import { internalMutation } from "./_generated/server.js"
import { ageCleanupTarget, cleanupCount } from "./cleanupStore.ts"
import { CLEANUP_SETTLE_MS } from "./cleanupDomain.ts"

export const cleanup = internalMutation({ args: {}, handler: async ctx => {
    const now = Date.now()
    const expired = await ctx.db.query("cleanupTargets").withIndex("by_deadline", q => q.eq("state", "reserved").lt("grant.dispatchExpiresAt", now - CLEANUP_SETTLE_MS)).take(20)
    for (const row of expired) await ageCleanupTarget(ctx, row)
    const targets = await ctx.db.query("cleanupTargets").withIndex("by_expiry", q => q.gt("expiresAt", 0).lte("expiresAt", now)).take(20)
    for (const row of targets) {
        if (row.active || row.state === "uncertain" || row.state === "failed" && !row.noDispatch || row.reassessedAt !== undefined) continue
        await ctx.db.delete(row._id)
        await cleanupCount(ctx, row.serverId, "retainedTargets", -1)
    }
    const receipts = await ctx.db.query("cleanupReceipts").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(20)
    for (const row of receipts) { await ctx.db.delete(row._id); await cleanupCount(ctx, row.serverId, "receipts", -1) }
    const sweeps = await ctx.db.query("cleanupSweeps").withIndex("by_expiry", q => q.gt("expiresAt", 0).lte("expiresAt", now)).take(20)
    for (const row of sweeps) {
        const active = await ctx.db.query("cleanupTargets").withIndex("by_sweep_active", q => q.eq("serverId", row.serverId).eq("sweepNo", row.sweepNo).eq("active", true)).first()
        const unresolved = await ctx.db.query("cleanupTargets").withIndex("by_sweep_unresolved", q => q.eq("serverId", row.serverId).eq("sweepNo", row.sweepNo).eq("replayBlocked", true).eq("expiresAt", undefined)).first()
        if (active || unresolved) { await ctx.db.patch(row._id, { expiresAt: undefined }); continue }
        await ctx.db.delete(row._id)
        await cleanupCount(ctx, row.serverId, "retainedSweeps", -1)
    }
    return { aged: expired.length, targets: targets.length, receipts: receipts.length, sweeps: sweeps.length }
} })
