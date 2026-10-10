import assert from "node:assert/strict"
import test from "node:test"
import type { MemberListOperation } from "@neonflux/contracts/member-list"
import type { DashboardConfigurationReadyJob } from "@neonflux/contracts/dashboard"
import { Permissions, type GuildRole } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { processDashboardConfigurationPass } from "../src/dashboard-configuration.ts"
import { memberListOrder, planMemberList } from "../src/memberlist-management.ts"
import type { MemberListStore } from "../src/memberlist-store.ts"
import { mockBackend } from "./backend-fake.ts"

const role = (id: string, position: number, hoistPosition: number | null = null, hoist = true): GuildRole =>
    ({ guildId: "1", id, name: `role${id}`, color: 0, position, permissions: 0n, hoist, mentionable: false, hoistPosition })

test("the member list shows hoisted roles by display position, then by hierarchy position", () => {
    const order = memberListOrder([role("1", 0), role("11", 9, null, false), role("12", 3), role("13", 2, 50), role("14", 7)], "1")
    assert.deepEqual(order.map(value => value.id), ["13", "14", "12"])
})

test("a plan keeps roles that cannot move in place and fits the others around them", () => {
    const order = [role("20", 2, 50), role("21", 18), role("22", 15), role("23", 5), role("24", 3)], locked = new Set(["21", "22"])
    const movable = (value: GuildRole) => !locked.has(value.id)
    assert.deepEqual(planMemberList(order, ["24", "20", "21", "22", "23"], movable), { positions: [{ id: "24", hoistPosition: 20 }, { id: "20", hoistPosition: 19 }] })
    assert.deepEqual(planMemberList(order, ["20", "21", "22", "24", "23"], movable), { positions: [{ id: "24", hoistPosition: 14 }, { id: "23", hoistPosition: 13 }] })
    // Roles that already show in this order are left alone
    assert.deepEqual(planMemberList(order, ["20", "21", "22", "23", "24"], movable), { positions: [] })
    assert.deepEqual(planMemberList(order, ["24", "23", "22", "21", "20"], () => true), { positions: [{ id: "24", hoistPosition: 5 }, { id: "23", hoistPosition: 4 }, { id: "22", hoistPosition: 3 }, { id: "21", hoistPosition: 2 }, { id: "20", hoistPosition: 1 }] })
    assert.match((planMemberList(order, ["20", "22", "21", "23", "24"], movable) as { error: string }).error, /role22 and role21 cannot move/)
    // Two fixed roles one apart leave no room for a role between them
    assert.match((planMemberList([role("30", 6), role("31", 5), role("32", 1)], ["30", "32", "31"], value => value.id === "32") as { error: string }).error, /no room between role30 and role31/)
    assert.match((planMemberList(order, ["20", "21"], movable) as { error: string }).error, /Name every role shown in the member list once/)
})

const token = Redacted.make("synthetic-memberlist-test-token")
const memberId = "6001", adminId = "6003", managerId = "6004", serverOwnerId = "6009"
type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const segment = (path: string, index: number) => path.split("/")[index]!
function platform(bot: Bot, log: string[]) {
    const f = bot.fixtures
    const botRole = f.role({ position: 30, permissions: Permissions.Administrator.toString() }), adminRole = f.role({ position: 10, permissions: Permissions.Administrator.toString() })
    const managerRole = f.role({ position: 12, permissions: (Permissions.ManageGuild | Permissions.ManageRoles).toString() })
    const hoisted = { vip: f.role({ name: "VIP", position: 2, hoist: true, hoist_position: 50 }), mods: f.role({ name: "Mods", position: 18, hoist: true }), staff: f.role({ name: "Staff", position: 15, hoist: true }),
        helper: f.role({ name: "Helper", position: 5, hoist: true }), member: f.role({ name: "Member", position: 3, hoist: true }) }
    bot.rest.respond("GET /guilds/:id", { body: f.guild({ owner_id: serverOwnerId }) })
    bot.rest.respond("GET /guilds/:id/roles", { body: [f.role({ id: f.ids.guild, permissions: "0" }), botRole, adminRole, managerRole, ...Object.values(hoisted)] })
    bot.rest.respond("GET /guilds/:id/members/:id", request => {
        const userId = segment(request.path, 4), roles = userId === f.ids.bot ? [botRole.id] : userId === adminId ? [adminRole.id] : userId === managerId ? [managerRole.id] : []
        return { body: f.member({ user: userId === f.ids.bot ? f.botUser() : f.user({ id: userId }), roles }) }
    })
    const set = bot.rest.respond("PATCH /guilds/:id/roles/hoist-positions", () => { log.push("native"); return { status: 204 } })
    const reset = bot.rest.respond("DELETE /guilds/:id/roles/hoist-positions", { status: 204 })
    const messages = bot.rest.respond("POST /channels/:id/messages", request => ({ body: f.message({ channel_id: segment(request.path, 2), author: f.botUser() }) }))
    return { hoisted, set, reset, replies: () => messages.requests().map(request => { const body = request.body as { content?: string, embeds?: object[] }; return body.content ?? body.embeds![0] }) }
}
const say = (bot: Bot, userId: string, content: string) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content, author: bot.fixtures.user({ id: userId }) }))
function run(body: (bot: Bot, native: ReturnType<typeof platform>, recorded: MemberListOperation[], log: string[]) => Effect.Effect<void, unknown>, log: string[] = []) {
    const f = createFixtures(), recorded: MemberListOperation[] = []
    const store: MemberListStore = { manage: input => Effect.sync(() => { recorded.push(input.operation); log.push("record"); return { revision: recorded.length } }) }
    return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { memberList: store }))
        const native = platform(bot, log)
        yield* bot.ready()
        yield* body(bot, native, recorded, log)
    })).pipe(Effect.provide(TestClock.layer())))
}

test("a manager views and moves roles in the member list, and the change is applied before it is recorded", async () => {
    await run((bot, native, recorded, log) => Effect.gen(function* () {
        const { vip, mods, staff, helper, member } = native.hoisted
        yield* say(bot, memberId, "!memberlist")
        yield* say(bot, adminId, "!memberlist")
        yield* say(bot, adminId, `!memberlist move <@&${member.id}> 1`)
        yield* bot.idle()
        assert.deepEqual(native.replies(), ["Only the server owner or members with Manage Server can change the member list",
            { color: 0x5560e6, title: "Member list order", description: [vip, mods, staff, helper, member].map((value, index) => `${index + 1}. <@&${value.id}>`).join("\n"), footer: { text: "Top first" } },
            `<@&${member.id}> is now number 1 in the member list`])
        // Mods and Staff sit above the Administrator's top role, so they keep their place and the others fit around them
        assert.deepEqual(native.set.requests()[0]!.body, [{ id: member.id, hoist_position: 20 }, { id: vip.id, hoist_position: 19 }])
        assert.deepEqual(recorded, [{ type: "set", roleIds: [member.id, vip.id, mods.id, staff.id, helper.id] }])
        assert.deepEqual(log, ["native", "record"])
    }))
})

test("roles above the manager cannot be reordered, and only the owner or an Administrator can reset", async () => {
    await run((bot, native, recorded) => Effect.gen(function* () {
        const { vip, mods, staff, helper, member } = native.hoisted
        yield* say(bot, adminId, `!memberlist set <@&${vip.id}> <@&${staff.id}> <@&${mods.id}> <@&${helper.id}> <@&${member.id}>`)
        yield* say(bot, managerId, "!memberlist reset")
        yield* bot.idle()
        assert.equal(native.set.requests().length, 0)
        assert.equal(native.reset.requests().length, 0)
        assert.match(native.replies()[0] as string, /Staff and Mods cannot move/)
        assert.match(native.replies()[1] as string, /Only the server owner or an Administrator can reset/)
        yield* say(bot, adminId, "!memberlist reset")
        yield* bot.idle()
        assert.equal(native.reset.requests().length, 1)
        assert.deepEqual(recorded, [{ type: "reset" }])
    }))
})

test("a dashboard order is applied natively before the backend records it, and a refused order fails the request", async t => {
    const log: string[] = [], failures: unknown[] = []
    let jobs: DashboardConfigurationReadyJob[] = []
    mockBackend(t, (call) => {
        if (call.path === "/dashboard-configuration/ready") return { jobs }
        if (call.path === "/dashboard-configuration/fail") { failures.push(call.body); return null }
        assert.equal(call.path, "/dashboard-configuration/execute")
        log.push("execute")
        const { native: _native, ...stored } = jobs[0]!
        return { job: { ...stored, state: "applied" } }
    })
    await run((bot, native) => Effect.gen(function* () {
        const f = bot.fixtures, { vip, mods, staff, helper, member } = native.hoisted, config = { token, serverId: f.ids.guild, backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-backend-secret") } }
        bot.rest.respond("GET /users/@me", { body: f.botUser({ system: false }) })
        bot.rest.respond(`GET /users/${adminId}`, { body: f.user({ id: adminId, bot: false, system: false }) })
        const job = (operation: MemberListOperation): DashboardConfigurationReadyJob => ({ family: "memberlist", operation, native: operation.type === "set" ? { roleIds: operation.roleIds } : { requiresOwnerAdmin: true },
            id: "synthetic_memberlist_job", actorId: adminId, expectedConfigRevision: 0, state: "queued", createdAt: 0, expiresAt: 120000 })
        const pass = () => processDashboardConfigurationPass(config, bot.client as unknown as Parameters<typeof processDashboardConfigurationPass>[1])
        jobs = [job({ type: "set", roleIds: [vip.id, mods.id, staff.id, member.id, helper.id] })]
        yield* pass()
        assert.deepEqual(log, ["native", "execute"])
        jobs = [job({ type: "set", roleIds: [staff.id, mods.id, vip.id, helper.id, member.id] })]
        yield* pass()
        assert.deepEqual(log, ["native", "execute"])
        assert.equal(failures.length, 1)
    }), log)
})
