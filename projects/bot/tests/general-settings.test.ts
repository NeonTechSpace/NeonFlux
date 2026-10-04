import assert from "node:assert/strict"
import test from "node:test"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { prefixTtlMs, type GeneralSettingsStore } from "../src/general-settings.ts"
import type { AfkStore } from "../src/afk-store.ts"
import { BackendRequestError } from "../src/backend-http.ts"

// In-memory AFK store, so the general adapter is the one under test that uses the backend
function offlineWorkers() {
    return {
        afk: { set: () => Effect.die("unused"), observe: () => Effect.succeed({ cleared: false, statuses: [] }) } satisfies AfkStore }
}

test("gateway dispatch caches the shared prefix, refreshes changes after the TTL and keeps fixed prefix discovery", async () => {
    const fixtures = createFixtures()
    let prefix = "?", revision = 1, reads = 0, reason: string | undefined
    const general: GeneralSettingsStore = {
        get: () => Effect.sync(() => { reads++; return { prefix, revision } }),
        set: (_actor, value, expected) => Effect.sync(() => {
            if (expected !== revision) return { saved: false as const, conflict: true as const, revision }
            prefix = value
            return { saved: true as const, revision: ++revision }
        }),
    }
    const afk: AfkStore = {
        set: (userId, value) => Effect.sync(() => { reason = value; return { userId, reason: value, since: 1234 } }),
        observe: () => Effect.succeed({ cleared: false, statuses: [] }),
    }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const config = { token: Redacted.make("synthetic-prefix-token"), serverId: fixtures.ids.guild }
        const bot = yield* createTestBot(createBotOptions(config, { afk, general }))
        const replies = bot.rest.respond("POST /channels/:id/messages", { body: bot.fixtures.message() })
        yield* bot.ready()
        const send = (content: string) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))
        for (const content of ["?ping", "!ping", "?afk Lunch", "!prefix"]) yield* send(content)
        assert.equal(reason, "Lunch")
        assert.deepEqual(replies.requests().map(row => (row.body as { content: string }).content), ["Pong!", "You are now AFK. Send a message to clear your status", "Current prefix: ?"])
        // One cached read serves the messages. The prefix command reads the current revision itself
        assert.equal(reads, 2)
        prefix = "::"
        revision++
        yield* send("::ping")
        assert.equal(replies.requests().length, 3)
        yield* TestClock.adjust(prefixTtlMs)
        for (const content of ["?ping", "::ping", "::afk Away again"]) yield* send(content)
        assert.equal(reason, "Away again")
        assert.deepEqual(replies.requests().slice(3).map(row => (row.body as { content: string }).content), ["Pong!", "You are now AFK. Send a message to clear your status"])
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("a failed first prefix read caches the ! fallback for the refresh interval", async () => {
    const fixtures = createFixtures()
    let reads = 0
    const general: GeneralSettingsStore = { get: () => Effect.suspend(() => { reads++; return Effect.fail(new BackendRequestError({ status: 503 })) }), set: () => Effect.die("unused") }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token: Redacted.make("synthetic-prefix-token"), serverId: fixtures.ids.guild }, { general }))
        const replies = bot.rest.respond("POST /channels/:id/messages", { body: bot.fixtures.message() })
        yield* bot.ready()
        const send = (content: string) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))
        for (const content of ["!ping", "?ping", "!ping"]) yield* send(content)
        assert.equal(reads, 1)
        yield* TestClock.adjust(prefixTtlMs)
        yield* send("!ping")
        assert.equal(reads, 2)
        assert.equal(replies.requests().length, 3)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("explicitly undefined store overrides keep the configured backend adapters", async t => {
    const fixtures = createFixtures()
    const config = { token: Redacted.make("synthetic-prefix-token"), serverId: fixtures.ids.guild, backend: { siteUrl: "https://synthetic.invalid", secret: Redacted.make("synthetic-secret") } }
    t.mock.method(globalThis, "fetch", async (url: URL | string) => String(url).endsWith("/general/get") ? Response.json({ prefix: "?", revision: 1 }) : Response.json({ error: "Synthetic unavailable" }, { status: 503 }))
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions(config, { ...offlineWorkers(), general: undefined }))
        const replies = bot.rest.respond("POST /channels/:id/messages", { body: bot.fixtures.message() })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "?ping" })).pipe(Effect.andThen(bot.idle()))
        assert.deepEqual(replies.requests().map(row => (row.body as { content: string }).content), ["Pong!"])
    })))
})
