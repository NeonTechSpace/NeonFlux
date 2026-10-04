import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { eventsBoundary } from "./event-fixture.ts"
import { boundary, platform, token } from "./moderation-fixture.ts"
import { EventsStoreError } from "../src/event-store.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { eventTimerGrant } from "./event-fixture.ts"

test("guild public event commands use fresh native membership and view without ManageRoles, raw epoch stays exact", async () => {
    const f = createFixtures(), remote = eventsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { events: remote.store }))
        const p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.ReadMessageHistory, botPermissions: Permissions.ViewChannel | Permissions.SendMessages })
        p.actor.remove(); bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: bot.fixtures.member({ roles: [p.actorRole.id], joined_at: "2026-01-01T00:00:00.123456789+00:00", communication_disabled_until: null }) })
        yield* bot.ready()
        for (const content of ["!event list", "!event show 1", "!event dates 1", "!event attendees 1 1", "!event rsvp 1 1 going", "!events"]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); yield* p.replies.next(); yield* bot.idle()
        }
        const source = remote.calls.find(c => c.method === "rsvp")!.input as C.EventsRsvpRequest
        assert.equal(source.context.member!.joinedAt, "2026-01-01T00:00:00.123456789+00:00")
        assert.equal(source.context.member!.canView, true); assert.equal(source.context.member!.canReadHistory, true)
        assert(source.createdAt > 0 && source.messageId.length > 0)
        assert(remote.calls.filter(c => c.method === "query").every(c => (c.input as C.EventsQueryRequest).context.channelId === f.ids.channel))
        for (const request of p.replies.requests()) assert.deepEqual((request.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        assert.equal(bot.failures().length, 0)
    })))
})
test("event management requires fresh owner/admin and exact forget confirmation makes no mutation", async () => {
    const f = createFixtures(), remote = eventsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { events: remote.store }))
        const p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.ReadMessageHistory })
        yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!event module on 1" }))
        const denied = yield* p.replies.next(); yield* bot.idle(); assert.match((denied.body as { content: string }).content, /Only the server owner/)
        assert.equal(remote.calls.some(c => c.method === "manage"), false)
        p.guildRoute.remove(); bot.rest.respond("GET /guilds/:id", { body: bot.fixtures.guild({ owner_id: f.ids.user }) })
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!event forget 1 2" })); const preview = yield* p.replies.next(); yield* bot.idle()
        assert.match((preview.body as { content: string }).content, /!event forget 1 2 confirm/)
        assert.equal(remote.calls.some(c => c.method === "manage"), false)
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!event forget 1 2 confirm" })); yield* p.replies.next(); yield* bot.idle()
        const write = remote.calls.find(c => c.method === "manage")!.input as C.EventsManageRequest
        assert.deepEqual(write.operation, { type: "forget", eventNo: 1, expectedRevision: 2, confirm: "forget" })
    })))
})
test("DEFCON blocks public events and preserves authorized critical disable, cancellation and status", async () => {
    const f = createFixtures(), remote = eventsBoundary(), moderation = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, events: remote.store })), p = platform(bot)
        yield* bot.ready()
        moderation.current.defcon = 2
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!event rsvp 1 1 going" })); yield* bot.idle()
        assert.equal(remote.calls.some(c => c.method === "rsvp"), false)
        moderation.current.defcon = 1
        for (const content of ["!event module off 1", "!event cancel 1 2", "!event status"]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); yield* p.replies.next(); yield* bot.idle()
        }
        assert.equal(remote.calls.filter(c => c.method === "manage").length, 2)
        assert(moderation.calls.filter(c => c.method === "gate").slice(-3).every(c => (c.input as C.ModerationGateRequest).command === "critical"))
    })))
})
test("malformed event namespace is consumed and HTTP conflicts return useful recovery", async () => {
    const f = createFixtures(), remote = eventsBoundary({ rsvp: () => Effect.fail(new EventsStoreError({ operation: "rsvp", status: 409 })) })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { events: remote.store })), p = platform(bot)
        yield* bot.ready()
        for (const content of ['!event time "broken', "!event unknown", "!event rsvp 1 1 none"]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); const reply = yield* p.replies.next(); yield* bot.idle()
            assert.match((reply.body as { content: string }).content, content.includes(" rsvp ") ? /Read !event show/ : /!event help/)
        }
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ guild_id: undefined, channel_id: p.dmId, content: "!event list" })); yield* bot.idle()
        assert.equal(remote.calls.length, 0)
        assert.equal(bot.failures().length, 0)
    })))
})

test("even an administrator's public event details stay in the actual destination and native visibility fails closed", async () => {
    const f = createFixtures(), remote = eventsBoundary()
    remote.event.channelId = "123456789012345699"
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { events: remote.store })), p = platform(bot)
        yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!event show 1" }))
        const denied = yield* p.replies.next(); yield* bot.idle()
        assert(!((denied.body as { content: string }).content.includes("Study")))
        p.actor.remove(); bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: bot.fixtures.member({ roles: [p.actorRole.id], communication_disabled_until: "2099-01-01T00:00:00Z" }) })
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!event rsvp 1 1 going" })); yield* p.replies.next(); yield* bot.idle()
        assert.equal(remote.calls.some(c => c.method === "rsvp"), false)
    })))
})

test("draft configuration uses fresh staff authority without native send/embed permissions and binds full calendar DTOs", async () => {
    const f = createFixtures(), remote = eventsBoundary()
    delete remote.event.cardPostNo
    remote.event.state = "draft"
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { events: remote.store })), p = platform(bot, { botPermissions: Permissions.ViewChannel })
        yield* bot.ready()
        for (const content of [`!event create study <#${f.ids.channel}> "Study group"`, "!event time 1 2 2026-11-01T18:00 Europe/Berlin 60 reject", "!event capacity 1 2 5"]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); yield* p.replies.next(); yield* bot.idle()
        }
        const writes = remote.calls.filter(c => c.method === "manage").map(c => c.input as C.EventsManageRequest)
        assert.equal(writes.length, 3)
        assert.equal(writes[0]!.operation.type, "create")
        const calendar = writes[1]!.operation
        assert.equal(calendar.type, "calendar")
        if (calendar.type === "calendar") {
            assert.equal(calendar.calendar.zone, "Europe/Berlin")
            assert.equal(calendar.calendar.dates[0]!.offsetMinutes, 60)
            assert.equal(calendar.calendar.dates[0]!.localMinute, "2026-11-01T18:00")
            assert.equal(calendar.expectedRevision, 2)
        }
        assert(writes.every(w => w.context.actor.isOwner && w.context.botAuthorized))
        assert.equal(bot.failures().length, 0)
    })))
})
test("event reconciliation observes only an exact protected known message and unknown IDs never trigger native search", async () => {
    const f = createFixtures(), remote = eventsBoundary(), publishing = publishingBoundary(), grant = eventTimerGrant()
    const messageId = "123456789012345698"
    publishing.posts.set(2, { postNo: 2, generation: 1, botId: f.ids.bot, channelId: f.ids.channel, messageId, outcome: "uncertain", createdAt: 0, updatedAt: 0, consumer: grant.consumer,
        attempt: { ...grant, messageId, outcome: "uncertain", createdAt: 0 } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { publishing: publishing.store, events: remote.store })), p = platform(bot)
        const native = bot.rest.respond(`GET /channels/${f.ids.channel}/messages/${messageId}`, { body: bot.fixtures.message({ id: messageId, author: bot.fixtures.botUser(), content: grant.content.content,
            embeds: [{ type: "rich", ...grant.content.embed!, color: 0, fields: grant.content.embed!.fields!.map(field => ({ ...field, inline: field.inline ?? false })) }] }) })
        yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!event reconcile 1 2 2" })); const reply = yield* p.replies.next(); yield* bot.idle()
        assert.match((reply.body as { content: string }).content, /Original delivery outcome is retained/)
        assert.equal(native.requests().length, 1)
        assert.equal(publishing.calls.filter(c => c.method === "reconcile").length, 1)
        const observation = (publishing.calls.find(c => c.method === "reconcile")!.input as C.PublishingReconcileRequest).observation
        assert.equal(observation.content.embed!.color, 0)
        assert.equal(observation.messageId, messageId)
        assert.equal(publishing.posts.get(2)!.attempt.outcome, "uncertain")
        assert.equal(publishing.calls.filter(c => c.method === "dispatch").length, 0)
        delete publishing.posts.get(2)!.messageId
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!event reconcile 1 2 2" })); const unknown = yield* p.replies.next(); yield* bot.idle()
        assert.match((unknown.body as { content: string }).content, /no known native message identity/)
        assert.equal(native.requests().length, 1)
    })))
})
