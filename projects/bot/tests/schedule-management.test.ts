import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { canonicalPublishingContent } from "../src/publishing-content.ts"
import { SchedulesStoreError } from "../src/schedule-store.ts"
import { platform, boundary, token } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { schedulesBoundary, scheduleGrant, scheduleNow } from "./schedule-fixture.ts"

function options(remote: ReturnType<typeof schedulesBoundary>, publishing = publishingBoundary(), moderation?: ReturnType<typeof boundary>) {
    const f = createFixtures()
    return createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation?.store, publishing: publishing.store, schedules: remote.store })
}
function source(publishing: ReturnType<typeof publishingBoundary>, kind: C.PublishingKind, name: string, revision: number) {
    const content = { content: "Synthetic source" }
    publishing.drafts.set(`${kind}:${name}`, { kind, name, revision, content, canonicalContent: canonicalPublishingContent(content), createdAt: 0, updatedAt: 0 })
}
const text = (reply: { body: unknown }) => (reply.body as { content: string }).content
const writes = (remote: ReturnType<typeof schedulesBoundary>) => remote.calls.filter(c => c.method === "manage").map(c => c.input as C.SchedulesManageRequest)
const queries = (remote: ReturnType<typeof schedulesBoundary>) => remote.calls.filter(c => c.method === "query").map(c => (c.input as C.SchedulesQueryRequest).operation)

test("management names the schedule and writes against its current revisions as the actual current administrator", async () => {
    const remote = schedulesBoundary(), publishing = publishingBoundary()
    source(publishing, "draft", "news", 4)
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote, publishing)), p = platform(bot, { actorOwner: false, actorPermissions: Permissions.Administrator, botPermissions: Permissions.ViewChannel })
        yield* bot.ready()
        for (const content of ["!publish schedule update News content draft NEWS", "!publish schedule disable news", "!publish schedule cancel news", `!publish schedule update news destination <#${bot.fixtures.ids.channel}>`, "!publish schedule module off"]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); yield* p.replies.next(); yield* bot.idle()
        }
        const sent = writes(remote)
        assert.equal(sent.length, 5); assert(sent.every(input => input.context.actor.userId === bot.fixtures.ids.user && input.context.actor.isAdministrator && !input.context.actor.isOwner))
        // The schedule's current revision 2 and the source's current revision 4 come from reads right before each write
        assert.deepEqual(sent.map(input => input.operation), [{ type: "content", scheduleNo: 1, expectedRevision: 2, source: { kind: "draft", name: "news", revision: 4 } }, { type: "disable", scheduleNo: 1, expectedRevision: 2 },
            { type: "cancel", scheduleNo: 1, expectedRevision: 2 }, { type: "destination", scheduleNo: 1, expectedRevision: 2, channelId: bot.fixtures.ids.channel }, { type: "settings", enabled: false, expectedRevision: 1 }])
        assert.deepEqual(queries(remote), [...Array.from({ length: 4 }, () => ({ type: "show", name: "news" })), { type: "settings" }])
        assert.equal(p.target.requests().length, 0)
        assert.equal(bot.failures().length, 0)
    })))
})
test("an unknown schedule name writes nothing and a missing source is named", async () => {
    const remote = schedulesBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote)), p = platform(bot)
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!publish schedule enable other" })); assert.equal(text(yield* p.replies.next()), "That schedule or retained delivery was not found"); yield* bot.idle()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!publish schedule update news content template missing" })); assert.equal(text(yield* p.replies.next()), "That draft, template, or tracked post was not found"); yield* bot.idle()
        assert.equal(writes(remote).length, 0)
    })))
})
test("schedule configuration stays staff-only and selective forgetting needs exact confirmation and names its continuation", async () => {
    const remote = schedulesBoundary()
    remote.store.manage = input => Effect.sync(() => { remote.calls.push({ method: "manage", input }); return { duplicate: false, type: "forgotten", scheduleNo: 1, complete: false, removed: 2 } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote)), p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.ReadMessageHistory })
        yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!publish schedule show news" })); yield* p.replies.next(); yield* bot.idle()
        assert.equal(remote.calls.some(c => c.method === "query"), false)
        p.guildRoute.remove(); bot.rest.respond("GET /guilds/:id", { body: bot.fixtures.guild({ owner_id: bot.fixtures.ids.user }) })
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!publish schedule forget news 3 9" })); const preview = yield* p.replies.next(); yield* bot.idle()
        assert.match(text(preview), /Confirm: !publish schedule forget news 3 9 confirm$/); assert.equal(remote.calls.length, 0)
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!publish schedule forget news 3 9 confirm" }))
        assert.equal(text(yield* p.replies.next()), "Schedule news: 2 retained records removed, forgetting Incomplete. Continue !publish schedule forget news 3 9 confirm with a new message. Native messages stay"); yield* bot.idle()
        assert.deepEqual(queries(remote), [{ type: "show", name: "news" }])
        assert.deepEqual(writes(remote)[0]!.operation, { type: "forget", scheduleNo: 1, expectedRevision: 2, occurrenceNos: [3, 9], confirm: "forget" })
        for (const request of p.replies.requests()) assert.deepEqual((request.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
    })))
})
test("create and time changes freeze a finite civil calendar and the source's current revision, with no immediate provider publication", async () => {
    const remote = schedulesBoundary(), publishing = publishingBoundary()
    source(publishing, "template", "notice", 3)
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${scheduleNow} millis`)
        const bot = yield* createTestBot(options(remote, publishing)), p = platform(bot, { botPermissions: Permissions.ViewChannel })
        yield* bot.ready()
        for (const content of [`!publish schedule create news template notice <#${bot.fixtures.ids.channel}> 2026-03-01T18:00 Europe/Berlin reject weekly 1 3`, "!publish schedule update news time 2026-03-02T09:30 UTC reject"]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); yield* p.replies.next(); yield* bot.idle()
        }
        const [create, time] = writes(remote)
        assert(create?.operation.type === "create" && time?.operation.type === "calendar")
        assert.deepEqual(create.operation.source, { kind: "template", name: "notice", revision: 3 }); assert.equal(create.operation.calendar.dates.length, 3)
        assert.equal(new Date(create.operation.calendar.dates[0]!.dueAt).toISOString(), "2026-03-01T17:00:00.000Z")
        assert.equal(time.operation.expectedRevision, 2); assert.equal(new Date(time.operation.calendar.dates[0]!.dueAt).toISOString(), "2026-03-02T09:30:00.000Z")
        assert.equal(p.replies.requests().length, 2); assert.equal(create.context.actor.userId, bot.fixtures.ids.user); assert(create.createdAt > 0)
    })).pipe(Effect.provide(TestClock.layer())))
})
test("lists and delivery status page with next, and each list remembers its own place", async () => {
    const remote = schedulesBoundary(), schedules = [11, 12].map(scheduleNo => ({ ...remote.schedule, scheduleNo, name: `news-${scheduleNo}` }))
    remote.store.query = input => Effect.sync((): C.SchedulesQueryResult => {
        remote.calls.push({ method: "query", input })
        const op = input.operation
        if (op.type === "show") return { type: "schedule", schedule: remote.schedule }
        if (op.type === "list") return op.beforeScheduleNo ? { type: "schedules", schedules: [schedules[0]!] } : { type: "schedules", schedules: [schedules[1]!], nextBeforeScheduleNo: 12 }
        assert(op.type === "deliveries")
        return op.afterOccurrenceNo ? { type: "deliveries", deliveries: [] } : { type: "deliveries", deliveries: [], nextAfterOccurrenceNo: 20 }
    })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote)), p = platform(bot)
        yield* bot.ready()
        const say = (content: string) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(p.replies.next()), Effect.map(text), Effect.tap(() => bot.idle()))
        assert.equal(yield* say("!publish schedule list"), "Schedule news-12: Enabled, plan 1\nNext: !publish schedule list next")
        assert.equal(yield* say("!publish schedule status news"), "No retained deliveries\nNext: !publish schedule status news next")
        assert.equal(yield* say("!publish schedule list next"), "Schedule news-11: Enabled, plan 1")
        assert.equal(yield* say("!publish schedule status news next"), "No retained deliveries")
        assert.equal(yield* say("!publish schedule list next"), "There is no next page to show. Send !publish schedule list to start the list again")
        assert.equal(yield* say("!publish schedule status news next"), "There is no next page to show. Send !publish schedule status news to start the list again")
        assert.deepEqual(queries(remote), [{ type: "list" }, { type: "show", name: "news" }, { type: "deliveries", scheduleNo: 1 }, { type: "list", beforeScheduleNo: 12 }, { type: "show", name: "news" }, { type: "deliveries", scheduleNo: 1, afterOccurrenceNo: 20 }])
    })))
})
test("DEFCON recovery keeps status/disable/cancel/forget while future activation remains gated, conflicts ask to send the command again", async () => {
    const remote = schedulesBoundary({ manage: () => Effect.fail(new SchedulesStoreError({ operation: "manage", status: 409 })) }), moderation = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote, publishingBoundary(), moderation)), p = platform(bot)
        yield* bot.ready(); moderation.current.defcon = 1
        for (const content of ["!publish schedule status", "!publish schedule disable news", "!publish schedule cancel news", "!publish schedule forget news 3 confirm"]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); const reply = yield* p.replies.next(); yield* bot.idle()
            if (!content.endsWith("status")) assert.match(text(reply), /^Schedule state changed\. Send the command again/)
        }
        assert(moderation.calls.filter(c => c.method === "gate").slice(-4).every(c => (c.input as C.ModerationGateRequest).command === "critical"))
        const count = p.replies.requests().length
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!publish schedule enable news" })); yield* bot.idle()
        assert.equal(p.replies.requests().length, count)
    })))
})
test("exact known post reconciliation checks schedule ownership and unknown IDs cannot trigger a native search or write", async () => {
    const remote = schedulesBoundary(), publishing = publishingBoundary(), grant = scheduleGrant()
    publishing.posts.set(grant.postNo, { postNo: grant.postNo, generation: grant.generation, channelId: grant.channelId, botId: grant.botId, outcome: "uncertain", createdAt: 0, updatedAt: 1000, consumer: grant.consumer, attempt: { ...grant, outcome: "uncertain", createdAt: 0 } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote, publishing)), p = platform(bot)
        yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!publish schedule reconcile news 1" })); const reply = yield* p.replies.next(); yield* bot.idle()
        assert.match(text(reply), /no known native message identity/)
        assert.equal(remote.calls.some(c => c.method === "manage"), false); assert.equal(p.replies.requests().length, 1)
        const messageId = bot.fixtures.nextId(), post = publishing.posts.get(1)!
        post.messageId = messageId; post.attempt.messageId = messageId
        const fetch = bot.rest.respond(`GET /channels/${grant.channelId}/messages/${messageId}`, { body: bot.fixtures.message({ id: messageId, author: bot.fixtures.botUser(), content: grant.content.content, embeds: [{ type: "rich", color: 0, ...grant.content.embed }] }) })
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!publish schedule reconcile news 1" })); yield* p.replies.next(); yield* bot.idle()
        const input = writes(remote)[0]!
        assert.equal(input.operation.type, "reconcile")
        if (input.operation.type === "reconcile") { assert.equal(input.operation.expectedRevision, 2); assert.equal(input.operation.deliveryId, grant.consumer.deliveryId); assert.equal(input.operation.observation.messageId, messageId); assert.equal(input.context.actor.userId, bot.fixtures.ids.user) }
        assert.equal(fetch.requests().length, 1); assert.equal(p.replies.requests().length, 2)
        // A post another schedule owns is never reconciled through this one
        publishing.posts.set(2, { ...structuredClone(post), postNo: 2, consumer: { ...grant.consumer, scheduleNo: 5 } })
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!publish schedule reconcile news 2" })); yield* p.replies.next(); yield* bot.idle()
        assert.equal(writes(remote).length, 1); assert.equal(fetch.requests().length, 1)
    })))
})
