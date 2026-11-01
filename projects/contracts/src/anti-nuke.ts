import { Schema } from "effect"
import { Id, Ids, Int, List, Millis, origin } from "./common.ts"
import { ModerationActor } from "./shared.ts"

// Anti-nuke, see docs/BOT.md#anti-nuke

/** The audit actions anti-nuke counts, by the name the detector and its evals use */
export const AntiNukeAction = Schema.Literals([
    "ban",
    "kick",
    "unban",
    "prune",
    "channel-delete",
    "channel-create",
    "role-delete",
    "role-create",
    "role-perms",
    "member-roles",
    "webhook-create",
    /** A timeout, purge, lock, slowmode, quarantine or jail by a member through a bot-only right, which only NeonFlux's own record shows */
    "restrict",
])
export type AntiNukeAction = typeof AntiNukeAction.Type
export const AntiNukeMode = Schema.Literals(["dry-run", "enforce"])
export type AntiNukeMode = typeof AntiNukeMode.Type
export const AntiNukeResponse = Schema.Literals(["strip", "kick", "ban"])
export type AntiNukeResponse = typeof AntiNukeResponse.Type
export const AntiNukeLimitName = Schema.Literals(["bans", "kicks", "channels", "roles"])
export type AntiNukeLimitName = typeof AntiNukeLimitName.Type
export const ANTI_NUKE_MIN_COUNT = 2,
    ANTI_NUKE_MAX_COUNT = 100,
    ANTI_NUKE_MIN_SECONDS = 5,
    ANTI_NUKE_MAX_SECONDS = 3600
export const AntiNukeLimit = Schema.Struct({
    count: Int(ANTI_NUKE_MIN_COUNT, ANTI_NUKE_MAX_COUNT),
    seconds: Int(ANTI_NUKE_MIN_SECONDS, ANTI_NUKE_MAX_SECONDS),
})
export type AntiNukeLimit = typeof AntiNukeLimit.Type
export const AntiNukeLimits = Schema.Struct({
    bans: AntiNukeLimit,
    kicks: AntiNukeLimit,
    channels: AntiNukeLimit,
    roles: AntiNukeLimit,
})
export type AntiNukeLimits = typeof AntiNukeLimits.Type
/** Tuned on evals/anti-nuke/train.json, see docs/CONTRIBUTING.md#detector-evals */
export const ANTI_NUKE_DEFAULT_LIMITS: AntiNukeLimits = {
    bans: { count: 10, seconds: 30 },
    kicks: { count: 10, seconds: 30 },
    channels: { count: 5, seconds: 30 },
    roles: { count: 5, seconds: 30 },
}
/** Accounts anti-nuke only alerts about. A list a server edits by hand stays short */
export const ANTI_NUKE_TRUST_LIMIT = 100
export const AntiNukeSettings = Schema.Struct({
    enabled: Schema.Boolean,
    mode: AntiNukeMode,
    limits: AntiNukeLimits,
    response: AntiNukeResponse,
    lockdown: Schema.Boolean,
    trustedIds: Ids(ANTI_NUKE_TRUST_LIMIT),
})
export type AntiNukeSettings = typeof AntiNukeSettings.Type
export const defaultAntiNukeSettings = (): AntiNukeSettings => ({
    enabled: false,
    mode: "dry-run",
    limits: ANTI_NUKE_DEFAULT_LIMITS,
    response: "strip",
    lockdown: false,
    trustedIds: [],
})

const trust = Schema.Struct({ type: Schema.Literal("trust"), userId: Id, trusted: Schema.Boolean })
const settingOperations = [
    Schema.Struct({ type: Schema.Literal("module"), enabled: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("mode"), mode: AntiNukeMode }),
    Schema.Struct({ type: Schema.Literal("limit"), limit: AntiNukeLimitName, value: AntiNukeLimit }),
    Schema.Struct({ type: Schema.Literal("response"), response: AntiNukeResponse }),
    Schema.Struct({ type: Schema.Literal("lockdown"), enabled: Schema.Boolean }),
    trust,
] as const
/**
 * What the bot read and did for a restore. Fluxer holds the roles, so the native work comes first and the backend records it. left names the
 * roles that ranked at or above NeonFlux and stayed out, which makes the outcome failed, so the incident can be restored again. gone names the
 * roles deleted since, which nothing can bring back
 */
export const AntiNukeRestoreResult = Schema.Struct({
    incidentNo: Int(1),
    outcome: Schema.Literals(["succeeded", "failed", "uncertain"]),
    left: Schema.optionalKey(Ids(1000)),
    gone: Schema.optionalKey(Ids(1000)),
})
export type AntiNukeRestoreResult = typeof AntiNukeRestoreResult.Type
/** Chat changes carry the owner's or Administrator's fresh native authority */
export const AntiNukeOperation = Schema.Union([
    ...settingOperations,
    Schema.Struct({ type: Schema.Literal("restore"), userId: Id, result: AntiNukeRestoreResult }),
])
export type AntiNukeOperation = typeof AntiNukeOperation.Type
/**
 * The website replaces the whole trusted list, asks the bot to restore what one incident removed, and asks it to read the member of an incident
 * whose outcome is unknown. Both name only the incident, since jobs and audit entries reach every website manager and incident accounts do not
 */
export const AntiNukeDashboardOperation = Schema.Union([
    ...settingOperations,
    Schema.Struct({ type: Schema.Literal("trust-set"), userIds: Ids(ANTI_NUKE_TRUST_LIMIT) }),
    Schema.Struct({ type: Schema.Literal("restore"), incidentNo: Int(1) }),
    Schema.Struct({ type: Schema.Literal("settle"), incidentNo: Int(1) }),
])
export type AntiNukeDashboardOperation = typeof AntiNukeDashboardOperation.Type
export const AntiNukeDashboardContext = Schema.Struct({ result: AntiNukeRestoreResult })
export type AntiNukeDashboardContext = typeof AntiNukeDashboardContext.Type
export const AntiNukeGetRequest = Schema.Struct({ serverId: Id })
export type AntiNukeGetRequest = typeof AntiNukeGetRequest.Type
export const AntiNukeManageRequest = Schema.Struct({
    ...origin,
    serverId: Id,
    messageId: Id,
    createdAt: Millis,
    actor: ModerationActor,
    operation: AntiNukeOperation,
})
export type AntiNukeManageRequest = typeof AntiNukeManageRequest.Type
export const AntiNukeResult = Schema.Struct({ settings: AntiNukeSettings })
export type AntiNukeResult = typeof AntiNukeResult.Type

/** Which rule of the detector fired */
export const AntiNukeRule = Schema.Literals([
    "bans",
    "kicks",
    "channels",
    "roles",
    "unbans",
    "prunes",
    "webhooks",
    "creates",
    "grants",
    "mixed",
    "slow",
    "colluding",
])
export type AntiNukeRule = typeof AntiNukeRule.Type
export const AntiNukeCounts = Schema.Struct(
    Object.fromEntries(AntiNukeAction.literals.map((action) => [action, Schema.optionalKey(Int(1))])) as Record<
        AntiNukeAction,
        Schema.optionalKey<ReturnType<typeof Int>>
    >,
)
export type AntiNukeCounts = typeof AntiNukeCounts.Type
/** How the bot read the account at the moment it acted. high ranks at or above NeonFlux, so it can only be reported */
export const AntiNukeActorKind = Schema.Literals(["staff", "bot", "high", "owner", "trusted"])
export type AntiNukeActorKind = typeof AntiNukeActorKind.Type
/**
 * What the incident did. alert means nothing was tried, in dry-run or for an account NeonFlux may not touch. pending is claimed with no
 * result yet, and none means enforcement found nothing to take away
 */
export const AntiNukeOutcome = Schema.Literals(["alert", "pending", "none", "succeeded", "failed", "uncertain"])
export type AntiNukeOutcome = typeof AntiNukeOutcome.Type
/** What the lockdown did for this incident: Not wanted, wanted but not allowed or in dry-run, started, already on, or could not start */
export const AntiNukeLockdownResult = Schema.Literals(["none", "not-allowed", "started", "already-on", "failed"])
export type AntiNukeLockdownResult = typeof AntiNukeLockdownResult.Type
export const AntiNukeIncident = Schema.Struct({
    incidentNo: Int(1),
    actorId: Id,
    actorKind: AntiNukeActorKind,
    rule: AntiNukeRule,
    counts: AntiNukeCounts,
    firstAt: Millis,
    lastAt: Millis,
    mode: AntiNukeMode,
    /** alert when NeonFlux may not act. kick is also how a strip treats a bot with no role to strip */
    response: Schema.Literals(["strip", "kick", "ban", "alert"]),
    outcome: AntiNukeOutcome,
    removedRoleIds: Ids(1000),
    lockdown: AntiNukeLockdownResult,
    restoredAt: Schema.optionalKey(Millis),
    restoredBy: Schema.optionalKey(Id),
    restoreOutcome: Schema.optionalKey(AntiNukeRestoreResult.fields.outcome),
    restoreLeftRoleIds: Schema.optionalKey(Ids(1000)),
    restoreGoneRoleIds: Schema.optionalKey(Ids(1000)),
    createdAt: Millis,
})
export type AntiNukeIncident = typeof AntiNukeIncident.Type
/** Whether an incident holds roles to give back. A strip that failed took nothing, and a later demotion by staff must not be undone */
export const antiNukeRestorable = (incident: {
    readonly removedRoleIds: readonly string[]
    readonly restoredAt?: number | undefined
    readonly outcome: string
}) =>
    incident.removedRoleIds.length > 0 &&
    incident.restoredAt === undefined &&
    (incident.outcome === "succeeded" || incident.outcome === "uncertain")
/** A server keeps its newest incidents, each with what was observed, done and how it ended */
export const ANTI_NUKE_INCIDENT_LIMIT = 200
export const ANTI_NUKE_INCIDENT_PAGE = 10
const claimFields = {
    actorId: Id,
    actorKind: AntiNukeActorKind,
    rule: AntiNukeRule,
    counts: AntiNukeCounts,
    firstAt: Millis,
    lastAt: Millis,
    response: AntiNukeIncident.fields.response,
    removedRoleIds: Ids(1000),
}
/** The bot claims an incident before it acts. An incident for the same account within the window claims nothing */
export const AntiNukeOpenRequest = Schema.Struct({ serverId: Id, ...claimFields })
export type AntiNukeOpenRequest = typeof AntiNukeOpenRequest.Type
export const AntiNukeOpenResult = Schema.Union([
    Schema.Struct({ claimed: Schema.Literal(false) }),
    Schema.Struct({ claimed: Schema.Literal(true), incidentNo: Int(1), act: Schema.Boolean, lockdown: Schema.Boolean }),
])
export type AntiNukeOpenResult = typeof AntiNukeOpenResult.Type
/** What happened, recorded once. It also settles an uncertain incident from a fresh read */
export const AntiNukeFinishRequest = Schema.Struct({
    serverId: Id,
    incidentNo: Int(1),
    outcome: Schema.Literals(["alert", "none", "succeeded", "failed", "uncertain"]),
    lockdown: Schema.optionalKey(AntiNukeLockdownResult),
})
export type AntiNukeFinishRequest = typeof AntiNukeFinishRequest.Type
/** admitted tells the bot a new record waits for delivery, and logChannelId names the staff log for its note, given once */
export const AntiNukeFinishResult = Schema.Struct({
    recorded: Schema.Boolean,
    admitted: Schema.Boolean,
    logChannelId: Schema.optionalKey(Id),
})
export type AntiNukeFinishResult = typeof AntiNukeFinishResult.Type
/** At startup, incidents a stopped process left without an outcome become uncertain */
export const AntiNukeObserveRequest = Schema.Struct({ serverId: Id })
export type AntiNukeObserveRequest = typeof AntiNukeObserveRequest.Type
export const AntiNukeObserveResult = Schema.Struct({ uncertain: Int(0), admitted: Schema.Boolean })
export type AntiNukeObserveResult = typeof AntiNukeObserveResult.Type
/** Incidents newest first, one by number or the newest with roles to give back to a member. Owner or Administrator only */
export const AntiNukeIncidentsRequest = Schema.Struct({
    serverId: Id,
    actor: ModerationActor,
    query: Schema.Union([
        Schema.Struct({ type: Schema.Literal("page"), before: Schema.optionalKey(Int(1)) }),
        Schema.Struct({ type: Schema.Literal("one"), incidentNo: Int(1) }),
        Schema.Struct({ type: Schema.Literal("restorable"), userId: Id }),
    ]),
})
export type AntiNukeIncidentsRequest = typeof AntiNukeIncidentsRequest.Type
export const AntiNukeIncidentsResult = Schema.Struct({
    incidents: List(AntiNukeIncident, ANTI_NUKE_INCIDENT_PAGE),
    more: Schema.Boolean,
})
export type AntiNukeIncidentsResult = typeof AntiNukeIncidentsResult.Type
/** What the settings section shows. The incidents themselves name accounts, so they are private data, served with Private cases */
export const AntiNukeView = Schema.Struct({
    settings: AntiNukeSettings,
    incidentCount: Int(0),
    unconfirmedCount: Int(0),
})
export type AntiNukeView = typeof AntiNukeView.Type
