import assert from "node:assert/strict"
import test from "node:test"
import {
    GIVEAWAY_EMOJI,
    GIVEAWAY_ENTRANTS,
    giveawayCard,
    type Giveaway,
    type GiveawayOperation,
    type GiveawayWorkOperation,
    type GiveawayWorkResult,
} from "@neonflux/contracts/giveaways"
import { canonicalPublishingContent, giveawaySourceId, type PublishingGrant } from "@neonflux/contracts/publishing-base"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Exit, Redacted, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { processDashboardConfigurationPass } from "../src/dashboard-configuration.ts"
import { giveawayCritical, giveawayHelp, parseGiveawayCommand } from "../src/giveaway-command.ts"
import { giveawayDetail, giveawayList } from "../src/giveaway-management.ts"
import { GiveawayStoreError, type GiveawayStore } from "../src/giveaway-store.ts"
import { drawOrder, processGiveaway } from "../src/giveaway-worker.ts"
import { mockBackend } from "./backend-fake.ts"
import { answerMemberRequests } from "./member-chunks-fixture.ts"
import { platform } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"

const now = Date.parse("2026-10-01T00:00:00Z"),
    CARD = "7001"
const controlled = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) =>
    Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))
const parse = (line: string) => parseGiveawayCommand(line.split(" "))
const sent = (request: { path: string; body?: unknown }) => ({
    path: request.path,
    ...(request.body as { content: string }),
})
const giveaway = (fields: Partial<Giveaway> = {}): Giveaway => ({
    giveawayNo: 3,
    hostId: "4000",
    channelId: "5001",
    prize: "Game key",
    winnerCount: 2,
    endsAt: now + 3600000,
    createdAt: now,
    state: "running",
    phase: "wait",
    messageId: CARD,
    winners: [],
    ...fields,
})

test("Commands read every form and refuse what lies outside the limits", () => {
    assert.deepEqual(parseGiveawayCommand(["start", "1d", "2", "<#5001>", "Game", "key"]), {
        type: "start",
        lengthSeconds: 86400,
        winners: 2,
        channelId: "5001",
        prize: "Game key",
    })
    assert.deepEqual(parse("end 3"), { type: "end", giveawayNo: 3 })
    assert.deepEqual(parse("cancel #3"), { type: "cancel", giveawayNo: 3 })
    assert.deepEqual(parse("show 3"), { type: "show", giveawayNo: 3 })
    assert.deepEqual(parse("reroll 3"), { type: "reroll", giveawayNo: 3 })
    assert.deepEqual(parse("reroll 3 5"), { type: "reroll", giveawayNo: 3, count: 5 })
    assert.deepEqual(parse("list"), { type: "list", next: false })
    assert.deepEqual(parse("list next"), { type: "list", next: true })
    assert.deepEqual(parse("settings"), { type: "settings" })
    assert.deepEqual(parse("module off"), { type: "settings-set", patch: { enabled: false } })
    assert.deepEqual(parse("role <@&77>"), { type: "settings-set", patch: { requiredRoleId: "77" } })
    assert.deepEqual(parse("role none"), { type: "settings-set", patch: { requiredRoleId: null } })
    assert.deepEqual(parseGiveawayCommand([]), { type: "help" })
    for (const line of [
        "start 59s 1 <#5001> x",
        "start 61d 1 <#5001> x",
        "start 1d 0 <#5001> x",
        "start 1d 21 <#5001> x",
        "start 1d 1 general x",
        "start 1d 1 <#5001>",
        `start 1d 1 <#5001> ${"x".repeat(257)}`,
        "end",
        "end x",
        "reroll",
        "reroll 3 21",
        "role everyone",
        "module",
        "fly",
    ])
        assert.ok("error" in parse(line), line)
    assert.equal(giveawayCritical(parse("module off")), true)
    assert.equal(giveawayCritical(parse("module on")), false)
    assert.match(giveawayHelp, /!giveaway start <length> <winners> #channel <prize>/)
})

test("The draw order is uniform: Every sequence of random picks gives every order once", () => {
    const orders = new Map<string, number>()
    for (let a = 0; a < 4; a++)
        for (let b = 0; b < 3; b++)
            for (let c = 0; c < 2; c++) {
                const picks = [a, b, c]
                const order = drawOrder(["w", "x", "y", "z"], () => picks.shift()!).join("")
                orders.set(order, (orders.get(order) ?? 0) + 1)
            }
    assert.equal(orders.size, 24)
    assert.ok([...orders.values()].every((count) => count === 1))
    // Without a source of its own it draws from node:crypto, and it keeps the pool as it was
    const pool = ["a", "b", "c"]
    assert.deepEqual([...drawOrder(pool)].sort(), pool)
    assert.deepEqual(pool, ["a", "b", "c"])
    assert.deepEqual(drawOrder([]), [])
})

test("The card shows the prize, end time, winners, host and how to enter, and each later state", () => {
    const running = giveawayCard(giveaway({ requiredRoleId: "77" }))
    const seconds = (now + 3600000) / 1000
    assert.equal(
        running,
        [
            "**Giveaway #3: Game key**",
            `Ends <t:${seconds}:f>, <t:${seconds}:R>`,
            "Winners: 2",
            "Hosted by <@4000>",
            "Needs the role <@&77> to win",
            `React with ${GIVEAWAY_EMOJI} to enter`,
        ].join("\n"),
    )
    const ended = giveawayCard(
        giveaway({
            state: "ended",
            endedAt: now,
            capped: true,
            winners: [
                { userId: "71", drawNo: 1, dm: "sent" },
                { userId: "72", drawNo: 1, dm: "failed" },
                { userId: "73", drawNo: 2, dm: "sent" },
            ],
        }),
    )
    assert.match(ended, /\*\*Giveaway #3 ended: Game key\*\*/)
    assert.match(ended, /Winners: <@71>, <@72>\nRerolled: <@73>/)
    assert.match(ended, /Only the first 5,000 entries by account age were read/)
    assert.match(giveawayCard(giveaway({ state: "ended", endedAt: now })), /No winner: No valid entries/)
    assert.equal(
        giveawayCard(giveaway({ state: "cancelled" })),
        "**Giveaway #3 cancelled: Game key**\nHosted by <@4000>",
    )
    // A host who deleted their data leaves the card's next edit
    const { hostId: _hostId, ...hostless } = giveaway({ state: "cancelled" })
    assert.doesNotMatch(giveawayCard(hostless), /Hosted/)
})

test("A giveaway that ended unposted says why", () => {
    const field = giveawayDetail(giveaway({ state: "ended", phase: "done", problem: "post-late" }), "!").fields!.find(
        ([name]) => name === "Problem",
    )!
    assert.match(String(field[1]), /Its end passed before its card could go out/)
})

test("Replies stay short: A full detail has at most 8 fields and a list says what is next", () => {
    const full = giveawayDetail(
        giveaway({
            state: "ended",
            phase: "done",
            requiredRoleId: "77",
            entrants: 5000,
            capped: true,
            problem: "result-uncertain",
            winners: [
                { userId: "71", drawNo: 1, dm: "failed" },
                { userId: "72", drawNo: 1, dm: "uncertain" },
                { userId: "73", drawNo: 1, dm: "sent" },
            ],
        }),
        "?",
    )
    assert.ok(full.fields!.length <= 8)
    assert.deepEqual(
        full.fields!.find(([name]) => name === "Not told by DM"),
        ["Not told by DM", "<@71>, <@72>"],
    )
    assert.match(String(full.fields!.find(([name]) => name === "Valid entries read")![1]), /Only the first 5,000/)
    assert.equal(full.note, "Draw again with `?giveaway reroll 3`")
    const page = giveawayList([giveaway()], 1, "!", true)
    assert.deepEqual(page.fields, [["Next", "`!giveaway list next`"]])
    assert.match(giveawayList([], 0, "!", false).description!, /No giveaways yet/)
})

test("A finished draw without a winner says so instead of how many are still to draw", () => {
    const shown = (fields: Partial<Giveaway>) =>
        giveawayDetail(giveaway(fields), "!").fields!.find(([name]) => name === "Winners")![1]
    assert.equal(shown({}), "2 to draw")
    assert.equal(shown({ state: "ended", phase: "done", entrants: 0 }), "None, no valid entries")
    assert.equal(shown({ state: "ended", phase: "done", problem: "card" }), "None")
    assert.equal(shown({ state: "cancelled", phase: "done" }), "None")
})

/** The backend's side of the chat commands */
function chatStore(fail?: GiveawayStoreError) {
    const operations: GiveawayOperation[] = [],
        work: GiveawayWorkOperation[] = []
    const store: GiveawayStore = {
        query: (input) =>
            Effect.succeed({
                settings: { enabled: true, requiredRoleId: null },
                running: 1,
                giveaways:
                    input.giveawayNo === 404
                        ? []
                        : [giveaway({ problem: "result-uncertain", state: "ended", phase: "done" })],
            }),
        manage: (input) =>
            fail
                ? Effect.fail(fail)
                : Effect.sync(() => {
                      operations.push(input.operation)
                      return input.operation.type === "settings"
                          ? { type: "settings" as const, settings: { enabled: false, requiredRoleId: null } }
                          : { type: "giveaway" as const, giveaway: giveaway() }
                  }),
        work: (input) =>
            Effect.sync(() => {
                work.push(input.operation)
                return { type: "progress" as const, recorded: true }
            }),
    }
    return { store, operations, work }
}
function chat(store: GiveawayStore, options: { permissions?: bigint; botPermissions?: bigint } = {}) {
    const f = createFixtures()
    return Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot(
            createBotOptions(
                { token: Redacted.make("synthetic-giveaway-token"), serverId: f.ids.guild },
                { giveaways: store },
            ),
        )
        const p = platform(bot, {
            actorOwner: false,
            actorPermissions: options.permissions ?? Permissions.ManageGuild,
            ...(options.botPermissions ? { botPermissions: options.botPermissions } : {}),
        })
        yield* bot.ready()
        const say = (content: string) =>
            bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))
        return { bot, p, say, f: bot.fixtures }
    })
}

test("Only the owner, Manage community or Administrator can use any form, and members get one refusal", async () => {
    const c = chatStore()
    await controlled(
        Effect.gen(function* () {
            const { say, p } = yield* chat(c.store, { permissions: Permissions.SendMessages })
            for (const command of ["list", "show 3", "settings", "module off", "end 3", "reroll 3", "cancel 3"]) {
                yield* say(`!giveaway ${command}`)
                assert.match(
                    sent(p.replies.requests().at(-1)!).content,
                    /Only the server owner or members with Manage community/,
                )
            }
            assert.deepEqual(c.operations, [])
        }),
    )
})

test("A start checks the channel and NeonFlux's permissions first, then records it and names the number", async () => {
    const c = chatStore()
    await controlled(
        Effect.gen(function* () {
            const { say, p, f } = yield* chat(c.store)
            yield* say(`!giveaway start 1d 2 <#${f.ids.channel}> Game key`)
            assert.deepEqual(c.operations, [
                { type: "start", lengthSeconds: 86400, winners: 2, channelId: f.ids.channel, prize: "Game key" },
            ])
            assert.match(sent(p.replies.requests().at(-1)!).content, /Giveaway #3 is being posted in/)
        }),
    )
    const refused = chatStore()
    await controlled(
        Effect.gen(function* () {
            const { say, p, f } = yield* chat(refused.store, { botPermissions: Permissions.ViewChannel })
            yield* say(`!giveaway start 1d 2 <#${f.ids.channel}> Game key`)
            assert.deepEqual(refused.operations, [])
            assert.match(sent(p.replies.requests().at(-1)!).content, /NeonFlux needs|Send messages/)
        }),
    )
})

test("End, cancel and reroll record what is wanted and name where the result appears", async () => {
    const c = chatStore()
    await controlled(
        Effect.gen(function* () {
            const { say, p } = yield* chat(c.store)
            yield* say("!giveaway end 3")
            assert.match(sent(p.replies.requests().at(-1)!).content, /Giveaway #3 is ending/)
            yield* say("!giveaway cancel 3")
            assert.match(sent(p.replies.requests().at(-1)!).content, /Giveaway #3 is cancelled/)
            yield* say("!giveaway reroll 3 1")
            assert.match(sent(p.replies.requests().at(-1)!).content, /Giveaway #3 is drawing again/)
            yield* say("!giveaway module off")
            assert.match(sent(p.replies.requests().at(-1)!).content, /Giveaways are off/)
            assert.deepEqual(c.operations, [
                { type: "end", giveawayNo: 3 },
                { type: "cancel", giveawayNo: 3 },
                { type: "reroll", giveawayNo: 3, count: 1 },
                { type: "settings", patch: { enabled: false } },
            ])
        }),
    )
})

test("A role that is not the server's is refused, and a refusal from the backend is shown as it is", async () => {
    const c = chatStore()
    await controlled(
        Effect.gen(function* () {
            const { say, p, f } = yield* chat(c.store)
            yield* say("!giveaway role 12345")
            assert.match(sent(p.replies.requests().at(-1)!).content, /Choose a role of this server/)
            yield* say(`!giveaway role ${f.ids.guild}`)
            assert.match(sent(p.replies.requests().at(-1)!).content, /Choose a role of this server/)
            assert.deepEqual(c.operations, [])
        }),
    )
    const refusal = chatStore(
        new GiveawayStoreError({
            operation: "manage",
            status: 409,
            code: "REFUSED",
            reason: "The server's automod rule words blocks this prize. Change the text and try again",
        }),
    )
    await controlled(
        Effect.gen(function* () {
            const { say, p } = yield* chat(refusal.store)
            yield* say("!giveaway end 3")
            assert.match(sent(p.replies.requests().at(-1)!).content, /automod rule words blocks this prize/)
        }),
    )
})

test("Show reads the card to settle an unknown update, and never sends it again", async () => {
    const c = chatStore()
    await controlled(
        Effect.gen(function* () {
            const { say, p, bot, f } = yield* chat(c.store)
            const fetched = bot.rest.respond(`GET /channels/5001/messages/${CARD}`, {
                body: f.message({
                    id: CARD,
                    channel_id: "5001",
                    author: f.botUser(),
                    content: giveawayCard(giveaway({ state: "ended", phase: "done" })),
                }),
            })
            const edits = bot.rest.respond("PATCH /channels/:id/messages/:id", { body: {} })
            yield* say("!giveaway show 3")
            assert.equal(fetched.requests().length, 1)
            assert.equal(edits.requests().length, 0)
            assert.deepEqual(c.work, [{ type: "confirm", giveawayNo: 3 }])
            assert.doesNotMatch(JSON.stringify(p.replies.requests().at(-1)!.body), /does not know whether/)
        }),
    )
    const other = chatStore()
    await controlled(
        Effect.gen(function* () {
            const { say, p, bot, f } = yield* chat(other.store)
            bot.rest.respond(`GET /channels/5001/messages/${CARD}`, {
                body: f.message({ id: CARD, channel_id: "5001", author: f.botUser(), content: "older text" }),
            })
            yield* say("!giveaway show 3")
            assert.deepEqual(other.work, [])
            assert.match(JSON.stringify(p.replies.requests().at(-1)!.body), /does not know whether/)
            yield* say("!giveaway show 404")
            assert.match(sent(p.replies.requests().at(-1)!).content, /There is no giveaway #404/)
        }),
    )
})

test("A refused dashboard change shows the backend's sentence on the website", async (t) => {
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot({ token: "synthetic-giveaway-token" }),
                f = bot.fixtures
            platform(bot)
            bot.rest.respond(`GET /users/${f.ids.user}`, { body: f.user({ bot: undefined, system: undefined }) })
            const failures: unknown[] = [],
                reason = "This server already runs 25 giveaways, its limit. End or cancel one first"
            mockBackend(t, (call) => {
                if (call.path === "/dashboard-configuration/ready")
                    return {
                        jobs: [
                            {
                                family: "giveaways",
                                operation: { type: "end", giveawayNo: 3 },
                                native: {},
                                id: "synthetic_giveaway_job",
                                actorId: f.ids.user,
                                expectedConfigRevision: 0,
                                state: "queued",
                                createdAt: now,
                                expiresAt: now + 120000,
                            },
                        ],
                    }
                if (call.path === "/dashboard-configuration/fail") {
                    failures.push(call.body)
                    return null
                }
                assert.equal(call.path, "/dashboard-configuration/execute")
                return Response.json({ error: reason, code: "REFUSED" }, { status: 429 })
            })
            yield* processDashboardConfigurationPass(
                {
                    token: Redacted.make("synthetic-giveaway-token"),
                    serverId: f.ids.guild,
                    backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic") },
                },
                bot.client,
            )
            assert.deepEqual(failures, [{ serverId: f.ids.guild, jobId: "synthetic_giveaway_job", reason }])
        }),
    )
})

// The worker's side of the backend, answering each claim with a canned result
function workStore(answers: Partial<Record<GiveawayWorkOperation["type"], GiveawayWorkResult>>) {
    const operations: GiveawayWorkOperation[] = []
    const store: GiveawayStore = {
        query: () => Effect.die("Unexpected query"),
        manage: () => Effect.die("Unexpected management"),
        work: (input) =>
            Effect.sync(() => {
                operations.push(input.operation)
                return answers[input.operation.type] ?? { type: "progress" as const, recorded: true }
            }),
    }
    return { store, operations }
}
const worker = (permissions?: bigint) =>
    Effect.gen(function* () {
        yield* TestClock.adjust(`${now} millis`)
        const bot = yield* createTestBot({ token: "synthetic-giveaway-token" }),
            f = bot.fixtures,
            p = platform(bot, permissions ? { botPermissions: permissions } : {})
        return { bot, f, p }
    })
const usersRoute = (bot: Effect.Success<ReturnType<typeof createTestBot>>, response: object) =>
    bot.rest.respond((request) => new URL(request.url).pathname.includes("/reactions/"), response)
const memberRoute = (bot: Effect.Success<ReturnType<typeof createTestBot>>, held: Record<string, string[]>) =>
    bot.rest.respond("GET /guilds/:id/members/:id", (request) => {
        const id = request.path.split("/").at(-1)!
        return id in held
            ? {
                  body: bot.fixtures.member({
                      user: bot.fixtures.user({ id }),
                      roles: held[id]!,
                      communication_disabled_until: null,
                  }),
              }
            : { status: 404, body: { code: "UNKNOWN_MEMBER", message: "Synthetic" } }
    })
const page = (ids: readonly (string | { id: string; bot: boolean })[]) => ({
    body: {
        items: ids.map((value) =>
            typeof value === "string"
                ? { id: value, username: `member${value}` }
                : { id: value.id, username: `member${value.id}`, bot: value.bot },
        ),
        has_more: false,
        next_after: null,
    },
})
const inOrder = (range: number) => range - 1

test("A card goes through the publisher with the bot's fresh read, and the entry emoji follows once", async () => {
    await controlled(
        Effect.gen(function* () {
            const { bot, f, p } = yield* worker()
            const publishing = publishingBoundary()
            const consumer = { type: "giveaway" as const, giveawayNo: 3 },
                content = { content: giveawayCard(giveaway({ channelId: f.ids.channel })) }
            const grant: PublishingGrant = {
                attemptId: "attempt1",
                postNo: 1,
                generation: 1,
                sourceId: giveawaySourceId(3),
                actorId: f.ids.bot,
                botId: f.ids.bot,
                action: "send",
                channelId: f.ids.channel,
                source: consumer,
                provenance: consumer,
                consumer,
                content,
                canonicalContent: canonicalPublishingContent(content),
                dispatchExpiresAt: now + 180000,
                nativeDeadlineMs: 5000,
            }
            publishing.posts.set(1, {
                postNo: 1,
                generation: 1,
                botId: f.ids.bot,
                channelId: f.ids.channel,
                outcome: "pending",
                createdAt: now,
                updatedAt: now,
                consumer,
                attempt: { ...grant, outcome: "pending", createdAt: now },
            })
            const posts = bot.rest.respond(`POST /channels/${f.ids.channel}/messages`, (request) => ({
                body: f.message({
                    id: CARD,
                    channel_id: f.ids.channel,
                    author: f.botUser(),
                    content: (request.body as { content: string }).content,
                }),
            }))
            const reacts = bot.rest.respond("PUT /channels/:id/messages/:id/reactions/:emoji/@me", { status: 204 })
            const s = workStore({ reserve: { type: "reserved", grant } })
            yield* processGiveaway(s.store, publishing.store, f.ids.guild, bot.client, {
                giveawayNo: 3,
                channelId: f.ids.channel,
                action: "post",
            })
            assert.equal(posts.requests().length, 1)
            assert.equal(reacts.requests().length, 1)
            assert.ok(reacts.requests()[0]!.path.includes(`/messages/${CARD}/reactions/`))
            const claim = publishing.calls.find((call) => call.method === "dispatch")!.input as {
                giveawayContext: unknown
            }
            assert.deepEqual(claim.giveawayContext, {
                originServerId: f.ids.guild,
                observedAt: now,
                channelId: f.ids.channel,
                botId: f.ids.bot,
                botAuthorized: true,
            })
            assert.deepEqual(
                s.operations.map((op) => op.type),
                ["reserve"],
            )
            // A failed reaction is noted, and members can still enter
            const refused = bot.rest.respond("PUT /channels/:id/messages/:id/reactions/:emoji/@me", {
                status: 403,
                body: { code: "MISSING_PERMISSIONS", message: "Synthetic refusal" },
            })
            const again = { ...grant, attemptId: "attempt2" }
            publishing.posts.set(1, {
                postNo: 1,
                generation: 1,
                botId: f.ids.bot,
                channelId: f.ids.channel,
                outcome: "pending",
                createdAt: now,
                updatedAt: now,
                consumer,
                attempt: { ...again, outcome: "pending", createdAt: now },
            })
            const second = workStore({ reserve: { type: "reserved", grant: again } })
            yield* processGiveaway(second.store, publishing.store, f.ids.guild, bot.client, {
                giveawayNo: 3,
                channelId: f.ids.channel,
                action: "post",
            })
            assert.equal(refused.requests().length, 1)
            assert.deepEqual(
                second.operations.map((op) => op.type),
                ["reserve", "reaction"],
            )
            // A grant for another giveaway sends nothing
            const substituted = workStore({
                reserve: { type: "reserved", grant: { ...grant, consumer: { type: "giveaway", giveawayNo: 4 } } },
            })
            const posted = posts.requests().length
            assert.ok(
                Exit.isFailure(
                    yield* Effect.exit(
                        processGiveaway(substituted.store, publishing.store, f.ids.guild, bot.client, {
                            giveawayNo: 3,
                            channelId: f.ids.channel,
                            action: "post",
                        }),
                    ),
                ),
            )
            assert.equal(posts.requests().length, posted)
            void p
        }),
    )
})

test("A channel that is gone or closed to NeonFlux is reported, and nothing is reserved", async () => {
    await controlled(
        Effect.gen(function* () {
            const { bot, f } = yield* worker(Permissions.ViewChannel)
            const s = workStore({})
            yield* processGiveaway(s.store, publishingBoundary().store, f.ids.guild, bot.client, {
                giveawayNo: 3,
                channelId: f.ids.channel,
                action: "post",
            })
            assert.deepEqual(s.operations, [
                { type: "blocked", giveawayNo: 3, channelId: f.ids.channel, reason: "permission" },
            ])
        }),
    )
})

test("A draw drops bots, NeonFlux and earlier winners, reads each candidate fresh, and keeps drawing until enough hold up", async () => {
    await controlled(
        Effect.gen(function* () {
            const { bot, f } = yield* worker()
            yield* answerMemberRequests(bot)
            const claim = giveaway({ channelId: f.ids.channel, requiredRoleId: "77" })
            const s = workStore({
                "draw-claim": { type: "draw", giveaway: claim, count: 2, excludeIds: ["1004"] },
                "announce-claim": { type: "announce", giveaway: claim, winnerIds: [] },
            })
            usersRoute(bot, page(["1001", "1002", "1003", "1004", "1005", { id: "1006", bot: true }, f.ids.bot]))
            // 1005 left, 1003 lacks the role, and 1002 and 1001 hold up. Draw order with this source is the pool's own
            const reads = memberRoute(bot, { "1001": ["77"], "1002": ["77"], "1003": [] })
            yield* processGiveaway(
                s.store,
                publishingBoundary().store,
                f.ids.guild,
                bot.client,
                { giveawayNo: 3, channelId: f.ids.channel, action: "draw" },
                inOrder,
            )
            assert.deepEqual(
                s.operations.find((op) => op.type === "draw-record"),
                {
                    type: "draw-record",
                    giveawayNo: 3,
                    winnerIds: ["1001", "1002"],
                    entrants: 4,
                    capped: false,
                },
            )
            assert.ok(reads.requests().length >= 4)
            assert.deepEqual(
                s.operations.map((op) => op.type),
                ["draw-claim", "draw-record", "announce-claim", "announce-outcome"],
            )
        }),
    )
})

test("A candidate Fluxer did not answer for puts the draw off, and nothing is recorded", async () => {
    await controlled(
        Effect.gen(function* () {
            const { bot, f } = yield* worker()
            yield* answerMemberRequests(bot)
            const claim = giveaway({ channelId: f.ids.channel })
            const s = workStore({ "draw-claim": { type: "draw", giveaway: claim, count: 1, excludeIds: [] } })
            usersRoute(bot, page(["1001", "1002"]))
            bot.rest.respond("GET /guilds/:id/members/:id", {
                status: 403,
                body: { code: "MISSING_ACCESS", message: "Synthetic" },
            })
            yield* processGiveaway(
                s.store,
                publishingBoundary().store,
                f.ids.guild,
                bot.client,
                { giveawayNo: 3, channelId: f.ids.channel, action: "draw" },
                inOrder,
            )
            assert.deepEqual(s.operations, [
                { type: "draw-claim", giveawayNo: 3 },
                { type: "defer", giveawayNo: 3 },
            ])
        }),
    )
    // One confirmed winner ahead of an unread candidate is enough, since the draw stops before reading on
    await controlled(
        Effect.gen(function* () {
            const { bot, f } = yield* worker()
            yield* answerMemberRequests(bot)
            const claim = giveaway({ channelId: f.ids.channel })
            const s = workStore({
                "draw-claim": { type: "draw", giveaway: claim, count: 1, excludeIds: [] },
                "announce-claim": { type: "skipped" },
            })
            usersRoute(bot, page(["1001", "1002"]))
            bot.rest.respond("GET /guilds/:id/members/:id", (request) =>
                request.path.endsWith("/1001")
                    ? {
                          body: f.member({
                              user: f.user({ id: "1001" }),
                              roles: [],
                              communication_disabled_until: null,
                          }),
                      }
                    : { status: 403, body: { code: "MISSING_ACCESS", message: "Synthetic" } },
            )
            yield* processGiveaway(
                s.store,
                publishingBoundary().store,
                f.ids.guild,
                bot.client,
                { giveawayNo: 3, channelId: f.ids.channel, action: "draw" },
                inOrder,
            )
            assert.deepEqual(
                s.operations.find((op) => op.type === "draw-record"),
                {
                    type: "draw-record",
                    giveawayNo: 3,
                    winnerIds: ["1001"],
                    entrants: 2,
                    capped: false,
                },
            )
        }),
    )
})

test("A draw over the bound says so, and one with no valid entry has no winner", async () => {
    await controlled(
        Effect.gen(function* () {
            const { bot, f } = yield* worker()
            yield* answerMemberRequests(bot)
            const claim = giveaway({ channelId: f.ids.channel })
            const s = workStore({ "draw-claim": { type: "draw", giveaway: claim, count: 1, excludeIds: [] } })
            const everyone = Array.from({ length: GIVEAWAY_ENTRANTS + 50 }, (_, index) => String(100000 + index))
            let requested = 0
            usersRoute(bot, (request: { url: string }) => {
                const url = new URL(request.url),
                    after = url.searchParams.get("after"),
                    limit = Number(url.searchParams.get("limit")),
                    from = after ? everyone.indexOf(after) + 1 : 0,
                    items = everyone.slice(from, from + limit)
                requested++
                return {
                    body: {
                        items: items.map((id) => ({ id, username: `member${id}` })),
                        has_more: from + limit < everyone.length,
                        next_after: from + limit < everyone.length ? items.at(-1) : null,
                    },
                }
            })
            memberRoute(bot, Object.fromEntries(everyone.map((id) => [id, []])))
            yield* processGiveaway(
                s.store,
                publishingBoundary().store,
                f.ids.guild,
                bot.client,
                { giveawayNo: 3, channelId: f.ids.channel, action: "draw" },
                inOrder,
            )
            const record = s.operations.find((op) => op.type === "draw-record") as Extract<
                GiveawayWorkOperation,
                { type: "draw-record" }
            >
            assert.deepEqual([record.entrants, record.capped, record.winnerIds.length], [GIVEAWAY_ENTRANTS, true, 1])
            assert.ok(requested <= 52, `read ${requested} pages`)
        }),
    )
    await controlled(
        Effect.gen(function* () {
            const { bot, f } = yield* worker()
            const claim = giveaway({ channelId: f.ids.channel })
            const s = workStore({ "draw-claim": { type: "draw", giveaway: claim, count: 2, excludeIds: [] } })
            usersRoute(bot, page([f.ids.bot]))
            yield* processGiveaway(s.store, publishingBoundary().store, f.ids.guild, bot.client, {
                giveawayNo: 3,
                channelId: f.ids.channel,
                action: "draw",
            })
            assert.deepEqual(
                s.operations.find((op) => op.type === "draw-record"),
                {
                    type: "draw-record",
                    giveawayNo: 3,
                    winnerIds: [],
                    entrants: 0,
                    capped: false,
                },
            )
        }),
    )
})

test("A deleted card ends the draw, a refused read tries again later with a note, and neither records winners", async () => {
    for (const [response, expected] of [
        [
            { status: 404, body: { code: "UNKNOWN_MESSAGE", message: "Synthetic" } },
            { type: "draw-gone", giveawayNo: 3, reason: "card" },
        ],
        [
            { status: 404, body: { code: "UNKNOWN_CHANNEL", message: "Synthetic" } },
            { type: "draw-gone", giveawayNo: 3, reason: "channel" },
        ],
        [
            { status: 403, body: { code: "MISSING_PERMISSIONS", message: "Synthetic" } },
            { type: "defer", giveawayNo: 3, problem: "permission" },
        ],
        [
            { status: 400, body: { message: "Synthetic" } },
            { type: "defer", giveawayNo: 3 },
        ],
    ] as const) {
        await controlled(
            Effect.gen(function* () {
                const { bot, f } = yield* worker()
                const s = workStore({
                    "draw-claim": {
                        type: "draw",
                        giveaway: giveaway({ channelId: f.ids.channel }),
                        count: 1,
                        excludeIds: [],
                    },
                })
                usersRoute(bot, response)
                yield* processGiveaway(s.store, publishingBoundary().store, f.ids.guild, bot.client, {
                    giveawayNo: 3,
                    channelId: f.ids.channel,
                    action: "draw",
                })
                assert.deepEqual(s.operations, [{ type: "draw-claim", giveawayNo: 3 }, expected])
            }),
        )
    }
})

test("A draw another pass took does nothing", async () => {
    await controlled(
        Effect.gen(function* () {
            const { bot, f } = yield* worker()
            const s = workStore({ "draw-claim": { type: "skipped" } })
            const reads = usersRoute(bot, page([]))
            yield* processGiveaway(s.store, publishingBoundary().store, f.ids.guild, bot.client, {
                giveawayNo: 3,
                channelId: f.ids.channel,
                action: "draw",
            })
            assert.equal(reads.requests().length, 0)
            assert.deepEqual(
                s.operations.map((op) => op.type),
                ["draw-claim"],
            )
        }),
    )
})

const ended = (channelId: string) =>
    giveaway({
        channelId,
        state: "ended",
        phase: "announcing",
        endedAt: now,
        winners: [
            { userId: "71", drawNo: 1, dm: "sending" },
            { userId: "72", drawNo: 1, dm: "sending" },
        ],
    })

test("The result edits the card with no ping, each winner gets a DM, and a failed DM stops nothing", async () => {
    await controlled(
        Effect.gen(function* () {
            const { bot, f, p } = yield* worker()
            const claim = ended(f.ids.channel)
            const s = workStore({ "announce-claim": { type: "announce", giveaway: claim, winnerIds: ["71", "72"] } })
            const edits = bot.rest.respond(`PATCH /channels/${f.ids.channel}/messages/${CARD}`, {
                body: f.message({ id: CARD, channel_id: f.ids.channel, author: f.botUser() }),
            })
            bot.rest.respond("POST /users/@me/channels", (request) =>
                (request.body as { recipient_id: string }).recipient_id === "71"
                    ? { status: 403, body: { code: "CANNOT_SEND_MESSAGES_TO_USER", message: "Synthetic refusal" } }
                    : { body: { id: p.dmId, type: 1, recipients: [f.user({ id: "72" })], last_message_id: null } },
            )
            yield* processGiveaway(s.store, publishingBoundary().store, f.ids.guild, bot.client, {
                giveawayNo: 3,
                channelId: f.ids.channel,
                action: "announce",
            })
            const body = edits.requests()[0]!.body as { content: string; allowed_mentions: unknown }
            assert.match(body.content, /Winners: <@71>, <@72>/)
            assert.deepEqual(body.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
            const dm = p.replies.requests().map(sent)
            assert.equal(dm.length, 1)
            assert.match(dm[0]!.content, /You won Game key in /)
            assert.deepEqual(s.operations.at(-1), {
                type: "announce-outcome",
                giveawayNo: 3,
                card: "sent",
                dms: [
                    { userId: "71", outcome: "failed" },
                    { userId: "72", outcome: "sent" },
                ],
            })
        }),
    )
})

test("An edit's outcome is reported as it is, and a card edit is sent once", async () => {
    for (const [response, card] of [
        [{ status: 404, body: { code: "UNKNOWN_MESSAGE", message: "Synthetic" } }, "gone"],
        [{ status: 403, body: { code: "MISSING_PERMISSIONS", message: "Synthetic" } }, "failed"],
        [{ status: 500, body: { message: "Synthetic" } }, "uncertain"],
    ] as const) {
        await controlled(
            Effect.gen(function* () {
                const { bot, f } = yield* worker()
                const claim = ended(f.ids.channel)
                const s = workStore({ "announce-claim": { type: "announce", giveaway: claim, winnerIds: [] } })
                const edits = bot.rest.respond(`PATCH /channels/${f.ids.channel}/messages/${CARD}`, response)
                yield* processGiveaway(s.store, publishingBoundary().store, f.ids.guild, bot.client, {
                    giveawayNo: 3,
                    channelId: f.ids.channel,
                    action: "announce",
                })
                assert.equal(edits.requests().length, 1)
                assert.deepEqual(s.operations.at(-1), { type: "announce-outcome", giveawayNo: 3, card, dms: [] })
            }),
        )
    }
})

test("A cancel edits the card once its claim is held", async () => {
    await controlled(
        Effect.gen(function* () {
            const { bot, f } = yield* worker()
            const claim = giveaway({ channelId: f.ids.channel, state: "cancelled", phase: "cancelling" })
            const s = workStore({ "cancel-claim": { type: "cancel", giveaway: claim } })
            const edits = bot.rest.respond(`PATCH /channels/${f.ids.channel}/messages/${CARD}`, {
                body: f.message({ id: CARD, channel_id: f.ids.channel, author: f.botUser() }),
            })
            yield* processGiveaway(s.store, publishingBoundary().store, f.ids.guild, bot.client, {
                giveawayNo: 3,
                channelId: f.ids.channel,
                action: "cancel",
            })
            assert.match((edits.requests()[0]!.body as { content: string }).content, /cancelled: Game key/)
            assert.deepEqual(s.operations.at(-1), { type: "cancel-outcome", giveawayNo: 3, card: "sent" })
        }),
    )
})
