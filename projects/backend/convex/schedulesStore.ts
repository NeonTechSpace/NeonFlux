import type { SchedulesAutomationContext, SchedulesContext, SchedulesDefinition, SchedulesDelivery, SchedulesDeliveryBinding, SchedulesDeliveryReason, SchedulesDeliveryState, SchedulesSnapshot } from "@neonflux/contracts/schedules"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"

import { canonicalPublishingContent, publishingContent } from "./publishingDomain.ts"
import { advanceSchedule, automationContext, scheduleContentSource, SCHEDULES_DAY } from "./schedulesDomain.ts"
import { fail } from "./validation.ts"
import { civilDayEnded } from "./civilDomain.ts"
import { eventAdmin } from "./publishingContext.ts"

export type SchedulesRead = MutationCtx | QueryCtx
export const scheduleSettings = (ctx: SchedulesRead, serverId: string) => ctx.db.query("scheduleSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
export const publisherSettings = (ctx: SchedulesRead, serverId: string) => ctx.db.query("publishingSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
export async function eventGate(ctx: SchedulesRead, serverId: string, critical = false) {
    const moderation = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if ((moderation?.config.defcon ?? 3) !== 3 && !critical) fail(403, "DEFCON restriction")
}
export async function scheduleState(ctx: MutationCtx, serverId: string) {
    const old = await scheduleSettings(ctx, serverId)
    if (old) return old
    const id = await ctx.db.insert("scheduleSettings", { serverId, enabled: false, revision: 1, activatedAt: 0, nextScheduleNo: 1, nextOccurrenceNo: 1, definitions: 0, deliveries: 0, receipts: 0 })
    return (await ctx.db.get(id))!
}
export async function scheduleCount(ctx: MutationCtx, serverId: string, key: "definitions" | "deliveries" | "receipts", delta: number) {
    const row = await scheduleState(ctx, serverId), cap = { definitions: 50, deliveries: 200, receipts: 1000 }[key]
    if (row[key] + delta > cap) fail(429, "Schedule capacity reached")
    if (row[key] + delta < 0) fail(503, "Schedule accounting unavailable")
    await ctx.db.patch(row._id, { [key]: row[key] + delta })
}
export async function scheduleRow(ctx: SchedulesRead, serverId: string, scheduleNo: number, revision?: number) {
    const row = await ctx.db.query("schedules").withIndex("by_number", q => q.eq("serverId", serverId).eq("scheduleNo", scheduleNo)).unique()
    if (!row) fail(404, "Schedule not found")
    if (revision !== undefined && row.revision !== revision) fail(409, "Schedule revision changed")
    return row
}
export async function boundScheduleDelivery(ctx: SchedulesRead, serverId: string, binding: SchedulesDeliveryBinding) {
    const id = ctx.db.normalizeId("scheduleDeliveries", binding.deliveryId), row = id ? await ctx.db.get(id) : null
    if (!row || row.serverId !== serverId || row.scheduleNo !== binding.scheduleNo || row.planRevision !== binding.planRevision || row.occurrenceNo !== binding.occurrenceNo) fail(409, "Schedule delivery binding changed")
    return row
}
export function publicSchedule(row: Doc<"schedules">): SchedulesDefinition {
    return { scheduleNo: row.scheduleNo, name: row.name, revision: row.revision, planRevision: row.planRevision, createdBy: row.createdBy, channelId: row.channelId, calendar: row.calendar, source: row.source, content: row.content, canonicalContent: canonicalPublishingContent(row.canonicalContent), enabled: row.enabled, cancelled: row.cancelled, activatedAt: row.activatedAt, createdAt: row.createdAt, updatedAt: row.updatedAt }
}
export function publicScheduleDelivery(row: Doc<"scheduleDeliveries">): SchedulesDelivery {
    return { deliveryId: row._id, scheduleNo: row.scheduleNo, planRevision: row.planRevision, occurrenceNo: row.occurrenceNo, channelId: row.channelId, source: row.source, content: row.content, canonicalContent: canonicalPublishingContent(row.canonicalContent), localMinute: row.localMinute, zone: row.zone, offsetMinutes: row.offsetMinutes, dueAt: row.dueAt, state: row.state, nextCheckAt: row.nextCheckAt, ...(row.claimedAt !== undefined ? { claimedAt: row.claimedAt } : {}), ...(row.postNo !== undefined ? { postNo: row.postNo } : {}), ...(row.attemptId ? { attemptId: row.attemptId } : {}), ...(row.reason ? { reason: row.reason } : {}) }
}
export async function scheduleSnapshot(ctx: SchedulesRead, serverId: string, value: unknown): Promise<SchedulesSnapshot> {
    const selected = scheduleContentSource(value)
    const row = await ctx.db.query("publishingDrafts").withIndex("by_server_kind_name", q => q.eq("serverId", serverId).eq("kind", selected.kind).eq("name", selected.name)).unique()
    if (!row) fail(404, "Publishing draft not found")
    if (row.revision !== selected.revision) fail(409, "Publishing draft changed")
    const content = publishingContent(row.content, true)
    return { source: selected, content, canonicalContent: canonicalPublishingContent(content) }
}
export async function scheduleReceipt(ctx: MutationCtx, identity: { serverId: string, messageId: string, createdAt: number }, actorId: string, operation: unknown) {
    const old = await ctx.db.query("scheduleReceipts").withIndex("by_source", q => q.eq("serverId", identity.serverId).eq("messageId", identity.messageId)).unique(), key = JSON.stringify(operation)
    if (old) {
        if (old.actorId !== actorId || old.createdAt !== identity.createdAt || old.operationKey !== key) fail(409, "Schedule source binding changed")
        return false
    }
    await scheduleCount(ctx, identity.serverId, "receipts", 1)
    await ctx.db.insert("scheduleReceipts", { serverId: identity.serverId, messageId: identity.messageId, createdAt: identity.createdAt, actorId, operationKey: key, expiresAt: Date.now() + SCHEDULES_DAY })
    return true
}
export const scheduleAdmin = (ctx: SchedulesRead, serverId: string, context: SchedulesContext, critical = false) => eventAdmin(ctx, serverId, context, critical)
// Automatic deliveries follow server policy: DEFCON open and fresh bot permission in the destination
export async function scheduleAutomation(ctx: SchedulesRead, serverId: string, context: SchedulesAutomationContext, channelId: string) {
    await eventGate(ctx, serverId)
    if (context.channelId !== channelId || !context.botAuthorized) fail(403, "Schedule destination unavailable")
}
export async function scheduleAvailability(ctx: SchedulesRead, row: Doc<"scheduleDeliveries">) {
    const definition = await scheduleRow(ctx, row.serverId, row.scheduleNo), module = await scheduleSettings(ctx, row.serverId), publisher = await publisherSettings(ctx, row.serverId)
    return { cancelled: definition.cancelled, enabled: definition.enabled && (module?.enabled ?? false) && (publisher?.enabled ?? true), cutoff: Math.max(definition.activatedAt, module?.activatedAt ?? 0, publisher?.activatedAt ?? 0) }
}
export async function closeScheduleDelivery(ctx: MutationCtx, row: Doc<"scheduleDeliveries">, state: SchedulesDeliveryState, reason: SchedulesDeliveryReason, now = Date.now()) {
    if (row.claimedAt !== undefined) return false
    const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
    if (attempt && (attempt.dispatchedAt !== undefined || attempt.outcome !== "pending")) return false
    if (attempt) {
        if (attempt.consumer?.type !== "schedule" || attempt.consumer.deliveryId !== row._id) fail(503, "Schedule publication binding unavailable")
        await ctx.db.patch(attempt._id, { outcome: "failed", noDispatch: true, unresolved: false, finishedAt: now, expiresAt: now + 180 * SCHEDULES_DAY })
        const post = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", row.serverId).eq("postNo", attempt.postNo)).unique()
        if (!post || post.attemptId !== attempt._id) fail(503, "Schedule post unavailable")
        await ctx.db.patch(post._id, { outcome: "failed", updatedAt: now })
    }
    await ctx.db.patch(row._id, { active: false, state, reason, historyExpiresAt: now + 180 * SCHEDULES_DAY })
    return true
}
export async function addSchedulePlan(ctx: MutationCtx, row: Doc<"schedules">, futureOnly = false, now = Date.now()) {
    const dates = row.calendar.dates.filter(date => !futureOnly || date.dueAt > now)
    await scheduleCount(ctx, row.serverId, "deliveries", dates.length)
    const current = await scheduleState(ctx, row.serverId)
    let occurrenceNo = current.nextOccurrenceNo
    for (const date of dates) {
        await ctx.db.insert("scheduleDeliveries", { serverId: row.serverId, scheduleNo: row.scheduleNo, planRevision: row.planRevision, occurrenceNo, channelId: row.channelId, source: row.source, content: row.content, canonicalContent: row.canonicalContent, localMinute: date.localMinute, zone: row.calendar.zone, offsetMinutes: date.offsetMinutes, dueAt: date.dueAt, state: "queued", active: true, nextCheckAt: date.dueAt, createdAt: now })
        occurrenceNo = advanceSchedule(occurrenceNo)
    }
    await ctx.db.patch(current._id, { nextOccurrenceNo: occurrenceNo })
}
export async function schedulePublishingFence(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, value: unknown): Promise<boolean> {
    const consumer = attempt.consumer
    if (consumer?.type !== "schedule" || attempt.source?.type !== "schedule-timer" || attempt.provenance?.type !== "schedule") fail(409, "Schedule consumer missing")
    const row = await boundScheduleDelivery(ctx, attempt.serverId, { deliveryId: consumer.deliveryId, scheduleNo: consumer.scheduleNo, planRevision: consumer.planRevision, occurrenceNo: consumer.occurrenceNo }), now = Date.now()
    if (row.attemptId !== attempt._id || row.postNo !== attempt.postNo || attempt.actorId !== attempt.botId || row.channelId !== attempt.channelId || row.dueAt !== attempt.source.dueAt || attempt.source.deliveryId !== row._id || attempt.provenance.scheduleNo !== row.scheduleNo || attempt.provenance.planRevision !== row.planRevision || JSON.stringify(attempt.provenance.source) !== JSON.stringify(row.source)) fail(409, "Schedule publication binding changed")
    if (!row.active || row.state !== "reserved" || row.claimedAt !== undefined) return false
    const availability = await scheduleAvailability(ctx, row)
    if (availability.cancelled) { await closeScheduleDelivery(ctx, row, "cancelled", "cancelled", now); return false }
    if (row.dueAt <= availability.cutoff) { await closeScheduleDelivery(ctx, row, "skipped", "activation-cutoff", now); return false }
    if (civilDayEnded(row.dueAt, row.zone, now) || now >= attempt.dispatchExpiresAt) {
        await closeScheduleDelivery(ctx, row, "skipped", "dispatch-expired", now)
        return false
    }
    if (!availability.enabled || now < row.dueAt) return false
    const context = automationContext(value)
    if (context.botId !== attempt.botId) fail(403, "Schedule bot identity changed")
    await scheduleAutomation(ctx, row.serverId, context, row.channelId)
    return true
}
export async function claimSchedulePublishing(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, now: number) {
    if (attempt.consumer?.type !== "schedule") return
    const row = await boundScheduleDelivery(ctx, attempt.serverId, attempt.consumer)
    if (row.attemptId !== attempt._id) fail(409, "Schedule attempt changed")
    await ctx.db.patch(row._id, { claimedAt: now, active: false })
}
export async function syncSchedulePublishing(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, outcome: "sent" | "failed" | "uncertain") {
    if (attempt.consumer?.type !== "schedule") return
    const row = await boundScheduleDelivery(ctx, attempt.serverId, attempt.consumer)
    if (row.attemptId !== attempt._id) fail(409, "Schedule attempt changed")
    if (row.claimedAt === undefined && !row.active && row.reason) return
    await ctx.db.patch(row._id, { state: outcome, active: false, ...(attempt.dispatchedAt === undefined && outcome === "failed" ? { reason: "dispatch-expired" as const } : {}), historyExpiresAt: Date.now() + 180 * SCHEDULES_DAY })
}
