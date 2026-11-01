import assert from "node:assert/strict"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { after, before, beforeEach, test } from "node:test"
import { xConfig, xConnection, xItemPosted, xMonthlyReads, xPollMs } from "../convex/feedX.ts"

// A fake X built from X's OpenAPI document 2.173, read 2026-11-01: A real HTTP server on localhost that feedX.ts talks to. It refuses
// parameter values the document does not list, so a request the real service would refuse fails here too. Real X was never contacted
const POST_FIELDS = [
    "article",
    "article_title",
    "attachments",
    "card_uri",
    "community_id",
    "context_annotations",
    "conversation_id",
    "created_at",
    "display_text_range",
    "edit_controls",
    "entities",
    "geo",
    "id",
    "lang",
    "matched_media_notes",
    "media_metadata",
    "non_public_metrics",
    "note_post",
    "note_request_suggestions",
    "organic_metrics",
    "paid_partnership",
    "possibly_sensitive",
    "promoted_metrics",
    "public_metrics",
    "reply_settings",
    "scopes",
    "source",
    "suggested_source_links",
    "suggested_source_links_with_counts",
    "text",
    "withheld",
]
const EXPANSIONS = [
    "article.cover_media",
    "article.media_entities",
    "attachments.media_keys",
    "attachments.media_source_tweet",
    "attachments.poll_ids",
    "author_id",
    "edit_history_post_ids",
    "entities.mentions.username",
    "geo.place_id",
    "in_reply_to_user_id",
    "referenced_posts",
    "username",
]
const MEDIA_FIELDS = [
    "alt_text",
    "duration_ms",
    "height",
    "media_key",
    "non_public_metrics",
    "organic_metrics",
    "preview_image_url",
    "promoted_metrics",
    "public_metrics",
    "type",
    "url",
    "variants",
    "width",
]
const USER_FIELDS = ["created_at", "description", "id", "name", "profile_image_url", "protected", "url", "username"]
const ALLOWED: Record<string, readonly string[]> = {
    "post.fields": POST_FIELDS,
    expansions: EXPANSIONS,
    "media.fields": MEDIA_FIELDS,
    "user.fields": USER_FIELDS,
    exclude: ["replies", "retweets"],
}
const TOKEN = "synthetic-x-bearer-token"
const USER_ID = "1000000000000000001"
type Answer = { status?: number; headers?: Record<string, string>; body: unknown }
let answer: Answer = { body: {} },
    seen: URL[] = []
let server: Server, origin: string

function refusal(url: URL) {
    for (const [key, value] of url.searchParams) {
        if (key === "max_results") {
            if (!(Number(value) >= 5 && Number(value) <= 100)) return `max_results ${value}`
        } else if (key === "since_id" || key === "pagination_token") continue
        else if (!ALLOWED[key]) return `unknown parameter ${key}`
        else for (const item of value.split(",")) if (!ALLOWED[key]!.includes(item)) return `${key} ${item}`
    }
    return undefined
}
function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url!, origin)
    seen.push(url)
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        response.writeHead(status, { "content-type": "application/json", ...headers })
        response.end(typeof body === "string" ? body : JSON.stringify(body))
    }
    if (request.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { code: 401, message: "Unauthorized" })
    const known =
        /^\/2\/users\/\d+\/tweets$/.test(url.pathname) || /^\/2\/users\/(by\/username\/\w+|\d+)$/.test(url.pathname)
    const refused = known ? refusal(url) : `unknown path ${url.pathname}`
    if (refused)
        return send(400, {
            errors: [
                { type: "https://api.x.com/2/problems/invalid-request", title: "Invalid Request", detail: refused },
            ],
        })
    send(answer.status ?? 200, answer.body, answer.headers)
}
before(async () => {
    server = createServer(handle)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => new Promise((resolve) => server.close(resolve)))
beforeEach(() => {
    process.env.NEONFLUX_X_BEARER_TOKEN = TOKEN
    process.env.NEONFLUX_X_API_ORIGIN = origin
    answer = { body: {} }
    seen = []
})
const post = (id: string, fields: Record<string, unknown> = {}) => ({
    id,
    text: `Post ${id}`,
    author_id: USER_ID,
    created_at: "2026-10-30T16:16:51.000Z",
    edit_history_post_ids: [id],
    possibly_sensitive: false,
    ...fields,
})
const read = (newestSeenId?: string) =>
    xConnection.read({ accountId: USER_ID, handle: "synthetic", ...(newestSeenId ? { newestSeenId } : {}) })

test("A timeline answer with data reads as items, with the request X's document allows", async () => {
    answer = {
        body: {
            data: [
                post("1850000000000000003", {
                    text: "A photo https://t.co/abc123",
                    attachments: { media_keys: ["3_1"] },
                }),
                post("1850000000000000002", { referenced_posts: [{ type: "quoted", id: "1" }] }),
                post("1850000000000000001", { possibly_sensitive: true }),
            ],
            includes: {
                media: [{ media_key: "3_1", type: "photo", url: "https://pbs.twimg.com/media/synthetic.jpg" }],
                users: [{ id: USER_ID, username: "Synthetic", name: "Synthetic Name" }],
                posts: [{ id: "1", text: "Older", author_id: "2" }],
            },
            meta: { result_count: 3, newest_id: "1850000000000000003", oldest_id: "1850000000000000001" },
        },
    }
    const result = await read("1849999999999999999")
    assert.equal(result.kind, "items")
    if (result.kind !== "items") return
    assert.deepEqual(result.author, { handle: "Synthetic", name: "Synthetic Name" })
    // Three posts, a quoted post and the expanded author, who counts double
    assert.equal(result.reads, 6)
    assert.deepEqual(
        result.items.map((item) => [item.id, item.posted, item.image]),
        [
            ["1850000000000000003", true, "https://pbs.twimg.com/media/synthetic.jpg"],
            ["1850000000000000002", true, undefined],
            ["1850000000000000001", false, undefined],
        ],
    )
    assert.equal(result.items[0]!.text, "A photo")
    assert.equal(result.items[0]!.url, "https://x.com/synthetic/status/1850000000000000003")
    assert.equal(result.items[0]!.publishedAt, Date.parse("2026-10-30T16:16:51.000Z"))
    const url = seen[0]!
    assert.equal(url.pathname, `/2/users/${USER_ID}/tweets`)
    assert.equal(url.searchParams.get("max_results"), "5")
    assert.equal(url.searchParams.get("exclude"), "replies,retweets")
    assert.equal(url.searchParams.get("since_id"), "1849999999999999999")
})
test("A first read sends no since_id", async () => {
    answer = { body: { meta: { result_count: 0 } } }
    await read()
    assert.equal(seen[0]!.searchParams.has("since_id"), false)
})
test("An answer with result_count 0 is empty and spends no reads", async () => {
    answer = { body: { meta: { result_count: 0 } } }
    assert.deepEqual(await read("1"), { kind: "empty" })
    answer = { body: { data: [], meta: { result_count: 0 } } }
    assert.deepEqual(await read("1"), { kind: "empty" })
})
test("A refused key and server failures read as unreadable with their status", async () => {
    process.env.NEONFLUX_X_BEARER_TOKEN = "synthetic-wrong-token"
    assert.deepEqual(await read(), { kind: "unreadable", status: 401 })
    process.env.NEONFLUX_X_BEARER_TOKEN = TOKEN
    answer = { status: 503, body: "not json" }
    assert.deepEqual(await read(), { kind: "unreadable", status: 503 })
})
test("A 429 carries X's reset time", async () => {
    const reset = Math.floor(Date.now() / 1000) + 900
    answer = {
        status: 429,
        headers: { "x-rate-limit-limit": "10000", "x-rate-limit-remaining": "0", "x-rate-limit-reset": String(reset) },
        body: { title: "Too Many Requests", detail: "Too Many Requests", type: "about:blank", status: 429 },
    }
    assert.deepEqual(await read(), { kind: "unreadable", status: 429, retryAt: reset * 1000 })
})
test("A 200 with a broken shape is a shape change, never an empty read", async () => {
    for (const body of ["not json", [], {}, { data: "posts" }, { meta: {} }]) {
        answer = { body }
        assert.deepEqual(await read(), { kind: "shape-change" }, JSON.stringify(body))
    }
    for (const body of [{ data: [{ id: 5 }] }, { data: [post("1", { author_id: "someone-else" })] }]) {
        answer = { body }
        assert.equal((await read()).kind, "shape-change", JSON.stringify(body))
    }
})
test("An unreadable answer counts what X returned, also under the older name for quoted posts", async () => {
    answer = {
        body: {
            data: [{ id: 5 }, { id: 6 }],
            includes: { tweets: [{ id: "1" }], users: [{ id: USER_ID, username: "synthetic" }] },
        },
    }
    assert.deepEqual(await read(), { kind: "shape-change", reads: 5 })
    answer = { body: { data: [post("7")], includes: { tweets: [{ id: "1" }] }, meta: { result_count: 1 } } }
    const items = await read()
    assert.equal(items.kind === "items" && items.reads, 2)
})
test("errors beside data keep the posts, and errors alone are unreadable", async () => {
    const problem = {
        title: "Authorization Error",
        type: "https://api.x.com/2/problems/not-authorized-for-resource",
        detail: "Sorry",
    }
    answer = { body: { data: [post("7")], errors: [problem], meta: { result_count: 1 } } }
    const partial = await read()
    assert.equal(partial.kind, "items")
    answer = { body: { errors: [problem] } }
    assert.deepEqual(await read(), { kind: "unreadable" })
})
test("A lookup finds a user by username or ID, counts as two reads and tells a missing user from a failure", async () => {
    answer = { body: { data: { id: USER_ID, username: "Synthetic", name: "Synthetic Name" } } }
    assert.deepEqual(await xConnection.resolve("pending:synthetic"), {
        kind: "account",
        accountId: USER_ID,
        handle: "synthetic",
        name: "Synthetic Name",
        reads: 2,
    })
    assert.equal(seen[0]!.pathname, "/2/users/by/username/synthetic")
    await xConnection.resolve(USER_ID)
    assert.equal(seen[1]!.pathname, `/2/users/${USER_ID}`)
    // A numeric username is a username, not a user ID
    await xConnection.resolve("pending:12345")
    assert.equal(seen[2]!.pathname, "/2/users/by/username/12345")
    answer = {
        body: {
            errors: [
                {
                    title: "Not Found Error",
                    type: "https://api.x.com/2/problems/resource-not-found",
                    detail: "Could not find user",
                },
            ],
        },
    }
    assert.deepEqual(await xConnection.resolve("pending:missing"), { kind: "missing" })
    answer = { status: 404, body: { code: 404, message: "Not found" } }
    assert.deepEqual(await xConnection.resolve("pending:missing"), { kind: "missing" })
    answer = { body: { errors: [{ title: "Service", type: "https://api.x.com/2/problems/internal-error" }] } }
    assert.deepEqual(await xConnection.resolve("pending:synthetic"), { kind: "unreadable" })
    answer = { body: { data: { username: "no-id" } } }
    assert.deepEqual(await xConnection.resolve("pending:synthetic"), { kind: "shape-change" })
    answer = { body: {} }
    assert.deepEqual(await xConnection.resolve("pending:synthetic"), { kind: "shape-change" })
})
test("X needs a key, and only localhost may skip HTTPS", () => {
    assert.equal(xConfig({}), null)
    assert.deepEqual(xConfig({ NEONFLUX_X_BEARER_TOKEN: "t" }), { token: "t", origin: "https://api.x.com" })
    assert.deepEqual(xConfig({ NEONFLUX_X_BEARER_TOKEN: "t", NEONFLUX_X_API_ORIGIN: "https://x.example.test" }), {
        token: "t",
        origin: "https://x.example.test",
    })
    assert.equal(
        xConfig({ NEONFLUX_X_BEARER_TOKEN: "t", NEONFLUX_X_API_ORIGIN: "http://localhost:4010" })?.origin,
        "http://localhost:4010",
    )
    for (const origin of [
        "http://x.example.test",
        "https://x.example.test/path",
        "https://user:pw@x.example.test",
        "nonsense",
    ])
        assert.equal(xConfig({ NEONFLUX_X_BEARER_TOKEN: "t", NEONFLUX_X_API_ORIGIN: origin }), null, origin)
})
test("The interval and the monthly cap have safe defaults and refuse nonsense", () => {
    assert.equal(xPollMs({}), 1800000)
    assert.equal(xPollMs({ NEONFLUX_X_POLL_MINUTES: "60" }), 3600000)
    assert.equal(xPollMs({ NEONFLUX_X_POLL_MINUTES: "1" }), 1800000)
    assert.equal(xMonthlyReads({}), 5000)
    assert.equal(xMonthlyReads({ NEONFLUX_X_MONTHLY_POST_READS: "100" }), 100)
    assert.equal(xMonthlyReads({ NEONFLUX_X_MONTHLY_POST_READS: "lots" }), 5000)
})
test("Selection reads the older field name for a reference as well", () => {
    const item = (fields: Record<string, unknown>) => ({ post: post("9", fields) })
    assert.equal(xItemPosted(USER_ID, item({ referenced_tweets: [{ type: "retweeted", id: "1" }] })), false)
    assert.equal(xItemPosted(USER_ID, item({ referenced_tweets: [{ type: "quoted", id: "1" }] })), true)
})
