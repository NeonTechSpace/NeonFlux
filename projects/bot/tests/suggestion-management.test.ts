import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { SuggestionsStoreError, type SuggestionsStore } from "../src/suggestion-store.ts"
import { boundary, platform, token } from "./moderation-fixture.ts"
import type { GeneralSettingsStore } from "../src/general-settings.ts"

type Body = { content?: string, embeds?: { title?: string, description?: string, color?: number, fields?: { name: string, value: string }[], footer?: { text: string } }[], allowed_mentions?: unknown }

const f = createFixtures()
function remote() {
    const calls: { method: string, input: C.SuggestionsMemberRequest | C.SuggestionsManageRequest | C.SuggestionsQueryRequest }[] = []
    const suggestion: C.SuggestionsDefinition = { suggestionNo: 1, revision: 2, authorId: f.ids.user, channelId: f.ids.channel, text: "Immutable public proposition", state: "under-review", up: 1, down: 0, voters: 1, desiredRevision: 2, publishedRevision: 0, cardGeneration: 1, cardState: "queued", cardStale: true, createdAt: 0, updatedAt: 0, forgetting: false }
    const vote: C.SuggestionsVote = { choice: "up", joinedAt: "2020-01-01T00:00:00.123456789+00:00", acceptedCreatedAt: 0, acceptedMessageId: f.nextId() }
    const settings: C.SuggestionsSettings = { enabled: true, revision: 4, channelId: f.ids.channel, suggestions: 1, voters: 1, staffReceipts: 0, memberReceipts: 0, dirty: 0, blocked: 0 }
    const store: SuggestionsStore = {
        query: input => { calls.push({ method: "query", input }); return Effect.succeed(input.operation.type === "mine" ? { type: "vote", suggestion, vote } : input.operation.type === "list" ? { type: "suggestions", suggestions: [suggestion] } : input.operation.type === "publication" ? { type: "publication", suggestion, post: null } : input.operation.type === "settings" ? { type: "settings", settings } : { type: "suggestion", suggestion }) },
        member: input => { calls.push({ method: "member", input }); return Effect.succeed(input.operation.type === "vote" ? { duplicate: false, type: "vote", accepted: true, suggestion, vote } : { duplicate: false, type: "suggestion", suggestion }) },
        manage: input => { calls.push({ method: "manage", input }); return Effect.succeed(input.operation.type === "forget" ? { duplicate: false, type: "forgotten", suggestionNo: 1, revision: 3, removed: 20, complete: false } : { duplicate: false, type: "suggestion", suggestion }) },
        work: () => Effect.succeed({ type: "cards", cards: [], hasMore: false }),
    }
    return { calls, store, suggestion, vote, settings }
}
const options = (store: SuggestionsStore, moderation?: ReturnType<typeof boundary>["store"]) => createBotOptions({ token, serverId: f.ids.guild }, { moderation, suggestions: store })

test("gateway command votes use eligible human evidence without a vote preflight or admin grant fabrication", async () => {
    const r = remote()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(r.store)), p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.ReadMessageHistory })
        p.actor.remove(); bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: bot.fixtures.member({ roles: [p.actorRole.id], joined_at: r.vote.joinedAt, communication_disabled_until: null }) })
        yield* bot.ready()
        for (const content of ['!suggest submit "Immutable public proposition"', "!suggest vote 1 clear", "!suggest mine 1", "!suggest show 1"]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); yield* p.replies.next(); yield* bot.idle()
        }
        const vote = r.calls.find(c => c.method === "member" && c.input.operation.type === "vote")!.input as C.SuggestionsMemberRequest
        assert.deepEqual(vote.operation, { type: "vote", suggestionNo: 1, choice: "clear" })
        assert.equal(r.calls.filter(c => c.method === "query").length, 2)
        assert.equal(vote.context.member!.joinedAt, r.vote.joinedAt); assert.equal(vote.context.actor.isAdministrator, false); assert.equal(vote.context.actor.isOwner, false)
        assert.equal(vote.context.actor.userId, f.ids.user); assert(vote.messageId && vote.createdAt > 0)
        const before = r.calls.length
        yield* bot.emit("MESSAGE_REACTION_ADD", { user_id: f.ids.user, channel_id: f.ids.channel, message_id: f.nextId(), guild_id: f.ids.guild, emoji: { name: "👍" } }); yield* bot.idle()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ guild_id: undefined, channel_id: p.dmId, content: "!suggest vote 1 up" })); yield* bot.idle()
        assert.equal(r.calls.length, before)
        for (const request of p.replies.requests()) assert.deepEqual((request.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        assert.equal(bot.failures().length, 0)
    })))
})

test("destination privacy and missing fresh history or timed-out membership fail before disclosure or vote", async () => {
    for (const scenario of ["wrong-destination", "no-history", "timeout"] as const) {
        const r = remote()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(options(r.store)), p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ViewChannel | (scenario === "no-history" ? 0n : Permissions.ReadMessageHistory) })
            if (scenario === "wrong-destination") r.suggestion.channelId = f.nextId()
            if (scenario === "timeout") { p.actor.remove(); bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: bot.fixtures.member({ roles: [p.actorRole.id], communication_disabled_until: "2099-01-01T00:00:00Z" }) }) }
            yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: scenario === "timeout" ? "!suggest vote 1 up" : "!suggest show 1" })); const denied = yield* p.replies.next(); yield* bot.idle()
            assert(!((denied.body as { content: string }).content.includes(r.suggestion.text)))
            assert.equal(r.calls.some(c => c.method === "member"), false)
            if (scenario === "no-history" || scenario === "timeout") assert.equal(r.calls.length, 0)
        })))
    }
})

test("staff confirmation and bounded forget continuation read the current revision", async () => {
    const r = remote()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(r.store)), p = platform(bot)
        yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!suggest forget 1" })); const preview = yield* p.replies.next(); yield* bot.idle()
        assert.match((preview.body as { content: string }).content, /!suggest forget 1 confirm/); assert.equal(r.calls.length, 0)
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!suggest forget 1 confirm" })); const result = yield* p.replies.next(); yield* bot.idle()
        assert.equal((result.body as { content: string }).content, "Removed 20 records of suggestion #1 so far\nContinue: `!suggest forget 1 confirm`")
        assert.deepEqual(r.calls.map(c => c.input.operation), [{ type: "publication", suggestionNo: 1 }, { type: "forget", suggestionNo: 1, expectedRevision: 2, confirm: true }])
    })))
})

test("restricted mode blocks ordinary votes while staff decline and disable retain critical gate", async () => {
    const r = remote(), moderation = boundary(); moderation.current.defcon = 2
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(r.store, moderation.store)), p = platform(bot)
        yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!suggest vote 1 up" })); yield* bot.idle(); assert.equal(r.calls.length, 0)
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!suggest status 1 declined Public reason, don't worry" })); yield* p.replies.next(); yield* bot.idle()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!suggest disable" })); yield* p.replies.next(); yield* bot.idle()
        assert.deepEqual(r.calls.filter(c => c.method === "query").map(c => c.input.operation), [{ type: "show", suggestionNo: 1 }, { type: "settings" }])
        assert.deepEqual(r.calls.filter(c => c.method === "manage").map(c => c.input.operation), [{ type: "status", suggestionNo: 1, expectedRevision: 2, state: "declined", reason: "Public reason, don't worry" }, { type: "settings", expectedRevision: 4, enabled: false }])
        assert.equal(bot.failures().length, 0)
    })))
})

test("withdrawal reads the current revision and a changed suggestion asks to send the command again", async () => {
    const r = remote()
    r.store.member = input => { r.calls.push({ method: "member", input }); return Effect.fail(new SuggestionsStoreError({ operation: "member", status: 409 })) }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(r.store)), p = platform(bot)
        yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!suggest withdraw 1 confirm" })); const reply = yield* p.replies.next(); yield* bot.idle()
        assert.deepEqual(r.calls.map(c => c.input.operation), [{ type: "show", suggestionNo: 1 }, { type: "withdraw", suggestionNo: 1, expectedRevision: 2, confirm: true }])
        assert.match((reply.body as { content: string }).content, /Send the command again/)
        assert.doesNotMatch((reply.body as { content: string }).content, /revision/)
    })))
})

test("lists page with next per state and say when no next page is remembered", async () => {
    const r = remote(), other: C.SuggestionsDefinition = { ...r.suggestion, suggestionNo: 9 }
    r.store.query = input => { r.calls.push({ method: "query", input }); return Effect.succeed(input.operation.type === "list" && input.operation.beforeSuggestionNo === undefined ? { type: "suggestions", suggestions: [other], nextBeforeSuggestionNo: 9 } : { type: "suggestions", suggestions: [r.suggestion] }) }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(r.store)), p = platform(bot)
        yield* bot.ready()
        const send = (content: string) => Effect.gen(function* () { yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); const reply = yield* p.replies.next(); yield* bot.idle(); return reply.body as Body })
        const first = (yield* send("!suggest list planned")).embeds![0]!
        assert.equal(first.title, "Planned suggestions"); assert.equal(first.description, "**#9** Under review, 1 up, 0 down: Immutable public proposition")
        assert.deepEqual(first.fields, [{ name: "Next", value: "`!suggest list planned next`" }])
        assert.match((yield* send("!suggest list next")).content!, /There is no next page to show\. Send !suggest list to start the list again/)
        const second = (yield* send("!suggest list planned next")).embeds![0]!
        assert.equal(second.description, "**#1** Under review, 1 up, 0 down: Immutable public proposition"); assert.equal(second.fields, undefined)
        assert.match((yield* send("!suggest list planned next")).content!, /Send !suggest list planned to start the list again/)
        assert.deepEqual(r.calls.map(c => c.input.operation), [{ type: "list", state: "planned" }, { type: "list", state: "planned", beforeSuggestionNo: 9 }])
        assert.equal(bot.failures().length, 0)
    })))
})

test("settings name a limit only when it is nearly reached", async () => {
    const r = remote()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(r.store)), p = platform(bot)
        yield* bot.ready()
        const fields = () => Effect.gen(function* () {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!suggest settings" })); const reply = yield* p.replies.next(); yield* bot.idle()
            return (reply.body as Body).embeds![0]!.fields!.map(field => [field.name, field.value])
        })
        assert.deepEqual(yield* fields(), [["Status", "On"], ["Channel", `<#${f.ids.channel}>`], ["Suggestions", "1"]])
        Object.assign(r.settings, { suggestions: 800, voters: 7999 })
        assert.deepEqual(yield* fields(), [["Status", "On"], ["Channel", `<#${f.ids.channel}>`], ["Suggestions", "800 of 1000"]])
        Object.assign(r.settings, { suggestions: 1000, voters: 8000 })
        assert.deepEqual(yield* fields(), [["Status", "On"], ["Channel", `<#${f.ids.channel}>`], ["Suggestions", "1000 of 1000"], ["Voters", "8000 of 10000"]])
        assert.equal(bot.failures().length, 0)
    })))
})

test("exact known-card recovery requires matching identity and typed404 replacement, with no native writes", async () => {
    for (const scenario of ["reconcile", "missing", "forbidden", "unknown", "wrong-author"] as const) {
        const r = remote(), messageId = f.nextId(), binding = { type: "suggestion-card" as const, suggestionNo: 1, cardGeneration: 1, desiredRevision: 2 }
        const grant: C.SuggestionsCardGrant = { attemptId: "synthetic_recovery_attempt", postNo: 1, generation: 2, sourceId: "suggestion_1_1_2_2", actorId: f.ids.user, botId: f.ids.bot, action: "edit", channelId: f.ids.channel, messageId, expectedContent: { content: "Previous" }, source: binding, provenance: binding, consumer: binding, content: { content: "Current card" }, canonicalContent: { content: "Current card" }, dispatchExpiresAt: 180000, nativeDeadlineMs: 5000 }
        const post: C.PublishingPost = { postNo: 1, generation: 2, channelId: f.ids.channel, botId: f.ids.bot, ...(scenario === "unknown" ? {} : { messageId }), consumer: binding, outcome: "uncertain", createdAt: 0, updatedAt: 190000, attempt: { ...grant, outcome: "uncertain", createdAt: 0, dispatchedAt: 1000, finishedAt: 190000 } }
        r.suggestion.postNo = post.postNo; r.suggestion.attemptId = grant.attemptId
        r.store.query = input => { r.calls.push({ method: "query", input }); return Effect.succeed({ type: "publication", suggestion: r.suggestion, post }) }
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(options(r.store)), p = platform(bot)
            const fetched = bot.rest.respond(`GET /channels/${f.ids.channel}/messages/${messageId}`, scenario === "missing" || scenario === "forbidden"
                ? { status: scenario === "missing" ? 404 : 403, body: { message: "Synthetic provider refusal" } }
                : { body: bot.fixtures.message({ id: messageId, author: scenario === "wrong-author" ? bot.fixtures.user() : bot.fixtures.botUser(), content: "Current card" }) })
            yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!suggest ${scenario === "reconcile" || scenario === "wrong-author" ? "reconcile" : "replace"} 1 confirm` })); yield* p.replies.next(); yield* bot.idle()
            const write = r.calls.find(c => c.method === "manage")?.input as C.SuggestionsManageRequest | undefined
            if (scenario === "reconcile" || scenario === "missing") {
                assert(write); assert.equal(write.operation.type, scenario === "missing" ? "replace" : "reconcile")
                const op = write.operation as Extract<C.SuggestionsManageOperation, { type: "replace" | "reconcile" }>
                // The revision and card generation come from the publication read right before the write
                assert.equal(op.expectedRevision, 2); assert.equal(op.postNo, 1); assert.equal(op.attemptId, grant.attemptId); assert.equal(op.cardGeneration, 1); assert.equal(op.expectedGeneration, 2); assert.equal(op.observation.messageId, messageId)
            } else assert.equal(write, undefined)
            assert.equal(fetched.requests().length, scenario === "unknown" ? 0 : 1)
            assert(bot.requests().filter(request => request.method !== "GET").every(request => request.method === "POST" && request.path.endsWith("/messages")))
        })))
    }
})

test("a server set to plain text gets the same suggestion detail as text that embeds show, without pings", async () => {
    const show = async (replyStyle: "embed" | "text") => {
        const r = remote(), general: GeneralSettingsStore = { get: () => Effect.succeed({ prefix: "!", replyStyle, revision: 1 }), set: () => Effect.die("unused"),
            nickname: () => Effect.die("unused"), setNickname: () => Effect.die("unused"), recordNickname: () => Effect.die("unused") }
        return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { suggestions: r.store, general })), p = platform(bot)
            yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!suggest show 1" })); const reply = yield* p.replies.next(); yield* bot.idle()
            assert.equal(p.replies.requests().length, 1)
            return reply.body as Body
        })))
    }
    const embed = await show("embed"), text = await show("text")
    assert.deepEqual(embed.embeds, [{ color: 0x5560e6, title: "Suggestion #1", description: "Immutable public proposition", fields: [
        { name: "Status", value: "Under review" }, { name: "Author", value: `<@${f.ids.user}>` }, { name: "Votes", value: "1 up, 0 down" }, { name: "Card", value: `Updating in <#${f.ids.channel}>` }] }])
    assert.equal(embed.content, undefined)
    assert.equal(text.content, ["**Suggestion #1**", "Immutable public proposition", "**Status:** Under review", `**Author:** <@${f.ids.user}>`, "**Votes:** 1 up, 0 down", `**Card:** Updating in <#${f.ids.channel}>`].join("\n"))
    assert.equal(text.embeds, undefined)
    for (const body of [embed, text]) assert.deepEqual(body.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
})
