import { type MetadataLogsEvent, type MetadataLogsSource, type MetadataLogsCategory, type MetadataLogsEventType, metadataAuditActions } from "@neonflux/contracts/metadata-logs"
import { randomBytes } from "node:crypto"
import { snowflakes } from "@neontechspace/fluxerly/effect"

export { metadataAuditActions, metadataChangedFields, metadataLogContent } from "@neonflux/contracts/metadata-logs"
const object = (v: unknown): Record<string, unknown> | undefined => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined
const id = (v: unknown): v is string => snowflakes.isValid(v) && v !== "0"
export interface MetadataProjectionScope { serverId: string, sessionId: string, sequence: number, observedAt: number, botId?: string, excludedChannelIds?: readonly string[] }
export function createMetadataObservationSession() {
    const sessionId = randomBytes(16).toString("hex")
    let sequence = 0
    return (serverId: string, observedAt: number): MetadataProjectionScope => ({ serverId, observedAt, sessionId, sequence: ++sequence })
}

/** Project only explicit safe fields. Actor attribution is never borrowed from another event */
export function projectMetadataEvent(name: string, payload: unknown, scope: MetadataProjectionScope): MetadataLogsEvent | undefined {
    const value = object(payload)
    if (!value || !id(scope.serverId) || !/^[a-f0-9]{32}$/.test(scope.sessionId) || !Number.isSafeInteger(scope.sequence) || scope.sequence < 1
        || !Number.isSafeInteger(scope.observedAt) || scope.observedAt < 0 || value.guildId !== scope.serverId && !(name === "guildUpdate" && value.id === scope.serverId)) return
    const source: MetadataLogsSource = { kind: "observation", sessionId: scope.sessionId, sequence: scope.sequence }
    const base = (category: MetadataLogsCategory, type: MetadataLogsEventType, resources: unknown[], changedFields: string[] = []): MetadataLogsEvent | undefined => {
        if (resources.length > 20 || !resources.every(id) || new Set(resources).size !== resources.length) return
        return { category, type, source, observedAt: scope.observedAt, actor: { kind: "unknown" }, resourceIds: resources as string[], changedFields, count: 1, outcome: "observed" }
    }
    if (name === "guildAuditLogEntryCreate") {
        if (!id(value.id) || !id(value.targetId) || !metadataAuditActions.includes(value.actionType as typeof metadataAuditActions[number])) return
        return { ...base("audit", "audit-entry", [value.targetId])!, source: { kind: "audit", auditEntryId: value.id },
            actor: id(value.userId) ? { kind: "audit", userId: value.userId } : { kind: "unknown" }, auditAction: value.actionType as number }
    }
    if (["guildMemberAdd", "guildMemberUpdate", "guildMemberRemove"].includes(name)) {
        const event = base("membership", name === "guildMemberAdd" ? "member-add" : name === "guildMemberRemove" ? "member-remove" : "member-update", [value.userId])
        if (event && name === "guildMemberAdd" && typeof value.joinedAt === "string" && value.joinedAt.length <= 64 && /^\d{4}-\d\d-\d\dT/.test(value.joinedAt)
            && Date.parse(value.joinedAt) <= scope.observedAt + 1000 && Date.parse(value.joinedAt) >= scope.observedAt - 900000)
            event.source = { kind: "member-add", userId: value.userId as string, joinedAt: value.joinedAt }
        // SDK update payloads are current snapshots, not before/after patches. No field-change claim is made.
        return event
    }
    const resources: Record<string, MetadataLogsEventType> = { guildRoleCreate: "role-create", guildRoleUpdate: "role-update", guildRoleDelete: "role-delete", guildChannelCreate: "channel-create", guildChannelUpdate: "channel-update", guildChannelDelete: "channel-delete", guildUpdate: "server-update" }
    if (resources[name]) return base("resources", resources[name]!, [value.id ?? value.roleId])
    if (name === "guildRoleUpdateBulk" || name === "guildChannelUpdateBulk") {
        const items = value[name === "guildRoleUpdateBulk" ? "roles" : "channels"]
        if (!Array.isArray(items) || items.length < 1 || items.length > 1000) return
        const ids = items.map(v => object(v)?.id)
        if (!ids.every(id) || new Set(ids).size !== ids.length) return
        // A batch is one observation. The bounded resource sample is not a complete inventory.
        const event = base("resources", name === "guildRoleUpdateBulk" ? "role-update" : "channel-update", ids.slice(0, 20))
        return event ? { ...event, count: items.length } : undefined
    }
    if (["messageUpdate", "messageDelete", "messageDeleteBulk"].includes(name)) {
        if (!id(value.channelId) || scope.excludedChannelIds?.includes(value.channelId)) return
        const author = object(value.author)
        if (author?.isBot === true || author?.isSystem === true || value.webhookId || scope.botId && (author?.id === scope.botId || value.authorId === scope.botId)) return
        const messageIds = name === "messageDeleteBulk" ? value.ids : [value.id]
        if (!Array.isArray(messageIds) || messageIds.length < 1 || messageIds.length > 1000 || !messageIds.every(id) || new Set(messageIds).size !== messageIds.length) return
        const event = base("messages", name === "messageUpdate" ? "message-update" : name === "messageDelete" ? "message-delete" : "message-bulk-delete", messageIds.slice(0, 20), name === "messageUpdate" ? ["update"] : [])!
        return { ...event, ...(name === "messageDelete" ? { source: { kind: "message-delete", messageId: value.id as string } as const } : {}),
            channelId: value.channelId, authorBot: typeof author?.isBot === "boolean" ? author.isBot : null, privateChannel: false, count: messageIds.length }
    }
}
