import assert from "node:assert/strict"
import test from "node:test"
import { adapterFixture } from "./adapter-fixture.ts"
import { createTwitchStore, TwitchStoreError } from "../../bot/src/twitch-store.ts"
import { createPublishingStore } from "../../bot/src/publishing-store.ts"

const modules = {
    "../convex/twitch.ts": () => import("../convex/twitch.ts"),
    "../convex/twitchHub.ts": () => import("../convex/twitchHub.ts"),
}
const BROADCASTER_ID = "12345",
    streamId = "123456"

test("Twitch alert adapter round trips management, a long title's alert and its publishing claim through the real HTTP boundary", async (t) => {
    const f = await adapterFixture(t, modules)
    process.env.NEONFLUX_TWITCH_CLIENT_ID = "synthetic-client-id"
    process.env.NEONFLUX_TWITCH_CLIENT_SECRET = "synthetic-client-secret"
    process.env.NEONFLUX_WEBSUB_CALLBACK_BASE = "https://alerts.synthetic.invalid"
    const store = createTwitchStore(f.config),
        publishing = createPublishingStore(f.config),
        run = (effect: unknown): Promise<any> => f.run(effect)
    const actor = {
        originServerId: "1",
        userId: "10",
        roleIds: [],
        isOwner: true,
        isAdministrator: false,
        nativePermissionAuthorized: true,
    }
    const manage = (operation: unknown) =>
        store.manage({ ...f.source(), originServerId: "1", actor, managerAuthorized: true, operation } as never)
    assert.deepEqual(
        (await run(manage({ type: "add", twitchChannelId: BROADCASTER_ID, channelId: "50" }))).subscription,
        {
            twitchChannelId: BROADCASTER_ID,
            channelId: "50",
            enabled: true,
            createdAt: f.now(),
            status: { connected: false, retrying: true },
        },
    )

    // A notification recorded a new stream whose title is longer than a forum post's name
    const title = `@everyone ${"t".repeat(290)}`
    await f.backend.run(async (ctx) => {
        await ctx.db.insert("twitchStreams", {
            streamId,
            twitchChannelId: BROADCASTER_ID,
            title,
            publishedAt: f.now(),
            seenAt: f.now(),
            expiresAt: f.now() + 86400000,
        })
        await ctx.db.insert("twitchDeliveries", {
            serverId: "1",
            twitchChannelId: BROADCASTER_ID,
            streamId,
            title,
            state: "queued",
            nextCheckAt: f.now(),
            createdAt: f.now(),
            expiresAt: f.now() + 86400000,
        })
    })
    assert.equal((await run(store.query({ serverId: "1" }))).subscriptions[0].status.latestStream.title, title)
    assert.equal((await run(store.query({ serverId: "1", sample: BROADCASTER_ID }))).sample.forumPostName.length, 100)
    assert.deepEqual(await run(store.work({ serverId: "1", operation: { type: "list" } })), {
        type: "deliveries",
        deliveries: [{ twitchChannelId: BROADCASTER_ID, streamId, channelId: "50" }],
    })
    const context = {
        originServerId: "1",
        observedAt: f.now(),
        channelId: "50",
        botId: "90",
        botAuthorized: true as const,
    }
    const { grant } = await run(
        store.work({
            serverId: "1",
            operation: { type: "reserve", twitchChannelId: BROADCASTER_ID, streamId, context },
        }),
    )
    assert.deepEqual(
        [grant.sourceId, grant.forumPostName.length, grant.consumer],
        [`twitch_${BROADCASTER_ID}_${streamId}`, 100, { type: "twitch", twitchChannelId: BROADCASTER_ID, streamId }],
    )
    const binding = {
        serverId: "1",
        postNo: grant.postNo,
        attemptId: grant.attemptId,
        generation: grant.generation,
        sourceId: grant.sourceId,
        claimToken: "c".repeat(32),
    }
    assert.equal((await run(publishing.dispatch({ ...binding, twitchContext: context }))).claimed, true)
    await run(publishing.outcome({ ...binding, outcome: "sent", messageId: "700" }))
    assert.equal((await run(store.query({ serverId: "1" }))).subscriptions[0].status.lastPostAt, f.now())

    assert.deepEqual(
        await run(
            store.work({
                serverId: "1",
                operation: { type: "blocked", twitchChannelId: BROADCASTER_ID, channelId: "50", reason: "channel" },
            }),
        ),
        { type: "progress", recorded: true },
    )
    assert.deepEqual((await run(store.query({ serverId: "1" }))).subscriptions[0].problem, "channel")
    await f.reject(manage({ type: "remove", twitchChannelId: "54321" }), TwitchStoreError, 404)
    await f.reject(createTwitchStore(f.wrongConfig).query({ serverId: "1" }), TwitchStoreError, 401)
    t.diagnostic(`${f.calls.length} real in-process HTTP calls, no real network`)
})
