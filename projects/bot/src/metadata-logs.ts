import type { MetadataLogsEmbed, MetadataLogsRecord, MetadataLogsObservation } from "@neonflux/contracts/metadata-logs"
import { randomBytes } from "node:crypto"
import { MessageOperationError, snowflakes, type Client } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect, Exit } from "effect"
import { cleanupRecord } from "./cleanup-permissions.ts"
import { readMetadataLogAutomationContext, readMetadataLogContext } from "./metadata-log-permissions.ts"
import { metadataLogBinding, type MetadataLogsStore } from "./metadata-log-store.ts"
import { noMentions } from "./responses.ts"

export class MetadataLogHandlingError extends Data.TaggedError("MetadataLogHandlingError")<{ readonly stage: "response" | "authority" | "expired" | "private" }> {}
export function matchesMetadataLogSnapshot(raw: unknown, expected: { messageId: string, channelId: string, botId: string, content: string, embed?: MetadataLogsEmbed, serverId: string }) {
    const v = cleanupRecord(raw), author = cleanupRecord(v?.author)
    const embeds = v?.embeds
    const embed = Array.isArray(embeds) && embeds.length === 1 ? cleanupRecord(embeds[0]) : undefined
    const matchesEmbed = expected.embed ? !!embed && (embed.type === undefined || embed.type === "rich")
        && Object.keys(embed).every(key => ["type", "title", "description", "color"].includes(key))
        && embed.title === expected.embed.title && embed.description === expected.embed.description && embed.color === expected.embed.color
        : embeds === undefined || Array.isArray(embeds) && embeds.length === 0
    return v?.id === expected.messageId && v.channel_id === expected.channelId && author?.id === expected.botId && author.bot === true
        && (author.system === undefined || author.system === false) && (v.guild_id === undefined || v.guild_id === expected.serverId) && v.content === expected.content
        && matchesEmbed && (v.attachments === undefined || Array.isArray(v.attachments) && v.attachments.length === 0)
        && (v.webhook_id === undefined || v.webhook_id === null)
}

/** Reserve, claim once, send and record the outcome. A lost claim response never sends */
export function executeMetadataLogRecord(store: MetadataLogsStore, serverId: string, client: Client, record: MetadataLogsRecord) {
    return Effect.gen(function* () {
        const delivery = record.delivery
        if (!delivery || delivery.claimedAt !== undefined || delivery.state !== "queued" && delivery.state !== "reserved" && !(delivery.state === "failed" && delivery.noDispatch)) return { attempted: false, sent: false }
        const { context } = yield* readMetadataLogAutomationContext(client, serverId, delivery.channelId)
        if (!context.botAuthorized) return yield* Effect.fail(new MetadataLogHandlingError({ stage: "authority" }))
        const reserved = yield* store.work({ serverId, operation: { type: "reserve", binding: metadataLogBinding(delivery), context } })
        if (reserved.type === "record") return { attempted: false, sent: false }
        if (reserved.type !== "reserved") return yield* Effect.fail(new MetadataLogHandlingError({ stage: "response" }))
        const grant = reserved.grant, binding = metadataLogBinding(grant), claimToken = randomBytes(16).toString("hex")
        const claim = yield* store.work({ serverId, operation: { type: "claim", binding, context, claimToken } })
        if (claim.type !== "claimed" || !claim.claimed) return { attempted: false, sent: false }
        const startedAt = yield* Clock.currentTimeMillis
        if (startedAt >= grant.dispatchExpiresAt) {
            // This invocation owns the claim but has not called the provider. Never replay this claim.
            yield* store.work({ serverId, operation: { type: "outcome", binding, claimToken, outcome: "failed", observedAt: startedAt } })
            return { attempted: false, sent: false }
        }
        const sent = yield* Effect.exit(client.messages.send(grant.channelId, { content: grant.content, ...(grant.embed ? { embeds: [grant.embed] } : {}), allowedMentions: noMentions }, { timeoutMs: 5000 }))
        const messageId = Exit.isSuccess(sent) && snowflakes.isValid(sent.value.id) && sent.value.id !== "0" && sent.value.channelId === grant.channelId ? sent.value.id : undefined
        yield* store.work({ serverId, operation: { type: "outcome", binding, claimToken, outcome: messageId ? "sent" : "uncertain", ...(messageId ? { messageId } : {}), observedAt: yield* Clock.currentTimeMillis } })
        return { attempted: true, sent: messageId !== undefined }
    })
}

export function observeMetadataLogRecord(client: Client, serverId: string, actorId: string, record: MetadataLogsRecord) {
    return Effect.gen(function* () {
        const d = record.delivery
        if (!d?.grant || !d.messageId || d.claimedAt === undefined) return yield* Effect.fail(new MetadataLogHandlingError({ stage: "response" }))
        const authority = yield* readMetadataLogContext(client, serverId, actorId, d.channelId)
        if (!authority.context.botAuthorized || authority.context.botId !== d.grant.botId) return yield* Effect.fail(new MetadataLogHandlingError({ stage: "authority" }))
        let status: MetadataLogsObservation["status"] = "unknown"
        const response = yield* client.messages.fetch({ channelId: d.channelId, id: d.messageId }, { timeoutMs: 5000 }).pipe(Effect.map(() => "present" as const),
            Effect.catch(error => Effect.succeed(error instanceof MessageOperationError && error.reason === "notFound" && error.status === 404 ? "absent" as const : "unknown" as const)))
        if (response === "absent") {
            const fresh = yield* readMetadataLogContext(client, serverId, actorId, d.channelId)
            if (fresh.context.botAuthorized) status = "absent"
        } else if (response === "present") {
            const raw = yield* client.rest.request({ method: "GET", path: `/channels/${d.channelId}/messages/${d.messageId}`, timeoutMs: 5000 }).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (raw?.status === 200) status = matchesMetadataLogSnapshot(raw.body, { messageId: d.messageId, channelId: d.channelId, botId: d.grant.botId, content: d.grant.content, ...(d.grant.embed ? { embed: d.grant.embed } : {}), serverId }) ? "match" : "conflict"
        }
        return { originServerId: authority.authority.guild.id, messageId: d.messageId, channelId: d.channelId, botId: d.grant.botId, observedAt: yield* Clock.currentTimeMillis, status,
            ...(status === "match" ? { content: d.grant.content, ...(d.grant.embed ? { embed: d.grant.embed } : {}) } : {}) } satisfies MetadataLogsObservation
    })
}
