import { internalMutation, type MutationCtx } from "./_generated/server.js"
import { SCHEDULES_BATCH, SCHEDULES_DAY } from "./schedulesDomain.ts"
import { closeScheduleDelivery, scheduleCount, scheduleRow } from "./schedulesStore.ts"
import { retentionPass } from "./retentionStore.ts"

export async function cleanupSchedules(ctx: MutationCtx, now: number) {
    let removed = 0
    const receipts = await ctx.db.query("scheduleReceipts").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(SCHEDULES_BATCH)
    for (const row of receipts) { await ctx.db.delete(row._id); await scheduleCount(ctx, row.serverId, "receipts", -1); removed++ }
    // Two days late is past any local due day. Visits close the rest sooner
    const late = await ctx.db.query("scheduleDeliveries").withIndex("by_global_due", q => q.eq("active", true).lte("dueAt", now - 2 * SCHEDULES_DAY))
        .take(SCHEDULES_BATCH)
    for (const row of late) await closeScheduleDelivery(ctx, row, "skipped", "late-window", now)
    const expired = await ctx.db.query("scheduleDeliveries").withIndex("by_history", q => q.gt("historyExpiresAt", 0).lte("historyExpiresAt", now)).take(SCHEDULES_BATCH)
    for (const row of expired) {
        const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
        if (row.attemptId || attempt) {
            // Minimal ownership anchors survive while a protected post or attempt exists
            await ctx.db.patch(row._id, { content: { content: "" }, canonicalContent: { content: "" }, historyExpiresAt: now + SCHEDULES_DAY })
            continue
        }
        await ctx.db.delete(row._id); await scheduleCount(ctx, row.serverId, "deliveries", -1); removed++
        const remaining = await ctx.db.query("scheduleDeliveries").withIndex("by_schedule_occurrence", q => q.eq("serverId", row.serverId).eq("scheduleNo", row.scheduleNo)).first()
        if (!remaining) {
            const definition = await scheduleRow(ctx, row.serverId, row.scheduleNo)
            if (definition.calendar.dates.every(date => date.dueAt + 180 * SCHEDULES_DAY <= now)) { await ctx.db.delete(definition._id); await scheduleCount(ctx, row.serverId, "definitions", -1); removed++ }
        }
    }
    return { removed, more: [receipts, late, expired].some(page => page.length === SCHEDULES_BATCH) }
}

// One pass. The retention chain in retention.ts repeats passes while a batch is full
export const cleanup = internalMutation({ args: {}, handler: async ctx => {
    const { removed } = await retentionPass(ctx, cleanupSchedules)
    return { removed }
} })
