import assert from "node:assert/strict"
import nodeTest, { type TestContext } from "node:test"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { readFileSync } from "node:fs"
import { makeFunctionReference } from "convex/server"
import { publicPost } from "../convex/publishing.ts"
import type * as C from "../contracts.js"
import { adapterFixture } from "./adapter-fixture.ts"
import { createSuggestionsStore, SuggestionsStoreError } from "../../bot/src/suggestion-store.ts"
import { createPublishingStore, PublishingStoreError } from "../../bot/src/publishing-store.ts"
import { processSuggestionsPass } from "../../bot/src/suggestion-worker.ts"
import { handleSuggestionCommand } from "../../bot/src/suggestion-management.ts"
import { parseSuggestionCommand } from "../../bot/src/suggestion-command.ts"
import { createModerationStore } from "../../bot/src/moderation-store.ts"
const test = (name: string, body: (t: TestContext) => Promise<void>) => nodeTest(name, { timeout: 30000 }, body)

const routes = ["/suggestions/manage", "/suggestions/member", "/suggestions/query", "/suggestions/work"]
const modules = {
    "../convex/suggestions.ts": () => import("../convex/suggestions.ts"),
    "../convex/suggestionsWork.ts": () => import("../convex/suggestionsWork.ts"),
    "../convex/suggestionsCleanup.ts": () => import("../convex/suggestionsCleanup.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"),
}

const rawEpoch = "2020-02-29T00:30:00.123456789+00:00"
const actor: C.ModerationActor = { userId: "20", roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: true }
const owner: C.ModerationActor = { ...actor, userId: "10", isOwner: true }
const admin: C.ModerationActor = { ...actor, userId: "11", isAdministrator: true }
const cardBinding = ({ suggestionNo, cardGeneration, desiredRevision }: C.SuggestionsCardBinding): C.SuggestionsCardBinding => ({ suggestionNo, cardGeneration, desiredRevision })
const publisherBinding = (grant: C.SuggestionsCardGrant, claimToken = "a".repeat(32)) => ({ serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, claimToken })

async function fixture(t: Parameters<typeof adapterFixture>[0]) {
    const f = await adapterFixture(t, modules)
    const store = createSuggestionsStore(f.config), wrongStore = createSuggestionsStore(f.wrongConfig), publishing = createPublishingStore(f.config)
    const context = (who = owner, channelId = "30", joinedAt = rawEpoch): C.SuggestionsContext => ({ observedAt: f.now(), actor: who, channelId, botId: "999", botAuthorized: true, actorAuthorized: true,
        member: { userId: who.userId, joinedAt, roleIds: who.roleIds, isBot: false, timeoutUntil: null, canView: true, canReadHistory: true } })
    const cardContext = (channelId = "30"): C.SuggestionsCardContext => ({ observedAt: f.now(), channelId, botId: "999", botAuthorized: true })
    const manageInput = (operation: C.SuggestionsManageOperation, current = context()): C.SuggestionsManageRequest => ({ ...f.source(), context: current, operation })
    const manage = (operation: C.SuggestionsManageOperation, current = context()) => f.run<C.SuggestionsManageResult>(store.manage(manageInput(operation, current)))
    const memberInput = (operation: C.SuggestionsMemberRequest["operation"], current = context(actor)): C.SuggestionsMemberRequest => ({ ...f.source(), context: current, operation })
    const member = (operation: C.SuggestionsMemberRequest["operation"], current = context(actor)) => f.run<C.SuggestionsMemberResult>(store.member(memberInput(operation, current)))
    const queryInput = (operation: C.SuggestionsQueryRequest["operation"], current = context()): C.SuggestionsQueryRequest => ({ serverId: "1", context: current, operation })
    const query = (operation: C.SuggestionsQueryRequest["operation"], current = context()) => f.run<C.SuggestionsQueryResult>(store.query(queryInput(operation, current)))
    const settings = async () => { const value = await query({ type: "settings" }); assert.equal(value.type, "settings"); return value.settings }
    const show = async (suggestionNo: number, current = context()) => { const value = await query({ type: "show", suggestionNo }, current); assert.equal(value.type, "suggestion"); return value.suggestion }
    const mine = async (suggestionNo: number, current = context(actor)) => { const value = await query({ type: "mine", suggestionNo }, current); assert.equal(value.type, "vote"); return value }
    const open = async () => {
        const first = await settings()
        const configured = await manage({ type: "configure", expectedRevision: first.revision, channelId: "30" })
        assert(!configured.duplicate && configured.type === "settings")
        await manage({ type: "settings", expectedRevision: configured.settings.revision, enabled: true })
    }
    const submit = async (text = "Synthetic immutable proposition", current = context(actor)) => { const value = await member({ type: "submit", text }, current); assert.equal(value.type, "suggestion"); return value.suggestion }
    const voteInput = async (suggestionNo: number, choice: C.SuggestionsVoteChoice, current = context(actor)) =>
        ({ ...f.source(), context: current, operation: { type: "vote" as const, suggestionNo, choice } })
    const vote = async (suggestionNo: number, choice: C.SuggestionsVoteChoice, current = context(actor)) => { const value = await f.run<C.SuggestionsMemberResult>(store.member(await voteInput(suggestionNo, choice, current))); assert.equal(value.type, "vote"); return value }
    const work = (operation: C.SuggestionsWorkRequest["operation"]) => f.run<C.SuggestionsWorkResult>(store.work({ serverId: "1", operation }))
    const cards = async (cursor?: C.SuggestionsWorkCursor) => { const value = await work({ type: "list", ...(cursor ? { cursor } : {}) }); assert.equal(value.type, "cards"); return value }
    const reserve = async (row: C.SuggestionsCardBinding, current = cardContext()) => { const value = await work({ type: "reserve", binding: cardBinding(row), context: current }); assert.equal(value.type, "reserved"); return value.grant }
    // Privileged readback verifies immutable audit, including older replacement generations.
    // Public visibility is exercised separately through the owning authenticated Suggestions routes.
    const post = (postNo: number) => f.backend.run(async ctx => {
        const row = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", "1").eq("postNo", postNo)).unique()
        assert(row)
        return publicPost(ctx, row)
    })
    const dispatch = (grant: C.SuggestionsCardGrant, current = cardContext(), claimToken = "a".repeat(32)) => f.run<C.PublishingDispatchResult>(publishing.dispatch({ ...publisherBinding(grant, claimToken), suggestionContext: current }))
    const outcome = (grant: C.SuggestionsCardGrant, outcome: C.PublishingOutcomeRequest["outcome"], messageId?: string) => f.run<C.PublishingOutcomeResult>(publishing.outcome({ ...publisherBinding(grant), outcome, ...(messageId ? { messageId } : {}) }))
    const sent = async (row: C.SuggestionsCardBinding, messageId = "2000") => { const grant = await reserve(row); assert((await dispatch(grant)).claimed); assert.deepEqual(await outcome(grant, "sent", messageId), { recorded: true }); return grant }
    const cleanup = () => f.backend.mutation(makeFunctionReference<"mutation">("suggestionsCleanup:cleanup"), {})
    return { ...f, store, wrongStore, publishing, context, cardContext, manageInput, manage, memberInput, member, queryInput, query, settings, show, mine, open, submit, voteInput, vote, work, cards, reserve, post, dispatch, outcome, sent, cleanup }
}

async function sdk() {
    const require = createRequire(new URL("../../bot/package.json", import.meta.url))
    const { Clock, Effect, Exit, Deferred, Fiber, Random, Redacted } = await import(pathToFileURL(require.resolve("effect")).href)
    const { TestClock } = await import(pathToFileURL(require.resolve("effect/testing")).href)
    const root = new URL("./", pathToFileURL(require.resolve("@neontechspace/fluxerly/effect")))
    const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"))
    const { Permissions } = await import(new URL(pkg.exports["./effect"].import, root).href)
    const { createTestBot } = await import(new URL(pkg.exports["./effect/testing"].import, root).href)
    return { Clock, Effect, Exit, Deferred, Fiber, Random, Redacted, TestClock, Permissions, createTestBot }
}

async function withNative(f: Awaited<ReturnType<typeof adapterFixture>>, body: (runtime: Awaited<ReturnType<typeof sdk>>, bot: any) => any, onRetry?: (delay: number) => void) {
    const runtime = await sdk(), { Clock, Effect, Random, TestClock, Permissions, createTestBot } = runtime
    return f.run(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${f.now()} millis`)
        const clock = yield* Clock.Clock, origin = clock.monotonicTimeNanosUnsafe()
        const monotonicTimeNanosUnsafe = () => clock.monotonicTimeNanosUnsafe() - origin
        const sdkClock = { ...clock, monotonicTimeNanosUnsafe, monotonicTimeNanos: Effect.sync(monotonicTimeNanosUnsafe) }
        const bot = yield* createTestBot({ token: "synthetic-suggestions-adapter-sdk-token", ...(onRetry ? { logging: { level: "debug", dedupe: false, sink: (record: { code: string, delayMs?: number }) => { if (record.code === "rest.retry") onRetry(record.delayMs!) } } } : {}) }).pipe(Effect.provideService(Clock.Clock, sdkClock)), native = bot.fixtures
        const staffRole = native.role({ permissions: Permissions.Administrator.toString() })
        const botRole = native.role({ permissions: (Permissions.ViewChannel | Permissions.SendMessages | Permissions.ReadMessageHistory | Permissions.EmbedLinks).toString() })
        const everyone = native.role({ id: "1", permissions: (Permissions.ViewChannel | Permissions.ReadMessageHistory).toString() })
        bot.rest.respond("GET /users/@me", { body: native.botUser({ id: "999" }) })
        bot.rest.respond("GET /guilds/1", { body: native.guild({ id: "1", owner_id: "10", name: "Synthetic server" }) })
        bot.rest.respond("GET /guilds/1/roles", { body: [everyone, staffRole, botRole] })
        for (const userId of ["10", "11"]) bot.rest.respond(`GET /guilds/1/members/${userId}`, { body: native.member({ user: native.user({ id: userId }), roles: [staffRole.id], joined_at: rawEpoch, communication_disabled_until: null }) })
        bot.rest.respond("GET /guilds/1/members/999", { body: native.member({ user: native.botUser({ id: "999" }), roles: [botRole.id], joined_at: rawEpoch, communication_disabled_until: null }) })
        for (const userId of ["20", "21"]) bot.rest.respond(`GET /guilds/1/members/${userId}`, { body: native.member({ user: native.user({ id: userId }), roles: [], joined_at: rawEpoch, communication_disabled_until: null }) })
        for (const id of ["30", "31"]) bot.rest.respond(`GET /channels/${id}`, { body: native.channel({ id, guild_id: "1" }) })
        yield* body(runtime, bot)
    })).pipe(Random.withSeed("synthetic-suggestions-sdk-retry"), Effect.provide(TestClock.layer())))
}

// Every elapsed backend interval in a native test also advances and awaits Effect's clock.
function advanceNative(f: Awaited<ReturnType<typeof adapterFixture>>, runtime: Awaited<ReturnType<typeof sdk>>, milliseconds: number) {
    assert(milliseconds >= 0)
    return runtime.Effect.sync(() => f.advance(milliseconds)).pipe(runtime.Effect.andThen(runtime.TestClock.adjust(`${milliseconds} millis`)))
}

// These wrappers observe or pause real operations. They never supply a replacement DTO.
function barrier() {
    let entered!: () => void, release!: () => void, rejectReached!: (error: Error) => void, wasEntered = false
    const reached = new Promise<void>((done, reject) => { entered = done; rejectReached = reject })
    const released = new Promise<void>(done => { release = done })
    return { reached, release, finish: () => { if (!wasEntered) rejectReached(new Error("Worker completed before reaching the requested real boundary")) }, wait: async () => { wasEntered = true; entered(); await released } }
}

function nativeCard(bot: any, messageId = "2000") {
    const messages = new Map<string, any>()
    const response = (request: { body: Record<string, unknown> }, id: string) => {
        const embeds = request.body.embeds as Record<string, unknown>[] | undefined
        const returnedEmbeds = embeds?.map(embed => ({ type: "rich", ...embed, ...(Array.isArray(embed.fields) ? { fields: embed.fields.map((field: Record<string, unknown>) => ({ inline: false, ...field })) } : {}) })) ?? []
        const message = bot.fixtures.message({ id, guild_id: "1", channel_id: "30", author: bot.fixtures.botUser({ id: "999" }), ...request.body, embeds: returnedEmbeds })
        messages.set(id, message)
        return { body: message }
    }
    const send = bot.rest.respond("POST /channels/30/messages", (request: { body: Record<string, unknown> }) => response(request, messageId))
    const baseline = bot.rest.respond("GET /channels/30/messages/2000", () => ({ body: messages.get("2000") }))
    const edit = bot.rest.respond("PATCH /channels/30/messages/2000", (request: { body: Record<string, unknown> }) => response(request, "2000"))
    return { messages, send, baseline, edit, response }
}

test("suggestions authenticate every actual route and keep disabled reads body-free", async t => {
    const f = await fixture(t), before = await f.settings()
    assert.equal(before.enabled, false)
    assert.equal(before.suggestions, 0)
    assert.equal(before.voters, 0)
    for (const effect of [
        f.wrongStore.manage(f.manageInput({ type: "configure", expectedRevision: before.revision, channelId: "30" })),
        f.wrongStore.member(f.memberInput({ type: "submit", text: "Synthetic denied" })),
        f.wrongStore.query(f.queryInput({ type: "settings" })),
        f.wrongStore.work({ serverId: "1", operation: { type: "list" } }),
    ]) await f.reject(effect, SuggestionsStoreError, 401)
    await f.reject(f.store.query({ ...f.queryInput({ type: "settings" }), serverId: "2" }), SuggestionsStoreError, 403)
    await f.reject(f.store.manage(f.manageInput({ type: "configure", expectedRevision: before.revision, channelId: "30" }, f.context(actor))), SuggestionsStoreError, 403)
    await f.reject(f.store.member(f.memberInput({ type: "submit", text: "Synthetic disabled" })), SuggestionsStoreError, 403)
    assert.deepEqual(await f.settings(), before)
    assert.deepEqual(new Set(f.calls.filter(call => call.status === 401).map(call => call.path)), new Set(routes))
})

test("tolerated future submit decodes actual persisted readback without weakening source replay or order", async t => {
    const f = await fixture(t); await f.open()
    const now = f.now(), input = { ...f.memberInput({ type: "submit", text: "Synthetic tolerated future proposition" }), createdAt: now + 1000 }
    const submitted = await f.run<C.SuggestionsMemberResult>(f.store.member(input))
    assert.equal(submitted.type, "suggestion"); assert.equal(submitted.duplicate, false)
    const row = submitted.suggestion
    assert.equal(row.createdAt, input.createdAt); assert.equal(row.updatedAt, now)
    assert(row.updatedAt < row.createdAt, "Source time and backend update time use separate clocks")
    assert.deepEqual(await f.show(row.suggestionNo, f.context(actor)), row)
    const persisted = await f.backend.run(async ctx => (await ctx.db.query("suggestions").collect())[0]!)
    assert.equal(persisted.sourceId, input.messageId); assert.equal(persisted.sourceCreatedAt, input.createdAt)
    assert.equal(persisted.authorJoinedAt, rawEpoch); assert.equal(persisted.createdAt, row.createdAt); assert.equal(persisted.updatedAt, now)
    assert.deepEqual(await f.run(f.store.member(input)), { ...submitted, duplicate: true })
    for (const changed of [
        { ...input, operation: { type: "submit" as const, text: "Synthetic conflicting proposition" } },
        { ...input, createdAt: input.createdAt + 1 },
        { ...input, context: f.context({ ...actor, userId: "21" }) },
        { ...input, context: f.context(actor, "30", "2020-03-01T00:00:00Z") },
    ]) await f.reject(f.store.member(changed), SuggestionsStoreError, 409)
    for (const createdAt of [now + 60001, now - 900001]) {
        await f.reject(f.store.member({ ...f.memberInput(input.operation), createdAt }), SuggestionsStoreError, 400)
    }
    const beforeCreation = await f.voteInput(row.suggestionNo, "up")
    await f.reject(f.store.member(beforeCreation), SuggestionsStoreError, 409)
    const orderedInput = { ...beforeCreation, createdAt: input.createdAt, messageId: "1000000000000000000" }
    const accepted = await f.run<C.SuggestionsMemberResult>(f.store.member(orderedInput))
    assert.equal(accepted.type, "vote"); assert.equal(accepted.accepted, true)
    assert.equal(accepted.vote?.acceptedCreatedAt, input.createdAt); assert.equal(accepted.vote?.acceptedMessageId, orderedInput.messageId)
    assert.equal(accepted.suggestion.up, 1); assert.equal(accepted.suggestion.updatedAt, now)
    const olderInput = { ...await f.voteInput(row.suggestionNo, "down"), createdAt: input.createdAt, messageId: "999999999999999999" }
    const older = await f.run<C.SuggestionsMemberResult>(f.store.member(olderInput))
    assert.equal(older.type, "vote"); assert.equal(older.accepted, false)
    assert.deepEqual(older.vote, accepted.vote); assert.deepEqual(await f.show(row.suggestionNo), accepted.suggestion)
    f.advance(86400001); await f.cleanup()
    assert.equal((await f.settings()).memberReceipts, 0)
    assert.deepEqual(await f.run(f.store.member({ ...input, context: f.context(actor) })), { duplicate: true, type: "suggestion", suggestion: accepted.suggestion })
    assert.equal((await f.settings()).suggestions, 1)
    assert.equal((await f.backend.run(ctx => ctx.db.query("suggestions").collect())).length, 1)
})

test("actual submit discovery worker send and vote edit retain one native card and suppress mentions", async t => {
    const f = await fixture(t); await f.open(); const suggestion = await f.submit("Synthetic <@21> @everyone proposition")
    assert.equal(suggestion.authorId, "20")
    assert.equal(suggestion.cardStale, true)
    assert.equal((await f.cards()).cards.length, 0)
    f.advance(5000)
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect } = runtime
        const native = nativeCard(bot), paths = f.calls.length
        const observed = { ...f.store, work: (input: C.SuggestionsWorkRequest) => f.store.work(input).pipe(Effect.tap((page: C.SuggestionsWorkResult) => Effect.sync(() => {
            if (input.operation.type !== "list") return
            assert.equal(page.type, "cards")
            assert.equal(page.cards.length, 1)
            assert.equal(page.cards[0]!.suggestionNo, suggestion.suggestionNo)
            assert.equal(page.cards[0]!.dueAt, suggestion.createdAt + 5000)
            assert(page.cards[0]!.nextCheckAt > f.now(), "Actionable rows retain independent future rescan metadata")
        }))) }
        const pass = yield* processSuggestionsPass(observed, f.publishing, "1", bot.client)
        assert.equal(pass.considered, 1)
        assert.equal(native.send.requests().length, 1)
        assert.equal(native.edit.requests().length, 0)
        const firstBody = native.send.requests()[0]!.body as { content: string, allowed_mentions: unknown }
        assert.deepEqual(firstBody.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        assert(JSON.stringify(firstBody).includes("Synthetic"))
        assert(f.calls.slice(paths).some(call => call.path === "/publishing/dispatch" && call.status === 200))
        const published = yield* Effect.promise(() => f.show(suggestion.suggestionNo))
        assert.equal(published.cardState, "current")
        const vote = yield* Effect.promise(() => f.vote(suggestion.suggestionNo, "up"))
        assert.equal(vote.accepted, true)
        yield* advanceNative(f, runtime, 5000)
        const edited = yield* processSuggestionsPass(f.store, f.publishing, "1", bot.client)
        assert.equal(edited.considered, 1)
        assert.equal(native.send.requests().length, 1)
        assert.equal(native.baseline.requests().length, 1)
        assert.equal(native.edit.requests().length, 1)
        assert.deepEqual((native.edit.requests()[0]!.body as { allowed_mentions: unknown }).allowed_mentions, firstBody.allowed_mentions)
        assert(!bot.requests().some((request: { method: string }) => request.method === "DELETE"))
        const idle = yield* processSuggestionsPass(f.store, f.publishing, "1", bot.client)
        assert.equal(idle.considered, 0)
    }))
    const current = await f.show(suggestion.suggestionNo)
    assert.equal(current.up, 1)
    assert.equal(current.down, 0)
    assert.equal(current.publishedRevision, current.desiredRevision)
    assert.equal(current.cardStale, false)
    assert(current.postNo)
    const post = await f.post(current.postNo)
    assert.equal(post.messageId, "2000")
    assert.equal(post.generation, 2)
    assert.equal(post.attempt.source?.type, "suggestion-card")
    assert.deepEqual(post.consumer, { type: "suggestion-card", ...cardBinding(current) })
})

test("ordered votes atomically replace counts, permit self-votes and retain clear tombstones", async t => {
    const f = await fixture(t); await f.open(); const row = await f.submit()
    const input = await f.voteInput(row.suggestionNo, "up")
    const first = await f.run<C.SuggestionsMemberResult>(f.store.member(input)); assert.equal(first.type, "vote"); assert(first.accepted)
    assert.equal(first.suggestion.up, 1)
    const duplicate = await f.run<C.SuggestionsMemberResult>(f.store.member(input))
    assert.equal(duplicate.duplicate, true)
    assert.equal((await f.show(row.suggestionNo)).up, 1)
    await f.reject(f.store.member({ ...input, operation: { ...input.operation, choice: "down" } }), SuggestionsStoreError, 409)
    const changed = await f.vote(row.suggestionNo, "down")
    assert.equal(changed.suggestion.up, 0); assert.equal(changed.suggestion.down, 1)
    const clear = await f.vote(row.suggestionNo, "clear")
    assert.equal(clear.suggestion.up, 0); assert.equal(clear.suggestion.down, 0)
    assert.equal(clear.suggestion.voters, 1, "Zero-vote ordering rows remain counted")
    assert.equal(clear.vote?.choice, "clear")
    assert.equal(clear.vote?.joinedAt, rawEpoch)
    assert.equal((await f.mine(row.suggestionNo, f.context({ ...actor, userId: "21" }))).vote, null)
    const publicRows = await f.query({ type: "list" }, f.context(actor))
    assert(!JSON.stringify(publicRows).includes("acceptedMessageId") && !JSON.stringify(publicRows).includes(rawEpoch))
    assert.equal((await f.settings()).voters, 1)
})

test("source order uses numeric same-time identity and rejects commands preceding suggestion or membership", async t => {
    const f = await fixture(t); await f.open(); const row = await f.submit()
    const high = { ...await f.voteInput(row.suggestionNo, "down"), messageId: "1000000000000000000" }
    const accepted = await f.run<C.SuggestionsMemberResult>(f.store.member(high)); assert.equal(accepted.type, "vote"); assert(accepted.accepted)
    const older = { ...await f.voteInput(row.suggestionNo, "up"), messageId: "999999999999999999" }
    const stale = await f.run<C.SuggestionsMemberResult>(f.store.member(older)); assert.equal(stale.type, "vote"); assert.equal(stale.accepted, false)
    assert.equal((await f.show(row.suggestionNo)).down, 1)
    await f.reject(f.store.member({ ...await f.voteInput(row.suggestionNo, "up"), createdAt: row.createdAt - 1 }), SuggestionsStoreError, 409)
    const rejoined = f.context(actor, "30", new Date(f.now() + 1).toISOString())
    f.advance(1); rejoined.observedAt = f.now()
    await f.reject(f.store.member({ ...await f.voteInput(row.suggestionNo, "up", rejoined), createdAt: f.now() - 1 }), SuggestionsStoreError, 409)
    const next = await f.run<C.SuggestionsMemberResult>(f.store.member({ ...await f.voteInput(row.suggestionNo, "up", rejoined), messageId: "1000000000000000001" }))
    assert.equal(next.type, "vote"); assert(next.accepted)
    assert.equal(next.suggestion.up, 1); assert.equal(next.suggestion.down, 0)
    const priorEpoch = { ...await f.voteInput(row.suggestionNo, "down", f.context(actor)), messageId: "1000000000000000002" }
    const staleEpoch = await f.run<C.SuggestionsMemberResult>(f.store.member(priorEpoch))
    assert.equal(staleEpoch.type, "vote"); assert.equal(staleEpoch.accepted, false)
    assert.equal((await f.show(row.suggestionNo)).up, 1)
})

test("receipt expiry cannot resurrect a cleared account vote or duplicate a retained submission", async t => {
    const f = await fixture(t); await f.open()
    const input = f.memberInput({ type: "submit", text: "Synthetic retained submit anchor" })
    const submitted = await f.run<C.SuggestionsMemberResult>(f.store.member(input)); assert.equal(submitted.type, "suggestion")
    await f.vote(submitted.suggestion.suggestionNo, "up")
    const clearInput = await f.voteInput(submitted.suggestion.suggestionNo, "clear")
    await f.run(f.store.member(clearInput))
    f.advance(86400001); await f.cleanup()
    assert.equal((await f.settings()).memberReceipts, 0)
    const clear = await f.mine(submitted.suggestion.suggestionNo)
    assert.equal(clear.vote?.choice, "clear")
    assert.equal(clear.vote?.acceptedMessageId, clearInput.messageId)
    await f.reject(f.store.member({ ...clearInput, createdAt: f.now(), context: f.context(actor), operation: { ...clearInput.operation, choice: "up" } }), SuggestionsStoreError, 409)
    const repeated = await f.run<C.SuggestionsMemberResult>(f.store.member({ ...input, context: f.context(actor) }))
    assert(repeated.duplicate && repeated.type === "suggestion")
    assert.equal(repeated.suggestion.suggestionNo, submitted.suggestion.suggestionNo)
    assert.equal((await f.settings()).suggestions, 1)
})

test("destination privacy applies to show list mine and votes independently from publisher eligibility", async t => {
    const f = await fixture(t); await f.open(); const row = await f.submit()
    for (const field of ["canView", "canReadHistory"] as const) {
        const hidden = f.context(actor); hidden.member![field] = false
        for (const operation of [{ type: "show", suggestionNo: row.suggestionNo }, { type: "mine", suggestionNo: row.suggestionNo }] satisfies C.SuggestionsQueryRequest["operation"][]) {
            await f.reject(f.store.query(f.queryInput(operation, hidden)), SuggestionsStoreError, 403)
        }
        await f.reject(f.store.query(f.queryInput({ type: "list" }, hidden)), SuggestionsStoreError, 403)
        await f.reject(f.store.member(f.memberInput({ type: "vote", suggestionNo: row.suggestionNo, choice: "up" }, hidden)), SuggestionsStoreError, 403)
    }
    const accepted = await f.vote(row.suggestionNo, "up")
    assert(accepted.accepted, "Member authorization is independent from staff publish permissions")
    f.advance(5000)
    await f.reject(f.store.work({ serverId: "1", operation: { type: "reserve", binding: cardBinding(await f.show(row.suggestionNo)), context: { ...f.cardContext(), botAuthorized: false } as unknown as C.SuggestionsCardContext } }), SuggestionsStoreError, 403)
    await f.work({ type: "defer", binding: cardBinding(await f.show(row.suggestionNo)) })
    assert.equal((await f.show(row.suggestionNo)).up, 1)
    assert.equal((await f.settings()).blocked, 1)
})

test("staff lifecycle keeps immutable text and destination, closes and reopens voting with the latest public reason", async t => {
    const f = await fixture(t); await f.open(); const original = await f.submit()
    let row = original
    for (const state of ["planned", "completed", "under-review", "declined"] as const) {
        const result = await f.manage({ type: "status", suggestionNo: row.suggestionNo, expectedRevision: row.revision, state, reason: `Synthetic ${state} reason` }, f.context(admin))
        assert(!result.duplicate && result.type === "suggestion"); row = result.suggestion
        assert.equal(row.authorId, actor.userId)
        assert.equal(row.text, original.text)
        assert.equal(row.statusBy, admin.userId)
        assert.equal(row.reason, `Synthetic ${state} reason`)
        if (state === "completed" || state === "declined") await f.reject(f.store.member(await f.voteInput(row.suggestionNo, "up")), SuggestionsStoreError, 403)
        else assert((await f.vote(row.suggestionNo, "up")).accepted)
    }
    const settings = await f.settings()
    await f.manage({ type: "configure", expectedRevision: settings.revision, channelId: "31" }, f.context(admin, "31"))
    assert.equal((await f.show(row.suggestionNo)).channelId, "30")
    const next = await f.submit("Synthetic new destination", f.context(actor, "31"))
    assert.equal(next.channelId, "31")
})

test("disable preserves canonical state and permits final author withdrawal while forbidding new commands and native claims", async t => {
    const f = await fixture(t); await f.open(); const row = await f.submit(); await f.vote(row.suggestionNo, "up")
    f.advance(5000); const grant = await f.reserve(await f.show(row.suggestionNo))
    const settings = await f.settings(); await f.manage({ type: "settings", expectedRevision: settings.revision, enabled: false })
    assert.equal((await f.dispatch(grant)).claimed, false)
    await f.reject(f.store.member(f.memberInput({ type: "submit", text: "Synthetic disabled new proposition" })), SuggestionsStoreError, 403)
    await f.reject(f.store.member(await f.voteInput(row.suggestionNo, "down")), SuggestionsStoreError, 403)
    const withdrawn = await f.member({ type: "withdraw", suggestionNo: row.suggestionNo, expectedRevision: row.revision, confirm: true })
    assert.equal(withdrawn.type, "suggestion"); assert.equal(withdrawn.suggestion.state, "withdrawn")
    assert.equal(withdrawn.suggestion.up, 1)
    await f.reject(f.store.manage(f.manageInput({ type: "status", suggestionNo: row.suggestionNo, expectedRevision: withdrawn.suggestion.revision, state: "under-review", reason: "Synthetic forbidden resurrection" })), SuggestionsStoreError, 409)
    assert.equal((await f.post(grant.postNo)).attempt.dispatchedAt, undefined)
})

test("coalescing fixes first-dirty due time and stale unclaimed grants cannot acknowledge newer intent", async t => {
    const f = await fixture(t); await f.open(); const row = await f.submit()
    f.advance(4000); await f.vote(row.suggestionNo, "up")
    f.advance(1000); const page = await f.cards(); assert.equal(page.cards.length, 1)
    assert.equal(page.cards[0]!.dueAt, row.createdAt + 5000)
    const grant = await f.reserve(page.cards[0]!)
    await f.vote(row.suggestionNo, "down")
    assert.equal((await f.dispatch(grant)).claimed, false)
    const post = await f.post(grant.postNo)
    assert.equal(post.attempt.dispatchedAt, undefined)
    assert.equal(post.attempt.noDispatch, true)
    const current = await f.show(row.suggestionNo)
    assert.equal(current.down, 1); assert.equal(current.publishedRevision, 0); assert.equal(current.cardStale, true)
    assert(current.desiredRevision > grant.consumer.desiredRevision)
})

test("exact unclaimed recovery reuses a single reservation and claimed old outcomes retain newer dirty work", async t => {
    const f = await fixture(t); await f.open(); const row = await f.submit(); f.advance(5000)
    const grant = await f.reserve(row), before = await f.settings()
    f.advance(1000)
    assert.deepEqual(await f.reserve(row), grant)
    assert.deepEqual(await f.settings(), before)
    assert((await f.dispatch(grant)).claimed)
    assert.equal((await f.dispatch(grant, f.cardContext(), "b".repeat(32))).claimed, false)
    const changed = await f.vote(row.suggestionNo, "up")
    assert.deepEqual(await f.outcome(grant, "sent", "2000"), { recorded: true })
    const after = await f.show(row.suggestionNo)
    assert.equal(after.publishedRevision, grant.consumer.desiredRevision)
    assert.equal(after.desiredRevision, changed.suggestion.desiredRevision)
    assert.equal(after.cardStale, true)
    assert.equal((await f.settings()).dirty, 1)
    f.advance(5000)
    const next = await f.reserve(after)
    assert.equal(next.action, "edit"); assert.equal(next.messageId, "2000")
    assert.equal(next.postNo, grant.postNo); assert.equal(next.generation, grant.generation + 1)
    assert.deepEqual(next.expectedContent, grant.canonicalContent)
    assert((await f.dispatch(next)).claimed); await f.outcome(next, "sent", "2000")
    assert.equal((await f.show(row.suggestionNo)).cardStale, false)
    assert.deepEqual(await f.outcome(grant, "sent", "2000"), { recorded: false })
})

for (const stage of ["reserve", "baseline", "claim", "edit", "outcome"] as const) test(`actual worker ${stage} barrier fences stale snapshots and preserves later vote or status`, async t => {
    const f = await fixture(t); await f.open(); const original = await f.submit(); f.advance(5000)
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect, Fiber } = runtime, native = nativeCard(bot)
        yield* processSuggestionsPass(f.store, f.publishing, "1", bot.client)
        const voted = yield* Effect.promise(() => f.vote(original.suggestionNo, "up"))
        yield* advanceNative(f, runtime, 5000)
        const gate = barrier()
        const store = stage === "reserve" ? { ...f.store, work: (input: C.SuggestionsWorkRequest) => f.store.work(input).pipe(Effect.tap((result: C.SuggestionsWorkResult) => input.operation.type === "reserve" && result.type === "reserved" ? Effect.promise(() => gate.wait()) : Effect.void)) } : f.store
        const publishing = stage === "claim" ? { ...f.publishing, dispatch: (input: C.PublishingDispatchRequest) => f.publishing.dispatch(input).pipe(Effect.tap((result: C.PublishingDispatchResult) => result.claimed ? Effect.promise(() => gate.wait()) : Effect.void)) }
            : stage === "outcome" ? { ...f.publishing, outcome: (input: C.PublishingOutcomeRequest) => Effect.promise(() => gate.wait()).pipe(Effect.andThen(f.publishing.outcome(input))) } : f.publishing
        if (stage === "baseline") { native.baseline.remove(); bot.rest.respond("GET /channels/30/messages/2000", async () => { const snapshot = native.messages.get("2000"); await gate.wait(); return { body: snapshot } }) }
        if (stage === "edit") { native.edit.remove(); bot.rest.respond("PATCH /channels/30/messages/2000", async (request: { body: Record<string, unknown> }) => { await gate.wait(); return native.response(request, "2000") }) }
        const running = yield* Effect.forkChild(processSuggestionsPass(store, publishing, "1", bot.client).pipe(Effect.ensuring(Effect.sync(() => gate.finish()))))
        yield* Effect.promise(() => gate.reached)
        const changed = stage === "edit"
            ? yield* Effect.promise(() => f.manage({ type: "status", suggestionNo: original.suggestionNo, expectedRevision: original.revision, state: "completed", reason: "Synthetic newer status while edit waits" }))
            : yield* Effect.promise(() => f.vote(original.suggestionNo, "down"))
        assert(!changed.duplicate)
        const newer = yield* Effect.promise(() => f.show(original.suggestionNo))
        assert(newer.desiredRevision > voted.suggestion.desiredRevision)
        yield* Effect.sync(() => gate.release())
        yield* Fiber.join(running)
        const current = yield* Effect.promise(() => f.show(original.suggestionNo))
        assert.equal(current.desiredRevision, newer.desiredRevision)
        assert.equal(current.cardStale, true)
        assert.equal(current.publishedRevision, stage === "reserve" || stage === "baseline" ? original.desiredRevision : voted.suggestion.desiredRevision)
        const writes = bot.requests().filter((request: { method: string }) => request.method === "PATCH")
        assert.equal(writes.length, stage === "reserve" || stage === "baseline" ? 0 : 1)
        assert.equal((yield* Effect.promise(() => f.settings())).dirty, 1)
        yield* advanceNative(f, runtime, 5000)
        if (stage === "baseline") bot.rest.respond("GET /channels/30/messages/2000", () => ({ body: native.messages.get("2000") }))
        yield* processSuggestionsPass(f.store, f.publishing, "1", bot.client)
        const settled = yield* Effect.promise(() => f.show(original.suggestionNo))
        assert.equal(settled.publishedRevision, settled.desiredRevision)
        assert.equal(settled.cardStale, false)
        assert.equal(native.send.requests().length, 1)
    }))
})

test("two actual workers share one reservation and only one claims or acknowledges the native send", async t => {
    const f = await fixture(t); await f.open(); const row = await f.submit(); f.advance(5000)
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect, Fiber } = runtime, gate = barrier(), native = nativeCard(bot)
        let observed: C.SuggestionsCardGrant | undefined
        const firstStore = { ...f.store, work: (input: C.SuggestionsWorkRequest) => f.store.work(input).pipe(Effect.tap((result: C.SuggestionsWorkResult) => {
            if (input.operation.type !== "reserve" || result.type !== "reserved") return Effect.void
            observed = result.grant
            return Effect.promise(() => gate.wait())
        })) }
        const first = yield* Effect.forkChild(processSuggestionsPass(firstStore, f.publishing, "1", bot.client).pipe(Effect.ensuring(Effect.sync(() => gate.finish()))))
        yield* Effect.promise(() => gate.reached)
        assert(observed)
        yield* advanceNative(f, runtime, 60000)
        const second = yield* processSuggestionsPass(createSuggestionsStore(f.config), createPublishingStore(f.config), "1", bot.client)
        assert.equal(second.considered, 1)
        assert.equal(native.send.requests().length, 1)
        yield* Effect.sync(() => gate.release())
        yield* Fiber.join(first)
        assert.equal(native.send.requests().length, 1)
        const claims = f.calls.filter(call => call.path === "/publishing/dispatch")
        assert.equal(claims.length, 2)
        assert.equal(f.calls.filter(call => call.path === "/publishing/outcome").length, 1)
    }))
    const current = await f.show(row.suggestionNo); assert(current.postNo)
    const post = await f.post(current.postNo)
    assert.equal(post.generation, 1)
    assert.equal(post.messageId, "2000")
    assert.equal((await f.settings()).dirty, 0)
})

test("two actual edit workers cannot reserve overlapping attempts for the same protected post", async t => {
    const f = await fixture(t); await f.open(); const row = await f.submit(); f.advance(5000)
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect, Fiber } = runtime, native = nativeCard(bot), gate = barrier()
        yield* processSuggestionsPass(f.store, f.publishing, "1", bot.client)
        yield* Effect.promise(() => f.vote(row.suggestionNo, "up")); yield* advanceNative(f, runtime, 5000)
        native.edit.remove()
        const edit = bot.rest.respond("PATCH /channels/30/messages/2000", async (request: { body: Record<string, unknown> }) => { await gate.wait(); return native.response(request, "2000") })
        const first = yield* Effect.forkChild(processSuggestionsPass(f.store, f.publishing, "1", bot.client).pipe(Effect.ensuring(Effect.sync(() => gate.finish()))))
        yield* Effect.promise(() => gate.reached)
        const current = yield* Effect.promise(() => f.show(row.suggestionNo)); assert(current.postNo)
        const second = yield* processSuggestionsPass(createSuggestionsStore(f.config), createPublishingStore(f.config), "1", bot.client)
        assert.equal(second.considered, 0)
        const attempts = yield* Effect.promise(() => f.backend.run(ctx => ctx.db.query("publishingAttempts").collect()))
        assert.equal(attempts.filter((value: { postNo: number, unresolved: boolean }) => value.postNo === current.postNo && value.unresolved).length, 1)
        assert.equal(edit.requests().length, 1)
        yield* Effect.sync(() => gate.release()); yield* Fiber.join(first)
        assert.equal(edit.requests().length, 1)
        assert.equal(native.send.requests().length, 1)
    }))
})

for (const action of ["send", "edit"] as const) test(`actual unknown native ${action} blocks replay while canonical votes remain accepted`, async t => {
    const f = await fixture(t); await f.open(); const row = await f.submit(); f.advance(5000)
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect } = runtime, native = nativeCard(bot)
        if (action === "edit") {
            yield* processSuggestionsPass(f.store, f.publishing, "1", bot.client)
            yield* Effect.promise(() => f.vote(row.suggestionNo, "up")); yield* advanceNative(f, runtime, 5000)
            native.edit.remove()
        } else native.send.remove()
        const failed = bot.rest.respond(`${action === "send" ? "POST /channels/30/messages" : "PATCH /channels/30/messages/2000"}`, () => { throw new Error("Synthetic opaque write outcome must not persist") })
        yield* processSuggestionsPass(f.store, f.publishing, "1", bot.client)
        assert.equal(failed.requests().length, 1)
        const changed = yield* Effect.promise(() => f.vote(row.suggestionNo, "down")); assert(changed.accepted)
        yield* advanceNative(f, runtime, 190001)
        const restarted = yield* processSuggestionsPass(createSuggestionsStore(f.config), createPublishingStore(f.config), "1", bot.client)
        assert.equal(restarted.considered, 0)
        assert.equal(failed.requests().length, 1)
        assert(!bot.requests().some((request: { path: string, method: string }) => request.method === "DELETE" || /search/.test(request.path)))
    }))
    const current = await f.show(row.suggestionNo); assert(current.postNo)
    const post = await f.post(current.postNo)
    assert.equal(post.outcome, "uncertain")
    assert.equal(current.cardStale, true)
    assert.equal(current.down, 1)
    assert(!JSON.stringify(post).includes("Synthetic opaque"))
    if (action === "send") assert.equal(post.messageId, undefined)
    else assert.equal(post.messageId, "2000")
})

test("exact known-ID reconciliation resolves ownership without rewriting unknown audit or adopting a guessed message", async t => {
    const f = await fixture(t); await f.open(); const row = await f.submit(); f.advance(5000)
    const grant = await f.reserve(row); assert((await f.dispatch(grant)).claimed)
    await f.outcome(grant, "uncertain", "2000")
    const audit = (await f.post(grant.postNo)).attempt
    f.advance(grant.dispatchExpiresAt + 10001 - f.now())
    const binding: C.SuggestionsPostBinding = { suggestionNo: row.suggestionNo, expectedRevision: row.revision, cardGeneration: row.cardGeneration, postNo: grant.postNo, attemptId: grant.attemptId, expectedGeneration: grant.generation }
    const observation: C.PublishingObservation = { observedAt: f.now(), messageId: "2000", channelId: "30", botId: "999", content: grant.canonicalContent }
    await f.reject(f.store.manage(f.manageInput({ type: "reconcile", ...binding, observation: { ...observation, messageId: "2001" } })), SuggestionsStoreError, 409)
    const mismatched = await f.manage({ type: "reconcile", ...binding, observation: { ...observation, content: { content: "Synthetic mismatching card" } } })
    assert(!mismatched.duplicate && mismatched.type === "reconciled")
    assert.equal(mismatched.post.attempt.resolution, undefined)
    assert.equal(mismatched.suggestion.cardStale, true)
    f.advance(1)
    const result = await f.manage({ type: "reconcile", ...binding, observation: { ...observation, observedAt: f.now() } })
    assert(!result.duplicate && result.type === "reconciled" && result.recorded)
    assert.equal(result.suggestion.cardStale, false)
    assert.equal(result.post.outcome, "uncertain")
    assert.equal(result.post.attempt.resolution?.matched, "intended")
    for (const field of ["attemptId", "generation", "sourceId", "source", "provenance", "consumer", "content", "canonicalContent", "dispatchedAt", "finishedAt", "outcome", "messageId"] as const) assert.deepEqual(result.post.attempt[field], audit[field])
    await f.reject(f.publishing.manage({ ...f.source(), actor: owner, operation: { type: "forget", postNo: grant.postNo, expectedGeneration: grant.generation } }), PublishingStoreError, 409)
    assert(!f.calls.some(call => /search|adopt|delete/.test(call.path)))
})

test("actual typed404 replacement queues one new binding while opaque403 cannot authorize repost", async t => {
    const f = await fixture(t); await f.open(); const row = await f.submit(); f.advance(5000)
    const grant = await f.sent(row), audit = await f.post(grant.postNo)
    f.advance(grant.dispatchExpiresAt + 10001 - f.now())
    await withNative(f, ({ Effect, Redacted }, bot) => Effect.gen(function* () {
        const replies: string[] = []
        const invoke = () => Effect.gen(function* () {
            const source = f.source(), args = ["replace", String(row.suggestionNo), String(row.revision), String(row.cardGeneration), "confirm"]
            bot.rest.respond(`GET /channels/30/messages/${source.messageId}`, { body: bot.fixtures.message({ id: source.messageId, guild_id: "1", channel_id: "30", author: bot.fixtures.user({ id: "10" }), timestamp: new Date(f.now()).toISOString(), content: `!suggest ${args.join(" ")}` }) })
            const message = yield* bot.client.messages.fetch({ channelId: "30", id: source.messageId })
            const event = { client: bot.client, message, reply: (input: { content: string }) => Effect.sync(() => { replies.push(input.content) }) } as Parameters<typeof handleSuggestionCommand>[3]
            yield* handleSuggestionCommand(f.store, { token: Redacted.make("synthetic-suggestion-recovery-token"), serverId: "1" }, parseSuggestionCommand(args), event)
        })
        bot.rest.respond("GET /channels/30/messages/2000", { status: 403, body: { message: "Synthetic hidden message is not absence" } })
        const before = f.calls.filter(call => call.path === "/suggestions/manage").length
        yield* invoke()
        assert.equal(f.calls.filter(call => call.path === "/suggestions/manage").length, before)
        assert.match(replies.at(-1)!, /No replacement was authorized/)
        bot.rest.respond("GET /channels/30/messages/2000", { status: 404, body: { message: "Synthetic typed missing message" } })
        yield* invoke()
        assert.equal(f.calls.filter(call => call.path === "/suggestions/manage").length, before + 1)
        assert(!bot.requests().some((request: { method: string }) => ["POST", "PATCH", "DELETE"].includes(request.method)))
    }))
    const replaced = await f.show(row.suggestionNo)
    assert.equal(replaced.cardGeneration, row.cardGeneration + 1)
    assert.equal(replaced.postNo, undefined)
    assert.equal(replaced.publishedRevision, 0)
    assert.deepEqual(await f.post(grant.postNo), audit)
    f.advance(5000); const replacement = await f.sent(replaced, "2001")
    assert.notEqual(replacement.postNo, grant.postNo)
    assert.equal(replacement.consumer.cardGeneration, replaced.cardGeneration)
    assert.deepEqual(await f.post(grant.postNo), audit)
})

test("capacity refusal preserves vote tombstones canonical state and publisher reservations atomically", async t => {
    const f = await fixture(t); await f.open(); const row = await f.submit(); await f.vote(row.suggestionNo, "clear")
    const settingsId = await f.backend.run(async ctx => (await ctx.db.query("suggestionSettings").collect())[0]!._id)
    for (const [field, maximum, effect] of [
        ["suggestions", 1000, () => f.store.member(f.memberInput({ type: "submit", text: "Synthetic full capacity" }))],
        ["voters", 10000, async () => f.store.member(await f.voteInput(row.suggestionNo, "up", f.context({ ...actor, userId: "21" })))],
        ["memberReceipts", 10000, async () => f.store.member(await f.voteInput(row.suggestionNo, "up"))],
        ["staffReceipts", 1000, () => f.store.manage(f.manageInput({ type: "status", suggestionNo: row.suggestionNo, expectedRevision: row.revision, state: "planned", reason: "Synthetic full receipts" }))],
    ] as const) {
        const before = await f.settings()
        await f.backend.run(ctx => ctx.db.patch(settingsId, { [field]: maximum }))
        await f.reject(await effect(), SuggestionsStoreError, 429)
        await f.backend.run(ctx => ctx.db.patch(settingsId, { [field]: before[field] }))
        assert.deepEqual(await f.settings(), before)
        assert.equal((await f.mine(row.suggestionNo)).vote?.choice, "clear")
    }
    const id = await f.backend.run(async ctx => (await ctx.db.query("suggestions").collect())[0]!._id)
    await f.backend.run(ctx => ctx.db.patch(id, { voters: 1000 }))
    await f.reject(f.store.member(await f.voteInput(row.suggestionNo, "up", f.context({ ...actor, userId: "21" }))), SuggestionsStoreError, 429)
    await f.backend.run(ctx => ctx.db.patch(id, { voters: 1 }))
})

test("logical terminal expiry precedes bounded cleanup and preserves unresolved sibling publication", async t => {
    const f = await fixture(t); await f.open(); const settled = await f.submit("Synthetic settled retention"), unknown = await f.submit("Synthetic unresolved retention")
    await f.vote(settled.suggestionNo, "up"); await f.vote(unknown.suggestionNo, "clear")
    f.advance(5000)
    const knownGrant = await f.sent(await f.show(settled.suggestionNo)), unknownGrant = await f.reserve(await f.show(unknown.suggestionNo))
    assert((await f.dispatch(unknownGrant)).claimed); await f.outcome(unknownGrant, "uncertain")
    const completed = await f.manage({ type: "status", suggestionNo: settled.suggestionNo, expectedRevision: settled.revision, state: "completed", reason: "Synthetic completed retention" })
    assert(!completed.duplicate && completed.type === "suggestion")
    const declined = await f.manage({ type: "status", suggestionNo: unknown.suggestionNo, expectedRevision: unknown.revision, state: "declined", reason: "Synthetic declined unresolved" })
    assert(!declined.duplicate && declined.type === "suggestion")
    const audit = await f.post(unknownGrant.postNo), expiry = completed.suggestion.historyExpiresAt!
    assert.equal(expiry, f.now() + 180 * 86400000)
    f.advance(expiry - f.now() - 1)
    assert.equal((await f.show(settled.suggestionNo)).state, "completed")
    f.advance(1)
    await f.reject(f.store.query(f.queryInput({ type: "show", suggestionNo: settled.suggestionNo })), SuggestionsStoreError, 404)
    await f.reject(f.store.member(f.memberInput({ type: "vote", suggestionNo: unknown.suggestionNo, choice: "up" })), SuggestionsStoreError, 404)
    await f.reject(f.store.manage(f.manageInput({ type: "status", suggestionNo: settled.suggestionNo, expectedRevision: completed.suggestion.revision, state: "under-review", reason: "Synthetic expired reopening" })), SuggestionsStoreError, 404)
    const persistedBefore = await f.backend.run(ctx => ctx.db.query("suggestions").collect())
    assert.equal(persistedBefore.length, 2, "Expiry is enforced before physical cleanup runs")
    const cleanup = await f.cleanup()
    assert(cleanup.removed <= 40, "One cleanup transaction bounds expired receipts and one dependent definition page")
    await f.backend.finishAllScheduledFunctions(() => t.mock.timers.tick(0))
    await f.reject(f.publishing.query({ serverId: "1", actor: owner, operation: { type: "post-show", postNo: knownGrant.postNo } }), PublishingStoreError, 404)
    assert.deepEqual(await f.post(unknownGrant.postNo), audit)
    const settings = await f.settings()
    assert.equal(settings.suggestions, 1); assert.equal(settings.voters, 1)
    assert.equal(settings.memberReceipts, 0); assert.equal(settings.staffReceipts, 0)
    const remaining = await f.backend.run(ctx => ctx.db.query("suggestions").collect())
    assert.equal(remaining[0]!.suggestionNo, unknown.suggestionNo)
})

test("terminal forgetting follows advertised bounded continuation and leaves unrelated canonical state intact", async t => {
    const f = await fixture(t); await f.open(); const row = await f.submit("Synthetic bounded erasure"), other = await f.submit("Synthetic preserved sibling")
    for (let index = 0; index < 21; index++) await f.vote(row.suggestionNo, index % 2 ? "clear" : "up", f.context({ ...actor, userId: String(200 + index) }))
    f.advance(5000); const grant = await f.sent(await f.show(row.suggestionNo))
    const withdrawn = await f.member({ type: "withdraw", suggestionNo: row.suggestionNo, expectedRevision: row.revision, confirm: true }); assert.equal(withdrawn.type, "suggestion")
    let revision = withdrawn.suggestion.revision, complete = false, pages = 0
    await withNative(f, ({ Effect, Redacted }, bot) => Effect.gen(function* () {
        const replies: string[] = []
        for (let page = 0; page < 6 && !complete; page++) {
            const source = f.source(), args = ["forget", String(row.suggestionNo), String(revision), "confirm"]
            bot.rest.respond(`GET /channels/30/messages/${source.messageId}`, { body: bot.fixtures.message({ id: source.messageId, guild_id: "1", channel_id: "30", author: bot.fixtures.user({ id: "10" }), timestamp: new Date(f.now()).toISOString() }) })
            const message = yield* bot.client.messages.fetch({ channelId: "30", id: source.messageId })
            const event = { client: bot.client, message, reply: (input: { content: string }) => Effect.sync(() => { replies.push(input.content) }) } as Parameters<typeof handleSuggestionCommand>[3]
            yield* handleSuggestionCommand(f.store, { token: Redacted.make("synthetic-suggestion-forget-token"), serverId: "1" }, parseSuggestionCommand(args), event)
            pages++
            const reply = replies.at(-1)!
            const count = /Removed (\d+) records/.exec(reply); assert(count); assert(Number(count[1]) <= 20)
            complete = reply.includes("Forgetting complete")
            if (!complete) {
                const continuation = /Continue: !suggest forget (\d+) (\d+) confirm/.exec(reply); assert(continuation)
                assert.equal(Number(continuation[1]), row.suggestionNo); revision = Number(continuation[2])
            }
        }
        assert(!bot.requests().some((request: { method: string }) => ["POST", "PATCH", "DELETE"].includes(request.method)))
    }))
    assert(complete); assert(pages >= 2)
    await f.reject(f.store.query(f.queryInput({ type: "show", suggestionNo: row.suggestionNo })), SuggestionsStoreError, 404)
    await f.reject(f.publishing.query({ serverId: "1", actor: owner, operation: { type: "post-show", postNo: grant.postNo } }), PublishingStoreError, 404)
    assert.deepEqual(await f.show(other.suggestionNo), other)
    const settings = await f.settings(); assert.equal(settings.suggestions, 1); assert.equal(settings.voters, 0)
    assert.deepEqual(await f.backend.run(ctx => ctx.db.query("suggestionVotes").collect()), [])
})

test("actual reserve response latency advances awaited time while exact delayed claim expiry forbids provider writes", async t => {
    const f = await fixture(t); await f.open(); const row = await f.submit(); f.advance(5000)
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect, Fiber } = runtime, gate = barrier(), native = nativeCard(bot)
        let grant: C.SuggestionsCardGrant | undefined
        const delayedStore = { ...f.store, work: (input: C.SuggestionsWorkRequest) => f.store.work(input).pipe(Effect.tap((result: C.SuggestionsWorkResult) => {
            if (result.type !== "reserved") return Effect.void
            grant = result.grant
            return advanceNative(f, runtime, 1)
        })) }
        const delayedPublisher = { ...f.publishing, dispatch: (input: C.PublishingDispatchRequest) => f.publishing.dispatch(input).pipe(Effect.tap((result: C.PublishingDispatchResult) => {
            assert(result.claimed)
            return Effect.promise(() => gate.wait())
        })) }
        const first = yield* Effect.forkChild(processSuggestionsPass(delayedStore, delayedPublisher, "1", bot.client).pipe(Effect.ensuring(Effect.sync(() => gate.finish()))))
        yield* Effect.promise(() => gate.reached); assert(grant)
        assert.equal(grant.dispatchExpiresAt, row.createdAt + 5000 + 180000)
        yield* advanceNative(f, runtime, grant.dispatchExpiresAt - f.now())
        yield* Effect.sync(() => gate.release()); yield* Fiber.join(first)
        assert.equal(native.send.requests().length, 0)
        yield* advanceNative(f, runtime, 10001)
        yield* processSuggestionsPass(f.store, f.publishing, "1", bot.client)
        assert.equal(native.send.requests().length, 0)
    }))
    const current = await f.show(row.suggestionNo); assert(current.postNo)
    const post = await f.post(current.postNo)
    assert.equal(post.attempt.noDispatch, undefined, "A claimed native operation cannot be labeled proof of no dispatch")
    assert.notEqual(post.outcome, "sent")
})

test("current human membership timeout verification and quarantine deny new vote mutations", async t => {
    const f = await fixture(t); await f.open(); const row = await f.submit(), before = await f.show(1)
    for (const invalid of [
        { ...f.context(actor), member: { ...f.context(actor).member!, isBot: true } },
        { ...f.context(actor), member: { ...f.context(actor).member!, timeoutUntil: new Date(f.now() + 60000).toISOString() } },
        { ...f.context(actor), member: { ...f.context(actor).member!, userId: "21" } },
    ]) await f.reject(f.store.member(f.memberInput({ type: "vote", suggestionNo: row.suggestionNo, choice: "up" }, invalid)), SuggestionsStoreError, 403)
    await f.reject(f.store.member(f.memberInput({ type: "vote", suggestionNo: row.suggestionNo, choice: "up" }, { ...f.context(actor), observedAt: f.now() - 60001 })), SuggestionsStoreError, 400)
    const moderation = createModerationStore(f.config)
    await f.run(moderation.manage({ ...f.source(), actor: owner, operation: { type: "action", action: { type: "quarantine", targetId: "20", durationSeconds: 60, reason: "Synthetic unclaimed quarantine fixture" }, context: { botActionAuthorized: true, actorCanManageTarget: true, botCanManageTarget: true, targetProtected: false, botId: "999", currentTimeoutUntil: null } } }))
    await f.reject(f.store.member(f.memberInput({ type: "vote", suggestionNo: row.suggestionNo, choice: "up" })), SuggestionsStoreError, 403)
    await f.backend.run(ctx => ctx.db.insert("rolePanels", { serverId: "1", name: "verify", kind: "verification", enabled: false, revision: 1, exclusive: false, mappings: [{ emoji: "ok", roleId: "40", prerequisiteRoleIds: [], exclusionRoleIds: [] }], withdrawing: false }))
    await f.reject(f.store.member(f.memberInput({ type: "vote", suggestionNo: row.suggestionNo, choice: "up" }, f.context({ ...actor, userId: "21" }))), SuggestionsStoreError, 403)
    assert.deepEqual(await f.backend.run(ctx => ctx.db.query("suggestionVotes").collect()), [])
    assert.deepEqual(await f.backend.run(async ctx => { const value = (await ctx.db.query("suggestions").collect())[0]!; return { up: value.up, down: value.down, desiredRevision: value.desiredRevision } }), { up: before.up, down: before.down, desiredRevision: before.desiredRevision })
})

test("DEFCON restrictions deny ordinary votes and dispatch but retain explicit staff disable", async t => {
    const f = await fixture(t); await f.open(); const row = await f.submit(), settings = await f.settings(); f.advance(5000)
    const grant = await f.reserve(row), moderation = createModerationStore(f.config)
    await f.run(moderation.manage({ ...f.source(), actor: owner, operation: { type: "settings", patch: { defcon: 2 } } }))
    await f.reject(f.store.member(f.memberInput({ type: "vote", suggestionNo: row.suggestionNo, choice: "up" })), SuggestionsStoreError, 403)
    await f.reject(f.publishing.dispatch({ ...publisherBinding(grant), suggestionContext: f.cardContext() }), PublishingStoreError, 403)
    const disabled = await f.manage({ type: "settings", expectedRevision: settings.revision, enabled: false })
    assert(!disabled.duplicate && disabled.type === "settings"); assert.equal(disabled.settings.enabled, false)
})

test("publisher DTO pagination remains compatible with suggestion-owned cards and fences independent composer writes", async t => {
    const f = await fixture(t); await f.open()
    for (let index = 0; index < 11; index++) { const row = await f.submit(`Synthetic private-scoped publisher card ${index}`); f.advance(5000); await f.sent(row, String(2000 + index)) }
    const first = await f.run<C.PublishingQueryResult>(f.publishing.query({ serverId: "1", actor: owner, operation: { type: "post-list" } }))
    assert.equal(first.type, "posts"); assert.equal(first.posts.length, 10); assert(first.nextBeforePostNo)
    assert(first.posts.every(post => post.consumer?.type === "suggestion-card"))
    assert(!JSON.stringify(first).includes("acceptedMessageId") && !JSON.stringify(first).includes(rawEpoch))
    const next = await f.run<C.PublishingQueryResult>(f.publishing.query({ serverId: "1", actor: owner, operation: { type: "post-list", beforePostNo: first.nextBeforePostNo } }))
    assert.equal(next.type, "posts"); assert.equal(next.posts.length, 1); assert.equal(next.nextBeforePostNo, undefined)
    assert.equal(new Set([...first.posts, ...next.posts].map(post => post.postNo)).size, 11)
    await f.run(f.publishing.manage({ ...f.source(), actor: owner, operation: { type: "draft-create", kind: "draft", name: "independent" } }))
    await f.run(f.publishing.manage({ ...f.source(), actor: owner, operation: { type: "draft-update", kind: "draft", name: "independent", expectedRevision: 1, edit: { type: "content", content: "Synthetic independent content" } } }))
    for (const operation of [
        { type: "forget", postNo: 1, expectedGeneration: 1 },
        { type: "edit", postNo: 1, expectedGeneration: 1, kind: "draft", name: "independent", expectedRevision: 2, context: { botId: "999", channelId: "30", botAuthorized: true, actorAuthorized: true } },
    ] satisfies C.PublishingManageOperation[]) await f.reject(f.publishing.manage({ ...f.source(), actor: owner, operation }), PublishingStoreError, 409)
})
