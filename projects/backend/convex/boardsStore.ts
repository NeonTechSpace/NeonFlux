import type { BoardView, Board } from "@neonflux/contracts/boards"
import { BOARD_ENTRY_LIMIT, BOARD_LIMIT } from "@neonflux/contracts/boards"
import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel.js"
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import { defconHoldsAutomation, publisherSettings } from "./schedulesStore.ts"
import { boardDeliveryContext, BOARD_ENTRY_RETENTION_MS, BOARD_REMOVE_MS, BOARD_RETRY_MS } from "./boardsDomain.ts"
import { fail } from "./validation.ts"
import { ringWork } from "./workSignal.ts"

type Read = QueryCtx | MutationCtx
export const readBoards = (ctx: Read, serverId: string) =>
    ctx.db
        .query("boards")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .take(BOARD_LIMIT)
export const readBoard = (ctx: Read, serverId: string, name: string) =>
    ctx.db
        .query("boards")
        .withIndex("by_server", (q) => q.eq("serverId", serverId).eq("name", name))
        .unique()
export const readBoardSettings = (ctx: Read, serverId: string) =>
    ctx.db
        .query("boardSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
export const boardEntry = (ctx: Read, serverId: string, messageId: string, boardId: Id<"boards">) =>
    ctx.db
        .query("boardEntries")
        .withIndex("by_message", (q) =>
            q.eq("serverId", serverId).eq("sourceMessageId", messageId).eq("boardId", boardId),
        )
        .unique()
export const publicBoard = (row: Doc<"boards">): Board => ({
    name: row.name,
    emoji: row.emoji,
    channelId: row.channelId,
    threshold: row.threshold,
    selfReactions: row.selfReactions,
    bots: row.bots,
    ignoredChannelIds: row.ignoredChannelIds,
    ...(row.problem ? { problem: row.problem } : {}),
    posted: row.posted,
    createdAt: row.createdAt,
})
export async function boardView(ctx: Read, serverId: string): Promise<BoardView> {
    return {
        enabled: (await readBoardSettings(ctx, serverId))?.enabled ?? true,
        boards: (await readBoards(ctx, serverId)).map(publicBoard),
    }
}
/** Reposts and count updates go out while publishing is on and the server is at DEFCON 3 */
export async function boardAutomation(ctx: Read, serverId: string) {
    return (await publisherSettings(ctx, serverId))?.enabled !== false && !(await defconHoldsAutomation(ctx, serverId))
}
const publishingPost = (ctx: Read, serverId: string, postNo: number) =>
    ctx.db
        .query("publishingPosts")
        .withIndex("by_server_post", (q) => q.eq("serverId", serverId).eq("postNo", postNo))
        .unique()
/** Whether a record's latest attempt is still pending or unknown, which keeps its tracked post */
export async function boardEntryUnsettled(ctx: Read, row: Doc<"boardEntries">) {
    const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
    return !!attempt && (attempt.outcome === "pending" || attempt.unresolved)
}
/** Removes a record's tracked post and every settled attempt, which hold the card's text as posted */
async function releaseBoardPost(ctx: MutationCtx, row: Doc<"boardEntries">) {
    if (row.postNo === undefined) return
    const post = await publishingPost(ctx, row.serverId, row.postNo)
    if (post) await ctx.db.delete(post._id)
    const attempts = await ctx.db
        .query("publishingAttempts")
        .withIndex("by_server_post", (q) => q.eq("serverId", row.serverId).eq("postNo", row.postNo!))
        .take(256)
    for (const attempt of attempts)
        if (attempt.outcome !== "pending" && !attempt.unresolved) await ctx.db.delete(attempt._id)
}
async function countPosted(ctx: MutationCtx, boardId: Id<"boards">, change: number) {
    const board = await ctx.db.get(boardId)
    if (board) await ctx.db.patch(board._id, { posted: Math.max(board.posted + change, 0) })
    return board
}
/**
 * Asks for a record's post to be deleted, because its source is gone, its readers changed or its author asked. The tracked post and its text
 * go now, and the record keeps only where the post is. A record without a known post simply ends. A record whose outcome is unknown keeps
 * the request, since there may be a post NeonFlux cannot name yet, and it runs once staff settle the outcome. Answers whether it ran now
 */
export async function queueBoardRemoval(ctx: MutationCtx, row: Doc<"boardEntries">, now: number) {
    if (row.state === "remove" || row.state === "removing") return true
    if (await boardEntryUnsettled(ctx, row)) {
        await ctx.db.patch(row._id, { removeWanted: true })
        return false
    }
    const post = row.postNo !== undefined ? await publishingPost(ctx, row.serverId, row.postNo) : null,
        messageId = row.postMessageId ?? post?.messageId,
        channelId = row.postChannelId ?? post?.channelId
    await releaseBoardPost(ctx, row)
    if (row.state === "sent") await countPosted(ctx, row.boardId, -1)
    if (!messageId || !channelId) {
        await ctx.db.delete(row._id)
        return true
    }
    await ctx.db.patch(row._id, {
        state: "remove",
        authorId: undefined,
        postMessageId: messageId,
        postChannelId: channelId,
        postNo: undefined,
        attemptId: undefined,
        removeQueuedAt: now,
        removeWanted: undefined,
        nextCheckAt: now,
        expiresAt: now + BOARD_ENTRY_RETENTION_MS,
    })
    return true
}
/** A removed board's records end at the next retention run, along with their tracked posts. Posts stay on Fluxer, and removals still run */
export async function retireBoardEntries(ctx: MutationCtx, boardId: Id<"boards">, now: number) {
    const rows = await ctx.db
        .query("boardEntries")
        .withIndex("by_board", (q) => q.eq("boardId", boardId).eq("state", "sent"))
        .take(BOARD_ENTRY_LIMIT * 2)
    for (const row of rows) await ctx.db.patch(row._id, { expiresAt: now })
}

// The publisher reports each outcome here. A send that never reached Fluxer is released and waits for another try. An unknown outcome is
// never retried, and a count update that failed leaves the card as it was until a later change
export async function syncBoardPublishing(
    ctx: MutationCtx,
    attempt: Doc<"publishingAttempts">,
    outcome: "sent" | "failed" | "uncertain",
) {
    const consumer = attempt.consumer
    if (consumer?.type !== "board") return
    const boardId = ctx.db.normalizeId("boards", consumer.boardId),
        row = boardId ? await boardEntry(ctx, attempt.serverId, consumer.messageId, boardId) : null
    if (!boardId || !row || row.attemptId !== attempt._id) return
    const now = Date.now()
    // A removal asked for while this outcome was unknown runs as soon as it is known. It takes the tracked post with it, which the publisher
    // still reads after this report, so it runs in its own mutation
    const wantedRemoval = async () => {
        if (row.removeWanted && outcome !== "uncertain")
            await ctx.scheduler.runAfter(0, internal.boardsStore.runWantedRemoval, { entryId: row._id })
    }
    if (attempt.action === "edit") return wantedRemoval()
    if (outcome === "failed" && attempt.dispatchedAt === undefined) {
        const post = await publishingPost(ctx, attempt.serverId, attempt.postNo)
        if (post?.attemptId === attempt._id) await ctx.db.delete(post._id)
        await ctx.db.delete(attempt._id)
        await ctx.db.patch(row._id, {
            state: "queued",
            nextCheckAt: now + BOARD_RETRY_MS,
            postNo: undefined,
            attemptId: undefined,
        })
        return wantedRemoval()
    }
    if (outcome !== "sent") {
        await ctx.db.patch(row._id, { state: outcome, expiresAt: now + BOARD_ENTRY_RETENTION_MS })
        return wantedRemoval()
    }
    // Reading a post back again settles nothing new, so it counts once
    if (row.state === "sent") return wantedRemoval()
    const post = await publishingPost(ctx, attempt.serverId, attempt.postNo)
    await ctx.db.patch(row._id, {
        state: "sent",
        postedAt: now,
        countAt: now,
        expiresAt: undefined,
        ...(post?.messageId ? { postMessageId: post.messageId, postChannelId: post.channelId } : {}),
    })
    const board = await countPosted(ctx, boardId, 1)
    // A full board forgets its oldest record. Its post stays on Fluxer
    if (board && board.posted + 1 > BOARD_ENTRY_LIMIT) {
        const oldest = await ctx.db
            .query("boardEntries")
            .withIndex("by_board_posted", (q) => q.eq("boardId", boardId).gt("postedAt", 0))
            .first()
        if (oldest && oldest._id !== row._id) {
            await releaseBoardPost(ctx, oldest)
            await ctx.db.delete(oldest._id)
            await countPosted(ctx, boardId, -1)
        }
    }
    await wantedRemoval()
}
// The publisher's claim: The post's board must still exist with the same channel while the module and publishing are on at DEFCON 3.
// Otherwise the unclaimed attempt closes without a send
export async function boardPublishingFence(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, value: unknown) {
    const consumer = attempt.consumer
    if (consumer?.type !== "board") fail(409, "Board consumer missing")
    const boardId = ctx.db.normalizeId("boards", consumer.boardId),
        board = boardId ? await ctx.db.get(boardId) : null,
        row = boardId ? await boardEntry(ctx, attempt.serverId, consumer.messageId, boardId) : null,
        now = Date.now()
    if (!row || row.attemptId !== attempt._id) fail(409, "Board post changed")
    if (
        !board ||
        board.problem ||
        board.channelId !== attempt.channelId ||
        now >= attempt.dispatchExpiresAt ||
        (await readBoardSettings(ctx, attempt.serverId))?.enabled === false ||
        !(await boardAutomation(ctx, attempt.serverId))
    ) {
        await ctx.db.patch(attempt._id, { outcome: "failed", noDispatch: true, unresolved: false, finishedAt: now })
        await syncBoardPublishing(ctx, (await ctx.db.get(attempt._id))!, "failed")
        return false
    }
    const context = boardDeliveryContext(value, now)
    if (context.botId !== attempt.botId || context.channelId !== attempt.channelId)
        fail(409, "Board post destination changed")
    return true
}

export const runWantedRemoval = internalMutation({
    args: { entryId: v.id("boardEntries") },
    handler: async (ctx, { entryId }): Promise<void> => {
        const row = await ctx.db.get(entryId)
        if (row?.removeWanted && (await queueBoardRemoval(ctx, row, Date.now()))) await ringWork(ctx)
    },
})

const BOARD_BATCH = 64
// Retention: A record without a post ends after 30 days, and so does a removal whose outcome stayed unknown or that kept failing. A record
// whose publishing outcome is unknown stays until staff settle it. A removed board's posted records end here too
export async function cleanupBoards(ctx: MutationCtx, now: number) {
    const rows = await ctx.db
        .query("boardEntries")
        .withIndex("by_expiry", (q) => q.gt("expiresAt", 0).lte("expiresAt", now))
        .take(BOARD_BATCH)
    for (const row of rows) {
        if (await boardEntryUnsettled(ctx, row)) {
            await ctx.db.patch(row._id, { expiresAt: now + BOARD_ENTRY_RETENTION_MS })
            continue
        }
        await releaseBoardPost(ctx, row)
        await ctx.db.delete(row._id)
    }
    return { more: rows.length === BOARD_BATCH }
}
export const boardRemoveExpired = (row: Doc<"boardEntries">, now: number) =>
    now - (row.removeQueuedAt ?? now) >= BOARD_REMOVE_MS
