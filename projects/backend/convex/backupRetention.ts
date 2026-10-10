import { internalMutation, type MutationCtx } from "./_generated/server.js"
import { BACKUP_SETTLE_MS } from "./backupDomain.ts"
import { backupPlanUnresolved, backupSetRetention } from "./backupStore.ts"
import { retentionPass } from "./retentionStore.ts"
import type { Id } from "./_generated/dataModel.js"

export async function cleanupBackups(ctx: MutationCtx, now: number) {
    let aged = 0, removed = 0, more = false
    const changedPlans = new Set<Id<"backupPlans">>()
    for (const state of ["reserved", "claimed"] as const) {
        const rows = await ctx.db.query("backupItems").withIndex("by_deadline", q => q.eq("state", state).lt("dispatchExpiresAt", now - BACKUP_SETTLE_MS)).take(20)
        more ||= rows.length === 20
        for (const item of rows) {
            if (state === "reserved") {
                await ctx.db.patch(item._id, { state: "failed", historicalOutcome: "failed", noDispatch: true, finishedAt: now, reason: "Unclaimed reservation expired" })
                if (item.originId) { const origin = await ctx.db.get(item.originId); if (origin?.state === "reserved" && origin.planId === item.planId && origin.itemNo === item.itemNo) await ctx.db.patch(origin._id, { state: "failed", noDispatch: true }) }
            } else {
                await ctx.db.patch(item._id, { state: "uncertain", historicalOutcome: "uncertain", finishedAt: now, reason: "Claimed native outcome unavailable" })
                if (item.originId) { const origin = await ctx.db.get(item.originId); if (origin?.state === "claimed" && origin.planId === item.planId && origin.itemNo === item.itemNo) await ctx.db.patch(origin._id, { state: "uncertain" }) }
            }
            changedPlans.add(item.planId)
            aged++
        }
    }
    for (const id of changedPlans) { const plan = await ctx.db.get(id); if (plan) await backupSetRetention(ctx, plan) }
    const plans = await ctx.db.query("backupPlans").withIndex("by_cleanup", q => q.gte("cleanupAt", 0).lte("cleanupAt", now)).take(2)
    more ||= plans.length === 2
    for (const plan of plans) {
        if (await backupPlanUnresolved(ctx, plan._id)) { await ctx.db.patch(plan._id, { cleanupAt: undefined }); continue }
        const items = await ctx.db.query("backupItems").withIndex("by_plan", q => q.eq("planId", plan._id)).take(21)
        // Bound physical erasure to twenty rows per pass, preserving origin identity maps
        for (const item of items.slice(0, 20)) { await ctx.db.delete(item._id); removed++ }
        if (items.length <= 20) { await ctx.db.delete(plan._id); removed++ }
        else more = true
    }
    return { aged, removed, more }
}

// One pass. The retention chain in retention.ts repeats passes while a batch is full
export const cleanup = internalMutation({ args: {}, handler: async (ctx): Promise<{ aged: number, removed: number }> => {
    const { aged, removed } = await retentionPass(ctx, cleanupBackups)
    return { aged, removed }
} })
