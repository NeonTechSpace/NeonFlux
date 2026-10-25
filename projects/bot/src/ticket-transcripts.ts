import type { TicketDueTranscript, TicketTranscriptMessage } from "@neonflux/contracts/tickets"
import {
    ChannelType,
    errors,
    type Client,
    type Embed,
    type GuildThreadChannel,
    type Message,
} from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { TicketHandlingError } from "./tickets.ts"
import type { TicketStore } from "./ticket-store.ts"
import { snapshotTicketChannel } from "./ticket-permissions.ts"
import { clip } from "./reply-style.ts"

/** Serialized message bytes per append, leaving room for request metadata under the backend's 262,144-byte body limit */
export const transcriptChunkBytes = 200000
// One Fluxer history page, and the most archived threads one read lists
const historyPage = 100,
    threadPage = 100

/** An embed as one line of text: its title, description, fields and footer */
function embedText(embed: Embed) {
    return [
        embed.title,
        embed.description,
        ...(embed.fields ?? []).map((field) => `${field.name}: ${field.value}`),
        embed.footer?.text,
    ]
        .filter((part) => part !== undefined && part.trim() !== "")
        .join(". ")
        .replace(/\s*\n\s*/g, " ")
}
/** One message as the transcript keeps it: its text, attachment links, embed text and sticker names */
export function transcriptMessage(message: Message): TicketTranscriptMessage {
    const embeds = message.embeds.map((embed) => clip(embedText(embed), 6000, "")).filter((text) => text !== "")
    return {
        messageId: message.id,
        authorId: message.author.id,
        authorName: clip(message.author.displayName || message.author.username, 100, ""),
        ...(message.createdAt ? { createdAt: message.createdAt } : {}),
        content: clip(message.content, 8000, ""),
        ...(message.attachments.length
            ? {
                  attachments: message.attachments.slice(0, 100).map((file) => ({
                      filename: clip(file.filename, 1000, ""),
                      size: Math.max(0, Math.floor(file.size)),
                      ...(file.url ? { url: clip(file.url, 4000, "") } : {}),
                  })),
              }
            : {}),
        ...(embeds.length ? { embeds: embeds.slice(0, 100) } : {}),
        ...(message.stickers.length
            ? { stickers: message.stickers.slice(0, 100).map((sticker) => clip(sticker.name, 100, "")) }
            : {}),
    }
}
/** Splits messages into appends whose serialized messages stay under the byte budget */
export function transcriptChunks(messages: readonly TicketTranscriptMessage[], budget = transcriptChunkBytes) {
    const chunks: TicketTranscriptMessage[][] = []
    let current: TicketTranscriptMessage[] = [],
        size = 0
    for (const message of messages) {
        // JSON escaping can multiply content bytes, so each message counts as serialized
        const bytes = Buffer.byteLength(JSON.stringify(message)) + 1
        if (current.length && size + bytes > budget) {
            chunks.push(current)
            current = []
            size = 0
        }
        current.push(message)
        size += bytes
    }
    if (current.length) chunks.push(current)
    return chunks
}
/** The ticket channel's public threads, active and every archived page, oldest first. A private thread's members need not match the transcript's readers */
export function ticketPublicThreads(client: Client, serverId: string, channelId: string) {
    return Effect.gen(function* () {
        const found = new Map<string, GuildThreadChannel>()
        for (const thread of yield* client.threads.fetchActive(serverId, { timeoutMs: 5000 }))
            found.set(thread.id, thread)
        let before: string | undefined
        for (;;) {
            const page = yield* client.threads.fetchArchived(
                channelId,
                { scope: "public", limit: threadPage, ...(before ? { before } : {}) },
                { timeoutMs: 5000 },
            )
            for (const thread of page.threads) found.set(thread.id, thread)
            const last = page.threads.at(-1)
            if (!page.hasMore || !last || last.archiveTimestamp === before) break
            before = last.archiveTimestamp
        }
        return [...found.values()]
            .filter((thread) => thread.parentId === channelId && thread.type === ChannelType.PublicThread)
            .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
    })
}

/**
 * Brings one due ticket's automatic transcript up to date: the ticket channel, then each public thread, each read forward
 * from the last message the transcript holds until a page comes back empty. A channel that is gone answers absent
 */
export function saveTicketTranscript(store: TicketStore, client: Client, serverId: string, due: TicketDueTranscript) {
    return Effect.gen(function* () {
        const native = yield* client.channels.fetch(due.channelId, { timeoutMs: 5000 }).pipe(
            Effect.map((channel) => channel as typeof channel | undefined),
            Effect.catchIf(
                (error) => errors.isNotFound(error, "channel"),
                () => Effect.succeed(undefined),
            ),
        )
        if (!native) return "absent" as const
        const channel = yield* snapshotTicketChannel(native)
        if (channel.serverId !== serverId || channel.channelId !== due.channelId)
            return yield* Effect.fail(new TicketHandlingError({ stage: "transcript" }))
        const sources = [
            { id: due.channelId },
            ...(yield* ticketPublicThreads(client, serverId, due.channelId)).map((thread) => ({
                id: thread.id,
                thread: clip(thread.name, 100, ""),
            })),
        ]
        for (const source of sources) {
            const cursor = yield* store.work({
                serverId,
                operation: { type: "cursor", ticketNo: due.ticketNo, sourceId: source.id },
            })
            if (cursor.type !== "cursor") return yield* Effect.fail(new TicketHandlingError({ stage: "transcript" }))
            let after = cursor.lastMessageId
            for (;;) {
                const page = yield* client.messages.fetchHistory(
                    source.id,
                    { after: after ?? source.id, limit: historyPage },
                    { timeoutMs: 5000 },
                )
                const fresh = page
                    .filter((message) => after === null || BigInt(message.id) > BigInt(after))
                    .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
                if (!fresh.length) break
                if (
                    fresh.some(
                        (message) => message.channelId !== source.id || (message.guildId ?? serverId) !== serverId,
                    )
                )
                    return yield* Effect.fail(new TicketHandlingError({ stage: "transcript" }))
                for (const messages of transcriptChunks(fresh.map(transcriptMessage))) {
                    yield* store.transcriptAppend({
                        serverId,
                        ticketNo: due.ticketNo,
                        dueAt: due.dueAt,
                        botId: due.botId,
                        channel,
                        source,
                        after,
                        messages,
                    })
                    after = messages.at(-1)!.messageId
                }
            }
        }
        return "saved" as const
    })
}

/** A transcript file of at most this size. A longer transcript arrives as several numbered files, like a server export */
export const TRANSCRIPT_FILE_BYTES = 4 * 1024 * 1024
/** Collects transcript pages into file parts at line ends. add answers a full part to send before the text goes on */
export function transcriptFileParts(partBytes = TRANSCRIPT_FILE_BYTES) {
    let text = "",
        size = 0
    const encoder = new TextEncoder()
    return {
        add(page: string): Uint8Array[] {
            const full: Uint8Array[] = []
            text += page
            size += Buffer.byteLength(page)
            while (size > partBytes) {
                // Cut at the last line end that fits, or at the size when a line alone is longer
                const bytes = encoder.encode(text)
                let cut = bytes.lastIndexOf(10, partBytes - 1) + 1
                if (cut <= 0) cut = partBytes
                full.push(bytes.slice(0, cut))
                text = new TextDecoder().decode(bytes.slice(cut))
                size = bytes.length - cut
            }
            return full
        },
        finish: () => encoder.encode(text),
    }
}
