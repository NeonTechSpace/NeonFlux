import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "../contracts.js"
import { adapterFixture } from "./adapter-fixture.ts"
import { createTemporaryRoleStore, TemporaryRoleStoreError } from "../../bot/src/temprole-store.ts"
import { createRolesStore } from "../../bot/src/roles-store.ts"

const modules = {
    "../convex/temporaryRoles.ts": () => import("../convex/temporaryRoles.ts"),
    "../convex/roleParticipation.ts": () => import("../convex/roleParticipation.ts"),
    "../convex/roleLifecycle.ts": () => import("../convex/roleLifecycle.ts"),
}
const staff: C.ModerationActor = { originServerId: "1", userId: "10", roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: true }
const roles: C.RolesRoleSnapshot[] = ["40", "41"].map(roleId => ({ originServerId: "1", roleId, permissions: "0", botCanManage: true, actorCanManage: true }))
const context = (roleIds: string[]): C.RolesMemberContext => ({ originServerId: "1", userId: "20", joinedAt: "2023-11-14T22:13:19.000Z", roleIds, isBot: false, timeoutUntil: null, botId: "999", botAuthorized: true, roles })

test("Bot temporary role adapters decode real grants, defaults, due work and the shared role grant", async t => {
    const f = await adapterFixture(t, modules), store = createTemporaryRoleStore(f.config), rolesStore = createRolesStore(f.config)
    const settings = await f.run<C.TemporaryRoleManageResult>(store.manage({ ...f.source(), actor: staff, operation: { type: "role", roleId: "40", defaultSeconds: 86400 } }))
    assert.deepEqual(settings, { type: "settings", revision: 1, settings: { roles: [{ roleId: "40", defaultSeconds: 86400 }] } })
    assert.deepEqual(await f.run(store.query({ serverId: "1", actor: staff, operation: { type: "settings" } })), settings)
    const added = await f.run<C.TemporaryRoleManageResult>(store.manage({ ...f.source(), actor: staff, context: context([]), operation: { type: "add", userId: "20", roleId: "40" } }))
    if (added.type !== "grant") throw new Error("Expected a grant")
    assert.deepEqual([added.grant.endsAt, added.grant.grantedBy], [f.now() + 86400000, "10"])
    await f.reject(store.manage({ ...f.source(), actor: { ...staff, nativePermissionAuthorized: false }, context: context([]), operation: { type: "add", userId: "20", roleId: "41", durationSeconds: 3600 } }), TemporaryRoleStoreError, 403)
    const evaluated = await f.run<C.RolesEvaluateResult>(rolesStore.evaluate({ serverId: "1", sourceId: added.grant.sourceId, createdAt: f.now(), context: context([]), operation: { type: "temporary", roleId: "40" } }))
    assert.deepEqual([evaluated.grant?.action, evaluated.grant?.consumerKey], ["add", "temporary"])
    const listed = await f.run<C.TemporaryRoleQueryResult>(store.query({ serverId: "1", actor: staff, operation: { type: "list", userId: "20" } }))
    assert.deepEqual(listed, { type: "grants", grants: [added.grant] })
    f.advance(86400000)
    const due = await f.run<C.TemporaryRoleWorkResult>(store.work({ serverId: "1", operation: { type: "list" } }))
    assert.deepEqual(due, { type: "grants", grants: [added.grant] })
    assert.deepEqual(await f.run(store.work({ serverId: "1", operation: { type: "problem", userId: "20", roleId: "40", sourceId: added.grant.sourceId, problem: "unavailable" } })), { type: "recorded", recorded: true })
    assert.deepEqual(await f.run(store.work({ serverId: "1", operation: { type: "end", userId: "20", roleId: "40", sourceId: added.grant.sourceId, reason: "role" } })), { type: "recorded", recorded: true })
    assert.deepEqual(await f.run(store.query({ serverId: "1", actor: staff, operation: { type: "list" } })), { type: "grants", grants: [] })
})
