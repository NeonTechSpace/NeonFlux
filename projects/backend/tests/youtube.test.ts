import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { internal } from "../convex/_generated/api.js"
import { hubBackoff, parseYoutubeNotification, renderYoutubeAlert, youtubeTopic } from "../convex/youtubeDomain.ts"
import { cleanupYoutube } from "../convex/youtubeStore.ts"
import { botCall } from "./bot-service.ts"

const keys = ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_IDS", "NEONFLUX_BOT_API_SECRET", "NEONFLUX_WEBSUB_HUB_URL", "NEONFLUX_WEBSUB_CALLBACK_BASE"] as const
const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]))
const start = Date.parse("2026-10-01T00:00:00Z"), minute = 60000, day = 86400000
const UC = `UC${"a".repeat(22)}`, OTHER = `UC${"b".repeat(22)}`, hubUrl = "https://hub.example.test/subscribe", base = "https://alerts.example.test"
let clock = start, random = 0.5
type HubCall = Record<string, string>
let hubCalls: HubCall[] = [], hubStatus = 202
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    Object.assign(process.env, { NEONFLUX_SERVER_ID: "10", NEONFLUX_BOT_API_SECRET: "synthetic-youtube-secret-not-a-credential-00", NEONFLUX_WEBSUB_HUB_URL: hubUrl, NEONFLUX_WEBSUB_CALLBACK_BASE: base })
    clock = start; random = 0.5; hubCalls = []; hubStatus = 202
    mock.method(Date, "now", () => clock)
    mock.method(Math, "random", () => random)
    mock.timers.enable({ apis: ["setTimeout"] })
    // The only network a test sees is this synthetic hub
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        assert.equal(String(input), hubUrl)
        hubCalls.push(Object.fromEntries(new URLSearchParams(String(init?.body))))
        return new Response(null, { status: hubStatus })
    })
})
afterEach(() => {
    mock.restoreAll(); mock.timers.reset()
    for (const key of keys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key] }
})
const modules = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url)).filter(name => name.endsWith(".ts")).map(name => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")], ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const actor = { originServerId: "10", userId: "20", roleIds: [], isOwner: false, isAdministrator: true, nativePermissionAuthorized: true }
const iso = (at: number) => new Date(at).toISOString().replace(/\.\d+Z$/, "+00:00")
const entry = (videoId: string, title: string, publishedAt: number, channel = UC) => `<entry><id>yt:video:${videoId}</id><yt:videoId>${videoId}</yt:videoId><yt:channelId>${channel}</yt:channelId>`
    + `<title>${title}</title><link rel="alternate" href="https://www.youtube.com/watch?v=${videoId}"/><author><name>Synthetic Channel</name><uri>https://www.youtube.com/channel/${channel}</uri></author>`
    + `<published>${iso(publishedAt)}</published><updated>${iso(publishedAt).replace("+00:00", ".552394234+00:00")}</updated></entry>`
const feed = (entries: string) => `<?xml version='1.0' encoding='UTF-8'?>\n<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">`
    + `<link rel="hub" href="https://pubsubhubbub.appspot.com"/><title>YouTube video feed</title><updated>2026-10-01T00:00:00+00:00</updated>${entries}</feed>\n`
const video = (id: string) => id.padEnd(11, "x")

async function fixture() {
    const t = convexTest({ schema, modules, transactionLimits: true }); let sequence = 1000
    const call = async (path: string, body: unknown, expected = 200) => {
        const response = await botCall(t, path, body), result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result
    }
    const manage = (operation: unknown, expected = 200, fields: Record<string, unknown> = {}) =>
        call("/youtube/manage", { serverId: "10", originServerId: "10", messageId: String(++sequence), createdAt: clock, actor, managerAuthorized: true, operation, ...fields }, expected)
    const work = (operation: unknown, expected = 200) => call("/youtube/work", { serverId: "10", operation }, expected)
    const settle = () => t.finishAllScheduledFunctions(() => mock.timers.tick(0))
    const source = (id = UC) => t.run(ctx => ctx.db.query("youtubeSources").withIndex("by_channel", q => q.eq("youtubeChannelId", id)).unique())
    const table = <T extends "youtubeSources" | "youtubeVideos" | "youtubeDeliveries" | "publishingPosts" | "publishingAttempts">(name: T) => t.run(ctx => ctx.db.query(name).collect())
    const challenge = (params: Record<string, string>, id = UC) => t.fetch(`/websub/youtube?${new URLSearchParams({ channel: id, ...params })}`, { method: "GET" })
    const confirm = async (id = UC, leaseSeconds = "432000") => {
        const response = await challenge({ "hub.mode": "subscribe", "hub.topic": youtubeTopic(id), "hub.challenge": "synthetic-challenge", "hub.lease_seconds": leaseSeconds }, id)
        assert.equal(response.status, 200)
        assert.equal(await response.text(), "synthetic-challenge")
    }
    const notify = async (xml: string, options: { id?: string, secret?: string | null } = {}) => {
        const id = options.id ?? UC, secret = options.secret === undefined ? (await source(id))?.secret : options.secret
        const headers: Record<string, string> = secret ? { "X-Hub-Signature": `sha1=${createHmac("sha1", secret).update(xml).digest("hex")}` } : {}
        return (await t.fetch(`/websub/youtube?channel=${id}`, { method: "POST", headers, body: xml })).status
    }
    const signal = () => t.run(async ctx => (await ctx.db.query("workSignal").first())?.version ?? 0)
    return { t, call, manage, work, settle, source, table, challenge, confirm, notify, signal }
}
// A followed channel whose subscription YouTube's hub confirmed
async function subscribed() {
    const f = await fixture()
    await f.manage({ type: "add", youtubeChannelId: UC, channelId: "50" })
    await f.settle()
    await f.confirm()
    return f
}

test("Adding a channel subscribes at the hub with its own secret, and only the challenge for a topic NeonFlux asked for is answered", async () => {
    const f = await fixture()
    const added = await f.manage({ type: "add", youtubeChannelId: UC, channelId: "50" })
    assert.deepEqual(added, { type: "added", subscription: { youtubeChannelId: UC, channelId: "50", enabled: true, createdAt: start, status: {} } })
    await f.settle()
    assert.equal(hubCalls.length, 1)
    const secret = (await f.source())!.secret!
    assert.match(secret, /^[a-f0-9]{64}$/)
    assert.deepEqual(hubCalls[0], { "hub.callback": `${base}/websub/youtube?channel=${UC}`, "hub.mode": "subscribe", "hub.topic": youtubeTopic(UC), "hub.verify": "async", "hub.secret": secret })
    // Unknown channels, other topics and the mode NeonFlux does not want get no challenge and change nothing
    const before = await f.table("youtubeSources")
    for (const [params, id] of [[{ "hub.mode": "subscribe", "hub.topic": youtubeTopic(OTHER), "hub.challenge": "x", "hub.lease_seconds": "432000" }, OTHER],
        [{ "hub.mode": "subscribe", "hub.topic": youtubeTopic(OTHER), "hub.challenge": "x", "hub.lease_seconds": "432000" }, UC],
        [{ "hub.mode": "unsubscribe", "hub.topic": youtubeTopic(UC), "hub.challenge": "x" }, UC],
        [{ "hub.mode": "subscribe", "hub.topic": youtubeTopic(UC), "hub.challenge": "x", "hub.lease_seconds": "soon" }, UC]] as const) {
        assert.equal((await f.challenge(params, id)).status, 404)
    }
    assert.deepEqual(await f.table("youtubeSources"), before)
    await f.confirm()
    const confirmed = (await f.source())!
    assert.deepEqual([confirmed.leaseExpiresAt, confirmed.dueAt, confirmed.failures], [start + 432000000, start + 4 * day, 0])
    assert.equal((await f.call("/youtube/query", { serverId: "10" })).subscriptions[0].status.subscribedUntil, start + 432000000)
    // Adding the channel again only changes where its alerts go, without a second subscription
    await f.manage({ type: "add", youtubeChannelId: UC, channelId: "51" })
    await f.settle()
    assert.equal(hubCalls.length, 1)
})

test("Notifications need the channel's signature, record each video once and alert once per subscription for new uploads only", async () => {
    const f = await subscribed()
    clock = start + 2 * minute
    const upload = feed(entry(video("upload"), "Launch &amp; recap", start + minute))
    assert.equal(await f.notify(upload, { secret: null }), 403)
    assert.equal(await f.notify(upload, { secret: "a-different-secret" }), 403)
    assert.equal(await f.notify(upload, { id: OTHER, secret: "a-different-secret" }), 404)
    // A signed but unreadable or empty notification is never taken as no news
    assert.equal(await f.notify("not a feed"), 400)
    assert.equal(await f.notify(feed("")), 400)
    assert.equal(await f.notify(feed(entry(video("foreign"), "Elsewhere", start + minute, OTHER))), 400)
    assert.equal(await f.notify(feed(entry(video("large"), "x".repeat(65536), start + minute))), 413)
    assert.deepEqual([(await f.table("youtubeVideos")).length, (await f.table("youtubeDeliveries")).length, (await f.source())!.lastNotificationAt], [0, 0, undefined])

    const version = await f.signal()
    assert.equal(await f.notify(upload), 204)
    const [delivery] = await f.table("youtubeDeliveries")
    assert.deepEqual([delivery!.serverId, delivery!.videoId, delivery!.title, delivery!.state], ["10", video("upload"), "Launch & recap", "queued"])
    assert.equal(await f.signal(), version + 1)
    assert.deepEqual([(await f.source())!.lastNotificationAt, (await f.source())!.title], [clock, "Synthetic Channel"])
    // The same video again is an update: Its title changes, and nothing else is posted
    assert.equal(await f.notify(feed(entry(video("upload"), "Launch and recap", start + minute))), 204)
    assert.deepEqual((await f.table("youtubeDeliveries")).map(row => row.videoId), [video("upload")])
    assert.equal((await f.table("youtubeVideos"))[0]!.title, "Launch and recap")
    // A video published before the channel was added is recorded and never posted
    assert.equal(await f.notify(feed(entry(video("older"), "Older", start - minute))), 204)
    assert.deepEqual([(await f.table("youtubeVideos")).length, (await f.table("youtubeDeliveries")).length], [2, 1])
    // Neither is a video published more than seven days ago, even after the channel was added
    clock = start + 10 * day
    assert.equal(await f.notify(feed(entry(video("late"), "Late", start + 2 * day))), 204)
    assert.deepEqual([(await f.table("youtubeVideos")).length, (await f.table("youtubeDeliveries")).length], [3, 1])
    // A notification that only deletes videos changes nothing
    assert.equal(await f.notify(feed(`<at:deleted-entry ref="yt:video:${video("upload")}" when="${iso(clock)}"/>`)), 204)
})

test("An alert goes through the publisher once, and a missing channel or permission turns its subscription off and shows in the recovery inbox", async () => {
    const f = await subscribed()
    clock = start + 2 * minute
    assert.equal(await f.notify(feed(entry(video("first"), "@everyone &lt;@123&gt; live now", start + minute))), 204)
    assert.deepEqual((await f.call("/service/work", { cursor: null, requestedAt: clock })).kinds.youtube, ["10"])
    assert.deepEqual(await f.work({ type: "list" }), { type: "deliveries", deliveries: [{ youtubeChannelId: UC, videoId: video("first"), channelId: "50" }] })
    const context = { originServerId: "10", observedAt: clock, channelId: "50", botId: "90", botAuthorized: true }
    await f.work({ type: "reserve", youtubeChannelId: UC, videoId: video("first"), context: { ...context, channelId: "51" } }, 409)
    const { grant } = await f.work({ type: "reserve", youtubeChannelId: UC, videoId: video("first"), context })
    const consumer = { type: "youtube", youtubeChannelId: UC, videoId: video("first") }
    assert.deepEqual([grant.consumer, grant.source, grant.provenance, grant.action, grant.channelId, grant.actorId, grant.sourceId], [consumer, consumer, consumer, "send", "50", "90", `youtube_${UC}_${video("first")}`])
    // Mentions in titles never render as mentions, the title links to the watch page and YouTube is named as the source
    const title = "@​everyone <​@123> live now"
    assert.equal(grant.forumPostName, title)
    assert.deepEqual(grant.content, { content: "", embed: { title, url: `https://www.youtube.com/watch?v=${video("first")}`, color: 0xff0000,
        author: { name: "Synthetic Channel", url: `https://www.youtube.com/channel/${UC}` }, image: { url: `https://i.ytimg.com/vi/${video("first")}/hqdefault.jpg` }, footer: { text: "YouTube" } } })
    await f.work({ type: "reserve", youtubeChannelId: UC, videoId: video("first"), context }, 409)
    assert.deepEqual(await f.work({ type: "list" }), { type: "deliveries", deliveries: [] })
    const binding = { serverId: "10", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId }, claimToken = "c".repeat(32)
    await f.call("/publishing/dispatch", { ...binding, claimToken }, 400)
    assert.equal((await f.call("/publishing/dispatch", { ...binding, claimToken, youtubeContext: context })).claimed, true)
    await f.call("/publishing/outcome", { ...binding, claimToken, outcome: "sent", messageId: "700", threadId: "701" })
    assert.equal((await f.table("youtubeDeliveries"))[0]!.state, "sent")
    assert.equal((await f.call("/youtube/query", { serverId: "10" })).subscriptions[0].status.lastPostAt, clock)

    // NeonFlux cannot post in the channel anymore: The subscription turns off once, its waiting alerts are dropped and the inbox names the fix
    await f.notify(feed(entry(video("second"), "Second", start + 90000)))
    assert.deepEqual(await f.work({ type: "blocked", youtubeChannelId: UC, channelId: "51", reason: "permission" }), { type: "progress", recorded: false })
    assert.deepEqual(await f.work({ type: "blocked", youtubeChannelId: UC, channelId: "50", reason: "permission" }), { type: "progress", recorded: true })
    assert.deepEqual(await f.work({ type: "blocked", youtubeChannelId: UC, channelId: "50", reason: "permission" }), { type: "progress", recorded: false })
    assert.deepEqual(await f.work({ type: "list" }), { type: "deliveries", deliveries: [] })
    assert.equal((await f.table("youtubeDeliveries")).find(row => row.videoId === video("second"))!.state, "skipped")
    const view = (await f.call("/youtube/query", { serverId: "10" })).subscriptions[0]
    assert.deepEqual([view.enabled, view.problem], [false, "permission"])
    const inbox = await f.call("/recovery/list", { serverId: "10" })
    const entry_ = inbox.entries.find((item: { source?: string }) => item.source === "youtube")
    assert.match(entry_.summary, /YouTube alerts for Synthetic Channel are off: NeonFlux cannot post in channel 50/)
    assert.match(entry_.next, /View Channel, Send Messages and Embed Links.*!youtube add UC/)
    assert.deepEqual((await f.call("/setup/status", { serverId: "10" })).sections.find((row: { id: string }) => row.id === "youtube"), { id: "youtube", state: "setup" })
    // A turned off subscription gets no alerts, and adding the channel again turns it back on
    await f.notify(feed(entry(video("third"), "Third", start + 100000)))
    assert.equal((await f.table("youtubeDeliveries")).length, 2)
    const restored = (await f.manage({ type: "add", youtubeChannelId: UC, channelId: "50" })).subscription
    assert.deepEqual([restored.enabled, restored.problem], [true, undefined])

    // Retention removes the sent alert with its tracked post after 30 days
    clock = start + 31 * day
    assert.equal((await f.table("publishingPosts")).length, 1)
    await f.t.run(ctx => cleanupYoutube(ctx, clock))
    assert.deepEqual([(await f.table("youtubeDeliveries")).length, (await f.table("publishingPosts")).length, (await f.table("publishingAttempts")).length, (await f.table("youtubeVideos")).length], [0, 0, 0, 0])
})

test("An alert the publisher never claimed waits for another try, and one a day old is dropped", async () => {
    const f = await subscribed()
    clock = start + 2 * minute
    await f.notify(feed(entry(video("retry"), "Retry", start + minute)))
    const context = { originServerId: "10", observedAt: clock, channelId: "50", botId: "90", botAuthorized: true }
    const { grant } = await f.work({ type: "reserve", youtubeChannelId: UC, videoId: video("retry"), context })
    // The bot gave up before its claim, so nothing reached Fluxer
    await f.call("/publishing/outcome", { serverId: "10", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, outcome: "failed" })
    const [row] = await f.table("youtubeDeliveries")
    assert.deepEqual([row!.state, row!.nextCheckAt, row!.attemptId, (await f.table("publishingAttempts")).length], ["queued", clock + minute, undefined, 0])
    await f.work({ type: "defer", youtubeChannelId: UC, videoId: video("retry") })
    clock = start + 2 * minute + day
    assert.deepEqual(await f.work({ type: "list" }), { type: "deliveries", deliveries: [] })
    assert.equal((await f.table("youtubeDeliveries"))[0]!.state, "skipped")
})

test("Leases renew a day before they end, failed requests back off with jitter, and a channel no server follows unsubscribes", async () => {
    const f = await subscribed()
    const leases = () => f.t.mutation(internal.youtubeHub.leases, {}).then(f.settle)
    clock = start + 4 * day - 1
    await leases()
    assert.equal(hubCalls.length, 1)
    clock = start + 4 * day
    hubStatus = 500
    await leases()
    assert.deepEqual([hubCalls.length, hubCalls[1]!["hub.mode"]], [2, "subscribe"])
    // Equal jitter: half the delay plus a random share of the other half, doubling from one minute
    let row = (await f.source())!
    assert.deepEqual([row.failures, row.lastError, row.dueAt], [1, "YouTube's hub answered 500", clock + 45000])
    assert.equal((await f.call("/youtube/query", { serverId: "10" })).subscriptions[0].status.hubError, "YouTube's hub answered 500")
    random = 1
    clock = row.dueAt
    await leases()
    row = (await f.source())!
    assert.deepEqual([hubCalls.length, row.failures, row.dueAt], [3, 2, clock + 120000])
    assert.deepEqual([hubBackoff(1, 0), hubBackoff(1, 1), hubBackoff(3, 0), hubBackoff(40, 1)], [30000, 60000, 120000, 6 * 3600000])
    // An accepted request waits an hour for the hub's confirmation, which resets the backoff
    hubStatus = 202
    clock = row.dueAt
    await leases()
    row = (await f.source())!
    assert.deepEqual([row.lastError, row.dueAt], [undefined, clock + 3600000])
    await f.confirm()
    assert.deepEqual([(await f.source())!.failures, (await f.source())!.leaseExpiresAt], [0, clock + 432000000])
    // A refusal from the hub keeps its reason and retries with backoff
    assert.equal((await f.challenge({ "hub.mode": "denied", "hub.topic": youtubeTopic(UC), "hub.reason": "synthetic refusal" })).status, 200)
    row = (await f.source())!
    assert.deepEqual([row.lastError, row.dueAt], ["YouTube's hub refused the subscription: synthetic refusal", clock + 60000])

    // Removing the last subscription unsubscribes, and the hub's confirmation deletes the source
    await f.manage({ type: "remove", youtubeChannelId: UC })
    await f.settle()
    assert.deepEqual([hubCalls.at(-1)!["hub.mode"], hubCalls.at(-1)!["hub.secret"]], ["unsubscribe", undefined])
    assert.equal((await f.challenge({ "hub.mode": "unsubscribe", "hub.topic": youtubeTopic(UC), "hub.challenge": "bye" })).status, 200)
    assert.equal(await f.source(), null)
    assert.equal(await f.notify(feed(entry(video("gone"), "Gone", clock)), { secret: "anything" }), 404)
    // A source whose lease already ended needs no request
    await f.manage({ type: "add", youtubeChannelId: OTHER, channelId: "50" })
    await f.settle()
    const calls = hubCalls.length
    await f.manage({ type: "remove", youtubeChannelId: OTHER })
    await f.settle()
    assert.deepEqual([hubCalls.length, await f.source(OTHER)], [calls, null])
    // A purged server's subscription goes without a removal, so the sweep checks for followers and unsubscribes instead of renewing
    await f.manage({ type: "add", youtubeChannelId: UC, channelId: "50" })
    await f.settle()
    await f.confirm()
    await f.t.run(async ctx => { for (const row of await ctx.db.query("youtubeSubscriptions").collect()) await ctx.db.delete(row._id) })
    clock += 4 * day
    await leases()
    assert.deepEqual([hubCalls.at(-1)!["hub.mode"], (await f.source())!.mode], ["unsubscribe", "unsubscribe"])
})

test("A server follows at most ten channels, managers only, and only once the deployment can reach the hub", async () => {
    const f = await fixture()
    for (const invalid of [{ type: "add", youtubeChannelId: "@synthetic", channelId: "50" }, { type: "add", youtubeChannelId: UC, channelId: "x" }, { type: "pause", youtubeChannelId: UC }]) await f.manage(invalid, 400)
    await f.manage({ type: "add", youtubeChannelId: UC, channelId: "50" }, 403, { managerAuthorized: false })
    for (let index = 0; index < 10; index++) await f.manage({ type: "add", youtubeChannelId: `UC${String(index).padStart(22, "c")}`, channelId: "50" })
    await f.manage({ type: "add", youtubeChannelId: UC, channelId: "50" }, 429)
    await f.manage({ type: "remove", youtubeChannelId: UC }, 404)
    // Every change is recorded in the audit log under the YouTube family
    const entries = await f.t.run(ctx => ctx.db.query("auditLogEntries").collect())
    assert.deepEqual([entries.length, entries[0]!.feature, entries[0]!.setting], [10, "youtube", `add UC${"0".padStart(22, "c")}`])
    delete process.env.NEONFLUX_WEBSUB_CALLBACK_BASE
    await f.manage({ type: "remove", youtubeChannelId: `UC${"0".padStart(22, "c")}` })
    await f.manage({ type: "add", youtubeChannelId: UC, channelId: "50" }, 503)
    assert.equal((await f.call("/youtube/query", { serverId: "10" })).configured, false)
})

test("The notification parser reads only the fields it needs, strictly, and the alert renders a placeholder without a video", () => {
    const parsed = parseYoutubeNotification(feed(entry(video("parse"), "A &lt;b&gt; &#x26; &#38; <![CDATA[x]]>", start)))
    assert.equal(parsed, undefined)
    assert.deepEqual(parseYoutubeNotification(feed(entry(video("parse"), "A &lt;b&gt; &#x26; &#38;", start))), [{ videoId: video("parse"), youtubeChannelId: UC, title: "A <b> & &", channelTitle: "Synthetic Channel", publishedAt: start, updatedAt: start + 552 }])
    assert.equal(parseYoutubeNotification(feed(entry(video("parse"), "Bad &nbsp; entity", start))), undefined)
    assert.equal(parseYoutubeNotification(feed(entry("short", "Short ID", start))), undefined)
    assert.equal(parseYoutubeNotification(feed(entry(video("parse"), "No date", start).replace(/<published>.*<\/published>/, ""))), undefined)
    assert.deepEqual(renderYoutubeAlert(UC, undefined, undefined), { forumPostName: "Test alert from NeonFlux", content: { content: "", embed: { title: "Test alert from NeonFlux", url: `https://www.youtube.com/channel/${UC}`, color: 0xff0000, footer: { text: "YouTube" } } } })
    // A long title fits the embed and, shorter still, a forum post's name
    const long = renderYoutubeAlert(UC, { videoId: video("long"), title: "t".repeat(300) }, undefined)
    assert.deepEqual([long.content.embed!.title!.length, long.forumPostName.length, long.forumPostName.endsWith("…")], [256, 100, true])
})
