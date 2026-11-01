import assert from "node:assert/strict"
import test from "node:test"
import { adapterFixture } from "./adapter-fixture.ts"
import { createJailStore, JailStoreError } from "../../bot/src/jail-store.ts"
import { createModerationStore } from "../../bot/src/moderation-store.ts"
import { createRightsStore } from "../../bot/src/rights-store.ts"
import { defaultRightsSettings } from "@neonflux/contracts/rights"

const modules = {
    "../convex/jail.ts": () => import("../convex/jail.ts"),
    "../convex/rights.ts": () => import("../convex/rights.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/moderationRetention.ts": () => import("../convex/moderationRetention.ts"),
    "../convex/metadataLogsWork.ts": () => import("../convex/metadataLogsWork.ts"),
    "../convex/schedulesDelivery.ts": () => import("../convex/schedulesDelivery.ts"),
    "../convex/milestonesDelivery.ts": () => import("../convex/milestonesDelivery.ts"),
    "../convex/levelingWork.ts": () => import("../convex/levelingWork.ts"),
}
const person = (userId: string, fields: Record<string, unknown> = {}) => ({
    originServerId: "1",
    userId,
    roleIds: [] as string[],
    isOwner: false,
    isAdministrator: false,
    nativePermissionAuthorized: false,
    ...fields,
})
const owner = person("10", { isOwner: true, nativePermissionAuthorized: true })
const staff = person("20", { roleIds: ["50"] })
const context = {
    originServerId: "1",
    botId: "999",
    botActionAuthorized: true,
    actorCanManageTarget: true,
    botCanManageTarget: true,
    targetProtected: false,
    rightRoleIds: ["50"],
    targetRoleIds: ["71", "72"],
}

test("The rights and moderation adapters round trip a right, its grant, its limit and its suspension", async (t) => {
    const f = await adapterFixture(t, modules)
    const rights = createRightsStore(f.config),
        moderation = createModerationStore(f.config),
        run = (effect: unknown): Promise<any> => f.run(effect)
    const manageRights = (operation: unknown) =>
        run(rights.manage({ ...f.source(), originServerId: "1", actor: owner, operation } as never))
    assert.deepEqual((await run(rights.get({ serverId: "1" }))).settings, defaultRightsSettings())
    await run(
        moderation.manage({
            ...f.source(),
            actor: owner,
            operation: { type: "settings", patch: { staffRoleIds: { moderation: ["50"] } } },
        } as never),
    )
    await manageRights({ type: "module", enabled: true })
    await manageRights({ type: "grant", roleId: "50", rights: ["kick"] })
    await manageRights({ type: "limit", right: "kick", count: 1, minutes: 5 })
    const kick = () =>
        run(
            moderation.manage({
                ...f.source(),
                actor: staff,
                operation: { type: "action", action: { type: "kick", targetId: "30" }, context },
            } as never),
        )
    const first = await kick()
    assert.equal(first.case.viaRight, "kick")
    assert.equal(first.grant.viaRight, "kick")
    assert.deepEqual(first.grant.rightRoleIds, ["50"])
    const claim = await run(
        moderation.dispatch({
            serverId: "1",
            actionId: first.grant.actionId,
            caseNo: first.grant.caseNo,
            dispatch: true,
        }),
    )
    assert.equal(claim.rightWithdrawn, undefined)
    const over = await kick()
    assert.equal(over.type, "right-refused")
    assert.equal(over.reason, "limit")
    const status = await run(rights.status({ serverId: "1", actor: owner as never }))
    assert.deepEqual(
        status.suspended.map((row: { userId: string }) => row.userId),
        ["20"],
    )
    assert.deepEqual(await run(rights.suspend({ serverId: "1", userId: "20" })), { suspended: false, admitted: false })
})

test("The jail and moderation adapters round trip a setup, a jail, its record and its release", async (t) => {
    const f = await adapterFixture(t, modules)
    const jail = createJailStore(f.config),
        moderation = createModerationStore(f.config),
        run = (effect: unknown): Promise<any> => f.run(effect)
    await run(
        jail.manage({
            ...f.source(),
            originServerId: "1",
            actor: owner,
            operation: { type: "setup", roleId: "60", channelId: "61" },
        } as never),
    )
    const act = (action: unknown) =>
        run(moderation.manage({ ...f.source(), actor: owner, operation: { type: "action", action, context } } as never))
    const jailed = await act({ type: "jail", targetId: "30", durationSeconds: 60, reason: "Spam" })
    assert.equal(jailed.grant.jailRoleId, "60")
    assert.deepEqual(jailed.grant.expectedRoleIds, ["71", "72"])
    const settled = await run(
        moderation.outcome({
            serverId: "1",
            actionId: jailed.grant.actionId,
            caseNo: jailed.grant.caseNo,
            outcome: "succeeded",
        }),
    )
    assert.equal(settled.notice.action, "jail")
    const memory = await run(jail.memory({ serverId: "1" }))
    assert.deepEqual(memory.jailedIds, ["30"])
    assert.equal(memory.settings.roleId, "60")
    assert.equal(memory.setupRunning, true)
    await run(
        jail.report({
            serverId: "1",
            setup: {
                state: "done",
                total: 2,
                done: 1,
                problems: [{ channelId: "90", state: "failed" }],
                moreProblems: 0,
            },
        }),
    )
    const status = await run(jail.status({ serverId: "1", actor: owner as never }))
    assert.equal(status.count, 1)
    assert.equal(status.setup.problems[0].channelId, "90")
    const list = await run(
        jail.list({ serverId: "1", originServerId: "1", actor: owner as never, privateChannelVerified: true }),
    )
    assert.equal(list.entries[0].userId, "30")
    assert.equal(list.entries[0].roleCount, 2)
    const record = await run(
        moderation.query({
            serverId: "1",
            actor: owner as never,
            operation: { type: "jail-record", targetId: "30" },
        }),
    )
    assert.deepEqual(record.roleIds, ["71", "72"])
    assert.deepEqual(await run(jail.due({ serverId: "1" })), { userIds: [] })
    assert.deepEqual(await run(jail.release({ serverId: "1", userId: "30", context: context as never })), {})
    const released = await act({ type: "unjail", targetId: "30" })
    assert.deepEqual(released.grant.restoreRoleIds, ["71", "72"])
    assert.deepEqual(
        await run(jail.held({ serverId: "1", userId: "30", kind: "rejoin", outcome: "succeeded", at: 1 })),
        {
            admitted: false,
        },
    )
    await assert.rejects(
        () =>
            run(
                jail.manage({
                    ...f.source(),
                    originServerId: "1",
                    actor: staff,
                    operation: { type: "module", enabled: false },
                } as never),
            ),
        (error: unknown) => error instanceof JailStoreError && error.status === 403,
    )
})
