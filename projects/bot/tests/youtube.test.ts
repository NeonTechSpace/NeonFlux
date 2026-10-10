import assert from "node:assert/strict"
import test from "node:test"
import type { YoutubeDelivery, YoutubeSubscription, YoutubeWorkOperation } from "@neonflux/contracts/youtube"
import type { PublishingDispatchRequest, PublishingOutcomeRequest } from "@neonflux/contracts/publishing"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Exit, Redacted, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { canonicalPublishingContent, type PublishingGrant } from "@neonflux/contracts/publishing-base"
import { renderEmbeds, renderText } from "../src/reply-style.ts"
import { channelIdHint, parseYoutubeCommand, youtubeHelp } from "../src/youtube-command.ts"
import { youtubeChannels, youtubeDetail, youtubeName } from "../src/youtube-management.ts"
import { YoutubeStoreError, type YoutubeStore } from "../src/youtube-store.ts"
import { processYoutubeDelivery, startYoutubeWorker } from "../src/youtube-worker.ts"
import { platform } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"

const now = Date.parse("2026-10-01T00:00:00Z"), UC = `UC${"a".repeat(22)}`
const controlled = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))
type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const storeWith = (work: YoutubeStore["work"]): YoutubeStore => ({ work, query: () => Effect.die("Unexpected query"), manage: () => Effect.die("Unexpected management") })
const delivery = (channelId: string, videoId = "synthVideo1"): YoutubeDelivery => ({ youtubeChannelId: UC, videoId, channelId })
const sent = (request: { path: string, body?: unknown }) => ({ path: request.path, content: (request.body as { content: string }).content })

test("Commands take a channel ID, a link that holds one or a followed channel's name, refuse handles with how to find the ID and take no revision", () => {
    assert.deepEqual(parseYoutubeCommand(["add", UC, "<#5001>"]), { type: "add", target: { youtubeChannelId: UC }, channelId: "5001" })
    assert.deepEqual(parseYoutubeCommand(["remove", `https://www.youtube.com/channel/${UC}/videos`]), { type: "remove", target: { youtubeChannelId: UC } })
    assert.deepEqual(parseYoutubeCommand(["test", `<youtube.com/channel/${UC}>`]), { type: "test", target: { youtubeChannelId: UC } })
    // The bare command shows the status, and a name may have spaces
    assert.deepEqual([parseYoutubeCommand([]), parseYoutubeCommand(["help"]), parseYoutubeCommand(["STATUS"])], [{ type: "status" }, { type: "help" }, { type: "status" }])
    assert.deepEqual(parseYoutubeCommand(["status", "Synthetic", "Channel"]), { type: "status", target: { name: "Synthetic Channel" } })
    assert.deepEqual(parseYoutubeCommand(["add", "Synthetic", "Channel", "<#5001>"]), { type: "add", target: { name: "Synthetic Channel" }, channelId: "5001" })
    // Handles and custom names need YouTube's API, which NeonFlux does not use
    for (const handle of ["@SyntheticCreator", "https://www.youtube.com/@SyntheticCreator", "youtube.com/c/SyntheticCreator", "https://m.youtube.com/user/SyntheticCreator"]) {
        const parsed = parseYoutubeCommand(["add", handle, "<#5001>"])
        assert.ok("error" in parsed && /without a YouTube API key.*Share channel and Copy channel ID/.test(parsed.error), handle)
    }
    assert.match((parseYoutubeCommand(["add", "https://www.youtube.com/watch?v=synthVideo1", "<#5001>"]) as { error: string }).error, /^That is not a YouTube channel link\. A channel ID starts with UC/)
    assert.match((parseYoutubeCommand(["add", UC, "videos"]) as { error: string }).error, /^Name the channel for the alerts/)
    // A trailing revision or any other extra word is a syntax error, and list is folded into status
    for (const args of [["add", UC, "<#5001>", "3"], ["remove", UC, "2"], ["status", "Synthetic", "<#5001>"], ["list"], ["list", "2"]]) assert.deepEqual(parseYoutubeCommand(args), { error: "Check the youtube command syntax. Use !youtube help" })
    assert.match(youtubeHelp, /Livestreams, premieres and Shorts arrive as ordinary new videos/)
    assert.ok(!youtubeHelp.includes("!youtube list"))
})

test("Managers follow channels and see their status in chat by name, while other members and handles are refused before the backend", async () => {
    const f = createFixtures(), calls: unknown[] = [], rows: YoutubeSubscription[] = []
    const store: YoutubeStore = {
        query: input => Effect.sync(() => { calls.push(input); return { configured: true, subscriptions: [...rows] } }),
        manage: input => Effect.sync(() => {
            calls.push(input.operation)
            const subscription: YoutubeSubscription = { youtubeChannelId: input.operation.youtubeChannelId, channelId: f.ids.channel, enabled: true, createdAt: now, status: { title: "Synthetic Channel", subscribedUntil: now + 86400000 } }
            if (input.operation.type === "add") rows.push(subscription)
            return { type: input.operation.type === "add" ? "added" as const : "removed" as const, subscription }
        }),
        work: () => Effect.die("Unexpected work"),
    }
    for (const manager of [false, true]) await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot(createBotOptions({ token: Redacted.make("synthetic-youtube-token"), serverId: f.ids.guild }, { youtube: store }))
        const p = platform(bot, { actorOwner: false, actorPermissions: manager ? Permissions.ManageGuild : Permissions.SendMessages })
        yield* bot.ready()
        const say = (content: string) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))
        if (!manager) {
            yield* say(`!youtube add ${UC} <#${f.ids.channel}>`)
            assert.deepEqual(p.replies.requests().map(request => sent(request).content), ["Only the server owner or members with Manage Server can manage YouTube alerts"])
            return
        }
        // The bare command shows the status, which for no channels says how to add one
        yield* say("!youtube")
        assert.deepEqual((p.replies.requests()[0]!.body as { embeds: unknown[] }).embeds, [{ color: 0x5560e6, title: "YouTube channels", description: "No YouTube channels yet. Add one with `!youtube add <channel-ID> #channel`" }])
        yield* say(`!youtube add @SyntheticCreator <#${f.ids.channel}>`)
        yield* say(`!youtube add ${UC} <#${f.ids.channel}>`)
        yield* say("!youtube status")
        yield* say("!youtube status synthetic   CHANNEL")
        // A name the server does not follow says how to follow a new channel, or where to look
        yield* say(`!youtube add Unknown Creator <#${f.ids.channel}>`)
        yield* say("!youtube test Unknown Creator")
        yield* say("!youtube remove Synthetic Channel")
        const replies = p.replies.requests().slice(1).map(request => (request.body as { content?: string }).content)
        assert.match(replies[0]!, /needs the channel ID/)
        // A channel whose name is known is named, and its ID shows only where a command needs it
        assert.match(replies[1]!, new RegExp(`^NeonFlux posts new uploads of Synthetic Channel in <#${f.ids.channel}>\\. Videos published before now are not posted`))
        const [status, detail] = p.replies.requests().slice(3, 5).map(request => (request.body as { embeds: { title: string, description?: string, fields?: { name: string, value: string }[], footer?: { text: string } }[] }).embeds[0]!)
        // One line per channel and one hint, with no footer while the server follows few channels
        assert.deepEqual([status!.title, status!.description, status!.fields, status!.footer], ["YouTube channels", `Synthetic Channel to <#${f.ids.channel}>: On\nSee a channel's latest activity with \`!youtube status <name>\``, undefined, undefined])
        // The detail names commands by the channel's name and shows no ID or lease while YouTube is connected
        assert.deepEqual(detail, { color: 0x5560e6, title: "Synthetic Channel", description: `Alerts in <#${f.ids.channel}>: On\nSend a test alert with \`!youtube test Synthetic Channel\` or stop alerts with \`!youtube remove Synthetic Channel\``,
            fields: [{ name: "Last notification", value: "None yet" }, { name: "Last post", value: "None yet" }] })
        assert.deepEqual(replies.slice(4), [`This server does not follow a YouTube channel called Unknown Creator. To follow a new channel, use its channel ID. ${channelIdHint}`,
            "This server does not follow a YouTube channel called Unknown Creator. Check !youtube status", "NeonFlux no longer posts uploads of Synthetic Channel"])
    }))
    const all = { serverId: f.ids.guild }
    assert.deepEqual(calls, [all, { type: "add", youtubeChannelId: UC, channelId: f.ids.channel }, all, all, all, all, all, { type: "remove", youtubeChannelId: UC }])
})

/** A followed channel whose alerts are off, with every detail present */
const offRow = (index: number): YoutubeSubscription => ({ youtubeChannelId: `UC${String(index).padStart(22, "a")}`, channelId: String(5001 + index), enabled: false, problem: index % 2 ? "permission" : "channel", createdAt: now,
    status: { title: `Synthetic Channel With A Long Name ${index}`, hubError: "YouTube's notification service had an error", lastNotificationAt: now - 3600000, lastPostAt: now - 7200000,
        latestVideo: { videoId: "synthVideo1", title: "A synthetic upload with a long title", publishedAt: now - 3600000 } } })
const commands = (text: string) => text.match(/`!youtube [^`]+`/g) ?? []

test("The status of 10 channels that are all off fits one short reply with one hint and no IDs", () => {
    const card = youtubeChannels({ configured: true, subscriptions: Array.from({ length: 10 }, (_, index) => offRow(index)) }, "!")
    const lines = card.description!.split("\n")
    assert.equal(lines.length, 10)
    assert.deepEqual(lines.slice(0, 2), ["Synthetic Channel With A Long Name 0 to <#5001>: Off (channel gone)", "Synthetic Channel With A Long Name 1 to <#5002>: Off (missing permission)"])
    assert.deepEqual([card.fields, card.footer, commands(card.note!)], [undefined, "10 of the 10 channels a server can follow", ["`!youtube add <name> #channel`"]])
    // Title, 10 channels, the hint and the footer, in one message
    const [text, ...more] = renderText(card)
    assert.deepEqual([more.length, renderEmbeds(card).length], [0, 1])
    assert.ok((text as { content: string }).content.split("\n").length <= 13)
    assert.ok(!/UC[\w-]{22}/.test(JSON.stringify(card)) && !/subscri|hub/i.test(JSON.stringify(card)))
    // A channel whose name YouTube has not sent yet shows its ID, because that is what staff type
    assert.equal(youtubeChannels({ configured: true, subscriptions: [{ ...offRow(0), status: {} }] }, "!").description, `\`UC${"0".padStart(22, "a")}\` to <#5001>: Off (channel gone)`)
})

test("One channel's detail shows its fix, its latest activity and YouTube trouble in plain words", () => {
    const card = youtubeDetail(offRow(1), now, "!"), text = [card.description, ...card.fields!.flat(), card.note].join("\n")
    assert.deepEqual(card.description, "Alerts in <#5002>: Off. NeonFlux lacks View Channel, Send Messages or Embed Links in <#5002>. Grant them")
    const ago = (ms: number) => `<t:${(now - ms) / 1000}:R>`
    assert.deepEqual(card.fields, [["Last notification", ago(3600000)], ["Last post", ago(7200000)], ["Newest video", `A synthetic upload with a long title, published ${ago(3600000)}`],
        ["YouTube connection", "YouTube's notification service had an error. NeonFlux tries again on its own"]])
    assert.deepEqual(commands(card.note!), ["`!youtube add Synthetic Channel With A Long Name 1 #channel`"])
    assert.ok(!/UC[\w-]{22}/.test(text) && !/subscri|hub/i.test(text))
    // Before YouTube confirms, the detail says it is waiting
    assert.deepEqual(youtubeDetail({ ...offRow(1), enabled: true, status: { title: "Synthetic Channel" } }, now, "!").fields!.at(-1), ["YouTube connection", "Waiting for YouTube to confirm"])
    // In a sentence, a channel whose name YouTube has not sent yet is this channel with its ID once
    assert.equal(youtubeName({ youtubeChannelId: UC, status: {} }), `this channel (\`${UC}\`)`)
})

test("A test alert is the backend's labelled sample for the channel a name or an ID picks, posted directly", async () => {
    const f = createFixtures(), samples: unknown[] = []
    const row: YoutubeSubscription = { youtubeChannelId: UC, channelId: f.ids.channel, enabled: true, createdAt: now, status: { title: "Synthetic Channel" } }
    const store: YoutubeStore = { work: () => Effect.die("Unexpected work"), manage: () => Effect.die("Unexpected management"), query: input => Effect.sync(() => {
        samples.push(input.sample)
        return { configured: true, subscriptions: [row], ...(input.sample ? { sample: { channelId: f.ids.channel, content: { content: "Test alert from NeonFlux", embed: { title: "Synthetic upload" } }, forumPostName: "Synthetic upload" } } : {}) }
    }) }
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot(createBotOptions({ token: Redacted.make("synthetic-youtube-token"), serverId: f.ids.guild }, { youtube: store }))
        const p = platform(bot)
        yield* bot.ready()
        const say = (content: string) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))
        yield* say("!youtube test synthetic channel")
        yield* say(`!youtube test ${UC}`)
        // A name first reads the followed channels to find its ID
        assert.deepEqual(samples, [undefined, UC, UC])
        assert.deepEqual(p.replies.requests().map(request => (request.body as { content: string }).content), ["Test alert from NeonFlux", `Test alert posted in <#${f.ids.channel}>`,
            "Test alert from NeonFlux", `Test alert posted in <#${f.ids.channel}>`])
    }))
})

test("A missing channel or permission turns the subscription off once, and only the change tells the server's staff", async () => {
    await controlled(Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot({ token: "synthetic-youtube-token" }), f = bot.fixtures, systemId = f.nextId(), missing = f.nextId(), closed = f.nextId()
        const p = platform(bot, { botPermissions: Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks, guild: { system_channel_id: systemId } })
        bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, { body: [f.channel({ id: systemId, type: 0 })] })
        bot.rest.respond(`GET /channels/${missing}`, { status: 404, body: { code: "UNKNOWN_CHANNEL", message: "Unknown Channel" } })
        bot.rest.respond(`GET /channels/${closed}`, { body: f.channel({ id: closed, permission_overwrites: [{ id: f.ids.bot, type: 1, allow: "0", deny: String(Permissions.SendMessages) }] }) })
        const operations: YoutubeWorkOperation[] = []
        let recorded = true
        const store = storeWith(input => { operations.push(input.operation); return Effect.succeed({ type: "progress", recorded, ...(recorded ? { title: "Synthetic Channel" } : {}) }) })
        const publishing = publishingBoundary()
        yield* processYoutubeDelivery(store, publishing.store, f.ids.guild, bot.client, delivery(missing))
        // The note names the channel by the name YouTube gave, and keeps the ID only in the command that needs it
        assert.deepEqual(p.replies.requests().map(sent), [{ path: `/channels/${systemId}/messages`,
            content: `YouTube alerts for Synthetic Channel are off. NeonFlux cannot find <#${missing}>, or it is not a text, announcement or forum channel. Choose another channel, then turn them back on with \`!youtube add Synthetic Channel #channel\`` }])
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
        const operations: YoutubeWorkOperation[] = [], done = yield* Deferred.make<void>()
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
        const grant: PublishingGrant = { attemptId: "synthetic_youtube_attempt", postNo: 1, generation: 1, sourceId: `youtube_${UC}_synthVideo1`, actorId: f.ids.bot, botId: f.ids.bot, channelId: forum.id,
            action: "send", source: consumer, provenance: consumer, consumer, content, canonicalContent: canonicalPublishingContent(content), dispatchExpiresAt: now + 180000, nativeDeadlineMs: 5000, forumPostName: "Synthetic upload" }
        const publishing = publishingBoundary()
        publishing.posts.set(1, { postNo: 1, generation: 1, botId: f.ids.bot, channelId: forum.id, outcome: "pending", createdAt: now, updatedAt: now, consumer, attempt: { ...grant, outcome: "pending", createdAt: now } })
        const operations: YoutubeWorkOperation[] = []
        let reserved = grant
        const store = storeWith(input => { operations.push(input.operation); return Effect.succeed({ type: "reserved", grant: reserved }) })
        yield* processYoutubeDelivery(store, publishing.store, f.ids.guild, bot.client, delivery(forum.id))
        const context = { originServerId: f.ids.guild, observedAt: now, channelId: forum.id, botId: f.ids.bot, botAuthorized: true }
        assert.deepEqual(operations, [{ type: "reserve", youtubeChannelId: UC, videoId: "synthVideo1", context }])
        const body = post.requests()[0]!.body as { name: string, message: { embeds: Array<{ url: string }>, allowed_mentions: unknown } }
        assert.deepEqual([body.name, body.message.embeds[0]!.url], ["Synthetic upload", "https://www.youtube.com/watch?v=synthVideo1"])
        const claim = publishing.calls.find(call => call.method === "dispatch")!.input as PublishingDispatchRequest
        assert.deepEqual([claim.youtubeContext, claim.suggestionContext, claim.eventContext], [context, undefined, undefined])
        const outcome = publishing.calls.find(call => call.method === "outcome")!.input as PublishingOutcomeRequest
        assert.deepEqual([outcome.outcome, outcome.threadId], ["sent", postId])
        // A grant for another video is refused before the publisher is asked
        reserved = { ...grant, consumer: { ...consumer, videoId: "synthVideo2" } }
        assert(Exit.isFailure(yield* Effect.exit(processYoutubeDelivery(store, publishing.store, f.ids.guild, bot.client, delivery(forum.id)))))
        assert.deepEqual([post.requests().length, publishing.calls.filter(call => call.method === "dispatch").length], [1, 1])
    }))
})
