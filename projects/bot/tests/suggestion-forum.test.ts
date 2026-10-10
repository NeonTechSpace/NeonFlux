import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Exit, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { processSuggestionCard } from "../src/suggestions.ts"
import { ensureSuggestionTags, isForum, SuggestionTagError } from "../src/suggestion-forum.ts"
import type { SuggestionsStore } from "../src/suggestion-store.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { platform } from "./moderation-fixture.ts"

const now = Date.parse("2026-01-02T00:00:00Z")
const controlled = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))
type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const storeWith = (grant: C.SuggestionsCardGrant): SuggestionsStore => ({ work: () => Effect.succeed({ type: "reserved", grant }), query: () => Effect.die("Unexpected query"), member: () => Effect.die("Unexpected member"), manage: () => Effect.die("Unexpected management") })
const tag = (id: string, name: string, moderated = false) => ({ id, name, moderated, emoji_id: null, emoji_name: null })
function card(forumId: string, overrides: Partial<C.SuggestionsWorkRow> = {}): C.SuggestionsWorkRow {
    return { suggestionNo: 1, cardGeneration: 1, desiredRevision: 1, channelId: forumId, suggestionState: "under-review", state: "queued", dueAt: now, nextCheckAt: now + 60000, ...overrides }
}
function grant(bot: Bot, row: C.SuggestionsWorkRow, overrides: Partial<C.SuggestionsCardGrant> = {}): C.SuggestionsCardGrant {
    const binding = { type: "suggestion-card" as const, suggestionNo: row.suggestionNo, cardGeneration: row.cardGeneration, desiredRevision: row.desiredRevision }
    return { attemptId: "synthetic_forum_attempt", postNo: 1, generation: 1, sourceId: `suggestion_${row.suggestionNo}_${row.cardGeneration}_${row.desiredRevision}_1`, actorId: bot.fixtures.ids.bot, botId: bot.fixtures.ids.bot,
        channelId: row.threadId ?? row.channelId, action: "send", source: binding, provenance: binding, consumer: binding, content: { content: "", embed: { title: "Suggestion #1" } }, canonicalContent: { content: "", embed: { title: "Suggestion #1" } },
        dispatchExpiresAt: now + 180000, nativeDeadlineMs: 5000, forumPostName: "#1 Forum proposition", ...overrides }
}
function addGrant(remote: ReturnType<typeof publishingBoundary>, g: C.SuggestionsCardGrant) {
    remote.posts.set(g.postNo, { postNo: g.postNo, generation: g.generation, botId: g.botId, channelId: g.channelId, outcome: "pending", createdAt: now, updatedAt: now, consumer: g.consumer, attempt: { ...g, outcome: "pending", createdAt: now }, ...(g.messageId ? { messageId: g.messageId } : {}) })
}
const message = (bot: Bot, channelId: string, body: unknown, id = bot.fixtures.nextId()) => {
    const value = body as { content?: string, embeds?: object[] }
    return bot.fixtures.message({ id, channel_id: channelId, author: bot.fixtures.botUser(), content: value.content ?? "", embeds: value.embeds?.map(e => ({ type: "rich", color: 0, ...e })) ?? [] })
}

test("a forum card adds its missing status tag and starts as a post tagged with its state", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot({ token: "synthetic-forum-token" }), f = bot.fixtures
        platform(bot)
        const forum = f.forumChannel({ available_tags: [tag(f.nextId(), "Ideas")] }), tagId = f.nextId(), postId = f.nextId()
        bot.rest.respond(`GET /channels/${forum.id}`, { body: forum })
        const create = bot.rest.respond(`POST /channels/${forum.id}/tags`, request => ({ body: { ...forum, available_tags: [...forum.available_tags!, tag(tagId, (request.body as { name: string }).name)] } }))
        const post = bot.rest.respond(`POST /channels/${forum.id}/threads`, request => ({ status: 201, body: { ...f.thread({ id: postId, parent_id: forum.id, owner_id: f.ids.bot }), message: message(bot, postId, (request.body as { message: unknown }).message) } }))
        const publishing = publishingBoundary(), row = card(forum.id), sendGrant = grant(bot, row)
        addGrant(publishing, sendGrant)
        const result = yield* processSuggestionCard(storeWith(sendGrant), publishing.store, f.ids.guild, bot.client, row)
        assert.equal(result?.outcome, "sent", JSON.stringify(result))
        assert.deepEqual(create.requests().map(r => (r.body as { name: string }).name), ["Under review"])
        const body = post.requests()[0]!.body as { name: string, applied_tags: string[], message: { embeds: unknown[] } }
        assert.equal(body.name, "#1 Forum proposition"); assert.deepEqual(body.applied_tags, [tagId]); assert.equal(body.message.embeds.length, 1)
        const outcome = publishing.calls.find(c => c.method === "outcome")!.input as C.PublishingOutcomeRequest
        assert.equal(outcome.threadId, postId); assert(outcome.messageId)
    }))
})

test("a status change reopens an archived post and swaps only its status tag before editing the card in the post", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot({ token: "synthetic-forum-token" }), f = bot.fixtures
        platform(bot)
        const review = f.nextId(), planned = f.nextId(), other = f.nextId()
        const forum = f.forumChannel({ available_tags: [tag(review, "Under review"), tag(planned, "Planned"), tag(other, "Ideas")] })
        const thread = f.thread({ parent_id: forum.id, owner_id: f.ids.bot, applied_tags: [review, other] }), archived = { ...thread, thread_metadata: { ...thread.thread_metadata, archived: true } }
        let current: typeof thread = archived
        bot.rest.respond(`GET /channels/${forum.id}`, { body: forum })
        bot.rest.respond(`GET /channels/${thread.id}`, () => ({ body: current }))
        const edit = bot.rest.respond(`PATCH /channels/${thread.id}`, request => {
            const change = request.body as { archived?: boolean, applied_tags?: string[] }
            current = { ...current, ...(change.applied_tags ? { applied_tags: change.applied_tags } : {}), thread_metadata: { ...current.thread_metadata, ...(change.archived === false ? { archived: false } : {}) } }
            return { body: current }
        })
        const cardId = f.nextId(), old = message(bot, thread.id, { content: "", embeds: [{ title: "Suggestion #1" }] }, cardId)
        bot.rest.respond(`GET /channels/${thread.id}/messages/${cardId}`, { body: old })
        const update = bot.rest.respond(`PATCH /channels/${thread.id}/messages/${cardId}`, request => ({ body: message(bot, thread.id, request.body, cardId) }))
        const row = card(forum.id, { threadId: thread.id, suggestionState: "planned", desiredRevision: 2 })
        const editGrant = grant(bot, row, { action: "edit", messageId: cardId, expectedContent: { content: "", embed: { title: "Suggestion #1" } }, content: { content: "", embed: { title: "Suggestion #1 planned" } },
            canonicalContent: { content: "", embed: { title: "Suggestion #1 planned" } }, sourceId: "suggestion_1_1_2_1" })
        delete (editGrant as { forumPostName?: string }).forumPostName
        const publishing = publishingBoundary(); addGrant(publishing, editGrant)
        const result = yield* processSuggestionCard(storeWith(editGrant), publishing.store, f.ids.guild, bot.client, row)
        assert.equal(result?.outcome, "sent", JSON.stringify(result))
        assert.deepEqual(edit.requests()[0]!.body, { archived: false, applied_tags: [planned, other] })
        assert.equal(update.requests().length, 1)
    }))
})

test("a forum without room for the status tags fails with the fix and adds nothing", async () => {
    await controlled(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-forum-token" }), f = bot.fixtures
        const forum = f.forumChannel({ available_tags: Array.from({ length: 18 }, (_, i) => tag(f.nextId(), `Topic ${i}`)) })
        const create = bot.rest.respond(`POST /channels/${forum.id}/tags`, { body: forum })
        const decoded = { id: forum.id, type: 15, guildId: f.ids.guild, availableTags: forum.available_tags!.map(t => ({ id: t.id, name: t.name, moderated: false, emojiId: null, emojiName: null })) } as never
        assert(isForum(decoded))
        const exit = yield* Effect.exit(ensureSuggestionTags(bot.client, decoded))
        assert(Exit.isFailure(exit))
        const error = exit.cause.reasons.find(r => r._tag === "Fail")
        assert(error?._tag === "Fail" && error.error instanceof SuggestionTagError)
        assert.match(error.error.fix, /^Remove 3 tags from <#\d+> so NeonFlux can add its status tags, or add the tags Under review, Planned, Completed, Declined and Withdrawn/)
        assert.equal(create.requests().length, 0)
    }))
})
