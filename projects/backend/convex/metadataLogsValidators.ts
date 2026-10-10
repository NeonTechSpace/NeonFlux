import { v } from "convex/values"
import { MetadataLogsDashboardScope, MetadataLogsDashboardSettingScope, MetadataLogsDeliveryState, MetadataLogsOutcome, MetadataLogsSettingsScope, metadataCategories, metadataEventSelectors, metadataEventTypes } from "@neonflux/contracts/metadata-logs"

// Stored enums follow the shared literals
const literals = <T extends string>(values: readonly T[]) => v.union(...values.map(value => v.literal(value)))
export const metadataCategoryValidator = literals(metadataCategories)
export const metadataEventTypeValidator = literals(metadataEventTypes)
export const metadataEventSelectorValidator = literals(metadataEventSelectors)
export const metadataEventValidator = v.object({
    category: metadataCategoryValidator,
    type: metadataEventTypeValidator,
    source: v.union(v.object({ kind: v.literal("audit"), auditEntryId: v.string() }), v.object({ kind: v.literal("message-delete"), messageId: v.string() }), v.object({ kind: v.literal("member-add"), userId: v.string(), joinedAt: v.string() }), v.object({ kind: v.literal("observation"), sessionId: v.string(), sequence: v.number() }), v.object({ kind: v.literal("settings"), messageId: v.string(), scope: literals(MetadataLogsSettingsScope.literals) }), v.object({ kind: v.literal("dashboard"), jobId: v.string(), scope: literals(MetadataLogsDashboardScope.literals) }), v.object({ kind: v.literal("dashboard-setting"), scope: literals(MetadataLogsDashboardSettingScope.literals), revision: v.number() })),
    actor: v.union(v.object({ kind: v.literal("unknown") }), v.object({ kind: v.union(v.literal("audit"), v.literal("configuration")), userId: v.string() })),
    observedAt: v.number(), resourceIds: v.array(v.string()), changedFields: v.array(v.string()), count: v.number(), channelId: v.optional(v.string()), parentChannelId: v.optional(v.string()), authorBot: v.optional(v.union(v.boolean(), v.null())), privateChannel: v.optional(v.boolean()), auditAction: v.optional(v.number()), outcome: v.optional(literals(MetadataLogsOutcome.literals)),
})
export const metadataRouteValidator = v.object({ category: metadataCategoryValidator, revision: v.number(), enabled: v.boolean(), channelId: v.optional(v.string()), ownerId: v.optional(v.string()) })
export const metadataEventRouteValidator = v.object({ eventType: metadataEventSelectorValidator, revision: v.number(), enabled: v.boolean(), channelId: v.optional(v.string()), ownerId: v.optional(v.string()) })
export const metadataEmbedValidator = v.object({ title: v.string(), description: v.string(), color: v.number() })
export const metadataPresentationValidator = v.object({ format: v.literal("embed-v1"), embed: metadataEmbedValidator })
export const metadataCategoryCounts = v.object({ membership: v.number(), resources: v.number(), messages: v.number(), audit: v.number(), settings: v.number(), operations: v.number() })
export const metadataBindingFields = { recordNo: v.number(), routeRevision: v.number(), moduleRevision: v.number(), generation: v.number(), channelId: v.string(), ownerId: v.string(), routeEventType: v.optional(metadataEventSelectorValidator) }
export const metadataGrantValidator = v.object({ ...metadataBindingFields, botId: v.string(), dispatchExpiresAt: v.number(), nativeDeadlineMs: v.literal(5000), content: v.literal(""), embed: metadataEmbedValidator })
export const metadataDeliveryValidator = v.object({ ...metadataBindingFields, state: literals(MetadataLogsDeliveryState.literals), nextCheckAt: v.number(), grant: v.optional(metadataGrantValidator), claimedAt: v.optional(v.number()), finishedAt: v.optional(v.number()), noDispatch: v.optional(v.literal(true)), messageId: v.optional(v.string()), reconciledAt: v.optional(v.number()), resolution: v.optional(v.union(v.literal("match"), v.literal("absent"))) })
