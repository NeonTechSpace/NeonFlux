import {
    TICKET_CLOSE_PERMISSIONS,
    TICKET_SEND,
    TICKET_VIEW,
    TicketChannelSnapshot,
    TicketContext,
    TicketQuestions,
    sortTicketOverwrites,
    type TicketActor,
    type TicketCategory,
    type TicketCategorySummary,
    type TicketIntakeCategory,
    type TicketOverwrite,
    type TicketTranscriptMessage,
} from "@neonflux/contracts/tickets"
import { actor } from "./moderationDomain.ts"
import { decode, fail, integer } from "./validation.ts"
export const TICKET_DAY = 86400000,
    TICKET_WINDOW = 180000,
    TICKET_BATCH = 32
const TICKET_READ = 65536n
/** Permission bits the ticket lifecycle owns: the bits its close owns from the close until the reopen, and SendMessages otherwise */
export const ticketMask = (ticket: { ownedPermissions?: string }) =>
    ticket.ownedPermissions === undefined ? TICKET_SEND : BigInt(ticket.ownedPermissions) & TICKET_CLOSE_PERMISSIONS
export const defaultTickets = () => ({ enabled: false, retentionDays: 30 })
function ticketActor(input: TicketActor): TicketActor {
    const result = { ...input, ...actor(input) }
    if (result.isBot || (result.privateChannelVerified && !result.privateChannelId))
        fail(403, "Ticket member context required")
    return result
}
/** Checks overwrites, including ones the backend builds, and sorts them by type and ID */
export function ticketOverwrites(value: unknown): TicketOverwrite[] {
    return sortTicketOverwrites(decode(TicketChannelSnapshot.fields.overwrites, value))
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
        ...(input.destination === undefined ? {} : { destination: ticketChannel(input.destination) }),
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
export function ownBitsEqual(a: TicketOverwrite | undefined, b: TicketOverwrite | undefined, mask = TICKET_SEND) {
    const own = (row: TicketOverwrite | undefined) => [
        Boolean(row),
        BigInt(row?.allow ?? "0") & mask,
        BigInt(row?.deny ?? "0") & mask,
    ]
    const [x, y] = [own(a), own(b)]
    return x[0] === y[0] && x[1] === y[1] && x[2] === y[2]
}
export function envelope(
    serverId: string,
    botId: string,
    requesterId: string,
    supportRoleIds: string[],
    audience: "private" | "public",
) {
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
/** Renders new transcript messages as lines, each attachment, embed and sticker on its own indented line below its message */
export function transcriptLines(messages: readonly TicketTranscriptMessage[], thread?: string) {
    const place = thread === undefined ? "" : ` [thread ${thread}]`
    return messages.flatMap((item) => [
        `[${item.createdAt ?? "Unknown time"}]${place} ${item.authorName} (${item.authorId}) (${item.messageId}): ${item.content}`,
        ...(item.attachments ?? []).map(
            (file) => `  Attachment: ${file.filename} (${file.size} bytes)${file.url ? ` ${file.url}` : ""}`,
        ),
        ...(item.embeds ?? []).map((text) => `  Embed: ${text}`),
        ...(item.stickers ?? []).map((name) => `  Sticker: ${name}`),
    ])
}
