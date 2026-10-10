import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { createFixtures } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted, Schema } from "effect"
import { createSuggestionsStore } from "../src/suggestion-store.ts"
import { publishingGrantSchema } from "../src/publishing-store.ts"
import { deriveServiceKey } from "../src/backend-http.ts"
import { mockBackend } from "./backend-fake.ts"

const f = createFixtures(), now = Date.parse("2026-01-02T00:00:00Z")
const context: C.SuggestionsContext = { observedAt: now, actor: { userId: f.ids.user, roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: true }, channelId: f.ids.channel, botId: f.ids.bot, actorAuthorized: true, botAuthorized: true, member: { userId: f.ids.user, roleIds: [], joinedAt: "2020-01-01T00:00:00.123456789+00:00", isBot: false, timeoutUntil: null, canView: true, canReadHistory: true } }
const suggestion: C.SuggestionsDefinition = { suggestionNo: 1, revision: 1, authorId: f.ids.user, channelId: f.ids.channel, text: "Immutable proposition", state: "under-review", up: 1, down: 0, voters: 1, desiredRevision: 2, publishedRevision: 0, cardGeneration: 1, cardState: "queued", cardStale: true, createdAt: now - 1000, updatedAt: now, forgetting: false }
const binding = { suggestionNo: 1, cardGeneration: 1, desiredRevision: 2 }, consumer = { type: "suggestion-card" as const, ...binding }
const grant: C.SuggestionsCardGrant = { attemptId: "synthetic_suggestion_attempt", postNo: 1, generation: 1, sourceId: "suggestion_1_1_2_1", actorId: f.ids.bot, botId: f.ids.bot, action: "send", channelId: f.ids.channel, source: consumer, provenance: consumer, consumer, content: { content: "Card" }, canonicalContent: { content: "Card" }, dispatchExpiresAt: now + 180000, nativeDeadlineMs: 5000 }
const config = { url: "https://synthetic-suggestions.convex.cloud", secret: Redacted.make("synthetic-suggestions-secret") }

test("suggestion backend decoder binds public destination, ordered lists and forbids voter/storage leakage", async t => {
    let value: unknown = { type: "suggestion", suggestion }
    mockBackend(t, call => {
        assert.equal(call.path, "/suggestions/query")
        assert.equal(call.key, Redacted.value(deriveServiceKey(config.secret)))
        assert(!JSON.stringify(call).includes("synthetic-suggestions-secret"))
        assert.equal((call.body as C.SuggestionsQueryRequest).context.actor.isAdministrator, false)
        return value
    })
    const store = createSuggestionsStore(config), input: C.SuggestionsQueryRequest = { serverId: f.ids.guild, context, operation: { type: "show", suggestionNo: 1 } }
    assert.deepEqual(await Effect.runPromise(store.query(input)), value)
    for (const change of [{ channelId: f.nextId() }, { suggestionNo: 2 }, { up: 1001 }, { down: 2 }, { text: "x".repeat(2001) }, { publishedRevision: 3 }, { voterIds: [f.ids.user] },
        ...["createdAt", "updatedAt"].flatMap(field => [-1, now + 0.5, Number.MAX_SAFE_INTEGER + 1].map(value => ({ [field]: value }))),
    ]) {
        value = { type: "suggestion", suggestion: { ...suggestion, ...change } }
        await assert.rejects(Effect.runPromise(store.query(input)), /SuggestionsStoreError/)
    }
    value = { type: "suggestions", suggestions: [suggestion], nextBeforeSuggestionNo: 1 }
    assert.deepEqual(await Effect.runPromise(store.query({ ...input, operation: { type: "list", state: "under-review", beforeSuggestionNo: 2 } })), value)
    value = { type: "suggestions", suggestions: [], nextBeforeSuggestionNo: 1 }
    assert.deepEqual(await Effect.runPromise(store.query({ ...input, operation: { type: "list", beforeSuggestionNo: 2 } })), value)
    value = { type: "suggestions", suggestions: [{ ...suggestion, suggestionNo: 3 }], nextBeforeSuggestionNo: 2 }
    assert.deepEqual(await Effect.runPromise(store.query({ ...input, operation: { type: "list", beforeSuggestionNo: 4 } })), value)
    for (const change of [{ type: "suggestions", suggestions: [suggestion, suggestion] }, { type: "suggestions", suggestions: [suggestion], nextBeforeSuggestionNo: 2 }]) {
        value = change; await assert.rejects(Effect.runPromise(store.query({ ...input, operation: { type: "list" } })), /SuggestionsStoreError/)
    }
})

test("vote decoder binds choice, physical command and raw epoch without upgrading member authority", async t => {
    const input: C.SuggestionsMemberRequest = { serverId: f.ids.guild, context, messageId: f.nextId(), createdAt: now, operation: { type: "vote", suggestionNo: 1, choice: "clear" } }
    const vote: C.SuggestionsVote = { choice: "clear", joinedAt: context.member!.joinedAt, acceptedCreatedAt: now, acceptedMessageId: input.messageId }
    let value: unknown = { duplicate: false, type: "vote", accepted: true, vote, suggestion }
    mockBackend(t, call => { assert.equal(call.path, "/suggestions/member"); assert.deepEqual(call.body, input); return value })
    const store = createSuggestionsStore(config)
    assert.deepEqual(await Effect.runPromise(store.member(input)), value)
    for (const change of [{ choice: "up" }, { joinedAt: "2020-01-01T00:00:00.123Z" }, { acceptedMessageId: f.nextId() }, { acceptedCreatedAt: now + 1 }, { userId: f.ids.user }]) {
        value = { duplicate: false, type: "vote", accepted: true, vote: { ...vote, ...change }, suggestion }; await assert.rejects(Effect.runPromise(store.member(input)), /SuggestionsStoreError/)
    }
})

test("suggestion publisher schemas require explicit matching source provenance consumer and immutable edit baseline", async () => {
    const decode = Schema.decodeUnknownSync(publishingGrantSchema, { onExcessProperty: "error" })
    assert.deepEqual(decode(grant), grant)
    assert(decode({ ...grant, action: "edit", generation: 2, sourceId: "suggestion_1_1_2_2", messageId: f.nextId(), expectedContent: { content: "Previous" } }))
    for (const changed of [{ sourceId: f.nextId() }, { source: { ...consumer, desiredRevision: 3 } }, { provenance: { ...consumer, cardGeneration: 2 } }, { consumer: { ...consumer, suggestionNo: 2 } }, { source: { type: "human", messageId: f.nextId(), createdAt: now } }, { draftKind: "draft", draftName: "x", draftRevision: 1 }, { action: "edit", messageId: f.nextId() }]) assert.throws(() => decode({ ...grant, ...changed }))
})

test("work adapter checks actionable rows, durable cursors, the bot actor and exact card binding", async t => {
    const row: C.SuggestionsWorkRow = { ...binding, channelId: f.ids.channel, dueAt: now, nextCheckAt: now + 60000, state: "queued" }
    let value: unknown = { type: "cards", cards: [row], hasMore: true, nextCursor: { cursor: "synthetic_next", throughAt: now } }
    mockBackend(t, () => value)
    const store = createSuggestionsStore(config), input: C.SuggestionsWorkRequest = { serverId: f.ids.guild, operation: { type: "list" } }
    assert.deepEqual(await Effect.runPromise(store.work(input)), value)
    for (const change of [{ type: "cards", cards: [row, row], hasMore: false }, { type: "cards", cards: [], hasMore: true }, { type: "cards", cards: [], hasMore: false, nextCursor: { cursor: "synthetic_next", throughAt: now } }]) { value = change; await assert.rejects(Effect.runPromise(store.work(input)), /SuggestionsStoreError/) }
    value = { type: "reserved", grant }
    const reserve: C.SuggestionsWorkRequest = { serverId: f.ids.guild, operation: { type: "reserve", binding, context: { observedAt: now, channelId: f.ids.channel, botId: f.ids.bot, botAuthorized: true } } }
    assert.deepEqual(await Effect.runPromise(store.work(reserve)), value)
    for (const change of [{ actorId: f.ids.user }, { botId: f.ids.user }, { channelId: f.nextId() }, { consumer: { ...consumer, desiredRevision: 3 } }]) { value = { type: "reserved", grant: { ...grant, ...change } }; await assert.rejects(Effect.runPromise(store.work(reserve)), /SuggestionsStoreError/) }
})
