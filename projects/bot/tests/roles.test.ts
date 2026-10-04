import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Deferred, Effect, Fiber } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { evaluateRoleRequest, performRoleGrant, verifyRolePanel } from "../src/roles.ts"
import { handleRoleReaction } from "../src/roles.ts"
import { RolesStoreError } from "../src/roles-store.ts"
import { boundary, token } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { rolesBoundary } from "./roles-fixture.ts"
import { nativeRoles, savedPanel } from "./roles-native-fixture.ts"

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const emit = (bot: Bot, content: string, userId = bot.fixtures.ids.user) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content, author: bot.fixtures.user({ id: userId }) })).pipe(Effect.andThen(bot.idle()))

test("legacy role panel snapshots compare omitted rich color without hiding color or text drift", async t => {
    for (const scenario of [
        { name: "Omitted color matches zero", expected: undefined, color: 0, title: "Rules", accepted: true },
        { name: "Matching nonzero remains valid", expected: 4023992, color: 4023992, title: "Rules", accepted: true },
        { name: "Nonzero mismatch is rejected", expected: 4023992, color: 0, title: "Rules", accepted: false },
        { name: "Text drift is rejected", expected: undefined, color: 0, title: "Changed", accepted: false },
    ]) await t.test(scenario.name, async () => {
        const remote = rolesBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-color-token" }), p = nativeRoles(bot), panel = savedPanel(bot, p, remote)
            panel.published!.content = { content: "Rules", embed: { title: "Rules", ...(scenario.expected === undefined ? {} : { color: scenario.expected }) } }
            p.messages.set(panel.published!.messageId, bot.fixtures.message({ id: panel.published!.messageId, author: bot.fixtures.botUser(), content: "Rules", embeds: [{ type: "rich", title: scenario.title, color: scenario.color }] }))
            const original = structuredClone(panel.published)
            const checked = yield* verifyRolePanel(bot.client, bot.fixtures.ids.guild, bot.fixtures.ids.user, panel).pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }))
            assert.equal(checked, scenario.accepted)
            assert.deepEqual(panel.published, original)
            assert.equal(p.add.requests().length, 0)
            assert.equal(p.remove.requests().length, 0)
        })))
    })
})
test("native reaction additions and removals read current targeted presence and ignore other messages", async () => {
    const f = createFixtures(), remote = rolesBoundary(), moderation = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, roles: remote.store }))
        const p = nativeRoles(bot), panel = savedPanel(bot, p, remote)
        remote.current.panelsEnabled = true
        let present = true
        const reactions = bot.rest.respond((request) => new URL(request.url).pathname.endsWith("/users"), () => ({ body: {
            items: present ? [{ id: p.targetId, username: "Synthetic reactor" }] : [], has_more: false, next_after: null } }))
        yield* bot.ready()
        const event = { guild_id: f.ids.guild, channel_id: f.ids.channel, message_id: panel.published!.messageId, user_id: p.targetId, emoji: { name: "✅" } }
        yield* bot.emit("MESSAGE_REACTION_ADD", event); yield* bot.idle()
        assert.equal(p.roleIds.has(p.role.id), true)
        present = false
        yield* bot.emit("MESSAGE_REACTION_REMOVE", event); yield* bot.idle()
        assert.equal(p.roleIds.has(p.role.id), false)
        assert.equal(reactions.requests().length, 2)
        for (const request of reactions.requests()) {
            const url = new URL(request.url)
            assert.equal(url.searchParams.get("limit"), "1")
            assert.equal(url.searchParams.get("after"), (BigInt(p.targetId) - 1n).toString())
        }
        yield* bot.emit("MESSAGE_REACTION_ADD", { ...event, message_id: f.nextId() }); yield* bot.idle()
        assert.equal(reactions.requests().length, 2)
        assert.equal(p.add.requests().length, 1)
        assert.equal(remote.calls.filter((c) => c.method === "evaluate").length, 4)
        assert.equal(bot.failures().length, 0)
    })))
})

test("rejoining with a retained current rules reaction acknowledges the new exact epoch before autorole", async () => {
    const f = createFixtures(), remote = rolesBoundary(), moderation = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, roles: remote.store }))
        const p = nativeRoles(bot), panel = savedPanel(bot, p, remote, "verification")
        remote.current.verificationEnabled = true; remote.current.autoroleEnabled = true; remote.current.autoroleIds = [p.second.id]
        const joinedAt = new Date(yield* Clock.currentTimeMillis).toISOString().replace(/Z$/, "4567Z")
        p.target.remove()
        bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({ body: f.member({ user: f.user({ id: p.targetId }), joined_at: joinedAt,
            roles: [...p.roleIds], communication_disabled_until: null }) }))
        bot.rest.respond((request) => new URL(request.url).pathname.endsWith("/users"), { body: { items: [{ id: p.targetId, username: "Returning member" }], has_more: false, next_after: null } })
        yield* bot.ready()
        yield* bot.emit("GUILD_MEMBER_ADD", { ...f.member({ user: f.user({ id: p.targetId }), joined_at: joinedAt }), guild_id: f.ids.guild }); yield* bot.idle()
        const evaluated = remote.calls.filter((c) => c.method === "evaluate").map((c) => c.input as C.RolesEvaluateRequest)
        assert.equal(evaluated[0]?.operation.type, "verify")
        assert.equal(evaluated.findIndex((c) => c.operation.type === "join") > 0, true)
        assert.equal(evaluated.every((c) => c.context.joinedAt === joinedAt), true)
        assert.equal((evaluated[0]?.operation as Extract<C.RolesEvaluateOperation, { type: "verify" }>).messageId, panel.published!.messageId)
        assert.equal(p.roleIds.has(p.role.id), true); assert.equal(p.roleIds.has(p.second.id), true); assert.equal(p.roleIds.has(p.targetRole.id), true)
        assert.equal(bot.failures().length, 0)
    })))
})

test("Autorole reservation commands configure absent user IDs without fetching targets and keep native roles additive", async () => {
    const f = createFixtures(), remote = rolesBoundary(), moderation = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, roles: remote.store }))
        const p = nativeRoles(bot), absentId = f.nextId()
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
    })))
})

test("Native joins apply all forty default and reserved roles using individual SDK writes while preserving existing roles", async () => {
    const f = createFixtures(), remote = rolesBoundary(), moderation = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, roles: remote.store }))
        const p = nativeRoles(bot), roles = Array.from({ length: 40 }, () => bot.fixtures.role({ position: 2, permissions: "0" }))
        bot.rest.respond("GET /guilds/:id/roles", { body: [...p.roles, p.role, p.second, ...roles] })
        remote.current.autoroleEnabled = true
        remote.current.autoroleIds = roles.slice(0, 20).map(role => role.id)
        remote.current.reservations = [{ userId: p.targetId, roleIds: roles.slice(20).map(role => role.id) }]
        const joinedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
        p.target.remove()
        bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({ body: f.member({ user: f.user({ id: p.targetId }), joined_at: joinedAt, roles: [...p.roleIds], communication_disabled_until: null }) }))
        yield* bot.ready()
        yield* bot.emit("GUILD_MEMBER_ADD", { ...f.member({ user: f.user({ id: p.targetId }), joined_at: joinedAt }), guild_id: f.ids.guild })
        yield* bot.idle()
        assert.equal(bot.failures().length, 0, JSON.stringify(bot.failures()))
        assert.equal(p.add.requests().length, 40, JSON.stringify(remote.calls.map(call => call.method)))
        assert.equal(p.remove.requests().length, 0)
        assert.deepEqual(p.roleIds, new Set([p.targetRole.id, ...roles.map(role => role.id)]))
        assert.equal(remote.calls.filter(call => call.method === "evaluate").length, 41)
        assert.equal(bot.failures().length, 0)
    })))
})

test("native role commands compose current panels, explicit choices and reusable verification without replacing roles", async () => {
    const f = createFixtures(), publishing = publishingBoundary(), remote = rolesBoundary(publishing.store), moderation = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, publishing: publishing.store, roles: remote.store }))
        const p = nativeRoles(bot)
        yield* bot.ready()
        for (const command of [
            "!publish create colors", '!publish set colors content "Choose a role @everyone"', "!roles create colors exclusive",
            `!roles map colors 🔵 <@&${p.role.id}>`, `!roles requires colors 🔵 <@&${p.targetRole.id}>`, "!roles excludes colors 🔵 none",
            `!roles publish colors <#${f.ids.channel}> colors`, "!roles module on", "!roles show colors", "!roles list", "!roles help",
            "!publish create rules", '!publish set rules content "Read the current rules"', `!verify configure <@&${p.second.id}> ✅`,
            `!verify publish <#${f.ids.channel}> rules`, "!verify module on",
        ]) yield* emit(bot, command)
        assert.equal(remote.panels.get("colors")?.exclusive, true)
        assert.ok(remote.panels.get("rules")?.published)
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
        for (const request of p.send.requests()) assert.deepEqual((request.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        assert.equal(bot.failures().length, 0)
    })))
})

test("native role grants bind membership epoch, exact presence and once-only claim before individual mutation", async () => {
    const f = createFixtures(), remote = rolesBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
        const p = nativeRoles(bot)
        yield* bot.ready()
        const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt
        const grant: C.RolesGrant = { attemptId: "synthetic_attempt", ownershipId: "synthetic_owner", generation: 1, sourceId: "synthetic_source", action: "add",
            userId: p.targetId, joinedAt, roleId: p.role.id, botId: f.ids.bot, expectedPresent: false, consumerKey: "panel:colors:1",
            dispatchExpiresAt: (yield* Clock.currentTimeMillis) + 180000, nativeDeadlineMs: 5000 }
        remote.attempts.set(grant.attemptId, { ...grant, createdAt: yield* Clock.currentTimeMillis, outcome: "pending" })
        const wrongEpoch = yield* performRoleGrant(remote.store, f.ids.guild, bot.client, { ...grant, joinedAt: "2020-01-01T00:00:00Z" })
        assert.equal(wrongEpoch.outcome, "failed"); assert.equal(p.add.requests().length, 0)
        remote.attempts.get(grant.attemptId)!.outcome = "pending"
        const applied = yield* performRoleGrant(remote.store, f.ids.guild, bot.client, grant)
        assert.deepEqual(applied, { outcome: "succeeded", acknowledged: true })
        assert.equal(p.add.requests().length, 1)
        const repeated = yield* performRoleGrant(remote.store, f.ids.guild, bot.client, grant)
        assert.equal(repeated.outcome, "failed"); assert.equal(p.add.requests().length, 1)
        assert.deepEqual([...p.roleIds].sort(), [p.targetRole.id, p.role.id].sort())
    })))
})

test("Role-only grants allow owners and higher-ranked members while retaining safe role and native permission boundaries", async t => {
    for (const scenario of ["owner", "higher-member", "unsafe-role", "above-bot", "missing-member", "missing-ManageRoles"] as const) await t.test(scenario, async () => {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const remote = rolesBoundary(), bot = yield* createTestBot({ token: "synthetic-role-only-authority" }), f = bot.fixtures, p = nativeRoles(bot)
            const userId = scenario === "owner" ? f.ids.user : p.targetId
            const highRole = f.role({ position: 30, permissions: "0" })
            const role = { ...p.role, position: scenario === "above-bot" ? 25 : p.role.position, permissions: scenario === "unsafe-role" ? Permissions.ManageRoles.toString() : "0" }
            bot.rest.respond("GET /guilds/:id/roles", { body: [...p.roles.map(item => item.id === p.botRole.id && scenario === "missing-ManageRoles" ? { ...item, permissions: "0" } : item), role, p.second, highRole] })
            const memberRoles = new Set([scenario === "owner" ? p.actorRole.id : highRole.id])
            const joinedAt = "2026-10-01T12:00:00Z"
            bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${userId}`, scenario === "missing-member" ? { status: 404, body: { message: "Synthetic unavailable member" } }
                : () => ({ body: f.member({ user: f.user({ id: userId }), roles: [...memberRoles], joined_at: joinedAt, communication_disabled_until: null }) }))
            p.add.remove(); p.remove.remove()
            const add = bot.rest.respond("PUT /guilds/:id/members/:id/roles/:id", () => { memberRoles.add(role.id); return { status: 204 } })
            const remove = bot.rest.respond("DELETE /guilds/:id/members/:id/roles/:id", () => { memberRoles.delete(role.id); return { status: 204 } })
            const grant: C.RolesGrant = { attemptId: "synthetic_role_only_add", ownershipId: "synthetic_role_only_owner", generation: 1, sourceId: "synthetic_source", action: "add",
                userId, joinedAt, roleId: role.id, botId: f.ids.bot, expectedPresent: false, consumerKey: "panel:colors:1", dispatchExpiresAt: Number.MAX_SAFE_INTEGER, nativeDeadlineMs: 5000 }
            remote.attempts.set(grant.attemptId, { ...grant, createdAt: yield* Clock.currentTimeMillis, outcome: "pending" })
            const result = yield* performRoleGrant(remote.store, f.ids.guild, bot.client, grant)
            if (scenario === "owner" || scenario === "higher-member") {
                assert.deepEqual(result, { outcome: "succeeded", acknowledged: true })
                assert.equal(add.requests().length, 1)
                assert(memberRoles.has(role.id))
                const removal: C.RolesGrant = { ...grant, attemptId: "synthetic_role_only_remove", sourceId: "synthetic_remove_source", generation: 2, action: "remove", expectedPresent: true }
                remote.attempts.set(removal.attemptId, { ...removal, createdAt: yield* Clock.currentTimeMillis, outcome: "pending" })
                assert.deepEqual(yield* performRoleGrant(remote.store, f.ids.guild, bot.client, removal), { outcome: "succeeded", acknowledged: true })
                assert.equal(remove.requests().length, 1)
                assert.deepEqual([...memberRoles], [scenario === "owner" ? p.actorRole.id : highRole.id])
            } else {
                assert.equal(result.outcome, "failed")
                assert.equal(add.requests().length, 0)
                assert.equal(remove.requests().length, 0)
                assert.equal(remote.calls.some(call => call.method === "dispatch"), false)
            }
        })))
    })
})

test("duplicate role claim cannot dispatch or acknowledge another performer", async () => {
    const f = createFixtures(), remote = rolesBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
        const p = nativeRoles(bot); yield* bot.ready()
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
        p.add.remove()
        const add = bot.rest.respond("PUT /guilds/:id/members/:id/roles/:id", () => Effect.runPromise(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.map(() => {
            p.roleIds.add(p.role.id); return { status: 204 }
        }))))
        const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt
        const grant: C.RolesGrant = { attemptId: "synthetic_concurrent", ownershipId: "synthetic_owner", generation: 1, sourceId: "synthetic_source", action: "add",
            userId: p.targetId, joinedAt, roleId: p.role.id, botId: f.ids.bot, expectedPresent: false, consumerKey: "panel:colors:1", dispatchExpiresAt: (yield* Clock.currentTimeMillis) + 180000, nativeDeadlineMs: 5000 }
        let claimed = false
        const store = { ...remote.store, dispatch: (input: C.RolesDispatchRequest) => {
            remote.calls.push({ method: "dispatch", input }); const winner = !claimed; claimed = true
            return Effect.succeed({ claimed: winner, dispatchExpiresAt: grant.dispatchExpiresAt, nativeDeadlineMs: 5000 as const })
        } }
        const first = yield* performRoleGrant(store, f.ids.guild, bot.client, grant).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.await(entered)
        const duplicate = yield* performRoleGrant(store, f.ids.guild, bot.client, grant)
        assert.equal(duplicate.acknowledged, false)
        assert.equal(remote.calls.some((c) => c.method === "outcome"), false)
        yield* Deferred.succeed(release, undefined)
        assert.equal((yield* Fiber.join(first)).outcome, "succeeded")
        assert.equal(add.requests().length, 1)
    })))
})

test("invoked role failures remain uncertain and never prove managed removal ownership", async () => {
    for (const status of [403, 500, 200]) {
        const f = createFixtures(), remote = rolesBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
            const p = nativeRoles(bot); yield* bot.ready()
            p.add.remove()
            const add = bot.rest.respond("PUT /guilds/:id/members/:id/roles/:id", { status, body: { message: "Synthetic private rejection" } })
            const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt
            const grant: C.RolesGrant = { attemptId: "synthetic_unknown", ownershipId: "synthetic_owner", generation: 1, sourceId: "synthetic_source", action: "add",
                userId: p.targetId, joinedAt, roleId: p.role.id, botId: f.ids.bot, expectedPresent: false, consumerKey: "panel:colors:1", dispatchExpiresAt: Number.MAX_SAFE_INTEGER, nativeDeadlineMs: 5000 }
            remote.attempts.set(grant.attemptId, { ...grant, createdAt: yield* Clock.currentTimeMillis, outcome: "pending" })
            const result = yield* performRoleGrant(remote.store, f.ids.guild, bot.client, grant)
            assert.equal(result.outcome, "uncertain")
            assert.equal(add.requests().length, 1)
            assert.equal(p.remove.requests().length, 0)
            assert.equal(JSON.stringify(result).includes("private"), false)
        })))
    }
})

test("interruption after role dispatch retains reservation without an invented terminal acknowledgement", async () => {
    const f = createFixtures(), remote = rolesBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
        const p = nativeRoles(bot); yield* bot.ready()
        p.add.remove()
        const entered = yield* Deferred.make<void>(), released = yield* Deferred.make<void>()
        const add = bot.rest.respond("PUT /guilds/:id/members/:id/roles/:id", () => Effect.runPromise(Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(released)), Effect.as({ status: 204 }))))
        const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt
        const grant: C.RolesGrant = { attemptId: "synthetic_interruption", ownershipId: "synthetic_owner", generation: 1, sourceId: "synthetic_source", action: "add",
            userId: p.targetId, joinedAt, roleId: p.role.id, botId: f.ids.bot, expectedPresent: false, consumerKey: "panel:colors:1", dispatchExpiresAt: Number.MAX_SAFE_INTEGER, nativeDeadlineMs: 5000 }
        remote.attempts.set(grant.attemptId, { ...grant, createdAt: yield* Clock.currentTimeMillis, outcome: "pending" })
        const fiber = yield* performRoleGrant(remote.store, f.ids.guild, bot.client, grant).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.await(entered)
        yield* Fiber.interrupt(fiber)
        yield* Deferred.succeed(released, undefined)
        assert.equal(add.requests().length, 1)
        assert.equal(remote.calls.filter((c) => c.method === "outcome").length, 0)
        assert.equal(remote.attempts.get(grant.attemptId)?.outcome, "pending")
    })))
})

test("one staff withdrawal command scopes every role independently and propagates current owner authority under DEFCON 1", async () => {
    const f = createFixtures(), remote = rolesBoundary(), moderation = boundary()
    let claims: C.RolesClaim[] = []
    remote.store.query = (input) => {
        remote.calls.push({ method: "query", input })
        if (input.operation.type === "claim-list") return Effect.succeed({ type: "claims", claims })
        return Effect.succeed({ type: "settings", settings: remote.current })
    }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, roles: remote.store }))
        const p = nativeRoles(bot); yield* bot.ready()
        p.roleIds.add(p.role.id); p.roleIds.add(p.second.id)
        const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt
        claims = [p.role.id, p.second.id].map((roleId) => ({ ownershipId: `synthetic_${roleId}`, userId: p.targetId, joinedAt, roleId, generation: 1,
            owned: true, status: "idle", consumerKeys: ["panel:colors:1"] }))
        moderation.current.defcon = 1
        yield* emit(bot, `!roles withdraw colors <@${p.targetId}>`)
        const initial = remote.calls.filter((c) => c.method === "evaluate").map((c) => c.input as C.RolesEvaluateRequest).filter((c) => !c.continuationAttemptId)
        assert.equal(initial.length, 2)
        assert.equal(new Set(initial.map((c) => c.sourceId)).size, 2)
        assert.equal(initial.every((c) => c.actor?.isOwner === true && c.actor.userId === f.ids.user), true)
        const dispatch = remote.calls.filter((c) => c.method === "dispatch").map((c) => c.input as C.RolesDispatchRequest)
        assert.equal(dispatch.every((c) => c.actor?.isOwner === true), true)
        assert.equal(p.remove.requests().length, 2)
        assert.deepEqual([...p.roleIds], [p.targetRole.id])
        assert.equal(bot.failures().length, 0)
    })))
})

// A synthetic withdrawal that pages ten targets at a time and keeps configuration references until withdraw-next runs without targets
function pagedWithdrawal(remote: ReturnType<typeof rolesBoundary>, failing: Set<string>) {
    const state = { targets: [] as C.RolesWithdrawal["targets"], configurations: 1, step: 1, status: "pending" as C.RolesWithdrawal["status"] }
    const view = (cursor?: string): C.RolesWithdrawal => {
        const start = cursor === undefined ? 0 : Number(cursor), targets = state.targets.slice(start, start + 10)
        return { withdrawalId: "synthetic_job", consumerKey: "panel:colors:1", step: state.step, status: state.status, remainingAtLeast: state.targets.length + state.configurations,
            hasMore: state.targets.length > start + 10 || state.configurations > 0, deletePanel: false, targets, ...(state.targets.length > start + 10 ? { nextCursor: String(start + 10) } : {}) }
    }
    const originalEvaluate = remote.store.evaluate
    remote.store.manage = (input) => {
        remote.calls.push({ method: "manage", input })
        if (input.operation.type === "withdraw-next") { state.step++; if (!state.targets.length) { state.configurations = 0; state.status = "complete" } }
        return Effect.succeed({ duplicate: false, type: "withdrawal", withdrawal: view() })
    }
    remote.store.query = (input) => {
        remote.calls.push({ method: "query", input })
        return Effect.succeed({ type: "withdrawal", withdrawal: view((input.operation as Extract<C.RolesQueryRequest["operation"], { type: "withdrawal-show" }>).cursor) })
    }
    remote.store.evaluate = (input) => {
        const roleId = (input.operation as Extract<C.RolesEvaluateOperation, { type: "withdraw" }>).roleId
        if (failing.has(roleId)) return Effect.fail(new RolesStoreError({ operation: "evaluate", status: 503 }))
        return originalEvaluate(input).pipe(Effect.tap((result) => Effect.sync(() => { if (!result.grant) state.targets = state.targets.filter((t) => t.roleId !== roleId) })))
    }
    return state
}

test("withdrawing the last owned role continues into configuration cleanup", async () => {
    const f = createFixtures(), remote = rolesBoundary(), state = pagedWithdrawal(remote, new Set())
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: boundary().store, roles: remote.store }))
        const p = nativeRoles(bot); yield* bot.ready(); p.roleIds.add(p.role.id)
        state.targets = [{ userId: p.targetId, joinedAt: (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt, roleId: p.role.id }]
        yield* emit(bot, "!roles next synthetic_job")
        assert.equal(p.roleIds.has(p.role.id), false)
        assert.equal(state.status, "complete")
    })))
})

test("withdrawal pages past failed lookups and keeps them for later recovery", async () => {
    const f = createFixtures(), remote = rolesBoundary(), failing = new Set(Array.from({ length: 10 }, (_, i) => String(900000000000000000n + BigInt(i))))
    const state = pagedWithdrawal(remote, failing)
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: boundary().store, roles: remote.store }))
        const p = nativeRoles(bot); yield* bot.ready(); p.roleIds.add(p.role.id)
        const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt
        state.targets = [...[...failing].map((roleId) => ({ userId: p.targetId, joinedAt, roleId })), { userId: p.targetId, joinedAt, roleId: p.role.id }]
        yield* emit(bot, "!roles next synthetic_job")
        assert.equal(p.roleIds.has(p.role.id), false)
        assert.equal(state.targets.length, 10)
        assert.equal(state.status, "pending")
    })))
})

test("a bounded retirement batch removes only exact current owned targets and settles departed metadata without touching a rejoin", async () => {
    const f = createFixtures(), remote = rolesBoundary(), moderation = boundary()
    let job: C.RolesWithdrawal | undefined
    const originalEvaluate = remote.store.evaluate
    remote.store.manage = (input) => {
        remote.calls.push({ method: "manage", input })
        assert(job)
        if (input.operation.type === "withdraw-departed") {
            const joinedAt = input.operation.joinedAt
            job.targets = job.targets.filter((t) => t.joinedAt !== joinedAt); job.remainingAtLeast = job.targets.length
            job.step++
        }
        if (input.operation.type === "withdraw-next") { job.step++; if (!job.targets.length) job.status = "complete" }
        return Effect.succeed({ duplicate: false, type: "withdrawal", withdrawal: structuredClone(job) })
    }
    remote.store.query = (input) => {
        remote.calls.push({ method: "query", input }); assert(job)
        return Effect.succeed({ type: "withdrawal", withdrawal: structuredClone(job) })
    }
    remote.store.evaluate = (input) => originalEvaluate(input).pipe(Effect.tap((result) => {
        if (!result.grant && job) { job.targets = job.targets.filter((t) => t.roleId !== (input.operation as Extract<C.RolesEvaluateOperation, { type: "withdraw" }>).roleId); job.remainingAtLeast = job.targets.length }
        return Effect.void
    }))
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, roles: remote.store }))
        const p = nativeRoles(bot); yield* bot.ready()
        p.roleIds.add(p.role.id); p.roleIds.add(p.second.id)
        const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt
        job = { withdrawalId: "synthetic_job", consumerKey: "panel:colors:1", step: 1, status: "pending", remainingAtLeast: 2, hasMore: false, deletePanel: false,
            targets: [{ userId: p.targetId, joinedAt, roleId: p.role.id }, { userId: p.targetId, joinedAt: "2020-01-01T00:00:00Z", roleId: p.second.id }] }
        yield* emit(bot, "!roles next synthetic_job")
        assert.equal(p.remove.requests().length, 1)
        assert.equal(p.roleIds.has(p.role.id), false)
        assert.equal(p.roleIds.has(p.second.id), true)
        assert.equal(p.roleIds.has(p.targetRole.id), true)
        const departed = remote.calls.find((c) => c.method === "manage" && (c.input as C.RolesManageRequest).operation.type === "withdraw-departed")?.input as C.RolesManageRequest
        assert.equal((departed.operation as Extract<C.RolesManageOperation, { type: "withdraw-departed" }>).currentJoinedAt, joinedAt)
        assert.equal(job.targets.length, 0)
        assert.equal(bot.failures().length, 0)
    })))
})

test("member reconciliation passes the explicit cursor and never upgrades an uncertain addition into owned removal", async () => {
    const f = createFixtures(), remote = rolesBoundary(), moderation = boundary()
    let claim: C.RolesClaim | undefined
    remote.store.query = (input) => {
        remote.calls.push({ method: "query", input }); assert(claim)
        return Effect.succeed({ type: "claims", claims: [claim] })
    }
    remote.store.reconcile = (input) => {
        remote.calls.push({ method: "reconcile", input }); assert(claim)
        return Effect.succeed({ recorded: true, claim: { ...claim, owned: false, status: "idle" } })
    }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, roles: remote.store }))
        const p = nativeRoles(bot); yield* bot.ready(); p.roleIds.add(p.role.id)
        const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt
        claim = { ownershipId: "synthetic_owner", userId: p.targetId, joinedAt, roleId: p.role.id, generation: 1, owned: false, status: "uncertain", consumerKeys: ["panel:colors:1"],
            attempt: { attemptId: "synthetic_attempt", ownershipId: "synthetic_owner", generation: 1, sourceId: "synthetic_source", action: "add", userId: p.targetId,
                joinedAt, roleId: p.role.id, botId: f.ids.bot, expectedPresent: false, consumerKey: "panel:colors:1", dispatchExpiresAt: 180000, nativeDeadlineMs: 5000,
                createdAt: 0, finishedAt: 1, outcome: "uncertain" } }
        yield* emit(bot, `!roles reconcile colors <@${p.targetId}> "opaque_cursor"`)
        assert.equal((remote.calls.find((c) => c.method === "query")!.input as C.RolesQueryRequest).operation.type, "claim-list")
        const request = remote.calls.find((c) => c.method === "query")!.input as C.RolesQueryRequest
        assert.equal((request.operation as Extract<C.RolesQueryRequest["operation"], { type: "claim-list" }>).cursor, "opaque_cursor")
        assert.equal(remote.calls.filter((c) => c.method === "reconcile").length, 1)
        assert.equal(p.add.requests().length + p.remove.requests().length, 0)
        assert.equal(p.roleIds.has(p.role.id), true)
    })))
})

test("exclusive switching observes old removal before reserving the replacement and preserves unrelated roles", async () => {
    const f = createFixtures(), remote = rolesBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
        const p = nativeRoles(bot); yield* bot.ready(); p.roleIds.add(p.role.id)
        const entered = yield* Deferred.make<void>(), released = yield* Deferred.make<void>()
        p.remove.remove()
        const remove = bot.rest.respond("DELETE /guilds/:id/members/:id/roles/:id", () => Effect.runPromise(Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(released)), Effect.map(() => { p.roleIds.delete(p.role.id); return { status: 204 } }))))
        remote.store.evaluate = (input) => {
            remote.calls.push({ method: "evaluate", input })
            const oldPresent = input.context.roleIds.includes(p.role.id), newPresent = input.context.roleIds.includes(p.second.id)
            if (newPresent) return Effect.succeed({ duplicate: false, status: "unchanged", acknowledgment: { acknowledged: false, accessConfirmed: false, accessRolePresent: false } })
            const grant: C.RolesGrant = { attemptId: oldPresent ? "synthetic_remove" : "synthetic_add", ownershipId: oldPresent ? "synthetic_old" : "synthetic_new",
                generation: oldPresent ? 1 : 2, sourceId: input.sourceId, action: oldPresent ? "remove" : "add", userId: p.targetId, joinedAt: input.context.joinedAt,
                roleId: oldPresent ? p.role.id : p.second.id, botId: f.ids.bot, expectedPresent: oldPresent, consumerKey: "panel:colors:1", dispatchExpiresAt: Number.MAX_SAFE_INTEGER, nativeDeadlineMs: 5000 }
            remote.attempts.set(grant.attemptId, { ...grant, createdAt: input.createdAt, outcome: "pending" })
            return Effect.succeed({ duplicate: false, status: oldPresent ? "partial" : "reserved", acknowledgment: { acknowledged: false, accessConfirmed: false, accessRolePresent: false }, grant })
        }
        const operation: C.RolesEvaluateOperation = { type: "choose", name: "colors", revision: 1, roleId: p.second.id, selected: true }
        const fiber = yield* evaluateRoleRequest(remote.store, f.ids.guild, bot.client, { sourceId: "synthetic_exclusive", createdAt: yield* Clock.currentTimeMillis }, p.targetId, operation)
            .pipe(Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.await(entered)
        assert.equal(p.add.requests().length, 0)
        assert.equal(remote.calls.filter((c) => c.method === "evaluate").length, 1)
        yield* Deferred.succeed(released, undefined); yield* Fiber.join(fiber)
        assert.equal(remove.requests().length, 1); assert.equal(p.add.requests().length, 1)
        const requests = remote.calls.filter((c) => c.method === "evaluate").map((c) => c.input as C.RolesEvaluateRequest)
        assert.equal(requests[1]?.continuationAttemptId, "synthetic_remove")
        assert.equal(requests[1]?.context.roleIds.includes(p.role.id), false)
        assert.equal(requests.every((r) => r.sourceId === "synthetic_exclusive" && JSON.stringify(r.operation) === JSON.stringify(operation)), true)
        assert.deepEqual([...p.roleIds].sort(), [p.targetRole.id, p.second.id].sort())
    })))
})

test("verification acknowledgement does not report access completion after an uncertain native grant", async () => {
    const f = createFixtures(), remote = rolesBoundary(), moderation = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, roles: remote.store }))
        const p = nativeRoles(bot); savedPanel(bot, p, remote, "verification"); remote.current.verificationEnabled = true
        p.add.remove(); const add = bot.rest.respond("PUT /guilds/:id/members/:id/roles/:id", { status: 403, body: { message: "Synthetic rejection" } })
        yield* bot.ready(); yield* emit(bot, "!verify", p.targetId); yield* emit(bot, "!verify status", p.targetId)
        assert.equal(add.requests().length, 1); assert.equal(p.roleIds.has(p.role.id), false)
        const replies = p.send.requests().map((r) => (r.body as { content: string }).content)
        assert.ok(replies.some((s) => s.includes("delivery uncertain") && s.includes("Rules acknowledged: Yes")))
        assert.ok(replies.some((s) => s.includes("Access role present: No") && s.includes("Access confirmed: No")))
        assert.equal(bot.failures().length, 0)
    })))
})

test("explicit withdrawal requires current administrator authority even for the command author", async () => {
    const f = createFixtures(), remote = rolesBoundary(), moderation = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, roles: remote.store }))
        const p = nativeRoles(bot); yield* bot.ready()
        yield* emit(bot, "!roles withdraw colors", p.targetId)
        assert.equal(remote.calls.some((c) => c.method === "evaluate" || c.method === "query"), false)
        assert.equal(p.remove.requests().length, 0)
        assert.ok(p.send.requests().some((r) => (r.body as { content: string }).content.includes("Only the server owner or an administrator")))
        assert.equal(bot.failures().length, 0)
    })))
})

test("clear choice scopes every mapped role while ambiguous reactions preserve the existing choice", async () => {
    const f = createFixtures(), remote = rolesBoundary(), moderation = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, roles: remote.store }))
        const p = nativeRoles(bot), panel = savedPanel(bot, p, remote)
        panel.mappings.push({ emoji: "🔵", roleId: p.second.id, prerequisiteRoleIds: [], exclusionRoleIds: [] })
        panel.published!.mappings = structuredClone(panel.mappings)
        remote.current.panelsEnabled = true; p.roleIds.add(p.role.id); p.roleIds.add(p.second.id)
        yield* bot.ready(); yield* emit(bot, "!roles choose colors none", p.targetId)
        const requests = remote.calls.filter((c) => c.method === "evaluate").map((c) => c.input as C.RolesEvaluateRequest).filter((c) => !c.continuationAttemptId)
        assert.equal(requests.length, 2); assert.equal(new Set(requests.map((r) => r.sourceId)).size, 2)
        assert.equal(p.remove.requests().length, 2); assert.deepEqual([...p.roleIds], [p.targetRole.id])
        p.roleIds.add(p.role.id); panel.exclusive = true; panel.published!.exclusive = true
        remote.store.evaluate = (input) => { remote.calls.push({ method: "evaluate", input }); return Effect.succeed({ duplicate: false, status: "ambiguous",
            acknowledgment: { acknowledged: false, accessConfirmed: false, accessRolePresent: false } }) }
        const reads = bot.rest.respond((r) => new URL(r.url).pathname.endsWith("/users"), { body: { items: [{ id: p.targetId, username: "Current reactor" }], has_more: false, next_after: null } })
        yield* bot.emit("MESSAGE_REACTION_ADD", { guild_id: f.ids.guild, channel_id: f.ids.channel, message_id: panel.published!.messageId, user_id: p.targetId, emoji: { name: "🔵" } }); yield* bot.idle()
        assert.equal(reads.requests().length, 2); assert.equal(p.add.requests().length, 0); assert.equal(p.remove.requests().length, 2)
        assert.equal(p.roleIds.has(p.role.id), true)
        assert.ok(p.send.requests().some((r) => (r.body as { content: string }).content.includes("multiple exclusive choices")))
        assert.equal(bot.failures().length, 0)
    })))
})

test("fresh role configuration authority cannot reuse an administrator claim after a native downgrade", async () => {
    const f = createFixtures(), remote = rolesBoundary(), moderation = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, roles: remote.store }))
        const p = nativeRoles(bot); savedPanel(bot, p, remote)
        let downgraded = false
        p.guildRoute.remove(); p.rolesRoute.remove()
        bot.rest.respond("GET /guilds/:id", () => ({ body: f.guild({ owner_id: downgraded ? p.targetId : f.ids.user }) }))
        bot.rest.respond("GET /guilds/:id/roles", () => ({ body: [...p.roles, p.role, p.second].map((r) => r.id === p.actorRole.id && downgraded ? { ...r, permissions: "0" } : r) }))
        const originalQuery = remote.store.query
        remote.store.query = (input) => originalQuery(input).pipe(Effect.tap(() => { if (input.operation.type === "panel-show") downgraded = true; return Effect.void }))
        remote.store.manage = (input) => { remote.calls.push({ method: "manage", input }); return Effect.fail(new RolesStoreError({ operation: "manage", status: 403 })) }
        yield* bot.ready(); yield* emit(bot, `!roles map colors 🔵 <@&${p.second.id}>`)
        const input = remote.calls.find((c) => c.method === "manage")!.input as C.RolesManageRequest
        assert.equal(input.actor.isOwner, false); assert.equal(input.actor.isAdministrator, false)
        assert.equal(remote.panels.get("colors")!.mappings.length, 1)
        assert.equal(p.add.requests().length + p.remove.requests().length, 0)
        assert.equal(bot.failures().length, 0)
    })))
})

test("queued reaction changes refresh current presence after the previous member operation finishes", async () => {
    const f = createFixtures(), remote = rolesBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }))
        const p = nativeRoles(bot), panel = savedPanel(bot, p, remote); remote.current.panelsEnabled = true
        let present = true
        const reads = bot.rest.respond((r) => new URL(r.url).pathname.endsWith("/users"), () => ({ body: { items: present ? [{ id: p.targetId, username: "Current reactor" }] : [], has_more: false, next_after: null } }))
        const entered = yield* Deferred.make<void>(), released = yield* Deferred.make<void>()
        p.add.remove(); const add = bot.rest.respond("PUT /guilds/:id/members/:id/roles/:id", () => Effect.runPromise(Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(released)), Effect.map(() => { p.roleIds.add(p.role.id); return { status: 204 } }))))
        yield* bot.ready()
        const target = { id: panel.published!.messageId, channelId: f.ids.channel, guildId: f.ids.guild }
        const first = yield* handleRoleReaction(remote.store, f.ids.guild, bot.client, target, p.targetId).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.await(entered); present = false
        const second = yield* handleRoleReaction(remote.store, f.ids.guild, bot.client, target, p.targetId).pipe(Effect.forkScoped({ startImmediately: true }))
        assert.equal(reads.requests().length, 1)
        yield* Deferred.succeed(released, undefined); yield* Fiber.join(first); yield* Fiber.join(second)
        assert.equal(reads.requests().length, 2); assert.equal(add.requests().length, 1); assert.equal(p.remove.requests().length, 1)
        assert.deepEqual([...p.roleIds], [p.targetRole.id])
    })))
})

test("join replay preserves raw epoch across every fresh read and uses the provider event time", async () => {
    const f = createFixtures(), remote = rolesBoundary(), moderation = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, roles: remote.store }))
        const p = nativeRoles(bot); remote.current.autoroleEnabled = true; remote.current.autoroleIds = [p.role.id]
        const now = yield* Clock.currentTimeMillis, epoch = new Date(now).toISOString().replace(/Z$/, "1234Z"), replacement = epoch.replace(/1234Z$/, "5678Z")
        let calls = 0
        p.target.remove(); bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({ body: f.member({ user: f.user({ id: p.targetId }),
            joined_at: ++calls === 1 ? epoch : replacement, roles: [...p.roleIds], communication_disabled_until: null }) }))
        yield* bot.ready()
        yield* bot.emit("GUILD_MEMBER_ADD", { ...f.member({ user: f.user({ id: p.targetId }), joined_at: epoch }), guild_id: f.ids.guild }); yield* bot.idle()
        assert.equal(Date.parse(epoch), Date.parse(replacement))
        assert.equal(remote.calls.some((c) => c.method === "evaluate"), false)
        assert.equal(p.add.requests().length, 0)
        const previous = calls
        const stale = new Date(now - 900001).toISOString()
        yield* bot.emit("GUILD_MEMBER_ADD", { ...f.member({ user: f.user({ id: p.targetId }), joined_at: stale }), guild_id: f.ids.guild }); yield* bot.idle()
        assert.equal(calls, previous); assert.equal(bot.failures().length, 0)
    })))
})
