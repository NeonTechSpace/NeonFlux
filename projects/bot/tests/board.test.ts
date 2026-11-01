import assert from "node:assert/strict"
import test from "node:test"
import type { Board, BoardView, BoardWorkOperation, BoardWorkResult } from "@neonflux/contracts/boards"
import { canonicalPublishingContent, boardSourceId, type PublishingGrant } from "@neonflux/contracts/publishing-base"
import { ChannelType, Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { boardHelp, parseBoardCommand } from "../src/board-command.ts"
import { boardCard, boardList } from "../src/board-management.ts"
import { boardChannel, boardRole, readBoardVisibility } from "../src/board-permissions.ts"
import type { BoardStore } from "../src/board-store.ts"
import { boardMayRepost } from "../src/board-visibility.ts"
import { BOARD_COUNT_WAIT_MS, BOARD_WAIT_MS, boardBotAuthor, boardImage, boardRuntimes } from "../src/board-worker.ts"
import { createBotOptions } from "../src/bot.ts"
import { renderText } from "../src/reply-style.ts"
import { reloadServerRuntime } from "../src/runtime-reload.ts"
import { platform } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const readable = Permissions.ViewChannel | Permissions.ReadMessageHistory
const fixtures = createFixtures(),
    SERVER = fixtures.ids.guild,
    now = Date.parse("2026-10-01T00:00:00Z"),
    BOARD_CHANNEL = "5001",
    MESSAGE = "6001"
const run = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) =>
    Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))
const settle = (bot: Bot) =>
    Effect.gen(function* () {
        for (let round = 0; round < 4; round++) {
            yield* bot.idle()
            for (let turn = 0; turn < 40; turn++) yield* Effect.yieldNow
        }
    })
const board = (fields: Partial<Board> = {}): Board => ({
    name: "stars",
    emoji: "⭐",
    channelId: BOARD_CHANNEL,
    threshold: 3,
    selfReactions: false,
    bots: false,
    ignoredChannelIds: [],
    posted: 0,
    createdAt: now,
    ...fields,
})
const types = (ops: readonly BoardWorkOperation[]) => ops.map((op) => op.type)
function fakeStore(view: BoardView, answer: (op: BoardWorkOperation) => BoardWorkResult | undefined = () => undefined) {
    const ops: BoardWorkOperation[] = [],
        queries: unknown[] = []
    const store: BoardStore = {
        query: (input) =>
            Effect.sync(() => {
                queries.push(input)
                return view
            }),
        manage: () => Effect.die("Unexpected management"),
        work: (input) =>
            Effect.sync(() => {
                ops.push(input.operation)
                return (
                    answer(input.operation) ??
                    (input.operation.type === "index"
                        ? { type: "index" as const, entries: [] }
                        : input.operation.type === "list"
                          ? { type: "work" as const, deliveries: [], removals: [] }
                          : { type: "progress" as const, recorded: true })
                )
            }),
    }
    return { store, ops, queries }
}
/** A running bot with one board, an open source channel and the reads a board needs */
const started = (
    view: BoardView,
    answer?: (op: BoardWorkOperation) => BoardWorkResult | undefined,
    overwrites: readonly unknown[] = [],
) =>
    Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const s = fakeStore(view, answer),
            publishing = publishingBoundary()
        const options = createBotOptions(
            { token: Redacted.make("synthetic-board-token"), serverId: SERVER },
            { boards: s.store, publishing: publishing.store },
        )
        const bot = yield* createTestBot(options).pipe(Effect.orDie)
        const f = bot.fixtures
        const p = platform(bot, { everyonePermissions: readable })
        bot.rest.respond(`GET /channels/${f.ids.channel}`, {
            body: f.channel({ permission_overwrites: overwrites }),
        })
        bot.rest.respond(`GET /channels/${BOARD_CHANNEL}`, { body: f.channel({ id: BOARD_CHANNEL }) })
        yield* bot.ready()
        yield* settle(bot)
        return { bot, f, p, publishing, ...s }
    })
const react = (bot: Bot, emoji = "⭐", messageId = MESSAGE, userId?: string) =>
    bot.emit("MESSAGE_REACTION_ADD", {
        guild_id: bot.fixtures.ids.guild,
        channel_id: bot.fixtures.ids.channel,
        message_id: messageId,
        user_id: userId ?? bot.fixtures.nextId(),
        emoji: { name: emoji },
    })
const wait = (bot: Bot, ms: number) =>
    Effect.gen(function* () {
        yield* settle(bot)
        yield* TestClock.adjust(`${ms} millis`)
        yield* settle(bot)
    })
const messageRoute = (bot: Bot, count: number, fields: Record<string, unknown> = {}) =>
    bot.rest.respond(`GET /channels/${bot.fixtures.ids.channel}/messages/${MESSAGE}`, {
        body: bot.fixtures.message({
            id: MESSAGE,
            content: "A fine message",
            timestamp: new Date(now - 60000).toISOString(),
            reactions: [{ emoji: { name: "⭐" }, count, me: false }],
            ...fields,
        }),
    })
const reactorsRoute = (bot: Bot, reactors: readonly { id: string; bot?: boolean }[]) =>
    bot.rest.respond((request) => new URL(request.url).pathname.includes("/reactions/"), {
        body: {
            // Fluxer lists reactors in ID order
            items: [...reactors]
                .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
                .map((row) => ({ id: row.id, username: "Synthetic", ...(row.bot ? { bot: true } : {}) })),
            has_more: false,
            next_after: null,
        },
    })

test("Commands name a board and read one change at a time, and anything else is refused", () => {
    assert.deepEqual(parseBoardCommand([]), { type: "list" })
    assert.deepEqual(parseBoardCommand(["add", "Stars", "⭐", "<#5001>"]), {
        type: "add",
        name: "stars",
        emoji: "⭐",
        channelId: "5001",
        threshold: 3,
    })
    assert.deepEqual(parseBoardCommand(["add", "clowns", "<:clown:123>", "<#5001>", "5"]), {
        type: "add",
        name: "clowns",
        emoji: "<:clown:123>",
        channelId: "5001",
        threshold: 5,
    })
    assert.deepEqual(parseBoardCommand(["set", "stars", "self", "on"]), {
        type: "set",
        name: "stars",
        setting: { selfReactions: true },
    })
    assert.deepEqual(parseBoardCommand(["set", "stars", "bots", "off"]), {
        type: "set",
        name: "stars",
        setting: { bots: false },
    })
    assert.deepEqual(parseBoardCommand(["set", "stars", "threshold", "9"]), {
        type: "set",
        name: "stars",
        setting: { threshold: 9 },
    })
    assert.deepEqual(parseBoardCommand(["set", "stars", "emoji", "🤡"]), {
        type: "set",
        name: "stars",
        setting: { emoji: "🤡" },
    })
    assert.deepEqual(parseBoardCommand(["ignore", "add", "stars", "<#5002>"]), {
        type: "ignore",
        name: "stars",
        channelId: "5002",
        ignored: true,
    })
    assert.deepEqual(parseBoardCommand(["ignore", "remove", "stars", "<#5002>"]), {
        type: "ignore",
        name: "stars",
        channelId: "5002",
        ignored: false,
    })
    assert.deepEqual(parseBoardCommand(["module", "off"]), { type: "module", enabled: false })
    assert.deepEqual(parseBoardCommand(["show", "stars"]), { type: "show", name: "stars" })
    assert.deepEqual(parseBoardCommand(["remove", "stars"]), { type: "remove", name: "stars" })
    assert.deepEqual(parseBoardCommand(["help"]), { type: "help" })
    for (const args of [
        ["add", "stars", ":star:", "<#5001>"],
        ["add", "stars", "word", "<#5001>"],
        ["add", "stars", "⭐", "5001x"],
        ["add", "stars", "⭐", "<#5001>", "0"],
        ["add", "stars", "⭐", "<#5001>", "101"],
        ["add", "no spaces!", "⭐", "<#5001>"],
        ["set", "stars", "self", "maybe"],
        ["set", "stars", "unknown", "1"],
        ["ignore", "stars", "<#5001>"],
        ["module", "maybe"],
        ["nonsense"],
    ])
        assert.ok("error" in parseBoardCommand(args), args.join(" "))
    assert.match(boardHelp, /!board add clowns 🤡 #clownboard/)
})

test("A list and a board's card stay short, and a stopped board names its fix", () => {
    const stopped = board({ name: "clowns", emoji: "🤡", problem: "permission" })
    const text = (card: Parameters<typeof renderText>[0]) =>
        renderText(card)
            .map((part) => ("content" in part ? part.content : ""))
            .join("\n")
    const list = text(boardList({ enabled: false, boards: [board(), stopped] }, "!"))
    assert.match(list, /Boards are off/)
    assert.match(list, /stars: ⭐ at 3 in <#5001>, on/)
    assert.match(list, /clowns: 🤡 at 3 in <#5001>, stopped\. NeonFlux lacks View channel/)
    assert.ok(list.split("\n").length <= 10)
    assert.match(text(boardList({ enabled: true, boards: [] }, "!")), /!board add stars/)
    // The fix names the command with the server's own prefix
    const prefixed = text(boardList({ enabled: true, boards: [stopped] }, "?"))
    assert.match(prefixed, /\?board set clowns channel #channel/)
    assert.doesNotMatch(prefixed, /!board/)
    assert.match(text(boardCard(board({ threshold: 1 }), undefined, "!")), /at 1 reaction$/m)
    assert.match(text(boardCard(board(), undefined, "!")), /at 3 reactions$/m)
    const card = boardCard(board({ posted: 4, ignoredChannelIds: ["7"] }), { waiting: 1, uncertain: 2 }, "!")
    assert.ok(card.fields!.length <= 8)
    const shown = text(card)
    assert.match(shown, /4, 1 waiting/)
    assert.match(shown, /2 posts/)
    assert.match(shown, /<#7>/)
})

test("A reaction on an emoji no board uses, and with no board at all, costs nothing", () =>
    run(
        Effect.gen(function* () {
            const none = yield* started({ enabled: true, boards: [] })
            yield* react(none.bot)
            yield* wait(none.bot, BOARD_WAIT_MS)
            assert.deepEqual(none.ops, [], "a server without boards does not even load an index")
            const { bot, ops } = yield* started({ enabled: true, boards: [board()] })
            const message = messageRoute(bot, 9)
            yield* react(bot, "👍")
            yield* wait(bot, BOARD_WAIT_MS)
            assert.equal(message.requests().length, 0)
            assert.deepEqual(types(ops), ["index"])
            assert.equal(bot.failures().length, 0)
        }),
    ))

test("A burst of a board's emoji reads the message once and asks the backend nothing below the threshold", () =>
    run(
        Effect.gen(function* () {
            const { bot, ops } = yield* started({ enabled: true, boards: [board()] })
            const message = messageRoute(bot, 2),
                reactors = reactorsRoute(bot, [])
            for (let i = 0; i < 5; i++) yield* react(bot)
            yield* settle(bot)
            assert.equal(message.requests().length, 0, "the read waits for the burst to end")
            yield* wait(bot, BOARD_WAIT_MS)
            assert.equal(message.requests().length, 1)
            assert.equal(reactors.requests().length, 0)
            assert.deepEqual(types(ops), ["index"])
        }),
    ))

test("At the threshold, the author's reaction and bots do not count unless a board says so, and a reached count queues the post", () =>
    run(
        Effect.gen(function* () {
            const { bot, f, ops } = yield* started({ enabled: true, boards: [board()] })
            const author = f.ids.user
            messageRoute(bot, 4)
            reactorsRoute(bot, [{ id: author }, { id: "7001", bot: true }, { id: "7002" }, { id: "7003" }])
            yield* react(bot)
            yield* wait(bot, BOARD_WAIT_MS)
            assert.deepEqual(types(ops), ["index"], "two of the four count")
            messageRoute(bot, 5)
            reactorsRoute(bot, [
                { id: author },
                { id: "7001", bot: true },
                { id: "7002" },
                { id: "7003" },
                { id: "7004" },
            ])
            yield* react(bot)
            yield* wait(bot, BOARD_WAIT_MS)
            assert.deepEqual(types(ops), ["index", "observe", "list"])
            assert.deepEqual(ops[1], {
                type: "observe",
                name: "stars",
                channelId: f.ids.channel,
                messageId: MESSAGE,
                authorId: author,
                sourceAt: now - 60000,
                count: 3,
                context: {
                    originServerId: f.ids.guild,
                    observedAt: now + 2 * BOARD_WAIT_MS,
                    channelId: BOARD_CHANNEL,
                    botId: f.ids.bot,
                    botAuthorized: true,
                },
            })
        }),
    ))

test("With self on the author's reaction counts", () =>
    run(
        Effect.gen(function* () {
            const { bot, f, ops } = yield* started({ enabled: true, boards: [board({ selfReactions: true })] })
            messageRoute(bot, 3)
            reactorsRoute(bot, [{ id: f.ids.user }, { id: "7002" }, { id: "7003" }])
            yield* react(bot)
            yield* wait(bot, BOARD_WAIT_MS)
            assert.equal((ops[1] as { count: number }).count, 3)
        }),
    ))

test("A channel a board's readers cannot see, an ignored channel and any board's channel cost no read of the message", () =>
    run(
        Effect.gen(function* () {
            const hidden = yield* started({ enabled: true, boards: [board()] }, undefined, [
                { id: SERVER, type: 0, allow: "0", deny: Permissions.ViewChannel.toString() },
            ])
            const first = messageRoute(hidden.bot, 9)
            yield* react(hidden.bot)
            yield* wait(hidden.bot, BOARD_WAIT_MS)
            assert.equal(first.requests().length, 0)
            assert.deepEqual(types(hidden.ops), ["index"])

            const channel = fixtures.ids.channel
            const ignoring = yield* started({ enabled: true, boards: [board({ ignoredChannelIds: [channel] })] })
            const second = messageRoute(ignoring.bot, 9)
            yield* react(ignoring.bot)
            yield* wait(ignoring.bot, BOARD_WAIT_MS)
            assert.equal(second.requests().length, 0)

            yield* boardRuntimes.get(SERVER)!.changed({
                enabled: true,
                boards: [board(), board({ name: "other", emoji: "🤡", channelId: channel })],
            })
            yield* react(ignoring.bot)
            yield* wait(ignoring.bot, BOARD_WAIT_MS)
            assert.equal(second.requests().length, 0, "a reaction inside any board's channel is left alone")
        }),
    ))

test("Messages of bots and webhooks count only with bots on, and system notes never do", () =>
    run(
        Effect.gen(function* () {
            assert.equal(boardBotAuthor({ author: { isBot: true } } as never), true)
            assert.equal(boardBotAuthor({ author: { isBot: false }, webhookId: "9" } as never), true)
            assert.equal(boardBotAuthor({ author: { isBot: false } } as never), false)
            const { bot, f, ops } = yield* started({ enabled: true, boards: [board()] })
            messageRoute(bot, 9, { author: f.botUser() })
            const reactors = reactorsRoute(bot, [])
            yield* react(bot)
            yield* wait(bot, BOARD_WAIT_MS)
            assert.equal(reactors.requests().length, 0)
            messageRoute(bot, 9, { webhook_id: "8888" })
            yield* react(bot)
            yield* wait(bot, BOARD_WAIT_MS)
            assert.deepEqual(types(ops), ["index"])
            yield* boardRuntimes.get(SERVER)!.changed({ enabled: true, boards: [board({ bots: true })] })
            reactorsRoute(bot, [{ id: "7001" }, { id: "7002" }, { id: "7003" }])
            yield* react(bot)
            yield* wait(bot, BOARD_WAIT_MS)
            assert.equal(types(ops).includes("observe"), true)
            ops.length = 0
            messageRoute(bot, 9, { type: 7 })
            yield* react(bot)
            yield* wait(bot, BOARD_WAIT_MS)
            assert.deepEqual(types(ops), [])
        }),
    ))

test("A message with a record waits a minute and reports any count, a removed reaction matters only to it, and a gone source queues removal", () =>
    run(
        Effect.gen(function* () {
            const { bot, f, ops } = yield* started({ enabled: true, boards: [board()] }, (op) =>
                op.type === "index" ? { type: "index", entries: [{ name: "stars", messageId: MESSAGE }] } : undefined,
            )
            messageRoute(bot, 1)
            reactorsRoute(bot, [{ id: "7002" }])
            const removed = (messageId: string) =>
                bot.emit("MESSAGE_REACTION_REMOVE", {
                    guild_id: f.ids.guild,
                    channel_id: f.ids.channel,
                    message_id: messageId,
                    user_id: "7002",
                    emoji: { name: "⭐" },
                })
            yield* removed("6999")
            yield* removed(MESSAGE)
            yield* wait(bot, BOARD_WAIT_MS)
            assert.deepEqual(types(ops), ["index"], "a post's count waits out its minute")
            yield* wait(bot, BOARD_COUNT_WAIT_MS - BOARD_WAIT_MS)
            assert.deepEqual(types(ops).slice(0, 2), ["index", "observe"])
            assert.equal((ops[1] as { count: number }).count, 1)

            ops.length = 0
            yield* bot.emit("MESSAGE_DELETE", { id: "6999", channel_id: f.ids.channel, guild_id: f.ids.guild })
            yield* settle(bot)
            assert.deepEqual(ops, [], "a message without a record costs no call")
            yield* bot.emit("MESSAGE_DELETE", { id: MESSAGE, channel_id: f.ids.channel, guild_id: f.ids.guild })
            yield* settle(bot)
            assert.deepEqual(ops[0], { type: "source-gone", messageIds: [MESSAGE] })
            ops.length = 0
            yield* bot.emit("MESSAGE_DELETE", { id: MESSAGE, channel_id: f.ids.channel, guild_id: f.ids.guild })
            yield* settle(bot)
            assert.deepEqual(ops, [], "the record is forgotten, so a repeated event asks nothing")
        }),
    ))

test("A queued post reads everything fresh, goes through the publisher with the board's context, and posts a card", () =>
    run(
        Effect.gen(function* () {
            let listed = false
            const f = fixtures
            const { bot, ops, publishing } = yield* started({ enabled: true, boards: [board()] }, (op) => {
                if (op.type === "list") {
                    if (listed) return undefined
                    listed = true
                    return {
                        type: "work",
                        deliveries: [
                            {
                                name: "stars",
                                channelId: BOARD_CHANNEL,
                                sourceChannelId: fixtures.ids.channel,
                                messageId: MESSAGE,
                            },
                        ],
                        removals: [],
                    }
                }
                if (op.type === "reserve") {
                    const consumer = { type: "board" as const, boardId: "boardsynthetic", messageId: MESSAGE }
                    const content = {
                        content: "",
                        embed: {
                            author: { name: op.card.authorName },
                            description: op.card.text,
                            fields: [{ name: "Reactions", value: `⭐ ${op.card.count}`, inline: true }],
                        },
                    }
                    const grant: PublishingGrant = {
                        attemptId: "synthetic_board_attempt",
                        postNo: 1,
                        generation: 1,
                        sourceId: boardSourceId("boardsynthetic", MESSAGE, 1),
                        actorId: f.ids.bot,
                        botId: f.ids.bot,
                        channelId: BOARD_CHANNEL,
                        action: "send",
                        source: consumer,
                        provenance: consumer,
                        consumer,
                        content,
                        canonicalContent: canonicalPublishingContent(content),
                        dispatchExpiresAt: now + 180000,
                        nativeDeadlineMs: 5000,
                    }
                    publishing.posts.set(1, {
                        postNo: 1,
                        generation: 1,
                        botId: f.ids.bot,
                        channelId: BOARD_CHANNEL,
                        outcome: "pending",
                        createdAt: now,
                        updatedAt: now,
                        consumer,
                        attempt: { ...grant, outcome: "pending", createdAt: now },
                    } as never)
                    return { type: "reserved", grant }
                }
                return undefined
            })
            messageRoute(bot, 3, {
                attachments: [
                    {
                        id: "9001",
                        filename: "a.png",
                        size: 1,
                        flags: 0,
                        url: "https://cdn.example.test/a.png",
                        content_type: "image/png",
                    },
                ],
            })
            reactorsRoute(bot, [{ id: "7001" }, { id: "7002" }, { id: "7003" }])
            const posts = bot.rest.respond(`POST /channels/${BOARD_CHANNEL}/messages`, (request) => {
                const value = request.body as { content: string; embeds: object[] }
                return {
                    body: f.message({
                        channel_id: BOARD_CHANNEL,
                        author: f.botUser(),
                        content: value.content,
                        embeds: value.embeds.map((embed) => ({ type: "rich", ...embed })),
                    }),
                }
            })
            // The work dispatcher wakes the worker
            yield* boardRuntimes.get(SERVER)!.notify()
            yield* settle(bot)
            const reserve = ops.find((op) => op.type === "reserve") as Extract<BoardWorkOperation, { type: "reserve" }>
            assert.equal(reserve.card.text, "A fine message")
            assert.equal(reserve.card.count, 3)
            assert.equal(reserve.card.imageUrl, "https://cdn.example.test/a.png")
            assert.equal(reserve.card.link, `https://fluxer.app/channels/${f.ids.guild}/${f.ids.channel}/${MESSAGE}`)
            assert.equal(reserve.context.channelId, BOARD_CHANNEL)
            assert.equal(posts.requests().length, 1)
            const dispatch = publishing.calls.find((call) => call.method === "dispatch")
            assert.equal(
                (dispatch?.input as { boardContext: { channelId: string } }).boardContext.channelId,
                BOARD_CHANNEL,
            )
        }),
    ))

test("Only real images reach a card, never a spoiler or a file marked as adult", () => {
    const file = (fields: Record<string, unknown>) =>
        ({ id: "1", filename: "a", size: 1, flags: 0, url: "https://cdn.example.test/a", ...fields }) as never
    assert.equal(boardImage({ attachments: [] }), undefined)
    assert.equal(boardImage({ attachments: [file({ contentType: "video/mp4" })] }), undefined)
    assert.equal(boardImage({ attachments: [file({ contentType: "image/png", flags: 8 })] }), undefined)
    assert.equal(boardImage({ attachments: [file({ contentType: "image/png", nsfw: true })] }), undefined)
    assert.equal(
        boardImage({
            attachments: [
                file({ contentType: "text/plain" }),
                file({ contentType: "image/png", url: "https://cdn.example.test/b" }),
            ],
        }),
        "https://cdn.example.test/b",
    )
})

test("Real roles and channels convert to what the visibility check judges, and a thread counts as its parent", () =>
    run(
        Effect.gen(function* () {
            yield* TestClock.setTime(now)
            const bot = yield* createTestBot({ token: "synthetic-board-token" })
            const f = bot.fixtures,
                server = SERVER,
                view = Permissions.ViewChannel.toString()
            assert.deepEqual(
                boardRole({ id: server, permissions: Permissions.ViewChannel | Permissions.SendMessages }, server),
                { id: "everyone", permissions: ["ViewChannel"] },
            )
            assert.deepEqual(boardRole({ id: "9", permissions: Permissions.Administrator }, server), {
                id: "9",
                permissions: ["Administrator"],
            })
            assert.deepEqual(
                boardChannel(
                    {
                        permissionOverwrites: [
                            { id: server, type: "role", allow: 0n, deny: Permissions.ViewChannel },
                            { id: "7", type: "member", allow: Permissions.ViewChannel, deny: 0n },
                        ],
                        nsfw: false,
                        nsfwOverride: true,
                    } as never,
                    server,
                    "8",
                ),
                {
                    overwrites: [
                        { id: "everyone", type: "role", allow: [], deny: ["ViewChannel"] },
                        { id: "7", type: "member", allow: ["ViewChannel"], deny: [] },
                    ],
                    nsfw: true,
                },
            )
            // NeonFlux's own member overwrite is no reader, and a role with its ID would still count
            assert.deepEqual(
                boardChannel(
                    {
                        permissionOverwrites: [
                            { id: "8", type: "member", allow: Permissions.ViewChannel, deny: 0n },
                            { id: "8", type: "role", allow: Permissions.ViewChannel, deny: 0n },
                        ],
                    } as never,
                    server,
                    "8",
                ).overwrites,
                [{ id: "8", type: "role", allow: ["ViewChannel"], deny: [] }],
            )
            bot.rest.respond("GET /users/@me", { body: f.botUser() })
            bot.rest.respond("GET /guilds/:id/roles", {
                body: [f.role({ id: server, permissions: readable.toString() })],
            })
            const parent = f.channel({
                id: "5101",
                permission_overwrites: [{ id: server, type: 0, allow: "0", deny: view }],
            })
            bot.rest.respond("GET /channels/5101", { body: parent })
            bot.rest.respond("GET /channels/5102", { body: f.channel({ id: "5102" }) })
            bot.rest.respond("GET /channels/5103", {
                body: f.thread({ id: "5103", parent_id: "5102", type: ChannelType.PublicThread }),
            })
            bot.rest.respond("GET /channels/5104", {
                body: f.thread({ id: "5104", parent_id: "5102", type: ChannelType.PrivateThread }),
            })
            bot.rest.respond("GET /channels/5105", {
                body: f.thread({ id: "5105", parent_id: "5101", type: ChannelType.PublicThread }),
            })
            const judged = (source: string) => readBoardVisibility(bot.client, server, source, "5102", false)
            assert.equal(yield* judged("5102"), true)
            assert.equal(yield* judged("5101"), false)
            assert.equal(yield* judged("5103"), true, "a public thread of an open channel")
            assert.equal(yield* judged("5105"), false, "a public thread of a hidden channel")
            assert.equal(yield* judged("5104"), false, "a private thread never reposts")
        }),
    ))

test("The eval's permission order holds on one example of each step", () => {
    const everyone = { id: "everyone", permissions: ["ViewChannel"] }
    const hide = { id: "everyone", type: "role" as const, allow: [], deny: ["ViewChannel"] }
    const show = (id: string) => ({ id, type: "role" as const, allow: ["ViewChannel"], deny: [] })
    const channel = (...overwrites: (typeof hide)[]) => ({ overwrites, nsfw: false })
    const roles = [everyone, { id: "mods", permissions: [] }, { id: "admins", permissions: ["Administrator"] }]
    assert.equal(boardMayRepost(roles, channel(), channel(), true), true)
    assert.equal(boardMayRepost(roles, channel(hide, show("mods") as never), channel(), true), false)
    assert.equal(
        boardMayRepost(roles, channel(hide, show("mods") as never), channel(hide, show("mods") as never), true),
        true,
    )
    assert.equal(boardMayRepost(roles, { overwrites: [], nsfw: true }, channel(), true), false)
    // Eval lists leave history out, while a real server is read literally: With no role holding it only an Administrator reads the source
    assert.equal(boardMayRepost(roles, channel(), channel()), false)
    assert.equal(
        boardMayRepost([{ ...everyone, permissions: ["ViewChannel", "ReadMessageHistory"] }], channel(), channel()),
        true,
    )
})

test("A dashboard change reads the boards again", () =>
    run(
        Effect.gen(function* () {
            const { bot, queries } = yield* started({ enabled: true, boards: [] })
            assert.equal(queries.length, 1)
            yield* reloadServerRuntime(bot.client, SERVER, "boards")
            assert.equal(queries.length, 2)
        }),
    ))

const queued = () => ({
    name: "stars",
    channelId: BOARD_CHANNEL,
    sourceChannelId: fixtures.ids.channel,
    messageId: MESSAGE,
})
/** The worker's answers to one list with one queued post, then nothing */
const oneDelivery = (delivery = queued()) => {
    let listed = false
    return (op: BoardWorkOperation): BoardWorkResult | undefined => {
        if (op.type === "list" && !listed) {
            listed = true
            return { type: "work", deliveries: [delivery], removals: [] }
        }
        return undefined
    }
}
const pass = (bot: Bot) =>
    Effect.gen(function* () {
        yield* boardRuntimes.get(SERVER)!.notify()
        yield* settle(bot)
    })

test("A queued post is dropped when its source became private, is gone, lost its reactions or came from a bot", () =>
    run(
        Effect.gen(function* () {
            // Private since it was queued: The fresh read decides, and the message is not read
            const hidden = yield* started({ enabled: true, boards: [board()] }, oneDelivery(), [
                { id: SERVER, type: 0, allow: "0", deny: Permissions.ViewChannel.toString() },
            ])
            const unread = messageRoute(hidden.bot, 9)
            yield* pass(hidden.bot)
            assert.equal(unread.requests().length, 0)
            assert.deepEqual(
                hidden.ops.find((op) => op.type === "drop"),
                { type: "drop", name: "stars", messageId: MESSAGE },
            )

            // Deleted while it waited
            const gone = yield* started({ enabled: true, boards: [board()] }, oneDelivery())
            gone.bot.rest.respond(`GET /channels/${fixtures.ids.channel}/messages/${MESSAGE}`, {
                status: 404,
                body: { code: "UNKNOWN_MESSAGE", message: "Unknown Message" },
            })
            yield* pass(gone.bot)
            assert.equal(types(gone.ops).includes("drop"), true)
            assert.equal(types(gone.ops).includes("reserve"), false)

            // The reactions were taken back while DEFCON held it
            const fell = yield* started({ enabled: true, boards: [board()] }, oneDelivery())
            messageRoute(fell.bot, 1)
            reactorsRoute(fell.bot, [{ id: "7001" }])
            yield* pass(fell.bot)
            assert.equal(types(fell.ops).includes("drop"), true)

            const fromBot = yield* started({ enabled: true, boards: [board()] }, oneDelivery())
            messageRoute(fromBot.bot, 9, { author: fixtures.botUser() })
            yield* pass(fromBot.bot)
            assert.equal(types(fromBot.ops).includes("drop"), true)
        }),
    ))

test("A board channel that is gone or a forum stops the board once and tells staff, and a failed read waits for the next try", () =>
    run(
        Effect.gen(function* () {
            const stopped = yield* started({ enabled: true, boards: [board()] }, oneDelivery())
            stopped.bot.rest.respond(`GET /channels/${BOARD_CHANNEL}`, {
                status: 404,
                body: { code: "UNKNOWN_CHANNEL", message: "Unknown Channel" },
            })
            stopped.bot.rest.respond("GET /guilds/:id/channels", { body: [fixtures.channel()] })
            yield* pass(stopped.bot)
            assert.deepEqual(
                stopped.ops.find((op) => op.type === "blocked"),
                { type: "blocked", name: "stars", channelId: BOARD_CHANNEL, reason: "channel" },
            )
            assert.equal(boardRuntimes.get(SERVER)!.view().boards[0]!.problem, "channel")
            assert.match(
                (stopped.p.replies.requests().at(-1)!.body as { content: string }).content,
                /Board stars is stopped/,
            )

            // A read that fails for another reason defers the post, and nothing is posted
            const failing = yield* started({ enabled: true, boards: [board()] }, oneDelivery())
            failing.bot.rest.respond(`GET /channels/${fixtures.ids.channel}/messages/${MESSAGE}`, {
                status: 403,
                body: { code: "MISSING_ACCESS", message: "Missing Access" },
            })
            yield* pass(failing.bot)
            assert.deepEqual(
                failing.ops.find((op) => op.type === "defer"),
                { type: "defer", name: "stars", messageId: MESSAGE },
            )
        }),
    ))

test("A removal claims first, a post that is gone ends it, and an unknown outcome is never sent again", () =>
    run(
        Effect.gen(function* () {
            const removal = { entryId: "entry1", channelId: BOARD_CHANNEL, messageId: "8001" }
            let listed = false
            const list = (op: BoardWorkOperation): BoardWorkResult | undefined => {
                if (op.type === "list" && !listed) {
                    listed = true
                    return { type: "work", deliveries: [], removals: [removal] }
                }
                return undefined
            }
            const fine = yield* started({ enabled: true, boards: [board()] }, list)
            const deletes = fine.bot.rest.respond(`DELETE /channels/${BOARD_CHANNEL}/messages/8001`, { status: 204 })
            yield* pass(fine.bot)
            assert.equal(deletes.requests().length, 1)
            assert.deepEqual(fine.ops.slice(2, 4), [
                { type: "remove-claim", entryId: "entry1" },
                { type: "remove-outcome", entryId: "entry1", outcome: "removed" },
            ])

            listed = false
            const gone = yield* started({ enabled: true, boards: [board()] }, list)
            gone.bot.rest.respond(`DELETE /channels/${BOARD_CHANNEL}/messages/8001`, {
                status: 404,
                body: { code: "UNKNOWN_MESSAGE", message: "Unknown Message" },
            })
            yield* pass(gone.bot)
            assert.deepEqual(
                gone.ops.find((op) => op.type === "remove-outcome"),
                { type: "remove-outcome", entryId: "entry1", outcome: "removed" },
            )

            listed = false
            const unknown = yield* started({ enabled: true, boards: [board()] }, list)
            const tried = unknown.bot.rest.respond(`DELETE /channels/${BOARD_CHANNEL}/messages/8001`, { status: 500 })
            yield* pass(unknown.bot)
            yield* pass(unknown.bot)
            assert.ok(tried.requests().length >= 1)
            assert.equal(types(unknown.ops).includes("remove-outcome"), false)
            assert.equal(types(unknown.ops).filter((type) => type === "remove-claim").length, 1)

            // Another worker's claim leaves the post alone
            listed = false
            const claimed = yield* started({ enabled: true, boards: [board()] }, (op) =>
                op.type === "remove-claim" ? { type: "progress", recorded: false } : list(op),
            )
            const untouched = claimed.bot.rest.respond(`DELETE /channels/${BOARD_CHANNEL}/messages/8001`, {
                status: 204,
            })
            yield* pass(claimed.bot)
            assert.equal(untouched.requests().length, 0)
        }),
    ))

test("Managers change boards from chat with the channel checked, other members cannot, and the memory follows", async () => {
    const f = fixtures
    for (const manager of [false, true])
        await run(
            Effect.gen(function* () {
                yield* TestClock.setTime(now)
                const operations: unknown[] = []
                let view: BoardView = { enabled: true, boards: [] }
                const store: BoardStore = {
                    query: () => Effect.succeed({ ...view, detail: { waiting: 0, uncertain: 0 } }),
                    work: () => Effect.succeed({ type: "index", entries: [] }),
                    manage: (input) =>
                        Effect.sync(() => {
                            operations.push(input.operation)
                            if (input.operation.type === "add") view = { enabled: true, boards: [board()] }
                            if (input.operation.type === "remove") view = { enabled: true, boards: [] }
                            return view
                        }),
                }
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token: Redacted.make("synthetic-board-token"), serverId: SERVER },
                        { boards: store },
                    ),
                )
                const p = platform(bot, {
                    actorOwner: false,
                    actorPermissions: manager ? Permissions.ManageGuild : Permissions.SendMessages,
                })
                const forum = f.forumChannel()
                bot.rest.respond(`GET /channels/${forum.id}`, { body: forum })
                yield* bot.ready()
                const say = (content: string) =>
                    bot.emit("MESSAGE_CREATE", f.message({ content })).pipe(Effect.andThen(settle(bot)))
                const last = () => (p.replies.requests().at(-1)!.body as { content: string }).content
                yield* say(`!board add stars ⭐ <#${f.ids.channel}>`)
                if (!manager) {
                    assert.deepEqual(operations, [])
                    assert.match(last(), /Only the server owner/)
                    return
                }
                assert.deepEqual(operations, [
                    { type: "add", name: "stars", emoji: "⭐", channelId: f.ids.channel, threshold: 3 },
                ])
                assert.match(last(), /Board stars saved/)
                assert.equal(boardRuntimes.get(SERVER)!.view().boards.length, 1)
                yield* say(`!board add clowns 🤡 <#${forum.id}>`)
                assert.equal(operations.length, 1)
                assert.match(last(), /Choose a text or announcement channel/)
                yield* say("!board set stars threshold 5")
                assert.deepEqual(operations.at(-1), { type: "set", name: "stars", threshold: 5 })
                yield* say("!board show stars")
                yield* say("!board show nothing")
                yield* say("!board remove stars")
                assert.deepEqual(operations.at(-1), { type: "remove", name: "stars" })
                assert.match(last(), /Its posts stay/)
                assert.equal(boardRuntimes.get(SERVER)!.view().boards.length, 0)
            }),
        )
})

test("Fluxer's missing overwrite list leaves a source's readers unknown, and NeonFlux's own overwrite lets a private board match a private channel", () =>
    run(
        Effect.gen(function* () {
            yield* TestClock.setTime(now)
            const bot = yield* createTestBot({ token: "synthetic-board-token" })
            const f = bot.fixtures,
                view = Permissions.ViewChannel.toString(),
                hide = { id: SERVER, type: 0, allow: "0", deny: view },
                staff = { id: "7700", type: 0, allow: view, deny: "0" },
                self = { id: f.ids.bot, type: 1, allow: view, deny: "0" }
            bot.rest.respond("GET /users/@me", { body: f.botUser() })
            bot.rest.respond("GET /guilds/:id/roles", {
                body: [
                    f.role({ id: SERVER, permissions: readable.toString() }),
                    f.role({ id: "7700", permissions: "0" }),
                ],
            })
            const { permission_overwrites: _, ...bare } = f.channel({ id: "5201" })
            bot.rest.respond("GET /channels/5201", { body: bare })
            bot.rest.respond("GET /channels/5202", { body: f.channel({ id: "5202", permission_overwrites: [] }) })
            bot.rest.respond("GET /channels/5203", {
                body: f.channel({ id: "5203", permission_overwrites: [hide, staff] }),
            })
            bot.rest.respond("GET /channels/5204", {
                body: f.channel({ id: "5204", permission_overwrites: [hide, staff, self] }),
            })
            bot.rest.respond("GET /channels/5205", {
                body: f.channel({
                    id: "5205",
                    permission_overwrites: [hide, staff, { id: "7701", type: 1, allow: view, deny: "0" }],
                }),
            })
            const judged = (source: string, target: string) =>
                readBoardVisibility(bot.client, SERVER, source, target, false)
            assert.equal(yield* judged("5201", "5202"), undefined)
            assert.equal(yield* judged("5203", "5204"), true, "only NeonFlux's own overwrite differs")
            assert.equal(yield* judged("5203", "5205"), false, "another member's overwrite still blocks")
        }),
    ))

test("A card whose source its readers may no longer see is withdrawn at the next reaction, with no count sent", () =>
    run(
        Effect.gen(function* () {
            const { bot, ops } = yield* started(
                { enabled: true, boards: [board()] },
                (op) =>
                    op.type === "index"
                        ? { type: "index", entries: [{ name: "stars", messageId: MESSAGE }] }
                        : undefined,
                [{ id: SERVER, type: 0, allow: "0", deny: Permissions.ViewChannel.toString() }],
            )
            const message = messageRoute(bot, 5)
            reactorsRoute(bot, [])
            yield* react(bot)
            yield* wait(bot, BOARD_COUNT_WAIT_MS)
            assert.equal(types(ops).includes("observe"), false)
            assert.deepEqual(
                ops.find((op) => op.type === "withdraw"),
                { type: "withdraw", name: "stars", messageId: MESSAGE },
            )
            assert.equal(message.requests().length, 1)
            // The memory forgets it, so a later reaction counts as new and is refused from memory
            ops.length = 0
            yield* react(bot)
            yield* wait(bot, BOARD_WAIT_MS)
            assert.deepEqual(types(ops), [])
            assert.equal(message.requests().length, 1)
        }),
    ))

test("A deleted channel asks for its posts and its threads' posts, a deleted thread for its own, and with no boards neither calls", () =>
    run(
        Effect.gen(function* () {
            const none = yield* started({ enabled: true, boards: [] })
            yield* none.bot.emit("CHANNEL_DELETE", fixtures.channel({ id: "5301" }))
            yield* settle(none.bot)
            assert.deepEqual(none.ops, [])

            let pages = 0
            const { bot, ops } = yield* started({ enabled: true, boards: [board()] }, (op) =>
                op.type === "source-channel-gone" && !op.parent && pages++ === 0
                    ? { type: "progress", recorded: true, cursor: "next" }
                    : undefined,
            )
            ops.length = 0
            yield* bot.emit("CHANNEL_DELETE", fixtures.channel({ id: "5301" }))
            yield* settle(bot)
            const gone = ops.filter((op) => op.type === "source-channel-gone")
            assert.deepEqual(gone, [
                { type: "source-channel-gone", channelId: "5301", parent: false },
                { type: "source-channel-gone", channelId: "5301", parent: false, cursor: "next" },
                { type: "source-channel-gone", channelId: "5301", parent: true },
            ])
            assert.equal(types(ops).includes("list"), true, "the worker wakes for the removals")
            ops.length = 0
            yield* bot.emit("THREAD_DELETE", {
                id: "5302",
                guild_id: SERVER,
                parent_id: fixtures.ids.channel,
                type: ChannelType.PublicThread,
            })
            yield* settle(bot)
            assert.deepEqual(
                ops.filter((op) => op.type === "source-channel-gone"),
                [{ type: "source-channel-gone", channelId: "5302", parent: false }],
            )
        }),
    ))

test("The reactor read names the emoji as the message holds it, once, whichever form the event or the board has", () =>
    run(
        Effect.gen(function* () {
            const { bot, ops } = yield* started({ enabled: true, boards: [board({ emoji: "❤" })] })
            messageRoute(bot, 0, { reactions: [{ emoji: { name: "❤\ufe0f" }, count: 3, me: false }] })
            const read: string[] = []
            bot.rest.respond(
                (request) => new URL(request.url).pathname.includes("/reactions/"),
                (request) => {
                    read.push(decodeURIComponent(new URL(request.url).pathname.split("/").at(-2)!))
                    return {
                        body: {
                            items: ["7001", "7002", "7003"].map((id) => ({ id, username: "Synthetic" })),
                            has_more: false,
                            next_after: null,
                        },
                    }
                },
            )
            yield* react(bot, "❤")
            yield* wait(bot, BOARD_WAIT_MS)
            assert.deepEqual(read, ["❤\ufe0f"])
            assert.equal((ops.find((op) => op.type === "observe") as { count: number }).count, 3)
        }),
    ))

test("A deleted board channel stops that board through a reaction, with a note, and another board on the emoji still counts", () =>
    run(
        Effect.gen(function* () {
            const { bot, ops, p } = yield* started({
                enabled: true,
                boards: [board(), board({ name: "other", channelId: "5002" })],
            })
            bot.rest.respond("GET /channels/5002", {
                body: fixtures.channel({ id: "5002", permission_overwrites: [] }),
            })
            bot.rest.respond(`GET /channels/${BOARD_CHANNEL}`, {
                status: 404,
                body: { code: "UNKNOWN_CHANNEL", message: "Unknown Channel" },
            })
            bot.rest.respond("GET /guilds/:id/channels", { body: [fixtures.channel()] })
            messageRoute(bot, 3)
            reactorsRoute(bot, [{ id: "7001" }, { id: "7002" }, { id: "7003" }])
            yield* react(bot)
            yield* wait(bot, BOARD_WAIT_MS)
            assert.deepEqual(
                ops.find((op) => op.type === "blocked"),
                { type: "blocked", name: "stars", channelId: BOARD_CHANNEL, reason: "channel" },
            )
            assert.equal(boardRuntimes.get(SERVER)!.view().boards[0]!.problem, "channel")
            assert.match((p.replies.requests().at(-1)!.body as { content: string }).content, /Board stars is stopped/)
            assert.equal((ops.find((op) => op.type === "observe") as { name: string }).name, "other")
            assert.equal(bot.failures().length, 0)
        }),
    ))

test("A moved board judges an old card against the channel the card stands in", () =>
    run(
        Effect.gen(function* () {
            const view = Permissions.ViewChannel.toString(),
                hide = { id: SERVER, type: 0, allow: "0", deny: view },
                staff = { id: "7700", type: 0, allow: view, deny: "0" }
            const entries = [{ name: "stars", messageId: MESSAGE, channelId: "5008" }]
            const answer = (op: BoardWorkOperation): BoardWorkResult | undefined =>
                op.type === "index" ? { type: "index", entries } : undefined
            // The source is staff-only. The card's old channel is too, though the board now points at an open one: The card may stay
            const stays = yield* started({ enabled: true, boards: [board()] }, answer, [hide, staff])
            stays.bot.rest.respond("GET /channels/5008", {
                body: fixtures.channel({ id: "5008", permission_overwrites: [hide, staff] }),
            })
            messageRoute(stays.bot, 3)
            reactorsRoute(stays.bot, [{ id: "7001" }])
            yield* react(stays.bot)
            yield* wait(stays.bot, BOARD_COUNT_WAIT_MS)
            assert.equal(types(stays.ops).includes("withdraw"), false)
            assert.equal(types(stays.ops).includes("observe"), true)
            // The other way round: The old channel is open, though the board now points at a staff channel: The card goes
            const goes = yield* started({ enabled: true, boards: [board()] }, answer, [hide, staff])
            goes.bot.rest.respond(`GET /channels/${BOARD_CHANNEL}`, {
                body: fixtures.channel({ id: BOARD_CHANNEL, permission_overwrites: [hide, staff] }),
            })
            goes.bot.rest.respond("GET /channels/5008", {
                body: fixtures.channel({ id: "5008", permission_overwrites: [] }),
            })
            messageRoute(goes.bot, 3)
            yield* react(goes.bot)
            yield* wait(goes.bot, BOARD_COUNT_WAIT_MS)
            assert.equal(types(goes.ops).includes("withdraw"), true)
        }),
    ))

test("A rate-limited delete tries again instead of counting as removed", () =>
    run(
        Effect.gen(function* () {
            const removal = { entryId: "entry1", channelId: BOARD_CHANNEL, messageId: "8001" }
            let listed = false
            const { bot, ops } = yield* started({ enabled: true, boards: [board()] }, (op) => {
                if (op.type === "list" && !listed) {
                    listed = true
                    return { type: "work", deliveries: [], removals: [removal] }
                }
                return undefined
            })
            bot.rest.respond(`DELETE /channels/${BOARD_CHANNEL}/messages/8001`, {
                status: 429,
                headers: { "retry-after": "6" },
                body: { message: "Synthetic rate limit", retry_after: 6, global: false },
            })
            yield* boardRuntimes.get(SERVER)!.notify()
            yield* wait(bot, 6000)
            yield* settle(bot)
            assert.deepEqual(
                ops.find((op) => op.type === "remove-outcome"),
                { type: "remove-outcome", entryId: "entry1", outcome: "retry" },
            )
        }),
    ))
