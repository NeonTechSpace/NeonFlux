import assert from "node:assert/strict"
import test from "node:test"
import { runBot, type Client } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { parseDeploymentScope } from "../src/server-scope.ts"
import { fakeClient, quietSignal } from "./backend-fake.ts"

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

// Dispatch types that deliver the events NeonFlux handles, including GUILD_CREATE for multi-mode registration
const handledDispatches = ["MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_DELETE", "MESSAGE_DELETE_BULK", "GUILD_MEMBER_ADD", "GUILD_MEMBER_UPDATE", "GUILD_MEMBER_REMOVE",
    "GUILD_ROLE_CREATE", "GUILD_ROLE_UPDATE", "GUILD_ROLE_DELETE", "GUILD_ROLE_UPDATE_BULK", "CHANNEL_CREATE", "CHANNEL_UPDATE", "CHANNEL_DELETE", "CHANNEL_UPDATE_BULK",
    "GUILD_CREATE", "GUILD_UPDATE", "GUILD_DELETE", "GUILD_AUDIT_LOG_ENTRY_CREATE", "MESSAGE_REACTION_ADD", "MESSAGE_REACTION_REMOVE", "MESSAGE_REACTION_REMOVE_ALL",
    "MESSAGE_REACTION_REMOVE_EMOJI", "VOICE_STATE_UPDATE", "THREAD_CREATE", "THREAD_UPDATE", "THREAD_DELETE", "THREAD_LIST_SYNC"]

for (const mode of ["single", "multi"] as const) {
    test(`${mode} mode asks Fluxer to skip unhandled dispatches and keeps every handled one`, async t => {
        const fixtures = createFixtures()
        const client = fakeClient(call => {
            if (call.path === "/service/scope") return { mode: "multi" }
            if (call.path === "/service/installations/list") return { serverIds: [], nextCursor: null }
            if (call.path === "/service/work") return { kinds: { dashboard: [], verification: [], events: [], schedules: [], milestones: [], suggestions: [], cleanup: [], metadata: [], levels: [] }, cursor: null, nextDueIn: null }
            throw new Error(`Unexpected backend request ${call.path}`)
        }, quietSignal)
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const config = mode === "single" ? { token, serverId: fixtures.ids.guild }
                : { token, scope: parseDeploymentScope({ NEONFLUX_SERVER_MODE: "multi" }), backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-secret"), client } }
            const bot = yield* createTestBot(createBotOptions(config))
            bot.rest.respond("GET /users/@me/guilds", { body: [] })
            yield* bot.ready()
            const identify = bot.commands().find(command => command.op === 2)!.d as { ignored_events?: string[] }
            const ignored = identify.ignored_events ?? []
            assert.ok(ignored.includes("TYPING_START") && ignored.includes("PRESENCE_UPDATE") && ignored.includes("CHANNEL_PINS_UPDATE"))
            assert.deepEqual(handledDispatches.filter(type => ignored.includes(type)), [])
            // The in-memory gateway refuses a dispatch that the session asked Fluxer not to send
            const typing = yield* Effect.exit(bot.emit("TYPING_START", { guild_id: fixtures.ids.guild, channel_id: fixtures.ids.channel, user_id: fixtures.ids.user, timestamp: 1 }))
            assert.equal(typing._tag, "Failure")
            yield* bot.idle()
        })))
    })
}
