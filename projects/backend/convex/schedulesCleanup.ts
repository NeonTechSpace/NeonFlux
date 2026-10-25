import type { MutationCtx } from "./_generated/server.js"
import { age, releaseConsumerPublication } from "./publishing.ts"
import { panelPost } from "./rolesStore.ts"
import { SCHEDULES_BATCH, SCHEDULES_DAY } from "./schedulesDomain.ts"
import { closeScheduleDelivery, extendSchedule, scheduleCount, scheduleRow } from "./schedulesStore.ts"

export async function cleanupSchedules(ctx: MutationCtx, now: number) {
    let removed = 0
    const receipts = await ctx.db
        .query("scheduleReceipts")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(SCHEDULES_BATCH)
    for (const row of receipts) {
        await ctx.db.delete(row._id)
        await scheduleCount(ctx, row.serverId, "receipts", -1)
        removed++
    }
    // Two days late is past any local due day. Visits close the rest sooner
    const late = await ctx.db
        .query("scheduleDeliveries")
        .withIndex("by_global_due", (q) => q.eq("active", true).lte("dueAt", now - 2 * SCHEDULES_DAY))
        .take(SCHEDULES_BATCH)
    for (const row of late) await closeScheduleDelivery(ctx, row, "skipped", "late-window", now)
    // Repeats get their next dates as earlier ones come due
    const extending = await ctx.db
        .query("schedules")
        .withIndex("by_extend", (q) => q.gt("extendAt", 0).lte("extendAt", now))
        .take(SCHEDULES_BATCH)
    for (const row of extending)
        if (row.cancelled) await ctx.db.patch(row._id, { extendAt: undefined })
        else await extendSchedule(ctx, row, now)
    const expired = await ctx.db
        .query("scheduleDeliveries")
        .withIndex("by_history", (q) => q.gt("historyExpiresAt", 0).lte("historyExpiresAt", now))
        .take(SCHEDULES_BATCH)
    for (const row of expired) {
        let attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
        if (attempt?.outcome === "pending") {
            await age(ctx, attempt, now)
            attempt = await ctx.db.get(attempt._id)
        }
        // A pending, unresolved or panel-bound post keeps a minimal ownership anchor. Settled posts are released
        if (
            attempt &&
            (attempt.outcome === "pending" ||
                attempt.unresolved ||
                (await panelPost(ctx, row.serverId, attempt.postNo)))
        ) {
            await ctx.db.patch(row._id, {
                content: { content: "" },
                canonicalContent: { content: "" },
                historyExpiresAt: now + SCHEDULES_DAY,
            })
            continue
        }
        await releaseConsumerPublication(ctx, row, "schedule")
        await ctx.db.delete(row._id)
        removed++
        const remaining = await ctx.db
            .query("scheduleDeliveries")
            .withIndex("by_schedule_occurrence", (q) => q.eq("serverId", row.serverId).eq("scheduleNo", row.scheduleNo))
            .first()
        if (!remaining) {
            const definition = await scheduleRow(ctx, row.serverId, row.scheduleNo)
            // A cancelled schedule, or one with no date left to add, gets no new deliveries, so its last expired one removes it
            if (definition.cancelled || definition.extendAt === undefined) {
                await ctx.db.delete(definition._id)
                if (!definition.released) await scheduleCount(ctx, row.serverId, "definitions", -1)
                removed++
            }
        }
    }
    return {
        removed,
        more: [receipts, late, extending, expired].some((page) => page.length === SCHEDULES_BATCH),
    }
}
