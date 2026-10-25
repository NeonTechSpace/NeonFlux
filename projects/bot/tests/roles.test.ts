import assert from "node:assert/strict"
import test from "node:test"
import type {
    RolesClaim,
    RolesDispatchRequest,
    RolesEvaluateOperation,
    RolesEvaluateRequest,
    RolesGrant,
    RolesManageOperation,
    RolesManageRequest,
    RolesQueryRequest,
    RolesReactionJob,
    RolesReactionJobsRequest,
    RolesWithdrawal,
} from "@neonflux/contracts/roles"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Deferred, Effect, Fiber, Logger, type Types } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { parseRoleCommand } from "../src/role-command.ts"
import {
    backgroundRoleWork,
    evaluateRoleRequest,
    memberRoleWork,
    performRoleGrant,
    verifyRolePanel,
    withRoleMember,
} from "../src/roles.ts"
import { handleRoleReaction } from "../src/roles.ts"
import { RolesStoreError } from "../src/roles-store.ts"
import { boundary, token } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { rolesBoundary } from "./roles-fixture.ts"
import { nativeRoles, savedPanel } from "./roles-native-fixture.ts"

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
type Body = {
    content?: string
    embeds?: {
        title?: string
        description?: string
        fields?: { name: string; value: string }[]
        footer?: { text: string }
    }[]
}
const emit = (bot: Bot, content: string, userId = bot.fixtures.ids.user) =>
    bot
        .emit("MESSAGE_CREATE", bot.fixtures.message({ content, author: bot.fixtures.user({ id: userId }) }))
        .pipe(Effect.andThen(bot.idle()))

test("role panel snapshots compare rich color and text, so color or text drift is rejected", async (t) => {
    for (const scenario of [
        { name: "Default color matches zero", expected: 0, color: 0, title: "Rules", accepted: true },
        { name: "Matching nonzero is valid", expected: 4023992, color: 4023992, title: "Rules", accepted: true },
        { name: "Nonzero mismatch is rejected", expected: 4023992, color: 0, title: "Rules", accepted: false },
        { name: "Text drift is rejected", expected: 0, color: 0, title: "Changed", accepted: false },
    ])
        await t.test(scenario.name, async () => {
            const remote = rolesBoundary()
            await Effect.runPromise(
                Effect.scoped(
                    Effect.gen(function* () {
                        const bot = yield* createTestBot({ token: "synthetic-color-token" }),
                            p = nativeRoles(bot),
                            panel = savedPanel(bot, p, remote)
                        panel.published!.content = {
                            content: "Rules",
                            embed: { title: "Rules", color: scenario.expected },
                        }
                        p.messages.set(
                            panel.published!.messageId,
                            bot.fixtures.message({
                                id: panel.published!.messageId,
                                author: bot.fixtures.botUser(),
                                content: "Rules",
                                embeds: [{ type: "rich", title: scenario.title, color: scenario.color }],
                            }),
                        )
                        const original = structuredClone(panel.published)
                        const checked = yield* verifyRolePanel(
                            bot.client,
                            bot.fixtures.ids.guild,
                            bot.fixtures.ids.user,
                            panel,
                        ).pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }))
                        assert.equal(checked, scenario.accepted)
                        assert.deepEqual(panel.published, original)
                        assert.equal(p.add.requests().length, 0)
                        assert.equal(p.remove.requests().length, 0)
                    }),
                ),
            )
        })
})
test("native reaction additions and removals read current targeted presence and ignore other messages", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot),
                    panel = savedPanel(bot, p, remote)
                remote.current.panelsEnabled = true
                let present = true
                const reactions = bot.rest.respond(
                    (request) => new URL(request.url).pathname.endsWith("/users"),
                    () => ({
                        body: {
                            items: present ? [{ id: p.targetId, username: "Synthetic reactor" }] : [],
                            has_more: false,
                            next_after: null,
                        },
                    }),
                )
                yield* bot.ready()
                const event = {
                    guild_id: f.ids.guild,
                    channel_id: f.ids.channel,
                    message_id: panel.published!.messageId,
                    user_id: p.targetId,
                    emoji: { name: "✅" },
                }
                yield* bot.emit("MESSAGE_REACTION_ADD", event)
                yield* bot.idle()
                assert.equal(p.roleIds.has(p.role.id), true)
                present = false
                yield* bot.emit("MESSAGE_REACTION_REMOVE", event)
                yield* bot.idle()
                assert.equal(p.roleIds.has(p.role.id), false)
                assert.equal(reactions.requests().length, 2)
                for (const request of reactions.requests()) {
                    const url = new URL(request.url)
                    assert.equal(url.searchParams.get("limit"), "1")
                    assert.equal(url.searchParams.get("after"), (BigInt(p.targetId) - 1n).toString())
                }
                yield* bot.emit("MESSAGE_REACTION_ADD", { ...event, message_id: f.nextId() })
                yield* bot.idle()
                assert.equal(reactions.requests().length, 2)
                assert.equal(p.add.requests().length, 1)
                assert.equal(remote.calls.filter((c) => c.method === "evaluate").length, 4)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("rejoining with a retained current rules reaction acknowledges the new exact epoch before autorole", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot),
                    panel = savedPanel(bot, p, remote, "verification")
                remote.current.verificationEnabled = true
                remote.current.autoroleEnabled = true
                remote.current.autoroleIds = [p.second.id]
                const joinedAt = new Date(yield* Clock.currentTimeMillis).toISOString().replace(/Z$/, "4567Z")
                p.target.remove()
                bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({
                    body: f.member({
                        user: f.user({ id: p.targetId }),
                        joined_at: joinedAt,
                        roles: [...p.roleIds],
                        communication_disabled_until: null,
                    }),
                }))
                bot.rest.respond((request) => new URL(request.url).pathname.endsWith("/users"), {
                    body: {
                        items: [{ id: p.targetId, username: "Returning member" }],
                        has_more: false,
                        next_after: null,
                    },
                })
                yield* bot.ready()
                yield* bot.emit("GUILD_MEMBER_ADD", {
                    ...f.member({ user: f.user({ id: p.targetId }), joined_at: joinedAt }),
                    guild_id: f.ids.guild,
                })
                yield* bot.idle()
                const evaluated = remote.calls
                    .filter((c) => c.method === "evaluate")
                    .map((c) => c.input as RolesEvaluateRequest)
                assert.equal(evaluated[0]?.operation.type, "verify")
                assert.equal(evaluated.findIndex((c) => c.operation.type === "join") > 0, true)
                assert.equal(
                    evaluated.every((c) => c.context.joinedAt === joinedAt),
                    true,
                )
                assert.equal(
                    (evaluated[0]?.operation as Extract<RolesEvaluateOperation, { type: "verify" }>).messageId,
                    panel.published!.messageId,
                )
                assert.equal(p.roleIds.has(p.role.id), true)
                assert.equal(p.roleIds.has(p.second.id), true)
                assert.equal(p.roleIds.has(p.targetRole.id), true)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

// The line of background role work is held until the test releases it. The node timeout only guards a hang
test(
    "The autoroles a verification unlocks wait as background role work, so the join's event and the events after it never wait for them",
    { timeout: 60000 },
    async () => {
        const f = createFixtures(),
            remote = rolesBoundary(),
            moderation = boundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions(
                            { token, serverId: f.ids.guild },
                            { moderation: moderation.store, roles: remote.store },
                        ),
                    )
                    const p = nativeRoles(bot),
                        gate = yield* Deferred.make<void>(),
                        answered = yield* Deferred.make<void>()
                    savedPanel(bot, p, remote, "verification")
                    remote.current.verificationEnabled = true
                    remote.current.autoroleEnabled = true
                    remote.current.autoroleIds = [p.second.id]
                    // As the backend does, a verification with nothing left to give answers acknowledged
                    const evaluate = remote.store.evaluate
                    remote.store.evaluate = (input) =>
                        evaluate(input).pipe(
                            Effect.map((result) =>
                                input.operation.type === "verify" &&
                                result.status === "unchanged" &&
                                result.acknowledgment.acknowledged
                                    ? { ...result, status: "acknowledged" as const }
                                    : result,
                            ),
                        )
                    const joinedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
                    p.target.remove()
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({
                        body: f.member({
                            user: f.user({ id: p.targetId }),
                            joined_at: joinedAt,
                            roles: [...p.roleIds],
                            communication_disabled_until: null,
                        }),
                    }))
                    bot.rest.respond((request) => new URL(request.url).pathname.endsWith("/users"), {
                        body: {
                            items: [{ id: p.targetId, username: "Returning member" }],
                            has_more: false,
                            next_after: null,
                        },
                    })
                    p.send.remove()
                    bot.rest.respond("POST /channels/:id/messages", (request) => {
                        Deferred.doneUnsafe(answered, Effect.void)
                        return { body: f.message({ channel_id: request.path.split("/")[2], author: f.botUser() }) }
                    })
                    yield* bot.ready()
                    yield* backgroundRoleWork(bot.client, f.ids.guild, Deferred.await(gate))
                    yield* bot.emit("GUILD_MEMBER_ADD", {
                        ...f.member({ user: f.user({ id: p.targetId }), joined_at: joinedAt }),
                        guild_id: f.ids.guild,
                    })
                    // The server's events run one at a time, so this command's answer comes after the join's event finished
                    yield* bot.emit("MESSAGE_CREATE", f.message({ content: "!autorole status" }))
                    yield* Deferred.await(answered)
                    assert.equal(p.roleIds.has(p.role.id), true)
                    assert.equal(p.roleIds.has(p.second.id), false)
                    yield* Deferred.succeed(gate, undefined)
                    yield* bot.idle()
                    assert.equal(p.roleIds.has(p.second.id), true)
                    // The verification's autoroles and the join's own pass each ran under a source of their own
                    const sources = new Set(
                        remote.calls
                            .filter(
                                (c) =>
                                    c.method === "evaluate" &&
                                    (c.input as RolesEvaluateRequest).operation.type === "join",
                            )
                            .map((c) => (c.input as RolesEvaluateRequest).sourceId.split("_")[0]),
                    )
                    assert.deepEqual(sources, new Set(["autorole", "join"]))
                    assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
                }),
            ),
        )
    },
)

test("Autorole reservation commands configure absent user IDs without fetching targets and keep native roles additive", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot),
                    absentId = f.nextId()
                const absent = bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${absentId}`, { status: 404 })
                yield* bot.ready()
                yield* emit(bot, `!autorole reserve ${absentId} <@&${p.role.id}> <@&${p.second.id}>`)
                assert.deepEqual(remote.current.reservations, [{ userId: absentId, roleIds: [p.role.id, p.second.id] }])
                yield* emit(bot, "!autorole reservations")
                assert.equal(absent.requests().length, 0)
                assert.equal(p.add.requests().length, 0)
                yield* emit(bot, `!autorole unreserve ${absentId}`)
                assert.deepEqual(remote.current.reservations, [])
                assert.equal(p.remove.requests().length, 0)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("Native joins apply all forty default and reserved roles using individual SDK writes while preserving existing roles", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot),
                    roles = Array.from({ length: 40 }, () => bot.fixtures.role({ position: 2, permissions: "0" }))
                bot.rest.respond("GET /guilds/:id/roles", { body: [...p.roles, p.role, p.second, ...roles] })
                remote.current.autoroleEnabled = true
                remote.current.autoroleIds = roles.slice(0, 20).map((role) => role.id)
                remote.current.reservations = [{ userId: p.targetId, roleIds: roles.slice(20).map((role) => role.id) }]
                const joinedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
                p.target.remove()
                bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({
                    body: f.member({
                        user: f.user({ id: p.targetId }),
                        joined_at: joinedAt,
                        roles: [...p.roleIds],
                        communication_disabled_until: null,
                    }),
                }))
                yield* bot.ready()
                yield* bot.emit("GUILD_MEMBER_ADD", {
                    ...f.member({ user: f.user({ id: p.targetId }), joined_at: joinedAt }),
                    guild_id: f.ids.guild,
                })
                yield* bot.idle()
                assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
                assert.equal(p.add.requests().length, 40, JSON.stringify(remote.calls.map((call) => call.method)))
                assert.equal(p.remove.requests().length, 0)
                assert.deepEqual(p.roleIds, new Set([p.targetRole.id, ...roles.map((role) => role.id)]))
                assert.equal(remote.calls.filter((call) => call.method === "evaluate").length, 41)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

// Runs on a controlled clock, so Fluxer's 6-second wait passes only when the test moves the clock. The node timeout only guards a hang
test(
    "A join with more autoroles than Fluxer adds in 10 seconds gives the rest once the limit allows, without holding the join",
    { timeout: 60000 },
    async () => {
        const f = createFixtures(),
            remote = rolesBoundary(),
            moderation = boundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions(
                            { token, serverId: f.ids.guild },
                            { moderation: moderation.store, roles: remote.store },
                        ),
                    )
                    const p = nativeRoles(bot),
                        roles = Array.from({ length: 25 }, () => bot.fixtures.role({ position: 2, permissions: "0" })),
                        done = yield* Deferred.make<void>(),
                        refusedBarrier = yield* Deferred.make<void>()
                    const outcome = remote.store.outcome
                    remote.store.outcome = (input) =>
                        outcome(input).pipe(
                            Effect.tap(() =>
                                input.outcome === "failed" ? Deferred.succeed(refusedBarrier, undefined) : Effect.void,
                            ),
                        )
                    bot.rest.respond("GET /guilds/:id/roles", { body: [...p.roles, p.role, p.second, ...roles] })
                    remote.current.autoroleEnabled = true
                    remote.current.autoroleIds = roles.map((role) => role.id)
                    // The 20th addition says Fluxer's role allowance is used up for 6 seconds, longer than a role change may wait. It
                    // gives no limit, so the SDK schedules no earlier refill probe and refuses the next addition before sending it
                    p.add.remove()
                    let added = 0
                    bot.rest.respond("PUT /guilds/:id/members/:id/roles/:id", (request) => {
                        p.roleIds.add(request.path.split("/").at(-1)!)
                        if (++added === 25) Deferred.doneUnsafe(done, Effect.void)
                        return added === 20
                            ? {
                                  status: 204,
                                  headers: {
                                      "x-ratelimit-bucket": "synthetic-role-add",
                                      "x-ratelimit-remaining": "0",
                                      "x-ratelimit-reset-after": "6",
                                  },
                              }
                            : { status: 204 }
                    })
                    const joinedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
                    p.target.remove()
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({
                        body: f.member({
                            user: f.user({ id: p.targetId }),
                            joined_at: joinedAt,
                            roles: [...p.roleIds],
                            communication_disabled_until: null,
                        }),
                    }))
                    yield* bot.ready()
                    yield* bot.emit("GUILD_MEMBER_ADD", {
                        ...f.member({ user: f.user({ id: p.targetId }), joined_at: joinedAt }),
                        guild_id: f.ids.guild,
                    })
                    // No time passes, so the 21st addition is always refused before it is sent, and the rest wait in the
                    // background for the limit
                    yield* Deferred.await(refusedBarrier)
                    assert.equal(added, 20)
                    const refused = remote.calls.filter(
                        (call) => call.method === "outcome" && (call.input as { outcome: string }).outcome === "failed",
                    )
                    assert.equal(refused.length, 1)
                    // The rest follow by themselves once the limit allows, under a source of their own
                    yield* TestClock.adjust("6 seconds")
                    yield* Deferred.await(done)
                    yield* bot.idle()
                    assert.equal(added, 25)
                    assert.deepEqual(p.roleIds, new Set([p.targetRole.id, ...roles.map((role) => role.id)]))
                    const sources = new Set(
                        remote.calls
                            .filter((call) => call.method === "evaluate")
                            .map((call) => (call.input as { sourceId: string }).sourceId.split("_")[0]),
                    )
                    assert.deepEqual(sources, new Set(["join", "joinwait"]))
                    assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

// Two members join a server with autoroles. Each member's roles live in its own set, and an addition puts the role in the member's set
function twoJoins(bot: Bot, p: ReturnType<typeof nativeRoles>, count: number) {
    const f = bot.fixtures,
        second = f.nextId(),
        joinedAt = new Map<string, string>(),
        held = new Map([
            [p.targetId, p.roleIds],
            [second, new Set<string>()],
        ]),
        roles = Array.from({ length: count }, () => f.role({ position: 2, permissions: "0" }))
    bot.rest.respond("GET /guilds/:id/roles", { body: [...p.roles, p.role, p.second, ...roles] })
    p.add.remove()
    p.target.remove()
    const add = bot.rest.respond("PUT /guilds/:id/members/:id/roles/:id", (request) => {
        const [, , , , userId, , roleId] = request.path.split("/")
        held.get(userId!)!.add(roleId!)
        return { status: 204 }
    })
    const member = (userId: string) =>
        f.member({
            user: f.user({ id: userId }),
            joined_at: joinedAt.get(userId)!,
            roles: [...held.get(userId)!],
            communication_disabled_until: null,
        })
    const join = (userId: string) =>
        Effect.gen(function* () {
            joinedAt.set(userId, new Date(yield* Clock.currentTimeMillis).toISOString())
            yield* bot.emit("GUILD_MEMBER_ADD", { ...member(userId), guild_id: f.ids.guild })
        })
    const given = (userId: string) => roles.filter((role) => held.get(userId)!.has(role.id)).length
    return { second, roles, held, add, member, join, given }
}

// Runs on a controlled clock, so Fluxer's member read limit holds the first pass until the test moves the clock. The node timeout only
// guards a hang
test(
    "A join's autoroles run beside the event handlers, so the next join reaches its protection while the pass waits for Fluxer's member read limit",
    { timeout: 60000 },
    async () => {
        const f = createFixtures(),
            remote = rolesBoundary(),
            moderation = boundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions(
                            { token, serverId: f.ids.guild },
                            { moderation: moderation.store, roles: remote.store },
                        ),
                    )
                    const p = nativeRoles(bot),
                        j = twoJoins(bot, p, 3),
                        heldBarrier = yield* Deferred.make<void>(),
                        protectedBarrier = yield* Deferred.make<void>(),
                        done = yield* Deferred.make<void>()
                    remote.current.autoroleEnabled = true
                    remote.current.autoroleIds = j.roles.map((role) => role.id)
                    moderation.current.securityEnabled = true
                    moderation.current.joinEnabled = true
                    // Once the first pass evaluates, its next member read says Fluxer's member reads are used up for 10 seconds, with
                    // complete limit headers, so the reads after it wait in the SDK instead of failing
                    let armed = false,
                        holding = false
                    const evaluate = remote.store.evaluate
                    remote.store.evaluate = (input) => {
                        if (input.operation.type === "join" && input.context.userId === p.targetId && !armed)
                            armed = holding = true
                        return evaluate(input)
                    }
                    // Every member read shares one bucket, as on Fluxer, and says how much of it is left
                    const reads = (remaining: number) => ({
                        "x-ratelimit-bucket": "synthetic-member-read",
                        "x-ratelimit-limit": "40",
                        "x-ratelimit-remaining": String(remaining),
                        "x-ratelimit-reset-after": "10",
                    })
                    p.ownMember.remove()
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.bot}`, {
                        body: f.member({
                            user: f.botUser(),
                            roles: [p.botRole.id],
                            communication_disabled_until: null,
                        }),
                        headers: reads(39),
                    })
                    for (const userId of [p.targetId, j.second])
                        bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${userId}`, () => {
                            if (holding && userId === p.targetId) {
                                holding = false
                                Deferred.doneUnsafe(heldBarrier, Effect.void)
                                return { body: j.member(userId), headers: reads(0) }
                            }
                            return { body: j.member(userId), headers: reads(39) }
                        })
                    bot.rest.respond("GET /users/:id", (request) => {
                        const userId = request.path.split("/").at(-1)!
                        if (userId === j.second) Deferred.doneUnsafe(protectedBarrier, Effect.void)
                        return { body: f.user({ id: userId }) }
                    })
                    j.add.remove()
                    bot.rest.respond("PUT /guilds/:id/members/:id/roles/:id", (request) => {
                        const [, , , , userId, , roleId] = request.path.split("/")
                        j.held.get(userId!)!.add(roleId!)
                        if (j.given(p.targetId) === 3 && j.given(j.second) === 3) Deferred.doneUnsafe(done, Effect.void)
                        return { status: 204 }
                    })
                    yield* bot.ready()
                    yield* j.join(p.targetId)
                    yield* Deferred.await(heldBarrier)
                    // The first pass waits for the limit, and the second join still reaches its protection
                    yield* j.join(j.second)
                    yield* Deferred.await(protectedBarrier)
                    assert.equal(j.given(p.targetId), 0)
                    yield* TestClock.adjust("10 seconds")
                    yield* Deferred.await(done)
                    yield* bot.idle()
                    assert.equal(j.given(p.targetId), 3)
                    assert.equal(j.given(j.second), 3)
                    assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

// Runs on a controlled clock. The node timeout only guards a hang
test(
    "An autorole pass that waited behind another past the backend's 15 minutes for a source still gives every role",
    { timeout: 60000 },
    async () => {
        const f = createFixtures(),
            remote = rolesBoundary(),
            moderation = boundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions(
                            { token, serverId: f.ids.guild },
                            { moderation: moderation.store, roles: remote.store },
                        ),
                    )
                    const p = nativeRoles(bot),
                        j = twoJoins(bot, p, 2),
                        entered = yield* Deferred.make<void>(),
                        release = yield* Deferred.make<void>(),
                        queued = yield* Deferred.make<void>()
                    remote.current.autoroleEnabled = true
                    remote.current.autoroleIds = j.roles.map((role) => role.id)
                    for (const userId of [p.targetId, j.second])
                        bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${userId}`, () => ({
                            body: j.member(userId),
                        }))
                    // The backend refuses a source more than 15 minutes old, and the first pass stops in its first evaluation
                    // until the test releases it
                    const evaluate = remote.store.evaluate
                    remote.store.evaluate = (input) =>
                        Effect.gen(function* () {
                            const now = yield* Clock.currentTimeMillis
                            if (input.createdAt < now - 900000 || input.createdAt > now + 60000)
                                return yield* Effect.fail(new RolesStoreError({ operation: "evaluate", status: 400 }))
                            if (input.context.userId === p.targetId && !Deferred.isDoneUnsafe(entered)) {
                                Deferred.doneUnsafe(entered, Effect.void)
                                yield* Deferred.await(release)
                            }
                            return yield* evaluate(input)
                        })
                    const memberQuery = remote.store.memberQuery
                    remote.store.memberQuery = (input) =>
                        memberQuery(input).pipe(
                            Effect.tap(() =>
                                input.context.userId === j.second ? Deferred.succeed(queued, undefined) : Effect.void,
                            ),
                        )
                    yield* bot.ready()
                    yield* j.join(p.targetId)
                    yield* Deferred.await(entered)
                    // The second join's handler finishes while the first pass is stopped, and its pass waits behind it
                    yield* j.join(j.second)
                    yield* Deferred.await(queued)
                    yield* TestClock.adjust("16 minutes")
                    yield* Deferred.succeed(release, undefined)
                    yield* bot.idle()
                    assert.equal(j.given(p.targetId), 2)
                    assert.equal(j.given(j.second), 2)
                    assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

test("native role commands compose current panels, explicit choices and reusable verification without replacing roles", async () => {
    const f = createFixtures(),
        publishing = publishingBoundary(),
        remote = rolesBoundary(publishing.store),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, publishing: publishing.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                yield* bot.ready()
                for (const command of [
                    "!publish create colors",
                    '!publish set colors content "Choose a role @everyone"',
                    "!roles create colors exclusive",
                    `!roles map colors 🔵 <@&${p.role.id}>`,
                    `!roles requires colors 🔵 <@&${p.targetRole.id}>`,
                    "!roles excludes colors 🔵 none",
                    `!roles publish colors <#${f.ids.channel}> colors`,
                    "!roles module on",
                    "!roles show colors",
                    "!roles list",
                    "!roles help",
                    "!publish create rules",
                    '!publish set rules content "Read the current rules"',
                    `!verify configure <@&${p.second.id}> ✅`,
                    `!verify publish <#${f.ids.channel}> rules`,
                    "!verify module on",
                ])
                    yield* emit(bot, command)
                assert.equal(remote.panels.get("colors")?.exclusive, true)
                assert.ok(remote.panels.get("rules")?.published)
                // Each panel change answers with one line that names it
                const sent = p.send.requests().map((request) => (request.body as { content?: string }).content)
                for (const line of [
                    `🔵 on role panel colors now gives <@&${p.role.id}>`,
                    `🔵 on role panel colors now requires <@&${p.targetRole.id}>`,
                    "🔵 on role panel colors has no excluded roles now",
                    `Role panel colors posted in <#${f.ids.channel}>`,
                    `Accepting the rules with ✅ now gives <@&${p.second.id}>`,
                    `Role panel rules posted in <#${f.ids.channel}>`,
                ])
                    assert.ok(sent.includes(line), line)
                yield* emit(bot, "!roles choose colors 🔵", p.targetId)
                assert.equal(p.roleIds.has(p.role.id), true)
                yield* emit(bot, "!roles choose colors none", p.targetId)
                assert.equal(p.roleIds.has(p.role.id), false)
                yield* emit(bot, "!verify", p.targetId)
                assert.equal(p.roleIds.has(p.second.id), true)
                assert.equal(p.roleIds.has(p.targetRole.id), true)
                assert.equal(p.add.requests().length, 2)
                assert.equal(p.remove.requests().length, 1)
                assert.equal(remote.calls.filter((c) => c.method === "outcome").length, 3)
                for (const request of p.send.requests())
                    assert.deepEqual((request.body as { allowed_mentions: unknown }).allowed_mentions, {
                        parse: [],
                        users: [],
                        roles: [],
                        replied_user: false,
                    })
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("chat verification finds its panel by kind and leaves a reaction panel named rules alone", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    let claims: RolesClaim[] = []
    const query = remote.store.query
    remote.store.query = (input) =>
        input.operation.type === "claim-list" ? Effect.succeed({ type: "claims", claims }) : query(input)
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                yield* bot.ready()
                // The dashboard accepts any name for the verification panel, and a reaction panel may be named rules
                const access = savedPanel(bot, p, remote, "verification")
                remote.panels.delete("rules")
                access.name = "access"
                remote.panels.set("access", access)
                const reaction = savedPanel(bot, p, remote, "reaction")
                remote.panels.delete("colors")
                reaction.name = "rules"
                reaction.mappings = [
                    { emoji: "🔵", roleId: p.second.id, prerequisiteRoleIds: [], exclusionRoleIds: [] },
                ]
                remote.panels.set("rules", reaction)
                remote.current.verificationEnabled = true
                const operations = () =>
                    remote.calls.flatMap((call) => (call.method === "manage" ? [call.input as RolesManageRequest] : []))
                yield* emit(bot, "!verify", p.targetId)
                assert.equal(p.roleIds.has(p.role.id), true)
                yield* emit(bot, `!verify configure <@&${p.targetRole.id}> ✅`)
                assert.deepEqual(
                    operations().map((input) => [
                        input.operation.type,
                        "name" in input.operation && input.operation.name,
                    ]),
                    [["panel-update", "access"]],
                )
                assert.deepEqual(
                    access.mappings.map((m) => m.roleId),
                    [p.targetRole.id],
                )
                assert.deepEqual(
                    reaction.mappings.map((m) => m.emoji),
                    ["🔵"],
                )
                yield* emit(bot, "!verify retire")
                assert.deepEqual(
                    operations()
                        .slice(1)
                        .map((input) => [input.operation.type, "name" in input.operation && input.operation.name]),
                    [["withdraw", "access"]],
                )
                yield* emit(bot, "!verify next")
                const opened = remote.calls.flatMap((call) =>
                    call.method === "query" && (call.input as RolesQueryRequest).operation.type === "withdrawal-open"
                        ? [(call.input as RolesQueryRequest).operation]
                        : [],
                )
                assert.deepEqual(opened, [{ type: "withdrawal-open", name: "access" }])
                // A member's roles are withdrawn by the verification panel's claims only
                const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId }))
                    .joinedAt
                p.roleIds.add(p.role.id)
                p.roleIds.add(p.second.id)
                claims = [
                    { roleId: p.role.id, consumerKeys: ["panel:access:1"] },
                    { roleId: p.second.id, consumerKeys: ["panel:rules:1"] },
                ].map((claim) => ({
                    ownershipId: `synthetic_${claim.roleId}`,
                    userId: p.targetId,
                    joinedAt,
                    generation: 1,
                    owned: true,
                    status: "idle",
                    ...claim,
                }))
                yield* emit(bot, `!verify withdraw <@${p.targetId}>`)
                const withdrawn = remote.calls
                    .filter((call) => call.method === "evaluate")
                    .map((call) => call.input as RolesEvaluateRequest)
                    .filter((input) => !input.continuationAttemptId && input.operation.type === "withdraw-member")
                    .map((input) => input.operation)
                assert.deepEqual(withdrawn, [
                    { type: "withdraw-member", consumerKey: "panel:access:1", roleId: p.role.id },
                ])
                assert.equal(p.roleIds.has(p.second.id), true)
            }),
        ),
    )
})

test("!verify configure says so when a reaction panel named rules blocks the verification panel", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                yield* bot.ready()
                const reaction = savedPanel(bot, p, remote, "reaction")
                remote.panels.delete("colors")
                reaction.name = "rules"
                remote.panels.set("rules", reaction)
                yield* emit(bot, `!verify configure <@&${p.second.id}> ✅`)
                const sent = p.send.requests().map((request) => (request.body as { content?: string }).content)
                assert.deepEqual(sent, [
                    "A role panel named rules already exists, so NeonFlux cannot create the verification panel. " +
                        "Delete it with !roles delete rules, or create the verification panel on the dashboard " +
                        "under another name, then send !verify configure again",
                ])
                assert.deepEqual([reaction.kind, reaction.mappings.map((m) => m.roleId)], ["reaction", [p.role.id]])
            }),
        ),
    )
})

test("native role grants bind membership epoch, exact presence and once-only claim before individual mutation", async () => {
    const f = createFixtures(),
        remote = rolesBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
                const p = nativeRoles(bot)
                yield* bot.ready()
                const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId }))
                    .joinedAt
                const grant: RolesGrant = {
                    attemptId: "synthetic_attempt",
                    ownershipId: "synthetic_owner",
                    generation: 1,
                    sourceId: "synthetic_source",
                    action: "add",
                    userId: p.targetId,
                    joinedAt,
                    roleId: p.role.id,
                    botId: f.ids.bot,
                    expectedPresent: false,
                    consumerKey: "panel:colors:1",
                    dispatchExpiresAt: (yield* Clock.currentTimeMillis) + 180000,
                    nativeDeadlineMs: 5000,
                }
                remote.attempts.set(grant.attemptId, {
                    ...grant,
                    createdAt: yield* Clock.currentTimeMillis,
                    outcome: "pending",
                })
                const wrongEpoch = yield* performRoleGrant(remote.store, f.ids.guild, bot.client, {
                    ...grant,
                    joinedAt: "2020-01-01T00:00:00Z",
                })
                assert.equal(wrongEpoch.outcome, "failed")
                assert.equal(p.add.requests().length, 0)
                remote.attempts.get(grant.attemptId)!.outcome = "pending"
                const { observed, ...applied } = yield* performRoleGrant(remote.store, f.ids.guild, bot.client, grant)
                assert.deepEqual(applied, { outcome: "succeeded", acknowledged: true })
                // The fresh read before the write, with the confirmed role, is the member's state for the next step
                assert.deepEqual(observed?.context.roleIds.toSorted(), [p.targetRole.id, p.role.id].sort())
                assert.equal(p.add.requests().length, 1)
                const repeated = yield* performRoleGrant(remote.store, f.ids.guild, bot.client, grant)
                assert.equal(repeated.outcome, "failed")
                assert.equal(p.add.requests().length, 1)
                assert.deepEqual([...p.roleIds].sort(), [p.targetRole.id, p.role.id].sort())
            }),
        ),
    )
})

test("Role-only grants allow owners and higher-ranked members while retaining safe role and native permission boundaries", async (t) => {
    for (const scenario of [
        "owner",
        "higher-member",
        "unsafe-role",
        "above-bot",
        "missing-member",
        "missing-ManageRoles",
    ] as const)
        await t.test(scenario, async () => {
            await Effect.runPromise(
                Effect.scoped(
                    Effect.gen(function* () {
                        const remote = rolesBoundary(),
                            bot = yield* createTestBot({ token: "synthetic-role-only-authority" }),
                            f = bot.fixtures,
                            p = nativeRoles(bot)
                        const userId = scenario === "owner" ? f.ids.user : p.targetId
                        const highRole = f.role({ position: 30, permissions: "0" })
                        const role = {
                            ...p.role,
                            position: scenario === "above-bot" ? 25 : p.role.position,
                            permissions: scenario === "unsafe-role" ? Permissions.ManageRoles.toString() : "0",
                        }
                        bot.rest.respond("GET /guilds/:id/roles", {
                            body: [
                                ...p.roles.map((item) =>
                                    item.id === p.botRole.id && scenario === "missing-ManageRoles"
                                        ? { ...item, permissions: "0" }
                                        : item,
                                ),
                                role,
                                p.second,
                                highRole,
                            ],
                        })
                        const memberRoles = new Set([scenario === "owner" ? p.actorRole.id : highRole.id])
                        const joinedAt = "2026-10-01T12:00:00Z"
                        bot.rest.respond(
                            `GET /guilds/${f.ids.guild}/members/${userId}`,
                            scenario === "missing-member"
                                ? { status: 404, body: { message: "Synthetic unavailable member" } }
                                : () => ({
                                      body: f.member({
                                          user: f.user({ id: userId }),
                                          roles: [...memberRoles],
                                          joined_at: joinedAt,
                                          communication_disabled_until: null,
                                      }),
                                  }),
                        )
                        p.add.remove()
                        p.remove.remove()
                        const add = bot.rest.respond("PUT /guilds/:id/members/:id/roles/:id", () => {
                            memberRoles.add(role.id)
                            return { status: 204 }
                        })
                        const remove = bot.rest.respond("DELETE /guilds/:id/members/:id/roles/:id", () => {
                            memberRoles.delete(role.id)
                            return { status: 204 }
                        })
                        const grant: RolesGrant = {
                            attemptId: "synthetic_role_only_add",
                            ownershipId: "synthetic_role_only_owner",
                            generation: 1,
                            sourceId: "synthetic_source",
                            action: "add",
                            userId,
                            joinedAt,
                            roleId: role.id,
                            botId: f.ids.bot,
                            expectedPresent: false,
                            consumerKey: "panel:colors:1",
                            dispatchExpiresAt: Number.MAX_SAFE_INTEGER,
                            nativeDeadlineMs: 5000,
                        }
                        remote.attempts.set(grant.attemptId, {
                            ...grant,
                            createdAt: yield* Clock.currentTimeMillis,
                            outcome: "pending",
                        })
                        const result = yield* performRoleGrant(remote.store, f.ids.guild, bot.client, grant)
                        if (scenario === "owner" || scenario === "higher-member") {
                            assert.deepEqual(
                                { outcome: result.outcome, acknowledged: result.acknowledged },
                                { outcome: "succeeded", acknowledged: true },
                            )
                            assert(result.observed?.context.roleIds.includes(role.id))
                            assert.equal(add.requests().length, 1)
                            assert(memberRoles.has(role.id))
                            const removal: RolesGrant = {
                                ...grant,
                                attemptId: "synthetic_role_only_remove",
                                sourceId: "synthetic_remove_source",
                                generation: 2,
                                action: "remove",
                                expectedPresent: true,
                            }
                            remote.attempts.set(removal.attemptId, {
                                ...removal,
                                createdAt: yield* Clock.currentTimeMillis,
                                outcome: "pending",
                            })
                            const removed = yield* performRoleGrant(remote.store, f.ids.guild, bot.client, removal)
                            assert.deepEqual(
                                { outcome: removed.outcome, acknowledged: removed.acknowledged },
                                { outcome: "succeeded", acknowledged: true },
                            )
                            assert.equal(removed.observed?.context.roleIds.includes(role.id), false)
                            assert.equal(remove.requests().length, 1)
                            assert.deepEqual([...memberRoles], [scenario === "owner" ? p.actorRole.id : highRole.id])
                        } else {
                            assert.equal(result.outcome, "failed")
                            assert.equal(add.requests().length, 0)
                            assert.equal(remove.requests().length, 0)
                            assert.equal(
                                remote.calls.some((call) => call.method === "dispatch"),
                                false,
                            )
                        }
                    }),
                ),
            )
        })
})

test("duplicate role claim cannot dispatch or acknowledge another performer", async () => {
    const f = createFixtures(),
        remote = rolesBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
                const p = nativeRoles(bot)
                yield* bot.ready()
                const entered = yield* Deferred.make<void>(),
                    release = yield* Deferred.make<void>()
                p.add.remove()
                const add = bot.rest.respond("PUT /guilds/:id/members/:id/roles/:id", () =>
                    Effect.runPromise(
                        Deferred.succeed(entered, undefined).pipe(
                            Effect.andThen(Deferred.await(release)),
                            Effect.map(() => {
                                p.roleIds.add(p.role.id)
                                return { status: 204 }
                            }),
                        ),
                    ),
                )
                const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId }))
                    .joinedAt
                const grant: RolesGrant = {
                    attemptId: "synthetic_concurrent",
                    ownershipId: "synthetic_owner",
                    generation: 1,
                    sourceId: "synthetic_source",
                    action: "add",
                    userId: p.targetId,
                    joinedAt,
                    roleId: p.role.id,
                    botId: f.ids.bot,
                    expectedPresent: false,
                    consumerKey: "panel:colors:1",
                    dispatchExpiresAt: (yield* Clock.currentTimeMillis) + 180000,
                    nativeDeadlineMs: 5000,
                }
                let claimed = false
                const store = {
                    ...remote.store,
                    dispatch: (input: RolesDispatchRequest) => {
                        remote.calls.push({ method: "dispatch", input })
                        const winner = !claimed
                        claimed = true
                        return Effect.succeed({
                            claimed: winner,
                            dispatchExpiresAt: grant.dispatchExpiresAt,
                            nativeDeadlineMs: 5000 as const,
                        })
                    },
                }
                const first = yield* performRoleGrant(store, f.ids.guild, bot.client, grant).pipe(
                    Effect.forkScoped({ startImmediately: true }),
                )
                yield* Deferred.await(entered)
                const duplicate = yield* performRoleGrant(store, f.ids.guild, bot.client, grant)
                assert.equal(duplicate.acknowledged, false)
                assert.equal(
                    remote.calls.some((c) => c.method === "outcome"),
                    false,
                )
                yield* Deferred.succeed(release, undefined)
                assert.equal((yield* Fiber.join(first)).outcome, "succeeded")
                assert.equal(add.requests().length, 1)
            }),
        ),
    )
})

test("invoked role failures remain uncertain and never prove managed removal ownership", async () => {
    for (const status of [403, 500, 200]) {
        const f = createFixtures(),
            remote = rolesBoundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
                    const p = nativeRoles(bot)
                    yield* bot.ready()
                    p.add.remove()
                    const add = bot.rest.respond("PUT /guilds/:id/members/:id/roles/:id", {
                        status,
                        body: { message: "Synthetic private rejection" },
                    })
                    const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId }))
                        .joinedAt
                    const grant: RolesGrant = {
                        attemptId: "synthetic_unknown",
                        ownershipId: "synthetic_owner",
                        generation: 1,
                        sourceId: "synthetic_source",
                        action: "add",
                        userId: p.targetId,
                        joinedAt,
                        roleId: p.role.id,
                        botId: f.ids.bot,
                        expectedPresent: false,
                        consumerKey: "panel:colors:1",
                        dispatchExpiresAt: Number.MAX_SAFE_INTEGER,
                        nativeDeadlineMs: 5000,
                    }
                    remote.attempts.set(grant.attemptId, {
                        ...grant,
                        createdAt: yield* Clock.currentTimeMillis,
                        outcome: "pending",
                    })
                    const result = yield* performRoleGrant(remote.store, f.ids.guild, bot.client, grant)
                    assert.equal(result.outcome, "uncertain")
                    assert.equal(add.requests().length, 1)
                    assert.equal(p.remove.requests().length, 0)
                    assert.equal(JSON.stringify(result).includes("private"), false)
                }),
            ),
        )
    }
})

test("interruption after role dispatch retains reservation without an invented terminal acknowledgement", async () => {
    const f = createFixtures(),
        remote = rolesBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
                const p = nativeRoles(bot)
                yield* bot.ready()
                p.add.remove()
                const entered = yield* Deferred.make<void>(),
                    released = yield* Deferred.make<void>()
                const add = bot.rest.respond("PUT /guilds/:id/members/:id/roles/:id", () =>
                    Effect.runPromise(
                        Deferred.succeed(entered, undefined).pipe(
                            Effect.andThen(Deferred.await(released)),
                            Effect.as({ status: 204 }),
                        ),
                    ),
                )
                const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId }))
                    .joinedAt
                const grant: RolesGrant = {
                    attemptId: "synthetic_interruption",
                    ownershipId: "synthetic_owner",
                    generation: 1,
                    sourceId: "synthetic_source",
                    action: "add",
                    userId: p.targetId,
                    joinedAt,
                    roleId: p.role.id,
                    botId: f.ids.bot,
                    expectedPresent: false,
                    consumerKey: "panel:colors:1",
                    dispatchExpiresAt: Number.MAX_SAFE_INTEGER,
                    nativeDeadlineMs: 5000,
                }
                remote.attempts.set(grant.attemptId, {
                    ...grant,
                    createdAt: yield* Clock.currentTimeMillis,
                    outcome: "pending",
                })
                const fiber = yield* performRoleGrant(remote.store, f.ids.guild, bot.client, grant).pipe(
                    Effect.forkScoped({ startImmediately: true }),
                )
                yield* Deferred.await(entered)
                yield* Fiber.interrupt(fiber)
                yield* Deferred.succeed(released, undefined)
                assert.equal(add.requests().length, 1)
                assert.equal(remote.calls.filter((c) => c.method === "outcome").length, 0)
                assert.equal(remote.attempts.get(grant.attemptId)?.outcome, "pending")
            }),
        ),
    )
})

test("one staff withdrawal command scopes every role independently and propagates current owner authority under DEFCON 1", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    let claims: RolesClaim[] = []
    remote.store.query = (input) => {
        remote.calls.push({ method: "query", input })
        if (input.operation.type === "claim-list") return Effect.succeed({ type: "claims", claims })
        return Effect.succeed({ type: "settings", settings: remote.current })
    }
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                yield* bot.ready()
                p.roleIds.add(p.role.id)
                p.roleIds.add(p.second.id)
                const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId }))
                    .joinedAt
                claims = [p.role.id, p.second.id].map((roleId) => ({
                    ownershipId: `synthetic_${roleId}`,
                    userId: p.targetId,
                    joinedAt,
                    roleId,
                    generation: 1,
                    owned: true,
                    status: "idle",
                    consumerKeys: ["panel:colors:1"],
                }))
                moderation.current.defcon = 1
                yield* emit(bot, `!roles withdraw colors <@${p.targetId}>`)
                const initial = remote.calls
                    .filter((c) => c.method === "evaluate")
                    .map((c) => c.input as RolesEvaluateRequest)
                    .filter((c) => !c.continuationAttemptId)
                assert.equal(initial.length, 2)
                assert.equal(new Set(initial.map((c) => c.sourceId)).size, 2)
                assert.equal(
                    initial.every((c) => c.actor?.isOwner === true && c.actor.userId === f.ids.user),
                    true,
                )
                const dispatch = remote.calls
                    .filter((c) => c.method === "dispatch")
                    .map((c) => c.input as RolesDispatchRequest)
                assert.equal(
                    dispatch.every((c) => c.actor?.isOwner === true),
                    true,
                )
                assert.equal(p.remove.requests().length, 2)
                assert.deepEqual([...p.roleIds], [p.targetRole.id])
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

// Runs on a controlled clock, so Fluxer's 6-second wait passes only when the test moves the clock. The node timeout only guards a hang
test(
    "!autorole withdraw answers at once and takes back every autorole role of a member in the background, the ones Fluxer's limit holds back once it allows",
    { timeout: 60000 },
    async () => {
        const f = createFixtures(),
            remote = rolesBoundary(),
            moderation = boundary()
        let claims: RolesClaim[] = []
        // The claims come ten to a page, as the backend lists them
        remote.store.query = (input) => {
            remote.calls.push({ method: "query", input })
            if (input.operation.type !== "claim-list")
                return Effect.succeed({ type: "settings", settings: remote.current })
            const from = Number(input.operation.cursor ?? 0)
            return Effect.succeed({
                type: "claims",
                claims: claims.slice(from, from + 10),
                ...(claims.length > from + 10 ? { nextCursor: String(from + 10) } : {}),
            })
        }
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions(
                            { token, serverId: f.ids.guild },
                            { moderation: moderation.store, roles: remote.store },
                        ),
                    )
                    const p = nativeRoles(bot),
                        roles = Array.from({ length: 25 }, () => bot.fixtures.role({ position: 2, permissions: "0" })),
                        waiting = yield* Deferred.make<void>(),
                        done = yield* Deferred.make<void>()
                    bot.rest.respond("GET /guilds/:id/roles", { body: [...p.roles, p.role, p.second, ...roles] })
                    for (const role of roles) p.roleIds.add(role.id)
                    // The 20th removal says Fluxer's role allowance is used up for 6 seconds, longer than a role change may wait
                    p.remove.remove()
                    let removed = 0
                    bot.rest.respond("DELETE /guilds/:id/members/:id/roles/:id", (request) => {
                        p.roleIds.delete(request.path.split("/").at(-1)!)
                        removed++
                        return removed === 20
                            ? {
                                  status: 204,
                                  headers: {
                                      "x-ratelimit-bucket": "synthetic-role-remove",
                                      "x-ratelimit-remaining": "0",
                                      "x-ratelimit-reset-after": "6",
                                  },
                              }
                            : { status: 204 }
                    })
                    const replies: Body[] = []
                    p.send.remove()
                    bot.rest.respond("POST /channels/:id/messages", (request) => {
                        const body = request.body as Body
                        replies.push(body)
                        if (body.content?.includes("so far")) Deferred.doneUnsafe(waiting, Effect.void)
                        if (body.embeds?.[0]?.title === "Role removal") Deferred.doneUnsafe(done, Effect.void)
                        return { body: f.message({ channel_id: request.path.split("/")[2], author: f.botUser() }) }
                    })
                    yield* bot.ready()
                    const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId }))
                        .joinedAt
                    claims = roles.map((role) => ({
                        ownershipId: `synthetic_${role.id}`,
                        userId: p.targetId,
                        joinedAt,
                        roleId: role.id,
                        generation: 1,
                        owned: true,
                        status: "idle",
                        consumerKeys: ["autorole:1"],
                    }))
                    // No time passes, so the 21st removal is always refused before it is sent
                    yield* bot.emit("MESSAGE_CREATE", f.message({ content: `!autorole withdraw <@${p.targetId}>` }))
                    yield* Deferred.await(waiting)
                    assert.equal(removed, 20)
                    assert.deepEqual(
                        replies.map((r) => r.content),
                        [
                            `Removing the roles autorole gave <@${p.targetId}>. NeonFlux replies here when it is done`,
                            `Removed 20 roles and released 20 autorole claims so far. Fluxer's role limit holds back the rest of <@${p.targetId}>'s roles, which follow once it allows`,
                        ],
                    )
                    yield* TestClock.adjust("6 seconds")
                    yield* Deferred.await(done)
                    yield* bot.idle()
                    assert.deepEqual(replies.at(-1)!.embeds![0], {
                        color: 0x5560e6,
                        title: "Role removal",
                        description: "Removed 25 roles",
                        fields: [
                            { name: "Member", value: `<@${p.targetId}>` },
                            { name: "Released", value: "25 autorole claims" },
                        ],
                        footer: { text: "NeonFlux removes a role only when it confirmed that it gave it" },
                    })
                    assert.deepEqual([...p.roleIds], [p.targetRole.id])
                    const cursors = remote.calls.flatMap((c) =>
                        c.method === "query" && (c.input as RolesQueryRequest).operation.type === "claim-list"
                            ? [(c.input as { operation: { cursor?: string } }).operation.cursor]
                            : [],
                    )
                    assert.deepEqual(cursors, [undefined, "10", "20"])
                    // Every removal is its own source, the one Fluxer's limit held back too
                    const sources = remote.calls
                        .filter((c) => c.method === "evaluate")
                        .map((c) => c.input as RolesEvaluateRequest)
                        .filter((c) => !c.continuationAttemptId)
                        .map((c) => c.sourceId)
                    assert.equal(sources.length, 26)
                    assert.equal(new Set(sources).size, 26)
                    assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

test("!autorole withdraw counts removed roles apart from roles already gone or kept for another feature, and stops at a role whose change is not confirmed", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    let claims: RolesClaim[] = []
    remote.store.query = (input) => {
        remote.calls.push({ method: "query", input })
        if (input.operation.type === "claim-list") return Effect.succeed({ type: "claims", claims })
        return Effect.succeed({ type: "settings", settings: remote.current })
    }
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot),
                    [own, shared, gone, unconfirmed, after] = Array.from({ length: 5 }, () =>
                        bot.fixtures.role({ position: 2, permissions: "0" }),
                    )
                bot.rest.respond("GET /guilds/:id/roles", {
                    body: [...p.roles, p.role, p.second, own!, shared!, gone!, unconfirmed!, after!],
                })
                // The backend keeps a role another feature still gives, and blocks one whose last change is not confirmed
                const evaluate = remote.store.evaluate
                remote.store.evaluate = (input) => {
                    const op = input.operation
                    if (op.type === "withdraw-member" && op.roleId === shared!.id) {
                        remote.calls.push({ method: "evaluate", input })
                        return Effect.succeed({
                            duplicate: false,
                            status: "unchanged",
                            acknowledgment: { acknowledged: false, accessConfirmed: false, accessRolePresent: false },
                        })
                    }
                    if (op.type === "withdraw-member" && op.roleId === unconfirmed!.id) {
                        remote.calls.push({ method: "evaluate", input })
                        return Effect.succeed({
                            duplicate: false,
                            status: "blocked",
                            acknowledgment: { acknowledged: false, accessConfirmed: false, accessRolePresent: false },
                        })
                    }
                    return evaluate(input)
                }
                yield* bot.ready()
                const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId }))
                    .joinedAt
                const claim = (roleId: string, consumerKeys: string[]): RolesClaim => ({
                    ownershipId: `synthetic_${roleId}`,
                    userId: p.targetId,
                    joinedAt,
                    roleId,
                    generation: 1,
                    owned: true,
                    status: "idle",
                    consumerKeys,
                })
                const replies = () => p.send.requests().map((r) => r.body as Body)
                p.roleIds.add(own!.id)
                p.roleIds.add(shared!.id)
                claims = [
                    claim(own!.id, ["autorole:1"]),
                    claim(shared!.id, ["autorole:1", "panel:colors:1"]),
                    claim(gone!.id, ["autorole:1"]),
                ]
                yield* emit(bot, `!autorole withdraw <@${p.targetId}>`)
                assert.deepEqual(
                    replies().at(-1)!.embeds![0]!.description,
                    "Removed 1 role, 1 already gone, 1 kept for another feature",
                )
                assert.deepEqual(replies().at(-1)!.embeds![0]!.fields!.at(-1), {
                    name: "Released",
                    value: "3 autorole claims",
                })
                assert.deepEqual(new Set(p.roleIds), new Set([p.targetRole.id, shared!.id]))
                // A blocked role stops the command, which names the recovery and leaves the roles after it alone
                p.roleIds.add(own!.id)
                p.roleIds.add(unconfirmed!.id)
                p.roleIds.add(after!.id)
                claims = [
                    claim(own!.id, ["autorole:1"]),
                    claim(unconfirmed!.id, ["autorole:1"]),
                    claim(after!.id, ["autorole:1"]),
                ]
                yield* emit(bot, `!autorole withdraw <@${p.targetId}>`)
                assert.equal(
                    replies().at(-1)!.content,
                    `Stopped at <@&${unconfirmed!.id}>, whose last change for <@${p.targetId}> is not confirmed yet. Check it with \`!autorole reconcile <@${p.targetId}>\`, then withdraw again. Removed 1 role and released 1 autorole claim so far`,
                )
                assert.deepEqual(new Set(p.roleIds), new Set([p.targetRole.id, shared!.id, unconfirmed!.id, after!.id]))
                assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
            }),
        ),
    )
})

// The line of background role work is held until the test releases it. The node timeout only guards a hang
test(
    "!autorole withdraw reads the staff member's authority again when its background work runs",
    { timeout: 60000 },
    async () => {
        const f = createFixtures(),
            remote = rolesBoundary(),
            moderation = boundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions(
                            { token, serverId: f.ids.guild },
                            { moderation: moderation.store, roles: remote.store },
                        ),
                    )
                    const p = nativeRoles(bot),
                        gate = yield* Deferred.make<void>(),
                        answered = yield* Deferred.make<void>()
                    const replies: string[] = []
                    p.send.remove()
                    bot.rest.respond("POST /channels/:id/messages", (request) => {
                        replies.push((request.body as Body).content ?? "")
                        Deferred.doneUnsafe(answered, Effect.void)
                        return { body: f.message({ channel_id: request.path.split("/")[2], author: f.botUser() }) }
                    })
                    yield* bot.ready()
                    yield* backgroundRoleWork(bot.client, f.ids.guild, Deferred.await(gate))
                    yield* bot.emit("MESSAGE_CREATE", f.message({ content: `!autorole withdraw <@${p.targetId}>` }))
                    yield* Deferred.await(answered)
                    // The command's author is neither the owner nor an administrator any more when the removal runs
                    p.guildRoute.remove()
                    bot.rest.respond("GET /guilds/:id", { body: f.guild({ owner_id: f.nextId() }) })
                    p.actor.remove()
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, {
                        body: f.member({ roles: [], communication_disabled_until: null }),
                    })
                    yield* Deferred.succeed(gate, undefined)
                    yield* bot.idle()
                    assert.deepEqual(replies, [
                        `Removing the roles autorole gave <@${p.targetId}>. NeonFlux replies here when it is done`,
                        `Stopped removing roles from <@${p.targetId}>, since only the server owner or an administrator can`,
                    ])
                    assert.equal(
                        remote.calls.some((c) => c.method === "evaluate" || c.method === "query"),
                        false,
                    )
                    assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
                }),
            ),
        )
    },
)

// The line of background role work is held until the test releases it. The node timeout only guards a hang
test(
    "!verify gives the autoroles that rules verification held back as background role work, and the join that waited for it warns about nothing",
    { timeout: 60000 },
    async () => {
        const f = createFixtures(),
            remote = rolesBoundary(),
            moderation = boundary(),
            logged: string[] = []
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions(
                            { token, serverId: f.ids.guild },
                            { moderation: moderation.store, roles: remote.store },
                        ),
                    )
                    const p = nativeRoles(bot),
                        gate = yield* Deferred.make<void>(),
                        answered = yield* Deferred.make<void>()
                    savedPanel(bot, p, remote, "verification")
                    remote.current.verificationEnabled = true
                    remote.current.autoroleEnabled = true
                    remote.current.autoroleIds = [p.second.id]
                    // As the backend does, autorole gives nothing before the member accepted the rules, and a verification with
                    // nothing left to give answers acknowledged
                    const evaluate = remote.store.evaluate
                    remote.store.evaluate = (input) =>
                        input.operation.type === "join" && !remote.acknowledgment.acknowledged
                            ? Effect.fail(
                                  new RolesStoreError({ operation: "evaluate", status: 403, code: "MEMBER_NOT_READY" }),
                              )
                            : evaluate(input).pipe(
                                  Effect.map((result) =>
                                      input.operation.type === "verify" &&
                                      result.status === "unchanged" &&
                                      result.acknowledgment.acknowledged
                                          ? { ...result, status: "acknowledged" as const }
                                          : result,
                                  ),
                              )
                    const joinedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
                    p.target.remove()
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({
                        body: f.member({
                            user: f.user({ id: p.targetId }),
                            joined_at: joinedAt,
                            roles: [...p.roleIds],
                            communication_disabled_until: null,
                        }),
                    }))
                    // The member has not reacted to the rules panel
                    bot.rest.respond((request) => new URL(request.url).pathname.endsWith("/users"), {
                        body: { items: [], has_more: false, next_after: null },
                    })
                    const replies: string[] = []
                    p.send.remove()
                    bot.rest.respond("POST /channels/:id/messages", (request) => {
                        replies.push((request.body as Body).content ?? "")
                        Deferred.doneUnsafe(answered, Effect.void)
                        return { body: f.message({ channel_id: request.path.split("/")[2], author: f.botUser() }) }
                    })
                    yield* bot.ready()
                    yield* bot.emit("GUILD_MEMBER_ADD", {
                        ...f.member({ user: f.user({ id: p.targetId }), joined_at: joinedAt }),
                        guild_id: f.ids.guild,
                    })
                    yield* bot.idle()
                    assert.equal(p.roleIds.has(p.second.id), false)
                    // With the line held, !verify answers and gives the rules role, and its autoroles wait for the line
                    yield* backgroundRoleWork(bot.client, f.ids.guild, Deferred.await(gate))
                    yield* bot.emit(
                        "MESSAGE_CREATE",
                        f.message({ content: "!verify", author: f.user({ id: p.targetId }) }),
                    )
                    yield* Deferred.await(answered)
                    assert.deepEqual(replies, ["Your roles are updated. Rules accepted"])
                    assert.equal(p.roleIds.has(p.role.id), true)
                    assert.equal(p.roleIds.has(p.second.id), false)
                    yield* Deferred.succeed(gate, undefined)
                    yield* bot.idle()
                    assert.equal(p.roleIds.has(p.second.id), true)
                    // They are bound to the membership that verified
                    const sources = remote.calls.flatMap((c) =>
                        c.method === "evaluate" && (c.input as RolesEvaluateRequest).operation.type === "join"
                            ? [(c.input as RolesEvaluateRequest).context.joinedAt]
                            : [],
                    )
                    assert.deepEqual(new Set(sources), new Set([joinedAt]))
                    assert.deepEqual(
                        logged.filter((line) => line.includes("autoroles could not")),
                        [],
                    )
                    assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
                }),
            ).pipe(
                Effect.provide(
                    Logger.layer([
                        Logger.make(({ message }) => {
                            logged.push(String(Array.isArray(message) ? message[0] : message))
                        }),
                    ]),
                ),
            ),
        )
    },
)

// The member's autorole round is held inside its member lock until the test releases it. The node timeout only guards a hang
test(
    "!autorole withdraw for a member whose autoroles are being given answers at once, and the commands after it do not wait for that member",
    { timeout: 60000 },
    async () => {
        const f = createFixtures(),
            remote = rolesBoundary(),
            moderation = boundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions(
                            { token, serverId: f.ids.guild },
                            { moderation: moderation.store, roles: remote.store },
                        ),
                    )
                    const p = nativeRoles(bot),
                        entered = yield* Deferred.make<void>(),
                        release = yield* Deferred.make<void>(),
                        replies: string[] = [],
                        sent: Deferred.Deferred<void>[] = []
                    remote.current.autoroleEnabled = true
                    remote.current.autoroleIds = [p.second.id]
                    const evaluate = remote.store.evaluate
                    remote.store.evaluate = (input) =>
                        Effect.gen(function* () {
                            if (input.operation.type === "join" && !Deferred.isDoneUnsafe(entered)) {
                                Deferred.doneUnsafe(entered, Effect.void)
                                yield* Deferred.await(release)
                            }
                            return yield* evaluate(input)
                        })
                    const joinedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
                    p.target.remove()
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({
                        body: f.member({
                            user: f.user({ id: p.targetId }),
                            joined_at: joinedAt,
                            roles: [...p.roleIds],
                            communication_disabled_until: null,
                        }),
                    }))
                    p.send.remove()
                    bot.rest.respond("POST /channels/:id/messages", (request) => {
                        const body = request.body as Body & { embeds?: { title?: string }[] }
                        replies.push(body.content || body.embeds?.[0]?.title || "")
                        const waiting = sent[replies.length - 1]
                        if (waiting) Deferred.doneUnsafe(waiting, Effect.void)
                        return { body: f.message({ channel_id: request.path.split("/")[2], author: f.botUser() }) }
                    })
                    const reply = (index: number) =>
                        Effect.suspend(() => {
                            while (sent.length <= index) sent.push(Deferred.makeUnsafe<void>())
                            if (replies.length > index) Deferred.doneUnsafe(sent[index]!, Effect.void)
                            return Deferred.await(sent[index]!)
                        })
                    yield* bot.ready()
                    yield* bot.emit("GUILD_MEMBER_ADD", {
                        ...f.member({ user: f.user({ id: p.targetId }), joined_at: joinedAt }),
                        guild_id: f.ids.guild,
                    })
                    yield* Deferred.await(entered)
                    // The member's round holds their lock, and the withdrawal and the next command still answer
                    yield* bot.emit("MESSAGE_CREATE", f.message({ content: `!autorole withdraw <@${p.targetId}>` }))
                    yield* reply(0)
                    yield* bot.emit("MESSAGE_CREATE", f.message({ content: "!autorole status" }))
                    yield* reply(1)
                    assert.equal(
                        replies[0],
                        `Removing the roles autorole gave <@${p.targetId}>. NeonFlux replies here when it is done`,
                    )
                    assert.equal(p.roleIds.has(p.second.id), false)
                    yield* Deferred.succeed(release, undefined)
                    yield* bot.idle()
                    assert.equal(p.roleIds.has(p.second.id), true)
                    assert.equal(replies.length, 3)
                    assert.equal(replies[2], "Role removal")
                    assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
                }),
            ),
        )
    },
)

// The member's autorole round is held inside its member lock until the test releases it. The node timeout only guards a hang
test(
    "retiring and deleting a panel whose member is getting autoroles answers at once, and another member's command does not wait for it",
    { timeout: 60000 },
    async () => {
        const f = createFixtures(),
            remote = rolesBoundary(),
            moderation = boundary()
        let job: Types.Mutable<RolesWithdrawal> | undefined
        const originalManage = remote.store.manage,
            originalQuery = remote.store.query,
            originalEvaluate = remote.store.evaluate
        // A removal with one target, which finishes once that member's role is taken back, like the backend's
        remote.store.manage = (input) => {
            const op = input.operation
            if (op.type !== "withdraw" && op.type !== "withdraw-next") return originalManage(input)
            remote.calls.push({ method: "manage", input })
            assert(job)
            if (op.type === "withdraw" && op.deletePanel && !job.deletePanel) {
                job.deletePanel = true
                job.status = "pending"
            }
            if (op.type === "withdraw-next" && !job.targets.length) job.status = "complete"
            return Effect.succeed({ duplicate: false, type: "withdrawal", withdrawal: structuredClone(job) })
        }
        remote.store.query = (input) =>
            input.operation.type === "withdrawal-show" || input.operation.type === "withdrawal-open"
                ? Effect.succeed({ type: "withdrawal", withdrawal: structuredClone(job!) })
                : originalQuery(input)
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions(
                            { token, serverId: f.ids.guild },
                            { moderation: moderation.store, roles: remote.store },
                        ),
                    )
                    const p = nativeRoles(bot),
                        entered = yield* Deferred.make<void>(),
                        release = yield* Deferred.make<void>(),
                        replies: string[] = [],
                        sent: Deferred.Deferred<void>[] = []
                    remote.current.autoroleEnabled = true
                    remote.current.autoroleIds = [p.second.id]
                    remote.store.evaluate = (input) =>
                        Effect.gen(function* () {
                            if (input.operation.type === "join" && !Deferred.isDoneUnsafe(entered)) {
                                Deferred.doneUnsafe(entered, Effect.void)
                                yield* Deferred.await(release)
                            }
                            const result = yield* originalEvaluate(input)
                            if (input.operation.type === "withdraw" && !result.grant && job)
                                job.targets = job.targets.filter((t) => t.userId !== p.targetId)
                            return result
                        })
                    const joinedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
                    p.roleIds.add(p.role.id)
                    job = {
                        withdrawalId: "synthetic_job",
                        consumerKey: "panel:colors:1",
                        step: 1,
                        status: "pending",
                        remainingAtLeast: 1,
                        hasMore: false,
                        deletePanel: false,
                        targets: [{ userId: p.targetId, joinedAt, roleId: p.role.id }],
                    }
                    savedPanel(bot, p, remote, "reaction")
                    p.target.remove()
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({
                        body: f.member({
                            user: f.user({ id: p.targetId }),
                            joined_at: joinedAt,
                            roles: [...p.roleIds],
                            communication_disabled_until: null,
                        }),
                    }))
                    p.send.remove()
                    bot.rest.respond("POST /channels/:id/messages", (request) => {
                        const body = request.body as Body & { embeds?: { title?: string }[] }
                        replies.push(body.content || body.embeds?.[0]?.title || "")
                        const waiting = sent[replies.length - 1]
                        if (waiting) Deferred.doneUnsafe(waiting, Effect.void)
                        return { body: f.message({ channel_id: request.path.split("/")[2], author: f.botUser() }) }
                    })
                    const reply = (index: number) =>
                        Effect.suspend(() => {
                            while (sent.length <= index) sent.push(Deferred.makeUnsafe<void>())
                            if (replies.length > index) Deferred.doneUnsafe(sent[index]!, Effect.void)
                            return Deferred.await(sent[index]!)
                        })
                    yield* bot.ready()
                    yield* bot.emit("GUILD_MEMBER_ADD", {
                        ...f.member({ user: f.user({ id: p.targetId }), joined_at: joinedAt }),
                        guild_id: f.ids.guild,
                    })
                    yield* Deferred.await(entered)
                    // The member's round holds their lock, and the retirement, the deletion and another member's command still answer
                    yield* bot.emit("MESSAGE_CREATE", f.message({ content: "!roles retire colors" }))
                    yield* reply(0)
                    yield* bot.emit("MESSAGE_CREATE", f.message({ content: "!roles delete colors" }))
                    yield* reply(1)
                    yield* bot.emit(
                        "MESSAGE_CREATE",
                        f.message({ content: "!help", author: f.user({ id: f.nextId() }) }),
                    )
                    yield* reply(2)
                    assert.deepEqual(replies.slice(0, 2), [
                        "Retiring panel colors. NeonFlux replies here when it is done",
                        "Deleting panel colors. NeonFlux replies here when it is done",
                    ])
                    assert.equal(p.roleIds.has(p.role.id), true)
                    assert.equal(job.status, "pending")
                    yield* Deferred.succeed(release, undefined)
                    yield* bot.idle()
                    // Both finish after the round, in the order they came
                    assert.equal(p.roleIds.has(p.role.id), false)
                    assert.equal(p.roleIds.has(p.second.id), true)
                    assert.deepEqual(replies.slice(3), [
                        "Retired. The roles it gave are removed",
                        "Deleted. The roles it gave are removed",
                    ])
                    assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
                }),
            ),
        )
    },
)

// Runs on a controlled clock. The member's first autorole round is held inside their lock until the test releases it. The node timeout only
// guards a hang
test(
    "a member's own choice and reaction wait only for one round of their autoroles, and other members' commands and reactions never wait for it",
    { timeout: 60000 },
    async () => {
        const f = createFixtures(),
            remote = rolesBoundary(),
            moderation = boundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions(
                            { token, serverId: f.ids.guild },
                            { moderation: moderation.store, roles: remote.store },
                        ),
                    )
                    const p = nativeRoles(bot),
                        j = twoJoins(bot, p, 10),
                        colors = savedPanel(bot, p, remote),
                        entered = yield* Deferred.make<void>(),
                        release = yield* Deferred.make<void>(),
                        otherReacted = yield* Deferred.make<void>(),
                        replies: { channelId: string; content: string }[] = [],
                        sent: Deferred.Deferred<void>[] = [],
                        log: string[] = []
                    const other = j.second,
                        otherJoinedAt = new Date((yield* Clock.currentTimeMillis) - 86400000).toISOString()
                    // A second posted reaction panel, whose 🎮 gives the second role
                    const gamesMessage = bot.fixtures.message({
                        author: bot.fixtures.botUser(),
                        content: "Games panel",
                    })
                    p.messages.set(gamesMessage.id, gamesMessage)
                    const mapping = { emoji: "🎮", roleId: p.second.id, prerequisiteRoleIds: [], exclusionRoleIds: [] }
                    remote.panels.set("games", {
                        ...structuredClone(colors),
                        name: "games",
                        mappings: [mapping],
                        published: {
                            ...structuredClone(colors.published!),
                            messageId: gamesMessage.id,
                            mappings: [mapping],
                        },
                    })
                    remote.current.panelsEnabled = true
                    remote.current.autoroleEnabled = true
                    remote.current.autoroleIds = j.roles.map((role) => role.id)
                    const autoroles = (userId: string) =>
                        log.filter(
                            (entry) => entry.startsWith(`put ${userId} `) && j.roles.some((r) => entry.endsWith(r.id)),
                        ).length
                    // The joining member's third autorole evaluation, in their first round, waits until the test releases it
                    let joinSteps = 0
                    const evaluate = remote.store.evaluate
                    remote.store.evaluate = (input) =>
                        Effect.gen(function* () {
                            const userId = input.context.userId
                            log.push(`evaluate ${userId} ${input.operation.type} ${autoroles(userId)}`)
                            if (input.operation.type === "join" && userId === p.targetId && ++joinSteps === 3) {
                                Deferred.doneUnsafe(entered, Effect.void)
                                yield* Deferred.await(release)
                            }
                            return yield* evaluate(input)
                        })
                    const outcome = remote.store.outcome
                    remote.store.outcome = (input) =>
                        outcome(input).pipe(
                            Effect.tap(() =>
                                Effect.sync(() => {
                                    const attempt = remote.attempts.get(input.attemptId)
                                    if (attempt?.userId === other && attempt.roleId === p.second.id)
                                        Deferred.doneUnsafe(otherReacted, Effect.void)
                                }),
                            ),
                        )
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${other}`, () => ({
                        body: f.member({
                            user: f.user({ id: other }),
                            joined_at: otherJoinedAt,
                            roles: [...j.held.get(other)!],
                            communication_disabled_until: null,
                        }),
                    }))
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({
                        body: j.member(p.targetId),
                    }))
                    // Fluxer sends its role limit with every role change, 20 every 10 seconds, so the SDK would wait for it rather than refuse a
                    // change. Fewer than 20 changes happen here, so only a round's own share can end it
                    j.add.remove()
                    let writes = 0
                    bot.rest.respond("PUT /guilds/:id/members/:id/roles/:id", (request) => {
                        const [, , , , userId, , roleId] = request.path.split("/")
                        j.held.get(userId!)!.add(roleId!)
                        log.push(`put ${userId} ${roleId}`)
                        return {
                            status: 204,
                            headers: {
                                "x-ratelimit-bucket": "synthetic-role-add",
                                "x-ratelimit-limit": "20",
                                "x-ratelimit-remaining": String(20 - ++writes),
                                "x-ratelimit-reset-after": "10",
                            },
                        }
                    })
                    // Both members hold their 🎮 reaction on the games panel, and no other reaction
                    bot.rest.respond(
                        (request) => new URL(request.url).pathname.endsWith("/users"),
                        (request) => {
                            const url = new URL(request.url),
                                userId = (BigInt(url.searchParams.get("after")!) + 1n).toString()
                            return {
                                body: {
                                    items:
                                        url.pathname.includes(gamesMessage.id) &&
                                        decodeURIComponent(url.pathname).includes("🎮")
                                            ? [{ id: userId, username: "Synthetic reactor" }]
                                            : [],
                                    has_more: false,
                                    next_after: null,
                                },
                            }
                        },
                    )
                    p.send.remove()
                    bot.rest.respond("POST /channels/:id/messages", (request) => {
                        const body = request.body as Body
                        replies.push({ channelId: request.path.split("/")[2]!, content: body.content ?? "" })
                        sent[replies.length - 1]?.pipe((waiting) => Deferred.doneUnsafe(waiting, Effect.void))
                        return { body: f.message({ channel_id: request.path.split("/")[2], author: f.botUser() }) }
                    })
                    const reply = (index: number) =>
                        Effect.suspend(() => {
                            while (sent.length <= index) sent.push(Deferred.makeUnsafe<void>())
                            if (replies.length > index) Deferred.doneUnsafe(sent[index]!, Effect.void)
                            return Deferred.await(sent[index]!)
                        })
                    const command = (content: string, userId: string) =>
                        bot.emit("MESSAGE_CREATE", f.message({ content, author: f.user({ id: userId }) }))
                    const reaction = (userId: string) =>
                        bot.emit("MESSAGE_REACTION_ADD", {
                            guild_id: f.ids.guild,
                            channel_id: f.ids.channel,
                            message_id: gamesMessage.id,
                            user_id: userId,
                            emoji: { name: "🎮" },
                        })
                    yield* bot.ready()
                    yield* j.join(p.targetId)
                    yield* Deferred.await(entered)
                    // The joining member's round holds their lock. Their own choice and reaction wait for it, and the other member's
                    // choice and reaction finish before it is released
                    yield* command("!roles choose colors ✅", p.targetId)
                    yield* reply(0)
                    yield* reaction(p.targetId)
                    yield* command("!roles choose colors ✅", other)
                    yield* reply(1)
                    yield* reaction(other)
                    yield* Deferred.await(otherReacted)
                    assert.deepEqual(
                        replies.map((r) => r.content),
                        [
                            "Your other role changes finish first. NeonFlux replies here when this one is done",
                            "Your roles are updated",
                        ],
                    )
                    assert.equal(j.held.get(other)!.has(p.role.id), true)
                    assert.equal(j.held.get(other)!.has(p.second.id), true)
                    assert.equal(p.roleIds.has(p.role.id), false)
                    assert.equal(p.roleIds.has(p.second.id), false)
                    assert.equal(autoroles(p.targetId), 2)
                    yield* Deferred.succeed(release, undefined)
                    yield* bot.idle()
                    // The member's choice and reaction ran right after the first round of five autoroles, before the next round
                    const evaluations = log.filter((entry) => entry.startsWith(`evaluate ${p.targetId} `))
                    // Each gives its role, then finds nothing more to change
                    assert.deepEqual(
                        evaluations.filter((entry) => !entry.includes(" join ")),
                        [
                            `evaluate ${p.targetId} choose 5`,
                            `evaluate ${p.targetId} choose 5`,
                            `evaluate ${p.targetId} reaction 5`,
                            `evaluate ${p.targetId} reaction 5`,
                        ],
                    )
                    assert.equal(j.given(p.targetId), 10)
                    assert.equal(p.roleIds.has(p.role.id), true)
                    assert.equal(p.roleIds.has(p.second.id), true)
                    assert.deepEqual(
                        replies.map((r) => r.content),
                        [
                            "Your other role changes finish first. NeonFlux replies here when this one is done",
                            "Your roles are updated",
                            "Your roles are updated",
                        ],
                    )
                    // No role change was refused, so only the round's share let the member's requests in
                    assert.equal(
                        remote.calls.filter(
                            (call) =>
                                call.method === "outcome" &&
                                (call.input as { outcome: string }).outcome !== "succeeded",
                        ).length,
                        0,
                    )
                    assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

// Runs on a controlled clock. The member's first autorole round is held inside their lock until the test releases it. The node timeout only
// guards a hang
test(
    "a staff reconcile of a member whose autoroles are running answers at once, and other members' commands never wait for it",
    { timeout: 60000 },
    async () => {
        const f = createFixtures(),
            remote = rolesBoundary(),
            moderation = boundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions(
                            { token, serverId: f.ids.guild },
                            { moderation: moderation.store, roles: remote.store },
                        ),
                    )
                    const p = nativeRoles(bot),
                        j = twoJoins(bot, p, 10),
                        entered = yield* Deferred.make<void>(),
                        release = yield* Deferred.make<void>(),
                        replies: { body: Body; released: boolean }[] = [],
                        sent: Deferred.Deferred<void>[] = []
                    let released = false
                    remote.current.autoroleEnabled = true
                    remote.current.autoroleIds = j.roles.map((role) => role.id)
                    // The joining member's third autorole evaluation, in their first round, waits until the test releases it
                    let joinSteps = 0
                    const evaluate = remote.store.evaluate
                    remote.store.evaluate = (input) =>
                        Effect.gen(function* () {
                            if (
                                input.operation.type === "join" &&
                                input.context.userId === p.targetId &&
                                ++joinSteps === 3
                            ) {
                                Deferred.doneUnsafe(entered, Effect.void)
                                yield* Deferred.await(release)
                            }
                            return yield* evaluate(input)
                        })
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({
                        body: j.member(p.targetId),
                    }))
                    p.send.remove()
                    bot.rest.respond("POST /channels/:id/messages", (request) => {
                        replies.push({ body: request.body as Body, released })
                        sent[replies.length - 1]?.pipe((waiting) => Deferred.doneUnsafe(waiting, Effect.void))
                        return { body: f.message({ channel_id: request.path.split("/")[2], author: f.botUser() }) }
                    })
                    const reply = (index: number) =>
                        Effect.suspend(() => {
                            while (sent.length <= index) sent.push(Deferred.makeUnsafe<void>())
                            if (replies.length > index) Deferred.doneUnsafe(sent[index]!, Effect.void)
                            return Deferred.await(sent[index]!)
                        })
                    const command = (content: string, userId: string) =>
                        bot.emit("MESSAGE_CREATE", f.message({ content, author: f.user({ id: userId }) }))
                    yield* bot.ready()
                    yield* j.join(p.targetId)
                    yield* Deferred.await(entered)
                    // The owner's reconcile of the joining member says it waits, and another member's command after it is answered while
                    // the round still holds the member's lock
                    yield* command(`!autorole reconcile <@${p.targetId}>`, f.ids.user)
                    yield* reply(0)
                    yield* command("!roles help", j.second)
                    yield* reply(1)
                    assert.equal(
                        replies[0]!.body.content,
                        "That member's other role changes finish first. NeonFlux replies here when this one is done",
                    )
                    assert.equal(replies.length, 2)
                    assert.equal(replies[1]!.released, false)
                    released = true
                    yield* Deferred.succeed(release, undefined)
                    yield* reply(2)
                    yield* bot.idle()
                    // The reconcile answers after the round, with the member's role check
                    assert.equal(replies[2]!.released, true)
                    assert.equal(replies[2]!.body.embeds?.[0]?.title, "Role check")
                    assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

// The first member's request and the second member's line are held until the test releases them. The node timeout only guards a hang
test(
    "members' own role requests run one at a time per server, as their handlers did, so a burst stays within Fluxer's role limit",
    { timeout: 60000 },
    async () => {
        const f = createFixtures(),
            remote = rolesBoundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { roles: remote.store }),
                    )
                    const first = bot.fixtures.nextId(),
                        second = bot.fixtures.nextId(),
                        entered = yield* Deferred.make<void>(),
                        release = yield* Deferred.make<void>(),
                        waiting = yield* Deferred.make<void>(),
                        free = yield* Deferred.make<void>(),
                        log: string[] = []
                    yield* bot.ready()
                    // The second member's line is busy, so their request says it waits once it starts
                    const busy = yield* withRoleMember(bot.client, second, Deferred.await(free), f.ids.guild).pipe(
                        Effect.forkScoped({ startImmediately: true }),
                    )
                    yield* memberRoleWork(
                        bot.client,
                        f.ids.guild,
                        first,
                        Deferred.succeed(entered, undefined).pipe(
                            Effect.andThen(Deferred.await(release)),
                            Effect.andThen(Effect.sync(() => log.push("first done"))),
                        ),
                    )
                    yield* Deferred.await(entered)
                    yield* memberRoleWork(
                        bot.client,
                        f.ids.guild,
                        second,
                        Effect.sync(() => log.push("second")),
                        Deferred.succeed(waiting, undefined),
                    )
                    yield* Deferred.await(waiting)
                    // The second member's line is free now, and their request still waits for the first one
                    yield* Deferred.succeed(free, undefined)
                    yield* Fiber.join(busy)
                    for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow
                    log.push("first released")
                    yield* Deferred.succeed(release, undefined)
                    yield* bot.idle()
                    assert.deepEqual(log, ["first released", "first done", "second"])
                    assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
                }),
            ),
        )
    },
)

// The member's line is held until the test releases it. The node timeout only guards a hang
test(
    "a member's role choice that waited is not applied once they left and rejoined meanwhile",
    { timeout: 60000 },
    async () => {
        const f = createFixtures(),
            remote = rolesBoundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { roles: remote.store }),
                    )
                    const p = nativeRoles(bot),
                        release = yield* Deferred.make<void>(),
                        acknowledged = yield* Deferred.make<void>(),
                        answered = yield* Deferred.make<void>(),
                        replies: string[] = []
                    savedPanel(bot, p, remote)
                    remote.current.panelsEnabled = true
                    const first = new Date((yield* Clock.currentTimeMillis) - 60000).toISOString()
                    let joinedAt = first
                    p.target.remove()
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({
                        body: f.member({
                            user: f.user({ id: p.targetId }),
                            joined_at: joinedAt,
                            roles: [...p.roleIds],
                            communication_disabled_until: null,
                        }),
                    }))
                    p.send.remove()
                    bot.rest.respond("POST /channels/:id/messages", (request) => {
                        replies.push((request.body as Body).content ?? "")
                        Deferred.doneUnsafe(replies.length === 1 ? acknowledged : answered, Effect.void)
                        return { body: f.message({ channel_id: request.path.split("/")[2], author: f.botUser() }) }
                    })
                    yield* bot.ready()
                    yield* bot.emit("GUILD_MEMBER_ADD", {
                        ...f.member({ user: f.user({ id: p.targetId }), joined_at: first }),
                        guild_id: f.ids.guild,
                    })
                    yield* bot.idle()
                    const work = yield* withRoleMember(
                        bot.client,
                        p.targetId,
                        Deferred.await(release),
                        f.ids.guild,
                    ).pipe(Effect.forkScoped({ startImmediately: true }))
                    yield* bot.emit(
                        "MESSAGE_CREATE",
                        f.message({ content: "!roles choose colors ✅", author: f.user({ id: p.targetId }) }),
                    )
                    // The choice waits for the member's line, and the member leaves and joins again before it runs
                    yield* Deferred.await(acknowledged)
                    joinedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
                    yield* Deferred.succeed(release, undefined)
                    yield* Fiber.join(work)
                    yield* Deferred.await(answered)
                    yield* bot.idle()
                    assert.deepEqual(replies, [
                        "Your other role changes finish first. NeonFlux replies here when this one is done",
                        "NeonFlux couldn't confirm the member's roles or the panel. Check them before you try again",
                    ])
                    assert.equal(p.roleIds.has(p.role.id), false)
                    assert.equal(p.add.requests().length, 0)
                }),
            ),
        )
    },
)

test("a verification gives at most five autoroles while it holds the member's lock, and the rest follow in the background", async () => {
    const f = createFixtures(),
        remote = rolesBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { roles: remote.store }),
                )
                const p = nativeRoles(bot),
                    roles = Array.from({ length: 10 }, () => bot.fixtures.role({ position: 2, permissions: "0" }))
                bot.rest.respond("GET /guilds/:id/roles", { body: [...p.roles, p.role, p.second, ...roles] })
                savedPanel(bot, p, remote, "verification")
                remote.current.verificationEnabled = true
                remote.current.autoroleEnabled = true
                remote.current.autoroleIds = roles.map((role) => role.id)
                // As the backend does, a verification with nothing left to give answers acknowledged
                const evaluate = remote.store.evaluate
                remote.store.evaluate = (input) =>
                    evaluate(input).pipe(
                        Effect.map((result) =>
                            input.operation.type === "verify" &&
                            result.status === "unchanged" &&
                            result.acknowledgment.acknowledged
                                ? { ...result, status: "acknowledged" as const }
                                : result,
                        ),
                    )
                const given = () => roles.filter((role) => p.roleIds.has(role.id)).length
                yield* bot.ready()
                const applied = yield* evaluateRoleRequest(
                    remote.store,
                    f.ids.guild,
                    bot.client,
                    { sourceId: "synthetic_verify", createdAt: yield* Clock.currentTimeMillis },
                    p.targetId,
                    { type: "verify", name: "rules", revision: 1 },
                )
                assert.equal(applied.autoroleFailed, false)
                assert.equal(p.roleIds.has(p.role.id), true)
                assert.equal(given(), 5)
                yield* bot.idle()
                assert.equal(given(), 10)
                assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
            }),
        ),
    )
})

// Runs on a controlled clock with the line of background role work held until the test releases it. The node timeout only guards a hang
test(
    "!autorole withdraw that waited in the line past the backend's 15 minutes for a source still removes the roles, and a member who rejoined meanwhile keeps theirs",
    { timeout: 60000 },
    async () => {
        const f = createFixtures(),
            remote = rolesBoundary(),
            moderation = boundary()
        let claims: RolesClaim[] = []
        remote.store.query = (input) => {
            remote.calls.push({ method: "query", input })
            const op = input.operation
            if (op.type === "claim-list")
                return Effect.succeed({ type: "claims", claims: claims.filter((c) => c.userId === op.userId) })
            return Effect.succeed({ type: "settings", settings: remote.current })
        }
        // The backend refuses a source more than 15 minutes old
        const evaluate = remote.store.evaluate
        remote.store.evaluate = (input) =>
            Effect.gen(function* () {
                const now = yield* Clock.currentTimeMillis
                if (input.createdAt < now - 900000 || input.createdAt > now + 60000)
                    return yield* Effect.fail(new RolesStoreError({ operation: "evaluate", status: 400 }))
                return yield* evaluate(input)
            })
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions(
                            { token, serverId: f.ids.guild },
                            { moderation: moderation.store, roles: remote.store },
                        ),
                    )
                    const p = nativeRoles(bot),
                        rejoining = bot.fixtures.nextId(),
                        gate = yield* Deferred.make<void>(),
                        replies: Body[] = [],
                        answered: Deferred.Deferred<void>[] = [Deferred.makeUnsafe(), Deferred.makeUnsafe()]
                    p.roleIds.add(p.second.id)
                    let rejoinedAt = "2026-01-01T00:00:00.000Z"
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${rejoining}`, () => ({
                        body: f.member({
                            user: f.user({ id: rejoining }),
                            joined_at: rejoinedAt,
                            roles: [p.second.id],
                            communication_disabled_until: null,
                        }),
                    }))
                    p.send.remove()
                    bot.rest.respond("POST /channels/:id/messages", (request) => {
                        replies.push(request.body as Body)
                        const waiting = answered[replies.length - 1]
                        if (waiting) Deferred.doneUnsafe(waiting, Effect.void)
                        return { body: f.message({ channel_id: request.path.split("/")[2], author: f.botUser() }) }
                    })
                    yield* bot.ready()
                    const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId }))
                        .joinedAt
                    claims = [
                        [p.targetId, joinedAt],
                        [rejoining, rejoinedAt],
                    ].map(([userId, at]) => ({
                        ownershipId: `synthetic_${userId}`,
                        userId: userId!,
                        joinedAt: at!,
                        roleId: p.second.id,
                        generation: 1,
                        owned: true,
                        status: "idle",
                        consumerKeys: ["autorole:1"],
                    }))
                    const timestamp = new Date(yield* Clock.currentTimeMillis).toISOString()
                    yield* backgroundRoleWork(bot.client, f.ids.guild, Deferred.await(gate))
                    for (const [index, userId] of [p.targetId, rejoining].entries()) {
                        yield* bot.emit(
                            "MESSAGE_CREATE",
                            f.message({ content: `!autorole withdraw <@${userId}>`, timestamp }),
                        )
                        yield* Deferred.await(answered[index]!)
                    }
                    // One member rejoins, and both withdrawals wait in the line for longer than a source may be old
                    rejoinedAt = "2026-01-02T00:00:00.000Z"
                    yield* TestClock.adjust("16 minutes")
                    yield* Deferred.succeed(gate, undefined)
                    yield* bot.idle()
                    assert.deepEqual(replies.at(-2)!.embeds![0]!.title, "Role removal")
                    assert.equal(replies.at(-2)!.embeds![0]!.description, "Removed 1 role")
                    assert.equal(replies.at(-1)!.content, `<@${rejoining}> left or rejoined, so no role was removed`)
                    assert.equal(p.roleIds.has(p.second.id), false)
                    assert.equal(p.remove.requests().length, 1)
                    // The removal counted from when it ran, under the command's own source
                    const removal = remote.calls.find(
                        (c) =>
                            c.method === "evaluate" &&
                            (c.input as RolesEvaluateRequest).operation.type === "withdraw-member",
                    )!.input as RolesEvaluateRequest
                    assert.match(removal.sourceId, /^command_\d+_0$/)
                    assert.equal(removal.createdAt, Date.parse(timestamp) + 16 * 60000)
                    assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

// A synthetic withdrawal that pages ten targets at a time and keeps configuration references until withdraw-next runs without targets
function pagedWithdrawal(remote: ReturnType<typeof rolesBoundary>, failing: Set<string>) {
    const state = {
        targets: [] as RolesWithdrawal["targets"],
        configurations: 1,
        step: 1,
        status: "pending" as RolesWithdrawal["status"],
    }
    const view = (cursor?: string): RolesWithdrawal => {
        const start = cursor === undefined ? 0 : Number(cursor),
            targets = state.targets.slice(start, start + 10)
        return {
            withdrawalId: "synthetic_job",
            consumerKey: "panel:colors:1",
            step: state.step,
            status: state.status,
            remainingAtLeast: state.targets.length + state.configurations,
            hasMore: state.targets.length > start + 10 || state.configurations > 0,
            deletePanel: false,
            targets,
            ...(state.targets.length > start + 10 ? { nextCursor: String(start + 10) } : {}),
        }
    }
    const originalEvaluate = remote.store.evaluate
    remote.store.manage = (input) => {
        remote.calls.push({ method: "manage", input })
        if (input.operation.type === "withdraw-next") {
            state.step++
            if (!state.targets.length) {
                state.configurations = 0
                state.status = "complete"
            }
        }
        return Effect.succeed({ duplicate: false, type: "withdrawal", withdrawal: view() })
    }
    const originalQuery = remote.store.query
    remote.store.query = (input) => {
        if (input.operation.type === "panel-show" || input.operation.type === "configuration-list")
            return originalQuery(input)
        remote.calls.push({ method: "query", input })
        return Effect.succeed({
            type: "withdrawal",
            withdrawal: view(
                (input.operation as Extract<RolesQueryRequest["operation"], { type: "withdrawal-show" }>).cursor,
            ),
        })
    }
    remote.store.evaluate = (input) => {
        const roleId = (input.operation as Extract<RolesEvaluateOperation, { type: "withdraw" }>).roleId
        if (failing.has(roleId)) return Effect.fail(new RolesStoreError({ operation: "evaluate", status: 503 }))
        return originalEvaluate(input).pipe(
            Effect.tap((result) =>
                Effect.sync(() => {
                    if (!result.grant) state.targets = state.targets.filter((t) => t.roleId !== roleId)
                }),
            ),
        )
    }
    return state
}

test("withdrawing the last owned role continues into configuration cleanup", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        state = pagedWithdrawal(remote, new Set())
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: boundary().store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                yield* bot.ready()
                p.roleIds.add(p.role.id)
                state.targets = [
                    {
                        userId: p.targetId,
                        joinedAt: (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId }))
                            .joinedAt,
                        roleId: p.role.id,
                    },
                ]
                savedPanel(bot, p, remote, "reaction")
                yield* emit(bot, "!roles next colors")
                assert.equal(p.roleIds.has(p.role.id), false)
                assert.equal(state.status, "complete")
            }),
        ),
    )
})

test("withdrawal pages past failed lookups and keeps them for later recovery", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        failing = new Set(Array.from({ length: 10 }, (_, i) => String(900000000000000000n + BigInt(i))))
    const state = pagedWithdrawal(remote, failing)
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: boundary().store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                yield* bot.ready()
                p.roleIds.add(p.role.id)
                const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId }))
                    .joinedAt
                state.targets = [
                    ...[...failing].map((roleId) => ({ userId: p.targetId, joinedAt, roleId })),
                    { userId: p.targetId, joinedAt, roleId: p.role.id },
                ]
                savedPanel(bot, p, remote, "reaction")
                yield* emit(bot, "!roles next colors")
                assert.equal(p.roleIds.has(p.role.id), false)
                assert.equal(state.targets.length, 10)
                assert.equal(state.status, "pending")
                // The removal is found by its panel's name, and the reply continues it by that name
                assert.deepEqual(
                    (remote.calls.find((c) => c.method === "query")!.input as RolesQueryRequest).operation,
                    { type: "withdrawal-open", name: "colors" },
                )
                assert.match(
                    (p.send.requests().at(-1)!.body as Body).content!,
                    /, 10 not confirmed\nContinue: `!roles next colors`$/,
                )
            }),
        ),
    )
})

test("a bounded retirement batch removes only exact current owned targets and settles departed metadata without touching a rejoin", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    let job: Types.Mutable<RolesWithdrawal> | undefined
    const originalEvaluate = remote.store.evaluate
    remote.store.manage = (input) => {
        remote.calls.push({ method: "manage", input })
        assert(job)
        if (input.operation.type === "withdraw-departed") {
            const joinedAt = input.operation.joinedAt
            job.targets = job.targets.filter((t) => t.joinedAt !== joinedAt)
            job.remainingAtLeast = job.targets.length
            job.step++
        }
        if (input.operation.type === "withdraw-next") {
            job.step++
            if (!job.targets.length) job.status = "complete"
        }
        return Effect.succeed({ duplicate: false, type: "withdrawal", withdrawal: structuredClone(job) })
    }
    const originalQuery = remote.store.query
    remote.store.query = (input) => {
        if (input.operation.type === "panel-show" || input.operation.type === "configuration-list")
            return originalQuery(input)
        remote.calls.push({ method: "query", input })
        assert(job)
        return Effect.succeed({ type: "withdrawal", withdrawal: structuredClone(job) })
    }
    remote.store.evaluate = (input) =>
        originalEvaluate(input).pipe(
            Effect.tap((result) => {
                if (!result.grant && job) {
                    job.targets = job.targets.filter(
                        (t) =>
                            t.roleId !==
                            (input.operation as Extract<RolesEvaluateOperation, { type: "withdraw" }>).roleId,
                    )
                    job.remainingAtLeast = job.targets.length
                }
                return Effect.void
            }),
        )
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                yield* bot.ready()
                p.roleIds.add(p.role.id)
                p.roleIds.add(p.second.id)
                const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId }))
                    .joinedAt
                job = {
                    withdrawalId: "synthetic_job",
                    consumerKey: "panel:colors:1",
                    step: 1,
                    status: "pending",
                    remainingAtLeast: 2,
                    hasMore: false,
                    deletePanel: false,
                    targets: [
                        { userId: p.targetId, joinedAt, roleId: p.role.id },
                        { userId: p.targetId, joinedAt: "2020-01-01T00:00:00Z", roleId: p.second.id },
                    ],
                }
                savedPanel(bot, p, remote, "reaction")
                yield* emit(bot, "!roles next colors")
                assert.equal(p.remove.requests().length, 1)
                assert.equal(p.roleIds.has(p.role.id), false)
                assert.equal(p.roleIds.has(p.second.id), true)
                assert.equal(p.roleIds.has(p.targetRole.id), true)
                const departed = remote.calls.find(
                    (c) =>
                        c.method === "manage" && (c.input as RolesManageRequest).operation.type === "withdraw-departed",
                )?.input as RolesManageRequest
                assert.equal(
                    (departed.operation as Extract<RolesManageOperation, { type: "withdraw-departed" }>)
                        .currentJoinedAt,
                    joinedAt,
                )
                assert.equal(job.targets.length, 0)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("member reconciliation continues with next from the remembered cursor and never upgrades an uncertain addition into owned removal", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    let claim: RolesClaim | undefined
    remote.store.query = (input) => {
        remote.calls.push({ method: "query", input })
        assert(claim)
        // The first page has a next page and the second is the last
        return Effect.succeed({
            type: "claims",
            claims: [claim],
            ...((input.operation as { cursor?: string }).cursor ? {} : { nextCursor: "opaque_cursor" }),
        })
    }
    remote.store.reconcile = (input) => {
        remote.calls.push({ method: "reconcile", input })
        assert(claim)
        return Effect.succeed({ recorded: true, claim: { ...claim, owned: false, status: "idle" } })
    }
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                yield* bot.ready()
                p.roleIds.add(p.role.id)
                const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId }))
                    .joinedAt
                claim = {
                    ownershipId: "synthetic_owner",
                    userId: p.targetId,
                    joinedAt,
                    roleId: p.role.id,
                    generation: 1,
                    owned: false,
                    status: "uncertain",
                    consumerKeys: ["panel:colors:1"],
                    attempt: {
                        attemptId: "synthetic_attempt",
                        ownershipId: "synthetic_owner",
                        generation: 1,
                        sourceId: "synthetic_source",
                        action: "add",
                        userId: p.targetId,
                        joinedAt,
                        roleId: p.role.id,
                        botId: f.ids.bot,
                        expectedPresent: false,
                        consumerKey: "panel:colors:1",
                        dispatchExpiresAt: 180000,
                        nativeDeadlineMs: 5000,
                        createdAt: 0,
                        finishedAt: 1,
                        outcome: "uncertain",
                    },
                }
                const replies = () => p.send.requests().map((r) => r.body as Body)
                const checked = [
                    { name: "Member", value: `<@${p.targetId}>` },
                    { name: "Checked", value: "1 role NeonFlux manages" },
                ]
                yield* emit(bot, `!roles reconcile colors <@${p.targetId}>`)
                assert.deepEqual(replies().at(-1)!.embeds![0], {
                    color: 0x5560e6,
                    title: "Role check",
                    description: `<@&${p.role.id}>: Settled, not confirmed as given by NeonFlux`,
                    fields: [...checked, { name: "Next", value: `\`!roles reconcile colors <@${p.targetId}> next\`` }],
                    footer: { text: "NeonFlux removes a role only when it confirmed that it gave it" },
                })
                yield* emit(bot, `!roles reconcile colors <@${p.targetId}> next`)
                assert.deepEqual(replies().at(-1)!.embeds![0]!.fields, checked)
                yield* emit(bot, `!roles reconcile colors <@${p.targetId}> next`)
                assert.equal(
                    replies().at(-1)!.content,
                    `There is no next page to show. Send !roles reconcile colors <@${p.targetId}> to start the list again`,
                )
                const requests = remote.calls
                    .filter((c) => c.method === "query")
                    .map(
                        (c) =>
                            (c.input as RolesQueryRequest).operation as Extract<
                                RolesQueryRequest["operation"],
                                { type: "claim-list" }
                            >,
                    )
                assert.deepEqual(
                    requests.map((op) => [op.type, op.cursor]),
                    [
                        ["claim-list", undefined],
                        ["claim-list", "opaque_cursor"],
                    ],
                )
                assert.equal(remote.calls.filter((c) => c.method === "reconcile").length, 2)
                assert.equal(p.add.requests().length + p.remove.requests().length, 0)
                assert.equal(p.roleIds.has(p.role.id), true)
            }),
        ),
    )
})

test("reconcile records an unconfirmed removal after its feature stopped desiring the role, and a settled role does not use up the command", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    let claims: RolesClaim[] = []
    const query = remote.store.query
    remote.store.query = (input) =>
        input.operation.type === "claim-list" ? Effect.succeed({ type: "claims", claims }) : query(input)
    remote.store.reconcile = (input) => {
        remote.calls.push({ method: "reconcile", input })
        const claim = claims.find((row) => row.attempt?.attemptId === input.attemptId)!
        return Effect.succeed({ recorded: true, claim: { ...claim, status: "idle", owned: false } })
    }
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                yield* bot.ready()
                const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId }))
                    .joinedAt
                const claimOf = (roleId: string, status: RolesClaim["status"], consumerKeys: string[]): RolesClaim => ({
                    ownershipId: `synthetic_owner_${roleId}`,
                    userId: p.targetId,
                    joinedAt,
                    roleId,
                    generation: 1,
                    owned: false,
                    status,
                    consumerKeys,
                    attempt: {
                        attemptId: `synthetic_attempt_${roleId}`,
                        ownershipId: `synthetic_owner_${roleId}`,
                        generation: 1,
                        sourceId: "synthetic_source",
                        action: "remove",
                        userId: p.targetId,
                        joinedAt,
                        roleId,
                        botId: f.ids.bot,
                        expectedPresent: true,
                        consumerKey: "panel:colors:1",
                        dispatchExpiresAt: 180000,
                        nativeDeadlineMs: 5000,
                        createdAt: 0,
                        finishedAt: 1,
                        outcome: status === "uncertain" ? "uncertain" : "succeeded",
                    },
                })
                // The settled role sorts first, and the unconfirmed removal no longer lists its panel as desiring the role
                claims = [claimOf(p.role.id, "idle", ["panel:colors:1"]), claimOf(p.second.id, "uncertain", [])]
                yield* emit(bot, `!roles reconcile colors <@${p.targetId}>`)
                assert.deepEqual(
                    remote.calls
                        .filter((c) => c.method === "reconcile")
                        .map((c) => (c.input as { attemptId: string }).attemptId),
                    [`synthetic_attempt_${p.second.id}`],
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("posting a posted reaction panel again binds the fresh message and adds the bot's reactions", async () => {
    const f = createFixtures(),
        publishing = publishingBoundary(),
        remote = rolesBoundary(publishing.store),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, publishing: publishing.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                const reactions = bot.rest.respond("PUT /channels/:id/messages/:id/reactions/:emoji/@me", {
                    status: 204,
                })
                yield* bot.ready()
                for (const command of [
                    "!publish create colors",
                    '!publish set colors content "Choose a role"',
                    "!roles create colors toggle",
                    `!roles map colors 🔵 <@&${p.role.id}>`,
                    `!roles publish colors <#${f.ids.channel}> colors`,
                ])
                    yield* emit(bot, command)
                const first = structuredClone(remote.panels.get("colors")!.published!)
                assert.equal(reactions.requests().length, 1)
                assert.ok(reactions.requests()[0]!.path.includes(first.messageId))
                const posts = () => p.send.requests().length
                const before = posts()
                yield* emit(bot, `!roles publish colors <#${f.ids.channel}> colors`)
                assert.equal(posts(), before + 2)
                assert.equal(
                    (p.send.requests().at(-1)!.body as { content?: string }).content,
                    `Role panel colors posted in <#${f.ids.channel}>. The earlier message no longer gives roles`,
                )
                const fresh = remote.panels.get("colors")!.published!
                assert.notEqual(fresh.messageId, first.messageId)
                assert.ok(fresh.revision > first.revision)
                assert.equal(
                    remote.calls.filter(
                        (c) => c.method === "manage" && (c.input as RolesManageRequest).operation.type === "panel-bind",
                    ).length,
                    2,
                )
                assert.equal(reactions.requests().length, 2)
                assert.ok(reactions.requests()[1]!.path.includes(fresh.messageId))
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})
test("mapping an emoji on a posted panel keeps its message, clears that emoji and reports it cleared", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot),
                    panel = savedPanel(bot, p, remote)
                const order: string[] = []
                const cleared = bot.rest.respond("DELETE /channels/:id/messages/:id/reactions/:emoji", (request) => {
                    order.push(`clear ${decodeURIComponent(request.path.split("/").at(-1)!)}`)
                    return { status: 204 }
                })
                const added = bot.rest.respond("PUT /channels/:id/messages/:id/reactions/:emoji/@me", (request) => {
                    order.push(`add ${decodeURIComponent(request.path.split("/").at(-2)!)}`)
                    return { status: 204 }
                })
                yield* bot.ready()
                const before = p.send.requests().length
                yield* emit(bot, `!roles map colors ✅ <@&${p.second.id}>`)
                assert.equal(p.send.requests().length, before + 1)
                assert.equal(
                    (p.send.requests().at(-1)!.body as { content?: string }).content,
                    `✅ on role panel colors now gives <@&${p.second.id}>. Members react again for the new role, and NeonFlux takes back the role it gave for the old one`,
                )
                const update = remote.calls.find(
                    (c) => c.method === "manage" && (c.input as RolesManageRequest).operation.type === "panel-update",
                )!.input as RolesManageRequest
                assert.equal((update.operation as { inPlace?: true }).inPlace, true)
                assert.equal(remote.panels.get("colors")!.revision, 1)
                assert.equal(remote.panels.get("colors")!.published!.messageId, panel.published!.messageId)
                assert.deepEqual(order, ["clear ✅", "add ✅"])
                assert.equal(cleared.requests().length, 1)
                assert.equal(added.requests().length, 1)
                const enqueue = remote.calls.find(
                    (c) =>
                        c.method === "reactionJobs" &&
                        (c.input as RolesReactionJobsRequest).operation.type === "enqueue",
                )!.input as RolesReactionJobsRequest
                // The report names the change it cleared for, so a newer change of the emoji keeps waiting
                assert.deepEqual(enqueue.operation, {
                    type: "enqueue",
                    messageId: panel.published!.messageId,
                    clearedEmojis: ["✅"],
                    clearGeneration: 1,
                })
                assert.equal(remote.panels.get("colors")!.published!.pendingClear, undefined)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})
test("mapping an emoji to a role another emoji of the panel gives says why, and the role maps once that emoji is unmapped", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot),
                    panel = savedPanel(bot, p, remote)
                const maps = [
                    { emoji: "🔴", roleId: p.role.id, prerequisiteRoleIds: [], exclusionRoleIds: [] },
                    { emoji: "🔵", roleId: p.second.id, prerequisiteRoleIds: [], exclusionRoleIds: [] },
                ]
                Object.assign(panel, { exclusive: true, mappings: structuredClone(maps) })
                Object.assign(panel.published!, { exclusive: true, mappings: structuredClone(maps) })
                const cleared = bot.rest.respond("DELETE /channels/:id/messages/:id/reactions/:emoji", { status: 204 })
                bot.rest.respond("PUT /channels/:id/messages/:id/reactions/:emoji/@me", { status: 204 })
                const updates = () =>
                    remote.calls.filter(
                        (c) =>
                            c.method === "manage" && (c.input as RolesManageRequest).operation.type === "panel-update",
                    ).length
                yield* bot.ready()
                yield* emit(bot, `!roles map colors 🔴 <@&${p.second.id}>`)
                assert.equal(
                    (p.send.requests().at(-1)!.body as { content?: string }).content,
                    `<@&${p.second.id}> already comes from 🔵 on role panel colors. Each role can come from one emoji, so unmap 🔵 with \`!roles unmap colors 🔵\` first or choose another role`,
                )
                assert.equal(updates(), 0)
                assert.equal(cleared.requests().length, 0)
                yield* emit(bot, "!roles unmap colors 🔵")
                yield* emit(bot, `!roles map colors 🔴 <@&${p.second.id}>`)
                assert.equal(
                    (p.send.requests().at(-1)!.body as { content?: string }).content,
                    `🔴 on role panel colors now gives <@&${p.second.id}>. Members react again for the new role, and NeonFlux takes back the role it gave for the old one`,
                )
                const posted = remote.panels.get("colors")!.published!
                assert.equal(posted.messageId, panel.published!.messageId)
                assert.deepEqual(
                    posted.mappings.map((m) => [m.emoji, m.roleId]),
                    [["🔴", p.second.id]],
                )
                // Both changed emojis were cleared and reported, so their reactions count again under the new meaning
                assert.deepEqual(
                    cleared.requests().map((r) => decodeURIComponent(r.path.split("/").at(-1)!)),
                    ["🔵", "🔴"],
                )
                assert.equal(posted.pendingClear, undefined)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})
test("mapping the only role of a posted panel to another emoji says how to move it, since the panel cannot lose its last role", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                savedPanel(bot, p, remote)
                const cleared = bot.rest.respond("DELETE /channels/:id/messages/:id/reactions/:emoji", { status: 204 })
                bot.rest.respond("PUT /channels/:id/messages/:id/reactions/:emoji/@me", { status: 204 })
                const updates = () =>
                    remote.calls.filter(
                        (c) =>
                            c.method === "manage" && (c.input as RolesManageRequest).operation.type === "panel-update",
                    ).length
                const last = () => (p.send.requests().at(-1)!.body as { content?: string }).content
                yield* bot.ready()
                yield* emit(bot, `!roles map colors 🔴 <@&${p.role.id}>`)
                assert.equal(
                    last(),
                    `<@&${p.role.id}> already comes from ✅ on role panel colors. Each role can come from one emoji, and this posted panel must keep at least one role, so change the emoji of ✅ on the dashboard or choose another role`,
                )
                assert.equal(updates(), 0)
                // Unmapping the only emoji is refused, as the earlier advice would have been
                yield* emit(bot, "!roles unmap colors ✅")
                assert.equal(
                    last(),
                    "A posted panel needs at least one role. Retire it with !roles retire colors instead",
                )
                assert.deepEqual(
                    remote.panels.get("colors")!.mappings.map((m) => [m.emoji, m.roleId]),
                    [["✅", p.role.id]],
                )
                assert.equal(cleared.requests().length, 0)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})
test("mapping a new emoji on a panel with 20 emojis names the limit before any request", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot),
                    panel = savedPanel(bot, p, remote)
                const maps = [..."🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🥦"].map((emoji, index) => ({
                    emoji,
                    roleId: String(900000000000000000n + BigInt(index)),
                    prerequisiteRoleIds: [],
                    exclusionRoleIds: [],
                }))
                assert.equal(maps.length, 20)
                Object.assign(panel, { mappings: structuredClone(maps) })
                Object.assign(panel.published!, { mappings: structuredClone(maps) })
                yield* bot.ready()
                yield* emit(bot, `!roles map colors 🌽 <@&${p.second.id}>`)
                assert.equal(
                    (p.send.requests().at(-1)!.body as { content?: string }).content,
                    "Role panel colors already has 20 emojis, the most a panel can have. Unmap one first or choose an emoji it already has",
                )
                assert.equal(
                    remote.calls.filter(
                        (c) =>
                            c.method === "manage" && (c.input as RolesManageRequest).operation.type === "panel-update",
                    ).length,
                    0,
                )
                assert.equal(remote.panels.get("colors")!.mappings.length, 20)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})
test("a panel change whose posted message is gone says how to post it again", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                savedPanel(bot, p, remote)
                bot.rest.respond("DELETE /channels/:id/messages/:id/reactions/:emoji", {
                    status: 404,
                    body: { code: "UNKNOWN_MESSAGE", message: "Unknown Message" },
                })
                yield* bot.ready()
                yield* emit(bot, `!roles map colors 🟢 <@&${p.second.id}>`)
                assert.equal(
                    (p.send.requests().at(-1)!.body as { content?: string }).content,
                    `🟢 on role panel colors now gives <@&${p.second.id}>. The posted message of panel colors is gone. Post it again with \`!roles publish colors #channel <draft-name>\``,
                )
                assert.deepEqual(remote.panels.get("colors")!.published!.pendingClear, ["🟢"])
                yield* emit(bot, "!roles show colors")
                const shown = JSON.stringify(p.send.requests().at(-1)!.body)
                assert.ok(shown.includes("Reactions to update"))
                assert.ok(shown.includes("🟢"))
            }),
        ),
    )
})
test("a reaction on a panel with emojis waiting to be cleared clears them, and a reaction with such an emoji changes no role", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot),
                    panel = savedPanel(bot, p, remote)
                remote.current.panelsEnabled = true
                panel.published!.pendingClear = ["✅"]
                panel.published!.clearGeneration = 3
                const reads = bot.rest.respond(
                    (request) => new URL(request.url).pathname.endsWith("/users"),
                    () => ({
                        body: {
                            items: [{ id: p.targetId, username: "Synthetic reactor" }],
                            has_more: false,
                            next_after: null,
                        },
                    }),
                )
                // A failed sync of a dashboard change left the emoji waiting
                const cleared = bot.rest.respond("DELETE /channels/:id/messages/:id/reactions/:emoji", { status: 204 })
                bot.rest.respond("PUT /channels/:id/messages/:id/reactions/:emoji/@me", { status: 204 })
                yield* bot.ready()
                yield* bot.emit("MESSAGE_REACTION_ADD", {
                    guild_id: f.ids.guild,
                    channel_id: f.ids.channel,
                    message_id: panel.published!.messageId,
                    user_id: p.targetId,
                    emoji: { name: "✅" },
                })
                yield* bot.idle()
                assert.equal(remote.calls.filter((c) => c.method === "evaluate").length, 0)
                assert.equal(reads.requests().length, 0)
                // The reaction clears the waiting emoji at once and reports it, so no staff command is needed
                assert.deepEqual(
                    cleared.requests().map((request) => decodeURIComponent(request.path.split("/").at(-1)!)),
                    ["✅"],
                )
                assert.deepEqual(
                    remote.calls.flatMap((c) =>
                        c.method === "reactionJobs" &&
                        (c.input as RolesReactionJobsRequest).operation.type === "enqueue"
                            ? [(c.input as RolesReactionJobsRequest).operation]
                            : [],
                    ),
                    [
                        {
                            type: "enqueue",
                            messageId: panel.published!.messageId,
                            clearedEmojis: ["✅"],
                            clearGeneration: 3,
                        },
                    ],
                )
                assert.equal(p.add.requests().length, 0)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("retiring autorole withdraws the earlier revisions that granted roles before the current one", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    const withdrawal = (revision: number): RolesWithdrawal => ({
        withdrawalId: `synthetic_job_${revision}`,
        consumerKey: `autorole:${revision}`,
        step: 1,
        status: "complete",
        remainingAtLeast: 0,
        hasMore: false,
        deletePanel: false,
        targets: [],
    })
    remote.current.revision = 3
    remote.store.query = (input) => {
        remote.calls.push({ method: "query", input })
        if (input.operation.type === "settings") return Effect.succeed({ type: "settings", settings: remote.current })
        // The first revision granted roles, and the second only changed the list
        return Effect.succeed({
            type: "configurations",
            references: [
                { consumerKey: "autorole:1", roleId: "40" },
                { consumerKey: "autorole:2", roleId: "41" },
            ],
        })
    }
    remote.store.manage = (input) => {
        remote.calls.push({ method: "manage", input })
        const op = input.operation as Extract<RolesManageOperation, { type: "autorole-withdraw" }>
        return Effect.succeed({ duplicate: false, type: "withdrawal", withdrawal: withdrawal(op.revision) })
    }
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                yield* bot.ready()
                yield* emit(bot, "!autorole retire")
                assert.deepEqual(
                    remote.calls
                        .filter((c) => c.method === "manage")
                        .map((c) => (c.input as RolesManageRequest).operation),
                    [
                        { type: "autorole-withdraw", revision: 1 },
                        { type: "autorole-withdraw", revision: 2 },
                        { type: "autorole-withdraw", revision: 3 },
                    ],
                )
                assert.equal(
                    (p.send.requests().at(-1)!.body as { content?: string }).content,
                    "Retired. The roles it gave are removed",
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("role commands take a final next instead of cursors or page numbers, and retire takes no revision", () => {
    assert.deepEqual(parseRoleCommand("roles", ["list", "next"]), { type: "list", next: true })
    // A mapping may require or exclude up to 100 roles
    const many = (count: number) => Array.from({ length: count }, (_, index) => `<@&${1000 + index}>`)
    assert.equal(
        (parseRoleCommand("roles", ["requires", "colors", "🔵", ...many(100)]) as { roleIds?: string[] }).roleIds
            ?.length,
        100,
    )
    assert.ok("error" in parseRoleCommand("roles", ["excludes", "colors", "🔵", ...many(101)]))
    assert.deepEqual(parseRoleCommand("roles", ["history", "colors", "next"]), {
        type: "history",
        name: "colors",
        next: true,
    })
    // A withdrawal walks every page, so it takes no next
    assert.deepEqual(parseRoleCommand("roles", ["withdraw", "colors", "<@123>"]), {
        type: "member",
        operation: "withdraw",
        name: "colors",
        userId: "123",
    })
    for (const [name, args] of [
        ["roles", ["withdraw", "colors", "<@123>", "next"]],
        ["verify", ["withdraw", "next"]],
        ["autorole", ["withdraw", "<@123>", "next"]],
    ] as const)
        assert.ok("error" in parseRoleCommand(name, args), args.join(" "))
    assert.deepEqual(parseRoleCommand("roles", ["reconcile", "colors", "next"]), {
        type: "member",
        operation: "reconcile",
        name: "colors",
        next: true,
    })
    assert.deepEqual(parseRoleCommand("roles", ["retire", "colors"]), { type: "retire", name: "colors" })
    // Role removals and reaction checks are named by their panel. Autorole and the rules panel need no name
    assert.deepEqual(parseRoleCommand("roles", ["next", "Colors"]), { type: "withdrawal", name: "colors" })
    assert.deepEqual(parseRoleCommand("verify", ["next"]), { type: "withdrawal" })
    assert.deepEqual(parseRoleCommand("autorole", ["next"]), { type: "withdrawal" })
    assert.deepEqual(parseRoleCommand("roles", ["resume", "colors"]), { type: "resume", name: "colors" })
    assert.deepEqual(parseRoleCommand("autorole", ["reservations", "next"]), { type: "reservations", next: true })
    assert.deepEqual(parseRoleCommand("verify", ["reconcile", "next"]), {
        type: "member",
        operation: "reconcile",
        next: true,
    })
    assert.deepEqual(parseRoleCommand("verify", ["withdraw", "<@123>"]), {
        type: "member",
        operation: "withdraw",
        userId: "123",
    })
    assert.deepEqual(parseRoleCommand("verify", ["retire"]), { type: "retire" })
    assert.deepEqual(parseRoleCommand("autorole", ["history", "next"]), { type: "history", next: true })
    assert.deepEqual(parseRoleCommand("autorole", ["reconcile", "<@123>", "next"]), {
        type: "member",
        operation: "reconcile",
        userId: "123",
        next: true,
    })
    assert.deepEqual(parseRoleCommand("autorole", ["retire"]), { type: "retire" })
    for (const [name, args] of [
        ["roles", ["list", "2"]],
        ["roles", ["history", "colors", "opaque_cursor"]],
        ["roles", ["retire", "colors", "3"]],
        ["roles", ["reconcile", "colors", "<@123>", "opaque_cursor"]],
        ["verify", ["retire", "3"]],
        ["verify", ["withdraw", "<@123>", "opaque_cursor"]],
        ["autorole", ["retire", "3"]],
        ["autorole", ["history", "opaque_cursor"]],
        ["autorole", ["reconcile", "next"]],
        ["roles", ["next"]],
        ["verify", ["next", "rules"]],
        ["autorole", ["next", "synthetic_job"]],
        ["roles", ["resume", "synthetic job"]],
        ["autorole", ["reservations", "2"]],
    ] as const)
        assert.ok("error" in parseRoleCommand(name, args), `${name} ${args.join(" ")}`)
})

test("panel lists and role history continue with next, and retiring reads the current revision", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary(),
        query = remote.store.query
    // Two pages of panels, and history with a next page until a cursor is given
    remote.store.query = (input) => {
        const op = input.operation
        if (op.type === "panel-list") {
            remote.calls.push({ method: "query", input })
            return Effect.succeed({ type: "panels", panels: [], page: op.page ?? 1, totalPages: 2 })
        }
        if (op.type === "configuration-list") {
            remote.calls.push({ method: "query", input })
            return Effect.succeed({
                type: "configurations",
                references: [],
                ...(op.cursor ? {} : { nextCursor: "opaque_cursor" }),
            })
        }
        return query(input)
    }
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot),
                    panel = savedPanel(bot, p, remote)
                yield* bot.ready()
                panel.revision = 2
                const replies = () => p.send.requests().map((r) => r.body as Body)
                yield* emit(bot, "!roles list")
                assert.deepEqual(replies().at(-1)!.embeds![0], {
                    color: 0x5560e6,
                    title: "Role panels",
                    description: "No role panels yet",
                    fields: [{ name: "Next", value: "`!roles list next`" }],
                })
                yield* emit(bot, "!roles list next")
                assert.deepEqual(replies().at(-1)!.embeds![0], {
                    color: 0x5560e6,
                    title: "Role panels",
                    description: "No role panels yet",
                })
                yield* emit(bot, "!roles list next")
                assert.equal(
                    replies().at(-1)!.content,
                    "There is no next page to show. Send !roles list to start the list again",
                )
                yield* emit(bot, "!autorole history")
                assert.deepEqual(replies().at(-1)!.embeds![0], {
                    color: 0x5560e6,
                    title: "Role history",
                    description: "No role history yet",
                    fields: [{ name: "Next", value: "`!autorole history next`" }],
                })
                yield* emit(bot, "!autorole history next")
                assert.deepEqual(replies().at(-1)!.embeds![0], {
                    color: 0x5560e6,
                    title: "Role history",
                    description: "No role history yet",
                })
                const listed = remote.calls
                    .filter((c) => c.method === "query")
                    .map((c) => (c.input as RolesQueryRequest).operation)
                    .filter((op) => op.type === "panel-list" || op.type === "configuration-list")
                assert.deepEqual(listed, [
                    { type: "panel-list", page: 1 },
                    { type: "panel-list", page: 2 },
                    { type: "configuration-list" },
                    { type: "configuration-list", cursor: "opaque_cursor" },
                ])
                // The synthetic backend refuses both withdrawals, after the bot sent the published panel revision and the current settings revision
                yield* emit(bot, "!roles retire colors")
                yield* emit(bot, "!autorole retire")
                assert.deepEqual(
                    remote.calls
                        .filter((c) => c.method === "manage")
                        .map((c) => (c.input as RolesManageRequest).operation),
                    [
                        { type: "withdraw", name: "colors", revision: 1 },
                        { type: "autorole-withdraw", revision: remote.current.revision },
                    ],
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("reaction checks sum up in one line, resume and next name the panel, and reservations count and page at 10 with mentions", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    // The worst case of 52 active checks, 12 of them stopped. The list stays empty until the bot is ready, so the worker starts idle
    let jobs: RolesReactionJob[] = []
    remote.store.reactionJobs = (input) => {
        remote.calls.push({ method: "reactionJobs", input })
        return input.operation.type === "list"
            ? Effect.succeed({ type: "jobs", jobs })
            : Effect.fail(new RolesStoreError({ operation: "reaction-jobs", status: 404 }))
    }
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                yield* bot.ready()
                jobs = Array.from({ length: 52 }, (_, i): RolesReactionJob => ({
                    jobId: `synthetic_job_${i}`,
                    name: `panel${i}`,
                    revision: 1,
                    messageId: String(900000000000000000n + BigInt(i)),
                    channelId: f.ids.channel,
                    generation: 1,
                    pageStep: 0,
                    status: i < 30 ? "running" : i < 40 ? "queued" : "blocked",
                    rerun: false,
                }))
                const replies = () => p.send.requests().map((r) => r.body as Body)
                yield* emit(bot, "!roles jobs")
                assert.deepEqual(replies().at(-1)!.embeds![0], {
                    color: 0x5560e6,
                    title: "Reaction checks",
                    description:
                        "52 reaction checks: 30 running, 10 waiting, 12 stopped (panels panel40, panel41, panel42, panel43 and 8 more)\nSend `!roles resume <panel>` to check a stopped panel again",
                })
                jobs = []
                yield* emit(bot, "!roles jobs")
                assert.deepEqual(replies().at(-1)!.embeds![0], {
                    color: 0x5560e6,
                    title: "Reaction checks",
                    description: "No reaction checks are running",
                })
                jobs = [
                    {
                        jobId: "synthetic_job",
                        name: "colors",
                        revision: 1,
                        messageId: "900000000000000000",
                        channelId: f.ids.channel,
                        generation: 1,
                        pageStep: 0,
                        status: "blocked",
                        rerun: false,
                    },
                ]
                yield* emit(bot, "!roles resume colors")
                assert.equal(replies().at(-1)!.content, "Checking the reactions on panel colors again")
                assert.ok(
                    remote.calls.some(
                        (c) =>
                            c.method === "reactionJobs" &&
                            JSON.stringify((c.input as RolesReactionJobsRequest).operation).includes(
                                '"jobId":"synthetic_job"',
                            ),
                    ),
                )
                yield* emit(bot, "!roles resume games")
                assert.equal(
                    replies().at(-1)!.content,
                    "Panel games has no reaction check to resume. Start one with `!roles reactions games`",
                )
                // A panel without an unfinished role removal says so, by name
                yield* emit(bot, "!roles next games")
                yield* emit(bot, "!autorole next")
                assert.deepEqual(
                    replies()
                        .slice(-2)
                        .map((r) => r.content),
                    ["Panel games has no role removal to continue", "Autorole has no role removal to continue"],
                )
                assert.deepEqual(
                    remote.calls
                        .filter((c) => c.method === "query")
                        .map((c) => (c.input as RolesQueryRequest).operation)
                        .slice(-2),
                    [{ type: "withdrawal-open", name: "games" }, { type: "withdrawal-open" }],
                )
                // 23 reservations: The count, then 10 members per page as mentions, never as IDs
                remote.current.reservations = Array.from({ length: 23 }, (_, i) => ({
                    userId: String(800000000000000000n + BigInt(i)),
                    roleIds: [p.role.id, p.second.id],
                }))
                const line = (i: number) =>
                    `<@${800000000000000000n + BigInt(i)}>: <@&${p.role.id}>, <@&${p.second.id}>`
                const footer = {
                    text: "Reserved roles are given when the user joins, while autorole is on and its humans-only setting allows them",
                }
                yield* emit(bot, "!autorole reservations")
                assert.deepEqual(replies().at(-1)!.embeds![0], {
                    color: 0x5560e6,
                    title: "Role reservations",
                    description: [
                        "23 members get roles on joining",
                        ...Array.from({ length: 10 }, (_, i) => line(i)),
                    ].join("\n"),
                    fields: [{ name: "Next", value: "`!autorole reservations next`" }],
                    footer,
                })
                yield* emit(bot, "!autorole reservations next")
                assert.equal(replies().at(-1)!.embeds![0]!.description!.split("\n")[1], line(10))
                yield* emit(bot, "!autorole reservations next")
                assert.deepEqual(replies().at(-1)!.embeds![0], {
                    color: 0x5560e6,
                    title: "Role reservations",
                    description: ["23 members get roles on joining", line(20), line(21), line(22)].join("\n"),
                    footer,
                })
                yield* emit(bot, "!autorole reservations next")
                assert.equal(
                    replies().at(-1)!.content,
                    "There is no next page to show. Send !autorole reservations to start the list again",
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("exclusive switching observes old removal before reserving the replacement and preserves unrelated roles", async () => {
    const f = createFixtures(),
        remote = rolesBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
                const p = nativeRoles(bot)
                yield* bot.ready()
                p.roleIds.add(p.role.id)
                const entered = yield* Deferred.make<void>(),
                    released = yield* Deferred.make<void>()
                p.remove.remove()
                const remove = bot.rest.respond("DELETE /guilds/:id/members/:id/roles/:id", () =>
                    Effect.runPromise(
                        Deferred.succeed(entered, undefined).pipe(
                            Effect.andThen(Deferred.await(released)),
                            Effect.map(() => {
                                p.roleIds.delete(p.role.id)
                                return { status: 204 }
                            }),
                        ),
                    ),
                )
                remote.store.evaluate = (input) => {
                    remote.calls.push({ method: "evaluate", input })
                    const oldPresent = input.context.roleIds.includes(p.role.id),
                        newPresent = input.context.roleIds.includes(p.second.id)
                    if (newPresent)
                        return Effect.succeed({
                            duplicate: false,
                            status: "unchanged",
                            acknowledgment: { acknowledged: false, accessConfirmed: false, accessRolePresent: false },
                        })
                    const grant: RolesGrant = {
                        attemptId: oldPresent ? "synthetic_remove" : "synthetic_add",
                        ownershipId: oldPresent ? "synthetic_old" : "synthetic_new",
                        generation: oldPresent ? 1 : 2,
                        sourceId: input.sourceId,
                        action: oldPresent ? "remove" : "add",
                        userId: p.targetId,
                        joinedAt: input.context.joinedAt,
                        roleId: oldPresent ? p.role.id : p.second.id,
                        botId: f.ids.bot,
                        expectedPresent: oldPresent,
                        consumerKey: "panel:colors:1",
                        dispatchExpiresAt: Number.MAX_SAFE_INTEGER,
                        nativeDeadlineMs: 5000,
                    }
                    remote.attempts.set(grant.attemptId, { ...grant, createdAt: input.createdAt, outcome: "pending" })
                    return Effect.succeed({
                        duplicate: false,
                        status: oldPresent ? "partial" : "reserved",
                        acknowledgment: { acknowledged: false, accessConfirmed: false, accessRolePresent: false },
                        grant,
                    })
                }
                const operation: RolesEvaluateOperation = {
                    type: "choose",
                    name: "colors",
                    revision: 1,
                    roleId: p.second.id,
                    selected: true,
                }
                const fiber = yield* evaluateRoleRequest(
                    remote.store,
                    f.ids.guild,
                    bot.client,
                    { sourceId: "synthetic_exclusive", createdAt: yield* Clock.currentTimeMillis },
                    p.targetId,
                    operation,
                ).pipe(Effect.forkScoped({ startImmediately: true }))
                yield* Deferred.await(entered)
                assert.equal(p.add.requests().length, 0)
                assert.equal(remote.calls.filter((c) => c.method === "evaluate").length, 1)
                yield* Deferred.succeed(released, undefined)
                yield* Fiber.join(fiber)
                assert.equal(remove.requests().length, 1)
                assert.equal(p.add.requests().length, 1)
                const requests = remote.calls
                    .filter((c) => c.method === "evaluate")
                    .map((c) => c.input as RolesEvaluateRequest)
                assert.equal(requests[1]?.continuationAttemptId, "synthetic_remove")
                assert.equal(requests[1]?.context.roleIds.includes(p.role.id), false)
                assert.equal(
                    requests.every(
                        (r) =>
                            r.sourceId === "synthetic_exclusive" &&
                            JSON.stringify(r.operation) === JSON.stringify(operation),
                    ),
                    true,
                )
                assert.deepEqual([...p.roleIds].sort(), [p.targetRole.id, p.second.id].sort())
            }),
        ),
    )
})

test("verification acknowledgement does not report access completion after an uncertain native grant", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                savedPanel(bot, p, remote, "verification")
                remote.current.verificationEnabled = true
                p.add.remove()
                const add = bot.rest.respond("PUT /guilds/:id/members/:id/roles/:id", {
                    status: 403,
                    body: { message: "Synthetic rejection" },
                })
                yield* bot.ready()
                yield* emit(bot, "!verify", p.targetId)
                yield* emit(bot, "!verify status", p.targetId)
                assert.equal(add.requests().length, 1)
                assert.equal(p.roleIds.has(p.role.id), false)
                const replies = p.send.requests().map((r) => r.body as Body)
                assert.ok(
                    replies.some(
                        (s) =>
                            s.content ===
                            "Your role change is not confirmed yet. Check your roles before you try again. Rules accepted",
                    ),
                )
                assert.deepEqual(replies.at(-1)!.embeds![0]!.fields, [
                    { name: "Rules accepted", value: "Yes" },
                    { name: "Access role", value: "You don't have it" },
                    { name: "Access confirmed", value: "No" },
                ])
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("explicit withdrawal requires current administrator authority even for the command author", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                yield* bot.ready()
                yield* emit(bot, "!roles withdraw colors", p.targetId)
                assert.equal(
                    remote.calls.some((c) => c.method === "evaluate" || c.method === "query"),
                    false,
                )
                assert.equal(p.remove.requests().length, 0)
                assert.ok(
                    p.send
                        .requests()
                        .some((r) =>
                            (r.body as { content: string }).content?.includes(
                                "Only the server owner or an administrator",
                            ),
                        ),
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("clear choice scopes every mapped role while ambiguous reactions preserve the existing choice", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot),
                    panel = savedPanel(bot, p, remote)
                panel.mappings.push({ emoji: "🔵", roleId: p.second.id, prerequisiteRoleIds: [], exclusionRoleIds: [] })
                panel.published!.mappings = structuredClone(panel.mappings)
                remote.current.panelsEnabled = true
                p.roleIds.add(p.role.id)
                p.roleIds.add(p.second.id)
                yield* bot.ready()
                yield* emit(bot, "!roles choose colors none", p.targetId)
                const requests = remote.calls
                    .filter((c) => c.method === "evaluate")
                    .map((c) => c.input as RolesEvaluateRequest)
                    .filter((c) => !c.continuationAttemptId)
                assert.equal(requests.length, 2)
                assert.equal(new Set(requests.map((r) => r.sourceId)).size, 2)
                assert.equal(p.remove.requests().length, 2)
                assert.deepEqual([...p.roleIds], [p.targetRole.id])
                p.roleIds.add(p.role.id)
                panel.exclusive = true
                panel.published!.exclusive = true
                remote.store.evaluate = (input) => {
                    remote.calls.push({ method: "evaluate", input })
                    return Effect.succeed({
                        duplicate: false,
                        status: "ambiguous",
                        acknowledgment: { acknowledged: false, accessConfirmed: false, accessRolePresent: false },
                    })
                }
                const reads = bot.rest.respond((r) => new URL(r.url).pathname.endsWith("/users"), {
                    body: {
                        items: [{ id: p.targetId, username: "Current reactor" }],
                        has_more: false,
                        next_after: null,
                    },
                })
                yield* bot.emit("MESSAGE_REACTION_ADD", {
                    guild_id: f.ids.guild,
                    channel_id: f.ids.channel,
                    message_id: panel.published!.messageId,
                    user_id: p.targetId,
                    emoji: { name: "🔵" },
                })
                yield* bot.idle()
                assert.equal(reads.requests().length, 2)
                assert.equal(p.add.requests().length, 0)
                assert.equal(p.remove.requests().length, 2)
                assert.equal(p.roleIds.has(p.role.id), true)
                assert.ok(
                    p.send
                        .requests()
                        .some((r) =>
                            (r.body as { content: string }).content?.includes(
                                `<@${p.targetId}>, your reactions on panel colors pick more than one role, but it gives one at a time. Use \`!roles choose colors <emoji>\` to pick one`,
                            ),
                        ),
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("fresh role configuration authority cannot reuse an administrator claim after a native downgrade", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                savedPanel(bot, p, remote)
                let downgraded = false
                p.guildRoute.remove()
                p.rolesRoute.remove()
                bot.rest.respond("GET /guilds/:id", () => ({
                    body: f.guild({ owner_id: downgraded ? p.targetId : f.ids.user }),
                }))
                bot.rest.respond("GET /guilds/:id/roles", () => ({
                    body: [...p.roles, p.role, p.second].map((r) =>
                        r.id === p.actorRole.id && downgraded ? { ...r, permissions: "0" } : r,
                    ),
                }))
                const originalQuery = remote.store.query
                remote.store.query = (input) =>
                    originalQuery(input).pipe(
                        Effect.tap(() => {
                            if (input.operation.type === "panel-show") downgraded = true
                            return Effect.void
                        }),
                    )
                remote.store.manage = (input) => {
                    remote.calls.push({ method: "manage", input })
                    return Effect.fail(new RolesStoreError({ operation: "manage", status: 403 }))
                }
                yield* bot.ready()
                yield* emit(bot, `!roles map colors 🔵 <@&${p.second.id}>`)
                const input = remote.calls.find((c) => c.method === "manage")!.input as RolesManageRequest
                assert.equal(input.actor.isOwner, false)
                assert.equal(input.actor.isAdministrator, false)
                assert.equal(remote.panels.get("colors")!.mappings.length, 1)
                assert.equal(p.add.requests().length + p.remove.requests().length, 0)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("queued reaction changes refresh current presence after the previous member operation finishes", async () => {
    const f = createFixtures(),
        remote = rolesBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
                const p = nativeRoles(bot),
                    panel = savedPanel(bot, p, remote)
                remote.current.panelsEnabled = true
                let present = true
                const reads = bot.rest.respond(
                    (r) => new URL(r.url).pathname.endsWith("/users"),
                    () => ({
                        body: {
                            items: present ? [{ id: p.targetId, username: "Current reactor" }] : [],
                            has_more: false,
                            next_after: null,
                        },
                    }),
                )
                const entered = yield* Deferred.make<void>(),
                    released = yield* Deferred.make<void>()
                p.add.remove()
                const add = bot.rest.respond("PUT /guilds/:id/members/:id/roles/:id", () =>
                    Effect.runPromise(
                        Deferred.succeed(entered, undefined).pipe(
                            Effect.andThen(Deferred.await(released)),
                            Effect.map(() => {
                                p.roleIds.add(p.role.id)
                                return { status: 204 }
                            }),
                        ),
                    ),
                )
                yield* bot.ready()
                const target = { id: panel.published!.messageId, channelId: f.ids.channel, guildId: f.ids.guild }
                const first = yield* handleRoleReaction(remote.store, f.ids.guild, bot.client, target, p.targetId).pipe(
                    Effect.forkScoped({ startImmediately: true }),
                )
                yield* Deferred.await(entered)
                present = false
                const second = yield* handleRoleReaction(
                    remote.store,
                    f.ids.guild,
                    bot.client,
                    target,
                    p.targetId,
                ).pipe(Effect.forkScoped({ startImmediately: true }))
                assert.equal(reads.requests().length, 1)
                yield* Deferred.succeed(released, undefined)
                yield* Fiber.join(first)
                yield* Fiber.join(second)
                assert.equal(reads.requests().length, 2)
                assert.equal(add.requests().length, 1)
                assert.equal(p.remove.requests().length, 1)
                assert.deepEqual([...p.roleIds], [p.targetRole.id])
            }),
        ),
    )
})

test("a reaction read before a remap and its clear gives no role for the new mapping, while a reaction after the clear does", async () => {
    const f = createFixtures(),
        remote = rolesBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
                const p = nativeRoles(bot),
                    panel = savedPanel(bot, p, remote)
                remote.current.panelsEnabled = true
                let present = true
                const reads = bot.rest.respond(
                    (r) => new URL(r.url).pathname.endsWith("/users"),
                    () => ({
                        body: {
                            items: present ? [{ id: p.targetId, username: "Synthetic reactor" }] : [],
                            has_more: false,
                            next_after: null,
                        },
                    }),
                )
                // The first evaluation waits after the handler read ✅ while it gave the first role
                const entered = yield* Deferred.make<void>(),
                    released = yield* Deferred.make<void>()
                let paused = false
                const store = {
                    ...remote.store,
                    evaluate: (input: RolesEvaluateRequest) => {
                        if (paused) return remote.store.evaluate(input)
                        paused = true
                        return Deferred.succeed(entered, undefined).pipe(
                            Effect.andThen(Deferred.await(released)),
                            Effect.andThen(Effect.suspend(() => remote.store.evaluate(input))),
                        )
                    },
                }
                yield* bot.ready()
                const target = { id: panel.published!.messageId, channelId: f.ids.channel, guildId: f.ids.guild }
                const stale = yield* handleRoleReaction(store, f.ids.guild, bot.client, target, p.targetId).pipe(
                    Effect.forkScoped({ startImmediately: true }),
                )
                yield* Deferred.await(entered)
                // Staff remap ✅ to the second role, and the native clear removes the reaction and is reported
                const remapped = [{ emoji: "✅", roleId: p.second.id, prerequisiteRoleIds: [], exclusionRoleIds: [] }]
                panel.mappings = remapped
                panel.published = {
                    ...panel.published!,
                    mappings: structuredClone(remapped),
                    pendingClear: ["✅"],
                    clearGeneration: 1,
                }
                present = false
                yield* remote.store.reactionJobs({
                    serverId: f.ids.guild,
                    operation: {
                        type: "enqueue",
                        messageId: panel.published.messageId,
                        clearedEmojis: ["✅"],
                        clearGeneration: 1,
                    },
                })
                assert.equal(remote.panels.get("colors")!.published!.pendingClear, undefined)
                yield* Deferred.succeed(released, undefined)
                assert.equal(yield* Fiber.join(stale), true)
                // The refused read was read again under the new mapping, and found no reaction
                assert.deepEqual(
                    remote.calls.flatMap((c) =>
                        c.method === "evaluate" ? [(c.input as RolesEvaluateRequest).operation] : [],
                    ),
                    [
                        {
                            type: "reaction",
                            name: "colors",
                            revision: 1,
                            messageId: panel.published.messageId,
                            presentEmojis: ["✅"],
                            panelVerified: true,
                            clearGeneration: 0,
                        },
                        {
                            type: "reaction",
                            name: "colors",
                            revision: 1,
                            messageId: panel.published.messageId,
                            presentEmojis: [],
                            panelVerified: true,
                            clearGeneration: 1,
                        },
                    ],
                )
                assert.equal(reads.requests().length, 2)
                assert.equal(p.add.requests().length, 0)
                // A reaction after the clear gives the second role
                present = true
                assert.equal(yield* handleRoleReaction(store, f.ids.guild, bot.client, target, p.targetId), true)
                assert.deepEqual(
                    p.add.requests().map((request) => request.path.split("/").at(-1)),
                    [p.second.id],
                )
                assert.equal(p.roleIds.has(p.second.id), true)
            }),
        ),
    )
})

test("join replay preserves raw epoch across every fresh read and uses the provider event time", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                remote.current.autoroleEnabled = true
                remote.current.autoroleIds = [p.role.id]
                const now = yield* Clock.currentTimeMillis,
                    epoch = new Date(now).toISOString().replace(/Z$/, "1234Z"),
                    replacement = epoch.replace(/1234Z$/, "5678Z")
                let calls = 0
                p.target.remove()
                bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({
                    body: f.member({
                        user: f.user({ id: p.targetId }),
                        joined_at: ++calls === 1 ? epoch : replacement,
                        roles: [...p.roleIds],
                        communication_disabled_until: null,
                    }),
                }))
                yield* bot.ready()
                yield* bot.emit("GUILD_MEMBER_ADD", {
                    ...f.member({ user: f.user({ id: p.targetId }), joined_at: epoch }),
                    guild_id: f.ids.guild,
                })
                yield* bot.idle()
                assert.equal(Date.parse(epoch), Date.parse(replacement))
                assert.equal(
                    remote.calls.some((c) => c.method === "evaluate"),
                    false,
                )
                assert.equal(p.add.requests().length, 0)
                const previous = calls
                const stale = new Date(now - 900001).toISOString()
                yield* bot.emit("GUILD_MEMBER_ADD", {
                    ...f.member({ user: f.user({ id: p.targetId }), joined_at: stale }),
                    guild_id: f.ids.guild,
                })
                yield* bot.idle()
                assert.equal(calls, previous)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("choosing on a panel edited after it was published says to publish it again", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                yield* bot.ready()
                savedPanel(bot, p, remote, "reaction").revision = 2
                yield* emit(bot, "!roles choose colors ✅", p.targetId)
                assert.equal(
                    (p.send.requests().at(-1)!.body as { content: string }).content,
                    "Panel colors was edited after it was published. An administrator must publish it again",
                )
                assert.equal(remote.calls.filter((c) => c.method === "evaluate").length, 0)
            }),
        ),
    )
})
test("retiring or deleting a panel withdraws every revision that still has configuration, earlier ones first", async () => {
    for (const command of ["retire", "delete"] as const) {
        const f = createFixtures(),
            remote = rolesBoundary(),
            moderation = boundary()
        const query = remote.store.query
        // An edit and a republish left grants under revisions 1 and 2, and the panel's current revision is 3
        remote.store.query = (input) =>
            input.operation.type === "configuration-list"
                ? Effect.succeed({
                      type: "configurations",
                      references: [3, 1, 2, 1].map((revision) => ({
                          consumerKey: `panel:colors:${revision}`,
                          roleId: "900000000000000001",
                      })),
                  })
                : query(input)
        remote.store.manage = (input) => {
            remote.calls.push({ method: "manage", input })
            const op = input.operation
            if (op.type !== "withdraw") return Effect.fail(new RolesStoreError({ operation: "manage", status: 404 }))
            return Effect.succeed({
                duplicate: false,
                type: "withdrawal",
                withdrawal: {
                    withdrawalId: `synthetic_job_${op.revision}`,
                    consumerKey: `panel:colors:${op.revision}`,
                    step: 1,
                    status: "complete",
                    remainingAtLeast: 0,
                    hasMore: false,
                    deletePanel: op.deletePanel === true,
                    targets: [],
                },
            })
        }
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions(
                            { token, serverId: f.ids.guild },
                            { moderation: moderation.store, roles: remote.store },
                        ),
                    )
                    const p = nativeRoles(bot)
                    yield* bot.ready()
                    const panel = savedPanel(bot, p, remote, "reaction")
                    panel.revision = 3
                    panel.published!.revision = 3
                    yield* emit(bot, `!roles ${command} colors`)
                    assert.deepEqual(
                        remote.calls
                            .filter((c) => c.method === "manage")
                            .map((c) => (c.input as RolesManageRequest).operation),
                        [
                            { type: "withdraw", name: "colors", revision: 1 },
                            { type: "withdraw", name: "colors", revision: 2 },
                            {
                                type: "withdraw",
                                name: "colors",
                                revision: 3,
                                ...(command === "delete" ? { deletePanel: true } : {}),
                            },
                        ],
                    )
                    assert.equal(bot.failures().length, 0)
                }),
            ),
        )
    }
})

test("a stalled earlier revision stops the deletion, and next withdraws the rest of the revisions once it is done", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        moderation = boundary()
    let stalled = true
    const query = remote.store.query
    const withdrawal = (revision: number, status: "complete" | "blocked", deletePanel = false) => ({
        withdrawalId: `synthetic_job_${revision}`,
        consumerKey: `panel:colors:${revision}`,
        step: 1,
        status,
        remainingAtLeast: status === "complete" ? 0 : 1,
        hasMore: false,
        deletePanel,
        targets: [],
    })
    remote.store.query = (input) =>
        input.operation.type === "configuration-list"
            ? Effect.succeed({
                  type: "configurations",
                  references: [1, 3].map((revision) => ({
                      consumerKey: `panel:colors:${revision}`,
                      roleId: "900000000000000001",
                  })),
              })
            : input.operation.type === "withdrawal-open"
              ? Effect.succeed({ type: "withdrawal", withdrawal: withdrawal(1, "blocked") })
              : query(input)
    remote.store.manage = (input) => {
        remote.calls.push({ method: "manage", input })
        const op = input.operation
        if (op.type !== "withdraw") return Effect.fail(new RolesStoreError({ operation: "manage", status: 404 }))
        return Effect.succeed({
            duplicate: false,
            type: "withdrawal",
            withdrawal: withdrawal(op.revision, op.revision === 1 && stalled ? "blocked" : "complete", op.deletePanel),
        })
    }
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot)
                yield* bot.ready()
                const panel = savedPanel(bot, p, remote, "reaction")
                panel.revision = 3
                panel.published!.revision = 3
                const revisions = () =>
                    remote.calls
                        .filter((c) => c.method === "manage")
                        .map((c) => (c.input as RolesManageRequest).operation)
                        .map((op) => (op.type === "withdraw" ? op.revision : undefined))
                const last = () => (p.send.requests().at(-1)!.body as { content: string }).content
                yield* emit(bot, "!roles delete colors")
                // Only the earlier revision ran, and the reply says to send delete again, not that the panel is retired
                assert.deepEqual(revisions(), [1])
                assert.match(last(), /^Stopped, at least 1 left\nContinue: `!roles delete colors`$/)
                stalled = false
                yield* emit(bot, "!roles next colors")
                // Continuing runs the earlier revision again and then the current one
                assert.deepEqual(revisions(), [1, 1, 3])
                assert.equal(last(), "Retired. The roles it gave are removed")
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("NeonFlux's own reactions on a role panel read nothing and log no warning, while a member's reaction still gives the role", async () => {
    const f = createFixtures(),
        remote = rolesBoundary(),
        logged: string[] = []
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: boundary().store, roles: remote.store },
                    ),
                )
                const p = nativeRoles(bot),
                    panel = savedPanel(bot, p, remote)
                remote.current.panelsEnabled = true
                const reactors = bot.rest.respond(
                    (r) => new URL(r.url).pathname.endsWith("/users"),
                    () => ({
                        body: {
                            items: [{ id: p.targetId, username: "Synthetic reactor" }],
                            has_more: false,
                            next_after: null,
                        },
                    }),
                )
                yield* bot.ready()
                yield* bot.idle()
                const target = {
                    guild_id: f.ids.guild,
                    channel_id: f.ids.channel,
                    message_id: panel.published!.messageId,
                }
                const reads = () =>
                    p.ownMember.requests().length + p.target.requests().length + reactors.requests().length
                const before = { calls: remote.calls.length, reads: reads() }
                // The reactions NeonFlux adds to a panel it posts come back as events. Here its member comes without the bot flag,
                // so only the own reaction check keeps the role path from taking NeonFlux for a member
                const { guild_id: _, ...ownMember } = f.member({
                    user: { id: f.ids.bot, username: "fixture-bot" } as ReturnType<typeof f.botUser>,
                    communication_disabled_until: null,
                })
                yield* bot.emit("MESSAGE_REACTION_ADD", {
                    ...target,
                    user_id: f.ids.bot,
                    emoji: { name: "✅" },
                    member: ownMember,
                })
                yield* bot.emit("MESSAGE_REACTION_ADD_MANY", {
                    ...target,
                    reactions: [{ user_id: f.ids.bot, emoji: { name: "✅" } }],
                })
                yield* bot.emit("MESSAGE_REACTION_REMOVE", { ...target, user_id: f.ids.bot, emoji: { name: "✅" } })
                yield* bot.idle()
                assert.deepEqual(
                    logged.filter((line) => line.includes("could not be handled")),
                    [],
                )
                assert.deepEqual(remote.calls.slice(before.calls), [])
                assert.equal(reads(), before.reads)
                assert.equal(p.add.requests().length + p.remove.requests().length, 0)
                // A member's reaction on the same panel still gives the role
                yield* bot.emit("MESSAGE_REACTION_ADD", { ...target, user_id: p.targetId, emoji: { name: "✅" } })
                yield* bot.idle()
                assert.equal(p.roleIds.has(p.role.id), true)
                assert.equal(p.add.requests().length, 1)
                assert.deepEqual(
                    logged.filter((line) => line.includes("could not be handled")),
                    [],
                )
                assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
            }),
        ).pipe(
            Effect.provide(
                Logger.layer([
                    Logger.make(({ message }) => {
                        logged.push(String(Array.isArray(message) ? message[0] : message))
                    }),
                ]),
            ),
        ),
    )
})
