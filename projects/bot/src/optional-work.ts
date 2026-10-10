import { Clock, Effect } from "effect"
import type { AfkStore } from "./afk-store.ts"

/** Per-message work the bot may skip. Moderation, protections and commands are never limited */
export type OptionalWork = "afk" | "responses" | "levels" | "analytics" | "sticky" | "helpdesk"

// Token buckets per server. A server may spend a burst at once and then the refill rate, so one very busy server cannot take
// a large share of the backend calls every server shares. AFK observation and response evaluation cost one call per message,
// a level credit up to two. Analytics counts in memory and sends at most one request per five minutes per server, so it has
// no rate limit, and only the bill guard pauses it. A sticky repost costs one backend call and waits for its channel's
// interval, so at most five channels per server repost once per interval each, and the bill guard alone pauses it too. A new
// post in a help desk forum costs one backend call for its reply reminder, bounded by how fast members start posts, so only the
// bill guard pauses it as well
export const optionalWorkLimits = {
    afk: { burst: 30, perMinute: 60 },
    responses: { burst: 30, perMinute: 60 },
    levels: { burst: 30, perMinute: 60 },
} as const satisfies Partial<Record<OptionalWork, { readonly burst: number, readonly perMinute: number }>>

/** One server's admission for optional work. It is refused while the bill guard pauses optional work or the server's bucket is empty */
export function createOptionalWork(paused: () => boolean) {
    const buckets = new Map<OptionalWork, { tokens: number, at: number }>()
    return (kind: OptionalWork) => Clock.currentTimeMillis.pipe(Effect.map(now => {
        if (paused()) return false
        if (kind === "analytics" || kind === "sticky" || kind === "helpdesk") return true
        const limit = optionalWorkLimits[kind], bucket = buckets.get(kind) ?? { tokens: limit.burst, at: now }
        bucket.tokens = Math.min(limit.burst, bucket.tokens + (now - bucket.at) * limit.perMinute / 60000)
        bucket.at = now
        buckets.set(kind, bucket)
        if (bucket.tokens < 1) return false
        bucket.tokens--
        return true
    }))
}
export type OptionalWorkAdmission = ReturnType<typeof createOptionalWork>

/** AFK with limited observation. A refused message clears no status and names no AFK member. Setting a status is a command and always runs */
export function limitAfk(store: AfkStore, admit: OptionalWorkAdmission): AfkStore {
    return {
        set: store.set,
        observe: (userId, mentionedUserIds) => admit("afk").pipe(Effect.flatMap(allowed => allowed ? store.observe(userId, mentionedUserIds) : Effect.succeed({ cleared: false, statuses: [] }))),
    }
}
