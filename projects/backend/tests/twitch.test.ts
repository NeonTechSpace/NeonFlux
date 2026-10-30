import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { internal } from "../convex/_generated/api.js"
import { cleanupTwitch } from "../convex/twitchStore.ts"
import { twitchConfig, renderTwitchAlert } from "../convex/twitchDomain.ts"
import { convexBackend } from "./convex-backend.ts"
import { botCall } from "./bot-service.ts"

const keys = [
    "NEONFLUX_SERVER_ID",
    "NEONFLUX_SERVER_MODE",
    "NEONFLUX_BOT_API_SECRET",
    "NEONFLUX_TWITCH_CLIENT_ID",
    "NEONFLUX_TWITCH_CLIENT_SECRET",
    "NEONFLUX_WEBSUB_CALLBACK_BASE",
] as const
const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]])),
    start = Date.parse("2026-10-01T00:00:00Z"),
    day = 86400000
let clock = start,
    unknown = false,
    metadataFails = false,
    requestStatus = 202,
    listFails = false,
    remote: { id: string; transport: { callback: string } }[] = []
let requests: { url: string; method: string; body?: Record<string, unknown> }[] = []
const modules = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")],
    ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    Object.assign(process.env, {
        NEONFLUX_SERVER_ID: "10",
        NEONFLUX_BOT_API_SECRET: "synthetic-twitch-service-secret-000000000000",
        NEONFLUX_TWITCH_CLIENT_ID: "synthetic-client",
        NEONFLUX_TWITCH_CLIENT_SECRET: "synthetic-secret",
        NEONFLUX_WEBSUB_CALLBACK_BASE: "https://alerts.example.test",
    })
    clock = start
    unknown = false
    metadataFails = false
    requestStatus = 202
    listFails = false
    remote = []
    requests = []
    mock.method(Date, "now", () => clock)
    mock.method(Math, "random", () => 0.5)
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input),
            method = init?.method ?? "GET"
        assert.ok(init?.signal instanceof AbortSignal)
        const body =
            typeof init?.body === "string" && init.body.startsWith("{")
                ? (JSON.parse(init.body) as Record<string, unknown>)
                : undefined
        requests.push({ url, method, ...(body ? { body } : {}) })
        if (url === "https://id.twitch.tv/oauth2/token") return Response.json({ access_token: "synthetic-app-token" })
        assert.ok(url.startsWith("https://api.twitch.tv/helix/"))
        assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer synthetic-app-token")
        if (url.includes("users?"))
            return Response.json({
                data: unknown ? [] : [{ id: "12345", login: "synthetic", display_name: "Synthetic" }],
            })
        if (url.includes("streams?"))
            return metadataFails
                ? new Response(null, { status: 503 })
                : Response.json({
                      data: [
                          {
                              id: "9001",
                              type: "live",
                              title: "@everyone Synthetic stream",
                              game_name: "Synthetic Game",
                              thumbnail_url: "https://images.example.test/{width}x{height}.jpg",
                          },
                      ],
                  })
        if (method === "DELETE") return new Response(null, { status: 204 })
        if (method === "GET" && url.includes("status=enabled"))
            return listFails ? new Response(null, { status: 503 }) : Response.json({ data: remote, pagination: {} })
        if (method === "GET") return Response.json({ data: [] })
        return Response.json({ data: [{ id: "synthetic-subscription" }] }, { status: requestStatus })
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
    const call = async (path: string, body: unknown, expected = 200) => {
        const response = await botCall(
                t,
                path,
                body,
                process.env.NEONFLUX_SERVER_MODE === "multi" ? { serverId: "10" } : {},
            ),
            result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result
    }
    const manage = (operation: unknown, expected = 200, fields: Record<string, unknown> = {}) =>
        call(
            "/twitch/manage",
            {
                serverId: "10",
                originServerId: "10",
                messageId: String(++sequence),
                createdAt: clock,
                actor,
                managerAuthorized: true,
                operation,
                ...fields,
            },
            expected,
        )
    const query = () => call("/twitch/query", { serverId: "10" }),
        work = (operation: unknown, expected = 200) => call("/twitch/work", { serverId: "10", operation }, expected)
    const settle = () => t.finishAllScheduledFunctions(() => mock.timers.tick(0))
    const source = (id = "12345") =>
        t.run((ctx) =>
            ctx.db
                .query("twitchSources")
                .withIndex("by_channel", (q) => q.eq("twitchChannelId", id))
                .unique(),
        )
    const subscription = {
        id: "synthetic-subscription",
        type: "stream.online",
        version: "1",
        status: "enabled",
        condition: { broadcaster_user_id: "12345" },
        transport: { callback: "https://alerts.example.test/eventsub/twitch?channel=12345" },
    }
    const event = {
        id: "9001",
        type: "live",
        broadcaster_user_id: "12345",
        broadcaster_user_login: "synthetic",
        broadcaster_user_name: "Synthetic",
        started_at: new Date(start + 60000).toISOString(),
    }
    const notify = async (
        type = "notification",
        payload: unknown = { subscription, event },
        options: { secret?: string | null; timestamp?: string; tamper?: boolean } = {},
    ) => {
        const body = JSON.stringify(payload),
            timestamp = options.timestamp ?? new Date(clock).toISOString(),
            messageId = "synthetic-message",
            secret = options.secret === undefined ? (await source())?.secret : options.secret
        const signature = secret
            ? `sha256=${createHmac("sha256", secret)
                  .update(messageId + timestamp + body)
                  .digest("hex")}`
            : undefined
        return t.fetch("/eventsub/twitch?channel=12345", {
            method: "POST",
            headers: {
                "Twitch-Eventsub-Message-Type": type,
                "Twitch-Eventsub-Message-Id": messageId,
                "Twitch-Eventsub-Message-Timestamp": timestamp,
                ...(signature ? { "Twitch-Eventsub-Message-Signature": signature } : {}),
            },
            body: body + (options.tamper ? " " : ""),
        })
    }
    const confirm = () => notify("webhook_callback_verification", { subscription, challenge: "synthetic-challenge" }),
        deliveries = () => t.run((ctx) => ctx.db.query("twitchDeliveries").collect())
    return { t, call, manage, query, work, settle, source, subscription, event, notify, confirm, deliveries }
}
async function subscribed() {
    const f = fixture()
    await f.manage({ type: "add", twitchChannelId: "synthetic", channelId: "50" })
    await f.settle()
    const response = await f.confirm()
    assert.equal(response.status, 200)
    assert.equal(await response.text(), "synthetic-challenge")
    clock += 60000
    return f
}
test("Login resolution creates one stable source, accepts the signed challenge and posts nothing already live", async () => {
    const f = await subscribed(),
        source = (await f.source())!
    assert.match(source.secret!, /^[a-f0-9]{64}$/)
    assert.deepEqual(
        [source.login, source.title, (await f.query()).subscriptions[0].twitchChannelId],
        ["synthetic", "Synthetic", "12345"],
    )
    assert.deepEqual(requests.find((item) => item.method === "POST" && item.body)!.body, {
        type: "stream.online",
        version: "1",
        condition: { broadcaster_user_id: "12345" },
        transport: {
            method: "webhook",
            callback: "https://alerts.example.test/eventsub/twitch?channel=12345",
            secret: source.secret,
        },
    })
    assert.equal(requests.filter((item) => item.url.includes("streams?")).length, 0)
    assert.deepEqual(await f.deliveries(), [])
    assert.equal((await f.confirm()).headers.get("content-type"), "text/plain")
    assert.ok(
        !JSON.stringify(await f.t.run((ctx) => ctx.db.query("auditLogChanges").collect())).includes(source.secret!),
    )
})
test("Wrong, missing, stale and tampered signatures and oversized bodies write nothing", async () => {
    const f = await subscribed()
    for (const options of [
        { secret: "synthetic-wrong-secret" },
        { secret: null },
        { timestamp: new Date(clock - 600001).toISOString() },
        { tamper: true },
    ])
        assert.equal((await f.notify(undefined, undefined, options)).status, 403)
    assert.equal(
        (await f.t.fetch("/eventsub/twitch?channel=12345", { method: "POST", body: "x".repeat(65537) })).status,
        413,
    )
    assert.deepEqual(await f.deliveries(), [])
    assert.equal((await f.source())!.lastNotificationAt, undefined)
})
test("Duplicate deliveries fan out once, optional metadata fails open, and renames retain broadcaster identity", async () => {
    const f = await subscribed()
    delete process.env.NEONFLUX_SERVER_ID
    process.env.NEONFLUX_SERVER_MODE = "multi"
    await f.t.run(async (ctx) => {
        for (const serverId of ["10", "11"])
            await ctx.db.insert("serverInstallations", { serverId, status: "active", joinedAt: start })
        await ctx.db.insert("twitchSubscriptions", {
            serverId: "11",
            twitchChannelId: "12345",
            channelId: "51",
            enabled: true,
            createdAt: start,
            updatedAt: start,
            updatedBy: "20",
        })
    })
    assert.equal((await f.notify()).status, 204)
    assert.equal((await f.notify()).status, 204)
    await f.settle()
    const rows = await f.deliveries()
    assert.equal(rows.length, 2)
    assert.equal(requests.filter((item) => item.url.includes("streams?")).length, 1)
    assert.ok(rows.every((row) => row.game === "Synthetic Game" && row.thumbnail?.includes("1280x720")))
    metadataFails = true
    const renamed = { ...f.event, id: "9002", broadcaster_user_login: "renamed", broadcaster_user_name: "Renamed" }
    await f.notify("notification", { subscription: f.subscription, event: renamed })
    await f.settle()
    assert.equal((await f.source())!.login, "renamed")
    assert.equal((await f.deliveries()).find((row) => row.streamId === "9002")!.game, undefined)
    await f.manage({ type: "add", twitchChannelId: "renamed", channelId: "52" })
    assert.equal((await f.query()).subscriptions.length, 1)
    await f.notify("notification", { subscription: f.subscription, event: { ...renamed, id: "9003", type: "rerun" } })
    await f.settle()
    assert.equal((await f.deliveries()).length, 4)
    const deletes = requests.filter((item) => item.method === "DELETE").length
    await f.manage({ type: "remove", twitchChannelId: "12345" })
    await f.settle()
    assert.ok(await f.source())
    assert.equal(requests.filter((item) => item.method === "DELETE").length, deletes)
})
test("Unknown logins reach status and recovery, and both credentials are required", async () => {
    const f = fixture()
    unknown = true
    await f.manage({ type: "add", twitchChannelId: "missing", channelId: "50" })
    await f.settle()
    const row = (await f.query()).subscriptions[0]
    assert.match(row.status.hubError, /does not exist/)
    assert.equal(row.status.retrying, false)
    assert.match(JSON.stringify(await f.call("/recovery/list", { serverId: "10" })), /does not exist/)
    for (const key of ["NEONFLUX_TWITCH_CLIENT_ID", "NEONFLUX_TWITCH_CLIENT_SECRET"] as const) {
        const value = process.env[key]
        delete process.env[key]
        await f.manage({ type: "add", twitchChannelId: "synthetic", channelId: "50" }, 503)
        assert.equal((await f.query()).configured, false)
        process.env[key] = value
    }
    await f.manage({ type: "remove", twitchChannelId: "missing" })
    await f.settle()
    assert.equal(await f.source("missing"), null)
    await f.manage({ type: "add", twitchChannelId: "33333", channelId: "50" })
    await f.settle()
    await f.manage({ type: "remove", twitchChannelId: "33333" })
    await f.settle()
    assert.equal(await f.source("33333"), null)
})
test("Revocations record reasons, retry delivery failures and stop for removed users and versions", async () => {
    const f = await subscribed()
    for (const reason of [
        "user_removed",
        "version_removed",
        "authorization_revoked",
        "notification_failures_exceeded",
    ]) {
        assert.equal(
            (await f.notify("revocation", { subscription: { ...f.subscription, status: reason } })).status,
            204,
        )
        const row = (await f.source())!
        assert.ok(row.lastError?.includes(reason))
        assert.equal(row.stopped, reason !== "notification_failures_exceeded")
        assert.match(JSON.stringify(await f.call("/recovery/list", { serverId: "10" })), new RegExp(reason))
    }
    const before = requests.length
    clock = (await f.source())!.dueAt
    await f.t.mutation(internal.twitchHub.leases, {})
    await f.settle()
    assert.ok(requests.slice(before).some((item) => item.method === "POST" && item.body))
})
test("The last unfollow and a purged follower delete the remote subscription", async () => {
    const f = await subscribed()
    await f.manage({ type: "remove", twitchChannelId: "12345" })
    await f.settle()
    assert.ok(requests.some((item) => item.method === "DELETE"))
    assert.equal(await f.source(), null)
    await f.manage({ type: "add", twitchChannelId: "synthetic", channelId: "50" })
    await f.settle()
    await f.confirm()
    await f.t.run(async (ctx) => {
        for (const row of await ctx.db.query("twitchSubscriptions").collect()) await ctx.db.delete(row._id)
    })
    clock += 3600000
    await f.t.mutation(internal.twitchHub.leases, {})
    await f.settle()
    assert.equal(await f.source(), null)
})
test("A subscription Twitch stopped without a revocation is found by the hourly check and made again", async () => {
    const f = fixture()
    await f.manage({ type: "add", twitchChannelId: "synthetic", channelId: "50" })
    await f.settle()
    await f.confirm()
    // Twitch still lists it, under this callback, so nothing changes
    remote = [
        {
            id: (await f.source())!.subscriptionId!,
            transport: { callback: "https://alerts.example.test/eventsub/twitch?channel=12345" },
        },
    ]
    clock += 3600000
    await f.t.action(internal.twitchHub.audit, {})
    assert.ok((await f.source())!.verifiedAt !== undefined)
    // A failed read proves nothing
    listFails = true
    await f.t.action(internal.twitchHub.audit, {})
    assert.ok((await f.source())!.verifiedAt !== undefined)
    listFails = false
    // Another deployment's subscription under the same app is not this one's
    remote = [
        {
            id: (await f.source())!.subscriptionId!,
            transport: { callback: "https://other.example.test/eventsub/twitch?channel=12345" },
        },
    ]
    clock += 3600000
    requests = []
    await f.t.action(internal.twitchHub.audit, {})
    assert.equal((await f.source())!.verifiedAt, undefined)
    assert.match((await f.source())!.lastError!, /subscribing again/)
    await f.settle()
    assert.ok(requests.some((request) => request.method === "POST" && request.url.endsWith("eventsub/subscriptions")))
})
test("No verified source makes no request to Twitch", async () => {
    const f = fixture()
    await f.t.action(internal.twitchHub.audit, {})
    assert.deepEqual(requests, [])
})
test("Adding a renamed streamer the server already follows moves its alerts", async () => {
    const f = fixture()
    await f.manage({ type: "add", twitchChannelId: "synthetic", channelId: "50" })
    await f.settle()
    await f.manage({ type: "add", twitchChannelId: "renamed", channelId: "52" })
    await f.settle()
    const rows = await f.t.run((ctx) => ctx.db.query("twitchSubscriptions").collect())
    assert.deepEqual(
        rows.map((row) => [row.twitchChannelId, row.channelId]),
        [["12345", "52"]],
    )
})
test("A streamer Twitch stopped starts again when another login adds them", async () => {
    const f = fixture()
    await f.manage({ type: "add", twitchChannelId: "synthetic", channelId: "50" })
    await f.settle()
    await f.t.run(async (ctx) => {
        const row = await ctx.db
            .query("twitchSources")
            .withIndex("by_channel", (q) => q.eq("twitchChannelId", "12345"))
            .unique()
        await ctx.db.patch(row!._id, { stopped: true })
    })
    await f.manage({ type: "add", twitchChannelId: "renamed", channelId: "52" })
    await f.settle()
    assert.equal((await f.source())!.stopped, false)
})
test("A title cut at its limit never splits an emoji", async () => {
    const { forumPostName, content } = renderTwitchAlert(
        "synthetic",
        { title: `${"a".repeat(98)}😀 more words` },
        undefined,
    )
    assert.equal(forumPostName.isWellFormed(), true)
    assert.equal(JSON.stringify(content).includes("\\ud83d"), false)
})
test("Failed requests back off and unknown publishing outcomes survive retention", async () => {
    const f = fixture()
    requestStatus = 503
    await f.manage({ type: "add", twitchChannelId: "synthetic", channelId: "50" })
    await f.settle()
    const failed = (await f.source())!
    assert.ok(failed.lastError)
    assert.equal(failed.dueAt, clock + 45000)
    clock = failed.dueAt
    requestStatus = 202
    await f.t.mutation(internal.twitchHub.leases, {})
    await f.settle()
    await f.confirm()
    clock += 60000
    await f.notify()
    await f.settle()
    const context = { originServerId: "10", observedAt: clock, channelId: "50", botId: "90", botAuthorized: true }
    const { grant } = await f.work({ type: "reserve", twitchChannelId: "12345", streamId: "9001", context })
    assert.ok(grant.content.embed.title.includes("@\u200beveryone"))
    const binding = {
        serverId: "10",
        postNo: grant.postNo,
        attemptId: grant.attemptId,
        generation: grant.generation,
        sourceId: grant.sourceId,
        claimToken: "c".repeat(32),
    }
    assert.equal((await f.call("/publishing/dispatch", { ...binding, twitchContext: context })).claimed, true)
    await f.call("/publishing/outcome", { ...binding, outcome: "uncertain" })
    clock += 31 * day
    await f.t.run((ctx) => cleanupTwitch(ctx, clock))
    assert.equal((await f.deliveries()).length, 1)
})
test("Management enforces permissions and ten follows, and queued alerts drop after a day", async () => {
    const f = await subscribed()
    await f.manage({ type: "add", twitchChannelId: "other", channelId: "50" }, 403, {
        actor: { ...actor, nativePermissionAuthorized: false },
    })
    for (let index = 0; index < 9; index++)
        await f.manage({ type: "add", twitchChannelId: `other${index}`, channelId: "50" })
    await f.manage({ type: "add", twitchChannelId: "overflow", channelId: "50" }, 429)
    await f.notify()
    await f.settle()
    clock += day
    assert.deepEqual(await f.work({ type: "list" }), { type: "deliveries", deliveries: [] })
    assert.ok((await f.deliveries()).every((row) => row.state === "skipped"))
})
test("Invalid callback origins disable adds and placeholder tests link the streamer", () => {
    assert.ok(twitchConfig())
    process.env.NEONFLUX_WEBSUB_CALLBACK_BASE = "https://alerts.example.test/path"
    assert.equal(twitchConfig(), null)
    const alert = renderTwitchAlert("synthetic", undefined, "Synthetic", true)
    assert.equal(alert.content.embed?.url, "https://www.twitch.tv/synthetic")
    assert.equal(alert.content.embed?.title, "Test alert from NeonFlux")
    assert.equal(alert.content.embed?.footer?.text, "Twitch")
})

test("Numeric logins are resolved as logins while numeric IDs from backups are looked up by ID", async () => {
    const f = fixture()
    await f.manage({ type: "add", twitchChannelId: "pending:123456", channelId: "50" })
    await f.settle()
    assert.ok(requests.some((item) => item.url.endsWith("users?login=123456")))
    assert.equal((await f.query()).subscriptions[0].twitchChannelId, "12345")
    await f.manage({ type: "remove", twitchChannelId: "12345" })
    await f.settle()
    await f.manage({ type: "add", twitchChannelId: "12345", channelId: "50" })
    await f.settle()
    assert.ok(requests.some((item) => item.url.endsWith("users?id=12345")))
})

test("A replacement challenge before the create response is accepted with the existing secret", async () => {
    const f = await subscribed(),
        secret = (await f.source())!.secret!
    await f.notify("revocation", { subscription: { ...f.subscription, status: "notification_failures_exceeded" } })
    await f.t.mutation(internal.twitchHub.deleted, { twitchChannelId: "12345", subscriptionId: f.subscription.id })
    const subscription = { ...f.subscription, id: "replacement" }
    const response = await f.notify("webhook_callback_verification", {
        subscription,
        challenge: "replacement-challenge",
    })
    assert.equal(await response.text(), "replacement-challenge")
    await f.t.mutation(internal.twitchHub.requested, {
        twitchChannelId: "12345",
        mode: "subscribe",
        stopped: false,
        subscriptionId: "replacement",
    })
    assert.deepEqual([(await f.source())!.secret, (await f.source())!.verifiedAt], [secret, clock])
})
