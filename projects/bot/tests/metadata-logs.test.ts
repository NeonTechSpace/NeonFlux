import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Exit, Fiber, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { metadataLogContent, projectMetadataEvent } from "../src/metadata-log-projector.ts"
import { createMetadataLogsStore, MetadataLogsStoreError, metadataLogBinding, type MetadataLogsStore } from "../src/metadata-log-store.ts"
import { executeMetadataLogRecord, matchesMetadataLogSnapshot, observeMetadataLogRecord } from "../src/metadata-logs.ts"
import { readMetadataLogContext } from "../src/metadata-log-permissions.ts"
import { metadataLogCategories } from "../src/metadata-log-command.ts"
import { processMetadataLogsPass } from "../src/metadata-log-worker.ts"
import { platform, token } from "./moderation-fixture.ts"
import type { GeneralSettingsStore } from "../src/general-settings.ts"

const now = Date.parse("2026-10-04T20:00:00Z"), f = createFixtures()
function state() {
    const event = projectMetadataEvent("guildMemberRemove", { guildId: f.ids.guild, userId: f.ids.user }, { serverId: f.ids.guild, observedAt: now, sessionId: "a".repeat(32), sequence: 1 })!
    const record: C.MetadataLogsRecord = { recordNo: 1, event, admittedAt: now, expiresAt: now + 2592000000, delivery: { recordNo: 1, routeRevision: 1, moduleRevision: 1, generation: 1, channelId: f.ids.channel, ownerId: f.ids.user, state: "queued", nextCheckAt: now } }
    const grant: C.MetadataLogsGrant = { ...metadataLogBinding(record.delivery!), botId: f.ids.bot, dispatchExpiresAt: now + 120000, nativeDeadlineMs: 5000, content: metadataLogContent(record.recordNo, event) }
    const calls: C.MetadataLogsWorkRequest[] = []
    const store: MetadataLogsStore = { admit: () => Effect.succeed({ admitted: false, duplicate: false, reason: "disabled" }), manage: () => Effect.succeed({ duplicate: true }), query: () => Effect.succeed({ type: "record", record }),
        work: input => Effect.sync((): C.MetadataLogsWorkResult => { calls.push(input)
            if (input.operation.type === "discover") return { type: "work", records: [record] }
            if (input.operation.type === "reserve") return { type: "reserved", grant }
            if (input.operation.type === "claim") return { type: "claimed", claimed: true, grant }
            return { type: "record", record }
        }) }
    return { record, grant, calls, store }
}
function nativeSetup(bot: Effect.Success<ReturnType<typeof createTestBot>>, content: string, embed?: C.MetadataLogsEmbed) {
    const p = platform(bot), f = bot.fixtures
    bot.rest.respond(`GET /users/${f.ids.user}`, { body: f.user({ bot: false, system: false }) })
    bot.rest.respond(`GET /users/${f.ids.bot}`, { body: f.botUser() })
    const message = f.message({ author: f.botUser(), content, attachments: [], embeds: embed ? [{ type: "rich", ...embed }] : [] })
    const sends = bot.rest.respond("POST /channels/:id/messages", { body: message })
    bot.rest.respond(`GET /channels/${f.ids.channel}/messages/${message.id}`, { body: message })
    return { p, message, sends }
}

test("Frozen backend embeds dispatch unchanged and suppress mentions", async () => {
    const r = state(), embed: C.MetadataLogsEmbed = { title: "Metadata #1", description: "Departure cause: Unknown\nActor: unknown", color: 0x78909c }
    r.record.presentation = { format: "embed-v1", embed }
    r.record.delivery!.routeEventType = "member-remove"
    Object.assign(r.grant, { content: "", embed, routeEventType: "member-remove" })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const bot = yield* createTestBot({ token: Redacted.value(token) }), p = nativeSetup(bot, "", embed)
        const result = yield* executeMetadataLogRecord(r.store, f.ids.guild, bot.client, r.record)
        assert.deepEqual(result, { attempted: true, sent: true })
        const body = p.sends.requests()[0]!.body as { content: string, embeds: unknown[], allowed_mentions: unknown }
        assert.equal(body.content, "")
        assert.deepEqual(body.embeds, [embed])
        assert.deepEqual(body.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        assert(r.calls.every(call => call.operation.type === "discover" || call.operation.binding.routeEventType === "member-remove"))
    })).pipe(Effect.provide(TestClock.layer())))
})

test("Embed snapshot comparison refuses changed colors, extra media, fields, attachments and webhook identities", () => {
    const embed = { title: "Metadata #1", description: "Departure cause: Unknown", color: 0x78909c }, messageId = f.nextId()
    const expected = { messageId, channelId: f.ids.channel, botId: f.ids.bot, content: "", embed, serverId: f.ids.guild }
    const raw = { id: messageId, guild_id: f.ids.guild, channel_id: f.ids.channel, author: { id: f.ids.bot, bot: true }, content: "", embeds: [{ type: "rich", ...embed }], attachments: [] }
    assert.equal(matchesMetadataLogSnapshot(raw, expected), true)
    for (const patch of [{ color: embed.color + 1 }, { title: "Changed" }, { description: "Changed" }, { url: "https://synthetic.invalid" }, { image: { url: "https://synthetic.invalid" } }, { fields: [] }, { footer: {} }, { type: "image" }]) assert.equal(matchesMetadataLogSnapshot({ ...raw, embeds: [{ ...raw.embeds[0], ...patch }] }, expected), false)
    for (const patch of [{ content: "extra" }, { attachments: [{ id: f.nextId() }] }, { webhook_id: f.nextId() }, { embeds: [...raw.embeds, ...raw.embeds] }, { author: { id: f.ids.bot, bot: true, system: "false" } }]) assert.equal(matchesMetadataLogSnapshot({ ...raw, ...patch }, expected), false)
})

test("Exact known embed reconciliation carries its original payload without sending again", async () => {
    const r = state(), embed = { title: "Metadata #1", description: "Departure cause: Unknown", color: 0x78909c }
    r.record.presentation = { format: "embed-v1", embed }
    Object.assign(r.grant, { content: "", embed })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: Redacted.value(token) }), p = nativeSetup(bot, "", embed)
        r.record.delivery = { ...r.record.delivery!, grant: r.grant, state: "uncertain", claimedAt: now, messageId: p.message.id }
        const observation = yield* observeMetadataLogRecord(bot.client, f.ids.guild, f.ids.user, r.record)
        assert.equal(observation.status, "match")
        assert.equal(observation.content, "")
        assert.deepEqual(observation.embed, embed)
        assert.equal(p.sends.requests().length, 0)
    })))
})

test("Adapter frozen embed and audit selector bindings cannot drift or switch to legacy plaintext", async t => {
    const r = state(), event = projectMetadataEvent("guildAuditLogEntryCreate", { guildId: f.ids.guild, id: f.nextId(), userId: f.ids.user, targetId: f.nextId(), actionType: 20 }, { serverId: f.ids.guild, observedAt: now, sessionId: "a".repeat(32), sequence: 3 })!
    assert(event)
    const embed = { title: "Metadata #1: Member kicked", description: "Actor observed from current audit entry", color: 0x991b1b }
    const original: C.MetadataLogsRecord = { ...r.record, event, presentation: { format: "embed-v1", embed }, delivery: { ...r.record.delivery!, routeEventType: "audit-entry:20", grant: { ...r.grant, routeEventType: "audit-entry:20", content: "", embed } } }
    let payload: unknown = { type: "record", record: original }
    t.mock.method(globalThis, "fetch", async () => Response.json(payload))
    const store = createMetadataLogsStore({ siteUrl: "https://synthetic.invalid", secret: Redacted.make("synthetic") })
    const member = { userId: f.ids.user, roleIds: [], joinedAt: "2020-01-01T00:00:00Z", isBot: false, timeoutUntil: null, canView: true, canReadHistory: true }
    const context: C.MetadataLogsContext = { observedAt: now, actor: { userId: f.ids.user, roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }, member, botMember: { ...member, userId: f.ids.bot, isBot: true }, channelId: f.ids.channel, channelType: 0, botId: f.ids.bot, botAuthorized: true, actorAuthorized: true, actorKind: "human", botKind: "bot" }
    const request = { serverId: f.ids.guild, context, operation: { type: "show" as const, recordNo: 1 } }
    assert.equal((await Effect.runPromise(store.query(request))).type, "record")
    for (const grant of [{ ...original.delivery!.grant!, embed: { ...embed, color: embed.color + 1 } }, { ...original.delivery!.grant!, content: metadataLogContent(1, event), embed: undefined }, { ...original.delivery!.grant!, routeEventType: "audit-entry:22" }]) {
        payload = { type: "record", record: { ...original, delivery: { ...original.delivery, grant } } }
        await assert.rejects(Effect.runPromise(store.query(request)), /MetadataLogsStoreError/)
    }
})

test("Adapter preserves disabled event destinations and rejects incomplete destination pairs", async t => {
    const route = { eventType: "audit-entry:20" as const, revision: 1, enabled: false, channelId: f.ids.channel, ownerId: f.ids.user }
    const settings: C.MetadataLogsSettings = { enabled: false, revision: 1, configRevision: 1, routes: metadataLogCategories.map(category => ({ category, revision: 1, enabled: false })), eventRoutes: [route],
        messageChannelIds: [], excludedChannelIds: [], retained: 0, admissions: 0, admissionWindowStartedAt: now, capacity: 10000, admissionCapacity: 10000, retentionMs: 2592000000, quotaPaused: false, refused: 0, suppressed: 0 }
    let payload: unknown = { type: "settings", settings }
    t.mock.method(globalThis, "fetch", async () => Response.json(payload))
    const store = createMetadataLogsStore({ siteUrl: "https://synthetic.invalid", secret: Redacted.make("synthetic") })
    const member = { userId: f.ids.user, roleIds: [], joinedAt: "2020-01-01T00:00:00Z", isBot: false, timeoutUntil: null, canView: true, canReadHistory: true }
    const context: C.MetadataLogsContext = { observedAt: now, actor: { userId: f.ids.user, roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }, member, botMember: { ...member, userId: f.ids.bot, isBot: true }, channelId: f.ids.channel, channelType: 0, botId: f.ids.bot, botAuthorized: true, actorAuthorized: true, actorKind: "human", botKind: "bot" }
    const request = { serverId: f.ids.guild, context, operation: { type: "settings" as const } }
    const result = await Effect.runPromise(store.query(request))
    assert.equal(result.type, "settings")
    if (result.type === "settings") assert.deepEqual(result.settings.eventRoutes, [route])
    // Admissions are uncapped because storage is bounded by eviction, not by refusing events
    payload = { type: "settings", settings: { ...settings, admissions: 10001 } }
    const busy = await Effect.runPromise(store.query(request))
    assert.equal(busy.type === "settings" && busy.settings.admissions, 10001)
    for (const eventRoute of [{ ...route, ownerId: undefined }, { ...route, channelId: undefined }, { ...route, enabled: true, channelId: undefined, ownerId: undefined }]) {
        payload = { type: "settings", settings: { ...settings, eventRoutes: [eventRoute] } }
        await assert.rejects(Effect.runPromise(store.query(request)), /MetadataLogsStoreError/)
    }
})

test("Metadata owner evidence accepts documented false-flag omission and rejects bot, system or malformed account flags", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: Redacted.value(token) }), p = platform(bot)
        p.self.remove()
        bot.rest.respond("GET /users/@me", { body: { ...bot.fixtures.botUser(), system: undefined } })
        let actorFlags: object = {}
        bot.rest.respond(`GET /users/${f.ids.user}`, () => ({ body: { ...bot.fixtures.user(), bot: undefined, system: undefined, ...actorFlags } }))
        const accepted = yield* readMetadataLogContext(bot.client, f.ids.guild, f.ids.user, f.ids.channel)
        assert.equal(accepted.context.actorKind, "human")
        assert.equal(accepted.context.botKind, "bot")
        for (const flags of [{ bot: true }, { system: true }, { bot: null }, { system: "false" }, { bot: 0 }]) {
            actorFlags = flags
            assert(Exit.isFailure(yield* Effect.exit(readMetadataLogContext(bot.client, f.ids.guild, f.ids.user, f.ids.channel))))
        }
    })))
})
test("serial production pass sends exact metadata snapshot with one claim and suppressed mentions", async () => {
    const r = state()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const bot = yield* createTestBot({ token: Redacted.value(token) }), p = nativeSetup(bot, r.grant.content)
        const result = yield* processMetadataLogsPass(r.store, f.ids.guild, bot.client)
        assert.equal(result.sent, 1); assert.equal(result.attempted, 1); assert.equal(p.sends.requests().length, 1)
        assert.deepEqual((p.sends.requests()[0]!.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        const outcome = r.calls.at(-1)!.operation
        assert.equal(outcome.type, "outcome"); if (outcome.type === "outcome") { assert.equal(outcome.outcome, "sent"); assert.equal(outcome.messageId, p.message.id) }
        r.record.delivery = { ...r.record.delivery!, state: "uncertain", claimedAt: now }
        yield* executeMetadataLogRecord(r.store, f.ids.guild, bot.client, r.record)
        assert.equal(p.sends.requests().length, 1)
    })).pipe(Effect.provide(TestClock.layer())))
})
test("claim response clock fence prevents delayed first dispatch", async () => {
    const r = state()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const bot = yield* createTestBot({ token: Redacted.value(token) }), p = nativeSetup(bot, r.grant.content)
        const entered = yield* Deferred.make<void>(), resume = yield* Deferred.make<void>(), original = r.store.work
        r.store.work = input => input.operation.type === "claim" ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(resume)), Effect.andThen(original(input))) : original(input)
        const fiber = yield* executeMetadataLogRecord(r.store, f.ids.guild, bot.client, r.record).pipe(Effect.forkChild)
        yield* Deferred.await(entered); yield* TestClock.setTime(now + 120001); yield* Deferred.succeed(resume, undefined)
        const result = yield* Fiber.join(fiber)
        assert.equal(result.attempted, false); assert.equal(p.sends.requests().length, 0)
        const outcome = r.calls.at(-1)!.operation
        assert.equal(outcome.type, "outcome"); if (outcome.type === "outcome") assert.equal(outcome.outcome, "failed")
    })).pipe(Effect.provide(TestClock.layer())))
})
test("lost claim response leaves no native send or falsely proven no-dispatch outcome", async () => {
    const r = state()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const bot = yield* createTestBot({ token: Redacted.value(token) }), p = nativeSetup(bot, r.grant.content), original = r.store.work
        r.store.work = input => input.operation.type === "claim" ? Effect.fail(new MetadataLogsStoreError({ operation: "work", status: null })) : original(input)
        assert(Exit.isFailure(yield* Effect.exit(executeMetadataLogRecord(r.store, f.ids.guild, bot.client, r.record))))
        assert.equal(p.sends.requests().length, 0); assert(!r.calls.some(c => c.operation.type === "outcome" || c.operation.type === "no-dispatch"))
    })).pipe(Effect.provide(TestClock.layer())))
})
test("private reports use fresh DM and Owner/Admin checks without metadata self-admission", async () => {
    const r = state(), reads: C.MetadataLogsQueryRequest[] = [], admissions: C.MetadataLogsAdmitRequest[] = []
    r.store.work = () => Effect.succeed({ type: "work", records: [] })
    r.store.admit = input => Effect.sync(() => { admissions.push(input); return { admitted: false, duplicate: false, reason: "disabled" } as const })
    r.store.query = input => Effect.sync(() => { reads.push(input); return { type: "records", records: [] } as const })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { metadata: r.store })), p = platform(bot)
        bot.rest.respond(`GET /users/${f.ids.user}`, { body: bot.fixtures.user({ bot: false, system: false }) })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!logs events list" }))
        const reply = yield* p.replies.next(); yield* bot.idle()
        assert.equal(reply.path, `/channels/${p.dmId}/messages`); assert.match((reply.body as { content: string }).content, /No retained metadata observations/)
        assert.equal(reads.length, 1); assert.equal(reads[0]!.context.channelType, 1); assert.equal(reads[0]!.context.actorAuthorized, false); assert.equal(reads[0]!.context.botAuthorized, false)
        assert.deepEqual(new Set(reads[0]!.privateRead!.recipientIds), new Set([f.ids.user, f.ids.bot])); assert.equal(admissions.length, 0)
        p.privateFetch.remove(); bot.rest.respond(`GET /channels/${p.dmId}`, { body: { id: p.dmId, type: 3, recipients: [bot.fixtures.user(), bot.fixtures.user({ id: f.nextId() })] } })
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ guild_id: undefined, channel_id: p.dmId, content: "!logs events list" })); yield* bot.idle()
        assert.equal(reads.length, 1); assert.equal(p.replies.requests().length, 1); assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})
test("runtime adapter structurally binds actual bulk projection and rejects leaked fields and changed grants", async t => {
    const r = state(), event = projectMetadataEvent("messageDeleteBulk", { guildId: f.ids.guild, channelId: f.ids.channel, ids: [f.nextId(), f.nextId()] }, { serverId: f.ids.guild, observedAt: now, sessionId: "a".repeat(32), sequence: 2 })!
    let result: unknown = { admitted: true, duplicate: false, record: { ...r.record, event, delivery: null } }
    t.mock.method(globalThis, "fetch", async () => Response.json(result))
    const store = createMetadataLogsStore({ siteUrl: "https://synthetic.invalid", secret: Redacted.make("synthetic") })
    assert.equal((await Effect.runPromise(store.admit({ serverId: f.ids.guild, event }))).admitted, true)
    result = { admitted: true, duplicate: false, record: { ...r.record, event: { ...event, content: "private" }, delivery: null } }
    await assert.rejects(Effect.runPromise(store.admit({ serverId: f.ids.guild, event })), /MetadataLogsStoreError/)
    const member = { userId: f.ids.user, roleIds: [], joinedAt: "2020-01-01T00:00:00Z", isBot: false, timeoutUntil: null, canView: true, canReadHistory: true }
    const context: C.MetadataLogsContext = { observedAt: now, actor: { userId: f.ids.user, roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }, member, botMember: { ...member, userId: f.ids.bot, isBot: true }, channelId: f.ids.channel, channelType: 0, botId: f.ids.bot, botAuthorized: true, actorAuthorized: true, actorKind: "human", botKind: "bot" }
    result = { type: "reserved", grant: { ...r.grant, moduleRevision: 3, generation: 2 } }
    assert.equal((await Effect.runPromise(store.work({ serverId: f.ids.guild, operation: { type: "reserve", binding: metadataLogBinding(r.grant), context } }))).type, "reserved")
    result = { type: "claimed", claimed: true, grant: { ...r.grant, generation: 2 } }
    await assert.rejects(Effect.runPromise(store.work({ serverId: f.ids.guild, operation: { type: "claim", binding: metadataLogBinding(r.grant), context, claimToken: "b".repeat(32) } })), /MetadataLogsStoreError/)
    const messageId = f.nextId()
    assert.equal(matchesMetadataLogSnapshot({ id: messageId, channel_id: f.ids.channel, author: { id: f.ids.bot, bot: true }, content: r.grant.content, embeds: [{ title: "extra" }] }, { messageId, channelId: f.ids.channel, botId: f.ids.bot, serverId: f.ids.guild, content: r.grant.content }), false)
})
test("private report continuations print the fixed ! the DM accepts when the server uses another prefix", async () => {
    const r = state()
    r.store.work = () => Effect.succeed({ type: "work", records: [] })
    r.store.query = () => Effect.succeed({ type: "records", records: [], nextBeforeRecordNo: 7 } as const)
    const general: GeneralSettingsStore = { get: () => Effect.succeed({ prefix: "?", revision: 1 }), set: () => Effect.die("unused") }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { metadata: r.store, general })), p = platform(bot)
        bot.rest.respond(`GET /users/${f.ids.user}`, { body: bot.fixtures.user({ bot: false, system: false }) })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "?logs events list" }))
        const response = yield* p.replies.next(); yield* bot.idle()
        assert.equal(response.path, `/channels/${p.dmId}/messages`)
        assert.match((response.body as { content: string }).content, /^Next: !logs events list 7$/m)
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})
