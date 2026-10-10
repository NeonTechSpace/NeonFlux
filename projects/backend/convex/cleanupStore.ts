import type { CleanupContext, CleanupPage, CleanupPolicy, CleanupSettings, CleanupSkipReason, CleanupSweep, CleanupSweepBinding, CleanupTarget, CleanupTargetBinding, CleanupMessage, CleanupTargetState, CleanupObservation } from "../contracts.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { administrator } from "./moderationDomain.ts"
import { memberRecoveries } from "./moderationStore.ts"
import { publishingProtectsMessage } from "./publishing.ts"
import { panelProtectsMessage, readRolesSettings, rolesAcknowledgment } from "./rolesStore.ts"
import { advanceCleanup, cleanupEligibility, CLEANUP_DAY, CLEANUP_RETENTION, CLEANUP_SETTLE_MS } from "./cleanupDomain.ts"
import { fail, integer } from "./validation.ts"

export type CleanupRead = MutationCtx | QueryCtx
export const cleanupSettings = (ctx: CleanupRead, serverId: string) => ctx.db.query("cleanupSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
export async function cleanupState(ctx: MutationCtx, serverId: string) {
    const old = await cleanupSettings(ctx, serverId)
    if (old) return old
    const id = await ctx.db.insert("cleanupSettings", { serverId, enabled: false, revision: 1, policies: 0, retainedTargets: 0, retainedSweeps: 0, receipts: 0, nextSweepNo: 1, nextTargetNo: 1 })
    return (await ctx.db.get(id))!
}
export function publicCleanupSettings(row: Doc<"cleanupSettings"> | null): CleanupSettings {
    return { enabled: row?.enabled ?? false, revision: row?.revision ?? 1, policies: row?.policies ?? 0, retainedTargets: row?.retainedTargets ?? 0, retainedSweeps: row?.retainedSweeps ?? 0, receipts: row?.receipts ?? 0, targetCapacity: 10000, quotaPaused: false }
}
export async function cleanupCount(ctx: MutationCtx, serverId: string, key: "policies" | "retainedTargets" | "retainedSweeps" | "receipts", delta: number) {
    const state = await cleanupState(ctx, serverId), cap = { policies: 50, retainedTargets: Infinity, retainedSweeps: Infinity, receipts: 1000 }[key]
    if (state[key] + delta > cap) fail(429, "Cleanup capacity reached")
    // Retention counts are informational. Drift never blocks cleanup or its retention cron
    await ctx.db.patch(state._id, { [key]: Math.max(0, state[key] + delta) })
}
export const readCleanupPolicy = (ctx: CleanupRead, serverId: string, channelId: string) => ctx.db.query("cleanupPolicies").withIndex("by_channel", q => q.eq("serverId", serverId).eq("channelId", channelId)).unique()
export async function cleanupPolicy(ctx: CleanupRead, serverId: string, channelId: string, revision?: unknown) {
    const row = await readCleanupPolicy(ctx, serverId, channelId)
    if (!row) fail(404, "Cleanup policy not found")
    if (revision !== undefined && row.revision !== integer(revision, 1, Number.MAX_SAFE_INTEGER)) fail(409, "Cleanup policy revision changed")
    return row
}
export function publicCleanupPolicy(row: Doc<"cleanupPolicies">): CleanupPolicy {
    const { serverId, _id, _creationTime, acceptedCreatedAt, acceptedMessageId, ...value } = row
    return value
}
export function publicCleanupSweep(row: Doc<"cleanupSweeps">): CleanupSweep {
    const { serverId, _id, _creationTime, expiresAt, ...value } = row
    return value
}
export function publicCleanupPage(row: Doc<"cleanupPages">): CleanupPage {
    const { serverId, _id, _creationTime, ...value } = row
    return value
}
export function publicCleanupTarget(row: Doc<"cleanupTargets">): CleanupTarget {
    const { serverId, _id, _creationTime, active, replayBlocked, claimToken, absenceObservedAt, ...value } = row
    return value
}
export const sweepBinding = (r: CleanupSweepBinding): CleanupSweepBinding => ({ channelId: r.channelId, policyRevision: r.policyRevision, moduleRevision: r.moduleRevision, sweepNo: r.sweepNo })
export const targetBinding = (r: CleanupTargetBinding): CleanupTargetBinding => ({ ...sweepBinding(r), pageNo: r.pageNo, targetNo: r.targetNo, messageId: r.messageId })
export const readCleanupSweep = (ctx: CleanupRead, serverId: string, sweepNo: number) => ctx.db.query("cleanupSweeps").withIndex("by_number", q => q.eq("serverId", serverId).eq("sweepNo", sweepNo)).unique()
export async function cleanupSweep(ctx: CleanupRead, serverId: string, binding: CleanupSweepBinding) {
    const row = await readCleanupSweep(ctx, serverId, binding.sweepNo)
    if (!row || row.channelId !== binding.channelId || row.policyRevision !== binding.policyRevision || row.moduleRevision !== binding.moduleRevision) fail(409, "Cleanup sweep changed")
    return row
}
export const readCleanupPage = (ctx: CleanupRead, serverId: string, sweepNo: number) => ctx.db.query("cleanupPages").withIndex("by_sweep", q => q.eq("serverId", serverId).eq("sweepNo", sweepNo)).unique()
export const readCleanupPageTargets = (ctx: CleanupRead, serverId: string, sweepNo: number, pageNo: number) => ctx.db.query("cleanupTargets").withIndex("by_page", q => q.eq("serverId", serverId).eq("sweepNo", sweepNo).eq("pageNo", pageNo)).take(50)
export async function cleanupTarget(ctx: CleanupRead, serverId: string, binding: CleanupTargetBinding) {
    const row = await ctx.db.query("cleanupTargets").withIndex("by_number", q => q.eq("serverId", serverId).eq("targetNo", binding.targetNo)).unique()
    if (!row || JSON.stringify(targetBinding(row)) !== JSON.stringify(binding)) fail(409, "Cleanup target changed")
    return row
}
export async function cleanupGate(ctx: CleanupRead, serverId: string) {
    const moderation = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (moderation?.config.defcon === 1) fail(403, "DEFCON restriction")
}
async function cleanupParticipant(ctx: CleanupRead, serverId: string, member: CleanupContext["member"], verification: boolean) {
    if (member.timeoutUntil !== null && Date.parse(member.timeoutUntil) > Date.now()) fail(403, "Cleanup participant timed out")
    const recoveries = await memberRecoveries(ctx, serverId, member.userId)
    if (recoveries.count > 10) fail(403, "Cleanup protection unavailable")
    if (recoveries.cases.some(action => !action || action.action === "quarantine")) fail(403, "Quarantine blocks cleanup")
    if (!verification) return
    const panel = await ctx.db.query("rolePanels").withIndex("by_server_kind", q => q.eq("serverId", serverId).eq("kind", "verification")).unique()
    if (panel && (panel.published || panel.mappings.length)) {
        const settings = await readRolesSettings(ctx, serverId), ack = await rolesAcknowledgment(ctx, serverId, member.userId, member.joinedAt, member.roleIds)
        if (!settings?.config.verificationEnabled || !panel.enabled || panel.withdrawing || !panel.published || panel.published.revision !== panel.revision || !ack.accessConfirmed || !ack.accessRolePresent) fail(403, "Verified cleanup owner required")
    }
}
export async function cleanupAdmin(ctx: CleanupRead, serverId: string, context: CleanupContext, critical = false) {
    if (!administrator(context.actor) || !context.actor.nativePermissionAuthorized || context.actorKind !== "human" || context.member.isBot || context.actor.userId === context.botId) fail(403, "Current human Owner or Administrator required")
    if (!critical) await cleanupGate(ctx, serverId)
}
export async function cleanupAuthority(ctx: CleanupRead, serverId: string, context: CleanupContext, channelId: string, ownerId?: string) {
    await cleanupAdmin(ctx, serverId, context)
    if (context.channelId !== channelId || ownerId !== undefined && context.actor.userId !== ownerId || !context.actorAuthorized || !context.botAuthorized || context.botKind !== "bot" || !context.botMember.isBot || !context.member.canView || !context.member.canReadHistory || !context.botMember.canView || !context.botMember.canReadHistory) fail(403, "Current cleanup channel authority required")
    await cleanupParticipant(ctx, serverId, context.member, true)
    await cleanupParticipant(ctx, serverId, context.botMember, false)
}
/** Automatic work runs under the server policy: bot permissions, the module switch and DEFCON */
export async function cleanupAutomation(ctx: CleanupRead, serverId: string, context: CleanupContext, channelId: string) {
    await cleanupGate(ctx, serverId)
    if (context.channelId !== channelId || !context.botAuthorized || context.botKind !== "bot" || !context.botMember.isBot
        || !context.botMember.canView || !context.botMember.canReadHistory) fail(403, "Current cleanup bot authority required")
    await cleanupParticipant(ctx, serverId, context.botMember, false)
}
export async function cleanupIntent(ctx: CleanupRead, serverId: string, binding: CleanupSweepBinding, context: CleanupContext) {
    const state = await cleanupSettings(ctx, serverId), policy = await cleanupPolicy(ctx, serverId, binding.channelId)
    if (!state?.enabled || !policy.enabled || state.revision !== binding.moduleRevision || policy.revision !== binding.policyRevision || policy.sweepNo !== binding.sweepNo) fail(409, "Cleanup intent changed")
    const sweep = await cleanupSweep(ctx, serverId, binding)
    if (sweep.state !== "active" || sweep.ownerId !== policy.ownerId) fail(409, "Cleanup sweep inactive")
    await cleanupAutomation(ctx, serverId, context, policy.channelId)
    return { state, policy, sweep }
}
export async function cleanupProtection(ctx: CleanupRead, serverId: string, channelId: string, messageId: string) {
    return await publishingProtectsMessage(ctx, serverId, channelId, messageId) || await panelProtectsMessage(ctx, serverId, channelId, messageId)
}
export async function cleanupDisposition(ctx: CleanupRead, serverId: string, message: CleanupMessage, policy: CleanupPolicy, cutoffAt: number, allowActive = false): Promise<CleanupSkipReason | null> {
    const reason = cleanupEligibility(message, policy, cutoffAt)
    if (reason) return reason
    if (await cleanupProtection(ctx, serverId, message.channelId, message.messageId)) return "protected"
    if (!allowActive && await ctx.db.query("cleanupTargets").withIndex("by_message_active", q => q.eq("serverId", serverId).eq("channelId", policy.channelId).eq("messageId", message.messageId).eq("active", true)).first()
        || await ctx.db.query("cleanupTargets").withIndex("by_message_replay", q => q.eq("serverId", serverId).eq("channelId", policy.channelId).eq("messageId", message.messageId).eq("active", false).eq("replayBlocked", true)).first()) return "retained-attempt"
    return null
}
export async function finishCleanupTarget(ctx: MutationCtx, row: Doc<"cleanupTargets">, state: Exclude<CleanupTargetState, "queued" | "reserved">, noDispatch: boolean, reason?: string, callbackEvidence = true) {
    const now = Date.now(), unresolved = state === "uncertain" || state === "failed" && !noDispatch, replayBlocked = !noDispatch && row.claimedAt !== undefined
    await ctx.db.patch(row._id, { state, active: false, replayBlocked, updatedAt: now, finishedAt: now, ...(noDispatch ? { noDispatch: true as const } : {}), ...(reason ? { reason } : {}), ...(unresolved ? { expiresAt: undefined } : { expiresAt: now + CLEANUP_RETENTION }) })
    const sweep = await readCleanupSweep(ctx, row.serverId, row.sweepNo)
    if (sweep) {
        const counts = { ...sweep.counts }
        if (state === "deleted") counts.acknowledged++
        if (state === "absent") counts.observedAbsent++
        if (state === "skipped") counts.skipped++
        if (state === "failed") counts.failed++
        if (state === "cancelled") counts.cancelled++
        if (unresolved) counts.unresolved++
        if (callbackEvidence && row.claimedAt !== undefined && !noDispatch) counts.submitted++
        await ctx.db.patch(sweep._id, { counts, updatedAt: now })
    }
    return (await ctx.db.get(row._id))!
}
export async function ageCleanupTarget(ctx: MutationCtx, row: Doc<"cleanupTargets">) {
    if (row.state !== "reserved" || Date.now() <= row.grant!.dispatchExpiresAt + CLEANUP_SETTLE_MS) return row
    return finishCleanupTarget(ctx, row, row.claimedAt === undefined ? "failed" : "uncertain", row.claimedAt === undefined, "operation-window-expired", false)
}
export async function cancelCleanupSweep(ctx: MutationCtx, sweep: Doc<"cleanupSweeps">) {
    if (sweep.state !== "active") return
    const targets = await readCleanupPageTargets(ctx, sweep.serverId, sweep.sweepNo, sweep.pageNo)
    for (const target of targets) if (target.state === "queued" || target.state === "reserved" && target.claimedAt === undefined) await finishCleanupTarget(ctx, target, "cancelled", true, "intent-changed")
    const page = await readCleanupPage(ctx, sweep.serverId, sweep.sweepNo)
    if (page) await ctx.db.delete(page._id)
    await ctx.db.patch(sweep._id, { state: "cancelled", updatedAt: Date.now(), expiresAt: Date.now() + CLEANUP_RETENTION })
    if (!await ctx.db.query("cleanupTargets").withIndex("by_page", q => q.eq("serverId", sweep.serverId).eq("sweepNo", sweep.sweepNo)).first()) {
        await ctx.db.delete(sweep._id)
        await cleanupCount(ctx, sweep.serverId, "retainedSweeps", -1)
    }
}
export async function cleanupReceipt(ctx: MutationCtx, identity: { serverId: string, messageId: string, createdAt: number }, actorId: string, operation: unknown) {
    const operationKey = JSON.stringify({ createdAt: identity.createdAt, operation }), old = await ctx.db.query("cleanupReceipts").withIndex("by_source", q => q.eq("serverId", identity.serverId).eq("messageId", identity.messageId)).unique()
    if (old) { if (old.actorId !== actorId || old.operationKey !== operationKey) fail(409, "Cleanup source binding changed"); return false }
    await cleanupCount(ctx, identity.serverId, "receipts", 1)
    await ctx.db.insert("cleanupReceipts", { serverId: identity.serverId, messageId: identity.messageId, actorId, operationKey, expiresAt: Date.now() + CLEANUP_DAY })
    return true
}
export function orderedCleanupSource(identity: { messageId: string, createdAt: number }, old: { acceptedCreatedAt?: number, acceptedMessageId?: string }) {
    if (old.acceptedCreatedAt !== undefined && (identity.createdAt < old.acceptedCreatedAt || BigInt(identity.messageId) <= BigInt(old.acceptedMessageId!))) fail(409, "Cleanup source order changed")
    return { acceptedCreatedAt: identity.createdAt, acceptedMessageId: identity.messageId }
}
export async function invalidateCleanupPolicy(ctx: MutationCtx, row: Doc<"cleanupPolicies">) {
    if (row.sweepNo !== undefined) { const sweep = await readCleanupSweep(ctx, row.serverId, row.sweepNo); if (sweep) await cancelCleanupSweep(ctx, sweep) }
    await ctx.db.patch(row._id, { revision: advanceCleanup(row.revision), sweepNo: undefined, nextCheckAt: Date.now(), blockedReason: undefined })
}
