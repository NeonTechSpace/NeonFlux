import { internalMutation } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import { LEVELING_BATCH, LEVELING_WINDOW } from "./levelingDomain.ts"
import { advanceLevelingSweep } from "./levelingStore.ts"

export const cleanup = internalMutation({ args: {}, handler: async ctx => {
    const now = Date.now()
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
    const sweeps = await ctx.db.query("levelingSettings").take(LEVELING_BATCH)
    for (const state of sweeps) if (state.sweepPending) await advanceLevelingSweep(ctx, state.serverId)
    if ([awards.length, management.length, audits.length, digests.length].some(count => count === LEVELING_BATCH)) await ctx.scheduler.runAfter(0, internal.levelingCleanup.cleanup, {})
} })
