import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import { publishingConsumer, publishingProvenance, publishingSource } from "./publishingConsumers.ts"
import { scheduleCalendar, scheduleDeliveryReason, scheduleDeliveryState, scheduleSource } from "./schedulesValidators.ts"
import { levelingSettings } from "./levelingValidators.ts"
import { greetingsSettings, greetingsRoute, greetingsState, greetingsReason, greetingsGrant } from "./greetingsValidators.ts"
import { ticketSettings, ticketCategory, ticketIntakeCategory, ticketState, ticketGrant, ticketChannel, ticketOverwrite } from "./ticketValidators.ts"
import { responseKind, responseReply, responseTrigger } from "./responseValidators.ts"
import { publishingContent, publishingKind, publishingObservation, publishingOutcome } from "./publishingValidators.ts"
import { rolesAction, rolesKind, rolesMapping, rolesOutcome, rolesOwnershipStatus, rolesPanelSnapshot, rolesSettings, rolesWithdrawalStatus, rolesParticipationOperation } from "./rolesValidators.ts"
import { moderationSettings, automodRule, permissionOverwrite, providerObservation, moderationAction, moderationOrigin, moderationCaseOutcome,
    moderationDeliveryOutcome, securityRecoveryType, securityRecoveryStatus, securityIncidentKind, moderationAppealStatus,
    moderationCorrectionType, moderationWindowKind, moderationGrant } from "./moderationValidators.ts"

export default defineSchema({
    generalSettings: defineTable({ serverId: v.string(), prefix: v.string(), revision: v.number(), updatedAt: v.number(), updatedBy: v.string() }).index("by_server", ["serverId"]),
    scheduleSettings: defineTable({ serverId: v.string(), enabled: v.boolean(), revision: v.number(), activatedAt: v.number(), nextScheduleNo: v.number(), nextOccurrenceNo: v.number(), definitions: v.number(), deliveries: v.number(), receipts: v.number(), discoveryCursor: v.optional(v.string()), discoveryThroughAt: v.optional(v.number()) }).index("by_server", ["serverId"]),
    schedules: defineTable({ serverId: v.string(), scheduleNo: v.number(), name: v.string(), revision: v.number(), planRevision: v.number(), createdBy: v.string(), channelId: v.string(), calendar: scheduleCalendar, source: scheduleSource, content: publishingContent, canonicalContent: publishingContent, enabled: v.boolean(), cancelled: v.boolean(), activatedAt: v.number(), createdAt: v.number(), updatedAt: v.number() }).index("by_number", ["serverId", "scheduleNo"]).index("by_name", ["serverId", "name"]),
    scheduleDeliveries: defineTable({ serverId: v.string(), scheduleNo: v.number(), planRevision: v.number(), occurrenceNo: v.number(), channelId: v.string(), source: scheduleSource, content: publishingContent, canonicalContent: publishingContent, localMinute: v.string(), zone: v.string(), offsetMinutes: v.number(), dueAt: v.number(), state: scheduleDeliveryState, reason: v.optional(scheduleDeliveryReason), active: v.boolean(), nextCheckAt: v.number(), createdAt: v.number(), claimedAt: v.optional(v.number()), postNo: v.optional(v.number()), attemptId: v.optional(v.id("publishingAttempts")), historyExpiresAt: v.optional(v.number()) }).index("by_schedule_occurrence", ["serverId", "scheduleNo", "occurrenceNo"]).index("by_schedule_active_due", ["serverId", "scheduleNo", "active", "dueAt"]).index("by_discovery", ["serverId", "active", "nextCheckAt"]).index("by_global_due", ["active", "dueAt"]).index("by_history", ["historyExpiresAt"]),
    scheduleReceipts: defineTable({ serverId: v.string(), messageId: v.string(), actorId: v.string(), operationKey: v.string(), createdAt: v.number(), expiresAt: v.number() }).index("by_source", ["serverId", "messageId"]).index("by_expiry", ["expiresAt"]),
    levelingSettings: defineTable({ serverId: v.string(), config: levelingSettings, resetAt: v.optional(v.number()), profiles: v.number(), nextAuditNo: v.number(), dirty: v.number(), sweepAfterUserId: v.optional(v.string()), sweepPending: v.boolean() }).index("by_server", ["serverId"]),
    levelingProfiles: defineTable({ serverId: v.string(), userId: v.string(), xp: v.number(), scoreEpoch: v.number(), adjustmentRevision: v.number(), correctedAt: v.optional(v.number()), resetAt: v.optional(v.number()), joinedAt: v.optional(v.string()), lastEventAt: v.optional(v.number()), lastAwardAt: v.optional(v.number()), digestExpiresAt: v.optional(v.number()), digests: v.array(v.object({ digest: v.string(), creditedAt: v.number() })), rewardMark: v.optional(v.number()), rewardDueAt: v.optional(v.number()) }).index("by_user", ["serverId", "userId"]).index("by_reward_due", ["serverId", "rewardDueAt"]).index("by_score", ["serverId", "scoreEpoch", "xp", "userId"]).index("by_digest_expiry", ["digestExpiresAt"]),
    levelingAwardReceipts: defineTable({ serverId: v.string(), messageId: v.string(), userId: v.string(), createdAt: v.number(), digest: v.string(), expiresAt: v.number() }).index("by_source", ["serverId", "messageId"]).index("by_expiry", ["expiresAt"]),
    levelingManagementReceipts: defineTable({ serverId: v.string(), messageId: v.string(), actorId: v.string(), operationKey: v.string(), createdAt: v.number(), expiresAt: v.number() }).index("by_source", ["serverId", "messageId"]).index("by_expiry", ["expiresAt"]),
    levelingAudits: defineTable({ serverId: v.string(), auditNo: v.number(), actorId: v.string(), userId: v.optional(v.string()), beforeXp: v.optional(v.number()), afterXp: v.optional(v.number()), reason: v.string(), createdAt: v.number(), type: v.union(v.literal("adjust"), v.literal("reset-member"), v.literal("reset-server")), scoreEpoch: v.number(), expiresAt: v.number() }).index("by_number", ["serverId", "auditNo"]).index("by_expiry", ["expiresAt"]),
    ticketSettings: defineTable({
        serverId: v.string(),
        config: ticketSettings,
        nextCategoryRevision: v.number(),
        nextIntakeNo: v.number(),
        nextTicketNo: v.number(),
        nextEntryNo: v.number(),
        nextAttemptNo: v.number(),
        nextTranscriptNo: v.number(),
    })
        .index("by_server", ["serverId"]),
    ticketCategories: defineTable({
        serverId: v.string(),
        config: ticketCategory,
    })
        .index("by_name", ["serverId", "config.name"]),
    ticketIntakes: defineTable({
        serverId: v.string(),
        intakeNo: v.number(),
        generation: v.number(),
        category: ticketIntakeCategory,
        requesterId: v.string(),
        joinedAt: v.string(),
        answers: v.array(v.string()),
        state: v.union(v.literal("draft"), v.literal("submitted"), v.literal("cancelled"), v.literal("expired")),
        createdAt: v.number(),
        expiresAt: v.number(),
        ticketNo: v.optional(v.number()),
    })
        .index("by_number", ["serverId", "intakeNo"])
        .index("by_user", ["serverId", "requesterId", "state", "intakeNo"])
        .index("by_user_live", ["serverId", "requesterId", "state", "expiresAt"])
        .index("by_expiry", ["expiresAt"]),
    tickets: defineTable({
        serverId: v.string(),
        ticketNo: v.number(),
        intakeNo: v.number(),
        requesterId: v.string(),
        requesterJoinedAt: v.string(),
        category: ticketCategory,
        answers: v.array(v.string()),
        state: ticketState,
        generation: v.number(),
        botId: v.string(),
        createdAt: v.number(),
        channelId: v.optional(v.string()),
        channel: v.optional(ticketChannel),
        claimedBy: v.optional(v.string()),
        priority: v.union(v.literal("low"), v.literal("normal"), v.literal("high"), v.literal("urgent")),
        currentAttemptId: v.optional(v.id("ticketAttempts")),
        entryCount: v.number(),
        active: v.boolean(),
        nativeProtected: v.boolean(),
        bodiesProtected: v.boolean(),
        baselineOverwrites: v.optional(v.array(ticketOverwrite)),
        transition: v.optional(v.union(v.literal("close"), v.literal("reopen"))),
        completedSteps: v.number(),
        closedAt: v.optional(v.number()),
        retiredAt: v.optional(v.number()),
        tombstoneExpiresAt: v.optional(v.number()),
        bodyExpiresAt: v.optional(v.number()),
        erased: v.boolean(),
        erasing: v.boolean(),
    })
        .index("by_number", ["serverId", "ticketNo"])
        .index("by_user", ["serverId", "requesterId", "active", "ticketNo"])
        .index("by_active", ["serverId", "active"])
        .index("by_requester", ["serverId", "requesterId", "ticketNo"])
        .index("by_body_expiry", ["bodyExpiresAt"])
        .index("by_erasing", ["erasing"])
        .index("by_tombstone_expiry", ["tombstoneExpiresAt"])
        .index("by_channel", ["serverId", "channelId"]),
    ticketEntries: defineTable({
        serverId: v.string(),
        ticketNo: v.number(),
        entryNo: v.number(),
        authorId: v.string(),
        kind: v.union(v.literal("reply"), v.literal("note")),
        createdAt: v.number(),
        content: v.optional(publishingContent),
        erased: v.boolean(),
        attemptNo: v.optional(v.number()),
    })
        .index("by_ticket", ["serverId", "ticketNo", "entryNo"])
        .index("by_kind", ["serverId", "ticketNo", "kind", "entryNo"])
        .index("by_payload", ["serverId", "ticketNo", "erased"]),
    ticketAttempts: defineTable({
        serverId: v.string(),
        ticketNo: v.number(),
        attemptNo: v.number(),
        generation: v.number(),
        sourceId: v.string(),
        actorId: v.string(),
        grant: v.optional(ticketGrant),
        outcome: v.union(v.literal("pending"), v.literal("succeeded"), v.literal("failed"), v.literal("uncertain")),
        createdAt: v.number(),
        dispatchExpiresAt: v.number(),
        claimedAt: v.optional(v.number()),
        claimToken: v.optional(v.string()),
        finishedAt: v.optional(v.number()),
        noDispatch: v.optional(v.literal(true)),
        messageId: v.optional(v.string()),
        channelId: v.optional(v.string()),
        observationAt: v.optional(v.number()),
        resolved: v.optional(v.union(v.literal("before"), v.literal("desired"), v.literal("absent"))),
        redacted: v.boolean(),
        nativeDeleteConfirmed: v.optional(v.literal(true)),
        expiresAt: v.optional(v.number()),
    })
        .index("by_number", ["serverId", "ticketNo", "attemptNo"])
        .index("by_payload", ["serverId", "ticketNo", "redacted"])
        .index("by_pending", ["outcome", "dispatchExpiresAt"])
        .index("by_ticket_outcome", ["serverId", "ticketNo", "outcome", "resolved", "grant.action"])
        .index("by_expiry", ["expiresAt"]),
    ticketTranscripts: defineTable({
        serverId: v.string(),
        ticketNo: v.number(),
        sourceId: v.string(),
        actorId: v.string(),
        transcriptNo: v.number(),
        channelId: v.string(),
        capturedAt: v.number(),
        messageCount: v.number(),
        truncated: v.boolean(),
        body: v.optional(v.string()),
        createdAt: v.number(),
    })
        .index("by_number", ["serverId", "ticketNo", "transcriptNo"])
        .index("by_source", ["serverId", "sourceId"]),
    ticketReceipts: defineTable({
        serverId: v.string(),
        messageId: v.string(),
        actorId: v.string(),
        kind: v.union(v.literal("staff"), v.literal("user")),
        expiresAt: v.number(),
    })
        .index("by_source", ["serverId", "messageId"])
        .index("by_user", ["serverId", "actorId", "kind", "expiresAt"])
        .index("by_expiry", ["expiresAt"]),
    ticketRoleProtections: defineTable({
        serverId: v.string(),
        roleId: v.string(),
        configurationRefs: v.number(),
        nativeOwnershipRefs: v.number(),
        privateBodyRefs: v.number(),
        protected: v.boolean(),
    })
        .index("by_role", ["serverId", "roleId"])
        .index("by_protected", ["serverId", "protected"]),
    greetingSettings: defineTable({ serverId: v.string(), config: greetingsSettings, activatedAt: v.object({ welcome: v.number(), dm: v.number(), goodbye: v.number() }), nextGeneration: v.number(), nextDeliveryNo: v.number(), nextClaimAt: v.number() }).index("by_server", ["serverId"]),
    greetingMembers: defineTable({ serverId: v.string(), userId: v.string(), userName: v.string(), serverName: v.string(), joinedAt: v.string(), generation: v.number(), present: v.boolean(), observedAt: v.number(), expiresAt: v.number() }).index("by_server_user", ["serverId", "userId"]).index("by_expiry", ["expiresAt"]),
    greetingReceipts: defineTable({ serverId: v.string(), messageId: v.string(), expiresAt: v.number() }).index("by_source", ["serverId", "messageId"]).index("by_expiry", ["expiresAt"]),
    greetingDeliveries: defineTable({ serverId: v.string(), deliveryNo: v.number(), route: greetingsRoute, routeRevision: v.number(), templateName: v.string(), templateRevision: v.number(), content: publishingContent, userId: v.string(), joinedAt: v.string(), memberGeneration: v.number(), timing: v.union(v.literal("join"), v.literal("verified")), state: greetingsState, active: v.boolean(), createdAt: v.number(), pendingExpiresAt: v.number(), nextCheckAt: v.number(), reason: v.optional(greetingsReason), grant: v.optional(greetingsGrant), claimedAt: v.optional(v.number()), claimToken: v.optional(v.string()), finishedAt: v.optional(v.number()), noDispatch: v.optional(v.literal(true)), messageId: v.optional(v.string()), channelId: v.optional(v.string()), expiresAt: v.optional(v.number()) }).index("by_number", ["serverId", "deliveryNo"]).index("by_epoch_route", ["serverId", "userId", "joinedAt", "route"]).index("by_ready", ["serverId", "state", "nextCheckAt"]).index("by_member_state", ["serverId", "userId", "state", "nextCheckAt"]).index("by_member_epoch_state", ["serverId", "userId", "joinedAt", "state", "nextCheckAt"]).index("by_server", ["serverId"]).index("by_route_unclaimed", ["serverId", "route", "active", "claimedAt", "routeRevision"]).index("by_active_expiry", ["active", "claimedAt", "pendingExpiresAt"]).index("by_reserved", ["state", "grant.dispatchExpiresAt"]).index("by_expiry", ["expiresAt"]),
    roleSettings: defineTable({ serverId: v.string(), config: rolesSettings, nextPanelRevision: v.number() }).index("by_server", ["serverId"]),
    rolePanels: defineTable({ serverId: v.string(), name: v.string(), kind: rolesKind, revision: v.number(), enabled: v.boolean(), exclusive: v.boolean(), mappings: v.array(rolesMapping), published: v.optional(rolesPanelSnapshot), withdrawing: v.boolean() }).index("by_server_name", ["serverId", "name"]).index("by_server_kind", ["serverId", "kind"]).index("by_server_message", ["serverId", "published.messageId"]).index("by_native_message", ["serverId", "published.channelId", "published.messageId"]),
    roleAcknowledgments: defineTable({ serverId: v.string(), userId: v.string(), joinedAt: v.string(), rulesRevision: v.number(), panelName: v.string(), acknowledgedAt: v.number() }).index("by_server_member", ["serverId", "userId", "joinedAt"]).index("by_panel", ["serverId", "panelName", "rulesRevision"]),
    roleOwnership: defineTable({ serverId: v.string(), userId: v.string(), joinedAt: v.string(), roleId: v.string(), generation: v.number(), intentSourceId: v.optional(v.string()), owned: v.boolean(), protected: v.boolean(), status: rolesOwnershipStatus, attemptId: v.optional(v.id("roleAttempts")), updatedAt: v.number() }).index("by_server_member_role", ["serverId", "userId", "joinedAt", "roleId"]).index("by_server_role", ["serverId", "roleId", "protected"]),
    roleReferences: defineTable({ serverId: v.string(), consumerKey: v.string(), roleId: v.string(), configuration: v.boolean(), desired: v.boolean(), ownershipId: v.optional(v.id("roleOwnership")), postNo: v.optional(v.number()), userId: v.optional(v.string()), joinedAt: v.optional(v.string()), createdAt: v.number() }).index("by_configuration_key",["serverId","configuration","consumerKey","roleId"]).index("by_server_role", ["serverId", "roleId"]).index("by_consumer", ["serverId", "consumerKey", "configuration"]).index("by_owner", ["ownershipId", "consumerKey"]).index("by_server_post", ["serverId", "postNo"]).index("by_server_configuration_consumer", ["serverId", "configuration", "consumerKey"]).index("by_level_member", ["serverId", "consumerKey", "configuration", "userId", "joinedAt", "roleId"]),
    roleAttempts: defineTable({ serverId: v.string(), ownershipId: v.id("roleOwnership"), generation: v.number(), sourceId: v.string(), operationKey: v.string(), action: rolesAction, userId: v.string(), joinedAt: v.string(), roleId: v.string(), botId: v.string(), expectedPresent: v.boolean(), consumerKey: v.string(), dispatchExpiresAt: v.number(), nativeDeadlineMs: v.literal(5000), outcome: rolesOutcome, createdAt: v.number(), finishedAt: v.optional(v.number()), noDispatch: v.optional(v.literal(true)), dispatchedAt: v.optional(v.number()), claimToken: v.optional(v.string()), continued: v.optional(v.boolean()), reactionJob: v.optional(v.object({ jobId: v.id("roleReactionJobs"), generation: v.number(), claimToken: v.string(), pageStep: v.number(), index: v.number() })), expiresAt: v.optional(v.number()), observationAt: v.optional(v.number()) }).index("by_source", ["serverId", "sourceId", "createdAt"]).index("by_pending", ["outcome", "dispatchExpiresAt"]).index("by_server_pending", ["serverId", "outcome", "dispatchExpiresAt"]).index("by_expiry", ["expiresAt"]),
    roleReceipts: defineTable({ serverId: v.string(), messageId: v.string(), expiresAt: v.number() }).index("by_server_message", ["serverId", "messageId"]).index("by_expiry", ["expiresAt"]),
    roleParticipationReceipts: defineTable({ serverId: v.string(), sourceId: v.string(), expiresAt: v.number() }).index("by_source", ["serverId", "sourceId"]).index("by_expiry", ["expiresAt"]),
    roleWithdrawals: defineTable({ serverId: v.string(), consumerKey: v.string(), step: v.number(), status: rolesWithdrawalStatus, deletePanel: v.boolean(), createdAt: v.number(), expiresAt: v.optional(v.number()) }).index("by_consumer", ["serverId", "consumerKey"]).index("by_expiry", ["expiresAt"]),
    roleReactionJobs: defineTable({ serverId: v.string(), name: v.string(), revision: v.number(), messageId: v.string(), channelId: v.string(), generation: v.number(), pageStep: v.number(), status: v.union(v.literal("queued"), v.literal("running"), v.literal("blocked"), v.literal("complete"), v.literal("cancelled")), active: v.boolean(), rerun: v.boolean(), blockedWork: v.boolean(), cursor: v.optional(v.string()), pageEnd: v.optional(v.string()), pageHasMore: v.optional(v.boolean()), targets: v.array(v.object({ userId: v.string(), joinedAt: v.string() })), pageDone: v.array(v.number()), leaseToken: v.optional(v.string()), leaseExpiresAt: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number(), expiresAt: v.optional(v.number()) }).index("by_server_name", ["serverId", "name"]).index("by_server_active", ["serverId", "active"]).index("by_server", ["serverId"]).index("by_expiry", ["expiresAt"]),
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
