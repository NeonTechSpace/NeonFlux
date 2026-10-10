import { Schema } from "effect"
import { Id, Int, List } from "@neonflux/contracts/common"
import { MetadataLogsContext, MetadataLogsEventInput, type MetadataLogsEvent, MetadataLogsBinding, type MetadataLogsEventType, metadataLogContent as metadataContent, type MetadataLogsPresentation } from "@neonflux/contracts/metadata-logs"
import { decode, fail, integer } from "./validation.ts"
import { cleanupContext } from "./cleanupDomain.ts"

export function metadataContext(value: unknown, privateReport = false): MetadataLogsContext {
    const input = decode(MetadataLogsContext, value)
    if (input.channelType === 1) {
        if (!privateReport) fail(403, "Private context is only for private metadata reports")
        return { ...cleanupContext({ ...input, channelType: 0 }), channelType: 1 }
    }
    return cleanupContext(input)
}

export { METADATA_RETENTION, METADATA_DAY, METADATA_CAPACITY, METADATA_GRANT_MS, METADATA_SETTLE_MS, metadataCategories, metadataTypes, metadataEventTypes, metadataEventSelectors, metadataChangedFields, metadataLogContent as metadataContent } from "@neonflux/contracts/metadata-logs"
export const metadataPalette = {
    membership: [0x4ade80, 0x22c55e, 0x16a34a, 0x15803d], resources: [0x60a5fa, 0x3b82f6, 0x2563eb, 0x1d4ed8],
    messages: [0x22d3ee, 0x06b6d4, 0x0891b2, 0x0e7490], audit: [0xc084fc, 0xa855f7, 0x9333ea, 0x7e22ce],
    settings: [0xfbbf24, 0xf59e0b, 0xd97706, 0xb45309], operations: [0xfb7f6b, 0xf25d50, 0xdc443c, 0xb92f2d],
} as const
const metadataAuditLabels: Record<number, string> = { 1: "Server updated", 10: "Channel created", 11: "Channel updated", 12: "Channel deleted", 13: "Permission overwrite created", 14: "Permission overwrite updated", 15: "Permission overwrite deleted", 20: "Member kicked", 22: "Member banned", 23: "Member ban lifted", 24: "Member updated", 25: "Member roles updated", 26: "Member moved", 27: "Member disconnected", 28: "Bot added", 30: "Role created", 31: "Role updated", 32: "Role deleted" }
export const metadataEventLabels: Record<MetadataLogsEventType, string> = { "member-add": "Member joined", "member-update": "Member update observed", "member-remove": "Member departed", "role-create": "Role created", "role-update": "Role update observed", "role-delete": "Role deleted", "channel-create": "Channel created", "channel-update": "Channel update observed", "channel-delete": "Channel deleted", "thread-create": "Thread created", "thread-update": "Thread update observed", "thread-delete": "Thread deleted", "server-update": "Server update observed", "message-update": "Message update observed", "message-delete": "Message deleted", "message-bulk-delete": "Messages deleted", "audit-entry": "Audit entry observed", "settings-change": "Settings changed", "backend-failure": "Backend failure", "admission-failure": "Admission failure", "delivery-failure": "Delivery failure", "gateway-discontinuity": "Gateway discontinuity observed" }
export function metadataTone(event: MetadataLogsEvent): 0 | 1 | 2 | 3 {
    if (event.type === "audit-entry") return [10, 13, 23, 28, 30].includes(event.auditAction!) ? 0 : [12, 15, 20, 22, 27, 32].includes(event.auditAction!) ? 3 : 2
    if (event.type === "gateway-discontinuity") return event.outcome === "reconnected" ? 0 : event.outcome === "disconnected" ? 3 : 1
    if (event.type === "member-remove") return 1
    if (["member-add", "role-create", "channel-create", "thread-create"].includes(event.type)) return 0
    if (["role-delete", "channel-delete", "thread-delete", "message-delete", "message-bulk-delete", "backend-failure", "admission-failure", "delivery-failure"].includes(event.type)) return 3
    return 2
}
export function metadataPresentation(recordNo: number, event: MetadataLogsEvent): MetadataLogsPresentation {
    const description = metadataContent(recordNo, event).split("\n").slice(1)
    description[description.length - 1] = `Observed (UTC): ${new Date(event.observedAt).toISOString()}`
    if (event.parentChannelId !== undefined) description.push(`Thread parent: ${event.parentChannelId}`)
    if (event.auditAction !== undefined) description.push(`Audit action: ${metadataAuditLabels[event.auditAction]} (${event.auditAction})`)
    if (event.type === "member-remove") description.push("Departure cause: Unknown")
    const label = event.auditAction !== undefined ? metadataAuditLabels[event.auditAction] : event.type === "gateway-discontinuity" && event.outcome === "reconnected" ? "Gateway reconnected" : event.type === "gateway-discontinuity" && event.outcome === "disconnected" ? "Gateway disconnected" : metadataEventLabels[event.type]
    return { format: "embed-v1", embed: { title: `Metadata #${recordNo}: ${label}`, description: description.join("\n"), color: metadataPalette[event.category][metadataTone(event)] } }
}
export const metadataNumber = (value: unknown) => decode(Int(1), value)
export const metadataIds = (value: unknown, max = 20): string[] => decode(List(Id, max).check(Schema.makeFilter(v => new Set(v).size === v.length)), value)
export function metadataEvent(value: unknown, internal = false): MetadataLogsEvent {
    const { originServerId: _origin, ...event } = decode(MetadataLogsEventInput, value)
    if (event.category === "settings" && !internal) fail(400, "Invalid metadata event")
    integer(event.observedAt, Date.now() - 900000, Date.now() + 1000)
    if (event.source.kind === "member-add") {
        if (Date.parse(event.source.joinedAt) > event.observedAt + 1000 || Date.parse(event.source.joinedAt) < event.observedAt - 900000) fail(400, "Membership source mismatch")
    }
    return event
}
export function metadataSourceKey(e: MetadataLogsEvent) { return JSON.stringify([e.category, e.type, e.source]) }
export const metadataBinding = (value: unknown): MetadataLogsBinding => decode(MetadataLogsBinding, value)
