import type * as C from "@neonflux/backend/contracts"
import { MessageType, type Client, type Message } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Redacted } from "effect"
import { createHmac } from "node:crypto"
import type { LevelingStore } from "./level-store.ts"
import { createLevelQueue, levelMaxAgeMs } from "./level-queue.ts"
import { levelingMember, readNativeMember } from "./member-evidence.ts"
import { readChannelParent } from "./fluxerly-next.ts"

export class LevelingHandlingError extends Data.TaggedError("LevelingHandlingError")<{ readonly stage: "membership" | "work" | "response" }> {}

export function levelCandidate(message: Message, serverId: string, secret: Redacted.Redacted<string>): C.LevelingCandidate | undefined {
    if (message.guildId !== serverId || message.author.isSystem || message.webhookId
        || message.type !== MessageType.Default && message.type !== MessageType.Reply) return
    // Bound both input to normalization and its expansion. Text never crosses this function's return boundary.
    const normalized = message.content.slice(0, 4096).normalize("NFKC").toLowerCase().replace(/[\p{Cf}]/gu, "").replace(/\s+/gu, " ").trim().slice(0, 4096)
    const createdAt = Date.parse(message.createdAt ?? "")
    if (!normalized || !Number.isSafeInteger(createdAt) || createdAt < 0) return
    const digest = createHmac("sha256", Redacted.value(secret))
        .update(`neonflux:leveling\u0000${serverId}\u0000${message.author.id}\u0000`)
        .update(normalized)
        .digest("hex")
    return { messageId: message.id, createdAt, userId: message.author.id, channelId: message.channelId, digest }
}

export function processLevelCandidate(store: LevelingStore, serverId: string, client: Client, candidate: C.LevelingCandidate) {
    return Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        if (candidate.createdAt < now - levelMaxAgeMs || candidate.createdAt > now + 60000) return
        // Excluded channels cover their threads, so a candidate from a thread carries its parent
        const parentChannelId = yield* readChannelParent(client, candidate.channelId)
        if (parentChannelId) candidate = { ...candidate, parentChannelId }
        const preflight = yield* store.preflight({ serverId, candidate })
        if (!preflight.eligible) return { awarded: false as const, reason: preflight.reason }
        // Member events and the message's other handlers usually leave the author cached
        const native = (yield* readNativeMember(client, serverId, candidate.userId, { cached: true })).member
        if (!native) return
        const member = levelingMember(native, serverId, candidate.userId)
        if (!member || member.isBot || Date.parse(member.joinedAt) > candidate.createdAt) return
        const observedAt = yield* Clock.currentTimeMillis
        return yield* store.award({ serverId, candidate, policyRevision: preflight.policyRevision, fence: preflight.fence, member, observedAt })
    })
}

export function startLevelCreditWorker(store: LevelingStore, serverId: string, client: Client, rewardNotify: Effect.Effect<void> = Effect.void) {
    return Effect.gen(function* () {
        const queue = yield* createLevelQueue<C.LevelingCandidate>()
        // Every candidate reaches backend preflight, which owns enablement. No local hint can go stale.
        const worker = Effect.gen(function* () {
            for (;;) {
                const candidate = yield* queue.take
                yield* processLevelCandidate(store, serverId, client, candidate).pipe(
                    Effect.flatMap(result => result?.awarded && result.rewardQueued ? rewardNotify : Effect.void),
                    Effect.ensuring(queue.release(candidate)),
                    Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
                        : Effect.logWarning("Message XP candidate dropped after an unverified credit operation")))
            }
        })
        yield* worker.pipe(Effect.forkScoped({ startImmediately: true }))
        return { offer: queue.offer, pending: queue.size }
    })
}
