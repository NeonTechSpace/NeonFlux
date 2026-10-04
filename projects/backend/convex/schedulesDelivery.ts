import { ConvexError, v } from "convex/values"
import type { SchedulesDeliveryGrant, SchedulesDeliveryResult } from "../contracts.js"
import { internalMutation } from "./_generated/server.js"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { shape } from "./publishingDomain.ts"
import { age, publicAttempt, reservePublishing } from "./publishing.ts"
import { automationContext, scheduleBinding, scheduleCursor, SCHEDULES_BATCH } from "./schedulesDomain.ts"
import { boundScheduleDelivery, closeScheduleDelivery, publicScheduleDelivery, scheduleAutomation, scheduleAvailability, scheduleState } from "./schedulesStore.ts"
import { fail, object, requireId, requireServer } from "./validation.ts"
import { civilDayEnded } from "./civilDomain.ts"

async function available(ctx: MutationCtx, row: Doc<"scheduleDeliveries">, now: number) {
    if (!row.active || row.claimedAt !== undefined) return "terminal" as const
    const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
    if (attempt && (attempt.outcome !== "pending" || attempt.dispatchedAt !== undefined)) return "terminal" as const
    const gate = await scheduleAvailability(ctx, row)
    if (gate.cancelled) { await closeScheduleDelivery(ctx, row, "cancelled", "cancelled", now); return "cancelled" as const }
    if (row.dueAt <= gate.cutoff) { await closeScheduleDelivery(ctx, row, "skipped", "activation-cutoff", now); return "skipped" as const }
    if (civilDayEnded(row.dueAt, row.zone, now)) { await closeScheduleDelivery(ctx, row, "skipped", "late-window", now); return "skipped" as const }
    if (attempt && now >= attempt.dispatchExpiresAt) { await age(ctx, attempt, now); return "terminal" as const }
    return gate.enabled && now >= row.dueAt ? "ready" as const : "waiting" as const
}
export const delivery = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<SchedulesDeliveryResult> => {
    const input = shape(request, ["serverId", "operation"], ["serverId", "operation"]), serverId = requireId(input.serverId)
    requireServer(serverId)
    const op = object(input.operation), now = Date.now()
    if (op.type === "list") {
        shape(op, ["type", "cursor"], ["type"])
        const current = await scheduleState(ctx, serverId), explicit = op.cursor === undefined ? undefined : scheduleCursor(op.cursor, now)
        const cursor = explicit ? explicit.cursor : current.discoveryCursor ?? null, throughAt = explicit?.throughAt ?? current.discoveryThroughAt ?? now
        const page = await ctx.db.query("scheduleDeliveries").withIndex("by_discovery", q => q.eq("serverId", serverId).eq("active", true).lte("nextCheckAt", throughAt)).paginate({ cursor, numItems: SCHEDULES_BATCH })
        const deliveries = []
        for (const row of page.page) {
            const status = await available(ctx, row, now)
            // A durable visit advances even when native permissions cannot be fetched
            if (status === "ready" || status === "waiting") await ctx.db.patch(row._id, { nextCheckAt: now + 60000 })
            if (status === "ready") deliveries.push(publicScheduleDelivery({ ...row, nextCheckAt: now + 60000 }))
        }
        await ctx.db.patch(current._id, { discoveryCursor: page.isDone ? undefined : page.continueCursor, discoveryThroughAt: page.isDone ? undefined : throughAt })
        return { type: "deliveries", deliveries, hasMore: !page.isDone, ...(!page.isDone ? { nextCursor: { cursor: page.continueCursor, throughAt } } : {}) }
    }
    if (op.type !== "reserve" && op.type !== "defer") fail(400, "Invalid schedule delivery operation")
    shape(op, op.type === "reserve" ? ["type", "binding", "context"] : ["type", "binding"], op.type === "reserve" ? ["type", "binding", "context"] : ["type", "binding"])
    const row = await boundScheduleDelivery(ctx, serverId, scheduleBinding(op.binding)), status = await available(ctx, row, now)
    if (op.type === "defer") {
        if (status !== "ready" && status !== "waiting") return { type: "progress", recorded: false }
        await ctx.db.patch(row._id, { ...(row.attemptId ? {} : { state: "blocked" as const, reason: "permission" as const }), nextCheckAt: now + 60000 })
        return { type: "progress", recorded: true }
    }
    if (status !== "ready") return { type: "reservation", status }
    const context = automationContext(op.context)
    try { await scheduleAutomation(ctx, serverId, context, row.channelId) }
    catch (error) {
        if (!(error instanceof ConvexError) || error.data === null || typeof error.data !== "object" || !("status" in error.data) || error.data.status !== 403) throw error
        await ctx.db.patch(row._id, { ...(row.attemptId ? {} : { state: "blocked" as const, reason: "permission" as const }), nextCheckAt: now + 60000 })
        return { type: "reservation", status: "waiting" }
    }
    if (row.attemptId) {
        const attempt = await ctx.db.get(row.attemptId)
        if (!attempt || attempt.consumer?.type !== "schedule" || attempt.consumer.deliveryId !== row._id || attempt.botId !== context.botId) fail(409, "Reserved schedule publication changed")
        const { outcome, createdAt, finishedAt, dispatchedAt, noDispatch, observation, resolution, ...grant } = publicAttempt(attempt)
        return { type: "reservation", status: "reserved", grant: grant as SchedulesDeliveryGrant }
    }
    const reserved = await reservePublishing(ctx, { serverId, actorId: context.botId, botId: context.botId, channelId: row.channelId, sourceId: `schedule_timer_${row._id}`,
        source: { type: "schedule-timer", deliveryId: row._id, dueAt: row.dueAt }, provenance: { type: "schedule", scheduleNo: row.scheduleNo, planRevision: row.planRevision, source: row.source },
        consumer: { type: "schedule", scheduleNo: row.scheduleNo, planRevision: row.planRevision, occurrenceNo: row.occurrenceNo, deliveryId: row._id }, content: row.content, expiresAt: now + 180000 })
    const attemptId = ctx.db.normalizeId("publishingAttempts", reserved.grant.attemptId)!
    await ctx.db.patch(row._id, { state: "reserved", reason: undefined, postNo: reserved.post.postNo, attemptId, nextCheckAt: now })
    return { type: "reservation", status: "reserved", grant: reserved.grant as SchedulesDeliveryGrant }
} })
