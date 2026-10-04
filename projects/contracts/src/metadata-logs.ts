import { Schema } from "effect"
import { Id, Int, IsoTime, List, Millis, Str } from "./common.ts"
import { CleanupContext } from "./cleanup.ts"

export const METADATA_RETENTION = 2592000000, METADATA_DAY = 86400000, METADATA_CAPACITY = 10000, METADATA_PAGE = 20, METADATA_GRANT_MS = 120000, METADATA_SETTLE_MS = 10000
export const metadataCategories = ["membership", "resources", "messages", "audit", "settings", "operations"] as const
export const metadataTypes = {
    membership: ["member-add", "member-update", "member-remove"],
    resources: ["role-create", "role-update", "role-delete", "channel-create", "channel-update", "channel-delete", "server-update"],
    messages: ["message-update", "message-delete", "message-bulk-delete"], audit: ["audit-entry"], settings: ["settings-change"],
    operations: ["backend-failure", "admission-failure", "delivery-failure", "gateway-discontinuity"],
} as const
/** Every event type, in category order */
export const metadataEventTypes: readonly typeof metadataTypes[keyof typeof metadataTypes][number][] = metadataCategories.flatMap(category => metadataTypes[category])
export const metadataChangedFields = {
    membership: ["roles", "nickname", "timeout", "pending"],
    resources: ["name", "permissions", "position", "parent", "type", "topic", "slowmode", "icon", "owner"],
    messages: ["update", "pinned", "flags"], audit: [],
    settings: ["manualModerationEnabled", "automodEnabled", "securityEnabled", "joinEnabled", "honeypotEnabled", "watchlistEnabled", "automodMode", "securityMode", "staffRoleIds", "logChannelId", "retentionDays", "joinWindowSeconds", "joinThreshold", "joinDefcon2", "honeypotChannelIds", "defcon", "enabled", "route", "messageChannelIds", "excludedChannelIds", "configuration"],
    operations: [],
} as const
export const metadataAuditActions = [1, 10, 11, 12, 13, 14, 15, 20, 22, 23, 24, 25, 26, 27, 28, 30, 31, 32] as const
export const metadataEventSelectors: readonly (typeof metadataEventTypes[number] | `audit-entry:${typeof metadataAuditActions[number]}`)[] = [...metadataEventTypes, ...metadataAuditActions.map(action => `audit-entry:${action}` as const)]
export const MetadataLogsAuditAction = Schema.Literals(metadataAuditActions)
export const MetadataLogsEventSelector = Schema.Literals(metadataEventSelectors)
const metadataLogCategories = metadataCategories
const text = (max = 4096) => Str(max).check(Schema.isMinLength(1))
const array = <S extends Schema.Top>(item: S, max = METADATA_PAGE) => List(item, max)

export const MetadataLogsCategory = Schema.Literals(metadataLogCategories)
export const MetadataLogsSettingsScope = Schema.Literals(["moderation", "metadata", "security"])
export const MetadataLogsOutcome = Schema.Literals(["observed", "accepted", "failed", "disconnected", "reconnected"])
export const MetadataLogsEventType = Schema.Literals(metadataEventTypes)
export const MetadataLogsSource = Schema.Union([Schema.Struct({ kind: Schema.Literal("audit"), auditEntryId: Id }), Schema.Struct({ kind: Schema.Literal("message-delete"), messageId: Id }),
    Schema.Struct({ kind: Schema.Literal("member-add"), userId: Id, joinedAt: text(64).check(Schema.makeFilter(v => Number.isFinite(Date.parse(v)))) }),
    Schema.Struct({ kind: Schema.Literal("observation"), sessionId: text(32).check(Schema.isPattern(/^[a-f0-9]{32}$/)), sequence: Int(1) }),
    Schema.Struct({ kind: Schema.Literal("settings"), messageId: Id, scope: MetadataLogsSettingsScope })])
export const MetadataLogsActor = Schema.Union([Schema.Struct({ kind: Schema.Literal("unknown") }), Schema.Struct({ kind: Schema.Literals(["audit", "configuration"]), userId: Id })])
export const MetadataLogsEvent = Schema.Struct({ category: MetadataLogsCategory, type: MetadataLogsEventType, source: Schema.mutableKey(MetadataLogsSource), observedAt: Int(), actor: MetadataLogsActor, resourceIds: array(Id), changedFields: array(text(64)), count: Int(1, 10000),
    channelId: Schema.optionalKey(Id), authorBot: Schema.optionalKey(Schema.NullOr(Schema.Boolean)), privateChannel: Schema.optionalKey(Schema.Boolean), auditAction: Schema.optionalKey(Int().check(Schema.makeFilter(v => (metadataAuditActions as readonly number[]).includes(v)))), outcome: Schema.optionalKey(MetadataLogsOutcome) }).check(Schema.makeFilter(v => {
        const prefixes: Record<MetadataLogsCategory, readonly string[]> = { membership: ["member-"], resources: ["role-", "channel-", "server-"], messages: ["message-"], audit: ["audit-entry"], settings: ["settings-change"], operations: ["backend-failure", "admission-failure", "delivery-failure", "gateway-discontinuity"] }
        return prefixes[v.category].some(p => v.type.startsWith(p)) && new Set(v.resourceIds).size === v.resourceIds.length && new Set(v.changedFields).size === v.changedFields.length
            && v.changedFields.every(f => (metadataChangedFields[v.category] as readonly string[]).includes(f))
            && (v.actor.kind === "unknown" || v.actor.kind === "audit" && v.category === "audit" || v.actor.kind === "configuration" && v.category === "settings")
            && (v.category === "audit" ? v.source.kind === "audit" && v.auditAction !== undefined && v.resourceIds.length === 1 : v.auditAction === undefined)
            && (v.type === "message-delete" ? v.source.kind === "message-delete" && v.resourceIds.includes(v.source.messageId) : true)
            && (v.type === "member-add" && v.source.kind === "member-add" ? v.resourceIds.includes(v.source.userId) : true)
            && (v.category === "settings" ? v.source.kind === "settings" : true)
            && (v.category === "audit" || v.category === "settings" || v.type === "message-delete" || v.type === "member-add" && v.source.kind === "member-add" || v.source.kind === "observation")
            && (v.category === "messages" ? v.channelId !== undefined && v.authorBot !== undefined && v.privateChannel !== undefined : v.authorBot === undefined && v.privateChannel === undefined)
            && (v.type === "message-bulk-delete" || v.category === "resources" ? v.count <= 1000 : v.category === "operations" || v.count === 1)
    }))
export const MetadataLogsEventInput = MetadataLogsEvent.check(Schema.makeFilter(v => v.source.kind !== "member-add" || Schema.is(IsoTime)(v.source.joinedAt)))
export const MetadataLogsRoute = Schema.Struct({ category: MetadataLogsCategory, revision: Int(1), enabled: Schema.Boolean, channelId: Schema.optionalKey(Id), ownerId: Schema.optionalKey(Id) }).check(Schema.makeFilter(v => !v.enabled || !!v.channelId && !!v.ownerId))
export const MetadataLogsEventRoute = Schema.Struct({ eventType: MetadataLogsEventSelector, revision: Int(1), enabled: Schema.Boolean, channelId: Schema.optionalKey(Id), ownerId: Schema.optionalKey(Id) }).check(Schema.makeFilter(v => (v.channelId === undefined) === (v.ownerId === undefined) && (!v.enabled || !!v.channelId && !!v.ownerId)))
export const MetadataLogsSettings = Schema.Struct({ enabled: Schema.Boolean, revision: Int(1), configRevision: Int(), routes: array(MetadataLogsRoute, 6), eventRoutes: array(MetadataLogsEventRoute, metadataEventSelectors.length), messageChannelIds: array(Id, 50), excludedChannelIds: array(Id, 50), retained: Int(0, 10000), admissions: Int(), admissionWindowStartedAt: Int(), capacity: Schema.Literal(10000), admissionCapacity: Schema.Literal(10000), retentionMs: Schema.Literal(2592000000), quotaPaused: Schema.Boolean, refused: Int(), suppressed: Int() }).check(Schema.makeFilter(v => v.routes.length === 6 && new Set(v.routes.map(r => r.category)).size === 6 && new Set(v.eventRoutes.map(r => r.eventType)).size === v.eventRoutes.length && new Set(v.messageChannelIds).size === v.messageChannelIds.length && new Set(v.excludedChannelIds).size === v.excludedChannelIds.length))
export const MetadataLogsBinding = Schema.Struct({ recordNo: Int(1), routeRevision: Int(1), moduleRevision: Int(1), generation: Int(1), channelId: Id, ownerId: Id, routeEventType: Schema.mutableKey(Schema.optionalKey(MetadataLogsEventSelector)) })
const bindingFields = MetadataLogsBinding.fields
export const MetadataLogsDeliveryState = Schema.Literals(["queued", "reserved", "sent", "failed", "uncertain", "cancelled"])
export const MetadataLogsEmbed = Schema.Struct({ title: text(256), description: text(4096), color: Int(0, 16777215) })
export const MetadataLogsGrant = Schema.Struct({ ...bindingFields, botId: Id, dispatchExpiresAt: Int(), nativeDeadlineMs: Schema.Literal(5000), content: Schema.Literal(""), embed: MetadataLogsEmbed })
export const MetadataLogsDelivery = Schema.Struct({ ...bindingFields, state: MetadataLogsDeliveryState, nextCheckAt: Int(), grant: Schema.optionalKey(MetadataLogsGrant), claimedAt: Schema.optionalKey(Int()), finishedAt: Schema.optionalKey(Int()), noDispatch: Schema.optionalKey(Schema.Literal(true)), messageId: Schema.optionalKey(Id), reconciledAt: Schema.optionalKey(Int()), resolution: Schema.optionalKey(Schema.Literals(["match", "absent"])) }).check(Schema.makeFilter(v => (!v.grant || sameMetadataLogBinding(v, v.grant)) && (!v.noDispatch || v.claimedAt === undefined) && (!v.resolution || v.reconciledAt !== undefined)))
export const MetadataLogsPresentation = Schema.Struct({ format: Schema.Literal("embed-v1"), embed: MetadataLogsEmbed })
export const MetadataLogsRecord = Schema.Struct({ recordNo: Int(1), event: MetadataLogsEvent, admittedAt: Int(), expiresAt: Int(), presentation: Schema.mutableKey(MetadataLogsPresentation), delivery: Schema.mutableKey(Schema.NullOr(MetadataLogsDelivery)) }).check(Schema.makeFilter(v => v.expiresAt >= v.admittedAt && (!v.delivery || v.delivery.recordNo === v.recordNo && (v.delivery.routeEventType === undefined || v.delivery.routeEventType === v.event.type || v.event.type === "audit-entry" && v.delivery.routeEventType === `audit-entry:${v.event.auditAction}`)
    && (!v.delivery.grant || v.delivery.grant.content === "" && equalMetadataEmbed(v.delivery.grant.embed, v.presentation.embed)))))
const definitions = Schema.Struct({ tickets: Schema.Literal("Active slots including reserved and recovery work"), moderation: Schema.Literal("Retained manual, event and critical cases"), metadata: Schema.Literal("Retained admitted records, not unique causal actions"), deliveries: Schema.Literal("Current delivery states, independent of event admission") })
export const MetadataLogsCounters = Schema.Struct({ activeTicketSlots: Int(), retainedModerationCases: Int(), retainedMetadataRecords: Int(0, 10000), categories: Schema.Struct({ membership: Int(), resources: Int(), messages: Int(), audit: Int(), settings: Int(), operations: Int() }), queued: Int(), reserved: Int(), failed: Int(), uncertain: Int(), refused: Int(), suppressed: Int(), definitions }).check(Schema.makeFilter(v => Object.values(v.categories).reduce((a, b) => a + b, 0) === v.retainedMetadataRecords && v.queued + v.reserved + v.failed + v.uncertain <= v.retainedMetadataRecords))
const metadataQueryResult = Schema.Union([Schema.Struct({ type: Schema.Literal("settings"), settings: MetadataLogsSettings }), Schema.Struct({ type: Schema.Literal("records"), records: array(MetadataLogsRecord), nextBeforeRecordNo: Schema.optionalKey(Int(1)) }), Schema.Struct({ type: Schema.Literal("record"), record: MetadataLogsRecord }), Schema.Struct({ type: Schema.Literal("counters"), counters: MetadataLogsCounters })])
export const MetadataLogsManageResult = Schema.Union([Schema.Struct({ duplicate: Schema.Literal(true) }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings: MetadataLogsSettings }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("forgotten"), recordNo: Int(1) }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("reconciled"), recorded: Schema.Boolean, record: MetadataLogsRecord })])
export const MetadataLogsWorkResult = Schema.Union([Schema.Struct({ type: Schema.Literal("work"), records: array(MetadataLogsRecord), nextCursor: Schema.optionalKey(text(8192)) }), Schema.Struct({ type: Schema.Literal("reserved"), grant: MetadataLogsGrant }), Schema.Struct({ type: Schema.Literal("claimed"), claimed: Schema.Boolean, grant: MetadataLogsGrant }), Schema.Struct({ type: Schema.Literal("record"), record: MetadataLogsRecord })])
export const MetadataLogsAdmitResult = Schema.Union([Schema.Struct({ admitted: Schema.Literal(true), duplicate: Schema.Literal(false), record: MetadataLogsRecord }), Schema.Struct({ admitted: Schema.Literal(false), duplicate: Schema.Boolean, reason: Schema.Literals(["duplicate", "disabled", "excluded", "quota", "rate-limited"]) })])
/** actorAuthorized is destination View/Send, botAuthorized is View/Send/Embed/History. Neither is inferred from administrator status */
export const MetadataLogsContext = Schema.Struct({ ...CleanupContext.fields, channelType: Schema.Literals([0, 1, 5]) })
export const MetadataLogsPrivateRead = Schema.Struct({ channelId: Id, recipientIds: List(Id, Number.MAX_SAFE_INTEGER), oneToOne: Schema.Literal(true) })
export const MetadataLogsObservation = Schema.Struct({ messageId: Id, channelId: Id, botId: Id, observedAt: Millis, status: Schema.Literals(["match", "absent", "conflict", "unknown"]), content: Schema.optionalKey(Str(2000)), embed: Schema.optionalKey(MetadataLogsEmbed) })
const moduleOperation = Schema.Struct({ type: Schema.Literal("module"), expectedRevision: Int(), enabled: Schema.Boolean })
const channelsOperation = Schema.Struct({ type: Schema.Literal("channels"), expectedRevision: Int(), messageChannelIds: List(Id, 50).check(Schema.makeFilter(v => new Set(v).size === v.length)), excludedChannelIds: List(Id, 50).check(Schema.makeFilter(v => new Set(v).size === v.length)) })
const routeOperation = Schema.Struct({ type: Schema.Literal("route"), category: MetadataLogsCategory, expectedRevision: Int(), enabled: Schema.Boolean, channelId: Id, ownerId: Id })
const clearOperation = Schema.Struct({ type: Schema.Literal("clear"), category: MetadataLogsCategory, expectedRevision: Int() })
const eventRouteOperation = Schema.Struct({ type: Schema.Literal("event-route"), eventType: MetadataLogsEventSelector, expectedRevision: Int(), enabled: Schema.Boolean, channelId: Schema.optionalKey(Id), ownerId: Schema.optionalKey(Id) })
    .check(Schema.makeFilter(v => v.enabled ? v.channelId !== undefined && v.ownerId !== undefined : v.channelId === undefined && v.ownerId === undefined))
const eventClearOperation = Schema.Struct({ type: Schema.Literal("event-clear"), eventType: MetadataLogsEventSelector, expectedRevision: Int() })
export const MetadataConfigurationOperation = Schema.Union([moduleOperation, channelsOperation, routeOperation, clearOperation, eventRouteOperation, eventClearOperation])
export const MetadataLogsConfigurationOperation = Schema.Union([moduleOperation, channelsOperation, Schema.Struct({ ...routeOperation.fields, recipientOwner: MetadataLogsContext }), clearOperation, Schema.Struct({ ...eventRouteOperation.fields, recipientOwner: Schema.optionalKey(MetadataLogsContext) })
    .check(Schema.makeFilter(v => v.enabled ? v.channelId !== undefined && v.ownerId !== undefined : v.channelId === undefined && v.ownerId === undefined)), eventClearOperation])
export const MetadataLogsManageOperation = Schema.Union([MetadataLogsConfigurationOperation, Schema.Struct({ type: Schema.Literal("forget"), recordNo: Int(1), confirm: Schema.Literal(true) }), Schema.Struct({ type: Schema.Literal("reconcile"), binding: MetadataLogsBinding, observation: MetadataLogsObservation })])
export const MetadataLogsManageRequest = Schema.Struct({ serverId: Id, messageId: Id, createdAt: Millis, context: MetadataLogsContext, operation: MetadataLogsManageOperation })
export const MetadataLogsAdmitRequest = Schema.Struct({ serverId: Id, event: MetadataLogsEventInput })
export const MetadataLogsDiagnosticSection = Schema.Literals(["core", "logging", "modules", "destinations"])
export const MetadataLogsDiagnosticItem = Schema.Struct({ key: text(128), supported: Schema.Boolean, configured: Schema.Boolean, enabled: Schema.NullOr(Schema.Boolean), channelId: Schema.optionalKey(Id), ownerId: Schema.optionalKey(Id), roleIds: Schema.optionalKey(List(Id, 1000)), action: Schema.String })
export const MetadataLogsQueryOperation = Schema.Union([Schema.Struct({ type: Schema.Literal("settings") }), Schema.Struct({ type: Schema.Literal("list"), beforeRecordNo: Schema.optionalKey(Int(1)) }), Schema.Struct({ type: Schema.Literal("show"), recordNo: Int(1) }), Schema.Struct({ type: Schema.Literal("counters") }), Schema.Struct({ type: Schema.Literal("diagnose"), section: MetadataLogsDiagnosticSection, cursor: Schema.optionalKey(Str(8192)) })])
export const MetadataLogsQueryRequest = Schema.Struct({ serverId: Id, context: MetadataLogsContext, privateRead: Schema.optionalKey(MetadataLogsPrivateRead), operation: MetadataLogsQueryOperation })
export const MetadataLogsWorkOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("discover"), cursor: Schema.optionalKey(Str(8192)) }), Schema.Struct({ type: Schema.Literal("reserve"), binding: MetadataLogsBinding, context: MetadataLogsContext }),
    Schema.Struct({ type: Schema.Literal("claim"), binding: MetadataLogsBinding, context: MetadataLogsContext, claimToken: Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/)) }),
    Schema.Struct({ type: Schema.Literals(["defer", "no-dispatch"]), binding: MetadataLogsBinding }),
    Schema.Struct({ type: Schema.Literal("outcome"), binding: MetadataLogsBinding, claimToken: Schema.String, outcome: Schema.Literals(["sent", "failed", "uncertain"]), messageId: Schema.optionalKey(Id), observedAt: Millis }),
])
export const MetadataLogsWorkRequest = Schema.Struct({ serverId: Id, operation: MetadataLogsWorkOperation })
export function sameMetadataLogBinding(a: MetadataLogsBinding, b: MetadataLogsBinding) { return a.recordNo === b.recordNo && a.routeRevision === b.routeRevision && a.moduleRevision === b.moduleRevision && a.generation === b.generation && a.channelId === b.channelId && a.ownerId === b.ownerId && a.routeEventType === b.routeEventType }
export function equalMetadataEmbed(a: MetadataLogsEmbed | undefined, b: MetadataLogsEmbed | undefined) { return a === undefined || b === undefined ? a === b : a.title === b.title && a.description === b.description && a.color === b.color }

export const MetadataLogsQueryResult = Schema.Union([...metadataQueryResult.members, Schema.Struct({ type: Schema.Literal("diagnostics"), section: MetadataLogsDiagnosticSection, items: List(MetadataLogsDiagnosticItem, 20), nextCursor: Schema.optionalKey(Str(8192)), settings: Schema.optionalKey(MetadataLogsSettings), counters: Schema.optionalKey(MetadataLogsCounters) })])
export function metadataLogContent(recordNo: number, event: MetadataLogsEvent) {
    return [`Metadata #${recordNo}`, `Category: ${event.category}`, `Observation: ${event.type}`, `Actor: ${event.actor.kind === "unknown" ? "unknown" : event.actor.userId + " (" + event.actor.kind + ")"}`, `Resources: ${event.resourceIds.join(", ") || "none"}`, `Fields: ${event.changedFields.join(", ") || "none"}`, `Count: ${event.count}`, `Source: ${event.source.kind}`, `Observed: ${event.observedAt}`].join("\n")
}
export type MetadataLogsAuditAction = typeof MetadataLogsAuditAction.Type
export type MetadataLogsEventSelector = typeof MetadataLogsEventSelector.Type
export type MetadataLogsCategory = typeof MetadataLogsCategory.Type
export type MetadataLogsEventType = typeof MetadataLogsEventType.Type
export type MetadataLogsSource = typeof MetadataLogsSource.Type
export type MetadataLogsActor = typeof MetadataLogsActor.Type
export type MetadataLogsEvent = typeof MetadataLogsEvent.Type
export type MetadataLogsRoute = typeof MetadataLogsRoute.Type
export type MetadataLogsEventRoute = typeof MetadataLogsEventRoute.Type
export type MetadataLogsSettings = typeof MetadataLogsSettings.Type
export type MetadataLogsBinding = typeof MetadataLogsBinding.Type
export type MetadataLogsDeliveryState = typeof MetadataLogsDeliveryState.Type
export type MetadataLogsEmbed = typeof MetadataLogsEmbed.Type
export type MetadataLogsGrant = typeof MetadataLogsGrant.Type
export type MetadataLogsDelivery = typeof MetadataLogsDelivery.Type
export type MetadataLogsPresentation = typeof MetadataLogsPresentation.Type
export type MetadataLogsRecord = typeof MetadataLogsRecord.Type
export type MetadataLogsCounters = typeof MetadataLogsCounters.Type
export type MetadataLogsManageResult = typeof MetadataLogsManageResult.Type
export type MetadataLogsWorkResult = typeof MetadataLogsWorkResult.Type
export type MetadataLogsAdmitResult = typeof MetadataLogsAdmitResult.Type
export type MetadataLogsContext = typeof MetadataLogsContext.Type
export type MetadataLogsPrivateRead = typeof MetadataLogsPrivateRead.Type
export type MetadataLogsObservation = typeof MetadataLogsObservation.Type
export type MetadataConfigurationOperation = typeof MetadataConfigurationOperation.Type
export type MetadataLogsConfigurationOperation = typeof MetadataLogsConfigurationOperation.Type
export type MetadataLogsManageOperation = typeof MetadataLogsManageOperation.Type
export type MetadataLogsManageRequest = typeof MetadataLogsManageRequest.Type
export type MetadataLogsAdmitRequest = typeof MetadataLogsAdmitRequest.Type
export type MetadataLogsDiagnosticSection = typeof MetadataLogsDiagnosticSection.Type
export type MetadataLogsDiagnosticItem = typeof MetadataLogsDiagnosticItem.Type
export type MetadataLogsQueryOperation = typeof MetadataLogsQueryOperation.Type
export type MetadataLogsQueryRequest = typeof MetadataLogsQueryRequest.Type
export type MetadataLogsWorkOperation = typeof MetadataLogsWorkOperation.Type
export type MetadataLogsWorkRequest = typeof MetadataLogsWorkRequest.Type
export type MetadataLogsQueryResult = typeof MetadataLogsQueryResult.Type
export type MetadataLogsEventInput = typeof MetadataLogsEventInput.Type
