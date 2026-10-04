import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import { publishingConsumer, publishingProvenance, publishingSource } from "./publishingConsumers.ts"
import { scheduleCalendar, scheduleDeliveryReason, scheduleDeliveryState, scheduleSource } from "./schedulesValidators.ts"
import { responseKind, responseReply, responseTrigger } from "./responseValidators.ts"
import { publishingContent, publishingKind, publishingObservation, publishingOutcome } from "./publishingValidators.ts"
import { moderationSettings, automodRule, permissionOverwrite, providerObservation, moderationAction, moderationOrigin, moderationCaseOutcome,
    moderationDeliveryOutcome, securityRecoveryType, securityRecoveryStatus, securityIncidentKind, moderationAppealStatus,
    moderationCorrectionType, moderationWindowKind, moderationGrant } from "./moderationValidators.ts"

export default defineSchema({
    generalSettings: defineTable({ serverId: v.string(), prefix: v.string(), revision: v.number(), updatedAt: v.number(), updatedBy: v.string() }).index("by_server", ["serverId"]),
    scheduleSettings: defineTable({ serverId: v.string(), enabled: v.boolean(), revision: v.number(), activatedAt: v.number(), nextScheduleNo: v.number(), nextOccurrenceNo: v.number(), definitions: v.number(), deliveries: v.number(), receipts: v.number(), discoveryCursor: v.optional(v.string()), discoveryThroughAt: v.optional(v.number()) }).index("by_server", ["serverId"]),
    schedules: defineTable({ serverId: v.string(), scheduleNo: v.number(), name: v.string(), revision: v.number(), planRevision: v.number(), createdBy: v.string(), channelId: v.string(), calendar: scheduleCalendar, source: scheduleSource, content: publishingContent, canonicalContent: publishingContent, enabled: v.boolean(), cancelled: v.boolean(), activatedAt: v.number(), createdAt: v.number(), updatedAt: v.number() }).index("by_number", ["serverId", "scheduleNo"]).index("by_name", ["serverId", "name"]),
    scheduleDeliveries: defineTable({ serverId: v.string(), scheduleNo: v.number(), planRevision: v.number(), occurrenceNo: v.number(), channelId: v.string(), source: scheduleSource, content: publishingContent, canonicalContent: publishingContent, localMinute: v.string(), zone: v.string(), offsetMinutes: v.number(), dueAt: v.number(), state: scheduleDeliveryState, reason: v.optional(scheduleDeliveryReason), active: v.boolean(), nextCheckAt: v.number(), createdAt: v.number(), claimedAt: v.optional(v.number()), postNo: v.optional(v.number()), attemptId: v.optional(v.id("publishingAttempts")), historyExpiresAt: v.optional(v.number()) }).index("by_schedule_occurrence", ["serverId", "scheduleNo", "occurrenceNo"]).index("by_schedule_active_due", ["serverId", "scheduleNo", "active", "dueAt"]).index("by_discovery", ["serverId", "active", "nextCheckAt"]).index("by_global_due", ["active", "dueAt"]).index("by_history", ["historyExpiresAt"]),
    scheduleReceipts: defineTable({ serverId: v.string(), messageId: v.string(), actorId: v.string(), operationKey: v.string(), createdAt: v.number(), expiresAt: v.number() }).index("by_source", ["serverId", "messageId"]).index("by_expiry", ["expiresAt"]),
    publishingSettings: defineTable({ serverId: v.string(), enabled: v.boolean(), activatedAt: v.optional(v.number()), nextPostNo: v.number() }).index("by_server", ["serverId"]),
    publishingDrafts: defineTable({ serverId: v.string(), kind: publishingKind, name: v.string(), revision: v.number(), content: publishingContent, canonicalContent: publishingContent, createdAt: v.number(), updatedAt: v.number() }).index("by_server_kind_name", ["serverId", "kind", "name"]),
    publishingPosts: defineTable({ serverId: v.string(), postNo: v.number(), generation: v.number(), channelId: v.string(), botId: v.string(), messageId: v.optional(v.string()), outcome: publishingOutcome, createdAt: v.number(), updatedAt: v.number(), attemptId: v.optional(v.id("publishingAttempts")),
        confirmedContent: v.optional(publishingContent), confirmedCanonicalContent: v.optional(publishingContent), confirmedDraftRevision: v.optional(v.number()), consumer: v.optional(publishingConsumer),
    }).index("by_server_post", ["serverId", "postNo"]).index("by_schedule", ["serverId", "consumer.scheduleNo", "postNo"]).index("by_native_message", ["serverId", "channelId", "messageId"]),
    publishingAttempts: defineTable({ serverId: v.string(), postNo: v.number(), generation: v.number(), sourceId: v.string(), actorId: v.string(), botId: v.string(), action: v.union(v.literal("send"), v.literal("edit")), channelId: v.string(), messageId: v.optional(v.string()),
        draftKind: v.optional(publishingKind), draftName: v.optional(v.string()), draftRevision: v.optional(v.number()), source: v.optional(publishingSource), provenance: v.optional(publishingProvenance), consumer: v.optional(publishingConsumer), content: publishingContent, canonicalContent: publishingContent, expectedContent: v.optional(publishingContent),
        dispatchExpiresAt: v.number(), nativeDeadlineMs: v.literal(5000), dispatchedAt: v.optional(v.number()), claimToken: v.optional(v.string()),
        outcome: publishingOutcome, unresolved: v.boolean(), createdAt: v.number(), finishedAt: v.optional(v.number()), noDispatch: v.optional(v.literal(true)), expiresAt: v.optional(v.number()), observation: v.optional(publishingObservation),
        resolution: v.optional(v.object({ attemptId: v.string(), generation: v.number(), sourceId: v.string(), observedAt: v.number(), matched: v.union(v.literal("intended"), v.literal("previous")) })),
    }).index("by_server_post", ["serverId", "postNo"]).index("by_server_post_unresolved", ["serverId", "postNo", "unresolved"]).index("by_schedule_unresolved", ["serverId", "consumer.scheduleNo", "unresolved"]).index("by_expiry", ["expiresAt"]).index("by_pending", ["serverId", "outcome", "createdAt"]).index("by_global_pending", ["outcome", "createdAt"]).index("by_pending_deadline", ["serverId", "outcome", "dispatchExpiresAt"]).index("by_global_pending_deadline", ["outcome", "dispatchExpiresAt"]).index("by_native_message", ["serverId", "channelId", "messageId"]),
    publishingReceipts: defineTable({ serverId: v.string(), sourceId: v.string(), createdAt: v.number(), expiresAt: v.number() }).index("by_server_source", ["serverId", "sourceId"]).index("by_expiry", ["expiresAt"]),
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
