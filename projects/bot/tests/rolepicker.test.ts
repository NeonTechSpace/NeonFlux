import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import type * as D from "@neonflux/backend/dashboard-contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { processDashboardConfigurationPass } from "../src/dashboard-configuration.ts"
import { RolePickerStoreError, type RolePickerStore } from "../src/rolepicker-store.ts"
import { processRolePickerPass } from "../src/rolepicker-worker.ts"
import { parseDeploymentScope } from "../src/server-scope.ts"
import { workKinds } from "../src/work-dispatcher.ts"
import { platform, token } from "./moderation-fixture.ts"
import { rolesBoundary } from "./roles-fixture.ts"
import { nativeRoles } from "./roles-native-fixture.ts"

test("Member requests run only after the work dispatcher wakes a server's dashboard worker, and idle servers make no role picker requests", async t => {
    const backend = { siteUrl: "https://synthetic.invalid", secret: Redacted.make("synthetic-secret") }
    const serverA = "1100000000000000001", serverB = "1100000000000000002", memberId = "1100000000000000077"
    const seen: { path: string, server: string | undefined, body: Record<string, unknown> }[] = [], waiters = new Map<string, () => void>()
    const called = (path: string, server: string) => new Promise<void>(resolve => { if (seen.some(row => row.path === path && row.server === server)) resolve(); else waiters.set(`${path} ${server}`, resolve) })
    let release!: (value: C.ServiceWork) => void, polls = 0
    const firstPoll = new Promise<C.ServiceWork>(resolve => { release = resolve })
    const noWork = Object.fromEntries(workKinds.map(kind => [kind, []])) as unknown as C.ServiceWork["kinds"]
    const job: C.RolePickerJob = { id: "synthetic_member_lookup", actorId: memberId, operation: { type: "lookup" }, state: "queued", createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER }
    t.mock.method(globalThis, "fetch", async (input: URL, init: RequestInit) => {
        const path = new URL(input).pathname, body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}, server = (init.headers as Record<string, string>)["X-NeonFlux-Server-ID"]
        seen.push({ path, server, body })
        waiters.get(`${path} ${server}`)?.()
        if (path === "/service/scope") return Response.json({ mode: "multi" })
        if (path === "/service/installations/list") return Response.json({ serverIds: [serverA, serverB], nextCursor: null })
        if (path === "/service/work") return Response.json(polls++ === 0 ? await firstPoll : { kinds: noWork, cursor: null })
        if (path === "/publishing/observe" || path === "/roles/observe") return Response.json({ uncertainAttempts: 0 })
        if (path === "/roles/reaction-jobs") return Response.json({ type: "jobs", jobs: [] })
        if (path === "/moderation/gate") return Response.json({ allowed: true, defcon: 3, messageProtectionEnabled: false, joinProtectionEnabled: false })
        if (path === "/afk/observe") return Response.json({ cleared: false, statuses: [] })
        if (path === "/rolepicker/ready") return Response.json({ jobs: [job] })
        if (path === "/rolepicker/start") return Response.json({ proceed: false, job: { ...job, state: "applied" } })
        // Manager dashboard passes fail here, which must not hold back member requests
        return Response.json({ error: "Backend unavailable" }, { status: 503 })
    })
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
        release({ kinds: { ...noWork, dashboard: [serverA] }, cursor: null })
        yield* Effect.promise(() => called("/rolepicker/start", serverA))
        const start = seen.find(row => row.path === "/rolepicker/start")!
        assert.deepEqual([start.body.jobId, (start.body.context as C.RolesMemberContext).userId, (start.body.context as C.RolesMemberContext).originServerId], [job.id, memberId, serverA])
        assert.equal((start.body.display as C.RolePickerRoleDisplay[]).some(role => role.roleId === botRole.id), true)
        assert.equal(seen.some(row => row.server === serverB && row.path.startsWith("/rolepicker/")), false)
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

// An in-memory backend boundary that keeps the chat operations and member request results it receives
function pickerBoundary(jobs: C.RolePickerJob[] = [], start: (input: C.RolePickerStartRequest, job: C.RolePickerJob) => C.RolePickerStartResult | "fail" = (_, job) => ({ proceed: job.operation.type !== "lookup", job })) {
    const state: C.RolePickerState = { revision: 0, settings: { enabled: false, menus: [] }, access: { allowRoleIds: [], blockRoleIds: [], allowUserIds: [], blockUserIds: [] } }
    const manages: C.RolePickerManageRequest[] = [], started: C.RolePickerStartRequest[] = [], completed: C.RolePickerCompleteRequest[] = [], failed: string[] = []
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
const job = (id: string, actorId: string, operation: C.RolePickerMemberOperation): C.RolePickerJob => ({ id, actorId, operation, state: "queued", createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER })

test("Role picker commands configure menus and access lists for administrators and refuse other members", async () => {
    const b = pickerBoundary(), serverId = createFixtures().ids.guild
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const runtime = yield* createTestBot(createBotOptions({ token, serverId }, { rolePicker: b.store })), f = runtime.fixtures
        const p = platform(runtime, { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.SendMessages, botPermissions: Permissions.ManageRoles | Permissions.ViewChannel | Permissions.SendMessages })
        yield* runtime.ready()
        const send = (content: string) => runtime.emit("MESSAGE_CREATE", f.message({ content })).pipe(Effect.andThen(runtime.idle()))
        const replies = () => p.replies.requests().map(row => (row.body as { content: string }).content)
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
            "!rolepicker menu set colors mode multi", "!rolepicker menu list", "!rolepicker menu shuffle"]) yield* send(command)
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
        assert.deepEqual(replies().slice(1), [
            "Role picker: On. Menus: 0 of 10\nMembers choose roles from these menus on the website\nEvery member who is not blocked may use the role picker",
            "Menu saved\ncolors: Single choice, 0 of 25 roles\nPick one colour\nRoles: None",
            `Menu saved\ncolors: Single choice, 1 of 25 roles\nPick one colour\nRoles: <@&${p.targetRole.id}>`,
            "Each role must sit below the bot's top role and yours, must not be everyone and must carry no moderation or management permissions",
            `Access lists saved\nEvery member who is not blocked may use the role picker\nAllowed roles: None\nAllowed users: None\nBlocked roles: None\nBlocked users: <@${blocked}>\nA block always wins over an allow`,
            "Name existing roles of this server. Leave the allow list empty for everyone instead of using the everyone role",
            `Menu saved\ncolors: Multiple choice, 1 of 25 roles\nPick one colour\nRoles: <@&${p.targetRole.id}>`,
            `colors: Multiple choice, 1 of 25 roles\nPick one colour\nRoles: <@&${p.targetRole.id}>`,
            "Use !rolepicker menu list, add <name> single|multi [\"description\"], remove <name>, set <name> mode single|multi, set <name> description \"text\"|none, or role add|remove <name> @roles...",
        ])
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
        const evaluations = roles.calls.filter(call => call.method === "evaluate").map(call => call.input as C.RolesEvaluateRequest)
        assert.equal(evaluations.length, 4)
        assert.deepEqual(evaluations.filter(row => !row.continuationAttemptId).map(row => [row.sourceId, row.operation]), [
            ["picker_synthetic_claim", { type: "pick", jobId: "synthetic_claim", menu: "colors", roleId: native.role.id, selected: true }],
            ["picker_synthetic_drop", { type: "pick", jobId: "synthetic_drop", menu: "colors", roleId: native.role.id, selected: false }],
        ])
        assert.deepEqual(roles.calls.filter(call => call.method === "outcome").map(call => (call.input as C.RolesOutcomeRequest).outcome), ["succeeded", "succeeded"])
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
        const executions: D.DashboardConfigurationExecuteRequest[] = [], failures: unknown[] = []
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            yield* TestClock.setTime(now)
            const bot = yield* createTestBot({ token: Redacted.value(token) }), f = bot.fixtures
            const p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ManageGuild | Permissions.ViewChannel, botPermissions: Permissions.ManageRoles | Permissions.ViewChannel | Permissions.SendMessages })
            bot.rest.respond(`GET /users/${f.ids.user}`, { body: f.user({ bot: undefined, system: undefined }) })
            const roleId = unsafe ? p.botRole.id : p.targetRole.id
            const job: D.DashboardConfigurationReadyJob = { family: "rolepicker", operation: { type: "menu-set", name: "colors", mode: "single", roleIds: [roleId] }, native: { roleIds: [roleId] },
                id: "synthetic_picker_job", actorId: f.ids.user, expectedConfigRevision: 0, state: "queued", createdAt: now, expiresAt: now + 120000 }
            st.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
                const path = new URL(String(url)).pathname, body = JSON.parse(String(init?.body))
                if (path === "/dashboard-configuration/ready") return Response.json({ jobs: [job] })
                if (path === "/dashboard-configuration/fail") { failures.push(body); return Response.json(null) }
                assert.equal(path, "/dashboard-configuration/execute")
                executions.push(body)
                const { native: _native, ...stored } = job
                return Response.json({ job: { ...stored, state: "applied" } })
            })
            yield* processDashboardConfigurationPass({ token, serverId: f.ids.guild, backend: { siteUrl: "https://synthetic.invalid", secret: Redacted.make("synthetic") } }, bot.client)
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
