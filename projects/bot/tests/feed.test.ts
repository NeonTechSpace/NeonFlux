import assert from "node:assert/strict"
import test from "node:test"
import type { FeedDelivery, FeedSubscription, FeedWorkOperation } from "@neonflux/contracts/feeds"
import type { PublishingDispatchRequest, PublishingOutcomeRequest } from "@neonflux/contracts/publishing"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Exit, Redacted, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { canonicalPublishingContent, feedSourceId, type PublishingGrant } from "@neonflux/contracts/publishing-base"
import { feedHelp, parseFeedCommand } from "../src/feed-command.ts"
import { feedAccounts, feedDetail, feedName } from "../src/feed-management.ts"
import { FeedStoreError, type FeedStore } from "../src/feed-store.ts"
import { processFeedDelivery, startFeedWorker } from "../src/feed-worker.ts"
import { renderEmbeds, renderText } from "../src/reply-style.ts"
import { platform } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"

const now = Date.parse("2026-10-01T00:00:00Z"),
    DID = "did:plc:syntheticaaaaaaaaaaaaaaa",
    HANDLE = "news.example.test",
    ITEM = "3mz46jsw4ic2h"
const controlled = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) =>
    Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))
const delivery = (channelId: string): FeedDelivery => ({
    provider: "bluesky",
    accountId: DID,
    itemId: ITEM,
    channelId,
})
const storeWith = (work: FeedStore["work"]): FeedStore => ({
    work,
    query: () => Effect.die("Unexpected query"),
    manage: () => Effect.die("Unexpected management"),
})
const sent = (request: { path: string; body?: unknown }) => ({
    path: request.path,
    content: (request.body as { content: string }).content,
})
const keyed = { xConfigured: true, xPaused: false }
const followed = (fields: Partial<FeedSubscription> = {}): FeedSubscription => ({
    provider: "bluesky",
    accountId: DID,
    channelId: "5001",
    enabled: true,
    createdAt: now,
    status: { handle: HANDLE, name: "Synthetic News", lastReadAt: now - 60000, lastItemAt: now - 3600000 },
    ...fields,
})

test("Commands name a service and a handle or link, and read names with spaces", () => {
    for (const input of [
        HANDLE,
        `@${HANDLE}`,
        `https://bsky.app/profile/${HANDLE}`,
        `<https://bsky.app/profile/${HANDLE}>`,
    ])
        assert.deepEqual(parseFeedCommand(["add", "bluesky", input, "<#5001>"]), {
            type: "add",
            provider: "bluesky",
            accountId: `pending:${HANDLE}`,
            channelId: "5001",
        })
    assert.deepEqual(parseFeedCommand(["add", "X", "https://x.com/Synthetic", "<#5001>"]), {
        type: "add",
        provider: "x",
        accountId: "pending:synthetic",
        channelId: "5001",
    })
    assert.deepEqual(parseFeedCommand(["add", "bluesky", DID, "<#5001>"]), {
        type: "add",
        provider: "bluesky",
        accountId: DID,
        channelId: "5001",
    })
    assert.deepEqual(parseFeedCommand([]), { type: "status" })
    assert.deepEqual(parseFeedCommand(["status"]), { type: "status" })
    assert.deepEqual(parseFeedCommand(["help"]), { type: "help" })
    assert.deepEqual(parseFeedCommand(["status", "Synthetic", "News"]), {
        type: "status",
        target: { name: "Synthetic News" },
    })
    assert.deepEqual(parseFeedCommand(["remove", "x", "alice"]), {
        type: "remove",
        target: { name: "alice", provider: "x" },
    })
    assert.deepEqual(parseFeedCommand(["test", "x"]), { type: "test", target: { name: "x" } })
    for (const args of [
        ["add", "mastodon", "a", "<#5001>"],
        ["add", "bluesky", "https://example.test/a", "<#5001>"],
        ["add", "bluesky", HANDLE, "news"],
        ["add", "bluesky", HANDLE],
        ["remove"],
        ["remove", "<#5001>"],
        ["fly"],
    ])
        assert.ok("error" in parseFeedCommand(args), args.join(" "))
    assert.match(feedHelp, /!feed add bluesky/)
    assert.match(feedHelp, /!feed add x/)
})

test("Managers add, inspect and remove accounts while other members cannot manage feeds", async () => {
    const f = createFixtures(),
        calls: unknown[] = [],
        rows: FeedSubscription[] = []
    const store: FeedStore = {
        work: () => Effect.die("Unexpected work"),
        query: () => Effect.succeed({ xConfigured: true, xPaused: false, subscriptions: [...rows] }),
        manage: (input) =>
            Effect.sync(() => {
                calls.push(input.operation)
                const subscription = followed({ channelId: f.ids.channel })
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
                        { token: Redacted.make("synthetic-feed-token"), serverId: f.ids.guild },
                        { feed: store },
                    ),
                )
                const p = platform(bot, {
                    actorOwner: false,
                    actorPermissions: manager ? Permissions.ManageGuild : Permissions.SendMessages,
                })
                yield* bot.ready()
                const say = (content: string) =>
                    bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))
                yield* say(`!feed add bluesky https://bsky.app/profile/${HANDLE} <#${f.ids.channel}>`)
                if (!manager) {
                    assert.equal(calls.length, 0)
                    assert.match(sent(p.replies.requests()[0]!).content, /Only the server owner/)
                    return
                }
                yield* say(`!feed status ${HANDLE}`)
                yield* say("!feed status")
                yield* say("!feed status nobody")
                yield* say(`!feed remove ${HANDLE}`)
                assert.deepEqual(calls, [
                    { type: "add", provider: "bluesky", accountId: `pending:${HANDLE}`, channelId: f.ids.channel },
                    { type: "remove", provider: "bluesky", accountId: DID },
                ])
                assert.match(sent(p.replies.requests()[0]!).content, /Nothing published before now is posted/)
                assert.match(sent(p.replies.requests().at(-2)!).content, /does not follow an account called nobody/)
                assert.match(
                    sent(p.replies.requests().at(-1)!).content,
                    /no longer posts Bluesky posts of Synthetic News/,
                )
            }),
        )
})

test("A Bluesky name without a dot names its bsky.social account in every command, as it does in add", async () => {
    const f = createFixtures(),
        calls: unknown[] = [],
        row = followed({ status: { handle: "alice.bsky.social" } })
    const store: FeedStore = {
        work: () => Effect.die("Unexpected work"),
        query: () => Effect.succeed({ xConfigured: true, xPaused: false, subscriptions: [row] }),
        manage: (input) =>
            Effect.sync(() => {
                calls.push(input.operation)
                return { type: "removed" as const, subscription: row }
            }),
    }
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot(
                createBotOptions(
                    { token: Redacted.make("synthetic-feed-token"), serverId: f.ids.guild },
                    { feed: store },
                ),
            )
            const p = platform(bot, { actorOwner: true })
            yield* bot.ready()
            const say = (content: string) =>
                bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))
            yield* say("!feed status alice")
            assert.doesNotMatch(JSON.stringify(p.replies.requests().at(-1)!.body), /does not follow/)
            yield* say("!feed remove @Alice")
            assert.deepEqual(calls, [{ type: "remove", provider: "bluesky", accountId: DID }])
            // An X account of that name is another account
            yield* say("!feed status x alice")
            assert.match(sent(p.replies.requests().at(-1)!).content, /does not follow/)
        }),
    )
})

test("An add that fails names what to do, without a raw status", async () => {
    const f = createFixtures()
    const failing = (status: number): FeedStore => ({
        work: () => Effect.die("Unexpected work"),
        query: () => Effect.die("Unexpected query"),
        manage: () => Effect.fail(new FeedStoreError({ operation: "manage", status })),
    })
    for (const [status, text] of [
        [503, /not set up an X key/],
        [429, /at most 10 accounts/],
        [507, /as many accounts as it can/],
    ] as const)
        await controlled(
            Effect.gen(function* () {
                yield* TestClock.adjust(`${now} millis`)
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token: Redacted.make("synthetic-feed-token"), serverId: f.ids.guild },
                        { feed: failing(status) },
                    ),
                )
                const p = platform(bot, { actorOwner: true })
                yield* bot.ready()
                yield* bot
                    .emit(
                        "MESSAGE_CREATE",
                        bot.fixtures.message({ content: `!feed add x synthetic <#${f.ids.channel}>` }),
                    )
                    .pipe(Effect.andThen(bot.idle()))
                assert.match(sent(p.replies.requests()[0]!).content, text)
            }),
        )
})

test("The status of 10 accounts fits one short reply with one hint and no raw IDs", () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
        followed({
            accountId: `did:plc:synthetic${"abcdefghij"[index]!.repeat(15)}`,
            channelId: String(5001 + index),
            enabled: index % 2 === 0,
            ...(index % 2 ? { problem: index % 4 === 1 ? ("permission" as const) : ("channel" as const) } : {}),
        }),
    )
    const card = feedAccounts({ xConfigured: true, xPaused: false, subscriptions: rows }, "!")
    assert.equal(card.description!.split("\n").length, 10)
    assert.equal(card.footer, "10 of the 10 accounts a server can follow")
    assert.ok(!JSON.stringify(card).includes("did:plc"))
    const [text, ...more] = renderText(card)
    assert.deepEqual([more.length, renderEmbeds(card).length], [0, 1])
    assert.ok((text as { content: string }).content.split("\n").length <= 13)
    assert.match(
        feedAccounts({ xConfigured: true, xPaused: false, subscriptions: [] }, "?").description!,
        /\?feed add bluesky/,
    )
    assert.match(
        feedAccounts({ xConfigured: true, xPaused: true, subscriptions: [followed({ provider: "x" })] }, "!").note!,
        /used its X reads/,
    )
    // An account the lookup has not reached shows the handle staff typed
    assert.equal(feedName(followed({ accountId: `pending:${HANDLE}`, status: {} })), `\`${HANDLE}\``)
})

test("Without an X key status shows X accounts as off and Bluesky as on", () => {
    const x = followed({ provider: "x", accountId: "1000000000000000001", status: { handle: "synthetic" } }),
        off = { xConfigured: false, xPaused: false }
    const list = feedAccounts({ ...off, subscriptions: [followed(), x] }, "!").description!.split("\n")
    assert.match(list[0]!, /: On$/)
    assert.match(list[1]!, /: Off \(no X key\)$/)
    const detail = feedDetail(x, off, "!")
    assert.match(detail.description!, /: Off$/)
    assert.deepEqual(detail.fields!.at(-1), [
        "Problem",
        "This NeonFlux has no X key, so NeonFlux does not read this account",
    ])
    assert.match(feedDetail(followed(), off, "!").description!, /: On$/)
})

test("One account's detail shows its fix, its latest activity and a read problem in plain words", () => {
    const off = feedDetail(followed({ enabled: false, problem: "permission" }), keyed, "!")
    assert.match(off.description!, /Off\. NeonFlux lacks View channel/)
    assert.match(off.note!, /!feed add bluesky news\.example\.test #channel/)
    const trouble = feedDetail(followed({ status: { handle: HANDLE, error: "Bluesky could not be read" } }), keyed, "!")
    assert.deepEqual(trouble.fields!.at(-1), ["Problem", "Bluesky could not be read. NeonFlux tries again on its own"])
    const stopped = feedDetail(
        followed({ status: { handle: HANDLE, stopped: true, error: "Bluesky has no such account" } }),
        keyed,
        "!",
    )
    assert.deepEqual(stopped.fields!.at(-1), ["Problem", "Bluesky has no such account"])
    const paused = feedDetail(
        followed({ provider: "x", status: { handle: "synthetic" } }),
        { ...keyed, xPaused: true },
        "!",
    )
    assert.match(String(paused.fields!.at(-1)![1]), /used its X reads/)
    assert.ok(feedDetail(followed(), keyed, "!").fields!.length <= 8)
})

test("A test post is the backend's labelled sample, posted directly for the account a name picks", async () => {
    const f = createFixtures(),
        samples: unknown[] = [],
        row = followed({ channelId: f.ids.channel })
    const store: FeedStore = {
        work: () => Effect.die("Unexpected work"),
        manage: () => Effect.die("Unexpected management"),
        query: (input) =>
            Effect.sync(() => {
                samples.push(input.sample)
                return {
                    xConfigured: true,
                    xPaused: false,
                    subscriptions: [row],
                    ...(input.sample
                        ? {
                              sample: {
                                  channelId: f.ids.channel,
                                  content: { content: "Test post from NeonFlux", embed: { title: "New post" } },
                                  forumPostName: "Synthetic News",
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
                    { token: Redacted.make("synthetic-feed-token"), serverId: f.ids.guild },
                    { feed: store },
                ),
            )
            const p = platform(bot)
            yield* bot.ready()
            yield* bot
                .emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!feed test synthetic news" }))
                .pipe(Effect.andThen(bot.idle()))
            assert.deepEqual(samples, [undefined, { provider: "bluesky", accountId: DID }])
            assert.deepEqual(
                p.replies.requests().map((request) => (request.body as { content: string }).content),
                ["Test post from NeonFlux", `Test post sent in <#${f.ids.channel}>`],
            )
        }),
    )
})

test("A missing channel or permission turns the follow off once, and only the change tells the server's staff", async () => {
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot({ token: "synthetic-feed-token" }),
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
            const operations: FeedWorkOperation[] = []
            let recorded = true
            const store = storeWith((input) => {
                operations.push(input.operation)
                return Effect.succeed({ type: "progress", recorded, ...(recorded ? { name: HANDLE } : {}) })
            })
            const publishing = publishingBoundary()
            yield* processFeedDelivery(store, publishing.store, f.ids.guild, bot.client, delivery(missing))
            const notes = p.replies.requests().map(sent)
            assert.equal(notes.length, 1)
            assert.equal(notes[0]!.path, `/channels/${systemId}/messages`)
            assert.match(notes[0]!.content, /Feed posts of news\.example\.test are off\. NeonFlux cannot find/)
            assert.match(notes[0]!.content, /!feed add bluesky news\.example\.test #channel/)
            // A report that changed nothing, because the follow was already off or moved, posts no second note
            recorded = false
            yield* processFeedDelivery(store, publishing.store, f.ids.guild, bot.client, delivery(closed))
            assert.deepEqual(operations, [
                { type: "blocked", provider: "bluesky", accountId: DID, channelId: missing, reason: "channel" },
                { type: "blocked", provider: "bluesky", accountId: DID, channelId: closed, reason: "permission" },
            ])
            assert.equal(p.replies.requests().length, 1)
            assert.equal(publishing.calls.length, 0)
        }),
    )
})

test("A failed post waits for its next try, and the rest of the page still goes on", async () => {
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot({ token: "synthetic-feed-token" }),
                f = bot.fixtures
            platform(bot)
            const operations: FeedWorkOperation[] = [],
                done = yield* Deferred.make<void>(),
                first = delivery(f.ids.channel),
                second = { ...first, itemId: "3mz46jsw4ic2j" }
            const store = storeWith((input) => {
                const op = input.operation
                operations.push(op)
                if (op.type === "list") return Effect.succeed({ type: "deliveries", deliveries: [first, second] })
                if (op.type === "reserve" && op.itemId === ITEM)
                    return Effect.fail(new FeedStoreError({ operation: "work", status: 503 }))
                if (op.type === "reserve")
                    return Deferred.succeed(done, undefined).pipe(Effect.as({ type: "skipped" as const }))
                return Effect.succeed({ type: "progress", recorded: true })
            })
            const worker = yield* startFeedWorker(store, publishingBoundary().store, f.ids.guild, bot.client)
            yield* worker.notify()
            yield* Deferred.await(done)
            assert.deepEqual(
                operations.map((op) => op.type),
                ["list", "reserve", "defer", "reserve"],
            )
            assert.deepEqual(operations[2], { type: "defer", provider: "bluesky", accountId: DID, itemId: ITEM })
        }),
    )
})

test("A post for a forum becomes its own forum post through the publisher, claimed with the bot's fresh read, and a substituted grant sends nothing", async () => {
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot({ token: "synthetic-feed-token" }),
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
            const consumer = { type: "feed" as const, provider: "bluesky" as const, accountId: DID, itemId: ITEM }
            // The embed the backend renders for a post
            const url = `https://bsky.app/profile/${DID}/post/${ITEM}`,
                content = {
                    content: "",
                    embed: {
                        title: "New post",
                        url,
                        color: 0x1185fe,
                        author: { name: "Synthetic News (@news.example.test)", url: `https://bsky.app/profile/${DID}` },
                        description: "A synthetic post",
                        image: { url: "https://cdn.bsky.app/img/feed_fullsize/plain/synthetic" },
                        footer: { text: "Bluesky" },
                    },
                }
            const grant: PublishingGrant = {
                attemptId: "synthetic_feed_attempt",
                postNo: 1,
                generation: 1,
                sourceId: feedSourceId("bluesky", DID, ITEM),
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
                forumPostName: "Synthetic News: A synthetic post",
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
            const operations: FeedWorkOperation[] = []
            let reserved = grant
            const store = storeWith((input) => {
                operations.push(input.operation)
                return Effect.succeed({ type: "reserved", grant: reserved })
            })
            yield* processFeedDelivery(store, publishing.store, f.ids.guild, bot.client, delivery(forum.id))
            const context = {
                originServerId: f.ids.guild,
                observedAt: now,
                channelId: forum.id,
                botId: f.ids.bot,
                botAuthorized: true,
            }
            assert.deepEqual(operations, [
                { type: "reserve", provider: "bluesky", accountId: DID, itemId: ITEM, context },
            ])
            const body = post.requests()[0]!.body as { name: string; message: { embeds: Array<{ url: string }> } }
            assert.deepEqual([body.name, body.message.embeds[0]!.url], ["Synthetic News: A synthetic post", url])
            const claim = publishing.calls.find((call) => call.method === "dispatch")!
                .input as PublishingDispatchRequest
            assert.deepEqual(
                [claim.feedContext, claim.twitchContext, claim.eventContext],
                [context, undefined, undefined],
            )
            const outcome = publishing.calls.find((call) => call.method === "outcome")!
                .input as PublishingOutcomeRequest
            assert.deepEqual([outcome.outcome, outcome.threadId], ["sent", postId])
            // A grant for another post is refused before the publisher is asked
            reserved = { ...grant, consumer: { ...consumer, itemId: "3mz46jsw4ic2j" } }
            assert(
                Exit.isFailure(
                    yield* Effect.exit(
                        processFeedDelivery(store, publishing.store, f.ids.guild, bot.client, delivery(forum.id)),
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
