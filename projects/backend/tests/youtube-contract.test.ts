import assert from "node:assert/strict"
import test from "node:test"
import { adapterFixture } from "./adapter-fixture.ts"
import { createYoutubeStore, YoutubeStoreError } from "../../bot/src/youtube-store.ts"
import { createPublishingStore } from "../../bot/src/publishing-store.ts"

const modules = { "../convex/youtube.ts": () => import("../convex/youtube.ts"), "../convex/youtubeHub.ts": () => import("../convex/youtubeHub.ts") }
const UC = `UC${"a".repeat(22)}`, videoId = "synthVideo1"

test("YouTube alert adapter round trips management, a long title's alert and its publishing claim through the real HTTP boundary", async t => {
    const f = await adapterFixture(t, modules)
    process.env.NEONFLUX_WEBSUB_HUB_URL = "https://hub.synthetic.invalid/subscribe"
    process.env.NEONFLUX_WEBSUB_CALLBACK_BASE = "https://alerts.synthetic.invalid"
    const store = createYoutubeStore(f.config), publishing = createPublishingStore(f.config), run = (effect: unknown): Promise<any> => f.run(effect)
    const actor = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
    const manage = (operation: unknown) => store.manage({ ...f.source(), originServerId: "1", actor, managerAuthorized: true, operation } as never)
    assert.deepEqual((await run(manage({ type: "add", youtubeChannelId: UC, channelId: "50" }))).subscription, { youtubeChannelId: UC, channelId: "50", enabled: true, createdAt: f.now(), status: {} })

    // A notification recorded a new upload whose title is longer than a forum post's name
    const title = `@everyone ${"t".repeat(290)}`
    await f.backend.run(async ctx => {
        await ctx.db.insert("youtubeVideos", { videoId, youtubeChannelId: UC, title, publishedAt: f.now(), seenAt: f.now(), expiresAt: f.now() + 86400000 })
        await ctx.db.insert("youtubeDeliveries", { serverId: "1", youtubeChannelId: UC, videoId, title, state: "queued", nextCheckAt: f.now(), createdAt: f.now(), expiresAt: f.now() + 86400000 })
    })
    assert.equal((await run(store.query({ serverId: "1" }))).subscriptions[0].status.latestVideo.title, title)
    assert.equal((await run(store.query({ serverId: "1", sample: UC }))).sample.forumPostName.length, 100)
    assert.deepEqual(await run(store.work({ serverId: "1", operation: { type: "list" } })), { type: "deliveries", deliveries: [{ youtubeChannelId: UC, videoId, channelId: "50" }] })
    const context = { originServerId: "1", observedAt: f.now(), channelId: "50", botId: "90", botAuthorized: true as const }
    const { grant } = await run(store.work({ serverId: "1", operation: { type: "reserve", youtubeChannelId: UC, videoId, context } }))
    assert.deepEqual([grant.sourceId, grant.forumPostName.length, grant.consumer], [`youtube_${UC}_${videoId}`, 100, { type: "youtube", youtubeChannelId: UC, videoId }])
    const binding = { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, claimToken: "c".repeat(32) }
    assert.equal((await run(publishing.dispatch({ ...binding, youtubeContext: context }))).claimed, true)
    await run(publishing.outcome({ ...binding, outcome: "sent", messageId: "700" }))
    assert.equal((await run(store.query({ serverId: "1" }))).subscriptions[0].status.lastPostAt, f.now())

    assert.deepEqual(await run(store.work({ serverId: "1", operation: { type: "blocked", youtubeChannelId: UC, channelId: "50", reason: "channel" } })), { type: "progress", recorded: true })
    assert.deepEqual((await run(store.query({ serverId: "1" }))).subscriptions[0].problem, "channel")
    await f.reject(manage({ type: "remove", youtubeChannelId: `UC${"b".repeat(22)}` }), YoutubeStoreError, 404)
    await f.reject(createYoutubeStore(f.wrongConfig).query({ serverId: "1" }), YoutubeStoreError, 401)
    t.diagnostic(`${f.calls.length} real in-process HTTP calls, no real network`)
})
