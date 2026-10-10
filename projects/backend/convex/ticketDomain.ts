import type {
    TicketActor,
    TicketCategory,
    TicketCategorySummary,
    TicketChannelSnapshot,
    TicketContext,
    TicketIntakeCategory,
    TicketOverwrite,
} from "../contracts.js"
import { actor, permissionBits, timeout } from "./moderationDomain.ts"
import { publishingContent, shape } from "./publishingDomain.ts"
import { epoch } from "./rolesDomain.ts"
import { fail, requireId, bool, ids, integer, name, text } from "./validation.ts"
export const TICKET_DAY = 86400000,
    TICKET_WINDOW = 180000,
    TICKET_CLOSED = 190000,
    TICKET_BATCH = 32
export const TICKET_VIEW = 1024n,
    TICKET_SEND = 2048n,
    TICKET_READ = 65536n,
    // Closing also stops posting in the ticket's threads and starting new ones: CreatePublicThreads, CreatePrivateThreads and SendMessagesInThreads
    TICKET_CLOSE_PERMISSIONS = TICKET_SEND | (1n << 35n) | (1n << 36n) | (1n << 38n)
/** Permission bits the ticket lifecycle owns. A ticket closed before thread support owns only SendMessages until it reopens */
export const ticketMask = (ticket: { ownedPermissions?: string }) =>
    ticket.ownedPermissions === undefined ? TICKET_SEND : BigInt(ticket.ownedPermissions) & TICKET_CLOSE_PERMISSIONS
export const defaultTickets = () => ({ enabled: false, retentionDays: 30 })
export function visibility(value: unknown): "private" | "public" {
    if (value !== "private" && value !== "public") fail(400, "Invalid ticket audience")
    return value
}
export function ticketActor(value: unknown): TicketActor {
    const input = shape(
        value,
        [
            "userId",
            "roleIds",
            "isOwner",
            "isAdministrator",
            "nativePermissionAuthorized",
            "joinedAt",
            "isBot",
            "timeoutUntil",
            "privateChannelVerified",
            "privateChannelId",
            "canView",
            "canReadHistory",
            "canSend",
        ],
        [
            "userId",
            "roleIds",
            "isOwner",
            "isAdministrator",
            "nativePermissionAuthorized",
            "joinedAt",
            "isBot",
            "timeoutUntil",
            "privateChannelVerified",
            "canView",
            "canReadHistory",
            "canSend",
        ],
    )
    const result = {
        ...actor(input),
        joinedAt: epoch(input.joinedAt),
        isBot: bool(input.isBot),
        timeoutUntil: timeout(input.timeoutUntil),
        privateChannelVerified: bool(input.privateChannelVerified),
        canView: bool(input.canView),
        canReadHistory: bool(input.canReadHistory),
        canSend: bool(input.canSend),
        ...(input.privateChannelId === undefined ? {} : { privateChannelId: requireId(input.privateChannelId) }),
    }
    if (result.isBot || (result.privateChannelVerified && !result.privateChannelId)) fail(403, "Ticket member context required")
    return result
}
export function ticketOverwrites(value: unknown): TicketOverwrite[] {
    if (!Array.isArray(value) || value.length > 100) fail(400, "Invalid ticket overwrites")
    const rows = value.map((raw) => {
        const item = shape(raw, ["id", "type", "allow", "deny"], ["id", "type", "allow", "deny"])
        if (item.type !== "role" && item.type !== "member") fail(400, "Invalid ticket overwrite")
        for (const field of ["allow", "deny"] as const)
            if (typeof item[field] !== "string" || !/^(0|[1-9]\d{0,19})$/.test(item[field]) || BigInt(item[field]) > 18446744073709551615n)
                fail(400, "Invalid ticket permissions")
        if ((BigInt(item.allow as string) & BigInt(item.deny as string)) !== 0n) fail(400, "Conflicting ticket permissions")
        return {
            id: requireId(item.id),
            type: item.type as "role" | "member",
            allow: item.allow as string,
            deny: item.deny as string,
        }
    })
    if (new Set(rows.map((r) => r.type + ":" + r.id)).size !== rows.length) fail(400, "Duplicate ticket overwrite")
    return rows.sort((a, b) => a.type.localeCompare(b.type) || (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0))
}
export function ticketChannel(value: unknown): TicketChannelSnapshot {
    const input = shape(
        value,
        ["channelId", "serverId", "type", "name", "parentId", "overwrites"],
        ["channelId", "serverId", "type", "name", "parentId", "overwrites"],
    )
    if (input.type !== "text") fail(400, "Ticket requires text channel")
    return {
        channelId: requireId(input.channelId),
        serverId: requireId(input.serverId),
        type: "text",
        name: text(input.name, 100),
        parentId: input.parentId === null ? null : requireId(input.parentId),
        overwrites: ticketOverwrites(input.overwrites),
    }
}
export function ticketContext(value: unknown): TicketContext {
    const now = Date.now(),
        input = shape(
            value,
            ["observedAt", "actor", "botId", "botAuthorized", "botPostingPermissions", "parentVerified", "channel"],
            ["observedAt", "actor", "botId", "botAuthorized"],
        )
    return {
        observedAt: integer(input.observedAt, now - 60000, now + 1000),
        actor: ticketActor(input.actor),
        botId: requireId(input.botId),
        botAuthorized: bool(input.botAuthorized),
        ...(input.botPostingPermissions === undefined ? {} : { botPostingPermissions: permissionBits(input.botPostingPermissions) }),
        ...(input.parentVerified === undefined ? {} : { parentVerified: bool(input.parentVerified) }),
        ...(input.channel === undefined ? {} : { channel: ticketChannel(input.channel) }),
    }
}
export function ticketQuestions(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > 5) fail(400, "Invalid ticket questions")
    return value.map((q) => text(q, 200))
}
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
export function transcriptBody(value: unknown, threads: unknown = []) {
    if (!Array.isArray(threads) || threads.length > 10) fail(400, "Invalid transcript")
    const groups = threads.map((raw) => {
        const thread = shape(raw, ["threadId", "name", "messages"], ["threadId", "name", "messages"])
        return { header: `Thread ${text(thread.name, 100)} (${requireId(thread.threadId)})`, lines: transcriptLines(thread.messages) }
    })
    const lines = [...transcriptLines(value), ...groups.flatMap((group) => [group.header, ...group.lines])],
        messageCount = lines.length - groups.length
    if (messageCount > 500) fail(400, "Invalid transcript")
    const body = lines.join("\n")
    if (body.length > 200000) fail(413, "Transcript too large")
    return { body, messageCount }
}
function transcriptLines(value: unknown) {
    if (!Array.isArray(value) || value.length > 500) fail(400, "Invalid transcript")
    return value.map((raw) => {
        const item = shape(
            raw,
            ["messageId", "authorId", "createdAt", "content", "omittedAttachments"],
            ["messageId", "authorId", "content", "omittedAttachments"],
        )
        if (typeof item.content !== "string" || item.content.length > 2000) fail(400, "Invalid transcript message")
        const time = item.createdAt === undefined ? "Unknown time" : epoch(item.createdAt),
            attachments = integer(item.omittedAttachments, 0, 100),
            omitted = attachments ? ` [${attachments} attachments omitted]` : ""
        return `[${time}] ${requireId(item.authorId)} (${requireId(item.messageId)}): ${item.content}${omitted}`
    })
}
export { ids, integer, name, text, publishingContent, shape }
