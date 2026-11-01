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

// X through its paid API, with the host's own key. Field names follow X's OpenAPI document 2.173, read 2026-11-01. The service itself has
// never been called from here, and keyless scraping stays out, see docs/BACKEND.md#bluesky-and-x-feeds
const API_ORIGIN = "https://api.x.com"
/** The key, from the deployment's environment, and where it goes. Null turns X off. Another origin is for tests, and only localhost may skip HTTPS */
export function xConfig(env: Record<string, string | undefined> = process.env) {
    const token = env.NEONFLUX_X_BEARER_TOKEN?.trim()
    if (!token) return null
    const configured = env.NEONFLUX_X_API_ORIGIN?.trim()
    if (!configured) return { token, origin: API_ORIGIN }
    try {
        const url = new URL(configured)
        const local = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")
        if (url.protocol !== "https:" && !local) return null
        return url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash
            ? { token, origin: url.origin }
            : null
    } catch {
        return null
    }
}
const whole = (value: string | undefined, fallback: number, min: number) => {
    const number = Number(value?.trim() || NaN)
    return Number.isSafeInteger(number) && number >= min ? number : fallback
}
const X_MONTHLY_READS = 5000,
    X_POLL_MINUTES = 30,
    X_POLL_MINUTES_MIN = 5
/** The deployment's monthly reads. X bills $0.005 per post read, so the default stops at about $25 a month */
export const xMonthlyReads = (env: Record<string, string | undefined> = process.env) =>
    whole(env.NEONFLUX_X_MONTHLY_POST_READS, X_MONTHLY_READS, 1)
export const xPollMs = (env: Record<string, string | undefined> = process.env) =>
    whole(env.NEONFLUX_X_POLL_MINUTES, X_POLL_MINUTES, X_POLL_MINUTES_MIN) * 60000
/** X bills a user read at twice a post read, so a lookup or an expanded author counts as two */
const USER_READ = 2
/** At most what one poll can spend: Five posts, up to five they quote and the author */
export const X_POLL_READS = 12

const POST_ID = /^[0-9]{1,25}$/
/** X's document names this referenced_posts. Its answers used referenced_tweets for years, and the service has not been read yet */
const referenceList = (post: Record<string, unknown>) => post.referenced_posts ?? post.referenced_tweets
const validPost = (post: Record<string, unknown> | undefined): post is Record<string, unknown> =>
    typeof post?.id === "string" &&
    POST_ID.test(post.id) &&
    typeof post.text === "string" &&
    typeof post.author_id === "string" &&
    typeof post.created_at === "string" &&
    Number.isFinite(Date.parse(post.created_at))
/**
 * Whether NeonFlux posts one post of an X timeline answer for the followed account, its user ID or username. Own original and quote posts
 * count. Retweets, replies including self-replies, other authors' posts, possibly sensitive posts and broken shapes do not
 */
export function xItemPosted(account: string, item: unknown): boolean {
    const entry = record(item),
        post = record(entry?.post)
    if (!validPost(post)) return false
    if (post.author_id !== account) {
        const users = record(entry?.includes)?.users,
            author = Array.isArray(users)
                ? users.map((user) => record(user)).find((user) => user?.id === post.author_id)
                : undefined
        if (author?.username !== account) return false
    }
    if (post.possibly_sensitive === true || post.in_reply_to_user_id !== undefined) return false
    // A retweet's text keeps this opening even where its reference is missing
    if (/^RT @\w/.test(post.text as string)) return false
    const list = referenceList(post) ?? []
    return (
        Array.isArray(list) &&
        !list.some((reference) => {
            const type = record(reference)?.type
            return type === "retweeted" || type === "replied_to"
        })
    )
}

const firstMediaImage = (post: Record<string, unknown>, includes: Record<string, unknown> | undefined) => {
    const key = record(post.attachments)?.media_keys,
        media = includes?.media
    if (!Array.isArray(key) || !Array.isArray(media)) return undefined
    const found = record(media.find((row) => record(row)?.media_key === key[0]))
    return feedImage(found?.url) ?? feedImage(found?.preview_image_url)
}
/** X adds a t.co link for attached media or a quoted post at the end of the text, and the post's own link replaces those */
const withoutTrailingLinks = (text: string) => text.replace(/(?:\s*https:\/\/t\.co\/\w+)+\s*$/, "").trim()
/** Reads one 200 answer of the timeline. errors beside data are partial, so the posts count. errors alone mean X read nothing */
export function xPostsAnswer(account: string, body: unknown, handle: string | undefined): FeedRead {
    const answer = record(body)
    if (!answer) return { kind: "shape-change" }
    const data = answer.data
    if (data === undefined) {
        if (Array.isArray(answer.errors) && answer.errors.length) return { kind: "unreadable" }
        return record(answer.meta)?.result_count === 0 ? { kind: "empty" } : { kind: "shape-change" }
    }
    if (!Array.isArray(data)) return { kind: "shape-change" }
    if (!data.length) return { kind: "empty" }
    const includes = record(answer.includes),
        users = Array.isArray(includes?.users) ? includes.users.map((user) => record(user)) : [],
        // The same older name as referenceList
        quoted = includes?.posts ?? includes?.tweets,
        reads = data.length + (Array.isArray(quoted) ? quoted.length : 0) + users.length * USER_READ,
        items: FeedItem[] = []
    for (const row of data) {
        const post = record(row)
        if (!validPost(post) || post.author_id !== account) continue
        const image = firstMediaImage(post, includes)
        items.push({
            id: post.id as string,
            publishedAt: Date.parse(post.created_at as string),
            posted: xItemPosted(account, { post, includes }),
            text: withoutTrailingLinks(post.text as string),
            url: `https://x.com/${handle ?? "i"}/status/${post.id as string}`,
            ...(image ? { image } : {}),
        })
    }
    // X bills what it returned, whether or not it can be read here
    if (!items.length) return { kind: "shape-change", reads }
    const self = users.find((user) => user?.id === account)
    const author: FeedAuthor | undefined =
        typeof self?.username === "string"
            ? { handle: self.username, ...(typeof self.name === "string" && self.name ? { name: self.name } : {}) }
            : undefined
    return {
        kind: "items",
        items,
        ...(author ? { author } : {}),
        reads,
    }
}

const POST_QUERY = new URLSearchParams({
    max_results: "5",
    exclude: "replies,retweets",
    // author_id and referenced_posts are not post.fields values in the document. Its expansions return them
    "post.fields": "created_at,attachments,possibly_sensitive",
    expansions: "author_id,attachments.media_keys,referenced_posts",
    "media.fields": "media_key,type,url,preview_image_url",
    "user.fields": "username,name",
}).toString()
const request = (path: string) => {
    const config = xConfig()
    return config ? feedRequest(`${config.origin}${path}`, { Authorization: `Bearer ${config.token}` }) : null
}
export const xConnection: FeedConnection = {
    async resolve(key): Promise<FeedResolved> {
        const username = feedPendingHandle(key),
            answer = await request(
                `${username ? `/2/users/by/username/${encodeURIComponent(username)}` : `/2/users/${key}`}?user.fields=username,name`,
            )
        if (answer?.status === 404) return { kind: "missing" }
        if (answer?.status !== 200) return feedRefusal(answer)
        const body = record(answer.body),
            user = record(body?.data)
        if (user) {
            if (typeof user.id !== "string" || !POST_ID.test(user.id) || typeof user.username !== "string")
                return { kind: "shape-change" }
            return {
                kind: "account",
                accountId: user.id,
                handle: user.username.toLowerCase(),
                ...(typeof user.name === "string" && user.name ? { name: user.name } : {}),
                reads: USER_READ,
            }
        }
        const errors = body?.errors
        if (!Array.isArray(errors) || !errors.length) return { kind: "shape-change" }
        // A lookup of a missing or suspended user answers 200 with only a problem
        return errors.some((error) => {
            const type = record(error)?.type
            return typeof type === "string" && /not-found|resource-unavailable/i.test(type)
        })
            ? { kind: "missing" }
            : { kind: "unreadable" }
    },
    async read({ accountId, handle, newestSeenId }): Promise<FeedRead> {
        const answer = await request(
            `/2/users/${accountId}/tweets?${POST_QUERY}${newestSeenId ? `&since_id=${newestSeenId}` : ""}`,
        )
        return answer?.status === 200 ? xPostsAnswer(accountId, answer.body, handle) : feedRefusal(answer)
    },
}
