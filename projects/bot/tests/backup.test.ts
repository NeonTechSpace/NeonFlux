import assert from "node:assert/strict"
import test from "node:test"
import { inspect } from "node:util"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted, Schema } from "effect"
import type * as C from "@neonflux/backend/contracts"
import { readConfig } from "../src/config.ts"
import { parseBackupCommand } from "../src/backup-command.ts"
import { parseBackupKey, encryptBackupManifest, decryptBackupEnvelope, BackupCryptoError } from "../src/backup-crypto.ts"
import { validateBackupManifest, backupItemSchema, backupDigest, backupExclusions, type BackupStore } from "../src/backup-store.ts"
import { createBotOptions } from "../src/bot.ts"
import { platform, token } from "./moderation-fixture.ts"
import { metadataLogCategories } from "../src/metadata-log-command.ts"

const f = createFixtures(), encoded = Buffer.alloc(32, 17).toString("base64")
const key = () => parseBackupKey({ NEONFLUX_BACKUP_KEY: encoded })!
const manifest = (): C.BackupManifest => ({ version: 1, backupId: "synthetic-archive", provider: "https://api.fluxer.app", serverId: f.ids.guild, selected: ["xp"], capturedAt: 1,
    observations: { databaseAt: 1, structureStartedAt: null, structureFinishedAt: null }, counts: { config: 0, xp: 1, structure: 0, overwrites: 0 }, exclusions: [...backupExclusions], config: [], xp: [{ sourceId: f.ids.user, userId: f.ids.user, xp: 123 }], structure: [] })

test("backup grammar requires explicit categories and exact reviewable binding", () => {
    assert.deepEqual(parseBackupCommand(["export", "config", "xp"]), { type: "export", selected: ["config", "xp"] })
    assert.deepEqual(parseBackupCommand(["inspect"]), { type: "inspect" })
    const binding = { planId: "synthetic-plan", revision: 1, planHash: "a".repeat(64), archiveDigest: "b".repeat(64) }
    assert.deepEqual(parseBackupCommand(["confirm", binding.planId, binding.planHash, binding.archiveDigest]), { type: "confirm", binding })
    for (const args of [["export"], ["export", "all"], ["export", "xp", "xp"], ["plan", "https://synthetic.invalid/private"], ["inspect", "C:\\private.nfb"], ["confirm", "synthetic-plan"], ["key", encoded]]) assert("error" in parseBackupCommand(args))
})

test("optional key configuration stays redacted and refuses malformed or authentication key reuse", async () => {
    const config = await Effect.runPromise(readConfig({ FLUXER_BOT_TOKEN: "synthetic-token", NEONFLUX_SERVER_ID: f.ids.guild, NEONFLUX_BACKUP_KEY: encoded }))
    assert(config.backupKey)
    assert.equal(inspect(config).includes(encoded), false)
    assert.equal(JSON.stringify(config).includes(encoded), false)
    assert.equal(parseBackupKey({}), undefined)
    for (const env of [{ NEONFLUX_BACKUP_KEY: Buffer.alloc(31).toString("base64") }, { NEONFLUX_BACKUP_KEY: encoded.replace(/=$/, "") }, { NEONFLUX_BACKUP_KEY: encoded, FLUXER_BOT_TOKEN: encoded }])
        assert.throws(() => parseBackupKey(env), BackupCryptoError)
})

test("AES envelope authenticates its version byte and random nonce before private manifest parsing", () => {
    const source = manifest(), keys = key(), first = encryptBackupManifest(source, keys), second = encryptBackupManifest(source, keys)
    assert.notDeepEqual(first, second); assert.equal(first[0], 1)
    assert.deepEqual(validateBackupManifest(decryptBackupEnvelope(first, keys)), source)
    for (const offset of [0, 1, 13, 29]) {
        const changed = Buffer.from(first); changed[offset] = changed[offset]! ^ 1
        assert.throws(() => decryptBackupEnvelope(changed, keys), BackupCryptoError)
    }
    assert.throws(() => decryptBackupEnvelope(first, parseBackupKey({ NEONFLUX_BACKUP_KEY: Buffer.alloc(32, 18).toString("base64") })!), BackupCryptoError)
    assert.throws(() => decryptBackupEnvelope(encryptBackupManifest({ private: "Synthetic private string", nested: { data: 1 } }, keys).subarray(0, 40), keys), (e: unknown) => !String(e).includes("Synthetic private string"))
})

test("manifest decoder refuses unsupported fields, unsafe overwrites, duplicate identities and mismatched counts", () => {
    const source = manifest()
    for (const value of [{ ...source, version: 2 }, { ...source, token: "Synthetic secret" }, { ...source, counts: { ...source.counts, xp: 2 } }, { ...source, xp: [source.xp[0], source.xp[0]], counts: { ...source.counts, xp: 2 } }, { ...source, xp: [{ ...source.xp[0], resetEpoch: 99 }] }]) assert.throws(() => validateBackupManifest(value))
    const structure: C.BackupStructureObject = { sourceId: f.ids.channel, type: "text", name: "synthetic", parentId: null, overwrites: [{ id: f.ids.guild, type: "role", allow: "8", deny: "0" }], capturedAt: 1 }
    assert.throws(() => validateBackupManifest({ ...source, selected: ["structure"], observations: { databaseAt: null, structureStartedAt: 1, structureFinishedAt: 1 }, counts: { config: 0, xp: 0, structure: 1, overwrites: 1 }, xp: [], structure: [structure] }))
    assert.equal(backupDigest({ a: 1, b: [2] }), backupDigest({ b: [2], a: 1 }))
})

test("Backup manifest decoding preserves role reservations and rejects malformed reservation rows", () => {
    const source = manifest(), value = { panelsEnabled: false, verificationEnabled: false, autoroleEnabled: true, humansOnly: true, autoroleIds: [], reservations: [{ userId: f.ids.user, roleIds: [f.role().id] }] }
    const roles = { ...source, selected: ["config"], counts: { config: 1, xp: 0, structure: 0, overwrites: 0 }, xp: [], config: [{ family: "roles", sourceId: "roles", value }] }
    assert.deepEqual(validateBackupManifest(roles).config[0], roles.config[0])
    assert.deepEqual(validateBackupManifest({ ...roles, config: [{ family: "roles", sourceId: "roles", value: { ...value, retentionDays: 180 } }] }).config[0], roles.config[0])
    assert.throws(() => validateBackupManifest({ ...roles, config: [{ family: "roles", sourceId: "roles", value: { ...value, reservations: [{ userId: f.ids.user, roleIds: [] }] } }] }))
})

test("Backup manifest preserves finite event overrides and dormant paired destinations", () => {
    const source = manifest(), route = { eventType: "audit-entry:20", enabled: false, channelId: f.ids.channel, ownerId: f.ids.user }
    const value = { enabled: false, routes: metadataLogCategories.map(category => ({ category, enabled: false })), eventRoutes: [route], messageChannelIds: [], excludedChannelIds: [] }
    const metadata = { ...source, selected: ["config"], counts: { config: 1, xp: 0, structure: 0, overwrites: 0 }, xp: [], config: [{ family: "metadata", sourceId: "metadata", value }] }
    assert.deepEqual(validateBackupManifest(metadata).config[0], metadata.config[0])
    const { eventRoutes: _events, ...legacy } = value
    for (const saved of [{ ...value, eventRoutes: [] }, legacy]) assert.doesNotThrow(() => validateBackupManifest({ ...metadata, config: [{ family: "metadata", sourceId: "metadata", value: saved }] }))
    for (const eventRoutes of [[{ ...route, eventType: "audit-entry:999" }], [{ ...route, ownerId: undefined }], [{ ...route, enabled: true, channelId: undefined, ownerId: undefined }], [route, route]]) {
        assert.throws(() => validateBackupManifest({ ...metadata, config: [{ family: "metadata", sourceId: "metadata", value: { ...value, eventRoutes } }] }))
    }
})

test("item decoder accepts backend IDs for config/XP and rejects them for native structure", () => {
    const item: C.BackupItem = { planId: "synthetic-plan", revision: 1, planHash: "a".repeat(64), archiveDigest: "b".repeat(64), itemNo: 1, generation: 1, category: "xp", family: "xp", sourceId: f.ids.user, disposition: "create", reason: null, state: "created", expectedHash: "c".repeat(64), desiredHash: "d".repeat(64), dependencyItemNo: null, mappedId: "synthetic_convex_id", disabledOnCreate: false }
    assert.deepEqual(Schema.decodeUnknownSync(backupItemSchema, { onExcessProperty: "error" })(item), item)
    assert.throws(() => Schema.decodeUnknownSync(backupItemSchema, { onExcessProperty: "error" })({ ...item, category: "structure", family: "structure" }))
})

test("production pipeline keeps server backup commands to a private hint and reserves namespace", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = platform(bot)
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!backup export xp" }))
        yield* bot.idle()
        assert.equal(p.replies.requests().length, 1)
        assert.match((p.replies.requests()[0]!.body as { content: string }).content, /one-to-one DM/)
        assert.equal(p.open.requests().length, 0)
        assert.equal(p.self.requests().length, 0)
        assert.equal(bot.failures().length, 0)
    })))
})

test("Export over the restore byte limit replies with a refusal instead of stopping silently", async () => {
    const id = (n: number) => String(100000000000000000n + BigInt(n))
    const config = Array.from({ length: 250 }, (_, i) => ({ family: "cleanupPolicy", sourceId: id(i * 1000), value: { channelId: id(i * 1000), enabled: false, ageMs: 3600000, ownerId: f.ids.user, excludedAuthorIds: [], excludedMessageIds: Array.from({ length: 100 }, (_, j) => id(i * 1000 + j + 1)) } }))
    const store = {
        query: () => Effect.succeed({ type: "capabilities", capabilities: { exclusions: [...backupExclusions] } }),
        snapshot: () => Effect.succeed({ capturedAt: 0, config, xp: [], counts: { config: config.length, xp: 0 } }),
    } as unknown as BackupStore
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild, backupKey: key() }, { backup: store })), p = platform(bot)
        yield* bot.ready()
        const message = { ...bot.fixtures.message({ channel_id: p.dmId, content: "!backup export config" }) }
        delete message.guild_id
        yield* bot.emit("MESSAGE_CREATE", message)
        yield* p.replies.next(); yield* bot.idle()
        assert.equal(p.replies.requests().length, 1)
        assert.match((p.replies.requests()[0]!.body as { content: string }).content, /refused or could not be verified/)
    })))
})

test("production private disabled backup commands check actual Owner before revealing configuration help", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = platform(bot)
        yield* bot.ready()
        const message = { ...bot.fixtures.message({ channel_id: p.dmId, content: "!backup export xp" }) }
        delete message.guild_id
        yield* bot.emit("MESSAGE_CREATE", message)
        // Backup commands run beside the serial message handler, so wait for the reply itself
        yield* p.replies.next(); yield* bot.idle()
        assert.equal(p.replies.requests().length, 1)
        assert.match((p.replies.requests()[0]!.body as { content: string }).content, /crypto is disabled/)
        assert.equal(bot.failures().length, 0)
        p.guildRoute.remove()
        bot.rest.respond(`GET /guilds/${f.ids.guild}`, { body: bot.fixtures.guild({ owner_id: bot.fixtures.nextId() }) })
        yield* bot.emit("MESSAGE_CREATE", { ...message, id: bot.fixtures.nextId() })
        yield* bot.idle()
        // A refused owner check stays silent and never fails the shared message handler
        assert.equal(p.replies.requests().length, 1)
        assert.equal(bot.failures().length, 0)
    })))
})
