import assert from "node:assert/strict"
import test from "node:test"
import type { TwitchDelivery, TwitchSubscription, TwitchWorkOperation } from "@neonflux/contracts/twitch"
import type { PublishingDispatchRequest, PublishingOutcomeRequest } from "@neonflux/contracts/publishing"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Exit, Redacted, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { canonicalPublishingContent, type PublishingGrant } from "@neonflux/contracts/publishing-base"
import { renderEmbeds, renderText } from "../src/reply-style.ts"
import { parseTwitchCommand, twitchHelp } from "../src/twitch-command.ts"
import { twitchChannels, twitchDetail, twitchName } from "../src/twitch-management.ts"
import { TwitchStoreError, type TwitchStore } from "../src/twitch-store.ts"
import { processTwitchDelivery, startTwitchWorker } from "../src/twitch-worker.ts"
import { platform } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"

const now = Date.parse("2026-10-01T00:00:00Z"),
    LOGIN = "synthetic"
const controlled = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) =>
    Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))
const storeWith = (work: TwitchStore["work"]): TwitchStore => ({
    work,
    query: () => Effect.die("Unexpected query"),
    manage: () => Effect.die("Unexpected management"),
})
const delivery = (channelId: string, streamId = "10001"): TwitchDelivery => ({
    twitchChannelId: LOGIN,
    streamId,
    channelId,
})
const sent = (request: { path: string; body?: unknown }) => ({
    path: request.path,
    content: (request.body as { content: string }).content,
})

test("Commands accept a Twitch login or link and show help and status", () => {
    for (const input of [LOGIN, `https://www.twitch.tv/${LOGIN}`, `<twitch.tv/${LOGIN}>`])
        assert.deepEqual(parseTwitchCommand(["add", input, "<#5001>"]), {
            type: "add",
            target: { twitchChannelId: LOGIN },
            channelId: "5001",
        })
    assert.deepEqual(parseTwitchCommand([]), { type: "status" })
    assert.deepEqual(parseTwitchCommand(["help"]), { type: "help" })
    assert.ok("error" in parseTwitchCommand(["add", "https://example.test/person", "<#5001>"]))
    assert.deepEqual(parseTwitchCommand(["add", "12345", "<#5001>"]), {
        type: "add",
        target: { twitchChannelId: "pending:12345" },
        channelId: "5001",
    })
    assert.match(twitchHelp, /next live stream/)
})

test("Managers add, inspect, test and remove streamers while other members cannot manage alerts", async () => {
    const f = createFixtures(),
        calls: unknown[] = [],
        rows: TwitchSubscription[] = []
    const store: TwitchStore = {
        work: () => Effect.die("Unexpected work"),
        query: () => Effect.succeed({ configured: true, subscriptions: [...rows] }),
        manage: (input) =>
            Effect.sync(() => {
                calls.push(input.operation)
                const subscription: TwitchSubscription = {
                    twitchChannelId: LOGIN,
                    channelId: f.ids.channel,
                    enabled: true,
                    createdAt: now,
                    status: { title: "Synthetic", login: LOGIN, connected: true },
                }
                if (input.operation.type === "add") rows.push(subscription)
                return {
                    type: input.operation.type === "add" ? ("added" as const) : ("removed" as const),
                    subscription,
                }
            }),
    }
    for (const manager of [false, true])
        await controlled(
            Effect.gen(function* () {
                yield* TestClock.adjust(`${now} millis`)
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token: Redacted.make("synthetic-twitch-token"), serverId: f.ids.guild },
                        { twitch: store },
                    ),
                )
                const p = platform(bot, {
                    actorOwner: false,
                    actorPermissions: manager ? Permissions.ManageGuild : Permissions.SendMessages,
                })
                yield* bot.ready()
                const say = (content: string) =>
                    bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))
                yield* say(`!twitch add https://twitch.tv/${LOGIN} <#${f.ids.channel}>`)
                if (!manager) {
                    assert.equal(calls.length, 0)
                    assert.match(sent(p.replies.requests()[0]!).content, /Only the server owner/)
                    return
                }
                yield* say(`!twitch status ${LOGIN}`)
                yield* say(`!twitch remove ${LOGIN}`)
                assert.deepEqual(calls, [
                    { type: "add", twitchChannelId: LOGIN, channelId: f.ids.channel },
                    { type: "remove", twitchChannelId: LOGIN },
                ])
                assert.match(sent(p.replies.requests()[0]!).content, /posts live alerts/)
                assert.match(sent(p.replies.requests().at(-1)!).content, /no longer posts live streams/)
            }),
        )
})

/** A followed channel whose alerts are off, with every detail present */
const offRow = (index: number): TwitchSubscription => ({
    twitchChannelId: `synthetic${index}`,
    channelId: String(5001 + index),
    enabled: false,
    problem: index % 2 ? "permission" : "channel",
    createdAt: now,
    status: {
        title: `Synthetic Channel With A Long Name ${index}`,
        hubError: "Twitch's notification service had an error",
        retrying: true,
        lastNotificationAt: now - 3600000,
        lastPostAt: now - 7200000,
        latestStream: {
            streamId: "10001",
            title: "A synthetic stream with a long title",
            publishedAt: now - 3600000,
        },
    },
})
const commands = (text: string) => text.match(/`!twitch [^`]+`/g) ?? []

test("The status of 10 channels that are all off fits one short reply with one hint and no IDs", () => {
    const card = twitchChannels(
        { configured: true, subscriptions: Array.from({ length: 10 }, (_, index) => offRow(index)) },
        "!",
    )
    const lines = card.description!.split("\n")
    assert.equal(lines.length, 10)
    assert.deepEqual(lines.slice(0, 2), [
        "Synthetic Channel With A Long Name 0 to <#5001>: Off (channel gone)",
        "Synthetic Channel With A Long Name 1 to <#5002>: Off (missing permission)",
    ])
    assert.deepEqual(
        [card.fields, card.footer, commands(card.note!)],
        [undefined, "10 of the 10 channels a server can follow", ["`!twitch add <name> #channel`"]],
    )
    // Title, 10 channels, the hint and the footer, in one message
    const [text, ...more] = renderText(card)
    assert.deepEqual([more.length, renderEmbeds(card).length], [0, 1])
    assert.ok((text as { content: string }).content.split("\n").length <= 13)
    assert.ok(!/pending:|twitch_/.test(JSON.stringify(card)) && !/subscri|hub/i.test(JSON.stringify(card)))
    // A channel whose name Twitch has not sent yet shows its ID, because that is what staff type
    assert.equal(
        twitchChannels({ configured: true, subscriptions: [{ ...offRow(0), status: {} }] }, "!").description,
        `\`synthetic0\` to <#5001>: Off (channel gone)`,
    )
})

test("One channel's detail shows its fix, its latest activity and Twitch trouble in plain words", () => {
    const card = twitchDetail(offRow(1), now, "!"),
        text = [card.description, ...card.fields!.flat(), card.note].join("\n")
    assert.deepEqual(
        card.description,
        "Alerts in <#5002>: Off. NeonFlux lacks View channel, Send messages or Embed links in <#5002>. Grant them",
    )
    const ago = (ms: number) => `<t:${(now - ms) / 1000}:R>`
    assert.deepEqual(card.fields, [
        ["Last notification", ago(3600000)],
        ["Last post", ago(7200000)],
        ["Latest stream", `A synthetic stream with a long title, published ${ago(3600000)}`],
        ["Twitch connection", "Twitch's notification service had an error. NeonFlux tries again on its own"],
    ])
    assert.deepEqual(commands(card.note!), ["`!twitch add synthetic1 #channel`"])
    assert.ok(!/pending:|twitch_/.test(text) && !/subscri|hub/i.test(text))
    // Before Twitch confirms, the detail says it is waiting
    assert.deepEqual(
        twitchDetail({ ...offRow(1), enabled: true, status: { title: "Synthetic Channel" } }, now, "!").fields!.at(-1),
        ["Twitch connection", "Waiting for Twitch to confirm"],
    )
    // In a sentence, a channel whose name Twitch has not sent yet is this channel with its ID once
    assert.equal(twitchName({ twitchChannelId: LOGIN, status: {} }), `this channel (\`${LOGIN}\`)`)
})

test("A test alert is the backend's labelled sample for the channel a name or an ID picks, posted directly", async () => {
    const f = createFixtures(),
        samples: unknown[] = []
    const row: TwitchSubscription = {
        twitchChannelId: LOGIN,
        channelId: f.ids.channel,
        enabled: true,
        createdAt: now,
        status: { title: "Synthetic Channel" },
    }
    const store: TwitchStore = {
        work: () => Effect.die("Unexpected work"),
        manage: () => Effect.die("Unexpected management"),
        query: (input) =>
            Effect.sync(() => {
                samples.push(input.sample)
                return {
                    configured: true,
                    subscriptions: [row],
                    ...(input.sample
                        ? {
                              sample: {
                                  channelId: f.ids.channel,
                                  content: {
                                      content: "Test alert from NeonFlux",
                                      embed: { title: "Synthetic stream" },
                                  },
                                  forumPostName: "Synthetic stream",
                              },
                          }
                        : {}),
                }
            }),
    }
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot(
                createBotOptions(
                    { token: Redacted.make("synthetic-twitch-token"), serverId: f.ids.guild },
                    { twitch: store },
                ),
            )
            const p = platform(bot)
            yield* bot.ready()
            const say = (content: string) =>
                bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))
            yield* say("!twitch test synthetic channel")
            yield* say(`!twitch test ${LOGIN}`)
            // A name first reads the followed channels to find its ID
            assert.deepEqual(samples, [undefined, LOGIN, LOGIN])
            assert.deepEqual(
                p.replies.requests().map((request) => (request.body as { content: string }).content),
                [
                    "Test alert from NeonFlux",
                    `Test alert posted in <#${f.ids.channel}>`,
                    "Test alert from NeonFlux",
                    `Test alert posted in <#${f.ids.channel}>`,
                ],
            )
        }),
    )
})

test("A missing channel or permission turns the subscription off once, and only the change tells the server's staff", async () => {
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot({ token: "synthetic-twitch-token" }),
                f = bot.fixtures,
                systemId = f.nextId(),
                missing = f.nextId(),
                closed = f.nextId()
            const p = platform(bot, {
                botPermissions: Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks,
                guild: { system_channel_id: systemId },
            })
            bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, { body: [f.channel({ id: systemId, type: 0 })] })
            bot.rest.respond(`GET /channels/${missing}`, {
                status: 404,
                body: { code: "UNKNOWN_CHANNEL", message: "Unknown Channel" },
            })
            bot.rest.respond(`GET /channels/${closed}`, {
                body: f.channel({
                    id: closed,
                    permission_overwrites: [
                        { id: f.ids.bot, type: 1, allow: "0", deny: String(Permissions.SendMessages) },
                    ],
                }),
            })
            const operations: TwitchWorkOperation[] = []
            let recorded = true
            const store = storeWith((input) => {
                operations.push(input.operation)
                return Effect.succeed({
                    type: "progress",
                    recorded,
                    ...(recorded ? { title: "Synthetic Channel" } : {}),
                })
            })
            const publishing = publishingBoundary()
            yield* processTwitchDelivery(store, publishing.store, f.ids.guild, bot.client, delivery(missing))
            // The note names the channel by the name Twitch gave, and keeps the ID only in the command that needs it
            assert.deepEqual(p.replies.requests().map(sent), [
                {
                    path: `/channels/${systemId}/messages`,
                    content: `Twitch alerts for Synthetic Channel are off. NeonFlux cannot find <#${missing}>, or it is not a text, announcement or forum channel. Choose another channel, then turn them back on with \`!twitch add Synthetic Channel #channel\``,
                },
            ])
            // A report that changed nothing, because the subscription was already off or moved, posts no second note
            recorded = false
            yield* processTwitchDelivery(store, publishing.store, f.ids.guild, bot.client, delivery(closed))
            assert.deepEqual(operations, [
                { type: "blocked", twitchChannelId: LOGIN, channelId: missing, reason: "channel" },
                { type: "blocked", twitchChannelId: LOGIN, channelId: closed, reason: "permission" },
            ])
            assert.equal(p.replies.requests().length, 1)
            assert.equal(publishing.calls.length, 0)
        }),
    )
})

test("A failed alert waits for its next try, and the rest of the page still goes on", async () => {
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot({ token: "synthetic-twitch-token" }),
                f = bot.fixtures
            platform(bot)
            const operations: TwitchWorkOperation[] = [],
                done = yield* Deferred.make<void>()
            const store = storeWith((input) => {
                const op = input.operation
                operations.push(op)
                if (op.type === "list")
                    return Effect.succeed({
                        type: "deliveries",
                        deliveries: [delivery(f.ids.channel, "10001"), delivery(f.ids.channel, "10002")],
                    })
                if (op.type === "reserve" && op.streamId === "10001")
                    return Effect.fail(new TwitchStoreError({ operation: "work", status: 503 }))
                if (op.type === "reserve")
                    return Deferred.succeed(done, undefined).pipe(Effect.as({ type: "skipped" as const }))
                return Effect.succeed({ type: "progress", recorded: true })
            })
            const worker = yield* startTwitchWorker(store, publishingBoundary().store, f.ids.guild, bot.client)
            yield* worker.notify()
            yield* Deferred.await(done)
            assert.deepEqual(
                operations.map((op) => op.type),
                ["list", "reserve", "defer", "reserve"],
            )
            assert.deepEqual(operations[2], { type: "defer", twitchChannelId: LOGIN, streamId: "10001" })
        }),
    )
})

test("An alert for a forum becomes its own post through the publisher, claimed with the bot's fresh read, and a substituted grant sends nothing", async () => {
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot({ token: "synthetic-twitch-token" }),
                f = bot.fixtures
            platform(bot)
            const forum = f.forumChannel(),
                postId = f.nextId()
            bot.rest.respond(`GET /channels/${forum.id}`, { body: forum })
            // Fluxer echoes the embed, with flags on its media
            const message = (body: unknown) => {
                const value = body as { content?: string; embeds?: Array<{ image?: object }> }
                return f.message({
                    channel_id: postId,
                    author: f.botUser(),
                    content: value.content ?? "",
                    embeds:
                        value.embeds?.map((embed) => ({
                            type: "rich",
                            ...embed,
                            ...(embed.image ? { image: { ...embed.image, flags: 0 } } : {}),
                        })) ?? [],
                })
            }
            const post = bot.rest.respond(`POST /channels/${forum.id}/threads`, (request) => ({
                status: 201,
                body: {
                    ...f.thread({ id: postId, parent_id: forum.id, owner_id: f.ids.bot }),
                    message: message((request.body as { message: unknown }).message),
                },
            }))
            const consumer = { type: "twitch" as const, twitchChannelId: LOGIN, streamId: "10001" }
            // The embed the backend renders for an alert
            const content = {
                content: "",
                embed: {
                    title: "Synthetic stream",
                    url: "https://www.twitch.tv/synthetic",
                    color: 0x9146ff,
                    author: { name: "Synthetic Channel", url: `https://www.twitch.tv/${LOGIN}` },
                    image: { url: "https://images.example.test/stream-10001.jpg" },
                    footer: { text: "Twitch" },
                },
            }
            const grant: PublishingGrant = {
                attemptId: "synthetic_twitch_attempt",
                postNo: 1,
                generation: 1,
                sourceId: `twitch_${LOGIN}_10001`,
                actorId: f.ids.bot,
                botId: f.ids.bot,
                channelId: forum.id,
                action: "send",
                source: consumer,
                provenance: consumer,
                consumer,
                content,
                canonicalContent: canonicalPublishingContent(content),
                dispatchExpiresAt: now + 180000,
                nativeDeadlineMs: 5000,
                forumPostName: "Synthetic stream",
            }
            const publishing = publishingBoundary()
            publishing.posts.set(1, {
                postNo: 1,
                generation: 1,
                botId: f.ids.bot,
                channelId: forum.id,
                outcome: "pending",
                createdAt: now,
                updatedAt: now,
                consumer,
                attempt: { ...grant, outcome: "pending", createdAt: now },
            })
            const operations: TwitchWorkOperation[] = []
            let reserved = grant
            const store = storeWith((input) => {
                operations.push(input.operation)
                return Effect.succeed({ type: "reserved", grant: reserved })
            })
            yield* processTwitchDelivery(store, publishing.store, f.ids.guild, bot.client, delivery(forum.id))
            const context = {
                originServerId: f.ids.guild,
                observedAt: now,
                channelId: forum.id,
                botId: f.ids.bot,
                botAuthorized: true,
            }
            assert.deepEqual(operations, [{ type: "reserve", twitchChannelId: LOGIN, streamId: "10001", context }])
            const body = post.requests()[0]!.body as {
                name: string
                message: { embeds: Array<{ url: string }>; allowed_mentions: unknown }
            }
            assert.deepEqual(
                [body.name, body.message.embeds[0]!.url],
                ["Synthetic stream", "https://www.twitch.tv/synthetic"],
            )
            const claim = publishing.calls.find((call) => call.method === "dispatch")!
                .input as PublishingDispatchRequest
            assert.deepEqual(
                [claim.twitchContext, claim.suggestionContext, claim.eventContext],
                [context, undefined, undefined],
            )
            const outcome = publishing.calls.find((call) => call.method === "outcome")!
                .input as PublishingOutcomeRequest
            assert.deepEqual([outcome.outcome, outcome.threadId], ["sent", postId])
            // A grant for another video is refused before the publisher is asked
            reserved = { ...grant, consumer: { ...consumer, streamId: "10002" } }
            assert(
                Exit.isFailure(
                    yield* Effect.exit(
                        processTwitchDelivery(store, publishing.store, f.ids.guild, bot.client, delivery(forum.id)),
                    ),
                ),
            )
            assert.deepEqual(
                [post.requests().length, publishing.calls.filter((call) => call.method === "dispatch").length],
                [1, 1],
            )
        }),
    )
})
