import assert from "node:assert/strict"
import test from "node:test"
import type { RolesEvaluateRequest, RolesOutcomeRequest } from "@neonflux/contracts/roles"
import type { ServiceWork } from "@neonflux/contracts/service"
import type { RolesMemberContext } from "@neonflux/contracts/shared"
import type { RolePickerCompleteRequest, RolePickerJob, RolePickerManageRequest, RolePickerMemberOperation, RolePickerRoleDisplay, RolePickerStartRequest, RolePickerStartResult, RolePickerState } from "@neonflux/contracts/role-picker"
import type { DashboardConfigurationExecuteRequest, DashboardConfigurationReadyJob } from "@neonflux/contracts/dashboard"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted, type Types } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { processDashboardConfigurationPass } from "../src/dashboard-configuration.ts"
import { RolePickerStoreError, type RolePickerStore } from "../src/rolepicker-store.ts"
import { processRolePickerPass } from "../src/rolepicker-worker.ts"
import { parseDeploymentScope } from "../src/server-scope.ts"
import { workKinds } from "../src/work-dispatcher.ts"
import { fakeClient, mockBackend, quietSignal } from "./backend-fake.ts"
import { platform, token } from "./moderation-fixture.ts"
import { rolesBoundary } from "./roles-fixture.ts"
import { nativeRoles } from "./roles-native-fixture.ts"

test("Member requests run only after the work dispatcher wakes a server's dashboard worker, and idle servers make no role picker requests", async () => {
    const serverA = "1100000000000000001", serverB = "1100000000000000002", memberId = "1100000000000000077"
    const seen: { path: string, server: string | undefined, body: Record<string, unknown> }[] = [], waiters = new Map<string, () => void>()
    const called = (path: string, server: string) => new Promise<void>(resolve => { if (seen.some(row => row.path === path && row.server === server)) resolve(); else waiters.set(`${path} ${server}`, resolve) })
    let release!: (value: ServiceWork) => void, polls = 0
    const firstPoll = new Promise<ServiceWork>(resolve => { release = resolve })
    const noWork = Object.fromEntries(workKinds.map(kind => [kind, []])) as unknown as ServiceWork["kinds"]
    const job: RolePickerJob = { id: "synthetic_member_lookup", actorId: memberId, operation: { type: "lookup" }, state: "queued", createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER }
    const client = fakeClient(async (call) => {
        const { path } = call, body = call.body as Record<string, unknown>, server = call.serverId
        seen.push({ path, server, body })
        waiters.get(`${path} ${server}`)?.()
        if (path === "/service/scope") return { mode: "multi" }
        if (path === "/service/installations/list") return { serverIds: [serverA, serverB], nextCursor: null }
        if (path === "/service/work") return polls++ === 0 ? await firstPoll : { kinds: noWork, cursor: null, nextDueIn: null }
        if (path === "/publishing/observe" || path === "/roles/observe") return { uncertainAttempts: 0 }
        if (path === "/roles/reaction-jobs") return { type: "jobs", jobs: [] }
        if (path === "/moderation/gate") return { allowed: true, defcon: 3, messageProtectionEnabled: false, joinProtectionEnabled: false, botMessageProtectionEnabled: false }
        if (path === "/afk/observe") return { cleared: false, statuses: [] }
        if (path === "/rolepicker/ready") return { jobs: [job] }
        if (path === "/rolepicker/start") return { proceed: false, job: { ...job, state: "applied" } }
        // Manager dashboard passes fail here, which must not hold back member requests
        return Response.json({ error: "Backend unavailable" }, { status: 503 })
    }, quietSignal)
    const backend = { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-secret"), client }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token: Redacted.make("synthetic-token"), scope: parseDeploymentScope({ NEONFLUX_SERVER_MODE: "multi" }), backend })), f = bot.fixtures
        const botRole = f.role({ position: 20, permissions: Permissions.Administrator.toString() })
        bot.rest.respond("GET /users/@me/guilds", request => ({ body: request.query.after ? [] : [serverA, serverB].map(id => f.guild({ id })) }))
        bot.rest.respond("GET /guilds/:id", request => ({ body: f.guild({ id: request.path.split("/")[2], owner_id: f.nextId() }) }))
        bot.rest.respond("GET /guilds/:id/roles", request => ({ body: [f.role({ id: request.path.split("/")[2], permissions: "0" }), botRole] }))
        bot.rest.respond("GET /guilds/:id/members/:id", request => {
            const userId = request.path.split("/")[4]!
            return { body: f.member({ user: userId === f.ids.bot ? f.botUser() : f.user({ id: userId }), roles: userId === f.ids.bot ? [botRole.id] : [], communication_disabled_until: null }) }
        })
        yield* bot.ready()
        for (const guild_id of [serverA, serverB]) { yield* bot.emit("MESSAGE_CREATE", f.message({ content: "!ping", guild_id })); yield* bot.idle() }
        // Started runtimes with no reported work make no role picker requests
        assert.equal(seen.some(row => row.path.startsWith("/rolepicker/")), false)
        release({ kinds: { ...noWork, dashboard: [serverA] }, cursor: null, nextDueIn: null })
        yield* Effect.promise(() => called("/rolepicker/start", serverA))
        const start = seen.find(row => row.path === "/rolepicker/start")!
        assert.deepEqual([start.body.jobId, (start.body.context as RolesMemberContext).userId, (start.body.context as RolesMemberContext).originServerId], [job.id, memberId, serverA])
        assert.equal((start.body.display as RolePickerRoleDisplay[]).some(role => role.roleId === botRole.id), true)
        assert.equal(seen.some(row => row.server === serverB && row.path.startsWith("/rolepicker/")), false)
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

// An in-memory backend boundary that keeps the chat operations and member request results it receives
function pickerBoundary(jobs: RolePickerJob[] = [], start: (input: RolePickerStartRequest, job: RolePickerJob) => RolePickerStartResult | "fail" = (_, job) => ({ proceed: job.operation.type !== "lookup", job })) {
    const state: Types.DeepMutable<RolePickerState> = { revision: 0, settings: { enabled: false, menus: [] }, access: { allowRoleIds: [], blockRoleIds: [], allowUserIds: [], blockUserIds: [] } }
    const manages: RolePickerManageRequest[] = [], started: RolePickerStartRequest[] = [], completed: RolePickerCompleteRequest[] = [], failed: string[] = []
    const store: RolePickerStore = {
        manage: input => Effect.sync(() => {
            manages.push(structuredClone(input))
            const op = input.operation, menu = "name" in op ? state.settings.menus.find(row => row.name === op.name) : undefined
            if (op.type === "module") state.settings.enabled = op.enabled
            if (op.type === "menu-add") state.settings.menus.push({ name: op.name, mode: op.mode, roleIds: [], ...(op.description ? { description: op.description } : {}) })
            if (op.type === "menu-update" && menu && op.mode) menu.mode = op.mode
            if (op.type === "menu-role-add" && menu) menu.roleIds.push(...op.roleIds)
            if (op.type === "access-add") state.access[`${op.list}${op.kind === "role" ? "RoleIds" : "UserIds"}`].push(...op.ids)
            state.revision++
            return structuredClone(state)
        }),
        settings: () => Effect.sync(() => structuredClone(state)),
        ready: () => Effect.sync(() => ({ jobs: jobs.splice(0) })),
        start: input => Effect.suspend(() => {
            started.push(structuredClone(input))
            const result = start(input, { id: input.jobId, actorId: input.actorId, operation: { type: "lookup" }, state: "queued", createdAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, ...knownJobs.get(input.jobId) })
            return result === "fail" ? Effect.fail(new RolePickerStoreError({ operation: "start", status: 503 })) : Effect.succeed(result)
        }),
        complete: input => Effect.sync(() => { completed.push(structuredClone(input)); return { job: { ...knownJobs.get(input.jobId)!, state: "applied" as const } } }),
        fail: input => Effect.sync(() => { failed.push(input.jobId); return null }),
    }
    const knownJobs = new Map(jobs.map(job => [job.id, job]))
    return { store, state, manages, started, completed, failed }
}
const job = (id: string, actorId: string, operation: RolePickerMemberOperation): RolePickerJob => ({ id, actorId, operation, state: "queued", createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER })

test("Role picker commands configure menus and access lists for administrators and refuse other members", async () => {
    const b = pickerBoundary(), serverId = createFixtures().ids.guild
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const runtime = yield* createTestBot(createBotOptions({ token, serverId }, { rolePicker: b.store })), f = runtime.fixtures
        const p = platform(runtime, { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.SendMessages, botPermissions: Permissions.ManageRoles | Permissions.ViewChannel | Permissions.SendMessages })
        yield* runtime.ready()
        const send = (content: string) => runtime.emit("MESSAGE_CREATE", f.message({ content })).pipe(Effect.andThen(runtime.idle()))
        // Text replies as their content, and cards as their embed title and fields
        const replies = () => p.replies.requests().map(row => {
            const body = row.body as { content?: string, embeds?: { title: string, description?: string, fields?: { name: string, value: string }[], footer?: { text: string } }[] }
            return body.content ?? body.embeds![0]!
        })
        yield* send("!rolepicker on")
        assert.deepEqual(replies(), ["Only the server owner or an administrator can manage the role picker"])
        assert.equal(b.manages.length, 0)
        // An Administrator role makes the same member a role picker manager
        const adminRole = f.role({ position: 15, permissions: Permissions.Administrator.toString() })
        p.rolesRoute.remove(); runtime.rest.respond("GET /guilds/:id/roles", { body: [...p.roles, adminRole] })
        p.actor.remove(); runtime.rest.respond(`GET /guilds/${serverId}/members/${f.ids.user}`, { body: f.member({ roles: [p.actorRole.id, adminRole.id], communication_disabled_until: null }) })
        const blocked = f.nextId()
        for (const command of ["!rolepicker on", "!rolepicker menu add Colors single \"Pick one colour\"", `!rolepicker menu role add colors <@&${p.targetRole.id}>`,
            `!rolepicker menu role add colors <@&${p.botRole.id}>`, `!rolepicker access block user <@${blocked}>`, `!rolepicker access allow role ${f.nextId()}`,
            "!rolepicker menu set colors mode multi", "!rolepicker menu list", "!rolepicker menu show colors", "!rolepicker menu show shapes", "!rolepicker menu shuffle"]) yield* send(command)
        assert.deepEqual(b.manages.map(row => row.operation), [
            { type: "module", enabled: true },
            { type: "menu-add", name: "colors", mode: "single", description: "Pick one colour" },
            { type: "menu-role-add", name: "colors", roleIds: [p.targetRole.id] },
            { type: "access-add", list: "block", kind: "user", ids: [blocked] },
            { type: "menu-update", name: "colors", mode: "multi" },
        ])
        // Menu roles carry fresh native snapshots for the shared role safety rules
        assert.equal(b.manages[2]!.roles?.find(role => role.roleId === p.targetRole.id)?.botCanManage, true)
        assert.equal(b.manages.every(row => row.actor.isAdministrator && row.actor.originServerId === serverId), true)
        // Every save carries the server's current role names from the bot's own read, without the everyone role
        assert.equal(b.manages.every(row => row.display?.some(role => role.roleId === p.targetRole.id && role.name === p.targetRole.name) && !row.display.some(role => role.roleId === serverId)), true)
        const accent = { color: 0x5560e6 }
        assert.deepEqual(replies().slice(1), [
            "Role picker on. Members choose roles on the website",
            "Menu colors added with single choice. Add its roles with `!rolepicker menu role add colors @roles`",
            `Added <@&${p.targetRole.id}> to menu colors, which has 1 role now`,
            `Move the NeonFlux role above <@&${p.botRole.id}>`,
            `Added <@${blocked}> to the block list for the role picker`,
            "Name existing roles of this server. Leave the allow list empty for everyone instead of using the everyone role",
            "Menu colors is multiple choice now",
            { ...accent, title: "Role picker menus", description: "**colors** Multiple choice, 1 role\nShow one with `!rolepicker menu show <name>`" },
            { ...accent, title: "Menu colors", description: "Pick one colour", fields: [{ name: "Mode", value: "Multiple choice" }, { name: "Roles", value: `<@&${p.targetRole.id}>` }], footer: { text: "1 role" } },
            "No menu is named shapes. Check !rolepicker menu list",
            "Use !rolepicker menu list, show <name> [next], add <name> single|multi [\"description\"], remove <name>, set <name> mode single|multi, set <name> description \"text\"|none, or role add|remove <name> @roles...",
        ])
        assert.equal(p.replies.requests().every(row => (row.body as { allowed_mentions?: { parse?: unknown[] } }).allowed_mentions?.parse?.length === 0), true)
        assert.equal(runtime.failures().length, 0)
    })))
})

test("Role picker replies stay short at their limits: one line per menu, menu roles and access lists page at 10 and the access card shows counts", async () => {
    const b = pickerBoundary(), serverId = createFixtures().ids.guild
    const ids = (list: number, count: number) => Array.from({ length: count }, (_, index) => String(1200000000000000000n + BigInt(list * 1000 + index)))
    b.state.settings.menus.push(...Array.from({ length: 10 }, (_, index) => ({ name: `menu-${index + 1}`, mode: "single" as const, roleIds: ids(index + 1, 25) })))
    b.state.access.allowRoleIds.push(...ids(20, 100)); b.state.access.allowUserIds.push(...ids(21, 100))
    b.state.access.blockRoleIds.push(...ids(22, 3)); b.state.access.blockUserIds.push(...ids(23, 12))
    const roles = (list: number, from: number, to: number) => ids(list, to).slice(from).map(id => `<@&${id}>`).join(", ")
    const users = (list: number, from: number, to: number) => ids(list, to).slice(from).map(id => `<@${id}>`).join(", ")
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const runtime = yield* createTestBot(createBotOptions({ token, serverId }, { rolePicker: b.store })), f = runtime.fixtures
        const p = platform(runtime)
        yield* runtime.ready()
        const send = (content: string) => runtime.emit("MESSAGE_CREATE", f.message({ content })).pipe(Effect.andThen(runtime.idle()))
        const last = () => {
            const body = p.replies.requests().at(-1)!.body as { content?: string, embeds?: { title: string, description?: string, fields?: { name: string, value: string }[], footer?: { text: string } }[] }
            return body.content ?? body.embeds![0]!
        }
        const accent = { color: 0x5560e6 }
        yield* send("!rolepicker menu list")
        assert.deepEqual(last(), { ...accent, title: "Role picker menus",
            description: [...Array.from({ length: 10 }, (_, index) => `**menu-${index + 1}** Single choice, 25 of 25 roles`), "Show one with `!rolepicker menu show <name>`"].join("\n") })
        yield* send("!rolepicker menu show menu-1")
        assert.deepEqual(last(), { ...accent, title: "Menu menu-1", fields: [{ name: "Mode", value: "Single choice" }, { name: "Roles", value: roles(1, 0, 10) },
            { name: "Next", value: "`!rolepicker menu show menu-1 next`" }], footer: { text: "25 of 25 roles" } })
        yield* send("!rolepicker menu show menu-1 next")
        yield* send("!rolepicker menu show menu-1 next")
        assert.deepEqual(last(), { ...accent, title: "Menu menu-1", fields: [{ name: "Mode", value: "Single choice" }, { name: "Roles", value: roles(1, 20, 25) }], footer: { text: "25 of 25 roles" } })
        yield* send("!rolepicker menu show menu-1 next")
        assert.equal(last(), "There is no next page to show. Send !rolepicker menu show menu-1 to start the list again")
        yield* send("!rolepicker")
        assert.deepEqual((last() as { fields: unknown[] }).fields.at(-1), { name: "Menus", value: "10 of 10" })
        // Full allow lists show only their counts, and the note names the commands that list them
        yield* send("!rolepicker access")
        assert.deepEqual(last(), { ...accent, title: "Role picker access", description: "List them with `!rolepicker access allowed` or `!rolepicker access blocked`",
            fields: [{ name: "Who can use it", value: "Only allowed members who are not blocked" }, { name: "Allowed", value: "100 of 100 roles, 100 of 100 members" },
                { name: "Blocked", value: "3 roles, 12 members" }], footer: { text: "A block always wins over an allow" } })
        // A list shows its roles first and then its members, 10 entries a page
        yield* send("!rolepicker access blocked")
        assert.deepEqual(last(), { ...accent, title: "Role picker block list", fields: [{ name: "Roles", value: roles(22, 0, 3) }, { name: "Members", value: users(23, 0, 7) },
            { name: "Next", value: "`!rolepicker access blocked next`" }], footer: { text: "3 roles, 12 members" } })
        yield* send("!rolepicker access blocked next")
        assert.deepEqual(last(), { ...accent, title: "Role picker block list", fields: [{ name: "Members", value: users(23, 7, 12) }], footer: { text: "3 roles, 12 members" } })
        yield* send("!rolepicker access allowed")
        assert.deepEqual(last(), { ...accent, title: "Role picker allow list", fields: [{ name: "Roles", value: roles(20, 0, 10) }, { name: "Next", value: "`!rolepicker access allowed next`" }],
            footer: { text: "100 of 100 roles, 100 of 100 members" } })
        assert.equal(p.replies.requests().every(row => (row.body as { allowed_mentions?: { parse?: unknown[] } }).allowed_mentions?.parse?.length === 0), true)
        assert.equal(runtime.failures().length, 0)
    })))
})

test("Website member requests read the member fresh and change roles only through the shared role lifecycle", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: Redacted.value(token) }), f = bot.fixtures, native = nativeRoles(bot), roles = rolesBoundary()
        const absent = f.nextId()
        bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${absent}`, { status: 404, body: { code: 10007, message: "Unknown Member" } })
        const jobs = [job("synthetic_lookup", native.targetId, { type: "lookup" }), job("synthetic_claim", native.targetId, { type: "claim", menu: "colors", roleId: native.role.id }),
            job("synthetic_refused", native.targetId, { type: "claim", menu: "colors", roleId: native.second.id }), job("synthetic_drop", native.targetId, { type: "drop", menu: "colors", roleId: native.role.id }),
            job("synthetic_departed", absent, { type: "claim", menu: "colors", roleId: native.role.id }), job("synthetic_unavailable", native.targetId, { type: "drop", menu: "colors", roleId: native.second.id })]
        const b = pickerBoundary(jobs, (input, current) => current.id === "synthetic_unavailable" ? "fail"
            : current.id === "synthetic_refused" ? { proceed: false, job: { ...current, state: "failed", error: "You cannot use the role picker in this server" } }
                : { proceed: current.operation.type !== "lookup", job: { ...current, ...(current.operation.type === "lookup" ? { state: "applied" as const } : {}) } })
        yield* processRolePickerPass(b.store, roles.store, f.ids.guild, bot.client)
        // Every request starts from a fresh native read of that member
        assert.deepEqual(b.started.map(row => [row.jobId, row.context.userId, row.context.originServerId]), ["synthetic_lookup", "synthetic_claim", "synthetic_refused", "synthetic_drop", "synthetic_unavailable"]
            .map(id => [id, native.targetId, f.ids.guild]))
        assert.deepEqual(b.started[1]!.context.roleIds, [native.targetRole.id])
        // The same read supplies the server's role names and colors for the backend to keep for menu roles only
        assert.deepEqual(b.started[0]!.display?.find(role => role.roleId === native.role.id), { roleId: native.role.id, name: native.role.name, color: native.role.color })
        assert.equal(b.started.every(row => row.display?.length && !row.display.some(role => role.roleId === f.ids.guild)), true)
        assert.equal(b.completed.every(row => row.display?.some(role => role.roleId === native.second.id)), true)
        // Claims and drops go through evaluate, a one-time dispatch claim and a recorded native outcome
        const evaluations = roles.calls.filter(call => call.method === "evaluate").map(call => call.input as RolesEvaluateRequest)
        assert.equal(evaluations.length, 4)
        assert.deepEqual(evaluations.filter(row => !row.continuationAttemptId).map(row => [row.sourceId, row.operation]), [
            ["picker_synthetic_claim", { type: "pick", jobId: "synthetic_claim", menu: "colors", roleId: native.role.id, selected: true }],
            ["picker_synthetic_drop", { type: "pick", jobId: "synthetic_drop", menu: "colors", roleId: native.role.id, selected: false }],
        ])
        assert.deepEqual(roles.calls.filter(call => call.method === "outcome").map(call => (call.input as RolesOutcomeRequest).outcome), ["succeeded", "succeeded"])
        assert.deepEqual([native.add.requests().length, native.remove.requests().length], [1, 1])
        assert.equal(native.roleIds.has(native.role.id), false)
        // The member's roles after each change decide the recorded result
        assert.deepEqual(b.completed.map(row => [row.jobId, row.context.roleIds.includes(native.role.id)]), [["synthetic_claim", true], ["synthetic_drop", false]])
        assert.deepEqual(b.failed, ["synthetic_departed", "synthetic_unavailable"])
        assert.equal(bot.failures().length, 0)
    })))
})

test("Dashboard role picker saves read menu roles natively and refuse unsafe roles before the backend", async t => {
    const now = Date.parse("2026-10-05T10:00:00Z")
    for (const unsafe of [false, true]) await t.test(unsafe ? "Unsafe role" : "Safe role", async st => {
        const executions: DashboardConfigurationExecuteRequest[] = [], failures: unknown[] = []
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            yield* TestClock.setTime(now)
            const bot = yield* createTestBot({ token: Redacted.value(token) }), f = bot.fixtures
            const p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ManageGuild | Permissions.ViewChannel, botPermissions: Permissions.ManageRoles | Permissions.ViewChannel | Permissions.SendMessages })
            bot.rest.respond(`GET /users/${f.ids.user}`, { body: f.user({ bot: undefined, system: undefined }) })
            const roleId = unsafe ? p.botRole.id : p.targetRole.id
            const job: DashboardConfigurationReadyJob = { family: "rolepicker", operation: { type: "menu-set", name: "colors", mode: "single", roleIds: [roleId] }, native: { roleIds: [roleId] },
                id: "synthetic_picker_job", actorId: f.ids.user, expectedConfigRevision: 0, state: "queued", createdAt: now, expiresAt: now + 120000 }
            mockBackend(st, (call) => {
                if (call.path === "/dashboard-configuration/ready") return { jobs: [job] }
                if (call.path === "/dashboard-configuration/fail") { failures.push(call.body); return null }
                assert.equal(call.path, "/dashboard-configuration/execute")
                executions.push(call.body as DashboardConfigurationExecuteRequest)
                const { native: _native, ...stored } = job
                return { job: { ...stored, state: "applied" } }
            })
            yield* processDashboardConfigurationPass({ token, serverId: f.ids.guild, backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic") } }, bot.client)
        })).pipe(Effect.provide(TestClock.layer())))
        assert.deepEqual([executions.length, failures.length], unsafe ? [0, 1] : [1, 0])
        if (!unsafe) {
            const execution = executions[0]!
            assert.equal(execution.managerAuthorized, true)
            assert.equal(execution.roles?.some(role => role.botCanManage && role.actorCanManage), true)
            assert.deepEqual(execution.references?.map(reference => reference.type), ["role"])
            assert.equal(execution.display?.some(role => role.roleId === execution.references![0]!.id), true)
        }
    })
})
