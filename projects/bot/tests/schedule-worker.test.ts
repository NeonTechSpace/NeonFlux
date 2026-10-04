import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Deferred, Effect, Fiber, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { processScheduleDelivery } from "../src/schedules.ts"
import { processSchedulesPass, startSchedulesWorker } from "../src/schedule-worker.ts"
import { platform } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { scheduleDelivery, scheduleGrant, scheduleNow, schedulesBoundary } from "./schedule-fixture.ts"

function native(bot: Effect.Success<ReturnType<typeof createTestBot>>, actorOwner = true) {
    const p = platform(bot, { actorOwner, actorPermissions: Permissions.Administrator, botPermissions: Permissions.ViewChannel | Permissions.SendMessages | Permissions.ReadMessageHistory | Permissions.EmbedLinks })
    p.replies.remove()
    const send = bot.rest.respond("POST /channels/:id/messages", request => {
        const value = request.body as { content?: string, embeds?: object[] }
        return { body: bot.fixtures.message({ channel_id: request.path.split("/")[2], author: bot.fixtures.botUser(), content: value.content ?? "", embeds: value.embeds?.map(e => ({ type: "rich", color: 0, ...e })) ?? [] }) }
    })
    return { ...p, send }
}
function addGrant(remote: ReturnType<typeof publishingBoundary>, grant: C.SchedulesDeliveryGrant, createdAt = scheduleNow) {
    remote.posts.set(grant.postNo, { postNo: grant.postNo, generation: grant.generation, botId: grant.botId, channelId: grant.channelId, outcome: "pending", createdAt, updatedAt: createdAt, consumer: grant.consumer, attempt: { ...grant, outcome: "pending", createdAt } })
}
const controlled = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))

test("schedule timer acts as the bot with an immutable plan, concrete SDK and schedule-only fresh dispatch proof", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${scheduleNow} millis`)
        const bot = yield* createTestBot({ token: "synthetic-schedule-token" }), p = native(bot, false), delivery = scheduleDelivery({ nextCheckAt: scheduleNow + 60000 }), grant = scheduleGrant(delivery), publishing = publishingBoundary()
        addGrant(publishing, grant)
        const remote = schedulesBoundary({ delivery: input => Effect.sync(() => {
            assert.equal(p.send.requests().length, 0); assert.equal(input.operation.type, "reserve")
            if (input.operation.type === "reserve") { assert.equal(input.operation.context.botId, grant.botId); assert.equal(input.operation.context.channelId, delivery.channelId); assert.deepEqual(input.operation.binding, { deliveryId: delivery.deliveryId, scheduleNo: 1, planRevision: 1, occurrenceNo: 1 }) }
            return { type: "reservation", status: "reserved", grant } as const
        }) })
        const result = yield* processScheduleDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, delivery)
        assert(result && typeof result === "object" && result.outcome === "sent", JSON.stringify(result))
        assert.equal(p.send.requests().length, 1)
        const claim = publishing.calls.find(c => c.method === "dispatch")!.input as C.PublishingDispatchRequest
        assert.equal(claim.eventContext, undefined); assert.equal(claim.scheduleContext!.botId, grant.botId); assert.equal(claim.scheduleContext!.botAuthorized, true)
        assert.equal(claim.sourceId, `schedule_timer_${delivery.deliveryId}`); assert.match(claim.claimToken, /^[a-f0-9]{32}$/)
        assert.deepEqual((p.send.requests()[0]!.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
    }))
})
test("same reserved occurrence resumes its one-time attempt and refuses substitution or claimed history", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${scheduleNow} millis`)
        const bot = yield* createTestBot({ token: "synthetic-schedule-token" }), p = native(bot), grant = scheduleGrant(), publishing = publishingBoundary()
        addGrant(publishing, grant)
        let reserved = 0
        const remote = schedulesBoundary({ delivery: () => Effect.sync(() => { reserved++; return { type: "reservation", status: "reserved", grant } as const }) })
        const delivery = scheduleDelivery({ state: "reserved", postNo: grant.postNo, attemptId: grant.attemptId })
        const result = yield* processScheduleDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, delivery)
        assert(result && typeof result === "object" && result.outcome === "sent")
        assert.equal(p.send.requests().length, 1)
        yield* Effect.exit(processScheduleDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, { ...delivery, attemptId: "synthetic_other_attempt" }))
        assert.equal(p.send.requests().length, 1)
        for (const state of ["failed", "uncertain", "sent", "skipped", "superseded", "cancelled"] as const) yield* processScheduleDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, { ...delivery, state })
        yield* processScheduleDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, { ...delivery, claimedAt: scheduleNow })
        assert.equal(reserved, 2)
    }))
})
test("pause, update and cancel at claim boundary cause no native send or invented no-dispatch acknowledgement", async () => {
    for (const reason of ["pause", "update", "cancel"] as const) await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${scheduleNow} millis`)
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), bot = yield* createTestBot({ token: "synthetic-schedule-token" }), p = native(bot), grant = scheduleGrant()
        const publishing = publishingBoundary({ dispatch: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as({ claimed: false, dispatchExpiresAt: grant.dispatchExpiresAt, nativeDeadlineMs: 5000 })) })
        const remote = schedulesBoundary({ delivery: () => Effect.succeed({ type: "reservation", status: "reserved", grant }) })
        const run = yield* processScheduleDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, scheduleDelivery()).pipe(Effect.forkScoped)
        yield* Deferred.await(entered); yield* Deferred.succeed(release, undefined)
        const result = yield* Fiber.join(run)
        assert(result && typeof result === "object" && !result.acknowledged, reason)
        assert.equal(p.send.requests().length, 0, reason); assert.equal(publishing.calls.some(c => c.method === "outcome"), false, reason)
    }))
})
test("schedule deadline is reservation plus 180 seconds and is checked immediately after claim", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${scheduleNow + 270000} millis`)
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), bot = yield* createTestBot({ token: "synthetic-schedule-token" }), p = native(bot), grant = scheduleGrant(scheduleDelivery(), scheduleNow + 270000)
        assert.equal(grant.dispatchExpiresAt, scheduleNow + 450000)
        const publishing = publishingBoundary({ dispatch: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as({ claimed: true, dispatchExpiresAt: grant.dispatchExpiresAt, nativeDeadlineMs: 5000 })) })
        const remote = schedulesBoundary({ delivery: () => Effect.succeed({ type: "reservation", status: "reserved", grant }) })
        const run = yield* processScheduleDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, scheduleDelivery()).pipe(Effect.forkScoped)
        yield* Deferred.await(entered); yield* TestClock.adjust("180000 millis"); yield* Deferred.succeed(release, undefined)
        const result = yield* Fiber.join(run)
        assert(result && typeof result === "object" && result.outcome === "failed"); assert.equal(p.send.requests().length, 0)
        assert.match((publishing.calls.find(c => c.method === "outcome")!.input as C.PublishingOutcomeRequest).claimToken!, /^[a-f0-9]{32}$/)
    }))
})
test("uncertain native response preserves unknown identity and cannot replay the occurrence", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${scheduleNow} millis`)
        const bot = yield* createTestBot({ token: "synthetic-schedule-token" }), p = native(bot), grant = scheduleGrant(), publishing = publishingBoundary()
        addGrant(publishing, grant); p.send.remove()
        const send = bot.rest.respond("POST /channels/:id/messages", { status: 500, body: { message: "Synthetic unavailable" } })
        const remote = schedulesBoundary({ delivery: () => Effect.succeed({ type: "reservation", status: "reserved", grant }) })
        const result = yield* processScheduleDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, scheduleDelivery())
        assert(result && typeof result === "object" && result.outcome === "uncertain" && result.messageId === undefined)
        yield* processScheduleDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, scheduleDelivery({ state: "uncertain", postNo: grant.postNo, attemptId: grant.attemptId }))
        assert.equal(send.requests().length, 1)
    }))
})
test("bounded discovery retains cursor past blocked destinations and empty pages without starving later jobs", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${scheduleNow} millis`)
        const bot = yield* createTestBot({ token: "synthetic-schedule-token" }), p = native(bot), publishing = publishingBoundary(), cursors: (C.SchedulesDeliveryCursor | undefined)[] = [], deferred: string[] = []
        let page = 0
        const remote = schedulesBoundary({ delivery: input => {
            const op = input.operation
            if (op.type === "list") {
                cursors.push(op.cursor); page++
                return Effect.succeed({ type: "deliveries", deliveries: page === 1 ? [scheduleDelivery({ channelId: p.targetId })] : page === 2 ? [] : [scheduleDelivery({ deliveryId: "synthetic_later" })], hasMore: page < 3,
                    ...(page < 3 ? { nextCursor: { cursor: `synthetic_page_${page}`, throughAt: scheduleNow } } : {}) })
            }
            if (op.type === "defer") { deferred.push(op.binding.deliveryId); return Effect.succeed({ type: "progress", recorded: true }) }
            return Effect.succeed({ type: "reservation", status: "skipped" })
        } })
        let cursor: C.SchedulesDeliveryCursor | undefined
        for (let i = 0; i < 3; i++) { const result = yield* processSchedulesPass(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, cursor); cursor = result.nextCursor; assert(result.considered <= 20) }
        assert.deepEqual(cursors, [undefined, { cursor: "synthetic_page_1", throughAt: scheduleNow }, { cursor: "synthetic_page_2", throughAt: scheduleNow }]); assert.equal(cursor, undefined)
        assert.deepEqual(deferred, ["synthetic_schedule_delivery"]); assert.equal(p.send.requests().length, 0)
    }))
})
test("scoped worker discovers once at startup, serializes pulses and follows a continuation without waiting", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${scheduleNow} millis`)
        const bot = yield* createTestBot({ token: "synthetic-schedule-token" }), seen = yield* Deferred.make<void>(), next = yield* Deferred.make<void>(), seenCursors: (C.SchedulesDeliveryCursor | undefined)[] = []
        const remote = schedulesBoundary({ delivery: input => Effect.gen(function* () {
            assert.equal(input.operation.type, "list")
            if (input.operation.type !== "list") return { type: "progress", recorded: false } as const
            seenCursors.push(input.operation.cursor)
            const first = seenCursors.length === 1
            yield* Deferred.succeed(first ? seen : next, undefined)
            return { type: "deliveries", deliveries: [], hasMore: first, ...(first ? { nextCursor: { cursor: "synthetic_startup", throughAt: scheduleNow } } : {}) } as const
        }) })
        yield* startSchedulesWorker(remote.store, publishingBoundary().store, bot.fixtures.ids.guild, bot.client)
        yield* Deferred.await(seen); yield* Deferred.await(next)
        assert.deepEqual(seenCursors, [undefined, { cursor: "synthetic_startup", throughAt: scheduleNow }]); assert.equal(yield* Clock.currentTimeMillis, scheduleNow)
    }))
})
