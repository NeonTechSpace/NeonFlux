import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { internal } from "../convex/_generated/api.js"
import { blueskyFeedAnswer, blueskyItemPosted } from "../convex/feedBluesky.ts"
import {
    feedExcerpt,
    feedFailureWait,
    feedInterval,
    feedNewer,
    FEED_TICK_BATCH,
    planFeedRead,
    renderFeedPost,
} from "../convex/feedDomain.ts"
import { feedRetryAt } from "../convex/feedRead.ts"
import { cleanupFeeds } from "../convex/feedStore.ts"
import { feedAccountKey, feedAccountToken } from "@neonflux/contracts/feeds"
import { feedSourceId } from "@neonflux/contracts/publishing-base"
import { convexBackend } from "./convex-backend.ts"
import { botCall } from "./bot-service.ts"
import { insertDocument } from "./schema-documents.ts"
import { MEMBER_DATA_EXEMPT } from "../convex/memberData.ts"

const keys = [
    "NEONFLUX_SERVER_ID",
    "NEONFLUX_SERVER_MODE",
    "NEONFLUX_BOT_API_SECRET",
    "NEONFLUX_X_BEARER_TOKEN",
    "NEONFLUX_X_MONTHLY_POST_READS",
    "NEONFLUX_FEED_SOURCE_LIMIT",
    "NEONFLUX_MONTHLY_CALL_BUDGET",
] as const
const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]])),
    start = Date.parse("2026-10-01T12:00:00Z"),
    MINUTE = 60000,
    HOUR = 60 * MINUTE,
    DID = "did:plc:syntheticaaaaaaaaaaaaaaa",
    HANDLE = "news.example.test",
    X_ID = "1000000000000000001"
const modules = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")],
    ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const TID = "234567abcdefghijklmnopqrstuvwxyz"
/** A sortable record key, as Bluesky's are */
const tid = (n: number) => `3mz${Array.from({ length: 10 }, (_, i) => TID[(n >> (5 * (9 - i))) & 31]).join("")}`
let clock = start,
    requests: string[] = [],
    profile: Response | (() => Response) = () =>
        Response.json({ did: DID, handle: HANDLE, displayName: "Synthetic News" }),
    feed: () => Response = () => Response.json({ feed: [] }),
    timeline: () => Response = () => Response.json({ meta: { result_count: 0 } }),
    user: () => Response = () => Response.json({ data: { id: X_ID, username: "synthetic", name: "Synthetic" } })
const entry = (n: number, fields: Record<string, unknown> = {}, publishedAt = clock) => {
    const at = new Date(publishedAt).toISOString()
    return {
        post: {
            uri: `at://${DID}/app.bsky.feed.post/${tid(n)}`,
            cid: "bafyreisynthetic",
            author: { did: DID, handle: HANDLE, displayName: "Synthetic News", labels: [] },
            record: { $type: "app.bsky.feed.post", createdAt: at, text: `Post ${n} @everyone` },
            indexedAt: at,
            labels: [],
        },
        ...fields,
    }
}
const posts = (...list: unknown[]) => {
    feed = () => Response.json({ feed: list })
}
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    Object.assign(process.env, {
        NEONFLUX_SERVER_ID: "10",
        NEONFLUX_BOT_API_SECRET: "synthetic-feed-service-secret-0000000000000000",
    })
    clock = start
    requests = []
    profile = () => Response.json({ did: DID, handle: HANDLE, displayName: "Synthetic News" })
    feed = () => Response.json({ feed: [] })
    timeline = () => Response.json({ meta: { result_count: 0 } })
    user = () => Response.json({ data: { id: X_ID, username: "synthetic", name: "Synthetic" } })
    mock.method(Date, "now", () => clock)
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
        const url = String(input)
        requests.push(url)
        if (url.includes("app.bsky.actor.getProfile")) return typeof profile === "function" ? profile() : profile
        if (url.includes("app.bsky.feed.getAuthorFeed")) return feed()
        if (url.includes("/tweets")) return timeline()
        if (url.startsWith("https://api.x.com/2/users/")) return user()
        throw new Error(`Unexpected request ${url}`)
    })
})
afterEach(() => {
    mock.restoreAll()
    mock.timers.reset()
    for (const key of keys)
        if (prior[key] === undefined) delete process.env[key]
        else process.env[key] = prior[key]
})
const actor = {
    originServerId: "10",
    userId: "20",
    roleIds: [],
    isOwner: true,
    isAdministrator: false,
    nativePermissionAuthorized: true,
}
function fixture() {
    const t = convexBackend(modules)
    let sequence = 1000
    const call = async (path: string, body: unknown, expected = 200, serverId?: string) => {
        const response = await botCall(t, path, body, serverId ? { serverId } : {}),
            result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result
    }
    const manage = (operation: unknown, expected = 200, serverId = "10") =>
        call(
            "/feed/manage",
            {
                serverId,
                originServerId: serverId,
                messageId: String(++sequence),
                createdAt: clock,
                actor: { ...actor, originServerId: serverId },
                managerAuthorized: true,
                operation,
            },
            expected,
            process.env.NEONFLUX_SERVER_MODE === "multi" ? serverId : undefined,
        )
    const query = () => call("/feed/query", { serverId: "10" })
    // Runs what is due at the current time, including what those runs schedule at once
    const settle = async () => {
        for (let round = 0; round < 8; round++) {
            mock.timers.tick(0)
            await t.finishInProgressScheduledFunctions()
            await new Promise((resolve) => setImmediate(resolve))
        }
    }
    const advance = async (ms: number) => {
        clock += ms
        mock.timers.tick(ms)
        await settle()
    }
    const rows = () => t.run((ctx) => ctx.db.query("feedDeliveries").collect())
    const source = (accountId = DID, provider: "bluesky" | "x" = "bluesky") =>
        t.run((ctx) =>
            ctx.db
                .query("feedSources")
                .withIndex("by_account", (q) => q.eq("provider", provider).eq("accountId", accountId))
                .unique(),
        )
    const add = (fields: Record<string, unknown> = {}, expected = 200, serverId = "10") =>
        manage(
            { type: "add", provider: "bluesky", accountId: `pending:${HANDLE}`, channelId: "50", ...fields },
            expected,
            serverId,
        )
    const poller = () => t.run((ctx) => ctx.db.query("feedPoller").first())
    return { t, call, manage, query, settle, advance, rows, source, add, poller }
}
/** A followed Bluesky account after its lookup and its first read, which saw post 1 */
async function following() {
    const f = fixture()
    posts(entry(1))
    await f.add()
    await f.settle()
    await f.advance(MINUTE)
    assert.equal((await f.source())?.newestSeenId, tid(1))
    return f
}
const POLL = 5 * MINUTE

test("A deployment that follows nothing has no tick, and the last unfollow ends the chain", async () => {
    const f = fixture()
    assert.equal(await f.poller(), null)
    await f.advance(HOUR)
    assert.deepEqual(requests, [])
    await f.add()
    await f.settle()
    assert.equal(requests.length, 1)
    assert.ok((await f.poller())?.scheduledId)
    await f.manage({ type: "remove", provider: "bluesky", accountId: DID })
    assert.equal(await f.source(), null)
    await f.advance(HOUR)
    const poller = await f.poller()
    assert.deepEqual([poller?.scheduledId, poller?.sourceCount], [undefined, 0])
    const seen = requests.length
    await f.advance(24 * HOUR)
    assert.equal(requests.length, seen)
})
test("A first read records the newest post and posts nothing, and a later post reaches the server with its mention broken up", async () => {
    const f = await following()
    assert.deepEqual(await f.rows(), [])
    const row = (await f.query()).subscriptions[0]
    assert.deepEqual([row.accountId, row.status.handle, row.status.name], [DID, HANDLE, "Synthetic News"])
    posts(entry(2), entry(1, {}, start))
    await f.advance(POLL)
    const [delivery] = await f.rows()
    assert.deepEqual(
        [delivery?.serverId, delivery?.itemId, delivery?.state, (await f.source())?.newestSeenId],
        ["10", tid(2), "queued", tid(2)],
    )
    const list = await f.call("/feed/work", { serverId: "10", operation: { type: "list" } })
    assert.deepEqual(list.deliveries, [{ provider: "bluesky", accountId: DID, itemId: tid(2), channelId: "50" }])
    const context = { originServerId: "10", observedAt: clock, channelId: "50", botId: "99", botAuthorized: true }
    const reserved = await f.call("/feed/work", {
        serverId: "10",
        operation: { type: "reserve", provider: "bluesky", accountId: DID, itemId: tid(2), context },
    })
    assert.equal(reserved.type, "reserved")
    assert.equal(reserved.grant.sourceId, feedSourceId("bluesky", DID, tid(2)))
    const embed = reserved.grant.content.embed
    assert.equal(embed.footer.text, "Bluesky")
    assert.equal(embed.url, `https://bsky.app/profile/${DID}/post/${tid(2)}`)
    assert.equal(embed.author.name, "Synthetic News (@news.example.test)")
    assert.ok(!embed.description.includes("@everyone"))
})
test("A post appears once however often it is read, and reposts, replies and old posts stay out", async () => {
    const f = await following()
    posts(
        entry(2),
        entry(3, { reason: { $type: "app.bsky.feed.defs#reasonRepost" } }),
        entry(4, { reply: { root: {}, parent: {} } }),
        entry(5, {}, clock - 25 * HOUR),
    )
    await f.advance(POLL)
    await f.advance(POLL)
    await f.advance(POLL)
    assert.deepEqual(
        (await f.rows()).map((row) => row.itemId),
        [tid(2)],
    )
    // Post 4 is the account's own and newer, so reading moves past it without posting it again later
    assert.equal((await f.source())?.newestSeenId, tid(5))
})
test("A burst after an outage posts only the newest five", async () => {
    const f = await following()
    const burst = Array.from({ length: 9 }, (_, index) => entry(index + 2, {}, clock + index * 1000))
    posts(...burst)
    await f.advance(POLL)
    // Listed oldest first, as the account posted them
    assert.deepEqual(
        (await f.call("/feed/work", { serverId: "10", operation: { type: "list" } })).deliveries.map(
            (row: { itemId: string }) => row.itemId,
        ),
        [6, 7, 8, 9, 10].map((n) => tid(n)),
    )
    assert.equal((await f.source())?.newestSeenId, tid(10))
    await f.advance(POLL)
    assert.equal((await f.rows()).length, 5)
})
test("A second server gets only posts newer than its own follow, from the one shared source", async () => {
    const f = await following()
    delete process.env.NEONFLUX_SERVER_ID
    process.env.NEONFLUX_SERVER_MODE = "multi"
    await f.t.run(async (ctx) => {
        for (const serverId of ["10", "11"])
            await ctx.db.insert("serverInstallations", { serverId, status: "active", joinedAt: start })
    })
    clock += MINUTE
    // Published before the second server follows, and read only after it does
    posts(entry(2))
    clock += MINUTE
    await f.add({ channelId: "51" }, 200, "11")
    assert.equal((await f.t.run((ctx) => ctx.db.query("feedSources").collect())).length, 1)
    assert.equal((await f.poller())?.sourceCount, 1)
    await f.advance(POLL)
    assert.deepEqual(
        (await f.rows()).map((row) => row.serverId),
        ["10"],
    )
    clock += MINUTE
    posts(entry(3))
    await f.advance(POLL)
    assert.deepEqual((await f.rows()).map((row) => [row.serverId, row.itemId]).sort(), [
        ["10", tid(2)],
        ["10", tid(3)],
        ["11", tid(3)],
    ])
})
test("An empty read moves nothing, and a later post still counts as new", async () => {
    const f = await following()
    posts()
    await f.advance(POLL)
    const after = await f.source()
    assert.equal(after?.newestSeenId, tid(1))
    assert.deepEqual(await f.rows(), [])
    clock += MINUTE
    posts(entry(2))
    await f.advance(POLL)
    assert.deepEqual(
        (await f.rows()).map((row) => row.itemId),
        [tid(2)],
    )
})
test("An unreadable read waits longer each time, shows once it repeats and clears on the next good read", async () => {
    const f = await following()
    feed = () => new Response("oops", { status: 503 })
    await f.advance(POLL)
    const once = await f.source()
    assert.deepEqual([once?.failures, once?.lastError], [1, undefined])
    assert.ok(once!.dueAt >= clock + 2 * POLL)
    await f.advance(once!.dueAt - clock)
    const twice = await f.source()
    assert.equal(twice?.failures, 2)
    assert.ok(twice!.dueAt >= clock + 4 * POLL)
    await f.advance(twice!.dueAt - clock)
    const thrice = await f.source()
    assert.match(thrice?.lastError ?? "", /Bluesky could not be read/)
    assert.equal((await f.query()).subscriptions[0].status.error, thrice?.lastError)
    assert.match(JSON.stringify(await f.call("/recovery/list", { serverId: "10" })), /may be missed/)
    assert.equal(thrice?.newestSeenId, tid(1))
    clock += MINUTE
    posts(entry(2))
    await f.advance(thrice!.dueAt - clock)
    const healed = await f.source()
    assert.deepEqual([healed?.failures, healed?.lastError, healed?.newestSeenId], [0, undefined, tid(2)])
})
test("A 429 waits at least as long as the service asks, and stops the tick's other reads of that service", async () => {
    const f = await following()
    feed = () => new Response("{}", { status: 429, headers: { "retry-after": "86400" } })
    await f.advance(POLL)
    const limited = await f.source()
    assert.ok(limited!.dueAt >= clock + 24 * HOUR - 1000)
    assert.equal(limited?.failures, 1)
    const seen = requests.length
    await f.advance(6 * HOUR)
    assert.equal(requests.length, seen)
})
test("A shape change shows at once in status and recovery, logs a warning naming no content and moves nothing", async () => {
    const f = await following()
    const warnings: string[] = []
    mock.method(console, "warn", (message: string) => warnings.push(message))
    posts({ post: { uri: 5 } })
    await f.advance(POLL)
    const row = await f.source()
    assert.match(row?.lastError ?? "", /changed the form/)
    assert.equal(row?.newestSeenId, tid(1))
    assert.deepEqual(warnings, ["A Bluesky answer no longer has the expected shape"])
    assert.match(JSON.stringify(await f.call("/recovery/list", { serverId: "10" })), /changed the form/)
    assert.match((await f.query()).subscriptions[0].status.error, /changed the form/)
    // An empty read cannot prove the change is over
    posts()
    await f.advance(row!.dueAt - clock)
    assert.match((await f.source())?.lastError ?? "", /changed the form/)
    posts(entry(2))
    await f.advance((await f.source())!.dueAt - clock)
    assert.equal((await f.source())?.lastError, undefined)
})
test("A handle Bluesky does not know stops the source with a clear error, and adding it again retries", async () => {
    const f = fixture()
    profile = () => Response.json({ error: "InvalidRequest", message: "Profile not found" }, { status: 400 })
    await f.add()
    await f.settle()
    const row = (await f.query()).subscriptions[0]
    assert.equal(row.accountId, `pending:${HANDLE}`)
    assert.equal(row.status.stopped, true)
    assert.match(row.status.error, /no such account/)
    assert.match(JSON.stringify(await f.call("/recovery/list", { serverId: "10" })), /no such account/)
    const seen = requests.length
    await f.advance(HOUR)
    assert.equal(requests.length, seen)
    profile = () => Response.json({ did: DID, handle: HANDLE })
    await f.add()
    await f.advance(MINUTE)
    assert.equal((await f.query()).subscriptions[0].accountId, DID)
})
test("A rename keeps the account's dedupe, and a follow by the new handle lands on the same source", async () => {
    const f = await following()
    const renamed = entry(2)
    renamed.post.author = { ...renamed.post.author, handle: "renamed.example.test", displayName: "Renamed" }
    posts(renamed)
    await f.advance(POLL)
    assert.deepEqual([(await f.source())?.handle, (await f.source())?.name], ["renamed.example.test", "Renamed"])
    await f.add({ accountId: "pending:renamed.example.test", channelId: "52" })
    const { subscriptions } = await f.query()
    assert.deepEqual(
        subscriptions.map((row: { accountId: string; channelId: string }) => [row.accountId, row.channelId]),
        [[DID, "52"]],
    )
    assert.equal((await f.t.run((ctx) => ctx.db.query("feedSources").collect())).length, 1)
})
test("Following an account another server follows under an old handle merges into its source and keeps its newest post", async () => {
    const f = await following()
    await f.t.run(async (ctx) => {
        const row = await ctx.db
            .query("feedSources")
            .withIndex("by_account", (q) => q.eq("provider", "bluesky").eq("accountId", DID))
            .unique()
        await ctx.db.patch(row!._id, { handle: "old.example.test" })
    })
    await f.manage({ type: "remove", provider: "bluesky", accountId: DID })
    await f.t.run(async (ctx) => {
        await ctx.db.insert("feedSources", {
            provider: "bluesky",
            accountId: DID,
            handle: "old.example.test",
            resolvedAt: clock,
            newestSeenId: tid(7),
            dueAt: clock + 24 * HOUR,
            failures: 0,
            createdAt: clock,
        })
        await ctx.db.insert("feedSubscriptions", {
            serverId: "10",
            provider: "bluesky",
            accountId: DID,
            channelId: "49",
            enabled: true,
            createdAt: clock,
            updatedAt: clock,
            updatedBy: "20",
        })
    })
    await f.add()
    await f.advance(MINUTE)
    const sources = await f.t.run((ctx) => ctx.db.query("feedSources").collect())
    assert.deepEqual(
        sources.map((row) => [row.accountId, row.newestSeenId]),
        [[DID, tid(7)]],
    )
    assert.deepEqual(
        (await f.query()).subscriptions.map((row: { channelId: string }) => row.channelId),
        ["50"],
    )
})
test("While the bill guard pauses optional work polling waits, and resumes afterwards", async () => {
    const f = await following()
    process.env.NEONFLUX_MONTHLY_CALL_BUDGET = "100"
    await f.t.run((ctx) => ctx.db.insert("usageMonths", { month: "2026-10", calls: 95, warned: true }))
    const seen = requests.length
    await f.advance(POLL)
    await f.advance(3 * HOUR)
    assert.equal(requests.length, seen)
    delete process.env.NEONFLUX_MONTHLY_CALL_BUDGET
    await f.advance(HOUR)
    assert.ok(requests.length > seen)
})
test("X refuses an add without a key, and its monthly cap pauses X polling, shows in status and spares Bluesky", async () => {
    const f = await following()
    const addX = (expected = 200) =>
        f.manage({ type: "add", provider: "x", accountId: "pending:synthetic", channelId: "51" }, expected)
    await addX(503)
    assert.equal((await f.query()).xConfigured, false)
    process.env.NEONFLUX_X_BEARER_TOKEN = "synthetic-x-token"
    process.env.NEONFLUX_X_MONTHLY_POST_READS = "14"
    await addX()
    await f.advance(MINUTE)
    assert.equal((await f.source(X_ID, "x"))?.handle, "synthetic")
    // The lookup counted two reads
    assert.equal((await f.poller())?.xReads, 2)
    await f.advance(MINUTE)
    const row = await f.source(X_ID, "x")
    assert.equal(row?.provider, "x")
    assert.equal((await f.query()).xPaused, false)
    await f.t.run(async (ctx) => {
        const poller = await ctx.db.query("feedPoller").first()
        await ctx.db.patch(poller!._id, { xReads: 14 })
    })
    assert.equal((await f.query()).xPaused, true)
    const reads = () => requests.filter((url) => url.includes("/tweets")).length,
        blueskyReads = () => requests.filter((url) => url.includes("getAuthorFeed")).length,
        before = reads(),
        blueskyBefore = blueskyReads()
    await f.advance(3 * HOUR)
    assert.equal(reads(), before)
    assert.ok(blueskyReads() > blueskyBefore)
    // A new month starts over
    await f.advance(31 * 24 * HOUR)
    assert.ok(reads() > before)
})
test("X polling baselines on its first post, sends since_id afterwards and counts what it reads", async () => {
    const f = fixture()
    process.env.NEONFLUX_X_BEARER_TOKEN = "synthetic-x-token"
    await f.manage({ type: "add", provider: "x", accountId: "pending:synthetic", channelId: "51" })
    await f.settle()
    const tweet = (id: string) => ({
        id,
        text: `Post ${id}`,
        author_id: X_ID,
        created_at: new Date(clock).toISOString(),
    })
    timeline = () => Response.json({ data: [tweet("1850000000000000001")], meta: { result_count: 1 }, includes: {} })
    await f.advance(MINUTE)
    assert.equal((await f.source(X_ID, "x"))?.newestSeenId, "1850000000000000001")
    assert.deepEqual(await f.rows(), [])
    clock += MINUTE
    timeline = () => Response.json({ data: [tweet("1850000000000000002")], meta: { result_count: 1 }, includes: {} })
    await f.advance(30 * MINUTE)
    assert.match(requests.at(-1)!, /since_id=1850000000000000001/)
    assert.deepEqual(
        (await f.rows()).map((row) => [row.provider, row.itemId]),
        [["x", "1850000000000000002"]],
    )
    assert.equal((await f.poller())?.xReads, 4)
})
test("The deployment's source limit refuses a new account and leaves following one fine", async () => {
    const f = await following()
    process.env.NEONFLUX_FEED_SOURCE_LIMIT = "1"
    await f.add({ accountId: "pending:second.example.test" }, 507)
    await f.add({ channelId: "52" })
    assert.equal((await f.t.run((ctx) => ctx.db.query("feedSources").collect())).length, 1)
})
test("A server follows at most 10 accounts", async () => {
    const f = fixture()
    for (let index = 0; index < 10; index++) await f.add({ accountId: `pending:account${index}.example.test` })
    await f.add({ accountId: "pending:account10.example.test" }, 429)
})
test("Every change reaches the audit log naming its account", async () => {
    const f = await following()
    await f.add({ channelId: "52" })
    await f.manage({ type: "remove", provider: "bluesky", accountId: DID })
    const changes = await f.t.run((ctx) => ctx.db.query("auditLogEntries").collect())
    const feeds = changes.filter((row) => row.feature === "feeds")
    assert.equal(feeds.length, 3)
})
test("The worker holds posts for DEFCON and drops one a day old, and a blocked follow stops the source's posts to that server", async () => {
    const f = await following()
    posts(entry(2))
    await f.advance(POLL)
    const hold = await f.t.run(async (ctx) => {
        const id = await insertDocument(ctx, "moderationSettings", "10")
        await ctx.db.patch(id, { config: { ...(await ctx.db.get(id))!.config, defcon: 1 } })
        return id
    })
    assert.deepEqual((await f.call("/feed/work", { serverId: "10", operation: { type: "list" } })).deliveries, [])
    await f.t.run((ctx) => ctx.db.delete(hold))
    clock += 25 * HOUR
    assert.deepEqual((await f.call("/feed/work", { serverId: "10", operation: { type: "list" } })).deliveries, [])
    assert.equal((await f.rows())[0]?.state, "skipped")
    const blocked = { type: "blocked", provider: "bluesky", accountId: DID, channelId: "50", reason: "permission" }
    assert.deepEqual(await f.call("/feed/work", { serverId: "10", operation: blocked }), {
        type: "progress",
        recorded: true,
        name: HANDLE,
    })
    const row = (await f.query()).subscriptions[0]
    assert.deepEqual([row.enabled, row.problem], [false, "permission"])
    clock += MINUTE
    posts(entry(9))
    await f.advance(POLL)
    assert.equal((await f.rows()).length, 1)
    assert.match(JSON.stringify(await f.call("/recovery/list", { serverId: "10" })), /are off: NeonFlux cannot post/)
    await f.add()
    assert.equal((await f.query()).subscriptions[0].enabled, true)
})
test("A test post is labelled, uses the latest post held or a placeholder, and reads nothing", async () => {
    const f = await following()
    const seen = requests.length
    const placeholder = await f.call("/feed/query", {
        serverId: "10",
        sample: { provider: "bluesky", accountId: DID },
    })
    assert.equal(placeholder.sample.content.embed.title, "Test post from NeonFlux")
    assert.equal(placeholder.sample.content.embed.url, `https://bsky.app/profile/${DID}`)
    posts(entry(2))
    await f.advance(POLL)
    const latest = await f.call("/feed/query", { serverId: "10", sample: { provider: "bluesky", accountId: DID } })
    assert.equal(latest.sample.content.content, "Test post from NeonFlux")
    assert.equal(latest.sample.content.embed.url, `https://bsky.app/profile/${DID}/post/${tid(2)}`)
    assert.equal(requests.length, seen + 1)
    await f.call(
        "/feed/query",
        { serverId: "10", sample: { provider: "bluesky", accountId: "did:plc:syntheticccccccccccccccc" } },
        404,
    )
})
test("Retention removes old posts and deliveries with their tracked posts, except while an outcome is unknown", async () => {
    const f = await following()
    posts(entry(2), entry(3))
    await f.advance(POLL)
    await f.t.run(async (ctx) => {
        const attemptId = await insertDocument(ctx, "publishingAttempts", "10", {
            postNo: 5,
            outcome: "uncertain",
            unresolved: true,
        })
        const rows = await ctx.db.query("feedDeliveries").collect()
        await ctx.db.patch(rows[0]!._id, { attemptId })
    })
    await f.t.run(async (ctx) => {
        const later = clock + 31 * 24 * HOUR
        const { more } = await cleanupFeeds(ctx, later)
        assert.equal(more, false)
        assert.deepEqual(await ctx.db.query("feedItems").collect(), [])
        const left = await ctx.db.query("feedDeliveries").collect()
        assert.equal(left.length, 1)
        assert.ok(left[0]!.expiresAt > later)
    })
})

test("A chain whose scheduled tick was lost restarts from the retention pass, and a live one is left alone", async () => {
    const f = await following()
    const generation = (await f.poller())!.generation
    await f.t.run((ctx) => cleanupFeeds(ctx, clock))
    assert.equal((await f.poller())!.generation, generation)
    const late = clock + HOUR
    await f.t.run((ctx) => cleanupFeeds(ctx, late))
    assert.equal((await f.poller())!.generation, generation + 1)
})

test("A source no server wants is not read, forgets its newest post, and comes back with a first read that posts nothing", async () => {
    const f = await following()
    delete process.env.NEONFLUX_SERVER_ID
    process.env.NEONFLUX_SERVER_MODE = "multi"
    await f.t.run(async (ctx) => {
        await ctx.db.insert("serverInstallations", { serverId: "10", status: "removed", joinedAt: start })
    })
    posts(entry(2))
    const seen = requests.length
    await f.advance(POLL)
    await f.advance(3 * HOUR)
    assert.equal(requests.length, seen)
    const idle = await f.source()
    assert.deepEqual([idle?.idle, idle?.newestSeenId], [true, undefined])
    assert.deepEqual(await f.rows(), [])
    await f.t.run(async (ctx) => {
        const row = await ctx.db.query("serverInstallations").first()
        await ctx.db.patch(row!._id, { status: "active" })
    })
    await f.add({ channelId: "52" })
    await f.advance(MINUTE)
    const back = await f.source()
    assert.deepEqual([back?.idle, back?.newestSeenId], [undefined, tid(2)])
    assert.deepEqual(await f.rows(), [])
})
test("A follow that is off stops the reads of a source only it wanted", async () => {
    const f = await following()
    await f.call("/feed/work", {
        serverId: "10",
        operation: { type: "blocked", provider: "bluesky", accountId: DID, channelId: "50", reason: "channel" },
    })
    const seen = requests.length
    await f.advance(POLL)
    assert.equal(requests.length, seen)
    assert.equal((await f.source())?.idle, true)
})
test("A long list of follows nobody receives spends no reads, whether they are off or on removed servers", async () => {
    const f = await following()
    delete process.env.NEONFLUX_SERVER_ID
    process.env.NEONFLUX_SERVER_MODE = "multi"
    const follows = (enabled: boolean) =>
        f.t.run(async (ctx) => {
            const own = await ctx.db.query("feedSubscriptions").first()
            if (own) await ctx.db.delete(own._id)
            for (let index = 0; index < 150; index++)
                await ctx.db.insert("feedSubscriptions", {
                    serverId: String(2000 + index),
                    provider: "bluesky",
                    accountId: DID,
                    channelId: "50",
                    enabled,
                    createdAt: clock,
                    updatedAt: clock,
                    updatedBy: "20",
                })
        })
    await follows(false)
    const seen = requests.length
    await f.advance(POLL)
    assert.equal(requests.length, seen)
    assert.equal((await f.source())?.idle, true)
    await f.t.run(async (ctx) => {
        for (const row of await ctx.db.query("feedSubscriptions").collect())
            await ctx.db.patch(row._id, { enabled: true })
        const source = await ctx.db.query("feedSources").first()
        await ctx.db.patch(source!._id, { dueAt: clock, idle: undefined })
    })
    const next = (await f.poller())!.nextTickAt! - clock
    await f.advance(next)
    // One claim checks 100 of the 150 removed servers, and the next finishes the list without a read
    assert.equal((await f.source())?.followScanAfter, "2099")
    await f.advance(MINUTE)
    const done = await f.source()
    assert.deepEqual([done?.idle, done?.followScanAfter], [true, undefined])
    assert.equal(requests.length, seen)
})
test("A served server past the first 100 removed ones still gets its posts read", async () => {
    const f = await following()
    delete process.env.NEONFLUX_SERVER_ID
    process.env.NEONFLUX_SERVER_MODE = "multi"
    await f.t.run(async (ctx) => {
        await ctx.db.insert("serverInstallations", { serverId: "9999", status: "active", joinedAt: start })
        for (const serverId of [...Array.from({ length: 150 }, (_, index) => String(1000 + index)), "9999"])
            await ctx.db.insert("feedSubscriptions", {
                serverId,
                provider: "bluesky",
                accountId: DID,
                channelId: "50",
                enabled: true,
                createdAt: clock,
                updatedAt: clock,
                updatedBy: "20",
            })
    })
    // Server 10 from the first follow has no installation either, and sorts first
    const seen = requests.length
    await f.advance(POLL)
    assert.equal(requests.length, seen)
    assert.equal((await f.source())?.followScanAfter, "1098")
    await f.advance(MINUTE)
    assert.equal(requests.length, seen + 1)
    assert.equal((await f.source())?.followScanAfter, undefined)
})
test("A staff member's ID on a follow has a stated member data exemption", () => {
    assert.ok(MEMBER_DATA_EXEMPT.feedSubscriptions)
})
test("Overlapping ticks cannot spend the same X reads, and record settles the reservation", async () => {
    const f = fixture()
    process.env.NEONFLUX_X_BEARER_TOKEN = "synthetic-x-token"
    process.env.NEONFLUX_X_MONTHLY_POST_READS = "12"
    const insert = (accountId: string, dueAt: number) =>
        f.t.run(async (ctx) => {
            await ctx.db.insert("feedSources", {
                provider: "x",
                accountId,
                handle: `h${accountId}`,
                resolvedAt: clock,
                dueAt,
                failures: 0,
                createdAt: clock,
            })
            await ctx.db.insert("feedSubscriptions", {
                serverId: "10",
                provider: "x",
                accountId,
                channelId: "50",
                enabled: true,
                createdAt: clock,
                updatedAt: clock,
                updatedBy: "20",
            })
        })
    await insert("1001", clock)
    await insert("1002", clock + 61000)
    await f.t.run((ctx) => ctx.db.insert("feedPoller", { generation: 1, sourceCount: 2, xMonth: "2026-10", xReads: 0 }))
    const first = await f.t.mutation(internal.feedPolling.claim, { generation: 1 })
    assert.deepEqual([first?.sources.map((row) => row.accountId), first?.reserved], [["1001"], 12])
    assert.equal((await f.poller())?.xReads, 12)
    // The first tick's reads are still running when the second one claims
    clock += 61000
    const second = await f.t.mutation(internal.feedPolling.claim, { generation: 1 })
    assert.deepEqual([second?.sources, second?.reserved], [[], 0])
    assert.equal((await f.source("1002", "x"))!.dueAt, clock + HOUR)
    await f.t.mutation(internal.feedPolling.record, {
        reserved: 12,
        results: [{ provider: "x", accountId: "1001", kind: "empty" }],
    })
    assert.equal((await f.poller())?.xReads, 0)
})
test("A billed answer whose shape changed still counts against the cap", async () => {
    const f = fixture()
    process.env.NEONFLUX_X_BEARER_TOKEN = "synthetic-x-token"
    await f.manage({ type: "add", provider: "x", accountId: "pending:synthetic", channelId: "51" })
    await f.settle()
    timeline = () => Response.json({ data: [{ id: "broken" }, { id: "broken too" }], meta: { result_count: 2 } })
    await f.advance(MINUTE)
    // Two for the lookup and two for the posts it could not read
    assert.equal((await f.poller())?.xReads, 4)
    assert.match((await f.source(X_ID, "x"))?.lastError ?? "", /changed the form/)
})
test("Removing and following again while publishing is off does not bring old posts back", async () => {
    const f = await following()
    posts(entry(2))
    await f.advance(POLL)
    assert.equal((await f.rows()).length, 1)
    const hold = await f.t.run(async (ctx) => {
        const id = await insertDocument(ctx, "moderationSettings", "10")
        await ctx.db.patch(id, { config: { ...(await ctx.db.get(id))!.config, defcon: 1 } })
        return id
    })
    await f.manage({ type: "remove", provider: "bluesky", accountId: DID })
    clock += MINUTE
    await f.add({ accountId: DID })
    await f.t.run((ctx) => ctx.db.delete(hold))
    assert.deepEqual((await f.call("/feed/work", { serverId: "10", operation: { type: "list" } })).deliveries, [])
    assert.equal((await f.rows())[0]?.state, "skipped")
    // The publisher's own claim holds the same line for a post reserved before the removal
    await f.t.run(async (ctx) => {
        const row = (await ctx.db.query("feedDeliveries").first())!
        await ctx.db.patch(row._id, { state: "queued" })
    })
    const context = { originServerId: "10", observedAt: clock, channelId: "50", botId: "99", botAuthorized: true }
    assert.deepEqual(
        await f.call("/feed/work", {
            serverId: "10",
            operation: { type: "reserve", provider: "bluesky", accountId: DID, itemId: tid(2), context },
        }),
        { type: "skipped" },
    )
})
test("A publishing claim for a post older than a new follow closes without a send", async () => {
    const f = await following()
    posts(entry(2))
    await f.advance(POLL)
    const context = { originServerId: "10", observedAt: clock, channelId: "50", botId: "99", botAuthorized: true }
    const { grant } = await f.call("/feed/work", {
        serverId: "10",
        operation: { type: "reserve", provider: "bluesky", accountId: DID, itemId: tid(2), context },
    })
    await f.manage({ type: "remove", provider: "bluesky", accountId: DID })
    clock += MINUTE
    await f.add({ accountId: DID })
    const fresh = { ...context, observedAt: clock }
    const claim = await f.call("/publishing/dispatch", {
        serverId: "10",
        postNo: grant.postNo,
        attemptId: grant.attemptId,
        generation: grant.generation,
        sourceId: grant.sourceId,
        claimToken: "c".repeat(32),
        feedContext: fresh,
    })
    assert.equal(claim.claimed, false)
})
test("Moving 100 or more pending followers keeps the source count right", async () => {
    const f = fixture()
    delete process.env.NEONFLUX_SERVER_ID
    process.env.NEONFLUX_SERVER_MODE = "multi"
    await f.t.run((ctx) => ctx.db.insert("serverInstallations", { serverId: "10", status: "active", joinedAt: start }))
    await f.add()
    await f.t.run(async (ctx) => {
        for (let index = 0; index < 150; index++)
            await ctx.db.insert("feedSubscriptions", {
                serverId: String(2000 + index),
                provider: "bluesky",
                accountId: `pending:${HANDLE}`,
                channelId: "50",
                enabled: true,
                createdAt: clock,
                updatedAt: clock,
                updatedBy: "20",
            })
    })
    await f.settle()
    assert.equal(await f.source(`pending:${HANDLE}`), null)
    assert.equal((await f.source())?.handle, HANDLE)
    assert.equal((await f.poller())?.sourceCount, 1)
})
test("Removing the last follow while the bill guard pauses polling still ends the chain", async () => {
    const f = await following()
    process.env.NEONFLUX_MONTHLY_CALL_BUDGET = "100"
    await f.t.run((ctx) => ctx.db.insert("usageMonths", { month: "2026-10", calls: 95, warned: true }))
    await f.manage({ type: "remove", provider: "bluesky", accountId: DID })
    await f.advance(HOUR)
    const poller = await f.poller()
    assert.deepEqual([poller?.scheduledId, poller?.nextTickAt], [undefined, undefined])
})

// The shared rules, tested once and free of any provider
test("Item IDs sort by length and then text, for both Bluesky keys and X numbers", () => {
    assert.ok(feedNewer("1850000000000000002", "1850000000000000001"))
    assert.ok(feedNewer("10", "9"))
    assert.ok(feedNewer(tid(2), tid(1)))
    assert.ok(!feedNewer(tid(1), tid(1)))
})
test("planFeedRead posts nothing on a first read and keeps the newest of a burst, skipping what selection or age rules out", () => {
    const now = start,
        item = (id: string, fields: Partial<Parameters<typeof planFeedRead>[1][number]> = {}) => ({
            id,
            publishedAt: now,
            posted: true,
            text: "",
            url: "https://example.test",
            ...fields,
        })
    assert.deepEqual(planFeedRead(undefined, [item("3"), item("5")], now), { newestSeenId: "5", post: [] })
    assert.deepEqual(planFeedRead("5", [], now), { newestSeenId: "5", post: [] })
    const plan = planFeedRead(
        "2",
        [
            item("1"),
            item("2"),
            item("3", { posted: false }),
            item("4", { publishedAt: now - 86400000 }),
            ...["5", "6", "7", "8", "9", "10"].map((id) => item(id)),
        ],
        now,
    )
    assert.equal(plan.newestSeenId, "10")
    assert.deepEqual(
        plan.post.map((row) => row.id),
        ["10", "9", "8", "7", "6"],
    )
})
test("A long post cuts at a sentence, or a word when a sentence runs on, and a short one stays whole", () => {
    assert.equal(feedExcerpt("Short. Post"), "Short. Post")
    const long = `${"First sentence goes on. ".repeat(14)}And this one never ends because it runs far past where the cut falls`
    const cut = feedExcerpt(long)
    assert.ok(cut.length <= 300)
    assert.ok(cut.endsWith("."))
    const words = feedExcerpt("word ".repeat(100))
    assert.ok(words.endsWith("…") && words.length <= 300 && !words.includes(" …"))
    assert.ok(feedExcerpt("x".repeat(400)).endsWith("…"))
    assert.ok(!/\p{Cs}$/u.test(feedExcerpt(`${"a".repeat(299)}😀 more text beyond`).replace(/…$/, "")))
})
test("The interval widens with the sources, so a whole round fits the ticks that read it", () => {
    assert.equal(feedInterval("bluesky", 1), 5 * MINUTE)
    assert.equal(feedInterval("bluesky", FEED_TICK_BATCH * 5), 5 * MINUTE)
    assert.equal(feedInterval("bluesky", FEED_TICK_BATCH * 20), 20 * MINUTE)
    assert.equal(feedInterval("x", 1), 30 * MINUTE)
    assert.equal(feedFailureWait(5 * MINUTE, 1), 10 * MINUTE)
    assert.equal(feedFailureWait(5 * MINUTE, 30), 6 * HOUR)
    // A round longer than the longest wait still spaces its failures by the round
    assert.equal(feedFailureWait(7 * HOUR, 3), 7 * HOUR)
})
test("A rate limit's wait reads Retry-After in seconds or as a date and X's reset time", () => {
    const now = start,
        seconds = (value: number) => new Date(now + value * 1000)
    assert.equal(feedRetryAt(new Headers({ "retry-after": "60" }), now), now + 60000)
    assert.equal(feedRetryAt(new Headers({ "retry-after": seconds(90).toUTCString() }), now), now + 90000)
    assert.equal(feedRetryAt(new Headers({ "x-rate-limit-reset": String((now + 120000) / 1000) }), now), now + 120000)
    assert.equal(feedRetryAt(new Headers({ "retry-after": "soon" }), now), undefined)
    assert.equal(feedRetryAt(new Headers(), now), undefined)
})
test("A post renders one embed with the author, an excerpt, the first image and a footer", () => {
    const { content, forumPostName } = renderFeedPost("x", "Synthetic (@synthetic)", "https://x.com/synthetic", {
        text: "Hello <@123> @everyone",
        url: "https://x.com/synthetic/status/5",
        image: "https://pbs.twimg.com/a.jpg",
    })
    assert.deepEqual(
        [content.content, content.embed?.title, content.embed?.footer?.text, content.embed?.image?.url],
        ["", "New post", "X", "https://pbs.twimg.com/a.jpg"],
    )
    assert.ok(!/<@|@everyone/.test(content.embed?.description ?? ""))
    assert.ok(forumPostName.length <= 100)
})
test("Typed handles and links become account keys, and anything else names nothing", () => {
    const pending = `pending:${HANDLE}`
    for (const value of [
        HANDLE,
        `@${HANDLE}`,
        `https://bsky.app/profile/${HANDLE}`,
        `<https://bsky.app/profile/${HANDLE}/post/${tid(1)}>`,
    ])
        assert.equal(feedAccountKey("bluesky", value), pending, value)
    assert.equal(feedAccountKey("bluesky", "synthetic"), "pending:synthetic.bsky.social")
    assert.equal(feedAccountKey("bluesky", DID), DID)
    assert.equal(feedAccountKey("bluesky", `bsky.app/profile/${DID}`), DID)
    for (const value of [
        "https://example.test/profile/a.b",
        "not a handle",
        "a..b",
        "https://bsky.app/search",
        "100%",
        "https://bsky.app/profile/100%",
    ])
        assert.equal(feedAccountKey("bluesky", value), undefined, value)
    for (const value of [
        "Synthetic",
        "@synthetic",
        "https://x.com/synthetic",
        "twitter.com/synthetic/status/1",
        "mobile.twitter.com/synthetic",
    ])
        assert.equal(feedAccountKey("x", value), "pending:synthetic", value)
    assert.equal(feedAccountKey("x", "12345"), "pending:12345")
    for (const value of ["far_too_long_for_an_x_name", "https://example.test/synthetic", "has space"])
        assert.equal(feedAccountKey("x", value), undefined, value)
    assert.match(feedAccountToken("bluesky", DID), /^[a-zA-Z0-9_-]+$/)
    assert.match(feedSourceId("bluesky", "did:web:example.test", tid(1)), /^[a-zA-Z0-9_-]+$/)
})
test("Bluesky answers tell an empty feed, a page of others' posts and a changed shape apart", () => {
    assert.deepEqual(blueskyFeedAnswer(DID, { feed: [] }), { kind: "empty" })
    assert.deepEqual(blueskyFeedAnswer(DID, {}), { kind: "shape-change" })
    assert.deepEqual(blueskyFeedAnswer(DID, null), { kind: "shape-change" })
    assert.deepEqual(blueskyFeedAnswer(DID, { feed: "posts" }), { kind: "shape-change" })
    assert.deepEqual(blueskyFeedAnswer(DID, { feed: [{ nope: true }] }), { kind: "shape-change" })
    const other = entry(1)
    other.post.author = { ...other.post.author, did: "did:plc:syntheticbbbbbbbbbbbbbbb" }
    other.post.uri = `at://did:plc:syntheticbbbbbbbbbbbbbbb/app.bsky.feed.post/${tid(1)}`
    assert.deepEqual(
        blueskyFeedAnswer(DID, {
            feed: [{ ...other, reason: { $type: "app.bsky.feed.defs#reasonRepost" } }],
        }),
        { kind: "empty" },
    )
    assert.equal(blueskyItemPosted(DID, entry(1)), true)
    // Own posts without text are not an empty page, while a repost of a broken post says nothing
    const textless = entry(1)
    textless.post.record = { $type: "app.bsky.feed.post", createdAt: textless.post.record.createdAt } as never
    assert.deepEqual(blueskyFeedAnswer(DID, { feed: [textless] }), { kind: "shape-change" })
    assert.deepEqual(blueskyFeedAnswer(DID, { feed: [{ ...textless, reason: { $type: "reasonRepost" } }] }), {
        kind: "empty",
    })
    const images = entry(2, {})
    Object.assign(images.post, {
        embed: {
            $type: "app.bsky.embed.recordWithMedia#view",
            media: { $type: "app.bsky.embed.images#view", images: [{ fullsize: "https://cdn.bsky.app/first.jpg" }] },
        },
    })
    const read = blueskyFeedAnswer(DID, { feed: [images] })
    assert.equal(read.kind === "items" && read.items[0]?.image, "https://cdn.bsky.app/first.jpg")
})
