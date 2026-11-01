import { Schema } from "effect"
import { Id, Ids, Int, List, Millis, origin, STRUCTURE_CHANNELS, Str, Text } from "./common.ts"
import { PermissionOverwriteSnapshot } from "./moderation.ts"
import { ModerationActor } from "./shared.ts"

// Server-wide lockdown, see docs/BOT.md#server-wide-lockdown

/** A server holds at most 500 channels, so a lockdown's rows and its exempt list stay within this */
export const LOCKDOWN_CHANNEL_LIMIT = STRUCTURE_CHANNELS
/** Channels one pass of the worker claims at once */
export const LOCKDOWN_WORK_BATCH = 20
/** Channels !lockdown status names, and how many uncertain channels one status settles */
export const LOCKDOWN_PROBLEM_LIMIT = 10
const Bits = PermissionOverwriteSnapshot.fields.allow

export const LockdownSettings = Schema.Struct({ exemptChannelIds: Ids(LOCKDOWN_CHANNEL_LIMIT) })
export type LockdownSettings = typeof LockdownSettings.Type

/** queued waits for the worker, writing was claimed, and uncertain may or may not have happened, which status settles by reading */
export const LockdownChannelState = Schema.Literals([
    "queued",
    "writing",
    "locked",
    "uncertain",
    "failed",
    "skipped",
    "restored",
])
export type LockdownChannelState = typeof LockdownChannelState.Type
/**
 * Why a channel holds nothing of a lockdown: Staff exempted it, the everyone role cannot view it, it already denies every bit, it has no
 * chat, or it was deleted
 */
export const LockdownSkip = Schema.Literals(["exempt", "private", "held", "gone"])
export type LockdownSkip = typeof LockdownSkip.Type
export const LockdownPhase = Schema.Literals(["lock", "restore"])
export type LockdownPhase = typeof LockdownPhase.Type
/** A member overwrite the lockdown set on NeonFlux itself, so restoring can remove it when it is still exactly this */
const BotOverwrite = Schema.Struct({ allow: Bits, deny: Bits })

/** One channel of a lockdown as the bot read it when the lockdown started. bits are the posting bits it denies */
export const LockdownPlanRow = Schema.Struct({
    channelId: Id,
    skip: Schema.optionalKey(LockdownSkip),
    everyone: PermissionOverwriteSnapshot,
    bits: Bits,
    botBefore: PermissionOverwriteSnapshot,
    botSet: Schema.optionalKey(BotOverwrite),
})
export type LockdownPlanRow = typeof LockdownPlanRow.Type
export const LockdownPlan = List(LockdownPlanRow, LOCKDOWN_CHANNEL_LIMIT).check(
    Schema.makeFilter(
        (rows: readonly LockdownPlanRow[]) => new Set(rows.map((row) => row.channelId)).size === rows.length,
    ),
)
export type LockdownPlan = typeof LockdownPlan.Type

export const LockdownState = Schema.Literals(["locking", "active", "restoring", "ended"])
export type LockdownState = typeof LockdownState.Type
export const LockdownOrigin = Schema.Literals(["command", "dashboard", "antinuke"])
export type LockdownOrigin = typeof LockdownOrigin.Type
const count = Int(0, LOCKDOWN_CHANNEL_LIMIT)
export const LockdownCounts = Schema.Struct(
    Object.fromEntries(LockdownChannelState.literals.map((state) => [state, count])) as Record<
        LockdownChannelState,
        typeof count
    >,
)
export type LockdownCounts = typeof LockdownCounts.Type
export const LockdownProblem = Schema.Struct({
    channelId: Id,
    state: Schema.Literals(["uncertain", "failed"]),
    phase: LockdownPhase,
    bits: Bits,
})
export type LockdownProblem = typeof LockdownProblem.Type
/** The server's latest lockdown. problems holds at most LOCKDOWN_PROBLEM_LIMIT channels of the uncertain and failed ones */
export const LockdownView = Schema.Struct({
    state: LockdownState,
    origin: LockdownOrigin,
    reason: Str(512),
    startedBy: Schema.optionalKey(Id),
    startedAt: Millis,
    endedBy: Schema.optionalKey(Id),
    endReason: Schema.optionalKey(Str(512)),
    endedAt: Schema.optionalKey(Millis),
    counts: LockdownCounts,
    problems: List(LockdownProblem, 2 * LOCKDOWN_PROBLEM_LIMIT),
})
export type LockdownView = typeof LockdownView.Type
export const LockdownStatus = Schema.Struct({ settings: LockdownSettings, lockdown: Schema.NullOr(LockdownView) })
export type LockdownStatus = typeof LockdownStatus.Type

const on = Schema.Struct({ type: Schema.Literal("on"), reason: Schema.optionalKey(Text(512)) })
const off = Schema.Struct({ type: Schema.Literal("off"), reason: Schema.optionalKey(Text(512)) })
const exempt = Schema.Struct({ type: Schema.Literal("exempt"), channelId: Id, exempt: Schema.Boolean })
export const LockdownOperation = Schema.Union([Schema.Struct({ ...on.fields, plan: LockdownPlan }), off, exempt])
export type LockdownOperation = typeof LockdownOperation.Type
/**
 * The website asks and the bot adds the plan it read to a job's context. It replaces the whole exempt list, and settle reads the
 * uncertain channels, which only the bot can do
 */
export const LockdownDashboardOperation = Schema.Union([
    on,
    off,
    exempt,
    Schema.Struct({ type: Schema.Literal("exempt-set"), channelIds: Ids(LOCKDOWN_CHANNEL_LIMIT) }),
    Schema.Struct({ type: Schema.Literal("settle") }),
])
export type LockdownDashboardOperation = typeof LockdownDashboardOperation.Type
/** The plan the bot read for a dashboard lockdown */
export const LockdownDashboardContext = Schema.Struct({ plan: LockdownPlan })
export type LockdownDashboardContext = typeof LockdownDashboardContext.Type

export const LockdownGetRequest = Schema.Struct({ serverId: Id, actor: ModerationActor })
export type LockdownGetRequest = typeof LockdownGetRequest.Type
/** Chat changes carry the staff member's fresh native authority, under the same rule as !security lock */
export const LockdownManageRequest = Schema.Struct({
    ...origin,
    serverId: Id,
    messageId: Id,
    createdAt: Millis,
    actor: ModerationActor,
    operation: LockdownOperation,
})
export type LockdownManageRequest = typeof LockdownManageRequest.Type
/**
 * What a change made happen. started and ended report a state change, refused says why nothing changed, and requeued counts the failed
 * channels an explicit repeat queued again. admitted tells the bot a security record waits for delivery
 */
export const LockdownRefusal = Schema.Literals(["already-on", "not-on", "restoring", "unrestored"])
export type LockdownRefusal = typeof LockdownRefusal.Type
export const LockdownResult = Schema.Struct({
    ...LockdownStatus.fields,
    started: Schema.optionalKey(Schema.Boolean),
    ended: Schema.optionalKey(Schema.Boolean),
    refused: Schema.optionalKey(LockdownRefusal),
    requeued: Schema.optionalKey(count),
    admitted: Schema.optionalKey(Schema.Boolean),
})
export type LockdownResult = typeof LockdownResult.Type

/** Anti-nuke starts a lockdown with no staff member behind it. The backend rechecks that its settings allow this */
export const LockdownAutoRequest = Schema.Struct({
    serverId: Id,
    incidentNo: Int(1),
    plan: LockdownPlan,
})
export type LockdownAutoRequest = typeof LockdownAutoRequest.Type

/** One claimed channel the worker writes */
export const LockdownWorkRow = Schema.Struct({
    channelId: Id,
    phase: LockdownPhase,
    everyone: PermissionOverwriteSnapshot,
    bits: Bits,
    botBefore: PermissionOverwriteSnapshot,
    botSet: Schema.optionalKey(BotOverwrite),
})
export type LockdownWorkRow = typeof LockdownWorkRow.Type
/**
 * done is what the phase set out to do, gone a channel Fluxer no longer holds, and retry a claim given back whose last write is known not to
 * have reached Fluxer or was answered with a 429, which goes again a few times with growing waits
 */
export const LockdownWorkOutcome = Schema.Literals(["done", "failed", "uncertain", "gone", "retry"])
export type LockdownWorkOutcome = typeof LockdownWorkOutcome.Type
export const LockdownWorkRequest = Schema.Union([
    Schema.Struct({ serverId: Id, type: Schema.Literal("claim") }),
    Schema.Struct({
        serverId: Id,
        type: Schema.Literal("report"),
        rows: List(
            Schema.Struct({ channelId: Id, outcome: LockdownWorkOutcome }),
            LOCKDOWN_WORK_BATCH + 2 * LOCKDOWN_PROBLEM_LIMIT,
        ),
    }),
    Schema.Struct({ serverId: Id, type: Schema.Literal("problems") }),
])
export type LockdownWorkRequest = typeof LockdownWorkRequest.Type
/** A staff log note the worker owes for a lockdown's start or end. The backend hands each out once */
export const LockdownNote = Schema.Struct({
    kind: Schema.Literals(["started", "ended"]),
    logChannelId: Id,
    by: Schema.optionalKey(Id),
    reason: Str(512),
})
export type LockdownNote = typeof LockdownNote.Type
/** rows answers a claim or a request for the uncertain channels */
export const LockdownWorkResult = Schema.Struct({
    rows: List(LockdownWorkRow, LOCKDOWN_WORK_BATCH + 2 * LOCKDOWN_PROBLEM_LIMIT),
    notes: List(LockdownNote, 2),
    admitted: Schema.optionalKey(Schema.Boolean),
})
export type LockdownWorkResult = typeof LockdownWorkResult.Type
