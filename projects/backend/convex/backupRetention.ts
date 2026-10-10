import type { MutationCtx } from "./_generated/server.js"
import { BACKUP_SETTLE_MS } from "./backupDomain.ts"
import { backupPlanUnresolved, backupSetRetention } from "./backupStore.ts"
import type { Doc, Id } from "./_generated/dataModel.js"

/** An item whose dispatch window and settle time have passed: a reservation fails, and a claim is not confirmed. No origin is left open */
export async function backupAgeItem(ctx: MutationCtx, item: Doc<"backupItems">, now: number) {
    if (item.state === "reserved") {
        await ctx.db.patch(item._id, {
            state: "failed",
            historicalOutcome: "failed",
            noDispatch: true,
            finishedAt: now,
            reason: "The restore ran out of time before this started",
        })
        if (item.originId) {
            const origin = await ctx.db.get(item.originId)
            if (origin?.state === "reserved" && origin.planId === item.planId && origin.itemNo === item.itemNo)
                await ctx.db.patch(origin._id, { state: "failed", noDispatch: true, mappedId: null })
        }
    } else {
        const creates = item.disposition === "create"
        await ctx.db.patch(item._id, {
            state: "uncertain",
            ...(creates ? { historicalOutcome: "uncertain" as const } : {}),
            finishedAt: now,
            reason: `NeonFlux could not confirm whether this was ${creates ? "created" : "applied"}`,
        })
        if (item.originId) {
            const origin = await ctx.db.get(item.originId)
            if (origin?.state === "claimed" && origin.planId === item.planId && origin.itemNo === item.itemNo)
                await ctx.db.patch(origin._id, { state: "uncertain" })
        }
    }
}
export async function cleanupBackups(ctx: MutationCtx, now: number) {
    let aged = 0,
        removed = 0,
        more = false
    const changedPlans = new Set<Id<"backupPlans">>()
    for (const state of ["reserved", "claimed"] as const) {
        const rows = await ctx.db
            .query("backupItems")
            .withIndex("by_deadline", (q) => q.eq("state", state).lt("dispatchExpiresAt", now - BACKUP_SETTLE_MS))
            .take(20)
        more ||= rows.length === 20
        for (const item of rows) {
            await backupAgeItem(ctx, item, now)
            changedPlans.add(item.planId)
            aged++
        }
    }
    for (const id of changedPlans) {
        const plan = await ctx.db.get(id)
        if (plan) await backupSetRetention(ctx, plan)
    }
    const plans = await ctx.db
        .query("backupPlans")
        .withIndex("by_cleanup", (q) => q.gte("cleanupAt", 0).lte("cleanupAt", now))
        .take(2)
    more ||= plans.length === 2
    for (const plan of plans) {
        if (await backupPlanUnresolved(ctx, plan._id)) {
            await ctx.db.patch(plan._id, { cleanupAt: undefined })
            continue
        }
        const items = await ctx.db
            .query("backupItems")
            .withIndex("by_plan", (q) => q.eq("planId", plan._id))
            .take(21)
        // Bound physical erasure to twenty rows per pass, preserving origin identity maps
        for (const item of items.slice(0, 20)) {
            await ctx.db.delete(item._id)
            removed++
        }
        if (items.length > 20) more = true
        else {
            // The changes of a plan whose items are gone go with it, twenty rows a pass as well
            const changes = await ctx.db
                .query("backupChanges")
                .withIndex("by_plan", (q) => q.eq("planId", plan._id))
                .take(21)
            for (const row of changes.slice(0, 20)) {
                await ctx.db.delete(row._id)
                removed++
            }
            if (changes.length > 20) more = true
            else {
                await ctx.db.delete(plan._id)
                removed++
            }
        }
    }
    return { aged, removed, more }
}
