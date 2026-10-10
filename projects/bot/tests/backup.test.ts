import assert from "node:assert/strict"
import test from "node:test"
import { inspect } from "node:util"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted, Schema } from "effect"
import { BackupItem, backupExclusions, type BackupBinding, type BackupItemBinding, type BackupManageRequest, type BackupManifest, type BackupPlan, type BackupPreviewJob, type BackupPreviewPage, type BackupQueryRequest, type BackupStructureObject, type BackupWorkRequest } from "@neonflux/contracts/backup"
import { readConfig } from "../src/config.ts"
import { parseBackupCommand } from "../src/backup-command.ts"
import { parseBackupKey, encryptBackupManifest, decryptBackupEnvelope, BackupCryptoError } from "../src/backup-crypto.ts"
import { createHash } from "node:crypto"
import { validateBackupManifest, backupBinding, backupDigest, type BackupStore } from "../src/backup-store.ts"
import { createBotOptions } from "../src/bot.ts"
import { processBackupPreviewPass } from "../src/backup.ts"
import { platform, token } from "./moderation-fixture.ts"
import { metadataLogCategories } from "../src/metadata-log-command.ts"

const f = createFixtures(), encoded = Buffer.alloc(32, 17).toString("base64")
const key = () => parseBackupKey({ NEONFLUX_BACKUP_KEY: encoded })!
const manifest = (): BackupManifest => ({ version: 1, backupId: "synthetic-archive", provider: "https://api.fluxer.app", serverId: f.ids.guild, selected: ["xp"], capturedAt: 1,
    observations: { databaseAt: 1, structureStartedAt: null, structureFinishedAt: null }, counts: { config: 0, xp: 1, structure: 0, overwrites: 0 }, exclusions: [...backupExclusions], config: [], xp: [{ sourceId: f.ids.user, userId: f.ids.user, xp: 123 }], structure: [] })

test("backup grammar requires explicit categories and never takes a typed plan", () => {
    assert.deepEqual(parseBackupCommand(["export", "config", "xp"]), { type: "export", selected: ["config", "xp"] })
    assert.deepEqual(parseBackupCommand(["inspect"]), { type: "inspect" })
    for (const type of ["status", "confirm", "reconcile", "forget"]) assert.deepEqual(parseBackupCommand([type]), { type })
    assert.deepEqual(parseBackupCommand(["items"]), { type: "items" })
    assert.deepEqual(parseBackupCommand(["items", "next"]), { type: "items", next: true })
    // The plan ID and hashes the owner once typed are refused, with no alias
    const typed = ["synthetic-plan", "a".repeat(64), "b".repeat(64)]
    for (const args of [["export"], ["export", "all"], ["export", "xp", "xp"], ["plan", "https://synthetic.invalid/private"], ["inspect", "C:\\private.nfb"], ["confirm", "synthetic-plan"], ["key", encoded],
        ["confirm", ...typed], ["status", ...typed], ["reconcile", ...typed], ["forget", ...typed], ["items", "2"]]) assert("error" in parseBackupCommand(args))
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
    const structure: BackupStructureObject = { sourceId: f.ids.channel, type: "text", name: "synthetic", parentId: null, overwrites: [{ id: f.ids.guild, type: "role", allow: "8", deny: "0" }], capturedAt: 1 }
    assert.throws(() => validateBackupManifest({ ...source, selected: ["structure"], observations: { databaseAt: null, structureStartedAt: 1, structureFinishedAt: 1 }, counts: { config: 0, xp: 0, structure: 1, overwrites: 1 }, xp: [], structure: [structure] }))
    assert.equal(backupDigest({ a: 1, b: [2] }), backupDigest({ b: [2], a: 1 }))
})

test("Backup manifest decoding preserves role reservations and rejects malformed reservation rows", () => {
    const source = manifest(), value = { panelsEnabled: false, verificationEnabled: false, advancedVerificationEnabled: false, autoroleEnabled: true, humansOnly: true, autoroleIds: [], reservations: [{ userId: f.ids.user, roleIds: [f.role().id] }] }
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
    const item: BackupItem = { planId: "synthetic-plan", revision: 1, planHash: "a".repeat(64), archiveDigest: "b".repeat(64), itemNo: 1, generation: 1, category: "xp", family: "xp", sourceId: f.ids.user, disposition: "create", reason: null, state: "created", expectedHash: "c".repeat(64), desiredHash: "d".repeat(64), dependencyItemNo: null, mappedId: "synthetic_convex_id", disabledOnCreate: false }
    assert.deepEqual(Schema.decodeUnknownSync(BackupItem, { onExcessProperty: "error" })(item), item)
    assert.throws(() => Schema.decodeUnknownSync(BackupItem, { onExcessProperty: "error" })({ ...item, category: "structure", family: "structure" }))
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
        assert.match((p.replies.requests()[0]!.body as { content: string }).content, /refused or could not be checked/)
    })))
})

test("backup preview grammar takes an optional next instead of a page", () => {
    assert.deepEqual(parseBackupCommand(["preview"]), { type: "preview" })
    assert.deepEqual(parseBackupCommand(["preview", "next"]), { type: "preview", next: true })
    for (const args of [["preview", "2"], ["preview", "20"], ["preview", "next", "next"], ["preview", "x"]]) assert("error" in parseBackupCommand(args))
})

const previewPage = (page: number): BackupPreviewPage => ({ backupId: "synthetic-archive", archiveDigest: "a".repeat(64), checkedAt: Date.parse("2026-10-01T00:00:00Z"), counts: { create: 1, skip: 0, conflict: 1, blocked: 25 },
    itemCount: 27, page, pages: 2, items: page === 1 ? [{ itemNo: 1, category: "structure", family: "structure", sourceId: f.ids.channel, name: "general", disposition: "create", reason: null }]
        : [{ itemNo: 26, category: "config", family: "response", sourceId: "custom_hello", disposition: "conflict", reason: "The server already has different settings for this" }, { itemNo: 27, category: "xp", family: "xp", sourceId: f.ids.user, disposition: "blocked", reason: "The server has reached its limit of 50,000 members with XP" }] })
type TestBot = Effect.Success<ReturnType<typeof createTestBot>>
/** Sends a message in the owner's DM and answers the bot's replies as text. A card reads as its title, description and one line per field */
const ownerDm = (bot: TestBot, p: ReturnType<typeof platform>) => (content: string, wire: Record<string, unknown> = {}) => Effect.gen(function* () {
    const message = { ...bot.fixtures.message({ id: bot.fixtures.nextId(), channel_id: p.dmId, content }), ...wire }
    delete message.guild_id
    const before = p.replies.requests().length
    yield* bot.emit("MESSAGE_CREATE", message)
    yield* p.replies.next(); yield* bot.idle()
    return p.replies.requests().slice(before).map(request => {
        const { content, embeds } = request.body as { content?: string, embeds?: { title: string, description?: string, fields?: { name: string, value: string }[], footer?: { text: string } }[] }
        return content ?? embeds!.map(e => [e.title, e.description, ...(e.fields ?? []).map(x => `${x.name}: ${x.value}`), e.footer?.text].filter(Boolean).join("\n")).join("\n")
    }).join("\n")
})
test("a stored restore preview pages in the owner's DM with its decisions in one line and each item's outcome", async () => {
    const pages: number[] = []
    const store = { query: (input: BackupQueryRequest) => Effect.sync(() => { pages.push((input.operation as { page: number }).page); return { type: "preview", preview: previewPage((input.operation as { page: number }).page) } }) } as unknown as BackupStore
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { backup: store })), p = platform(bot)
        yield* bot.ready()
        const say = ownerDm(bot, p)
        const header = `Checked <t:${Date.parse("2026-10-01T00:00:00Z") / 1000}:R>, nothing changed. 1 would be created, 1 conflict, 25 blocked`
        const start = "To restore, attach the same archive to `!backup plan`. A restore checks every item again"
        assert.equal(yield* say("!backup preview"), ["Restore preview", header, "Channel **general**: Would be created", start, "Next: `!backup preview next`"].join("\n"))
        assert.equal(yield* say("!backup preview next"), ["Restore preview", header, "Custom response **hello**: Left alone because it conflicts. The server already has different settings for this",
            `XP of <@${f.ids.user}>: Blocked. The server has reached its limit of 50,000 members with XP`, start].join("\n"))
        assert.equal(yield* say("!backup preview next"), "There is no next page to show. Send !backup preview to start the list again")
        assert.match(yield* say("!backup preview 2"), /^Invalid backup command/)
        assert.deepEqual(pages, [1, 2])
    })))
})

test("confirm runs the restore plan shown last with its exact hashes, and refuses when no plan was shown", async () => {
    const archive = encryptBackupManifest(manifest(), key()), plans = new Map<string, BackupPlan>(), items = new Map<string, BackupItem[]>(), managed: BackupManageRequest[] = []
    // Each plan holds 11 members' XP to create and one conflict, so its items take two pages
    const makePlan = (n: number) => {
        const plan: BackupPlan = { planId: `synthetic-plan-${n}`, revision: 1, planHash: String(n).repeat(64), archiveDigest: createHash("sha256").update(archive).digest("hex"), backupId: "synthetic-archive",
            manifestDigest: "c".repeat(64), provider: "https://api.fluxer.app", serverId: f.ids.guild, ownerId: f.ids.user, createdAt: Date.now() + n, expiresAt: Date.now() + 900000, itemCount: 12,
            counts: { create: 11, skip: 0, conflict: 1, blocked: 0 }, forgotten: false }
        plans.set(plan.planId, plan)
        items.set(plan.planId, Array.from({ length: 12 }, (_, i): BackupItem => ({ ...backupBinding(plan), itemNo: i + 1, generation: 1, category: "xp", family: "xp", sourceId: String(100000000000000000n + BigInt(i)),
            disposition: i === 11 ? "conflict" : "create", reason: i === 11 ? "The member already has different XP" : null, state: "planned", expectedHash: "c".repeat(64), desiredHash: "d".repeat(64), dependencyItemNo: null, mappedId: null, disabledOnCreate: false })))
        return plan
    }
    const store = {
        manage: (input: BackupManageRequest) => Effect.sync(() => {
            managed.push(input)
            if (input.operation.type === "plan") { const plan = makePlan(plans.size + 1); return { type: "plan", duplicate: false, plan, items: [] } }
            const plan = { ...plans.get(input.operation.binding.planId)!, confirmedAt: Date.now() }
            plans.set(plan.planId, plan)
            return { type: "confirmed", duplicate: false, plan }
        }),
        query: (input: BackupQueryRequest) => Effect.sync(() => {
            const op = input.operation
            if (op.type === "plans") return { type: "plans", plans: [...plans.values()] }
            if (op.type === "origins") return { type: "origins", origins: [] }
            if (op.type === "plan" || op.type === "items") {
                const plan = plans.get(op.binding.planId)!
                assert.deepEqual(backupBinding(op.binding), backupBinding(plan))
                return op.type === "plan" ? { type: "plan", plan } : { type: "items", items: items.get(plan.planId)! }
            }
            if (op.type === "item") { const item = items.get(op.binding.planId)![op.binding.itemNo - 1]!; return { type: "item", item, object: { sourceId: item.sourceId, userId: item.sourceId, xp: 10 } } }
            throw new Error(`Unexpected query ${op.type}`)
        }),
        work: (input: BackupWorkRequest) => Effect.sync(() => {
            const binding = input.operation.binding as BackupItemBinding, list = items.get(binding.planId)!, item = list[binding.itemNo - 1]!
            list[binding.itemNo - 1] = { ...item, state: item.disposition === "conflict" ? "conflict" : "created" }
            return { type: "item", item: list[binding.itemNo - 1] }
        }),
    } as unknown as BackupStore
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild, backupKey: key() }, { backup: store })), p = platform(bot)
        yield* bot.ready()
        const say = ownerDm(bot, p)
        // An archive attached to a DM message, served from the media origin the bot accepts
        const attached = () => {
            const id = bot.fixtures.nextId(), attachmentId = bot.fixtures.nextId(), filename = "neonflux-backup-archive.nfb"
            const wire = { id, attachments: [{ id: attachmentId, filename, size: archive.length, flags: 0, content_type: "application/octet-stream", url: `https://fluxerusercontent.com/attachments/${p.dmId}/${attachmentId}/${filename}` }] }
            const message: Record<string, unknown> = { ...bot.fixtures.message({ channel_id: p.dmId, content: "!backup plan" }), ...wire }
            delete message.guild_id
            bot.rest.respond(`GET /channels/${p.dmId}/messages/${id}`, { body: message })
            return wire
        }
        bot.rest.respond(request => request.url.startsWith("https://fluxerusercontent.com/attachments/"), () => new Response(archive))
        const refusal = "There is no restore plan to work on here. Attach the archive to !backup plan again, or send !backup status to pick up your latest plan"
        // Before any plan is shown, nothing is confirmed
        assert.equal(yield* say("!backup confirm"), refusal)
        assert.equal(managed.length, 0)
        const summary = (n: number) => ["Restore plan", "11 to create, 1 conflict", `Waiting for your confirmation. Expires <t:${Math.floor(plans.get(`synthetic-plan-${n}`)!.expiresAt / 1000)}:f>`,
            "Send `!backup confirm` to start. `!backup items` lists each item, problems first", "Conflicting and blocked items stay untouched. Nothing is overwritten, deleted, moved or turned on automatically"].join("\n")
        assert.equal(yield* say("!backup plan", attached()), summary(1))
        assert.equal(yield* say("!backup plan", attached()), summary(2))
        // The second plan was shown last, so confirm sends its exact binding and never the first plan's
        const progress = yield* say("!backup confirm")
        const confirms = managed.filter(row => row.operation.type === "confirm").map(row => (row.operation as { binding: BackupBinding }).binding)
        assert.deepEqual(confirms, [backupBinding(plans.get("synthetic-plan-2")!)])
        assert.equal(plans.get("synthetic-plan-1")!.confirmedAt, undefined)
        assert.equal(progress, ["Restore progress", "This run: 11 created, 1 conflict", "Every item is done", "`!backup items` lists problems first", "Finished items stay in place. Nothing is rolled back"].join("\n"))
        // Items page at 10, the conflict first
        const first = (yield* say("!backup items")).split("\n")
        assert.deepEqual(first.slice(0, 2), ["Restore items", `XP of <@100000000000000011>: Left alone because it conflicts. The member already has different XP`])
        assert.equal(first.filter(line => line.startsWith("XP of")).length, 10)
        assert.deepEqual(first.slice(-2), ["Next: `!backup items next`", "Items that need attention come first"])
        assert.equal((yield* say("!backup items next")).split("\n").filter(line => line.startsWith("XP of")).length, 2)
        assert.equal(yield* say("!backup items next"), "There is no next page to show. Send !backup items to start the list again")
        // Status shows the newest plan and its progress, and confirm refuses once the plan expired
        assert.match(yield* say("!backup status"), /^Restore plan\n11 created, 1 conflict\nConfirmed <t:\d+:R>\. Expires <t:\d+:f>\n`!backup items` lists problems first\n/)
        plans.set("synthetic-plan-2", { ...plans.get("synthetic-plan-2")!, expiresAt: Date.now() - 1000 })
        assert.match(yield* say("!backup confirm"), /^This restore plan expired <t:\d+:R>\. Attach the archive to !backup plan again to make a new one$/)
        assert.equal(managed.filter(row => row.operation.type === "confirm").length, 1)
        assert.equal(bot.failures().length, 0)
    })))
})

test("the website's preview refresh reads the archive message as the bot and reports why it could not", async () => {
    const failures: string[] = []
    const store = (job: BackupPreviewJob | null) => ({ previewReady: () => Effect.succeed({ job }), previewFailed: (_: string, failure: string) => Effect.sync(() => { failures.push(failure); return { recorded: true } }) }) as unknown as BackupStore
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = platform(bot), messageId = bot.fixtures.nextId()
        yield* bot.ready()
        const job = { ownerId: f.ids.user, channelId: p.dmId, messageId }
        const config = (backupKey?: ReturnType<typeof key>) => ({ serverId: f.ids.guild, ...(backupKey ? { backupKey } : {}) }) as Parameters<typeof processBackupPreviewPass>[1]
        yield* processBackupPreviewPass(store(null), config(key()), bot.client)
        yield* processBackupPreviewPass(store(job), config(), bot.client)
        const missing = bot.rest.respond(`GET /channels/${p.dmId}/messages/${messageId}`, { status: 404, body: { code: "UNKNOWN_MESSAGE", message: "Unknown Message" } })
        yield* processBackupPreviewPass(store(job), config(key()), bot.client)
        assert.equal(missing.requests().length, 1)
        // A sender who no longer owns the server is refused before the archive message is read
        p.guildRoute.remove()
        bot.rest.respond(`GET /guilds/${f.ids.guild}`, { body: bot.fixtures.guild({ owner_id: bot.fixtures.nextId() }) })
        yield* processBackupPreviewPass(store(job), config(key()), bot.client)
        assert.equal(missing.requests().length, 1)
    })))
    assert.deepEqual(failures, ["key", "archive", "owner"])
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
        assert.match((p.replies.requests()[0]!.body as { content: string }).content, /no NEONFLUX_BACKUP_KEY/)
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
