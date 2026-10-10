import { defineSchema, defineTable } from "convex/server"
import { configurationFamilyValidator } from "./configurationRevision.ts"
import { backupCategory, backupDisposition, backupItemState, backupObject, backupOriginState, backupResolution, backupStructureObject } from "./backupValidators.ts"
import { v } from "convex/values"
import { metadataCategoryCounts, metadataDeliveryValidator, metadataEventValidator, metadataRouteValidator, metadataEventRouteValidator, metadataPresentationValidator } from "./metadataLogsValidators.ts"
import { eventsAllocation, eventsCalendar, eventsChoice, eventsDate, eventsDeliveryState, eventsState, eventsTemplate } from "./eventsValidators.ts"
import { publishingConsumer, publishingProvenance, publishingSource } from "./publishingConsumers.ts"
import { scheduleCalendar, scheduleDeliveryReason, scheduleDeliveryState, scheduleSource } from "./schedulesValidators.ts"
import { milestoneBindingFields, milestoneFold, milestoneKind, milestoneReason, milestoneState, milestoneTemplate } from "./milestonesValidators.ts"
import { levelingSettings } from "./levelingValidators.ts"
import { greetingsSettings, greetingsRoute, greetingsState, greetingsReason, greetingsGrant } from "./greetingsValidators.ts"
import { ticketSettings, ticketCategory, ticketIntakeCategory, ticketState, ticketGrant, ticketChannel, ticketOverwrite } from "./ticketValidators.ts"
import { responseKind, responseReply, responseTrigger } from "./responseValidators.ts"
import { publishingContent, publishingKind, publishingObservation, publishingOutcome } from "./publishingValidators.ts"
import { rolesAction, rolesKind, rolesMapping, rolesOutcome, rolesOwnershipStatus, rolesPanelSnapshot, rolesSettings, rolesWithdrawalStatus, rolesParticipationOperation } from "./rolesValidators.ts"
import { moderationSettings, automodRule, permissionOverwrite, providerObservation, moderationAction, moderationOrigin, moderationCaseOutcome,
    moderationDeliveryOutcome, securityRecoveryType, securityRecoveryStatus, securityIncidentKind, moderationAppealStatus,
    moderationCorrectionType, moderationWindowKind, moderationGrant } from "./moderationValidators.ts"

import { suggestionState, suggestionChoice, suggestionCardState } from "./suggestionsValidators.ts"
import { setupProblem } from "./setupCheckValidators.ts"
import { cleanupBindingFields, cleanupTargetBindingFields, cleanupCounts, cleanupMessage, cleanupGrant, cleanupObservation, cleanupTargetState, cleanupPageItem } from "./cleanupValidators.ts"
import { memberAccessFields, rolePickerMenu, rolePickerRoleDisplay } from "./rolePickerValidators.ts"

export default defineSchema({
    // The single retention chain row. It holds the scheduled run's generation and lease, the last finished run and the passes isolated after failing
    retentionState: defineTable({ generation: v.number(), leaseUntil: v.number(), finishedAt: v.number(), isolated: v.array(v.string()) }),
    // Multi mode serves only active installations. Removed servers keep their data and removedAt until the purge, which holds purgeLeaseUntil while it runs
    serverInstallations: defineTable({ serverId: v.string(), status: v.union(v.literal("active"), v.literal("removed")), joinedAt: v.number(), lastSeenAt: v.number(), removedAt: v.optional(v.number()), purgeLeaseUntil: v.optional(v.number()) })
        .index("by_server", ["serverId"]).index("by_status_removed", ["status", "removedAt"]),
    // One row the bot subscribes to. Writers outside the bot raise version when they create work for it, see workSignal.ts
    workSignal: defineTable({ version: v.number() }),
    // The bot's billed function calls per UTC month, from its own reports, and whether the month's warning was sent, see usage.ts
    usageMonths: defineTable({ month: v.string(), calls: v.number(), warned: v.boolean() }).index("by_month", ["month"]),
    serverConfigurationRevisions: defineTable({ serverId: v.string(), family: configurationFamilyValidator, revision: v.number(), lastDashboardAt: v.optional(v.number()) }).index("by_family", ["serverId", "family"]),
    // The member family holds website role picker requests beside configuration jobs, with the same expiry and one-day retention
    dashboardConfigurationJobs: defineTable({ serverId: v.string(), family: v.union(configurationFamilyValidator, v.literal("member")), actorId: v.string(), sessionId: v.id("dashboardSessions"), requestId: v.string(), expectedConfigRevision: v.number(), operation: v.any(), state: v.union(v.literal("queued"), v.literal("applied"), v.literal("failed"), v.literal("conflict")), createdAt: v.number(), expiresAt: v.number(), cleanupAt: v.number(), error: v.optional(v.string()) }).index("by_request", ["sessionId", "serverId", "requestId"]).index("by_work", ["serverId", "state", "createdAt"]).index("by_family", ["serverId", "family", "createdAt"]).index("by_state", ["state", "createdAt"])
        .index("by_family_work", ["serverId", "family", "state", "createdAt"]).index("by_family_actor", ["serverId", "family", "actorId", "createdAt"]),
    verificationLinks: defineTable({ serverId: v.string(), userId: v.string(), joinedAt: v.string(), panelName: v.string(), rulesRevision: v.number(), publishedMessageId: v.string(), linkHash: v.string(), createdAt: v.number(), expiresAt: v.number(), linkExpiresAt: v.number(), lastIssuedAt: v.number(), status: v.union(v.literal("issued"), v.literal("started"), v.literal("solved"), v.literal("failed"), v.literal("expired"), v.literal("redeemed")), startedAt: v.optional(v.number()), solveExpiresAt: v.optional(v.number()), motionSeed: v.optional(v.string()), pathAnswers: v.optional(v.array(v.number())), pathSelections: v.optional(v.array(v.number())), pathRound: v.optional(v.number()), attempts: v.number(), solvedAt: v.optional(v.number()), redeemedAt: v.optional(v.number()), sourceId: v.string(), reviewedBy: v.optional(v.string()), reviewedAt: v.optional(v.number()), sessionId: v.optional(v.string()), deliveryClaimedAt: v.optional(v.number()), deliveryClaimToken: v.optional(v.string()), deliveryOutcome: v.optional(v.union(v.literal("succeeded"), v.literal("failed"))) }).index("by_hash", ["linkHash"]).index("by_member", ["serverId", "userId"]).index("by_expiry", ["expiresAt"]).index("by_ready", ["serverId", "status", "deliveryOutcome", "createdAt"]).index("by_server", ["serverId", "createdAt"]).index("by_global_ready", ["status", "deliveryOutcome", "createdAt"]),
    dashboardSessions: defineTable({ tokenHash: v.string(), accessToken: v.string(), userId: v.string(), userName: v.string(), servers: v.array(v.object({ id: v.string(), name: v.string() })), memberServers: v.optional(v.array(v.object({ id: v.string(), name: v.string() }))), expiresAt: v.number(), lifetimeAt: v.number() }).index("by_token", ["tokenHash"]).index("by_user", ["userId"]).index("by_expiry", ["expiresAt"]),
    dashboardMessageJobs: defineTable({ serverId: v.string(), actorId: v.string(), sessionId: v.id("dashboardSessions"), requestId: v.string(), channelId: v.string(), content: publishingContent, state: v.union(v.literal("queued"), v.literal("reserved"), v.literal("sent"), v.literal("failed"), v.literal("uncertain")), createdAt: v.number(), expiresAt: v.number(), cleanupAt: v.number(), error: v.optional(v.string()), messageId: v.optional(v.string()), attemptId: v.optional(v.id("publishingAttempts")) }).index("by_request", ["sessionId", "serverId", "requestId"]).index("by_work", ["serverId", "state", "createdAt"]).index("by_server", ["serverId", "createdAt"]).index("by_state", ["state", "createdAt"]),
    dashboardRoleJobs: defineTable({ serverId: v.string(), actorId: v.string(), sessionId: v.id("dashboardSessions"), requestId:v.optional(v.string()), section: v.union(v.literal("reaction"), v.literal("autorole"), v.literal("verification")), expectedRevision: v.number(), operation: v.any(), state: v.union(v.literal("queued"), v.literal("configured"), v.literal("applied"), v.literal("failed"), v.literal("conflict")), createdAt: v.number(), expiresAt: v.number(), cleanupAt: v.number(), error: v.optional(v.string()), result: v.optional(v.any()), attemptId: v.optional(v.id("publishingAttempts")), postNo: v.optional(v.number()), panelRevision: v.optional(v.number()), publication: v.optional(v.object({ channelId: v.string(), content: publishingContent })) }).index("by_request",["sessionId","serverId","requestId"]).index("by_work", ["serverId", "state", "createdAt"]).index("by_server", ["serverId", "createdAt"]).index("by_cleanup", ["cleanupAt"]).index("by_state", ["state", "createdAt"]),
    generalSettings: defineTable({ serverId: v.string(), prefix: v.string(), revision: v.number(), updatedAt: v.number(), updatedBy: v.string(), nickname: v.optional(v.string()), nicknameResult: v.optional(v.object({ state: v.union(v.literal("pending"), v.literal("applied"), v.literal("failed")), nickname: v.union(v.string(), v.null()), revision: v.number(), at: v.number(), actorId: v.string(), error: v.optional(v.string()) })) }).index("by_server", ["serverId"]),
    analyticsSettings: defineTable({ serverId: v.string(), enabled: v.boolean(), revision: v.number(), updatedAt: v.number(), updatedBy: v.string() }).index("by_server", ["serverId"]),
    // Shared member access lists by feature name, "rolepicker" first
    memberAccessLists: defineTable({ serverId: v.string(), feature: v.string(), ...memberAccessFields }).index("by_feature", ["serverId", "feature"]),
    rolePickerSettings: defineTable({ serverId: v.string(), enabled: v.boolean(), menus: v.array(rolePickerMenu) }).index("by_server", ["serverId"]),
    // A member's current role IDs and the names and colors of the server's menu roles from the last lookup, deleted ten minutes after the bot read them
    rolePickerSnapshots: defineTable({ serverId: v.string(), userId: v.string(), roleIds: v.array(v.string()), roles: v.optional(v.array(rolePickerRoleDisplay)), observedAt: v.number(), expiresAt: v.number() }).index("by_member", ["serverId", "userId"]),
    // One channel's messages on one UTC day, where hours[h] counts UTC hour h
    analyticsChannelDays: defineTable({ serverId: v.string(), channelId: v.string(), day: v.number(), count: v.number(), hours: v.array(v.number()) }).index("by_channel", ["serverId", "channelId", "day"]).index("by_day", ["day"]),
    // A server's messages on one UTC day in total, by UTC hour and by channel, so a dashboard range reads one row per day
    analyticsMessageDays: defineTable({ serverId: v.string(), day: v.number(), count: v.number(), hours: v.array(v.number()), channels: v.array(v.object({ channelId: v.string(), count: v.number() })) }).index("by_server", ["serverId", "day"]).index("by_day", ["day"]),
    analyticsDays: defineTable({ serverId: v.string(), day: v.number(), joins: v.number(), leaves: v.number() }).index("by_bucket", ["serverId", "day"]).index("by_day", ["day"]),
    // The highest applied batch of each bot worker run, so a resent batch is applied once
    analyticsFlushes: defineTable({ serverId: v.string(), session: v.string(), sequence: v.number(), updatedAt: v.number() }).index("by_session", ["serverId", "session"]).index("by_updated", ["updatedAt"]),
    dashboardMetadataJobs: defineTable({ serverId: v.string(), actorId: v.string(), sessionId: v.id("dashboardSessions"), requestId: v.string(), expectedConfigRevision: v.number(), operation: v.any(), state: v.union(v.literal("queued"), v.literal("applied"), v.literal("failed"), v.literal("conflict")), createdAt: v.number(), expiresAt: v.number(), cleanupAt: v.number(), error: v.optional(v.string()) }).index("by_request", ["sessionId", "serverId", "requestId"]).index("by_work", ["serverId", "state", "createdAt"]).index("by_server", ["serverId", "createdAt"]).index("by_state", ["state", "createdAt"]),
    // One permission check per server that the website asks the bot to run. The bot answers with what it lacks, never with member data
    dashboardSetupJobs: defineTable({ serverId: v.string(), state: v.union(v.literal("queued"), v.literal("done"), v.literal("failed")), createdAt: v.number(), expiresAt: v.number(), checkedAt: v.optional(v.number()),
        problems: v.array(setupProblem) }).index("by_server", ["serverId"]).index("by_state", ["state", "createdAt"]),
    backupPlans: defineTable({ serverId: v.string(), ownerId: v.string(), provider: v.string(), backupId: v.string(), messageId: v.string(), sourceCreatedAt: v.number(), archiveDigest: v.string(), manifestDigest: v.string(), planHash: v.string(), revision: v.literal(1), createdAt: v.number(), expiresAt: v.number(), cleanupAt: v.optional(v.number()), confirmedAt: v.optional(v.number()), itemCount: v.number(), counts: v.object({ create: v.number(), skip: v.number(), conflict: v.number(), blocked: v.number() }), forgotten: v.boolean() }).index("by_server", ["serverId"]).index("by_source", ["serverId", "messageId"]).index("by_cleanup", ["cleanupAt"]),
    backupItems: defineTable({ serverId: v.string(), planId: v.id("backupPlans"), itemNo: v.number(), generation: v.literal(1), category: backupCategory, family: v.string(), sourceId: v.string(), disposition: backupDisposition, reason: v.union(v.string(), v.null()), state: backupItemState, expectedHash: v.string(), desiredHash: v.string(), dependencyItemNo: v.union(v.number(), v.null()), mappedId: v.union(v.string(), v.null()), disabledOnCreate: v.boolean(), object: v.optional(backupObject), configMappings: v.optional(v.array(v.object({ sourceId: v.string(), targetId: v.union(v.string(), v.null()), targetItemNo: v.union(v.number(), v.null()) }))), desiredChannel: v.optional(backupStructureObject), returnedChannel: v.optional(backupStructureObject), originId: v.optional(v.id("backupOrigins")), dispatchExpiresAt: v.optional(v.number()), claimedAt: v.optional(v.number()), claimToken: v.optional(v.string()), botId: v.optional(v.string()), finishedAt: v.optional(v.number()), noDispatch: v.optional(v.literal(true)), historicalOutcome: v.optional(v.union(v.literal("created"), v.literal("failed"), v.literal("uncertain"))), resolution: v.optional(backupResolution) }).index("by_plan", ["planId", "itemNo"]).index("by_number", ["serverId", "planId", "itemNo"]).index("by_deadline", ["state", "dispatchExpiresAt"])
        .index("by_plan_unresolved", ["planId", "state", "resolution", "noDispatch"]),
    backupOrigins: defineTable({ provider: v.string(), serverId: v.string(), category: backupCategory, family: v.string(), sourceId: v.string(), state: backupOriginState, planId: v.id("backupPlans"), itemNo: v.number(), generation: v.literal(1), mappedId: v.union(v.string(), v.null()), desiredHash: v.string(), noDispatch: v.optional(v.literal(true)), resolved: v.optional(backupResolution) }).index("by_origin", ["serverId", "provider", "category", "family", "sourceId"]).index("by_server", ["serverId", "provider"]),
    // How many origins each server and provider holds, so restore capacity checks read one row
    backupOriginCounts: defineTable({ serverId: v.string(), provider: v.string(), count: v.number() }).index("by_provider", ["serverId", "provider"]),
    metadataLogSettings: defineTable({ serverId: v.string(), enabled: v.boolean(), revision: v.number(), configRevision: v.optional(v.number()), routes: v.array(metadataRouteValidator), eventRoutes: v.optional(v.array(metadataEventRouteValidator)), messageChannelIds: v.array(v.string()), excludedChannelIds: v.array(v.string()), retained: v.number(), nextRecordNo: v.number(), categories: metadataCategoryCounts, queued: v.number(), reserved: v.number(), failed: v.number(), uncertain: v.number(), admissions: v.number(), admissionWindowStartedAt: v.number(), refused: v.number(), suppressed: v.number(), operationNextAt: v.number(), receipts: v.number(), acceptedCreatedAt: v.optional(v.number()), acceptedMessageId: v.optional(v.string()) }).index("by_server", ["serverId"]),
    metadataLogRecords: defineTable({ serverId: v.string(), recordNo: v.number(), sourceKey: v.string(), event: metadataEventValidator, admittedAt: v.number(), expiresAt: v.number(), presentation: v.optional(metadataPresentationValidator), cleanupAt: v.optional(v.number()), delivery: v.union(metadataDeliveryValidator, v.null()), claimToken: v.optional(v.string()), actionable: v.boolean(), nextCheckAt: v.number() }).index("by_number", ["serverId", "recordNo"]).index("by_source", ["serverId", "sourceKey"]).index("by_work", ["serverId", "actionable", "nextCheckAt", "recordNo"]).index("by_cleanup", ["cleanupAt"]).index("by_deadline", ["delivery.state", "delivery.grant.dispatchExpiresAt"]).index("by_destination", ["serverId", "delivery.channelId"]).index("by_active_expiry", ["actionable", "expiresAt"]).index("by_global_work", ["actionable", "nextCheckAt"]),
    metadataLogAdmissions: defineTable({ serverId: v.string(), expiresAt: v.number() }).index("by_expiry", ["expiresAt"]).index("by_server", ["serverId", "expiresAt"]),
    metadataLogAttempts: defineTable({ serverId: v.string(), recordNo: v.number(), generation: v.number(), delivery: metadataDeliveryValidator, claimToken: v.optional(v.string()) }).index("by_binding", ["serverId", "recordNo", "generation"]).index("by_record", ["serverId", "recordNo"]),
    metadataLogReceipts: defineTable({ serverId: v.string(), messageId: v.string(), actorId: v.string(), operationKey: v.string(), expiresAt: v.number() }).index("by_source", ["serverId", "messageId"]).index("by_expiry", ["expiresAt"]),
    metadataLogCoreFences: defineTable({ serverId: v.string(), scope: v.literal("moderation"), createdAt: v.number(), messageId: v.string(), actorId: v.string(), operationKey: v.string() }).index("by_scope", ["serverId", "scope"]),
    voiceGenerators: defineTable({ serverId: v.string(), channelId: v.string(), categoryId: v.union(v.string(), v.null()), template: v.string(), userLimit: v.union(v.number(), v.null()), region: v.union(v.string(), v.null()), revision: v.number(), createdAt: v.number(), updatedAt: v.number() }).index("by_channel", ["serverId", "channelId"]),
    voiceRooms: defineTable({ serverId: v.string(), channelId: v.string(), ownerId: v.string(), generatorChannelId: v.string(), createdAt: v.number() }).index("by_channel", ["serverId", "channelId"]).index("by_owner", ["serverId", "ownerId"]),
    cleanupSettings: defineTable({ serverId: v.string(), enabled: v.boolean(), revision: v.number(), policies: v.number(), retainedTargets: v.number(), retainedSweeps: v.number(), receipts: v.number(), nextSweepNo: v.number(), nextTargetNo: v.number(), acceptedCreatedAt: v.optional(v.number()), acceptedMessageId: v.optional(v.string()) }).index("by_server", ["serverId"]),
    cleanupPolicies: defineTable({ serverId: v.string(), channelId: v.string(), revision: v.number(), enabled: v.boolean(), ageMs: v.number(), ownerId: v.string(), excludedAuthorIds: v.array(v.string()), excludedMessageIds: v.array(v.string()), nextCheckAt: v.number(), sweepNo: v.optional(v.number()), blockedReason: v.optional(v.string()), acceptedCreatedAt: v.optional(v.number()), acceptedMessageId: v.optional(v.string()) }).index("by_channel", ["serverId", "channelId"]).index("by_due", ["serverId", "enabled", "nextCheckAt"]).index("by_global_due", ["enabled", "nextCheckAt"]),
    cleanupSweeps: defineTable({ serverId: v.string(), ...cleanupBindingFields, ownerId: v.string(), cutoffAt: v.number(), before: v.string(), pageNo: v.number(), state: v.union(v.literal("active"), v.literal("complete"), v.literal("cancelled")), counts: cleanupCounts, createdAt: v.number(), updatedAt: v.number(), expiresAt: v.optional(v.number()) }).index("by_number", ["serverId", "sweepNo"]).index("by_expiry", ["expiresAt"]),
    cleanupPages: defineTable({ serverId: v.string(), ...cleanupBindingFields, pageNo: v.number(), before: v.string(), nextBefore: v.optional(v.string()), empty: v.boolean(), items: v.array(cleanupPageItem), persistedAt: v.number() }).index("by_sweep", ["serverId", "sweepNo"]),
    cleanupTargets: defineTable({ serverId: v.string(), ...cleanupTargetBindingFields, ownerId: v.string(), state: cleanupTargetState, message: cleanupMessage, active: v.boolean(), replayBlocked: v.boolean(), createdAt: v.number(), updatedAt: v.number(), grant: v.optional(cleanupGrant), claimedAt: v.optional(v.number()), claimToken: v.optional(v.string()), finishedAt: v.optional(v.number()), noDispatch: v.optional(v.literal(true)), expiresAt: v.optional(v.number()), reason: v.optional(v.string()), observation: v.optional(cleanupObservation), absenceObservedAt: v.optional(v.number()), lateOutcome: v.optional(v.union(v.literal("deleted"), v.literal("failed"), v.literal("uncertain"))), reassessedAt: v.optional(v.number()) }).index("by_number", ["serverId", "targetNo"]).index("by_page", ["serverId", "sweepNo", "pageNo", "targetNo"]).index("by_sweep_active", ["serverId", "sweepNo", "active"]).index("by_sweep_unresolved", ["serverId", "sweepNo", "replayBlocked", "expiresAt"]).index("by_message_active", ["serverId", "channelId", "messageId", "active"]).index("by_message_replay", ["serverId", "channelId", "messageId", "active", "replayBlocked"]).index("by_channel", ["serverId", "channelId", "targetNo"]).index("by_channel_active", ["serverId", "channelId", "active"]).index("by_channel_unresolved", ["serverId", "channelId", "replayBlocked", "expiresAt"]).index("by_server_deadline", ["serverId", "state", "grant.dispatchExpiresAt"]).index("by_recovery_unresolved", ["serverId", "replayBlocked", "expiresAt", "targetNo"]).index("by_deadline", ["state", "grant.dispatchExpiresAt"]).index("by_expiry", ["expiresAt"]),
    cleanupReceipts: defineTable({ serverId: v.string(), messageId: v.string(), actorId: v.string(), operationKey: v.string(), expiresAt: v.number() }).index("by_source", ["serverId", "messageId"]).index("by_expiry", ["expiresAt"]),
    suggestionSettings: defineTable({ serverId: v.string(), enabled: v.boolean(), revision: v.number(), channelId: v.optional(v.string()), nextSuggestionNo: v.number(), suggestions: v.number(), voters: v.number(), staffReceipts: v.number(), memberReceipts: v.number(), dirty: v.number(), blocked: v.number(), acceptedCreatedAt: v.optional(v.number()), acceptedMessageId: v.optional(v.string()) }).index("by_server", ["serverId"]),
    suggestions: defineTable({ serverId: v.string(), suggestionNo: v.number(), revision: v.number(), authorId: v.string(), authorJoinedAt: v.string(), channelId: v.string(), text: v.string(), state: suggestionState, up: v.number(), down: v.number(), voters: v.number(), desiredRevision: v.number(), publishedRevision: v.number(), cardGeneration: v.number(), cardState: suggestionCardState, dirty: v.boolean(), dueAt: v.number(), nextCheckAt: v.number(), createdAt: v.number(), updatedAt: v.number(), sourceId: v.string(), sourceCreatedAt: v.number(), sourceKey: v.string(), acceptedCreatedAt: v.number(), acceptedMessageId: v.string(), reason: v.optional(v.string()), statusBy: v.optional(v.string()), statusAt: v.optional(v.number()), historyExpiresAt: v.optional(v.number()), cleanupAt: v.optional(v.number()), forgetting: v.boolean(), postNo: v.optional(v.number()), attemptId: v.optional(v.id("publishingAttempts")) }).index("by_number", ["serverId", "suggestionNo"]).index("by_source", ["serverId", "sourceId"]).index("by_channel", ["serverId", "channelId", "suggestionNo"]).index("by_channel_state", ["serverId", "channelId", "state", "suggestionNo"]).index("by_work", ["serverId", "dirty", "nextCheckAt"]).index("by_history", ["cleanupAt"]).index("by_global_work", ["dirty", "nextCheckAt"]),
    suggestionVotes: defineTable({ serverId: v.string(), suggestionNo: v.number(), userId: v.string(), joinedAt: v.string(), choice: suggestionChoice, acceptedSourceKey: v.string(), acceptedCreatedAt: v.number(), acceptedMessageId: v.string(), observedAt: v.number() }).index("by_suggestion_user", ["serverId", "suggestionNo", "userId"]),
    suggestionReceipts: defineTable({ serverId: v.string(), messageId: v.string(), actorId: v.string(), category: v.union(v.literal("staff"), v.literal("member")), operationKey: v.string(), createdAt: v.number(), expiresAt: v.number() }).index("by_source", ["serverId", "messageId"]).index("by_expiry", ["expiresAt"]),
    milestoneSettings: defineTable({ serverId: v.string(), enabled: v.boolean(), revision: v.number(), activatedAt: v.number(), accounts: v.number(), enrollments: v.number(), deliveries: v.number(), staffReceipts: v.number(), memberReceipts: v.number(), discoveryCursor: v.optional(v.string()), discoveryThroughAt: v.optional(v.number()) }).index("by_server", ["serverId"]),
    milestoneRoutes: defineTable({ serverId: v.string(), kind: milestoneKind, revision: v.number(), intentRevision: v.number(), audienceGeneration: v.number(), createdBy: v.string(), channelId: v.string(), zone: v.string(), time: v.string(), fold: milestoneFold, template: milestoneTemplate, content: publishingContent, canonicalContent: publishingContent, configured: v.boolean(), enabled: v.boolean(), activatedAt: v.number(), createdAt: v.number(), updatedAt: v.number() }).index("by_kind", ["serverId", "kind"]),
    milestoneMembers: defineTable({ serverId: v.string(), userId: v.string(), revision: v.number(), acceptedCreatedAt: v.number(), acceptedMessageId: v.string(), expiresAt: v.number() }).index("by_user", ["serverId", "userId"]).index("by_expiry", ["expiresAt"]),
    milestoneEnrollments: defineTable({ serverId: v.string(), userId: v.string(), kind: milestoneKind, revision: v.number(), joinedAt: v.string(), audienceGeneration: v.number(), channelId: v.string(), consentedAt: v.number(), observedAt: v.number(), monthDay: v.optional(v.string()), nextCheckAt: v.number(), nextYear: v.number(), generation: v.number(), deliveryId: v.optional(v.id("milestoneDeliveries")) }).index("by_user_kind", ["serverId", "userId", "kind"]).index("by_discovery", ["serverId", "nextCheckAt"]).index("by_member_epoch", ["serverId", "userId", "joinedAt"]).index("by_global_discovery", ["nextCheckAt"]),
    milestoneDeliveries: defineTable({ serverId: v.string(), ...milestoneBindingFields, channelId: v.string(), zone: v.string(), time: v.string(), fold: milestoneFold, dueAt: v.number(), offsetMinutes: v.number(), template: milestoneTemplate, content: publishingContent, active: v.boolean(), state: milestoneState, reason: v.optional(milestoneReason), nextCheckAt: v.number(), createdAt: v.number(), claimedAt: v.optional(v.number()), postNo: v.optional(v.number()), attemptId: v.optional(v.id("publishingAttempts")), historyExpiresAt: v.optional(v.number()) }).index("by_member_active", ["serverId", "userId", "active"]).index("by_route", ["serverId", "kind", "createdAt"]).index("by_history", ["historyExpiresAt"]).index("by_global_due", ["active", "dueAt"]),
    milestoneReceipts: defineTable({ serverId: v.string(), messageId: v.string(), actorId: v.string(), channelId: v.optional(v.string()), category: v.union(v.literal("staff"), v.literal("member")), operationKey: v.string(), createdAt: v.number(), receiptExpiresAt: v.optional(v.number()), expiresAt: v.number() }).index("by_source", ["serverId", "messageId"]).index("by_receipt_expiry", ["receiptExpiresAt"]).index("by_expiry", ["expiresAt"]),
    milestoneConsumed: defineTable({ serverId: v.string(), userId: v.string(), kind: milestoneKind, epoch: v.string(), year: v.number(), createdAt: v.number(), expiresAt: v.number() }).index("by_binding", ["serverId", "userId", "kind", "epoch", "year"]).index("by_expiry", ["expiresAt"]),
    scheduleSettings: defineTable({ serverId: v.string(), enabled: v.boolean(), revision: v.number(), activatedAt: v.number(), nextScheduleNo: v.number(), nextOccurrenceNo: v.number(), definitions: v.number(), deliveries: v.number(), receipts: v.number(), discoveryCursor: v.optional(v.string()), discoveryThroughAt: v.optional(v.number()) }).index("by_server", ["serverId"]),
    schedules: defineTable({ serverId: v.string(), scheduleNo: v.number(), name: v.string(), revision: v.number(), planRevision: v.number(), createdBy: v.string(), channelId: v.string(), calendar: scheduleCalendar, source: scheduleSource, content: publishingContent, canonicalContent: publishingContent, enabled: v.boolean(), cancelled: v.boolean(), activatedAt: v.number(), createdAt: v.number(), updatedAt: v.number() }).index("by_number", ["serverId", "scheduleNo"]).index("by_name", ["serverId", "name"]),
    scheduleDeliveries: defineTable({ serverId: v.string(), scheduleNo: v.number(), planRevision: v.number(), occurrenceNo: v.number(), channelId: v.string(), source: scheduleSource, content: publishingContent, canonicalContent: publishingContent, localMinute: v.string(), zone: v.string(), offsetMinutes: v.number(), dueAt: v.number(), state: scheduleDeliveryState, reason: v.optional(scheduleDeliveryReason), active: v.boolean(), nextCheckAt: v.number(), createdAt: v.number(), claimedAt: v.optional(v.number()), postNo: v.optional(v.number()), attemptId: v.optional(v.id("publishingAttempts")), historyExpiresAt: v.optional(v.number()) }).index("by_schedule_occurrence", ["serverId", "scheduleNo", "occurrenceNo"]).index("by_schedule_active_due", ["serverId", "scheduleNo", "active", "dueAt"]).index("by_discovery", ["serverId", "active", "nextCheckAt"]).index("by_global_due", ["active", "dueAt"]).index("by_history", ["historyExpiresAt"]),
    scheduleReceipts: defineTable({ serverId: v.string(), messageId: v.string(), actorId: v.string(), operationKey: v.string(), createdAt: v.number(), expiresAt: v.number() }).index("by_source", ["serverId", "messageId"]).index("by_expiry", ["expiresAt"]),
    eventSettings: defineTable({ serverId: v.string(), enabled: v.boolean(), revision: v.number(), nextEventNo: v.number(), nextOccurrenceNo: v.number(), definitions: v.number(), occurrences: v.number(), rsvps: v.number(), receipts: v.number() }).index("by_server", ["serverId"]),
    events: defineTable({ serverId: v.string(), eventNo: v.number(), name: v.string(), revision: v.number(), channelId: v.string(), title: v.string(), description: v.string(), capacity: v.union(v.null(), v.number()), reminderOffsets: v.array(v.number()), state: eventsState, participationStarted: v.boolean(), calendar: v.optional(eventsCalendar), template: v.optional(eventsTemplate), cardPostNo: v.optional(v.number()), endsAt: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number(), activatedAt: v.optional(v.number()), terminalAt: v.optional(v.number()), historyExpiresAt: v.optional(v.number()), forgetting: v.optional(v.boolean()) })
        .index("by_number", ["serverId", "eventNo"]).index("by_name", ["serverId", "name"]).index("by_channel", ["serverId", "channelId", "eventNo"]).index("by_history", ["historyExpiresAt"]).index("by_state_end", ["state", "endsAt"]),
    eventOccurrences: defineTable({ serverId: v.string(), eventNo: v.number(), occurrenceNo: v.number(), revision: v.number(), date: eventsDate, state: eventsState, participationStarted: v.boolean(), capacity: v.union(v.null(), v.number()), going: v.number(), waitlisted: v.number(), rsvps: v.number(), nextQueueOrder: v.number(), workGeneration: v.number(), workActive: v.boolean(), nextCheckAt: v.number(), workAfterQueue: v.optional(v.number()), workResetAt: v.optional(v.number()), claimToken: v.optional(v.string()), leaseExpiresAt: v.optional(v.number()), headId: v.optional(v.id("eventRsvps")), terminalAt: v.optional(v.number()), participationExpiresAt: v.optional(v.number()) }).index("by_number", ["serverId", "eventNo", "occurrenceNo"]).index("by_event", ["serverId", "eventNo"]).index("by_work", ["serverId", "workActive", "nextCheckAt"]).index("by_state_start", ["state", "date.startsAt"]).index("by_state_end", ["state", "date.endsAt"]).index("by_participation_expiry", ["participationExpiresAt"]).index("by_global_work", ["workActive", "nextCheckAt"]),
    eventRsvps: defineTable({ serverId: v.string(), eventNo: v.number(), occurrenceNo: v.number(), userId: v.string(), joinedAt: v.string(), membershipGeneration: v.number(), revision: v.number(), choice: eventsChoice, allocation: eventsAllocation, queueOrder: v.optional(v.number()), deferredUntil: v.optional(v.number()), acceptedCreatedAt: v.number(), acceptedMessageId: v.string(), observedAt: v.number(), createdAt: v.number() }).index("by_member", ["serverId", "userId", "eventNo", "occurrenceNo"]).index("by_queue", ["serverId", "eventNo", "occurrenceNo", "allocation", "queueOrder"]).index("by_occurrence", ["serverId", "eventNo", "occurrenceNo", "userId"]),
    eventReceipts: defineTable({ serverId: v.string(), messageId: v.string(), operationKey: v.string(), actorId: v.string(), createdAt: v.number(), expiresAt: v.number() }).index("by_source", ["serverId", "messageId"]).index("by_expiry", ["expiresAt"]),
    eventDeliveries: defineTable({ serverId: v.string(), eventNo: v.number(), occurrenceNo: v.number(), revision: v.number(), channelId: v.string(), offsetMinutes: v.number(), dueAt: v.number(), startsAt: v.number(), state: eventsDeliveryState, nextCheckAt: v.number(), claimedAt: v.optional(v.number()), postNo: v.optional(v.number()), attemptId: v.optional(v.id("publishingAttempts")), createdAt: v.number() }).index("by_event", ["serverId", "eventNo"]).index("by_due", ["serverId", "state", "nextCheckAt"]).index("by_binding", ["serverId", "eventNo", "occurrenceNo", "revision", "offsetMinutes"]).index("by_post", ["serverId", "postNo"]).index("by_event_active", ["serverId", "eventNo", "state", "claimedAt"]).index("by_event_unattempted", ["serverId", "eventNo", "attemptId", "revision"]).index("by_due_unclaimed", ["serverId", "state", "claimedAt", "nextCheckAt"]).index("by_expiry", ["state", "startsAt"]).index("by_global_due", ["state", "claimedAt", "nextCheckAt"]),
    // ranked is set once every profile with XP in the current epoch is counted in levelingLevels. Settings from before rank
    // counts are counted from rankAfterUserId by the retention chain
    levelingSettings: defineTable({ serverId: v.string(), config: levelingSettings, resetAt: v.optional(v.number()), profiles: v.number(), nextAuditNo: v.number(), dirty: v.number(), sweepAfterUserId: v.optional(v.string()), sweepPending: v.boolean(), ranked: v.optional(v.boolean()), rankAfterUserId: v.optional(v.string()) }).index("by_server", ["serverId"]).index("by_sweep", ["sweepPending"]).index("by_ranked", ["ranked"]),
    // rankLevel is the level a profile with XP is counted under in levelingLevels for its own scoreEpoch
    levelingProfiles: defineTable({ serverId: v.string(), userId: v.string(), xp: v.number(), scoreEpoch: v.number(), adjustmentRevision: v.number(), correctedAt: v.optional(v.number()), resetAt: v.optional(v.number()), joinedAt: v.optional(v.string()), lastEventAt: v.optional(v.number()), lastAwardAt: v.optional(v.number()), digestExpiresAt: v.optional(v.number()), digests: v.array(v.object({ digest: v.string(), creditedAt: v.number() })), rewardMark: v.optional(v.number()), rewardDueAt: v.optional(v.number()), rankLevel: v.optional(v.number()) }).index("by_user", ["serverId", "userId"]).index("by_reward_due", ["serverId", "rewardDueAt"]).index("by_score", ["serverId", "scoreEpoch", "xp", "userId"]).index("by_digest_expiry", ["digestExpiresAt"]).index("by_global_reward_due", ["rewardDueAt"]),
    // How many profiles with XP each level holds in a score epoch, so a rank sums at most 1,000 small rows
    levelingLevels: defineTable({ serverId: v.string(), scoreEpoch: v.number(), level: v.number(), count: v.number() }).index("by_level", ["serverId", "scoreEpoch", "level"]),
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
        // Active tickets for metadata counters. Rows from before the count start counting at their next active change
        activeTickets: v.optional(v.number()),
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
        // A plain DM reply finds the member's drafts on every server
        .index("by_requester_live", ["requesterId", "state", "expiresAt"])
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
        // Permission bits the current close owns. Tickets closed before thread support omit it and own SendMessages only
        ownedPermissions: v.optional(v.string()),
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
        // Captures from before page storage keep their whole body here. Newer captures store pages, the page count of an unerased body
        body: v.optional(v.string()),
        pages: v.optional(v.number()),
        createdAt: v.number(),
    })
        .index("by_number", ["serverId", "ticketNo", "transcriptNo"])
        .index("by_source", ["serverId", "sourceId"]),
    // One 1,500-character page of a transcript body, so lists and page reads never read whole bodies
    ticketTranscriptPages: defineTable({
        serverId: v.string(),
        ticketNo: v.number(),
        transcriptNo: v.number(),
        pageNo: v.number(),
        text: v.string(),
    }).index("by_page", ["serverId", "ticketNo", "transcriptNo", "pageNo"]),
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
    roleSettings: defineTable({ serverId: v.string(), config: rolesSettings, dashboardRevision: v.optional(v.number()), nextPanelRevision: v.number() }).index("by_server", ["serverId"]),
    rolePanels: defineTable({ serverId: v.string(), name: v.string(), kind: rolesKind, revision: v.number(), enabled: v.boolean(), exclusive: v.boolean(), mappings: v.array(rolesMapping), published: v.optional(rolesPanelSnapshot), withdrawing: v.boolean() }).index("by_server_name", ["serverId", "name"]).index("by_server_kind", ["serverId", "kind"]).index("by_server_message", ["serverId", "published.messageId"]).index("by_native_message", ["serverId", "published.channelId", "published.messageId"]),
    roleAcknowledgments: defineTable({ serverId: v.string(), userId: v.string(), joinedAt: v.string(), rulesRevision: v.number(), panelName: v.string(), acknowledgedAt: v.number(), advancedVerified: v.optional(v.boolean()) }).index("by_server_member", ["serverId", "userId", "joinedAt"]).index("by_panel", ["serverId", "panelName", "rulesRevision"]),
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
    }).index("by_server_post", ["serverId", "postNo"]).index("by_event", ["serverId", "consumer.eventNo", "postNo"]).index("by_schedule", ["serverId", "consumer.scheduleNo", "postNo"]).index("by_suggestion", ["serverId", "consumer.suggestionNo", "postNo"]).index("by_native_message", ["serverId", "channelId", "messageId"]),
    publishingAttempts: defineTable({ serverId: v.string(), postNo: v.number(), generation: v.number(), sourceId: v.string(), actorId: v.string(), botId: v.string(), action: v.union(v.literal("send"), v.literal("edit")), channelId: v.string(), messageId: v.optional(v.string()),
        draftKind: v.optional(publishingKind), draftName: v.optional(v.string()), draftRevision: v.optional(v.number()), source: v.optional(publishingSource), provenance: v.optional(publishingProvenance), consumer: v.optional(publishingConsumer), content: publishingContent, canonicalContent: publishingContent, expectedContent: v.optional(publishingContent),
        dispatchExpiresAt: v.number(), nativeDeadlineMs: v.literal(5000), dispatchedAt: v.optional(v.number()), claimToken: v.optional(v.string()),
        outcome: publishingOutcome, unresolved: v.boolean(), createdAt: v.number(), finishedAt: v.optional(v.number()), noDispatch: v.optional(v.literal(true)), expiresAt: v.optional(v.number()), observation: v.optional(publishingObservation),
        resolution: v.optional(v.object({ attemptId: v.string(), generation: v.number(), sourceId: v.string(), observedAt: v.number(), matched: v.union(v.literal("intended"), v.literal("previous")) })),
    }).index("by_server_post", ["serverId", "postNo"]).index("by_server_post_unresolved", ["serverId", "postNo", "unresolved"]).index("by_event_unresolved", ["serverId", "consumer.eventNo", "unresolved"]).index("by_schedule_unresolved", ["serverId", "consumer.scheduleNo", "unresolved"]).index("by_suggestion_unresolved", ["serverId", "consumer.suggestionNo", "unresolved"]).index("by_expiry", ["expiresAt"]).index("by_pending", ["serverId", "outcome", "createdAt"]).index("by_global_pending", ["outcome", "createdAt"]).index("by_pending_deadline", ["serverId", "outcome", "dispatchExpiresAt"]).index("by_global_pending_deadline", ["outcome", "dispatchExpiresAt"]).index("by_native_message", ["serverId", "channelId", "messageId"]),
    publishingReceipts: defineTable({ serverId: v.string(), sourceId: v.string(), createdAt: v.number(), expiresAt: v.number() }).index("by_server_source", ["serverId", "sourceId"]).index("by_expiry", ["expiresAt"]),
    // Retained cases are nextCaseNo - 1 - casesRemoved, because retention is the only deletion before the server's purge
    moderationSettings: defineTable({ serverId: v.string(), config: moderationSettings, nextCaseNo: v.number(), nextAppealNo: v.number(), casesRemoved: v.optional(v.number()) }).index("by_server", ["serverId"]),
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
    automodWindows: defineTable({ serverId: v.string(), userId: v.string(), channelId: v.optional(v.string()), parentChannelId: v.optional(v.string()), kind: moderationWindowKind, contentHash: v.optional(v.string()), timestamp: v.number(), expiresAt: v.number() })
        .index("by_server_user_time", ["serverId", "userId", "timestamp"]).index("by_server_kind_time", ["serverId", "kind", "timestamp"]).index("by_expiry", ["expiresAt"])
        .index("by_server_user_hash_time", ["serverId", "userId", "contentHash", "timestamp"]),
    automodRules: defineTable({ serverId: v.string(), name: v.string(), rule: automodRule }).index("by_server_name", ["serverId", "name"]),
    securityRecoveries: defineTable({ serverId: v.string(), generation: v.number(), type: securityRecoveryType, targetId: v.optional(v.string()), channelId: v.optional(v.string()), caseNo: v.number(), status: securityRecoveryStatus,
        expectedTimeoutUntil: v.optional(v.union(v.string(), v.null())), previousTimeoutUntil: v.optional(v.union(v.string(), v.null())),
        previousOverwrite: v.optional(permissionOverwrite), expectedOverwrite: v.optional(permissionOverwrite), ownedPermissions: v.optional(v.string()), createdAt: v.number(), knownDeadline: v.optional(v.number()),
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
    }).index("by_definition_user", ["definitionId", "userId"]).index("by_expiry", ["nextEligibleAt"]).index("by_server", ["serverId"]),
})
