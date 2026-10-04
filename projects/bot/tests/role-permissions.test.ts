import assert from "node:assert/strict"
import test from "node:test"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createTestClient, type TestClient } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { readRoleAuthority, RolePermissionError, targetedReactionPresent } from "../src/role-permissions.ts"
import { readSafetyAuthority } from "../src/safety-permissions.ts"

function routes(native: TestClient) {
    const f = native.fixtures
    const actorRole = f.role({ position: 2, permissions: "0" })
    const botRole = f.role({ position: 20, permissions: Permissions.ManageRoles.toString() })
    const selected = f.role({ position: 5, permissions: Permissions.ViewChannel.toString() })
    const joinedAt = "2026-10-01T12:00:00.123456Z"
    const ownerId = f.nextId()
    const everyone = f.role({ id: f.ids.guild, permissions: "0" })
    native.rest.respond("GET /users/@me", { body: f.botUser() })
    native.rest.respond(`GET /guilds/${f.ids.guild}`, { body: f.guild({ owner_id: ownerId }) })
    native.rest.respond(`GET /guilds/${f.ids.guild}/roles`, { body: [everyone, actorRole, botRole, selected] })
    native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: f.member({ roles: [actorRole.id], joined_at: joinedAt }) })
    native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.bot}`, { body: f.member({ user: f.botUser(), roles: [botRole.id] }) })
    return { f, actorRole, botRole, selected, everyone, joinedAt, ownerId }
}

test("self-service uses fresh bot rank without requiring actor role-management power and retains the exact epoch", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f, selected, joinedAt } = routes(native)
        const result = yield* readRoleAuthority(native.client, f.ids.guild, f.ids.user, { roleIds: [selected.id] })
        assert.equal(result.joinedAt, joinedAt)
        assert.equal(result.target.userId, f.ids.user)
        assert.equal(result.targetPresent, true)
        assert.equal(result.botCanManageTarget, true)
        assert.equal(result.targetProtected, false)
        assert(result.eligibleRoleIds.includes(selected.id))
        assert.equal(result.roleSnapshots.find(role => role.roleId === selected.id)?.actorCanManage, false)
        assert.equal(result.roleSnapshots.find(role => role.roleId === selected.id)?.botCanManage, true)
        assert(native.requests().every(request => request.method === "GET"))
    })))
})

test("configuration enforces actor role rank while owner role assignment checks the selected role rank", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f, selected } = routes(native)
        const rejected = yield* Effect.exit(readRoleAuthority(native.client, f.ids.guild, f.ids.user, { roleIds: [selected.id], configuration: true }))
        assert(Exit.isFailure(rejected))
        native.rest.respond(`GET /guilds/${f.ids.guild}`, { body: f.guild({ owner_id: f.ids.user }) })
        const accepted = yield* readRoleAuthority(native.client, f.ids.guild, f.ids.user, { roleIds: [selected.id], configuration: true })
        assert(accepted.isOwner)
        assert(accepted.eligibleRoleIds.includes(selected.id))
        const selfGrant = yield* readRoleAuthority(native.client, f.ids.guild, f.ids.user, { roleIds: [selected.id] })
        assert.equal(selfGrant.botPermissionAuthorized, true)
        assert(selfGrant.eligibleRoleIds.includes(selected.id))
        const moderationAuthority = yield* readSafetyAuthority(native.client, f.ids.guild, f.ids.user, { targetId: f.ids.user })
        assert.equal(moderationAuthority.botCanManageTarget, false)
        assert.equal(moderationAuthority.targetProtected, true)
    })))
})

test("everyone, privileged bits, unknown bits and inaccessible role rank are rejected through native wire snapshots", async () => {
    for (const invalid of ["everyone", "privileged", "unknown", "rank"] as const) await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f, actorRole, botRole, selected, everyone } = routes(native)
        const role = f.role({ id: selected.id, position: invalid === "rank" ? 21 : 5,
            permissions: (invalid === "privileged" ? Permissions.ManageRoles : invalid === "unknown" ? 1n << 63n : 0n).toString() })
        native.rest.respond(`GET /guilds/${f.ids.guild}/roles`, { body: [everyone, actorRole, botRole, role] })
        const result = yield* Effect.exit(readRoleAuthority(native.client, f.ids.guild, f.ids.user, { roleIds: [invalid === "everyone" ? f.ids.guild : selected.id] }))
        assert(Exit.isFailure(result), invalid)
        assert(result.cause.reasons.some(reason => reason._tag === "Fail" && reason.error instanceof RolePermissionError))
    })))
})

test("success is not cached across bot permission or membership changes and member rank does not replace role rank", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f, actorRole, botRole, selected, everyone } = routes(native)
        yield* readRoleAuthority(native.client, f.ids.guild, f.ids.user, { roleIds: [selected.id] })
        native.rest.respond(`GET /guilds/${f.ids.guild}/roles`, { body: [everyone, actorRole, selected, f.role({ id: botRole.id, position: 20, permissions: "0" })] })
        assert(Exit.isFailure(yield* Effect.exit(readRoleAuthority(native.client, f.ids.guild, f.ids.user))))
        native.rest.respond(`GET /guilds/${f.ids.guild}/roles`, { body: [everyone, actorRole, botRole, selected] })
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: f.member({ roles: [botRole.id] }) })
        const equalRank = yield* readRoleAuthority(native.client, f.ids.guild, f.ids.user, { roleIds: [selected.id] })
        assert.equal(equalRank.botPermissionAuthorized, true)
        assert(equalRank.eligibleRoleIds.includes(selected.id))
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { status: 404, body: { message: "Synthetic private missing member" } })
        const missing = yield* Effect.exit(readRoleAuthority(native.client, f.ids.guild, f.ids.user))
        assert(Exit.isFailure(missing))
        assert(!JSON.stringify(missing).includes("Synthetic private"))
    })))
})

test("bot target opt-in is explicit and never authorizes a bot actor", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f, selected } = routes(native)
        const targetId = f.nextId()
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${targetId}`, { body: f.member({ user: f.botUser({ id: targetId }), roles: [] }) })
        assert(Exit.isFailure(yield* Effect.exit(readRoleAuthority(native.client, f.ids.guild, f.ids.user, { targetId }))))
        const accepted = yield* readRoleAuthority(native.client, f.ids.guild, f.ids.user, { targetId, roleIds: [selected.id], allowBotTarget: true })
        assert.equal(accepted.target.isBot, true)
        assert.equal(accepted.target.userId, targetId)
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: f.member({ user: f.botUser({ id: f.ids.user }), roles: [] }) })
        assert(Exit.isFailure(yield* Effect.exit(readRoleAuthority(native.client, f.ids.guild, f.ids.user, { targetId, allowBotTarget: true }))))
    })))
})

test("read-only inspection exposes revoked permission and protected target facts without granting write authority", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f, actorRole, botRole, selected, everyone } = routes(native)
        native.rest.respond(`GET /guilds/${f.ids.guild}/roles`, { body: [everyone, actorRole, selected,
            f.role({ id: botRole.id, position: 20, permissions: "0" })] })
        native.rest.respond(`GET /guilds/${f.ids.guild}`, { body: f.guild({ owner_id: f.ids.user }) })
        const observed = yield* readRoleAuthority(native.client, f.ids.guild, f.ids.user, { readOnly: true })
        assert.equal(observed.targetPresent, true)
        assert.equal(observed.isOwner, true)
        assert.equal(observed.botPermissionAuthorized, false)
        assert.deepEqual(observed.eligibleRoleIds, [])
        assert(Exit.isFailure(yield* Effect.exit(readRoleAuthority(native.client, f.ids.guild, f.ids.user))))
        assert(Exit.isFailure(yield* Effect.exit(readRoleAuthority(native.client, f.ids.guild, f.ids.user, { readOnly: true, roleIds: [selected.id] }))))
        assert(native.requests().every(request => request.method === "GET"))
    })))
})

test("authenticated bot identity cannot become a human actor when the native wire bot flag is omitted", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f, botRole } = routes(native)
        const { bot: _bot, ...omitted } = f.botUser()
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.bot}`, { body: f.member({ user: omitted, roles: [botRole.id] }) })
        assert(Exit.isFailure(yield* Effect.exit(readRoleAuthority(native.client, f.ids.guild, f.ids.bot, { readOnly: true, allowBotTarget: true }))))
        assert(Exit.isFailure(yield* Effect.exit(readRoleAuthority(native.client, f.ids.guild, f.ids.user, { targetId: f.ids.bot, readOnly: true }))))
        const observed = yield* readRoleAuthority(native.client, f.ids.guild, f.ids.user, { targetId: f.ids.bot, readOnly: true, allowBotTarget: true })
        assert.equal(observed.target.isBot, true)
        assert.equal(observed.target.userId, observed.botId)
        assert(native.requests().every(request => request.method === "GET"))
    })))
})

test("reaction presence uses one numeric targeted page for Unicode and custom emoji, including the smallest ID", async () => {
    for (const [emoji, userId, returnedId] of [["👍", "10", "10"], ["<:approved:20>", "10", "11"], ["👍", "1", "1"]] as const) {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const native = yield* createTestClient({ logging: { level: "silent" } })
            const f = native.fixtures
            const route = native.rest.respond(request => new URL(request.url).pathname.endsWith("/users"),
                { body: { items: [{ id: returnedId, username: "Synthetic reactor" }], has_more: false, next_after: null } })
            const result = yield* targetedReactionPresent(native.client, { id: f.message().id, channelId: f.ids.channel }, emoji, userId)
            assert.equal(result, returnedId === userId)
            assert.equal(route.requests().length, 1)
            const url = new URL(route.requests()[0]!.url)
            assert.equal(url.searchParams.get("limit"), "1")
            assert.equal(url.searchParams.get("after"), userId === "1" ? null : "9")
            assert(url.pathname.includes(emoji.startsWith("<") ? "approved%3A20" : encodeURIComponent(emoji)))
            assert.equal(native.requests().length, 1)
        })))
    }
})

test("a blocked targeted reaction read has a controlled five-second bound and malformed IDs never dispatch", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ rest: { defaultTimeoutMs: 10_000 }, logging: { level: "silent" } })
        const entered = Deferred.makeUnsafe<void>()
        const released = Deferred.makeUnsafe<void>()
        const route = native.rest.respond(request => new URL(request.url).pathname.endsWith("/users"), () => Effect.runPromise(Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(released)
            return { body: { items: [], has_more: false, next_after: null } }
        })))
        const fiber = yield* Effect.forkChild(targetedReactionPresent(native.client, { id: native.fixtures.message().id, channelId: native.fixtures.ids.channel }, "👍", "10"))
        yield* Deferred.await(entered)
        yield* TestClock.adjust("5 seconds")
        assert(Exit.isFailure(yield* Fiber.await(fiber)))
        assert.equal(route.requests().length, 1)
        assert(native.requests().every(request => request.method === "GET"))
        yield* Deferred.succeed(released, undefined)
        const malformed = yield* Effect.exit(targetedReactionPresent(native.client, { id: native.fixtures.message().id, channelId: native.fixtures.ids.channel }, "👍", "not-an-id"))
        assert(Exit.isFailure(malformed))
        assert.equal(native.requests().length, 1)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("interrupting a targeted reaction check cannot reach a subsequent native role write", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const entered = Deferred.makeUnsafe<void>()
        const released = Deferred.makeUnsafe<void>()
        const f = native.fixtures
        native.rest.respond(request => new URL(request.url).pathname.endsWith("/users"), () => Effect.runPromise(Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(released)
            return { body: { items: [{ id: "10", username: "Synthetic reactor" }], has_more: false, next_after: null } }
        })))
        const write = native.rest.respond(`PUT /guilds/${f.ids.guild}/members/${f.ids.user}/roles/20`, { status: 204 })
        const fiber = yield* Effect.forkChild(targetedReactionPresent(native.client, { id: f.message().id, channelId: f.ids.channel }, "👍", "10")
            .pipe(Effect.andThen(native.client.members.addRole({ guildId: f.ids.guild, userId: f.ids.user }, "20"))))
        yield* Deferred.await(entered)
        yield* Fiber.interrupt(fiber)
        yield* Deferred.succeed(released, undefined)
        assert(Exit.isFailure(yield* Fiber.await(fiber)))
        assert.equal(write.requests().length, 0)
    })))
})
