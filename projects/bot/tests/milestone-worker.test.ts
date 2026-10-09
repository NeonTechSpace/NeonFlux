import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Deferred, Effect, Fiber, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { processMilestoneDelivery } from "../src/milestones.ts"
import { processMilestonesPass, startMilestonesWorker } from "../src/milestone-worker.ts"
import { observeMilestoneDeparture } from "../src/milestone-events.ts"
import { platform } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { milestoneDelivery, milestoneEpoch, milestoneGrant, milestoneNow, milestonesBoundary } from "./milestone-fixture.ts"

const controlled = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))
function native(bot: Effect.Success<ReturnType<typeof createTestBot>>) {
    const p = platform(bot, { targetPermissions: Permissions.ViewChannel | Permissions.ReadMessageHistory })
    p.target.remove()
    bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${p.targetId}`, { body: bot.fixtures.member({ user: bot.fixtures.user({ id: p.targetId }), roles: [p.targetRole.id], joined_at: milestoneEpoch, communication_disabled_until: null }) })
    p.replies.remove()
    const send = bot.rest.respond("POST /channels/:id/messages", request => {
        const body = request.body as { content?: string, embeds?: object[] }
        return { body: bot.fixtures.message({ channel_id: request.path.split("/")[2], author: bot.fixtures.botUser(), content: body.content ?? "", embeds: body.embeds?.map(e => ({ type: "rich", color: 0, ...e })) ?? [] }) }
    })
    return { ...p, send }
}
test("milestone admitted ready row ignores future rescan and uses separate bot automation and participant dispatch proof", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${milestoneNow} millis`)
        const bot = yield* createTestBot({ token: "synthetic-milestone-token" }), p = native(bot), d = milestoneDelivery({ userId: p.targetId, nextCheckAt: milestoneNow + 60000 }), g = milestoneGrant(d), publishing = publishingBoundary()
        publishing.posts.set(g.postNo, { postNo: g.postNo, generation: g.generation, botId: g.botId, channelId: g.channelId, outcome: "pending", createdAt: milestoneNow, updatedAt: milestoneNow, consumer: g.consumer, attempt: { ...g, outcome: "pending", createdAt: milestoneNow } })
        const remote = milestonesBoundary({ delivery: input => {
            assert.equal(input.operation.type, "reserve")
            if (input.operation.type === "reserve") {
                assert.equal(input.operation.context.automation.botId, g.botId)
                assert.equal(input.operation.context.participant.member.userId, p.targetId)
                assert.equal(input.operation.context.participant.member.joinedAt, milestoneEpoch)
                assert.equal(input.operation.context.automation.channelId, d.channelId)
            }
            return Effect.succeed({ type: "reservation", status: "reserved", grant: g })
        } })
        const result = yield* processMilestoneDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, d)
        assert(result && typeof result === "object" && "outcome" in result && result.outcome === "sent")
        const claim = publishing.calls.find(c => c.method === "dispatch")!.input as C.PublishingDispatchRequest
        assert.equal(claim.milestoneContext!.automation.botId, g.botId)
        assert.equal(claim.milestoneContext!.participant.member.userId, p.targetId)
        assert.equal(claim.eventContext, undefined); assert.equal(claim.scheduleContext, undefined)
        assert.deepEqual((p.send.requests()[0]!.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        for (const state of ["sent", "uncertain", "failed", "cancelled", "superseded", "skipped"] as const) yield* processMilestoneDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, { ...d, state })
        yield* processMilestoneDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, { ...d, claimedAt: milestoneNow })
        assert.equal(p.send.requests().length, 1)
    }))
})
test("milestone expiry is checked immediately after one-time claim with no native dispatch", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${milestoneNow + 270000} millis`)
        const bot = yield* createTestBot({ token: "synthetic-milestone-token" }), p = native(bot), d = milestoneDelivery({ userId: p.targetId }), g = milestoneGrant(d, milestoneNow + 270000), entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
        const publishing = publishingBoundary({ dispatch: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as({ claimed: true, dispatchExpiresAt: g.dispatchExpiresAt, nativeDeadlineMs: 5000 })) })
        const remote = milestonesBoundary({ delivery: () => Effect.succeed({ type: "reservation", status: "reserved", grant: g }) })
        const run = yield* processMilestoneDelivery(remote.store, publishing.store, bot.fixtures.ids.guild, bot.client, d).pipe(Effect.forkScoped)
        yield* Deferred.await(entered); yield* TestClock.adjust("180000 millis"); yield* Deferred.succeed(release, undefined)
        const result = yield* Fiber.join(run)
        assert(result && typeof result === "object" && "outcome" in result && result.outcome === "failed")
        assert.equal(p.send.requests().length, 0)
        assert.equal((publishing.calls.find(c => c.method === "outcome")!.input as C.PublishingOutcomeRequest).outcome, "failed")
    }))
})
test("member404 revokes before owner evaluation while opaque errors defer and fairness cursor advances", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${milestoneNow} millis`)
        const bot = yield* createTestBot({ token: "synthetic-milestone-token" }), f = bot.fixtures, seen: C.MilestonesDeliveryRequest[] = []
        const self = bot.rest.respond("GET /users/@me", { body: f.botUser() })
        bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { status: 404, body: { message: "Synthetic absent" } })
        const other = f.nextId()
        bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${other}`, { status: 403, body: { message: "Synthetic opaque" } })
        const remote = milestonesBoundary({ delivery: input => {
            seen.push(input)
            return Effect.succeed(input.operation.type === "list" ? { type: "deliveries", deliveries: [milestoneDelivery(), milestoneDelivery({ deliveryId: "synthetic_other", userId: other })], hasMore: true, nextCursor: { cursor: "synthetic_next", throughAt: milestoneNow } } : { type: "progress", recorded: true })
        } })
        const result = yield* processMilestonesPass(remote.store, publishingBoundary().store, f.ids.guild, bot.client)
        assert.equal(result.considered, 2); assert.equal(result.nextCursor!.cursor, "synthetic_next")
        assert.equal(seen.filter(r => r.operation.type === "membership").length, 1)
        assert.equal(seen.filter(r => r.operation.type === "defer").length, 1)
        assert(!seen.some(r => r.operation.type === "reserve"))
        assert.equal(self.requests().length, 0)
    }))
})
test("departure is a hint and exact current epoch suppresses removal while submillisecond epoch change revokes", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${milestoneNow} millis`)
        const bot = yield* createTestBot({ token: "synthetic-milestone-token" }), f = bot.fixtures, seen: C.MilestonesDeliveryRequest[] = []
        const target: C.MilestonesMemberTarget = { kind: "birthday", userId: f.ids.user, joinedAt: milestoneEpoch, consentRevision: 2, consentedAt: milestoneNow - 100 }
        const remote = milestonesBoundary({ delivery: input => {
            seen.push(input)
            return Effect.succeed(input.operation.type === "member-targets" ? { type: "member-targets", targets: [target], hasMore: false } : { type: "progress", recorded: true, hasMore: false })
        } })
        const path = `GET /guilds/${f.ids.guild}/members/${f.ids.user}`
        bot.rest.respond(path, { body: f.member({ joined_at: milestoneEpoch, communication_disabled_until: null }) })
        assert.equal((yield* observeMilestoneDeparture(remote.store, f.ids.guild, bot.client, f.ids.user)).considered, 0)
        bot.rest.respond(path, { body: f.member({ joined_at: "2020-01-02T00:00:00.123456788Z", communication_disabled_until: null }) })
        assert.equal((yield* observeMilestoneDeparture(remote.store, f.ids.guild, bot.client, f.ids.user)).considered, 1)
        const op = seen.find(r => r.operation.type === "member-observation")!.operation
        assert(op.type === "member-observation"); assert.deepEqual(op.target, target)
        assert(op.observation.status === "present"); assert.equal(op.observation.joinedAt, "2020-01-02T00:00:00.123456788Z")
    }))
})
test("scoped milestone worker makes no request until woken, then follows a continuation without waiting", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${milestoneNow} millis`)
        const bot = yield* createTestBot({ token: "synthetic-milestone-token" }), first = yield* Deferred.make<void>(), second = yield* Deferred.make<void>(), cursors: (C.MilestonesDeliveryCursor | undefined)[] = []
        const remote = milestonesBoundary({ delivery: input => Effect.gen(function* () {
            assert.equal(input.operation.type, "list"); if (input.operation.type !== "list") return { type: "progress", recorded: false } as const
            cursors.push(input.operation.cursor)
            yield* Deferred.succeed(cursors.length === 1 ? first : second, undefined)
            return { type: "deliveries", deliveries: [], hasMore: cursors.length === 1, ...(cursors.length === 1 ? { nextCursor: { cursor: "synthetic_continue", throughAt: milestoneNow } } : {}) } as const
        }) })
        const worker = yield* startMilestonesWorker(remote.store, publishingBoundary().store, bot.fixtures.ids.guild, bot.client)
        yield* TestClock.adjust("1 hour"); assert.deepEqual(cursors, [])
        yield* worker.notify(); yield* Deferred.await(first); yield* Deferred.await(second)
        assert.deepEqual(cursors, [undefined, { cursor: "synthetic_continue", throughAt: milestoneNow }]); assert.equal(yield* Clock.currentTimeMillis, milestoneNow + 3600000)
    }))
})
test("participant loss during final authorization confirms typed absence and closes consent before publishing claim", async () => {
    for (const status of [404, 403]) await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${milestoneNow} millis`)
        const bot = yield* createTestBot({ token: "synthetic-milestone-token" }), p = native(bot), f = bot.fixtures, d = milestoneDelivery({ userId: p.targetId }), g = milestoneGrant(d), publishing = publishingBoundary()
        let reads = 0
        bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => {
            reads++
            return reads < 3 ? { body: f.member({ user: f.user({ id: p.targetId }), roles: [p.targetRole.id], joined_at: milestoneEpoch, communication_disabled_until: null }) }
                : { status, body: { message: "Synthetic unavailable participant" } }
        })
        const seen: C.MilestonesDeliveryRequest[] = []
        const remote = milestonesBoundary({ delivery: input => {
            seen.push(input)
            return Effect.succeed(input.operation.type === "reserve" ? { type: "reservation", status: "reserved", grant: g } : { type: "progress", recorded: true, hasMore: false })
        } })
        const result = yield* processMilestoneDelivery(remote.store, publishing.store, f.ids.guild, bot.client, d)
        assert(result && typeof result === "object" && "outcome" in result && result.outcome === "failed")
        assert.equal(reads, 4)
        assert.equal(seen.filter(r => r.operation.type === "membership").length, status === 404 ? 1 : 0)
        assert.equal(publishing.calls.some(c => c.method === "dispatch"), false)
        assert.equal(p.send.requests().length, 0)
    }))
})
