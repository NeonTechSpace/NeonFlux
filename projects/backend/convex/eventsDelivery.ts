import { EventsDeliveryRequest, type EventsDeliveryBinding, type EventsDeliveryGrant, type EventsDeliveryResult } from "@neonflux/contracts/events"
import { v, ConvexError } from "convex/values"
import { internalMutation } from "./_generated/server.js"
import type { MutationCtx } from "./_generated/server.js"
import { renderEvent } from "./eventsDomain.ts"
import { age, publicAttempt, reservePublishing } from "./publishing.ts"
import { eventAutomation, eventAutomationContext, eventRow, lifecycle, occurrenceRow, publicDelivery, publicEvent } from "./eventsStore.ts"
import { decode, fail, requireServer } from "./validation.ts"
async function bound(ctx: MutationCtx, serverId: string, b: EventsDeliveryBinding) {
    const id = ctx.db.normalizeId("eventDeliveries", b.deliveryId), row = id ? await ctx.db.get(id) : null
    if (!row || row.serverId !== serverId || row.eventNo !== b.eventNo || row.occurrenceNo !== b.occurrenceNo || row.revision !== b.revision || row.offsetMinutes !== b.offsetMinutes) fail(409, "Event delivery binding changed")
    return row
}
export const delivery = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<EventsDeliveryResult> => {
    const input = decode(EventsDeliveryRequest, request), serverId = input.serverId; requireServer(serverId)
    const op = input.operation, now = Date.now()
    if (op.type === "list") {
        const queued = await ctx.db.query("eventDeliveries").withIndex("by_due", q => q.eq("serverId", serverId).eq("state", "queued").lte("nextCheckAt", now)).take(20)
        const blocked = await ctx.db.query("eventDeliveries").withIndex("by_due", q => q.eq("serverId", serverId).eq("state", "blocked").lte("nextCheckAt", now)).take(20)
        const reserved = await ctx.db.query("eventDeliveries").withIndex("by_due_unclaimed", q => q.eq("serverId", serverId).eq("state", "reserved").eq("claimedAt", undefined).lte("nextCheckAt", now)).take(20)
        const selected = [...queued, ...blocked, ...reserved].sort((a, b) => a.nextCheckAt - b.nextCheckAt || a.dueAt - b.dueAt || a.eventNo - b.eventNo).slice(0, 20), active = []
        for (const row of selected) {
            if (row.claimedAt !== undefined) continue
            const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
            if (attempt && (attempt.outcome !== "pending" || attempt.dispatchedAt !== undefined)) continue
            if (attempt && now >= attempt.dispatchExpiresAt) { await age(ctx, attempt, now); continue }
            if (now >= Math.min(row.dueAt + 300000, row.startsAt)) { await ctx.db.patch(row._id, { state: "skipped" }); continue }
            if (row.dueAt > now) continue
            active.push(publicDelivery(row))
        }
        return { type: "deliveries", deliveries: active }
    }
    if (op.type === "status") {
        await eventRow(ctx, serverId, op.eventNo)
        const after = op.afterDeliveryId === undefined ? null : ctx.db.normalizeId("eventDeliveries", op.afterDeliveryId)
        if (op.afterDeliveryId !== undefined && !after) fail(400, "Invalid delivery cursor")
        if (after) {
            const cursor = await ctx.db.get(after)
            if (!cursor || cursor.serverId !== serverId || cursor.eventNo !== op.eventNo) fail(400, "Invalid delivery cursor")
        }
        const rows = await ctx.db.query("eventDeliveries").withIndex("by_event", q => q.eq("serverId", serverId).eq("eventNo", op.eventNo)).take(1101)
        const selected = rows.filter(row => after === null || row._id > after).sort((a, b) => a._id < b._id ? -1 : 1).slice(0, 21)
        const deliveries = []
        for (const row of selected.slice(0, 20)) {
            const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
            deliveries.push(publicDelivery(attempt && attempt.outcome !== "pending" ? { ...row, state: attempt.outcome } : row))
        }
        return { type: "deliveries", deliveries, ...(selected.length > 20 ? { nextAfterDeliveryId: selected[19]!._id } : {}) }
    }
    if (op.type === "show") {
        return { type: "event", event: publicEvent(await eventRow(ctx, serverId, op.eventNo)) }
    }
    if (op.type !== "reserve" && op.type !== "defer") fail(400, "Invalid delivery operation")
    const b = op.binding, row = await bound(ctx, serverId, b)
    if (!["queued", "blocked", "reserved"].includes(row.state)) return op.type === "defer" ? { type: "progress", recorded: false } : { type: "reservation", status: "terminal" }
    const event = await eventRow(ctx, serverId, row.eventNo)
    if (event.state === "cancelled" || event.forgetting || event.revision !== row.revision || event.channelId !== row.channelId) {
        await ctx.db.patch(row._id, { state: "cancelled" }); return op.type === "defer" ? { type: "progress", recorded: true } : { type: "reservation", status: "cancelled" }
    }
    if (now >= Math.min(row.dueAt + 300000, row.startsAt)) {
        if (row.state !== "reserved") await ctx.db.patch(row._id, { state: "skipped" })
        return op.type === "defer" ? { type: "progress", recorded: true } : { type: "reservation", status: "skipped" }
    }
    if (op.type === "defer") {
        if (row.attemptId) return { type: "progress", recorded: false }
        await ctx.db.patch(row._id, { state: "blocked", nextCheckAt: now + 60000 })
        return { type: "progress", recorded: true }
    }
    const context = eventAutomationContext(op.context)
    if (row.attemptId) {
        const attempt = await ctx.db.get(row.attemptId)
        if (!attempt || attempt.consumer?.type !== "event" || attempt.consumer.deliveryId !== row._id) fail(503, "Reserved event attempt unavailable")
        if (attempt.outcome !== "pending" || attempt.dispatchedAt !== undefined) return { type: "reservation", status: "terminal" }
        const { outcome, createdAt, finishedAt, dispatchedAt, noDispatch, observation, resolution, ...grant } = publicAttempt(attempt)
        return { type: "reservation", status: "reserved", grant: grant as EventsDeliveryGrant }
    }
    if (now < row.dueAt || now < row.nextCheckAt) return { type: "reservation", status: "waiting" }
    const occurrence = await occurrenceRow(ctx, serverId, row.eventNo, row.occurrenceNo, row.revision)
    if (lifecycle({ ...occurrence.date, state: occurrence.state }) !== "open") return { type: "reservation", status: "cancelled" }
    try { await eventAutomation(ctx, serverId, context, event.channelId) } catch (error) {
        if (!(error instanceof ConvexError) || error.data === null || typeof error.data !== "object" || !("status" in error.data) || error.data.status !== 403) throw error
        await ctx.db.patch(row._id, { state: "blocked", nextCheckAt: now + 60000 })
        return { type: "reservation", status: "waiting" }
    }
    const reserved = await reservePublishing(ctx, { serverId, actorId: context.botId, botId: context.botId, channelId: event.channelId, sourceId: `event_timer_${row._id}`,
        source: { type: "event-timer", deliveryId: row._id, dueAt: row.dueAt }, provenance: { type: "event", eventNo: event.eventNo, revision: event.revision, ...(event.template ? { template: { name: event.template.name, revision: event.template.revision } } : {}) },
        consumer: { type: "event", eventNo: event.eventNo, revision: event.revision, purpose: "reminder", occurrenceNo: occurrence.occurrenceNo, offsetMinutes: row.offsetMinutes, deliveryId: row._id }, content: renderEvent(event, occurrence.date), expiresAt: Math.min(now + 180000, row.dueAt + 300000, row.startsAt) })
    const attemptId = ctx.db.normalizeId("publishingAttempts", reserved.grant.attemptId)!
    await ctx.db.patch(row._id, { state: "reserved", postNo: reserved.post.postNo, attemptId })
    return { type: "reservation", status: "reserved", grant: reserved.grant as EventsDeliveryGrant }
} })
