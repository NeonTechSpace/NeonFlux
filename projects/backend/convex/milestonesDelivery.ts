import { ConvexError, v } from "convex/values"
import { MilestonesDeliveryRequest, type MilestonesDeliveryGrant, type MilestonesDeliveryResult, type MilestonesMemberTarget, type MilestonesMembershipObservation } from "@neonflux/contracts/milestones"
import { serviceMutation } from "./installations.ts"
import type { MutationCtx } from "./_generated/server.js"
import { age, publicAttempt, reservePublishing } from "./publishing.ts"
import { milestoneDeliveryContext, renderMilestone, MILESTONES_BATCH } from "./milestonesDomain.ts"
import { availableMilestone, boundMilestoneDelivery, deliveryBinding, milestoneEnrollment, milestoneParticipantEligible, milestoneState, progressMilestone, publicMilestoneDelivery, removeMilestoneEnrollment } from "./milestonesStore.ts"
import { scheduleAutomation } from "./schedulesStore.ts"
import { recentObservation } from "./schedulesDomain.ts"
import { decode, fail, requireServer } from "./validation.ts"
// The caller has checked that the observation is fresh
async function observeTarget(ctx: MutationCtx, serverId: string, target: MilestonesMemberTarget, observed: MilestonesMembershipObservation) {
    if (observed.userId !== target.userId) fail(409, "Milestone observed member changed")
    const row = await milestoneEnrollment(ctx, serverId, target.userId, target.kind)
    if (!row || row.revision !== target.consentRevision || row.joinedAt !== target.joinedAt || row.consentedAt !== target.consentedAt || observed.observedAt < Math.max(row.observedAt, row.consentedAt)) return false
    if (observed.status === "present" && observed.joinedAt === row.joinedAt) { await ctx.db.patch(row._id, { observedAt: observed.observedAt }); return false }
    await removeMilestoneEnrollment(ctx, row, "membership")
    return true
}
export const delivery = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<MilestonesDeliveryResult> => {
    const { serverId, operation: op } = decode(MilestonesDeliveryRequest, request), now = Date.now()
    requireServer(serverId)
    if (op.type === "member-targets") {
        const userId = op.userId
        const page = await ctx.db.query("milestoneEnrollments").withIndex("by_user_kind", q => q.eq("serverId", serverId).eq("userId", userId)).paginate({ cursor: op.cursor ?? null, numItems: MILESTONES_BATCH })
        return { type: "member-targets", targets: page.page.map(row => ({ kind: row.kind, userId: row.userId, joinedAt: row.joinedAt, consentRevision: row.revision, consentedAt: row.consentedAt })), hasMore: !page.isDone, ...(!page.isDone ? { nextCursor: page.continueCursor } : {}) }
    }
    if (op.type === "member-observation") {
        recentObservation(op.observation.observedAt)
        return { type: "progress", recorded: await observeTarget(ctx, serverId, op.target, op.observation), hasMore: false }
    }
    if (op.type === "list") {
        const current = await milestoneState(ctx, serverId), explicit = op.cursor
        if (explicit && explicit.throughAt > now) fail(400, "Invalid milestone due cursor")
        const throughAt = explicit?.throughAt ?? current.discoveryThroughAt ?? now
        const page = await ctx.db.query("milestoneEnrollments").withIndex("by_discovery", q => q.eq("serverId", serverId).lte("nextCheckAt", throughAt)).paginate({ cursor: explicit ? explicit.cursor : current.discoveryCursor ?? null, numItems: MILESTONES_BATCH })
        const deliveries = []
        for (const enrollment of page.page) {
            const row = await progressMilestone(ctx, enrollment)
            if (row && await availableMilestone(ctx, row) === "ready") deliveries.push(publicMilestoneDelivery(row))
        }
        await ctx.db.patch(current._id, { discoveryCursor: page.isDone ? undefined : page.continueCursor, discoveryThroughAt: page.isDone ? undefined : throughAt })
        return { type: "deliveries", deliveries, hasMore: !page.isDone, ...(!page.isDone ? { nextCursor: { cursor: page.continueCursor, throughAt } } : {}) }
    }
    const row = await boundMilestoneDelivery(ctx, serverId, op.binding)
    if (op.type === "membership") {
        const observed = op.observation, c = op.cursor
        recentObservation(observed.observedAt)
        if (observed.userId !== row.userId) fail(409, "Milestone observed member changed")
        if (c && (c.userId !== row.userId || c.joinedAt !== row.joinedAt || c.observedAt !== observed.observedAt)) fail(409, "Milestone cleanup cursor changed")
        const page = await ctx.db.query("milestoneEnrollments").withIndex("by_member_epoch", q => q.eq("serverId", serverId).eq("userId", row.userId).eq("joinedAt", row.joinedAt)).paginate({ cursor: c?.cursor ?? null, numItems: MILESTONES_BATCH })
        let recorded = false
        for (const enrollment of page.page) {
            // The locator's exact consent protects later enrollment of the same raw epoch
            if (enrollment.kind === row.kind && enrollment.revision !== row.consentRevision || enrollment.revision > row.consentRevision || enrollment.consentedAt > row.createdAt) continue
            recorded = await observeTarget(ctx, serverId, { kind: enrollment.kind, userId: enrollment.userId, joinedAt: enrollment.joinedAt, consentRevision: enrollment.revision, consentedAt: enrollment.consentedAt }, observed) || recorded
        }
        return { type: "progress", recorded, hasMore: !page.isDone, ...(!page.isDone ? { nextCursor: { cursor: page.continueCursor, userId: row.userId, joinedAt: row.joinedAt, observedAt: observed.observedAt } } : {}) }
    }
    const status = await availableMilestone(ctx, row)
    if (op.type === "defer") {
        if (status !== "ready" && status !== "waiting") return { type: "progress", recorded: false }
        await ctx.db.patch(row._id, { nextCheckAt: now + 60000, ...(!row.attemptId ? { state: "blocked" as const, reason: "permission" as const } : {}) })
        const enrollment = await milestoneEnrollment(ctx, serverId, row.userId, row.kind)
        if (enrollment?.deliveryId === row._id) await ctx.db.patch(enrollment._id, { nextCheckAt: now + 60000 })
        return { type: "progress", recorded: true }
    }
    if (status !== "ready") return { type: "reservation", status }
    const context = milestoneDeliveryContext(op.context)
    if (context.participant.member.userId !== row.userId || context.participant.channelId !== row.channelId || context.participant.botId !== context.automation.botId) fail(403, "Milestone participant identity changed")
    if (context.participant.member.joinedAt !== row.joinedAt) {
        const enrollment = await milestoneEnrollment(ctx, serverId, row.userId, row.kind)
        if (enrollment?.revision === row.consentRevision && context.participant.observedAt >= Math.max(enrollment.consentedAt, enrollment.observedAt)) await removeMilestoneEnrollment(ctx, enrollment, "membership")
        return { type: "reservation", status: "cancelled" }
    }
    try {
        await scheduleAutomation(ctx, serverId, context.automation, row.channelId)
        await milestoneParticipantEligible(ctx, serverId, context.participant, row.channelId, row.userId)
    } catch (error) {
        if (!(error instanceof ConvexError) || typeof error.data !== "object" || error.data === null || !("status" in error.data) || error.data.status !== 403) throw error
        await ctx.db.patch(row._id, { nextCheckAt: now + 60000, ...(!row.attemptId ? { state: "blocked" as const, reason: "permission" as const } : {}) })
        return { type: "reservation", status: "waiting" }
    }
    if (row.attemptId) {
        const attempt = await ctx.db.get(row.attemptId)
        if (!attempt || attempt.consumer?.type !== "milestone" || attempt.consumer.deliveryId !== row._id || attempt.botId !== context.automation.botId) fail(409, "Reserved milestone changed")
        if (now >= attempt.dispatchExpiresAt) { await age(ctx, attempt, now); return { type: "reservation", status: "terminal" } }
        const { outcome, createdAt, finishedAt, dispatchedAt, noDispatch, observation, resolution, ...grant } = publicAttempt(attempt)
        return { type: "reservation", status: "reserved", grant: grant as MilestonesDeliveryGrant }
    }
    const reserved = await reservePublishing(ctx, { serverId, actorId: context.automation.botId, botId: context.automation.botId, channelId: row.channelId, sourceId: `milestone_timer_${row._id}`, source: { type: "milestone-timer", deliveryId: row._id, dueAt: row.dueAt }, provenance: { type: "milestone", kind: row.kind, intentRevision: row.intentRevision, template: row.template }, consumer: { type: "milestone", ...deliveryBinding(row) }, content: renderMilestone(row.content, row.kind, context.participant.userName, context.participant.serverName, row.completedYears), expiresAt: now + 180000 })
    const attemptId = ctx.db.normalizeId("publishingAttempts", reserved.grant.attemptId)!
    await ctx.db.patch(row._id, { state: "reserved", reason: undefined, postNo: reserved.post.postNo, attemptId, nextCheckAt: now })
    return { type: "reservation", status: "reserved", grant: reserved.grant as MilestonesDeliveryGrant }
} })
