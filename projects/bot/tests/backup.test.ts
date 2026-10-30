import assert from "node:assert/strict"
import test from "node:test"
import { inspect } from "node:util"
import { createFixtures, createTestBot, createTestClient, type TestRoute } from "@neontechspace/fluxerly/effect/testing"
import { TestClock } from "effect/testing"
import { fakeClient, quietSignal } from "./backend-fake.ts"
import { Clock, Effect, Redacted, Schema } from "effect"
import {
    BACKUP_PLAN_MS,
    BackupItem,
    backupExclusions,
    type BackupBinding,
    type BackupItemBinding,
    type BackupManageRequest,
    type BackupManifest,
    type BackupNativeProof,
    type BackupPlan,
    type BackupPreviewJob,
    type BackupPreviewSegmentRequest,
    type BackupPreviewStartRequest,
    type BackupQueryRequest,
    type BackupStructureObject,
    type BackupWorkRequest,
} from "@neonflux/contracts/backup"
import { STRUCTURE_CHANNELS } from "@neonflux/contracts/common"
import { readConfig } from "../src/config.ts"
import { uploadBackupAttachments } from "../src/backup-attachments.ts"
import { parseServerScope } from "@neonflux/contracts/service"
import { parseBackupCommand } from "../src/backup-command.ts"
import {
    parseBackupKey,
    encryptBackupManifest,
    decryptBackupParts,
    BackupCryptoError,
    backupArchiveDigest,
    backupPartCount,
    backupPartLimit,
} from "../src/backup-crypto.ts"
import { createCipheriv } from "node:crypto"
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
import { readBackupEvidence, readBackupNativeProof, snapshotBackupChannel } from "../src/backup-permissions.ts"
import { readNativeMembers } from "../src/member-evidence.ts"
import { alertRuntimes, type SecurityAlerts } from "../src/alerts-worker.ts"
import { allowBotPosting, postingPermissions } from "../src/safety-permissions.ts"
import { ChannelType, Permissions, permissionBits } from "@neontechspace/fluxerly/effect"
import { permissionKeyTitles, permissionNames, permissionTitles } from "@neonflux/contracts/permission-names"
import { answerMemberRequests, memberChunk, waitingClock } from "./member-chunks-fixture.ts"
import { platform, token } from "./moderation-fixture.ts"
import { metadataLogCategories } from "../src/metadata-log-command.ts"
import { ownerChanges, restoreConfig, syntheticPlan, withClock, type Change } from "./backup-fixture.ts"
import type { BackupConfigObject } from "@neonflux/contracts/backup"
import type { StickyMessage } from "@neonflux/contracts/sticky"
import type { VoiceGenerator } from "@neonflux/contracts/voice"
import { createStickyRuntime } from "../src/sticky-worker.ts"
import type { StickyStore } from "../src/sticky-store.ts"
import { createHelpDeskRuntime } from "../src/helpdesk-worker.ts"
import type { HelpDeskStore } from "../src/helpdesk-store.ts"
import { createVoiceRuntime } from "../src/voice-worker.ts"
import type { VoiceStore } from "../src/voice-store.ts"
import { createOnboardingRuntime, registerOnboardingRuntime } from "../src/onboarding.ts"
import type { OnboardingStore } from "../src/onboarding-store.ts"
import { createPrefixReader, type GeneralSettingsStore } from "../src/general-settings.ts"
import { levelingRechecks } from "../src/leveling.ts"
import { metadataRechecks } from "../src/metadata-log-events.ts"
import { startAnalyticsWorker } from "../src/analytics-worker.ts"
import type { AnalyticsStore } from "../src/analytics-store.ts"

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
    version: 2,
    backupId: "5".repeat(32),
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

test("an archive's parts are authenticated with their header, so a swapped, missing, mixed or older part is refused before parsing", () => {
    const source = manifest(),
        keys = key(),
        first = encryptBackupManifest(source, keys),
        second = encryptBackupManifest(source, keys)
    assert.deepEqual([first.length, first[0]![0]], [1, 2])
    // A new nonce for each encryption, and the plaintext never shows
    assert.notDeepEqual(Buffer.from(first[0]!).subarray(21, 33), Buffer.from(second[0]!).subarray(21, 33))
    assert.deepEqual(validateBackupManifest(decryptBackupParts(first, keys).manifest), source)
    assert(!Buffer.from(first[0]!).includes(Buffer.from('"backupId"')))
    cryptoRejected(
        () =>
            decryptBackupParts(
                first,
                parseBackupKey({ NEONFLUX_BACKUP_KEY: Buffer.alloc(32, 18).toString("base64") })!,
            ),
        "authentication",
    )
    // The archive ID, the nonce, the tag and the ciphertext are each bound
    for (const offset of [1, 21, 33, 49]) {
        const changed = Buffer.from(first[0]!)
        changed[offset] = changed[offset]! ^ 1
        cryptoRejected(() => decryptBackupParts([changed], keys), "authentication")
    }
    // A small part size splits a larger archive into numbered parts, which decrypt in any order
    const large: BackupManifest = {
        ...source,
        xp: Array.from({ length: 60 }, (_, i) => ({ sourceId: String(1000 + i), userId: String(1000 + i), xp: i })),
        counts: { ...source.counts, xp: 60 },
    }
    const parts = encryptBackupManifest(large, keys, 1024)
    assert(parts.length >= 3, `${parts.length} parts`)
    assert.deepEqual(validateBackupManifest(decryptBackupParts([...parts].reverse(), keys).manifest), large)
    assert.equal(backupPartCount(parts[0]!), parts.length)
    // Swapping the numbers two parts carry breaks their authentication
    const swapped = parts.map((part) => Buffer.from(part))
    swapped[0]!.writeUInt16BE(2, 17)
    swapped[1]!.writeUInt16BE(1, 17)
    cryptoRejected(() => decryptBackupParts(swapped, keys), "authentication")
    // A part missing, a part twice and a part of another archive each say how many parts the archive has
    for (const mixed of [
        parts.slice(1),
        [parts[0]!, ...parts.slice(0, -1)],
        [encryptBackupManifest({ ...large, backupId: "6".repeat(32) }, keys, 1024)[0]!, ...parts.slice(1)],
    ])
        assert.throws(
            () => decryptBackupParts(mixed, keys),
            (error: unknown) =>
                error instanceof BackupCryptoError && error.reason === "parts" && error.partCount === parts.length,
        )
    // An archive of the earlier format is refused by name
    cryptoRejected(() => decryptBackupParts([rawEnvelope(JSON.stringify(source))], keys), "version")
    cryptoRejected(() => decryptBackupParts([new Uint8Array(backupPartLimit + 1).fill(2)], keys), "size")
    // An archive of more than 10 parts is refused before anything is sent
    cryptoRejected(() => encryptBackupManifest(large, keys, 100), "size")
})

test("manifest decoder refuses unsupported fields, overlapping overwrites, duplicate identities and mismatched counts", () => {
    const source = manifest()
    for (const value of [
        { ...source, version: 1 },
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

test("an export larger than an archive holds names the 40 MiB limit instead of the ownership refusal", async () => {
    const id = (n: number) => String(100000000000000000n + BigInt(n))
    const policy = (i: number) => ({
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
    })
    // 200 pages of 100 settings items, each about 2.3 KB, read page by page through the cursor the backend gives
    const pages: string[] = []
    const store = {
        snapshotPage: (input: { cursor?: string }) =>
            Effect.sync(() => {
                const page = Number(input.cursor ?? 0)
                pages.push(String(page))
                return {
                    capturedAt: 0,
                    config: Array.from({ length: 100 }, (_, i) => policy(page * 100 + i)),
                    xp: [],
                    cursor: page < 199 ? String(page + 1) : null,
                }
            }),
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
                assert.equal(pages.length, 200)
                assert.equal(p.replies.requests().length, 1)
                assert.match(
                    (p.replies.requests()[0]!.body as { content: string }).content,
                    /^This backup is larger than an archive holds, 40 MiB in at most 10 parts\. Export fewer categories at a time$/,
                )
            }),
        ),
    )
})

test("an export of more channels than Fluxer allows in a server names that limit instead of the ownership refusal", async () => {
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
                bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/channels`, {
                    body: Array.from({ length: STRUCTURE_CHANNELS + 1 }, () =>
                        bot.fixtures.channel({ id: bot.fixtures.nextId() }),
                    ),
                })
                yield* bot.ready()
                assert.match(
                    yield* ownerDm(bot, p)("!backup export structure"),
                    new RegExp(`more than ${STRUCTURE_CHANNELS} channels, more than Fluxer allows in a server`),
                )
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
test("the encrypted backup files name their server, and an archive of several parts numbers each part", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-backup-token" }),
                    dmId = bot.fixtures.nextId()
                const sent = bot.rest.respond("POST /channels/:id/messages", () => ({
                    body: bot.fixtures.message({ channel_id: dmId, content: "" }),
                }))
                yield* bot.ready()
                let checks = 0
                const check = Effect.sync(() => void checks++)
                yield* uploadBackupAttachments(
                    bot.client,
                    dmId,
                    [new Uint8Array(40)],
                    "a".repeat(32),
                    check,
                    "NeonBotLab",
                )
                yield* uploadBackupAttachments(
                    bot.client,
                    dmId,
                    [new Uint8Array(40), new Uint8Array(40)],
                    "b".repeat(32),
                    check,
                )
                const bodies = sent.requests().map((request) => request.body as { content: string })
                const [labelled, first, second] = bodies.map((body) => body.content)
                assert.match(labelled!, /^\*\*NeonBotLab\*\*: Your encrypted backup\. Keep this file/)
                assert.match(first!, /^Your encrypted backup, part 1 of 2\. Keep every part/)
                assert.match(second!, /^Your encrypted backup, part 2 of 2\./)
                // The Owner evidence is read again before each message
                assert.equal(checks, 3)
                assert.equal(bodies.length, 3)
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
                    yield* say("!backup inspect", attachArchive(bot, p, [junk], "!backup inspect")()),
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
                assert.match(
                    yield* say("!backup inspect"),
                    /^Attach every part of one encrypted \.nfb archive to !backup inspect$/,
                )
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
        previews: BackupPreviewStartRequest[] = []
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
        previewSegment: (input: BackupPreviewSegmentRequest) => Effect.sync(() => ({ plan: plans.get(input.planId)! })),
        previewStart: (input: BackupPreviewStartRequest) =>
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
                    backupId: "5".repeat(32),
                    manifestDigest: "c".repeat(64),
                    provider: "https://api.fluxer.app",
                    serverId: f.ids.guild,
                    ownerId: f.ids.user,
                    createdAt: Date.now() + n,
                    expiresAt: Date.now() + BACKUP_PLAN_MS,
                    itemCount: 0,
                    counts: { create: 0, update: 0, delete: 0, skip: 0, blocked: 0 },
                    gain,
                    match: input.match,
                    forgotten: false,
                    state: "ready",
                    warned: 0,
                    states: {},
                }
                const rows = build(base)
                const counts = { create: 0, update: 0, delete: 0, skip: 0, blocked: 0 }
                for (const row of rows) counts[row.disposition]++
                const plan = {
                    ...base,
                    itemCount: rows.length,
                    counts,
                    // The backend counts a delete's warning on a line of its own
                    warned: rows.filter((row) => row.warning && row.disposition !== "delete").length,
                }
                plans.set(plan.planId, plan)
                items.set(plan.planId, rows)
                return { plan }
            }),
        manage: (input: BackupManageRequest) =>
            Effect.sync(() => {
                managed.push(input)
                const plan = { ...plans.get(input.operation.binding.planId)!, confirmedAt: Date.now() }
                plans.set(plan.planId, plan)
                return { type: "confirmed", duplicate: false, plan, run: "started" }
            }),
        query: (input: BackupQueryRequest) =>
            Effect.suspend((): Effect.Effect<unknown, BackupStoreError> => {
                const op = input.operation
                if (op.type === "plans") return Effect.succeed({ type: "plans", plans: [...plans.values()] })
                if (op.type === "origins") return Effect.succeed({ type: "origins", origins: [] as never[] })
                if (op.type === "plan" || op.type === "page" || op.type === "open" || op.type === "unconfirmed") {
                    const plan = plans.get(op.binding.planId)
                    // A plan that a newer preview replaced is gone
                    if (!plan) return Effect.fail(new BackupStoreError({ operation: "query", status: 404 }))
                    assert.deepEqual(backupBinding(op.binding), backupBinding(plan))
                    const list = items.get(plan.planId)!
                    if (op.type === "plan") return Effect.succeed({ type: "plan", plan })
                    if (op.type === "open")
                        return Effect.succeed({
                            type: "open",
                            items: list.filter((row) => row.state === "planned").slice(0, 20),
                        })
                    if (op.type === "unconfirmed")
                        return Effect.succeed({
                            type: "unconfirmed",
                            items: list.filter((row) => row.state === "uncertain"),
                        })
                    // Ten to a page in the backend's order: problems, deletes, gains, warnings, updates, creates, identical items
                    const rank = (row: BackupItem) =>
                        row.disposition === "blocked"
                            ? 0
                            : row.disposition === "delete"
                              ? 1
                              : row.gain || row.on || row.warning
                                ? 2
                                : row.disposition === "update"
                                  ? 3
                                  : row.disposition === "create"
                                    ? 4
                                    : 5
                    const ranked = [...list].sort((a, b) => rank(a) - rank(b) || a.itemNo - b.itemNo),
                        start = Number(op.cursor ?? 0)
                    return Effect.succeed({
                        type: "page",
                        items: ranked.slice(start, start + 10),
                        ...(start + 10 < ranked.length ? { nextCursor: String(start + 10) } : {}),
                    })
                }
                if (op.type === "item") {
                    const row = items.get(op.binding.planId)![op.binding.itemNo - 1]!
                    return Effect.succeed({
                        type: "item",
                        item: row,
                        object: {
                            sourceId: row.sourceId,
                            epoch: 1,
                            members: [{ userId: row.sourceId, xp: 10, expected: null }],
                        },
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
/** Attaches every part of the archive to one DM message, served from the media origin the bot accepts */
function attachArchive(
    bot: TestBot,
    p: ReturnType<typeof platform>,
    archive: readonly Uint8Array[],
    content = "!backup preview",
) {
    const served = new Map<string, Uint8Array>()
    const attached = (filename = "neonflux-backup-archive.nfb") => {
        const id = bot.fixtures.nextId()
        const wire = {
            id,
            attachments: archive.map((part, i) => {
                const attachmentId = bot.fixtures.nextId(),
                    name =
                        archive.length === 1 ? filename : filename.replace(/\.nfb$/, `-${i + 1}of${archive.length}.nfb`)
                served.set(attachmentId, part)
                return {
                    id: attachmentId,
                    filename: name,
                    size: part.length,
                    flags: 0,
                    content_type: "application/octet-stream",
                    url: `https://fluxerusercontent.com/attachments/${p.dmId}/${attachmentId}/${encodeURIComponent(name)}`,
                }
            }),
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
        (request) => new Response(served.get(new URL(request.url).pathname.split("/")[3]!)),
    )
    return attached
}

test("a preview is the plan a confirmation runs: it shows what each item will do, what it grants and turns on, ten to a page", async () => {
    const archive = encryptBackupManifest(manifest(), key())
    const { store, plans, item, previews } = planStore(
        backupArchiveDigest(archive),
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
                reason: "1 member is left out, since they deleted their data with !mydata after the backup was made",
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
                    "1 item has a warning, such as messages it deletes or posts, see its line",
                    "XP of <@100000000000000005>: Blocked. 1 member is left out, since they deleted their data with !mydata after the backup was made",
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
    // The backend numbers deletions after every other item, and the preview still lists them first, as it ranks them
    const { store, previews, item } = planStore(backupArchiveDigest(archive), (plan) => [
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
                    "Match needs the archive. Attach every part of the encrypted .nfb archive to !backup preview match",
                )
                assert.equal(previews.length, 0)
                const lines = (yield* say("!backup preview match", attached())).split("\n")
                assert.equal(previews[0]!.match, true)
                assert.equal(lines[1]!.endsWith("2 to update, 1 to delete, 1 identical"), true)
                // The delete has the line of its own, so the line for work that starts counts only the setting that turns message cleanup on
                assert.deepEqual(lines.slice(2, 8), [
                    "1 channel or category will be deleted with its messages. This cannot be undone",
                    "1 item has a warning, such as messages it deletes or posts, see its line",
                    "Channel **old-room**: Will be deleted. " + warning,
                    `Message cleanup in <#${f.ids.channel}>: Will be updated. Turns on message cleanup: messages older than 30 days in <#${f.ids.channel}> will be deleted`,
                    "Channel **rules**: Will be updated (name, permissions)",
                    "Channel **tickets**: Left alone. A ticket channel belongs to its ticket, so a restore leaves it alone",
                ])
                // Plan is another word for preview, and without match it asks for no deletion
                yield* say("!backup plan", attached())
                assert.equal(previews[1]!.match, false)
                // An archive the backend refuses as a whole says so
                const oversize = {
                    ...store,
                    previewStart: () => Effect.fail(new BackupStoreError({ operation: "previewStart", status: 413 })),
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
                    yield* sayBig("!backup preview", attachedBig()),
                    /^A restore refuses this archive as a whole/,
                )
                // A check made while a restore runs says why it is refused
                const running = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild, backupKey: key() },
                        {
                            backup: {
                                ...store,
                                previewStart: () =>
                                    Effect.fail(new BackupStoreError({ operation: "previewStart", status: 409 })),
                            } as unknown as BackupStore,
                        },
                    ),
                )
                const r = platform(running)
                yield* running.ready()
                forgetShown(r)
                assert.equal(
                    yield* ownerDm(running, r)("!backup preview", attachArchive(running, r, archive)()),
                    "A restore is running. Preview again when it ends",
                )
                // A server that keeps the most plans it may is told so, instead of to try again shortly
                const full = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild, backupKey: key() },
                        {
                            backup: {
                                ...store,
                                previewStart: () =>
                                    Effect.fail(new BackupStoreError({ operation: "previewStart", status: 429 })),
                            } as unknown as BackupStore,
                        },
                    ),
                )
                const c = platform(full)
                yield* full.ready()
                forgetShown(c)
                assert.equal(
                    yield* ownerDm(full, c)("!backup preview", attachArchive(full, c, archive)()),
                    "This server already has 10 restore plans that are not finished, the most it may have. A plan nobody confirmed is replaced by the next check, and a plan frees its place when its restore finishes or you forget it with !backup forget",
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("confirm starts the restore plan shown last with its exact hashes in the background, and says when a newer preview replaced it", async () => {
    const archive = encryptBackupManifest(manifest(), key())
    // Each plan holds 10 members' XP to create, one to update and one conflict, so its items take two pages
    const { store, plans, items, managed, item } = planStore(backupArchiveDigest(archive), (plan) =>
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
                    /^NeonFlux cannot use the attached file\. Check its name, size and type\. .+ rename a copy such as neonflux-backup-0123abcd-1of2 \(1\)\.nfb first$/,
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
                // The command only starts the run, which goes on in the background and posts its outcome
                assert.equal(
                    progress,
                    "Restore started: 12 items. NeonFlux runs it to the end and posts the outcome here. !backup status shows progress",
                )
                assert.deepEqual(
                    items.get("synthetic-plan-2")!.map((row) => row.state),
                    Array.from({ length: 12 }, () => "planned"),
                )
                // The background run settles every item, as the backend counts them
                items.set(
                    "synthetic-plan-2",
                    items.get("synthetic-plan-2")!.map((row) => ({
                        ...row,
                        state:
                            row.disposition === "update"
                                ? "updated"
                                : row.disposition === "blocked"
                                  ? "blocked"
                                  : "created",
                    })),
                )
                plans.set("synthetic-plan-2", {
                    ...plans.get("synthetic-plan-2")!,
                    states: { created: 10, updated: 1, blocked: 1 },
                })
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
                // Status shows the newest plan and its progress
                assert.match(
                    yield* say("!backup status"),
                    /^Restore plan\n10 created, 1 updated, 1 blocked\nConfirmed <t:\d+:R>\. Every item is done\n`!backup items` lists problems first\n/,
                )
                // The plan shown again after it was confirmed says so and no longer offers to start it
                const again = yield* say("!backup preview")
                assert.match(again, /^Restore preview\nChecked <t:\d+:R>, confirmed <t:\d+:R>\. /)
                assert.doesNotMatch(again, /To restore/)
                // Another preview replaces nothing that was confirmed. The plan shown last is then the newest one, which a day later expires
                assert.match(yield* say("!backup preview", attached()), /^Restore preview\n/)
                plans.set("synthetic-plan-3", { ...plans.get("synthetic-plan-3")!, expiresAt: Date.now() - 1000 })
                assert.match(
                    yield* say("!backup confirm"),
                    /^This restore plan expired <t:\d+:R>\. Attach the archive to !backup preview again to make a new one$/,
                )
                assert.equal(managed.length, 1)
                // A plan that is gone says so
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
        // Fluxer leaves every member out of the gateway reads, so each is read by its ID as the test answers it
        yield* answerMemberRequests(bot)
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
        // A setting's channels come from one listing of the server's channels, so for settings the change lands while it is read
        bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, () => {
            if (options.during) changed ??= options.during(bot, p)
            return {
                body: options.config
                    ? readIds.map((id, i) => bot.fixtures.channel({ id, name: objects[i]!.name }))
                    : [],
            }
        })
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
                    if (op.type === "open" || op.type === "unconfirmed")
                        return {
                            type: op.type,
                            items: items.filter((row) =>
                                op.type === "open" ? row.state === "planned" : row.state === "uncertain",
                            ),
                        }
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

test("the cleanup module's proof reads the channels of the cleanup policies that are on, since turning it on resumes them", async () => {
    const natives: (BackupNativeProof | null)[] = []
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                yield* bot.ready()
                const channel = bot.fixtures.channel({ id: bot.fixtures.nextId(), name: "cleaned" })
                bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, { body: [channel] })
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
                            if (op.type === "open" || op.type === "unconfirmed")
                                return {
                                    type: op.type,
                                    items: items.filter((row) =>
                                        op.type === "open" ? row.state === "planned" : row.state === "uncertain",
                                    ),
                                }
                            if (op.type === "origins") return { type: "origins", origins: [] }
                            if (op.type === "item")
                                return {
                                    type: "item",
                                    item: items[op.binding.itemNo - 1],
                                    object: objects[op.binding.itemNo - 1],
                                    // The backend names the channels of the policies that are on with the module's item
                                    ...(op.binding.itemNo === 1 ? { resumed: [channel.id] } : {}),
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

test("a restored alerts item reloads the server's running security alerts, so restored actions apply without a restart", async () => {
    let reloads = 0
    alertRuntimes.set(f.ids.guild, {
        reload: () => Effect.sync(() => void reloads++),
    } as unknown as SecurityAlerts)
    try {
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                        p = platform(bot)
                    yield* bot.ready()
                    yield* restoreConfig(bot.client, p.dmId, [
                        {
                            family: "responses",
                            sourceId: "responses",
                            value: { customEnabled: true, autoEnabled: true },
                        },
                        {
                            family: "alerts",
                            sourceId: "alerts",
                            value: {
                                invites: false,
                                bots: true,
                                webhooks: false,
                                privileges: false,
                                impersonation: false,
                                kickBots: true,
                                deleteWebhooks: false,
                                removePermissions: false,
                                expectedBotIds: [],
                                expectedWebhookIds: [],
                            },
                        },
                    ])
                    // Only the alerts item reloads them
                    assert.equal(reloads, 1)
                }),
            ),
        )
    } finally {
        alertRuntimes.delete(f.ids.guild)
    }
})

test("a restore reaches every running feature that keeps settings in memory, without a restart", async () => {
    let levelingChecks = 0,
        metadataChecks = 0
    const recheckLeveling = () => Effect.sync(() => void levelingChecks++),
        recheckMetadata = () => Effect.sync(() => void metadataChecks++)
    levelingRechecks.set(f.ids.guild, recheckLeveling)
    metadataRechecks.set(f.ids.guild, recheckMetadata)
    try {
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                        p = platform(bot)
                    yield* bot.ready()
                    // The restored settings name the server's channel, which the listing of its channels holds
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, {
                        body: [bot.fixtures.channel({ permission_overwrites: [] })],
                    })
                    // What the backend holds for each feature, which the restore below changes as it writes each item
                    let stickies: StickyMessage[] = [],
                        helpdesk = { forumIds: [] as string[], greeting: null as string | null, nudgeHours: null },
                        generators: VoiceGenerator[] = [],
                        onboarding = { settings: { enabled: false } },
                        general = { prefix: "!", replyStyle: "embed" as const },
                        analytics = false
                    let voiceReads = 0
                    const counted: number[] = []
                    const recorder = yield* startAnalyticsWorker(
                        {
                            settings: () => Effect.sync(() => ({ enabled: analytics })),
                            record: (input: { hours: { count: number }[] }) =>
                                Effect.sync(() => {
                                    counted.push(...input.hours.map((hour) => hour.count))
                                    return { enabled: analytics }
                                }),
                        } as unknown as AnalyticsStore,
                        f.ids.guild,
                    )
                    // The bot learned that analytics is off, so it counts nothing and rereads the switch only after ten minutes
                    yield* recorder.setEnabled(false)
                    const sticky = createStickyRuntime(
                        {
                            list: () => Effect.sync(() => ({ stickies })),
                            posted: (input: { channelId: string; messageId: string }) =>
                                Effect.sync(() => {
                                    stickies = stickies.map((row) =>
                                        row.channelId === input.channelId
                                            ? { ...row, messageId: input.messageId }
                                            : row,
                                    )
                                    return { accepted: true, sticky: stickies[0] }
                                }),
                        } as unknown as StickyStore,
                        f.ids.guild,
                        Effect.succeed(true),
                    )
                    const desk = createHelpDeskRuntime(
                        { get: () => Effect.sync(() => ({ settings: helpdesk })) } as unknown as HelpDeskStore,
                        f.ids.guild,
                        Effect.succeed(false),
                    )
                    const voice = createVoiceRuntime(
                        {
                            query: () =>
                                Effect.sync(() => {
                                    voiceReads++
                                    return { type: "state", generators, rooms: [] }
                                }),
                        } as unknown as VoiceStore,
                        f.ids.guild,
                    )
                    const checklist = createOnboardingRuntime(
                        { get: () => Effect.sync(() => onboarding) } as unknown as OnboardingStore,
                        undefined,
                        f.ids.guild,
                    )
                    const prefix = createPrefixReader(
                        { get: () => Effect.sync(() => general) } as unknown as GeneralSettingsStore,
                        f.ids.guild,
                    )
                    yield* sticky.start(bot.client)
                    yield* desk.start(bot.client)
                    yield* voice.start(bot.client)
                    yield* registerOnboardingRuntime(f.ids.guild, checklist)
                    // Each feature has read the old settings once
                    assert.equal(yield* voice.ready, true)
                    assert.equal((yield* checklist.current)?.settings.enabled, false)
                    assert.equal(yield* prefix, "!")
                    const restored = {
                        sticky: { channelId: f.ids.channel, content: "Restored rules", intervalSeconds: 30 },
                        helpdesk: { forumIds: [f.ids.channel], greeting: "Welcome back", nudgeHours: null },
                        voiceGenerator: {
                            channelId: f.ids.channel,
                            categoryId: f.ids.channel,
                            template: "{owner}'s room",
                            userLimit: 4,
                            region: null,
                        },
                        onboarding: { enabled: true },
                        general: { prefix: "?", replyStyle: "embed" },
                        analytics: { enabled: true },
                        leveling: {},
                        metadata: {},
                    }
                    yield* restoreConfig(
                        bot.client,
                        p.dmId,
                        Object.entries(restored).map(
                            ([family, value]) => ({ family, sourceId: family, value }) as unknown as BackupConfigObject,
                        ),
                        (object) => {
                            if (object.family === "sticky")
                                stickies = [
                                    {
                                        ...restored.sticky,
                                        messageId: null,
                                        revision: 1,
                                        updatedAt: 0,
                                    } as unknown as StickyMessage,
                                ]
                            if (object.family === "helpdesk") helpdesk = restored.helpdesk
                            if (object.family === "voiceGenerator")
                                generators = [{ ...restored.voiceGenerator, revision: 1, createdAt: 0, updatedAt: 0 }]
                            if (object.family === "onboarding") onboarding = { settings: { enabled: true } }
                            if (object.family === "general") general = { prefix: "?", replyStyle: "embed" }
                            if (object.family === "analytics") analytics = true
                        },
                    )
                    // The restored sticky is posted at once and its copy recorded, and later messages repost it
                    assert.deepEqual(
                        sticky.stickies().map((row) => row.content),
                        ["Restored rules"],
                    )
                    assert.equal(
                        p.replies
                            .requests()
                            .some((request) => (request.body as { content?: string }).content === "Restored rules"),
                        true,
                    )
                    // A new post in the restored forum gets the restored greeting
                    assert.deepEqual(desk.settings()?.forumIds, [f.ids.channel])
                    assert.equal(desk.settings()?.greeting, "Welcome back")
                    // The voice generators are read again, so a join of the restored generator makes a room
                    assert.equal(voiceReads, 2)
                    assert.equal((yield* checklist.current)?.settings.enabled, true)
                    assert.equal(yield* prefix, "?")
                    assert.equal(levelingChecks, 1)
                    assert.equal(metadataChecks, 1)
                    // Analytics counts the next message at once
                    yield* recorder.message(f.ids.channel)
                    yield* recorder.flush()
                    assert.deepEqual(counted, [1])
                }),
            ),
        )
    } finally {
        if (levelingRechecks.get(f.ids.guild) === recheckLeveling) levelingRechecks.delete(f.ids.guild)
        if (metadataRechecks.get(f.ids.guild) === recheckMetadata) metadataRechecks.delete(f.ids.guild)
    }
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

// Runs on a clock that moves only as the test's Fluxer answers, by the time each read takes there, so the backend's 60 seconds pass as they would
test("a restore check reads hundreds of member overwrites in batches, and its proof is still fresh when a member is left out or a batch fails", async () => {
    const time = { now: Date.now() }
    // The IDs come from the bot's own fixtures, so none of them is an ID the bot's other fixtures hold
    let ids: string[] = [],
        omitted = "",
        gone = ""
    const archived = (channelId: string): BackupManifest => ({
        ...manifest(),
        selected: ["structure"],
        observations: { databaseAt: null, structureStartedAt: 1, structureFinishedAt: 1 },
        counts: { config: 0, xp: 0, structure: 1, overwrites: ids.length },
        xp: [],
        structure: [
            {
                sourceId: channelId,
                type: "text",
                name: "members",
                parentId: null,
                overwrites: ids.map((id) => ({ id, type: "member" as const, allow: "1024", deny: "0" })),
                capturedAt: 1,
            },
        ],
    })
    const segments: BackupPreviewSegmentRequest[] = [],
        failures: string[] = [],
        order: string[] = []
    let stale = false
    // The backend refuses any observation more than 60 seconds old
    const fresh = (input: BackupPreviewSegmentRequest) => {
        const native = input.native,
            stamps = native
                ? [
                      native.observedAt,
                      ...native.references.map((r) => r.observedAt),
                      ...native.observations.map((o) => o.observedAt),
                  ]
                : []
        if ([input.context.observedAt, ...stamps].some((at) => at < time.now - 60000)) stale = true
    }
    let commands = 0,
        reads = 0
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot),
                    channelId = bot.fixtures.nextId()
                ids = Array.from({ length: 400 }, () => bot.fixtures.nextId())
                // Fluxer leaves out a member it has, the last member left the server, and the second batch's answer is malformed
                omitted = ids[0]!
                gone = ids.at(-1)!
                const archive = encryptBackupManifest(archived(channelId), key())
                yield* bot.ready()
                const wire = (id: string) =>
                    bot.fixtures.member({
                        user: bot.fixtures.user({ id }),
                        roles: [],
                        communication_disabled_until: null,
                    })
                // A gateway request takes 300 ms, and a member read by ID 250 ms, since Fluxer allows 40 of them every 10 seconds
                yield* answerMemberRequests(bot, (request) => {
                    time.now += 300
                    order.push("members")
                    if (request.index === 1) return [memberChunk(request, [wire(bot.fixtures.nextId())])]
                    return [
                        memberChunk(request, request.userIds.filter((id) => id !== omitted && id !== gone).map(wire)),
                    ]
                })
                for (const id of ids)
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${id}`, () => {
                        time.now += 250
                        reads++
                        return id === gone
                            ? { status: 404, body: { code: "UNKNOWN_MEMBER", message: "Synthetic absent" } }
                            : { body: wire(id) }
                    })
                const live = bot.fixtures.channel({
                    id: channelId,
                    name: "members",
                    permission_overwrites: ids.map((id) => ({ id, type: 1, allow: "1024", deny: "0" })),
                })
                bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, () => {
                    order.push("channels")
                    return { body: [live] }
                })
                bot.rest.respond(`GET /channels/${channelId}`, { body: live })
                const { id } = attachArchive(bot, p, archive)()
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
                    previewStart: () => Effect.succeed({ plan: { planId: "synthetic-plan" } }),
                    previewSegment: (input: BackupPreviewSegmentRequest) =>
                        Effect.sync(() => {
                            fresh(input)
                            segments.push(input)
                            return { plan: { planId: "synthetic-plan" } }
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
                ).pipe(withClock(() => time.now))
                commands = bot.commands().filter((command) => command.op === 8).length
            }),
        ),
    )
    assert.deepEqual(failures, [])
    assert.equal(stale, false)
    // Four requests read the members, and only the one left out, the one who left and the failed batch were read by ID
    assert.equal(commands, 4)
    assert.equal(reads, 102)
    const members = segments.flatMap((segment) => segment.native?.references.filter((r) => r.type === "member") ?? [])
    assert.equal(members.length, ids.length)
    assert.deepEqual(
        members.filter((r) => !r.exists).map((r) => r.id),
        [gone],
    )
    assert.equal(members.find((r) => r.id === omitted)?.exists, true)
    // The channels are read after the members, so they are as fresh as the proof
    assert(order.lastIndexOf("channels") > order.lastIndexOf("members"))
})

// Runs on a clock that moves only as the test's Fluxer answers
test("members Fluxer leaves out are read by ID while the reads are fresh, and the rest stay unknown rather than absent", async () => {
    const time = { now: Date.now() }
    let ids: string[] = []
    const found = await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
                platform(bot)
                ids = Array.from({ length: 5 }, () => bot.fixtures.nextId())
                yield* bot.ready()
                yield* answerMemberRequests(bot)
                // Each read by ID takes 15 seconds, so the reads stop once the oldest answer is 40 seconds old
                for (const id of ids)
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${id}`, () => {
                        time.now += 15000
                        return { status: 404, body: { code: "UNKNOWN_MEMBER", message: "Synthetic absent" } }
                    })
                return yield* readNativeMembers(bot.client, f.ids.guild, ids, 40000).pipe(withClock(() => time.now))
            }),
        ),
    )
    assert.deepEqual([...found.keys()], ids.slice(0, 4))
    assert(ids.slice(0, 4).every((id) => found.get(id)!.member === undefined))
    assert.equal(found.has(ids[4]!), false)
})

/** A channel whose overwrites name each of the members */
const memberChannel = (sourceId: string, ids: readonly string[]): BackupStructureObject => ({
    sourceId,
    type: "text",
    name: "members",
    parentId: null,
    overwrites: ids.map((id) => ({ id, type: "member" as const, allow: "1024", deny: "0" })),
    capturedAt: 1,
})
const memberArchive = (structure: BackupStructureObject[]): BackupManifest => ({
    ...manifest(),
    selected: ["structure"],
    observations: { databaseAt: null, structureStartedAt: 1, structureFinishedAt: 1 },
    counts: {
        config: 0,
        xp: 0,
        structure: structure.length,
        overwrites: structure.reduce((sum, channel) => sum + channel.overwrites.length, 0),
    },
    xp: [],
    structure,
})
const memberWire = (bot: TestBot, id: string) =>
    bot.fixtures.member({ user: bot.fixtures.user({ id }), roles: [], communication_disabled_until: null })
/** Serves the archived channels as the server has them, in its channel list and each by its ID */
function liveMemberChannels(bot: TestBot, structure: readonly BackupStructureObject[]) {
    const live = structure.map((channel) =>
        bot.fixtures.channel({
            id: channel.sourceId,
            name: channel.name,
            permission_overwrites: channel.overwrites.map((o) => ({ id: o.id, type: 1, allow: o.allow, deny: o.deny })),
        }),
    )
    bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, { body: live })
    for (const channel of live) bot.rest.respond(`GET /channels/${channel.id}`, { body: channel })
}
/**
 * One preview pass of an archive against a backend that keeps each segment and, as the backend does, finds an observation more than 60
 * seconds older than its own clock stale
 */
function previewPass(
    bot: TestBot,
    client: Parameters<typeof processBackupJobPass>[2],
    p: ReturnType<typeof platform>,
    archive: readonly Uint8Array[],
) {
    return Effect.gen(function* () {
        const segments: BackupPreviewSegmentRequest[] = [],
            failures: string[] = []
        let stale = false
        const { id } = attachArchive(bot, p, archive)()
        const store = {
            previewReady: () =>
                Effect.succeed({
                    job: { ownerId: f.ids.user, channelId: p.dmId, messageId: id, requestedAt: 1, match: false },
                }),
            query: () => Effect.succeed({ type: "origins", origins: [] }),
            previewStart: () => Effect.succeed({ plan: { planId: "synthetic-plan" } }),
            previewSegment: (input: BackupPreviewSegmentRequest) =>
                Effect.gen(function* () {
                    const now = yield* Clock.currentTimeMillis,
                        native = input.native
                    const stamps = native
                        ? [
                              native.observedAt,
                              ...native.references.map((r) => r.observedAt),
                              ...native.observations.map((o) => o.observedAt),
                          ]
                        : []
                    if ([input.context.observedAt, ...stamps].some((at) => at < now - 60000)) stale = true
                    segments.push(input)
                    return { plan: { planId: "synthetic-plan" } }
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
            client,
        )
        return { segments, failures, stale }
    })
}
const memberReferences = (segments: readonly BackupPreviewSegmentRequest[], channelId: string) =>
    segments
        .filter(
            (segment) =>
                (segment.segment.kind === "channels" || segment.segment.kind === "categories") &&
                segment.segment.structure.some((channel) => channel.sourceId === channelId),
        )
        .flatMap((segment) => segment.native?.references.filter((r) => r.type === "member") ?? [])

/** Whether a proof would reach the backend fresh when it is sent at sentAt, by the backend's 60 seconds */
const freshAt = (proof: BackupNativeProof, sentAt: number) =>
    [
        proof.observedAt,
        ...proof.references.map((r) => r.observedAt),
        ...proof.observations.map((o) => o.observedAt),
    ].every((at) => at >= sentAt - 60000)

// Runs on a controlled clock that moves only once the check waits, for Fluxer's member request limit or for the answer the test holds back,
// and the SDK paces its requests by that clock. The node timeout only guards a hang
test(
    "a check of a channel with the most member overwrites stops its member reads in time when a batch answers late, so no stale member reaches the backend and another channel's check stays complete",
    { timeout: 120000 },
    async () => {
        let ids: string[] = [],
            other = "",
            requests = 0
        const proofs = await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                        p = platform(bot),
                        clock = yield* waitingClock
                    ids = Array.from({ length: 4019 }, () => bot.fixtures.nextId())
                    other = bot.fixtures.nextId()
                    const big = memberChannel(bot.fixtures.nextId(), ids),
                        small = memberChannel(bot.fixtures.nextId(), [other])
                    yield* bot.ready()
                    liveMemberChannels(bot, [big, small])
                    // Every member is in the server. The thirteenth request, the first after Fluxer's limit, answers 28 seconds late,
                    // within its own timeout
                    yield* answerMemberRequests(bot, (request) => {
                        requests++
                        const answer = [
                            memberChunk(
                                request,
                                request.userIds.map((id) => memberWire(bot, id)),
                            ),
                        ]
                        return request.index === 12 ? clock.wait(28000).pipe(Effect.as(answer)) : answer
                    })
                    // The channels are checked one after the other, as a preview checks its segments
                    const evidence = yield* readBackupEvidence(bot.client, f.ids.guild, f.ids.user, p.dmId)
                    const [checked] = yield* clock.run([
                        Effect.forEach([big, small], (channel) =>
                            Effect.gen(function* () {
                                const proof = yield* readBackupNativeProof(bot.client, f.ids.guild, evidence, [channel])
                                return { proof, sentAt: yield* Clock.currentTimeMillis }
                            }),
                        ),
                    ])
                    return checked!
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
        const [big, small] = proofs
        assert.equal(freshAt(big!.proof, big!.sentAt), true)
        // The first answer comes at 0 seconds. Twelve requests go then and twelve more once the late one answered at 39 seconds, and the
        // next would wait past the 40 seconds, so the reads stop there. The members read are present, and the rest stay out of the proof as
        // unknown, never absent. The other channel's one request waits for Fluxer's limit until 50 seconds
        const read = big!.proof.references.filter((r) => r.type === "member")
        assert.deepEqual([requests, read.length, big!.sentAt, small!.sentAt], [26, 2500, 39000, 50000])
        assert(read.every((r) => r.exists))
        // The other channel is checked on its own and fully proven
        assert.equal(freshAt(small!.proof, small!.sentAt), true)
        assert.deepEqual(
            small!.proof.references.filter((r) => r.type === "member").map((r) => [r.id, r.exists]),
            [[other, true]],
        )
    },
)

// Runs on a controlled clock that moves only once the check whose turn it is waits for Fluxer's member request limit, which the bot shares
// between them and the SDK paces by that clock. The node timeout only guards a hang
test(
    "two checks that share the bot's member request limit each end their member reads in time, so neither proof holds a stale member",
    { timeout: 120000 },
    async () => {
        const proofs = await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                        p = platform(bot),
                        clock = yield* waitingClock
                    const structure = [0, 1].map(() =>
                        memberChannel(
                            bot.fixtures.nextId(),
                            Array.from({ length: 4019 }, () => bot.fixtures.nextId()),
                        ),
                    )
                    yield* bot.ready()
                    liveMemberChannels(bot, structure)
                    yield* answerMemberRequests(bot, (request) => [
                        memberChunk(
                            request,
                            request.userIds.map((id) => memberWire(bot, id)),
                        ),
                    ])
                    const evidence = yield* readBackupEvidence(bot.client, f.ids.guild, f.ids.user, p.dmId)
                    return yield* clock.run(
                        structure.map((channel) =>
                            Effect.gen(function* () {
                                const proof = yield* readBackupNativeProof(bot.client, f.ids.guild, evidence, [channel])
                                return { proof, sentAt: yield* Clock.currentTimeMillis }
                            }),
                        ),
                        { queued: true },
                    )
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
        // The bot reads one proof's members at a time, so the second check's reads start once the first's are done, and both finish within
        // their own 40 seconds
        assert.deepEqual(
            proofs.map(({ sentAt }) => sentAt),
            [33000, 66000],
        )
        for (const { proof, sentAt } of proofs) {
            const members = proof.references.filter((r) => r.type === "member")
            assert.equal(members.length, 4019)
            assert(members.every((r) => r.exists))
            assert(
                [
                    proof.observedAt,
                    ...proof.references.map((r) => r.observedAt),
                    ...proof.observations.map((o) => o.observedAt),
                ].every((at) => at >= sentAt - 60000),
            )
        }
    },
)

// Runs on a clock that moves only as the test's Fluxer answers, by the time each read takes there
test("a check of many channels, each naming a few members who left, reads every one of them, so no channel is blocked by another's", async () => {
    const time = { now: Date.now() }
    const channels: { id: string; present: string[]; gone: string[] }[] = []
    let reads = 0
    const result = await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                for (let index = 0; index < 60; index++)
                    channels.push({
                        id: bot.fixtures.nextId(),
                        present: [bot.fixtures.nextId(), bot.fixtures.nextId()],
                        gone: [bot.fixtures.nextId(), bot.fixtures.nextId(), bot.fixtures.nextId()],
                    })
                const structure = channels.map((c) => memberChannel(c.id, [...c.present, ...c.gone])),
                    present = new Set(channels.flatMap((c) => c.present))
                yield* bot.ready()
                liveMemberChannels(bot, structure)
                // A gateway request takes 300 ms, and a member read by ID 250 ms, since Fluxer allows 40 of them every 10 seconds
                yield* answerMemberRequests(bot, (request) => {
                    time.now += 300
                    return [
                        memberChunk(
                            request,
                            request.userIds.filter((id) => present.has(id)).map((id) => memberWire(bot, id)),
                        ),
                    ]
                })
                for (const id of channels.flatMap((c) => c.gone))
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${id}`, () => {
                        time.now += 250
                        reads++
                        return { status: 404, body: { code: "UNKNOWN_MEMBER", message: "Synthetic absent" } }
                    })
                const archive = encryptBackupManifest(memberArchive(structure), key())
                return yield* previewPass(bot, bot.client, p, archive).pipe(withClock(() => time.now))
            }),
        ),
    )
    assert.deepEqual(result.failures, [])
    assert.equal(result.stale, false)
    assert.equal(reads, 180)
    // Each channel's members are all proven, the ones who left as absent
    for (const channel of channels)
        assert.deepEqual(
            memberReferences(result.segments, channel.id)
                .filter((r) => [...channel.present, ...channel.gone].includes(r.id))
                .map((r) => [r.id, r.exists])
                .sort(),
            [...channel.present.map((id) => [id, true]), ...channel.gone.map((id) => [id, false])].sort(),
        )
})

// Runs on a clock that moves only as the test's Fluxer answers
test("a check of 100 channels takes them from the one channel listing, so its evidence is fresh even when each channel read is slow", async () => {
    const time = { now: Date.now() },
        listings: number[] = []
    let reads = 0
    const result = await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                const structure = Array.from({ length: 100 }, () => memberChannel(bot.fixtures.nextId(), []))
                yield* bot.ready()
                liveMemberChannels(bot, structure)
                // Each channel read by its ID takes 650 ms, well inside its 5 second timeout, and 100 of them would take 65 seconds
                for (const channel of structure)
                    bot.rest.respond(`GET /channels/${channel.sourceId}`, () => {
                        time.now += 650
                        reads++
                        return { body: bot.fixtures.channel({ id: channel.sourceId, name: channel.name }) }
                    })
                const live = structure.map((channel) =>
                    bot.fixtures.channel({ id: channel.sourceId, name: channel.name }),
                )
                bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, () => {
                    listings.push(time.now)
                    time.now += 650
                    return { body: live }
                })
                const archive = encryptBackupManifest(memberArchive(structure), key())
                return yield* previewPass(bot, bot.client, p, archive).pipe(withClock(() => time.now))
            }),
        ),
    )
    assert.deepEqual(result.failures, [])
    assert.equal(result.stale, false)
    assert.equal(reads, 0)
    const observations = result.segments.flatMap((segment) =>
        segment.segment.kind === "channels" ? (segment.native?.observations ?? []) : [],
    )
    assert.equal(observations.length, 100)
    assert(observations.every((o) => o.status === "present"))
    // Each observation carries the time its listing was read
    assert(observations.every((o) => listings.includes(o.observedAt)))
})

test("a channel the listing leaves out is read by its ID, so one NeonFlux cannot view is unknown and only a deleted one is absent", async () => {
    let listings = 0
    const reads: string[] = []
    const result = await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                const [hidden, deleted, visible] = Array.from({ length: 3 }, () =>
                    memberChannel(bot.fixtures.nextId(), []),
                ) as [BackupStructureObject, BackupStructureObject, BackupStructureObject]
                yield* bot.ready()
                // Fluxer lists only the channels NeonFlux can view, and refuses a direct read of a channel it cannot view
                bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, () => {
                    listings++
                    return { body: [bot.fixtures.channel({ id: visible.sourceId, name: visible.name })] }
                })
                bot.rest.respond(`GET /channels/${hidden.sourceId}`, () => {
                    reads.push(hidden.sourceId)
                    return { status: 403, body: { code: "MISSING_ACCESS", message: "Missing access" } }
                })
                bot.rest.respond(`GET /channels/${deleted.sourceId}`, () => {
                    reads.push(deleted.sourceId)
                    return { status: 404, body: { code: "UNKNOWN_CHANNEL", message: "Unknown Channel" } }
                })
                const archive = encryptBackupManifest(memberArchive([hidden, deleted, visible]), key())
                const pass = yield* previewPass(bot, bot.client, p, archive)
                return { pass, ids: [hidden.sourceId, deleted.sourceId, visible.sourceId] }
            }),
        ),
    )
    assert.deepEqual(result.pass.failures, [])
    const observations = result.pass.segments.flatMap((segment) =>
        segment.segment.kind === "channels" ? (segment.native?.observations ?? []) : [],
    )
    assert.deepEqual(
        result.ids.map((id) => observations.find((o) => o.sourceId === id)?.status),
        ["unknown", "absent", "present"],
    )
    assert.deepEqual(reads.sort(), result.ids.slice(0, 2).sort())
    // The listing is read once for each segment that takes its channels from it
    assert.equal(listings, result.pass.segments.filter((segment) => segment.segment.kind !== "config").length)
})

// Runs on a clock that moves only as the test's Fluxer answers
test("evidence that got too old during the Owner and DM check after a proof is left out, so the check still completes", async () => {
    const time = { now: Date.now() }
    let listed = false,
        slowed = false
    const result = await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                const structure = Array.from({ length: 3 }, () => memberChannel(bot.fixtures.nextId(), []))
                yield* bot.ready()
                liveMemberChannels(bot, structure)
                const live = structure.map((channel) =>
                    bot.fixtures.channel({ id: channel.sourceId, name: channel.name }),
                )
                bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, () => {
                    listed = true
                    return { body: live }
                })
                // The first DM read after the channel listing, which is the Owner and DM check before the segment is sent, answers 55 seconds
                // later
                const dm = { id: p.dmId, type: 1, recipients: [bot.fixtures.user()], last_message_id: null }
                p.privateFetch.remove()
                bot.rest.respond(`GET /channels/${p.dmId}`, () => {
                    if (listed && !slowed) {
                        slowed = true
                        time.now += 55000
                    }
                    return { body: dm }
                })
                const archive = encryptBackupManifest(memberArchive(structure), key())
                return yield* previewPass(bot, bot.client, p, archive).pipe(withClock(() => time.now))
            }),
        ),
    )
    assert.equal(slowed, true)
    assert.deepEqual(result.failures, [])
    assert.equal(result.stale, false)
    // The channel observations of the segment the slow check followed are left out, so only its channels are blocked
    const channels = result.segments.find((segment) => segment.segment.kind === "channels")
    assert.deepEqual(channels?.native?.observations, [])
})

// Runs on a clock that moves only as the test's Fluxer answers
test("a member answer that got too old while the channel reads after it ran is left out of the proof as unknown", async () => {
    const time = { now: Date.now() }
    const proof = await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot),
                    ids = [bot.fixtures.nextId(), bot.fixtures.nextId()],
                    channel = memberChannel(bot.fixtures.nextId(), ids)
                yield* bot.ready()
                liveMemberChannels(bot, [channel])
                yield* answerMemberRequests(bot, (request) => {
                    time.now += 300
                    return [
                        memberChunk(
                            request,
                            request.userIds.map((id) => memberWire(bot, id)),
                        ),
                    ]
                })
                // The channel list answers 55 seconds after the members did
                bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, () => {
                    time.now += 55000
                    return { body: [] }
                })
                const evidence = yield* readBackupEvidence(bot.client, f.ids.guild, f.ids.user, p.dmId)
                return yield* readBackupNativeProof(
                    bot.client,
                    f.ids.guild,
                    evidence,
                    [channel],
                    new Map(),
                    [],
                    true,
                ).pipe(withClock(() => time.now))
            }),
        ),
    )
    assert.deepEqual(
        proof.references.filter((r) => r.type === "member"),
        [],
    )
})

test("a preview checks the Owner and the DM again after its native reads and before it sends the backend a segment", async () => {
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
    // Each change lands while the preview's proof reads the server's channels for the one the policy names, after that proof's own Owner check
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
                    yield* answerMemberRequests(bot)
                    const { id } = attachArchive(bot, p, archive)()
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, () => {
                        changed ??= change(bot, p)
                        return { body: [bot.fixtures.channel({ id: referenceId })] }
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
                        // The check starts before any proof, and no segment reaches the backend once the Owner changed
                        previewStart: () => Effect.succeed({ plan: { planId: "synthetic-plan" } }),
                        previewSegment: (input: unknown) =>
                            Effect.sync(() => {
                                previews.push(input)
                                return { plan: { planId: "synthetic-plan" } }
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
const websiteRestore = (count: number, chat?: { ended: { failure?: "paused" } }) =>
    Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
            p = platform(bot)
        yield* bot.ready()
        // Fluxer leaves every member out of the gateway reads, so each is read by its ID as the test answers it
        yield* answerMemberRequests(bot)
        const plan = syntheticPlan({
            planId: "synthetic-website-plan",
            createdAt: Date.now(),
            expiresAt: Date.now() + 900000,
            confirmedAt: Date.now(),
            itemCount: count,
            counts: { create: count, update: 0, delete: 0, skip: 0, blocked: 0 },
        })
        const objects = Array.from({ length: count }, (_, i) => ({
            sourceId: `xp-${i}`,
            epoch: 1,
            members: [{ userId: String(5000 + i), xp: 10, expected: null }],
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
                        ...(chat ? { notify: true } : {}),
                    },
                }),
            query: (input: BackupQueryRequest) =>
                Effect.sync(() => {
                    const op = input.operation
                    // The plan as the backend counts its items after the pass
                    if (op.type === "plan")
                        return {
                            type: "plan",
                            plan: {
                                ...plan,
                                states: {
                                    created: items.filter((row) => row.state === "created").length,
                                    planned: items.filter((row) => row.state === "planned").length,
                                },
                            },
                        }
                    if (op.type === "open" || op.type === "unconfirmed")
                        return {
                            type: op.type,
                            items: items.filter((row) =>
                                op.type === "open" ? row.state === "planned" : row.state === "uncertain",
                            ),
                        }
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
                    return { recorded: true, ...chat }
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

test("a restore confirmed in chat posts its outcome in the DM when the backend says it ended, and a website restore posts nothing", async () => {
    for (const [chat, title] of [
        [{ ended: {} }, ["Restore finished", "3 created"]],
        [
            { ended: { failure: "paused" as const } },
            [
                "Restore stopped",
                "3 created\nDEFCON 1 pauses restores. Send !backup confirm once DEFCON is lower to continue",
            ],
        ],
        [undefined, undefined],
    ] as const)
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const { bot, p, store, config } = yield* websiteRestore(3, chat)
                    const sent = bot.rest.respond(`POST /channels/${p.dmId}/messages`, {
                        body: bot.fixtures.message({ channel_id: p.dmId, content: "" }),
                    })
                    yield* processBackupJobPass(store, config, bot.client)
                    const cards = sent
                        .requests()
                        .flatMap(
                            (request) =>
                                (request.body as { embeds?: { title?: string; description?: string }[] }).embeds ?? [],
                        )
                    assert.deepEqual(
                        cards.map((card) => [card.title, card.description]),
                        title ? [title] : [],
                    )
                }),
            ),
        )
})

test("a restore from chat that ended for lack of progress posts its outcome once and runs nothing", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })),
                    p = platform(bot)
                yield* bot.ready()
                const plan = syntheticPlan({
                    planId: "synthetic-idle-plan",
                    createdAt: Date.now(),
                    expiresAt: Date.now() + 900000,
                    confirmedAt: Date.now(),
                    itemCount: 3,
                    counts: { create: 3, update: 0, delete: 0, skip: 0, blocked: 0 },
                    states: { created: 1, planned: 2 },
                })
                let due = true
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
                                notify: true,
                                ended: { failure: "expired" },
                            },
                        }),
                    outcomeClaim: (_serverId: string, requestedAt: number) =>
                        Effect.sync(() => {
                            assert.equal(requestedAt, 7000)
                            const claimed = due
                            due = false
                            return { claimed }
                        }),
                    query: (input: BackupQueryRequest) =>
                        input.operation.type === "plan"
                            ? Effect.succeed({ type: "plan", plan })
                            : Effect.die(`Unexpected query ${input.operation.type}`),
                    work: () => Effect.die("Nothing runs after the run ended"),
                    runStep: () => Effect.die("Nothing runs after the run ended"),
                } as unknown as BackupStore
                const sent = bot.rest.respond(`POST /channels/${p.dmId}/messages`, {
                    body: bot.fixtures.message({ channel_id: p.dmId, content: "" }),
                })
                const config = { serverId: f.ids.guild } as Parameters<typeof processBackupJobPass>[1]
                // The next pass finds the outcome claimed and posts nothing again
                yield* processBackupJobPass(store, config, bot.client)
                yield* processBackupJobPass(store, config, bot.client)
                const cards = sent
                    .requests()
                    .flatMap(
                        (request) =>
                            (request.body as { embeds?: { title?: string; description?: string }[] }).embeds ?? [],
                    )
                assert.deepEqual(
                    cards.map((card) => card.title),
                    ["Restore stopped"],
                )
                assert.match(cards[0]!.description!, /made no progress for 10 minutes/)
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
                    previewStart: (input: unknown) =>
                        Effect.sync(() => {
                            previews.push(input)
                            return { plan: { planId: "synthetic-plan" } }
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
                const previews: BackupPreviewStartRequest[] = []
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
                    previewStart: (input: BackupPreviewStartRequest) =>
                        Effect.sync(() => {
                            previews.push(input)
                            return { plan: { planId: "synthetic-plan" } }
                        }),
                    previewSegment: () => Effect.succeed({ plan: { planId: "synthetic-plan" } }),
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
