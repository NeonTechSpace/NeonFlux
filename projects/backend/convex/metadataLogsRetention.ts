import { internalMutation, type MutationCtx } from "./_generated/server.js"
import { metadataDelivery, metadataState, removeMetadataRecord } from "./metadataLogsStore.ts"
import { METADATA_SETTLE_MS } from "./metadataLogsDomain.ts"
import { settleMetadataReservation } from "./metadataLogsWork.ts"
import { retentionPass } from "./retentionStore.ts"

export async function cleanupMetadataLogs(ctx: MutationCtx, now: number) {
    const aged = await ctx.db.query("metadataLogRecords").withIndex("by_deadline", q => q.eq("delivery.state", "reserved").lte("delivery.grant.dispatchExpiresAt", now - METADATA_SETTLE_MS - 1)).take(20)
    for (const row of aged) await settleMetadataReservation(ctx, row)
    const expiredPending = await ctx.db.query("metadataLogRecords").withIndex("by_active_expiry", q => q.eq("actionable", true).lte("expiresAt", now)).take(20)
    for (const row of expiredPending) {
        if (row.delivery && row.delivery.claimedAt === undefined && row.delivery.state !== "reserved") await metadataDelivery(ctx, row, { ...row.delivery, state: "cancelled", noDispatch: true, finishedAt: now, nextCheckAt: now })
    }
    const rows = await ctx.db.query("metadataLogRecords").withIndex("by_cleanup", q => q.gt("cleanupAt", 0).lte("cleanupAt", now)).take(20)
    for (const row of rows) await removeMetadataRecord(ctx, row)
    const admissions = await ctx.db.query("metadataLogAdmissions").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(128)
    for (const row of admissions) {
        const state = await metadataState(ctx, row.serverId)
        await ctx.db.patch(state._id, { admissions: Math.max(0, state.admissions - 1) })
        await ctx.db.delete(row._id)
    }
    const receipts = await ctx.db.query("metadataLogReceipts").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(128)
    for (const row of receipts) {
        const state = await metadataState(ctx, row.serverId)
        await ctx.db.patch(state._id, { receipts: Math.max(0, state.receipts - 1) })
        await ctx.db.delete(row._id)
    }
    const more = aged.length === 20 || expiredPending.length === 20 || rows.length === 20 || admissions.length === 128 || receipts.length === 128
    return { removed: rows.length, admissions: admissions.length, receipts: receipts.length, aged: aged.length, more }
}

// One pass. The retention chain in retention.ts repeats passes while a batch is full
export const cleanup = internalMutation({ args: {}, handler: async ctx => {
    const { more: _more, ...result } = await retentionPass(ctx, cleanupMetadataLogs)
    return result
} })
