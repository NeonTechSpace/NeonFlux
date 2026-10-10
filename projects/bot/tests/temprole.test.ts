import assert from "node:assert/strict"
import test from "node:test"
import type { RolesAcknowledgment, RolesAttempt, RolesClaim, RolesEvaluateRequest, RolesEvaluateResult, RolesGrant, RolesReconcileRequest } from "@neonflux/contracts/roles"
import type { TemporaryRoleDefault, TemporaryRoleGrant, TemporaryRoleManageRequest, TemporaryRoleQueryResult, TemporaryRoleWorkOperation } from "@neonflux/contracts/temporary-roles"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { audiences, helpCard } from "../src/help.ts"
import { RolesStoreError } from "../src/roles-store.ts"
import { parseTemporaryRoleCommand, temporaryDuration, temporaryRoleCritical } from "../src/temprole-command.ts"
import type { TemporaryRoleStore } from "../src/temprole-store.ts"
import { settleTemporaryRole, startTemporaryRoleWorker } from "../src/temprole-worker.ts"
import { platform, token } from "./moderation-fixture.ts"
import { rolesBoundary } from "./roles-fixture.ts"
import { nativeRoles } from "./roles-native-fixture.ts"

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
// A text reply as its content and a card as its first embed
const reply = (row: { body: unknown }) => { const body = row.body as { content?: string, embeds?: object[] }; return body.content ?? body.embeds![0] }
const acknowledgment: RolesAcknowledgment = { acknowledged: false, accessConfirmed: false, accessRolePresent: false }

// An in-memory temporary role backend that keeps what the bot sends. Listing hands out the due grants once
function temporaryBoundary(due: TemporaryRoleGrant[] = [], onWork: (operation: TemporaryRoleWorkOperation) => Effect.Effect<void> = () => Effect.void) {
    const manages: TemporaryRoleManageRequest[] = [], works: TemporaryRoleWorkOperation[] = [], listed: TemporaryRoleGrant[] = [], memberships = new Map<string, string>()
    const defaults = new Map<string, TemporaryRoleDefault>()
    const store: TemporaryRoleStore = {
        manage: input => Effect.sync(() => {
            manages.push(structuredClone(input))
            const op = input.operation
            if (op.type === "role") {
                const row = { ...defaults.get(op.roleId), roleId: op.roleId }
                if (op.defaultSeconds !== undefined) { if (op.defaultSeconds === null) delete row.defaultSeconds; else row.defaultSeconds = op.defaultSeconds }
                if (op.maxSeconds !== undefined) { if (op.maxSeconds === null) delete row.maxSeconds; else row.maxSeconds = op.maxSeconds }
                defaults.set(op.roleId, row)
                return { type: "settings", revision: manages.length, settings: { roles: [...defaults.values()] } }
            }
            const seconds = op.type === "remove" ? 0 : op.durationSeconds ?? 86400
            if (input.context) memberships.set(op.userId, input.context.joinedAt)
            return { type: "grant", grant: { grantId: "synthetic_grant", userId: op.userId, roleId: op.roleId, joinedAt: memberships.get(op.userId) ?? "2023-11-14T22:13:19.000Z",
                endsAt: 1700000000000 + seconds * 1000, grantedBy: input.actor.userId, createdAt: 0, updatedAt: 0, sourceId: `temp_synthetic_${manages.length}` } }
        }),
        query: input => Effect.succeed(input.operation.type === "settings" ? { type: "settings", revision: 0, settings: { roles: [...defaults.values()] } } : { type: "grants", grants: listed }),
        work: input => Effect.gen(function* () {
            works.push(structuredClone(input.operation))
            yield* onWork(input.operation)
            return input.operation.type === "list" ? { type: "grants", grants: due.splice(0) } as const : { type: "recorded", recorded: true } as const
        }),
    }
    return { store, manages, works, listed, defaults }
}
// The shared role evaluation for a grant that wants the role or wants it gone, reserving one native change when the member differs
function temporaryEvaluate(roles: ReturnType<typeof rolesBoundary>, wanted: () => boolean) {
    return (input: RolesEvaluateRequest) => Effect.sync((): RolesEvaluateResult => {
        if (input.operation.type !== "temporary") throw new Error("Expected a temporary role evaluation")
        roles.calls.push({ method: "evaluate", input })
        if (input.context.roleIds.includes(input.operation.roleId) === wanted()) return { duplicate: false, status: "unchanged", acknowledgment }
        const grant: RolesGrant = { attemptId: `synthetic_temp_${roles.attempts.size + 1}`, ownershipId: "synthetic_owner", generation: roles.attempts.size + 1, sourceId: input.sourceId,
            action: wanted() ? "add" : "remove", userId: input.context.userId, joinedAt: input.context.joinedAt, roleId: input.operation.roleId, botId: input.context.botId,
            expectedPresent: !wanted(), consumerKey: "temporary", dispatchExpiresAt: Number.MAX_SAFE_INTEGER, nativeDeadlineMs: 5000 }
        roles.attempts.set(grant.attemptId, { ...grant, outcome: "pending", createdAt: input.createdAt })
        return { duplicate: false, status: "reserved", acknowledgment, grant }
    })
}
const endedGrant = (userId: string, roleId: string, joinedAt: string): TemporaryRoleGrant =>
    ({ grantId: "synthetic_grant", userId, roleId, joinedAt, endsAt: 1, grantedBy: "1", createdAt: 0, updatedAt: 0, sourceId: "temp_synthetic_1" })
const joinedAtOf = (bot: Bot, userId: string) => bot.client.members.fetch({ guildId: bot.fixtures.ids.guild, userId }, { timeoutMs: 5000 }).pipe(Effect.map(member => member.joinedAt))

test("Durations, command forms and the DEFCON class parse as the help describes", () => {
    assert.deepEqual(["30m", "12h", "7d", "2w", "1m", "59s", "0m", "53w", "7D"].map(temporaryDuration), [1800, 43200, 604800, 1209600, 60, undefined, undefined, undefined, 604800])
    assert.deepEqual(parseTemporaryRoleCommand(["add", "<@123>", "<@&456>", "7d"]), { type: "add", userId: "123", roleId: "456", seconds: 604800 })
    assert.deepEqual(parseTemporaryRoleCommand(["add", "<@123>", "<@&456>"]), { type: "add", userId: "123", roleId: "456" })
    assert.deepEqual(parseTemporaryRoleCommand(["set", "<@123>", "<@&456>", "3d"]), { type: "set", userId: "123", roleId: "456", seconds: 259200 })
    assert.deepEqual(parseTemporaryRoleCommand(["max", "<@&456>", "none"]), { type: "max", roleId: "456", seconds: null })
    assert.deepEqual(parseTemporaryRoleCommand(["list", "<@123>"]), { type: "list", userId: "123" })
    assert.deepEqual(parseTemporaryRoleCommand(["list", "next"]), { type: "list", next: true })
    assert.deepEqual(parseTemporaryRoleCommand(["list", "<@123>", "next"]), { type: "list", userId: "123", next: true })
    for (const args of [["list", "opaque_cursor"], ["list", "next", "<@123>"], ["list", "<@123>", "opaque_cursor"]]) assert.equal("error" in parseTemporaryRoleCommand(args), true)
    assert.deepEqual(parseTemporaryRoleCommand(["defaults", "next"]), { type: "defaults", next: true })
    assert.equal("error" in parseTemporaryRoleCommand(["defaults", "2"]), true)
    assert.equal("error" in parseTemporaryRoleCommand(["set", "<@123>", "<@&456>"]), true)
    assert.equal("error" in parseTemporaryRoleCommand(["add", "<@123>", "<@&456>", "forever"]), true)
    assert.deepEqual(["remove", "list", "reconcile", "add", "set", "default"].map(type => temporaryRoleCritical({ type } as never)), [true, true, true, false, false, false])
    // Members who manage roles see the command in help without any moderation permission
    assert.equal(JSON.stringify(helpCard("!", audiences(Permissions.ManageRoles), "roles")).includes("!temprole"), true)
})

test("An ended grant removes the role NeonFlux added through the shared role lifecycle and then closes", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: Redacted.value(token) }), p = nativeRoles(bot), roles = rolesBoundary(), t = temporaryBoundary()
        yield* bot.ready()
        p.roleIds.add(p.role.id)
        roles.store.evaluate = temporaryEvaluate(roles, () => false)
        const settled = yield* settleTemporaryRole(t.store, roles.store, bot.fixtures.ids.guild, bot.client, endedGrant(p.targetId, p.role.id, yield* joinedAtOf(bot, p.targetId)))
        assert.deepEqual(settled, { state: "removed" })
        assert.equal(p.remove.requests().length, 1)
        assert.equal(p.roleIds.has(p.role.id), false)
        assert.deepEqual(roles.calls.map(call => call.method), ["evaluate", "dispatch", "outcome", "evaluate"])
        assert.equal(t.works.length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("A grant whose member left or whose role was deleted ends without a role change", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: Redacted.value(token) }), f = bot.fixtures, p = nativeRoles(bot), roles = rolesBoundary(), t = temporaryBoundary()
        yield* bot.ready()
        const joinedAt = yield* joinedAtOf(bot, p.targetId)
        // The role no longer exists in the server
        const deleted = yield* settleTemporaryRole(t.store, roles.store, f.ids.guild, bot.client, endedGrant(p.targetId, f.nextId(), joinedAt))
        assert.deepEqual(deleted, { state: "ended" })
        assert.equal(t.works[0]?.type === "end" && t.works[0].reason, "role")
        // A later membership does not inherit the grant
        const rejoined = yield* settleTemporaryRole(t.store, roles.store, f.ids.guild, bot.client, endedGrant(p.targetId, p.role.id, "2020-01-01T00:00:00.000Z"))
        assert.deepEqual(rejoined, { state: "ended" })
        assert.deepEqual(t.works[1], { type: "end", userId: p.targetId, roleId: p.role.id, sourceId: "temp_synthetic_1", reason: "member", originServerId: f.ids.guild, memberUserId: p.targetId,
            observedAt: 0, currentJoinedAt: joinedAt })
        p.target.remove()
        bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, { status: 404, body: { code: "UNKNOWN_MEMBER", message: "Synthetic absent" } })
        const left = yield* settleTemporaryRole(t.store, roles.store, f.ids.guild, bot.client, endedGrant(p.targetId, p.role.id, joinedAt))
        assert.deepEqual(left, { state: "ended" })
        assert.equal(t.works[2]?.type === "end" && "memberAbsent" in t.works[2] && t.works[2].memberAbsent, true)
        assert.equal(roles.calls.length, 0)
        assert.deepEqual([p.add.requests().length, p.remove.requests().length], [0, 0])
    })).pipe(Effect.provide(TestClock.layer())))
})

test("A grant NeonFlux cannot settle keeps a visible problem instead of being dropped", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: Redacted.value(token) }), f = bot.fixtures, p = nativeRoles(bot), roles = rolesBoundary(), t = temporaryBoundary()
        yield* bot.ready()
        p.roleIds.add(p.role.id)
        const grant = endedGrant(p.targetId, p.role.id, yield* joinedAtOf(bot, p.targetId))
        roles.store.evaluate = () => Effect.fail(new RolesStoreError({ operation: "evaluate", status: 403, code: "BOT_PERMISSION" }))
        assert.deepEqual(yield* settleTemporaryRole(t.store, roles.store, f.ids.guild, bot.client, grant), { state: "problem", problem: "permission" })
        roles.store.evaluate = () => Effect.fail(new RolesStoreError({ operation: "evaluate", status: 403, code: "ROLE_NOT_ELIGIBLE" }))
        assert.deepEqual(yield* settleTemporaryRole(t.store, roles.store, f.ids.guild, bot.client, grant), { state: "problem", problem: "role" })
        // An unconfirmed earlier change is never repeated
        roles.store.evaluate = () => Effect.succeed({ duplicate: false, status: "blocked", acknowledgment })
        assert.deepEqual(yield* settleTemporaryRole(t.store, roles.store, f.ids.guild, bot.client, grant), { state: "problem", problem: "uncertain" })
        roles.store.evaluate = () => Effect.fail(new RolesStoreError({ operation: "evaluate", status: 503 }))
        assert.deepEqual(yield* settleTemporaryRole(t.store, roles.store, f.ids.guild, bot.client, grant), { state: "problem", problem: "unavailable" })
        assert.deepEqual(t.works.map(op => op.type === "problem" ? op.problem : op.type), ["permission", "role", "uncertain", "unavailable"])
        assert.equal(p.remove.requests().length, 0)
        assert.equal(p.roleIds.has(p.role.id), true)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("The work dispatcher's wake settles every due grant", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: Redacted.value(token) }), f = bot.fixtures, p = nativeRoles(bot), roles = rolesBoundary()
        yield* bot.ready()
        const joinedAt = yield* joinedAtOf(bot, p.targetId), ended = yield* Deferred.make<void>()
        const t = temporaryBoundary([endedGrant(p.targetId, f.nextId(), joinedAt), endedGrant(p.targetId, f.nextId(), joinedAt)],
            op => op.type === "end" && t.works.filter(row => row.type === "end").length === 2 ? Deferred.succeed(ended, undefined).pipe(Effect.asVoid) : Effect.void)
        const worker = yield* startTemporaryRoleWorker(t.store, roles.store, f.ids.guild, bot.client)
        assert.equal(t.works.length, 0)
        yield* worker.notify()
        yield* Deferred.await(ended)
        assert.deepEqual(t.works.map(op => op.type), ["list", "end", "end"])
    })).pipe(Effect.provide(TestClock.layer())))
})

test("Staff give, list and end temporary roles from chat, and members without Manage Roles are refused", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const roles = rolesBoundary(), t = temporaryBoundary(), serverId = createFixtures().ids.guild
        let wanted = true
        roles.store.evaluate = temporaryEvaluate(roles, () => wanted)
        const bot = yield* createTestBot(createBotOptions({ token, serverId }, { roles: roles.store, temporaryRoles: t.store })), f = bot.fixtures, p = nativeRoles(bot)
        yield* bot.ready()
        const send = (content: string) => bot.emit("MESSAGE_CREATE", f.message({ content })).pipe(Effect.andThen(bot.idle()))
        const replies = () => p.send.requests().map(reply)
        yield* send(`!temprole add <@${p.targetId}> <@&${p.role.id}> 7d`)
        assert.deepEqual(t.manages.map(row => [row.operation, row.actor.userId, row.context?.userId]), [[{ type: "add", userId: p.targetId, roleId: p.role.id, durationSeconds: 604800 }, f.ids.user, p.targetId]])
        assert.equal(t.manages[0]!.context?.roles.find(role => role.roleId === p.role.id)?.actorCanManage, true)
        assert.equal(p.roleIds.has(p.role.id), true)
        assert.equal(replies().at(-1), `Gave <@&${p.role.id}> to <@${p.targetId}> until <t:1700604800:f>`)
        // A role the member already holds would never be removed, so it is refused before anything is saved
        yield* send(`!temprole add <@${p.targetId}> <@&${p.targetRole.id}> 1d`)
        assert.equal(t.manages.length, 1)
        assert.match(replies().at(-1) as string, /already has/)
        t.listed.push({ ...endedGrant(p.targetId, p.second.id, "2023-11-14T22:13:19.000Z"), endsAt: 1700000000000, problem: "permission" })
        yield* send("!temprole list")
        assert.deepEqual(replies().at(-1), { color: 0x5560e6, title: "Temporary roles",
            description: `<@${p.targetId}> <@&${p.second.id}>, ended <t:1700000000:R>, not removed yet: Grant Manage Roles to the NeonFlux role. NeonFlux tries again within 10 minutes` })
        wanted = false
        yield* send(`!temprole remove <@${p.targetId}> <@&${p.role.id}>`)
        assert.deepEqual(t.manages.at(-1)?.operation, { type: "remove", userId: p.targetId, roleId: p.role.id })
        assert.equal(p.roleIds.has(p.role.id), false)
        assert.equal(replies().at(-1), `Removed <@&${p.role.id}> from <@${p.targetId}>`)
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const roles = rolesBoundary(), t = temporaryBoundary(), serverId = createFixtures().ids.guild
        const bot = yield* createTestBot(createBotOptions({ token, serverId }, { roles: roles.store, temporaryRoles: t.store })), f = bot.fixtures
        const p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.SendMessages | Permissions.KickMembers, botPermissions: Permissions.ManageRoles | Permissions.ViewChannel | Permissions.SendMessages })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", f.message({ content: `!temprole add <@${p.targetId}> <@&${p.targetRole.id}> 7d` })); yield* bot.idle()
        assert.deepEqual(p.replies.requests().map(row => (row.body as { content: string }).content), ["You need Manage Roles to manage temporary roles"])
        assert.equal(t.manages.length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("Grant lists continue with next from where the member's last page ended", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const roles = rolesBoundary(), t = temporaryBoundary(), serverId = createFixtures().ids.guild, lists: unknown[] = []
        // The server-wide list has a second page, and one member's grants fit on one
        t.store.query = input => Effect.sync((): TemporaryRoleQueryResult => {
            lists.push(input.operation)
            const op = input.operation as { cursor?: string, userId?: string }
            return { type: "grants", grants: [], ...(op.cursor || op.userId ? {} : { nextCursor: "opaque_cursor" }) }
        })
        const bot = yield* createTestBot(createBotOptions({ token, serverId }, { roles: roles.store, temporaryRoles: t.store })), f = bot.fixtures, p = nativeRoles(bot)
        yield* bot.ready()
        const send = (content: string) => bot.emit("MESSAGE_CREATE", f.message({ content })).pipe(Effect.andThen(bot.idle()))
        const replies = () => p.send.requests().map(reply)
        yield* send("!temprole list")
        assert.deepEqual(replies().at(-1), { color: 0x5560e6, title: "Temporary roles", description: "No temporary roles yet", fields: [{ name: "Next", value: "`!temprole list next`" }] })
        yield* send("!temprole list next")
        assert.deepEqual(replies().at(-1), { color: 0x5560e6, title: "Temporary roles", description: "No temporary roles yet" })
        yield* send("!temprole list next")
        assert.equal(replies().at(-1), "There is no next page to show. Send !temprole list to start the list again")
        yield* send(`!temprole list <@${p.targetId}>`)
        yield* send(`!temprole list <@${p.targetId}> next`)
        assert.equal(replies().at(-1), `There is no next page to show. Send !temprole list <@${p.targetId}> to start the list again`)
        assert.deepEqual(lists, [{ type: "list" }, { type: "list", cursor: "opaque_cursor" }, { type: "list", userId: p.targetId }])
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("Role defaults and renewals from chat save through the backend and reply with the result", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const roles = rolesBoundary(), t = temporaryBoundary(), serverId = createFixtures().ids.guild
        roles.store.evaluate = temporaryEvaluate(roles, () => true)
        const bot = yield* createTestBot(createBotOptions({ token, serverId }, { roles: roles.store, temporaryRoles: t.store })), f = bot.fixtures, p = nativeRoles(bot)
        yield* bot.ready()
        const send = (content: string) => bot.emit("MESSAGE_CREATE", f.message({ content })).pipe(Effect.andThen(bot.idle()))
        const replies = () => p.send.requests().map(reply)
        for (const command of [`!temprole default <@&${p.role.id}> 7d`, `!temprole max <@&${p.role.id}> 30d`, "!temprole defaults", `!temprole default <@&${f.nextId()}> 1d`]) yield* send(command)
        assert.deepEqual(t.manages.map(row => row.operation), [{ type: "role", roleId: p.role.id, defaultSeconds: 604800 }, { type: "role", roleId: p.role.id, maxSeconds: 2592000 }])
        assert.deepEqual(replies(), [`<@&${p.role.id}> now lasts 1 week by default`, `<@&${p.role.id}> can now be given for at most 30 days`,
            { color: 0x5560e6, title: "Temporary role defaults", description: `1 role has defaults\n<@&${p.role.id}>: Default 1 week, longest 30 days` }, "Name a role of this server other than the everyone role"])
        // A renewal of a role the member holds only moves the end time
        p.roleIds.add(p.role.id)
        yield* send(`!temprole set <@${p.targetId}> <@&${p.role.id}> 3d`)
        assert.deepEqual(t.manages.at(-1)?.operation, { type: "set", userId: p.targetId, roleId: p.role.id, durationSeconds: 259200 })
        assert.equal(replies().at(-1), `<@${p.targetId}> keeps <@&${p.role.id}> until <t:1700259200:f>`)
        assert.deepEqual([p.add.requests().length, p.remove.requests().length], [0, 0])
    })).pipe(Effect.provide(TestClock.layer())))
})

test("Role defaults page at ten and name the limit once most of it is used", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const roles = rolesBoundary(), t = temporaryBoundary(), serverId = createFixtures().ids.guild
        for (let i = 0; i < 85; i++) t.defaults.set(String(200000000000000000n + BigInt(i)), { roleId: String(200000000000000000n + BigInt(i)), defaultSeconds: 3600 })
        const bot = yield* createTestBot(createBotOptions({ token, serverId }, { roles: roles.store, temporaryRoles: t.store })), f = bot.fixtures, p = nativeRoles(bot)
        yield* bot.ready()
        const page =(content: string) => Effect.gen(function* () {
            yield* bot.emit("MESSAGE_CREATE", f.message({ content })); yield* bot.idle()
            return reply(p.send.requests().at(-1)!) as { description: string, fields?: { name: string, value: string }[] } | string
        })
        const first = (yield* page("!temprole defaults")) as { description: string, fields?: { name: string, value: string }[] }
        assert.deepEqual(first.description.split("\n").slice(0, 2), ["85 of 100 roles have defaults", "<@&200000000000000000>: Default 1 hour, longest 365 days"])
        assert.equal(first.description.split("\n").length, 11)
        assert.deepEqual(first.fields, [{ name: "Next", value: "`!temprole defaults next`" }])
        for (let shown = 1; shown < 8; shown++) yield* page("!temprole defaults next")
        const last = (yield* page("!temprole defaults next")) as { description: string, fields?: unknown }
        assert.equal(last.description.split("\n").length, 6)
        assert.equal(last.fields, undefined)
        assert.equal(yield* page("!temprole defaults next"), "There is no next page to show. Send !temprole defaults to start the list again")
    })).pipe(Effect.provide(TestClock.layer())))
})

test("An administrator's reconcile records the member's current role once, then settles the member's grants", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const roles = rolesBoundary(), t = temporaryBoundary(), serverId = createFixtures().ids.guild
        roles.store.evaluate = temporaryEvaluate(roles, () => false)
        const reconciled: RolesReconcileRequest[] = []
        const bot = yield* createTestBot(createBotOptions({ token, serverId }, { roles: roles.store, temporaryRoles: t.store })), f = bot.fixtures, p = nativeRoles(bot)
        yield* bot.ready()
        p.roleIds.add(p.role.id)
        const joinedAt = yield* joinedAtOf(bot, p.targetId)
        const attempt: RolesAttempt = { attemptId: "synthetic_uncertain", ownershipId: "synthetic_owner", generation: 2, sourceId: "temp_synthetic_1", action: "add", userId: p.targetId, joinedAt,
            roleId: p.role.id, botId: f.ids.bot, expectedPresent: false, consumerKey: "temporary", dispatchExpiresAt: 180000, nativeDeadlineMs: 5000, outcome: "uncertain", createdAt: 0 }
        const claim: RolesClaim = { ownershipId: "synthetic_owner", userId: p.targetId, joinedAt, roleId: p.role.id, generation: 2, owned: false, status: "uncertain", consumerKeys: ["temporary"], attempt }
        roles.store.query = input => Effect.succeed(input.operation.type === "claim-list" ? { type: "claims", claims: [claim] } : { type: "settings", settings: { ...roles.current } })
        roles.store.reconcile = input => Effect.sync(() => { reconciled.push(input); return { recorded: true, claim: { ...claim, status: "idle" as const, owned: false } } })
        t.listed.push(endedGrant(p.targetId, p.role.id, joinedAt))
        yield* bot.emit("MESSAGE_CREATE", f.message({ content: `!temprole reconcile <@${p.targetId}>` })); yield* bot.idle()
        assert.deepEqual(reconciled.map(row => [row.attemptId, row.generation, row.observation.present, row.actor.isOwner]), [["synthetic_uncertain", 2, true, true]])
        assert.equal(p.remove.requests().length, 1)
        assert.deepEqual(p.send.requests().map(reply).at(-1), { color: 0x5560e6, title: "Temporary role check", description: `Recorded that <@&${p.role.id}> is on <@${p.targetId}>\n<@&${p.role.id}>: Removed`,
            fields: [{ name: "Member", value: `<@${p.targetId}>` }] })
    })).pipe(Effect.provide(TestClock.layer())))
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const roles = rolesBoundary(), t = temporaryBoundary(), serverId = createFixtures().ids.guild
        const bot = yield* createTestBot(createBotOptions({ token, serverId }, { roles: roles.store, temporaryRoles: t.store })), f = bot.fixtures
        const p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.SendMessages | Permissions.ManageRoles, botPermissions: Permissions.ManageRoles | Permissions.ViewChannel | Permissions.SendMessages })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", f.message({ content: `!temprole reconcile <@${p.targetId}>` })); yield* bot.idle()
        assert.deepEqual(p.replies.requests().map(row => (row.body as { content: string }).content), ["Only the server owner or an administrator can reconcile temporary roles"])
        assert.equal(roles.calls.some(call => call.method === "query" || call.method === "reconcile"), false)
    })).pipe(Effect.provide(TestClock.layer())))
})
