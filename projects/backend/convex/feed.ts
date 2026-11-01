import { v } from "convex/values"
import type { MutationCtx } from "./_generated/server.js"
import type { PublishingFeedConsumer } from "@neonflux/contracts/publishing-base"
import {
    FEED_WORK_BATCH,
    feedPendingHandle,
    feedProviderNames,
    feedSourceId,
    FeedManageRequest,
    FeedQueryRequest,
    FeedWorkRequest,
    type FeedManageResult,
    type FeedOperation,
    type FeedQueryResult,
    type FeedWorkResult,
} from "@neonflux/contracts/feeds"
import { changeConfiguration } from "./configurationChange.ts"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import { actor } from "./moderationDomain.ts"
import { reservePublishing } from "./publishing.ts"
import { decode, fail, source, type ConfigurationIdentity } from "./validation.ts"
import {
    FEED_LIMIT,
    FEED_RETRY_MS,
    FEED_WINDOW_MS,
    feedAuthorName,
    feedDeliveryContext,
    feedProfileUrl,
    renderFeedPost,
} from "./feedDomain.ts"
import {
    feedAutomation,
    feedDelivery,
    feedItem,
    feedSource,
    feedSourceByHandle,
    feedSubscription,
    feedSubscriptions,
    feedView,
    followFeedSource,
    publicFeedSubscription,
    unfollowFeedSource,
} from "./feedStore.ts"
import { xConfig } from "./feedX.ts"

/** A queued post needs its follow on, and that follow from before the post: Removing and following again while publishing is off must not bring old posts back */
const feedPostStillWanted = (
    follow: { enabled: boolean; createdAt: number },
    delivery: { publishedAt: number },
    now: number,
) => follow.enabled && follow.createdAt <= delivery.publishedAt && now - delivery.publishedAt < FEED_WINDOW_MS

// Chat changes. The bot vouches for a server manager's fresh native authority, like sticky messages
export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<FeedManageResult> => {
        const input = decode(FeedManageRequest, request)
        const identity = source(input, Date.now()),
            who = actor(input.actor),
            op = input.operation
        if (!who.nativePermissionAuthorized) fail(403, "Manage community permission required")
        return changeConfiguration(
            ctx,
            identity.serverId,
            "feeds",
            {
                kind: "chat",
                createdAt: identity.createdAt,
                actor: { userId: who.userId, source: "command" },
                operation: op,
            },
            () =>
                applyFeedManagement(
                    ctx,
                    {
                        serverId: identity.serverId,
                        actorId: who.userId,
                        createdAt: identity.createdAt,
                        source: { kind: "chat", messageId: identity.messageId },
                    },
                    op,
                ),
        )
    },
})

// Chat and dashboard share these rules. Adding an account posts nothing it published before: Only later posts go out
export async function applyFeedManagement(
    ctx: MutationCtx,
    identity: ConfigurationIdentity,
    op: FeedOperation,
): Promise<FeedManageResult> {
    const { serverId } = identity,
        { provider } = op,
        handle = feedPendingHandle(op.accountId),
        known = handle ? await feedSourceByHandle(ctx, provider, handle) : null,
        // A handle another server already looked up names its stable account
        accountId = known?.accountId ?? op.accountId,
        row = await feedSubscription(ctx, serverId, provider, accountId),
        now = Date.now()
    if (op.type === "remove") {
        if (!row) fail(404, "This server does not follow that account")
        const subscription = await publicFeedSubscription(ctx, row)
        await ctx.db.delete(row._id)
        await unfollowFeedSource(ctx, provider, accountId)
        return { type: "removed", subscription }
    }
    if (provider === "x" && !xConfig()) fail(503, "X feeds are not configured")
    if (row)
        await ctx.db.patch(row._id, {
            channelId: op.channelId,
            enabled: true,
            problem: undefined,
            updatedAt: now,
            updatedBy: identity.actorId,
        })
    else {
        if ((await feedSubscriptions(ctx, serverId)).length >= FEED_LIMIT)
            fail(429, `A server can follow at most ${FEED_LIMIT} accounts`)
        await ctx.db.insert("feedSubscriptions", {
            serverId,
            provider,
            accountId,
            channelId: op.channelId,
            enabled: true,
            createdAt: now,
            updatedAt: now,
            updatedBy: identity.actorId,
        })
    }
    await followFeedSource(ctx, provider, accountId, now)
    return {
        type: "added",
        subscription: await publicFeedSubscription(ctx, (await feedSubscription(ctx, serverId, provider, accountId))!),
    }
}

// What !feed status shows. sample also builds a test post of one followed account, labelled as a test
export const query = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<FeedQueryResult> => {
        const { serverId, sample } = decode(FeedQueryRequest, request),
            view = await feedView(ctx, serverId)
        if (sample === undefined) return view
        const row = await feedSubscription(ctx, serverId, sample.provider, sample.accountId)
        if (!row) fail(404, "This server does not follow that account")
        // A test uses only the latest post NeonFlux already holds, or a placeholder, and reads nothing from the service
        const account = await feedSource(ctx, row.provider, row.accountId),
            latest = await ctx.db
                .query("feedItems")
                .withIndex("by_account", (q) => q.eq("provider", row.provider).eq("accountId", row.accountId))
                .order("desc")
                .first()
        return {
            ...view,
            sample: {
                channelId: row.channelId,
                ...renderFeedPost(
                    row.provider,
                    feedAuthorName(account, feedProviderNames[row.provider]),
                    feedProfileUrl(row.provider, row.accountId, account?.handle),
                    latest ?? undefined,
                    true,
                ),
            },
        }
    },
})

// The bot's post worker: Due posts, their reservation for the publisher, a wait after a failed read and a follow NeonFlux turns off
export const work = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<FeedWorkResult> => {
        const { serverId, operation: op } = decode(FeedWorkRequest, request)
        const now = Date.now()
        if (op.type === "list") {
            if (!(await feedAutomation(ctx, serverId))) return { type: "deliveries", deliveries: [] }
            const due = await ctx.db
                .query("feedDeliveries")
                .withIndex("by_server_due", (q) =>
                    q.eq("serverId", serverId).eq("state", "queued").lte("nextCheckAt", now),
                )
                .take(FEED_WORK_BATCH)
            const deliveries = []
            for (const row of due) {
                const subscription = await feedSubscription(ctx, serverId, row.provider, row.accountId)
                if (!subscription || !feedPostStillWanted(subscription, row, now))
                    await ctx.db.patch(row._id, { state: "skipped" })
                else
                    deliveries.push({
                        provider: row.provider,
                        accountId: row.accountId,
                        itemId: row.itemId,
                        channelId: subscription.channelId,
                    })
            }
            return { type: "deliveries", deliveries }
        }
        if (op.type === "blocked") {
            const row = await feedSubscription(ctx, serverId, op.provider, op.accountId)
            // A report about a destination that changed since the bot read it changes nothing
            if (!row?.enabled || row.channelId !== op.channelId) return { type: "progress", recorded: false }
            await ctx.db.patch(row._id, { enabled: false, problem: op.reason, updatedAt: now })
            const account = await feedSource(ctx, row.provider, row.accountId),
                name = account?.handle ?? account?.name
            return { type: "progress", recorded: true, ...(name ? { name } : {}) }
        }
        const row = await feedDelivery(ctx, serverId, op.provider, op.accountId, op.itemId)
        if (!row) fail(404, "Feed post not found")
        if (op.type === "defer") {
            if (row.state !== "queued") return { type: "progress", recorded: false }
            await ctx.db.patch(row._id, { nextCheckAt: now + FEED_RETRY_MS })
            return { type: "progress", recorded: true }
        }
        const context = feedDeliveryContext(op.context, now)
        if (row.state !== "queued") fail(409, "Feed post already handled")
        if (!(await feedAutomation(ctx, serverId))) fail(403, "Feed posts paused")
        const subscription = await feedSubscription(ctx, serverId, row.provider, row.accountId),
            item = await feedItem(ctx, row.provider, row.accountId, row.itemId)
        if (!subscription || !item || !feedPostStillWanted(subscription, row, now)) {
            await ctx.db.patch(row._id, { state: "skipped" })
            return { type: "skipped" }
        }
        if (context.channelId !== subscription.channelId) fail(409, "Feed post destination changed")
        const account = await feedSource(ctx, row.provider, row.accountId),
            post = renderFeedPost(
                row.provider,
                feedAuthorName(account, feedProviderNames[row.provider]),
                feedProfileUrl(row.provider, row.accountId, account?.handle),
                item,
            )
        const consumer: PublishingFeedConsumer = {
            type: "feed",
            provider: row.provider,
            accountId: row.accountId,
            itemId: row.itemId,
        }
        const reserved = await reservePublishing(ctx, {
            serverId,
            actorId: context.botId,
            botId: context.botId,
            channelId: subscription.channelId,
            sourceId: feedSourceId(row.provider, row.accountId, row.itemId),
            source: consumer,
            provenance: consumer,
            consumer,
            content: post.content,
            // In a forum the post becomes the first message of its own forum post
            forumPostName: post.forumPostName,
        })
        await ctx.db.patch(row._id, {
            state: "reserved",
            postNo: reserved.post.postNo,
            attemptId: ctx.db.normalizeId("publishingAttempts", reserved.grant.attemptId)!,
        })
        return { type: "reserved", grant: reserved.grant }
    },
})
