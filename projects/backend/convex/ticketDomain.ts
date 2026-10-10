import {
    TICKET_CLOSE_PERMISSIONS,
    TICKET_SEND,
    TicketChannelSnapshot,
    TicketContext,
    TicketQuestions,
    TicketVisibility,
    type TicketActor,
    type TicketCategory,
    type TicketCategorySummary,
    type TicketIntakeCategory,
    type TicketOverwrite,
    type TicketTranscriptMessage,
    type TicketTranscriptThread,
} from "@neonflux/contracts/tickets"
import { actor } from "./moderationDomain.ts"
import { decode, fail, integer } from "./validation.ts"
export { TICKET_CLOSE_PERMISSIONS, TICKET_SEND }
export const TICKET_DAY = 86400000,
    TICKET_WINDOW = 180000,
    TICKET_CLOSED = 190000,
    TICKET_BATCH = 32
export const TICKET_VIEW = 1024n,
    TICKET_READ = 65536n
/** Permission bits the ticket lifecycle owns. A ticket closed before thread support owns only SendMessages until it reopens */
export const ticketMask = (ticket: { ownedPermissions?: string }) =>
    ticket.ownedPermissions === undefined ? TICKET_SEND : BigInt(ticket.ownedPermissions) & TICKET_CLOSE_PERMISSIONS
export const defaultTickets = () => ({ enabled: false, retentionDays: 30 })
export const visibility = (value: unknown) => decode(TicketVisibility, value, "Invalid ticket audience")
function ticketActor(input: TicketActor): TicketActor {
    const result = { ...input, ...actor(input) }
    if (result.isBot || (result.privateChannelVerified && !result.privateChannelId)) fail(403, "Ticket member context required")
    return result
}
/** Checks overwrites, including ones the backend builds, and sorts them by type and ID */
export function ticketOverwrites(value: unknown): TicketOverwrite[] {
    return [...decode(TicketChannelSnapshot.fields.overwrites, value)].sort((a, b) => a.type.localeCompare(b.type) || (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0))
}
/** A channel snapshot as stored: without its read server and with sorted overwrites */
export function ticketChannel(value: TicketChannelSnapshot): TicketChannelSnapshot {
    const { channelId, serverId, type, name, parentId, overwrites } = value
    return { channelId, serverId, type, name, parentId, overwrites: ticketOverwrites(overwrites) }
}
export function ticketContext(value: unknown): TicketContext {
    const now = Date.now(),
        input = decode(TicketContext, value)
    integer(input.observedAt, now - 60000, now + 1000)
    return {
        ...input,
        actor: ticketActor(input.actor),
        ...(input.channel === undefined ? {} : { channel: ticketChannel(input.channel) }),
    }
}
export const ticketQuestions = (value: unknown) => decode(TicketQuestions, value, "Invalid ticket questions")
export function categorySummary(value: TicketCategory): TicketCategorySummary {
    const { name, revision, enabled, visibility, description } = value
    return { name, revision, enabled, visibility, description }
}
export function intakeCategory(value: TicketCategory): TicketIntakeCategory {
    return {
        ...categorySummary(value),
        parentId: value.parentId,
        supportRoleIds: value.supportRoleIds,
        questions: value.questions,
    }
}
export function channelEqual(a: TicketChannelSnapshot, b: TicketChannelSnapshot) {
    return sameChannelIdentity(a, b) && overwritesEqual(a.overwrites, b.overwrites)
}
export function overwritesEqual(a: TicketOverwrite[], b: TicketOverwrite[]) {
    const first = ticketOverwrites(a),
        second = ticketOverwrites(b)
    return (
        first.length === second.length &&
        first.every((row, index) => {
            const other = second[index]!
            return row.id === other.id && row.type === other.type && row.allow === other.allow && row.deny === other.deny
        })
    )
}
export function sameChannelIdentity(a: TicketChannelSnapshot, b: TicketChannelSnapshot) {
    // Staff may rename or move a ticket channel. Only its identity and owned overwrites bind the lifecycle
    return a.channelId === b.channelId && a.serverId === b.serverId && a.type === b.type
}
export function sendBits(row: TicketOverwrite | undefined, mask = TICKET_SEND) {
    return {
        exists: Boolean(row),
        allow: (BigInt(row?.allow ?? "0") & mask).toString(),
        deny: (BigInt(row?.deny ?? "0") & mask).toString(),
    }
}
export function ownBitsEqual(a: TicketOverwrite | undefined, b: TicketOverwrite | undefined, mask = TICKET_SEND) {
    return JSON.stringify(sendBits(a, mask)) === JSON.stringify(sendBits(b, mask))
}
export function envelope(serverId: string, botId: string, requesterId: string, supportRoleIds: string[], audience: "private" | "public") {
    const access = (TICKET_VIEW | TICKET_SEND | TICKET_READ).toString()
    return ticketOverwrites([
        {
            id: serverId,
            type: "role",
            allow: audience === "public" ? access : "0",
            deny: audience === "private" ? (TICKET_VIEW | TICKET_SEND).toString() : "0",
        },
        ...supportRoleIds.map((id) => ({
            id,
            type: "role",
            allow: access,
            deny: "0",
        })),
        ...[botId, requesterId].map((id) => ({
            id,
            type: "member",
            allow: access,
            deny: "0",
        })),
    ])
}
export const TRANSCRIPT_PAGE = 1500
/** Render one bounded transcript body. Reads page through it instead of storing message chunks.
 * Thread messages follow the channel's, each thread under a header with its name, and share its 500 messages */
export function transcriptBody(messages: TicketTranscriptMessage[], threads: TicketTranscriptThread[] = []) {
    const groups = threads.map((thread) => ({ header: `Thread ${thread.name} (${thread.threadId})`, lines: transcriptLines(thread.messages) }))
    const lines = [...transcriptLines(messages), ...groups.flatMap((group) => [group.header, ...group.lines])],
        messageCount = lines.length - groups.length
    const body = lines.join("\n")
    if (body.length > 200000) fail(413, "Transcript too large")
    return { body, messageCount }
}
function transcriptLines(messages: TicketTranscriptMessage[]) {
    return messages.map((item) => {
        const time = item.createdAt ?? "Unknown time",
            omitted = item.omittedAttachments ? ` [${item.omittedAttachments} attachments omitted]` : ""
        return `[${time}] ${item.authorId} (${item.messageId}): ${item.content}${omitted}`
    })
}
