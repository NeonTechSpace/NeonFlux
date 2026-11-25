export interface RateLimitOptions {
    limit: number
    windowMs: number
    maxEntries?: number
}

export interface RateLimitResult {
    allowed: boolean
    retryAfterSeconds: number
}

export interface RateLimiter {
    check(key: string, now: number): RateLimitResult
}

const DEFAULT_MAX_ENTRIES = 10_000

/** In-memory sliding-window rate limiter with a bounded entry map so flooded keys cannot grow memory unbounded */
export function createSlidingWindowRateLimiter(options: RateLimitOptions): RateLimiter {
    const { limit, windowMs, maxEntries = DEFAULT_MAX_ENTRIES } = options
    const buckets = new Map<string, number[]>()

    function sweepExpired(cutoff: number) {
        for (const [key, timestamps] of buckets) {
            const newest = timestamps.at(-1)
            if (newest === undefined || newest <= cutoff) buckets.delete(key)
        }
    }

    return {
        check(key: string, now: number): RateLimitResult {
            const cutoff = now - windowMs
            const existing = buckets.get(key)
            const active = existing ? existing.filter((timestamp) => timestamp > cutoff) : []
            if (active.length >= limit) {
                // Keep the key warm in LRU order so repeated abusive traffic is not evicted ahead of idle keys
                buckets.delete(key)
                buckets.set(key, active)
                const oldest = active[0] ?? now
                return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) }
            }
            active.push(now)
            buckets.delete(key)
            buckets.set(key, active)
            if (buckets.size > maxEntries) {
                sweepExpired(cutoff)
                while (buckets.size > maxEntries) {
                    const oldestKey = buckets.keys().next().value
                    if (oldestKey === undefined) break
                    buckets.delete(oldestKey)
                }
            }
            return { allowed: true, retryAfterSeconds: 0 }
        },
    }
}

export type TrustProxyMode = false | "cloudflare" | "forwarded"

const rateLimitEncoder = new TextEncoder()

/** SHA-256 hex digest for keying session-scoped rate limits without holding raw secret prefixes in memory */
export async function hashRateLimitKey(value: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", rateLimitEncoder.encode(value))
    let out = ""
    for (const byte of new Uint8Array(digest)) out += byte.toString(16).padStart(2, "0")
    return out
}

/** Parses TRUST_PROXY env config. Defaults to false so spoofable forwarding headers are never trusted unconfigured */
export function parseTrustProxyMode(value: string | undefined): TrustProxyMode {
    const normalized = value?.trim().toLowerCase()
    if (normalized === "cloudflare") return "cloudflare"
    if (normalized === "forwarded") return "forwarded"
    return false
}

/** Extracts a bounded client IP address only from headers explicitly trusted by the deployment proxy mode */
export function clientIpKey(request: Request, trustProxy: TrustProxyMode = false): string | undefined {
    if (trustProxy === "cloudflare") {
        const cfIp = request.headers.get("cf-connecting-ip")?.trim()
        return cfIp ? cfIp.slice(0, 128) : undefined
    }
    if (trustProxy === "forwarded") {
        // Use the rightmost entry appended by the trusted edge proxy rather than spoofable X-Real-IP or leftmost X-Forwarded-For
        const entries = (request.headers.get("x-forwarded-for") ?? "")
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
        const proxyClient = entries.at(-1)
        return proxyClient ? proxyClient.slice(0, 128) : undefined
    }
    return undefined
}
