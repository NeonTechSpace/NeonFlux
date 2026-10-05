import { wakeGreetings } from "./greetingLifecycle.ts"
import { v } from "convex/values"
import type { RolesEvaluateResult } from "../contracts.js"
import { internalMutation } from "./_generated/server.js"
import { shape } from "./publishingDomain.ts"
import { autoroleIds, consumerKey, eligible, emoji, evaluationKey, memberContext, participationOperation, ROLES_DAY, rolesSource } from "./rolesDomain.ts"
import { desiredReference, dropUndesiredReferences, ensureOwner, grantEligibility, participationAvailability, releaseEarlierEpochs, reserveRole, roleOwner, rolePolicy } from "./roleClaims.ts"
import { ownerReferences, roleAttempt, rolePanel, rolesAcknowledgment, rolesAdmin, roleWithdrawal } from "./rolesStore.ts"
import { fail, object, requireId, bool, integer, name, source, token } from "./validation.ts"
import { completeReactionTarget, reactionFence } from "./roleReactions.ts"
import { evaluateLevelRole } from "./levelingRoles.ts"

export const evaluate = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<RolesEvaluateResult> => {
    const input = shape(request, ["serverId", "sourceId", "createdAt", "context", "operation", "continuationAttemptId", "actor", "reactionJob"], ["serverId", "sourceId", "createdAt", "context", "operation"])
    const now = Date.now(), identity = rolesSource(input, now), member = memberContext(input.context), operation = participationOperation(input.operation), op = object(operation)
    if (operation.type === "level-sync") {
        if (["continuationAttemptId", "actor", "reactionJob"].some(key => input[key] !== undefined)) fail(400, "Invalid leveling role continuation")
        return evaluateLevelRole(ctx, identity, member, operation)
    }
    const job = input.reactionJob === undefined ? null : await reactionFence(ctx, identity.serverId, input.reactionJob)
    if (job) {
        const target = job.row.targets[job.index]!
        if (member.userId !== target.userId || member.joinedAt !== target.joinedAt || identity.sourceId !== `job_${job.row._id}_${job.row.generation}_${job.row.pageStep}_${job.index}` || op.name !== job.row.name || op.revision !== job.row.revision || op.messageId !== job.row.messageId || op.type !== "reaction" && op.type !== "verify") fail(409, "Reaction page target changed")
    }
    const ack = () => rolesAcknowledgment(ctx, identity.serverId, member.userId, member.joinedAt, member.roleIds)
    const result = async (status: RolesEvaluateResult["status"], duplicate = false): Promise<RolesEvaluateResult> => {
        if (job && duplicate) {
            const latest = await ctx.db.query("roleAttempts").withIndex("by_source", q => q.eq("serverId", identity.serverId).eq("sourceId", identity.sourceId)).order("desc").first()
            if (latest?.outcome === "pending" || latest?.outcome === "uncertain") status = "blocked"
        }
        if (job) await completeReactionTarget(ctx, job.row, job.index, status === "blocked")
        return { duplicate, status, acknowledgment: await ack() }
    }
    const recoveryActor = op.type === "withdraw" || op.type === "withdraw-member" ? await rolesAdmin(ctx, identity.serverId, input.actor, true) : null
    // A source is applied once, a replay reports the earlier result
    const receipt = await ctx.db.query("roleParticipationReceipts").withIndex("by_source", q => q.eq("serverId", identity.serverId).eq("sourceId", identity.sourceId)).unique()
    if (!receipt && input.continuationAttemptId !== undefined) fail(409, "Role source binding missing")
    // A source whose grant was never dispatched may be evaluated again, which lets a verification proof finish after a restart
    const sourceAttempt = await ctx.db.query("roleAttempts").withIndex("by_source", q => q.eq("serverId", identity.serverId).eq("sourceId", identity.sourceId)).order("desc").first()
    // Only the same membership epoch and operation may be evaluated again
    const reusable = sourceAttempt?.noDispatch === true && sourceAttempt.userId === member.userId && sourceAttempt.joinedAt === member.joinedAt && sourceAttempt.operationKey === evaluationKey(op)
    if (input.continuationAttemptId === undefined && receipt && !reusable) {
        return result(sourceAttempt?.outcome === "pending" || sourceAttempt?.outcome === "uncertain" ? "blocked" : "unchanged", true)
    }
    if (!receipt) await ctx.db.insert("roleParticipationReceipts", { serverId: identity.serverId, sourceId: identity.sourceId, expiresAt: now + ROLES_DAY })
    if (input.continuationAttemptId !== undefined) {
        const previous = await roleAttempt(ctx, identity.serverId, input.continuationAttemptId)
        if (previous.sourceId !== identity.sourceId || previous.userId !== member.userId || previous.joinedAt !== member.joinedAt || previous.outcome !== "succeeded" || previous.operationKey !== evaluationKey(op)) fail(409, "Role continuation is not confirmed")
        if (previous.continued) return result("unchanged", true)
        const owner = await ctx.db.get(previous.ownershipId)
        if (!owner || owner.attemptId !== previous._id || owner.generation !== previous.generation || owner.status !== "idle" || owner.intentSourceId !== identity.sourceId) fail(409, "Role continuation intent changed")
        if (member.roleIds.includes(previous.roleId) !== (previous.action === "add")) fail(409, "Role continuation observation changed")
        await ctx.db.patch(previous._id, { continued: true })
    } else if (sourceAttempt && !reusable) {
        return result(sourceAttempt.outcome === "pending" || sourceAttempt.outcome === "uncertain" ? "blocked" : "unchanged", true)
    }
    const policy = await rolePolicy(ctx, identity.serverId)
    if (op.type === "withdraw" || op.type === "withdraw-member") await rolesAdmin(ctx, identity.serverId, input.actor, true)
    if (policy.defcon !== 3 && op.type !== "join") {
        if (op.type !== "withdraw" && op.type !== "withdraw-member") fail(403, "DEFCON restriction")
        await rolesAdmin(ctx, identity.serverId, input.actor, true)
    }
    let key: string, desiredRoleIds: string[] = [], consideredRoleIds: string[] = [], verifying = false, proofDeadline = Infinity
    if (op.type === "join") {
        shape(op, ["type"], ["type"])
        // A join source is the join itself or a later verification that unlocks the autoroles
        if (identity.createdAt < Date.parse(member.joinedAt)) fail(400, "Autorole source predates current membership")
        if (!policy.settings.autoroleEnabled || policy.settings.humansOnly && member.isBot) return result("unchanged")
        key = `autorole:${policy.settings.revision}`; desiredRoleIds = autoroleIds(policy.settings, member.userId); consideredRoleIds = desiredRoleIds
    } else if (op.type === "withdraw" || op.type === "withdraw-member") {
        shape(op, op.type === "withdraw" ? ["type", "withdrawalId", "roleId"] : ["type", "consumerKey", "roleId"], op.type === "withdraw" ? ["type", "withdrawalId", "roleId"] : ["type", "consumerKey", "roleId"])
        key = op.type === "withdraw" ? (await roleWithdrawal(ctx, identity.serverId, op.withdrawalId)).consumerKey : ""
        // Consumer keys include colon separators, unlike event tokens
        if (op.type === "withdraw-member") {
            if (typeof op.consumerKey !== "string" || !/^(panel:[a-z0-9][a-z0-9_-]{0,31}|autorole):[1-9]\d{0,15}$/.test(op.consumerKey)) fail(400, "Invalid consumer reference")
            key = op.consumerKey
        }
        consideredRoleIds = [requireId(op.roleId)]
        const acknowledgment = await ctx.db.query("roleAcknowledgments").withIndex("by_server_member", q => q.eq("serverId", identity.serverId).eq("userId", member.userId).eq("joinedAt", member.joinedAt)).unique()
        if (acknowledgment && key === consumerKey(acknowledgment.panelName, acknowledgment.rulesRevision)) { await ctx.db.delete(acknowledgment._id) }
    } else {
        if (op.type !== "choose" && op.type !== "reaction" && op.type !== "verify") fail(400, "Invalid role participation")
        await participationAvailability(ctx, identity.serverId, member)
        if (member.isBot) fail(403, "Bot participation unavailable")
        const panel = await rolePanel(ctx, identity.serverId, name(op.name)), published = panel.published
        if (!published || published.revision !== integer(op.revision, 1, Number.MAX_SAFE_INTEGER)) fail(409, "Role panel publication changed")
        if ((op.type === "choose" || op.type === "verify" && op.messageId === undefined) && (identity.createdAt < published.publishedAt || identity.createdAt < Date.parse(member.joinedAt))) fail(400, "Role command predates current publication or membership")
        key = consumerKey(panel.name, published.revision)
        consideredRoleIds = published.mappings.map(x => x.roleId)
        if (op.type === "verify") {
            shape(op, ["type", "name", "revision", "messageId", "panelVerified", "reactionPresent"], ["type", "name", "revision"])
            if (panel.kind !== "verification" || !panel.enabled || panel.withdrawing || !policy.settings.verificationEnabled) fail(403, "Verification unavailable")
            if (job && op.messageId === published.messageId && op.panelVerified === true && op.reactionPresent === false) return result("unchanged")
            if (op.messageId !== undefined && (requireId(op.messageId) !== published.messageId || op.panelVerified !== true || op.reactionPresent !== true)) fail(403, "Current rules reaction required")
            if (op.messageId === undefined && (op.panelVerified !== undefined || op.reactionPresent !== undefined)) fail(400, "Invalid rules acknowledgment")
            if (op.messageId === undefined && identity.createdAt < Date.parse(member.joinedAt)) fail(400, "Rules command predates current membership")
            if (policy.settings.advancedVerificationEnabled) {
                const challengeId = identity.sourceId.startsWith("verify_") ? ctx.db.normalizeId("verificationLinks", identity.sourceId.slice(7)) : null
                const proof = challengeId ? await ctx.db.get(challengeId) : null
                if (!proof || proof.serverId !== identity.serverId || proof.userId !== member.userId || proof.joinedAt !== member.joinedAt
                    || proof.panelName !== panel.name || proof.rulesRevision !== published.revision || proof.publishedMessageId !== published.messageId
                    || proof.sourceId !== identity.sourceId || proof.solvedAt !== identity.createdAt || proof.deliveryClaimToken === undefined
                    || proof.status !== "solved" && proof.status !== "redeemed" || proof.solveExpiresAt === undefined || now >= proof.solveExpiresAt + 180000) fail(403, "Complete the advanced verification challenge first")
                if (proof.status === "solved") await ctx.db.patch(proof._id, { status: "redeemed", redeemedAt: now })
                // A retried grant must not outlive the proof that authorized it
                proofDeadline = proof.solveExpiresAt + 180000
            }
            verifying = true; desiredRoleIds = consideredRoleIds
            await grantEligibility(ctx, identity.serverId, member, key, desiredRoleIds[0]!, true)
            const old = await ctx.db.query("roleAcknowledgments").withIndex("by_server_member", q => q.eq("serverId", identity.serverId).eq("userId", member.userId).eq("joinedAt", member.joinedAt)).unique()
            const value = { rulesRevision: published.revision, panelName: panel.name, acknowledgedAt: now, advancedVerified: policy.settings.advancedVerificationEnabled === true }
            if (old) { if (old.rulesRevision !== published.revision || old.panelName !== panel.name || old.advancedVerified !== value.advancedVerified) await ctx.db.patch(old._id, value) }
            else { await releaseEarlierEpochs(ctx, identity.serverId, member); await ctx.db.insert("roleAcknowledgments", { serverId: identity.serverId, userId: member.userId, joinedAt: member.joinedAt, ...value }) }
            await wakeGreetings(ctx, identity.serverId, member.userId, member.joinedAt)
        } else if (op.type === "reaction") {
            shape(op, ["type", "name", "revision", "messageId", "presentEmojis", "panelVerified"], ["type", "name", "revision", "messageId", "presentEmojis", "panelVerified"])
            if (panel.kind !== "reaction" || requireId(op.messageId) !== published.messageId || op.panelVerified !== true || !Array.isArray(op.presentEmojis) || op.presentEmojis.length > 20) fail(400, "Invalid current panel reaction")
            if (!policy.settings.panelsEnabled || !panel.enabled || panel.withdrawing) fail(403, "Role panel unavailable")
            const present = [...new Set(op.presentEmojis.map(emoji))]
            desiredRoleIds = published.mappings.filter(x => present.includes(x.emoji)).map(x => x.roleId)
            if (published.exclusive && desiredRoleIds.length > 1) return result("ambiguous")
        } else {
            shape(op, ["type", "name", "revision", "roleId", "selected"], ["type", "name", "revision", "roleId", "selected"])
            if (panel.kind !== "reaction") fail(400, "Invalid role panel choice")
            if (!policy.settings.panelsEnabled || !panel.enabled || panel.withdrawing) fail(403, "Role panel unavailable")
            const selected = bool(op.selected), roleId = requireId(op.roleId)
            if (!consideredRoleIds.includes(roleId)) fail(400, "Role is not mapped")
            desiredRoleIds = selected ? [roleId] : []
            if (!published.exclusive || !selected) consideredRoleIds = [roleId]
        }
        // An exclusive choice must never remove an unowned role or another consumer's reference
        if (published.exclusive && desiredRoleIds.length) {
            for (const roleId of consideredRoleIds.filter(x => !desiredRoleIds.includes(x) && member.roleIds.includes(x))) {
                const owner = await roleOwner(ctx, identity.serverId, member, roleId), refs = owner ? await ownerReferences(ctx, owner._id) : []
                if (!owner?.owned || owner.status !== "idle" || refs.some(x => x.desired && x.consumerKey !== key)) fail(409, "Conflicting role is not exclusively owned")
            }
        }
        for (const roleId of desiredRoleIds) {
            const map = published.mappings.find(x => x.roleId === roleId)!
            if (!eligible(map, member.roleIds)) fail(403, "Role prerequisites or exclusions failed")
        }
    }
    // A newer accepted desired-state refresh fences older multi-role continuations
    for (const roleId of consideredRoleIds) {
        const owner = await roleOwner(ctx, identity.serverId, member, roleId)
        if (owner) await ctx.db.patch(owner._id, { intentSourceId: identity.sourceId })
    }
    // First release undesired confirmed-owned roles, then grant after fresh observed absence
    for (const roleId of consideredRoleIds.filter(x => !desiredRoleIds.includes(x))) {
        const owner = await roleOwner(ctx, identity.serverId, member, roleId)
        if (!owner) continue
        await desiredReference(ctx, identity.serverId, owner, key, false, now)
        if (owner.status !== "idle") return result("blocked")
        const refs = await ownerReferences(ctx, owner._id)
        if (refs.some(x => x.desired)) { await dropUndesiredReferences(ctx, owner._id); continue }
        if (owner.owned && member.roleIds.includes(roleId)) return { duplicate: false, status: desiredRoleIds.length ? "partial" : "reserved", acknowledgment: await ack(), grant: await reserveRole(ctx, identity.serverId, member, owner, key, "remove", identity.sourceId, now, evaluationKey(op), job?.binding) }
        await dropUndesiredReferences(ctx, owner._id)
        await ctx.db.patch(owner._id, { owned: false, protected: false, updatedAt: now })
        if (!(await ownerReferences(ctx, owner._id)).length) { await ctx.db.delete(owner._id) }
    }
    for (const roleId of desiredRoleIds) {
        await grantEligibility(ctx, identity.serverId, member, key!, roleId, verifying)
        const owner = await ensureOwner(ctx, identity.serverId, member, roleId, now)
        await ctx.db.patch(owner._id, { intentSourceId: identity.sourceId })
        await desiredReference(ctx, identity.serverId, owner, key!, true, now)
        if (owner.status !== "idle") return result("blocked")
        if (member.roleIds.includes(roleId)) continue
        return { duplicate: false, status: "reserved", acknowledgment: await ack(), grant: await reserveRole(ctx, identity.serverId, member, owner, key!, "add", identity.sourceId, now, evaluationKey(op), job?.binding, proofDeadline) }
    }
    return result(verifying ? "acknowledged" : "unchanged")
} })
