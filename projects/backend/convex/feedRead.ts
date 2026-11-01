import { readBody } from "./youtubeDomain.ts"

// What every feed provider returns, and the one way they reach the network. Providers hold only what differs between services

/** A post of the followed account, ready for the shared rules. posted is the provider's selection, see feedItemPosted */
export type FeedItem = {
    id: string
    publishedAt: number
    posted: boolean
    text: string
    url: string
    image?: string
}
export type FeedAuthor = { handle: string; name?: string }
/**
 * What a read found. Only items says anything about news: An empty or unreadable answer never counts as "nothing new", and a shape change
 * raises an alert. reads is what the answer counts against X's monthly cap, and retryAt when the service asks to wait longer
 */
export type FeedRead =
    | { kind: "items"; items: FeedItem[]; author?: FeedAuthor; reads?: number }
    | { kind: "empty"; reads?: number }
    | { kind: "unreadable"; status?: number; retryAt?: number }
    | { kind: "shape-change"; reads?: number }
export type FeedResolved =
    | { kind: "account"; accountId: string; handle: string; name?: string; reads?: number }
    | { kind: "missing" }
    | { kind: "unreadable"; status?: number; retryAt?: number }
    | { kind: "shape-change" }
/** One provider's connection. resolve takes an account key, which is pending:<handle> or a stable account ID */
export interface FeedConnection {
    resolve(input: string): Promise<FeedResolved>
    read(source: { accountId: string; handle?: string; newestSeenId?: string }): Promise<FeedRead>
}

/** Ample for a page of posts with their embeds, which is about 170 KiB for 30 real Bluesky posts */
const FEED_ANSWER_BYTES = 2097152,
    FEED_READ_TIMEOUT_MS = 8000
/** The latest time a rate limit answer names, from Retry-After or the provider's reset header in Unix seconds */
export function feedRetryAt(headers: Headers, now: number): number | undefined {
    const retry = headers.get("retry-after"),
        reset = Number(headers.get("x-rate-limit-reset") ?? headers.get("ratelimit-reset") ?? NaN)
    const seconds = retry === null ? NaN : Number(retry)
    const times = [
        Number.isFinite(seconds) ? now + seconds * 1000 : retry === null ? NaN : Date.parse(retry),
        Number.isFinite(reset) ? reset * 1000 : NaN,
    ].filter((time) => Number.isFinite(time) && time > now)
    return times.length ? Math.max(...times) : undefined
}
export type FeedAnswer = { status: number; headers: Headers; body: unknown }
/** One GET with a deadline. Null means the service could not be reached or sent too much. A body that is not JSON answers undefined */
export async function feedRequest(url: string, headers: Record<string, string> = {}): Promise<FeedAnswer | null> {
    const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), FEED_READ_TIMEOUT_MS)
    try {
        const response = await fetch(url, { headers, signal: controller.signal }),
            bytes = await readBody(response.body, FEED_ANSWER_BYTES)
        if (!bytes) return null
        let body: unknown
        try {
            body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
        } catch {
            body = undefined
        }
        return { status: response.status, headers: response.headers, body }
    } catch {
        return null
    } finally {
        clearTimeout(timer)
    }
}
/** The unreadable answer for a failed status, with a rate limit's wait */
export const feedRefusal = (answer: FeedAnswer | null, now = Date.now()) => {
    if (!answer) return { kind: "unreadable" as const }
    const retryAt = answer.status === 429 ? feedRetryAt(answer.headers, now) : undefined
    return { kind: "unreadable" as const, status: answer.status, ...(retryAt ? { retryAt } : {}) }
}
export const record = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined
/** An image a post can show: HTTPS and of a length the publisher keeps */
export const feedImage = (value: unknown) =>
    typeof value === "string" && value.startsWith("https://") && value.length <= 2048 ? value : undefined
