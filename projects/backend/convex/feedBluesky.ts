import { feedPendingHandle } from "@neonflux/contracts/feeds"
import {
    feedImage,
    feedRefusal,
    feedRequest,
    record,
    type FeedAuthor,
    type FeedConnection,
    type FeedItem,
    type FeedRead,
    type FeedResolved,
} from "./feedRead.ts"

// Bluesky through its public read API, which needs no key. A DID is the stable account ID, so a renamed account keeps its dedupe
const API = "https://public.api.bsky.app/xrpc"
const API_PAGE = 25
const POST_RECORD = "app.bsky.feed.post"
/** Post IDs are record keys, which are sortable TIDs in the posts the apps write, in the form a tracked post can hold */
const RECORD_KEY = /^[a-z0-9]{1,30}$/

/** Adult content, moderation's own hiding, and an account's choice to stay out of view for anyone logged out, which a public channel would ignore */
const HELD_LABELS = new Set([
    "porn",
    "sexual",
    "nudity",
    "graphic-media",
    "!hide",
    "!takedown",
    "!suspend",
    "!no-unauthenticated",
])
const labelled = (labels: unknown) =>
    Array.isArray(labels) &&
    labels.some((label) => {
        const row = record(label)
        return typeof row?.val === "string" && row.neg !== true && HELD_LABELS.has(row.val)
    })
/** The record key of a post by this repository's author, or undefined for a broken address */
function postKey(post: Record<string, unknown>, did: unknown) {
    if (typeof post.uri !== "string" || typeof did !== "string") return undefined
    const key = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(post.uri)
    return key?.[1] === did && RECORD_KEY.test(key[2]!) ? key[2] : undefined
}
/** When the post came out. Importers backdate createdAt and clients set it freely, so the earlier of it and the service's own time counts */
function publishedAt(post: Record<string, unknown>, value: Record<string, unknown>) {
    const times = [post.indexedAt, value.createdAt].flatMap((time) => {
        const at = typeof time === "string" ? Date.parse(time) : NaN
        return Number.isFinite(at) ? [at] : []
    })
    return times.length ? Math.min(...times) : undefined
}
/**
 * Whether NeonFlux posts one element of a Bluesky author feed for the followed account, its DID or handle. Own original and quote posts
 * count. Reposts, pinned posts, replies including self-replies, other authors' posts, held labels on the post or its account and broken shapes do not
 */
export function blueskyItemPosted(account: string, item: unknown): boolean {
    const entry = record(item),
        post = record(entry?.post),
        author = record(post?.author),
        value = record(post?.record)
    if (!entry || !post || !author || !value) return false
    if (author.did !== account && author.handle !== account) return false
    if (entry.reason !== undefined && entry.reason !== null) return false
    if (entry.reply !== undefined || value.reply !== undefined) return false
    if (value.$type !== POST_RECORD || typeof value.text !== "string") return false
    if (!postKey(post, author.did) || publishedAt(post, value) === undefined) return false
    return !labelled(post.labels) && !labelled(author.labels) && !labelled(record(value.labels)?.values)
}

/** The first picture of a view embed: A photo, a video's still or a link card's image, and the media beside a quoted post */
function firstImage(embed: unknown): string | undefined {
    const view = record(embed),
        first = (list: unknown) => (Array.isArray(list) ? record(list[0]) : undefined)
    switch (view?.$type) {
        case "app.bsky.embed.images#view":
            return feedImage(first(view.images)?.fullsize)
        case "app.bsky.embed.gallery#view":
            return feedImage(first(view.items)?.fullsize)
        case "app.bsky.embed.video#view":
            return feedImage(view.thumbnail)
        case "app.bsky.embed.external#view":
            return feedImage(record(view.external)?.thumb)
        case "app.bsky.embed.recordWithMedia#view":
            return firstImage(view.media)
        default:
            return undefined
    }
}
/** A post of the followed account in the shared form, or undefined for another author's post, a repost or a broken one */
function ownItem(account: string, entry: unknown): FeedItem | undefined {
    const row = record(entry),
        post = record(row?.post),
        value = record(post?.record),
        did = record(post?.author)?.did
    if (!row || !post || !value || did !== account || (row.reason !== undefined && row.reason !== null))
        return undefined
    const id = postKey(post, did),
        at = publishedAt(post, value)
    if (!id || at === undefined || typeof value.text !== "string") return undefined
    const image = firstImage(post.embed)
    return {
        id,
        publishedAt: at,
        posted: blueskyItemPosted(account, entry),
        text: value.text,
        url: `https://bsky.app/profile/${account}/post/${id}`,
        ...(image ? { image } : {}),
    }
}
/** The account's own name and handle, from an answer that carries them */
function authorOf(entries: readonly unknown[], account: string): FeedAuthor | undefined {
    for (const entry of entries) {
        const author = record(record(record(entry)?.post)?.author)
        if (author?.did === account && typeof author.handle === "string")
            return {
                handle: author.handle,
                ...(typeof author.displayName === "string" && author.displayName ? { name: author.displayName } : {}),
            }
    }
    return undefined
}
/** Reads one getAuthorFeed answer. A page holding only others' posts says nothing about the account, so it counts as empty */
export function blueskyFeedAnswer(account: string, body: unknown): FeedRead {
    const feed = record(body)?.feed
    if (!Array.isArray(feed)) return { kind: "shape-change" }
    if (!feed.length) return { kind: "empty" }
    const readable = feed.filter((entry) => {
        const post = record(record(entry)?.post)
        return typeof post?.uri === "string" && !!record(post.author) && !!record(post.record)
    })
    if (!readable.length) return { kind: "shape-change" }
    const items = feed.flatMap((entry) => ownItem(account, entry) ?? [])
    const author = authorOf(feed, account)
    if (items.length) return { kind: "items", items, ...(author ? { author } : {}) }
    // Own posts that cannot be read are not an empty page, which would clear an earlier read problem
    const own = readable.some((entry) => {
        const row = record(entry)
        return record(record(row?.post)?.author)?.did === account && (row?.reason === undefined || row.reason === null)
    })
    return own ? { kind: "shape-change" } : { kind: "empty" }
}

export const blueskyConnection: FeedConnection = {
    /** getProfile takes a handle or a DID and answers both with the display name, so one call replaces resolveHandle and a second read */
    async resolve(key): Promise<FeedResolved> {
        const actor = feedPendingHandle(key) ?? key,
            answer = await feedRequest(`${API}/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`)
        if (answer?.status === 400) {
            const reason = record(answer.body)?.message
            if (typeof reason === "string" && /not found|unable to resolve/i.test(reason)) return { kind: "missing" }
        }
        if (answer?.status !== 200) return feedRefusal(answer)
        const body = record(answer.body)
        if (typeof body?.did !== "string" || !body.did.startsWith("did:") || typeof body.handle !== "string")
            return { kind: "shape-change" }
        return {
            kind: "account",
            accountId: body.did,
            handle: body.handle,
            ...(typeof body.displayName === "string" && body.displayName ? { name: body.displayName } : {}),
        }
    },
    async read({ accountId }): Promise<FeedRead> {
        const answer = await feedRequest(
            `${API}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(accountId)}&filter=posts_no_replies&limit=${API_PAGE}`,
        )
        return answer?.status === 200 ? blueskyFeedAnswer(accountId, answer.body) : feedRefusal(answer)
    },
}
