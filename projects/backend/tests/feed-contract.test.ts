import assert from "node:assert/strict"
import test from "node:test"
import { adapterFixture } from "./adapter-fixture.ts"
import { createFeedStore, FeedStoreError } from "../../bot/src/feed-store.ts"
import { createPublishingStore } from "../../bot/src/publishing-store.ts"
import { feedSourceId } from "@neonflux/contracts/publishing-base"

const modules = {
    "../convex/feed.ts": () => import("../convex/feed.ts"),
    "../convex/feedPolling.ts": () => import("../convex/feedPolling.ts"),
}
const DID = "did:plc:syntheticaaaaaaaaaaaaaaa",
    itemId = "3mz46jsw4ic2h"

test("The feed adapter round trips management, a long post and its publishing claim through the real HTTP boundary", async (t) => {
    const f = await adapterFixture(t, modules)
    const store = createFeedStore(f.config),
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
        (await run(manage({ type: "add", provider: "bluesky", accountId: DID, channelId: "50" }))).subscription,
        { provider: "bluesky", accountId: DID, channelId: "50", enabled: true, createdAt: f.now(), status: {} },
    )

    // A read found a new post whose text is longer than a forum post's name
    await f.backend.run(async (ctx) => {
        await ctx.db.insert("feedItems", {
            provider: "bluesky",
            accountId: DID,
            itemId,
            publishedAt: f.now(),
            text: `@everyone ${"t".repeat(290)}`,
            url: `https://bsky.app/profile/${DID}/post/${itemId}`,
            image: "https://cdn.bsky.app/img/feed_fullsize/plain/synthetic",
            seenAt: f.now(),
            expiresAt: f.now() + 86400000,
        })
        await ctx.db.insert("feedDeliveries", {
            serverId: "1",
            provider: "bluesky",
            accountId: DID,
            itemId,
            title: "A synthetic post",
            publishedAt: f.now(),
            state: "queued",
            nextCheckAt: f.now(),
            createdAt: f.now(),
            expiresAt: f.now() + 86400000,
        })
    })
    assert.deepEqual((await run(store.work({ serverId: "1", operation: { type: "list" } }))).deliveries, [
        { provider: "bluesky", accountId: DID, itemId, channelId: "50" },
    ])
    const context = {
        originServerId: "1",
        observedAt: f.now(),
        channelId: "50",
        botId: "99",
        botAuthorized: true as const,
    }
    const { grant } = await run(
        store.work({
            serverId: "1",
            operation: { type: "reserve", provider: "bluesky", accountId: DID, itemId, context },
        }),
    )
    assert.deepEqual(
        [grant.sourceId, grant.forumPostName.length <= 100, grant.consumer],
        [feedSourceId("bluesky", DID, itemId), true, { type: "feed", provider: "bluesky", accountId: DID, itemId }],
    )
    const binding = {
        serverId: "1",
        postNo: grant.postNo,
        attemptId: grant.attemptId,
        generation: grant.generation,
        sourceId: grant.sourceId,
        claimToken: "c".repeat(32),
    }
    assert.equal((await run(publishing.dispatch({ ...binding, feedContext: context }))).claimed, true)
    await run(publishing.outcome({ ...binding, outcome: "sent", messageId: "700" }))
    assert.equal((await run(store.query({ serverId: "1" }))).subscriptions[0].status.lastPostAt, f.now())

    assert.deepEqual(
        await run(
            store.work({
                serverId: "1",
                operation: { type: "blocked", provider: "bluesky", accountId: DID, channelId: "50", reason: "channel" },
            }),
        ),
        { type: "progress", recorded: true },
    )
    assert.deepEqual((await run(store.query({ serverId: "1" }))).subscriptions[0].problem, "channel")
    await f.reject(
        manage({ type: "remove", provider: "bluesky", accountId: "did:plc:syntheticbbbbbbbbbbbbbbb" }),
        FeedStoreError,
        404,
    )
    await f.reject(createFeedStore(f.wrongConfig).query({ serverId: "1" }), FeedStoreError, 401)
    t.diagnostic(`${f.calls.length} real in-process HTTP calls, no real network`)
})
test("An outcome the bot never learned stays uncertain and is not offered again", async (t) => {
    const f = await adapterFixture(t, modules)
    const store = createFeedStore(f.config),
        publishing = createPublishingStore(f.config),
        run = (effect: unknown): Promise<any> => f.run(effect)
    await f.backend.run(async (ctx) => {
        await ctx.db.insert("feedSubscriptions", {
            serverId: "1",
            provider: "x",
            accountId: "1000000000000000001",
            channelId: "50",
            enabled: true,
            createdAt: f.now() - 1000,
            updatedAt: f.now(),
            updatedBy: "10",
        })
        await ctx.db.insert("feedItems", {
            provider: "x",
            accountId: "1000000000000000001",
            itemId: "1850000000000000001",
            publishedAt: f.now(),
            text: "A synthetic post",
            url: "https://x.com/synthetic/status/1850000000000000001",
            seenAt: f.now(),
            expiresAt: f.now() + 86400000,
        })
        await ctx.db.insert("feedDeliveries", {
            serverId: "1",
            provider: "x",
            accountId: "1000000000000000001",
            itemId: "1850000000000000001",
            title: "A synthetic post",
            publishedAt: f.now(),
            state: "queued",
            nextCheckAt: f.now(),
            createdAt: f.now(),
            expiresAt: f.now() + 86400000,
        })
    })
    const context = {
        originServerId: "1",
        observedAt: f.now(),
        channelId: "50",
        botId: "99",
        botAuthorized: true as const,
    }
    const { grant } = await run(
        store.work({
            serverId: "1",
            operation: {
                type: "reserve",
                provider: "x",
                accountId: "1000000000000000001",
                itemId: "1850000000000000001",
                context,
            },
        }),
    )
    const binding = {
        serverId: "1",
        postNo: grant.postNo,
        attemptId: grant.attemptId,
        generation: grant.generation,
        sourceId: grant.sourceId,
        claimToken: "c".repeat(32),
    }
    assert.equal((await run(publishing.dispatch({ ...binding, feedContext: context }))).claimed, true)
    await run(publishing.outcome({ ...binding, outcome: "uncertain" }))
    assert.deepEqual((await run(store.work({ serverId: "1", operation: { type: "list" } }))).deliveries, [])
    const rows = await f.backend.run((ctx) => ctx.db.query("feedDeliveries").collect())
    assert.equal(rows[0]?.state, "uncertain")
})
