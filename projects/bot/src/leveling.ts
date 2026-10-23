import type { LevelingCandidate } from "@neonflux/contracts/leveling"
import { format, MessageType, type Client, type Message } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Redacted } from "effect"
import { createHmac } from "node:crypto"
import type { LevelingStore } from "./level-store.ts"
import { createLevelQueue, levelMaxAgeMs } from "./level-queue.ts"
import { memberFacts, readNativeMember } from "./member-evidence.ts"
import { readChannelParent } from "./channel-parents.ts"
import { contained } from "./contained.ts"

export class LevelingHandlingError extends Data.TaggedError("LevelingHandlingError")<{
    readonly stage: "membership" | "work" | "response"
}> {}

export function levelCandidate(
    message: Message,
    serverId: string,
    secret: Redacted.Redacted<string>,
): LevelingCandidate | undefined {
    if (
        message.guildId !== serverId ||
        message.author.isSystem ||
        message.webhookId ||
        (message.type !== MessageType.Default && message.type !== MessageType.Reply)
    )
        return
    // Bound both input to normalization and its expansion. Text never crosses this function's return boundary.
    const normalized = message.content
        .slice(0, 4096)
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\p{Cf}]/gu, "")
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, 4096)
    const createdAt = Date.parse(message.createdAt ?? "")
    if (!normalized || !Number.isSafeInteger(createdAt) || createdAt < 0) return
    const digest = createHmac("sha256", Redacted.value(secret))
        .update(`neonflux:leveling\u0000${serverId}\u0000${message.author.id}\u0000`)
        .update(normalized)
        .digest("hex")
    return { messageId: message.id, createdAt, userId: message.author.id, channelId: message.channelId, digest }
}

export function processLevelCandidate(
    store: LevelingStore,
    serverId: string,
    client: Client,
    candidate: LevelingCandidate,
) {
    return Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        if (candidate.createdAt < now - levelMaxAgeMs || candidate.createdAt > now + 60000) return
        // Excluded channels cover their threads, so a candidate from a thread carries its parent
        const parentChannelId = yield* readChannelParent(client, candidate.channelId)
        if (parentChannelId) candidate = { ...candidate, parentChannelId }
        const preflight = yield* store.preflight({ serverId, candidate })
        if (!preflight.eligible) return { awarded: false as const, reason: preflight.reason }
        // The message's own member, member events and the message's other handlers usually leave the author cached
        const native = (yield* readNativeMember(client, serverId, candidate.userId, { cached: true })).member
        if (!native) return
        const member = memberFacts(native, serverId, candidate.userId)
        if (!member || member.isBot || Date.parse(member.joinedAt) > candidate.createdAt) return
        const observedAt = yield* Clock.currentTimeMillis
        return yield* store.award({
            serverId,
            candidate,
            policyRevision: preflight.policyRevision,
            fence: preflight.fence,
            member,
            observedAt,
        })
    })
}

/** How long a server whose leveling answered disabled sends no candidates, unless a leveling or preset change rechecks it sooner */
const LEVELING_OFF_RECHECK_MS = 600000
/** Each server's recheck after a change made on the dashboard, which reaches the bot through its dashboard worker */
export const levelingRechecks = new Map<string, () => Effect.Effect<void>>()

export function startLevelCreditWorker(
    store: LevelingStore,
    serverId: string,
    client: Client,
    rewardNotify: Effect.Effect<void> = Effect.void,
) {
    return Effect.gen(function* () {
        const queue = yield* createLevelQueue<LevelingCandidate>()
        // Backend preflight owns enablement. After it answers disabled the server sends no candidates until a change rechecks it or the interval ends
        // A recheck starts a new generation, so a disabled answer to a preflight sent before it cannot pause the server again
        let offUntil = 0,
            generation = 0
        const recheck = () =>
            Effect.sync(() => {
                offUntil = 0
                generation++
            })
        levelingRechecks.set(serverId, recheck)
        yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
                if (levelingRechecks.get(serverId) === recheck) levelingRechecks.delete(serverId)
            }),
        )
        const worker = Effect.gen(function* () {
            for (;;) {
                const candidate = yield* queue.take,
                    asked = generation
                yield* processLevelCandidate(store, serverId, client, candidate).pipe(
                    Effect.tap((result) =>
                        result && !result.awarded && result.reason === "disabled" && asked === generation
                            ? Clock.currentTimeMillis.pipe(
                                  Effect.map((now) => {
                                      offUntil = now + LEVELING_OFF_RECHECK_MS
                                  }),
                              )
                            : Effect.void,
                    ),
                    Effect.tap((result) =>
                        result?.awarded && result.levelUp
                            ? Effect.forkScoped(
                                  contained(
                                      client.messages.send(
                                          result.levelUp.channelId ?? candidate.channelId,
                                          {
                                              content: `${format.userMention(candidate.userId)} reached level ${result.levelUp.level}`,
                                              allowedMentions: {
                                                  users: [],
                                                  roles: [],
                                                  everyone: false,
                                                  repliedUser: false,
                                              },
                                          },
                                          { timeoutMs: 5000 },
                                      ),
                                      "A level-up message could not be sent",
                                  ),
                              )
                            : Effect.void,
                    ),
                    Effect.flatMap((result) => (result?.awarded && result.rewardQueued ? rewardNotify : Effect.void)),
                    Effect.ensuring(queue.release(candidate)),
                    Effect.catchCause((cause) =>
                        Cause.hasInterrupts(cause)
                            ? Effect.failCause(cause)
                            : Effect.logWarning("Message XP candidate dropped after an unverified credit operation"),
                    ),
                )
            }
        })
        yield* worker.pipe(Effect.forkScoped({ startImmediately: true }))
        return {
            offer: queue.offer,
            pending: queue.size,
            recheck,
            wanted: Clock.currentTimeMillis.pipe(Effect.map((now) => now >= offUntil)),
        }
    })
}
