import { Schema } from "effect"
import { Id, Ids, Int, IsoTime, List, Millis, Text, origin } from "./common.ts"
import { ModerationActor, ModerationSource, RolesRoleSnapshot } from "./shared.ts"

// Message leveling, see docs/BOT.md#message-leveling

/** A server stores at most 50,000 member scores, and a score is at most 100 million XP, which is level 1,000 */
export const LEVELING_CAP = 50000, LEVELING_XP_CAP = 100000000
const xp = Int(0, LEVELING_XP_CAP), xpPerMessage = Int(1, 100), cooldownSeconds = Int(15, 3600), reason = Text(500)
const distinctIds = Ids(50).check(Schema.makeFilter(v => new Set(v).size === v.length))

export const LevelingMapping = Schema.Struct({ level: Int(1, 1000), roleId: Id })
export type LevelingMapping = typeof LevelingMapping.Type
/** At most 20 role rewards, each at its own level with its own role */
export const LevelingMappings = List(LevelingMapping, 20).check(Schema.makeFilter(v => new Set(v.map(m => m.level)).size === v.length && new Set(v.map(m => m.roleId)).size === v.length))
export const LevelingFence = Schema.Struct({ scoreEpoch: Int(1), adjustmentRevision: Int(), mappingRevision: Int(1) })
export type LevelingFence = typeof LevelingFence.Type
export const LevelingSettings = Schema.Struct({ enabled: Schema.Boolean, xpPerMessage, cooldownSeconds, excludedChannelIds: distinctIds, excludedRoleIds: distinctIds,
    revision: Int(1), mappingRevision: Int(1), scoreEpoch: Int(1), mappings: LevelingMappings })
export type LevelingSettings = typeof LevelingSettings.Type
/** The backend drops repeated IDs from the excluded lists */
export const LevelingSettingsPatch = Schema.Struct({ enabled: Schema.optionalKey(Schema.Boolean), xpPerMessage: Schema.optionalKey(xpPerMessage), cooldownSeconds: Schema.optionalKey(cooldownSeconds),
    excludedChannelIds: Schema.optionalKey(Ids(50)), excludedRoleIds: Schema.optionalKey(Ids(50)) }).check(Schema.makeFilter(value => Object.keys(value).length > 0))
export type LevelingSettingsPatch = typeof LevelingSettingsPatch.Type
export const LevelingMemberContext = Schema.Struct({ ...origin, userId: Id, joinedAt: IsoTime, roleIds: Ids(1000), isBot: Schema.Boolean, timeoutUntil: Schema.NullOr(IsoTime) })
export type LevelingMemberContext = typeof LevelingMemberContext.Type
/** parentChannelId is the parent of a message's thread. Excluded channels match either channel */
export const LevelingCandidate = Schema.Struct({ messageId: Id, createdAt: Millis, userId: Id, channelId: Id, parentChannelId: Schema.optionalKey(Id), digest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)) })
    .check(Schema.makeFilter(value => value.parentChannelId !== value.channelId))
export type LevelingCandidate = typeof LevelingCandidate.Type
export const LevelingProfile = Schema.Struct({ userId: Id, xp, level: Int(0, 1000), nextLevelXp: Schema.NullOr(Int(100, LEVELING_XP_CAP)), fence: LevelingFence })
    .check(Schema.makeFilter(v => v.level === Math.floor(Math.sqrt(v.xp / 100)) && v.nextLevelXp === (v.level === 1000 ? null : 100 * (v.level + 1) ** 2)))
export type LevelingProfile = typeof LevelingProfile.Type
export const LevelingAudit = Schema.Struct({ auditNo: Int(1), actorId: Id, userId: Schema.optionalKey(Id), beforeXp: Schema.optionalKey(xp), afterXp: Schema.optionalKey(xp),
    reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)), createdAt: Millis, type: Schema.Literals(["adjust", "reset-member", "reset-server"]), scoreEpoch: Int(1) })
    .check(Schema.makeFilter(v => v.type === "reset-server" ? v.userId === undefined && v.beforeXp === undefined && v.afterXp === undefined
        : v.userId !== undefined && v.beforeXp !== undefined && v.afterXp !== undefined && (v.type !== "reset-member" || v.afterXp === 0)))
export type LevelingAudit = typeof LevelingAudit.Type
export const LevelingManageOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), expectedRevision: Int(1), patch: LevelingSettingsPatch }),
    Schema.Struct({ type: Schema.Literal("mappings"), expectedMappingRevision: Int(1), mappings: LevelingMappings, roles: List(RolesRoleSnapshot, 1000) }),
    Schema.Struct({ type: Schema.Literal("adjust"), userId: Id, xp, reason }),
    Schema.Struct({ type: Schema.Literal("reset-member"), userId: Id, confirm: Schema.Literal("reset-member"), reason }),
    Schema.Struct({ type: Schema.Literal("reset-server"), confirm: Schema.Literal("reset-server"), reason }),
    Schema.Struct({ type: Schema.Literal("reconcile"), userId: Schema.optionalKey(Id) }),
])
export type LevelingManageOperation = typeof LevelingManageOperation.Type
export const LevelingManageRequest = Schema.Struct({ ...ModerationSource.fields, serverId: Id, actor: ModerationActor, operation: LevelingManageOperation })
export type LevelingManageRequest = typeof LevelingManageRequest.Type
export const LevelingManageResult = Schema.Union([
    Schema.Struct({ duplicate: Schema.Literal(true) }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings: LevelingSettings }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("profile"), profile: LevelingProfile, audit: LevelingAudit }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("reset"), settings: LevelingSettings, audit: LevelingAudit }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("reconcile"), queued: Schema.Boolean }),
])
export type LevelingManageResult = typeof LevelingManageResult.Type
export const LevelingLeaderboardCursor = Schema.Struct({ ...origin, xp: Int(1, LEVELING_XP_CAP), userId: Id, scoreEpoch: Int(1) })
export type LevelingLeaderboardCursor = typeof LevelingLeaderboardCursor.Type
export const LevelingQueryRequest = Schema.Struct({ serverId: Id, actor: ModerationActor, member: LevelingMemberContext, observedAt: Millis, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings") }),
    Schema.Struct({ type: Schema.Literal("rank"), userId: Schema.optionalKey(Id) }),
    Schema.Struct({ type: Schema.Literal("leaderboard"), cursor: Schema.optionalKey(LevelingLeaderboardCursor) }),
    Schema.Struct({ type: Schema.Literal("status") }),
    Schema.Struct({ type: Schema.Literal("audits"), beforeAuditNo: Schema.optionalKey(Int(1)) }),
]) })
export type LevelingQueryRequest = typeof LevelingQueryRequest.Type
/** A rank is exact unless more than 100 members of the same level score higher, when it is the range the level allows. Servers whose rank counts are still being built report exact ranks only within the top 1,000 */
export const LevelingRank = Schema.Union([
    Schema.Struct({ type: Schema.Literal("exact"), position: Int(1, LEVELING_CAP) }),
    Schema.Struct({ type: Schema.Literal("range"), from: Int(2, LEVELING_CAP), to: Int(2, LEVELING_CAP) }),
    Schema.Struct({ type: Schema.Literal("outside-top-1000") }),
    Schema.Struct({ type: Schema.Literal("unranked") }),
])
export type LevelingRank = typeof LevelingRank.Type
export const LevelingQueryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings: LevelingSettings }),
    Schema.Struct({ type: Schema.Literal("rank"), profile: LevelingProfile, rank: LevelingRank }),
    Schema.Struct({ type: Schema.Literal("leaderboard"), profiles: List(LevelingProfile, 10), nextCursor: Schema.optionalKey(LevelingLeaderboardCursor) }),
    Schema.Struct({ type: Schema.Literal("status"), dirty: Int(), sweepPending: Schema.Boolean, profiles: Int(0, LEVELING_CAP) }),
    Schema.Struct({ type: Schema.Literal("audits"), audits: List(LevelingAudit, 10), nextBeforeAuditNo: Schema.optionalKey(Int(1)) }),
])
export type LevelingQueryResult = typeof LevelingQueryResult.Type
export const LevelingPreflightRequest = Schema.Struct({ serverId: Id, candidate: LevelingCandidate })
export type LevelingPreflightRequest = typeof LevelingPreflightRequest.Type
export const LevelingRejectReason = Schema.Literals(["disabled", "stale", "excluded", "cooldown", "duplicate", "capacity", "policy", "membership", "fence"])
export type LevelingRejectReason = typeof LevelingRejectReason.Type
export const LevelingPreflightResult = Schema.Union([Schema.Struct({ eligible: Schema.Literal(false), reason: LevelingRejectReason }),
    Schema.Struct({ eligible: Schema.Literal(true), policyRevision: Int(1), fence: LevelingFence })])
export type LevelingPreflightResult = typeof LevelingPreflightResult.Type
export const LevelingAwardRequest = Schema.Struct({ ...LevelingPreflightRequest.fields, policyRevision: Int(1), fence: LevelingFence, member: LevelingMemberContext, observedAt: Millis })
export type LevelingAwardRequest = typeof LevelingAwardRequest.Type
export const LevelingAwardResult = Schema.Union([Schema.Struct({ awarded: Schema.Literal(false), reason: LevelingRejectReason }),
    Schema.Struct({ awarded: Schema.Literal(true), xpAdded: Int(0, 100), profile: LevelingProfile, rewardQueued: Schema.Boolean })])
export type LevelingAwardResult = typeof LevelingAwardResult.Type
export const LevelingRewardAccount = Schema.Struct({ userId: Id, mark: Int(1), refs: List(Schema.Struct({ roleId: Id, joinedAt: IsoTime }), 40),
    targets: List(Schema.Struct({ roleId: Id, sourceId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)) }), 60), complete: Schema.Boolean })
export type LevelingRewardAccount = typeof LevelingRewardAccount.Type
/** A skip retires a level reference of an earlier membership. currentJoinedAt is null only with explicit member absence evidence */
export const LevelingWorkRequest = Schema.Struct({ serverId: Id, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("list") }),
    Schema.Struct({ ...origin, type: Schema.Literal("skip"), userId: Id, mark: Int(), roleId: Id, joinedAt: IsoTime, observedAt: Millis, currentJoinedAt: Schema.NullOr(IsoTime),
        memberAbsent: Schema.optionalKey(Schema.Literal(true)), memberUserId: Schema.optionalKey(Schema.String) })
        .check(Schema.makeFilter(op => (op.currentJoinedAt === null) === (op.memberAbsent === true) && (op.currentJoinedAt === null || Date.parse(op.currentJoinedAt) <= op.observedAt + 1000))),
    Schema.Struct({ type: Schema.Literal("done"), userId: Id, mark: Int(), complete: Schema.Boolean }),
]) })
export type LevelingWorkRequest = typeof LevelingWorkRequest.Type
export const LevelingWorkResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("accounts"), accounts: List(LevelingRewardAccount, 10), sweepPending: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean }),
])
export type LevelingWorkResult = typeof LevelingWorkResult.Type
