import type { MutationCtx } from "./_generated/server.js"
import { ageCleanupTarget, cleanupCount } from "./cleanupStore.ts"
import { CLEANUP_DAY, CLEANUP_SETTLE_MS } from "./cleanupDomain.ts"

export async function cleanupCleanupMetadata(ctx: MutationCtx, now: number) {
    const expired = await ctx.db
        .query("cleanupTargets")
        .withIndex("by_deadline", (q) =>
            q.eq("state", "reserved").lt("grant.dispatchExpiresAt", now - CLEANUP_SETTLE_MS),
        )
        .take(20)
    for (const row of expired) await ageCleanupTarget(ctx, row)
    const targets = await ctx.db
        .query("cleanupTargets")
        .withIndex("by_expiry", (q) => q.gt("expiresAt", 0).lte("expiresAt", now))
        .take(20)
    for (const row of targets) {
        // An active target is checked again a day later, so kept rows never fill the head of the range and stop progress
        if (row.active) await ctx.db.patch(row._id, { expiresAt: now + CLEANUP_DAY })
        else await ctx.db.delete(row._id)
    }
    const receipts = await ctx.db
        .query("cleanupReceipts")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(20)
    for (const row of receipts) {
        await ctx.db.delete(row._id)
        await cleanupCount(ctx, row.serverId, "receipts", -1)
    }
    const sweeps = await ctx.db
        .query("cleanupSweeps")
        .withIndex("by_expiry", (q) => q.gt("expiresAt", 0).lte("expiresAt", now))
        .take(20)
    for (const row of sweeps) {
        const active = await ctx.db
            .query("cleanupTargets")
            .withIndex("by_sweep_active", (q) =>
                q.eq("serverId", row.serverId).eq("sweepNo", row.sweepNo).eq("active", true),
            )
            .first()
        if (active) {
            await ctx.db.patch(row._id, { expiresAt: undefined })
            continue
        }
        await ctx.db.delete(row._id)
    }
    const more = [expired, targets, receipts, sweeps].some((page) => page.length === 20)
    return { aged: expired.length, targets: targets.length, receipts: receipts.length, sweeps: sweeps.length, more }
}
