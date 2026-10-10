import type { ModerationActionContext, ModerationActionGrant, ModerationActionInput, ModerationActor, ModerationCase, ModerationSettings } from "../contracts.js"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { LOCK_PERMISSIONS, lockMask, overwrite, ownedPostingBits, permissionBits, RETENTION, SEND_MESSAGES, timeout } from "./moderationDomain.ts"
import { publicCase, state } from "./moderationStore.ts"
import { fail, object, requireId, bool, integer, text, token } from "./validation.ts"

export function actionContext(value: unknown): ModerationActionContext {
    const input = object(value)
    return { botActionAuthorized: bool(input.botActionAuthorized), actorCanManageTarget: bool(input.actorCanManageTarget),
        botCanManageTarget: bool(input.botCanManageTarget), targetProtected: bool(input.targetProtected), botId: requireId(input.botId),
        ...(Object.hasOwn(input, "currentTimeoutUntil") ? { currentTimeoutUntil: timeout(input.currentTimeoutUntil) } : {}),
        ...(Object.hasOwn(input, "currentOverwrite") ? { currentOverwrite: overwrite(input.currentOverwrite) } : {}),
        ...(Object.hasOwn(input, "currentSlowmodeSeconds") ? { currentSlowmodeSeconds: integer(input.currentSlowmodeSeconds, 0, 21600) } : {}),
        ...(Object.hasOwn(input, "recoveryGeneration") ? { recoveryGeneration: integer(input.recoveryGeneration, 1, Number.MAX_SAFE_INTEGER) } : {}),
        ...(Object.hasOwn(input, "botAuthorizedActions") ? { botAuthorizedActions: authorizedActions(input.botAuthorizedActions) } : {}),
        ...(Object.hasOwn(input, "botPostingPermissions") ? { botPostingPermissions: permissionBits(input.botPostingPermissions) } : {}) }
}
function authorizedActions(value: unknown) {
    if (!Array.isArray(value) || value.length > 15) fail(400, "Invalid action permissions")
    return value.map(v => actionInput({ type: v, reason: "Permission context" }).type)
}
export function actionInput(value: unknown): ModerationActionInput {
    const input = object(value)
    if (!["log", "warn", "kick", "ban", "unban", "timeout", "untimeout", "delete", "purge", "slowmode", "lock", "unlock", "quarantine", "release"].includes(String(input.type))) fail(400, "Invalid action")
    return { type: input.type as ModerationActionInput["type"], reason: text(input.reason),
        ...(input.targetId !== undefined ? { targetId: requireId(input.targetId) } : {}),
        ...(input.channelId !== undefined ? { channelId: requireId(input.channelId) } : {}),
        ...(input.messageIds !== undefined ? { messageIds: messageIds(input.messageIds) } : {}),
        ...(input.durationSeconds !== undefined ? { durationSeconds: integer(input.durationSeconds, input.type === "ban" ? 60 : 1, input.type === "ban" ? 63072000 : 31536000) } : {}),
        ...(input.slowmodeSeconds !== undefined ? { slowmodeSeconds: integer(input.slowmodeSeconds, 0, 21600) } : {}),
        ...(input.linkedCaseNo !== undefined ? { linkedCaseNo: integer(input.linkedCaseNo, 1, Number.MAX_SAFE_INTEGER) } : {}),
        ...(input.recoveryId !== undefined ? { recoveryId: token(input.recoveryId) } : {}) }
}
function messageIds(value: unknown) { if (!Array.isArray(value) || !value.length || value.length > 100) fail(400, "Invalid request"); return [...new Set(value.map(requireId))] }
export function ownedOverwriteEqual(a: { exists: boolean, allow: string, deny: string }, b: { exists: boolean, allow: string, deny: string }, mask = SEND_MESSAGES) {
    return a.exists === b.exists && (BigInt(a.allow) & mask) === (BigInt(b.allow) & mask) && (BigInt(a.deny) & mask) === (BigInt(b.deny) & mask)
}
export async function reserveAction(ctx: MutationCtx, options: {
    serverId: string, sourceId: string, settings: ModerationSettings, actor?: ModerationActor, input: ModerationActionInput,
    context: ModerationActionContext, origin: ModerationCase["origin"], incident?: ModerationCase["incident"], ruleName?: string, blocked?: boolean, now: number
}) {
    const { serverId, settings, input, context, origin, now } = options
    let recovery: Doc<"securityRecoveries"> | null = null
    let writeOverwrite; let expectedOverwrite; let expectedTimeoutUntil: string | null | undefined; let lockBits: bigint | undefined
    const userAction = ["warn", "kick", "ban", "unban", "timeout", "untimeout", "quarantine", "release"].includes(input.type)
    const channelAction = ["delete", "purge", "slowmode", "lock", "unlock"].includes(input.type)
    if (userAction && !input.targetId || channelAction && !input.channelId) fail(400, "Invalid action target")
    if (input.type !== "log") {
        if (!context.botActionAuthorized) fail(403, "Bot permission required")
        if (context.botAuthorizedActions && !context.botAuthorizedActions.includes(input.type)) fail(403, "Bot permission required")
        if (userAction && (context.targetProtected || !context.botCanManageTarget || !context.actorCanManageTarget
            || input.targetId === context.botId || input.targetId === options.actor?.userId)) fail(403, "Protected target")
        if (options.actor && !options.actor.nativePermissionAuthorized) fail(403, "Native permission required")
    }
    if (["delete", "purge"].includes(input.type) && (!input.messageIds?.length || input.type === "delete" && input.messageIds.length !== 1)) fail(400, "Invalid message selection")
    if (["timeout", "quarantine"].includes(input.type) && (!input.durationSeconds || context.currentTimeoutUntil === undefined)) fail(400, "Timeout snapshot required")
    if (input.type === "quarantine" && context.currentTimeoutUntil && Date.parse(context.currentTimeoutUntil) >= now + input.durationSeconds! * 1000) fail(409, "Stronger timeout preserved")
    if (input.type === "untimeout" && context.currentTimeoutUntil === undefined) fail(400, "Timeout snapshot required")
    if (input.type === "slowmode" && (input.slowmodeSeconds === undefined || context.currentSlowmodeSeconds === undefined)) fail(400, "Slowmode snapshot required")
    if (["release", "unlock"].includes(input.type)) {
        if (!input.recoveryId || context.recoveryGeneration === undefined) fail(400, "Recovery snapshot required")
        const id = ctx.db.normalizeId("securityRecoveries", input.recoveryId); recovery = id ? await ctx.db.get(id) : null
        if (!recovery || recovery.serverId !== serverId || recovery.status === "pending" || recovery.generation !== context.recoveryGeneration) fail(409, "Recovery changed")
        if (input.type === "release") {
            if (recovery.type !== "timeout" || recovery.targetId !== input.targetId || context.currentTimeoutUntil === undefined
                || !Object.hasOwn(recovery, "expectedTimeoutUntil") || context.currentTimeoutUntil !== recovery.expectedTimeoutUntil) fail(409, "Timeout changed")
            expectedTimeoutUntil = context.currentTimeoutUntil
            if (recovery.previousTimeoutUntil && Date.parse(recovery.previousTimeoutUntil) > now) fail(409, "Prior timeout still active")
            const newer = await ctx.db.query("securityRecoveries").withIndex("by_server_target", q => q.eq("serverId", serverId).eq("targetId", input.targetId!)).take(1001)
            if (newer.some(r => r.type === "timeout" && r.generation > recovery!.generation)) fail(409, "Recovery superseded")
        } else {
            // Unlock restores exactly the bits its lock owned, so a lock recorded before thread support restores SendMessages only
            lockBits = lockMask(recovery)
            if (recovery.type !== "lock" || recovery.channelId !== input.channelId || !context.currentOverwrite || !recovery.expectedOverwrite
                || !ownedOverwriteEqual(context.currentOverwrite, recovery.expectedOverwrite, lockBits)) fail(409, "Channel lock changed")
            expectedOverwrite = context.currentOverwrite
            const previous = recovery.previousOverwrite!
            const allow = (BigInt(context.currentOverwrite.allow) & ~lockBits) | (BigInt(previous.allow) & lockBits)
            const deny = (BigInt(context.currentOverwrite.deny) & ~lockBits) | (BigInt(previous.deny) & lockBits)
            writeOverwrite = { exists: previous.exists || allow !== 0n || deny !== 0n, allow: String(allow), deny: String(deny) }
        }
    }
    if (input.type === "lock") {
        if (!context.currentOverwrite) fail(400, "Channel snapshot required")
        const existing = await ctx.db.query("securityRecoveries").withIndex("by_server_channel", q => q.eq("serverId", serverId).eq("channelId", input.channelId!)).take(1001)
        if (existing.some(r => r.type === "lock")) fail(409, "Channel recovery already active")
        expectedOverwrite = context.currentOverwrite
        lockBits = ownedPostingBits(LOCK_PERMISSIONS, context.botPostingPermissions)
        writeOverwrite = { exists: true, allow: String(BigInt(expectedOverwrite.allow) & ~lockBits), deny: String(BigInt(expectedOverwrite.deny) | lockBits) }
    }
    if (["timeout", "quarantine", "untimeout"].includes(input.type)) expectedTimeoutUntil = context.currentTimeoutUntil
    if (recovery) {
        if (input.linkedCaseNo !== undefined && input.linkedCaseNo !== recovery.caseNo) fail(409, "Recovery case mismatch")
        input.linkedCaseNo = recovery.caseNo
    }
    const current = await state(ctx, serverId); const caseNo = current.nextCaseNo
    await ctx.db.patch(current._id, { nextCaseNo: caseNo + 1 })
    const fields = { ...(input.targetId ? { targetId: input.targetId } : {}), ...(input.channelId ? { channelId: input.channelId } : {}) }
    const id = await ctx.db.insert("moderationCases", { serverId, caseNo, sourceId: options.sourceId,
        action: input.type, origin, ...(options.incident ? { incident: options.incident } : {}), ...fields,
        ...(options.actor ? { actorId: options.actor.userId } : {}), reason: input.reason,
        ...(options.ruleName ? { ruleName: options.ruleName } : {}), ...(input.linkedCaseNo ? { linkedCaseNo: input.linkedCaseNo } : {}),
        createdAt: now, expiresAt: now + RETENTION, outcome: "pending", logOutcome: "none", notificationOutcome: "none",
        erased: false, voided: false, blocksPublic: options.blocked ?? false,
        correctionCount: 0, ...(settings.logChannelId ? { logChannelId: settings.logChannelId } : {}) })
    if (["lock", "timeout", "quarantine", "ban"].includes(input.type)) {
        const type = input.type === "lock" ? "lock" : input.type === "ban" ? "ban" : "timeout"
        const recoveryId = await ctx.db.insert("securityRecoveries", { serverId, generation: caseNo, type,
            ...fields, caseNo, status: "pending", createdAt: now,
            ...(context.currentTimeoutUntil !== undefined ? { previousTimeoutUntil: context.currentTimeoutUntil } : {}),
            ...(input.type === "lock" && expectedOverwrite && writeOverwrite ? { previousOverwrite: expectedOverwrite, expectedOverwrite: writeOverwrite, ownedPermissions: String(lockBits) } : {}) })
        recovery = (await ctx.db.get(recoveryId))!
    }
    if (recovery) {
        const reversal = ["release", "unlock"].includes(input.type)
            ? { reversalState: { generation: recovery.generation, status: recovery.status as "active" | "uncertain" } } : {}
        await ctx.db.patch(recovery._id, { caseNo, generation: caseNo, status: "pending", ...reversal })
        await ctx.db.patch(id, { recoveryId: recovery._id })
    }
    const grant: ModerationActionGrant = { actionId: id, caseNo, sourceId: options.sourceId, action: input.type, ...fields, reason: input.reason,
        ...(input.messageIds ? { messageIds: input.messageIds } : {}), ...(input.durationSeconds ? { durationSeconds: input.durationSeconds } : {}),
        ...(input.slowmodeSeconds !== undefined ? { slowmodeSeconds: input.slowmodeSeconds, expectedSlowmodeSeconds: context.currentSlowmodeSeconds! } : {}),
        ...(expectedTimeoutUntil !== undefined ? { expectedTimeoutUntil } : {}), ...(writeOverwrite ? { overwrite: writeOverwrite } : {}),
        ...(input.type === "release" && recovery ? { restoreTimeoutUntil: recovery.previousTimeoutUntil ?? null } : {}),
        ...(expectedOverwrite ? { expectedOverwrite } : {}), ...(lockBits !== undefined ? { ownedPermissions: String(lockBits) } : {}), ...(recovery ? { recoveryId: recovery._id } : {}) }
    await ctx.db.patch(id, { grant })
    return { case: await publicCase(ctx, (await ctx.db.get(id))!), grant }
}
