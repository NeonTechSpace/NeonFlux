import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Deferred, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { processRoleReactionJob } from "../src/role-reconciliation.ts"
import { boundary, token } from "./moderation-fixture.ts"
import { rolesBoundary } from "./roles-fixture.ts"
import { greetingsBoundary } from "./welcome-fixture.ts"
import { nativeRoles, savedPanel } from "./roles-native-fixture.ts"

test("cleared reaction jobs persist blocked unknown targets while later targets and pages progress", async () => {
    const f = createFixtures(), remote = rolesBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
        const p = nativeRoles(bot), panel = savedPanel(bot, p, remote); remote.current.panelsEnabled = true
        const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt
        const users = [p.targetId, bot.fixtures.nextId(), bot.fixtures.nextId()], membership = new Map(users.map((id) => [id, new Set([p.targetRole.id, p.role.id])]))
        p.target.remove()
        for (const userId of users) bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${userId}`, () => ({ body: f.member({ user: f.user({ id: userId }),
            joined_at: joinedAt, roles: [...membership.get(userId)!], communication_disabled_until: null }) }))
        p.remove.remove()
        const remove = bot.rest.respond("DELETE /guilds/:id/members/:id/roles/:id", (request) => {
            const userId = request.path.split("/")[4]!
            if (userId === users[0]) return { status: 403, body: { message: "Synthetic unconfirmed provider rejection" } }
            membership.get(userId)!.delete(p.role.id); return { status: 204 }
        })
        bot.rest.respond((r) => new URL(r.url).pathname.endsWith("/users"), { body: { items: [], has_more: false, next_after: null } })
        let page = 0, unresolved = false
        const job: C.RolesReactionJob = { jobId: "synthetic_job", name: panel.name, revision: panel.revision, messageId: panel.published!.messageId,
            channelId: f.ids.channel, generation: 0, pageStep: 0, status: "queued", rerun: false }
        remote.store.reactionJobs = (input) => Effect.gen(function* () {
            remote.calls.push({ method: "reactionJobs", input }); const op = input.operation
            if (op.type === "claim") {
                job.generation++; job.pageStep++; job.status = "running"; job.leaseExpiresAt = (yield* Clock.currentTimeMillis) + 600000
                const targets = (page === 0 ? users.slice(0, 2) : users.slice(2)).map((userId, index) => ({ userId, joinedAt,
                    sourceId: `job_${job.jobId}_${job.generation}_${job.pageStep}_${index}` }))
                return { type: "page", claimed: true, job: { ...job }, targets, hasMore: page === 0 }
            }
            if (op.type === "block") { unresolved = true; assert.equal(op.binding.index, 0); return { type: "job", job: { ...job } } }
            assert.equal(op.type, "checkpoint")
            if (op.type !== "checkpoint") throw new Error("Synthetic checkpoint expected")
            assert.equal(op.generation, job.generation); assert.equal(op.pageStep, job.pageStep)
            assert.equal(op.blocked, page === 0)
            job.status = page++ === 0 ? "queued" : unresolved ? "blocked" : "complete"
            return { type: "job", job: { ...job } }
        })
        yield* bot.ready()
        const result = yield* processRoleReactionJob(remote.store, f.ids.guild, bot.client, job.jobId)
        assert.equal(result.status, "blocked"); assert.equal(page, 2)
        assert.equal(remove.requests().length, 3)
        assert.equal(membership.get(users[0]!)!.has(p.role.id), true)
        for (const userId of users.slice(1)) assert.deepEqual([...membership.get(userId)!], [p.targetRole.id])
        const first = [...remote.attempts.values()].find((a) => a.userId === users[0])
        assert.equal(first?.outcome, "uncertain")
        const evaluated = remote.calls.filter((c) => c.method === "evaluate").map((c) => c.input as C.RolesEvaluateRequest)
        assert.equal(evaluated.every((r) => r.reactionJob?.jobId === job.jobId && /^[a-f0-9]{32}$/.test(r.reactionJob.claimToken)), true)
        assert.equal(evaluated.filter((r) => r.context.userId === users[0]).length, 1)
    })))
})

for (const expiryAlreadyReached of [false, true]) test(`startup resumes a saved running page ${expiryAlreadyReached ? "when its lease expires during the claim response" : "at exactly the old lease expiry"}`, async () => {
    const f = createFixtures(), remote = rolesBoundary(), moderation = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const entered = yield* Deferred.make<void>(), completed = yield* Deferred.make<void>(), returnClaim = yield* Deferred.make<void>()
        const job: C.RolesReactionJob = { jobId: "synthetic_resumed", name: "colors", revision: 1, messageId: f.nextId(), channelId: f.ids.channel,
            generation: 1, pageStep: 1, status: "running", rerun: false, leaseExpiresAt: 600000 }
        let claims = 0
        remote.store.reactionJobs = (input) => Effect.gen(function* () {
            remote.calls.push({ method: "reactionJobs", input }); const op = input.operation
            if (op.type === "list") return { type: "jobs", jobs: [{ ...job }] }
            if (op.type === "claim") {
                claims++
                if (claims === 1) {
                    yield* Deferred.succeed(entered, undefined)
                    if (expiryAlreadyReached) yield* Deferred.await(returnClaim)
                    return { type: "page", claimed: false, job: { ...job } }
                }
                assert.equal(yield* Clock.currentTimeMillis, 600000)
                job.generation = 2; job.pageStep = 2; job.leaseExpiresAt = 1200000
                return { type: "page", claimed: true, job: { ...job }, targets: [], hasMore: false }
            }
            assert.equal(op.type, "checkpoint"); job.status = "complete"; yield* Deferred.succeed(completed, undefined)
            return { type: "job", job: { ...job } }
        })
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, roles: remote.store }))
        nativeRoles(bot); yield* bot.ready(); yield* Deferred.await(entered)
        assert.equal(claims, 1)
        yield* TestClock.adjust("600000 millis")
        if (expiryAlreadyReached) yield* Deferred.succeed(returnClaim, undefined)
        yield* Deferred.await(completed)
        assert.equal(claims, 2); assert.equal(job.status, "complete")
    })).pipe(Effect.provide(TestClock.layer())))
})

for (const eventName of ["MESSAGE_REACTION_REMOVE_ALL", "MESSAGE_REACTION_REMOVE_EMOJI"] as const) test(`${eventName} resumes bounded known consumers through the native gateway entry point${eventName === "MESSAGE_REACTION_REMOVE_EMOJI" ? " with greeting hooks" : ""}`, { timeout: 10000 }, async () => {
    const f = createFixtures(), remote = rolesBoundary(), moderation = boundary(), greetings = eventName === "MESSAGE_REACTION_REMOVE_EMOJI" ? greetingsBoundary() : undefined
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const completed = yield* Deferred.make<void>()
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, roles: remote.store, greetings: greetings?.store }))
        const p = nativeRoles(bot), panel = savedPanel(bot, p, remote); remote.current.panelsEnabled = true; p.roleIds.add(p.role.id)
        const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt
        bot.rest.respond((request) => new URL(request.url).pathname.endsWith("/users"), { body: { items: [], has_more: false, next_after: null } })
        const job: C.RolesReactionJob = { jobId: "synthetic_gateway_job", name: panel.name, revision: panel.revision, messageId: panel.published!.messageId,
            channelId: f.ids.channel, generation: 1, pageStep: 1, status: "queued", rerun: false }
        remote.store.reactionJobs = (input) => Effect.gen(function* () {
            remote.calls.push({ method: "reactionJobs", input }); const op = input.operation
            if (op.type === "list") return { type: "jobs", jobs: [] }
            if (op.type === "enqueue") { assert.equal(op.messageId, job.messageId); return { type: "job", job: { ...job } } }
            if (op.type === "claim") {
                job.status = "running"; job.leaseExpiresAt = (yield* Clock.currentTimeMillis) + 600000
                return { type: "page", claimed: true, job: { ...job }, hasMore: false,
                    targets: [{ userId: p.targetId, joinedAt, sourceId: `job_${job.jobId}_1_1_0` }] }
            }
            assert.equal(op.type, "checkpoint")
            if (op.type !== "checkpoint") throw new Error("Synthetic checkpoint expected")
            assert.equal(op.blocked, false); job.status = "complete"; yield* Deferred.succeed(completed, undefined)
            return { type: "job", job: { ...job } }
        })
        yield* bot.ready()
        const event = { guild_id: f.ids.guild, channel_id: f.ids.channel, message_id: job.messageId, emoji: { name: "✅" } }
        yield* bot.emit(eventName, { ...event, guild_id: bot.fixtures.nextId() }); yield* bot.idle()
        assert.equal(remote.calls.some((call) => call.method === "reactionJobs" && (call.input as C.RolesReactionJobsRequest).operation.type === "enqueue"), false)
        yield* bot.emit(eventName, event); yield* bot.idle(); yield* Deferred.await(completed)
        assert.equal(p.remove.requests().length, 1); assert.equal(p.roleIds.has(p.role.id), false); assert.equal(p.roleIds.has(p.targetRole.id), true)
        assert.equal(remote.calls.filter((call) => call.method === "evaluate").every((call) => (call.input as C.RolesEvaluateRequest).reactionJob?.jobId === job.jobId), true)
    })))
})

test("a cancelled current panel job stops before any member or native role operation", async () => {
    const f = createFixtures(), remote = rolesBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = nativeRoles(bot)
        const job: C.RolesReactionJob = { jobId: "synthetic_cancelled", name: "retired", revision: 4, messageId: bot.fixtures.nextId(), channelId: f.ids.channel,
            generation: 2, pageStep: 1, status: "cancelled", rerun: false }
        remote.store.reactionJobs = (input) => { assert.equal(input.operation.type, "claim"); return Effect.succeed({ type: "job", job }) }
        yield* bot.ready()
        const stopped = yield* processRoleReactionJob(remote.store, f.ids.guild, bot.client, job.jobId)
        assert.equal(stopped.status, "cancelled"); assert.equal(p.target.requests().length, 0)
        assert.equal(p.add.requests().length, 0); assert.equal(p.remove.requests().length, 0)
    })))
})
