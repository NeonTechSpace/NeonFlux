import {
    LOCKDOWN_PROBLEM_LIMIT,
    type LockdownChannelState,
    type LockdownCounts,
    type LockdownSettings,
    type LockdownStatus,
    type LockdownView,
} from "@neonflux/contracts/lockdown"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { admitMetadata } from "./metadataLogsStore.ts"
import { metadataEvent } from "./metadataLogsDomain.ts"
import type { MetadataLogsEvent } from "@neonflux/contracts/metadata-logs"

type Read = QueryCtx | MutationCtx
export const readLockdownSettings = (ctx: Read, serverId: string) =>
    ctx.db
        .query("lockdownSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
export const publicLockdownSettings = (row: Doc<"lockdownSettings"> | null): LockdownSettings => ({
    exemptChannelIds: row?.exemptChannelIds ?? [],
})
export const readLockdown = (ctx: Read, serverId: string) =>
    ctx.db
        .query("lockdowns")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
export const lockdownChannelsIn = (ctx: Read, serverId: string, state: LockdownChannelState) =>
    ctx.db.query("lockdownChannels").withIndex("by_server_state", (q) => q.eq("serverId", serverId).eq("state", state))
export const readLockdownChannel = (ctx: Read, serverId: string, channelId: string) =>
    ctx.db
        .query("lockdownChannels")
        .withIndex("by_server_channel", (q) => q.eq("serverId", serverId).eq("channelId", channelId))
        .unique()
/** Whether a lockdown holds a channel now, so an unrelated lock of it cannot outlive or undo the lockdown's bits */
export async function lockdownHolds(ctx: Read, serverId: string, channelId: string) {
    const row = await readLockdownChannel(ctx, serverId, channelId)
    return (
        !!row &&
        row.phase === "lock" &&
        (row.state === "queued" || row.state === "writing" || row.state === "locked" || row.state === "uncertain")
    )
}
export async function publicLockdown(ctx: Read, row: Doc<"lockdowns"> | null): Promise<LockdownView | null> {
    if (!row) return null
    const problems = [
        ...(await lockdownChannelsIn(ctx, row.serverId, "uncertain").take(LOCKDOWN_PROBLEM_LIMIT)),
        ...(await lockdownChannelsIn(ctx, row.serverId, "failed").take(LOCKDOWN_PROBLEM_LIMIT)),
    ]
    return {
        state: row.state,
        origin: row.origin,
        reason: row.reason,
        ...(row.startedBy ? { startedBy: row.startedBy } : {}),
        startedAt: row.startedAt,
        ...(row.endedBy ? { endedBy: row.endedBy } : {}),
        ...(row.endReason !== undefined ? { endReason: row.endReason } : {}),
        ...(row.endedAt !== undefined ? { endedAt: row.endedAt } : {}),
        counts: row.counts,
        problems: problems.map((problem) => ({
            channelId: problem.channelId,
            state: problem.state as "uncertain" | "failed",
            phase: problem.phase,
            bits: problem.bits,
        })),
    }
}
export const lockdownStatus = async (ctx: Read, serverId: string): Promise<LockdownStatus> => ({
    settings: publicLockdownSettings(await readLockdownSettings(ctx, serverId)),
    lockdown: await publicLockdown(ctx, await readLockdown(ctx, serverId)),
})
/** Moves one channel between states in a count kept on the lockdown, so status reads one row however many channels it holds */
export const movedCounts = (counts: LockdownCounts, from: LockdownChannelState, to: LockdownChannelState) =>
    from === to ? counts : { ...counts, [from]: counts[from] - 1, [to]: counts[to] + 1 }

/**
 * Admits a security record of a lockdown or an anti-nuke incident. Its source is derived from what it records, so a repeated request
 * admits it once
 */
export async function admitSecurityRecord(
    ctx: MutationCtx,
    serverId: string,
    key: string,
    fields: Pick<MetadataLogsEvent, "type" | "resourceIds" | "changedFields"> & {
        readonly actorId?: string | undefined
    },
) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${serverId}\n${key}`))
    const sessionId = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("")
    const { actorId, ...record } = fields
    const event: MetadataLogsEvent = {
        category: "security",
        source: { kind: "observation", sessionId, sequence: 1 },
        observedAt: Date.now(),
        actor: actorId ? { kind: "configuration", userId: actorId } : { kind: "unknown" },
        count: 1,
        outcome: "observed",
        ...record,
    }
    return (await admitMetadata(ctx, serverId, metadataEvent(event, true))).admitted
}
