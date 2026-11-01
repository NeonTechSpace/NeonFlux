import { cutText } from "@neonflux/contracts/common"
import { FeedDeliveryContext, FeedOperation, feedProviderNames, type FeedProvider } from "@neonflux/contracts/feeds"
import type { PublishingContent } from "@neonflux/contracts/publishing-base"
import { neutralMentions } from "@neonflux/contracts/member-content"
import type { FeedItem } from "./feedRead.ts"
import { publishingContent } from "./publishingDomain.ts"
import { decode, fail } from "./validation.ts"
import { xPollMs } from "./feedX.ts"
export { FEED_LIMIT } from "@neonflux/contracts/feeds"

/** A post NeonFlux could not send within a day is dropped, like one that is a day old when first read */
export const FEED_WINDOW_MS = 86400000,
    FEED_ITEM_RETENTION_MS = 7 * 86400000,
    FEED_DELIVERY_RETENTION_MS = 30 * 86400000,
    FEED_RETRY_MS = 60000,
    /** A source posts at most this many posts per tick, the newest ones */
    FEED_BURST = 5,
    /** A tick reads at most this many sources, and ticks start at least this far apart */
    FEED_TICK_BATCH = 50,
    FEED_TICK_GAP_MS = 60000,
    FEED_FAILURE_WAIT_MAX_MS = 6 * 3600000,
    /** Failures in a row before a read problem counts as one, since one failed read costs nothing but the next interval */
    FEED_ERROR_FAILURES = 3
const BLUESKY_POLL_MS = 5 * 60000,
    FEED_SOURCES_DEFAULT = 1000
export const feedOperation = (value: unknown): FeedOperation => decode(FeedOperation, value)
export function feedDeliveryContext(value: unknown, now = Date.now()): FeedDeliveryContext {
    const context = decode(FeedDeliveryContext, value)
    if (context.observedAt < now - 60000 || context.observedAt > now + 1000) fail(400, "Invalid request")
    return context
}
/** The accounts one deployment may follow in total, across every server, from NEONFLUX_FEED_SOURCE_LIMIT */
export function feedSourceLimit(env: Record<string, string | undefined> = process.env) {
    const value = Number(env.NEONFLUX_FEED_SOURCE_LIMIT?.trim() || NaN)
    return Number.isSafeInteger(value) && value >= 1 ? value : FEED_SOURCES_DEFAULT
}
/** How long a source waits between reads. The wait widens with the sources so a whole round fits the ticks that read them */
export const feedInterval = (provider: FeedProvider, sources: number) =>
    Math.max(
        provider === "x" ? xPollMs() : BLUESKY_POLL_MS,
        Math.ceil(Math.max(sources, 1) / FEED_TICK_BATCH) * FEED_TICK_GAP_MS,
    )
export const feedFailureWait = (interval: number, failures: number) =>
    Math.min(interval * 2 ** Math.min(failures, 16), Math.max(FEED_FAILURE_WAIT_MAX_MS, interval))
/** Whether a post ID is newer than another. Bluesky's record keys share one length and sort as text, and X's IDs are decimal numbers */
export const feedNewer = (id: string, than: string) => (id.length !== than.length ? id.length > than.length : id > than)
/**
 * The shared rules for one read's posts. A source's first read records the newest ID and posts nothing. After that only newer posts count,
 * and of those only posts selected for posting and under a day old, the newest few of a burst
 */
export function planFeedRead(newestSeenId: string | undefined, items: readonly FeedItem[], now: number) {
    let newest = newestSeenId
    for (const { id } of items) if (newest === undefined || feedNewer(id, newest)) newest = id
    if (newestSeenId === undefined) return { newestSeenId: newest, post: [] as FeedItem[] }
    const post = items
        .filter((item) => item.posted && feedNewer(item.id, newestSeenId) && now - item.publishedAt < FEED_WINDOW_MS)
        .sort((a, b) => (feedNewer(a.id, b.id) ? -1 : 1))
        .slice(0, FEED_BURST)
    return { newestSeenId: newest, post }
}

const EXCERPT_LENGTH = 300,
    SENTENCE_FLOOR = 0.4
const clip = (text: string, max: number) => (text.length > max ? `${cutText(text, max - 1)}…` : text)
/** A long post up to its last whole sentence, or its last whole word when one sentence runs on. Full text is never reposted once it is long */
export function feedExcerpt(text: string, max = EXCERPT_LENGTH) {
    const clean = text.trim()
    if (clean.length <= max) return clean
    const head = cutText(clean, max)
    let end = 0
    for (const match of head.matchAll(/[.!?…](?=["')\]]*(?:\s|$))/g)) end = match.index + 1
    if (end >= max * SENTENCE_FLOOR) return head.slice(0, end)
    const space = head.search(/\s\S*$/)
    return `${(space > max * SENTENCE_FLOOR ? head.slice(0, space) : cutText(clean, max - 1)).trimEnd()}…`
}
export const feedColor: Record<FeedProvider, number> = { bluesky: 0x1185fe, x: 0x000000 }
/** How a source appears: Its display name and handle, or whichever is known */
export const feedAuthorName = (source: { name?: string; handle?: string } | null | undefined, fallback: string) => {
    const handle = source?.handle ? `@${source.handle}` : undefined
    return source?.name ? (handle ? `${source.name} (${handle})` : source.name) : (handle ?? fallback)
}
/** One embed with the author, an excerpt and the first image, with mentions broken up. A test says so, and the placeholder has no link to a post */
export function renderFeedPost(
    provider: FeedProvider,
    author: string,
    profile: string,
    item: { text: string; url: string; image?: string } | undefined,
    test = false,
): { content: PublishingContent; forumPostName: string } {
    const excerpt = neutralMentions(feedExcerpt(item?.text ?? "")),
        name = clip(neutralMentions(author), 256),
        title = test ? `Test post from NeonFlux` : "New post"
    return {
        forumPostName: clip(excerpt ? `${name}: ${excerpt}`.replace(/\s+/g, " ") : name, 100),
        content: publishingContent(
            {
                content: test && item ? "Test post from NeonFlux" : "",
                embed: {
                    title,
                    url: item?.url ?? profile,
                    color: feedColor[provider],
                    author: { name, url: profile },
                    ...(excerpt ? { description: excerpt } : {}),
                    ...(item?.image ? { image: { url: item.image } } : {}),
                    footer: { text: feedProviderNames[provider] },
                },
            },
            true,
        ),
    }
}
/** The account's profile page. A DID stays valid after a rename */
export const feedProfileUrl = (provider: FeedProvider, accountId: string, handle: string | undefined) =>
    provider === "bluesky"
        ? `https://bsky.app/profile/${accountId.startsWith("pending:") ? (handle ?? "") : accountId}`
        : `https://x.com/${handle ?? "i"}`
