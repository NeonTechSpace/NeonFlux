import { cutText } from "@neonflux/contracts/common"
import { feedProviderNames } from "@neonflux/contracts/feeds"
import { v, type Infer } from "convex/values"
import { internalAction, internalMutation } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx } from "./_generated/server.js"
import { isServed } from "./serviceGuard.ts"
import { ringWork } from "./workSignal.ts"
import { usagePaused } from "./usage.ts"
import {
    FEED_DELIVERY_RETENTION_MS,
    FEED_ERROR_FAILURES,
    FEED_ITEM_RETENTION_MS,
    FEED_TICK_BATCH,
    FEED_TICK_GAP_MS,
    FEED_WINDOW_MS,
    feedFailureWait,
    feedInterval,
    feedNewer,
    planFeedRead,
} from "./feedDomain.ts"
import { feedConnections } from "./feedProviders.ts"
import type { FeedRead, FeedResolved } from "./feedRead.ts"
import {
    countFeedSources,
    feedDelivery,
    feedItem,
    feedMonth,
    feedPollerRow,
    feedSource,
    feedSubscription,
    wakeFeedPoller,
    xReadsLeft,
} from "./feedStore.ts"
import { feedProvider } from "./feedValidators.ts"
import { xConfig, X_POLL_READS } from "./feedX.ts"

// Sources are read here, one row per account however many servers follow it. The chain exists only while sources do, so a deployment that
// follows nothing has no tick at all. Each tick schedules the next before it reads, so a failed read cannot end the chain
const HOUR = 3600000
/** Reads at once in one tick. Eight seconds per read bounds a tick well inside an action's limit */
const READS_AT_ONCE = 5,
    FAN_OUT_PAGE = 100
const stoppedSourceWait = 24 * HOUR

const spentThisMonth = (poller: Doc<"feedPoller">, now: number) =>
    poller.xMonth === feedMonth(now) ? poller.xReads : 0
const claimedSource = v.object({
    provider: feedProvider,
    accountId: v.string(),
    handle: v.optional(v.string()),
    newestSeenId: v.optional(v.string()),
    resolve: v.boolean(),
})
/** Enabled follows one claim checks for a served server. A source with more waits for the next tick, and only a served server counts as demand */
const FOLLOW_SCAN = 100
/**
 * Whether anyone would receive this source's posts. A follow that is off, or a server that removed NeonFlux and waits for its purge, would
 * not. The search goes on from where the last claim stopped, so a long list of removed servers spends no reads and still ends
 */
async function followState(ctx: MutationCtx, row: Doc<"feedSources">) {
    const { provider, accountId } = row
    let seen = 0,
        last = row.followScanAfter ?? ""
    for await (const follow of ctx.db
        .query("feedSubscriptions")
        .withIndex("by_source_enabled", (q) =>
            q.eq("provider", provider).eq("accountId", accountId).eq("enabled", true).gt("serverId", last),
        )) {
        if (await isServed(ctx, follow.serverId)) return { state: "wanted" as const }
        last = follow.serverId
        if (++seen >= FOLLOW_SCAN) return { state: "scanning" as const, after: last }
    }
    const any = await ctx.db
        .query("feedSubscriptions")
        .withIndex("by_source", (q) => q.eq("provider", provider).eq("accountId", accountId))
        .first()
    return { state: any ? ("idle" as const) : ("none" as const) }
}
const claimed = async (ctx: MutationCtx, row: Doc<"feedSources">, interval: number, now: number) => {
    await ctx.db.patch(row._id, {
        dueAt: now + interval,
        ...(row.idle ? { idle: undefined } : {}),
        ...(row.followScanAfter !== undefined ? { followScanAfter: undefined } : {}),
    })
    return {
        provider: row.provider,
        accountId: row.accountId,
        ...(row.handle ? { handle: row.handle } : {}),
        ...(row.newestSeenId ? { newestSeenId: row.newestSeenId } : {}),
        resolve: !row.resolvedAt,
    }
}
/**
 * Picks the due sources and schedules the next tick. X reads are reserved here, at the most each poll can spend, and record settles them.
 * Ticks can overlap when reads are slow, so nothing else stops two of them spending the same reads. Null means this tick was replaced
 */
export const claim = internalMutation({
    args: { generation: v.number() },
    handler: async (
        ctx,
        { generation },
    ): Promise<{ sources: Infer<typeof claimedSource>[]; reserved: number } | null> => {
        const poller = await feedPollerRow(ctx),
            now = Date.now()
        if (!poller || poller.generation !== generation) return null
        const schedule = async (at: number, changes: Partial<Doc<"feedPoller">> = {}) => {
            const scheduledId = await ctx.scheduler.runAt(at, internal.feedPolling.tick, { generation })
            await ctx.db.patch(poller._id, { lastTickAt: now, scheduledId, nextTickAt: at, ...changes })
        }
        const stop = (sourceCount: number) =>
            ctx.db.patch(poller._id, { lastTickAt: now, scheduledId: undefined, nextTickAt: undefined, sourceCount })
        const nextSource = () => ctx.db.query("feedSources").withIndex("by_due").first()
        if (!(await nextSource())) {
            await stop(0)
            return { sources: [], reserved: 0 }
        }
        // While the bill guard pauses optional work, polling waits and spends no reads
        if (await usagePaused(ctx, now)) {
            await schedule(now + HOUR)
            return { sources: [], reserved: 0 }
        }
        const due = await ctx.db
            .query("feedSources")
            .withIndex("by_due", (q) => q.lte("dueAt", now))
            .take(FEED_TICK_BATCH)
        const picked: Infer<typeof claimedSource>[] = []
        let removed = 0,
            reserved = 0
        const xLeft = xReadsLeft(poller, now)
        for (const row of due) {
            const follows = await followState(ctx, row),
                state = follows.state
            // A purged server's follows go without leaving through unfollowFeedSource
            if (state === "none") {
                await ctx.db.delete(row._id)
                removed++
            } else if (row.stopped) await ctx.db.patch(row._id, { dueAt: now + stoppedSourceWait })
            // Nobody would receive these posts, so X is not paid for them. Whoever comes back starts from a new first read and gets no backlog
            else if (state === "idle")
                await ctx.db.patch(row._id, {
                    dueAt: now + HOUR,
                    idle: true,
                    newestSeenId: undefined,
                    followScanAfter: undefined,
                })
            else if (follows.state === "scanning")
                await ctx.db.patch(row._id, { dueAt: now + FEED_TICK_GAP_MS, followScanAfter: follows.after })
            else if (row.provider === "x" && (!xConfig() || xLeft - reserved < X_POLL_READS))
                await ctx.db.patch(row._id, { dueAt: now + HOUR })
            else {
                if (row.provider === "x") reserved += X_POLL_READS
                picked.push(await claimed(ctx, row, feedInterval(row.provider, poller.sourceCount), now))
            }
        }
        const next = await nextSource(),
            sourceCount = Math.max(poller.sourceCount - removed, 0)
        if (next)
            await schedule(Math.max(next.dueAt, now + FEED_TICK_GAP_MS), {
                sourceCount,
                ...(reserved ? { xMonth: feedMonth(now), xReads: spentThisMonth(poller, now) + reserved } : {}),
            })
        else await stop(sourceCount)
        return { sources: picked, reserved }
    },
})

const readFeedItem = v.object({
    id: v.string(),
    publishedAt: v.number(),
    text: v.string(),
    url: v.string(),
    image: v.optional(v.string()),
})
const readResult = v.object({
    provider: feedProvider,
    accountId: v.string(),
    kind: v.union(
        v.literal("items"),
        v.literal("empty"),
        v.literal("unreadable"),
        v.literal("shape-change"),
        v.literal("account"),
        v.literal("missing"),
    ),
    newestSeenId: v.optional(v.string()),
    lastItemAt: v.optional(v.number()),
    post: v.optional(v.array(readFeedItem)),
    handle: v.optional(v.string()),
    name: v.optional(v.string()),
    resolvedId: v.optional(v.string()),
    status: v.optional(v.number()),
    retryAt: v.optional(v.number()),
    reads: v.optional(v.number()),
})
type ReadResult = Infer<typeof readResult>

/** One source's read in the form the mutation records. The shared rules run here, so only posts that may go out cross into the transaction */
function readOutcome(source: Infer<typeof claimedSource>, read: FeedRead, now: number): ReadResult {
    const base = { provider: source.provider, accountId: source.accountId }
    if (read.kind === "unreadable")
        return {
            ...base,
            kind: "unreadable",
            ...(read.status !== undefined ? { status: read.status } : {}),
            ...(read.retryAt !== undefined ? { retryAt: read.retryAt } : {}),
        }
    if (read.kind === "shape-change")
        return { ...base, kind: "shape-change", ...(read.reads ? { reads: read.reads } : {}) }
    if (read.kind === "empty") return { ...base, kind: "empty", ...(read.reads ? { reads: read.reads } : {}) }
    const plan = planFeedRead(source.newestSeenId, read.items, now),
        posted = read.items.filter((item) => item.posted)
    return {
        ...base,
        kind: "items",
        ...(plan.newestSeenId ? { newestSeenId: plan.newestSeenId } : {}),
        ...(posted.length ? { lastItemAt: Math.max(...posted.map((item) => item.publishedAt)) } : {}),
        post: plan.post.map(({ id, publishedAt, text, url, image }) => ({
            id,
            publishedAt,
            text: cutText(text, 2000),
            url,
            ...(image ? { image } : {}),
        })),
        ...(read.author?.handle ? { handle: read.author.handle.toLowerCase() } : {}),
        ...(read.author?.name ? { name: cutText(read.author.name, 256) } : {}),
        ...(read.reads ? { reads: read.reads } : {}),
    }
}
function resolveOutcome(source: Infer<typeof claimedSource>, found: FeedResolved): ReadResult {
    const base = { provider: source.provider, accountId: source.accountId }
    if (found.kind === "account")
        return {
            ...base,
            kind: "account",
            resolvedId: found.accountId,
            handle: found.handle.toLowerCase(),
            ...(found.name ? { name: cutText(found.name, 256) } : {}),
            ...(found.reads ? { reads: found.reads } : {}),
        }
    if (found.kind === "unreadable") return readOutcome(source, found, 0)
    return { ...base, kind: found.kind }
}
export const tick = internalAction({
    args: { generation: v.number() },
    handler: async (ctx, { generation }) => {
        const claim = await ctx.runMutation(internal.feedPolling.claim, { generation })
        if (!claim?.sources.length) return
        const { sources, reserved } = claim
        // A rate limit holds for every read of that provider, so the rest of this tick waits with it
        const limited = new Map<string, number>(),
            results: ReadResult[] = []
        const readOne = async (source: Infer<typeof claimedSource>): Promise<ReadResult> => {
            const connection = feedConnections[source.provider],
                wait = limited.get(source.provider),
                now = Date.now()
            if (wait !== undefined) return readOutcome(source, { kind: "unreadable", status: 429, retryAt: wait }, now)
            const result = source.resolve
                ? resolveOutcome(source, await connection.resolve(source.accountId))
                : readOutcome(source, await connection.read(source), now)
            if (result.status === 429) limited.set(source.provider, result.retryAt ?? now + FEED_TICK_GAP_MS)
            return result
        }
        for (let start = 0; start < sources.length; start += READS_AT_ONCE)
            results.push(...(await Promise.all(sources.slice(start, start + READS_AT_ONCE).map(readOne))))
        await ctx.runMutation(internal.feedPolling.record, { results, reserved })
    },
})

const failureText = (result: ReadResult) => {
    const service = feedProviderNames[result.provider]
    if (result.kind === "shape-change")
        return `${service} changed the form of its answers, so NeonFlux cannot read this account`
    if (result.provider === "x" && (result.status === 401 || result.status === 403))
        return "X turned down this NeonFlux's key"
    return result.status === 429 ? `${service} asks NeonFlux to wait` : `${service} could not be read`
}
/** A failed read waits longer each time, and at least as long as the service asked. A read problem shows once it repeats. A shape change shows at once */
async function recordFailure(
    ctx: MutationCtx,
    row: Doc<"feedSources">,
    result: ReadResult,
    interval: number,
    now: number,
) {
    const failures = row.failures + 1,
        shape = result.kind === "shape-change"
    if (shape) console.warn(`A ${feedProviderNames[row.provider]} answer no longer has the expected shape`)
    await ctx.db.patch(row._id, {
        failures,
        dueAt: Math.max(now + feedFailureWait(interval, failures), result.retryAt ?? 0),
        ...(shape || failures >= FEED_ERROR_FAILURES ? { lastError: failureText(result), shapeChange: shape } : {}),
    })
}
export const record = internalMutation({
    args: { results: v.array(readResult), reserved: v.number() },
    handler: async (ctx, { results, reserved }) => {
        const now = Date.now(),
            poller = await feedPollerRow(ctx)
        let reads = 0
        for (const result of results) {
            reads += result.reads ?? 0
            const row = await feedSource(ctx, result.provider, result.accountId)
            if (!row) continue
            const interval = feedInterval(row.provider, poller?.sourceCount ?? 1)
            if (result.kind === "unreadable" || result.kind === "shape-change") {
                await recordFailure(ctx, row, result, interval, now)
                continue
            }
            if (result.kind === "missing") {
                await ctx.db.patch(row._id, {
                    stopped: true,
                    lastError: `${feedProviderNames[row.provider]} has no such account. Remove it and add a current handle`,
                })
                continue
            }
            if (result.kind === "account") {
                await ctx.scheduler.runAfter(0, internal.feedPolling.resolved, {
                    provider: result.provider,
                    pending: result.accountId,
                    accountId: result.resolvedId!,
                    handle: result.handle!,
                    ...(result.name ? { name: result.name } : {}),
                })
                continue
            }
            // An empty read says nothing about news, and shows only that a read failure is over. It moves no newest ID and clears no shape change
            if (result.kind === "empty") {
                await ctx.db.patch(row._id, {
                    lastReadAt: now,
                    failures: 0,
                    ...(row.shapeChange ? {} : { lastError: undefined }),
                })
                continue
            }
            await ctx.db.patch(row._id, {
                lastReadAt: now,
                failures: 0,
                lastError: undefined,
                shapeChange: undefined,
                // A newer newest only: A read that raced this one, or a deleted post, never moves it back
                ...(result.newestSeenId &&
                (row.newestSeenId === undefined || feedNewer(result.newestSeenId, row.newestSeenId))
                    ? { newestSeenId: result.newestSeenId }
                    : {}),
                ...(result.lastItemAt !== undefined && result.lastItemAt > (row.lastItemAt ?? 0)
                    ? { lastItemAt: result.lastItemAt }
                    : {}),
                ...(result.handle ? { handle: result.handle } : {}),
                ...(result.name ? { name: result.name } : {}),
            })
            for (const item of result.post ?? []) {
                if (row.newestSeenId !== undefined && !feedNewer(item.id, row.newestSeenId)) continue
                if (await feedItem(ctx, row.provider, row.accountId, item.id)) continue
                await ctx.db.insert("feedItems", {
                    provider: row.provider,
                    accountId: row.accountId,
                    itemId: item.id,
                    publishedAt: item.publishedAt,
                    text: item.text,
                    url: item.url,
                    ...(item.image ? { image: item.image } : {}),
                    seenAt: now,
                    expiresAt: now + FEED_ITEM_RETENTION_MS,
                })
                await ctx.scheduler.runAfter(0, internal.feedPolling.fanOut, {
                    provider: row.provider,
                    accountId: row.accountId,
                    itemId: item.id,
                    afterServerId: "",
                })
            }
        }
        if (poller && (reads || reserved))
            await ctx.db.patch(poller._id, {
                xMonth: feedMonth(now),
                xReads: Math.max(spentThisMonth(poller, now) + reads - reserved, 0),
            })
    },
})
/** A looked-up account: A new source is the same row under its stable ID, and a source another server already follows keeps its newest ID */
export const resolved = internalMutation({
    args: {
        provider: feedProvider,
        pending: v.string(),
        accountId: v.string(),
        handle: v.string(),
        name: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { provider, pending, accountId, handle, name } = args,
            row = await feedSource(ctx, provider, pending),
            now = Date.now()
        if (!row) return
        const details = { handle, ...(name ? { name } : {}), resolvedAt: now, failures: 0 }
        if (pending === accountId) {
            await ctx.db.patch(row._id, { ...details, lastError: undefined, dueAt: now })
            await wakeFeedPoller(ctx, now)
            return
        }
        const target = await feedSource(ctx, provider, accountId)
        if (target)
            await ctx.db.patch(target._id, {
                ...details,
                lastError: undefined,
                ...(target.idle ? { idle: undefined, dueAt: now } : {}),
            })
        else {
            await ctx.db.insert("feedSources", {
                provider,
                accountId,
                ...details,
                dueAt: now,
                createdAt: row.createdAt,
            })
            await countFeedSources(ctx, 1)
        }
        const page = await ctx.db
            .query("feedSubscriptions")
            .withIndex("by_source", (q) => q.eq("provider", provider).eq("accountId", pending))
            .take(FAN_OUT_PAGE)
        for (const follow of page) {
            const exists = await feedSubscription(ctx, follow.serverId, provider, accountId)
            if (!exists) await ctx.db.patch(follow._id, { accountId })
            else {
                // An account the server already follows under its old handle: This add is the newer one, so its destination wins
                await ctx.db.patch(exists._id, {
                    channelId: follow.channelId,
                    enabled: follow.enabled,
                    problem: follow.problem,
                })
                await ctx.db.delete(follow._id)
            }
        }
        if (page.length === FAN_OUT_PAGE) await ctx.scheduler.runAfter(0, internal.feedPolling.resolved, args)
        else {
            await ctx.db.delete(row._id)
            await countFeedSources(ctx, -1)
            await wakeFeedPoller(ctx, now)
        }
    },
})
/** One post to every server following its source, a page at a time. A server gets only posts newer than its own follow */
export const fanOut = internalMutation({
    args: { provider: feedProvider, accountId: v.string(), itemId: v.string(), afterServerId: v.string() },
    handler: async (ctx, args) => {
        const item = await feedItem(ctx, args.provider, args.accountId, args.itemId)
        if (!item) return
        const now = Date.now(),
            page = await ctx.db
                .query("feedSubscriptions")
                .withIndex("by_source", (q) =>
                    q.eq("provider", args.provider).eq("accountId", args.accountId).gt("serverId", args.afterServerId),
                )
                .take(FAN_OUT_PAGE)
        let created = 0
        for (const row of page) {
            if (
                !row.enabled ||
                row.createdAt > item.publishedAt ||
                now - item.publishedAt >= FEED_WINDOW_MS ||
                !(await isServed(ctx, row.serverId)) ||
                (await feedDelivery(ctx, row.serverId, args.provider, args.accountId, args.itemId))
            )
                continue
            await ctx.db.insert("feedDeliveries", {
                serverId: row.serverId,
                provider: args.provider,
                accountId: args.accountId,
                itemId: args.itemId,
                title: cutText(item.text.replace(/\s+/g, " ").trim(), 100) || feedProviderNames[args.provider],
                publishedAt: item.publishedAt,
                state: "queued",
                // The publication time orders a burst oldest first in every list of due posts
                nextCheckAt: Math.min(now, item.publishedAt),
                createdAt: now,
                expiresAt: now + FEED_DELIVERY_RETENTION_MS,
            })
            created++
        }
        if (created) await ringWork(ctx)
        if (page.length === FAN_OUT_PAGE)
            await ctx.scheduler.runAfter(0, internal.feedPolling.fanOut, {
                ...args,
                afterServerId: page.at(-1)!.serverId,
            })
    },
})
