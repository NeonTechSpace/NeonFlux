import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Exit, Fiber, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { metadataLogContent, projectMetadataEvent } from "../src/metadata-log-projector.ts"
import { createMetadataLogsStore, MetadataLogsStoreError, metadataLogBinding, type MetadataLogsStore } from "../src/metadata-log-store.ts"
import { executeMetadataLogRecord, matchesMetadataLogSnapshot, observeMetadataLogRecord } from "../src/metadata-logs.ts"
import { readMetadataLogContext } from "../src/metadata-log-permissions.ts"
import { metadataLogCategories, metadataLogEventSelectors } from "../src/metadata-log-command.ts"
import { processMetadataLogsPass } from "../src/metadata-log-worker.ts"
import { createMetadataGatewayAdmission } from "../src/metadata-log-events.ts"
import { platform, token } from "./moderation-fixture.ts"
import type { GeneralSettingsStore } from "../src/general-settings.ts"
import { mockBackend } from "./backend-fake.ts"

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
    mockBackend(t, () => payload)
    const store = createMetadataLogsStore({ url: "https://synthetic.invalid", secret: Redacted.make("synthetic") })
    const member = { userId: f.ids.user, roleIds: [], joinedAt: "2020-01-01T00:00:00Z", isBot: false, timeoutUntil: null, canView: true, canReadHistory: true }
    const context: C.MetadataLogsContext = { observedAt: now, actor: { userId: f.ids.user, roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }, member, botMember: { ...member, userId: f.ids.bot, isBot: true }, channelId: f.ids.channel, channelType: 0, botId: f.ids.bot, botAuthorized: true, actorAuthorized: true, actorKind: "human", botKind: "bot" }
    const request = { serverId: f.ids.guild, context, operation: { type: "show" as const, recordNo: 1 } }
    assert.equal((await Effect.runPromise(store.query(request))).type, "record")
    for (const grant of [{ ...original.delivery!.grant!, embed: { ...embed, color: embed.color + 1 } }, { ...original.delivery!.grant!, content: metadataLogContent(1, event), embed: undefined }, { ...original.delivery!.grant!, routeEventType: "audit-entry:22" }]) {
        payload = { type: "record", record: { ...original, delivery: { ...original.delivery, grant } } }
        await assert.rejects(Effect.runPromise(store.query(request)), /MetadataLogsStoreError/)
    }
})

test("Adapter reads exact dashboard settings sources and rejects malformed or unrelated job sources", async t => {
    const r = state(), event: C.MetadataLogsEvent = { category: "settings", type: "settings-change", source: { kind: "dashboard", jobId: "synthetic_job-1", scope: "metadata" }, observedAt: now,
        actor: { kind: "configuration", userId: f.ids.user }, resourceIds: [], changedFields: ["enabled"], count: 1 }
    let payload: unknown = { type: "record", record: { ...r.record, event, delivery: null } }
    mockBackend(t, () => payload)
    const store = createMetadataLogsStore({ url: "https://synthetic.invalid", secret: Redacted.make("synthetic") })
    const member = { userId: f.ids.user, roleIds: [], joinedAt: "2020-01-01T00:00:00Z", isBot: false, timeoutUntil: null, canView: true, canReadHistory: true }
    const context: C.MetadataLogsContext = { observedAt: now, actor: { userId: f.ids.user, roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }, member, botMember: { ...member, userId: f.ids.bot, isBot: true }, channelId: f.ids.channel, channelType: 0, botId: f.ids.bot, botAuthorized: true, actorAuthorized: true, actorKind: "human", botKind: "bot" }
    const request = { serverId: f.ids.guild, context, operation: { type: "show" as const, recordNo: 1 } }
    assert.equal((await Effect.runPromise(store.query(request))).type, "record")
    for (const scope of ["roles", "responses", "moderation", "publishing", "greetings", "tickets", "leveling", "milestones", "suggestions", "cleanup", "events", "schedules"]) {
        payload = { type: "record", record: { ...r.record, event: { ...event, source: { ...event.source, scope } }, delivery: null } }
        const restored = await Effect.runPromise(store.query(request))
        assert.equal(restored.type, "record")
        if (restored.type === "record") assert.equal(restored.record.event.source.kind === "dashboard" && restored.record.event.source.scope, scope)
    }
    for (const scope of ["general", "responses"] as const) {
        const source = { kind: "dashboard-setting" as const, scope, revision: 2 }
        payload = { type: "record", record: { ...r.record, event: { ...event, source, changedFields: ["configuration"] }, delivery: null } }
        const restored = await Effect.runPromise(store.query(request))
        assert.equal(restored.type, "record")
        if (restored.type === "record") assert.deepEqual(restored.record.event.source, source)
    }
    for (const source of [{ kind: "dashboard-setting", scope: "general", revision: 0 }, { kind: "dashboard-setting", scope: "general", revision: Number.MAX_SAFE_INTEGER + 1 }, { kind: "dashboard-setting", scope: "events", revision: 1 }]) {
        payload = { type: "record", record: { ...r.record, event: { ...event, source, changedFields: ["configuration"] }, delivery: null } }
        await assert.rejects(Effect.runPromise(store.query(request)), /MetadataLogsStoreError/)
    }
    for (const source of [{ ...event.source, jobId: "private value" }, { ...event.source, jobId: "x".repeat(129) }, { ...event.source, scope: "security" }, { ...event.source, messageId: f.nextId() }]) {
        payload = { type: "record", record: { ...r.record, event: { ...event, source }, delivery: null } }
        await assert.rejects(Effect.runPromise(store.query(request)), /MetadataLogsStoreError/)
    }
    payload = { type: "record", record: { ...r.record, event: { ...r.record.event, source: event.source }, delivery: null } }
    await assert.rejects(Effect.runPromise(store.query(request)), /MetadataLogsStoreError/)
})

test("Adapter preserves disabled backup event destinations and rejects incomplete destination pairs", async t => {
    const route = { eventType: "audit-entry:20" as const, revision: 1, enabled: false, channelId: f.ids.channel, ownerId: f.ids.user }
    const settings: C.MetadataLogsSettings = { enabled: false, revision: 1, configRevision: 1, routes: metadataLogCategories.map(category => ({ category, revision: 1, enabled: false })), eventRoutes: [route],
        messageChannelIds: [], excludedChannelIds: [], retained: 0, admissions: 0, admissionWindowStartedAt: now, capacity: 10000, admissionCapacity: 10000, retentionMs: 2592000000, quotaPaused: false, refused: 0, suppressed: 0 }
    let payload: unknown = { type: "settings", settings }
    mockBackend(t, () => payload)
    const store = createMetadataLogsStore({ url: "https://synthetic.invalid", secret: Redacted.make("synthetic") })
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
        assert.equal(reply.path, `/channels/${p.dmId}/messages`); assert.deepEqual((reply.body as { embeds: unknown[] }).embeds, [{ color: 0x5560e6, title: "Metadata events", description: "No events recorded yet" }])
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
    mockBackend(t, () => result)
    const store = createMetadataLogsStore({ url: "https://synthetic.invalid", secret: Redacted.make("synthetic") })
    assert.equal((await Effect.runPromise(store.admit({ serverId: f.ids.guild, event }))).admitted, true)
    const { originServerId: _origin, ...storedEvent } = event
    result = { admitted: true, duplicate: false, record: { ...r.record, event: storedEvent, delivery: null } }
    assert.equal((await Effect.runPromise(store.admit({ serverId: f.ids.guild, event }))).admitted, true)
    result = { admitted: true, duplicate: false, record: { ...r.record, event: { ...storedEvent, originServerId: f.nextId() }, delivery: null } }
    await assert.rejects(Effect.runPromise(store.admit({ serverId: f.ids.guild, event })), /MetadataLogsStoreError/)
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
test("private report continuations page with next and print the fixed ! the DM accepts when the server uses another prefix", async () => {
    const r = state(), reads: C.MetadataLogsQueryOperation[] = []
    r.store.work = () => Effect.succeed({ type: "work", records: [] })
    r.store.query = input => Effect.sync(() => { reads.push(input.operation); return input.operation.type === "list" && input.operation.beforeRecordNo === undefined ? { type: "records", records: [], nextBeforeRecordNo: 7 } as const : { type: "records", records: [] } as const })
    const general: GeneralSettingsStore = { get: () => Effect.succeed({ prefix: "?", replyStyle: "embed" as const, revision: 1 }), set: () => Effect.die("unused"), nickname: () => Effect.die("unused"), setNickname: () => Effect.die("unused"), recordNickname: () => Effect.die("unused") }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { metadata: r.store, general })), p = platform(bot)
        bot.rest.respond(`GET /users/${f.ids.user}`, { body: bot.fixtures.user({ bot: false, system: false }) })
        yield* bot.ready()
        const send = (content: string) => Effect.gen(function* () { yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); const response = yield* p.replies.next(); yield* bot.idle(); assert.equal(response.path, `/channels/${p.dmId}/messages`); return response.body as { content?: string, embeds?: { fields?: unknown[] }[] } })
        assert.deepEqual((yield* send("?logs events list")).embeds![0]!.fields, [{ name: "Next", value: "`!logs events list next`" }])
        assert.equal((yield* send("?logs events list next")).embeds![0]!.fields, undefined)
        assert.equal((yield* send("?logs events list next")).content, "There is no next page to show. Send !logs events list to start the list again")
        assert.deepEqual(reads, [{ type: "list" }, { type: "list", beforeRecordNo: 7 }])
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})
test("metadata changes read the current revisions right before the write", async () => {
    const r = state(), reads: C.MetadataLogsQueryOperation[] = [], writes: C.MetadataLogsManageOperation[] = []
    const settings: C.MetadataLogsSettings = { enabled: false, revision: 20, configRevision: 9, routes: metadataLogCategories.map((category, index) => ({ category, revision: index + 1, enabled: false })), eventRoutes: [], messageChannelIds: [], excludedChannelIds: [],
        retained: 0, admissions: 0, admissionWindowStartedAt: 0, capacity: 10000, admissionCapacity: 10000, retentionMs: 2592000000, quotaPaused: false, refused: 0, suppressed: 0 }
    r.store.work = () => Effect.succeed({ type: "work", records: [] })
    r.store.query = input => Effect.sync(() => { reads.push(input.operation); return { type: "settings", settings } as const })
    r.store.manage = input => Effect.sync(() => { writes.push(input.operation); return { duplicate: true } as const })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { metadata: r.store })), p = platform(bot)
        bot.rest.respond(`GET /users/${f.ids.user}`, { body: bot.fixtures.user({ bot: false, system: false }) })
        yield* bot.ready()
        for (const content of ["!logs metadata module on", `!logs metadata route audit <#${f.ids.channel}> <@${f.ids.user}> on`, "!logs metadata clear audit", `!logs metadata event member-add ${f.ids.channel} ${f.ids.user} on`,
            "!logs metadata event member-remove off", "!logs metadata inherit member-remove", `!logs metadata channels ${f.ids.channel} none`]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); yield* p.replies.next(); yield* bot.idle()
        }
        assert.equal(reads.length, 7); assert(reads.every(read => read.type === "settings"))
        // Module and channel changes use the module revision, routes their own revision and event overrides the configuration revision
        assert.deepEqual(writes.map(write => { const { recipientOwner: _owner, ...operation } = write as { recipientOwner?: unknown }; return operation }), [
            { type: "module", enabled: true, expectedRevision: 20 }, { type: "route", category: "audit", channelId: f.ids.channel, ownerId: f.ids.user, enabled: true, expectedRevision: 4 }, { type: "clear", category: "audit", expectedRevision: 4 },
            { type: "event-route", eventType: "member-add", enabled: true, channelId: f.ids.channel, ownerId: f.ids.user, expectedRevision: 9 }, { type: "event-route", eventType: "member-remove", enabled: false, expectedRevision: 9 },
            { type: "event-clear", eventType: "member-remove", expectedRevision: 9 }, { type: "channels", messageChannelIds: [f.ids.channel], excludedChannelIds: [], expectedRevision: 20 }])
        assert.deepEqual(writes.map(write => "recipientOwner" in write), [false, true, false, true, false, false, false])
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})
test("a metadata change whose write fails gets a reply that says what to do", async () => {
    const r = state(), statuses: (number | null)[] = [409, 403, null]
    const settings: C.MetadataLogsSettings = { enabled: false, revision: 20, configRevision: 9, routes: metadataLogCategories.map((category, index) => ({ category, revision: index + 1, enabled: false })), eventRoutes: [], messageChannelIds: [], excludedChannelIds: [],
        retained: 0, admissions: 0, admissionWindowStartedAt: 0, capacity: 10000, admissionCapacity: 10000, retentionMs: 2592000000, quotaPaused: false, refused: 0, suppressed: 0 }
    r.store.work = () => Effect.succeed({ type: "work", records: [] })
    r.store.query = () => Effect.succeed({ type: "settings", settings } as const)
    // A change between the read and the write answers 409, as do the other refusals this reply covers
    r.store.manage = () => Effect.fail(new MetadataLogsStoreError({ operation: "manage", status: statuses.shift()! }))
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { metadata: r.store })), p = platform(bot)
        bot.rest.respond(`GET /users/${f.ids.user}`, { body: bot.fixtures.user({ bot: false, system: false }) })
        yield* bot.ready()
        const say = (content: string) => Effect.gen(function* () { yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); const response = yield* p.replies.next(); yield* bot.idle(); return (response.body as { content: string }).content })
        assert.equal(yield* say("!logs metadata module on"), "Metadata log settings changed while this command ran. Check !logs metadata status, then send the command again")
        assert.equal(yield* say("!logs metadata module on"), "Metadata log change denied by current permissions or policy")
        assert.equal(yield* say("!logs metadata module on"), "The metadata log change was not confirmed. Check !logs metadata status before another change")
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})
test("thread creation, changes and deletion reach metadata logs, and a deleted forum counts the threads it took", async () => {
    const r = state(), admissions: C.MetadataLogsAdmitRequest[] = []
    r.store.admit = input => Effect.sync(() => { admissions.push(input); return { admitted: false, duplicate: false, reason: "disabled" } as const })
    r.store.work = () => Effect.succeed({ type: "work", records: [] })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { metadata: r.store }))
        const forum = bot.fixtures.forumChannel()
        const post = bot.fixtures.thread({ parent_id: forum.id, applied_tags: [] }), joined = bot.fixtures.thread({ parent_id: forum.id }), unseen = bot.fixtures.thread({ parent_id: forum.id })
        yield* bot.ready()
        // Each event type has its own handler queue, so the test waits for each event before the next
        yield* bot.emit("THREAD_CREATE", { ...post, newly_created: true }); yield* bot.idle()
        // The bot joining an existing thread is not a creation
        yield* bot.emit("THREAD_CREATE", joined); yield* bot.idle()
        yield* bot.emit("THREAD_UPDATE", { ...post, name: "renamed", applied_tags: [bot.fixtures.nextId()], thread_metadata: { ...post.thread_metadata, archived: true, locked: true } }); yield* bot.idle()
        // Without an earlier observation an update names no fields
        yield* bot.emit("THREAD_UPDATE", { ...unseen, name: "renamed" }); yield* bot.idle()
        yield* bot.emit("THREAD_DELETE", { id: joined.id, guild_id: f.ids.guild, parent_id: forum.id, type: 11 }); yield* bot.idle()
        yield* bot.emit("CHANNEL_DELETE", forum); yield* bot.idle()
        assert.deepEqual(admissions.map(({ event: e }) => [e.type, e.resourceIds, e.changedFields, e.parentChannelId, e.count]), [
            ["thread-create", [post.id], [], forum.id, 1],
            ["thread-update", [post.id], ["name", "archived", "locked", "tags"], forum.id, 1],
            ["thread-update", [unseen.id], [], forum.id, 1],
            ["thread-delete", [joined.id], [], forum.id, 1],
            ["channel-delete", [forum.id], [], undefined, 1],
            ["thread-delete", [post.id, unseen.id], [], forum.id, 2],
        ])
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})
test("message events from a thread carry its parent channel, read once per thread and never for bot messages", async () => {
    const r = state(), admissions: C.MetadataLogsAdmitRequest[] = []
    r.store.admit = input => Effect.sync(() => { admissions.push(input); return { admitted: false, duplicate: false, reason: "excluded" } as const })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const bot = yield* createTestBot({ token: "synthetic-metadata-thread-token" })
        const thread = bot.fixtures.thread(), other = bot.fixtures.thread()
        const reads = bot.rest.respond(`GET /channels/${thread.id}`, { body: thread }), otherReads = bot.rest.respond(`GET /channels/${other.id}`, { body: other })
        bot.rest.respond("GET /users/@me", { body: bot.fixtures.botUser() })
        yield* bot.ready()
        const admit = createMetadataGatewayAdmission(r.store, f.ids.guild, () => Effect.void)
        for (const id of [f.nextId(), f.nextId()]) yield* admit("messageDelete", { id, channelId: thread.id, guildId: f.ids.guild }, bot.client)
        yield* admit("messageUpdate", { id: f.nextId(), channelId: other.id, guildId: f.ids.guild, author: { id: f.ids.bot, isBot: true } }, bot.client)
        assert.deepEqual(admissions.map(a => [a.event.channelId, a.event.parentChannelId]), [[thread.id, bot.fixtures.ids.channel], [thread.id, bot.fixtures.ids.channel]])
        assert.equal(reads.requests().length, 1); assert.equal(otherReads.requests().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

type Embed = { title?: string, description?: string, fields?: { name: string, value: string }[] }
type Body = { content?: string, embeds?: Embed[] }
/** The owner's limits for one reply: About 10 rendered lines, at most 8 fields and 3 commands, and no event codes, internal words or ISO times. A list page may add its hint and Next */
function assertShort(body: Body, lines = 10) {
    const embed = body.embeds?.[0], text = body.content ?? [embed?.description, ...(embed?.fields ?? []).map(field => `${field.name}: ${field.value}`)].filter(Boolean).join("\n")
    assert((embed?.fields?.length ?? 0) <= 8, text)
    assert((body.content ? 0 : 1) + text.split("\n").length <= lines, text)
    assert((text.match(/`[^`]+`/g) ?? []).length <= 3, text)
    assert.doesNotMatch(text, /\d{4}-\d\d-\d\dT|audit-entry|member-|backend|revision|Refused|Skipped|Ticket slots/)
    return text
}
const mentions = (ids: readonly string[]) => ids.map(id => `<#${id}>`).join(", ")
/** Every category and every second event override routed to its own channel, with full message channel lists and a nearly full store */
function crowdedSettings() {
    const destinations = Array.from({ length: 30 }, () => f.nextId()), ids = (count: number) => Array.from({ length: count }, () => f.nextId())
    const settings: C.MetadataLogsSettings = { enabled: true, revision: 1, configRevision: 1, routes: metadataLogCategories.map((category, i) => ({ category, revision: 1, enabled: true, channelId: destinations[i]!, ownerId: f.ids.user })),
        eventRoutes: metadataLogEventSelectors.map((eventType, i) => i % 2 ? { eventType, revision: 1, enabled: false } : { eventType, revision: 1, enabled: true, channelId: destinations[7 + i / 2]!, ownerId: f.ids.user }),
        messageChannelIds: ids(50), excludedChannelIds: ids(50), retained: 9500, admissions: 20000, admissionWindowStartedAt: now, capacity: 10000, admissionCapacity: 10000, retentionMs: 2592000000, quotaPaused: true, refused: 0, suppressed: 900 }
    return { settings, destinations }
}
/** A bot that answers metadata reads from fixed results. NeonFlux may only view channels, and the first 20 log channels exist */
function reportBot(results: (operation: C.MetadataLogsQueryOperation) => C.MetadataLogsQueryResult, destinations: readonly string[], style: "embed" | "text" = "embed") {
    const r = state()
    r.store.work = () => Effect.succeed({ type: "work", records: [] })
    r.store.query = input => Effect.sync(() => results(input.operation))
    const general: GeneralSettingsStore = { get: () => Effect.succeed({ prefix: "!", replyStyle: style, revision: 1 }), set: () => Effect.die("unused"), nickname: () => Effect.die("unused"), setNickname: () => Effect.die("unused"), recordNickname: () => Effect.die("unused") }
    return Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { metadata: r.store, general })), p = platform(bot, { botPermissions: Permissions.ViewChannel })
        bot.rest.respond(`GET /users/${f.ids.user}`, { body: bot.fixtures.user({ bot: false, system: false }) })
        for (const id of destinations.slice(0, 20)) bot.rest.respond(`GET /channels/${id}`, { body: bot.fixtures.channel({ id }) })
        yield* bot.ready()
        const send = (content: string) => Effect.gen(function* () {
            const before = p.replies.requests().length
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); const response = yield* p.replies.next(); yield* bot.idle()
            assert.equal(response.path, `/channels/${p.dmId}/messages`); assert.equal(p.replies.requests().length, before + 1, "One message")
            return response.body as Body
        })
        return { bot, send }
    })
}

test("metadata status stays a short summary with every category and override routed and most log channels failing", async () => {
    for (const style of ["embed", "text"] as const) {
        const { settings, destinations } = crowdedSettings()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const { bot, send } = yield* reportBot(() => ({ type: "settings", settings }), destinations, style)
            const body = yield* send("!logs metadata status"), text = assertShort(body)
            const summary = "On, but paused because the daily limit is reached. 7 of 7 categories post to a channel. 20 log channels lack permissions"
            const note = "Send `!logs metadata categories` for each category and `!logs metadata overrides` for event overrides"
            const fields = [["Event overrides", "46, 23 turned off"], ["Message events", "From 50 channels, 50 excluded"], ["NeonFlux lacks permissions in", `${mentions(destinations.slice(0, 5))} and 15 more`],
                ["Could not check permissions in", `${mentions(destinations.slice(20, 25))} and 5 more`], ["Stored events", "9500 of 10000. The oldest are removed when full"]] as const
            if (style === "embed") assert.deepEqual(body.embeds, [{ color: 0x5560e6, title: "Metadata logs", description: `${summary}\n${note}`, fields: fields.map(([name, value]) => ({ name, value })) }])
            else assert.equal(body.content, ["**Metadata logs**", summary, note, ...fields.map(([name, value]) => `**${name}:** ${value}`)].join("\n"))
            assert.doesNotMatch(text, /Recent events/)
            assert.equal(bot.failures().length, 0)
        })).pipe(Effect.provide(TestClock.layer())))
    }
})

test("metadata status of a quiet server shows only the state, message events and the details command", async () => {
    const settings: C.MetadataLogsSettings = { ...crowdedSettings().settings, enabled: false, quotaPaused: false, routes: metadataLogCategories.map(category => ({ category, revision: 1, enabled: false })), eventRoutes: [], messageChannelIds: [], excludedChannelIds: [], retained: 7999 }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { send } = yield* reportBot(() => ({ type: "settings", settings }), [])
        assert.deepEqual((yield* send("!logs metadata status")).embeds, [{ color: 0x5560e6, title: "Metadata logs", description: "Off. When on, 0 of 7 categories post to a channel\nSend `!logs metadata categories` for each category",
            fields: [{ name: "Message events", value: "From no channels yet" }] }])
    })).pipe(Effect.provide(TestClock.layer())))
})

test("metadata categories and event overrides show plain labels in their own reports, and overrides page at 10", async () => {
    const { settings, destinations } = crowdedSettings()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { bot, send } = yield* reportBot(() => ({ type: "settings", settings }), destinations)
        const categories = yield* send("!logs metadata categories")
        assertShort(categories)
        assert.deepEqual(categories.embeds, [{ color: 0x5560e6, title: "Metadata log categories", description: [...metadataLogCategories.map((category, i) =>
            `**${category[0]!.toUpperCase()}${category.slice(1)}**: On in <#${destinations[i]}>, owner <@${f.ids.user}>. NeonFlux lacks Send Messages, Embed Links`), "Change one with `!logs metadata route <category> <channel> <owner> on|off`"].join("\n") }])
        const pages: Body[] = [yield* send("!logs metadata overrides")]
        for (let i = 0; i < 4; i++) pages.push(yield* send("!logs metadata overrides next"))
        const lines = pages.map(page => page.embeds![0]!.description!.split("\n").slice(0, -1))
        // A list page shows 10 entries, the hint to remove one and Next
        for (const page of pages) assertShort(page, 13)
        assert.deepEqual(lines.map(page => page.length), [10, 10, 10, 10, 6])
        assert.deepEqual(lines[0]!.slice(0, 2), [`**Member joined**: On in <#${destinations[7]}>, owner <@${f.ids.user}>`, "**Member changed**: Off, so it never posts"])
        assert.equal(lines[2]![8], `**Audit: Server changed**: On in <#${destinations[21]}>, owner <@${f.ids.user}>`)
        assert.equal(pages[0]!.embeds![0]!.description!.split("\n").at(-1), "Send `!logs metadata inherit <event>` to remove one")
        assert.deepEqual(pages.map(page => page.embeds![0]!.fields), [...Array(4).fill([{ name: "Next", value: "`!logs metadata overrides next`" }]), undefined])
        assert.equal((yield* send("!logs metadata overrides next")).content, "There is no next page to show. Send !logs metadata overrides to start the list again")
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("event lists, a record and the counters use plain labels and short replies", async () => {
    const r = state(), when = `<t:${Math.floor(now / 1000)}:R>`
    const audit = projectMetadataEvent("guildAuditLogEntryCreate", { guildId: f.ids.guild, id: f.nextId(), userId: f.ids.user, targetId: f.nextId(), actionType: 22 }, { serverId: f.ids.guild, observedAt: now, sessionId: "a".repeat(32), sequence: 4 })!
    const records = Array.from({ length: 10 }, (_, i): C.MetadataLogsRecord => ({ ...r.record, recordNo: 20 - i, event: i % 2 ? audit : r.record.event }))
    const uncertain: C.MetadataLogsRecord = { ...records[1]!, delivery: { ...r.record.delivery!, recordNo: 19, state: "uncertain" } }
    const counters: C.MetadataLogsCounters = { activeTicketSlots: 3, retainedModerationCases: 12, retainedMetadataRecords: 9500, categories: { membership: 9000, resources: 100, messages: 100, audit: 100, settings: 100, operations: 50, security: 50 },
        queued: 4, reserved: 1, failed: 2, uncertain: 3, refused: 0, suppressed: 900, definitions: { tickets: "Active slots including reserved and recovery work", moderation: "Retained manual, event and critical cases", metadata: "Retained admitted records, not unique causal actions", deliveries: "Current delivery states, independent of event admission" } }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { bot, send } = yield* reportBot(operation => operation.type === "list" ? { type: "records", records, nextBeforeRecordNo: 11 } : operation.type === "counters" ? { type: "counters", counters } : { type: "record", record: uncertain }, [])
        const list = yield* send("!logs events list")
        assertShort(list, 13)
        assert.deepEqual(list.embeds, [{ color: 0x5560e6, title: "Metadata events", description: records.map((record, i) => `**#${record.recordNo}** ${i % 2 ? `Audit: Member banned by <@${f.ids.user}>` : "Member departed"}, ${when}`).join("\n"),
            fields: [{ name: "Details", value: "`!logs events show <record>`" }, { name: "Next", value: "`!logs events list next`" }] }])
        const record = yield* send("!logs events show 19")
        assertShort(record)
        assert.deepEqual(record.embeds![0]!.fields, [{ name: "Event", value: "Audit: Member banned" }, { name: "By", value: `<@${f.ids.user}>` }, { name: "When", value: when },
            { name: "Log post", value: `Not confirmed yet in <#${f.ids.channel}>. Run \`!logs delivery reconcile 19\` to check it` }])
        const report = yield* send("!logs counters")
        assertShort(report)
        assert.deepEqual(report.embeds, [{ color: 0x5560e6, title: "Log counters", description: "`!logs metadata status` names log channels NeonFlux cannot post in", fields: [{ name: "Open tickets", value: "3" }, { name: "Moderation cases stored", value: "12" },
            { name: "Metadata events stored", value: "9500: Membership 9000, Resources 100, Messages 100, Audit 100, Settings 100, Operations 50, Security 50" }, { name: "Log posts", value: "4 waiting, 1 posting, 2 failed, 3 not confirmed" }] }])
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("event override changes name the event in plain words", async () => {
    const r = state(), settings: C.MetadataLogsSettings = { ...crowdedSettings().settings, eventRoutes: [] }
    r.store.work = () => Effect.succeed({ type: "work", records: [] })
    r.store.query = () => Effect.succeed({ type: "settings", settings } as const)
    r.store.manage = () => Effect.succeed({ duplicate: false, type: "settings", settings } as const)
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { metadata: r.store })), p = platform(bot)
        bot.rest.respond(`GET /users/${f.ids.user}`, { body: bot.fixtures.user({ bot: false, system: false }) })
        yield* bot.ready()
        const say = (content: string) => Effect.gen(function* () { yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); const response = yield* p.replies.next(); yield* bot.idle(); return (response.body as { content: string }).content })
        assert.equal(yield* say(`!logs metadata event audit-entry:20 ${f.ids.channel} ${f.ids.user} on`), `**Audit: Member kicked** events now post in <#${f.ids.channel}>, owner <@${f.ids.user}>`)
        assert.equal(yield* say("!logs metadata event member-remove off"), "**Member departed** events are now off")
        assert.equal(yield* say("!logs metadata inherit member-remove"), "**Member departed** events now follow their category again")
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})
