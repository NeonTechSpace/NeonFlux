import assert from "node:assert/strict"
import test from "node:test"
import type {
    ModerationActionContext,
    ModerationManageResult,
    ModerationOutcomeResult,
    ModerationWarningPenaltyResult,
} from "@neonflux/contracts/moderation"
import type { ModerationActor } from "@neonflux/contracts/shared"
import { adapterFixture } from "./adapter-fixture.ts"
import { createModerationStore } from "../../bot/src/moderation-store.ts"

const modules = {
    "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/protection.ts": () => import("../convex/protection.ts"),
}
const owner: ModerationActor = {
    originServerId: "1",
    userId: "10",
    roleIds: [],
    isOwner: true,
    isAdministrator: false,
    nativePermissionAuthorized: true,
}
const context: ModerationActionContext = {
    originServerId: "1",
    botId: "999",
    botActionAuthorized: true,
    actorCanManageTarget: true,
    botCanManageTarget: true,
    targetProtected: false,
    currentTimeoutUntil: null,
}

test("The bot's moderation adapter decodes a real warning limit penalty, and a lost or repeated answer adds nothing", async (t) => {
    const f = await adapterFixture(t, modules),
        store = createModerationStore(f.config)
    const settings = await f.run<ModerationManageResult>(
        store.manage({
            ...f.source(),
            actor: owner,
            operation: {
                type: "settings",
                patch: { warningPenaltyEnabled: true, automodMode: "enforce", logChannelId: "500" },
            },
        }),
    )
    assert.ok(!settings.duplicate && settings.type === "settings")
    assert.equal(settings.settings.warningPenaltyEnabled, true)
    const warn = async () => {
        const reserved = await f.run<ModerationManageResult>(
            store.manage({
                ...f.source(),
                actor: owner,
                operation: { type: "action", action: { type: "warn", targetId: "20", reason: "Reason" }, context },
            }),
        )
        assert.ok(!reserved.duplicate && reserved.type === "case" && reserved.grant)
        return reserved.grant
    }
    const report = (grant: { actionId: string; caseNo: number }) =>
        store.outcome({ serverId: "1", actionId: grant.actionId, caseNo: grant.caseNo, outcome: "succeeded" })
    for (let i = 0; i < 2; i++) {
        const result = await f.run<ModerationOutcomeResult>(report(await warn()))
        assert.equal(result.warningPenaltyDue, undefined)
    }
    const third = await warn()
    const reached = await f.run<ModerationOutcomeResult>(report(third))
    assert.equal(reached.warningPenaltyDue, true)
    // The report was recorded, and repeating it answers nothing due
    assert.deepEqual(await f.run(report(third)), { recorded: false })

    const request = {
        serverId: "1",
        actionId: third.actionId,
        caseNo: third.caseNo,
        userId: "20",
        roleIds: [],
        context,
    }
    // The answer is lost on its way back, so the repeated request finds the case that was opened
    f.afterApplied((path) => {
        if (path === "/moderation/warning-penalty") throw new Error("Synthetic lost answer")
    })
    await assert.rejects(f.run(store.warningPenalty(request)))
    f.afterApplied()
    assert.deepEqual(await f.run(store.warningPenalty(request)), {})

    const fourth = await warn()
    await f.run(report(fourth))
    const fifth = await warn()
    await f.run(report(fifth))
    const sixth = await warn()
    const again = await f.run<ModerationOutcomeResult>(report(sixth))
    assert.equal(again.warningPenaltyDue, true)
    const opened = await f.run<ModerationWarningPenaltyResult>(
        store.warningPenalty({ ...request, actionId: sixth.actionId, caseNo: sixth.caseNo }),
    )
    assert.equal(opened.grant?.action, "timeout")
    assert.equal(opened.grant?.sourceId, `warnings:${sixth.caseNo}`)
    assert.equal(opened.case?.origin, "penalty")
    assert.equal(opened.case?.linkedCaseNo, sixth.caseNo)
    const done = await f.run<ModerationOutcomeResult>(
        store.outcome({
            serverId: "1",
            actionId: opened.grant!.actionId,
            caseNo: opened.grant!.caseNo,
            outcome: "succeeded",
            timeoutUntil: new Date(f.now() + 3600000).toISOString(),
        }),
    )
    assert.equal(done.log?.action, "timeout")
    assert.equal(done.notice?.action, "timeout")
    const listed = await f.run<{ type: string; cases: { origin: string }[] }>(
        store.query({
            serverId: "1",
            actor: owner,
            originServerId: "1",
            privateChannelVerified: true,
            operation: { type: "case-list", userId: "20" },
        }),
    )
    assert.equal(listed.cases.filter((row) => row.origin === "penalty").length, 2)
})

test("A warning limit change is recorded in the audit log, from chat and with its values", async (t) => {
    const f = await adapterFixture(t, modules),
        store = createModerationStore(f.config)
    await f.run(
        store.manage({
            ...f.source(),
            actor: owner,
            operation: { type: "settings", patch: { warningPenaltyEnabled: true, warningPenaltyCount: 5 } },
        }),
    )
    const entries = await f.backend.run((ctx) => ctx.db.query("auditLogEntries").collect())
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.source, "command")
    assert.equal(entries[0]!.actorId, "10")
    assert.equal(entries[0]!.summary, "warningPenaltyCount: none → 5; warningPenaltyEnabled: none → on")
})
