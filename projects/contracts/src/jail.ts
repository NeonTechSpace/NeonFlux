import { Schema } from "effect"
import { Id, Ids, Int, List, Millis, origin } from "./common.ts"
import { ModerationActionContext, ModerationActionGrant, ModerationCase } from "./moderation.ts"
import { ModerationActor } from "./shared.ts"

// Jail, see docs/BOT.md#jail

/** Jailed members a server holds at once, which every bot process keeps in memory */
export const JAIL_RECORD_LIMIT = 1000
/** Channels !jail status names, and how many a server stores */
export const JAIL_PROBLEM_LIMIT = 10
export const JailProblem = Schema.Struct({ channelId: Id, state: Schema.Literals(["failed", "uncertain"]) })
export type JailProblem = typeof JailProblem.Type
/** How far the channel pass is. running stays until it finishes, so a restart in the middle shows as running until the next pass reports */
export const JailSetup = Schema.Struct({
    state: Schema.Literals(["running", "done"]),
    total: Int(0, 100000),
    done: Int(0, 100000),
    problems: List(JailProblem, JAIL_PROBLEM_LIMIT),
    moreProblems: Int(0, 100000),
    updatedAt: Millis,
})
export type JailSetup = typeof JailSetup.Type
export const JailSettings = Schema.Struct({
    enabled: Schema.Boolean,
    roleId: Schema.NullOr(Id),
    channelId: Schema.NullOr(Id),
})
export type JailSettings = typeof JailSettings.Type
export const defaultJailSettings = (): JailSettings => ({ enabled: false, roleId: null, channelId: null })
/**
 * jailing and releasing wait for the one native call. Their uncertain forms may or may not have happened, which !mod recover reads and
 * nothing repeats. The stored roles never change while a record lives, except that an expired temporary role leaves them
 */
export const JailState = Schema.Literals(["jailing", "active", "jail-uncertain", "releasing", "release-uncertain"])
export type JailState = typeof JailState.Type
export const JailEntry = Schema.Struct({
    userId: Id,
    state: JailState,
    caseNo: Int(1),
    actorId: Schema.optionalKey(Id),
    createdAt: Millis,
    releaseAt: Schema.optionalKey(Millis),
    roleCount: Int(0, 1000),
})
export type JailEntry = typeof JailEntry.Type
export const JAIL_PAGE = 10

const settingOperations = [
    Schema.Struct({ type: Schema.Literal("module"), enabled: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("role"), roleId: Id }),
    Schema.Struct({ type: Schema.Literal("channel"), channelId: Id }),
] as const
/** The role and channel !jail setup found or made. Fluxer holds them, so the native work comes first and the backend records it */
export const JailSetupResult = Schema.Struct({ roleId: Id, channelId: Id })
export type JailSetupResult = typeof JailSetupResult.Type
export const JailOperation = Schema.Union([
    ...settingOperations,
    Schema.Struct({ type: Schema.Literal("setup"), ...JailSetupResult.fields }),
])
export type JailOperation = typeof JailOperation.Type
/** The website asks and the bot makes what is missing and adds it to the job's context. The website can name a channel to use */
export const JailDashboardOperation = Schema.Union([
    ...settingOperations,
    Schema.Struct({ type: Schema.Literal("setup"), channelId: Schema.optionalKey(Id) }),
])
export type JailDashboardOperation = typeof JailDashboardOperation.Type
export const JailDashboardContext = Schema.Struct({ jailSetup: JailSetupResult })
export type JailDashboardContext = typeof JailDashboardContext.Type

export const JailManageRequest = Schema.Struct({
    ...origin,
    serverId: Id,
    messageId: Id,
    createdAt: Millis,
    actor: ModerationActor,
    operation: JailOperation,
})
export type JailManageRequest = typeof JailManageRequest.Type
export const JailResult = Schema.Struct({ settings: JailSettings })
export type JailResult = typeof JailResult.Type
/**
 * What a server start keeps in memory, so a join or member update costs nothing extra. A server with no record and jail off answers an
 * empty list. moderationRoleIds are the staff who may read the jail channel
 */
export const JailMemoryRequest = Schema.Struct({ serverId: Id })
export type JailMemoryRequest = typeof JailMemoryRequest.Type
export const JailMemory = Schema.Struct({
    settings: JailSettings,
    moderationRoleIds: Ids(1000),
    /** Whose jail is confirmed, who NeonFlux sets back to the jail role */
    jailedIds: Ids(JAIL_RECORD_LIMIT),
    /** Everyone with a record, doubts included, whom the command gate and channel writes treat as jailed */
    confinedIds: Ids(JAIL_RECORD_LIMIT),
    /** A setup's pass had not finished when the last process stopped, so the next one reports its end */
    setupRunning: Schema.Boolean,
})
export type JailMemory = typeof JailMemory.Type
export const JailStatus = Schema.Struct({
    settings: JailSettings,
    setup: Schema.NullOr(JailSetup),
    count: Int(0, JAIL_RECORD_LIMIT),
})
export type JailStatus = typeof JailStatus.Type
export const JailStatusRequest = Schema.Struct({ serverId: Id, actor: ModerationActor })
export type JailStatusRequest = typeof JailStatusRequest.Type
/** Who is jailed follows the rule of private cases: The answer goes to a DM the bot verified, or to a server channel only staff can view */
export const JailListRequest = Schema.Struct({
    ...origin,
    serverId: Id,
    actor: ModerationActor,
    privateChannelVerified: Schema.optionalKey(Schema.Boolean),
    staffChannelRoleIds: Schema.optionalKey(Ids(1000)),
    afterUserId: Schema.optionalKey(Id),
})
export type JailListRequest = typeof JailListRequest.Type
export const JailListResult = Schema.Struct({
    entries: List(JailEntry, JAIL_PAGE),
    nextAfterUserId: Schema.optionalKey(Id),
})
export type JailListResult = typeof JailListResult.Type
/** What the dashboard section shows. It has the count and no names, which need the private moderation data rule */
export const JailView = JailStatus
export type JailView = typeof JailView.Type
/** One report of the channel pass. It replaces the last one */
const { updatedAt: _updatedAt, ...reportFields } = JailSetup.fields
export const JailReportRequest = Schema.Struct({ serverId: Id, setup: Schema.Struct(reportFields) })
export type JailReportRequest = typeof JailReportRequest.Type
export const JailReportResult = Schema.Struct({ recorded: Schema.Boolean })
export type JailReportResult = typeof JailReportResult.Type
/** The jails whose length ended, which the worker releases one at a time with a fresh read of each member */
export const JailDueRequest = Schema.Struct({ serverId: Id })
export type JailDueRequest = typeof JailDueRequest.Type
export const JailDueResult = Schema.Struct({ userIds: Ids(JAIL_PAGE) })
export type JailDueResult = typeof JailDueResult.Type
export const JailReleaseRequest = Schema.Struct({ serverId: Id, userId: Id, context: ModerationActionContext })
export type JailReleaseRequest = typeof JailReleaseRequest.Type
export const JailReleaseResult = Schema.Struct({
    case: Schema.optionalKey(ModerationCase),
    grant: Schema.optionalKey(ModerationActionGrant),
})
export type JailReleaseResult = typeof JailReleaseResult.Type
/** The bot held a jailed member again: After a rejoin, or by taking back roles someone added. It is recorded once per edit */
export const JailHeldRequest = Schema.Struct({
    serverId: Id,
    userId: Id,
    kind: Schema.Literals(["rejoin", "stripped"]),
    outcome: Schema.Literals(["succeeded", "failed", "uncertain"]),
    at: Millis,
})
export type JailHeldRequest = typeof JailHeldRequest.Type
export const JailHeldResult = Schema.Struct({ admitted: Schema.Boolean })
export type JailHeldResult = typeof JailHeldResult.Type
