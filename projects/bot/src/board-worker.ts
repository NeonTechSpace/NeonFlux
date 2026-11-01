import {
    BOARD_ENTRY_LIMIT,
    BOARD_LIMIT,
    BOARD_SOURCE_TEXT_MAX,
    BOARD_WORK_BATCH,
    boardEmojiKey,
    type Board,
    type BoardCard,
    type BoardDelivery,
    type BoardProblem,
    type BoardRemoval,
    type BoardView,
} from "@neonflux/contracts/boards"
import { cutText } from "@neonflux/contracts/common"
import { metadataMessageLink } from "@neonflux/contracts/metadata-logs"
import type { PublishingGrant } from "@neonflux/contracts/publishing-base"
import {
    errors,
    format,
    isThreadChannel,
    MessageType,
    type Client,
    type Message,
    type ReactionEmoji,
} from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Exit, Scope, Semaphore } from "effect"
import { readBoardVisibility } from "./board-permissions.ts"
import type { BoardStore } from "./board-store.ts"
import { readKnownChannel } from "./channel-parents.ts"
import { contained, warnFailure } from "./contained.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { postServerNote } from "./install-note.ts"
import { readNativeMember } from "./member-evidence.ts"
import { performPublishingGrant } from "./publishing.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { sourceTimestamp } from "./responses.ts"
import { readAuthenticatedBotId } from "./safety-permissions.ts"
import { startSignalledWorker } from "./signalled-worker.ts"
// Board cards have the same destinations and permissions as alerts, without a forum
import { readTwitchDestination } from "./twitch-worker.ts"

export class BoardHandlingError extends Data.TaggedError("BoardHandlingError")<{
    readonly stage: "destination" | "response" | "grant"
}> {}
/** How long a reaction waits before its message is read, so a burst costs one read */
export const BOARD_WAIT_MS = 5000
/** How long a reaction on a message with a record waits. A card's count changes at most once a minute */
export const BOARD_COUNT_WAIT_MS = 60000
/** Messages one server's reactions can wait on, and message records it remembers. A reaction beyond the first bound is dropped, and the next one asks again */
export const BOARD_WAITING_MAX = 200,
    BOARD_REMEMBERED_MAX = BOARD_LIMIT * BOARD_ENTRY_LIMIT + 1000
/** Pages of due posts one pass handles at most */
const PAGES_PER_PASS = 5
const SPOILER_FLAG = 1 << 3

/** What stopped a board, and its fix */
export const boardProblemText = (problem: BoardProblem, channelId: string) =>
    problem === "channel"
        ? `NeonFlux cannot find ${format.channelMention(channelId)}, or it is not a text or announcement channel. Choose another channel`
        : `NeonFlux lacks View channel, Send messages or Embed links in ${format.channelMention(channelId)}. Grant them`
const stopNote = (board: Board, problem: BoardProblem) =>
    `Board ${board.name} is stopped. ${boardProblemText(problem, board.channelId)}, then turn it back on with \`!board set ${board.name} channel #channel\``
const destinationContext = (client: Client, serverId: string, channelId: string) =>
    readTwitchDestination(client, serverId, channelId).pipe(
        Effect.flatMap((read) =>
            "context" in read
                ? Effect.succeed(read.context)
                : Effect.fail(new BoardHandlingError({ stage: "destination" })),
        ),
    )
/** The first image a message holds. A spoiler or a file Fluxer marks as adult stays behind */
export function boardImage(message: Pick<Message, "attachments">) {
    for (const file of message.attachments)
        if (file.contentType?.startsWith("image/") && file.url && !(file.flags & SPOILER_FLAG) && !file.nsfw)
            return file.url
    return undefined
}
/** Whether a message's author is a bot or a webhook, whose messages a board takes only with bots on */
export const boardBotAuthor = (message: Pick<Message, "author" | "webhookId">) =>
    message.webhookId !== undefined || message.author.isBot || !!message.author.isSystem
/** Ordinary messages and replies. A join note and the like is no member's message */
const boardMessageKind = (message: Pick<Message, "type">) =>
    message.type === undefined || message.type === MessageType.Default || message.type === MessageType.Reply
/** A board's emoji on a message, as Fluxer holds it */
const reactionRow = (message: Pick<Message, "reactions">, board: Board) =>
    message.reactions?.find((row) => boardEmojiKey(row.emoji) === boardEmojiKey(board.emoji))
const rawCount = (message: Pick<Message, "reactions">, board: Board) => reactionRow(message, board)?.count ?? 0

/**
 * One server's boards, kept in memory. They load once when the server starts and again after a change, so a reaction on an emoji no board
 * uses and a deleted message without a record cost nothing. A reaction on a board's emoji waits a moment and reads its message once.
 * The backend hears of it only at the board's threshold or when the message has a record
 */
export function createBoardRuntime(
    store: BoardStore,
    publishing: PublishingStore | undefined,
    serverId: string,
    admitted: Effect.Effect<boolean>,
) {
    let view: BoardView = { enabled: false, boards: [] },
        started: { client: Client; scope: Scope.Scope; wake: Effect.Effect<void> } | undefined
    // The boards of each message with a record, oldest first, each with the channel its post stands in once known
    const records = new Map<string, Map<string, string | undefined>>()
    const waiting = new Map<string, { channelId: string; names: Set<string> }>()
    const line = Semaphore.makeUnsafe(1)

    const remember = (messageId: string, name: string, channelId?: string) => {
        const names = records.get(messageId)
        if (names) names.set(name, channelId)
        else {
            if (records.size >= BOARD_REMEMBERED_MAX) records.delete(records.keys().next().value!)
            records.set(messageId, new Map([[name, channelId]]))
        }
    }
    const loadRecords = Effect.gen(function* () {
        records.clear()
        if (!view.boards.length) return
        let cursor: string | undefined
        do {
            const page = yield* store.work({
                serverId,
                operation: { type: "index", ...(cursor ? { cursor } : {}) },
            })
            if (page.type !== "index") return yield* Effect.fail(new BoardHandlingError({ stage: "response" }))
            for (const entry of page.entries) remember(entry.messageId, entry.name, entry.channelId)
            cursor = page.cursor
        } while (cursor)
    })
    const load = Effect.gen(function* () {
        const { detail: _, ...next } = yield* store.query({ serverId })
        view = next
        yield* loadRecords
    })
    const publish = (client: Client, grant: PublishingGrant, messageId: string, board: Board) =>
        Effect.gen(function* () {
            const consumer = grant.consumer
            if (
                !publishing ||
                consumer?.type !== "board" ||
                consumer.messageId !== messageId ||
                grant.actorId !== grant.botId ||
                grant.channelId !== board.channelId
            )
                return yield* Effect.fail(new BoardHandlingError({ stage: "grant" }))
            const done = yield* performPublishingGrant(publishing, serverId, grant.botId, client, grant, () =>
                destinationContext(client, serverId, grant.channelId),
            )
            if (done.refused === "permission") yield* stop(client, board, "permission")
            if (grant.action === "send" && done.outcome === "sent") remember(messageId, board.name, grant.channelId)
        })
    /** A missing channel or permission stops the board once and tells the server's staff */
    const stop = (client: Client, board: Board, reason: BoardProblem) =>
        Effect.gen(function* () {
            const result = yield* store.work({
                serverId,
                operation: { type: "blocked", name: board.name, channelId: board.channelId, reason },
            })
            view = {
                ...view,
                boards: view.boards.map((row) => (row.name === board.name ? { ...row, problem: reason } : row)),
            }
            if (result.type === "progress" && result.recorded)
                yield* postServerNote(
                    client,
                    serverId,
                    withPrefix(stopNote(board, reason), replyPrefix(serverId, serverId)),
                ).pipe(
                    Effect.catchCause((cause) =>
                        Cause.hasInterrupts(cause)
                            ? Effect.failCause(cause)
                            : warnFailure("A note about a stopped board could not be posted", cause),
                    ),
                )
        })
    /** The count of a message, without its author's reaction unless the board counts it and without bots. One read judges up to 100 reactors */
    const counted = (client: Client, message: Message, board: Board) =>
        Effect.gen(function* () {
            const row = reactionRow(message, board)
            if (!row) return 0
            // The read names the emoji as the message holds it, since Fluxer answers a form it does not hold with an empty page
            const page = yield* client.messages.fetchReactionUsers(
                { channelId: message.channelId, id: message.id },
                row.emoji.id ? { name: row.emoji.name, id: row.emoji.id } : row.emoji.name,
                { limit: 100 },
                { timeoutMs: 5000 },
            )
            const left = page.items.filter(
                (user) => !user.isBot && (board.selfReactions || user.id !== message.author.id),
            ).length
            return Math.max(row.count - (page.items.length - left), 0)
        })
    /** Tells the backend that source messages are gone. Posts of theirs are queued for removal */
    const sourceGone = (messageIds: readonly string[]) =>
        Effect.gen(function* () {
            for (let at = 0; at < messageIds.length; at += 100) {
                const result = yield* store.work({
                    serverId,
                    operation: { type: "source-gone", messageIds: messageIds.slice(at, at + 100) },
                })
                if (result.type === "progress" && result.recorded && started) yield* started.wake
            }
        })
    /** The reactions a message collected in its wait: One read of it, and one of its reactors at a threshold or for a record */
    const check = (client: Client, messageId: string, channelId: string, names: ReadonlySet<string>) =>
        Effect.gen(function* () {
            if (!view.enabled || !(yield* admitted)) return
            const boards = view.boards.filter((board) => names.has(board.name) && !board.problem),
                channel = yield* readKnownChannel(client, channelId),
                parentId = isThreadChannel(channel) ? channel.parentId : undefined,
                inside = (id: string) => id === channelId || id === parentId
            const recorded = (board: Board) => records.get(messageId)?.has(board.name) === true
            // A new post must come from an allowed channel, read from memory. The post itself reads everything fresh
            const eligible: Board[] = []
            for (const board of boards) {
                if (recorded(board)) eligible.push(board)
                else if (
                    !view.boards.some((other) => inside(other.channelId)) &&
                    !board.ignoredChannelIds.some(inside)
                ) {
                    const allowed = yield* readBoardVisibility(client, serverId, channelId, board.channelId, true)
                    if (allowed === "channel-gone") yield* stop(client, board, "channel")
                    else if (allowed === true) eligible.push(board)
                }
            }
            if (!eligible.length) return
            const message = yield* client.messages
                .fetch({ channelId, id: messageId }, { timeoutMs: 5000 })
                .pipe(
                    Effect.catch((error) =>
                        errors.isNotFound(error) ? Effect.succeed(undefined) : Effect.fail(error),
                    ),
                )
            if (!message) {
                if (records.delete(messageId)) yield* sourceGone([messageId])
                return
            }
            const botId = yield* readAuthenticatedBotId(client),
                observedAt = yield* Clock.currentTimeMillis
            for (const board of eligible) {
                const known = recorded(board)
                // A card stays only while the readers of its own channel may see the source, which a moved board's old card still stands in.
                // It is judged here, at the next reaction, and read fresh
                if (known) {
                    const destination = records.get(messageId)?.get(board.name) ?? board.channelId
                    const allowed = yield* readBoardVisibility(client, serverId, channelId, destination, false).pipe(
                        Effect.catch((error) =>
                            errors.isNotFound(error) ? Effect.succeed(undefined) : Effect.fail(error),
                        ),
                    )
                    if (allowed === false) {
                        const result = yield* store.work({
                            serverId,
                            operation: { type: "withdraw", name: board.name, messageId },
                        })
                        records.get(messageId)?.delete(board.name)
                        if (result.type === "progress" && result.recorded && started) yield* started.wake
                    }
                    if (allowed === "channel-gone" && destination === board.channelId)
                        yield* stop(client, board, "channel")
                    if (allowed !== true) continue
                }
                if (!known && (!boardMessageKind(message) || (boardBotAuthor(message) && !board.bots))) continue
                const raw = rawCount(message, board)
                if (!known && raw < board.threshold) continue
                const count = yield* counted(client, message, board)
                if (!known && count < board.threshold) continue
                const result = yield* store.work({
                    serverId,
                    operation: {
                        type: "observe",
                        name: board.name,
                        channelId,
                        ...(parentId ? { parentChannelId: parentId } : {}),
                        messageId,
                        authorId: message.author.id,
                        sourceAt: yield* sourceTimestamp(message),
                        count,
                        context: {
                            originServerId: serverId,
                            observedAt,
                            channelId: board.channelId,
                            botId,
                            botAuthorized: true,
                        },
                    },
                })
                if (result.type === "reserved") yield* publish(client, result.grant, messageId, board)
                else if (result.type === "progress" && result.recorded) {
                    remember(messageId, board.name)
                    if (started) yield* started.wake
                }
            }
        })
    const schedule = (client: Client, messageId: string, channelId: string, names: readonly string[]) =>
        Effect.gen(function* () {
            const current = waiting.get(messageId)
            if (current) {
                for (const name of names) current.names.add(name)
                return
            }
            if (!started || waiting.size >= BOARD_WAITING_MAX) return
            const entry = { channelId, names: new Set(names) }
            waiting.set(messageId, entry)
            const wait = names.some((name) => records.get(messageId)?.has(name)) ? BOARD_COUNT_WAIT_MS : BOARD_WAIT_MS
            yield* Effect.sleep(wait).pipe(
                Effect.andThen(Effect.sync(() => waiting.delete(messageId))),
                Effect.andThen(line.withPermit(check(client, messageId, entry.channelId, entry.names))),
                (work) => contained(work, "A board reaction could not be checked"),
                Effect.forkIn(started.scope, { startImmediately: true }),
            )
        })
    /** One queued post: A fresh read of its channel, its message and who may see it, then the publisher, never twice */
    const deliver = (client: Client, delivery: BoardDelivery) =>
        Effect.gen(function* () {
            const board = view.boards.find((row) => row.name === delivery.name),
                drop = store.work({
                    serverId,
                    operation: { type: "drop", name: delivery.name, messageId: delivery.messageId },
                })
            // A board this memory does not hold yet waits for its reload
            if (!board || board.channelId !== delivery.channelId)
                return yield* Effect.fail(new BoardHandlingError({ stage: "destination" }))
            const destination = yield* readTwitchDestination(client, serverId, board.channelId)
            if ("problem" in destination) return yield* stop(client, board, destination.problem)
            if (destination.forum) return yield* stop(client, board, "channel")
            const allowed = yield* readBoardVisibility(
                client,
                serverId,
                delivery.sourceChannelId,
                board.channelId,
                false,
            ).pipe(Effect.catch((error) => (errors.isNotFound(error) ? Effect.succeed(false) : Effect.fail(error))))
            if (allowed !== true) return yield* drop
            const message = yield* client.messages
                .fetch({ channelId: delivery.sourceChannelId, id: delivery.messageId }, { timeoutMs: 5000 })
                .pipe(
                    Effect.catch((error) =>
                        errors.isNotFound(error) ? Effect.succeed(undefined) : Effect.fail(error),
                    ),
                )
            if (!message || !boardMessageKind(message) || (boardBotAuthor(message) && !board.bots)) return yield* drop
            const count = yield* counted(client, message, board)
            // Reactions taken back while the post waited leave nothing to post
            if (count < board.threshold) return yield* drop
            const member = message.webhookId
                ? undefined
                : (yield* readNativeMember(client, serverId, message.author.id, { allowAbsent: true })).member
            const image = boardImage(message)
            const card: BoardCard = {
                authorName:
                    member?.nickname ||
                    message.author.displayName ||
                    message.author.username ||
                    "A member of this server",
                text: cutText(message.content, BOARD_SOURCE_TEXT_MAX),
                ...(image ? { imageUrl: image } : {}),
                link: metadataMessageLink(serverId, delivery.sourceChannelId, delivery.messageId),
                count,
                roleIds: member ? [...member.roleIds] : [],
            }
            const result = yield* store.work({
                serverId,
                operation: {
                    type: "reserve",
                    name: board.name,
                    messageId: delivery.messageId,
                    context: destination.context,
                    card,
                },
            })
            if (result.type === "skipped") return
            if (result.type !== "reserved") return yield* Effect.fail(new BoardHandlingError({ stage: "response" }))
            yield* publish(client, result.grant, delivery.messageId, board)
        })
    /** One post to delete, claimed first, so an unknown outcome is never sent again. A post that is gone or may not be deleted is done */
    const remove = (client: Client, removal: BoardRemoval) =>
        Effect.gen(function* () {
            const claim = yield* store.work({
                serverId,
                operation: { type: "remove-claim", entryId: removal.entryId },
            })
            if (claim.type !== "progress" || !claim.recorded) return
            const done = yield* Effect.exit(
                client.messages.delete({ channelId: removal.channelId, id: removal.messageId }, { timeoutMs: 5000 }),
            )
            if (Exit.isFailure(done) && Cause.hasInterrupts(done.cause)) return yield* Effect.failCause(done.cause)
            const failure = Exit.isFailure(done) ? Cause.squash(done.cause) : undefined,
                outcome = failure === undefined ? undefined : errors.outcome(failure),
                rateLimited = (failure as { readonly status?: unknown } | undefined)?.status === 429
            if (outcome === "unknown" && !rateLimited) return
            yield* store.work({
                serverId,
                operation: {
                    type: "remove-outcome",
                    entryId: removal.entryId,
                    outcome: outcome === "notDispatched" || rateLimited ? "retry" : "removed",
                },
            })
        })
    const pass = (client: Client) =>
        Effect.gen(function* () {
            for (let page = 0; page < PAGES_PER_PASS; page++) {
                const listed = yield* store.work({ serverId, operation: { type: "list" } })
                if (listed.type !== "work") return yield* Effect.fail(new BoardHandlingError({ stage: "response" }))
                for (const removal of listed.removals)
                    yield* contained(remove(client, removal), "A board post could not be removed")
                for (const delivery of listed.deliveries)
                    yield* line.withPermit(deliver(client, delivery)).pipe(
                        // A failed post waits a minute, so the next page holds other posts
                        Effect.catchCause((cause) =>
                            Cause.hasInterrupts(cause)
                                ? Effect.failCause(cause)
                                : store
                                      .work({
                                          serverId,
                                          operation: {
                                              type: "defer",
                                              name: delivery.name,
                                              messageId: delivery.messageId,
                                          },
                                      })
                                      .pipe(Effect.catch(() => Effect.void)),
                        ),
                    )
                if (listed.deliveries.length < BOARD_WORK_BATCH && listed.removals.length < BOARD_WORK_BATCH) return
            }
        })
    const runtime = {
        serverId,
        start: (client: Client) =>
            Effect.gen(function* () {
                const scope = yield* Effect.scope,
                    { wake } = yield* startSignalledWorker(
                        pass(client),
                        Effect.logWarning("Board posts could not be checked. They stay due for the next check"),
                    )
                started = { client, scope, wake }
                boardRuntimes.set(serverId, runtime)
                yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                        if (boardRuntimes.get(serverId) === runtime) boardRuntimes.delete(serverId)
                    }),
                )
                yield* Effect.forkIn(
                    contained(load, "Boards could not be loaded. They wait for the next change"),
                    scope,
                )
                return { notify: () => wake }
            }),
        /** After a chat change, which reports the new boards */
        changed: (next: BoardView) =>
            Effect.sync(() => {
                const hadNone = !view.boards.length
                view = next
                if (hadNone) return
                const names = new Set(next.boards.map((board) => board.name))
                for (const [messageId, held] of records) {
                    for (const name of held.keys()) if (!names.has(name)) held.delete(name)
                    if (!held.size) records.delete(messageId)
                }
            }),
        /** After a dashboard change or a restored backup */
        reload: contained(load, "Boards could not be loaded. They wait for the next change"),
        view: () => view,
        /** A deleted channel or thread takes its messages with it, without message events. With no boards this costs nothing */
        channelDeleted: (channelId: string, isThread: boolean) =>
            contained(
                Effect.gen(function* () {
                    if (!view.boards.length) return
                    // Fluxer deletes a channel's threads with it and sends no thread events for them
                    for (const parent of isThread ? [false] : [false, true]) {
                        let cursor: string | undefined
                        do {
                            const result = yield* store.work({
                                serverId,
                                operation: {
                                    type: "source-channel-gone",
                                    channelId,
                                    parent,
                                    ...(cursor ? { cursor } : {}),
                                },
                            })
                            if (result.type !== "progress") return
                            if (result.recorded && started) yield* started.wake
                            cursor = result.cursor
                        } while (cursor)
                    }
                }),
                "The posts of a deleted channel could not be queued for removal",
            ).pipe(Effect.catch(() => Effect.void)),
        /** Runs the worker's next pass */
        notify: () => started?.wake ?? Effect.void,
        /** Reactions that a member added, on one message. Only an emoji a board uses costs anything, and that once in a wait */
        reactionAdded: (
            client: Client,
            event: { readonly id: string; readonly channelId: string; readonly guildId?: string | undefined },
            emoji: ReactionEmoji,
        ) =>
            Effect.suspend(() => {
                if (!view.enabled || !view.boards.length || (event.guildId !== undefined && event.guildId !== serverId))
                    return Effect.void
                const key = boardEmojiKey(emoji),
                    names = view.boards.flatMap((board) =>
                        !board.problem && boardEmojiKey(board.emoji) === key ? [board.name] : [],
                    )
                return names.length ? schedule(client, event.id, event.channelId, names) : Effect.void
            }),
        /** A reaction taken away, or all of them or of one emoji. It matters only to a post that stands, whose count may change */
        reactionRemoved: (
            client: Client,
            event: { readonly id: string; readonly channelId: string; readonly guildId?: string | undefined },
            emoji?: ReactionEmoji,
        ) =>
            Effect.suspend(() => {
                const held = records.get(event.id)
                if (!held || !view.enabled || (event.guildId !== undefined && event.guildId !== serverId))
                    return Effect.void
                const key = emoji ? boardEmojiKey(emoji) : undefined,
                    names = view.boards.flatMap((board) =>
                        held.has(board.name) && (key === undefined || boardEmojiKey(board.emoji) === key)
                            ? [board.name]
                            : [],
                    )
                return names.length ? schedule(client, event.id, event.channelId, names) : Effect.void
            }),
        /** Deleted messages. Only one with a record costs a call */
        messagesDeleted: (messageIds: readonly string[]) =>
            contained(
                Effect.suspend(() => {
                    const gone = messageIds.filter((id) => records.delete(id))
                    return gone.length ? sourceGone(gone) : Effect.void
                }),
                "The posts of a deleted message could not be queued for removal",
            ).pipe(Effect.catch(() => Effect.void)),
    }
    return runtime
}
export type BoardRuntime = ReturnType<typeof createBoardRuntime>
/** Each running server's boards, so dashboard changes reach them */
export const boardRuntimes = new Map<string, BoardRuntime>()
