import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { SchedulesStoreError } from "../src/schedule-store.ts"
import { platform, boundary, token } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { schedulesBoundary, scheduleGrant } from "./schedule-fixture.ts"

function options(remote: ReturnType<typeof schedulesBoundary>, publishing = publishingBoundary(), moderation?: ReturnType<typeof boundary>) {
    const f = createFixtures()
    return createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation?.store, publishing: publishing.store, schedules: remote.store })
}
test("management uses actual current administrator and retains frozen past dates", async () => {
    const remote = schedulesBoundary()
    remote.schedule.calendar.dates[0]!.dueAt = Date.parse("2026-01-02T00:00:00Z")
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote)), p = platform(bot, { actorOwner: false, actorPermissions: Permissions.Administrator, botPermissions: Permissions.ViewChannel })
        yield* bot.ready()
        for (const content of ["!publish schedule update 1 2 content draft news 4", "!publish schedule disable 1 2", "!publish schedule cancel 1 2"]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); yield* p.replies.next(); yield* bot.idle()
        }
        const writes = remote.calls.filter(c => c.method === "manage").map(c => c.input as C.SchedulesManageRequest)
        assert.equal(writes.length, 3); assert(writes.every(input => input.context.actor.userId === bot.fixtures.ids.user && input.context.actor.isAdministrator && !input.context.actor.isOwner))
        assert.deepEqual(writes[0]!.operation, { type: "content", scheduleNo: 1, expectedRevision: 2, source: { kind: "draft", name: "news", revision: 4 } })
        assert.equal(p.target.requests().length, 0)
        assert.equal(remote.calls.some(c => c.method === "query" && (c.input as C.SchedulesQueryRequest).operation.type === "show"), false)
        assert.equal(bot.failures().length, 0)
    })))
})
test("schedule configuration stays staff-only and selective forgetting needs exact confirmation", async () => {
    const remote = schedulesBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote)), p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.ReadMessageHistory })
        yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!publish schedule show 1" })); yield* p.replies.next(); yield* bot.idle()
        assert.equal(remote.calls.some(c => c.method === "query"), false)
        p.guildRoute.remove(); bot.rest.respond("GET /guilds/:id", { body: bot.fixtures.guild({ owner_id: bot.fixtures.ids.user }) })
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!publish schedule forget 1 2 3 9" })); const preview = yield* p.replies.next(); yield* bot.idle()
        assert.match((preview.body as { content: string }).content, /forget 1 2 3 9 confirm/); assert.equal(remote.calls.some(c => c.method === "manage"), false)
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!publish schedule forget 1 2 3 9 confirm" })); yield* p.replies.next(); yield* bot.idle()
        const input = remote.calls.find(c => c.method === "manage")!.input as C.SchedulesManageRequest
        assert.deepEqual(input.operation, { type: "forget", scheduleNo: 1, expectedRevision: 2, occurrenceNos: [3, 9], confirm: "forget" })
        for (const request of p.replies.requests()) assert.deepEqual((request.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
    })))
})
test("create freezes finite civil calendar and exact source revision, with no immediate provider publication", async () => {
    const remote = schedulesBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote)), p = platform(bot, { botPermissions: Permissions.ViewChannel })
        yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!publish schedule create news template notice 3 <#${bot.fixtures.ids.channel}> 2026-11-01T18:00 Europe/Berlin reject weekly 1 3` })); yield* p.replies.next(); yield* bot.idle()
        const input = remote.calls.find(c => c.method === "manage")!.input as C.SchedulesManageRequest
        assert.equal(input.operation.type, "create")
        if (input.operation.type !== "create") return
        assert.deepEqual(input.operation.source, { kind: "template", name: "notice", revision: 3 }); assert.equal(input.operation.calendar.dates.length, 3)
        assert.equal(new Date(input.operation.calendar.dates[0]!.dueAt).toISOString(), "2026-11-01T17:00:00.000Z")
        assert.equal(p.replies.requests().length, 1); assert.equal(input.context.actor.userId, bot.fixtures.ids.user); assert(input.createdAt > 0)
    })))
})
test("DEFCON recovery keeps status/disable/cancel/forget while future activation remains gated, conflicts return current-state recovery", async () => {
    const remote = schedulesBoundary({ manage: () => Effect.fail(new SchedulesStoreError({ operation: "manage", status: 409 })) }), moderation = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote, publishingBoundary(), moderation)), p = platform(bot)
        yield* bot.ready(); moderation.current.defcon = 1
        for (const content of ["!publish schedule status", "!publish schedule disable 1 2", "!publish schedule cancel 1 2", "!publish schedule forget 1 2 3 confirm"]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); const reply = yield* p.replies.next(); yield* bot.idle()
            if (!content.endsWith("status")) assert.match((reply.body as { content: string }).content, /Schedule state changed/)
        }
        assert(moderation.calls.filter(c => c.method === "gate").slice(-4).every(c => (c.input as C.ModerationGateRequest).command === "critical"))
        const count = p.replies.requests().length
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!publish schedule enable 1 2" })); yield* bot.idle()
        assert.equal(p.replies.requests().length, count)
    })))
})
test("exact known post reconciliation checks schedule ownership and unknown IDs cannot trigger a native search or write", async () => {
    const remote = schedulesBoundary(), publishing = publishingBoundary(), grant = scheduleGrant()
    publishing.posts.set(grant.postNo, { postNo: grant.postNo, generation: grant.generation, channelId: grant.channelId, botId: grant.botId, outcome: "uncertain", createdAt: 0, updatedAt: 1000, consumer: grant.consumer, attempt: { ...grant, outcome: "uncertain", createdAt: 0 } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote, publishing)), p = platform(bot)
        yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!publish schedule reconcile 1 2 1" })); const reply = yield* p.replies.next(); yield* bot.idle()
        assert.match((reply.body as { content: string }).content, /no known native message identity/)
        assert.equal(remote.calls.some(c => c.method === "manage"), false); assert.equal(p.replies.requests().length, 1)
        const messageId = bot.fixtures.nextId(), post = publishing.posts.get(1)!
        post.messageId = messageId; post.attempt.messageId = messageId
        const fetch = bot.rest.respond(`GET /channels/${grant.channelId}/messages/${messageId}`, { body: bot.fixtures.message({ id: messageId, author: bot.fixtures.botUser(), content: grant.content.content, embeds: [{ type: "rich", color: 0, ...grant.content.embed }] }) })
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!publish schedule reconcile 1 2 1" })); yield* p.replies.next(); yield* bot.idle()
        const input = remote.calls.find(c => c.method === "manage")!.input as C.SchedulesManageRequest
        assert.equal(input.operation.type, "reconcile")
        if (input.operation.type === "reconcile") { assert.equal(input.operation.deliveryId, grant.consumer.deliveryId); assert.equal(input.operation.observation.messageId, messageId); assert.equal(input.context.actor.userId, bot.fixtures.ids.user) }
        assert.equal(fetch.requests().length, 1); assert.equal(p.replies.requests().length, 2)
    })))
})
