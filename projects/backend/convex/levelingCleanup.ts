import type { MutationCtx } from "./_generated/server.js"
import { LEVELING_BATCH, LEVELING_WINDOW } from "./levelingDomain.ts"
import { advanceLevelingSweep } from "./levelingStore.ts"

export async function cleanupLeveling(ctx: MutationCtx, now: number) {
    const awards = await ctx.db
        .query("levelingAwardReceipts")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(LEVELING_BATCH)
    for (const row of awards) await ctx.db.delete(row._id)
    const management = await ctx.db
        .query("levelingManagementReceipts")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(LEVELING_BATCH)
    for (const row of management) await ctx.db.delete(row._id)
    const audits = await ctx.db
        .query("levelingAudits")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(LEVELING_BATCH)
    for (const row of audits) await ctx.db.delete(row._id)
    const digests = await ctx.db
        .query("levelingProfiles")
        .withIndex("by_digest_expiry", (q) => q.gt("digestExpiresAt", 0).lte("digestExpiresAt", now))
        .take(LEVELING_BATCH)
    for (const row of digests) {
        const retained = row.digests.filter((x) => x.creditedAt > now - LEVELING_WINDOW)
        await ctx.db.patch(row._id, {
            digests: retained,
            digestExpiresAt: retained[0] ? retained[0].creditedAt + LEVELING_WINDOW : undefined,
        })
    }
    // Only servers with a pending sweep are read, so sweeps of every server advance however many servers exist
    const sweeps = await ctx.db
        .query("levelingSettings")
        .withIndex("by_sweep", (q) => q.eq("sweepPending", true))
        .take(LEVELING_BATCH)
    for (const state of sweeps) await advanceLevelingSweep(ctx, state.serverId)
    // A sweep advances 20 profiles per pass and stays pending until its last page, so any pending sweep asks for another pass
    return {
        more:
            [awards.length, management.length, audits.length, digests.length].some(
                (count) => count === LEVELING_BATCH,
            ) || sweeps.length > 0,
    }
}
