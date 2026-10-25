import assert from "node:assert/strict"
import test from "node:test"
import { adapterFixture } from "./adapter-fixture.ts"
import { AlertsStoreError, createAlertsStore } from "../../bot/src/alerts-store.ts"

const modules = { "../convex/alerts.ts": () => import("../convex/alerts.ts") }

test("the security alerts adapter round trips through the real HTTP boundary", async (t) => {
    const f = await adapterFixture(t, modules)
    const run = (effect: unknown): Promise<any> => f.run(effect)
    const actor = {
        originServerId: "1",
        userId: "10",
        roleIds: [],
        isOwner: true,
        isAdministrator: false,
        nativePermissionAuthorized: true,
    }
    const chat = () => ({ ...f.source(), originServerId: "1", actor, managerAuthorized: true as const })
    const store = createAlertsStore(f.config)
    assert.equal((await run(store.get({ serverId: "1" }))).settings.privileges, false)
    assert.equal(
        (await run(store.manage({ ...chat(), operation: { type: "set", alert: "privileges", enabled: true } })))
            .settings.privileges,
        true,
    )
    assert.deepEqual(
        (
            await run(
                store.manage({ ...chat(), operation: { type: "expect", kind: "webhook", id: "60", expected: true } }),
            )
        ).settings.expectedWebhookIds,
        ["60"],
    )
    // More than 50 expected webhooks pass the bot's contract both ways
    for (let id = 61; id <= 111; id++)
        await run(
            store.manage({
                ...chat(),
                operation: { type: "expect", kind: "webhook", id: String(id), expected: true },
            }),
        )
    assert.equal((await run(store.get({ serverId: "1" }))).settings.expectedWebhookIds.length, 52)
    await f.reject(
        store.manage({
            ...chat(),
            actor: { ...actor, nativePermissionAuthorized: false },
            operation: { type: "set", alert: "bots", enabled: true },
        }),
        AlertsStoreError,
        403,
    )
    // Turning an action on needs the owner or an Administrator. The actor here is the owner
    await f.reject(
        store.manage({
            ...chat(),
            actor: { ...actor, isOwner: false },
            operation: { type: "action", action: "removePermissions", enabled: true },
        }),
        AlertsStoreError,
        403,
    )
    assert.equal(
        (
            await run(
                store.manage({ ...chat(), operation: { type: "action", action: "removePermissions", enabled: true } }),
            )
        ).settings.removePermissions,
        true,
    )
    const key = "audit:70",
        claim = { serverId: "1", key, action: "removePermissions" as const, targetId: "40", actorId: "11" }
    assert.deepEqual(await run(store.claimAction({ ...claim, permissions: ["Administrator"] })), { claimed: true })
    assert.deepEqual(await run(store.claimAction({ ...claim, permissions: ["Administrator"] })), { claimed: false })
    assert.deepEqual(await run(store.actionOutcome({ serverId: "1", key, outcome: "failed" })), {
        recorded: true,
        admitted: false,
    })
    assert.deepEqual(await run(store.observeActions({ serverId: "1" })), { uncertain: 0, admitted: false })
    t.diagnostic(`${f.calls.length} real in-process HTTP calls, no real network`)
})
