import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Deferred, Effect, Fiber, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { processSuggestionCard } from "../src/suggestions.ts"
import { processSuggestionsPass, startSuggestionsWorker } from "../src/suggestion-worker.ts"
import type { SuggestionsStore } from "../src/suggestion-store.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { platform } from "./moderation-fixture.ts"

const now = Date.parse("2026-01-02T00:00:00Z")
const controlled = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))
const storeWith = (work: SuggestionsStore["work"]): SuggestionsStore => ({ work, query: () => Effect.die("Unexpected query"), member: () => Effect.die("Unexpected member"), manage: () => Effect.die("Unexpected management") })
function card(bot: Effect.Success<ReturnType<typeof createTestBot>>, overrides: Partial<C.SuggestionsWorkRow> = {}): C.SuggestionsWorkRow { return { suggestionNo: 1, cardGeneration: 1, desiredRevision: 1, channelId: bot.fixtures.ids.channel, suggestionState: "under-review", state: "queued", dueAt: now, nextCheckAt: now + 60000, ...overrides } }
function grant(bot: Effect.Success<ReturnType<typeof createTestBot>>, row: C.SuggestionsWorkRow, overrides: Partial<C.SuggestionsCardGrant> = {}): C.SuggestionsCardGrant {
    const binding = { type: "suggestion-card" as const, suggestionNo: row.suggestionNo, cardGeneration: row.cardGeneration, desiredRevision: row.desiredRevision }
    return { attemptId: "synthetic_suggestion_attempt", postNo: 1, generation: 1, sourceId: `suggestion_${row.suggestionNo}_${row.cardGeneration}_${row.desiredRevision}_1`, actorId: bot.fixtures.ids.bot, botId: bot.fixtures.ids.bot, channelId: row.channelId, action: "send", source: binding, provenance: binding, consumer: binding, content: { content: "Card @everyone", embed: { title: "Suggestion 1" } }, canonicalContent: { content: "Card @everyone", embed: { title: "Suggestion 1" } }, dispatchExpiresAt: now + 180000, nativeDeadlineMs: 5000, ...overrides }
}
function native(bot: Effect.Success<ReturnType<typeof createTestBot>>) {
    const p = platform(bot), messages = new Map<string, ReturnType<typeof bot.fixtures.message>>()
    p.replies.remove()
    const reply = (request: { path: string, body?: unknown }, id = bot.fixtures.nextId()) => {
        const value = request.body as { content?: string, embeds?: object[] }
        const message = bot.fixtures.message({ id, channel_id: request.path.split("/")[2], author: bot.fixtures.botUser(), content: value.content ?? "", embeds: value.embeds?.map(e => ({ type: "rich", color: 0, ...e })) ?? [] })
        messages.set(message.id, message); return { body: message }
    }
    const send = bot.rest.respond("POST /channels/:id/messages", request => reply(request))
    const fetch = bot.rest.respond("GET /channels/:id/messages/:id", request => ({ body: messages.get(request.path.split("/").at(-1)!) }))
    const edit = bot.rest.respond("PATCH /channels/:id/messages/:id", request => reply(request, request.path.split("/").at(-1)!))
    return { ...p, messages, send, fetch, edit }
}
function addGrant(remote: ReturnType<typeof publishingBoundary>, g: C.SuggestionsCardGrant) { remote.posts.set(g.postNo, { postNo: g.postNo, generation: g.generation, botId: g.botId, channelId: g.channelId, outcome: "pending", createdAt: now, updatedAt: now, consumer: g.consumer, attempt: { ...g, outcome: "pending", createdAt: now }, ...(g.messageId ? { messageId: g.messageId } : {}) }) }

test("admitted future-rescan suggestion work sends with fresh bot destination proof and edits the same card through SDK", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot({ token: "synthetic-suggestion-token" }), p = native(bot), publishing = publishingBoundary(), row = card(bot), g = grant(bot, row)
        addGrant(publishing, g)
        const remote = storeWith(input => { assert.equal(input.operation.type, "reserve"); return Effect.succeed({ type: "reserved", grant: g }) })
        const sent = yield* processSuggestionCard(remote, publishing.store, bot.fixtures.ids.guild, bot.client, row)
        assert.equal(sent?.outcome, "sent"); assert(sent?.messageId)
        const next = card(bot, { desiredRevision: 2 }), editGrant = grant(bot, next, { action: "edit", generation: 2, sourceId: "suggestion_1_1_2_2", attemptId: "synthetic_edit_attempt", messageId: sent.messageId, expectedContent: g.canonicalContent, content: { content: "Updated votes" }, canonicalContent: { content: "Updated votes" } })
        addGrant(publishing, editGrant)
        const updated = yield* processSuggestionCard(storeWith(() => Effect.succeed({ type: "reserved", grant: editGrant })), publishing.store, bot.fixtures.ids.guild, bot.client, next)
        assert.equal(updated?.outcome, "sent"); assert.equal(updated?.messageId, sent.messageId)
        assert.equal(p.send.requests().length, 1); assert.equal(p.edit.requests().length, 1); assert.equal(p.fetch.requests().length, 1)
        for (const claim of publishing.calls.filter(c => c.method === "dispatch").map(c => c.input as C.PublishingDispatchRequest)) {
            assert.equal(claim.suggestionContext!.botId, bot.fixtures.ids.bot); assert.equal(claim.suggestionContext!.channelId, row.channelId)
            assert.equal(claim.eventContext, undefined); assert.equal(claim.scheduleContext, undefined); assert.equal(claim.milestoneContext, undefined)
        }
        assert.deepEqual((p.edit.requests()[0]!.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
    }))
})

test("reserve response uses post-response time bounds and rejects substituted bindings", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot({ token: "synthetic-suggestion-token" }), p = native(bot), row = card(bot), publishing = publishingBoundary()
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
        const remote = storeWith(() => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.andThen(Clock.currentTimeMillis), Effect.map(t => ({ type: "reserved" as const, grant: grant(bot, row, { dispatchExpiresAt: t + 180000 }) }))))
        publishing.store.dispatch = input => Clock.currentTimeMillis.pipe(Effect.map(t => ({ claimed: true, dispatchExpiresAt: t + 180000, nativeDeadlineMs: 5000 as const })))
        const run = yield* processSuggestionCard(remote, publishing.store, bot.fixtures.ids.guild, bot.client, row).pipe(Effect.forkScoped)
        yield* Deferred.await(entered); yield* TestClock.adjust("10 seconds"); yield* Deferred.succeed(release, undefined)
        assert.equal((yield* Fiber.join(run))?.outcome, "sent")
        const changed = grant(bot, row, { sourceId: "suggestion_1_2_1_1" })
        yield* Effect.exit(processSuggestionCard(storeWith(() => Effect.succeed({ type: "reserved", grant: changed })), publishing.store, bot.fixtures.ids.guild, bot.client, row))
        assert.equal(p.send.requests().length, 1)
    }))
})

test("two workers rely on backend one-time claim and retain unknown outcome without replay", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot({ token: "synthetic-suggestion-token" }), p = native(bot), row = card(bot), g = grant(bot, row)
        p.send.remove()
        const send = bot.rest.respond("POST /channels/:id/messages", { status: 500, body: { message: "Synthetic uncertain response" } })
        let claimed = false, reserves = 0
        const publishing = publishingBoundary({ dispatch: () => Effect.sync(() => { const admitted = !claimed; claimed = true; return { claimed: admitted, dispatchExpiresAt: g.dispatchExpiresAt, nativeDeadlineMs: 5000 as const } }) })
        const remote = storeWith(() => Effect.sync(() => { reserves++; return { type: "reserved", grant: g } as const }))
        const first = yield* processSuggestionCard(remote, publishing.store, bot.fixtures.ids.guild, bot.client, row).pipe(Effect.forkScoped)
        const second = yield* processSuggestionCard(remote, publishing.store, bot.fixtures.ids.guild, bot.client, row).pipe(Effect.forkScoped)
        const results = [yield* Fiber.join(first), yield* Fiber.join(second)]
        assert.equal(results.filter(r => r?.outcome === "uncertain").length, 1); assert.equal(send.requests().length, 1)
        yield* processSuggestionCard(remote, publishing.store, bot.fixtures.ids.guild, bot.client, row)
        assert.equal(reserves, 3); assert.equal(send.requests().length, 1)
        assert.equal(publishing.calls.filter(c => c.method === "outcome").length, 1)
    }))
})

test("claim barrier deadline prevents native dispatch and does not convert a refused claim into an outcome", async () => {
    for (const admitted of [true, false]) await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot({ token: "synthetic-suggestion-token" }), p = native(bot), row = card(bot), g = grant(bot, row), entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
        const publishing = publishingBoundary({ dispatch: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as({ claimed: admitted, dispatchExpiresAt: g.dispatchExpiresAt, nativeDeadlineMs: 5000 })) })
        const run = yield* processSuggestionCard(storeWith(() => Effect.succeed({ type: "reserved", grant: g })), publishing.store, bot.fixtures.ids.guild, bot.client, row).pipe(Effect.forkScoped)
        yield* Deferred.await(entered); yield* TestClock.adjust("180 seconds"); yield* Deferred.succeed(release, undefined)
        const result = yield* Fiber.join(run)
        assert.equal(p.send.requests().length, 0); assert.equal(publishing.calls.filter(c => c.method === "outcome").length, admitted ? 1 : 0)
        assert.equal(result?.acknowledged, admitted)
    }))
})

test("fair bounded pages continue past a failed card and empty continuation", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot({ token: "synthetic-suggestion-token" }), p = native(bot), publishing = publishingBoundary(), cursors: (C.SuggestionsWorkCursor | undefined)[] = [], deferred: number[] = []
        let page = 0
        const remote = storeWith(input => {
            const op = input.operation
            if (op.type === "list") { cursors.push(op.cursor); page++; return Effect.succeed({ type: "cards", cards: page === 1 ? [card(bot)] : page === 2 ? [] : [card(bot, { suggestionNo: 2 })], hasMore: page < 3, ...(page < 3 ? { nextCursor: { cursor: `synthetic_page_${page}`, throughAt: now } } : {}) }) }
            if (op.type === "defer") { deferred.push(op.binding.suggestionNo); return Effect.succeed({ type: "progress", recorded: true }) }
            if (op.binding.suggestionNo === 1) return Effect.succeed({ type: "cards", cards: [], hasMore: false })
            return Effect.succeed({ type: "progress", recorded: false })
        })
        let cursor: C.SuggestionsWorkCursor | undefined
        for (let i = 0; i < 3; i++) { const result = yield* processSuggestionsPass(remote, publishing.store, bot.fixtures.ids.guild, bot.client, cursor); cursor = result.nextCursor; assert(result.considered <= 20) }
        assert.deepEqual(cursors, [undefined, { cursor: "synthetic_page_1", throughAt: now }, { cursor: "synthetic_page_2", throughAt: now }]); assert.deepEqual(deferred, [1]); assert.equal(cursor, undefined)
    }))
})

test("scoped wake fixes first command deadline at five seconds and has no periodic pass", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot({ token: "synthetic-suggestion-token" }), started = yield* Deferred.make<void>(), coalesced = yield* Deferred.make<void>(), fallback = yield* Deferred.make<void>(), times: number[] = []
        const remote = storeWith(() => Clock.currentTimeMillis.pipe(Effect.flatMap(t => { times.push(t); return Deferred.succeed(times.length === 1 ? started : times.length === 2 ? coalesced : fallback, undefined).pipe(Effect.as({ type: "cards" as const, cards: [], hasMore: false })) })))
        const worker = yield* startSuggestionsWorker(remote, publishingBoundary().store, bot.fixtures.ids.guild, bot.client)
        yield* TestClock.adjust("1 hour"); assert.deepEqual(times, [])
        yield* worker.wake(); yield* Deferred.await(started)
        yield* worker.notify(); yield* TestClock.adjust("3 seconds"); yield* worker.notify(); yield* TestClock.adjust("2 seconds"); yield* Deferred.await(coalesced)
        assert.deepEqual(times, [now + 3600000, now + 3605000])
        yield* TestClock.adjust("1 hour"); assert.deepEqual(times, [now + 3600000, now + 3605000])
        yield* worker.wake(); yield* Deferred.await(fallback); assert.deepEqual(times, [now + 3600000, now + 3605000, now + 7205000])
    }))
})
