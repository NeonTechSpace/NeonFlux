import { Schema } from "effect"
import { Id, Int, List } from "@neonflux/contracts/common"
import {
    MetadataLogsContext,
    MetadataLogsEventInput,
    type MetadataLogsEvent,
    MetadataLogsBinding,
    type MetadataLogsEventType,
    metadataEventLabel,
    metadataLogContent as metadataContent,
    type MetadataLogsPresentation,
} from "@neonflux/contracts/metadata-logs"
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

export {
    METADATA_RETENTION,
    METADATA_DAY,
    METADATA_CAPACITY,
    METADATA_GRANT_MS,
    METADATA_SETTLE_MS,
    metadataCategories,
    metadataTypes,
    metadataEventTypes,
    metadataEventSelectors,
    metadataChangedFields,
    metadataLogContent as metadataContent,
} from "@neonflux/contracts/metadata-logs"
export const metadataPalette = {
    membership: [0x4ade80, 0x22c55e, 0x16a34a, 0x15803d],
    resources: [0x60a5fa, 0x3b82f6, 0x2563eb, 0x1d4ed8],
    messages: [0x22d3ee, 0x06b6d4, 0x0891b2, 0x0e7490],
    audit: [0xc084fc, 0xa855f7, 0x9333ea, 0x7e22ce],
    settings: [0xfbbf24, 0xf59e0b, 0xd97706, 0xb45309],
    operations: [0xfb7f6b, 0xf25d50, 0xdc443c, 0xb92f2d],
    security: [0xf472b6, 0xec4899, 0xdb2777, 0xbe185d],
} as const
// What a security record means for staff. NeonFlux acts only on the alerts whose action a server turned on
const securityNotes: Partial<Record<MetadataLogsEventType, string>> = {
    "invite-create": "About: the invite's channel",
    "invite-delete": "About: the invite's channel, when Fluxer names it",
    "bot-join": "A bot that is not marked expected joined. Mark it expected with the alerts command if you added it",
    "webhook-change":
        "A webhook that is not marked expected was created or changed. Mark it expected with the alerts command if it is yours",
    "privilege-change":
        "Changed names the dangerous permissions. About: the role, or the member and the roles they gained",
    impersonation: "About: the member, then the staff member or owner whose name theirs closely matches",
    "alert-action":
        "NeonFlux acted on an alert because its action is turned on. Changed names the action and its outcome. Turn it off with the alerts command",
}
export function metadataTone(event: MetadataLogsEvent): 0 | 1 | 2 | 3 {
    if (event.type === "audit-entry")
        return [10, 13, 23, 28, 30, 40, 50, 60, 74, 90, 110].includes(event.auditAction!)
            ? 0
            : [12, 15, 20, 21, 22, 27, 32, 42, 52, 62, 72, 73, 92, 112].includes(event.auditAction!)
              ? 3
              : 2
    if (event.type === "gateway-discontinuity")
        return event.outcome === "reconnected" ? 0 : event.outcome === "disconnected" ? 3 : 1
    if (event.type === "member-remove") return 1
    if (["member-add", "role-create", "channel-create", "thread-create", "invite-create"].includes(event.type)) return 0
    if (
        [
            "role-delete",
            "channel-delete",
            "thread-delete",
            "message-delete",
            "message-bulk-delete",
            "backend-failure",
            "admission-failure",
            "delivery-failure",
            "privilege-change",
        ].includes(event.type)
    )
        return 3
    return 2
}
export function metadataPresentation(
    recordNo: number,
    event: MetadataLogsEvent,
    serverId: string,
): MetadataLogsPresentation {
    const notes = [
        ...(event.parentChannelId !== undefined ? [`Parent channel: <#${event.parentChannelId}>`] : []),
        ...(event.type === "member-remove" ? ["Departure cause: Unknown"] : []),
        ...(securityNotes[event.type] ? [securityNotes[event.type]!] : []),
    ]
    const content = metadataContent(recordNo, event, serverId, notes)
    const label =
        event.auditAction !== undefined
            ? metadataEventLabel(`audit-entry:${event.auditAction}`)
            : event.type === "gateway-discontinuity" && event.outcome === "reconnected"
              ? "Gateway reconnected"
              : event.type === "gateway-discontinuity" && event.outcome === "disconnected"
                ? "Gateway disconnected"
                : metadataEventLabel(event.type)
    return {
        format: "embed-v1",
        embed: {
            title: `Metadata #${recordNo}: ${label}`,
            description: content.slice(content.indexOf("\n") + 1),
            color: metadataPalette[event.category][metadataTone(event)],
        },
    }
}
export const metadataNumber = (value: unknown) => decode(Int(1), value)
export const metadataIds = (value: unknown, max = 20): string[] =>
    decode(List(Id, max).check(Schema.makeFilter((v) => new Set(v).size === v.length)), value)
export function metadataEvent(value: unknown, internal = false): MetadataLogsEvent {
    const { originServerId: _origin, ...event } = decode(MetadataLogsEventInput, value)
    if (event.category === "settings" && !internal) fail(400, "Invalid metadata event")
    integer(event.observedAt, Date.now() - 900000, Date.now() + 1000)
    if (event.source.kind === "member-add") {
        if (
            Date.parse(event.source.joinedAt) > event.observedAt + 1000 ||
            Date.parse(event.source.joinedAt) < event.observedAt - 900000
        )
            fail(400, "Membership source mismatch")
    }
    if (event.actor.kind === "audit" && event.source.kind !== "audit") fail(400, "Unproven metadata actor")
    return event
}
export function metadataSourceKey(e: MetadataLogsEvent) {
    return JSON.stringify([e.category, e.type, e.source])
}
export const metadataBinding = (value: unknown): MetadataLogsBinding => decode(MetadataLogsBinding, value)
