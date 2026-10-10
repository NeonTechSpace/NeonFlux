import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import type * as D from "@neonflux/backend/dashboard-contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { StickyStoreError, type StickyStore } from "../src/sticky-store.ts"
import { processDashboardConfigurationPass } from "../src/dashboard-configuration.ts"
import { mockBackend } from "./backend-fake.ts"

const token = Redacted.make("synthetic-sticky-test-token")
const channelId = "5001", memberId = "6001", adminId = "6003", serverOwnerId = "6009"
const sticky = (fields: Partial<C.StickyMessage> = {}): C.StickyMessage => ({ channelId, content: "Read the pinned rules", intervalSeconds: 30, messageId: "900", revision: 1, updatedAt: 0, ...fields })

/** The backend's sticky rules in memory, including the check that keeps one of two racing copies */
function memoryStore(initial: C.StickyMessage[] = []) {
    const rows = new Map(initial.map(row => [row.channelId, row])), calls: { method: string, input: unknown }[] = []
    let rejectNext = false
    const store: StickyStore = {
        list: input => Effect.sync(() => { calls.push({ method: "list", input }); return { stickies: [...rows.values()] } }),
        manage: input => Effect.suspend((): Effect.Effect<C.StickyManageResult, StickyStoreError> => {
            calls.push({ method: "manage", input: input.operation })
            const op = input.operation, row = rows.get(op.channelId)
            if (op.type === "remove") {
                if (!row) return Effect.fail(new StickyStoreError({ operation: "manage", status: 404 }))
                rows.delete(op.channelId)
                return Effect.succeed({ type: "removed", sticky: row })
            }
            const next = row ? { ...row, ...(op.content ? { content: op.content } : {}), ...(op.intervalSeconds ? { intervalSeconds: op.intervalSeconds } : {}), revision: row.revision + 1 }
                : sticky({ channelId: op.channelId, content: op.content!, messageId: null })
            rows.set(op.channelId, next)
            return Effect.succeed({ type: "saved", sticky: next })
        }),
        posted: input => Effect.sync((): C.StickyPostedResult => {
            calls.push({ method: "posted", input })
            const row = rows.get(input.channelId)
            if (rejectNext || !row || row.revision !== input.revision || row.messageId !== input.previousMessageId) {
                rejectNext = false
                return { accepted: false, sticky: row ?? null }
            }
            const next = { ...row, messageId: input.messageId }
            rows.set(input.channelId, next)
            return { accepted: true, sticky: next }
        }),
    }
    return { store, calls, rows, rejectNextPost: () => { rejectNext = true } }
}

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const segment = (path: string, index: number) => path.split("/")[index]!
function platform(bot: Bot) {
    const f = bot.fixtures
    const botRole = f.role({ position: 20, permissions: Permissions.Administrator.toString() }), adminRole = f.role({ position: 10, permissions: Permissions.Administrator.toString() })
    bot.rest.respond("GET /guilds/:id", { body: f.guild({ owner_id: serverOwnerId }) })
    bot.rest.respond("GET /guilds/:id/roles", { body: [f.role({ id: f.ids.guild, permissions: "0" }), botRole, adminRole] })
    bot.rest.respond("GET /guilds/:id/members/:id", request => {
        const userId = segment(request.path, 4)
        return { body: f.member({ user: userId === f.ids.bot ? f.botUser() : f.user({ id: userId }), roles: userId === f.ids.bot ? [botRole.id] : userId === adminId ? [adminRole.id] : [] }) }
    })
    bot.rest.respond("GET /channels/:id", request => ({ body: f.channel({ id: segment(request.path, 2), type: 0 }) }))
    let next = 1000, failSends = 0, history: unknown[] = []
    // A failed send stands for one whose answer was lost, so it may still have reached the channel
    const messages = bot.rest.respond("POST /channels/:id/messages", request => failSends > 0 ? (failSends--, { status: 503, body: { code: "SERVICE_UNAVAILABLE", message: "Service Unavailable" } })
        : { body: f.message({ id: String(++next), channel_id: segment(request.path, 2), author: f.botUser(), content: (request.body as { content: string }).content }) })
    const remove = bot.rest.respond("DELETE /channels/:id/messages/:id", { status: 204 })
    const reads = bot.rest.respond("GET /channels/:id/messages", () => ({ body: history }))
    return {
        failNextSend: () => { failSends = 1 },
        setHistory: (messages: unknown[]) => { history = messages },
        historyReads: () => reads.requests().map(request => new URL(request.url).searchParams.get("limit")),
        copies: () => messages.requests().filter(request => (request.body as { content: string }).content !== undefined && !(request.body as { message_reference?: unknown }).message_reference).map(request => (request.body as { content: string }).content),
        replies: () => messages.requests().filter(request => (request.body as { message_reference?: unknown }).message_reference).map(request => (request.body as { content: string }).content),
        deleted: () => remove.requests().map(request => segment(request.path, 4)),
    }
}
const say = (bot: Bot, userId: string, content: string, channel = channelId, isBot = false) =>
    bot.emit("MESSAGE_CREATE", bot.fixtures.message({ channel_id: channel, content, author: isBot ? bot.fixtures.botUser() : bot.fixtures.user({ id: userId }) }))
function run(initial: C.StickyMessage[], body: (bot: Bot, native: ReturnType<typeof platform>, memory: ReturnType<typeof memoryStore>) => Effect.Effect<void, unknown>) {
    const f = createFixtures(), memory = memoryStore(initial)
    return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { sticky: memory.store }))
        const native = platform(bot)
        yield* bot.ready()
        yield* bot.idle()
        yield* body(bot, native, memory)
    })).pipe(Effect.provide(TestClock.layer())))
}

test("a member message reposts the sticky, records the new copy and deletes only the copy before it", async () => {
    await run([sticky()], (bot, native, memory) => Effect.gen(function* () {
        assert.deepEqual(memory.calls.map(call => call.method), ["list"])
        // Messages in other channels and the bot's own messages never repost
        yield* say(bot, memberId, "elsewhere", "5002")
        yield* say(bot, memberId, "from the bot", channelId, true)
        yield* bot.idle()
        assert.deepEqual(native.copies(), [])
        assert.deepEqual(memory.calls.map(call => call.method), ["list"])
        yield* say(bot, memberId, "hello")
        yield* bot.idle()
        assert.deepEqual(native.copies(), ["Read the pinned rules"])
        assert.deepEqual(memory.calls.at(-1), { method: "posted", input: { serverId: bot.fixtures.ids.guild, channelId, revision: 1, previousMessageId: "900", messageId: "1001" } })
        assert.deepEqual(native.deleted(), ["900"])
        assert.equal(memory.rows.get(channelId)!.messageId, "1001")
    }))
})

test("a busy channel gets at most one repost per interval, and the last message still gets one", async () => {
    await run([sticky()], (bot, native) => Effect.gen(function* () {
        yield* say(bot, memberId, "first")
        yield* bot.idle()
        for (const text of ["two", "three", "four"]) yield* say(bot, memberId, text)
        yield* TestClock.adjust("29999 millis")
        yield* bot.idle()
        assert.equal(native.copies().length, 1)
        yield* TestClock.adjust("1 millis")
        yield* bot.idle()
        assert.equal(native.copies().length, 2)
        assert.deepEqual(native.deleted(), ["900", "1001"])
        // A quiet channel waits for its next message
        yield* TestClock.adjust("5 minutes")
        yield* bot.idle()
        assert.equal(native.copies().length, 2)
    }))
})

test("a repost that loses the race deletes its own copy and never the recorded one", async () => {
    await run([sticky()], (bot, native, memory) => Effect.gen(function* () {
        memory.rejectNextPost()
        yield* say(bot, memberId, "hello")
        yield* bot.idle()
        assert.deepEqual(native.deleted(), ["1001"])
        assert.equal(memory.rows.get(channelId)!.messageId, "900")
        // The next repost builds on the recorded copy
        yield* TestClock.adjust("30 seconds")
        yield* say(bot, memberId, "again")
        yield* bot.idle()
        assert.deepEqual(native.deleted(), ["1001", "900"])
        assert.equal(memory.rows.get(channelId)!.messageId, "1002")
    }))
})

test("a copy whose send had an unknown outcome is found among the 50 newest messages and deleted before the next repost", async () => {
    await run([sticky()], (bot, native, memory) => Effect.gen(function* () {
        const f = bot.fixtures, rules = "Read the pinned rules"
        native.failNextSend()
        yield* say(bot, memberId, "hello")
        yield* bot.idle()
        assert.deepEqual([native.deleted(), memory.rows.get(channelId)!.messageId, native.historyReads()], [[], "900", []])
        // Fluxer kept that copy as 1500. Members' messages and the bot's other messages are never touched
        native.setHistory([f.message({ id: "1500", channel_id: channelId, author: f.botUser(), content: rules }), f.message({ id: "1499", channel_id: channelId, author: f.user({ id: memberId }), content: rules }),
            f.message({ id: "1498", channel_id: channelId, author: f.botUser(), content: "Another reply" }), f.message({ id: "900", channel_id: channelId, author: f.botUser(), content: rules })])
        yield* TestClock.adjust("30 seconds")
        yield* say(bot, memberId, "again")
        yield* bot.idle()
        assert.deepEqual([native.historyReads(), native.deleted()], [["50"], ["1500", "900"]])
        assert.equal(memory.rows.get(channelId)!.messageId, "1001")
        // A settled channel reads no history
        yield* TestClock.adjust("30 seconds")
        yield* say(bot, memberId, "once more")
        yield* bot.idle()
        assert.deepEqual([native.historyReads(), native.deleted()], [["50"], ["1500", "900", "1001"]])
    }))
})

test("managers add, change and remove stickies in chat, and other members are refused", async () => {
    await run([], (bot, native, memory) => Effect.gen(function* () {
        yield* say(bot, memberId, `!sticky add <#${channelId}> "Welcome in"`, "5002")
        yield* bot.idle()
        assert.deepEqual(native.replies(), ["Only the server owner or members with Manage Server can manage sticky messages"])
        yield* say(bot, adminId, `!sticky add <#${channelId}> "Welcome in"`, "5002")
        yield* bot.idle()
        // A new sticky is posted at once
        assert.deepEqual(native.copies(), ["Welcome in"])
        assert.equal(memory.rows.get(channelId)!.messageId, "1002")
        yield* say(bot, adminId, `!sticky interval <#${channelId}> 120`, "5002")
        yield* bot.idle()
        assert.equal(memory.rows.get(channelId)!.intervalSeconds, 120)
        assert.deepEqual(native.deleted(), ["1002"])
        yield* say(bot, adminId, `!sticky remove <#${channelId}>`, "5002")
        yield* bot.idle()
        assert.equal(memory.rows.size, 0)
        assert.deepEqual(native.deleted(), ["1002", "1004"])
        // A removed sticky no longer reposts
        yield* say(bot, memberId, "hello")
        yield* bot.idle()
        assert.equal(native.copies().length, 2)
        assert.deepEqual(memory.calls.filter(call => call.method === "manage").map(call => call.input), [
            { type: "set", channelId, content: "Welcome in" }, { type: "set", channelId, intervalSeconds: 120 }, { type: "remove", channelId }])
    }))
})

test("an applied dashboard change reloads the stickies, posts a changed one at once and deletes a removed one's last copy", async t => {
    let jobs: D.DashboardConfigurationReadyJob[] = []
    mockBackend(t, (call) => {
        if (call.path === "/dashboard-configuration/ready") return { jobs }
        assert.equal(call.path, "/dashboard-configuration/execute")
        const { native: _native, ...stored } = jobs[0]!
        return { job: { ...stored, state: "applied" } }
    })
    await run([sticky(), sticky({ channelId: "5009", messageId: "901" })], (bot, native, memory) => Effect.gen(function* () {
        const f = bot.fixtures, config = { token, serverId: f.ids.guild, backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-backend-secret") } }
        bot.rest.respond("GET /users/@me", { body: f.botUser({ system: false }) })
        bot.rest.respond(`GET /users/${adminId}`, { body: f.user({ id: adminId, bot: false, system: false }) })
        // The backend applied the change, which the bot then reads back
        memory.rows.set(channelId, sticky({ content: "New rules", revision: 2 }))
        memory.rows.delete("5009")
        jobs = [{ family: "sticky", operation: { type: "set", channelId, content: "New rules" }, native: { channelIds: [channelId] },
            id: "synthetic_sticky_job", actorId: adminId, expectedConfigRevision: 0, state: "queued", createdAt: 0, expiresAt: 120000 }]
        yield* processDashboardConfigurationPass(config, bot.client as unknown as Parameters<typeof processDashboardConfigurationPass>[1])
        yield* bot.idle()
        assert.deepEqual(native.copies(), ["New rules"])
        assert.deepEqual(native.deleted().sort(), ["900", "901"])
    }))
})
