import { v } from "convex/values"

export const moderationAction = v.union(
    v.literal("log"), v.literal("warn"), v.literal("kick"), v.literal("ban"), v.literal("unban"),
    v.literal("timeout"), v.literal("untimeout"), v.literal("delete"), v.literal("purge"),
    v.literal("slowmode"), v.literal("lock"), v.literal("unlock"), v.literal("quarantine"), v.literal("release"),
)
export const moderationOrigin = v.union(v.literal("manual"), v.literal("automod"), v.literal("security"))
export const moderationCaseOutcome = v.union(v.literal("pending"), v.literal("succeeded"), v.literal("failed"), v.literal("uncertain"))
export const moderationDeliveryOutcome = v.union(v.literal("none"), v.literal("pending"), v.literal("sent"), v.literal("failed"), v.literal("uncertain"))
export const securityRecoveryType = v.union(v.literal("timeout"), v.literal("lock"), v.literal("ban"))
export const securityRecoveryStatus = v.union(v.literal("pending"), v.literal("active"), v.literal("uncertain"))
export const securityIncidentKind = v.union(v.literal("join-burst"), v.literal("honeypot"), v.literal("watchlist"))
export const moderationAppealStatus = v.union(v.literal("open"), v.literal("accepted"), v.literal("rejected"), v.literal("withdrawn"))
export const moderationCorrectionType = v.union(v.literal("reason"), v.literal("void"))
export const moderationWindowKind = v.union(v.literal("message"), v.literal("join"))

const enforcementMode = v.union(v.literal("dry-run"), v.literal("enforce"))
const nullableString = v.union(v.string(), v.null())

export const moderationSettings = v.object({
    staffRoleIds: v.object({
        moderation: v.array(v.string()),
        cases: v.array(v.string()),
        automod: v.array(v.string()),
        security: v.array(v.string()),
        appeals: v.array(v.string()),
    }),
    logChannelId: nullableString,
    manualModerationEnabled: v.boolean(),
    automodEnabled: v.boolean(),
    automodMode: enforcementMode,
    securityEnabled: v.boolean(),
    securityMode: enforcementMode,
    joinEnabled: v.boolean(),
    joinThreshold: v.number(),
    joinWindowSeconds: v.number(),
    joinDefcon2: v.boolean(),
    honeypotEnabled: v.boolean(),
    honeypotChannelIds: v.array(v.string()),
    watchlistEnabled: v.boolean(),
    appealsEnabled: v.boolean(),
    defcon: v.union(v.literal(1), v.literal(2), v.literal(3)),
})

export const automodRule = v.object({
    name: v.string(),
    type: v.union(v.literal("spam"), v.literal("repeat"), v.literal("mentions"), v.literal("words"), v.literal("domains"), v.literal("invites")),
    enabled: v.boolean(),
    priority: v.number(),
    action: v.union(v.literal("log"), v.literal("delete"), v.literal("warn"), v.literal("timeout")),
    threshold: v.number(),
    windowSeconds: v.number(),
    durationSeconds: v.number(),
    patterns: v.array(v.string()),
    domainMode: v.union(v.literal("block"), v.literal("allow")),
    channelIds: v.array(v.string()),
    exemptChannelIds: v.array(v.string()),
    exemptRoleIds: v.array(v.string()),
})

export const permissionOverwrite = v.object({ exists: v.boolean(), allow: v.string(), deny: v.string() })
export const providerObservation = v.object({
    observedAt: v.number(),
    timeoutUntil: v.optional(nullableString),
    banned: v.optional(v.boolean()),
    banExpiresAt: v.optional(nullableString),
    memberPresent: v.optional(v.boolean()),
    overwrite: v.optional(permissionOverwrite),
    slowmodeSeconds: v.optional(v.number()),
})

export const moderationGrant = v.object({
    actionId: v.string(),
    caseNo: v.number(),
    sourceId: v.string(),
    action: moderationAction,
    targetId: v.optional(v.string()),
    channelId: v.optional(v.string()),
    messageIds: v.optional(v.array(v.string())),
    durationSeconds: v.optional(v.number()),
    slowmodeSeconds: v.optional(v.number()),
    expectedSlowmodeSeconds: v.optional(v.number()),
    reason: v.string(),
    expectedTimeoutUntil: v.optional(nullableString),
    restoreTimeoutUntil: v.optional(nullableString),
    overwrite: v.optional(permissionOverwrite),
    expectedOverwrite: v.optional(permissionOverwrite),
    ownedPermissions: v.optional(v.string()),
    recoveryId: v.optional(v.string()),
})
