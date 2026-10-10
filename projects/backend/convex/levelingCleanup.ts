import { internalMutation, type MutationCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import { LEVELING_BATCH, LEVELING_WINDOW } from "./levelingDomain.ts"
import { advanceLevelingSweep, rankLevelingBackfill } from "./levelingStore.ts"
import { retentionPass } from "./retentionStore.ts"

export async function cleanupLeveling(ctx: MutationCtx, now: number) {
    const awards = await ctx.db.query("levelingAwardReceipts").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(LEVELING_BATCH)
    for (const row of awards) await ctx.db.delete(row._id)
    const management = await ctx.db.query("levelingManagementReceipts").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(LEVELING_BATCH)
    for (const row of management) await ctx.db.delete(row._id)
    const audits = await ctx.db.query("levelingAudits").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(LEVELING_BATCH)
    for (const row of audits) await ctx.db.delete(row._id)
    const digests = await ctx.db.query("levelingProfiles").withIndex("by_digest_expiry", q => q.gt("digestExpiresAt", 0).lte("digestExpiresAt", now)).take(LEVELING_BATCH)
    for (const row of digests) {
        const retained = row.digests.filter(x => x.creditedAt > now - LEVELING_WINDOW)
        await ctx.db.patch(row._id, { digests: retained, digestExpiresAt: retained[0] ? retained[0].creditedAt + LEVELING_WINDOW : undefined })
    }
    // Only servers with a pending sweep are read, so sweeps of every server advance however many servers exist
    const sweeps = await ctx.db.query("levelingSettings").withIndex("by_sweep", q => q.eq("sweepPending", true)).take(LEVELING_BATCH)
    for (const state of sweeps) await advanceLevelingSweep(ctx, state.serverId)
    // Servers from before rank counts are counted 256 profiles per pass
    const ranking = await rankLevelingBackfill(ctx)
    // A sweep advances 20 profiles per pass and stays pending until its last page, so any pending sweep asks for another pass
    return { more: [awards.length, management.length, audits.length, digests.length].some(count => count === LEVELING_BATCH) || sweeps.length > 0 || ranking }
}

// One pass that continues itself while a batch is full or a sweep is pending. The cron runs it through the retention chain in retention.ts
export const cleanup = internalMutation({ args: {}, handler: async ctx => {
    if ((await retentionPass(ctx, cleanupLeveling)).more) await ctx.scheduler.runAfter(0, internal.levelingCleanup.cleanup, {})
} })
