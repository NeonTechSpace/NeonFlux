import assert from "node:assert/strict"
import test from "node:test"
import { runBot, type Client } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { createBotOptions } from "../src/bot.ts"

const token = Redacted.make("synthetic-neonflux-test-token")

test("ping replies in the configured server and scope closure stops the client", async () => {
    const fixtures = createFixtures()
    let client: Client | undefined

    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }))
                client = bot.client
                const replies = bot.rest.respond("POST /channels/:id/messages", {
                    body: bot.fixtures.message({ content: "Pong!" }),
                })
                yield* bot.ready()
                assert.equal(bot.client.state, "Connected")

                const incoming = bot.fixtures.message({ content: "!ping" })
                yield* bot.emit("MESSAGE_CREATE", incoming)
                const reply = yield* replies.next()
                yield* bot.idle()

                assert.equal(reply.method, "POST")
                assert.equal(reply.path, `/channels/${incoming.channel_id}/messages`)
                assert.equal((reply.body as { content: string }).content, "Pong!")
                assert.equal(
                    (reply.body as { message_reference: { message_id: string } }).message_reference.message_id,
                    incoming.id,
                )
                assert.equal(replies.requests().length, 1)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )

    assert.equal(client?.state, "Closed")
})

test("bot messages, other servers, and unrelated messages receive no reply", async () => {
    const fixtures = createFixtures()

    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }))
                const replies = bot.rest.respond("POST /channels/:id/messages", {
                    body: bot.fixtures.message({ content: "Pong!" }),
                })
                yield* bot.ready()

                const messages = [
                    bot.fixtures.message({ content: "!ping", author: bot.fixtures.botUser() }),
                    bot.fixtures.message({ content: "!ping", guild_id: bot.fixtures.nextId() }),
                    bot.fixtures.message({ content: "hello" }),
                    bot.fixtures.message({ content: "!unknown" }),
                ]
                for (const message of messages) {
                    yield* bot.emit("MESSAGE_CREATE", message)
                }
                yield* bot.idle()

                assert.equal(replies.requests().length, 0)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("a rejected reply is reported once and the bot can handle the next command", async () => {
    const fixtures = createFixtures()

    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }))
                const denied = bot.rest.respond("POST /channels/:id/messages", {
                    status: 403,
                    body: { code: "MISSING_PERMISSIONS", message: "Missing permissions" },
                })
                yield* bot.ready()
                yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!ping" }))
                yield* denied.next()
                yield* bot.idle()

                assert.equal(denied.requests().length, 1)
                assert.equal(bot.failures().length, 1)
                assert.equal(bot.client.state, "Connected")
                denied.remove()

                const replies = bot.rest.respond("POST /channels/:id/messages", {
                    body: bot.fixtures.message({ content: "Pong!" }),
                })
                yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!ping" }))
                const reply = yield* replies.next()
                yield* bot.idle()
                assert.equal((reply.body as { content: string }).content, "Pong!")
                assert.equal(replies.requests().length, 1)
            }),
        ),
    )
})

test("a feature without its storage says it is not set up", async () => {
    const fixtures = createFixtures()

    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }))
                const replies = bot.rest.respond("POST /channels/:id/messages", {
                    body: bot.fixtures.message({ content: "Synthetic reply" }),
                })
                yield* bot.ready()
                for (const [content, feature] of [
                    ["!ticket list", "Tickets"],
                    ["!verify status", "Rules verification"],
                    ["!auto list", "Autoresponders"],
                ] as const) {
                    yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content }))
                    yield* bot.idle()
                    assert.equal(
                        (replies.requests().at(-1)?.body as { content: string }).content,
                        `${feature} isn't available on this NeonFlux yet. The bot operator needs to finish setting it up`,
                    )
                }
                assert.equal(replies.requests().length, 3)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("a stop requested before startup completes without registering process listeners", async () => {
    const fixtures = createFixtures()
    const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]

    await Effect.runPromise(
        runBot({
            ...createBotOptions({ token, serverId: fixtures.ids.guild }),
            signal: AbortSignal.abort(),
            reportFailure: false,
        }),
    )

    assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], before)
})

// Dispatch types of the events NeonFlux handles and of those its SDK caches need
const handledDispatches = [
    "MESSAGE_CREATE",
    "MESSAGE_UPDATE",
    "GUILD_MEMBER_ADD",
    "GUILD_MEMBER_UPDATE",
    "GUILD_MEMBER_REMOVE",
    "CHANNEL_UPDATE",
    "CHANNEL_DELETE",
    "CHANNEL_UPDATE_BULK",
    "GUILD_CREATE",
    "GUILD_DELETE",
    "MESSAGE_REACTION_ADD",
    "MESSAGE_REACTION_REMOVE",
    "MESSAGE_REACTION_REMOVE_ALL",
    "MESSAGE_REACTION_REMOVE_EMOJI",
    "THREAD_CREATE",
    "THREAD_UPDATE",
    "THREAD_DELETE",
    "THREAD_LIST_SYNC",
]

test("the bot asks Fluxer to skip unhandled dispatches and keeps every handled one", async () => {
    const fixtures = createFixtures()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }))
                yield* bot.ready()
                const identify = bot.commands().find((command) => command.op === 2)!.d as {
                    ignored_events?: string[]
                }
                const ignored = identify.ignored_events ?? []
                assert.ok(
                    ignored.includes("TYPING_START") &&
                        ignored.includes("PRESENCE_UPDATE") &&
                        ignored.includes("CHANNEL_PINS_UPDATE"),
                )
                assert.deepEqual(
                    handledDispatches.filter((type) => ignored.includes(type)),
                    [],
                )
                // The in-memory gateway refuses a dispatch that the session asked Fluxer not to send
                const typing = yield* Effect.exit(
                    bot.emit("TYPING_START", {
                        guild_id: fixtures.ids.guild,
                        channel_id: fixtures.ids.channel,
                        user_id: fixtures.ids.user,
                        timestamp: 1,
                    }),
                )
                assert.equal(typing._tag, "Failure")
                yield* bot.idle()
            }),
        ),
    )
})
