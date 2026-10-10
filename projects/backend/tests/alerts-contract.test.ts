import assert from "node:assert/strict"
import test from "node:test"
import { adapterFixture } from "./adapter-fixture.ts"
import { AlertsStoreError, createAlertsStore } from "../../bot/src/alerts-store.ts"

const modules = { "../convex/alerts.ts": () => import("../convex/alerts.ts") }

test("the security alerts adapter round trips through the real HTTP boundary", async t => {
    const f = await adapterFixture(t, modules)
    const run = (effect: unknown): Promise<any> => f.run(effect)
    const actor = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
    const chat = () => ({ ...f.source(), originServerId: "1", actor, managerAuthorized: true as const })
    const store = createAlertsStore(f.config)
    assert.equal((await run(store.get({ serverId: "1" }))).settings.privileges, false)
    assert.equal((await run(store.manage({ ...chat(), operation: { type: "set", alert: "privileges", enabled: true } }))).settings.privileges, true)
    assert.deepEqual((await run(store.manage({ ...chat(), operation: { type: "expect", kind: "webhook", id: "60", expected: true } }))).settings.expectedWebhookIds, ["60"])
    await f.reject(store.manage({ ...chat(), actor: { ...actor, nativePermissionAuthorized: false }, operation: { type: "set", alert: "bots", enabled: true } }), AlertsStoreError, 403)
    t.diagnostic(`${f.calls.length} real in-process HTTP calls, no real network`)
})
