import type * as C from "@neonflux/backend/contracts"
import { MessageType, snowflakes, type Client } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import { cleanupRecord, cleanupTimestamp } from "./cleanup-permissions.ts"

export class CleanupEvidenceError extends Data.TaggedError("CleanupEvidenceError")<{ readonly stage: "identity" | "history" | "metadata" | "absent" }> {}
const identifier = (value: unknown) => snowflakes.isValid(value) && value !== "0" ? value : null
const boolean = (value: unknown) => typeof value === "boolean" ? value : null
// Fluxer omits false author flags: https://docs.fluxer.app/http-api/users/#partial-user-object
const authorFlag = (value: unknown) => value === undefined ? false : boolean(value)
export function cleanupMessageMetadata(raw: unknown, channelId: string, observedAt: number): C.CleanupMessage {
    const value = cleanupRecord(raw), author = cleanupRecord(value?.author), messageId = identifier(value?.id)
    if (!value || !author || messageId === null || value.channel_id !== channelId
        || value.guild_id !== undefined && identifier(value.guild_id) === null
        || value.webhook_id !== undefined && value.webhook_id !== null && identifier(value.webhook_id) === null)
        throw new CleanupEvidenceError({ stage: "identity" })
    return {
        messageId, channelId, serverId: identifier(value.guild_id), observedAt,
        createdAt: typeof value.timestamp === "string" ? value.timestamp : null,
        authorId: identifier(author.id), authorBot: authorFlag(author.bot), authorSystem: authorFlag(author.system),
        type: typeof value.type === "number" && Number.isSafeInteger(value.type) ? value.type : null,
        pinned: boolean(value.pinned), webhookId: identifier(value.webhook_id),
    }
}
export function cleanupSkip(message: C.CleanupMessage, serverId: string, channelId: string, cutoffAt: number, policy: Pick<C.CleanupPolicy, "excludedAuthorIds" | "excludedMessageIds">): C.CleanupSkipReason | undefined {
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
/** One raw read supplies pin and author-flag presence. Bodies never leave this projection */
export function fetchCleanupMessage(client: Client, channelId: string, messageId: string, serverId?: string) {
    return Effect.gen(function* () {
        const channel = serverId ? yield* client.channels.fetch(channelId, { timeoutMs: 5000 }) : undefined
        if (channel && (channel.id !== channelId || channel.guildId !== serverId)) return yield* Effect.fail(new CleanupEvidenceError({ stage: "identity" }))
        const response = yield* client.rest.request({ method: "GET", path: `/channels/${channelId}/messages/${messageId}`, timeoutMs: 5000 }).pipe(
            Effect.catch(error => Effect.fail(error._tag === "RestRequestError" && error.status === 404 ? new CleanupEvidenceError({ stage: "absent" }) : error)))
        if (response.status !== 200) return yield* Effect.fail(new CleanupEvidenceError({ stage: "metadata" }))
        const observedAt = yield* Clock.currentTimeMillis
        const message = yield* Effect.try({ try: () => cleanupMessageMetadata(response.body, channelId, observedAt), catch: () => new CleanupEvidenceError({ stage: "metadata" }) })
        if (message.messageId !== messageId) return yield* Effect.fail(new CleanupEvidenceError({ stage: "identity" }))
        return { ...message, ...(channel ? { originServerId: channel.guildId } : {}) }
    })
}
export function fetchCleanupHistory(client: Client, serverId: string, channelId: string, before: string) {
    return Effect.gen(function* () {
        const channel = yield* client.channels.fetch(channelId, { timeoutMs: 5000 })
        if (channel.id !== channelId || channel.guildId !== serverId || !snowflakes.isValid(before)) return yield* Effect.fail(new CleanupEvidenceError({ stage: "history" }))
        const response = yield* client.rest.request({ method: "GET", path: `/channels/${channelId}/messages`, query: { limit: 50, before }, timeoutMs: 5000 })
        if (response.status !== 200 || !Array.isArray(response.body) || response.body.length > 50) return yield* Effect.fail(new CleanupEvidenceError({ stage: "history" }))
        const raw = response.body as unknown[], observedAt = yield* Clock.currentTimeMillis
        const messages = yield* Effect.try({
            try: () => raw.map(m => ({ ...cleanupMessageMetadata(m, channelId, observedAt), originServerId: channel.guildId })),
            catch: () => new CleanupEvidenceError({ stage: "history" }),
        })
        // A page runs strictly newest first below its cursor, so the oldest ID advances it
        if (messages.some((m, index) => m.serverId !== null && m.serverId !== serverId || BigInt(m.messageId) >= BigInt(index === 0 ? before : messages[index - 1]!.messageId)))
            return yield* Effect.fail(new CleanupEvidenceError({ stage: "history" }))
        return messages
    })
}
