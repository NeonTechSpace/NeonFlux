import { wakeGreetings } from "./greetingLifecycle.ts"
import { v } from "convex/values"
import type { RolesDispatchResult, RolesOutcomeResult, RolesReconcileResult, RolesObserveResult } from "../contracts.js"
import { internalMutation } from "./_generated/server.js"
import { serviceMutation } from "./installations.ts"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { internal } from "./_generated/api.js"
import { shape } from "./publishingDomain.ts"
import { claimToken, defaultRolesSettings, epoch, memberContext, ROLES_BATCH, ROLES_DAY, ROLES_MARGIN, ROLES_RETENTION, safeRole } from "./rolesDomain.ts"
import { dropUndesiredReferences, grantEligibility, participationAvailability, rolePolicy } from "./roleClaims.ts"
import { ownerReferences, publicRoleClaim, readRolesSettings, roleAttempt, rolesAcknowledgment, rolesAdmin, rolesReceipt } from "./rolesStore.ts"
import { fail, requireId, requireServer, integer, source } from "./validation.ts"
import { reactionFence } from "./roleReactions.ts"
import { levelAttemptFence, levelRemovalEligibility } from "./levelingRoles.ts"

async function boundAttempt(ctx: MutationCtx, input: Record<string, unknown>) {
    const serverId = requireId(input.serverId); requireServer(serverId)
    const attempt = await roleAttempt(ctx, serverId, input.attemptId), owner = await ctx.db.get(attempt.ownershipId)
    if (input.ownershipId !== attempt.ownershipId || input.generation !== attempt.generation || input.sourceId !== attempt.sourceId || !owner || owner.generation !== attempt.generation || owner.attemptId !== attempt._id) fail(409, "Role attempt binding changed")
    return { serverId, attempt, owner }
}
export const dispatch = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<RolesDispatchResult> => {
    const input = shape(request, ["serverId", "attemptId", "ownershipId", "generation", "sourceId", "claimToken", "context", "actor"], ["serverId", "attemptId", "ownershipId", "generation", "sourceId", "claimToken", "context"])
    const { serverId, attempt, owner } = await boundAttempt(ctx, input), member = memberContext(input.context), capability = claimToken(input.claimToken), now = Date.now()
    const denied: RolesDispatchResult = { claimed: false, dispatchExpiresAt: attempt.dispatchExpiresAt, nativeDeadlineMs: 5000 }
    if (attempt.outcome !== "pending" || attempt.dispatchedAt !== undefined || now >= attempt.dispatchExpiresAt) return denied
    if (owner.intentSourceId !== attempt.sourceId) return denied
    if (attempt.reactionJob) await reactionFence(ctx, serverId, attempt.reactionJob)
    if (attempt.consumerKey === "level") await levelAttemptFence(ctx, serverId, attempt)
    if (member.userId !== attempt.userId || member.joinedAt !== attempt.joinedAt || member.botId !== attempt.botId || !member.botAuthorized || member.roleIds.includes(attempt.roleId) !== attempt.expectedPresent) fail(409, "Role provider snapshot changed")
    const refs = await ownerReferences(ctx, owner._id)
    if (attempt.action === "add") {
        const panelName = attempt.consumerKey.startsWith("panel:") ? attempt.consumerKey.split(":")[1] : undefined
        const panel = panelName ? await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", serverId).eq("name", panelName)).unique() : null
        const currentPolicy = await grantEligibility(ctx, serverId, member, attempt.consumerKey, attempt.roleId, panel?.kind === "verification")
        if (panel?.kind === "verification" && currentPolicy.settings.advancedVerificationEnabled
            && !(await rolesAcknowledgment(ctx, serverId, member.userId, member.joinedAt, member.roleIds)).acknowledged) fail(403, "Advanced verification proof required before role dispatch")
        if (!refs.some(x => x.desired && x.consumerKey === attempt.consumerKey)) fail(409, "Role reference withdrawn")
    } else {
        const policy = await rolePolicy(ctx, serverId)
        const operation = JSON.parse(attempt.operationKey) as { type: string, name?: string, revision?: number }
        if (attempt.consumerKey === "level") await levelRemovalEligibility(ctx, serverId, member, attempt.roleId)
        else if (operation.type === "withdraw" || operation.type === "withdraw-member") await rolesAdmin(ctx, serverId, input.actor, true)
        else {
            await participationAvailability(ctx, serverId, member)
            if (policy.defcon !== 3) fail(403, "DEFCON restriction")
            const panel = await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", serverId).eq("name", operation.name!)).unique()
            if (!panel?.enabled || panel.withdrawing || !policy.settings.panelsEnabled || panel.published?.revision !== operation.revision || panel.revision !== operation.revision) fail(403, "Role panel unavailable")
        }
        safeRole(serverId, attempt.roleId, member.roles, policy.staffRoleIds, false)
        if (!owner.owned || refs.some(x => x.desired)) fail(409, "Role removal ownership changed")
    }
    await ctx.db.patch(attempt._id, { dispatchedAt: now, claimToken: capability })
    return { claimed: true, dispatchExpiresAt: attempt.dispatchExpiresAt, nativeDeadlineMs: 5000 }
} })
export const outcome = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<RolesOutcomeResult> => {
    const input = shape(request, ["serverId", "attemptId", "ownershipId", "generation", "sourceId", "claimToken", "outcome"], ["serverId", "attemptId", "ownershipId", "generation", "sourceId", "outcome"])
    const { serverId, attempt, owner } = await boundAttempt(ctx, input), now = Date.now()
    if (input.outcome !== "succeeded" && input.outcome !== "failed" && input.outcome !== "uncertain") fail(400, "Invalid role outcome")
    const capability = input.claimToken === undefined ? undefined : claimToken(input.claimToken)
    if (attempt.dispatchedAt === undefined) {
        if (capability !== undefined || input.outcome !== "failed") fail(409, "Role action was not claimed")
    } else if (attempt.claimToken !== capability) fail(409, "Role claim capability mismatch")
    if (attempt.outcome !== "pending") {
        if (attempt.outcome !== input.outcome) fail(409, "Role outcome is immutable")
        return { recorded: false }
    }
    const noDispatch = attempt.dispatchedAt === undefined
    await ctx.db.patch(attempt._id, { outcome: input.outcome, finishedAt: now, ...(noDispatch ? { noDispatch: true } : {}), ...(input.outcome !== "uncertain" ? { expiresAt: now + ROLES_RETENTION } : {}) })
    const owned = input.outcome === "succeeded" ? attempt.action === "add" : owner.owned
    await ctx.db.patch(owner._id, { status: input.outcome === "uncertain" ? "uncertain" : "idle", owned, protected: input.outcome === "uncertain" || owned, updatedAt: now })
    if (input.outcome === "succeeded" && attempt.action === "remove") await dropUndesiredReferences(ctx, owner._id)
    await wakeGreetings(ctx, serverId, owner.userId, owner.joinedAt)
    return { recorded: true }
} })

export const reconcile = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<RolesReconcileResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "actor", "attemptId", "generation", "observation"], ["serverId", "messageId", "createdAt", "actor", "attemptId", "generation", "observation"])
    const now = Date.now(), identity = source(input, now)
    await rolesAdmin(ctx, identity.serverId, input.actor, true)
    const attempt = await roleAttempt(ctx, identity.serverId, input.attemptId), owner = await ctx.db.get(attempt.ownershipId)
    if (!owner || input.generation !== attempt.generation || owner.generation !== attempt.generation || owner.attemptId !== attempt._id) fail(409, "Role recovery binding changed")
    const observation = shape(input.observation, ["observedAt", "userId", "joinedAt", "roleId", "present"], ["observedAt", "userId", "joinedAt", "roleId", "present"])
    const observedAt = integer(observation.observedAt, now - 60000, now + 1000), observedEpoch = epoch(observation.joinedAt)
    if (requireId(observation.userId) !== owner.userId || requireId(observation.roleId) !== owner.roleId || typeof observation.present !== "boolean") fail(409, "Role recovery subject mismatch")
    if (!await rolesReceipt(ctx, identity.serverId, identity.messageId, now)) return { recorded: false, claim: await publicRoleClaim(ctx, owner) }
    const closedAt = attempt.dispatchExpiresAt + (attempt.dispatchedAt === undefined ? 0 : attempt.nativeDeadlineMs + ROLES_MARGIN)
    if (attempt.outcome === "pending" || observedAt < closedAt || now < closedAt) fail(409, "Role dispatch window remains open")
    const sameEpoch = observedEpoch === owner.joinedAt
    if (attempt.outcome !== "uncertain" && sameEpoch && observation.present) return { recorded: false, claim: await publicRoleClaim(ctx, owner) }
    // An uncertain addition never establishes ownership, so a present role is unlocked but left unmanaged
    const owned = sameEpoch && observation.present && owner.owned
    await ctx.db.patch(owner._id, { owned, protected: owned, status: "idle", updatedAt: now })
    if (!sameEpoch) {
        for (const ref of await ownerReferences(ctx, owner._id)) { await ctx.db.delete(ref._id) }
    } else if (!owned) await dropUndesiredReferences(ctx, owner._id)
    await ctx.db.patch(attempt._id, { observationAt: observedAt, expiresAt: now + ROLES_RETENTION })
    await wakeGreetings(ctx, identity.serverId, owner.userId, owner.joinedAt)
    return { recorded: true, claim: await publicRoleClaim(ctx, (await ctx.db.get(owner._id))!) }
} })

async function age(ctx: MutationCtx, now: number, serverId?: string) {
    const rows = await (serverId === undefined ? ctx.db.query("roleAttempts").withIndex("by_pending", q => q.eq("outcome", "pending").lte("dispatchExpiresAt", now - 10000)) : ctx.db.query("roleAttempts").withIndex("by_server_pending", q => q.eq("serverId", serverId).eq("outcome", "pending").lte("dispatchExpiresAt", now - 10000))).take(ROLES_BATCH)
    let uncertain = 0
    for (const attempt of rows) if (!await expire(ctx, attempt, now)) uncertain++
    return { processed: rows.length, uncertain }
}
async function expire(ctx: MutationCtx, attempt: Doc<"roleAttempts">, now: number) {
    const owner = await ctx.db.get(attempt.ownershipId)
    const noDispatch = attempt.dispatchedAt === undefined
    await ctx.db.patch(attempt._id, { outcome: noDispatch ? "failed" : "uncertain", finishedAt: now, ...(noDispatch ? { noDispatch: true, expiresAt: now + ROLES_RETENTION } : {}) })
    if (owner?.attemptId === attempt._id && owner.generation === attempt.generation) {
        await ctx.db.patch(owner._id, { status: noDispatch ? "idle" : "uncertain", protected: !noDispatch || owner.owned, updatedAt: now })
    }
    return noDispatch
}
export const observe = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<RolesObserveResult> => {
    const input = shape(request, ["serverId", "mode"], ["serverId", "mode"]), serverId = requireId(input.serverId); requireServer(serverId)
    if (input.mode !== "restart" && input.mode !== "aged") fail(400, "Invalid role observation")
    // A restarted bot holds no unclaimed verification grant, so the proof can reserve it again within its own window
    if (input.mode === "restart") for (const attempt of await ctx.db.query("roleAttempts").withIndex("by_server_pending", q => q.eq("serverId", serverId).eq("outcome", "pending")).take(ROLES_BATCH))
        if (attempt.dispatchedAt === undefined && attempt.sourceId.startsWith("verify_")) await expire(ctx, attempt, Date.now())
    const aged = await age(ctx, Date.now(), serverId)
    if (aged.processed === ROLES_BATCH) await ctx.scheduler.runAfter(0, internal.roleLifecycle.observe, { request: input })
    return { uncertainAttempts: aged.uncertain }
} })
export const cleanup = internalMutation({ args: {}, handler: async ctx => {
    const now = Date.now(), aged = await age(ctx, now)
    const attempts = await ctx.db.query("roleAttempts").withIndex("by_expiry", q => q.gt("expiresAt", 0).lte("expiresAt", now)).take(ROLES_BATCH)
    for (const attempt of attempts) {
        const owner = await ctx.db.get(attempt.ownershipId)
        if (owner?.attemptId === attempt._id && owner.status !== "idle") continue
        if (owner?.attemptId === attempt._id) {
            if (!owner.owned && !(await ownerReferences(ctx, owner._id)).length) { await ctx.db.delete(owner._id) }
            else await ctx.db.patch(owner._id, { attemptId: undefined })
        }
        await ctx.db.delete(attempt._id)
    }
    const receipts = await ctx.db.query("roleReceipts").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(ROLES_BATCH)
    for (const row of receipts) { await ctx.db.delete(row._id) }
    const participation = await ctx.db.query("roleParticipationReceipts").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(ROLES_BATCH)
    for (const row of participation) { await ctx.db.delete(row._id) }
    const jobs = await ctx.db.query("roleWithdrawals").withIndex("by_expiry", q => q.gt("expiresAt", 0).lte("expiresAt", now)).take(ROLES_BATCH)
    for (const job of jobs) await ctx.db.delete(job._id)
    const reactions = await ctx.db.query("roleReactionJobs").withIndex("by_expiry", q => q.gt("expiresAt", 0).lte("expiresAt", now)).take(ROLES_BATCH)
    for (const job of reactions) if (!job.active) await ctx.db.delete(job._id)
    if ([aged.processed, attempts.length, receipts.length, participation.length, jobs.length, reactions.length].some(x => x === ROLES_BATCH)) await ctx.scheduler.runAfter(0, internal.roleLifecycle.cleanup, {})
} })
