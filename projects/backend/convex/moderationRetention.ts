import { v } from "convex/values"
import { internalMutation } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import { BATCH, CORRECTION_BATCH, retentionUntil } from "./moderationDomain.ts"
import { config, deleteCorrections, readSettings } from "./moderationStore.ts"

/**
 * Stamps a server's cases and closed appeals with the expiry its current case retention gives them, one page per run. Each page
 * reads the setting again, so a later change wins and a second chain only repeats the same writes
 */
export const restamp = internalMutation({
    args: { serverId: v.string(), table: v.union(v.literal("cases"), v.literal("appeals")), after: v.number() },
    handler: async (ctx, { serverId, table, after }) => {
        const settings = config(await readSettings(ctx, serverId))
        // Open appeals have no expiry until they close
        const stamps =
            table === "cases"
                ? (
                      await ctx.db
                          .query("moderationCases")
                          .withIndex("by_server_case", (q) => q.eq("serverId", serverId).gt("caseNo", after))
                          .take(BATCH)
                  ).map((row) => ({ row, no: row.caseNo, from: row.createdAt }))
                : (
                      await ctx.db
                          .query("moderationAppeals")
                          .withIndex("by_server_appeal", (q) => q.eq("serverId", serverId).gt("appealNo", after))
                          .take(BATCH)
                  ).map((row) => ({ row, no: row.appealNo, from: row.decidedAt }))
        for (const { row, from } of stamps) {
            if (from === undefined) continue
            const expiresAt = retentionUntil(settings, from)
            if (row.expiresAt !== expiresAt) await ctx.db.patch(row._id, { expiresAt })
        }
        if (stamps.length === BATCH)
            await ctx.scheduler.runAfter(0, internal.moderationRetention.restamp, {
                serverId,
                table,
                after: stamps.at(-1)!.no,
            })
        else if (table === "cases")
            await ctx.scheduler.runAfter(0, internal.moderationRetention.restamp, {
                serverId,
                table: "appeals",
                after: 0,
            })
    },
})

/** Deletes an erased case's corrections that its erasure left, one batch per run */
export const eraseCorrections = internalMutation({
    args: { caseId: v.id("moderationCases") },
    handler: async (ctx, { caseId }) => {
        if ((await deleteCorrections(ctx, caseId, CORRECTION_BATCH)).more)
            await ctx.scheduler.runAfter(0, internal.moderationRetention.eraseCorrections, { caseId })
    },
})
