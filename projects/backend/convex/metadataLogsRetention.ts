import { internalMutation } from "./_generated/server.js"
import { applyMetadataReleases, metadataDelivery, metadataRelease, removeMetadataRecord, type MetadataCounterRelease } from "./metadataLogsStore.ts"
import { METADATA_SETTLE_MS } from "./metadataLogsDomain.ts"
import { settleMetadataReservation } from "./metadataLogsWork.ts"

export const cleanup = internalMutation({ args: {}, handler: async ctx => {
    const now = Date.now()
    const aged = await ctx.db.query("metadataLogRecords").withIndex("by_deadline", q => q.eq("delivery.state", "reserved").lte("delivery.grant.dispatchExpiresAt", now - METADATA_SETTLE_MS - 1)).take(20)
    for (const row of aged) await settleMetadataReservation(ctx, row)
    const expiredPending = await ctx.db.query("metadataLogRecords").withIndex("by_active_expiry", q => q.eq("actionable", true).lte("expiresAt", now)).take(20)
    for (const row of expiredPending) {
        if (row.delivery && row.delivery.claimedAt === undefined && row.delivery.state !== "reserved") await metadataDelivery(ctx, row, { ...row.delivery, state: "cancelled", noDispatch: true, finishedAt: now, nextCheckAt: now })
    }
    // Removals sum their counter changes by server, so each settings row is patched once per pass
    const releases = new Map<string, MetadataCounterRelease>()
    const rows = await ctx.db.query("metadataLogRecords").withIndex("by_cleanup", q => q.gt("cleanupAt", 0).lte("cleanupAt", now)).take(20)
    for (const row of rows) await removeMetadataRecord(ctx, row, releases)
    const admissions = await ctx.db.query("metadataLogAdmissions").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(128)
    for (const row of admissions) { metadataRelease(releases, row.serverId).admissions++; await ctx.db.delete(row._id) }
    const receipts = await ctx.db.query("metadataLogReceipts").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(128)
    for (const row of receipts) { metadataRelease(releases, row.serverId).receipts++; await ctx.db.delete(row._id) }
    await applyMetadataReleases(ctx, releases)
    return { removed: rows.length, admissions: admissions.length, receipts: receipts.length, aged: aged.length }
} })
