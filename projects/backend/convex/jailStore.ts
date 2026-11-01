import {
    defaultJailSettings,
    JAIL_RECORD_LIMIT,
    type JailEntry,
    type JailSettings,
    type JailView,
} from "@neonflux/contracts/jail"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"

type Read = QueryCtx | MutationCtx
export const readJailSettings = (ctx: Read, serverId: string) =>
    ctx.db
        .query("jailSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
export const publicJailSettings = (row: Doc<"jailSettings"> | null): JailSettings =>
    row ? { enabled: row.enabled, roleId: row.roleId ?? null, channelId: row.channelId ?? null } : defaultJailSettings()
export const readJailRecord = (ctx: Read, serverId: string, userId: string) =>
    ctx.db
        .query("jailRecords")
        .withIndex("by_server_user", (q) => q.eq("serverId", serverId).eq("userId", userId))
        .unique()
/**
 * Whether a member counts as jailed for the features that give roles. A record of an unjail in progress or unconfirmed still counts, since
 * the stored roles are not known to be back yet, and any role change waits for it
 */
export const jailHolds = async (ctx: Read, serverId: string, userId: string) =>
    (await readJailRecord(ctx, serverId, userId)) !== null
export const publicJailEntry = (row: Doc<"jailRecords">): JailEntry => ({
    userId: row.userId,
    state: row.state,
    caseNo: row.caseNo,
    ...(row.actorId ? { actorId: row.actorId } : {}),
    createdAt: row.createdAt,
    ...(row.releaseAt !== undefined ? { releaseAt: row.releaseAt } : {}),
    roleCount: row.roleIds.length,
})
/** A server's jailed members up to the limit, which is what a count of them can reach */
export const jailedRows = (ctx: Read, serverId: string, limit: number) =>
    ctx.db
        .query("jailRecords")
        .withIndex("by_server_user", (q) => q.eq("serverId", serverId))
        .take(limit)
export async function jailView(ctx: Read, serverId: string): Promise<JailView> {
    const row = await readJailSettings(ctx, serverId)
    return {
        settings: publicJailSettings(row),
        setup: row?.setup ?? null,
        count: (await jailedRows(ctx, serverId, JAIL_RECORD_LIMIT)).length,
    }
}
// How long a release that could not run waits before the worker tries again
const RELEASE_RETRY_MS = 600000
/** What a jail's or unjail's outcome does to its record. A case that only changed the length or reason of a jail has nothing to settle */
export async function settleJail(
    ctx: MutationCtx,
    row: Pick<Doc<"moderationCases">, "_id" | "serverId" | "caseNo" | "action" | "targetId" | "grant">,
    outcome: "succeeded" | "failed" | "uncertain",
    now: number,
) {
    if (!row.targetId || (row.action !== "jail" && row.action !== "unjail")) return
    // Member roles stay only on the record while the jail runs, not on its case until retention
    if (row.grant) {
        const { expectedRoleIds: _expected, restoreRoleIds: _restore, ...grant } = row.grant
        await ctx.db.patch(row._id, { grant })
    }
    const record = await readJailRecord(ctx, row.serverId, row.targetId)
    if (!record) return
    if (row.action === "jail") {
        if (record.caseNo !== row.caseNo || record.state !== "jailing") return
        if (outcome === "failed") await ctx.db.delete(record._id)
        else if (outcome === "uncertain") await ctx.db.patch(record._id, { state: "jail-uncertain" })
        else
            await ctx.db.patch(record._id, {
                state: "active",
                ...(record.releaseAt !== undefined ? { timed: true as const, nextCheckAt: record.releaseAt } : {}),
            })
        return
    }
    if (record.releaseCaseNo !== row.caseNo || record.state !== "releasing") return
    if (outcome === "succeeded") await ctx.db.delete(record._id)
    else if (outcome === "uncertain") await ctx.db.patch(record._id, { state: "release-uncertain" })
    else
        await ctx.db.patch(record._id, {
            state: "active",
            releaseCaseNo: undefined,
            ...(record.releaseAt !== undefined
                ? { timed: true as const, nextCheckAt: Math.max(record.releaseAt, now + RELEASE_RETRY_MS) }
                : {}),
        })
}
/**
 * A temporary role that ended during a jail leaves the stored roles, so unjail does not give back an expired role. Other roles stay as they
 * were, whatever else changes
 */
export async function dropJailedRole(ctx: MutationCtx, serverId: string, userId: string, roleId: string) {
    const record = await readJailRecord(ctx, serverId, userId)
    if (record?.roleIds.includes(roleId))
        await ctx.db.patch(record._id, { roleIds: record.roleIds.filter((id) => id !== roleId) })
}
