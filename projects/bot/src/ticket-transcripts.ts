import type * as C from "@neonflux/backend/contracts"
import type { Client, Message } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import { TicketHandlingError } from "./tickets.ts"
import type { TicketStore } from "./ticket-store.ts"

// Serialized message bytes, leaving room for request metadata under the backend's 262,144-byte body limit
const messageBudget = 200000

/** Explicit bounded history capture. It neither observes ordinary messages continuously nor claims a complete history */
export function captureTicketTranscript(store: TicketStore, client: Client, source: C.TicketSource, ticket: C.TicketRecord,
    maxMessages: number, refresh: () => Effect.Effect<C.TicketContext, unknown>) {
    return Effect.gen(function* () {
        const channelId = ticket.channelId
        const readable = (context: C.TicketContext) => context.actor.privateChannelVerified && context.actor.canReadHistory
            && context.channel?.channelId === channelId
        if (!channelId || maxMessages < 1 || maxMessages > 500 || !Number.isInteger(maxMessages) || !readable(yield* refresh())) {
            return yield* Effect.fail(new TicketHandlingError({ stage: "transcript" }))
        }
        const capturedAt = yield* Clock.currentTimeMillis
        const messages: C.TicketTranscriptMessage[] = []
        const seen = new Set<string>()
        let before: string | undefined, size = 0, truncated = false, full = false
        for (let page = 0; page < 10 && !full && messages.length < maxMessages; page++) {
            const limit = Math.min(100, maxMessages - messages.length)
            const history: readonly Message[] = yield* client.messages.fetchHistory(channelId, { limit, ...(before ? { before } : {}) })
                .pipe(Effect.timeout("5 seconds"))
            if (!history.length) break
            for (const message of history) {
                if (message.channelId !== channelId || seen.has(message.id) || message.guildId !== undefined && message.guildId !== source.serverId) {
                    return yield* Effect.fail(new TicketHandlingError({ stage: "transcript" }))
                }
                const content = message.content.slice(0, 2000)
                const entry: C.TicketTranscriptMessage = { messageId: message.id, authorId: message.author.id, ...(message.createdAt ? { createdAt: message.createdAt } : {}),
                    content, omittedAttachments: message.attachments.length }
                // JSON escaping can multiply content bytes, so the budget counts each entry as serialized
                const bytes = Buffer.byteLength(JSON.stringify(entry)) + 1
                if (size + bytes > messageBudget) { full = true; break }
                if (content.length < message.content.length) truncated = true
                seen.add(message.id), size += bytes
                messages.push(entry)
            }
            before = history.at(-1)!.id
        }
        const context = yield* refresh()
        if (!readable(context)) return yield* Effect.fail(new TicketHandlingError({ stage: "transcript" }))
        const result = yield* store.transcriptUpload({ ...source, context, ticketNo: ticket.ticketNo, expectedGeneration: ticket.generation, capturedAt,
            messages: messages.reverse(), truncated: truncated || full || messages.length >= maxMessages })
        return result.transcript
    })
}
