import { v } from "convex/values"
import type { SchedulesManageResult, SchedulesQueryResult } from "../contracts.js"
import { internalMutation, internalQuery } from "./_generated/server.js"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { publishingName, shape } from "./publishingDomain.ts"
import { reconcilePublishing, releaseSchedulePublication } from "./publishing.ts"
import { advanceSchedule, scheduleContext, validateScheduleCalendar, SCHEDULES_BATCH } from "./schedulesDomain.ts"
import { addSchedulePlan, closeScheduleDelivery, publicSchedule, publicScheduleDelivery, publisherSettings, scheduleAdmin, scheduleCount, scheduleReceipt, scheduleRow, scheduleSettings, scheduleSnapshot, scheduleState } from "./schedulesStore.ts"
import { fail, object, requireId, requireServer, bool, integer, source, token } from "./validation.ts"
const publicSettings = (row: Doc<"scheduleSettings"> | null) => ({ enabled: row?.enabled ?? false, revision: row?.revision ?? 1, activatedAt: row?.activatedAt ?? 0 })
async function closeFuture(ctx: MutationCtx, row: Doc<"schedules">, now: number, cancel = false) {
    // Retained delivery capacity bounds the number of indexed pages
    for (let page = 0; page < 11; page++) {
        const rows = await ctx.db.query("scheduleDeliveries").withIndex("by_schedule_active_due", q => q.eq("serverId", row.serverId).eq("scheduleNo", row.scheduleNo).eq("active", true).gt("dueAt", cancel ? -1 : now)).take(SCHEDULES_BATCH)
        if (!rows.length) return
        for (const delivery of rows) await closeScheduleDelivery(ctx, delivery, cancel ? "cancelled" : "superseded", cancel ? "cancelled" : "superseded", now)
        // Closing removes each row from the active index, including equal due times
        if (rows.length < SCHEDULES_BATCH) return
    }
    fail(503, "Schedule retained capacity conflict")
}
async function settled(ctx: MutationCtx, row: Doc<"scheduleDeliveries">) {
    const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
    if (row.active || attempt && (attempt.outcome === "pending" || attempt.unresolved)) fail(409, "Unresolved schedule occurrence preserved")
    if (row.attemptId && !attempt) fail(503, "Schedule ownership anchor unavailable")
}
export async function forgetSchedule(ctx: MutationCtx, row: Doc<"schedules">, occurrenceNos?: number[]) {
    const selective = occurrenceNos !== undefined
    if (!selective) {
        if (await ctx.db.query("scheduleDeliveries").withIndex("by_schedule_active_due", q => q.eq("serverId", row.serverId).eq("scheduleNo", row.scheduleNo).eq("active", true)).first()) fail(409, "Pending schedule occurrences preserved")
        if (await ctx.db.query("publishingAttempts").withIndex("by_schedule_unresolved", q => q.eq("serverId", row.serverId).eq("consumer.scheduleNo", row.scheduleNo).eq("unresolved", true)).first()) fail(409, "Unresolved schedule publication preserved")
    }
    const rows: Doc<"scheduleDeliveries">[] = []
    if (selective) for (const occurrenceNo of occurrenceNos) {
        const delivery = await ctx.db.query("scheduleDeliveries").withIndex("by_schedule_occurrence", q => q.eq("serverId", row.serverId).eq("scheduleNo", row.scheduleNo).eq("occurrenceNo", occurrenceNo)).unique()
        if (!delivery) fail(404, "Schedule occurrence not found")
        rows.push(delivery)
    }
    else rows.push(...await ctx.db.query("scheduleDeliveries").withIndex("by_schedule_occurrence", q => q.eq("serverId", row.serverId).eq("scheduleNo", row.scheduleNo)).take(SCHEDULES_BATCH))
    for (const delivery of rows) await settled(ctx, delivery)
    for (const delivery of rows) {
        await releaseSchedulePublication(ctx, delivery)
        await ctx.db.delete(delivery._id)
        await scheduleCount(ctx, row.serverId, "deliveries", -1)
    }
    const remaining = await ctx.db.query("scheduleDeliveries").withIndex("by_schedule_occurrence", q => q.eq("serverId", row.serverId).eq("scheduleNo", row.scheduleNo)).first()
    const post = await ctx.db.query("publishingPosts").withIndex("by_schedule", q => q.eq("serverId", row.serverId).eq("consumer.scheduleNo", row.scheduleNo)).first()
    const complete = selective || !remaining && !post
    if (!selective && complete) { await ctx.db.delete(row._id); await scheduleCount(ctx, row.serverId, "definitions", -1) }
    else await ctx.db.patch(row._id, { revision: advanceSchedule(row.revision), updatedAt: Date.now(), ...(!selective ? { enabled: false, cancelled: true } : {}) })
    return { duplicate: false as const, type: "forgotten" as const, scheduleNo: row.scheduleNo, complete, removed: rows.length }
}
export const manage = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<SchedulesManageResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "context", "operation"], ["serverId", "messageId", "createdAt", "context", "operation"])
    const now = Date.now(), identity = source({ serverId: input.serverId, messageId: input.messageId, createdAt: input.createdAt }, now), context = scheduleContext(input.context), op = object(input.operation)
    const critical = op.type === "disable" || op.type === "cancel" || op.type === "reconcile" || op.type === "forget" || op.type === "settings" && op.enabled === false
    await scheduleAdmin(ctx, identity.serverId, context, critical)
    if (!await scheduleReceipt(ctx, identity, context.actor.userId, op)) return { duplicate: true }
    const result = await applySchedulesManagement(ctx, { serverId: identity.serverId, actorId: context.actor.userId }, context, op, now)
    return result
} })
export const query = internalQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<SchedulesQueryResult> => {
    const input = shape(request, ["serverId", "context", "operation"], ["serverId", "context", "operation"]), serverId = requireId(input.serverId)
    requireServer(serverId)
    const context = scheduleContext(input.context), op = object(input.operation)
    await scheduleAdmin(ctx, serverId, context, true)
    const settings = await scheduleSettings(ctx, serverId)
    if (op.type === "settings" || op.type === "status") {
        shape(op, ["type"], ["type"])
        if (op.type === "settings") return { type: "settings", settings: publicSettings(settings) }
        const publisher = await publisherSettings(ctx, serverId)
        return { type: "status", settings: publicSettings(settings), definitions: settings?.definitions ?? 0, deliveries: settings?.deliveries ?? 0, receipts: settings?.receipts ?? 0, publishing: { enabled: publisher?.enabled ?? true }, limits: { definitions: 50, deliveries: 200, receipts: 1000 } }
    }
    if (op.type === "show") { shape(op, ["type", "scheduleNo"], ["type", "scheduleNo"]); return { type: "schedule", schedule: publicSchedule(await scheduleRow(ctx, serverId, op.scheduleNo)) } }
    if (op.type === "list") {
        shape(op, ["type", "beforeScheduleNo"], ["type"])
        const before = op.beforeScheduleNo === undefined ? Number.MAX_SAFE_INTEGER : integer(op.beforeScheduleNo, 1, Number.MAX_SAFE_INTEGER)
        const rows = await ctx.db.query("schedules").withIndex("by_number", q => q.eq("serverId", serverId).lt("scheduleNo", before)).order("desc").take(SCHEDULES_BATCH)
        const last = rows.at(-1), more = last ? await ctx.db.query("schedules").withIndex("by_number", q => q.eq("serverId", serverId).lt("scheduleNo", last.scheduleNo)).first() : null
        return { type: "schedules", schedules: rows.map(publicSchedule), ...(more ? { nextBeforeScheduleNo: last!.scheduleNo } : {}) }
    }
    if (op.type !== "deliveries") fail(400, "Invalid schedule query")
    shape(op, ["type", "scheduleNo", "afterOccurrenceNo"], ["type", "scheduleNo"])
    const row = await scheduleRow(ctx, serverId, op.scheduleNo), after = op.afterOccurrenceNo === undefined ? 0 : integer(op.afterOccurrenceNo, 1, Number.MAX_SAFE_INTEGER)
    const rows = await ctx.db.query("scheduleDeliveries").withIndex("by_schedule_occurrence", q => q.eq("serverId", serverId).eq("scheduleNo", row.scheduleNo).gt("occurrenceNo", after)).take(SCHEDULES_BATCH)
    const last = rows.at(-1), more = last ? await ctx.db.query("scheduleDeliveries").withIndex("by_schedule_occurrence", q => q.eq("serverId", serverId).eq("scheduleNo", row.scheduleNo).gt("occurrenceNo", last.occurrenceNo)).first() : null
    const deliveries = rows.map(publicScheduleDelivery)
    return { type: "deliveries", deliveries, ...(more ? { nextAfterOccurrenceNo: last!.occurrenceNo } : {}) }
} })

export async function applySchedulesManagement(ctx: MutationCtx, identity: { serverId: string, actorId: string }, context: ReturnType<typeof scheduleContext> | undefined, op: Record<string, unknown>, now: number): Promise<SchedulesManageResult> {
    const current = await scheduleState(ctx, identity.serverId)
    if (op.type === "settings") {
        shape(op, ["type", "expectedRevision", "enabled"], ["type", "expectedRevision", "enabled"])
        if (integer(op.expectedRevision, 1, Number.MAX_SAFE_INTEGER) !== current.revision) fail(409, "Schedule settings changed")
        const enabled = bool(op.enabled)
        await ctx.db.patch(current._id, { enabled, revision: advanceSchedule(current.revision), ...(enabled && !current.enabled ? { activatedAt: now } : {}) })
        return { duplicate: false, type: "settings", settings: publicSettings((await ctx.db.get(current._id))!) }
    }
    if (op.type === "create") {
        if (!context) fail(403, "Native schedule owner required")
        shape(op, ["type", "name", "source", "channelId", "calendar"], ["type", "name", "source", "channelId", "calendar"])
        const name = publishingName(op.name), channelId = requireId(op.channelId), calendar = validateScheduleCalendar(op.calendar, now), snapshot = await scheduleSnapshot(ctx, identity.serverId, op.source)
        if (context.channelId !== channelId || !context.actorAuthorized || !context.botAuthorized) fail(403, "Schedule destination permission required")
        if (await ctx.db.query("schedules").withIndex("by_name", q => q.eq("serverId", identity.serverId).eq("name", name)).unique()) fail(409, "Schedule name already exists")
        await scheduleCount(ctx, identity.serverId, "definitions", 1)
        const scheduleNo = current.nextScheduleNo
        await ctx.db.patch(current._id, { nextScheduleNo: advanceSchedule(scheduleNo) })
        const id = await ctx.db.insert("schedules", { serverId: identity.serverId, scheduleNo, name, revision: 1, planRevision: 1, createdBy: identity.actorId, channelId, calendar, source: snapshot.source, content: snapshot.content, canonicalContent: snapshot.canonicalContent, enabled: false, cancelled: false, activatedAt: 0, createdAt: now, updatedAt: now })
        const row = (await ctx.db.get(id))!
        await addSchedulePlan(ctx, row)
        return { duplicate: false, type: "schedule", schedule: publicSchedule(row) }
    }
    const fields: Record<string, string[]> = { content: ["source"], calendar: ["calendar"], destination: ["channelId"], enable: [], disable: [], cancel: [], reconcile: ["deliveryId", "attemptId", "expectedGeneration", "observation"], forget: ["confirm", "occurrenceNos"] }
    if (typeof op.type !== "string" || !Object.hasOwn(fields, op.type)) fail(400, "Invalid schedule operation")
    const allowed = ["type", "scheduleNo", "expectedRevision", ...fields[op.type]!], required = allowed.filter(key => key !== "occurrenceNos")
    shape(op, allowed, required)
    const row = await scheduleRow(ctx, identity.serverId, op.scheduleNo, op.expectedRevision)
    if (op.type === "forget") {
        if (op.confirm !== "forget") fail(400, "Explicit forget confirmation required")
        let occurrenceNos: number[] | undefined
        if (op.occurrenceNos !== undefined) {
            if (!Array.isArray(op.occurrenceNos) || !op.occurrenceNos.length || op.occurrenceNos.length > SCHEDULES_BATCH) fail(400, "At most twenty selected occurrences required")
            occurrenceNos = op.occurrenceNos.map(value => integer(value, 1, Number.MAX_SAFE_INTEGER))
            if (new Set(occurrenceNos).size !== occurrenceNos.length) fail(400, "Duplicate schedule occurrence")
        }
        return forgetSchedule(ctx, row, occurrenceNos)
    }
    if (op.type === "reconcile") {
        const id = ctx.db.normalizeId("scheduleDeliveries", token(op.deliveryId)), delivery = id ? await ctx.db.get(id) : null
        if (!delivery || delivery.serverId !== row.serverId || delivery.scheduleNo !== row.scheduleNo || delivery.attemptId !== token(op.attemptId)) fail(409, "Schedule occurrence changed")
        const attempt = await ctx.db.get(delivery.attemptId), post = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", row.serverId).eq("postNo", delivery.postNo!)).unique()
        if (!attempt || attempt.generation !== integer(op.expectedGeneration, 1, Number.MAX_SAFE_INTEGER) || !post || post.attemptId !== attempt._id || attempt.consumer?.type !== "schedule" || attempt.consumer.deliveryId !== delivery._id) fail(409, "Schedule publication changed")
        const result = await reconcilePublishing(ctx, post, attempt, op.observation)
        await ctx.db.patch(row._id, { revision: advanceSchedule(row.revision), updatedAt: now })
        return { duplicate: false, type: "reconciled", ...result }
    }
    if (op.type === "cancel") {
        await closeFuture(ctx, row, now, true)
        await ctx.db.patch(row._id, { cancelled: true, enabled: false, revision: advanceSchedule(row.revision), updatedAt: now })
    } else if (op.type === "enable" || op.type === "disable") {
        if (op.type === "enable" && row.cancelled) fail(409, "Cancelled schedule cannot be enabled")
        const enabled = op.type === "enable"
        await ctx.db.patch(row._id, { enabled, revision: advanceSchedule(row.revision), updatedAt: now, ...(enabled && !row.enabled ? { activatedAt: now } : {}) })
    } else {
        if (row.cancelled) fail(409, "Cancelled schedule is immutable")
        let patch: Partial<Doc<"schedules">> = {}
        if (op.type === "content") patch = await scheduleSnapshot(ctx, row.serverId, op.source)
        else if (op.type === "calendar") patch = { calendar: validateScheduleCalendar(op.calendar, now) }
        else if (op.type === "destination") {
            if (!context) fail(403, "Native schedule owner required")
            const channelId = requireId(op.channelId)
            if (context.channelId !== channelId || !context.actorAuthorized || !context.botAuthorized) fail(403, "Schedule destination permission required")
            patch = { channelId }
        }
        await closeFuture(ctx, row, now)
        await ctx.db.patch(row._id, { ...patch, revision: advanceSchedule(row.revision), planRevision: advanceSchedule(row.planRevision), updatedAt: now })
        await addSchedulePlan(ctx, (await ctx.db.get(row._id))!, true, now)
    }
    return { duplicate: false, type: "schedule", schedule: publicSchedule((await ctx.db.get(row._id))!) }
}
