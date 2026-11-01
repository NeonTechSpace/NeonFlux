import { v } from "convex/values"
import {
    LOCKDOWN_CHANNEL_LIMIT,
    LOCKDOWN_PROBLEM_LIMIT,
    LOCKDOWN_WORK_BATCH,
    LockdownAutoRequest,
    LockdownGetRequest,
    LockdownManageRequest,
    LockdownWorkRequest,
    type LockdownChannelState,
    type LockdownDashboardOperation,
    type LockdownOrigin,
    type LockdownPlan,
    type LockdownRefusal,
    type LockdownResult,
    type LockdownStatus,
    type LockdownWorkOutcome,
    type LockdownWorkResult,
    type LockdownWorkRow,
} from "@neonflux/contracts/lockdown"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx } from "./_generated/server.js"
import { changeConfiguration } from "./configurationChange.ts"
import { emptyLockdownCounts } from "./lockdownDomain.ts"
import {
    admitSecurityRecord,
    lockdownChannelsIn,
    lockdownStatus,
    movedCounts,
    publicLockdownSettings,
    readLockdown,
    readLockdownChannel,
    readLockdownSettings,
} from "./lockdownStore.ts"
import { actor, authorize } from "./moderationDomain.ts"
import { config as moderationConfig, readSettings as readModeration } from "./moderationStore.ts"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import { decode, fail, source } from "./validation.ts"

// A claimed write that never reported, such as after a restart, becomes uncertain after this long. A batch writes one after another
const LEASE_MS = 300000
// A write known not to have reached its change, such as one Fluxer answered with a 429, may go again, this long after its first try and twice
// as long each time. After this many tries it fails and waits for staff, so a Fluxer outage never loops
const RETRY_MS = 10000,
    WRITE_TRIES = 5

const anyChannelLeft = (row: Pick<Doc<"lockdowns">, "counts">) => row.counts.queued + row.counts.writing > 0

/** Admits the record of a finished lockdown */
async function closingFields(ctx: MutationCtx, row: Doc<"lockdowns">) {
    return {
        ended: true,
        admitted: await admitSecurityRecord(ctx, row.serverId, `lockdown:${row.startedAt}:end`, {
            type: "lockdown-change",
            actorId: row.endedBy,
            resourceIds: [],
            changedFields: ["lockdown-ended"],
        }),
    }
}
/** The next state once no channel is queued or being written */
async function settled(ctx: MutationCtx, row: Doc<"lockdowns">): Promise<{ ended?: boolean; admitted?: boolean }> {
    if (anyChannelLeft(row)) return {}
    if (row.state === "locking") {
        await ctx.db.patch(row._id, { state: "active" })
        return {}
    }
    if (row.state !== "restoring") return {}
    const endedAt = Date.now()
    await ctx.db.patch(row._id, { state: "ended", endedAt, notesDue: [...(row.notesDue ?? []), "ended"] })
    return closingFields(ctx, { ...row, state: "ended", endedAt })
}

/**
 * One way to start a lockdown, for staff and for anti-nuke. A lockdown already on queues its failed channels again, since that is an
 * explicit request. A new one replaces the rows of the last one, which status keeps showing until then. The last lockdown's failed or
 * uncertain channels still hold what it denied and only their rows know what to give back, so it must be lifted first
 */
async function startLockdown(
    ctx: MutationCtx,
    serverId: string,
    start: { origin: LockdownOrigin; actorId?: string; reason: string; plan: LockdownPlan },
) {
    const current = await readLockdown(ctx, serverId),
        now = Date.now()
    if (current?.state === "locking" || current?.state === "active") {
        const failed = await lockdownChannelsIn(ctx, serverId, "failed").take(LOCKDOWN_CHANNEL_LIMIT)
        if (!failed.length) return { refused: "already-on" as const }
        let counts = current.counts
        for (const row of failed) {
            await ctx.db.patch(row._id, { state: "queued", active: true, nextCheckAt: now, tries: undefined })
            counts = movedCounts(counts, "failed", "queued")
        }
        await ctx.db.patch(current._id, { counts, state: "locking" })
        return { requeued: failed.length }
    }
    if (current?.state === "restoring") return { refused: "restoring" as const }
    if (current && current.counts.failed + current.counts.uncertain > 0) return { refused: "unrestored" as const }
    const exempt = new Set(publicLockdownSettings(await readLockdownSettings(ctx, serverId)).exemptChannelIds)
    for (const state of ["locked", "skipped", "restored", "failed", "uncertain", "queued", "writing"] as const)
        for (const row of await lockdownChannelsIn(ctx, serverId, state).take(LOCKDOWN_CHANNEL_LIMIT))
            await ctx.db.delete(row._id)
    const counts: Record<LockdownChannelState, number> = { ...emptyLockdownCounts() }
    for (const row of start.plan) {
        const skip = exempt.has(row.channelId) ? ("exempt" as const) : row.skip
        const state: LockdownChannelState = skip ? "skipped" : "queued"
        counts[state]++
        await ctx.db.insert("lockdownChannels", {
            serverId,
            channelId: row.channelId,
            phase: "lock",
            state,
            ...(skip ? { skip } : { active: true as const }),
            everyone: row.everyone,
            bits: row.bits,
            botBefore: row.botBefore,
            ...(row.botSet ? { botSet: row.botSet } : {}),
            nextCheckAt: now,
        })
    }
    const fields = {
        serverId,
        state: counts.queued ? ("locking" as const) : ("active" as const),
        origin: start.origin,
        reason: start.reason,
        ...(start.actorId ? { startedBy: start.actorId } : {}),
        startedAt: now,
        counts,
        notesDue: ["started" as const],
    }
    if (current) await ctx.db.replace(current._id, fields)
    else await ctx.db.insert("lockdowns", fields)
    return {
        started: true,
        admitted: await admitSecurityRecord(ctx, serverId, `lockdown:${now}:start`, {
            type: "lockdown-change",
            actorId: start.actorId,
            resourceIds: [],
            changedFields: ["lockdown-started"],
        }),
    }
}

/**
 * Lifts the lockdown. Channels not written yet have nothing to give back, and a channel being written goes back when its write reports. A
 * lockdown that already ended with failed or uncertain channels queues them again, since the worker reads each channel before it writes
 */
async function endLockdown(ctx: MutationCtx, serverId: string, end: { actorId: string; reason: string }) {
    const current = await readLockdown(ctx, serverId),
        now = Date.now()
    if (!current) return { refused: "not-on" as const }
    if (current.state === "ended" && current.counts.failed + current.counts.uncertain === 0)
        return { refused: "not-on" as const }
    let counts = current.counts
    const move = async (from: LockdownChannelState, to: LockdownChannelState, active: boolean) => {
        for (const row of await lockdownChannelsIn(ctx, serverId, from).take(LOCKDOWN_CHANNEL_LIMIT)) {
            await ctx.db.patch(row._id, {
                phase: "restore",
                state: to,
                active: active ? true : undefined,
                nextCheckAt: now,
                tries: undefined,
            })
            counts = movedCounts(counts, from, to)
        }
    }
    if (current.state === "locking" || current.state === "active")
        for (const row of await lockdownChannelsIn(ctx, serverId, "queued").take(LOCKDOWN_CHANNEL_LIMIT)) {
            // A channel an earlier try reached may hold NeonFlux's own allow, so the worker reads it. Others hold nothing of this lockdown
            if (row.attempted) {
                await ctx.db.patch(row._id, { phase: "restore", nextCheckAt: now, tries: undefined })
                continue
            }
            await ctx.db.patch(row._id, { phase: "restore", state: "restored", active: undefined })
            counts = movedCounts(counts, "queued", "restored")
        }
    await move("locked", "queued", true)
    await move("failed", "queued", true)
    await move("uncertain", "queued", true)
    const next = {
        ...current,
        counts,
        state: "restoring" as const,
        endedBy: end.actorId,
        endReason: end.reason,
    }
    await ctx.db.patch(current._id, { counts, state: "restoring", endedBy: end.actorId, endReason: end.reason })
    return settled(ctx, next)
}

const refusals: Record<LockdownRefusal, string> = {
    "already-on": "A lockdown is already on",
    "not-on": "No lockdown is on",
    restoring: "The last lockdown is still being lifted. Try again once it ended",
    unrestored:
        "The last lockdown left channels it could not restore. Lift it again first, since only its record knows what to give back",
}
/** Chat and dashboard share these rules. A dashboard lockdown carries the plan the bot read, see configurationNative.ts */
export async function applyLockdownManagement(
    ctx: MutationCtx,
    serverId: string,
    actorId: string,
    op: LockdownDashboardOperation & { plan?: LockdownPlan },
    origin: LockdownOrigin,
): Promise<LockdownResult> {
    let outcome: Partial<LockdownResult> = {}
    if (op.type === "on") {
        if (!op.plan) fail(400, "Lockdown plan required")
        outcome = await startLockdown(ctx, serverId, { origin, actorId, reason: op.reason ?? "", plan: op.plan })
    } else if (op.type === "off") outcome = await endLockdown(ctx, serverId, { actorId, reason: op.reason ?? "" })
    else if (op.type === "exempt" || op.type === "exempt-set") {
        const row = await readLockdownSettings(ctx, serverId),
            saved = publicLockdownSettings(row).exemptChannelIds
        const list =
            op.type === "exempt-set"
                ? [...new Set(op.channelIds)]
                : op.exempt
                  ? [...new Set([...saved, op.channelId])]
                  : saved.filter((id) => id !== op.channelId)
        if (list.length > LOCKDOWN_CHANNEL_LIMIT) fail(429, `A server can exempt ${LOCKDOWN_CHANNEL_LIMIT} channels`)
        const fields = { exemptChannelIds: list, updatedAt: Date.now(), updatedBy: actorId }
        if (row) await ctx.db.patch(row._id, fields)
        else await ctx.db.insert("lockdownSettings", { serverId, ...fields })
    }
    // A website job has no reply to carry a refusal, so the job fails with the sentence
    if (origin === "dashboard" && outcome.refused) fail(409, refusals[outcome.refused], "REFUSED")
    return { ...(await lockdownStatus(ctx, serverId)), ...outcome }
}

// The status reads the channel rows only for its problems, so it costs a handful of reads however large the server is
export const get = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<LockdownStatus> => {
        const input = decode(LockdownGetRequest, request)
        authorize(actor(input.actor), moderationConfig(await readModeration(ctx, input.serverId)), "security", true)
        return lockdownStatus(ctx, input.serverId)
    },
})

export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<LockdownResult> => {
        const input = decode(LockdownManageRequest, request),
            identity = source(input, Date.now()),
            who = actor(input.actor),
            op = input.operation
        // The same rule as !security lock. Lifting stays reachable for an Administrator at DEFCON 1
        authorize(who, moderationConfig(await readModeration(ctx, identity.serverId)), "security", op.type === "off")
        return changeConfiguration(
            ctx,
            identity.serverId,
            "lockdown",
            {
                kind: "chat",
                createdAt: identity.createdAt,
                actor: { userId: who.userId, source: "command" },
                operation: op,
            },
            () => applyLockdownManagement(ctx, identity.serverId, who.userId, op, "command"),
        )
    },
})

/** Anti-nuke's own start, which only a server that allowed it reaches */
export const auto = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<LockdownResult> => {
        const input = decode(LockdownAutoRequest, request)
        const settings = await ctx.db
            .query("antiNukeSettings")
            .withIndex("by_server", (q) => q.eq("serverId", input.serverId))
            .unique()
        if (!settings?.enabled || settings.mode !== "enforce" || !settings.lockdown)
            return lockdownStatus(ctx, input.serverId)
        const outcome = await startLockdown(ctx, input.serverId, {
            origin: "antinuke",
            reason: `Anti-nuke incident ${input.incidentNo}`,
            plan: input.plan,
        })
        return { ...(await lockdownStatus(ctx, input.serverId)), ...outcome }
    },
})

const workRow = (row: Doc<"lockdownChannels">): LockdownWorkRow => ({
    channelId: row.channelId,
    phase: row.phase,
    everyone: row.everyone,
    bits: row.bits,
    botBefore: row.botBefore,
    ...(row.botSet ? { botSet: row.botSet } : {}),
})
/** The staff log notes due, each handed out once. A server without a staff log channel has no note to send */
async function takeNotes(ctx: MutationCtx, serverId: string): Promise<LockdownWorkResult["notes"]> {
    const row = await readLockdown(ctx, serverId)
    if (!row?.notesDue?.length) return []
    await ctx.db.patch(row._id, { notesDue: [] })
    const logChannelId = moderationConfig(await readModeration(ctx, serverId)).logChannelId
    if (!logChannelId) return []
    return row.notesDue.map((kind) => {
        const by = kind === "started" ? row.startedBy : row.endedBy
        return {
            kind,
            logChannelId,
            ...(by ? { by } : {}),
            reason: (kind === "started" ? row.reason : row.endReason) ?? "",
        }
    })
}
/** What one outcome makes of a channel. A write that was still running when staff lifted the lockdown goes back to the queue to be restored */
function nextChannel(row: Doc<"lockdownChannels">, outcome: LockdownWorkOutcome, lifting: boolean, now: number) {
    const parked = { active: undefined, nextCheckAt: now }
    // Even a write given back may have set NeonFlux's own allow before it stopped, so a lift still reads the channel
    if (lifting && row.phase === "lock")
        return outcome === "gone"
            ? { phase: "restore" as const, state: "restored" as const, ...parked }
            : {
                  phase: "restore" as const,
                  state: "queued" as const,
                  active: true as const,
                  nextCheckAt: now,
                  tries: undefined,
              }
    if (outcome === "retry") {
        const tries = (row.tries ?? 0) + 1
        return tries >= WRITE_TRIES
            ? { state: "failed" as const, tries: undefined, ...parked }
            : {
                  state: "queued" as const,
                  active: true as const,
                  tries,
                  nextCheckAt: now + RETRY_MS * 2 ** (tries - 1),
              }
    }
    if (outcome === "gone")
        return row.phase === "lock"
            ? { state: "skipped" as const, skip: "gone" as const, ...parked }
            : { state: "restored" as const, ...parked }
    if (outcome === "done")
        return { state: row.phase === "lock" ? ("locked" as const) : ("restored" as const), ...parked }
    return { state: outcome === "failed" ? ("failed" as const) : ("uncertain" as const), ...parked }
}

/**
 * The worker's three steps. A claim first makes writes that never reported uncertain, then hands out queued channels. A report records
 * what happened, and also settles uncertain channels from a fresh read. Nothing here ever queues an uncertain write again
 */
export const work = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<LockdownWorkResult> => {
        const input = decode(LockdownWorkRequest, request),
            serverId = input.serverId,
            now = Date.now()
        const lockdown = await readLockdown(ctx, serverId)
        if (!lockdown) return { rows: [], notes: [] }
        let counts = lockdown.counts
        const lifting = lockdown.state === "restoring"
        const update = async (row: Doc<"lockdownChannels">, outcome: LockdownWorkOutcome) => {
            const next = nextChannel(row, outcome, lifting, now)
            await ctx.db.patch(row._id, next)
            counts = movedCounts(counts, row.state, next.state)
        }
        if (input.type === "problems") {
            const rows = await lockdownChannelsIn(ctx, serverId, "uncertain").take(LOCKDOWN_PROBLEM_LIMIT)
            return { rows: rows.map(workRow), notes: [] }
        }
        let rows: LockdownWorkRow[] = []
        if (input.type === "report") {
            for (const { channelId, outcome } of input.rows) {
                const row = await readLockdownChannel(ctx, serverId, channelId)
                if (row && (row.state === "writing" || row.state === "uncertain")) await update(row, outcome)
            }
        } else {
            const expired = await lockdownChannelsIn(ctx, serverId, "writing")
                .filter((q) => q.lte(q.field("nextCheckAt"), now))
                .take(LOCKDOWN_CHANNEL_LIMIT)
            for (const row of expired) await update(row, "uncertain")
            const due = await ctx.db
                .query("lockdownChannels")
                .withIndex("by_server_state", (q) =>
                    q.eq("serverId", serverId).eq("state", "queued").lte("nextCheckAt", now),
                )
                .take(LOCKDOWN_WORK_BATCH)
            for (const row of due) {
                await ctx.db.patch(row._id, { state: "writing", nextCheckAt: now + LEASE_MS, attempted: true })
                counts = movedCounts(counts, "queued", "writing")
            }
            rows = due.map(workRow)
        }
        await ctx.db.patch(lockdown._id, { counts })
        const { admitted } = await settled(ctx, { ...lockdown, counts })
        return { rows, notes: await takeNotes(ctx, serverId), ...(admitted ? { admitted } : {}) }
    },
})
