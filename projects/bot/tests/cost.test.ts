// Request cost of one ordinary event with every feature configured but nothing to do. Each scenario boots the real bot
// options against the SDK's in-memory Fluxer with counting backend fakes, then counts what one event adds. The expected
// numbers document the current cost, so a change that makes an event more or less expensive updates them on purpose
import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Exit, Logger, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBackendRequest } from "../src/backend-http.ts"
import { createBotOptions, type BotStores } from "../src/bot.ts"
import { fakeClient, quietSignal } from "./backend-fake.ts"
import { observeCosts, readCosts, startCostSummary } from "../src/costs.ts"
import { boundary, token } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { rolesBoundary } from "./roles-fixture.ts"
import { nativeRoles, savedPanel } from "./roles-native-fixture.ts"
import { greetingsBoundary } from "./welcome-fixture.ts"
import { ticketBoundary } from "./ticket-fixture.ts"
import { levelsBoundary } from "./level-fixture.ts"
import { eventsBoundary } from "./event-fixture.ts"
import { schedulesBoundary } from "./schedule-fixture.ts"
import { milestonesBoundary } from "./milestone-fixture.ts"

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const f = createFixtures()
const now = Date.parse("2026-01-01T00:01:00Z")
const noWork = { kinds: { dashboard: [], verification: [], events: [], schedules: [], milestones: [], suggestions: [], cleanup: [], metadata: [], levels: [] }, cursor: null, nextDueIn: null }
// The deployment's own requests: scope at startup, usage reports and the work dispatcher. Feature requests go to the counting adapters
let guardState: "normal" | "paused" = "normal"
const backend = { url: "https://synthetic-cost.invalid", secret: Redacted.make("synthetic-cost-secret-for-test-only"), client: fakeClient(call => {
    if (call.path === "/service/scope") return { mode: "single", serverIds: [f.ids.guild] }
    if (call.path === "/service/work") return noWork
    if (call.path === "/service/usage") return { month: "2026-01", calls: guardState === "paused" ? 900 : 1, budget: 1000, state: guardState, warn: false }
    throw new Error(`Unexpected backend request ${call.path}`)
}, quietSignal) }

// Counts every method call of a backend adapter
function counted<T extends object>(name: string, store: T, calls: string[]): T {
    return new Proxy(store, { get: (target, key) => {
        const value: unknown = Reflect.get(target, key)
        return typeof value === "function" ? (...args: unknown[]) => { calls.push(`${name}.${String(key)}`); return value.apply(target, args) } : value
    } })
}
// A backend adapter that answers only the named operations. Any other call is a defect, so an unexpected request fails the test
function fake<T extends object>(name: string, answers: Record<string, (input: never) => unknown>): T {
    return new Proxy({}, { get: (_, key) => {
        const answer = answers[String(key)]
        return (input: never) => answer ? Effect.sync(() => answer(input)) : Effect.die(`${name}.${String(key)} was not expected`)
    } }) as T
}

// Every feature is configured: Automod, join protection, role panels with advanced verification, leveling, analytics and
// the background workers. None of them has anything to do for the measured events
function idleStores(calls: string[]) {
    const publishing = publishingBoundary(), roles = rolesBoundary(publishing.store), moderation = boundary()
    Object.assign(moderation.current, { automodEnabled: true, securityEnabled: true, joinEnabled: true })
    Object.assign(roles.current, { panelsEnabled: true, verificationEnabled: true, advancedVerificationEnabled: true })
    const stores: BotStores = {
        moderation: moderation.store, publishing: publishing.store, roles: roles.store, greetings: greetingsBoundary().store, tickets: ticketBoundary().store,
        leveling: levelsBoundary().store, events: eventsBoundary().store, schedules: schedulesBoundary().store, milestones: milestonesBoundary().store,
        afk: fake("afk", { observe: () => ({ cleared: false, statuses: [] }) }),
        responses: fake("responses", { evaluate: () => ({ send: false }) }),
        general: fake("general", { get: () => ({ prefix: "!", revision: 1 }) }),
        analytics: fake("analytics", { settings: () => ({ enabled: true }), record: () => ({ enabled: true, recorded: true }) }),
        metadata: fake("metadata", { admit: () => ({ admitted: false, duplicate: false, reason: "disabled" }) }),
        cleanup: fake("cleanup", {}), suggestions: fake("suggestions", {}), backup: fake("backup", {}), rolePicker: fake("rolePicker", {}),
        voice: fake("voice", { query: () => ({ type: "state", generators: [], rooms: [] }) }),
        verification: fake("verification", { ready: () => ({ requests: [] }) }),
        // Sticky messages load once at startup, so a message in a channel without one costs nothing more
        sticky: fake("sticky", { list: () => ({ stickies: [] }) }), sidebar: fake("sidebar", {}), memberList: fake("memberList", {}),
        // Security alert settings load once at startup too, so with every alert off events cost nothing more
        alerts: fake("alerts", { get: () => ({ settings: { invites: false, bots: false, webhooks: false, privileges: false, impersonation: false, expectedBotIds: [], expectedWebhookIds: [] } }) }),
        // Help desk settings load once at startup, so a message costs nothing more
        helpDesk: fake("helpDesk", { get: () => ({ settings: { forumIds: [], greeting: null, solvedTag: "Solved", nudgeHours: 24, guardChannelId: null, autoArchive: false, revision: 0 } }) }),
        // The newcomer checklist is read on a server's first member update and kept for ten minutes. A member without a role of every step costs nothing more
        onboarding: fake("onboarding", { get: () => ({ revision: 1, settings: { enabled: true, delivery: "welcome", steps: [{ type: "rules" }], completionRoleId: null }, roleSteps: [["1"]] }) }),
        presets: fake("presets", {}),
    }
    const wrapped = Object.fromEntries(Object.entries(stores).map(([name, store]) => [name, counted(name, store as object, calls)])) as BotStores
    return { stores: wrapped, roles, moderation }
}

interface Measured {
    readonly fluxer: number
    readonly backend: number
    /** One when Fluxer sends the dispatch and the SDK decodes it, zero when the session asked Fluxer to suppress it */
    readonly delivered: number
}

// Boots the bot, lets startup settle, prepares the scenario, then counts what the measured event adds
function measure(t: TestContext, scenario: (bot: Bot, native: ReturnType<typeof nativeRoles>, panels: { reaction: string, verification: string }, moderation: ReturnType<typeof boundary>) => {
    readonly prepare?: Effect.Effect<void, unknown>
    readonly event: readonly [string, unknown]
}) {
    return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const calls: string[] = [], { stores, roles, moderation } = idleStores(calls)
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild, backend, websiteUrl: "https://synthetic-cost.invalid" }, stores))
        // Any member or account read answers with a present human, and specific fixtures registered later take precedence
        bot.rest.respond("GET /guilds/:id/members/:id", request => ({ body: bot.fixtures.member({ user: bot.fixtures.user({ id: request.path.split("/").at(-1)! }), joined_at: new Date(now).toISOString(), communication_disabled_until: null }) }))
        bot.rest.respond("GET /users/:id", request => ({ body: bot.fixtures.user({ id: request.path.split("/").at(-1)! }) }))
        const native = nativeRoles(bot)
        bot.rest.respond(request => new URL(request.url).pathname.endsWith("/users"), { body: { items: [{ id: native.targetId, username: "Synthetic reactor" }], has_more: false, next_after: null } })
        const reaction = savedPanel(bot, native, roles), verification = savedPanel(bot, native, roles, "verification")
        const { prepare, event } = scenario(bot, native, { reaction: reaction.published!.messageId, verification: verification.published!.messageId }, moderation)
        yield* bot.ready()
        yield* settle(bot)
        if (prepare) { yield* prepare; yield* settle(bot) }
        const restBefore = bot.requests().length, backendBefore = calls.length, costsBefore = readCosts()
        const emitted = yield* Effect.exit(bot.emit(event[0], event[1]))
        yield* settle(bot)
        const rest = bot.requests().slice(restBefore).map(request => `${request.method} ${request.path}`), backendCalls = calls.slice(backendBefore)
        // The production accounting sees the same Fluxer requests and no extra backend transport requests
        assert.equal(readCosts().fluxerRequests - costsBefore.fluxerRequests, rest.length)
        assert.equal(readCosts().backendRequests - costsBefore.backendRequests, 0)
        assert.equal(bot.failures().length, 0)
        return { measured: { fluxer: rest.length, backend: backendCalls.length, delivered: Exit.isSuccess(emitted) ? 1 : 0 } satisfies Measured, rest, backendCalls }
    })).pipe(Effect.provide(TestClock.layer())))
}

// Handlers and the workers they wake finish in-memory work without the clock, so repeated idle checks drain them
const settle = (bot: Bot) => Effect.gen(function* () {
    for (let round = 0; round < 3; round++) {
        yield* bot.idle()
        for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow
    }
})

const reactionAdd = (messageId: string, userId: string, emoji = "✅") => ["MESSAGE_REACTION_ADD", { guild_id: f.ids.guild, channel_id: f.ids.channel, message_id: messageId, user_id: userId, emoji: { name: emoji } }] as const
const warmUp = (bot: Bot, userId: string) => { const [type, payload] = reactionAdd(bot.fixtures.nextId(), userId, "👋"); return bot.emit(type, payload) }
const linkMessage = (bot: Bot) => bot.fixtures.message({ id: "1767225600123456789", content: "Release notes https://example.invalid/notes", timestamp: new Date(now).toISOString() })
const ordinary = (bot: Bot, content = "Hello everyone", authorId?: string) =>
    bot.fixtures.message({ content, timestamp: new Date(now).toISOString(), ...(authorId ? { author: bot.fixtures.user({ id: authorId }) } : {}) })

const scenarios: Record<string, { expected: Measured, run: (t: TestContext) => ReturnType<typeof measure> }> = {
    // The server's first message reads what evaluation needs: the server, its roles, the bot's member, the channel and the author
    "the first ordinary message after startup, with no matching response": {
        expected: { fluxer: 5, backend: 5, delivered: 1 },
        run: t => measure(t, bot => ({ event: ["MESSAGE_CREATE", ordinary(bot)] })),
    },
    // Later messages are evaluated from the bot's cached copies, which gateway events keep current
    "an ordinary message in a warm server, with no matching response": {
        expected: { fluxer: 0, backend: 5, delivered: 1 },
        run: t => measure(t, bot => ({ prepare: bot.emit("MESSAGE_CREATE", ordinary(bot)), event: ["MESSAGE_CREATE", ordinary(bot, "Hello again")] })),
    },
    // An action still reads the server, its roles, both members and the channel from Fluxer before it deletes
    "a message automod deletes in a warm server": {
        expected: { fluxer: 6, backend: 5, delivered: 1 },
        run: t => measure(t, (bot, native, _, moderation) => {
            const spam = ordinary(bot, "Synthetic spam", native.targetId)
            moderation.store.evaluate = input => Effect.succeed(input.messageId !== spam.id ? { duplicate: false, blocked: false } : { duplicate: false, blocked: true,
                grant: { actionId: "synthetic_cost_action", caseNo: 1, sourceId: spam.id, action: "delete", targetId: native.targetId, channelId: f.ids.channel, messageIds: [spam.id], reason: "Synthetic match" } })
            bot.rest.respond("DELETE /channels/:id/messages/:id", { status: 204 })
            return { prepare: bot.emit("MESSAGE_CREATE", ordinary(bot, "Hello everyone", native.targetId)), event: ["MESSAGE_CREATE", spam] }
        }),
    },
    // The startup usage report answers paused, so AFK, custom responses, leveling and analytics skip the message while moderation runs
    "an ordinary message while the bill guard pauses optional work": {
        expected: { fluxer: 5, backend: 2, delivered: 1 },
        run: t => {
            guardState = "paused"
            return measure(t, bot => ({ event: ["MESSAGE_CREATE", bot.fixtures.message({ content: "Hello everyone", timestamp: new Date(now).toISOString() })] }))
                .finally(() => { guardState = "normal" })
        },
    },
    // Reaction scenarios measure the steady state after the server's first reaction
    "a reaction on a message that is not a panel": {
        expected: { fluxer: 0, backend: 0, delivered: 1 },
        run: t => measure(t, (bot, native) => ({ prepare: warmUp(bot, native.targetId), event: reactionAdd(bot.fixtures.nextId(), native.targetId, "👍") })),
    },
    // The reaction is evaluated from cached copies. The role grant and the evaluation after it read Fluxer
    "a reaction on a role panel": {
        expected: { fluxer: 10, backend: 10, delivered: 1 },
        run: t => measure(t, (bot, native, panels) => ({ prepare: warmUp(bot, native.targetId), event: reactionAdd(panels.reaction, native.targetId) })),
    },
    // Join protection takes the new member from the event. Greetings and autorole read Fluxer
    "a member join": {
        expected: { fluxer: 12, backend: 10, delivered: 1 },
        run: t => measure(t, bot => {
            const userId = bot.fixtures.nextId()
            return { event: ["GUILD_MEMBER_ADD", { ...bot.fixtures.member({ user: bot.fixtures.user({ id: userId }), joined_at: new Date(now).toISOString() }), guild_id: f.ids.guild }] }
        }),
    },
    "a member leave": {
        expected: { fluxer: 3, backend: 7, delivered: 1 },
        run: t => measure(t, bot => ({ event: ["GUILD_MEMBER_REMOVE", { guild_id: f.ids.guild, user: bot.fixtures.user({ id: bot.fixtures.nextId() }) }] })),
    },
    "a member update": {
        expected: { fluxer: 0, backend: 5, delivered: 1 },
        run: t => measure(t, (bot, native) => ({ event: ["GUILD_MEMBER_UPDATE", { ...bot.fixtures.member({ user: bot.fixtures.user({ id: native.targetId }), roles: [native.role.id] }), guild_id: f.ids.guild }] })),
    },
    // Only metadata logs admit the entry. Privilege alerts are off, so the security check adds nothing
    "an audit entry while every security alert is off": {
        expected: { fluxer: 0, backend: 1, delivered: 1 },
        run: t => measure(t, (bot, native) => ({ event: ["GUILD_AUDIT_LOG_ENTRY_CREATE", { guild_id: f.ids.guild, id: bot.fixtures.nextId(), action_type: 31, user_id: f.ids.user, target_id: native.role.id,
            changes: [{ key: "permissions", old_value: "0", new_value: "8" }] }] })),
    },
    "a new invite while invite logs are off": {
        expected: { fluxer: 0, backend: 0, delivered: 1 },
        run: t => measure(t, bot => ({ event: ["INVITE_CREATE", { code: "SyntheticCostInvite", type: 0, channel: { id: f.ids.channel, type: 0 }, guild: { id: f.ids.guild, name: "Synthetic server" },
            presence_count: 1, member_count: 2, temporary: false, inviter: bot.fixtures.user(), created_at: new Date(now).toISOString(), uses: 0, max_uses: 0, max_age: 0, expires_at: null }] })),
    },
    "a typing notice": {
        expected: { fluxer: 0, backend: 0, delivered: 0 },
        run: t => measure(t, () => ({ event: ["TYPING_START", { guild_id: f.ids.guild, channel_id: f.ids.channel, user_id: f.ids.user, timestamp: Math.floor(now / 1000) }] })),
    },
    "a message edit that only adds a link preview": {
        expected: { fluxer: 0, backend: 0, delivered: 1 },
        run: t => measure(t, bot => {
            const created = linkMessage(bot)
            return { prepare: bot.emit("MESSAGE_CREATE", created),
                event: ["MESSAGE_UPDATE", { ...created, embeds: [{ type: "link", url: "https://example.invalid/notes", title: "Release notes" }] }] }
        }),
    },
    // The message's creation already read what evaluating the edit needs
    "a text edit": {
        expected: { fluxer: 0, backend: 3, delivered: 1 },
        run: t => measure(t, bot => {
            const created = linkMessage(bot)
            return { prepare: bot.emit("MESSAGE_CREATE", created),
                event: ["MESSAGE_UPDATE", { ...created, content: "Release notes, corrected", edited_timestamp: new Date(now).toISOString() }] }
        }),
    },
}

test("the summary logs each ten-minute change in totals and stays quiet without activity", async t => {
    const messages: unknown[] = []
    const dropped = { overflow: 0, malformed: 0, collector: 0, closed: 0 }
    const client = { diagnostics: () => ({ counters: { eventsDropped: dropped } }) } as unknown as Parameters<typeof startCostSummary>[0]
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* startCostSummary(client)
        yield* TestClock.adjust("10 minutes")
        assert.deepEqual(messages, [])
        observeCosts({ type: "rest", method: "GET", route: "/guilds/:id", status: 200, durationMs: 3, attempt: 1 })
        observeCosts({ type: "rest", method: "GET", route: "/guilds/:id", status: 429, durationMs: 3, attempt: 2 })
        observeCosts({ type: "rateLimit", method: "GET", route: "/guilds/:id", waitMs: 250, global: false })
        observeCosts({ type: "handler", event: "messageCreate", subscriptionId: "messageCreate#1", shardId: 0, durationMs: 1, outcome: "success" })
        yield* createBackendRequest(backend)("/service/scope", {})
        dropped.overflow++
        yield* TestClock.adjust("10 minutes")
        assert.deepEqual(messages, ["Costs in the last 10 minutes: 2 Fluxer requests, 1 backend requests, 1 events, 1 rate-limit waits and 1 dropped events"])
        yield* TestClock.adjust("10 minutes")
        assert.equal(messages.length, 1)
    })).pipe(Effect.provide(Logger.layer([Logger.make(({ message }) => { messages.push(Array.isArray(message) ? message[0] : message) })])), Effect.provide(TestClock.layer())))
    const totals = readCosts()
    assert.equal(totals.fluxerRoutes["GET /guilds/:id"]! >= 2, true)
    assert.equal(totals.backendPaths["/service/scope"]! >= 1, true)
    assert.equal(totals.eventCounts.messageCreate! >= 1, true)
})

for (const [name, scenario] of Object.entries(scenarios)) {
    test(`cost of ${name}`, async t => {
        const { measured, rest, backendCalls } = await scenario.run(t)
        const breakdown = `Fluxer: ${rest.join(", ") || "none"}. Backend: ${backendCalls.join(", ") || "none"}`
        t.diagnostic(breakdown)
        assert.deepEqual(measured, scenario.expected, breakdown)
    })
}
