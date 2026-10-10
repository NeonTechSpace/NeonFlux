import type { TicketContext, TicketRecord, TicketSource, TicketTranscriptMessage, TicketTranscriptThread } from "@neonflux/contracts/tickets"
import { ChannelType, type Client, type GuildThreadChannel, type Message } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import { TicketHandlingError } from "./tickets.ts"
import type { TicketStore } from "./ticket-store.ts"

// Serialized message bytes, leaving room for request metadata under the backend's 262,144-byte body limit
const messageBudget = 200000
// Threads share what the channel leaves of the bounds, oldest thread first, each with one history read of its newest messages
const threadLimit = 10

/** Explicit bounded history capture. It neither observes ordinary messages continuously nor claims a complete history */
export function captureTicketTranscript(store: TicketStore, client: Client, source: TicketSource, ticket: TicketRecord,
    maxMessages: number, refresh: () => Effect.Effect<TicketContext, unknown>) {
    return Effect.gen(function* () {
        const channelId = ticket.channelId
        const readable = (context: TicketContext) => context.actor.privateChannelVerified && context.actor.canReadHistory
            && context.channel?.channelId === channelId
        if (!channelId || maxMessages < 1 || maxMessages > 500 || !Number.isInteger(maxMessages) || !readable(yield* refresh())) {
            return yield* Effect.fail(new TicketHandlingError({ stage: "transcript" }))
        }
        const capturedAt = yield* Clock.currentTimeMillis
        const messages: TicketTranscriptMessage[] = [], threads: TicketTranscriptThread[] = []
        const seen = new Set<string>()
        let before: string | undefined, size = 0, count = 0, truncated = false, full = false
        // Adds one message of a page read newest first, or reports that the byte budget is spent
        const take = (into: TicketTranscriptMessage[], fromChannelId: string, message: Message) => Effect.gen(function* () {
            if (message.channelId !== fromChannelId || seen.has(message.id) || message.guildId !== undefined && message.guildId !== source.serverId) {
                return yield* Effect.fail(new TicketHandlingError({ stage: "transcript" }))
            }
            const content = message.content.slice(0, 2000)
            const entry: TicketTranscriptMessage = { messageId: message.id, authorId: message.author.id, ...(message.createdAt ? { createdAt: message.createdAt } : {}),
                content, omittedAttachments: message.attachments.length }
            // JSON escaping can multiply content bytes, so the budget counts each entry as serialized
            const bytes = Buffer.byteLength(JSON.stringify(entry)) + 1
            if (size + bytes > messageBudget) { full = true; return false }
            if (content.length < message.content.length) truncated = true
            seen.add(message.id), size += bytes, count++
            into.push(entry)
            return true
        })
        for (let page = 0; page < 10 && !full && count < maxMessages; page++) {
            const limit = Math.min(100, maxMessages - count)
            const history: readonly Message[] = yield* client.messages.fetchHistory(channelId, { limit, ...(before ? { before } : {}) })
                .pipe(Effect.timeout("5 seconds"))
            if (!history.length) break
            for (const message of history) if (!(yield* take(messages, channelId, message))) break
            before = history.at(-1)!.id
        }
        if (!full && count < maxMessages) {
            // Public threads only: a private thread's members need not match the transcript's readers.
            // A list Fluxer refuses keeps the channel's capture and marks it truncated, since threads may be missing
            const unlisted = { threads: [] as readonly GuildThreadChannel[], hasMore: true }
            const active = yield* client.threads.fetchActive(source.serverId, { timeoutMs: 5000 }).pipe(Effect.catch(() => Effect.succeed(undefined)))
            const archived = yield* client.threads.fetchArchived(channelId, { scope: "public", limit: 100 }, { timeoutMs: 5000 }).pipe(Effect.catch(() => Effect.succeed(unlisted)))
            const found = new Map<string, GuildThreadChannel>()
            for (const thread of [...active ?? [], ...archived.threads]) if (thread.parentId === channelId && thread.type === ChannelType.PublicThread) found.set(thread.id, thread)
            const ordered = [...found.values()].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1)
            if (!active || archived.hasMore || ordered.length > threadLimit) truncated = true
            for (const thread of ordered.slice(0, threadLimit)) {
                if (full || count >= maxMessages) { truncated = true; break }
                const limit = Math.min(100, maxMessages - count)
                const history: readonly Message[] = yield* client.messages.fetchHistory(thread.id, { limit }).pipe(Effect.timeout("5 seconds"))
                if (history.length >= limit) truncated = true
                const group: TicketTranscriptThread = { threadId: thread.id, name: thread.name, messages: [] }
                const header = Buffer.byteLength(JSON.stringify(group)) + 1
                if (size + header > messageBudget) { full = true; break }
                size += header
                for (const message of history) if (!(yield* take(group.messages, thread.id, message))) break
                if (group.messages.length) threads.push({ ...group, messages: group.messages.reverse() })
            }
        }
        const context = yield* refresh()
        if (!readable(context)) return yield* Effect.fail(new TicketHandlingError({ stage: "transcript" }))
        const result = yield* store.transcriptUpload({ ...source, context, ticketNo: ticket.ticketNo, expectedGeneration: ticket.generation, capturedAt,
            messages: messages.reverse(), ...(threads.length ? { threads } : {}), truncated: truncated || full || count >= maxMessages })
        return result.transcript
    })
}
