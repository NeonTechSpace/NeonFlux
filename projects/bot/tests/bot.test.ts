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

    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
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
        assert.equal((reply.body as { message_reference: { message_id: string } }).message_reference.message_id, incoming.id)
        assert.equal(replies.requests().length, 1)
        assert.equal(bot.failures().length, 0)
    })))

    assert.equal(client?.state, "Closed")
})

test("bot messages, DMs, other servers, and unrelated messages receive no reply", async () => {
    const fixtures = createFixtures()

    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }))
        const replies = bot.rest.respond("POST /channels/:id/messages", {
            body: bot.fixtures.message({ content: "Pong!" }),
        })
        yield* bot.ready()

        const directMessage = { ...bot.fixtures.message({ content: "!ping" }) }
        delete directMessage.guild_id
        const messages = [
            bot.fixtures.message({ content: "!ping", author: bot.fixtures.botUser() }),
            directMessage,
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
    })))
})

test("a rejected reply is reported once and the bot can handle the next command", async () => {
    const fixtures = createFixtures()

    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
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
    })))
})

test("a stop requested before startup completes without registering process listeners", async () => {
    const fixtures = createFixtures()
    const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]

    await Effect.runPromise(runBot({
        ...createBotOptions({ token, serverId: fixtures.ids.guild }),
        signal: AbortSignal.abort(),
        reportFailure: false,
    }))

    assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], before)
})
