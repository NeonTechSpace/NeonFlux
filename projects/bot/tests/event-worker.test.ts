import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { Clock, Deferred, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { processEventDelivery, processEventPromotion } from "../src/events.ts"
import { processEventsPass, processEventsMemberPass, startEventsWorker, eventsPassBudget } from "../src/event-worker.ts"
import { EventsStoreError } from "../src/event-store.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { eventDefinition, eventDelivery, eventTimerGrant, eventNow, eventsBoundary } from "./event-fixture.ts"
import { platform } from "./moderation-fixture.ts"
import { createEventCalendar } from "../src/event-calendar.ts"

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
function native(bot: Bot) {
    const p = platform(bot, { botPermissions: Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks })
    p.replies.remove()
    const send = bot.rest.respond("POST /channels/:id/messages", request => {
        const value = request.body as { content?: string, embeds?: object[] }
        return { body: bot.fixtures.message({ channel_id: request.path.split("/")[2], author: bot.fixtures.botUser(), content: value.content ?? "", embeds: value.embeds?.map(e => {
            const embed = e as { fields?: { name: string, value: string, inline?: boolean }[] }
            return { type: "rich", ...e, ...(embed.fields ? { fields: embed.fields.map(field => ({ ...field, inline: field.inline ?? false })) } : {}) }
        }) ?? [] }) }
    })
    return { ...p, send }
}
function addGrant(remote: ReturnType<typeof publishingBoundary>, grant: C.EventsDeliveryGrant, createdAt: number) {
    remote.posts.set(grant.postNo, { postNo: grant.postNo, generation: grant.generation, botId: grant.botId, channelId: grant.channelId, outcome: "pending", createdAt, updatedAt: createdAt,
        consumer: grant.consumer, attempt: { ...grant, outcome: "pending", createdAt } })
}
const job = (event = eventDefinition()): C.EventsPromotionJob => ({ eventNo: event.eventNo, occurrenceNo: 1, revision: event.revision, generation: 3, nextCheckAt: eventNow, channelId: event.channelId })
const head = (input: Extract<C.EventsWorkRequest["operation"], { type: "claim" }>, userId: string): C.EventsPromotionBinding => ({ eventNo: input.eventNo, occurrenceNo: input.occurrenceNo, revision: input.revision, generation: input.generation, claimToken: input.claimToken,
    userId, joinedAt: "2026-01-01T00:00:00.000Z", rsvpRevision: 2, membershipGeneration: 1, queueOrder: 4 })

test("due event work reserves as the bot before one native send, rechecks bot context and suppresses mentions", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${eventNow} millis`)
        const bot = yield* createTestBot({ token: "synthetic-event-token" }), p = native(bot)
        const event = eventDefinition(), delivery = eventDelivery(event), grant = eventTimerGrant(event, delivery), publishing = publishingBoundary(), operations: string[] = []
        addGrant(publishing, grant, eventNow)
        const remote = eventsBoundary({ delivery: input => Effect.sync(() => {
            operations.push(input.operation.type)
            assert.equal(p.send.requests().length, 0)
            assert.equal(input.operation.type, "reserve")
            if (input.operation.type === "reserve") {
                assert.equal(input.operation.context.botId, bot.fixtures.ids.bot)
                assert.equal(input.operation.context.botAuthorized, true)
                assert.equal("actor" in input.operation.context, false)
            }
            return { type: "reservation", status: "reserved", grant } as const
        }) })
        const result = yield* processEventDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, delivery, event)
        assert(result && typeof result === "object" && result.outcome === "sent", JSON.stringify(result))
        assert.deepEqual(operations, ["reserve"]); assert.equal(p.send.requests().length, 1)
        const claim = publishing.calls.find(c => c.method === "dispatch")!.input as C.PublishingDispatchRequest
        assert.match(claim.claimToken, /^[a-f0-9]{32}$/)
        assert.equal(claim.sourceId, `event_timer_${delivery.deliveryId}`)
        assert.deepEqual(Object.keys(claim.eventContext!).sort(), ["botAuthorized", "botId", "channelId", "observedAt", "originServerId"])
        assert(claim.eventContext!.observedAt >= eventNow)
        assert.deepEqual((p.send.requests()[0]!.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        assert.equal(p.actor.requests().length, 0)
        assert.equal(publishing.posts.get(grant.postNo)!.outcome, "sent")
    })).pipe(Effect.provide(TestClock.layer())))
})
test("short event expiry is rechecked after claim and the native SDK budget respects the remaining window", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${eventNow + 270000} millis`)
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), bot = yield* createTestBot({ token: "synthetic-event-token" }), p = native(bot)
        const event = eventDefinition(), delivery = eventDelivery(), grant = eventTimerGrant(event, delivery, eventNow + 270000)
        assert.equal(grant.dispatchExpiresAt, eventNow + 300000)
        const publishing = publishingBoundary({ dispatch: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as({ claimed: true, dispatchExpiresAt: grant.dispatchExpiresAt, nativeDeadlineMs: 5000 })) })
        const remote = eventsBoundary({ delivery: () => Effect.succeed({ type: "reservation", status: "reserved", grant }) })
        const run = yield* processEventDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, delivery, event).pipe(Effect.forkScoped)
        yield* Deferred.await(entered); yield* TestClock.adjust("30000 millis"); yield* Deferred.succeed(release, undefined)
        const result = yield* Fiber.join(run)
        assert(result && typeof result === "object" && result.outcome === "failed")
        assert.equal(p.send.requests().length, 0)
        assert.match((publishing.calls.find(c => c.method === "outcome")!.input as C.PublishingOutcomeRequest).claimToken!, /^[a-f0-9]{32}$/)
    })).pipe(Effect.provide(TestClock.layer())))
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${eventNow + 298000} millis`)
        const bot = yield* createTestBot({ token: "synthetic-event-token", rest: { defaultTimeoutMs: 30000 } }), p = native(bot)
        p.send.remove()
        const send = bot.rest.respond("POST /channels/:id/messages", { status: 429, headers: { "retry-after": "3" }, body: { retry_after: 3, global: false, message: "Synthetic wait" } })
        const event = eventDefinition(), grant = eventTimerGrant(event, eventDelivery(), eventNow + 298000), publishing = publishingBoundary()
        addGrant(publishing, grant, eventNow + 298000)
        const remote = eventsBoundary({ delivery: () => Effect.succeed({ type: "reservation", status: "reserved", grant }) })
        const result = yield* processEventDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, eventDelivery(), event)
        assert(result && typeof result === "object" && result.outcome === "uncertain")
        assert.equal(send.requests().length, 1); assert.equal(yield* Clock.currentTimeMillis, eventNow + 298000)
    })).pipe(Effect.provide(TestClock.layer())))
})
test("cancellation claim refusal prevents writes, while terminal work never rediscovers a send", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${eventNow} millis`)
        const bot = yield* createTestBot({ token: "synthetic-event-token" }), p = native(bot), event = eventDefinition(), delivery = eventDelivery(), grant = eventTimerGrant()
        const publishing = publishingBoundary({ dispatch: () => Effect.succeed({ claimed: false, dispatchExpiresAt: grant.dispatchExpiresAt, nativeDeadlineMs: 5000 }) })
        const remote = eventsBoundary({ delivery: () => Effect.succeed({ type: "reservation", status: "reserved", grant }) })
        const result = yield* processEventDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, delivery, event)
        assert(result && typeof result === "object" && !result.acknowledged)
        assert.equal(p.send.requests().length, 0); assert.equal(publishing.calls.some(c => c.method === "outcome"), false)
        for (const state of ["uncertain", "sent", "cancelled", "skipped"] as const) yield* processEventDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, { ...delivery, state }, event)
        assert.equal(p.send.requests().length, 0)
        yield* processEventDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, { ...delivery, dueAt: eventNow + 1 }, event)
        assert.equal(p.send.requests().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})
test("promotion reads the fresh waiter as its own member context, and defers an ambiguous head without skipping other occurrences", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${eventNow} millis`)
        const bot = yield* createTestBot({ token: "synthetic-event-token" }), p = native(bot), event = eventDefinition(), promoted: C.EventsContext[] = [], deferred: C.EventsPromotionBinding[] = []
        const remote = eventsBoundary({ work: input => {
            const op = input.operation
            if (op.type === "claim") return Effect.succeed({ type: "head", claimed: true, binding: head(op, p.targetId), leaseExpiresAt: eventNow + 60000 })
            if (op.type === "promote") promoted.push(op.context)
            if (op.type === "defer") deferred.push(op.binding)
            return Effect.succeed({ type: "progress", recorded: true })
        } })
        yield* processEventPromotion(remote.store, bot.fixtures.ids.guild, bot.client, job(event))
        assert.equal(promoted.length, 1)
        assert.equal(promoted[0]!.actor.userId, p.targetId); assert.equal(promoted[0]!.member!.userId, p.targetId)
        assert.equal(promoted[0]!.member!.canView, false)
        p.target.remove(); bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${p.targetId}`, { status: 403, body: { message: "Synthetic blocked read" } })
        yield* processEventPromotion(remote.store, bot.fixtures.ids.guild, bot.client, job(event))
        assert.equal(deferred.length, 1); assert.equal(promoted.length, 1)
        assert.equal(deferred[0]!.userId, p.targetId); assert.equal(deferred[0]!.queueOrder, 4)
        const listed: C.EventsPromotionJob[] = [job(event), { ...job(event), eventNo: 2 }]
        let claims = 0
        remote.store.work = input => input.operation.type === "list" ? Effect.succeed({ type: "jobs", jobs: [listed[input.operation.cursor ? 1 : 0]!], ...(input.operation.cursor ? {} : { nextCursor: { eventNo: 1, occurrenceNo: 1 } }) }) : input.operation.type === "claim" ? Effect.sync(() => { claims++; return { type: "head", claimed: true, binding: head(input.operation as Extract<C.EventsWorkRequest["operation"], { type: "claim" }>, p.targetId), leaseExpiresAt: eventNow + 60000 } as const }) : Effect.succeed({ type: "progress", recorded: true })
        yield* processEventsPass(remote.store, publishingBoundary().store, bot.fixtures.ids.guild, bot.client)
        assert.equal(claims, 2); assert.equal(p.send.requests().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})
test("member-target cleanup releases only exact recorded fences after typed 404, current rejoin and opaque failures preserve seats", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${eventNow} millis`)
        const bot = yield* createTestBot({ token: "synthetic-event-token" }), p = native(bot), observations: C.EventsWorkRequest["operation"][] = []
        const target: C.EventsMemberTarget = { eventNo: 1, occurrenceNo: 2, revision: 3, generation: 4, userId: p.targetId, joinedAt: "2025-01-01T00:00:00.123456789+00:00", membershipGeneration: 5, rsvpRevision: 6 }
        const remote = eventsBoundary({ work: input => {
            if (input.operation.type === "member-targets") return Effect.succeed({ type: "member-targets", targets: [target], nextCursor: { eventNo: 1, occurrenceNo: 20 } })
            observations.push(input.operation); return Effect.succeed({ type: "progress", recorded: true })
        } })
        const present = yield* processEventsMemberPass(remote.store, bot.fixtures.ids.guild, bot.client, p.targetId)
        assert.equal(present.considered, 0); assert.equal(observations.length, 0)
        p.target.remove(); const absent = bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${p.targetId}`, { status: 404, body: { code: "UNKNOWN_MEMBER", message: "Synthetic absent" } })
        const result = yield* processEventsMemberPass(remote.store, bot.fixtures.ids.guild, bot.client, p.targetId)
        assert.deepEqual(result.nextCursor, { eventNo: 1, occurrenceNo: 20 })
        assert.deepEqual(observations[0], { type: "observe", ...target, originServerId: bot.fixtures.ids.guild, memberAbsent: true, observedAt: eventNow })
        absent.remove(); bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${p.targetId}`, { status: 403, body: { message: "Synthetic denied" } })
        const failed = yield* Effect.exit(processEventsMemberPass(remote.store, bot.fixtures.ids.guild, bot.client, p.targetId))
        assert.equal(failed._tag, "Failure"); assert.equal(observations.length, 1)
    })).pipe(Effect.provide(TestClock.layer())))
})
test("startup uses durable discovery and scoped periodic work has bounded passes with no immediate retry flood", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${eventNow} millis`)
        const first = yield* Deferred.make<void>(), second = yield* Deferred.make<void>(), bot = yield* createTestBot({ token: "synthetic-event-token" }); native(bot)
        let lists = 0
        const remote = eventsBoundary({ delivery: input => Effect.gen(function* () {
            assert.equal(input.operation.type, "list"); lists++
            yield* Deferred.succeed(lists === 1 ? first : second, undefined)
            return { type: "deliveries", deliveries: [] } as const
        }) })
        yield* startEventsWorker(remote.store, publishingBoundary().store, bot.fixtures.ids.guild, bot.client)
        yield* Deferred.await(first); assert.equal(lists, 1)
        yield* TestClock.adjust("59999 millis"); assert.equal(lists, 1)
        yield* TestClock.adjust("1 millis"); yield* Deferred.await(second); assert.equal(lists, 2)
        assert.equal(eventsPassBudget, 20)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("a native request already in flight keeps its actual outcome after cancellation and unknown requests never replay", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${eventNow} millis`)
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), bot = yield* createTestBot({ token: "synthetic-event-token" }), p = native(bot)
        p.send.remove()
        const event = eventDefinition(), grant = eventTimerGrant(), publishing = publishingBoundary()
        addGrant(publishing, grant, eventNow)
        const send = bot.rest.respond("POST /channels/:id/messages", async request => {
            await Effect.runPromise(Deferred.succeed(entered, undefined)); await Effect.runPromise(Deferred.await(release))
            const content = request.body as { content?: string, embeds: { fields: { name: string, value: string, inline?: boolean }[] }[] }
            return { body: bot.fixtures.message({ author: bot.fixtures.botUser(), content: content.content ?? "", embeds: content.embeds.map(e => ({ type: "rich", ...e, fields: e.fields.map(f => ({ ...f, inline: f.inline ?? false })) })) }) }
        })
        const remote = eventsBoundary({ delivery: () => Effect.succeed({ type: "reservation", status: "reserved", grant }) })
        const run = yield* processEventDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, eventDelivery(), event).pipe(Effect.forkScoped)
        yield* Deferred.await(entered); event.state = "cancelled"; yield* Deferred.succeed(release, undefined)
        const result = yield* Fiber.join(run)
        assert(result && typeof result === "object" && result.outcome === "sent")
        assert.equal(send.requests().length, 1); assert.equal(publishing.posts.get(grant.postNo)!.outcome, "sent")
        send.remove(); const unknown = bot.rest.respond("POST /channels/:id/messages", { status: 500, body: { message: "Synthetic unknown" } })
        const other = eventTimerGrant(eventDefinition(), { ...eventDelivery(), deliveryId: "synthetic_other_delivery" })
        other.postNo = 3; other.attemptId = "synthetic_other_attempt"; addGrant(publishing, other, eventNow)
        remote.store.delivery = () => Effect.succeed({ type: "reservation", status: "reserved", grant: other })
        const uncertain = yield* processEventDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, { ...eventDelivery(), deliveryId: "synthetic_other_delivery" }, eventDefinition())
        assert(uncertain && typeof uncertain === "object" && uncertain.outcome === "uncertain")
        assert.equal(unknown.requests().length, 1)
        yield* processEventDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, { ...eventDelivery(), state: "uncertain" }, eventDefinition())
        assert.equal(unknown.requests().length, 1)
        assert.equal(publishing.posts.get(3)!.outcome, "uncertain")
    })).pipe(Effect.provide(TestClock.layer())))
})

test("one worker pass bounds due and promotion work independently and honors the returned lease without native reads", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${eventNow} millis`)
        const bot = yield* createTestBot({ token: "synthetic-event-token" }), p = native(bot), event = eventDefinition()
        let deferred = 0, claimed = 0
        const remote = eventsBoundary({
            delivery: input => input.operation.type === "list" ? Effect.succeed({ type: "deliveries", deliveries: Array.from({ length: 20 }, (_, i) => eventDelivery(event, { deliveryId: `synthetic_${i}` })) })
                : input.operation.type === "show" ? Effect.fail(new EventsStoreError({ operation: "delivery", status: 503 }))
                : Effect.sync(() => { assert.equal(input.operation.type, "defer"); deferred++; return { type: "progress", recorded: true } as const }),
            work: input => input.operation.type === "list" ? Effect.succeed({ type: "jobs", jobs: [{ ...job(event), occurrenceNo: (input.operation.cursor?.occurrenceNo ?? 0) + 1 }], nextCursor: { eventNo: 1, occurrenceNo: (input.operation.cursor?.occurrenceNo ?? 0) + 1 } })
                : input.operation.type === "claim" ? Effect.sync(() => { claimed++; return { type: "head", claimed: false } as const }) : Effect.succeed({ type: "progress", recorded: true }),
        })
        const pass = yield* processEventsPass(remote.store, publishingBoundary().store, bot.fixtures.ids.guild, bot.client)
        assert.equal(pass.considered, eventsPassBudget); assert.equal(deferred, 10); assert.equal(claimed, 10)
        remote.store.work = input => input.operation.type === "claim" ? Effect.succeed({ type: "head", claimed: true, binding: head(input.operation, p.targetId), leaseExpiresAt: eventNow }) : Effect.succeed({ type: "progress", recorded: true })
        yield* processEventPromotion(remote.store, bot.fixtures.ids.guild, bot.client, job(event))
        assert.equal(p.target.requests().length, 0); assert.equal(p.send.requests().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("an in-flight member page cannot block an independent reminder discovery notification", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${eventNow} millis`)
        const first = yield* Deferred.make<void>(), entered = yield* Deferred.make<void>(), resumed = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
        const bot = yield* createTestBot({ token: "synthetic-event-token" }), p = native(bot)
        let calls = 0
        const remote = eventsBoundary({
            delivery: () => Effect.gen(function* () { calls++; yield* Deferred.succeed(calls === 1 ? first : resumed, undefined); return { type: "deliveries", deliveries: [] } as const }),
            work: input => input.operation.type === "member-targets" ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as({ type: "member-targets", targets: [] } as const))
                : Effect.succeed({ type: "jobs", jobs: [] }),
        })
        const worker = yield* startEventsWorker(remote.store, publishingBoundary().store, bot.fixtures.ids.guild, bot.client)
        yield* Deferred.await(first); yield* worker.notifyMember(p.targetId); yield* Deferred.await(entered)
        yield* worker.notify(); yield* Deferred.await(resumed)
        assert.equal(calls, 2); assert.equal(p.send.requests().length, 0)
        yield* Deferred.succeed(release, undefined)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("a fresh bot timeout blocks automatic delivery before reservation or native dispatch", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${eventNow} millis`)
        const bot = yield* createTestBot({ token: "synthetic-event-token" }), p = native(bot), remote = eventsBoundary(), publishing = publishingBoundary()
        p.ownMember.remove(); bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${bot.fixtures.ids.bot}`, { body: bot.fixtures.member({ user: bot.fixtures.botUser(), roles: [p.botRole.id],
            communication_disabled_until: new Date(eventNow + 60000).toISOString() }) })
        const result = yield* Effect.exit(processEventDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, eventDelivery(), eventDefinition()))
        assert.equal(result._tag, "Failure")
        assert.equal(remote.calls.some(c => c.method === "delivery"), false)
        assert.equal(publishing.calls.some(c => c.method === "dispatch"), false)
        assert.equal(p.send.requests().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("startup resumes the same unclaimed reservation once and never replays claimed or uncertain attempts", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${eventNow} millis`)
        const claimed = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
        const bot = yield* createTestBot({ token: "synthetic-event-token" }), p = native(bot)
        const event = eventDefinition(), grant = eventTimerGrant(), publishing = publishingBoundary()
        addGrant(publishing, grant, eventNow)
        const delivery = eventDelivery(event, { state: "reserved", postNo: grant.postNo, attemptId: grant.attemptId })
        let reserves = 0, dispatches = 0
        publishing.store.dispatch = input => Effect.gen(function* () {
            dispatches++
            assert.equal(input.attemptId, grant.attemptId)
            assert.equal(input.postNo, grant.postNo)
            const attempt = publishing.posts.get(grant.postNo)!.attempt
            const owns = attempt.outcome === "pending" && attempt.dispatchedAt === undefined
            if (owns) {
                attempt.dispatchedAt = yield* Clock.currentTimeMillis
                yield* Deferred.succeed(claimed, undefined)
                yield* Deferred.await(release)
            }
            return { claimed: owns, dispatchExpiresAt: grant.dispatchExpiresAt, nativeDeadlineMs: 5000 } as const
        })
        const remote = eventsBoundary({ delivery: input => Effect.sync(() => {
            if (input.operation.type === "list") return { type: "deliveries", deliveries: [delivery] } as const
            if (input.operation.type === "show") return { type: "event", event } as const
            assert.equal(input.operation.type, "reserve")
            assert.deepEqual(input.operation.binding, { deliveryId: delivery.deliveryId, eventNo: delivery.eventNo, occurrenceNo: delivery.occurrenceNo, revision: delivery.revision, offsetMinutes: delivery.offsetMinutes })
            reserves++
            const attempt = publishing.posts.get(grant.postNo)!.attempt
            return attempt.outcome === "pending" && attempt.dispatchedAt === undefined
                ? { type: "reservation", status: "reserved", grant } as const
                : { type: "reservation", status: "terminal" } as const
        }) })
        const first = yield* processEventsPass(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client).pipe(Effect.forkScoped)
        yield* Effect.raceFirst(Deferred.await(claimed), Fiber.join(first))
        assert.equal(dispatches, 1)
        yield* Deferred.await(claimed)
        yield* processEventsPass(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client)
        assert.equal(dispatches, 1)
        assert.equal(p.send.requests().length, 0)
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(first)
        assert.equal(p.send.requests().length, 1)
        assert.equal(publishing.posts.get(grant.postNo)!.outcome, "sent")
        yield* processEventsPass(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client)
        publishing.posts.get(grant.postNo)!.attempt.outcome = "uncertain"
        publishing.posts.get(grant.postNo)!.outcome = "uncertain"
        yield* processEventsPass(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client)
        assert.equal(reserves, 4)
        assert.equal(dispatches, 1)
        assert.equal(p.send.requests().length, 1)
        assert.equal(publishing.calls.some(c => c.method === "manage"), false)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("stale typed absence restarts bounded discovery and refetches membership before releasing the fresh binding", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${eventNow} millis`)
        const rejected = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), cleaned = yield* Deferred.make<void>()
        const bot = yield* createTestBot({ token: "synthetic-event-token" }), p = native(bot)
        p.target.remove()
        const absent = bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${p.targetId}`, { status: 404, body: { code: "UNKNOWN_MEMBER", message: "Synthetic absent" } })
        const old: C.EventsMemberTarget = { eventNo: 1, occurrenceNo: 1, revision: 2, generation: 3, userId: p.targetId, joinedAt: "2026-01-01T00:00:00.000Z", membershipGeneration: 1, rsvpRevision: 2 }
        const fresh = { ...old, generation: 4, rsvpRevision: 3 }
        let discoveries = 0, observations = 0
        const remote = eventsBoundary({ work: input => Effect.gen(function* () {
            const op = input.operation
            if (op.type === "list") return { type: "jobs", jobs: [] } as const
            if (op.type === "member-targets") {
                discoveries++
                assert.equal(op.cursor, undefined)
                return { type: "member-targets", targets: [discoveries === 1 ? old : fresh] } as const
            }
            assert.equal(op.type, "observe")
            observations++
            if (observations === 1) {
                assert.equal(op.generation, old.generation)
                yield* Deferred.succeed(rejected, undefined)
                yield* Deferred.await(release)
                return { type: "progress", recorded: false } as const
            }
            assert.equal(op.generation, fresh.generation)
            assert.equal(op.rsvpRevision, fresh.rsvpRevision)
            assert.equal(absent.requests().length, 2)
            assert.equal(op.observedAt, eventNow + 60000)
            yield* Deferred.succeed(cleaned, undefined)
            return { type: "progress", recorded: true } as const
        }) })
        const worker = yield* startEventsWorker(remote.store, publishingBoundary().store, bot.fixtures.ids.guild, bot.client)
        yield* worker.notifyMember(p.targetId)
        yield* Deferred.await(rejected)
        yield* Deferred.succeed(release, undefined)
        yield* TestClock.adjust("59999 millis")
        assert.equal(discoveries, 1)
        yield* TestClock.adjust("1 millis")
        assert.equal(discoveries, 2)
        yield* Deferred.await(cleaned)
        yield* TestClock.adjust("60 seconds")
        assert.equal(discoveries, 2)
        assert.equal(observations, 2)
        assert.equal(absent.requests().length, 2)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("a newer member hint survives an older rejected pass and a fresh rejoin prevents absence cleanup", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${eventNow} millis`)
        const rejected = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), rejoined = yield* Deferred.make<void>()
        const bot = yield* createTestBot({ token: "synthetic-event-token" }), p = native(bot)
        p.target.remove()
        const absent = bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${p.targetId}`, { status: 404, body: { code: "UNKNOWN_MEMBER", message: "Synthetic absent" } })
        const old: C.EventsMemberTarget = { eventNo: 1, occurrenceNo: 1, revision: 2, generation: 3, userId: p.targetId, joinedAt: "2026-01-01T00:00:00.000Z", membershipGeneration: 1, rsvpRevision: 2 }
        let discoveries = 0, observations = 0
        const remote = eventsBoundary({ work: input => Effect.gen(function* () {
            const op = input.operation
            if (op.type === "list") return { type: "jobs", jobs: [] } as const
            if (op.type === "member-targets") {
                discoveries++
                assert.equal(op.cursor, undefined)
                return { type: "member-targets", targets: [{ ...old, ...(discoveries > 1 ? { generation: 4, membershipGeneration: 2, rsvpRevision: 3, joinedAt: "2026-01-02T00:00:00.000Z" } : {}) }] } as const
            }
            assert.equal(op.type, "observe")
            observations++
            yield* Deferred.succeed(rejected, undefined)
            yield* Deferred.await(release)
            return { type: "progress", recorded: false } as const
        }) })
        const worker = yield* startEventsWorker(remote.store, publishingBoundary().store, bot.fixtures.ids.guild, bot.client)
        yield* worker.notifyMember(p.targetId)
        yield* Deferred.await(rejected)
        absent.remove()
        const present = bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${p.targetId}`, async () => {
            await Effect.runPromise(Deferred.succeed(rejoined, undefined))
            return { body: bot.fixtures.member({ user: bot.fixtures.user({ id: p.targetId }), joined_at: "2026-01-02T00:00:00.000Z" }) }
        })
        yield* worker.notifyMember(p.targetId)
        yield* Deferred.succeed(release, undefined)
        yield* TestClock.adjust("60 seconds")
        assert.equal(discoveries, 2)
        assert.equal(observations, 1)
        assert.equal(present.requests().length, 1)
        assert.equal(p.send.requests().length, 0)
        yield* Deferred.await(rejoined)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("bounded fresh promotion discovery advances beyond 20 ineligible waiters while other occurrences and FIFO keep progressing", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${eventNow} millis`)
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
        const bot = yield* createTestBot({ token: "synthetic-event-token" }), p = native(bot), event = eventDefinition({ calendar: createEventCalendar("2026-01-02T04:00", "UTC", 60) })
        const waiters = Array.from({ length: 26 }, () => bot.fixtures.nextId())
        for (const [index, userId] of waiters.entries()) bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${userId}`, {
            body: bot.fixtures.member({ user: bot.fixtures.user({ id: userId }), roles: [index === 25 ? p.actorRole.id : p.targetRole.id], joined_at: "2026-01-01T00:00:00.000Z" }),
        })
        const opaqueId = bot.fixtures.nextId()
        const opaque = bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${opaqueId}`, { status: 403, body: { message: "Synthetic opaque read" } })
        const states = Array.from({ length: 24 }, (_, index) => ({ occurrenceNo: index + 1, generation: 3, after: 0, nextCheckAt: eventNow, active: true,
            users: index === 0 ? waiters : index === 1 ? [opaqueId, waiters[25]!] : [waiters[25]!] }))
        const firstQueue: number[] = [], promoted: number[] = [], deferred: number[] = []
        let discoveries = 0, claims = 0
        const remote = eventsBoundary({ work: input => Effect.gen(function* () {
            const op = input.operation, now = yield* Clock.currentTimeMillis
            if (op.type === "list") {
                discoveries++
                const page = states.filter(s => s.occurrenceNo > (op.cursor?.occurrenceNo ?? 0)).slice(0, op.limit ?? 20)
                const last = page.at(-1)
                return { type: "jobs", jobs: page.filter(row => row.active && row.nextCheckAt <= now).map(row => ({ ...job(event), occurrenceNo: row.occurrenceNo, generation: row.generation, nextCheckAt: row.nextCheckAt })),
                    ...(last && last.occurrenceNo < states.length ? { nextCursor: { eventNo: 1, occurrenceNo: last.occurrenceNo } } : {}) } as const
            }
            if (op.type === "claim") {
                claims++
                const row = states[op.occurrenceNo - 1]!
                assert.equal(op.generation, row.generation, "Each claim must rediscover the current generation")
                assert.equal(row.active, true)
                const userId = row.users[row.after]!
                return { type: "head", claimed: true, binding: { ...head(op, userId), queueOrder: row.after + 1 }, leaseExpiresAt: now + 60000 } as const
            }
            if (op.type === "defer") {
                const row = states[op.binding.occurrenceNo - 1]!
                assert.equal(row.occurrenceNo, 2)
                assert.equal(op.binding.queueOrder, 1)
                row.nextCheckAt = now + 60000
                deferred.push(row.occurrenceNo)
                return { type: "progress", recorded: true } as const
            }
            assert.equal(op.type, "promote")
            const row = states[op.binding.occurrenceNo - 1]!
            assert.equal(op.binding.generation, row.generation)
            assert.equal(op.binding.queueOrder, row.after + 1)
            if (row.occurrenceNo === 1) {
                firstQueue.push(op.binding.queueOrder)
                if (row.after === 0) {
                    yield* Deferred.succeed(entered, undefined)
                    yield* Deferred.await(release)
                }
            }
            row.generation++
            if (!op.context.member!.canView) {
                row.after++
                return { type: "progress", recorded: true, promoted: false } as const
            }
            row.active = false
            promoted.push(row.occurrenceNo)
            return { type: "progress", recorded: true, promoted: true } as const
        }) })
        const first = yield* processEventsPass(remote.store, publishingBoundary().store, bot.fixtures.ids.guild, bot.client).pipe(Effect.forkScoped)
        yield* Effect.raceFirst(Deferred.await(entered), Fiber.join(first))
        yield* Deferred.await(entered)
        yield* Deferred.succeed(release, undefined)
        let result = yield* Fiber.join(first)
        assert.equal(result.considered, 10)
        assert(promoted.some(n => n > 2))
        const passLimit = Math.ceil(states.length / (eventsPassBudget / 2)) * waiters.length
        for (let pass = 1; pass < passLimit && states[0]!.active; pass++) {
            yield* TestClock.adjust("60 seconds")
            const before = claims, scans = discoveries
            result = yield* processEventsPass(remote.store, publishingBoundary().store, bot.fixtures.ids.guild, bot.client, result.promotionCursor)
            assert(result.considered <= 10)
            assert(claims - before <= 10)
            assert(discoveries - scans <= 10)
        }
        assert.equal(states[0]!.active, false, JSON.stringify({ firstQueue, promoted, deferred, claims, discoveries }))
        assert.deepEqual(firstQueue, Array.from({ length: 26 }, (_, i) => i + 1))
        assert.equal(promoted.length, 23)
        assert.equal(promoted.includes(2), false)
        assert.equal(states[1]!.after, 0)
        assert.equal(opaque.requests().length, deferred.length)
        assert.equal(p.send.requests().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("the scoped worker retains promotion continuation across pulses instead of starving occurrences beyond the first page", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${eventNow} millis`)
        const first = yield* Deferred.make<void>(), second = yield* Deferred.make<void>(), third = yield* Deferred.make<void>()
        const bot = yield* createTestBot({ token: "synthetic-event-token" }); native(bot)
        const claimed: number[] = []
        const remote = eventsBoundary({ work: input => Effect.gen(function* () {
            const op = input.operation
            if (op.type === "list") {
                const occurrenceNo = (op.cursor?.occurrenceNo ?? 0) + 1
                return { type: "jobs", jobs: [{ ...job(), occurrenceNo }], ...(occurrenceNo < 24 ? { nextCursor: { eventNo: 1, occurrenceNo } } : {}) } as const
            }
            assert.equal(op.type, "claim")
            claimed.push(op.occurrenceNo)
            if (claimed.length === 10) yield* Deferred.succeed(first, undefined)
            if (claimed.length === 20) yield* Deferred.succeed(second, undefined)
            if (op.occurrenceNo === 24) yield* Deferred.succeed(third, undefined)
            return { type: "head", claimed: false } as const
        }) })
        yield* startEventsWorker(remote.store, publishingBoundary().store, bot.fixtures.ids.guild, bot.client)
        yield* Deferred.await(first)
        yield* TestClock.adjust("60 seconds")
        yield* Deferred.await(second)
        assert.deepEqual(claimed, Array.from({ length: 20 }, (_, i) => i + 1))
        yield* TestClock.adjust("60 seconds")
        yield* Deferred.await(third)
        assert.deepEqual(claimed.slice(0, 24), Array.from({ length: 24 }, (_, i) => i + 1))
    })).pipe(Effect.provide(TestClock.layer())))
})

test("definite ineligibility and typed removal continue to the next FIFO waiter with fresh generations in the same bounded pass", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${eventNow} millis`)
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
        const bot = yield* createTestBot({ token: "synthetic-event-token" }), p = native(bot)
        const absentId = bot.fixtures.nextId(), eligibleId = bot.fixtures.nextId()
        const absent = bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${absentId}`, { status: 404, body: { code: "UNKNOWN_MEMBER", message: "Synthetic absent" } })
        bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${eligibleId}`, { body: bot.fixtures.member({ user: bot.fixtures.user({ id: eligibleId }), roles: [p.actorRole.id], joined_at: "2026-01-01T00:00:00.000Z" }) })
        const users = [p.targetId, absentId, eligibleId], generations: number[] = []
        let generation = 3, index = 0, allocated = false
        const remote = eventsBoundary({ work: input => Effect.gen(function* () {
            const op = input.operation
            if (op.type === "list") return { type: "jobs", jobs: allocated ? [] : [{ ...job(), generation }] } as const
            if (op.type === "claim") {
                assert.equal(op.generation, generation)
                generations.push(op.generation)
                return { type: "head", claimed: true, binding: { ...head(op, users[index]!), queueOrder: index + 1 }, leaseExpiresAt: eventNow + 60000 } as const
            }
            if (op.type === "observe") {
                assert.equal(index, 1)
                assert.equal(op.userId, absentId)
                assert.equal(op.generation, generation)
                assert.equal(absent.requests().length, 1)
                generation++
                index++
                return { type: "progress", recorded: true } as const
            }
            assert.equal(op.type, "promote")
            assert.equal(op.binding.generation, generation)
            assert.equal(op.binding.userId, users[index])
            if (index === 0) {
                assert.equal(op.context.member!.canView, false)
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(release)
            } else {
                assert.equal(index, 2)
                assert.equal(op.context.member!.canView, true)
                allocated = true
            }
            generation++
            index++
            return { type: "progress", recorded: true, promoted: allocated } as const
        }) })
        const run = yield* processEventsPass(remote.store, publishingBoundary().store, bot.fixtures.ids.guild, bot.client).pipe(Effect.forkScoped)
        yield* Effect.raceFirst(Deferred.await(entered), Fiber.join(run))
        yield* Deferred.succeed(release, undefined)
        const result = yield* Fiber.join(run)
        assert.equal(allocated, true)
        assert.equal(result.considered, 3)
        assert.deepEqual(generations, [3, 4, 5])
        assert.equal(p.send.requests().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})
