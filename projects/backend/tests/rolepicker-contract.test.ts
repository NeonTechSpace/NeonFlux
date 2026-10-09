import assert from "node:assert/strict"
import test from "node:test"
import type { RolePickerCompleteResult, RolePickerManageRequest, RolePickerMemberOperation, RolePickerOperation, RolePickerReadyResult, RolePickerStartResult, RolePickerState } from "@neonflux/contracts/role-picker"
import type { RolesDispatchResult, RolesEvaluateResult } from "@neonflux/contracts/roles"
import type { ModerationActor, RolesMemberContext, RolesRoleSnapshot } from "@neonflux/contracts/shared"
import { adapterFixture } from "./adapter-fixture.ts"
import { createRolePickerStore, RolePickerStoreError } from "../../bot/src/rolepicker-store.ts"
import { createRolesStore } from "../../bot/src/roles-store.ts"

const modules = {
    "../convex/rolePicker.ts": () => import("../convex/rolePicker.ts"),
    "../convex/roleParticipation.ts": () => import("../convex/roleParticipation.ts"),
    "../convex/roleLifecycle.ts": () => import("../convex/roleLifecycle.ts"),
    "../convex/dashboard.ts": () => import("../convex/dashboard.ts"),
    "../convex/dashboardConfiguration.ts": () => import("../convex/dashboardConfiguration.ts"),
}
const owner: ModerationActor = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
const roles: RolesRoleSnapshot[] = ["40", "41"].map(roleId => ({ originServerId: "1", roleId, permissions: "0", botCanManage: true, actorCanManage: true }))
const context = (roleIds: string[]): RolesMemberContext => ({ originServerId: "1", userId: "20", joinedAt: "2023-11-14T22:13:19.000Z", roleIds, isBot: false, timeoutUntil: null, botId: "999", botAuthorized: true, roles })

test("Bot role picker adapters decode real settings, member requests and pick grants", async t => {
    const f = await adapterFixture(t, modules), store = createRolePickerStore(f.config), rolesStore = createRolesStore(f.config)
    const manage = (operation: RolePickerOperation, extra: Partial<RolePickerManageRequest> = {}) => f.run<RolePickerState>(store.manage({ ...f.source(), actor: owner, operation, ...extra }))
    await manage({ type: "module", enabled: true })
    await manage({ type: "menu-add", name: "colors", mode: "single", description: "One colour" })
    const display = [{ roleId: "40", name: "Red", color: 16711680 }, { roleId: "41", name: "Blue", color: 255 }, { roleId: "42", name: "Outside", color: 0 }]
    const saved = await manage({ type: "menu-role-add", name: "colors", roleIds: ["40", "41"] }, { roles, display })
    assert.deepEqual(saved, { revision: 3, settings: { enabled: true, menus: [{ name: "colors", mode: "single", description: "One colour", roleIds: ["40", "41"], display: display.slice(0, 2) }] },
        access: { allowRoleIds: [], blockRoleIds: [], allowUserIds: [], blockUserIds: [] } })
    assert.deepEqual(await f.run(store.settings({ serverId: "1", actor: owner })), saved)
    await f.reject(store.manage({ ...f.source(), actor: { ...owner, isOwner: false }, operation: { type: "module", enabled: false } }), RolePickerStoreError, 403)
    // A signed-in member's queued requests, as the website mutation stores them
    const jobs = await f.backend.run(async ctx => {
        const sessionId = await ctx.db.insert("dashboardSessions", { tokenHash: "a".repeat(64), accessToken: "synthetic-provider-token", userId: "20", userName: "Member", servers: [], memberServers: [{ id: "1", name: "Server" }], expiresAt: f.now() + 300000, lifetimeAt: f.now() + 28800000 })
        const insert = (requestId: string, operation: RolePickerMemberOperation) => ctx.db.insert("dashboardConfigurationJobs", { serverId: "1", family: "member", actorId: "20", sessionId, requestId, expectedConfigRevision: 3, operation, state: "queued", createdAt: f.now(), expiresAt: f.now() + 120000, cleanupAt: f.now() + 86400000 })
        return [await insert("00000000-0000-4000-8000-000000000001", { type: "lookup" }), await insert("00000000-0000-4000-8000-000000000002", { type: "claim", menu: "colors", roleId: "40" }), await insert("00000000-0000-4000-8000-000000000003", { type: "drop", menu: "colors", roleId: "41" })]
    })
    const ready = await f.run<RolePickerReadyResult>(store.ready({ serverId: "1" }))
    assert.deepEqual(ready.jobs.map(job => [job.id, job.operation.type]), [[jobs[0], "lookup"], [jobs[1], "claim"], [jobs[2], "drop"]])
    const lookup = await f.run<RolePickerStartResult>(store.start({ serverId: "1", jobId: jobs[0]!, actorId: "20", context: context(["41"]), display }))
    assert.deepEqual([lookup.proceed, lookup.job.state], [false, "applied"])
    assert.deepEqual((await f.backend.run(ctx => ctx.db.query("rolePickerSnapshots").collect())).map(row => row.roles), [display.slice(0, 2)])
    const claim = ready.jobs[1]!, started = await f.run<RolePickerStartResult>(store.start({ serverId: "1", jobId: claim.id, actorId: "20", context: context([]) }))
    assert.equal(started.proceed, true)
    const evaluated = await f.run<RolesEvaluateResult>(rolesStore.evaluate({ serverId: "1", sourceId: `picker_${claim.id}`, createdAt: claim.createdAt, context: context([]), operation: { type: "pick", jobId: claim.id, menu: "colors", roleId: "40", selected: true } }))
    const grant = evaluated.grant!, binding = { serverId: "1", attemptId: grant.attemptId, ownershipId: grant.ownershipId, generation: grant.generation, sourceId: grant.sourceId }
    assert.deepEqual([grant.action, grant.roleId, grant.consumerKey], ["add", "40", "picker:colors"])
    assert.equal((await f.run<RolesDispatchResult>(rolesStore.dispatch({ ...binding, claimToken: "d".repeat(32), context: context([]) }))).claimed, true)
    await f.run(rolesStore.outcome({ ...binding, claimToken: "d".repeat(32), outcome: "succeeded" }))
    const completed = await f.run<RolePickerCompleteResult>(store.complete({ serverId: "1", jobId: claim.id, actorId: "20", context: context(["40"]) }))
    assert.equal(completed.job.state, "applied")
    // A request the bot could not finish is recorded as failed, and the role it never touched stays
    await f.run(store.fail({ serverId: "1", jobId: jobs[2]! }))
    assert.deepEqual((await f.run<RolePickerReadyResult>(store.ready({ serverId: "1" }))).jobs, [])
    await f.reject(store.start({ serverId: "1", jobId: jobs[2]!, actorId: "21", context: context([]) }), RolePickerStoreError, 403)
})
