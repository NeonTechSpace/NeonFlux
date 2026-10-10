import type { MetadataLogsActor, MetadataLogsBinding, MetadataLogsCategory, MetadataLogsEvent, MetadataLogsEventType, MetadataLogsEventSelector, MetadataLogsSource, MetadataLogsPresentation } from "../contracts.js"
import { shape } from "./publishingDomain.ts"
import { epoch } from "./rolesDomain.ts"
import { fail, parentChannel, requireId, bool, integer, token } from "./validation.ts"
import { cleanupContext } from "./cleanupDomain.ts"
import type { MetadataLogsContext } from "../contracts.js"

export function metadataContext(value: unknown, privateReport = false): MetadataLogsContext {
    const input = shape(value, ["observedAt", "actor", "member", "channelId", "channelType", "botId", "botAuthorized", "actorAuthorized", "actorKind", "botKind", "botMember"], ["observedAt", "actor", "member", "channelId", "channelType", "botId", "botAuthorized", "actorAuthorized", "actorKind", "botKind", "botMember"])
    if (input.channelType === 1) {
        if (!privateReport) fail(403, "Private context is only for private metadata reports")
        return { ...cleanupContext({ ...input, channelType: 0 }), channelType: 1 }
    }
    return cleanupContext(input)
}

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
export const metadataEventTypes = Object.values(metadataTypes).flat() as MetadataLogsEventType[]
export const metadataEventType = (value: unknown): MetadataLogsEventType => { if (!metadataEventTypes.includes(value as MetadataLogsEventType)) fail(400, "Invalid metadata event type"); return value as MetadataLogsEventType }
export const metadataPalette = {
    membership: [0x4ade80, 0x22c55e, 0x16a34a, 0x15803d], resources: [0x60a5fa, 0x3b82f6, 0x2563eb, 0x1d4ed8],
    messages: [0x22d3ee, 0x06b6d4, 0x0891b2, 0x0e7490], audit: [0xc084fc, 0xa855f7, 0x9333ea, 0x7e22ce],
    settings: [0xfbbf24, 0xf59e0b, 0xd97706, 0xb45309], operations: [0xfb7f6b, 0xf25d50, 0xdc443c, 0xb92f2d],
    security: [0xf472b6, 0xec4899, 0xdb2777, 0xbe185d],
} as const
const metadataAuditLabels: Record<number, string> = { 1: "Server updated", 10: "Channel created", 11: "Channel updated", 12: "Channel deleted", 13: "Permission overwrite created", 14: "Permission overwrite updated", 15: "Permission overwrite deleted", 20: "Member kicked", 22: "Member banned", 23: "Member ban lifted", 24: "Member updated", 25: "Member roles updated", 26: "Member moved", 27: "Member disconnected", 28: "Bot added", 30: "Role created", 31: "Role updated", 32: "Role deleted" }
export const metadataEventLabels: Record<MetadataLogsEventType, string> = { "member-add": "Member joined", "member-update": "Member update observed", "member-remove": "Member departed", "role-create": "Role created", "role-update": "Role update observed", "role-delete": "Role deleted", "channel-create": "Channel created", "channel-update": "Channel update observed", "channel-delete": "Channel deleted", "thread-create": "Thread created", "thread-update": "Thread update observed", "thread-delete": "Thread deleted", "server-update": "Server update observed", "message-update": "Message update observed", "message-delete": "Message deleted", "message-bulk-delete": "Messages deleted", "audit-entry": "Audit entry observed", "settings-change": "Settings changed", "backend-failure": "Backend failure", "admission-failure": "Admission failure", "delivery-failure": "Delivery failure", "gateway-discontinuity": "Gateway discontinuity observed", "invite-create": "Invite created", "invite-delete": "Invite deleted", "bot-join": "Unexpected bot joined", "webhook-change": "Unexpected webhook change", "privilege-change": "Dangerous permissions granted", "impersonation": "Possible impersonation" }
// What a security record means for staff. NeonFlux only reports these and never acts on them
const securityNotes: Partial<Record<MetadataLogsEventType, string>> = {
    "invite-create": "Resources: the invite's channel. The invite code is not recorded",
    "invite-delete": "Resources: the invite's channel, when Fluxer names it. The invite code is not recorded",
    "bot-join": "A bot that is not marked expected joined. Mark it expected with the alerts command if you added it",
    "webhook-change": "A webhook that is not marked expected was created or changed. Mark it expected with the alerts command if it is yours",
    "privilege-change": "Fields name the dangerous permissions. Resources: the role, or the member and the roles they gained",
    "impersonation": "Resources: the member, then the staff member or owner whose name theirs closely matches",
}
export function metadataTone(event: MetadataLogsEvent): 0 | 1 | 2 | 3 {
    if (event.type === "audit-entry") return [10, 13, 23, 28, 30].includes(event.auditAction!) ? 0 : [12, 15, 20, 22, 27, 32].includes(event.auditAction!) ? 3 : 2
    if (event.type === "gateway-discontinuity") return event.outcome === "reconnected" ? 0 : event.outcome === "disconnected" ? 3 : 1
    if (event.type === "member-remove") return 1
    if (["member-add", "role-create", "channel-create", "thread-create", "invite-create"].includes(event.type)) return 0
    if (["role-delete", "channel-delete", "thread-delete", "message-delete", "message-bulk-delete", "backend-failure", "admission-failure", "delivery-failure", "privilege-change"].includes(event.type)) return 3
    return 2
}
export function metadataPresentation(recordNo: number, event: MetadataLogsEvent): MetadataLogsPresentation {
    const description = metadataContent(recordNo, event).split("\n").slice(1)
    description[description.length - 1] = `Observed (UTC): ${new Date(event.observedAt).toISOString()}`
    if (event.parentChannelId !== undefined) description.push(`Thread parent: ${event.parentChannelId}`)
    if (event.auditAction !== undefined) description.push(`Audit action: ${metadataAuditLabels[event.auditAction]} (${event.auditAction})`)
    if (event.type === "member-remove") description.push("Departure cause: Unknown")
    if (securityNotes[event.type]) description.push(securityNotes[event.type]!)
    const label = event.auditAction !== undefined ? metadataAuditLabels[event.auditAction] : event.type === "gateway-discontinuity" && event.outcome === "reconnected" ? "Gateway reconnected" : event.type === "gateway-discontinuity" && event.outcome === "disconnected" ? "Gateway disconnected" : metadataEventLabels[event.type]
    return { format: "embed-v1", embed: { title: `Metadata #${recordNo}: ${label}`, description: description.join("\n"), color: metadataPalette[event.category][metadataTone(event)] } }
}
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
export const metadataEventSelectors: MetadataLogsEventSelector[] = [...metadataEventTypes, ...metadataAuditActions.map(action => `audit-entry:${action}` as const)]
export const metadataEventSelector = (value: unknown): MetadataLogsEventSelector => { if (!metadataEventSelectors.includes(value as MetadataLogsEventSelector)) fail(400, "Invalid metadata event selector"); return value as MetadataLogsEventSelector }
export const metadataCategory = (x: unknown): MetadataLogsCategory => { if (!metadataCategories.includes(x as MetadataLogsCategory)) fail(400, "Invalid metadata category"); return x as MetadataLogsCategory }
export const metadataNumber = (x: unknown) => integer(x, 1, Number.MAX_SAFE_INTEGER)
export const metadataIds = (x: unknown, max = 20): string[] => { if (!Array.isArray(x) || x.length > max) fail(400, "Metadata ID limit exceeded"); const values = x.map(requireId); if (new Set(values).size !== values.length) fail(400, "Duplicate metadata IDs"); return values }
export function metadataEvent(value: unknown, internal = false): MetadataLogsEvent {
    const r = shape(value, ["category", "type", "source", "observedAt", "actor", "resourceIds", "changedFields", "count", "channelId", "parentChannelId", "authorBot", "privateChannel", "auditAction", "outcome"], ["category", "type", "source", "observedAt", "actor", "resourceIds", "changedFields", "count"])
    const category = metadataCategory(r.category), type = r.type as MetadataLogsEventType
    if (!(metadataTypes[category] as readonly string[]).includes(type) || category === "settings" && !internal) fail(400, "Invalid metadata event")
    const observedAt = integer(r.observedAt, Date.now() - 900000, Date.now() + 1000), resourceIds = metadataIds(r.resourceIds)
    if (!Array.isArray(r.changedFields) || r.changedFields.length > 20 || new Set(r.changedFields).size !== r.changedFields.length || r.changedFields.some(x => !(metadataChangedFields[category] as readonly unknown[]).includes(x))) fail(400, "Invalid metadata changed fields")
    const a = shape(r.actor, ["kind", "userId"], ["kind"])
    let actor: MetadataLogsActor
    if (a.kind === "unknown") { shape(a, ["kind"], ["kind"]); actor = { kind: "unknown" } }
    // A security alert names an actor only from its own audit entry, or the creator a new invite's event names
    else if (a.kind === "audit" && (category === "audit" || type === "privilege-change" || type === "webhook-change") || a.kind === "configuration" && category === "settings" && internal
        || a.kind === "event" && type === "invite-create") actor = { kind: a.kind as "audit" | "configuration" | "event", userId: requireId(a.userId) }
    else fail(400, "Unproven metadata actor")
    const s = shape(r.source, ["kind", "auditEntryId", "messageId", "userId", "joinedAt", "sessionId", "sequence", "scope", "jobId", "revision"], ["kind"])
    let source: MetadataLogsSource
    if (type === "audit-entry" || (type === "privilege-change" || type === "webhook-change") && s.kind === "audit") { shape(s, ["kind", "auditEntryId"], ["kind", "auditEntryId"]); if (s.kind !== "audit") fail(400, "Audit source required"); source = { kind: "audit", auditEntryId: requireId(s.auditEntryId) } }
    else if (type === "message-delete") { shape(s, ["kind", "messageId"], ["kind", "messageId"]); if (s.kind !== "message-delete") fail(400, "Message deletion source required"); source = { kind: "message-delete", messageId: requireId(s.messageId) }; if (!resourceIds.includes(source.messageId)) fail(400, "Message source mismatch") }
    else if (type === "member-add" && s.kind === "member-add") { shape(s, ["kind", "userId", "joinedAt"], ["kind", "userId", "joinedAt"]); source = { kind: "member-add", userId: requireId(s.userId), joinedAt: epoch(s.joinedAt) }; if (!resourceIds.includes(source.userId) || Date.parse(source.joinedAt) > observedAt + 1000 || Date.parse(source.joinedAt) < observedAt - 900000) fail(400, "Membership source mismatch") }
    else if (category === "settings" && s.kind === "dashboard") { shape(s, ["kind", "jobId", "scope"], ["kind", "jobId", "scope"]); if (!["metadata", "roles", "responses", "moderation", "publishing", "greetings", "tickets", "leveling", "milestones", "suggestions", "cleanup", "events", "schedules", "nickname", "voice", "rolepicker", "temproles", "sticky", "sidebar", "memberlist", "alerts", "helpdesk", "onboarding", "presets", "lfg", "showcase", "profile", "youtube"].includes(String(s.scope))) fail(400, "Dashboard configuration source required"); source = { kind: "dashboard", jobId: token(s.jobId), scope: s.scope as Extract<MetadataLogsSource, {kind:"dashboard"}>["scope"] } }
    else if (category === "settings" && s.kind === "dashboard-setting") { shape(s, ["kind", "scope", "revision"], ["kind", "scope", "revision"]); if (s.scope !== "general" && s.scope !== "responses") fail(400, "Dashboard setting source required"); source = { kind: "dashboard-setting", scope: s.scope, revision: metadataNumber(s.revision) } }
    else if (category === "settings") { shape(s, ["kind", "messageId", "scope"], ["kind", "messageId", "scope"]); if (s.kind !== "settings" || !["moderation", "metadata", "security"].includes(String(s.scope))) fail(400, "Settings source required"); source = { kind: "settings", messageId: requireId(s.messageId), scope: s.scope as "moderation" | "metadata" | "security" } }
    else { shape(s, ["kind", "sessionId", "sequence"], ["kind", "sessionId", "sequence"]); if (s.kind !== "observation" || typeof s.sessionId !== "string" || !/^[a-f0-9]{32}$/.test(s.sessionId)) fail(400, "Observation session required"); source = { kind: "observation", sessionId: s.sessionId, sequence: metadataNumber(s.sequence) } }
    if (actor.kind === "audit" && source.kind !== "audit") fail(400, "Unproven metadata actor")
    const count = integer(r.count, 1, type === "message-bulk-delete" || category === "resources" ? 1000 : category === "operations" ? 10000 : 1)
    if (category === "messages") { if (r.channelId === undefined || r.authorBot === undefined || r.privateChannel === undefined) fail(400, "Message channel evidence required") }
    else if (r.authorBot !== undefined || r.privateChannel !== undefined) fail(400, "Unexpected message evidence")
    if (category === "audit") { if (!metadataAuditActions.includes(r.auditAction as typeof metadataAuditActions[number]) || resourceIds.length !== 1) fail(400, "Unsupported audit entry") }
    else if (r.auditAction !== undefined) fail(400, "Unexpected audit action")
    // A thread parent describes a message in a thread or the thread a thread event names, never another event
    const thread = type === "thread-create" || type === "thread-update" || type === "thread-delete"
    if (thread && (r.parentChannelId === undefined || resourceIds.includes(r.parentChannelId as string))) fail(400, "Thread parent required")
    const parentChannelId = category === "messages" ? parentChannel(r.parentChannelId, requireId(r.channelId)) : thread ? requireId(r.parentChannelId) : r.parentChannelId === undefined ? undefined : fail(400, "Unexpected thread parent")
    if (r.outcome !== undefined && !["observed", "accepted", "failed", "disconnected", "reconnected"].includes(String(r.outcome))) fail(400, "Invalid metadata outcome")
    return { category, type, source, observedAt, actor, resourceIds, changedFields: r.changedFields as string[], count, ...(r.channelId !== undefined ? { channelId: requireId(r.channelId) } : {}), ...(parentChannelId ? { parentChannelId } : {}), ...(r.authorBot !== undefined ? { authorBot: r.authorBot === null ? null : bool(r.authorBot) } : {}), ...(r.privateChannel !== undefined ? { privateChannel: bool(r.privateChannel) } : {}), ...(r.auditAction !== undefined ? { auditAction: r.auditAction as number } : {}), ...(r.outcome !== undefined ? { outcome: r.outcome as NonNullable<MetadataLogsEvent["outcome"]> } : {}) }
}
export function metadataSourceKey(e: MetadataLogsEvent) { return JSON.stringify([e.category, e.type, e.source]) }
export function metadataBinding(value: unknown): MetadataLogsBinding {
    const keys = ["recordNo", "routeRevision", "moduleRevision", "generation", "channelId", "ownerId"], r = shape(value, [...keys, "routeEventType"], keys)
    return { recordNo: metadataNumber(r.recordNo), routeRevision: metadataNumber(r.routeRevision), moduleRevision: metadataNumber(r.moduleRevision), generation: metadataNumber(r.generation), channelId: requireId(r.channelId), ownerId: requireId(r.ownerId), ...(r.routeEventType === undefined ? {} : { routeEventType: metadataEventSelector(r.routeEventType) }) }
}
export function metadataContent(recordNo: number, event: MetadataLogsEvent) {
    return [`Metadata #${recordNo}`, `Category: ${event.category}`, `Observation: ${event.type}`, `Actor: ${event.actor.kind === "unknown" ? "unknown" : event.actor.userId + " (" + event.actor.kind + ")"}`, `Resources: ${event.resourceIds.join(", ") || "none"}`, `Fields: ${event.changedFields.join(", ") || "none"}`, `Count: ${event.count}`, `Source: ${event.source.kind}`, `Observed: ${event.observedAt}`].join("\n")
}
