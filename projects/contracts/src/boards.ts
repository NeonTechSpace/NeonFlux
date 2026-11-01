import { Schema } from "effect"
import { Id, Ids, Int, List, Millis, Name, origin, Token } from "./common.ts"
import { ModerationActor } from "./shared.ts"
import { PublishingGrant } from "./publishing-base.ts"
export { boardSourceId } from "./publishing-base.ts"

// Starboard and clownboard, see docs/BOT.md#boards

/** A server has at most five boards, a board ignores at most 25 channels, and a work pass lists at most ten posts and removals */
export const BOARD_LIMIT = 5,
    BOARD_IGNORE_LIMIT = 25,
    BOARD_WORK_BATCH = 10
/** A board keeps the record of its latest 1,000 posts. An older post stays on Fluxer without one */
export const BOARD_ENTRY_LIMIT = 1000
/** Pages of the entry index the bot loads when a server starts */
export const BOARD_INDEX_PAGE = 500
export const BOARD_THRESHOLD_DEFAULT = 3,
    /** A reaction read holds 100 reactors, so a threshold stays inside what one read can judge */
    BOARD_THRESHOLD_MAX = 100
/** The longest text a card's description holds, and the most text the bot sends the backend for its content check */
export const BOARD_TEXT_MAX = 2000,
    BOARD_SOURCE_TEXT_MAX = 8000

const customEmoji = /^<a?:[A-Za-z0-9_-]{1,32}:([1-9]\d{0,18})>$/
const unicodeEmoji = /^(?:[^\s<>:@#\u0000-\u007f]{1,32}|[0-9#*]️?⃣)$/
/** A Unicode emoji without its optional emoji-style selector, which Fluxer refuses in a reaction such as ⭐ */
const withoutSelector = (value: string) => value.replaceAll("\ufe0f", "")
/** An emoji as staff type it: A Unicode emoji or a custom emoji's markup, such as <:party:123> */
export const isBoardEmoji = (value: string) => customEmoji.test(value) || unicodeEmoji.test(withoutSelector(value))
/** The form a board stores its emoji in, whichever one was typed */
export const boardEmojiForm = (value: string) => (customEmoji.test(value) ? value : withoutSelector(value))
export const BoardEmoji = Schema.String.check(Schema.makeFilter(isBoardEmoji))
/** What makes two emojis the same reaction: A custom emoji's ID, or a Unicode emoji without its optional emoji-style selector */
export const boardEmojiKey = (emoji: string | { readonly name: string; readonly id?: string | null | undefined }) =>
    typeof emoji === "string"
        ? (customEmoji.exec(emoji)?.[1] ?? withoutSelector(emoji))
        : (emoji.id ?? withoutSelector(emoji.name))
export const BoardThreshold = Int(1, BOARD_THRESHOLD_MAX)
/** Why NeonFlux stopped a board: Its channel is gone or cannot hold posts, or NeonFlux cannot post there */
export const BoardProblem = Schema.Literals(["channel", "permission"])
export type BoardProblem = typeof BoardProblem.Type
const ignored = Ids(BOARD_IGNORE_LIMIT).check(Schema.isUnique())
/**
 * selfReactions counts the author's own reaction, and bots lets messages of bots and webhooks onto the board. problem is set while
 * NeonFlux stopped the board. posted is how many posts it keeps a record of
 */
export const Board = Schema.Struct({
    name: Name,
    emoji: BoardEmoji,
    channelId: Id,
    threshold: BoardThreshold,
    selfReactions: Schema.Boolean,
    bots: Schema.Boolean,
    ignoredChannelIds: ignored,
    problem: Schema.optionalKey(BoardProblem),
    posted: Int(0),
    createdAt: Millis,
})
export type Board = typeof Board.Type
/** enabled is the feature's switch. A server without a row has it on, so a first board works at once */
export const BoardView = Schema.Struct({ enabled: Schema.Boolean, boards: List(Board, BOARD_LIMIT) })
export type BoardView = typeof BoardView.Type
/** add makes a board. set changes what it names and turns a stopped board back on. ignore adds or removes one ignored channel */
export const BoardOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("module"), enabled: Schema.Boolean }),
    Schema.Struct({
        type: Schema.Literal("add"),
        name: Name,
        emoji: BoardEmoji,
        channelId: Id,
        threshold: BoardThreshold,
    }),
    Schema.Struct({
        type: Schema.Literal("set"),
        name: Name,
        emoji: Schema.optionalKey(BoardEmoji),
        channelId: Schema.optionalKey(Id),
        threshold: Schema.optionalKey(BoardThreshold),
        selfReactions: Schema.optionalKey(Schema.Boolean),
        bots: Schema.optionalKey(Schema.Boolean),
    }),
    Schema.Struct({ type: Schema.Literal("ignore"), name: Name, channelId: Id, ignored: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("remove"), name: Name }),
])
export type BoardOperation = typeof BoardOperation.Type
/** Chat changes carry the server manager's fresh native authority, like sticky messages */
export const BoardManageRequest = Schema.Struct({
    ...origin,
    serverId: Id,
    messageId: Id,
    createdAt: Millis,
    actor: ModerationActor,
    managerAuthorized: Schema.Literal(true),
    operation: BoardOperation,
})
export type BoardManageRequest = typeof BoardManageRequest.Type
/** detail also counts one board's posts that wait or whose outcome is unknown, for !board show */
export const BoardQueryRequest = Schema.Struct({ serverId: Id, detail: Schema.optionalKey(Name) })
export type BoardQueryRequest = typeof BoardQueryRequest.Type
export const BoardDetail = Schema.Struct({ waiting: Int(0), uncertain: Int(0) })
export type BoardDetail = typeof BoardDetail.Type
export const BoardQueryResult = Schema.Struct({ ...BoardView.fields, detail: Schema.optionalKey(BoardDetail) })
export type BoardQueryResult = typeof BoardQueryResult.Type
/** The bot's fresh read of a board's channel, acting as itself */
export const BoardDeliveryContext = Schema.Struct({
    ...origin,
    observedAt: Millis,
    channelId: Id,
    botId: Id,
    botAuthorized: Schema.Literal(true),
})
export type BoardDeliveryContext = typeof BoardDeliveryContext.Type
/** A queued post, with its board's current channel */
export const BoardDelivery = Schema.Struct({
    name: Name,
    channelId: Id,
    sourceChannelId: Id,
    messageId: Id,
})
export type BoardDelivery = typeof BoardDelivery.Type
/** A board post to remove. entryId names its record */
export const BoardRemoval = Schema.Struct({ entryId: Token, channelId: Id, messageId: Id })
export type BoardRemoval = typeof BoardRemoval.Type
/** What the card shows, read fresh from the source message. Its text is checked here and never stored apart from the posted card */
export const BoardCard = Schema.Struct({
    authorName: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
    text: Schema.String.check(Schema.isMaxLength(BOARD_SOURCE_TEXT_MAX)),
    imageUrl: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2048))),
    link: Schema.String.check(Schema.isMaxLength(256)),
    count: Int(1),
    /** The author's roles, since a role a content rule exempts stays exempt here */
    roleIds: Ids(1000),
})
export type BoardCard = typeof BoardCard.Type
/**
 * index pages through the messages that have a record, once when a server starts. observe reports a count at or above the threshold, or
 * any count of a message with a record, and context lets a due count update reserve its edit at once. list returns due posts and removals.
 * reserve claims one post for the publisher, with the card it shows. defer waits a minute after a failed read, and drop forgets a queued
 * post that may no longer go out. blocked stops a board. source-gone marks the posts of deleted messages for removal, and source-channel-gone
 * those of a deleted channel or thread, a page at a time, with parent for the threads of a deleted channel. withdraw removes one board's post
 * of a message its readers may no longer see. remove-claim takes one removal before its delete, and remove-outcome closes it. A removal
 * without an outcome stays unknown and is never sent again
 */
export const BoardWorkOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("index"), cursor: Schema.optionalKey(Schema.String) }),
    Schema.Struct({
        type: Schema.Literal("observe"),
        name: Name,
        channelId: Id,
        parentChannelId: Schema.optionalKey(Id),
        messageId: Id,
        authorId: Id,
        sourceAt: Millis,
        count: Int(0),
        context: Schema.optionalKey(BoardDeliveryContext),
    }),
    Schema.Struct({ type: Schema.Literal("list") }),
    Schema.Struct({
        type: Schema.Literal("reserve"),
        name: Name,
        messageId: Id,
        context: BoardDeliveryContext,
        card: BoardCard,
    }),
    Schema.Struct({ type: Schema.Literal("defer"), name: Name, messageId: Id }),
    Schema.Struct({ type: Schema.Literal("drop"), name: Name, messageId: Id }),
    Schema.Struct({ type: Schema.Literal("blocked"), name: Name, channelId: Id, reason: BoardProblem }),
    Schema.Struct({ type: Schema.Literal("source-gone"), messageIds: Ids(100).check(Schema.isMinLength(1)) }),
    Schema.Struct({
        type: Schema.Literal("source-channel-gone"),
        channelId: Id,
        parent: Schema.Boolean,
        cursor: Schema.optionalKey(Schema.String),
    }),
    Schema.Struct({ type: Schema.Literal("withdraw"), name: Name, messageId: Id }),
    Schema.Struct({ type: Schema.Literal("remove-claim"), entryId: Token }),
    Schema.Struct({
        type: Schema.Literal("remove-outcome"),
        entryId: Token,
        outcome: Schema.Literals(["removed", "retry"]),
    }),
])
export type BoardWorkOperation = typeof BoardWorkOperation.Type
export const BoardWorkRequest = Schema.Struct({ serverId: Id, operation: BoardWorkOperation })
export type BoardWorkRequest = typeof BoardWorkRequest.Type
/** recorded is false when nothing changed. A recorded observe that queued a post or a recorded source-gone has work to wake */
export const BoardWorkResult = Schema.Union([
    Schema.Struct({
        type: Schema.Literal("index"),
        /** channelId is where the message's post stands, once it has one */
        entries: List(
            Schema.Struct({ name: Name, messageId: Id, channelId: Schema.optionalKey(Id) }),
            BOARD_INDEX_PAGE,
        ),
        cursor: Schema.optionalKey(Schema.String),
    }),
    Schema.Struct({
        type: Schema.Literal("work"),
        deliveries: List(BoardDelivery, BOARD_WORK_BATCH),
        removals: List(BoardRemoval, BOARD_WORK_BATCH),
    }),
    Schema.Struct({ type: Schema.Literal("reserved"), grant: PublishingGrant }),
    Schema.Struct({ type: Schema.Literal("skipped") }),
    Schema.Struct({
        type: Schema.Literal("progress"),
        recorded: Schema.Boolean,
        cursor: Schema.optionalKey(Schema.String),
    }),
])
export type BoardWorkResult = typeof BoardWorkResult.Type
