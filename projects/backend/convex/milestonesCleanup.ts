import { internalMutation } from "./_generated/server.js"
import { age, releaseMilestonePublication } from "./publishing.ts"
import { MILESTONES_BATCH, MILESTONES_DAY } from "./milestonesDomain.ts"
import { closeMilestoneDelivery, milestoneCount } from "./milestonesStore.ts"

export const cleanup = internalMutation({ args: {}, handler: async ctx => {
    const now = Date.now()
    let removed = 0
    const receipts = await ctx.db.query("milestoneReceipts").withIndex("by_receipt_expiry", q => q.gt("receiptExpiresAt", 0).lte("receiptExpiresAt", now)).take(MILESTONES_BATCH)
    for (const row of receipts) { await ctx.db.patch(row._id, { receiptExpiresAt: undefined }); await milestoneCount(ctx, row.serverId, row.category === "staff" ? "staffReceipts" : "memberReceipts", -1) }
    const fences = await ctx.db.query("milestoneReceipts").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(MILESTONES_BATCH)
    for (const row of fences) { if (row.receiptExpiresAt !== undefined) await milestoneCount(ctx, row.serverId, row.category === "staff" ? "staffReceipts" : "memberReceipts", -1); await ctx.db.delete(row._id); removed++ }
    for (const row of await ctx.db.query("milestoneConsumed").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(MILESTONES_BATCH)) { await ctx.db.delete(row._id); removed++ }
    for (const row of await ctx.db.query("milestoneMembers").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(MILESTONES_BATCH)) {
        const active = await ctx.db.query("milestoneEnrollments").withIndex("by_user_kind", q => q.eq("serverId", row.serverId).eq("userId", row.userId)).first()
        if (active) await ctx.db.patch(row._id, { expiresAt: now + 400 * MILESTONES_DAY })
        else { await ctx.db.delete(row._id); removed++ }
    }
    // Two days late is past any local due day. Visits close the rest sooner
    const late = await ctx.db.query("milestoneDeliveries").withIndex("by_global_due", q => q.eq("active", true).lte("dueAt", now - 2 * MILESTONES_DAY))
        .take(MILESTONES_BATCH)
    for (const row of late) await closeMilestoneDelivery(ctx, row, "skipped", "late-window")
    const expired = await ctx.db.query("milestoneDeliveries").withIndex("by_history", q => q.gt("historyExpiresAt", 0).lte("historyExpiresAt", now)).take(MILESTONES_BATCH)
    for (const row of expired) {
        let attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
        if (attempt?.outcome === "pending") { await age(ctx, attempt, now); attempt = await ctx.db.get(attempt._id) }
        if (attempt && (attempt.outcome === "pending" || attempt.unresolved)) { await ctx.db.patch(row._id, { historyExpiresAt: now + MILESTONES_DAY }); continue }
        await releaseMilestonePublication(ctx, row)
        await ctx.db.delete(row._id); await milestoneCount(ctx, row.serverId, "deliveries", -1); removed++
    }
    return { removed }
} })
