import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import { responseKind, responseReply, responseTrigger } from "./responseValidators.ts"
import { moderationSettings, automodRule, permissionOverwrite, providerObservation, moderationAction, moderationOrigin, moderationCaseOutcome,
    moderationDeliveryOutcome, securityRecoveryType, securityRecoveryStatus, securityIncidentKind, moderationAppealStatus,
    moderationCorrectionType, moderationWindowKind, moderationGrant } from "./moderationValidators.ts"

export default defineSchema({
    generalSettings: defineTable({ serverId: v.string(), prefix: v.string(), revision: v.number(), updatedAt: v.number(), updatedBy: v.string() }).index("by_server", ["serverId"]),
    moderationSettings: defineTable({ serverId: v.string(), config: moderationSettings, nextCaseNo: v.number(), nextAppealNo: v.number() }).index("by_server", ["serverId"]),
    moderationCases: defineTable({ serverId: v.string(), caseNo: v.number(), sourceId: v.string(),
        action: moderationAction, origin: moderationOrigin, incident: v.optional(securityIncidentKind),
        actorId: v.optional(v.string()), targetId: v.optional(v.string()), channelId: v.optional(v.string()),
        reason: v.string(), ruleName: v.optional(v.string()), linkedCaseNo: v.optional(v.number()), createdAt: v.number(), expiresAt: v.number(),
        outcome: moderationCaseOutcome, logOutcome: moderationDeliveryOutcome, notificationOutcome: moderationDeliveryOutcome,
        erased: v.boolean(), voided: v.boolean(), blocksPublic: v.boolean(), grant: v.optional(moderationGrant),
        logChannelId: v.optional(v.string()), logMessageId: v.optional(v.string()), noticeMessageId: v.optional(v.string()),
        observation: v.optional(providerObservation), correctionCount: v.number(), recoveryId: v.optional(v.id("securityRecoveries")), dispatched: v.optional(v.boolean()),
    }).index("by_server_case", ["serverId", "caseNo"]).index("by_server_user", ["serverId", "targetId", "caseNo"]).index("by_server_source", ["serverId", "sourceId"])
        .index("by_server_incident", ["serverId", "incident", "createdAt"]).index("by_expiry", ["expiresAt"]).index("by_outcome", ["serverId", "outcome"])
        .index("by_log_outcome", ["serverId", "logOutcome"]).index("by_notice_outcome", ["serverId", "notificationOutcome"]),
    moderationCorrections: defineTable({ caseId: v.id("moderationCases"), actorId: v.string(), createdAt: v.number(), previousReason: v.string(), reason: v.string(), type: moderationCorrectionType }).index("by_case", ["caseId"]),
    moderationReceipts: defineTable({ serverId: v.string(), key: v.string(), expiresAt: v.number(), claimed: v.boolean(), blocked: v.boolean(), createCounted: v.boolean(), versions: v.array(v.string()) })
        .index("by_server_key", ["serverId", "key"]).index("by_expiry", ["expiresAt"]),
    automodWindows: defineTable({ serverId: v.string(), userId: v.string(), channelId: v.optional(v.string()), kind: moderationWindowKind, contentHash: v.optional(v.string()), timestamp: v.number(), expiresAt: v.number() })
        .index("by_server_user_time", ["serverId", "userId", "timestamp"]).index("by_server_kind_time", ["serverId", "kind", "timestamp"]).index("by_expiry", ["expiresAt"]),
    automodRules: defineTable({ serverId: v.string(), name: v.string(), rule: automodRule }).index("by_server_name", ["serverId", "name"]),
    securityRecoveries: defineTable({ serverId: v.string(), generation: v.number(), type: securityRecoveryType, targetId: v.optional(v.string()), channelId: v.optional(v.string()), caseNo: v.number(), status: securityRecoveryStatus,
        expectedTimeoutUntil: v.optional(v.union(v.string(), v.null())), previousTimeoutUntil: v.optional(v.union(v.string(), v.null())),
        previousOverwrite: v.optional(permissionOverwrite), expectedOverwrite: v.optional(permissionOverwrite), createdAt: v.number(), knownDeadline: v.optional(v.number()),
        reversalState: v.optional(v.object({ generation: v.number(), status: v.union(v.literal("active"), v.literal("uncertain")) })),
    }).index("by_server", ["serverId"]).index("by_server_target", ["serverId", "targetId"]).index("by_server_channel", ["serverId", "channelId"]).index("by_status_deadline", ["status", "knownDeadline"]),
    securityWatchlist: defineTable({ serverId: v.string(), userId: v.string(), reason: v.string(), createdAt: v.number() }).index("by_server_user", ["serverId", "userId"]),
    moderationAppeals: defineTable({ serverId: v.string(), appealNo: v.number(), caseNo: v.number(), userId: v.string(), text: v.string(), createdAt: v.number(), status: moderationAppealStatus, decisionReason: v.optional(v.string()), decidedAt: v.optional(v.number()), decidedBy: v.optional(v.string()), erased: v.boolean(), expiresAt: v.optional(v.number()) })
        .index("by_server_appeal", ["serverId", "appealNo"]).index("by_server_user", ["serverId", "userId"]).index("by_case_user", ["serverId", "caseNo", "userId"]).index("by_expiry", ["expiresAt"]),
    afkStatuses: defineTable({
        serverId: v.string(),
        userId: v.string(),
        reason: v.string(),
        since: v.number(),
    }).index("by_server_user", ["serverId", "userId"]),
    responseSettings: defineTable({
        serverId: v.string(), customEnabled: v.boolean(), autoEnabled: v.boolean(),
        customRevision: v.optional(v.number()), autoRevision: v.optional(v.number()),
    }).index("by_server", ["serverId"]),
    responseDefinitions: defineTable({
        serverId: v.string(), kind: responseKind, name: v.string(), reply: responseReply,
        trigger: v.optional(responseTrigger), channelIds: v.array(v.string()), roleIds: v.array(v.string()),
        cooldownSeconds: v.number(), priority: v.number(), enabled: v.boolean(),
        createdAt: v.number(), updatedAt: v.number(),
    }).index("by_server", ["serverId"])
        .index("by_server_kind_name", ["serverId", "kind", "name"]),
    responseReceipts: defineTable({ serverId: v.string(), messageId: v.string(), expiresAt: v.number() })
        .index("by_server_message", ["serverId", "messageId"]).index("by_expiry", ["expiresAt"]),
    responseCooldowns: defineTable({
        serverId: v.string(), definitionId: v.id("responseDefinitions"), userId: v.string(), nextEligibleAt: v.number(),
    }).index("by_definition_user", ["definitionId", "userId"]).index("by_expiry", ["nextEligibleAt"]),
})
