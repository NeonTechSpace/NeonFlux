import type { CleanupMessage, CleanupPolicy, CleanupSkipReason, CleanupSweep } from "@neonflux/contracts/cleanup"
import { isThreadChannel, MessageType, snowflakes, type Client, type GuildChannel, type Message } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import { cleanupTimestamp } from "./cleanup-permissions.ts"

export class CleanupEvidenceError extends Data.TaggedError("CleanupEvidenceError")<{ readonly stage: "identity" | "history" | "metadata" | "absent" }> {}
const identifier = (value: unknown) => snowflakes.isValid(value) && value !== "0" ? value : null
/** The SDK keeps an omitted pin flag absent, which stays unknown here. Fluxer omits false author flags, which the SDK reads
 * as false: https://docs.fluxer.app/http-api/users/#partial-user-object. Bodies never leave this projection */
export function cleanupMessageMetadata(message: Message, channelId: string, observedAt: number): CleanupMessage {
    const messageId = identifier(message.id)
    if (messageId === null || message.channelId !== channelId
        || message.guildId !== undefined && identifier(message.guildId) === null
        || message.webhookId !== undefined && identifier(message.webhookId) === null)
        throw new CleanupEvidenceError({ stage: "identity" })
    return {
        messageId, channelId, serverId: identifier(message.guildId), observedAt, createdAt: message.createdAt ?? null,
        authorId: identifier(message.author.id), authorBot: message.author.isBot, authorSystem: message.author.isSystem ?? false,
        type: message.type ?? null, pinned: message.pinned ?? null, webhookId: identifier(message.webhookId),
    }
}
export function cleanupSkip(message: CleanupMessage, serverId: string, channelId: string, cutoffAt: number, policy: Pick<CleanupPolicy, "excludedAuthorIds" | "excludedMessageIds">): CleanupSkipReason | undefined {
    if (message.messageId === "0" || !snowflakes.isValid(message.messageId) || message.channelId !== channelId || message.serverId !== null && message.serverId !== serverId) return "identity-unknown"
    if (message.pinned !== false) return message.pinned === true ? "pinned" : "pin-unknown"
    if (message.authorBot === true) return "bot"
    if (message.webhookId !== null) return "webhook"
    if (message.authorSystem === true || message.type !== null && message.type !== MessageType.Default && message.type !== MessageType.Reply) return "system"
    if (!message.authorId || message.authorBot !== false || message.authorSystem !== false || message.type === null) return "identity-unknown"
    const timestamp = cleanupTimestamp(message.messageId, message.createdAt)
    if (timestamp === undefined) return "timestamp-unknown"
    if (timestamp >= cutoffAt) return "too-new"
    if (policy.excludedAuthorIds.includes(message.authorId)) return "excluded-author"
    if (policy.excludedMessageIds.includes(message.messageId)) return "excluded-message"
}
// A thread read for a policy must belong to the policy's channel
const inChannel = (channel: GuildChannel, parentId?: string) => parentId === undefined || isThreadChannel(channel) && channel.parentId === parentId
/** One message read supplies pin status and author flags. parentId names the policy channel of a thread's message */
export function fetchCleanupMessage(client: Client, channelId: string, messageId: string, serverId?: string, parentId?: string) {
    return Effect.gen(function* () {
        const channel = serverId ? yield* client.channels.fetch(channelId, { timeoutMs: 5000 }) : undefined
        if (channel && (channel.id !== channelId || channel.guildId !== serverId || !inChannel(channel, parentId))) return yield* Effect.fail(new CleanupEvidenceError({ stage: "identity" }))
        const read = yield* client.messages.fetch({ id: messageId, channelId }, { timeoutMs: 5000 }).pipe(
            Effect.catch(error => Effect.fail(error._tag === "MessageOperationError" && error.status === 404 ? new CleanupEvidenceError({ stage: "absent" }) : error)))
        const observedAt = yield* Clock.currentTimeMillis
        const message = yield* Effect.try({ try: () => cleanupMessageMetadata(read, channelId, observedAt), catch: () => new CleanupEvidenceError({ stage: "metadata" }) })
        if (message.messageId !== messageId) return yield* Effect.fail(new CleanupEvidenceError({ stage: "identity" }))
        return { ...message, ...(channel ? { originServerId: channel.guildId } : {}) }
    })
}
export function fetchCleanupHistory(client: Client, serverId: string, channelId: string, before: string, parentId?: string) {
    return Effect.gen(function* () {
        const channel = yield* client.channels.fetch(channelId, { timeoutMs: 5000 })
        if (channel.id !== channelId || channel.guildId !== serverId || !inChannel(channel, parentId) || !snowflakes.isValid(before)) return yield* Effect.fail(new CleanupEvidenceError({ stage: "history" }))
        const page = yield* client.messages.fetchHistory(channelId, { limit: 50, before }, { timeoutMs: 5000 })
        if (page.length > 50) return yield* Effect.fail(new CleanupEvidenceError({ stage: "history" }))
        const observedAt = yield* Clock.currentTimeMillis
        const messages = yield* Effect.try({
            try: () => page.map(m => ({ ...cleanupMessageMetadata(m, channelId, observedAt), originServerId: channel.guildId })),
            catch: () => new CleanupEvidenceError({ stage: "history" }),
        })
        // A page runs strictly newest first below its cursor, so the oldest ID advances it
        if (messages.some((m, index) => m.serverId !== null && m.serverId !== serverId || BigInt(m.messageId) >= BigInt(index === 0 ? before : messages[index - 1]!.messageId)))
            return yield* Effect.fail(new CleanupEvidenceError({ stage: "history" }))
        return messages
    })
}
/** The active thread of a policy channel that a sweep reads next: The oldest one after the thread just read and created before
 * the cutoff, since a newer thread holds no message older than it. Archived threads wait until they are active again */
export function nextCleanupThread(client: Client, serverId: string, sweep: CleanupSweep) {
    return client.threads.fetchActive(serverId, { timeoutMs: 5000 }).pipe(Effect.map(threads => {
        const after = BigInt(sweep.threadId ?? "0"), boundary = BigInt(snowflakes.boundary(new Date(sweep.cutoffAt)))
        const ids = threads.filter(thread => thread.parentId === sweep.channelId && BigInt(thread.id) > after && BigInt(thread.id) < boundary).map(thread => BigInt(thread.id))
        return ids.length ? ids.reduce((a, b) => b < a ? b : a).toString() : undefined
    }))
}
