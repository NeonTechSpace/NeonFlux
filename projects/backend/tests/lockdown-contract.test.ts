import assert from "node:assert/strict"
import test from "node:test"
import { adapterFixture } from "./adapter-fixture.ts"
import { createLockdownStore } from "../../bot/src/lockdown-store.ts"
import { createAntiNukeStore, AntiNukeStoreError } from "../../bot/src/antinuke-store.ts"
import { defaultAntiNukeSettings } from "@neonflux/contracts/anti-nuke"

const modules = {
    "../convex/lockdown.ts": () => import("../convex/lockdown.ts"),
    "../convex/antiNuke.ts": () => import("../convex/antiNuke.ts"),
}
const actor = {
    originServerId: "1",
    userId: "10",
    roleIds: [],
    isOwner: true,
    isAdministrator: false,
    nativePermissionAuthorized: true,
}

test("The lockdown adapter round trips a lockdown through the real HTTP boundary", async (t) => {
    const f = await adapterFixture(t, modules)
    const store = createLockdownStore(f.config),
        run = (effect: unknown): Promise<any> => f.run(effect)
    const plan = [
        {
            channelId: "50",
            everyone: { exists: false, allow: "0", deny: "0" },
            bits: "2048",
            botBefore: { exists: false, allow: "0", deny: "0" },
            botSet: { allow: "2048", deny: "0" },
        },
    ]
    const started = await run(
        store.manage({
            ...f.source(),
            originServerId: "1",
            actor,
            operation: { type: "on", reason: "A raid", plan },
        } as never),
    )
    assert.equal(started.started, true)
    const claim = await run(store.work({ serverId: "1", type: "claim" }))
    assert.deepEqual(claim.rows, [{ channelId: "50", phase: "lock", ...plan[0] }])
    await run(store.work({ serverId: "1", type: "report", rows: [{ channelId: "50", outcome: "done" }] }))
    const status = await run(store.get({ serverId: "1", actor }))
    assert.equal(status.lockdown.state, "active")
    assert.equal(status.lockdown.counts.locked, 1)
})

test("The anti-nuke adapter round trips settings and an incident through the real HTTP boundary", async (t) => {
    const f = await adapterFixture(t, modules)
    const store = createAntiNukeStore(f.config),
        run = (effect: unknown): Promise<any> => f.run(effect)
    assert.deepEqual(await run(store.get({ serverId: "1" })), { settings: defaultAntiNukeSettings() })
    await run(
        store.manage({
            ...f.source(),
            originServerId: "1",
            actor,
            operation: { type: "module", enabled: true },
        } as never),
    )
    const claim = await run(
        store.open({
            serverId: "1",
            actorId: "60",
            actorKind: "staff",
            rule: "channels",
            counts: { "channel-delete": 6 },
            firstAt: f.now() - 1000,
            lastAt: f.now(),
            response: "strip",
            removedRoleIds: ["70"],
        }),
    )
    assert.deepEqual(claim, { claimed: true, incidentNo: 1, act: false, lockdown: false })
    assert.equal((await run(store.finish({ serverId: "1", incidentNo: 1, outcome: "alert" }))).recorded, true)
    const page = await run(store.incidents({ serverId: "1", actor, query: { type: "page" } }))
    assert.deepEqual(page.incidents[0].counts, { "channel-delete": 6 })
    await assert.rejects(
        () =>
            run(
                store.incidents({
                    serverId: "1",
                    actor: { ...actor, isOwner: false },
                    query: { type: "page" },
                }),
            ),
        (error: unknown) => error instanceof AntiNukeStoreError && error.status === 403,
    )
})
