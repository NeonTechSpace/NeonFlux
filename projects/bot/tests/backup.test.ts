import assert from "node:assert/strict"
import test from "node:test"
import { inspect } from "node:util"
import { createFixtures, createTestBot, createTestClient, type TestRoute } from "@neontechspace/fluxerly/effect/testing"
import { TestClock } from "effect/testing"
import { fakeClient, quietSignal } from "./backend-fake.ts"
import { Effect, Redacted, Schema } from "effect"
import {
    BackupItem,
    backupExclusions,
    type BackupBinding,
    type BackupItemBinding,
    type BackupManageRequest,
    type BackupManifest,
    type BackupNativeProof,
    type BackupPlan,
    type BackupPreviewJob,
    type BackupPreviewRequest,
    type BackupQueryRequest,
    type BackupStructureObject,
    type BackupWorkRequest,
} from "@neonflux/contracts/backup"
import { readConfig } from "../src/config.ts"
import { uploadBackupAttachment } from "../src/backup-attachments.ts"
import { parseServerScope } from "@neonflux/contracts/service"
import { parseBackupCommand } from "../src/backup-command.ts"
import {
    parseBackupKey,
    encryptBackupManifest,
    decryptBackupEnvelope,
    BackupCryptoError,
    backupEnvelopeLimit,
    backupPlaintextLimit,
} from "../src/backup-crypto.ts"
import { createCipheriv, createHash } from "node:crypto"
import {
    BackupStoreError,
    validateBackupManifest,
    backupBinding,
    backupItemBinding,
    type BackupStore,
} from "../src/backup-store.ts"
import { createBotOptions } from "../src/bot.ts"
import { pageKey, rememberPosition } from "../src/paging.ts"
import {
    markManagedChannels,
    nativeBackupCreate,
    processBackupPlanPass,
    processBackupJobPass,
    reconcileBackupPlan,
} from "../src/backup.ts"
import { snapshotBackupChannel } from "../src/backup-permissions.ts"
import { allowBotPosting, postingPermissions } from "../src/safety-permissions.ts"
import { ChannelType, Permissions, permissionBits } from "@neontechspace/fluxerly/effect"
import { permissionKeyTitles, permissionNames, permissionTitles } from "@neonflux/contracts/permission-names"
import { platform, token } from "./moderation-fixture.ts"
import { metadataLogCategories } from "../src/metadata-log-command.ts"
import { ownerChanges, syntheticPlan, withClock, type Change } from "./backup-fixture.ts"

const f = createFixtures(),
    encoded = Buffer.alloc(32, 17).toString("base64")
const key = () => parseBackupKey({ NEONFLUX_BACKUP_KEY: encoded })!
function cryptoRejected(body: () => unknown, reason: BackupCryptoError["reason"]) {
    assert.throws(body, (error: unknown) => {
        assert(error instanceof BackupCryptoError)
        assert.equal(error.reason, reason)
        const diagnostic = JSON.stringify(error)
        for (const secret of [encoded, "Synthetic private authored content"])
            assert(!diagnostic.includes(secret), "Failure diagnostics contain neither recovery material nor plaintext")
        return true
    })
}
/** An envelope with a valid tag around plaintext the manifest parser must still refuse */
function rawEnvelope(plaintext: string): Uint8Array {
    const version = Buffer.from([1]),
        nonce = Buffer.alloc(12, 7),
        cipher = createCipheriv("aes-256-gcm", Buffer.from(encoded, "base64"), nonce, { authTagLength: 16 })
    cipher.setAAD(version)
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    return Buffer.concat([version, nonce, cipher.getAuthTag(), ciphertext])
}

test("a top-level category without a parent field can be captured for a structure export", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const native = yield* createTestClient({ logging: { level: "silent" } }),
                    f = native.fixtures
                const { parent_id: _parentId, ...category } = f.channel({
                    type: ChannelType.Category,
                    name: "Synthetic category",
                    permission_overwrites: [],
                })
                native.rest.respond(`GET /channels/${category.id}`, { body: category })
                const channel = yield* native.client.channels.fetch(category.id)
                assert.equal(channel.parentId, undefined)
                assert.deepEqual(snapshotBackupChannel(channel, 1), {
                    sourceId: category.id,
                    type: "category",
                    name: category.name,
                    parentId: null,
                    capturedAt: 1,
                    overwrites: [],
                })
            }),
        ),
    )
})
test("a structure export captures the overwrite a lock leaves for the bot", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const native = yield* createTestClient({ logging: { level: "silent" } }),
                    f = native.fixtures,
                    channelId = f.nextId()
                const puts = native.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
                // A lock first allows the bot the posting bits it holds, which here include Create private threads
                yield* allowBotPosting(
                    native.client,
                    channelId,
                    f.ids.bot,
                    postingPermissions,
                    postingPermissions,
                    undefined,
                )
                const written = puts.requests()[0]!.body as { allow: string; deny: string }
                native.rest.respond(`GET /channels/${channelId}`, {
                    body: f.channel({
                        id: channelId,
                        permission_overwrites: [{ id: f.ids.bot, type: 1, allow: written.allow, deny: written.deny }],
                    }),
                })
                const channel = yield* native.client.channels.fetch(channelId)
                assert.deepEqual(snapshotBackupChannel(channel, 1).overwrites, [
                    { id: f.ids.bot, type: "member", allow: postingPermissions.toString(), deny: "0" },
                ])
            }),
        ),
    )
})
const manifest = (): BackupManifest => ({
    version: 1,
    backupId: "synthetic-archive",
    provider: "https://api.fluxer.app",
    serverId: f.ids.guild,
    selected: ["xp"],
    capturedAt: 1,
    observations: { databaseAt: 1, structureStartedAt: null, structureFinishedAt: null },
    counts: { config: 0, xp: 1, structure: 0, overwrites: 0 },
    exclusions: [...backupExclusions],
    config: [],
    xp: [{ sourceId: f.ids.user, userId: f.ids.user, xp: 123 }],
    structure: [],
})

test("backup grammar requires explicit categories, takes plan as another word for preview and never takes a typed plan", () => {
    assert.deepEqual(parseBackupCommand(["export", "config", "xp"]), { type: "export", selected: ["config", "xp"] })
    assert.deepEqual(parseBackupCommand(["inspect"]), { type: "inspect" })
    for (const type of ["status", "confirm", "reconcile", "forget"])
        assert.deepEqual(parseBackupCommand([type]), { type })
    // A preview is the plan a confirmation runs, so both words make it
    assert.deepEqual(parseBackupCommand(["plan"]), { type: "preview" })
    assert.deepEqual(parseBackupCommand(["plan", "next"]), { type: "preview", next: true })
    assert.deepEqual(parseBackupCommand(["items"]), { type: "items" })
    assert.deepEqual(parseBackupCommand(["items", "next"]), { type: "items", next: true })
    // The plan ID and hashes the owner once typed are refused, with no alias
    const typed = ["synthetic-plan", "a".repeat(64), "b".repeat(64)]
    for (const args of [
        ["export"],
        ["export", "all"],
        ["export", "xp", "xp"],
        ["plan", "https://synthetic.invalid/private"],
        ["inspect", "C:\\private.nfb"],
        ["confirm", "synthetic-plan"],
        ["key", encoded],
        ["confirm", ...typed],
        ["status", ...typed],
        ["reconcile", ...typed],
        ["forget", ...typed],
        ["items", "2"],
    ])
        assert("error" in parseBackupCommand(args))
})

test("optional key configuration stays redacted and refuses malformed or authentication key reuse", async () => {
    const config = await Effect.runPromise(
        readConfig({
            FLUXER_BOT_TOKEN: "synthetic-token",
            NEONFLUX_SERVER_ID: f.ids.guild,
            NEONFLUX_BACKUP_KEY: encoded,
        }),
    )
    assert(config.backupKey)
    assert.equal(inspect(config).includes(encoded), false)
    assert.equal(JSON.stringify(config).includes(encoded), false)
    assert.equal(parseBackupKey({}), undefined)
    for (const env of [
        { NEONFLUX_BACKUP_KEY: Buffer.alloc(31).toString("base64") },
        { NEONFLUX_BACKUP_KEY: encoded.replace(/=$/, "") },
        { NEONFLUX_BACKUP_KEY: encoded, FLUXER_BOT_TOKEN: encoded },
        { NEONFLUX_BACKUP_KEY: encoded, NEONFLUX_BOT_API_SECRET: encoded },
    ])
        cryptoRejected(() => parseBackupKey(env), "configuration")
})

test("AES envelope authenticates its version byte and random nonce before private manifest parsing", () => {
    const source = manifest(),
        keys = key(),
        first = encryptBackupManifest(source, keys),
        second = encryptBackupManifest(source, keys)
    assert.notDeepEqual(first, second)
    assert.equal(first[0], 1)
    assert.notDeepEqual(Buffer.from(first).subarray(1, 13), Buffer.from(second).subarray(1, 13))
    assert.deepEqual(validateBackupManifest(decryptBackupEnvelope(first, keys)), source)
    const payload = { content: "Synthetic private authored content" },
        bytes = encryptBackupManifest(payload, keys)
    assert(!Buffer.from(bytes).includes(Buffer.from(payload.content)))
    cryptoRejected(
        () =>
            decryptBackupEnvelope(
                bytes,
                parseBackupKey({ NEONFLUX_BACKUP_KEY: Buffer.alloc(32, 18).toString("base64") })!,
            ),
        "authentication",
    )
    for (const offset of [1, 13, 29]) {
        const changed = Buffer.from(bytes)
        changed[offset] = changed[offset]! ^ 1
        cryptoRejected(() => decryptBackupEnvelope(changed, keys), "authentication")
    }
    const versioned = Buffer.from(bytes)
    versioned[0] = 2
    cryptoRejected(() => decryptBackupEnvelope(versioned, keys), "envelope")
    cryptoRejected(() => decryptBackupEnvelope(Buffer.from(bytes).subarray(0, 20), keys), "envelope")
    cryptoRejected(
        () => decryptBackupEnvelope(rawEnvelope('{"content":"Synthetic private authored content"'), keys),
        "manifest",
    )
    const largest = "x".repeat(backupPlaintextLimit - 2),
        roundtrip = decryptBackupEnvelope(encryptBackupManifest(largest, keys), keys)
    assert.equal(
        (roundtrip as string).length,
        largest.length,
        "The largest archive a restore plan accepts remains readable",
    )
    cryptoRejected(() => encryptBackupManifest("x".repeat(backupPlaintextLimit), keys), "size")
    cryptoRejected(() => decryptBackupEnvelope(new Uint8Array(backupEnvelopeLimit + 1), keys), "size")
    cryptoRejected(() => decryptBackupEnvelope(rawEnvelope("x".repeat(backupPlaintextLimit + 1)), keys), "size")
})

test("manifest decoder refuses unsupported fields, overlapping overwrites, duplicate identities and mismatched counts", () => {
    const source = manifest()
    for (const value of [
        { ...source, version: 2 },
        { ...source, token: "Synthetic secret" },
        { ...source, counts: { ...source.counts, xp: 2 } },
        { ...source, xp: [source.xp[0], source.xp[0]], counts: { ...source.counts, xp: 2 } },
        { ...source, xp: [{ ...source.xp[0], resetEpoch: 99 }] },
    ])
        assert.throws(() => validateBackupManifest(value))
    const structure = (allow: string, deny: string): BackupStructureObject => ({
        sourceId: f.ids.channel,
        type: "text",
        name: "synthetic",
        parentId: null,
        overwrites: [{ id: f.ids.guild, type: "role", allow, deny }],
        capturedAt: 1,
    })
    const archive = (channel: BackupStructureObject): unknown => ({
        ...source,
        selected: ["structure"],
        observations: { databaseAt: null, structureStartedAt: 1, structureFinishedAt: 1 },
        counts: { config: 0, xp: 0, structure: 1, overwrites: 1 },
        xp: [],
        structure: [channel],
    })
    // An overwrite is kept as the server has it, so Administrator and a permission nobody names are archived, and only an overlap or a mask above 64 bits is not
    assert.doesNotThrow(() => validateBackupManifest(archive(structure("8", (1n << 19n).toString()))))
    assert.doesNotThrow(() => validateBackupManifest(archive(structure("18446744073709551615", "0"))))
    assert.throws(() => validateBackupManifest(archive(structure("8", "8"))))
    assert.throws(() => validateBackupManifest(archive(structure("18446744073709551616", "0"))))
})

test("Backup manifest decoding preserves role reservations and rejects malformed reservation rows", () => {
    const source = manifest(),
        value = {
            panelsEnabled: false,
            verificationEnabled: false,
            advancedVerificationEnabled: false,
            autoroleEnabled: true,
            humansOnly: true,
            autoroleIds: [],
            reservations: [{ userId: f.ids.user, roleIds: [f.role().id] }],
        }
    const roles = {
        ...source,
        selected: ["config"],
        counts: { config: 1, xp: 0, structure: 0, overwrites: 0 },
        xp: [],
        config: [{ family: "roles", sourceId: "roles", value }],
    }
    assert.deepEqual(validateBackupManifest(roles).config[0], roles.config[0])
    assert.throws(() =>
        validateBackupManifest({
            ...roles,
            config: [
                {
                    family: "roles",
                    sourceId: "roles",
                    value: { ...value, reservations: [{ userId: f.ids.user, roleIds: [] }] },
                },
            ],
        }),
    )
})

test("Backup manifest preserves finite event overrides and dormant paired destinations", () => {
    const source = manifest(),
        route = { eventType: "audit-entry:20", enabled: false, channelId: f.ids.channel, ownerId: f.ids.user }
    const value = {
        enabled: false,
        routes: metadataLogCategories.map((category) => ({ category, enabled: false })),
        eventRoutes: [route],
        messageChannelIds: [],
        excludedChannelIds: [],
    }
    const metadata = {
        ...source,
        selected: ["config"],
        counts: { config: 1, xp: 0, structure: 0, overwrites: 0 },
        xp: [],
        config: [{ family: "metadata", sourceId: "metadata", value }],
    }
    assert.deepEqual(validateBackupManifest(metadata).config[0], metadata.config[0])
    assert.doesNotThrow(() =>
        validateBackupManifest({
            ...metadata,
            config: [{ family: "metadata", sourceId: "metadata", value: { ...value, eventRoutes: [] } }],
        }),
    )
    for (const eventRoutes of [
        [{ ...route, eventType: "audit-entry:999" }],
        [{ ...route, ownerId: undefined }],
        [{ ...route, enabled: true, channelId: undefined, ownerId: undefined }],
        [route, route],
    ]) {
        assert.throws(() =>
            validateBackupManifest({
                ...metadata,
                config: [{ family: "metadata", sourceId: "metadata", value: { ...value, eventRoutes } }],
            }),
        )
    }
})

test("an announcement channel restores as an announcement channel with its text settings", () => {
    const channel: BackupStructureObject = {
        sourceId: f.ids.channel,
        type: "announcement",
        name: "news",
        parentId: null,
        overwrites: [],
        topic: "Synthetic news",
        slowmodeSeconds: 5,
        capturedAt: 1,
    }
    assert.deepEqual(nativeBackupCreate(channel), {
        type: ChannelType.Announcement,
        name: "news",
        parentId: null,
        permissionOverwrites: [],
        topic: "Synthetic news",
        rateLimitPerUser: 5,
    })
})
test("an overwrite with Manage messages allowed and a permission nobody names denied is archived and restored unchanged", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const native = yield* createTestClient({ logging: { level: "silent" } }),
                    fixtures = native.fixtures,
                    allow = Permissions.ManageMessages.toString(),
                    deny = (Permissions.ViewChannel | (1n << 19n)).toString()
                const channel = fixtures.channel({
                    permission_overwrites: [{ id: fixtures.ids.guild, type: 0, allow, deny }],
                })
                native.rest.respond(`GET /channels/${channel.id}`, { body: channel })
                const snapshot = snapshotBackupChannel(yield* native.client.channels.fetch(channel.id), 1)
                assert.deepEqual(snapshot.overwrites, [{ id: fixtures.ids.guild, type: "role", allow, deny }])
                // It passes the manifest decoder as the export builds it, and the create request carries the same bits
                const archive: BackupManifest = {
                    ...manifest(),
                    selected: ["structure"],
                    observations: { databaseAt: null, structureStartedAt: 1, structureFinishedAt: 1 },
                    counts: { config: 0, xp: 0, structure: 1, overwrites: 1 },
                    xp: [],
                    structure: [snapshot],
                }
                assert.deepEqual(validateBackupManifest(archive).structure[0]!.overwrites, snapshot.overwrites)
                assert.deepEqual(nativeBackupCreate(snapshot).permissionOverwrites, [
                    { id: fixtures.ids.guild, type: "role", allow: BigInt(allow), deny: BigInt(deny) },
                ])
            }),
        ),
    )
})
test("a channel that NeonFlux's tickets or voice rooms made is labelled in the export, and nothing else about it changes", async () => {
    const asked: string[][] = []
    const store = {
        query: (input: BackupQueryRequest) =>
            Effect.sync(() => {
                const op = input.operation as { type: "managed"; channelIds: string[] }
                asked.push(op.channelIds)
                return {
                    type: "managed",
                    channels: [
                        { id: "100000000000000002", managed: "ticket" },
                        { id: "100000000000000003", managed: "voiceRoom" },
                    ],
                }
            }),
    } as unknown as BackupStore
    const channel = (id: string): BackupStructureObject => ({
        sourceId: id,
        type: "text",
        name: `channel-${id}`,
        parentId: null,
        overwrites: [],
        capturedAt: 1,
    })
    const config = { serverId: f.ids.guild } as Parameters<typeof markManagedChannels>[1]
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                yield* bot.ready()
                const message = { author: { id: f.ids.user }, channelId: p.dmId }
                const objects = ["100000000000000001", "100000000000000002", "100000000000000003"].map(channel)
                const marked = yield* markManagedChannels(store, config, bot.client, message as never, objects)
                assert.deepEqual(
                    marked.map((x) => x.managed),
                    [undefined, "ticket", "voiceRoom"],
                )
                assert.deepEqual(asked, [objects.map((x) => x.sourceId)])
                // A label is not a difference, so an archive with it matches the same channel without it
                const { managed: _managed, ...plain } = marked[1]!
                assert.deepEqual(plain, objects[1])
                // Without channels nothing is asked
                assert.deepEqual(yield* markManagedChannels(store, config, bot.client, message as never, []), [])
                assert.equal(asked.length, 1)
            }),
        ),
    )
})
test("the permission titles the backend and the website show are the SDK's, by bit and by name", () => {
    const sdk = Object.entries(Permissions).map(([name, bit]) => ({
        bit: Number(bit.toString(2).length - 1),
        title: permissionBits.label(name as keyof typeof Permissions),
    }))
    assert.deepEqual(
        Object.entries(permissionTitles)
            .map(([bit, title]) => ({ bit: Number(bit), title }))
            .sort((a, b) => a.bit - b.bit),
        sdk.sort((a, b) => a.bit - b.bit),
    )
    assert.deepEqual(
        permissionKeyTitles,
        Object.fromEntries(
            Object.keys(Permissions).map((name) => [name, permissionBits.label(name as keyof typeof Permissions)]),
        ),
    )
    assert.deepEqual(
        permissionNames((Permissions.ManageMessages | Permissions.SendMessages | (1n << 19n)).toString()),
        ["Send messages", "Manage messages", "unnamed permissions"],
    )
    assert.deepEqual(permissionNames("0"), [])
})
test("item decoder accepts backend IDs for config/XP and rejects them for native structure", () => {
    const item: BackupItem = {
        planId: "synthetic-plan",
        revision: 1,
        planHash: "a".repeat(64),
        archiveDigest: "b".repeat(64),
        itemNo: 1,
        generation: 1,
        category: "xp",
        family: "xp",
        sourceId: f.ids.user,
        disposition: "create",
        reason: null,
        state: "created",
        expectedHash: "c".repeat(64),
        desiredHash: "d".repeat(64),
        dependencyItemNo: null,
        mappedId: "synthetic_convex_id",
    }
    assert.deepEqual(Schema.decodeSync(BackupItem, { onExcessProperty: "error" })(item), item)
    assert.throws(() =>
        Schema.decodeSync(BackupItem, { onExcessProperty: "error" })({
            ...item,
            category: "structure",
            family: "structure",
        }),
    )
})

test("production pipeline keeps server backup commands to a private hint and reserves namespace", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                yield* bot.ready()
                yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!backup export xp" }))
                yield* bot.idle()
                assert.equal(p.replies.requests().length, 1)
                assert.match((p.replies.requests()[0]!.body as { content: string }).content, /one-to-one DM/)
                assert.equal(p.open.requests().length, 0)
                assert.equal(p.self.requests().length, 0)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("Export over the restore byte limit names the 512 KiB limit instead of the ownership refusal", async () => {
    const id = (n: number) => String(100000000000000000n + BigInt(n))
    const config = Array.from({ length: 250 }, (_, i) => ({
        family: "cleanupPolicy",
        sourceId: id(i * 1000),
        value: {
            channelId: id(i * 1000),
            enabled: false,
            ageMs: 3600000,
            ownerId: f.ids.user,
            excludedAuthorIds: [],
            excludedMessageIds: Array.from({ length: 100 }, (_, j) => id(i * 1000 + j + 1)),
        },
    }))
    const store = {
        snapshot: () => Effect.succeed({ capturedAt: 0, config, xp: [], counts: { config: config.length, xp: 0 } }),
    } as unknown as BackupStore
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild, backupKey: key() }, { backup: store }),
                    ),
                    p = platform(bot)
                yield* bot.ready()
                const message = { ...bot.fixtures.message({ channel_id: p.dmId, content: "!backup export config" }) }
                delete message.guild_id
                yield* bot.emit("MESSAGE_CREATE", message)
                yield* p.replies.next()
                yield* bot.idle()
                assert.equal(p.replies.requests().length, 1)
                assert.match(
                    (p.replies.requests()[0]!.body as { content: string }).content,
                    /^This backup is larger than the 512 KiB one restore plan accepts\. Export fewer categories at a time$/,
                )
            }),
        ),
    )
})

test("an export over the XP, channel or overwrite limit names that limit instead of the ownership refusal", async () => {
    const store = {
        // The backend refuses a snapshot of more than 500 XP profiles as a whole
        snapshot: () => Effect.fail(new BackupStoreError({ operation: "snapshot", status: 413 })),
    } as unknown as BackupStore
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild, backupKey: key() }, { backup: store }),
                    ),
                    p = platform(bot)
                bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/channels`, {
                    body: Array.from({ length: 101 }, () => bot.fixtures.channel({ id: bot.fixtures.nextId() })),
                })
                yield* bot.ready()
                const say = ownerDm(bot, p)
                const limit = yield* say("!backup export xp")
                assert.match(limit, /XP for at most 500 members/)
                assert.match(
                    limit,
                    /500 settings items, counting each draft, template, response, automod rule and role panel/,
                )
                assert.match(yield* say("!backup export structure"), /more than the 100 channels/)
                // Six channels within the channel and per-channel limits whose overwrites total 504
                bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/channels`, {
                    body: Array.from({ length: 6 }, () =>
                        bot.fixtures.channel({
                            id: bot.fixtures.nextId(),
                            permission_overwrites: Array.from({ length: 84 }, () => ({
                                id: bot.fixtures.nextId(),
                                type: 0,
                                allow: "0",
                                deny: Permissions.ViewChannel.toString(),
                            })),
                        }),
                    ),
                })
                assert.match(yield* say("!backup export structure"), /500 permission overwrites/)
            }),
        ),
    )
})

test("a structure export keeps an overwrite that allows Manage messages instead of refusing it, and asks which channels NeonFlux made", async () => {
    const asked: string[][] = []
    const store = {
        query: (input: BackupQueryRequest) =>
            Effect.sync(() => {
                if (input.operation.type !== "managed") throw new Error(`Unexpected ${input.operation.type} query`)
                asked.push([...input.operation.channelIds])
                return { type: "managed", channels: [] }
            }),
    } as unknown as BackupStore
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild, backupKey: key() }, { backup: store }),
                    ),
                    p = platform(bot),
                    channel = bot.fixtures.channel({
                        permission_overwrites: [
                            {
                                id: bot.fixtures.ids.guild,
                                type: 0,
                                allow: Permissions.ManageMessages.toString(),
                                deny: Permissions.ViewChannel.toString(),
                            },
                        ],
                    })
                bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/channels`, { body: [channel] })
                yield* bot.ready()
                const message = { ...bot.fixtures.message({ channel_id: p.dmId, content: "!backup export structure" }) }
                delete message.guild_id
                yield* bot.emit("MESSAGE_CREATE", message)
                yield* p.replies.next()
                yield* bot.idle()
                // The one reply is the encrypted file, not a refusal
                assert.equal(p.replies.requests().length, 1)
                assert.equal(p.replies.requests()[0]!.files.length, 1)
                assert.deepEqual(asked, [[channel.id]])
            }),
        ),
    )
})

test("in multi mode a syntax hint carries the server selector", async () => {
    const server = createFixtures().ids.guild
    const client = fakeClient((call) => {
        if (call.path === "/service/scope") return { mode: "multi" }
        if (call.path === "/service/installations/list") return { serverIds: [server], nextCursor: null }
        if (call.path === "/moderation/gate")
            return {
                allowed: true,
                defcon: 3,
                messageProtectionEnabled: false,
                joinProtectionEnabled: false,
                botMessageProtectionEnabled: false,
            }
        return Response.json({ error: "Backend unavailable" }, { status: 503 })
    }, quietSignal)
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({
                        token,
                        scope: parseServerScope({ NEONFLUX_SERVER_MODE: "multi" }),
                        backupKey: key(),
                        backend: {
                            url: "https://synthetic.invalid",
                            secret: Redacted.make("synthetic-secret"),
                            client,
                        },
                    }),
                )
                const f = bot.fixtures,
                    p = platform(bot)
                bot.rest.respond("GET /users/@me/guilds", (request) => ({
                    body: request.query.after ? [] : [f.guild({ id: server })],
                }))
                yield* bot.ready()
                const say = ownerDm(bot, p)
                const hint = yield* say(`!backup --server ${server} export nope`)
                assert.match(hint, new RegExp(`Use !backup --server ${server} help privately`))
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})
test("the encrypted backup file names its server", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-backup-token" }),
                    dmId = bot.fixtures.nextId()
                const sent = bot.rest.respond("POST /channels/:id/messages", (request) => ({
                    body: bot.fixtures.message({ channel_id: dmId, content: "" }),
                }))
                yield* bot.ready()
                yield* uploadBackupAttachment(bot.client, dmId, new Uint8Array(40), "NeonBotLab")
                yield* uploadBackupAttachment(bot.client, dmId, new Uint8Array(40))
                const [labelled, plain] = sent
                    .requests()
                    .map((request) => (request.body as { content: string }).content)
                assert.match(labelled!, /^\*\*NeonBotLab\*\*: Your encrypted backup/)
                assert.match(plain!, /^Your encrypted backup/)
            }),
        ),
    )
})

test("a file that is not a backup gets its own reply instead of the general refusal", async () => {
    const junk = new Uint8Array(64).fill(7)
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions(
                            { token, serverId: f.ids.guild, backupKey: key() },
                            { backup: {} as BackupStore },
                        ),
                    ),
                    p = platform(bot)
                yield* bot.ready()
                const say = ownerDm(bot, p)
                assert.match(
                    yield* say("!backup inspect", attachArchive(bot, p, junk, "!backup inspect")()),
                    /^NeonFlux cannot read that file as a backup\. Send an archive that NeonFlux made, with the current backup key$/,
                )
            }),
        ),
    )
})

test("inspect without exactly one attached file asks for the archive instead of the general refusal", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions(
                            { token, serverId: f.ids.guild, backupKey: key() },
                            { backup: {} as BackupStore },
                        ),
                    ),
                    p = platform(bot)
                yield* bot.ready()
                const say = ownerDm(bot, p)
                assert.match(yield* say("!backup inspect"), /^Attach one encrypted \.nfb archive to !backup inspect$/)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("backup preview grammar takes an optional next", () => {
    assert.deepEqual(parseBackupCommand(["preview"]), { type: "preview" })
    assert.deepEqual(parseBackupCommand(["preview", "next"]), { type: "preview", next: true })
    for (const args of [
        ["preview", "2"],
        ["preview", "20"],
        ["preview", "next", "next"],
        ["preview", "x"],
    ])
        assert("error" in parseBackupCommand(args))
})

type TestBot = Effect.Success<ReturnType<typeof createTestBot>>
/** Sends a message in the owner's DM and answers the bot's replies as text. A card reads as its title, description and one line per field */
const ownerDm =
    (bot: TestBot, p: ReturnType<typeof platform>) =>
    (content: string, wire: Record<string, unknown> = {}) =>
        Effect.gen(function* () {
            const message = {
                ...bot.fixtures.message({ id: bot.fixtures.nextId(), channel_id: p.dmId, content }),
                ...wire,
            }
            delete message.guild_id
            const before = p.replies.requests().length
            yield* bot.emit("MESSAGE_CREATE", message)
            yield* p.replies.next()
            yield* bot.idle()
            return p.replies
                .requests()
                .slice(before)
                .map((request) => {
                    const { content, embeds } = request.body as {
                        content?: string
                        embeds?: {
                            title: string
                            description?: string
                            fields?: { name: string; value: string }[]
                            footer?: { text: string }
                        }[]
                    }
                    return (
                        content ??
                        embeds!
                            .map((e) =>
                                [
                                    e.title,
                                    e.description,
                                    ...(e.fields ?? []).map((x) => `${x.name}: ${x.value}`),
                                    e.footer?.text,
                                ]
                                    .filter(Boolean)
                                    .join("\n"),
                            )
                            .join("\n")
                    )
                })
                .join("\n")
        })
const noGain = { items: 0, bits: "0", switches: 0 }
/**
 * A restore plan store in memory. A preview makes a plan from the items the test gives and replaces the plan nobody confirmed, as the
 * backend does, and a confirmation sets the plan's time
 */
function planStore(archiveDigest: string, build: (plan: BackupPlan) => BackupItem[], gain = noGain) {
    const plans = new Map<string, BackupPlan>(),
        items = new Map<string, BackupItem[]>(),
        managed: BackupManageRequest[] = [],
        previews: BackupPreviewRequest[] = []
    const item = (plan: BackupPlan, itemNo: number, patch: Partial<BackupItem> = {}): BackupItem => ({
        ...backupBinding(plan),
        itemNo,
        generation: 1,
        category: "xp",
        family: "xp",
        sourceId: String(100000000000000000n + BigInt(itemNo)),
        disposition: "create",
        reason: null,
        state: "planned",
        expectedHash: "c".repeat(64),
        desiredHash: "d".repeat(64),
        dependencyItemNo: null,
        mappedId: null,
        ...patch,
    })
    const store = {
        preview: (input: BackupPreviewRequest) =>
            Effect.sync(() => {
                previews.push(input)
                for (const [id, old] of plans)
                    if (old.confirmedAt === undefined) {
                        plans.delete(id)
                        items.delete(id)
                    }
                const n = previews.length
                const base: BackupPlan = {
                    planId: `synthetic-plan-${n}`,
                    revision: 1,
                    planHash: String(n).repeat(64),
                    archiveDigest,
                    backupId: "synthetic-archive",
                    manifestDigest: "c".repeat(64),
                    provider: "https://api.fluxer.app",
                    serverId: f.ids.guild,
                    ownerId: f.ids.user,
                    createdAt: Date.now() + n,
                    expiresAt: Date.now() + 900000,
                    itemCount: 0,
                    counts: { create: 0, update: 0, delete: 0, skip: 0, blocked: 0 },
                    gain,
                    match: input.match,
                    forgotten: false,
                }
                const rows = build(base)
                const counts = { create: 0, update: 0, delete: 0, skip: 0, blocked: 0 }
                for (const row of rows) counts[row.disposition]++
                const plan = { ...base, itemCount: rows.length, counts }
                plans.set(plan.planId, plan)
                items.set(plan.planId, rows)
                return { plan }
            }),
        manage: (input: BackupManageRequest) =>
            Effect.sync(() => {
                managed.push(input)
                const plan = { ...plans.get(input.operation.binding.planId)!, confirmedAt: Date.now() }
                plans.set(plan.planId, plan)
                return { type: "confirmed", duplicate: false, plan }
            }),
        query: (input: BackupQueryRequest) =>
            Effect.suspend((): Effect.Effect<unknown, BackupStoreError> => {
                const op = input.operation
                if (op.type === "plans") return Effect.succeed({ type: "plans", plans: [...plans.values()] })
                if (op.type === "origins") return Effect.succeed({ type: "origins", origins: [] as never[] })
                if (op.type === "plan" || op.type === "items") {
                    const plan = plans.get(op.binding.planId)
                    // A plan that a newer preview replaced is gone
                    if (!plan) return Effect.fail(new BackupStoreError({ operation: "query", status: 404 }))
                    assert.deepEqual(backupBinding(op.binding), backupBinding(plan))
                    return Effect.succeed(
                        op.type === "plan" ? { type: "plan", plan } : { type: "items", items: items.get(plan.planId)! },
                    )
                }
                if (op.type === "item") {
                    const row = items.get(op.binding.planId)![op.binding.itemNo - 1]!
                    return Effect.succeed({
                        type: "item",
                        item: row,
                        object: { sourceId: row.sourceId, userId: row.sourceId, xp: 10 },
                    })
                }
                throw new Error(`Unexpected query ${op.type}`)
            }),
        work: (input: BackupWorkRequest) =>
            Effect.sync(() => {
                const binding = input.operation.binding as BackupItemBinding,
                    list = items.get(binding.planId)!,
                    row = list[binding.itemNo - 1]!
                const state: BackupItem["state"] =
                    row.disposition === "blocked"
                        ? "blocked"
                        : row.disposition === "update"
                          ? "updated"
                          : row.disposition === "skip"
                            ? "skipped"
                            : "created"
                list[binding.itemNo - 1] = { ...row, state }
                return { type: "item", item: list[binding.itemNo - 1] }
            }),
    } as unknown as BackupStore
    return { store, plans, items, managed, previews, item }
}
/** Pages and the plan shown last stay in memory by server, DM and member, which tests with the same fixture IDs share */
function forgetShown(p: ReturnType<typeof platform>) {
    for (const list of ["plan", "preview", "items"])
        rememberPosition(
            pageKey(f.ids.guild, { channelId: p.dmId, author: { id: f.ids.user } }, "backup", list),
            undefined,
        )
}
/** Attaches the archive to a DM message, served from the media origin the bot accepts */
function attachArchive(bot: TestBot, p: ReturnType<typeof platform>, archive: Uint8Array, content = "!backup preview") {
    const attached = (filename = "neonflux-backup-archive.nfb") => {
        const id = bot.fixtures.nextId(),
            attachmentId = bot.fixtures.nextId()
        const wire = {
            id,
            attachments: [
                {
                    id: attachmentId,
                    filename,
                    size: archive.length,
                    flags: 0,
                    content_type: "application/octet-stream",
                    url: `https://fluxerusercontent.com/attachments/${p.dmId}/${attachmentId}/${encodeURIComponent(filename)}`,
                },
            ],
        }
        const message: Record<string, unknown> = {
            ...bot.fixtures.message({ channel_id: p.dmId, content }),
            ...wire,
        }
        delete message.guild_id
        bot.rest.respond(`GET /channels/${p.dmId}/messages/${id}`, { body: message })
        return wire
    }
    bot.rest.respond(
        (request) => request.url.startsWith("https://fluxerusercontent.com/attachments/"),
        () => new Response(archive),
    )
    return attached
}

test("a preview is the plan a confirmation runs: it shows what each item will do, what it grants and turns on, ten to a page", async () => {
    const archive = encryptBackupManifest(manifest(), key())
    const { store, plans, item, previews } = planStore(
        createHash("sha256").update(archive).digest("hex"),
        (plan) => [
            item(plan, 1, {
                category: "structure",
                family: "structure",
                sourceId: f.ids.channel,
                name: "general",
                gain: true,
            }),
            item(plan, 2, {
                category: "config",
                family: "cleanupPolicy",
                sourceId: f.ids.channel,
                disposition: "update",
                changed: ["ageMs", "parentId", "xpPerMessage", "enabled"],
                on: true,
                warning: `Turns on message cleanup: messages older than 30 days in <#${f.ids.channel}> will be deleted`,
            }),
            item(plan, 3, { disposition: "update", changed: ["xp"] }),
            item(plan, 4, { disposition: "skip" }),
            item(plan, 5, {
                disposition: "blocked",
                reason: "The server has reached its limit of 50,000 members with XP",
            }),
            ...Array.from({ length: 8 }, (_, i) => item(plan, 6 + i)),
        ],
        { items: 1, bits: Permissions.ManageMessages.toString(), switches: 1 },
    )
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild, backupKey: key() }, { backup: store }),
                    ),
                    p = platform(bot)
                yield* bot.ready()
                forgetShown(p)
                const say = ownerDm(bot, p),
                    attached = attachArchive(bot, p, archive)
                assert.equal(
                    yield* say("!backup preview"),
                    "No restore preview yet. Attach an encrypted .nfb archive to !backup preview, or send !backup status to pick up your latest plan",
                )
                const first = (yield* say("!backup preview", attached())).split("\n")
                // The time comes from the stored plan, never from the clock before the call
                const checked = `Checked <t:${Math.floor(plans.get("synthetic-plan-1")!.createdAt / 1000)}:R>, nothing changed yet`
                assert.deepEqual(first.slice(0, 7), [
                    "Restore preview",
                    `${checked}. 9 to create, 2 to update, 1 identical, 1 blocked`,
                    "1 item gives more permissions than the server has now: Manage messages",
                    "1 setting turns on",
                    "1 item starts to delete messages or post logs, see its line",
                    "XP of <@100000000000000005>: Blocked. The server has reached its limit of 50,000 members with XP",
                    "Channel **general**: Will be created, more permissions than now",
                ])
                assert.equal(
                    first[7],
                    `Message cleanup in <#${f.ids.channel}>: Will be updated (age ms, category, XP per message, enabled), turns a setting on. Turns on message cleanup: messages older than 30 days in <#${f.ids.channel}> will be deleted`,
                )
                assert.equal(first[8], "XP of <@100000000000000003>: Will be updated (XP)")
                assert.deepEqual(first.slice(-2), [
                    `To restore, send \`!backup confirm\` before <t:${Math.floor(plans.get("synthetic-plan-1")!.expiresAt / 1000)}:f>. A restore checks every item again`,
                    "Next: `!backup preview next`",
                ])
                const next = (yield* say("!backup preview next")).split("\n")
                assert.equal(next.filter((line) => line.startsWith("XP of")).length, 3)
                assert.equal(
                    yield* say("!backup preview next"),
                    "There is no next page to show. Send !backup preview to start the list again",
                )
                // Without a file it shows the first page of the plan it showed last, and plan is another word for it
                assert.equal((yield* say("!backup preview")).split("\n")[0], "Restore preview")
                assert.equal((yield* say("!backup plan", attached())).split("\n")[0], "Restore preview")
                assert.equal(previews.length, 2)
                assert.match(yield* say("!backup preview 2"), /^Invalid backup command/)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("a match preview asks for deletions and the card says what will be deleted, and a preview without match asks for none", async () => {
    const archive = encryptBackupManifest(manifest(), key())
    const warning = "Deletes the channel with its messages, files, webhooks and invites, which cannot be undone"
    // The backend numbers deletions after every other item, and the preview still lists them first
    const { store, previews, item } = planStore(createHash("sha256").update(archive).digest("hex"), (plan) => [
        item(plan, 1, {
            category: "structure",
            family: "structure",
            sourceId: f.ids.user,
            name: "rules",
            disposition: "update",
            changed: ["name", "permissions"],
        }),
        item(plan, 2, {
            category: "structure",
            family: "structure",
            sourceId: f.ids.guild,
            name: "tickets",
            disposition: "skip",
            reason: "A ticket channel belongs to its ticket, so a restore leaves it alone",
        }),
        item(plan, 3, {
            category: "config",
            family: "cleanupPolicy",
            sourceId: f.ids.channel,
            disposition: "update",
            warning: `Turns on message cleanup: messages older than 30 days in <#${f.ids.channel}> will be deleted`,
        }),
        item(plan, 4, {
            category: "structure",
            family: "structure",
            sourceId: f.ids.channel,
            name: "old-room",
            disposition: "delete",
            warning,
            extra: true,
        }),
    ])
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild, backupKey: key() }, { backup: store }),
                    ),
                    p = platform(bot)
                yield* bot.ready()
                forgetShown(p)
                const say = ownerDm(bot, p),
                    attached = attachArchive(bot, p, archive)
                // Match needs the archive, since it makes a new plan
                assert.equal(
                    yield* say("!backup preview match"),
                    "Match needs the archive. Attach the encrypted .nfb archive to !backup preview match",
                )
                assert.equal(previews.length, 0)
                const lines = (yield* say("!backup preview match", attached())).split("\n")
                assert.equal(previews[0]!.match, true)
                assert.equal(lines[1]!.endsWith("2 to update, 1 to delete, 1 identical"), true)
                // The delete has the line of its own, so the line for work that starts counts only the setting that turns message cleanup on
                assert.deepEqual(lines.slice(2, 8), [
                    "1 channel or category will be deleted with its messages. This cannot be undone",
                    "1 item starts to delete messages or post logs, see its line",
                    "Channel **old-room**: Will be deleted. " + warning,
                    "Channel **rules**: Will be updated (name, permissions)",
                    "Channel **tickets**: Left alone. A ticket channel belongs to its ticket, so a restore leaves it alone",
                    `Message cleanup in <#${f.ids.channel}>: Will be updated. Turns on message cleanup: messages older than 30 days in <#${f.ids.channel}> will be deleted`,
                ])
                // Plan is another word for preview, and without match it asks for no deletion
                yield* say("!backup plan", attached())
                assert.equal(previews[1]!.match, false)
                // A match plan that the backend refuses for its size says so, and a plain preview keeps the general words
                const oversize = {
                    ...store,
                    preview: () => Effect.fail(new BackupStoreError({ operation: "preview", status: 413 })),
                }
                const big = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild, backupKey: key() },
                        { backup: oversize as unknown as BackupStore },
                    ),
                )
                const q = platform(big)
                yield* big.ready()
                forgetShown(q)
                const sayBig = ownerDm(big, q),
                    attachedBig = attachArchive(big, q, archive)
                assert.match(
                    yield* sayBig("!backup preview match", attachedBig()),
                    /^Match would make a plan of more than 500 items/,
                )
                assert.match(
                    yield* sayBig("!backup preview", attachedBig()),
                    /^A restore refuses this archive as a whole/,
                )
                // A check made while a restore from the dashboard runs says why it is refused
                const running = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild, backupKey: key() },
                        {
                            backup: {
                                ...store,
                                preview: () => Effect.fail(new BackupStoreError({ operation: "preview", status: 409 })),
                            } as unknown as BackupStore,
                        },
                    ),
                )
                const r = platform(running)
                yield* running.ready()
                forgetShown(r)
                assert.equal(
                    yield* ownerDm(running, r)("!backup preview", attachArchive(running, r, archive)()),
                    "A restore started on the dashboard is running. Preview again when it ends",
                )
                // A server that keeps the most plans it may is told so, instead of to try again shortly
                const full = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild, backupKey: key() },
                        {
                            backup: {
                                ...store,
                                preview: () => Effect.fail(new BackupStoreError({ operation: "preview", status: 429 })),
                            } as unknown as BackupStore,
                        },
                    ),
                )
                const c = platform(full)
                yield* full.ready()
                forgetShown(c)
                assert.equal(
                    yield* ownerDm(full, c)("!backup preview", attachArchive(full, c, archive)()),
                    "This server already keeps 10 restore plans, the most it may keep. Every confirmed plan counts, forgotten ones too, for at least seven days after it expires, and longer while a created channel's outcome is unknown. A preview nobody confirmed is replaced by the next one. Preview again once an older plan is removed",
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("confirm runs the restore plan shown last with its exact hashes, and says when a newer preview replaced it", async () => {
    const archive = encryptBackupManifest(manifest(), key())
    // Each plan holds 10 members' XP to create, one to update and one conflict, so its items take two pages
    const { store, plans, managed, item } = planStore(createHash("sha256").update(archive).digest("hex"), (plan) =>
        Array.from({ length: 12 }, (_, i) =>
            item(
                plan,
                i + 1,
                i === 11
                    ? { disposition: "blocked", reason: "The member already has different XP" }
                    : i === 10
                      ? { disposition: "update", changed: ["xp"] }
                      : {},
            ),
        ),
    )
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild, backupKey: key() }, { backup: store }),
                    ),
                    p = platform(bot)
                yield* bot.ready()
                forgetShown(p)
                const say = ownerDm(bot, p),
                    attached = attachArchive(bot, p, archive)
                const refusal =
                    "There is no restore plan to work on here. Attach the archive to !backup preview again, or send !backup status to pick up your latest plan"
                // Before any plan is shown, nothing is confirmed
                assert.equal(yield* say("!backup confirm"), refusal)
                assert.equal(managed.length, 0)
                // A browser's renamed copy is refused with the name rule
                assert.match(
                    yield* say("!backup preview", attached("neonflux-backup-archive (1).nfb")),
                    /^NeonFlux cannot use the attached file\. Check its name, size and type\. .+ rename a copy such as neonflux-backup-archive \(1\)\.nfb first$/,
                )
                // Each preview replaces the plan nobody confirmed, so the first plan is gone after the second
                assert.match(yield* say("!backup preview", attached()), /^Restore preview\n/)
                const first = [...plans.values()][0]!
                assert.match(yield* say("!backup preview", attached()), /^Restore preview\n/)
                assert.deepEqual([...plans.keys()], ["synthetic-plan-2"])
                const progress = yield* say("!backup confirm")
                const confirms = managed.map((row) => (row.operation as { binding: BackupBinding }).binding)
                assert.deepEqual(confirms, [backupBinding(plans.get("synthetic-plan-2")!)])
                assert.equal(first.confirmedAt, undefined)
                assert.equal(
                    progress,
                    [
                        "Restore progress",
                        "This run: 10 created, 1 updated, 1 blocked",
                        "Every item is done",
                        "`!backup items` lists problems first",
                        "Finished items stay in place. Nothing is rolled back",
                    ].join("\n"),
                )
                // Items page at 10, the conflict first
                const firstPage = (yield* say("!backup items")).split("\n")
                assert.deepEqual(firstPage.slice(0, 2), [
                    "Restore items",
                    `XP of <@100000000000000012>: Blocked. The member already has different XP`,
                ])
                assert.equal(firstPage.filter((line) => line.startsWith("XP of")).length, 10)
                assert.deepEqual(firstPage.slice(-2), [
                    "Next: `!backup items next`",
                    "Items that need attention come first",
                ])
                assert.equal(
                    (yield* say("!backup items next")).split("\n").filter((line) => line.startsWith("XP of")).length,
                    2,
                )
                assert.equal(
                    yield* say("!backup items next"),
                    "There is no next page to show. Send !backup items to start the list again",
                )
                // Status shows the newest plan and its progress, and confirm refuses once the plan expired
                assert.match(
                    yield* say("!backup status"),
                    /^Restore plan\n10 created, 1 updated, 1 blocked\nConfirmed <t:\d+:R>\. Expires <t:\d+:f>\n`!backup items` lists problems first\n/,
                )
                // The plan shown again after it was confirmed says so and no longer offers to start it
                const again = yield* say("!backup preview")
                assert.match(again, /^Restore preview\nChecked <t:\d+:R>, confirmed <t:\d+:R>\. /)
                assert.doesNotMatch(again, /To restore/)
                plans.set("synthetic-plan-2", { ...plans.get("synthetic-plan-2")!, expiresAt: Date.now() - 1000 })
                assert.match(
                    yield* say("!backup confirm"),
                    /^This restore plan expired <t:\d+:R>\. Attach the archive to !backup preview again to make a new one$/,
                )
                assert.equal(managed.length, 1)
                // Another preview replaces nothing that was confirmed. The plan shown last is then the newest one, and a plan that is gone says so
                assert.match(yield* say("!backup preview", attached()), /^Restore preview\n/)
                plans.delete("synthetic-plan-3")
                assert.equal(
                    yield* say("!backup confirm"),
                    "That preview was replaced. Send !backup status to pick up the newest plan, or attach the archive to !backup preview again",
                )
                assert.equal(yield* say("!backup confirm"), refusal)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("the website's preview refresh reads the archive message as the bot and reports why it could not", async () => {
    const failures: string[] = [],
        answered: number[] = []
    const store = (job: BackupPreviewJob | null) =>
        ({
            previewReady: () => Effect.succeed({ job }),
            previewFailed: (_: string, requestedAt: number, failure: string) =>
                Effect.sync(() => {
                    answered.push(requestedAt)
                    failures.push(failure)
                    return { recorded: true }
                }),
        }) as unknown as BackupStore
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot),
                    messageId = bot.fixtures.nextId()
                yield* bot.ready()
                const job = { ownerId: f.ids.user, channelId: p.dmId, messageId, requestedAt: 7000, match: false }
                const config = (backupKey?: ReturnType<typeof key>) =>
                    ({ serverId: f.ids.guild, ...(backupKey ? { backupKey } : {}) }) as Parameters<
                        typeof processBackupJobPass
                    >[1]
                yield* processBackupJobPass(store(null), config(key()), bot.client)
                yield* processBackupJobPass(store(job), config(), bot.client)
                const missing = bot.rest.respond(`GET /channels/${p.dmId}/messages/${messageId}`, {
                    status: 404,
                    body: { code: "UNKNOWN_MESSAGE", message: "Unknown Message" },
                })
                yield* processBackupJobPass(store(job), config(key()), bot.client)
                assert.equal(missing.requests().length, 1)
                // A sender who no longer owns the server is refused before the archive message is read
                p.guildRoute.remove()
                bot.rest.respond(`GET /guilds/${f.ids.guild}`, {
                    body: bot.fixtures.guild({ owner_id: bot.fixtures.nextId() }),
                })
                yield* processBackupJobPass(store(job), config(key()), bot.client)
                assert.equal(missing.requests().length, 1)
            }),
        ),
    )
    assert.deepEqual(failures, ["key", "archive", "owner"])
    // Each answer names the request it answers
    assert.deepEqual(answered, [7000, 7000, 7000])
})

test("production private disabled backup commands check actual Owner before revealing configuration help", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                yield* bot.ready()
                const message = { ...bot.fixtures.message({ channel_id: p.dmId, content: "!backup export xp" }) }
                delete message.guild_id
                yield* bot.emit("MESSAGE_CREATE", message)
                // Backup commands run beside the serial message handler, so wait for the reply itself
                yield* p.replies.next()
                yield* bot.idle()
                assert.equal(p.replies.requests().length, 1)
                assert.match((p.replies.requests()[0]!.body as { content: string }).content, /no NEONFLUX_BACKUP_KEY/)
                assert.equal(bot.failures().length, 0)
                p.guildRoute.remove()
                bot.rest.respond(`GET /guilds/${f.ids.guild}`, {
                    body: bot.fixtures.guild({ owner_id: bot.fixtures.nextId() }),
                })
                yield* bot.emit("MESSAGE_CREATE", { ...message, id: bot.fixtures.nextId() })
                yield* bot.idle()
                // A refused owner check stays silent and never fails the shared message handler
                assert.equal(p.replies.requests().length, 1)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

/**
 * Restores count new text channels in one confirmation pass. Each keeps a member and an everyone overwrite, so its proof reads a member.
 * With config, it restores count cleanup policies instead, each naming its own channel. With reconcile, it rechecks count channels an earlier
 * pass created with unknown results. during changes Fluxer while the first item's proof reads its channel for the first time
 */
const restorePass = (
    count: number,
    options: {
        config?: boolean
        reconcile?: boolean
        refuseCreate?: boolean
        during?: Change
        onClaim?: (bot: TestBot, p: ReturnType<typeof platform>, object: BackupStructureObject) => void
    } = {},
) =>
    Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
            p = platform(bot)
        yield* bot.ready()
        // The pass runs on a clock that stands still, so a slow machine never reaches the 30-second renewal of the Owner check
        const now = Date.now()
        const plan = syntheticPlan({
            planId: "synthetic-structure-plan",
            createdAt: now,
            expiresAt: now + 900000,
            confirmedAt: now,
            itemCount: count,
            counts: { create: count, update: 0, delete: 0, skip: 0, blocked: 0 },
        })
        const objects = Array.from({ length: count }, (_, i): BackupStructureObject => ({
            sourceId: bot.fixtures.nextId(),
            type: "text",
            name: `restored-${i + 1}`,
            parentId: null,
            topic: null,
            nsfw: false,
            slowmodeSeconds: 0,
            capturedAt: 1,
            overwrites: [
                { id: p.targetId, type: "member", allow: "1024", deny: "0" },
                { id: f.ids.guild, type: "role", allow: "0", deny: "1024" },
            ],
        }))
        const policies = objects.map((object) => ({
            family: "cleanupPolicy",
            sourceId: object.sourceId,
            value: { channelId: object.sourceId, enabled: false },
        }))
        // The channel each item's proof reads: Its original, the channel a policy names, or the channel an earlier pass created
        const readIds = objects.map((object) => (options.reconcile ? bot.fixtures.nextId() : object.sourceId))
        const items = objects.map((object, i): BackupItem => ({
            ...backupBinding(plan),
            itemNo: i + 1,
            generation: 1,
            category: options.config ? "config" : "structure",
            family: options.config ? "cleanupPolicy" : "structure",
            sourceId: object.sourceId,
            disposition: "create",
            reason: null,
            state: options.reconcile ? "uncertain" : "planned",
            expectedHash: "c".repeat(64),
            desiredHash: "d".repeat(64),
            dependencyItemNo: null,
            mappedId: options.reconcile ? readIds[i]! : null,
        }))
        // The original channels are gone, and each policy's and earlier pass's channel exists. A created channel reads back as created
        let changed: TestRoute | undefined
        const originals = readIds.map((id, i) =>
            bot.rest.respond(`GET /channels/${id}`, () => {
                if (i === 0 && options.during) changed ??= options.during(bot, p)
                return options.config || options.reconcile
                    ? { body: bot.fixtures.channel({ id, name: objects[i]!.name }) }
                    : { status: 404, body: { code: "UNKNOWN_CHANNEL", message: "Unknown Channel" } }
            }),
        )
        const created = new Map<string, ReturnType<typeof bot.fixtures.channel>>()
        const creates = bot.rest.respond(`POST /guilds/${f.ids.guild}/channels`, (request) => {
            if (options.refuseCreate)
                return {
                    status: 400,
                    body: { code: "MAX_GUILD_CHANNELS", message: "Maximum number of channels reached" },
                }
            const body = request.body as { name: string; type: number; permission_overwrites: [] }
            const channel = bot.fixtures.channel({
                id: bot.fixtures.nextId(),
                name: body.name,
                type: body.type,
                permission_overwrites: body.permission_overwrites,
            })
            created.set(channel.id, channel)
            return { body: channel }
        })
        bot.rest.respond(
            (request) => request.method === "GET" && created.has(request.path.split("/")[2]!),
            (request) => ({ body: created.get(request.path.split("/")[2]!) }),
        )
        const writes: BackupWorkRequest["operation"][] = []
        const grant = (i: number) => ({
            ...backupItemBinding(items[i]!),
            provider: plan.provider,
            serverId: f.ids.guild,
            ownerId: f.ids.user,
            botId: f.ids.bot,
            sourceId: objects[i]!.sourceId,
            action: "create" as const,
            channel: objects[i]!,
            dispatchExpiresAt: plan.expiresAt,
            nativeDeadlineMs: 5000,
        })
        const store = {
            query: (input: BackupQueryRequest) =>
                Effect.sync(() => {
                    const op = input.operation
                    if (op.type === "plan") return { type: "plan", plan }
                    if (op.type === "items") return { type: "items", items }
                    if (op.type === "origins") return { type: "origins", origins: [] }
                    if (op.type === "item")
                        return {
                            type: "item",
                            item: items[op.binding.itemNo - 1],
                            object: (options.config ? policies : objects)[op.binding.itemNo - 1],
                        }
                    throw new Error(`Unexpected query ${op.type}`)
                }),
            work: (input: BackupWorkRequest) =>
                Effect.sync(() => {
                    const op = input.operation,
                        i = (op.binding as BackupItemBinding).itemNo - 1
                    writes.push(op)
                    if (op.type === "apply" || op.type === "reconcile") {
                        items[i] = { ...items[i]!, state: "created" }
                        return { type: "item", item: items[i] }
                    }
                    if (op.type === "reserve") {
                        items[i] = { ...items[i]!, state: "reserved" }
                        return { type: "grant", item: items[i], grant: grant(i), claimed: false }
                    }
                    if (op.type === "claim") {
                        options.onClaim?.(bot, p, objects[i]!)
                        items[i] = { ...items[i]!, state: "claimed" }
                        return { type: "grant", item: items[i], grant: grant(i), claimed: true }
                    }
                    if (op.type !== "outcome") throw new Error(`Unexpected work ${op.type}`)
                    items[i] = { ...items[i]!, state: op.outcome, mappedId: op.mappedId }
                    return { type: "item", item: items[i] }
                }),
        } as unknown as BackupStore
        yield* bot.idle()
        const routes = {
            guild: p.guildRoute,
            roles: p.rolesRoute,
            owner: p.actor,
            bot: p.ownMember,
            member: p.target,
            dm: p.privateFetch,
            original: { requests: () => originals.flatMap((r) => r.requests()) },
        }
        const before = Object.fromEntries(Object.entries(routes).map(([k, r]) => [k, r.requests().length]))
        const config = { serverId: f.ids.guild } as Parameters<typeof processBackupPlanPass>[1]
        const exit = yield* Effect.exit(
            options.reconcile
                ? Effect.asVoid(reconcileBackupPlan(store, config, bot.client, plan, p.dmId))
                : Effect.asVoid(processBackupPlanPass(store, config, bot.client, plan, p.dmId)),
        ).pipe(withClock(() => now))
        const reads = Object.fromEntries(
            Object.entries(routes).map(([k, r]) => [k, r.requests().length - before[k]!]),
        ) as Record<keyof typeof routes, number>
        return {
            exit,
            reads,
            creates: creates.requests().length,
            writes,
            outcomes: writes.filter((op) => op.type === "outcome"),
            changed,
        }
    })

test("a structure restore reads the server's authority once for the pass, then before reserving and twice after claiming each channel", async () => {
    const { exit, reads, creates, outcomes } = await Effect.runPromise(Effect.scoped(restorePass(3)))
    assert.equal(exit._tag, "Success")
    assert.equal(creates, 3)
    assert.deepEqual(
        outcomes.map((o) => o.outcome),
        ["created", "created", "created"],
    )
    // One Owner check opens the pass, and its reads serve the plan check, the items, the earlier channels and every channel's first proof. A fresh
    // one after that proof covers a channel's reservation and claim. After the claim a fresh proof and a last Owner check precede the create.
    // Every check reads the server, its roles, both members and the DM, and every proof the original channel and the overwrite's member
    const pass = 1,
        checks = 3 * 3,
        proofs = 2 * 3
    assert.deepEqual(reads, {
        guild: pass + checks,
        roles: pass + checks,
        owner: pass + checks,
        bot: pass + checks,
        member: proofs,
        dm: pass + checks,
        original: proofs,
    })
})

test("a channel create that Fluxer refuses settles as failed without a dispatch, so a new preview can try it again", async () => {
    const { exit, creates, outcomes } = await Effect.runPromise(Effect.scoped(restorePass(1, { refuseCreate: true })))
    assert.equal(exit._tag, "Success")
    assert.equal(creates, 1)
    assert.equal(outcomes.length, 1)
    const outcome = outcomes[0]!
    assert.equal(outcome.type === "outcome" && outcome.outcome, "failed")
    assert.equal(outcome.type === "outcome" && outcome.noDispatch, true)
    assert.equal(outcome.type === "outcome" && outcome.mappedId, null)
})

test("a structure restore reads the Owner, the DM, the members and the original channel again after its claim and creates nothing they refuse", async () => {
    const changes: Record<
        string,
        (bot: TestBot, p: ReturnType<typeof platform>, object: BackupStructureObject) => TestRoute
    > = {
        ...ownerChanges,
        "the overwrite's member left": (bot, p) =>
            bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, {
                status: 404,
                body: { code: "UNKNOWN_MEMBER", message: "Unknown Member" },
            }),
        "the original channel exists again": (bot, _, object) =>
            bot.rest.respond(`GET /channels/${object.sourceId}`, {
                body: bot.fixtures.channel({ id: object.sourceId, name: object.name }),
            }),
    }
    for (const [name, change] of Object.entries(changes)) {
        let changed: TestRoute | undefined
        const { creates, outcomes } = await Effect.runPromise(
            Effect.scoped(
                restorePass(1, {
                    onClaim: (bot, p, object) => {
                        changed = change(bot, p, object)
                    },
                }),
            ),
        )
        assert.equal(changed!.requests().length > 0, true, name)
        assert.equal(creates, 0, name)
        assert.deepEqual(
            outcomes.map((o) => [o.outcome, o.noDispatch]),
            [["failed", true]],
            name,
        )
    }
})

test("a structure restore checks the Owner and the DM again after its last channel and member reads, right before the create", async () => {
    // Each change lands while the post-claim proof reads the original channel, after that proof's own Owner check
    for (const [name, change] of Object.entries(ownerChanges)) {
        let changed: TestRoute | undefined
        const { creates, outcomes } = await Effect.runPromise(
            Effect.scoped(
                restorePass(1, {
                    onClaim: (bot, p, object) => {
                        bot.rest.respond(`GET /channels/${object.sourceId}`, () => {
                            changed ??= change(bot, p)
                            return { status: 404, body: { code: "UNKNOWN_CHANNEL", message: "Unknown Channel" } }
                        })
                    },
                }),
            ),
        )
        assert.equal(changed!.requests().length > 0, true, name)
        assert.equal(creates, 0, name)
        assert.deepEqual(
            outcomes.map((o) => [o.outcome, o.noDispatch]),
            [["failed", true]],
            name,
        )
    }
})

test("a restore checks the Owner and the DM again after its native reads and before it reserves a channel or applies settings", async () => {
    // Each change lands while the first item's proof reads its channel, after the Owner check that proof reuses
    for (const config of [false, true])
        for (const [name, change] of Object.entries(ownerChanges)) {
            const label = `${config ? "config" : "structure"}: ${name}`
            const { writes, creates, changed } = await Effect.runPromise(
                Effect.scoped(restorePass(1, { config, during: change })),
            )
            assert.equal(changed!.requests().length > 0, true, label)
            assert.deepEqual(writes, [], label)
            assert.equal(creates, 0, label)
        }
})

test("the cleanup module's proof reads the channels of the cleanup policies in the archive, since turning it on resumes them", async () => {
    const natives: (BackupNativeProof | null)[] = []
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                yield* bot.ready()
                const channel = bot.fixtures.channel({ id: bot.fixtures.nextId(), name: "cleaned" })
                bot.rest.respond(`GET /channels/${channel.id}`, { body: channel })
                const plan = syntheticPlan({
                    planId: "synthetic-cleanup-plan",
                    createdAt: Date.now(),
                    expiresAt: Date.now() + 900000,
                    confirmedAt: Date.now(),
                    itemCount: 3,
                    counts: { create: 0, update: 1, delete: 0, skip: 1, blocked: 0 },
                })
                const row = (itemNo: number, family: string, sourceId: string): BackupItem => ({
                    ...backupBinding(plan),
                    itemNo,
                    generation: 1,
                    category: "config",
                    family: family as BackupItem["family"],
                    sourceId,
                    disposition: "update",
                    reason: null,
                    state: "planned",
                    expectedHash: "c".repeat(64),
                    desiredHash: "d".repeat(64),
                    dependencyItemNo: null,
                    mappedId: null,
                })
                const items = [
                    row(1, "cleanup", "cleanup"),
                    row(2, "cleanupPolicy", channel.id),
                    row(3, "responses", "responses"),
                ]
                const objects = [
                    { family: "cleanup", sourceId: "cleanup", value: { enabled: true } },
                    { family: "cleanupPolicy", sourceId: channel.id, value: { channelId: channel.id, enabled: true } },
                    { family: "responses", sourceId: "responses", value: { customEnabled: true, autoEnabled: true } },
                ]
                const store = {
                    query: (input: BackupQueryRequest) =>
                        Effect.sync(() => {
                            const op = input.operation
                            if (op.type === "plan") return { type: "plan", plan }
                            if (op.type === "items") return { type: "items", items }
                            if (op.type === "origins") return { type: "origins", origins: [] }
                            if (op.type === "item")
                                return {
                                    type: "item",
                                    item: items[op.binding.itemNo - 1],
                                    object: objects[op.binding.itemNo - 1],
                                }
                            throw new Error(`Unexpected query ${op.type}`)
                        }),
                    work: (input: BackupWorkRequest) =>
                        Effect.sync(() => {
                            const op = input.operation as Extract<BackupWorkRequest["operation"], { type: "apply" }>
                            natives.push(op.native)
                            const i = op.binding.itemNo - 1
                            items[i] = { ...items[i]!, state: "updated" }
                            return { type: "item", item: items[i] }
                        }),
                } as unknown as BackupStore
                const config = { serverId: f.ids.guild } as Parameters<typeof processBackupPlanPass>[1]
                yield* processBackupPlanPass(store, config, bot.client, plan, p.dmId)
                const read = (native: BackupNativeProof | null) =>
                    native?.references.some((x) => x.id === channel.id && x.type === "text")
                // The module and the policy are read for the channel, and an unrelated setting is not
                assert.deepEqual(natives.map(read), [true, true, false])
            }),
        ),
    )
})

test("a reconcile checks the Owner and the DM again after its native reads and before it records what it found", async () => {
    // Each change lands while the proof reads the channel an earlier pass created, after the Owner check that proof reuses
    for (const [name, change] of Object.entries(ownerChanges)) {
        const { writes, changed } = await Effect.runPromise(
            Effect.scoped(restorePass(1, { reconcile: true, during: change })),
        )
        assert.equal(changed!.requests().length > 0, true, name)
        assert.deepEqual(writes, [], name)
    }
})

test("a preview checks the Owner and the DM again after its native reads and before the backend decides the archive", async () => {
    // Far above every fixture counter, so the test bot's own DM channel cannot share this ID
    const referenceId = String(BigInt(f.ids.guild) + 1_000_000n)
    const archived: BackupManifest = {
        ...manifest(),
        selected: ["config"],
        counts: { config: 1, xp: 0, structure: 0, overwrites: 0 },
        xp: [],
        config: [
            {
                family: "cleanupPolicy",
                sourceId: referenceId,
                value: {
                    channelId: referenceId,
                    enabled: false,
                    ageMs: 3600000,
                    ownerId: f.ids.user,
                    excludedAuthorIds: [],
                    excludedMessageIds: [],
                },
            },
        ] as BackupManifest["config"],
    }
    const archive = encryptBackupManifest(archived, key())
    // Each change lands while the preview's proof reads the channel the policy names, after that proof's own Owner check
    for (const [name, change] of Object.entries(ownerChanges)) {
        const previews: unknown[] = [],
            failures: string[] = []
        let changed: TestRoute | undefined
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                        p = platform(bot)
                    yield* bot.ready()
                    const { id } = attachArchive(bot, p, archive)()
                    bot.rest.respond(`GET /channels/${referenceId}`, () => {
                        changed ??= change(bot, p)
                        return { body: bot.fixtures.channel({ id: referenceId }) }
                    })
                    const store = {
                        previewReady: () =>
                            Effect.succeed({
                                job: {
                                    ownerId: f.ids.user,
                                    channelId: p.dmId,
                                    messageId: id,
                                    requestedAt: 1,
                                    match: false,
                                },
                            }),
                        query: () => Effect.succeed({ type: "origins", origins: [] }),
                        preview: (input: unknown) =>
                            Effect.sync(() => {
                                previews.push(input)
                                return { plan: { backupId: "synthetic-archive" } }
                            }),
                        previewFailed: (_: string, _requestedAt: number, failure: string) =>
                            Effect.sync(() => {
                                failures.push(failure)
                                return { recorded: true }
                            }),
                    } as unknown as BackupStore
                    yield* processBackupJobPass(
                        store,
                        { serverId: f.ids.guild, backupKey: key() } as Parameters<typeof processBackupJobPass>[1],
                        bot.client,
                    )
                }),
            ),
        )
        assert.equal(changed!.requests().length > 0, true, name)
        assert.deepEqual(previews, [], name)
        assert.deepEqual(failures, ["owner"], name)
    }
})

/** A confirmed restore of count XP items that the website started, run through a store that records what the pass tells the backend */
const websiteRestore = (count: number) =>
    Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
            p = platform(bot)
        yield* bot.ready()
        const plan = syntheticPlan({
            planId: "synthetic-website-plan",
            createdAt: Date.now(),
            expiresAt: Date.now() + 900000,
            confirmedAt: Date.now(),
            itemCount: count,
            counts: { create: count, update: 0, delete: 0, skip: 0, blocked: 0 },
        })
        const objects = Array.from({ length: count }, (_, i) => ({
            sourceId: String(5000 + i),
            userId: String(5000 + i),
            xp: 10,
        }))
        const items: BackupItem[] = objects.map((object, i) => ({
            ...backupBinding(plan),
            itemNo: i + 1,
            generation: 1,
            category: "xp",
            family: "xp",
            sourceId: object.sourceId,
            disposition: "create",
            reason: null,
            state: "planned",
            expectedHash: "c".repeat(64),
            desiredHash: "d".repeat(64),
            dependencyItemNo: null,
            mappedId: null,
        }))
        const steps: object[] = [],
            applied: number[] = []
        const store = {
            previewReady: () =>
                Effect.succeed({
                    job: {
                        ownerId: f.ids.user,
                        channelId: p.dmId,
                        messageId: "1",
                        requestedAt: 7000,
                        match: false,
                        plan,
                    },
                }),
            query: (input: BackupQueryRequest) =>
                Effect.sync(() => {
                    const op = input.operation
                    if (op.type === "plan") return { type: "plan", plan }
                    if (op.type === "items") return { type: "items", items }
                    if (op.type === "origins") return { type: "origins", origins: [] }
                    if (op.type === "item")
                        return {
                            type: "item",
                            item: items[op.binding.itemNo - 1],
                            object: objects[op.binding.itemNo - 1],
                        }
                    throw new Error(`Unexpected query ${op.type}`)
                }),
            work: (input: BackupWorkRequest) =>
                Effect.sync(() => {
                    const op = input.operation,
                        i = (op.binding as BackupItemBinding).itemNo - 1
                    if (op.type !== "apply") throw new Error(`Unexpected work ${op.type}`)
                    applied.push(i + 1)
                    items[i] = { ...items[i]!, state: "created" }
                    return { type: "item", item: items[i] }
                }),
            runStep: (input: object) =>
                Effect.sync(() => {
                    steps.push(input)
                    return { recorded: true }
                }),
        } as unknown as BackupStore
        yield* bot.idle()
        const config = { serverId: f.ids.guild } as Parameters<typeof processBackupJobPass>[1]
        return { bot, p, store, config, steps, applied }
    })

test("a restore the website confirmed runs one pass of 20 items for each wake and tells the backend how many it recorded", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { bot, store, config, steps, applied } = yield* websiteRestore(25)
                yield* processBackupJobPass(store, config, bot.client)
                assert.deepEqual(steps, [{ serverId: f.ids.guild, requestedAt: 7000, recorded: 20 }])
                assert.equal(applied.length, 20)
                // The bot keeps nothing between wakes: the next wake finds the plan as the backend gives it and does the rest
                yield* processBackupJobPass(store, config, bot.client)
                assert.deepEqual(steps.at(-1), { serverId: f.ids.guild, requestedAt: 7000, recorded: 5 })
                assert.deepEqual(
                    applied,
                    Array.from({ length: 25 }, (_, i) => i + 1),
                )
                yield* processBackupJobPass(store, config, bot.client)
                assert.deepEqual(steps.at(-1), { serverId: f.ids.guild, requestedAt: 7000, recorded: 0 })
                assert.equal(applied.length, 25)
            }),
        ),
    )
})

test("a restore the website confirmed stops with no write when the sender no longer owns the server", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { bot, p, store, config, steps, applied } = yield* websiteRestore(3)
                p.guildRoute.remove()
                bot.rest.respond(`GET /guilds/${f.ids.guild}`, {
                    body: bot.fixtures.guild({ owner_id: bot.fixtures.nextId() }),
                })
                yield* processBackupJobPass(store, config, bot.client)
                assert.deepEqual(steps, [{ serverId: f.ids.guild, requestedAt: 7000, recorded: 0, stopped: "owner" }])
                assert.deepEqual(applied, [])
            }),
        ),
    )
})

test("a restore the website confirmed that the backend refuses records nothing and does not blame the owner", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { bot, store, config, steps } = yield* websiteRestore(3)
                const refusing = {
                    ...store,
                    work: () => Effect.fail(new BackupStoreError({ operation: "work", status: 403 })),
                } as unknown as BackupStore
                yield* processBackupJobPass(refusing, config, bot.client)
                assert.deepEqual(steps, [{ serverId: f.ids.guild, requestedAt: 7000, recorded: 0 }])
            }),
        ),
    )
})

test("a restore the website confirmed reports the items it recorded before a transient failure", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { bot, store, config, steps, applied } = yield* websiteRestore(5)
                let calls = 0
                const flaky = {
                    ...store,
                    work: (input: BackupWorkRequest) =>
                        ++calls > 2
                            ? Effect.fail(new BackupStoreError({ operation: "work", status: 503 }))
                            : (store.work(input) as Effect.Effect<never, never>),
                } as unknown as BackupStore
                yield* processBackupJobPass(flaky, config, bot.client)
                // Two items were recorded before the third request failed, so the backend sees progress and the restore goes on
                assert.deepEqual(applied, [1, 2])
                assert.deepEqual(steps, [{ serverId: f.ids.guild, requestedAt: 7000, recorded: 2 }])
            }),
        ),
    )
})

test("a website refresh reads the archive only from a message the owner sent", async () => {
    const failures: string[] = [],
        previews: unknown[] = [],
        archive = encryptBackupManifest(manifest(), key())
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot),
                    id = bot.fixtures.nextId(),
                    attachmentId = bot.fixtures.nextId(),
                    filename = "neonflux-backup-archive.nfb"
                yield* bot.ready()
                const sent = bot.fixtures.message({ id, channel_id: p.dmId, content: "!backup preview" }),
                    message: Record<string, unknown> = {
                        ...sent,
                        author: { ...sent.author, id: bot.fixtures.nextId() },
                        attachments: [
                            {
                                id: attachmentId,
                                filename,
                                size: archive.length,
                                flags: 0,
                                content_type: "application/octet-stream",
                                url: `https://fluxerusercontent.com/attachments/${p.dmId}/${attachmentId}/${filename}`,
                            },
                        ],
                    }
                delete message.guild_id
                const read = bot.rest.respond(`GET /channels/${p.dmId}/messages/${id}`, { body: message })
                const download = bot.rest.respond(
                    (request) => request.url.startsWith("https://fluxerusercontent.com/attachments/"),
                    () => new Response(archive),
                )
                const store = {
                    previewReady: () =>
                        Effect.succeed({
                            job: {
                                ownerId: f.ids.user,
                                channelId: p.dmId,
                                messageId: id,
                                requestedAt: 7000,
                                match: false,
                            },
                        }),
                    preview: (input: unknown) =>
                        Effect.sync(() => {
                            previews.push(input)
                            return { plan: { backupId: "synthetic-archive" } }
                        }),
                    previewFailed: (_: string, _requestedAt: number, failure: string) =>
                        Effect.sync(() => {
                            failures.push(failure)
                            return { recorded: true }
                        }),
                } as unknown as BackupStore
                yield* processBackupJobPass(
                    store,
                    { serverId: f.ids.guild, backupKey: key() } as Parameters<typeof processBackupJobPass>[1],
                    bot.client,
                )
                assert.deepEqual([read.requests().length, download.requests().length, previews.length], [1, 0, 0])
            }),
        ),
    )
    assert.deepEqual(failures, ["archive"])
})

test("a website refresh answers the request it was given and keeps the mode the owner chose", async () => {
    const archive = encryptBackupManifest(manifest(), key())
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                yield* bot.ready()
                const { id } = attachArchive(bot, p, archive)()
                const previews: BackupPreviewRequest[] = []
                const store = {
                    previewReady: () =>
                        Effect.succeed({
                            job: {
                                ownerId: f.ids.user,
                                channelId: p.dmId,
                                messageId: id,
                                requestedAt: 7000,
                                match: true,
                            },
                        }),
                    query: () => Effect.succeed({ type: "origins", origins: [] }),
                    preview: (input: BackupPreviewRequest) =>
                        Effect.sync(() => {
                            previews.push(input)
                            return { plan: { backupId: "synthetic-archive" } }
                        }),
                } as unknown as BackupStore
                yield* processBackupJobPass(
                    store,
                    { serverId: f.ids.guild, backupKey: key() } as Parameters<typeof processBackupJobPass>[1],
                    bot.client,
                )
                assert.deepEqual(
                    previews.map((x) => [x.requestedAt, x.match, x.archive]),
                    [[7000, true, { channelId: p.dmId, messageId: id }]],
                )
            }),
        ),
    )
})
