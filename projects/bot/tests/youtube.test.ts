import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Exit, Redacted, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { canonicalPublishingContent } from "../src/publishing-content.ts"
import { parseYoutubeCommand, youtubeHelp } from "../src/youtube-command.ts"
import { YoutubeStoreError, type YoutubeStore } from "../src/youtube-store.ts"
import { processYoutubeDelivery, startYoutubeWorker } from "../src/youtube-worker.ts"
import { platform } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"

const now = Date.parse("2026-10-01T00:00:00Z"), UC = `UC${"a".repeat(22)}`
const controlled = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))
type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const storeWith = (work: YoutubeStore["work"]): YoutubeStore => ({ work, query: () => Effect.die("Unexpected query"), manage: () => Effect.die("Unexpected management") })
const delivery = (channelId: string, videoId = "synthVideo1"): C.YoutubeDelivery => ({ youtubeChannelId: UC, videoId, channelId })
const sent = (request: { path: string, body?: unknown }) => ({ path: request.path, content: (request.body as { content: string }).content })

test("Commands take a channel ID or a link that holds one, refuse handles with how to find the ID and take no revision", () => {
    assert.deepEqual(parseYoutubeCommand(["add", UC, "<#5001>"]), { type: "add", youtubeChannelId: UC, channelId: "5001" })
    assert.deepEqual(parseYoutubeCommand(["remove", `https://www.youtube.com/channel/${UC}/videos`]), { type: "remove", youtubeChannelId: UC })
    assert.deepEqual(parseYoutubeCommand(["test", `<youtube.com/channel/${UC}>`]), { type: "test", youtubeChannelId: UC })
    assert.deepEqual([parseYoutubeCommand([]), parseYoutubeCommand(["list"]), parseYoutubeCommand(["STATUS"])], [{ type: "help" }, { type: "list" }, { type: "status" }])
    // Handles and custom names need YouTube's API, which NeonFlux does not use
    for (const handle of ["@SyntheticCreator", "https://www.youtube.com/@SyntheticCreator", "youtube.com/c/SyntheticCreator", "https://m.youtube.com/user/SyntheticCreator"]) {
        const parsed = parseYoutubeCommand(["add", handle, "<#5001>"])
        assert.ok("error" in parsed && /without a YouTube API key.*Share channel and Copy channel ID/.test(parsed.error), handle)
    }
    assert.match((parseYoutubeCommand(["add", "UCshort", "<#5001>"]) as { error: string }).error, /^That is not a YouTube channel ID/)
    assert.match((parseYoutubeCommand(["add", UC, "videos"]) as { error: string }).error, /^Name the channel for the alerts/)
    // A trailing revision or any other extra word is a syntax error
    for (const args of [["add", UC, "<#5001>", "3"], ["remove", UC, "2"], ["list", "2"]]) assert.deepEqual(parseYoutubeCommand(args), { error: "Check the youtube command syntax. Use !youtube help" })
    assert.match(youtubeHelp, /without a YouTube API key, so livestreams, premieres and Shorts arrive as ordinary new videos/)
})

test("Managers follow and list channels in chat, while other members and handles are refused before the backend", async () => {
    const f = createFixtures(), calls: unknown[] = [], rows: C.YoutubeSubscription[] = []
    const store: YoutubeStore = {
        query: input => Effect.sync(() => { calls.push(input); return { configured: true, subscriptions: [...rows] } }),
        manage: input => Effect.sync(() => {
            calls.push(input.operation)
            const subscription: C.YoutubeSubscription = { youtubeChannelId: input.operation.youtubeChannelId, channelId: f.ids.channel, enabled: true, createdAt: now, status: { title: "Synthetic Channel" } }
            rows.push(subscription)
            return { type: "added" as const, subscription }
        }),
        work: () => Effect.die("Unexpected work"),
    }
    for (const manager of [false, true]) await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token: Redacted.make("synthetic-youtube-token"), serverId: f.ids.guild }, { youtube: store }))
        const p = platform(bot, { actorOwner: false, actorPermissions: manager ? Permissions.ManageGuild : Permissions.SendMessages })
        yield* bot.ready()
        const say = (content: string) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))
        if (!manager) {
            yield* say(`!youtube add ${UC} <#${f.ids.channel}>`)
            assert.deepEqual(p.replies.requests().map(request => sent(request).content), ["Only the server owner or members with Manage Server can manage YouTube alerts"])
            return
        }
        yield* say(`!youtube add @SyntheticCreator <#${f.ids.channel}>`)
        yield* say(`!youtube add ${UC} <#${f.ids.channel}>`)
        yield* say("!youtube list")
        const replies = p.replies.requests().map(request => sent(request).content)
        assert.match(replies[0]!, /needs the channel ID/)
        assert.match(replies[1]!, new RegExp(`^NeonFlux posts new uploads of Synthetic Channel \\(${UC}\\) in <#${f.ids.channel}>\\. Videos published before now are not posted`))
        assert.equal(replies[2], `YouTube channels 1/10\n\nSynthetic Channel (${UC}) in <#${f.ids.channel}>: On`)
    })))
    assert.deepEqual(calls, [{ type: "add", youtubeChannelId: UC, channelId: f.ids.channel }, { serverId: f.ids.guild }])
})

test("A missing channel or permission turns the subscription off once, and only the change tells the server's staff", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot({ token: "synthetic-youtube-token" }), f = bot.fixtures, systemId = f.nextId(), missing = f.nextId(), closed = f.nextId()
        const p = platform(bot, { botPermissions: Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks, guild: { system_channel_id: systemId } })
        bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, { body: [f.channel({ id: systemId, type: 0 })] })
        bot.rest.respond(`GET /channels/${missing}`, { status: 404, body: { code: "UNKNOWN_CHANNEL", message: "Unknown Channel" } })
        bot.rest.respond(`GET /channels/${closed}`, { body: f.channel({ id: closed, permission_overwrites: [{ id: f.ids.bot, type: 1, allow: "0", deny: String(Permissions.SendMessages) }] }) })
        const operations: C.YoutubeWorkOperation[] = []
        let recorded = true
        const store = storeWith(input => { operations.push(input.operation); return Effect.succeed({ type: "progress", recorded }) })
        const publishing = publishingBoundary()
        yield* processYoutubeDelivery(store, publishing.store, f.ids.guild, bot.client, delivery(missing))
        assert.deepEqual(p.replies.requests().map(sent), [{ path: `/channels/${systemId}/messages`,
            content: `YouTube alerts for channel ${UC} are off. NeonFlux cannot find <#${missing}>, or it is not a text, announcement or forum channel. Choose another channel, then turn them back on with !youtube add ${UC} #channel` }])
        // A report that changed nothing, because the subscription was already off or moved, posts no second note
        recorded = false
        yield* processYoutubeDelivery(store, publishing.store, f.ids.guild, bot.client, delivery(closed))
        assert.deepEqual(operations, [{ type: "blocked", youtubeChannelId: UC, channelId: missing, reason: "channel" }, { type: "blocked", youtubeChannelId: UC, channelId: closed, reason: "permission" }])
        assert.equal(p.replies.requests().length, 1)
        assert.equal(publishing.calls.length, 0)
    }))
})

test("A failed alert waits for its next try, and the rest of the page still goes on", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot({ token: "synthetic-youtube-token" }), f = bot.fixtures
        platform(bot)
        const operations: C.YoutubeWorkOperation[] = [], done = yield* Deferred.make<void>()
        const store = storeWith(input => {
            const op = input.operation
            operations.push(op)
            if (op.type === "list") return Effect.succeed({ type: "deliveries", deliveries: [delivery(f.ids.channel, "synthVideo1"), delivery(f.ids.channel, "synthVideo2")] })
            if (op.type === "reserve" && op.videoId === "synthVideo1") return Effect.fail(new YoutubeStoreError({ operation: "work", status: 503 }))
            if (op.type === "reserve") return Deferred.succeed(done, undefined).pipe(Effect.as({ type: "skipped" as const }))
            return Effect.succeed({ type: "progress", recorded: true })
        })
        const worker = yield* startYoutubeWorker(store, publishingBoundary().store, f.ids.guild, bot.client)
        yield* worker.notify()
        yield* Deferred.await(done)
        assert.deepEqual(operations.map(op => op.type), ["list", "reserve", "defer", "reserve"])
        assert.deepEqual(operations[2], { type: "defer", youtubeChannelId: UC, videoId: "synthVideo1" })
    }))
})

test("An alert for a forum becomes its own post through the publisher, claimed with the bot's fresh read, and a substituted grant sends nothing", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot({ token: "synthetic-youtube-token" }), f = bot.fixtures
        platform(bot)
        const forum = f.forumChannel(), postId = f.nextId()
        bot.rest.respond(`GET /channels/${forum.id}`, { body: forum })
        // Fluxer echoes the embed, with flags on its media
        const message = (body: unknown) => {
            const value = body as { content?: string, embeds?: Array<{ image?: object }> }
            return f.message({ channel_id: postId, author: f.botUser(), content: value.content ?? "",
                embeds: value.embeds?.map(embed => ({ type: "rich", ...embed, ...(embed.image ? { image: { ...embed.image, flags: 0 } } : {}) })) ?? [] })
        }
        const post = bot.rest.respond(`POST /channels/${forum.id}/threads`, request => ({ status: 201,
            body: { ...f.thread({ id: postId, parent_id: forum.id, owner_id: f.ids.bot }), message: message((request.body as { message: unknown }).message) } }))
        const consumer = { type: "youtube" as const, youtubeChannelId: UC, videoId: "synthVideo1" }
        // The embed the backend renders for an alert
        const content = { content: "", embed: { title: "Synthetic upload", url: "https://www.youtube.com/watch?v=synthVideo1", color: 0xff0000, author: { name: "Synthetic Channel", url: `https://www.youtube.com/channel/${UC}` },
            image: { url: "https://i.ytimg.com/vi/synthVideo1/hqdefault.jpg" }, footer: { text: "YouTube" } } }
        const grant: C.PublishingGrant = { attemptId: "synthetic_youtube_attempt", postNo: 1, generation: 1, sourceId: `youtube_${UC}_synthVideo1`, actorId: f.ids.bot, botId: f.ids.bot, channelId: forum.id,
            action: "send", source: consumer, provenance: consumer, consumer, content, canonicalContent: canonicalPublishingContent(content), dispatchExpiresAt: now + 180000, nativeDeadlineMs: 5000, forumPostName: "Synthetic upload" }
        const publishing = publishingBoundary()
        publishing.posts.set(1, { postNo: 1, generation: 1, botId: f.ids.bot, channelId: forum.id, outcome: "pending", createdAt: now, updatedAt: now, consumer, attempt: { ...grant, outcome: "pending", createdAt: now } })
        const operations: C.YoutubeWorkOperation[] = []
        let reserved = grant
        const store = storeWith(input => { operations.push(input.operation); return Effect.succeed({ type: "reserved", grant: reserved }) })
        yield* processYoutubeDelivery(store, publishing.store, f.ids.guild, bot.client, delivery(forum.id))
        const context = { originServerId: f.ids.guild, observedAt: now, channelId: forum.id, botId: f.ids.bot, botAuthorized: true }
        assert.deepEqual(operations, [{ type: "reserve", youtubeChannelId: UC, videoId: "synthVideo1", context }])
        const body = post.requests()[0]!.body as { name: string, message: { embeds: Array<{ url: string }>, allowed_mentions: unknown } }
        assert.deepEqual([body.name, body.message.embeds[0]!.url], ["Synthetic upload", "https://www.youtube.com/watch?v=synthVideo1"])
        const claim = publishing.calls.find(call => call.method === "dispatch")!.input as C.PublishingDispatchRequest
        assert.deepEqual([claim.youtubeContext, claim.suggestionContext, claim.eventContext], [context, undefined, undefined])
        const outcome = publishing.calls.find(call => call.method === "outcome")!.input as C.PublishingOutcomeRequest
        assert.deepEqual([outcome.outcome, outcome.threadId], ["sent", postId])
        // A grant for another video is refused before the publisher is asked
        reserved = { ...grant, consumer: { ...consumer, videoId: "synthVideo2" } }
        assert(Exit.isFailure(yield* Effect.exit(processYoutubeDelivery(store, publishing.store, f.ids.guild, bot.client, delivery(forum.id)))))
        assert.deepEqual([post.requests().length, publishing.calls.filter(call => call.method === "dispatch").length], [1, 1])
    }))
})
