import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Deferred, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { performPublishingGrant, publishingDiagnostic, publishingDraftCard } from "../src/publishing.ts"
import { canonicalPublishingContent, publishingMessageContent } from "../src/publishing-content.ts"
import { PublishingStoreError } from "../src/publishing-store.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { boundary, platform, token } from "./moderation-fixture.ts"
import { scheduleGrant, schedulesBoundary } from "./schedule-fixture.ts"
import { eventsBoundary } from "./event-fixture.ts"

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
type Embed = { title?: string, description?: string, fields?: { name: string, value: string }[], footer?: { text: string } }
const emit = (bot: Bot, content: string, extra = {}) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content, ...extra })).pipe(Effect.andThen(bot.idle()))
function wire(bot: Bot, restOnlyIdentity = false) {
    const messages = new Map<string, ReturnType<typeof bot.fixtures.message>>()
    const restMessage = (value: ReturnType<typeof bot.fixtures.message>) => {
        if (!restOnlyIdentity) return value
        const result = { ...value, author: { ...value.author } }
        delete result.guild_id
        delete result.author.bot
        return result
    }
    const returnedEmbeds = (embeds: object[] | undefined) => embeds?.map((e) => {
        const value = e as { image?: object, thumbnail?: object }
        return { type: "rich", ...e, ...(value.image ? { image: { ...value.image, flags: 0 } } : {}), ...(value.thumbnail ? { thumbnail: { ...value.thumbnail, flags: 0 } } : {}) }
    }) ?? []
    const send = bot.rest.respond("POST /channels/:id/messages", (request) => {
        const body = request.body as { content?: string, embeds?: object[] }
        const result = restMessage(bot.fixtures.message({ channel_id: request.path.split("/")[2], author: bot.fixtures.botUser(), content: body.content ?? "", embeds: returnedEmbeds(body.embeds) }))
        messages.set(result.id, result); return { body: result }
    })
    const fetch = bot.rest.respond("GET /channels/:id/messages/:id", (request) => ({ body: messages.get(request.path.split("/").at(-1)!) }))
    const edit = bot.rest.respond("PATCH /channels/:id/messages/:id", (request) => {
        const body = request.body as { content?: string, embeds?: object[] }
        const result = restMessage(bot.fixtures.message({ id: request.path.split("/").at(-1), channel_id: request.path.split("/")[2], author: bot.fixtures.botUser(), content: body.content ?? "", embeds: returnedEmbeds(body.embeds) }))
        messages.set(result.id, result); return { body: result }
    })
    return { messages, send, fetch, edit }
}
function grant(bot: Bot, changes: Partial<C.PublishingGrant> = {}): C.PublishingGrant {
    return { attemptId: "synthetic_publishing_attempt", postNo: 1, generation: 1, sourceId: bot.fixtures.nextId(), actorId: bot.fixtures.ids.user, botId: bot.fixtures.ids.bot,
        action: "send", channelId: bot.fixtures.ids.channel, draftKind: "draft", draftName: "news", draftRevision: 1, content: { content: "News" }, canonicalContent: { content: "News" }, dispatchExpiresAt: Number.MAX_SAFE_INTEGER, nativeDeadlineMs: 5000, ...changes }
}
const nativeSafeMentions = { parse: [], users: [], roles: [], replied_user: false }

test("publishing compares native rich color through the actual SDK send and fetch transport", async t => {
    for (const scenario of [
        { name: "Omitted color matches native zero", authored: undefined, native: 0, sent: true },
        { name: "Explicit zero matches zero", authored: 0, native: 0, sent: true },
        { name: "Explicit nonzero matches unchanged", authored: 4023992, native: 4023992, sent: true },
        { name: "Explicit nonzero rejects zero", authored: 4023992, native: 0, sent: false },
        { name: "Explicit nonzero rejects another color", authored: 4023992, native: 4023993, sent: false },
        { name: "Omitted color rejects nonzero", authored: undefined, native: 4023992, sent: false },
    ]) await t.test(scenario.name, async () => {
        const remote = publishingBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-color-token" }); const p = platform(bot); p.replies.remove()
            const id = bot.fixtures.nextId()
            const content: C.PublishingContent = { content: "News", embed: { title: "News", ...(scenario.authored === undefined ? {} : { color: scenario.authored }) } }
            const returned = bot.fixtures.message({ id, author: bot.fixtures.botUser(), content: content.content, embeds: [{ type: "rich", title: "News", color: scenario.native }] })
            const send = bot.rest.respond("POST /channels/:id/messages", { body: returned })
            const fetch = bot.rest.respond("GET /channels/:id/messages/:id", { body: returned })
            const result = yield* performPublishingGrant(remote.store, bot.fixtures.ids.guild, bot.fixtures.ids.user, bot.client,
                grant(bot, { content, canonicalContent: canonicalPublishingContent(content) }))
            assert.equal(result.outcome, scenario.sent ? "sent" : "uncertain")
            assert.equal(result.messageId, id)
            assert.equal(send.requests().length, 1)
            const body = send.requests()[0]!.body as { embeds: { color?: number }[] }
            assert.equal(body.embeds[0]!.color, scenario.authored)
            assert.equal(Object.hasOwn(body.embeds[0]!, "color"), scenario.authored !== undefined)
            assert.equal(content.embed!.color, scenario.authored)
            const fetched = yield* bot.client.messages.fetch({ id, channelId: bot.fixtures.ids.channel })
            assert.equal(fetched.embeds[0]!.color, scenario.native)
            assert.equal(publishingMessageContent(fetched)!.embed!.color, scenario.native)
            assert.equal(fetch.requests().length, 1)
        })))
    })
})

test("edit baselines reject native content or color drift", async t => {
    for (const scenario of [
        { name: "Explicit nonzero baseline remains exact", expectedColor: 4023992, nativeColor: 4023992, title: "Previous", accepted: true },
        { name: "Explicit nonzero baseline rejects zero", expectedColor: 4023992, nativeColor: 0, title: "Previous", accepted: false },
        { name: "Baseline rejects real content drift", expectedColor: 4023992, nativeColor: 4023992, title: "Changed", accepted: false },
    ]) await t.test(scenario.name, async () => {
        const remote = publishingBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-color-token" }); const p = platform(bot); p.replies.remove(); const native = wire(bot)
            const id = bot.fixtures.nextId()
            native.messages.set(id, bot.fixtures.message({ id, author: bot.fixtures.botUser(), content: "Previous", embeds: [{ type: "rich", title: scenario.title, color: scenario.nativeColor }] }))
            const expectedContent: C.PublishingContent = { content: "Previous", embed: { title: "Previous", ...(scenario.expectedColor === undefined ? {} : { color: scenario.expectedColor }) } }
            const original = structuredClone(expectedContent)
            const result = yield* performPublishingGrant(remote.store, bot.fixtures.ids.guild, bot.fixtures.ids.user, bot.client, grant(bot, { action: "edit", messageId: id, expectedContent }))
            assert.equal(result.outcome, scenario.accepted ? "sent" : "failed")
            assert.equal(native.edit.requests().length, scenario.accepted ? 1 : 0)
            assert.deepEqual(expectedContent, original)
        })))
    })
})

test("canonical rich content prunes empty embeds before defaulting color and stays idempotent", () => {
    for (const embed of [{}, { title: " \u202e", description: "", fields: [] }]) {
        const input = { content: " Plain ", embed }
        assert.deepEqual(canonicalPublishingContent(input), { content: "Plain" })
        assert.deepEqual(canonicalPublishingContent(canonicalPublishingContent(input)), { content: "Plain" })
    }
    for (const color of [undefined, 0, 4023992]) {
        const input: C.PublishingContent = { content: "", embed: { title: " Title ", ...(color === undefined ? {} : { color }) } }
        const canonical = canonicalPublishingContent(input)
        assert.deepEqual(canonical, { content: "", embed: { title: "Title", color: color ?? 0 } })
        assert.deepEqual(canonicalPublishingContent(canonical), canonical)
        assert.equal(input.embed!.color, color)
    }
})

test("a draft card sums up its parts in two short fields and leaves the content to preview", () => {
    assert.deepEqual(publishingDraftCard({ kind: "template", name: "news", content: { content: "Hello", embed: { title: "Release", timestamp: "2026-10-04T00:00:00.000Z" } } }, "!"),
        { title: "Template news", fields: [["Message text", "Hello"], ["Embed", "title, timestamp"]], note: "See the whole post with `!publish template preview news`" })
    // The fullest draft still renders two fields: The text is cut, and every embed part is named once
    const fields = Array.from({ length: 25 }, (_, index) => ({ name: `Field ${index}`, value: "x".repeat(1024) }))
    const full = publishingDraftCard({ kind: "draft", name: "big", content: { content: "y".repeat(2000), embed: { title: "t", description: "d".repeat(4096), url: "https://example.com", color: 1,
        timestamp: "2026-10-04T00:00:00.000Z", author: { name: "a" }, footer: { text: "f" }, image: { url: "https://example.com/i.png" }, thumbnail: { url: "https://example.com/t.png" }, fields } } }, "!")
    assert.equal(full.fields!.length, 2); assert(full.fields![0]![1].length <= 80)
    assert.equal(full.fields![1]![1], "title, description, 25 fields, image, thumbnail, author, footer, link, colour, timestamp")
    assert.equal(publishingDraftCard({ kind: "draft", name: "empty", content: { content: "" } }, "!").fields![1]![1], "None")
})

test("native publishing quoted commands edit every rich field, clone templates, preview, send, edit and forget", async () => {
    const f = createFixtures(), remote = publishingBoundary(), safety = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: safety.store, publishing: remote.store }))
        const p = platform(bot); p.replies.remove(); const native = wire(bot, true)
        yield* bot.ready()
        for (const content of [
            "!publish template create news", '!publish template set news content "Hello @everyone"', '!publish template set news title "Release"',
            '!publish template set news description "Details"', '!publish template set news url "https://example.com"', '!publish template set news color "#3d66b8"',
            '!publish template set news timestamp "2026-10-04T00:00:00Z"', '!publish template set news author "Editor" "https://example.com" "https://example.com/icon.png"',
            '!publish template set news footer "Footer" "https://example.com/icon.png"', '!publish template set news image "https://example.com/image.png" "Image description"',
            '!publish template set news thumbnail "https://example.com/thumb.png" "Thumbnail description"', '!publish template field news add "Status" "Ready" on',
            '!publish template field news set 1 "Status" "Published" off', '!publish template clone news announcement draft', '!publish show announcement',
            '!publish list', '!publish template list', '!publish preview announcement', `!publish send announcement <#${f.ids.channel}>`,
            '!publish set announcement content "Updated"', '!publish edit 1 announcement', '!publish status 1', '!publish posts', '!publish reconcile 1',
            '!publish clear announcement fields', '!publish clear announcement embed', '!publish clear announcement content', '!publish delete announcement',
            '!publish template delete news', '!publish forget 1', '!publish module off', '!publish module on', '!publish help',
        ]) {
            yield* emit(bot, content)
            if (content.startsWith("!publish send")) {
                const post = remote.posts.get(1)!
                const outcome = remote.calls.findLast((c) => c.method === "outcome")?.input as C.PublishingOutcomeRequest
                const actual = outcome?.messageId ? publishingMessageContent(yield* bot.client.messages.fetch({ channelId: f.ids.channel, id: outcome.messageId })) : undefined
                assert.equal(post.outcome, "sent", JSON.stringify({ expected: post.attempt.canonicalContent, actual }))
            }
        }
        const reserve = remote.calls.filter((call) => call.method === "manage").map((call) => call.input as C.PublishingManageRequest)
        assert.equal(reserve.find((call) => call.operation.type === "send")?.actor.isOwner, true)
        assert.equal(reserve.find((call) => call.operation.type === "edit")?.operation.type, "edit")
        assert.equal(native.edit.requests().length, 1)
        assert.equal(remote.calls.filter((call) => call.method === "outcome").length, 2)
        assert.equal(remote.calls.filter((call) => call.method === "reconcile").length, 1)
        assert.equal(remote.drafts.size, 0); assert.equal(remote.posts.size, 0)
        assert.ok(native.send.requests().some((r) => (r.body as { embeds?: unknown[] }).embeds?.length === 1))
        for (const request of [...native.send.requests(), ...native.edit.requests()]) assert.deepEqual((request.body as { allowed_mentions: unknown }).allowed_mentions, nativeSafeMentions)
        assert.equal(bot.failures().length, 0)
    })))
})

test("publishing ignores bot, webhook, DM, system and other-server events and consumes malformed and reserved commands", async () => {
    const f = createFixtures(), remote = publishingBoundary(), safety = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: safety.store, publishing: remote.store }))
        const p = platform(bot); p.replies.remove(); const native = wire(bot)
        yield* bot.ready()
        for (const extra of [{ author: bot.fixtures.botUser() }, { webhook_id: bot.fixtures.nextId() }, { guild_id: undefined, channel_id: p.dmId }, { guild_id: bot.fixtures.nextId() }, { type: 7 }]) yield* emit(bot, "!publish create excluded", extra)
        assert.equal(remote.calls.filter((c) => c.method !== "observe").length, 0)
        yield* emit(bot, '!publish set news content "unclosed')
        yield* emit(bot, '!publish set news image "file:///private.png"')
        yield* emit(bot, '!custom create publish text "collision"')
        assert.equal(remote.calls.filter((c) => c.method === "manage").length, 0)
        assert.ok(native.send.requests().length >= 3)
        assert.equal(bot.failures().length, 0)
    })))
})

test("fresh admin and bot destination permissions fail closed before publishing writes", async () => {
    const f = createFixtures()
    for (const scenario of ["actor", "view", "send", "embed", "channel", "timeout"] as const) {
        const remote = publishingBoundary(), safety = boundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: safety.store, publishing: remote.store }))
            const p = platform(bot, { actorOwner: scenario !== "actor" }); p.replies.remove(); const native = wire(bot)
            yield* bot.ready(); yield* emit(bot, "!publish create news"); yield* emit(bot, '!publish set news title "News"')
            const before = remote.calls.filter((c) => c.method === "manage").length
            if (scenario === "actor" || ["view", "send", "embed"].includes(scenario)) {
                p.rolesRoute.remove()
                const permission = scenario === "actor" ? 0n : Permissions.ViewChannel | (scenario === "view" ? 0n : Permissions.SendMessages) | (scenario === "embed" ? 0n : Permissions.EmbedLinks)
                bot.rest.respond("GET /guilds/:id/roles", { body: p.roles.map((r) => r.id === (scenario === "actor" ? p.actorRole.id : p.botRole.id) ? { ...r, permissions: permission.toString() } : r) })
                if (scenario === "view") { p.channel.remove(); bot.rest.respond("GET /channels/:id", { body: bot.fixtures.channel({ permission_overwrites: [{ id: f.ids.bot, type: 1, allow: "0", deny: Permissions.ViewChannel.toString() }] }) }) }
                if (scenario === "send") { p.channel.remove(); bot.rest.respond("GET /channels/:id", { body: bot.fixtures.channel({ permission_overwrites: [{ id: f.ids.bot, type: 1, allow: "0", deny: Permissions.SendMessages.toString() }] }) }) }
            }
            if (scenario === "channel") { p.channel.remove(); bot.rest.respond("GET /channels/:id", { body: bot.fixtures.channel({ guild_id: bot.fixtures.nextId() }) }) }
            if (scenario === "timeout") { p.ownMember.remove(); bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.bot}`, { body: bot.fixtures.member({ user: bot.fixtures.botUser(), roles: [p.botRole.id], communication_disabled_until: "2099-01-01T00:00:00Z" }) }) }
            yield* emit(bot, `!publish send news <#${f.ids.channel}>`)
            assert.equal(remote.calls.filter((c) => c.method === "manage").length, before, scenario)
            assert.equal(native.edit.requests().length, 0)
        })))
    }
})

test("publishing honors DEFCON gates, keeps critical status and module disable, and clears AFK on return", async () => {
    const f = createFixtures(), remote = publishingBoundary(), safety = boundary(); let cleared = 0
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { afk: { set: (userId,reason) => Effect.succeed({ userId, reason, since: 1 }), observe: () => Effect.sync(() => { cleared++; return { cleared: false, statuses: [] } }) }, moderation: safety.store, publishing: remote.store }))
        const p = platform(bot); p.replies.remove(); wire(bot)
        yield* bot.ready(); safety.current.defcon = 2
        yield* emit(bot, "!publish create news"); assert.equal(remote.drafts.size, 1)
        safety.current.defcon = 1
        yield* emit(bot, '!publish set news content "blocked"'); assert.equal(remote.drafts.get("draft:news")!.revision, 1)
        yield* emit(bot, "!publish status"); yield* emit(bot, "!publish module off")
        assert.equal(remote.current.enabled, false); assert.equal(cleared, 4)
        assert.equal(bot.failures().length, 0)
    })))
})

test("native publishing edit checks exact bot identity and canonical prior content before one write", async () => {
    for (const scenario of ["success", "author", "server", "channel", "changed"] as const) {
        const remote = publishingBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-publishing-token" }); const p = platform(bot); p.replies.remove(); const native = wire(bot)
            const id = bot.fixtures.nextId()
            native.messages.set(id, bot.fixtures.message({ id, content: scenario === "changed" ? "Other staff content" : "Previous", author: scenario === "author" ? bot.fixtures.user() : bot.fixtures.botUser(), guild_id: scenario === "server" ? bot.fixtures.nextId() : bot.fixtures.ids.guild, channel_id: scenario === "channel" ? bot.fixtures.nextId() : bot.fixtures.ids.channel }))
            const result = yield* performPublishingGrant(remote.store, bot.fixtures.ids.guild, bot.fixtures.ids.user, bot.client, grant(bot, { action: "edit", messageId: id, expectedContent: { content: "Previous" } }))
            assert.equal(result.outcome, scenario === "success" ? "sent" : "failed")
            assert.equal(native.edit.requests().length, scenario === "success" ? 1 : 0)
        })))
    }
})

test("verified send identity survives uncertain canonical readback and supports exact read-only reconciliation", async () => {
    const f = createFixtures(), remote = publishingBoundary(), safety = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: safety.store, publishing: remote.store }))
        const p = platform(bot); p.replies.remove(); const native = wire(bot)
        yield* bot.ready(); yield* emit(bot, "!publish create news"); yield* emit(bot, '!publish set news content "News"')
        native.send.remove()
        const id = bot.fixtures.nextId()
        const altered = { ...bot.fixtures.message({ id, author: bot.fixtures.botUser(), content: "Provider normalized differently" }), author: { ...bot.fixtures.botUser() } }
        delete altered.guild_id
        delete altered.author.bot
        const send = bot.rest.respond("POST /channels/:id/messages", (request) => ({ body: (request.body as { content: string }).content === "News" ? altered : bot.fixtures.message({ author: bot.fixtures.botUser() }) }))
        yield* emit(bot, `!publish send news <#${f.ids.channel}>`)
        const post = remote.posts.get(1)!
        assert.equal(post.outcome, "uncertain"); assert.equal(post.messageId, id)
        native.messages.set(id, altered)
        yield* emit(bot, "!publish reconcile 1")
        assert.equal(native.fetch.requests().length, 1)
        assert.equal(remote.calls.filter((c) => c.method === "reconcile").length, 1)
        assert.equal(send.requests().filter((r) => (r.body as { content: string }).content === "News").length, 1)
        assert.equal(remote.posts.get(1)!.outcome, "uncertain")
        const resolves = () => remote.calls.filter((c) => c.method === "manage" && (c.input as C.PublishingManageRequest).operation.type === "resolve")
        const human = bot.fixtures.nextId(), elsewhere = bot.fixtures.nextId()
        native.messages.set(human, bot.fixtures.message({ id: human, author: bot.fixtures.user(), content: "News" }))
        native.messages.set(elsewhere, bot.fixtures.message({ id: elsewhere, author: bot.fixtures.botUser(), content: "News", channel_id: bot.fixtures.nextId() }))
        for (const target of [human, elsewhere, id, bot.fixtures.nextId()]) yield* emit(bot, `!publish resolve 1 sent ${target}`)
        assert.equal(resolves().length, 0); assert.equal(remote.posts.get(1)!.outcome, "uncertain")
        assert.equal(send.requests().filter((request) => (request.body as { content: string }).content?.endsWith("so nothing changed")).length, 4)
        native.messages.set(id, { ...altered, content: "News" })
        yield* emit(bot, `!publish resolve 1 sent ${id}`)
        assert.deepEqual((resolves()[0]?.input as C.PublishingManageRequest).operation, { type: "resolve", postNo: 1, expectedGeneration: post.generation, outcome: "sent", messageId: id, channelId: post.channelId, botId: post.botId, content: { content: "News" } })
        assert.equal(remote.posts.get(1)!.outcome, "sent")
        assert.ok(send.requests().some((request) => (request.body as { content: string }).content === `Post #1 is now recorded as posted in <#${post.channelId}>. Nothing was sent or edited`))
    })))
})

test("unknown native transport is never retried, and lost outcome acknowledgement preserves confirmed delivery", async () => {
    for (const scenario of ["unknown", "acknowledgement"] as const) {
        const remote = publishingBoundary(scenario === "acknowledgement" ? { outcome: () => Effect.fail(new PublishingStoreError({ operation: "outcome", status: null })) } : {})
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-publishing-token" }); const p = platform(bot); p.replies.remove(); const native = wire(bot)
            if (scenario === "unknown") { native.send.remove(); bot.rest.respond("POST /channels/:id/messages", () => { throw new Error("Synthetic unknown write") }) }
            const result = yield* performPublishingGrant(remote.store, bot.fixtures.ids.guild, bot.fixtures.ids.user, bot.client, grant(bot))
            assert.equal(result.outcome, scenario === "unknown" ? "uncertain" : "sent")
            if (scenario === "acknowledgement") {
                assert.equal(result.acknowledged, false)
                assert.deepEqual(result.diagnostics, [{ stage: "acknowledgement", failureClass: "PublishingStoreError" }])
            } else assert.deepEqual(result.diagnostics, [{ stage: "native", failureClass: "MessageError", kind: "network", nativeOutcome: "unknown" }])
            assert.equal(native.edit.requests().length, 0)
        })))
    }
})

test("serialized publishing revision updates finish before queued preview without timing assumptions", async () => {
    const f = createFixtures(), original = publishingBoundary(), safety = boundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
        const store = { ...original.store, manage: (request: C.PublishingManageRequest) => request.operation.type === "draft-update"
            ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.andThen(original.store.manage(request))) : original.store.manage(request) }
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: safety.store, publishing: store }))
        const p = platform(bot); p.replies.remove(); const native = wire(bot)
        yield* bot.ready(); yield* emit(bot, "!publish create news")
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: '!publish set news content "Revision two"' })); yield* Deferred.await(entered)
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!publish preview news" }))
        assert.equal(original.calls.some((c) => c.method === "manage" && (c.input as C.PublishingManageRequest).operation.type === "preview"), false)
        yield* Deferred.succeed(release, undefined); yield* bot.idle()
        const preview = original.calls.find((c) => c.method === "manage" && (c.input as C.PublishingManageRequest).operation.type === "preview")!.input as C.PublishingManageRequest
        assert.equal("expectedRevision" in preview.operation && preview.operation.expectedRevision, 2)
        assert.ok(native.send.requests().some((r) => (r.body as { content: string }).content === "Revision two"))
    })))
})

test("native publishing interruption leaves a reserved write unresolved without acknowledgement or replay", async () => {
    const remote = publishingBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-publishing-token" }); const p = platform(bot); p.replies.remove()
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
        const send = bot.rest.respond("POST /channels/:id/messages", async () => { await Effect.runPromise(Deferred.succeed(entered, undefined)); await Effect.runPromise(Deferred.await(release)); return { body: bot.fixtures.message({ author: bot.fixtures.botUser(), content: "News" }) } })
        const operation = yield* performPublishingGrant(remote.store, bot.fixtures.ids.guild, bot.fixtures.ids.user, bot.client, grant(bot)).pipe(Effect.forkScoped)
        yield* Deferred.await(entered)
        const stopped = yield* Fiber.interrupt(operation).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.succeed(release, undefined); yield* Fiber.join(stopped)
        assert.equal(remote.calls.some((c) => c.method === "outcome"), false)
        assert.equal(send.requests().length, 1)
    })))
})

test("a delayed publishing worker cannot dispatch after aging, reconciliation and a new generation", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
        const remote = publishingBoundary()
        const store = { ...remote.store, query: (input: C.PublishingQueryRequest) => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.andThen(remote.store.query(input))) }
        const bot = yield* createTestBot({ token: "synthetic-publishing-token" }); const p = platform(bot); p.replies.remove(); const native = wire(bot)
        const id = bot.fixtures.nextId()
        native.messages.set(id, bot.fixtures.message({ id, content: "Previous", author: bot.fixtures.botUser() }))
        const old = grant(bot, { action: "edit", messageId: id, expectedContent: { content: "Previous" }, dispatchExpiresAt: 180000 })
        const operation = yield* performPublishingGrant(store, bot.fixtures.ids.guild, bot.fixtures.ids.user, bot.client, old).pipe(Effect.forkScoped)
        yield* Deferred.await(entered)
        yield* TestClock.adjust("190001 millis")
        const replacement: C.PublishingPost = { postNo: 1, generation: 2, channelId: old.channelId, botId: old.botId, messageId: id, outcome: "pending", createdAt: 0, updatedAt: 190001,
            confirmedContent: { content: "Previous" }, confirmedCanonicalContent: { content: "Previous" }, confirmedDraftRevision: 1,
            attempt: { ...old, attemptId: "synthetic_new_generation", generation: 2, sourceId: bot.fixtures.nextId(), dispatchExpiresAt: 370001, createdAt: 190001, outcome: "pending" } }
        remote.posts.set(1, replacement)
        yield* Deferred.succeed(release, undefined)
        const result = yield* Fiber.join(operation)
        assert.equal(result.acknowledged, false)
        assert.equal(native.edit.requests().length, 0)
        assert.equal(remote.calls.some((call) => call.method === "outcome"), false)
        assert.equal(remote.posts.get(1)!.attempt.attemptId, "synthetic_new_generation")
    })).pipe(Effect.provide(TestClock.layer())))
})

test("publishing checks expiry after its exact claim response and cannot dispatch a claim delayed past the window", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
        const remote = publishingBoundary({ dispatch: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as({ claimed: true, dispatchExpiresAt: 180000, nativeDeadlineMs: 5000 })) })
        const bot = yield* createTestBot({ token: "synthetic-publishing-token" }); const p = platform(bot); p.replies.remove(); const native = wire(bot)
        const operation = yield* performPublishingGrant(remote.store, bot.fixtures.ids.guild, bot.fixtures.ids.user, bot.client, grant(bot, { dispatchExpiresAt: 180000 })).pipe(Effect.forkScoped)
        yield* Deferred.await(entered); yield* TestClock.adjust("180000 millis"); yield* Deferred.succeed(release, undefined)
        const result = yield* Fiber.join(operation)
        assert.equal(result.outcome, "failed")
        assert.equal(native.send.requests().length, 0)
        const outcome = remote.calls.find((c) => c.method === "outcome")!.input as C.PublishingOutcomeRequest
        assert.match(outcome.claimToken!, /^[a-f0-9]{32}$/)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("a denied or lost publishing claim never dispatches or acknowledges another performer's write", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
        let claimed = false
        const remote = publishingBoundary({ dispatch: () => Effect.sync(() => { const accepted = !claimed; claimed = true; return { claimed: accepted, dispatchExpiresAt: Number.MAX_SAFE_INTEGER, nativeDeadlineMs: 5000 } }) })
        const bot = yield* createTestBot({ token: "synthetic-publishing-token", rest: { concurrency: 4 } }); const p = platform(bot); p.replies.remove()
        const send = bot.rest.respond("POST /channels/:id/messages", async () => { await Effect.runPromise(Deferred.succeed(entered, undefined)); await Effect.runPromise(Deferred.await(release)); return { body: bot.fixtures.message({ author: bot.fixtures.botUser(), content: "News" }) } })
        const reserved = grant(bot)
        const first = yield* performPublishingGrant(remote.store, bot.fixtures.ids.guild, bot.fixtures.ids.user, bot.client, reserved).pipe(Effect.forkScoped)
        yield* Deferred.await(entered)
        const duplicate = yield* performPublishingGrant(remote.store, bot.fixtures.ids.guild, bot.fixtures.ids.user, bot.client, reserved)
        assert.equal(duplicate.acknowledged, false)
        assert.equal(send.requests().length, 1)
        assert.equal(remote.calls.some((call) => call.method === "outcome"), false)
        yield* Deferred.succeed(release, undefined)
        const result = yield* Fiber.join(first)
        assert.equal(result.outcome, "sent")
        const outcomes = remote.calls.filter((call) => call.method === "outcome")
        assert.equal(outcomes.length, 1)
        assert.match((outcomes[0]!.input as C.PublishingOutcomeRequest).claimToken!, /^[a-f0-9]{32}$/)
        const lost = { ...remote.store, dispatch: () => Effect.fail(new PublishingStoreError({ operation: "dispatch", status: null })) }
        const uncertain = yield* performPublishingGrant(lost, bot.fixtures.ids.guild, bot.fixtures.ids.user, bot.client, reserved)
        assert.equal(uncertain.acknowledged, false)
        assert.equal(send.requests().length, 1)
        assert.equal(remote.calls.filter((call) => call.method === "outcome").length, 1)
    })))
})

test("publishing applies its five-second native write budget rather than a longer client default", { timeout: 200000 }, async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const remote = publishingBoundary()
        const bot = yield* createTestBot({ token: "synthetic-publishing-token", rest: { defaultTimeoutMs: 30000 } })
        const p = platform(bot); p.replies.remove()
        const send = bot.rest.respond("POST /channels/:id/messages", { status: 429, headers: { "retry-after": "6" }, body: { message: "Synthetic rate limit", retry_after: 6, global: false } })
        const result = yield* performPublishingGrant(remote.store, bot.fixtures.ids.guild, bot.fixtures.ids.user, bot.client, grant(bot))
        assert.equal(result.outcome, "uncertain")
        assert.deepEqual(result.diagnostics, [{ stage: "native", failureClass: "MessageError", kind: "rateLimit", status: 429, retryAfterMs: 6000, nativeOutcome: "rejected" }])
        assert.equal(send.requests().length, 1)
        assert.equal(yield* Clock.currentTimeMillis, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("publishing preserves fixed native failure diagnostics and never treats provider rejection or parse failure as absence", async () => {
    for (const variation of ["rejected", "forbidden", "server", "response", "local"] as const) {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const remote = publishingBoundary(), bot = yield* createTestBot({ token: "synthetic-publishing-token" })
            const p = platform(bot); p.replies.remove()
            const status = variation === "rejected" ? 400 : variation === "forbidden" ? 403 : 500
            const send = bot.rest.respond("POST /channels/:id/messages", ["rejected", "forbidden", "server"].includes(variation)
                ? { status, body: { message: "Synthetic private rejection body", private: "not-a-diagnostic" } }
                : variation === "response" ? { status: 200, body: { private: "Synthetic unusable response" } }
                : { body: bot.fixtures.message({ author: bot.fixtures.botUser() }) })
            const selected = grant(bot, variation === "local" ? { content: { content: "" } } : {})
            const result = yield* performPublishingGrant(remote.store, bot.fixtures.ids.guild, bot.fixtures.ids.user, bot.client, selected)
            assert.equal(result.outcome, variation === "local" ? "failed" : "uncertain")
            assert.equal(result.acknowledged, true)
            assert.equal(send.requests().length, variation === "local" ? 0 : 1)
            const diagnostic = result.diagnostics?.[0]
            assert.equal(diagnostic?.stage, "native")
            assert.equal(diagnostic?.failureClass, "MessageError")
            assert.equal(diagnostic?.kind, variation === "local" ? "input" : variation === "response" ? "response" : "rejected")
            assert.equal(diagnostic?.nativeOutcome, variation === "local" ? "notDispatched" : variation === "response" || variation === "server" ? "unknown" : "rejected")
            assert.equal(diagnostic?.status, variation === "local" ? undefined : variation === "response" ? 200 : status)
            assert.ok(!JSON.stringify(result).includes("Synthetic private"))
            assert.ok(!JSON.stringify(result).includes("not-a-diagnostic"))
        })))
    }
    assert.deepEqual(publishingDiagnostic("native", { _tag: "UnapprovedPrivateClass", reason: "private-kind", status: 999, retryAfterMs: -1, message: "Private body", cause: "Private token" }), { stage: "native", failureClass: "Unknown" })
    assert.deepEqual(publishingDiagnostic("native", Object.defineProperty({}, "_tag", { get: () => { throw new Error("Private getter") } })), { stage: "native", failureClass: "Unknown" })
})

test("client closure after a publishing claim stays uncertain without a native replay", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const remote = publishingBoundary(), bot = yield* createTestBot({ token: "synthetic-publishing-token" })
        const p = platform(bot); p.replies.remove()
        const send = bot.rest.respond("POST /channels/:id/messages", { body: bot.fixtures.message({ author: bot.fixtures.botUser() }) })
        const store = { ...remote.store, dispatch: (input: C.PublishingDispatchRequest) => remote.store.dispatch(input).pipe(Effect.tap(() => bot.client.shutdown())) }
        const result = yield* performPublishingGrant(store, bot.fixtures.ids.guild, bot.fixtures.ids.user, bot.client, grant(bot))
        assert.equal(result.outcome, "uncertain")
        assert.equal(result.acknowledged, true)
        assert.equal(send.requests().length, 0)
        assert.deepEqual(result.diagnostics, [{ stage: "native", failureClass: "ClientClosedError" }])
        assert.equal(remote.calls.filter((call) => call.method === "outcome").length, 1)
    })))
})

test("native REST publishing proves identity through its fresh guild channel when optional message metadata is omitted", async () => {
    for (const variation of ["guild-omitted", "bot-omitted", "both-omitted", "wrong-guild", "wrong-author", "wrong-channel", "webhook"] as const) {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const remote = publishingBoundary(), bot = yield* createTestBot({ token: "synthetic-publishing-token" })
            const p = platform(bot); p.replies.remove()
            const response = { ...bot.fixtures.message({ author: bot.fixtures.botUser(), content: "News" }), author: { ...bot.fixtures.botUser() }, webhook_id: undefined as string | undefined }
            if (variation === "guild-omitted" || variation === "both-omitted") delete response.guild_id
            if (variation === "bot-omitted" || variation === "both-omitted") delete response.author.bot
            if (variation === "wrong-guild") response.guild_id = bot.fixtures.nextId()
            if (variation === "wrong-author") response.author = bot.fixtures.user()
            if (variation === "wrong-channel") response.channel_id = bot.fixtures.nextId()
            if (variation === "webhook") response.webhook_id = bot.fixtures.nextId()
            const send = bot.rest.respond("POST /channels/:id/messages", { body: response })
            const result = yield* performPublishingGrant(remote.store, bot.fixtures.ids.guild, bot.fixtures.ids.user, bot.client, grant(bot))
            const valid = variation.endsWith("omitted")
            assert.equal(result.outcome, valid ? "sent" : "uncertain")
            assert.equal(result.acknowledged, true)
            assert.equal(send.requests().length, 1)
            assert.equal(result.messageId, valid ? response.id : undefined)
            if (valid) {
                assert.equal(result.identityPresence?.guildSupplied, variation === "bot-omitted")
                assert.equal(result.identityPresence?.reportedBot, variation === "guild-omitted")
                assert.equal(result.identityPresence?.channelMatches, true)
                assert.equal(result.identityPresence?.authorMatches, true)
                assert.equal(result.identityPresence?.webhookPresent, false)
            } else if (variation !== "wrong-channel") {
                assert.equal(result.diagnostics?.[0]?.stage, "readback")
                assert.equal(result.diagnostics?.[0]?.identityField, variation === "wrong-guild" ? "guild" : variation === "wrong-author" ? "author" : "webhook")
            }
        })))
    }
})

test("draft, template and post lists page with next, each from its own place", async () => {
    const f = createFixtures(), remote = publishingBoundary(), base = remote.store.query
    remote.store.query = (input) => {
        const op = input.operation
        if (op.type === "draft-list") { remote.calls.push({ method: "query", input }); return Effect.succeed({ type: "drafts", kind: op.kind, page: op.page ?? 1, totalPages: 2, drafts: [] }) }
        if (op.type === "post-list") { remote.calls.push({ method: "query", input }); return Effect.succeed(op.beforePostNo ? { type: "posts", posts: [] } : { type: "posts", posts: [], nextBeforePostNo: 5 }) }
        return base(input)
    }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: boundary().store, publishing: remote.store })), p = platform(bot)
        yield* bot.ready()
        const send = (content: string) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(p.replies.next()), Effect.map((reply) => reply.body as { content?: string, embeds?: Embed[] }), Effect.tap(() => bot.idle()))
        const say = (content: string) => send(content).pipe(Effect.map((body) => body.content))
        const card = (content: string) => send(content).pipe(Effect.map((body) => { const e = body.embeds![0]!; return [e.title, e.description, e.fields, e.footer?.text] }))
        const next = (command: string) => [{ name: "Next", value: "`" + command + " next`" }]
        assert.deepEqual(yield* card("!publish list"), ["Drafts", "No drafts yet", next("!publish list"), undefined])
        assert.deepEqual(yield* card("!publish template list"), ["Templates", "No templates yet", next("!publish template list"), undefined])
        assert.deepEqual(yield* card("!publish posts"), ["Posts", "No posts yet", next("!publish posts"), undefined])
        assert.deepEqual(yield* card("!publish list next"), ["Drafts", "No drafts yet", undefined, undefined])
        assert.deepEqual(yield* card("!publish posts next"), ["Posts", "No posts yet", undefined, undefined])
        assert.deepEqual(yield* card("!publish template list next"), ["Templates", "No templates yet", undefined, undefined])
        assert.equal(yield* say("!publish posts next"), "There is no next page to show. Send !publish posts to start the list again")
        assert.equal(yield* say("!publish list next"), "There is no next page to show. Send !publish list to start the list again")
        // Page numbers and post cursors are not forms of these commands
        for (const content of ["!publish list 2", "!publish posts 5"]) assert.equal(yield* say(content), "Check quoting and values. Use !publish help for examples")
        assert.deepEqual(remote.calls.filter((c) => c.method === "query").map((c) => (c.input as C.PublishingQueryRequest).operation), [{ type: "draft-list", kind: "draft" }, { type: "draft-list", kind: "template" }, { type: "post-list" },
            { type: "draft-list", kind: "draft", page: 2 }, { type: "post-list", beforePostNo: 5 }, { type: "draft-list", kind: "template", page: 2 }])
    })))
})

test("a scheduled or event post's recovery and edit replies name its schedule or event", async () => {
    const f = createFixtures(), remote = publishingBoundary(), schedules = schedulesBoundary(), events = eventsBoundary(), scheduled = scheduleGrant()
    remote.posts.set(scheduled.postNo, { postNo: scheduled.postNo, generation: scheduled.generation, channelId: scheduled.channelId, botId: scheduled.botId, outcome: "uncertain", createdAt: 0, updatedAt: 0, consumer: scheduled.consumer, attempt: { ...scheduled, outcome: "uncertain", createdAt: 0 } })
    remote.drafts.set("draft:notice", { kind: "draft", name: "notice", revision: 1, content: { content: "Notice" }, canonicalContent: { content: "Notice" }, createdAt: 0, updatedAt: 0 })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: boundary().store, publishing: remote.store, schedules: schedules.store, events: events.store })), p = platform(bot)
        yield* bot.ready()
        const send = (content: string) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(p.replies.next()), Effect.map((reply) => reply.body as { content?: string, embeds?: Embed[] }), Effect.tap(() => bot.idle()))
        const say = (content: string) => send(content).pipe(Effect.map((body) => body.content))
        assert.equal(yield* say("!publish reconcile 1"), "Post #1 belongs to schedule news. Use `!publish schedule reconcile news 1`")
        assert.equal(yield* say("!publish forget 1"), "Post #1 belongs to schedule news. Use `!publish schedule forget news` once its posts are settled")
        assert.equal(yield* say("!publish edit 1 notice"), "Post #1 belongs to schedule news. Change its later posts with `!publish schedule update news content …`")
        assert.deepEqual(schedules.calls.map((c) => (c.input as C.SchedulesQueryRequest).operation), Array.from({ length: 3 }, () => ({ type: "show", scheduleNo: 1 })))
        // An event's post points at the event commands, which take the event's name rather than its number
        remote.posts.set(2, { ...structuredClone(remote.posts.get(1)!), postNo: 2, consumer: { type: "event", eventNo: 3, revision: 1, purpose: "card" } })
        assert.equal(yield* say("!publish reconcile 2"), "Post #2 belongs to event study. Use `!event reconcile study 2`")
        assert.equal(yield* say("!publish forget 2"), "Post #2 belongs to event study. Use `!event forget study` once its posts are settled")
        assert.equal(yield* say("!publish edit 2 notice"), "Post #2 belongs to event study. Change the event with `!event`, and its card follows")
        // An unconfirmed post names the command that checks it, with its real number
        const shown = yield* send("!publish status 1")
        assert.deepEqual(shown.embeds![0]!.fields, [{ name: "From", value: "Schedule post from draft news" }, { name: "Status", value: "Not confirmed yet, run `!publish reconcile 1`" }])
        // In the list, unconfirmed posts share one hint instead of a command on each line
        const listed = (yield* send("!publish posts")).embeds![0]!.description!.split("\n")
        assert.deepEqual(listed.slice(0, 2).map(line => line.replace(/^\*\*#\d\*\* .*: /, "")), ["Not confirmed yet", "Not confirmed yet"])
        assert.deepEqual(listed.slice(2), ["Check a post that is not confirmed with `!publish reconcile <post>`, or record it with `!publish resolve <post> sent <message-id>|failed` when NeonFlux does not know its message"])
        assert.deepEqual(events.calls.filter((c) => c.method === "query").map((c) => (c.input as C.EventsQueryRequest).operation), Array.from({ length: 3 }, () => ({ type: "show", eventNo: 3 })))
        assert.equal(remote.calls.filter((c) => c.method !== "query" && c.method !== "observe").length, 0)
    })))
})
