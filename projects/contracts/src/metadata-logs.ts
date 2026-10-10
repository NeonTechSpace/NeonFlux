import { Schema } from "effect"
import { Id, Int, IsoTime, List, Millis, Str, Token, origin } from "./common.ts"
import { CleanupContext } from "./cleanup.ts"

export const METADATA_RETENTION = 2592000000, METADATA_DAY = 86400000, METADATA_CAPACITY = 10000, METADATA_PAGE = 20, METADATA_GRANT_MS = 120000, METADATA_SETTLE_MS = 10000
export const metadataCategories = ["membership", "resources", "messages", "audit", "settings", "operations", "security"] as const
export const metadataTypes = {
    membership: ["member-add", "member-update", "member-remove"],
    resources: ["role-create", "role-update", "role-delete", "channel-create", "channel-update", "channel-delete", "thread-create", "thread-update", "thread-delete", "server-update"],
    messages: ["message-update", "message-delete", "message-bulk-delete"], audit: ["audit-entry"], settings: ["settings-change"],
    operations: ["backend-failure", "admission-failure", "delivery-failure", "gateway-discontinuity"],
    // Security alerts and invite logs, which the bot sends only for the alerts a server turned on
    security: ["invite-create", "invite-delete", "bot-join", "webhook-change", "privilege-change", "impersonation"],
} as const
export const metadataEventTypes = ["member-add", "member-update", "member-remove", "role-create", "role-update", "role-delete", "channel-create", "channel-update", "channel-delete", "thread-create", "thread-update", "thread-delete", "server-update", "message-update", "message-delete", "message-bulk-delete", "audit-entry", "settings-change", "backend-failure", "admission-failure", "delivery-failure", "gateway-discontinuity", "invite-create", "invite-delete", "bot-join", "webhook-change", "privilege-change", "impersonation"] as const
export const metadataChangedFields = {
    membership: ["roles", "nickname", "timeout", "pending"],
    resources: ["name", "permissions", "position", "parent", "type", "topic", "slowmode", "icon", "owner", "archived", "locked", "tags"],
    messages: ["update", "pinned", "flags"], audit: [],
    settings: ["manualModerationEnabled", "automodEnabled", "securityEnabled", "joinEnabled", "honeypotEnabled", "watchlistEnabled", "automodMode", "securityMode", "staffRoleIds", "logChannelId", "retentionDays", "joinWindowSeconds", "joinThreshold", "joinDefcon2", "honeypotChannelIds", "defcon", "enabled", "route", "messageChannelIds", "excludedChannelIds", "configuration"],
    operations: [],
    // Invite flags, webhook changes, how a privilege was gained and the dangerous permission names, and the matched name
    security: ["never-expires", "unlimited-uses", "created", "updated", "role-permissions", "member-roles", "Administrator", "ManageGuild", "ManageRoles", "ManageChannels", "ManageWebhooks", "BanMembers", "KickMembers", "ModerateMembers", "username", "nickname"],
} as const
export const metadataAuditActions = [1, 10, 11, 12, 13, 14, 15, 20, 22, 23, 24, 25, 26, 27, 28, 30, 31, 32] as const
export const metadataEventSelectors: Array<typeof metadataEventTypes[number] | `audit-entry:${typeof metadataAuditActions[number]}`> = [...metadataEventTypes, ...metadataAuditActions.map(action => `audit-entry:${action}` as const)]
export const MetadataLogsAuditAction = Schema.Literals(metadataAuditActions)
export const MetadataLogsEventSelector = Schema.Literals([...metadataEventTypes, ...metadataAuditActions.map(action => `audit-entry:${action}` as const)])
const metadataLogCategories = metadataCategories
const text = (max = 4096) => Str(max).check(Schema.isMinLength(1))
const array = <S extends Schema.Top>(item: S, max = METADATA_PAGE) => List(item, max)

export const MetadataLogsCategory = Schema.Literals(metadataLogCategories)
export const MetadataLogsEventType = Schema.Literals(metadataEventTypes)
export const MetadataLogsSource = Schema.Union([Schema.Struct({ kind: Schema.Literal("audit"), auditEntryId: Id }), Schema.Struct({ kind: Schema.Literal("message-delete"), messageId: Id }),
    Schema.Struct({ kind: Schema.Literal("member-add"), userId: Id, joinedAt: text(64).check(Schema.makeFilter(v => Number.isFinite(Date.parse(v)))) }),
    Schema.Struct({ kind: Schema.Literal("observation"), sessionId: text(32).check(Schema.isPattern(/^[a-f0-9]{32}$/)), sequence: Int(1) }),
    Schema.Struct({ kind: Schema.Literal("settings"), messageId: Id, scope: Schema.Literals(["moderation", "metadata", "security"]) }),
    Schema.Struct({ kind: Schema.Literal("dashboard"), jobId: Token, scope: Schema.Literals(["metadata", "roles", "responses", "moderation", "publishing", "greetings", "tickets", "leveling", "milestones", "suggestions", "cleanup", "events", "schedules", "nickname", "voice", "rolepicker", "temproles", "sticky", "sidebar", "memberlist", "alerts", "helpdesk", "onboarding", "presets", "lfg", "showcase", "profile", "youtube"]) }),
    Schema.Struct({ kind: Schema.Literal("dashboard-setting"), scope: Schema.Literals(["general", "responses"]), revision: Int(1) })])
/** event is an account the Fluxer event itself names, such as the creator of a new invite */
export const MetadataLogsActor = Schema.Union([Schema.Struct({ kind: Schema.Literal("unknown") }), Schema.Struct({ kind: Schema.Literals(["audit", "configuration", "event"]), userId: Id })])
// Security alerts may carry their own audit entry as source and actor
const auditAlert = (v: { type: string, source: { kind: string } }) => (v.type === "privilege-change" || v.type === "webhook-change") && v.source.kind === "audit"
export const MetadataLogsEvent = Schema.Struct({ ...origin, category: MetadataLogsCategory, type: MetadataLogsEventType, source: Schema.mutableKey(MetadataLogsSource), observedAt: Int(), actor: MetadataLogsActor, resourceIds: array(Id), changedFields: array(text(64)), count: Int(1, 10000),
    channelId: Schema.optionalKey(Id), /** The parent channel of a message's thread, or of the thread a thread event describes */
    parentChannelId: Schema.optionalKey(Id), authorBot: Schema.optionalKey(Schema.NullOr(Schema.Boolean)), privateChannel: Schema.optionalKey(Schema.Boolean), auditAction: Schema.optionalKey(Int().check(Schema.makeFilter(v => (metadataAuditActions as readonly number[]).includes(v)))), outcome: Schema.optionalKey(Schema.Literals(["observed", "accepted", "failed", "disconnected", "reconnected"])) }).check(Schema.makeFilter(v => {
        const prefixes: Record<MetadataLogsCategory, readonly string[]> = { membership: ["member-"], resources: ["role-", "channel-", "thread-", "server-"], messages: ["message-"], audit: ["audit-entry"], settings: ["settings-change"], operations: ["backend-failure", "admission-failure", "delivery-failure", "gateway-discontinuity"], security: ["invite-", "bot-join", "webhook-change", "privilege-change", "impersonation"] }
        return prefixes[v.category].some(p => v.type.startsWith(p)) && new Set(v.resourceIds).size === v.resourceIds.length && new Set(v.changedFields).size === v.changedFields.length
            && v.changedFields.every(f => (metadataChangedFields[v.category] as readonly string[]).includes(f))
            && (v.actor.kind === "unknown" || v.actor.kind === "audit" && (v.category === "audit" || auditAlert(v)) || v.actor.kind === "configuration" && v.category === "settings" || v.actor.kind === "event" && v.type === "invite-create")
            && (v.category === "audit" ? v.source.kind === "audit" && v.auditAction !== undefined && v.resourceIds.length === 1 : v.auditAction === undefined)
            && (v.type === "message-delete" ? v.source.kind === "message-delete" && v.resourceIds.includes(v.source.messageId) : true)
            && (v.type === "member-add" && v.source.kind === "member-add" ? v.resourceIds.includes(v.source.userId) : true)
            && (v.category === "settings" ? v.source.kind === "settings" || v.source.kind === "dashboard" || v.source.kind === "dashboard-setting" : true)
            && (v.category === "audit" || v.category === "settings" || v.type === "message-delete" || v.type === "member-add" && v.source.kind === "member-add" || auditAlert(v) || v.source.kind === "observation")
            && (v.category === "messages" ? v.channelId !== undefined && v.authorBot !== undefined && v.privateChannel !== undefined : v.authorBot === undefined && v.privateChannel === undefined)
            && (v.type.startsWith("thread-") ? v.parentChannelId !== undefined && !v.resourceIds.includes(v.parentChannelId)
                : v.parentChannelId === undefined || v.category === "messages" && v.parentChannelId !== v.channelId)
            && (v.type === "message-bulk-delete" || v.category === "resources" ? v.count <= 1000 : v.category === "operations" || v.count === 1)
    }))
export const MetadataLogsEventInput = MetadataLogsEvent.check(Schema.makeFilter(v => v.source.kind !== "member-add" || Schema.is(IsoTime)(v.source.joinedAt)))
export const MetadataLogsRoute = Schema.Struct({ category: MetadataLogsCategory, revision: Int(1), enabled: Schema.Boolean, channelId: Schema.optionalKey(Id), ownerId: Schema.optionalKey(Id) }).check(Schema.makeFilter(v => !v.enabled || !!v.channelId && !!v.ownerId))
export const MetadataLogsEventRoute = Schema.Struct({ eventType: MetadataLogsEventSelector, revision: Int(1), enabled: Schema.Boolean, channelId: Schema.optionalKey(Id), ownerId: Schema.optionalKey(Id) }).check(Schema.makeFilter(v => (v.channelId === undefined) === (v.ownerId === undefined) && (!v.enabled || !!v.channelId && !!v.ownerId)))
export const MetadataLogsSettings = Schema.Struct({ enabled: Schema.Boolean, revision: Int(1), configRevision: Int(), routes: array(MetadataLogsRoute, 7), eventRoutes: array(MetadataLogsEventRoute, metadataEventSelectors.length), messageChannelIds: array(Id, 50), excludedChannelIds: array(Id, 50), retained: Int(0, 10000), admissions: Int(), admissionWindowStartedAt: Int(), capacity: Schema.Literal(10000), admissionCapacity: Schema.Literal(10000), retentionMs: Schema.Literal(2592000000), quotaPaused: Schema.Boolean, refused: Int(), suppressed: Int() }).check(Schema.makeFilter(v => v.routes.length === 7 && new Set(v.routes.map(r => r.category)).size === 7 && new Set(v.eventRoutes.map(r => r.eventType)).size === v.eventRoutes.length && new Set(v.messageChannelIds).size === v.messageChannelIds.length && new Set(v.excludedChannelIds).size === v.excludedChannelIds.length))
export const MetadataLogsBinding = Schema.Struct({ recordNo: Int(1), routeRevision: Int(1), moduleRevision: Int(1), generation: Int(1), channelId: Id, ownerId: Id, routeEventType: Schema.mutableKey(Schema.optionalKey(MetadataLogsEventSelector)) })
const bindingFields = MetadataLogsBinding.fields
export const MetadataLogsDeliveryState = Schema.Literals(["queued", "reserved", "sent", "failed", "uncertain", "cancelled"])
export const MetadataLogsEmbed = Schema.Struct({ title: text(256), description: text(4096), color: Int(0, 16777215) })
export const MetadataLogsGrant = Schema.Struct({ ...bindingFields, botId: Id, dispatchExpiresAt: Int(), nativeDeadlineMs: Schema.Literal(5000), content: Schema.String.check(Schema.isMaxLength(2000)), embed: Schema.optionalKey(MetadataLogsEmbed) }).check(Schema.makeFilter(v => v.embed ? v.content === "" : v.content.length > 0))
export const MetadataLogsDelivery = Schema.Struct({ ...bindingFields, state: MetadataLogsDeliveryState, nextCheckAt: Int(), grant: Schema.optionalKey(MetadataLogsGrant), claimedAt: Schema.optionalKey(Int()), finishedAt: Schema.optionalKey(Int()), noDispatch: Schema.optionalKey(Schema.Literal(true)), messageId: Schema.optionalKey(Id), reconciledAt: Schema.optionalKey(Int()), resolution: Schema.optionalKey(Schema.Literals(["match", "absent"])) }).check(Schema.makeFilter(v => (!v.grant || sameMetadataLogBinding(v, v.grant)) && (!v.noDispatch || v.claimedAt === undefined) && (!v.resolution || v.reconciledAt !== undefined)))
export const MetadataLogsPresentation = Schema.Struct({ format: Schema.Literal("embed-v1"), embed: MetadataLogsEmbed })
export const MetadataLogsRecord = Schema.Struct({ recordNo: Int(1), event: MetadataLogsEvent, admittedAt: Int(), expiresAt: Int(), presentation: Schema.mutableKey(Schema.optionalKey(MetadataLogsPresentation)), delivery: Schema.mutableKey(Schema.NullOr(MetadataLogsDelivery)) }).check(Schema.makeFilter(v => v.expiresAt >= v.admittedAt && (!v.delivery || v.delivery.recordNo === v.recordNo && (v.delivery.routeEventType === undefined || v.delivery.routeEventType === v.event.type || v.event.type === "audit-entry" && v.delivery.routeEventType === `audit-entry:${v.event.auditAction}`)
    && (!v.delivery.grant || v.delivery.grant.content === (v.presentation ? "" : metadataLogContent(v.recordNo, v.event)) && equalMetadataEmbed(v.delivery.grant.embed, v.presentation?.embed)))))
const definitions = Schema.Struct({ tickets: Schema.Literal("Active slots including reserved and recovery work"), moderation: Schema.Literal("Retained manual, event and critical cases"), metadata: Schema.Literal("Retained admitted records, not unique causal actions"), deliveries: Schema.Literal("Current delivery states, independent of event admission") })
export const MetadataLogsCounters = Schema.Struct({ activeTicketSlots: Int(), retainedModerationCases: Int(), retainedMetadataRecords: Int(0, 10000), categories: Schema.Struct({ membership: Int(), resources: Int(), messages: Int(), audit: Int(), settings: Int(), operations: Int(), security: Int() }), queued: Int(), reserved: Int(), failed: Int(), uncertain: Int(), refused: Int(), suppressed: Int(), definitions }).check(Schema.makeFilter(v => Object.values(v.categories).reduce((a, b) => a + b, 0) === v.retainedMetadataRecords && v.queued + v.reserved + v.failed + v.uncertain <= v.retainedMetadataRecords))
const metadataQueryResult = Schema.Union([Schema.Struct({ type: Schema.Literal("settings"), settings: MetadataLogsSettings }), Schema.Struct({ type: Schema.Literal("records"), records: array(MetadataLogsRecord), nextBeforeRecordNo: Schema.optionalKey(Int(1)) }), Schema.Struct({ type: Schema.Literal("record"), record: MetadataLogsRecord }), Schema.Struct({ type: Schema.Literal("counters"), counters: MetadataLogsCounters })])
export const MetadataLogsManageResult = Schema.Union([Schema.Struct({ duplicate: Schema.Literal(true) }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings: MetadataLogsSettings }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("forgotten"), recordNo: Int(1) }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("reconciled"), recorded: Schema.Boolean, record: MetadataLogsRecord })])
export const MetadataLogsWorkResult = Schema.Union([Schema.Struct({ type: Schema.Literal("work"), records: array(MetadataLogsRecord), nextCursor: Schema.optionalKey(text(8192)) }), Schema.Struct({ type: Schema.Literal("reserved"), grant: MetadataLogsGrant }), Schema.Struct({ type: Schema.Literal("claimed"), claimed: Schema.Boolean, grant: MetadataLogsGrant }), Schema.Struct({ type: Schema.Literal("record"), record: MetadataLogsRecord })])
export const MetadataLogsAdmitResult = Schema.Union([Schema.Struct({ admitted: Schema.Literal(true), duplicate: Schema.Literal(false), record: MetadataLogsRecord }), Schema.Struct({ admitted: Schema.Literal(false), duplicate: Schema.Boolean, reason: Schema.Literals(["duplicate", "disabled", "excluded", "quota", "rate-limited"]) })])
/** actorAuthorized is destination View/Send, botAuthorized is View/Send/Embed/History. Neither is inferred from administrator status */
export const MetadataLogsContext = Schema.Struct({ ...CleanupContext.fields, channelType: Schema.Literals([0, 1, 5]) })
export const MetadataLogsPrivateRead = Schema.Struct({ ...origin, channelId: Id, recipientIds: List(Id, Number.MAX_SAFE_INTEGER), oneToOne: Schema.Literal(true) })
export const MetadataLogsObservation = Schema.Struct({ ...origin, messageId: Id, channelId: Id, botId: Id, observedAt: Millis, status: Schema.Literals(["match", "absent", "conflict", "unknown"]), content: Schema.optionalKey(Str(2000)), embed: Schema.optionalKey(MetadataLogsEmbed) })
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
const metadataSources = { observation: "Fluxer event", "member-add": "Fluxer event", "message-delete": "Fluxer event", audit: "Audit log", settings: "Chat command", dashboard: "Dashboard", "dashboard-setting": "Dashboard" } as const
export function metadataLogContent(recordNo: number, event: MetadataLogsEvent) {
    const user = (id: string) => `<@${id}>`, role = (id: string) => `<@&${id}>`, channel = (id: string) => `<#${id}>`, { type, resourceIds: ids } = event, action = event.auditAction ?? 0
    const about = !ids.length ? undefined : type === "server-update" || action === 1 ? "About: This server" : type.startsWith("message-") ? `Messages: ${ids.join(", ")}` : type === "webhook-change" ? `Webhook: ${ids.join(", ")}`
        : type === "privilege-change" && event.changedFields.includes("member-roles") ? `About: ${[user(ids[0]!), ...ids.slice(1).map(role)].join(", ")}`
        : `About: ${ids.map(type.startsWith("member-") || type === "bot-join" || type === "impersonation" || action >= 20 && action <= 28 ? user : type.startsWith("role-") || type === "privilege-change" || action >= 30 ? role : channel).join(", ")}`
    return [`Metadata #${recordNo}`, `Event: ${type} (${event.category})`, `By: ${event.actor.kind === "unknown" ? "Unknown" : user(event.actor.userId)}`, ...(about ? [about] : []), ...(event.channelId ? [`Channel: ${channel(event.channelId)}`] : []),
        ...(event.changedFields.length ? [`Changed: ${event.changedFields.join(", ")}`] : []), ...(event.count > 1 ? [`Count: ${event.count}`] : []), `Source: ${metadataSources[event.source.kind]}`, `When: <t:${Math.floor(event.observedAt / 1000)}:f>`].join("\n")
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
