import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Effect, Redacted } from "effect"
import { createModerationStore, ModerationStoreError, moderationErrorMessage } from "../src/moderation-store.ts"
import { deriveServiceKey } from "../src/backend-http.ts"
import { mockBackend, type BackendCall } from "./backend-fake.ts"

const serverId = "123456789012345678"
const actorId = "123456789012345679"
const targetId = "123456789012345680"
const channelId = "123456789012345681"
const messageId = "123456789012345682"
const otherId = "123456789012345683"
const secret = "synthetic-moderation-adapter-test-secret"
const config = { url: "https://synthetic-test.convex.cloud", secret: Redacted.make(secret) }
const actor: C.ModerationActor = { userId: actorId, roleIds: [serverId], isOwner: true, isAdministrator: true, nativePermissionAuthorized: true }
const context: C.ModerationActionContext = { botId: otherId, botActionAuthorized: true, actorCanManageTarget: true, botCanManageTarget: true, targetProtected: false, currentTimeoutUntil: null }
const source = { serverId, messageId, createdAt: 1000 }

function fixture(t: TestContext) {
    let payload: unknown
    const requests: BackendCall[] = []
    mockBackend(t, call => {
        requests.push(call)
        return payload
    })
    return { store: createModerationStore(config), requests, respond: (value: unknown) => { payload = value } }
}
function actionRequest(action: C.ModerationActionInput, proof: C.ModerationActionContext = context): C.ModerationManageRequest {
    return { ...source, actor, operation: { type: "action", action, context: proof } }
}
function actionResult(action: C.ModerationActionInput, extras: Partial<C.ModerationActionGrant> = {}): Extract<C.ModerationManageResult, { type: "case" }> {
    const grant: C.ModerationActionGrant = { actionId: "synthetic_case_11", caseNo: 11, sourceId: messageId, action: action.type, reason: action.reason,
        ...(action.targetId ? { targetId: action.targetId } : {}), ...(action.channelId ? { channelId: action.channelId } : {}),
        ...(action.durationSeconds ? { durationSeconds: action.durationSeconds } : {}), ...(action.messageIds ? { messageIds: action.messageIds } : {}),
        ...(["timeout", "quarantine", "untimeout", "release"].includes(action.type) ? { expectedTimeoutUntil: null } : {}), ...extras }
    const value: C.ModerationCase = { actionId: grant.actionId, caseNo: grant.caseNo, sourceId: grant.sourceId, action: grant.action,
        origin: "manual", actorId, reason: grant.reason, createdAt: 1000, expiresAt: 2000, outcome: "pending", logOutcome: "none", notificationOutcome: "none",
        erased: false, voided: false, corrections: [], ...(grant.targetId ? { targetId: grant.targetId } : {}), ...(grant.channelId ? { channelId: grant.channelId } : {}),
        ...(action.linkedCaseNo ? { linkedCaseNo: action.linkedCaseNo } : {}) }
    return { duplicate: false, type: "case", case: value, grant }
}
async function rejected<A>(operation: Effect.Effect<A, unknown>) { await assert.rejects(Effect.runPromise(operation), /ModerationStoreError/) }
const timeoutAction: C.ModerationActionInput = { type: "timeout", targetId, durationSeconds: 60, reason: "Synthetic reason" }
const appeal: C.Appeal = { appealNo: 7, caseNo: 11, userId: targetId, text: "Synthetic private appeal", createdAt: 1000, status: "open", erased: false }

test("Moderation backend adapter sends exact authenticated requests and accepts a newly allocated recovery", async t => {
    const f = fixture(t)
    const request = actionRequest(timeoutAction)
    const response = actionResult(timeoutAction, { recoveryId: "new_recovery", expectedTimeoutUntil: null })
    f.respond(response)
    assert.deepEqual(await Effect.runPromise(f.store.manage(request)), response)
    const read: C.ModerationQueryRequest = { serverId, actor, privateChannelVerified: true, operation: { type: "case-show", caseNo: 11 } }
    f.respond({ type: "case", case: response.case })
    await Effect.runPromise(f.store.query(read))
    assert.deepEqual(f.requests.map(value => value.path), ["/moderation/manage", "/moderation/query"])
    assert.deepEqual(f.requests.map(value => value.body), [request, read])
    for (const value of f.requests) {
        assert.ok(value.signal instanceof AbortSignal)
        assert.equal(value.key, Redacted.value(deriveServiceKey(config.secret)))
        assert.ok(!JSON.stringify(value).includes(secret))
    }
})

test("Action grants cannot substitute another action, target, source, or purge selection", async t => {
    const f = fixture(t)
    const request = actionRequest(timeoutAction)
    for (const patch of [
        { action: "ban" as const }, { targetId: otherId }, { sourceId: otherId },
    ]) {
        f.respond(actionResult(timeoutAction, patch))
        await rejected(f.store.manage(request))
    }
    const purge: C.ModerationActionInput = { type: "purge", channelId, messageIds: [messageId, otherId], reason: "Synthetic purge" }
    f.respond(actionResult(purge))
    await Effect.runPromise(f.store.manage(actionRequest(purge)))
    for (const selection of [[messageId], [messageId, targetId], [messageId, messageId]]) {
        f.respond(actionResult(purge, { messageIds: selection }))
        await rejected(f.store.manage(actionRequest(purge)))
    }
})

test("Automation grants cannot introduce a manual ban or change the message being moderated", async t => {
    const f = fixture(t)
    const request: C.ModerationEvaluateRequest = { ...source, event: "create", userId: targetId, channelId, roleIds: [], content: "Synthetic blocked content",
        contentHash: "a".repeat(64), mentionedUserIds: [], mentionedRoleIds: [], mentionedEveryone: false, targetIsStaff: false, context }
    const deletion: C.ModerationActionInput = { type: "delete", targetId, channelId, messageIds: [messageId], reason: "Synthetic automation" }
    const result = actionResult(deletion)
    const evaluation = { duplicate: false, blocked: true, case: { ...result.case, origin: "automod" }, grant: result.grant }
    f.respond(evaluation)
    await Effect.runPromise(f.store.evaluate(request))
    for (const changed of [
        actionResult({ type: "ban", targetId, reason: "Synthetic forbidden automation" }),
        actionResult({ ...deletion, targetId: otherId }),
        actionResult(deletion, { sourceId: otherId }),
        actionResult({ ...deletion, messageIds: [otherId] }),
    ]) {
        f.respond({ duplicate: false, blocked: true, case: { ...changed.case, origin: "automod" }, grant: changed.grant })
        await rejected(f.store.evaluate(request))
    }
})

test("Owned reversal grants must match the existing recovery and linked case", async t => {
    const f = fixture(t)
    const release: C.ModerationActionInput = { type: "release", targetId, recoveryId: "existing_recovery", linkedCaseNo: 10, reason: "Synthetic release" }
    const response = actionResult(release, { recoveryId: "existing_recovery", expectedTimeoutUntil: "2026-01-01T00:00:00Z", restoreTimeoutUntil: null })
    const request = actionRequest(release, { ...context, currentTimeoutUntil: "2026-01-01T00:00:00Z" })
    f.respond(response)
    await Effect.runPromise(f.store.manage(request))
    f.respond(actionResult(release, { ...response.grant, recoveryId: "unrelated_recovery" }))
    await rejected(f.store.manage(request))
    f.respond({ ...response, case: { ...response.case, linkedCaseNo: 9 } })
    await rejected(f.store.manage(request))
})

test("Voiding a case accepts a distinct linked log generation without replaying its original sanction", async t => {
    const f = fixture(t)
    const result = actionResult({ type: "log", targetId, linkedCaseNo: 10, reason: "Case 10 voided" })
    const request: C.ModerationManageRequest = { ...source, actor, operation: { type: "case-void", caseNo: 10 } }
    f.respond(result)
    assert.deepEqual(await Effect.runPromise(f.store.manage(request)), result)
    f.respond({ ...result, case: { ...result.case, caseNo: 10 }, grant: { ...result.grant, caseNo: 10 } })
    await rejected(f.store.manage(request))
    f.respond(actionResult({ type: "kick", targetId, linkedCaseNo: 10, reason: "Synthetic wrong action" }))
    await rejected(f.store.manage(request))
})

test("Strict DTO projections reject internal storage fields at both case and recovery boundaries", async t => {
    const f = fixture(t)
    const result = actionResult(timeoutAction)
    f.respond({ ...result, case: { ...result.case, grant: result.grant } })
    await rejected(f.store.manage(actionRequest(timeoutAction)))
    f.respond({ ...result, grant: { ...result.grant, serverId } })
    await rejected(f.store.manage(actionRequest(timeoutAction)))
    const recovery: C.SecurityRecovery = { recoveryId: "existing_recovery", generation: 11, type: "timeout", targetId, caseNo: 11, status: "uncertain", createdAt: 1000, expectedTimeoutUntil: "2026-01-01T00:00:00Z" }
    const request: C.ModerationQueryRequest = { serverId, actor, operation: { type: "recovery-target", targetId } }
    f.respond({ type: "recovery", recovery })
    await Effect.runPromise(f.store.query(request))
    for (const internal of [{ _id: "storage_id" }, { serverId }, { reversalState: { generation: 10, status: "active" } }]) {
        f.respond({ type: "recovery", recovery: { ...recovery, ...internal } })
        await rejected(f.store.query(request))
    }
})

test("Private appeal results stay bound to requester and requested appeal", async t => {
    const f = fixture(t)
    const request: C.AppealMemberRequest = { ...source, requesterId: targetId, privateChannelVerified: true, operation: { type: "show", appealNo: 7 } }
    f.respond({ duplicate: false, type: "appeal", appeal })
    await Effect.runPromise(f.store.memberAppeal(request))
    for (const patch of [{ userId: otherId }, { appealNo: 8 }]) {
        f.respond({ duplicate: false, type: "appeal", appeal: { ...appeal, ...patch } })
        await rejected(f.store.memberAppeal(request))
    }
    const list: C.AppealMemberRequest = { ...request, operation: { type: "list", page: 2 } }
    f.respond({ duplicate: false, type: "appeals", appeals: [appeal], page: 2, totalPages: 2 })
    await Effect.runPromise(f.store.memberAppeal(list))
    for (const payload of [
        { duplicate: false, type: "appeals", appeals: [{ ...appeal, userId: otherId }], page: 2, totalPages: 2 },
        { duplicate: false, type: "appeals", appeals: Array.from({ length: 11 }, (_, index) => ({ ...appeal, appealNo: index + 1 })), page: 2, totalPages: 2 },
    ]) { f.respond(payload); await rejected(f.store.memberAppeal(list)) }
    const staff: C.AppealStaffRequest = { ...source, actor, privateChannelVerified: true, operation: { type: "decide", appealNo: 7, decision: "accepted", reason: "Synthetic decision" } }
    f.respond({ duplicate: false, type: "appeal", appeal: { ...appeal, appealNo: 8, status: "accepted" } })
    await rejected(f.store.staffAppeal(staff))
    f.respond({ duplicate: false, type: "appeal", appeal: { ...appeal, status: "accepted" } })
    await Effect.runPromise(f.store.staffAppeal(staff))
})

test("Outcome delivery grants are bound to the acknowledged action", async t => {
    const f = fixture(t)
    const request: C.ModerationOutcomeRequest = { serverId, actionId: "synthetic_case_11", caseNo: 11, outcome: "succeeded" }
    const log: C.StaffLogGrant = { logId: request.actionId, channelId, caseNo: 11, action: "warn", outcome: "succeeded", targetId, reason: "Synthetic reason" }
    const notice: C.WarningNoticeGrant = { noticeId: request.actionId, caseNo: 11, targetId, reason: "Synthetic reason" }
    f.respond({ recorded: true, log, notice })
    await Effect.runPromise(f.store.outcome(request))
    for (const payload of [
        { recorded: true, log: { ...log, logId: "unrelated_case" } }, { recorded: true, log: { ...log, caseNo: 12 } },
        { recorded: true, notice: { ...notice, noticeId: "unrelated_case" } }, { recorded: true, notice: { ...notice, caseNo: 12 } },
    ]) { f.respond(payload); await rejected(f.store.outcome(request)) }
    f.respond({ recorded: false })
    await Effect.runPromise(f.store.outcome(request))
})

test("Lock grants may own SendMessages and the thread bits only", async t => {
    const f = fixture(t)
    const lock: C.ModerationActionInput = { type: "lock", channelId, reason: "Synthetic reason" }
    const request = actionRequest(lock, { ...context, currentOverwrite: { exists: false, allow: "0", deny: "0" } })
    const overwrite = { overwrite: { exists: true, allow: "0", deny: "2048" }, expectedOverwrite: { exists: false, allow: "0", deny: "0" } }
    // SendMessages, CreatePublicThreads, CreatePrivateThreads and SendMessagesInThreads
    f.respond(actionResult(lock, { ...overwrite, ownedPermissions: String(2048n | 1n << 35n | 1n << 36n | 1n << 38n) }))
    assert.equal((await Effect.runPromise(f.store.manage(request))).duplicate, false)
    // Administrator, a thread bit without SendMessages and malformed values are refused
    for (const ownedPermissions of [String(2048n | 8n), String(1n << 38n), "0", "02048"]) {
        f.respond(actionResult(lock, { ...overwrite, ownedPermissions }))
        await rejected(f.store.manage(request))
    }
})

test("backend refusals read as one plain line that says what happened and what to do", () => {
    const messages = [400, 403, 404, 409, 429, 500, null].map(status => moderationErrorMessage(new ModerationStoreError({ operation: "manage", status })))
    assert.deepEqual(messages.slice(0, 5).filter((_, index) => index !== 1), [
        "Some values in the command are not valid. Check them and try again",
        "NeonFlux could not find that case, appeal, rule or entry. Check the number or name",
        "That already exists or changed in the meantime. Look at it again before you retry",
        "A limit was reached. Remove an entry you no longer need, or wait a minute and try again",
    ])
    for (const message of messages) {
        assert.ok(!message.includes("\n"))
        assert.ok(!/\b(record|recovery state|configured capacity|request was rejected|backend|payload)\b/i.test(message), message)
    }
})
