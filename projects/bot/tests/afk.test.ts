import assert from "node:assert/strict"
import test from "node:test"
import { MessageType } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Redacted } from "effect"
import { AfkStoreError, type AfkStatus, type AfkStore } from "../src/afk-store.ts"
import { createBotOptions } from "../src/bot.ts"

const token = Redacted.make("synthetic-neonflux-test-token")

function memoryStore() {
    const statuses = new Map<string, AfkStatus>()
    const calls: Array<{ operation: string, userId: string, mentions?: readonly string[] }> = []
    const store: AfkStore = {
        set: (userId, reason) => Effect.sync(() => {
            calls.push({ operation: "set", userId })
            const status = { userId, reason, since: 1234 }
            statuses.set(userId, status)
            return status
        }),
        observe: (userId, mentions) => Effect.sync(() => {
            calls.push({ operation: "observe", userId, mentions })
            return {
                cleared: statuses.delete(userId),
                statuses: mentions.flatMap((id) => statuses.has(id) ? [statuses.get(id)!] : []),
            }
        }),
    }
    return { store, statuses, calls }
}

test("AFK sets, updates, defaults, displays mentions without notifications, and clears on return", async () => {
    const fixture = createFixtures()
    const memory = memoryStore()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixture.ids.guild }, { afk: memory.store }))
        const replies = bot.rest.respond("POST /channels/:id/messages", { body: bot.fixtures.message() })
        yield* bot.ready()
        const userId = bot.fixtures.ids.user
        for (const [content, reason] of [["!afk Lunch", "Lunch"], ["!afk   ", "Away"], ["!AFK @everyone <@123456789012345678>", "@everyone <@123456789012345678>"]]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content }))
            yield* bot.idle()
            assert.equal(memory.statuses.get(userId)?.reason, reason)
            assert.equal(memory.calls.at(-1)?.operation, "set")
        }
        assert.equal(memory.calls.filter((call) => call.operation === "observe").length, 0)
        const mentioningUser = bot.fixtures.user({ id: bot.fixtures.nextId() })
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({
            content: `<@${userId}>`, author: mentioningUser, mentions: [bot.fixtures.user()],
        }))
        yield* bot.idle()
        const mentionReply = replies.requests().at(-1)!.body as { content: string, allowed_mentions: unknown }
        assert.equal(mentionReply.content, `<@${userId}> is AFK: @everyone <@123456789012345678>`)
        assert.deepEqual(mentionReply.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        assert.ok(memory.statuses.has(userId))

        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "I'm back", type: MessageType.Reply }))
        yield* bot.idle()
        assert.ok(!memory.statuses.has(userId))
        assert.equal((replies.requests().at(-1)!.body as { content: string }).content, "Welcome back! Your AFK status has been cleared")
        assert.equal(replies.requests().length, 5)
        assert.equal(bot.failures().length, 0)
    })))
})

test("AFK ignores bots, webhooks, DMs, other servers, and system messages and bounds mentions and reasons", async () => {
    const fixture = createFixtures()
    const memory = memoryStore()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixture.ids.guild }, { afk: memory.store }))
        const replies = bot.rest.respond("POST /channels/:id/messages", { body: bot.fixtures.message() })
        yield* bot.ready()
        const direct = { ...bot.fixtures.message({ content: "!afk" }) }
        delete direct.guild_id
        for (const message of [
            bot.fixtures.message({ content: "!afk", author: bot.fixtures.botUser() }),
            bot.fixtures.message({ content: "!afk", webhook_id: bot.fixtures.nextId() }),
            direct,
            bot.fixtures.message({ content: "!afk", guild_id: bot.fixtures.nextId() }),
            bot.fixtures.message({ content: "!afk", type: MessageType.UserJoin }),
        ]) yield* bot.emit("MESSAGE_CREATE", message)
        yield* bot.idle()
        assert.equal(memory.calls.length, 0)
        assert.equal(replies.requests().length, 0)

        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!afk ${"🙂".repeat(101)}` }))
        yield* bot.idle()
        assert.equal(memory.calls.length, 0)
        assert.match((replies.requests().at(-1)!.body as { content: string }).content, /200 characters/)

        const mentions = Array.from({ length: 7 }, () => bot.fixtures.user({ id: bot.fixtures.nextId() }))
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({
            content: "hello", mentions: [bot.fixtures.user(), mentions[0]!, ...mentions],
        }))
        yield* bot.idle()
        assert.deepEqual(memory.calls.at(-1)?.mentions, mentions.slice(0, 5).map((user) => user.id))
        assert.equal(bot.failures().length, 0)
    })))
})

test("a subsequent prefix command clears AFK while ping still replies", async () => {
    const fixture = createFixtures()
    const memory = memoryStore()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixture.ids.guild }, { afk: memory.store }))
        const replies = bot.rest.respond("POST /channels/:id/messages", { body: bot.fixtures.message() })
        yield* bot.ready()
        for (const command of ["!ping", "!unknown"]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!afk" }))
            yield* bot.idle()
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: command }))
            yield* bot.idle()
            assert.ok(!memory.statuses.has(bot.fixtures.ids.user))
        }
        assert.equal(replies.requests().filter((request) => (request.body as { content: string }).content === "Pong!").length, 1)
        assert.equal(bot.failures().length, 0)
    })))
})

test("serialized AFK events finish setting before a queued return clears the status", async () => {
    const fixture = createFixtures()
    const memory = memoryStore()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const order: string[] = []
        const store: AfkStore = {
            ...memory.store,
            set: (userId, reason) => Effect.gen(function* () {
                order.push("set started")
                yield* Deferred.succeed(started, undefined)
                yield* Deferred.await(release)
                const status = yield* memory.store.set(userId, reason)
                order.push("set completed")
                return status
            }),
            observe: (userId, mentions) => Effect.gen(function* () {
                order.push("observed")
                return yield* memory.store.observe(userId, mentions)
            }),
        }
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixture.ids.guild }, { afk: store }))
        bot.rest.respond("POST /channels/:id/messages", { body: bot.fixtures.message() })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!afk Lunch" }))
        yield* Deferred.await(started)
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "returned" }))
        yield* Deferred.succeed(release, undefined)
        yield* bot.idle()
        assert.deepEqual(order, ["set started", "set completed", "observed"])
        assert.equal(memory.statuses.size, 0)
        assert.equal(bot.failures().length, 0)
    })))
})

test("backend failures do not confirm AFK and observation failure leaves the bot usable", async () => {
    const fixture = createFixtures()
    const store: AfkStore = {
        set: () => Effect.fail(new AfkStoreError({ operation: "set" })),
        observe: () => Effect.fail(new AfkStoreError({ operation: "observe" })),
    }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({
            ...createBotOptions({ token, serverId: fixture.ids.guild }, { afk: store }),
            logging: { dedupe: false },
        })
        const replies = bot.rest.respond("POST /channels/:id/messages", { body: bot.fixtures.message() })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!afk" }))
        yield* bot.idle()
        assert.match((replies.requests().at(-1)!.body as { content: string }).content, /couldn't confirm/)
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "returned" }))
        yield* bot.idle()
        assert.equal(bot.failures().length, 1)
        assert.equal(replies.requests().length, 1)
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!ping" }))
        yield* bot.idle()
        assert.equal(bot.failures().length, 2)
        assert.equal((replies.requests().at(-1)!.body as { content: string }).content, "Pong!")
        assert.equal(bot.client.state, "Connected")
    })))
})
