import type { PublishingPost } from "@neonflux/contracts/publishing-base"
import type {
    SuggestionsCardIndexEntry,
    SuggestionsDefinition,
    SuggestionsReactionRequest,
    SuggestionsWorkRequest,
} from "@neonflux/contracts/suggestions"
import assert from "node:assert/strict"
import test from "node:test"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Fiber, Redacted } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { withRoleMember } from "../src/roles.ts"
import { SuggestionsStoreError, type SuggestionsStore } from "../src/suggestion-store.ts"
import { platform, token } from "./moderation-fixture.ts"
import { mockBackend } from "./backend-fake.ts"
import { processDashboardConfigurationPass } from "../src/dashboard-configuration.ts"
import type { DashboardConfigurationReadyJob } from "@neonflux/contracts/dashboard"
import { restoreConfig } from "./backup-fixture.ts"

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const f = createFixtures()
const up = "👍",
    down = "👎"

function remote(card: SuggestionsCardIndexEntry) {
    const reactions: SuggestionsReactionRequest[] = [],
        work: SuggestionsWorkRequest[] = []
    // differing holds the reactors whose vote differs, and pagedClear makes a clear answer a second page of votes
    // pagedIndex puts the card on a second card-index page
    const state: { refuse?: number; differing: Set<string>; pagedClear?: boolean; pagedIndex?: boolean } = {
        differing: new Set(),
    }
    const suggestion: SuggestionsDefinition = {
        suggestionNo: card.suggestionNo,
        revision: 1,
        authorId: f.nextId(),
        channelId: card.channelId,
        text: "Synthetic proposition",
        state: "under-review",
        up: 0,
        down: 0,
        voters: 0,
        desiredRevision: 1,
        publishedRevision: 1,
        cardGeneration: 1,
        cardState: "current",
        cardStale: false,
        createdAt: 0,
        updatedAt: 0,
        forgetting: false,
        postNo: 1,
        attemptId: "a".repeat(32),
    }
    const post = {
        postNo: 1,
        generation: 1,
        channelId: card.cardChannelId,
        botId: f.ids.bot,
        messageId: card.messageId,
        outcome: "sent",
        consumer: { type: "suggestion-card", suggestionNo: card.suggestionNo, cardGeneration: 1, desiredRevision: 1 },
    } as unknown as PublishingPost
    const store: SuggestionsStore = {
        query: () => Effect.succeed({ type: "publication", suggestion, post }),
        member: () => Effect.die("Unexpected member"),
        manage: () => Effect.die("Unexpected management"),
        work: (input) => {
            work.push(input)
            const op = input.operation
            return Effect.succeed(
                op.type === "card-index"
                    ? state.pagedIndex && !op.cursor
                        ? { type: "card-index", cards: [], cursor: "synthetic_index" }
                        : { type: "card-index", cards: [card] }
                    : op.type === "reaction-sync"
                      ? { type: "reaction-sync", differing: op.present.filter((id) => state.differing.has(id)) }
                      : op.type === "reaction-sweep"
                        ? { type: "reaction-sweep", cleared: op.choice === "up" ? 1 : 0 }
                        : op.type === "reactions-cleared" && state.pagedClear && !op.cursor
                          ? { type: "progress", recorded: true, cursor: "synthetic_cursor" }
                          : { type: "progress", recorded: true },
            )
        },
        reaction: (input) => {
            reactions.push(input)
            return state.refuse
                ? Effect.fail(new SuggestionsStoreError({ operation: "reaction", status: state.refuse }))
                : Effect.succeed({
                      type: "vote",
                      accepted: true,
                      vote: {
                          choice: input.choice,
                          joinedAt: input.context.member!.joinedAt,
                          acceptedCreatedAt: 0,
                          acceptedMessageId: input.messageId,
                          via: "reaction",
                      },
                      suggestion,
                  })
        },
    }
    return { store, reactions, work, state }
}

// The reactions Fluxer holds on the card, which reaction reads page through and removals change
function nativeReactions(bot: Bot) {
    const held: Record<string, Set<string>> = { [up]: new Set(), [down]: new Set() }
    const emojiOf = (path: string) => decodeURIComponent(path.split("/reactions/")[1]!.split("/")[0]!)
    const reads = bot.rest.respond(
        (request) => request.method === "GET" && new URL(request.url).pathname.endsWith("/users"),
        (request) => {
            const url = new URL(request.url),
                after = BigInt(url.searchParams.get("after") ?? "0"),
                limit = Number(url.searchParams.get("limit") ?? "25")
            const users = [...held[emojiOf(url.pathname)]!].filter((id) => BigInt(id) > after).sort()
            return {
                body: {
                    items: users.slice(0, limit).map((id) => ({ id, username: "Synthetic reactor" })),
                    has_more: users.length > limit,
                    next_after: users.length > limit ? users[limit - 1]! : null,
                },
            }
        },
    )
    const removals = bot.rest.respond(
        (request) => request.method === "DELETE" && request.path.includes("/reactions/"),
        (request) => {
            const userId = request.path.split("/").at(-1)!
            held[emojiOf(request.path)]!.delete(userId)
            return { status: 204 }
        },
    )
    const seeds = bot.rest.respond("PUT /channels/:id/messages/:id/reactions/:emoji/@me", { status: 204 })
    return { held, reads, removals, seeds, emojiOf }
}

function scenario(
    run: (context: {
        bot: Bot
        r: ReturnType<typeof remote>
        native: ReturnType<typeof nativeReactions>
        card: SuggestionsCardIndexEntry
        react: (type: "ADD" | "REMOVE", emoji: string, userId?: string) => Effect.Effect<void, unknown>
        say: (content: string) => Effect.Effect<string | undefined, unknown>
        dmId: string
    }) => Effect.Effect<void, unknown>,
    thread = false,
) {
    const card: SuggestionsCardIndexEntry = {
        suggestionNo: 1,
        channelId: f.ids.channel,
        cardChannelId: thread ? f.nextId() : f.ids.channel,
        messageId: f.nextId(),
    }
    const r = remote(card)
    return Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { suggestions: r.store }),
                )
                // Every reactor reads as a present human member, and the platform's own members take precedence
                bot.rest.respond("GET /guilds/:id/members/:id", (request) => ({
                    body: bot.fixtures.member({
                        user: bot.fixtures.user({ id: request.path.split("/").at(-1)! }),
                        roles: [],
                        communication_disabled_until: null,
                    }),
                }))
                const p = platform(bot, {
                    everyonePermissions: Permissions.ViewChannel | Permissions.ReadMessageHistory,
                })
                const native = nativeReactions(bot)
                yield* bot.ready()
                const react = (type: "ADD" | "REMOVE", emoji: string, userId: string = f.ids.user) =>
                    Effect.gen(function* () {
                        if (type === "ADD") native.held[emoji]?.add(userId)
                        else native.held[emoji]?.delete(userId)
                        yield* bot.emit(`MESSAGE_REACTION_${type}`, {
                            user_id: userId,
                            channel_id: card.cardChannelId,
                            message_id: card.messageId,
                            guild_id: f.ids.guild,
                            emoji: { name: emoji },
                        })
                        yield* bot.idle()
                    })
                const say = (content: string) =>
                    Effect.gen(function* () {
                        const before = p.replies.requests().length
                        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content }))
                        yield* bot.idle()
                        return (p.replies.requests().slice(before).at(-1)?.body as { content?: string } | undefined)
                            ?.content
                    })
                yield* run({ bot, r, native, card, react, say, dmId: p.dmId })
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
}

// The member's role work is held until the test releases it. The node timeout only guards a hang
test("a vote by reaction never waits for the member's role work, such as their autoroles", { timeout: 60000 }, () =>
    scenario(({ bot, r, react }) =>
        Effect.gen(function* () {
            const release = yield* Deferred.make<void>(),
                held = yield* Deferred.make<void>()
            const roleWork = yield* withRoleMember(
                bot.client as unknown as Parameters<typeof withRoleMember>[0],
                f.ids.user,
                Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(release))),
                f.ids.guild,
            ).pipe(Effect.forkChild)
            yield* Deferred.await(held)
            yield* react("ADD", up)
            assert.deepEqual(
                r.reactions.map((call) => call.choice),
                ["up"],
            )
            yield* Deferred.succeed(release, undefined)
            yield* Fiber.join(roleWork)
        }),
    ),
)

test("a 👍 on a card votes up, and a 👎 while 👍 is held switches the vote and removes the 👍 once", () =>
    scenario(({ r, native, react, card }) =>
        Effect.gen(function* () {
            yield* react("ADD", up)
            assert.deepEqual(
                r.reactions.map((call) => [call.choice, call.channelId, call.messageId, call.context.channelId]),
                [["up", card.cardChannelId, card.messageId, card.channelId]],
            )
            assert.equal(r.reactions[0]!.context.member!.userId, f.ids.user)
            assert.equal(native.removals.requests().length, 0)
            yield* react("ADD", down)
            assert.equal(r.reactions.at(-1)!.choice, "down")
            assert.deepEqual(
                native.removals
                    .requests()
                    .map((request) => [native.emojiOf(request.path), request.path.split("/").at(-1)]),
                [[up, f.ids.user]],
            )
            // The bot's removal of 👍 changes nothing more, and taking away the last reaction clears the vote
            yield* react("REMOVE", up)
            assert.equal(r.reactions.at(-1)!.choice, "down")
            yield* react("REMOVE", down)
            assert.equal(r.reactions.at(-1)!.choice, "clear")
            assert.equal(native.removals.requests().length, 1)
            // Only the first vote reaction read the card index
            assert.equal(r.work.filter((call) => call.operation.type === "card-index").length, 1)
        }),
    ))

test("a card on a later page of the card index still takes votes", () =>
    scenario(({ r, react, card }) =>
        Effect.gen(function* () {
            r.state.pagedIndex = true
            yield* react("ADD", up)
            assert.deepEqual(
                r.work.flatMap((call) => (call.operation.type === "card-index" ? [call.operation.cursor] : [])),
                [undefined, "synthetic_index"],
            )
            assert.deepEqual(
                r.reactions.map((call) => [call.choice, call.messageId]),
                [["up", card.messageId]],
            )
        }),
    ))

test("a refused added reaction is removed once, a refused removal removes nothing, and the bot's own reaction reads nothing", () =>
    scenario(({ r, native, react }) =>
        Effect.gen(function* () {
            r.state.refuse = 403
            yield* react("ADD", up)
            assert.deepEqual(
                native.removals.requests().map((request) => native.emojiOf(request.path)),
                [up],
            )
            native.held[down]!.add(f.ids.user)
            yield* react("REMOVE", down)
            assert.equal(r.reactions.at(-1)!.choice, "clear")
            assert.equal(native.removals.requests().length, 1)
            r.state.refuse = 429
            yield* react("ADD", down)
            assert.equal(native.removals.requests().length, 2)
            delete r.state.refuse
            const reads = native.reads.requests().length,
                calls = r.reactions.length
            yield* react("ADD", up, f.ids.bot)
            assert.equal(native.reads.requests().length, reads)
            assert.equal(r.reactions.length, calls)
            // Another emoji on the card is no vote
            yield* react("ADD", "🎉")
            assert.equal(r.reactions.length, calls)
        }),
    ))

test("a card in a forum post votes with the forum as the member's channel", () =>
    scenario(
        ({ r, react, card }) =>
            Effect.gen(function* () {
                yield* react("ADD", down)
                assert.notEqual(card.cardChannelId, card.channelId)
                assert.deepEqual(
                    r.reactions.map((call) => [call.choice, call.channelId, call.context.channelId]),
                    [["down", card.cardChannelId, card.channelId]],
                )
            }),
        true,
    ))

test("clearing a card's reactions clears their votes a page at a time and the bot adds its own two again", () =>
    scenario(({ bot, r, native, card }) =>
        Effect.gen(function* () {
            r.state.pagedClear = true
            const target = { channel_id: card.cardChannelId, message_id: card.messageId, guild_id: f.ids.guild }
            yield* bot.emit("MESSAGE_REACTION_REMOVE_ALL", target)
            yield* bot.idle()
            yield* bot.emit("MESSAGE_REACTION_REMOVE_EMOJI", { ...target, emoji: { name: up } })
            yield* bot.idle()
            yield* bot.emit("MESSAGE_REACTION_REMOVE_EMOJI", { ...target, emoji: { name: "🎉" } })
            yield* bot.idle()
            const clears = r.work.flatMap((call) =>
                call.operation.type === "reactions-cleared" ? [call.operation] : [],
            )
            // Each clear goes on with the cursor of the votes page before, under the time the reactions were cleared
            assert.deepEqual(
                clears.map((op) => [op.choice, op.cursor]),
                [
                    ["all", undefined],
                    ["all", "synthetic_cursor"],
                    ["up", undefined],
                    ["up", "synthetic_cursor"],
                ],
            )
            assert.equal(clears[0]!.observedAt, clears[1]!.observedAt)
            assert.deepEqual(
                native.seeds.requests().map((request) => native.emojiOf(request.path)),
                [up, down, up, down],
            )
        }),
    ))

test("a recount reads reactors a page at a time, counts at most 100 a run and goes on where it stopped with next", () =>
    scenario(({ r, native, say }) =>
        Effect.gen(function* () {
            const reactors = Array.from({ length: 101 }, () => f.nextId())
            for (const id of reactors) {
                native.held[up]!.add(id)
                r.state.differing.add(id)
            }
            assert.equal(
                yield* say("!suggest recount 1 next"),
                "There is no next page to show. Send !suggest recount 1 to start the list again",
            )
            assert.equal(
                yield* say("!suggest recount 1"),
                "Recounted 100 reactions of suggestion #1 so far\nContinue: `!suggest recount 1 next`",
            )
            const syncs = () =>
                r.work.flatMap((call) => (call.operation.type === "reaction-sync" ? [call.operation] : []))
            // The 101 reactors take two pages of 100, and the run stops before counting the 101st
            assert.deepEqual(
                syncs().map((op) => [op.choice, op.present.length]),
                [
                    ["up", 100],
                    ["up", 1],
                ],
            )
            assert.equal(r.reactions.length, 100)
            assert(r.reactions.every((call) => call.choice === "up"))
            // next reads on after the last reactor counted, so nobody is counted twice, then sweeps both emojis. Its answer counts
            // the votes of both runs
            assert.equal(
                yield* say("!suggest recount 1 next"),
                "Recounted suggestion #1: 101 votes added, 1 cleared, reactions match now",
            )
            assert.equal(r.reactions.length, 101)
            assert.equal(new Set(r.reactions.map((call) => call.context.actor.userId)).size, 101)
            assert.deepEqual(
                syncs().map((op) => [op.choice, op.present.length]),
                [
                    ["up", 100],
                    ["up", 1],
                    ["up", 1],
                ],
            )
            const sweeps = r.work.flatMap((call) => (call.operation.type === "reaction-sweep" ? [call.operation] : []))
            assert.deepEqual(
                sweeps.map((op) => op.choice),
                ["up", "down"],
            )
            // Both sweeps clear only votes no read confirmed since the first run began
            assert(sweeps.every((op) => op.before === sweeps[0]!.before && op.before <= syncs()[0]!.observedAt))
            // Each run adds the bot's own two reactions
            assert.equal(native.seeds.requests().length, 4)
            assert.equal(
                yield* say("!suggest recount 1 next"),
                "There is no next page to show. Send !suggest recount 1 to start the list again",
            )
        }),
    ))

test("turning suggestions on from the dashboard makes the next reaction read the cards again", (t) => {
    let jobs: DashboardConfigurationReadyJob[] = []
    mockBackend(t, (call) => {
        if (call.path === "/dashboard-configuration/ready") return { jobs }
        assert.equal(call.path, "/dashboard-configuration/execute")
        const { native: _native, ...stored } = jobs[0]!
        return { job: { ...stored, state: "applied" } }
    })
    return scenario(({ bot, r, react }) =>
        Effect.gen(function* () {
            const learned = () => r.work.filter((input) => input.operation.type === "card-index").length
            // The dashboard pass reads the member who asked as a human account
            bot.rest.respond("GET /users/@me", { body: bot.fixtures.botUser({ system: false }) })
            bot.rest.respond(`GET /users/${f.ids.user}`, {
                body: bot.fixtures.user({ id: f.ids.user, bot: false, system: false }),
            })
            yield* react("ADD", up)
            yield* react("REMOVE", up)
            assert.equal(learned(), 1)
            jobs = [
                {
                    native: {},
                    id: "synthetic_suggestions_job",
                    actorId: f.ids.user,
                    expectedConfigRevision: 0,
                    state: "queued",
                    // This scenario runs on the real clock, so the job never expires during it
                    createdAt: 0,
                    expiresAt: Number.MAX_SAFE_INTEGER,
                    family: "suggestions",
                    operation: { type: "settings", expectedRevision: 1, enabled: true },
                },
            ]
            yield* processDashboardConfigurationPass(
                {
                    token,
                    serverId: f.ids.guild,
                    backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-backend-secret") },
                },
                bot.client as unknown as Parameters<typeof processDashboardConfigurationPass>[1],
            )
            yield* react("ADD", up)
            assert.equal(learned(), 2)
        }),
    )
})

test("restoring the suggestions settings makes the next reaction read the cards again", () =>
    scenario(({ bot, r, react, dmId }) =>
        Effect.gen(function* () {
            const learned = () => r.work.filter((input) => input.operation.type === "card-index").length
            yield* react("ADD", up)
            yield* react("REMOVE", up)
            assert.equal(learned(), 1)
            // The restore reads the channel the settings name from one listing of the server's channels
            bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, { body: [bot.fixtures.channel()] })
            yield* restoreConfig(bot.client as unknown as Parameters<typeof restoreConfig>[0], dmId, [
                { family: "suggestions", sourceId: "suggestions", value: { enabled: true, channelId: f.ids.channel } },
            ])
            yield* react("ADD", up)
            assert.equal(learned(), 2)
        }),
    ))
