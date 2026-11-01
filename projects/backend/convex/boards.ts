import { v } from "convex/values"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import {
    BOARD_IGNORE_LIMIT,
    BOARD_INDEX_PAGE,
    BOARD_WORK_BATCH,
    BoardManageRequest,
    BoardQueryRequest,
    BoardWorkRequest,
    boardEmojiForm,
    boardSourceId,
    type BoardOperation,
    type BoardQueryResult,
    type BoardView,
    type BoardWorkOperation,
    type BoardWorkResult,
} from "@neonflux/contracts/boards"
import type { PublishingBoardConsumer } from "@neonflux/contracts/publishing-base"
import { changeConfiguration } from "./configurationChange.ts"
import { actor } from "./moderationDomain.ts"
import { memberDataDeletedSince } from "./memberData.ts"
import { blockingContentRule } from "./protection.ts"
import { reservePublishing } from "./publishing.ts"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import { decode, fail, source, type ConfigurationIdentity } from "./validation.ts"
import {
    BOARD_COUNT_MS,
    BOARD_ENTRY_RETENTION_MS,
    BOARD_LIMIT,
    BOARD_RETRY_MS,
    boardDeliveryContext,
    renderBoardCard,
    withBoardCount,
} from "./boardsDomain.ts"
import {
    boardAutomation,
    boardEntry,
    boardEntryUnsettled,
    boardRemoveExpired,
    boardView,
    queueBoardRemoval,
    readBoard,
    readBoards,
    readBoardSettings,
    retireBoardEntries,
} from "./boardsStore.ts"

// Chat changes. The bot vouches for a server manager's fresh native authority, like sticky messages
export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<BoardView> => {
        const input = decode(BoardManageRequest, request)
        const identity = source(input, Date.now()),
            who = actor(input.actor),
            op = input.operation
        if (!who.nativePermissionAuthorized) fail(403, "Manage community permission required")
        return changeConfiguration(
            ctx,
            identity.serverId,
            "boards",
            {
                kind: "chat",
                createdAt: identity.createdAt,
                actor: { userId: who.userId, source: "command" },
                operation: op,
            },
            () =>
                applyBoardManagement(
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

/** Chat, the dashboard and a backup restore share these rules. Changing a board turns it back on after NeonFlux stopped it */
export async function applyBoardManagement(
    ctx: MutationCtx,
    identity: ConfigurationIdentity,
    op: BoardOperation,
): Promise<BoardView> {
    const { serverId } = identity,
        now = Date.now()
    if (op.type === "module") {
        const settings = await readBoardSettings(ctx, serverId)
        if (settings) await ctx.db.patch(settings._id, { enabled: op.enabled })
        else await ctx.db.insert("boardSettings", { serverId, enabled: op.enabled })
        return boardView(ctx, serverId)
    }
    const row = await readBoard(ctx, serverId, op.name),
        changed = { updatedAt: now, updatedBy: identity.actorId }
    if (op.type === "add") {
        if (row) fail(409, "A board with that name already exists")
        if ((await readBoards(ctx, serverId)).length >= BOARD_LIMIT)
            fail(429, `A server can have at most ${BOARD_LIMIT} boards`)
        await ctx.db.insert("boards", {
            serverId,
            name: op.name,
            emoji: boardEmojiForm(op.emoji),
            channelId: op.channelId,
            threshold: op.threshold,
            selfReactions: false,
            bots: false,
            ignoredChannelIds: [],
            posted: 0,
            createdAt: now,
            ...changed,
        })
        return boardView(ctx, serverId)
    }
    if (!row) fail(404, "This server has no board with that name")
    if (op.type === "remove") {
        await retireBoardEntries(ctx, row._id, now)
        await ctx.db.delete(row._id)
    } else if (op.type === "ignore") {
        const others = row.ignoredChannelIds.filter((id) => id !== op.channelId)
        if (op.ignored && others.length >= BOARD_IGNORE_LIMIT)
            fail(413, `A board can ignore at most ${BOARD_IGNORE_LIMIT} channels`)
        await ctx.db.patch(row._id, {
            ignoredChannelIds: op.ignored ? [...others, op.channelId] : others,
            ...changed,
        })
    } else {
        const { type: _type, name: _name, ...patch } = op
        await ctx.db.patch(row._id, {
            ...patch,
            ...(patch.emoji ? { emoji: boardEmojiForm(patch.emoji) } : {}),
            problem: undefined,
            ...changed,
        })
    }
    return boardView(ctx, serverId)
}
/** A restored board replaces the settings of one with its name and keeps the record of its posts */
export async function restoreBoard(
    ctx: MutationCtx,
    identity: ConfigurationIdentity,
    value: Pick<
        Doc<"boards">,
        "name" | "emoji" | "channelId" | "threshold" | "selfReactions" | "bots" | "ignoredChannelIds"
    >,
) {
    const row = await readBoard(ctx, identity.serverId, value.name),
        now = Date.now(),
        settings = { ...value, emoji: boardEmojiForm(value.emoji) }
    if (row)
        await ctx.db.patch(row._id, { ...settings, problem: undefined, updatedAt: now, updatedBy: identity.actorId })
    else
        await ctx.db.insert("boards", {
            serverId: identity.serverId,
            ...settings,
            posted: 0,
            createdAt: now,
            updatedAt: now,
            updatedBy: identity.actorId,
        })
}

/** What the bot loads once when a server starts and after a change it did not make itself. An ordinary reaction reads none of this */
export const query = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<BoardQueryResult> => {
        const { serverId, detail } = decode(BoardQueryRequest, request),
            view = await boardView(ctx, serverId)
        if (detail === undefined) return view
        const row = await readBoard(ctx, serverId, detail)
        if (!row) fail(404, "This server has no board with that name")
        const count = async (state: Doc<"boardEntries">["state"]) =>
            (
                await ctx.db
                    .query("boardEntries")
                    .withIndex("by_board", (q) => q.eq("boardId", row._id).eq("state", state))
                    .take(BOARD_WORK_BATCH * 10)
            ).length
        return { ...view, detail: { waiting: await count("queued"), uncertain: await count("uncertain") } }
    },
})
const consumerOf = (row: Doc<"boardEntries">): PublishingBoardConsumer => ({
    type: "board",
    boardId: row.boardId,
    messageId: row.sourceMessageId,
})

async function observe(
    ctx: MutationCtx,
    serverId: string,
    op: Extract<BoardWorkOperation, { type: "observe" }>,
    now: number,
): Promise<BoardWorkResult> {
    const none = { type: "progress", recorded: false } as const,
        board = await readBoard(ctx, serverId, op.name)
    if (!board || board.problem || (await readBoardSettings(ctx, serverId))?.enabled === false) return none
    const row = await boardEntry(ctx, serverId, op.messageId, board._id)
    if (!row) {
        const inChannel = (id: string) => id === op.channelId || id === op.parentChannelId
        if (
            op.count < board.threshold ||
            inChannel(board.channelId) ||
            board.ignoredChannelIds.some(inChannel) ||
            // A ticket stays private, whatever its channel's permissions say
            (await ctx.db
                .query("tickets")
                .withIndex("by_channel", (q) =>
                    q.eq("serverId", serverId).eq("channelId", op.parentChannelId ?? op.channelId),
                )
                .first()) ||
            // A member who deleted their data since this message was sent does not get it reposted again
            (await memberDataDeletedSince(ctx, serverId, op.authorId, op.sourceAt))
        )
            return none
        await ctx.db.insert("boardEntries", {
            serverId,
            boardId: board._id,
            sourceChannelId: op.channelId,
            ...(op.parentChannelId ? { sourceParentId: op.parentChannelId } : {}),
            sourceMessageId: op.messageId,
            authorId: op.authorId,
            count: op.count,
            state: "queued",
            nextCheckAt: now,
            createdAt: now,
            expiresAt: now + BOARD_ENTRY_RETENTION_MS,
        })
        return { type: "progress", recorded: true }
    }
    // Only a standing post changes, at most once a minute. A card that moved with its board's old channel keeps its last count
    if (
        row.state !== "sent" ||
        row.postNo === undefined ||
        !op.context ||
        row.postChannelId !== op.context.channelId ||
        op.count === row.count ||
        now - (row.countAt ?? 0) < BOARD_COUNT_MS ||
        !(await boardAutomation(ctx, serverId)) ||
        (await boardEntryUnsettled(ctx, row))
    )
        return none
    const context = boardDeliveryContext(op.context, now)
    const existing = await ctx.db
            .query("publishingPosts")
            .withIndex("by_server_post", (q) => q.eq("serverId", serverId).eq("postNo", row.postNo!))
            .unique(),
        content = existing?.confirmedContent && withBoardCount(existing.confirmedContent, board.emoji, op.count)
    if (!existing || !content) return none
    const consumer = consumerOf(row),
        reserved = await reservePublishing(ctx, {
            serverId,
            actorId: context.botId,
            botId: context.botId,
            channelId: row.postChannelId,
            sourceId: boardSourceId(row.boardId, row.sourceMessageId, existing.generation + 1),
            source: consumer,
            provenance: consumer,
            consumer,
            content,
            existing,
        })
    await ctx.db.patch(row._id, {
        count: op.count,
        countAt: now,
        attemptId: ctx.db.normalizeId("publishingAttempts", reserved.grant.attemptId)!,
    })
    return { type: "reserved", grant: reserved.grant }
}

// The bot's board work: Reactions that reached a threshold or changed a card, queued posts and their reservation, and removals
export const work = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<BoardWorkResult> => {
        const { serverId, operation: op } = decode(BoardWorkRequest, request),
            now = Date.now(),
            none = { type: "progress", recorded: false } as const
        if (op.type === "observe") return observe(ctx, serverId, op, now)
        if (op.type === "index") {
            const boards = await readBoards(ctx, serverId),
                names = new Map(boards.map((board) => [board._id as string, board.name]))
            const page = await ctx.db
                .query("boardEntries")
                .withIndex("by_message", (q) => q.eq("serverId", serverId))
                .paginate({ cursor: op.cursor ?? null, numItems: BOARD_INDEX_PAGE })
            return {
                type: "index",
                entries: page.page.flatMap((row) => {
                    const name = names.get(row.boardId)
                    return name
                        ? [
                              {
                                  name,
                                  messageId: row.sourceMessageId,
                                  ...(row.postChannelId ? { channelId: row.postChannelId } : {}),
                              },
                          ]
                        : []
                }),
                ...(page.isDone ? {} : { cursor: page.continueCursor }),
            }
        }
        if (op.type === "list") {
            const removals = await ctx.db
                .query("boardEntries")
                .withIndex("by_server_due", (q) =>
                    q.eq("serverId", serverId).eq("state", "remove").lte("nextCheckAt", now),
                )
                .take(BOARD_WORK_BATCH)
            const deliveries = []
            if ((await boardAutomation(ctx, serverId)) && (await readBoardSettings(ctx, serverId))?.enabled !== false) {
                const due = await ctx.db
                    .query("boardEntries")
                    .withIndex("by_server_due", (q) =>
                        q.eq("serverId", serverId).eq("state", "queued").lte("nextCheckAt", now),
                    )
                    .take(BOARD_WORK_BATCH)
                for (const row of due) {
                    const board = await ctx.db.get(row.boardId)
                    // A stopped or removed board posts nothing, and a later reaction queues the message again once it works
                    if (!board || board.problem) await ctx.db.delete(row._id)
                    else
                        deliveries.push({
                            name: board.name,
                            channelId: board.channelId,
                            sourceChannelId: row.sourceChannelId,
                            messageId: row.sourceMessageId,
                        })
                }
            }
            return {
                type: "work",
                deliveries,
                removals: removals.flatMap((row) =>
                    row.postChannelId && row.postMessageId
                        ? [{ entryId: row._id, channelId: row.postChannelId, messageId: row.postMessageId }]
                        : [],
                ),
            }
        }
        if (op.type === "source-gone") {
            let recorded = false
            for (const messageId of op.messageIds) {
                const rows = await ctx.db
                    .query("boardEntries")
                    .withIndex("by_message", (q) => q.eq("serverId", serverId).eq("sourceMessageId", messageId))
                    .take(BOARD_LIMIT * 2)
                for (const row of rows) if (await queueBoardRemoval(ctx, row, now)) recorded = true
            }
            return { type: "progress", recorded }
        }
        if (op.type === "source-channel-gone") {
            const page = await (
                op.parent
                    ? ctx.db
                          .query("boardEntries")
                          .withIndex("by_source_parent", (q) =>
                              q.eq("serverId", serverId).eq("sourceParentId", op.channelId),
                          )
                    : ctx.db
                          .query("boardEntries")
                          .withIndex("by_source_channel", (q) =>
                              q.eq("serverId", serverId).eq("sourceChannelId", op.channelId),
                          )
            ).paginate({ cursor: op.cursor ?? null, numItems: BOARD_WORK_BATCH * 10 })
            let recorded = false
            for (const row of page.page) if (await queueBoardRemoval(ctx, row, now)) recorded = true
            return { type: "progress", recorded, ...(page.isDone ? {} : { cursor: page.continueCursor }) }
        }
        if (op.type === "remove-claim" || op.type === "remove-outcome") {
            const id = ctx.db.normalizeId("boardEntries", op.entryId),
                row = id ? await ctx.db.get(id) : null
            if (!row || row.serverId !== serverId) return none
            if (op.type === "remove-claim") {
                if (row.state !== "remove") return none
                await ctx.db.patch(row._id, { state: "removing", expiresAt: now + BOARD_ENTRY_RETENTION_MS })
                return { type: "progress", recorded: true }
            }
            if (row.state !== "removing") return none
            if (op.outcome === "removed" || boardRemoveExpired(row, now)) await ctx.db.delete(row._id)
            else await ctx.db.patch(row._id, { state: "remove", nextCheckAt: now + BOARD_RETRY_MS })
            return { type: "progress", recorded: true }
        }
        const board = await readBoard(ctx, serverId, op.name)
        if (op.type === "blocked") {
            // A report about a channel that changed since the bot read it changes nothing
            if (!board || board.problem || board.channelId !== op.channelId) return none
            await ctx.db.patch(board._id, { problem: op.reason, updatedAt: now })
            return { type: "progress", recorded: true }
        }
        const row = board ? await boardEntry(ctx, serverId, op.messageId, board._id) : null
        if (op.type === "withdraw") {
            if (!row) return none
            return { type: "progress", recorded: await queueBoardRemoval(ctx, row, now) }
        }
        if (op.type === "defer" || op.type === "drop") {
            if (row?.state !== "queued") return none
            if (op.type === "drop") await ctx.db.delete(row._id)
            else await ctx.db.patch(row._id, { nextCheckAt: now + BOARD_RETRY_MS })
            return { type: "progress", recorded: true }
        }
        const context = boardDeliveryContext(op.context, now)
        if (!board || !row || row.state !== "queued") return { type: "skipped" }
        if (
            !(await boardAutomation(ctx, serverId)) ||
            (await readBoardSettings(ctx, serverId))?.enabled === false ||
            board.problem
        )
            return { type: "skipped" }
        if (context.channelId !== board.channelId) fail(409, "Board channel changed")
        // A card's text faces the same rules as other member posts in the board's channel
        const withheld =
            op.card.text !== "" &&
            (await blockingContentRule(ctx, serverId, op.card.text, op.card.roleIds, board.channelId)) !== null
        const consumer = consumerOf(row),
            reserved = await reservePublishing(ctx, {
                serverId,
                actorId: context.botId,
                botId: context.botId,
                channelId: board.channelId,
                sourceId: boardSourceId(row.boardId, row.sourceMessageId, 1),
                source: consumer,
                provenance: consumer,
                consumer,
                content: renderBoardCard(op.card, board.emoji, withheld),
            })
        await ctx.db.patch(row._id, {
            state: "reserved",
            count: op.card.count,
            postNo: reserved.post.postNo,
            attemptId: ctx.db.normalizeId("publishingAttempts", reserved.grant.attemptId)!,
        })
        return { type: "reserved", grant: reserved.grant }
    },
})
