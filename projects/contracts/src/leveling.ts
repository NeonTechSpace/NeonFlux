import { Schema } from "effect"
import { Id, Ids, Int, IsoTime, List, Millis, SERVER_ROLES, STRUCTURE_CHANNELS, Text, origin } from "./common.ts"
import { ModerationActor, ModerationSource, RolesRoleSnapshot } from "./shared.ts"

// Message leveling, see docs/BOT.md#message-leveling

/** A score is at most 100 million XP, which is level 1,000 */
export const LEVELING_XP_CAP = 100000000
/** Level N begins at 100 * N² XP, up to level 1000 */
export const levelStartXp = (level: number) => 100 * level ** 2
export const levelForXp = (xp: number) => Math.min(1000, Math.floor(Math.sqrt(xp / 100)))
/** Where the next level begins, or null at the highest level */
export const nextLevelXp = (xp: number) => (levelForXp(xp) === 1000 ? null : levelStartXp(levelForXp(xp) + 1))
/**
 * Setting bounds: XP per message and cooldown ranges, only-these channels, excluded channels, excluded roles and role rewards, which
 * are Fluxer's channel and role limits per server, and the highest reward level
 */
export const LEVELING_LIMITS = {
    xpPerMessage: [1, 100],
    cooldownSeconds: [15, 3600],
    onlyChannels: STRUCTURE_CHANNELS,
    excludedChannels: STRUCTURE_CHANNELS,
    excludedRoles: SERVER_ROLES,
    rewards: SERVER_ROLES,
    level: 1000,
} as const
const xp = Int(0, LEVELING_XP_CAP),
    xpPerMessage = Int(...LEVELING_LIMITS.xpPerMessage),
    cooldownSeconds = Int(...LEVELING_LIMITS.cooldownSeconds),
    reason = Text(500)
const distinctIds = (max: number) => Ids(max).check(Schema.makeFilter((v) => new Set(v).size === v.length))

export const LevelingMapping = Schema.Struct({ level: Int(1, LEVELING_LIMITS.level), roleId: Id })
export type LevelingMapping = typeof LevelingMapping.Type
/** Up to 250 role rewards, as many as a server has roles, each at its own level with its own role */
export const LevelingMappings = List(LevelingMapping, LEVELING_LIMITS.rewards).check(
    Schema.makeFilter(
        (v) => new Set(v.map((m) => m.level)).size === v.length && new Set(v.map((m) => m.roleId)).size === v.length,
    ),
)
export const LevelingFence = Schema.Struct({ scoreEpoch: Int(1), adjustmentRevision: Int(), mappingRevision: Int(1) })
export type LevelingFence = typeof LevelingFence.Type
export const sameLevelingFence = (a: LevelingFence, b: LevelingFence) =>
    a.scoreEpoch === b.scoreEpoch &&
    a.adjustmentRevision === b.adjustmentRevision &&
    a.mappingRevision === b.mappingRevision
/** Level-up messages post in channelId, or where the member leveled up when it is null, optionally only for levels with a reward role */
export const LevelingLevelUp = Schema.Struct({ channelId: Schema.NullOr(Id), rewardsOnly: Schema.Boolean })
export type LevelingLevelUp = typeof LevelingLevelUp.Type
/**
 * Without levelUp, level-up messages are off. With onlyChannelIds, only messages in those channels earn XP, and without it every channel
 * does. Excluded channels and roles apply either way
 */
export const LevelingSettings = Schema.Struct({
    enabled: Schema.Boolean,
    xpPerMessage,
    cooldownSeconds,
    onlyChannelIds: Schema.optionalKey(
        distinctIds(LEVELING_LIMITS.onlyChannels).check(Schema.makeFilter((v) => v.length > 0)),
    ),
    excludedChannelIds: distinctIds(LEVELING_LIMITS.excludedChannels),
    excludedRoleIds: distinctIds(LEVELING_LIMITS.excludedRoles),
    revision: Int(1),
    mappingRevision: Int(1),
    scoreEpoch: Int(1),
    mappings: LevelingMappings,
    levelUp: Schema.optionalKey(LevelingLevelUp),
})
export type LevelingSettings = typeof LevelingSettings.Type
/** The backend drops repeated IDs from the channel and role lists. An empty onlyChannelIds lets every channel earn XP again */
export const LevelingSettingsPatch = Schema.Struct({
    enabled: Schema.optionalKey(Schema.Boolean),
    xpPerMessage: Schema.optionalKey(xpPerMessage),
    cooldownSeconds: Schema.optionalKey(cooldownSeconds),
    onlyChannelIds: Schema.optionalKey(Ids(LEVELING_LIMITS.onlyChannels)),
    excludedChannelIds: Schema.optionalKey(Ids(LEVELING_LIMITS.excludedChannels)),
    excludedRoleIds: Schema.optionalKey(Ids(LEVELING_LIMITS.excludedRoles)),
    /** null turns level-up messages off */
    levelUp: Schema.optionalKey(Schema.NullOr(LevelingLevelUp)),
}).check(Schema.makeFilter((value) => Object.keys(value).length > 0))
export type LevelingSettingsPatch = typeof LevelingSettingsPatch.Type
export const LevelingMemberContext = Schema.Struct({
    ...origin,
    userId: Id,
    joinedAt: IsoTime,
    roleIds: Ids(1000),
    isBot: Schema.Boolean,
    timeoutUntil: Schema.NullOr(IsoTime),
})
export type LevelingMemberContext = typeof LevelingMemberContext.Type
/** parentChannelId is the parent of a message's thread. Only-these and excluded channels match either channel */
export const LevelingCandidate = Schema.Struct({
    messageId: Id,
    createdAt: Millis,
    userId: Id,
    channelId: Id,
    parentChannelId: Schema.optionalKey(Id),
    digest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
}).check(Schema.makeFilter((value) => value.parentChannelId !== value.channelId))
export type LevelingCandidate = typeof LevelingCandidate.Type
export const LevelingProfile = Schema.Struct({
    userId: Id,
    xp,
    level: Int(0, 1000),
    nextLevelXp: Schema.NullOr(Int(100, LEVELING_XP_CAP)),
    fence: LevelingFence,
}).check(Schema.makeFilter((v) => v.level === levelForXp(v.xp) && v.nextLevelXp === nextLevelXp(v.xp)))
export type LevelingProfile = typeof LevelingProfile.Type
export const LevelingAudit = Schema.Struct({
    auditNo: Int(1),
    actorId: Id,
    userId: Schema.optionalKey(Id),
    beforeXp: Schema.optionalKey(xp),
    afterXp: Schema.optionalKey(xp),
    reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
    createdAt: Millis,
    type: Schema.Literals(["adjust", "reset-member", "reset-server"]),
    scoreEpoch: Int(1),
}).check(
    Schema.makeFilter((v) =>
        v.type === "reset-server"
            ? v.userId === undefined && v.beforeXp === undefined && v.afterXp === undefined
            : v.userId !== undefined &&
              v.beforeXp !== undefined &&
              v.afterXp !== undefined &&
              (v.type !== "reset-member" || v.afterXp === 0),
    ),
)
export type LevelingAudit = typeof LevelingAudit.Type
export const LevelingManageOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), expectedRevision: Int(1), patch: LevelingSettingsPatch }),
    Schema.Struct({
        type: Schema.Literal("mappings"),
        expectedMappingRevision: Int(1),
        mappings: LevelingMappings,
        roles: List(RolesRoleSnapshot, 1000),
    }),
    Schema.Struct({ type: Schema.Literal("adjust"), userId: Id, xp, reason }),
    Schema.Struct({
        type: Schema.Literal("reset-member"),
        userId: Id,
        confirm: Schema.Literal("reset-member"),
        reason,
    }),
    Schema.Struct({ type: Schema.Literal("reset-server"), confirm: Schema.Literal("reset-server"), reason }),
    Schema.Struct({ type: Schema.Literal("reconcile"), userId: Schema.optionalKey(Id) }),
])
export type LevelingManageOperation = typeof LevelingManageOperation.Type
export const LevelingManageRequest = Schema.Struct({
    ...ModerationSource.fields,
    serverId: Id,
    actor: ModerationActor,
    operation: LevelingManageOperation,
})
export type LevelingManageRequest = typeof LevelingManageRequest.Type
export const LevelingManageResult = Schema.Union([
    Schema.Struct({ duplicate: Schema.Literal(true) }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings: LevelingSettings }),
    Schema.Struct({
        duplicate: Schema.Literal(false),
        type: Schema.Literal("profile"),
        profile: LevelingProfile,
        audit: LevelingAudit,
    }),
    Schema.Struct({
        duplicate: Schema.Literal(false),
        type: Schema.Literal("reset"),
        settings: LevelingSettings,
        audit: LevelingAudit,
    }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("reconcile"), queued: Schema.Boolean }),
])
export type LevelingManageResult = typeof LevelingManageResult.Type
export const LevelingLeaderboardCursor = Schema.Struct({
    ...origin,
    xp: Int(1, LEVELING_XP_CAP),
    userId: Id,
    scoreEpoch: Int(1),
})
export type LevelingLeaderboardCursor = typeof LevelingLeaderboardCursor.Type
export const LevelingQueryRequest = Schema.Struct({
    serverId: Id,
    actor: ModerationActor,
    member: LevelingMemberContext,
    observedAt: Millis,
    operation: Schema.Union([
        Schema.Struct({ type: Schema.Literal("settings") }),
        Schema.Struct({ type: Schema.Literal("rank"), userId: Schema.optionalKey(Id) }),
        Schema.Struct({ type: Schema.Literal("leaderboard"), cursor: Schema.optionalKey(LevelingLeaderboardCursor) }),
        Schema.Struct({ type: Schema.Literal("status") }),
        Schema.Struct({ type: Schema.Literal("audits"), beforeAuditNo: Schema.optionalKey(Int(1)) }),
    ]),
})
export type LevelingQueryRequest = typeof LevelingQueryRequest.Type
/**
 * A rank is one plus the members with more XP this season, and equal XP shares a rank, so tied is how many others share it.
 * A server whose counts are still being built has no rank yet
 */
export const LevelingRank = Schema.Union([
    Schema.Struct({ type: Schema.Literal("exact"), position: Int(1), tied: Int() }),
    Schema.Struct({ type: Schema.Literal("counting") }),
    Schema.Struct({ type: Schema.Literal("unranked") }),
])
export type LevelingRank = typeof LevelingRank.Type
export const LevelingQueryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings: LevelingSettings }),
    Schema.Struct({ type: Schema.Literal("rank"), profile: LevelingProfile, rank: LevelingRank }),
    Schema.Struct({
        type: Schema.Literal("leaderboard"),
        profiles: List(LevelingProfile, 10),
        nextCursor: Schema.optionalKey(LevelingLeaderboardCursor),
    }),
    Schema.Struct({
        type: Schema.Literal("status"),
        dirty: Int(),
        sweepPending: Schema.Boolean,
        profiles: Int(),
    }),
    Schema.Struct({
        type: Schema.Literal("audits"),
        audits: List(LevelingAudit, 10),
        nextBeforeAuditNo: Schema.optionalKey(Int(1)),
    }),
])
export type LevelingQueryResult = typeof LevelingQueryResult.Type
export const LevelingPreflightRequest = Schema.Struct({ serverId: Id, candidate: LevelingCandidate })
export type LevelingPreflightRequest = typeof LevelingPreflightRequest.Type
export const LevelingRejectReason = Schema.Literals([
    "disabled",
    "stale",
    "excluded",
    "cooldown",
    "duplicate",
    "policy",
    "membership",
    "fence",
])
export type LevelingRejectReason = typeof LevelingRejectReason.Type
/** nextAt is when the member earns again, in milliseconds, and comes only with a cooldown refusal and an award */
export const LevelingPreflightResult = Schema.Union([
    Schema.Struct({
        eligible: Schema.Literal(false),
        reason: LevelingRejectReason,
        nextAt: Schema.optionalKey(Millis),
    }),
    Schema.Struct({ eligible: Schema.Literal(true), policyRevision: Int(1), fence: LevelingFence }),
])
export type LevelingPreflightResult = typeof LevelingPreflightResult.Type
export const LevelingAwardRequest = Schema.Struct({
    ...LevelingPreflightRequest.fields,
    policyRevision: Int(1),
    fence: LevelingFence,
    member: LevelingMemberContext,
    observedAt: Millis,
})
export type LevelingAwardRequest = typeof LevelingAwardRequest.Type
export const LevelingAwardResult = Schema.Union([
    Schema.Struct({ awarded: Schema.Literal(false), reason: LevelingRejectReason, nextAt: Schema.optionalKey(Millis) }),
    Schema.Struct({
        awarded: Schema.Literal(true),
        nextAt: Schema.optionalKey(Millis),
        xpAdded: Int(0, 100),
        profile: LevelingProfile,
        rewardQueued: Schema.Boolean,
        /** The new level to announce and where, present only when a level-up message should post */
        levelUp: Schema.optionalKey(Schema.Struct({ level: Int(1), channelId: Schema.NullOr(Id) })),
    }),
])
export type LevelingAwardResult = typeof LevelingAwardResult.Type
/**
 * A reward pass lists up to twice as many of a member's retained level references as there can be rewards, so one pass holds every
 * reference of the current membership, and its targets are the earned rewards and the roles of those references
 */
export const LEVELING_REWARD_REFS = 2 * LEVELING_LIMITS.rewards
export const LevelingRewardAccount = Schema.Struct({
    userId: Id,
    mark: Int(1),
    refs: List(Schema.Struct({ roleId: Id, joinedAt: IsoTime }), LEVELING_REWARD_REFS),
    targets: List(
        Schema.Struct({ roleId: Id, sourceId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)) }),
        LEVELING_LIMITS.rewards + LEVELING_REWARD_REFS,
    ),
    complete: Schema.Boolean,
})
export type LevelingRewardAccount = typeof LevelingRewardAccount.Type
/** A skip retires a level reference of an earlier membership. currentJoinedAt is null only with explicit member absence evidence */
export const LevelingWorkRequest = Schema.Struct({
    serverId: Id,
    operation: Schema.Union([
        Schema.Struct({ type: Schema.Literal("list") }),
        Schema.Struct({
            ...origin,
            type: Schema.Literal("skip"),
            userId: Id,
            mark: Int(),
            roleId: Id,
            joinedAt: IsoTime,
            observedAt: Millis,
            currentJoinedAt: Schema.NullOr(IsoTime),
            memberAbsent: Schema.optionalKey(Schema.Literal(true)),
            memberUserId: Schema.optionalKey(Schema.String),
        }).check(
            Schema.makeFilter(
                (op) =>
                    (op.currentJoinedAt === null) === (op.memberAbsent === true) &&
                    (op.currentJoinedAt === null || Date.parse(op.currentJoinedAt) <= op.observedAt + 1000),
            ),
        ),
        // held is set only when the backend refused its role changes, which DEFCON does for additions, and nothing else was left
        // unsettled, so the backend may wait for DEFCON 3 instead of a minute. A removal refused for another reason also sets it.
        // Without it an unfinished pass is tried again a minute later
        Schema.Struct({
            type: Schema.Literal("done"),
            userId: Id,
            mark: Int(),
            complete: Schema.Boolean,
            held: Schema.optionalKey(Schema.Boolean),
        }),
    ]),
})
export type LevelingWorkRequest = typeof LevelingWorkRequest.Type
export const LevelingWorkResult = Schema.Union([
    Schema.Struct({
        type: Schema.Literal("accounts"),
        accounts: List(LevelingRewardAccount, 10),
        sweepPending: Schema.Boolean,
    }),
    Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean }),
])
export type LevelingWorkResult = typeof LevelingWorkResult.Type
