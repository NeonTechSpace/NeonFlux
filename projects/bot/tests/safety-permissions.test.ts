import assert from "node:assert/strict"
import test from "node:test"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createTestClient, type TestClient } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Deferred, Effect, Exit, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { readSafetyAuthority, SafetyPermissionError } from "../src/safety-permissions.ts"

function authorityRoutes(client: TestClient) {
    const f = client.fixtures
    const actorRole = f.role({ position: 10, permissions: Permissions.Administrator.toString() })
    const botRole = f.role({ position: 20, permissions: Permissions.Administrator.toString() })
    const targetId = f.nextId()
    const responses: [string, unknown][] = [
        ["GET /users/@me", f.botUser()],
        [`GET /guilds/${f.ids.guild}`, f.guild({ owner_id: f.ids.user })],
        [`GET /guilds/${f.ids.guild}/roles`, [f.role({ id: f.ids.guild, permissions: "0" }), actorRole, botRole]],
        [`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, f.member({ roles: [actorRole.id], communication_disabled_until: null })],
        [`GET /guilds/${f.ids.guild}/members/${f.ids.bot}`, f.member({ user: f.botUser(), roles: [botRole.id], communication_disabled_until: null })],
        [`GET /channels/${f.ids.channel}`, f.channel()],
        [`GET /guilds/${f.ids.guild}/members/${targetId}`, f.member({ user: f.user({ id: targetId }), roles: [], communication_disabled_until: null })],
    ]
    const gates = responses.map(([path, body]) => {
        const entered = Deferred.makeUnsafe<void>()
        const release = Deferred.makeUnsafe<void>()
        const route = client.rest.respond(path, () => Effect.runPromise(Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            return { body }
        })))
        return { entered, release, route }
    })
    return { gates, targetId }
}

test("fresh native authority reads may exceed five seconds in total while each remains bounded", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ rest: { concurrency: 1, defaultTimeoutMs: 10_000 }, logging: { level: "silent" } })
        const { gates, targetId } = authorityRoutes(native)
        const startedAt = yield* Clock.currentTimeMillis
        const fiber = yield* Effect.forkChild(readSafetyAuthority(native.client, native.fixtures.ids.guild, native.fixtures.ids.user,
            { permission: Permissions.ModerateMembers, targetId, channelId: native.fixtures.ids.channel }))
        for (const gate of gates) {
            const next = yield* Effect.raceFirst(Deferred.await(gate.entered).pipe(Effect.as("request" as const)), Fiber.await(fiber).pipe(Effect.as("finished" as const)))
            assert.equal(next, "request", "The complete authority check must not time out while individual reads remain bounded")
            yield* TestClock.adjust("2 seconds")
            yield* Deferred.succeed(gate.release, undefined)
        }
        const result = yield* Fiber.join(fiber)
        assert.equal(result.actorId, native.fixtures.ids.user)
        assert.equal(result.target?.userId, targetId)
        assert.equal(result.actorCanManageTarget, true)
        assert.equal(result.botCanManageTarget, true)
        assert.equal((yield* Clock.currentTimeMillis) - startedAt, 14_000)
        assert(gates.every(gate => gate.route.requests().length === 1))
    })).pipe(Effect.provide(TestClock.layer())))
})

for (const [label, sdkDeadline, advance] of [
    ["one blocked native read fails at the five-second safety deadline", 10_000, "5 seconds"],
    ["a shorter configured native SDK deadline remains effective", 1_000, "1 second"],
] as const) test(label, async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ rest: { concurrency: 1, defaultTimeoutMs: sdkDeadline }, logging: { level: "silent" } })
        const { gates } = authorityRoutes(native)
        const first = gates[0]!
        const fiber = yield* Effect.forkChild(readSafetyAuthority(native.client, native.fixtures.ids.guild, native.fixtures.ids.user))
        yield* Deferred.await(first.entered)
        yield* TestClock.adjust(advance)
        const result = yield* Fiber.await(fiber)
        assert(Exit.isFailure(result))
        assert(result.cause.reasons.some(reason => reason._tag === "Fail" && reason.error._tag === "SafetyPermissionError" && reason.error.stage === "permissions"))
        const reason = result.cause.reasons.find(reason => reason._tag === "Fail")
        assert(reason?._tag === "Fail")
        assert.deepEqual({ operation: reason.error.operation, kind: reason.error.kind, failureClass: reason.error.failureClass },
            { operation: "self", kind: "timeout", failureClass: sdkDeadline === 1_000 ? "UserOperationError" : "TimeoutError" })
        assert.equal(first.route.requests().length, 1)
        assert(gates.slice(1).every(gate => gate.route.requests().length === 0))
        yield* Deferred.succeed(first.release, undefined)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("a native rate-limit delay beyond the authorization budget retains fixed fields without another request", { timeout: 10_000 }, async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ rest: { concurrency: 1, defaultTimeoutMs: 5_000 }, logging: { level: "silent" } })
        const privateBody = "Synthetic private provider body"
        const route = native.rest.respond("GET /users/@me", { status: 429, headers: { "Retry-After": "61" },
            body: { retry_after: 61, global: false, message: privateBody } })
        const startedAt = yield* Clock.currentTimeMillis
        const result = yield* Effect.exit(readSafetyAuthority(native.client, native.fixtures.ids.guild, native.fixtures.ids.user))
        assert(Exit.isFailure(result))
        const reason = result.cause.reasons.find(reason => reason._tag === "Fail")
        assert(reason?._tag === "Fail" && reason.error instanceof SafetyPermissionError)
        assert.deepEqual({ operation: reason.error.operation, kind: reason.error.kind, failureClass: reason.error.failureClass, status: reason.error.status },
            { operation: "self", kind: "rateLimit", failureClass: "UserOperationError", status: 429 })
        assert.equal(reason.error.retryAfterMs, 61000)
        assert.equal(JSON.stringify(reason.error).includes(privateBody), false)
        assert.equal(route.requests().length, 1)
        assert.equal(native.requests().length, 1)
        assert.equal(yield* Clock.currentTimeMillis, startedAt)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("a provider-directed read wait refreshes the full volatile authorization before exposing permissions", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const rateLimited = Deferred.makeUnsafe<void>()
        const native = yield* createTestClient({ rest: { concurrency: 1, defaultTimeoutMs: 5000 }, logging: { level: "silent" } })
        const { gates, targetId } = authorityRoutes(native)
        for (const gate of gates) yield* Deferred.succeed(gate.release, undefined)
        const f = native.fixtures
        const ordinaryOwner = f.nextId()
        native.rest.respond(`GET /guilds/${f.ids.guild}`, { body: f.guild({ owner_id: ordinaryOwner }) })
        let attempts = 0
        const target = native.rest.respond(`GET /guilds/${f.ids.guild}/members/${targetId}`, () => {
            if (++attempts === 1) {
                Effect.runSync(Deferred.succeed(rateLimited, undefined))
                return { status: 429, headers: { "Retry-After": "6" }, body: { retry_after: 6, global: false, message: "Synthetic private 429 response" } }
            }
            return { body: f.member({ user: f.user({ id: targetId }), roles: [], communication_disabled_until: null }) }
        })
        const startedAt = yield* Clock.currentTimeMillis
        const fiber = yield* Effect.forkChild(readSafetyAuthority(native.client, f.ids.guild, f.ids.user,
            { permission: Permissions.ModerateMembers, targetId, channelId: f.ids.channel }))
        yield* Deferred.await(rateLimited)
        yield* TestClock.adjust(5999)
        assert.equal(target.requests().length, 1, "No early manual retry is permitted")
        assert.equal(gates[2]!.route.requests().length, 1)
        const downgraded = f.role({ permissions: "0", position: 1 })
        const refreshedRoles = native.rest.respond(`GET /guilds/${f.ids.guild}/roles`, { body: [f.role({ id: f.ids.guild, permissions: "0" }), downgraded] })
        const refreshedActor = native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: f.member({ roles: [downgraded.id], communication_disabled_until: null }) })
        const refreshedBot = native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.bot}`, { body: f.member({ user: f.botUser(), roles: [], communication_disabled_until: null }) })
        yield* TestClock.adjust(1)
        const authority = yield* Fiber.join(fiber)
        assert.equal((yield* Clock.currentTimeMillis) - startedAt, 6000)
        assert.equal(authority.nativePermissionAuthorized, false)
        assert.equal(authority.botPermissionAuthorized, false)
        assert(authority.roleIds.includes(downgraded.id))
        assert.equal(gates[0]!.route.requests().length, 2, "Before READY each authorization reads the bot identity")
        assert.equal(target.requests().length, 2)
        assert.equal(refreshedRoles.requests().length, 1)
        assert.equal(refreshedActor.requests().length, 1)
        assert.equal(refreshedBot.requests().length, 1)
        assert.equal(gates[5]!.route.requests().length, 2)
        const paths = native.requests().map(request => new URL(request.url).pathname)
        assert.equal(paths.filter(path => path.endsWith(`/guilds/${f.ids.guild}`)).length, 2)
        assert(native.requests().every(request => request.method === "GET"))
    })).pipe(Effect.provide(TestClock.layer())))
})

test("a repeated native 429 escapes the single authorization wait and prevents later dispatch", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const limited = Deferred.makeUnsafe<void>()
        const native = yield* createTestClient({ rest: { concurrency: 1, defaultTimeoutMs: 5000 }, logging: { level: "silent" } })
        const { gates } = authorityRoutes(native)
        for (const gate of gates) yield* Deferred.succeed(gate.release, undefined)
        const actor = native.rest.respond(`GET /guilds/${native.fixtures.ids.guild}/members/${native.fixtures.ids.user}`, () => {
            Effect.runSync(Deferred.succeed(limited, undefined))
            return { status: 429, headers: { "Retry-After": "6" }, body: { retry_after: 6, global: false } }
        })
        const write = native.rest.respond(`POST /channels/${native.fixtures.ids.channel}/messages`, { body: native.fixtures.message() })
        const startedAt = yield* Clock.currentTimeMillis
        const fiber = yield* Effect.forkChild(readSafetyAuthority(native.client, native.fixtures.ids.guild, native.fixtures.ids.user).pipe(
            Effect.andThen(native.client.messages.send(native.fixtures.ids.channel, { content: "Synthetic dispatch must remain unreachable" }))))
        yield* Deferred.await(limited)
        yield* TestClock.adjust("6 seconds")
        const result = yield* Fiber.await(fiber)
        assert(Exit.isFailure(result))
        const reason = result.cause.reasons.find(reason => reason._tag === "Fail")
        assert(reason?._tag === "Fail" && reason.error instanceof SafetyPermissionError)
        assert.deepEqual({ operation: reason.error.operation, kind: reason.error.kind, status: reason.error.status, retryAfterMs: reason.error.retryAfterMs },
            { operation: "actor", kind: "rateLimit", status: 429, retryAfterMs: 6000 })
        assert.equal((yield* Clock.currentTimeMillis) - startedAt, 6000)
        assert.equal(actor.requests().length, 2)
        assert.equal(write.requests().length, 0)
        assert.equal(gates[4]!.route.requests().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("a missing provider delay and network failure never start an application authorization retry", async () => {
    for (const failure of ["missing-delay", "network"] as const) await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ rest: { concurrency: 1, defaultTimeoutMs: 1 }, logging: { level: "silent" } })
        const { gates } = authorityRoutes(native)
        const rejected = native.rest.respond("GET /users/@me", () => {
            if (failure === "network") throw new Error("Synthetic private network failure")
            return { status: 429, body: { message: "Synthetic private unknown cooldown" } }
        })
        const startedAt = yield* Clock.currentTimeMillis
        const result = yield* Effect.exit(readSafetyAuthority(native.client, native.fixtures.ids.guild, native.fixtures.ids.user))
        assert(Exit.isFailure(result))
        const reason = result.cause.reasons.find(reason => reason._tag === "Fail")
        assert(reason?._tag === "Fail" && reason.error instanceof SafetyPermissionError)
        assert.equal(reason.error.kind, failure === "network" ? "network" : "rateLimit")
        assert.equal(reason.error.retryAfterMs, undefined)
        assert.equal(rejected.requests().length, 1)
        assert(gates.every(gate => gate.route.requests().length === 0))
        assert.equal(yield* Clock.currentTimeMillis, startedAt)
        assert.equal(JSON.stringify(reason.error).includes("Synthetic private"), false)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("the sixty-second provider wait boundary is accepted once and cancellation cannot start its refresh", async () => {
    for (const interrupted of [false, true]) await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const limited = Deferred.makeUnsafe<void>()
        const native = yield* createTestClient({ rest: { concurrency: 1, defaultTimeoutMs: 5000 }, logging: { level: "silent" } })
        const { gates } = authorityRoutes(native)
        for (const gate of gates) yield* Deferred.succeed(gate.release, undefined)
        let attempts = 0
        const self = native.rest.respond("GET /users/@me", () => {
            if (++attempts === 1) {
                Effect.runSync(Deferred.succeed(limited, undefined))
                return { status: 429, headers: { "Retry-After": "60" }, body: { retry_after: 60, global: false } }
            }
            return { body: native.fixtures.botUser() }
        })
        const startedAt = yield* Clock.currentTimeMillis
        const fiber = yield* Effect.forkChild(readSafetyAuthority(native.client, native.fixtures.ids.guild, native.fixtures.ids.user))
        yield* Deferred.await(limited)
        yield* TestClock.adjust(59999)
        assert.equal(self.requests().length, 1)
        if (interrupted) yield* Fiber.interrupt(fiber)
        yield* TestClock.adjust(1)
        const result = yield* Fiber.await(fiber)
        assert.equal((yield* Clock.currentTimeMillis) - startedAt, 60000)
        if (interrupted) {
            assert(Exit.isFailure(result))
            assert.equal(self.requests().length, 1)
            assert(gates.slice(1).every(gate => gate.route.requests().length === 0))
        } else {
            assert(Exit.isSuccess(result))
            assert.equal(self.requests().length, 2)
            assert(gates.slice(1, 5).every(gate => gate.route.requests().length === 1))
        }
    })).pipe(Effect.provide(TestClock.layer())))
})

test("the typed absent-target 404 path remains available without discarding other target failures", async () => {
    for (const allowAbsentTarget of [true, false]) await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { gates, targetId } = authorityRoutes(native)
        for (const gate of gates) yield* Deferred.succeed(gate.release, undefined)
        const privateBody = "Synthetic private missing-member detail"
        const absent = native.rest.respond(`GET /guilds/${native.fixtures.ids.guild}/members/${targetId}`,
            { status: 404, body: { code: "UNKNOWN_MEMBER", message: privateBody } })
        const result = yield* Effect.exit(readSafetyAuthority(native.client, native.fixtures.ids.guild, native.fixtures.ids.user,
            { targetId, allowAbsentTarget }))
        if (allowAbsentTarget) {
            assert(Exit.isSuccess(result))
            assert.equal(result.value.targetPresent, false)
            assert.equal(result.value.target, undefined)
        } else {
            assert(Exit.isFailure(result))
            const reason = result.cause.reasons.find(reason => reason._tag === "Fail")
            assert(reason?._tag === "Fail")
            assert.deepEqual({ operation: reason.error.operation, kind: reason.error.kind, failureClass: reason.error.failureClass, status: reason.error.status },
                { operation: "target", kind: "notFound", failureClass: "GuildOperationError", status: 404 })
            assert.equal(JSON.stringify(reason.error).includes(privateBody), false)
        }
        assert.equal(absent.requests().length, 1)
    })))
})

test("each authorization observes permission and membership changes", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { gates } = authorityRoutes(native)
        for (const gate of gates) yield* Deferred.succeed(gate.release, undefined)
        const f = native.fixtures
        const ownerId = f.nextId()
        native.rest.respond(`GET /guilds/${f.ids.guild}`, { body: f.guild({ owner_id: ownerId }) })
        const first = yield* readSafetyAuthority(native.client, f.ids.guild, f.ids.user, { permission: Permissions.ModerateMembers })
        assert.equal(first.nativePermissionAuthorized, true)
        const ordinaryRole = f.role({ position: 1, permissions: "0" })
        native.rest.respond(`GET /guilds/${f.ids.guild}/roles`, { body: [f.role({ id: f.ids.guild, permissions: "0" }), ordinaryRole] })
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: f.member({ roles: [ordinaryRole.id], communication_disabled_until: null }) })
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.bot}`, { body: f.member({ user: f.botUser(), roles: [], communication_disabled_until: null }) })
        const second = yield* readSafetyAuthority(native.client, f.ids.guild, f.ids.user, { permission: Permissions.ModerateMembers })
        assert.equal(second.botId, first.botId)
        assert.equal(second.nativePermissionAuthorized, false)
        assert.equal(second.botPermissionAuthorized, false)
        assert(second.roleIds.includes(ordinaryRole.id))
        const paths = native.requests().map(request => new URL(request.url).pathname)
        assert.equal(paths.filter(path => path.endsWith("/users/@me")).length, 2)
        for (const suffix of [`/guilds/${f.ids.guild}`, `/guilds/${f.ids.guild}/roles`, `/guilds/${f.ids.guild}/members/${f.ids.user}`, `/guilds/${f.ids.guild}/members/${f.ids.bot}`]) {
            assert.equal(paths.filter(path => path.endsWith(suffix)).length, 2)
        }
    })))
})

test("authenticated identities are isolated between clients", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const other = yield* createTestClient({ logging: { level: "silent" } })
        const first = authorityRoutes(native)
        const second = authorityRoutes(other)
        for (const gate of [...first.gates, ...second.gates]) yield* Deferred.succeed(gate.release, undefined)
        const otherId = other.fixtures.nextId()
        const otherSelf = other.rest.respond("GET /users/@me", { body: other.fixtures.botUser({ id: otherId }) })
        other.rest.respond(`GET /guilds/${other.fixtures.ids.guild}/members/${otherId}`, { body: other.fixtures.member({ user: other.fixtures.botUser({ id: otherId }), roles: [], communication_disabled_until: null }) })
        const a = yield* readSafetyAuthority(native.client, native.fixtures.ids.guild, native.fixtures.ids.user)
        const b = yield* readSafetyAuthority(other.client, other.fixtures.ids.guild, other.fixtures.ids.user)
        assert.equal(a.botId, native.fixtures.ids.bot)
        assert.equal(b.botId, otherId)
        assert.notEqual(a.botId, b.botId)
        assert.equal(first.gates[0]!.route.requests().length, 1)
        assert.equal(otherSelf.requests().length, 1)
    })))
})

test("an unsuccessful bot identity lookup is not cached for the next authorization", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { gates } = authorityRoutes(native)
        for (const gate of gates) yield* Deferred.succeed(gate.release, undefined)
        const rejected = native.rest.respond("GET /users/@me", { status: 403, body: { message: "Synthetic private rejected lookup" } })
        const failed = yield* Effect.exit(readSafetyAuthority(native.client, native.fixtures.ids.guild, native.fixtures.ids.user))
        assert(Exit.isFailure(failed))
        assert.equal(rejected.requests().length, 1)
        assert(gates.slice(1).every(gate => gate.route.requests().length === 0))
        const accepted = native.rest.respond("GET /users/@me", { body: native.fixtures.botUser() })
        const authority = yield* readSafetyAuthority(native.client, native.fixtures.ids.guild, native.fixtures.ids.user)
        assert.equal(authority.botId, native.fixtures.ids.bot)
        assert.equal(accepted.requests().length, 1)
        assert(gates.slice(1, 5).every(gate => gate.route.requests().length === 1))
    })))
})
