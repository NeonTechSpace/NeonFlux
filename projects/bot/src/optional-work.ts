import { Clock, Effect } from "effect"
import type { AfkStore } from "./afk-store.ts"
import { countOptionalSkip } from "./costs.ts"

/** Per-message work the bot may skip. Moderation, protections and commands are never limited */
type OptionalWork = "afk" | "responses" | "custom" | "levels" | "analytics" | "sticky" | "helpdesk"

// Only the autoresponder check has a token bucket. A server may spend a burst at once and then the refill rate, so one very busy
// server cannot take a large share of the backend calls every server shares, and a refusal counts into the cost summary. Custom
// commands run on the member's own prefixed message, AFK memory skips the backend for members it knows have no status, and XP
// keeps one pending message per member behind the backend's own cooldown, so none of them needs a rate limit. Analytics counts
// in memory and sends at most one request per five minutes per server. A sticky repost costs one backend call and waits for its
// channel's interval, so at most five channels per server repost once per interval each. A new post in a help desk forum costs
// one backend call for its reply reminder, bounded by how fast members start posts. Only the bill guard pauses these
export const optionalWorkLimits = {
    responses: { burst: 30, perMinute: 60 },
} as const satisfies Partial<Record<OptionalWork, { readonly burst: number; readonly perMinute: number }>>

/** One server's admission for optional work. It is refused while the bill guard pauses optional work or the server's bucket is empty */
export function createOptionalWork(paused: () => boolean) {
    const buckets = new Map<OptionalWork, { tokens: number; at: number }>()
    return (kind: OptionalWork) =>
        Clock.currentTimeMillis.pipe(
            Effect.map((now) => {
                if (paused()) return false
                if (kind !== "responses") return true
                const limit = optionalWorkLimits[kind],
                    bucket = buckets.get(kind) ?? { tokens: limit.burst, at: now }
                bucket.tokens = Math.min(limit.burst, bucket.tokens + ((now - bucket.at) * limit.perMinute) / 60000)
                bucket.at = now
                buckets.set(kind, bucket)
                if (bucket.tokens < 1) {
                    countOptionalSkip()
                    return false
                }
                bucket.tokens--
                return true
            }),
        )
}
type OptionalWorkAdmission = ReturnType<typeof createOptionalWork>

/** How many members each server's memories hold. An evicted member costs one more backend call or one more preflight */
export const MEMORY_MEMBERS = 5000
/** Adds a member to a memory of at most MEMORY_MEMBERS, dropping the oldest entry when it is full */
export function remember<V>(memory: Map<string, V>, key: string, value: V) {
    memory.delete(key)
    if (memory.size >= MEMORY_MEMBERS) memory.delete(memory.keys().next().value!)
    memory.set(key, value)
}

/**
 * AFK that remembers which members have no status, so a message whose author and mentions are all known costs no backend call.
 * The bill guard still pauses observation, and a paused message clears no status and names no AFK member. Setting a status is
 * a command and always runs. A member leaves the memory before their status is set and joins it only from a successful
 * observation, so a failed call or a status set elsewhere is never hidden
 */
export function rememberAfk(store: AfkStore, admit: OptionalWorkAdmission): AfkStore {
    const clear = new Map<string, true>()
    return {
        set: (userId, reason) => {
            clear.delete(userId)
            return store.set(userId, reason).pipe(Effect.ensuring(Effect.sync(() => clear.delete(userId))))
        },
        observe: (userId, mentionedUserIds) =>
            admit("afk").pipe(
                Effect.flatMap((allowed) => {
                    if (!allowed) return Effect.succeed({ cleared: false, statuses: [] })
                    if (clear.has(userId) && mentionedUserIds.every((id) => clear.has(id)))
                        return Effect.succeed({ cleared: false, statuses: [] })
                    return store.observe(userId, mentionedUserIds).pipe(
                        Effect.tap((result) =>
                            Effect.sync(() => {
                                // The author's status is gone after an observation, and a mention without a status has none
                                remember(clear, userId, true)
                                for (const id of mentionedUserIds)
                                    if (!result.statuses.some((status) => status.userId === id))
                                        remember(clear, id, true)
                            }),
                        ),
                    )
                }),
            ),
    }
}
