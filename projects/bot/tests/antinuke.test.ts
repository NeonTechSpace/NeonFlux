import assert from "node:assert/strict"
import test from "node:test"
import { defaultAntiNukeSettings, type AntiNukeIncident, type AntiNukeSettings } from "@neonflux/contracts/anti-nuke"
import { Permissions, snowflakes } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { antiNukeCritical, parseAntiNukeCommand } from "../src/antinuke-command.ts"
import {
    AntiNukeHandlingError,
    antiNukeCard,
    incidentCard,
    prepareAntiNukeDashboardJob,
    restoreReply,
} from "../src/antinuke-management.ts"
import type { AntiNukeStore } from "../src/antinuke-store.ts"
import type { LockdownStore } from "../src/lockdown-store.ts"
import { antiNukeRuleText, createAntiNuke, restoreIncidentRoles } from "../src/antinuke-worker.ts"
import { antiNukeFedAction } from "../src/moderation.ts"
import { renderText } from "../src/reply-style.ts"
import { platform } from "./moderation-fixture.ts"

const now = Date.parse("2026-10-01T00:00:00Z"),
    f0 = "4000"
const controlled = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) =>
    Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))
type Bot = Effect.Success<ReturnType<typeof createTestBot>>
type Route = ReturnType<Bot["rest"]["respond"]>

function fakeStore(settings: Partial<AntiNukeSettings>) {
    const calls: { method: string; input: unknown }[] = []
    let current: AntiNukeSettings = { ...defaultAntiNukeSettings(), enabled: true, ...settings }
    let number = 0
    const note = (method: string, input: unknown) => calls.push({ method, input })
    const store: AntiNukeStore = {
        get: () => Effect.succeed({ settings: current }),
        manage: (input) =>
            Effect.sync(() => {
                note("manage", input.operation)
                if (input.operation.type === "mode") current = { ...current, mode: input.operation.mode }
                return { settings: current }
            }),
        open: (input) =>
            Effect.sync(() => {
                note("open", input)
                number++
                return {
                    claimed: true as const,
                    incidentNo: number,
                    act: current.mode === "enforce" && input.response !== "alert",
                    lockdown: current.mode === "enforce" && current.lockdown,
                }
            }),
        finish: (input) =>
            Effect.sync(() => {
                note("finish", input)
                return { recorded: true, admitted: false }
            }),
        observe: () => Effect.succeed({ uncertain: 0, admitted: false }),
        incidents: (input) =>
            Effect.sync(() => {
                note("incidents", input.query)
                return { incidents: [], more: false }
            }),
    }
    return { store, calls, settings: () => current }
}
// What one account did, as Fluxer reports it in audit entries
const ban = (bot: Bot, userId: string) =>
    bot.emit("GUILD_AUDIT_LOG_ENTRY_CREATE", {
        guild_id: bot.fixtures.ids.guild,
        id: bot.fixtures.nextId(),
        action_type: 22,
        user_id: userId,
        target_id: bot.fixtures.nextId(),
        changes: [],
    })
const burst = (bot: Bot, userId: string, count = 10) =>
    Effect.gen(function* () {
        for (let index = 0; index < count; index++) yield* ban(bot, userId)
        yield* bot.idle()
    })
function start(
    settings: Partial<AntiNukeSettings>,
    run: (f: {
        bot: Bot
        p: ReturnType<typeof platform>
        store: ReturnType<typeof fakeStore>
        setRoles: Route
        kicks: Route
        bans: Route
    }) => Effect.Effect<void, unknown, Scope.Scope>,
    options: { targetIsBot?: boolean; targetPermissions?: bigint; botPermissions?: bigint } = {},
) {
    const f = createFixtures(),
        store = fakeStore(settings)
    return controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot(
                createBotOptions(
                    { token: Redacted.make("synthetic-anti-nuke-token"), serverId: f.ids.guild },
                    { antiNuke: store.store },
                ),
            )
            const p = platform(bot, {
                actorOwner: false,
                botPermissions: options.botPermissions ?? Permissions.Administrator,
                targetPermissions: options.targetPermissions ?? Permissions.BanMembers,
                ...(options.targetIsBot ? { targetIsBot: true } : {}),
            })
            bot.rest.respond(`GET /users/${p.targetId}`, {
                body: bot.fixtures.user({ id: p.targetId, ...(options.targetIsBot ? { bot: true } : {}) }),
            })
            const setRoles = bot.rest.respond("PATCH /guilds/:id/members/:id", (request) => ({
                body: bot.fixtures.member({
                    user: bot.fixtures.user({ id: request.path.split("/").at(-1)! }),
                    roles: [],
                    communication_disabled_until: null,
                }),
            }))
            const kicks = bot.rest.respond("DELETE /guilds/:id/members/:id", { status: 204 }),
                bans = bot.rest.respond("PUT /guilds/:id/bans/:id", { status: 204 })
            yield* bot.ready()
            yield* bot.idle()
            yield* run({ bot, p, store, setRoles, kicks, bans })
        }),
    )
}
const opened = (store: ReturnType<typeof fakeStore>) =>
    store.calls.filter((call) => call.method === "open").map((call) => call.input as Record<string, unknown>)
const finished = (store: ReturnType<typeof fakeStore>) =>
    store.calls.filter((call) => call.method === "finish").map((call) => call.input as Record<string, unknown>)

test("The grammar reads each form within its bounds, and turning protection down is critical", () => {
    assert.deepEqual(parseAntiNukeCommand([]), { type: "status" })
    assert.deepEqual(parseAntiNukeCommand(["module", "on"]), { type: "module", enabled: true })
    assert.deepEqual(parseAntiNukeCommand(["mode", "enforce"]), { type: "mode", mode: "enforce" })
    assert.deepEqual(parseAntiNukeCommand(["limit", "bans", "6", "20"]), {
        type: "limit",
        limit: "bans",
        value: { count: 6, seconds: 20 },
    })
    assert.match((parseAntiNukeCommand(["limit", "bans", "1", "20"]) as { error: string }).error, /A limit is 2 to 100/)
    assert.deepEqual(parseAntiNukeCommand(["response", "ban"]), { type: "response", response: "ban" })
    assert.deepEqual(parseAntiNukeCommand(["trust", "add", "<@55>"]), { type: "trust", userId: "55", trusted: true })
    assert.deepEqual(parseAntiNukeCommand(["incidents", "next"]), { type: "incidents", next: true })
    assert.deepEqual(parseAntiNukeCommand(["incident", "4"]), { type: "incident", incidentNo: 4 })
    assert.deepEqual(parseAntiNukeCommand(["restore", "<@55>"]), { type: "restore", userId: "55" })
    assert.ok("error" in parseAntiNukeCommand(["mode", "maybe"]))
    assert.equal(antiNukeCritical({ type: "module", enabled: false }), true)
    assert.equal(antiNukeCritical({ type: "module", enabled: true }), false)
    assert.equal(antiNukeCritical({ type: "mode", mode: "dry-run" }), true)
    assert.equal(antiNukeCritical({ type: "mode", mode: "enforce" }), false)
    assert.equal(antiNukeCritical({ type: "restore", userId: "1" }), true)
})

test("Dry-run records and alerts only, with no native call", () =>
    start({ mode: "dry-run" }, ({ bot, p, store, setRoles, kicks }) =>
        Effect.gen(function* () {
            yield* burst(bot, p.targetId)
            assert.equal(opened(store).length, 1)
            assert.equal(opened(store)[0]!.rule, "bans")
            assert.deepEqual(finished(store), [
                { serverId: bot.fixtures.ids.guild, incidentNo: 1, outcome: "alert", lockdown: "none" },
            ])
            assert.equal(setRoles.requests().length, 0)
            assert.equal(kicks.requests().length, 0)
        }),
    ))

test("Enforce strips the roles with dangerous permissions once, with the same account's later entries quiet", () =>
    start({ mode: "enforce" }, ({ bot, p, store, setRoles }) =>
        Effect.gen(function* () {
            yield* burst(bot, p.targetId, 25)
            assert.equal(opened(store).length, 1)
            assert.deepEqual(opened(store)[0]!.removedRoleIds, [p.targetRole.id])
            assert.equal(opened(store)[0]!.actorKind, "staff")
            assert.equal(setRoles.requests().length, 1)
            assert.deepEqual((setRoles.requests()[0]!.body as { roles: string[] }).roles, [])
            assert.equal(finished(store)[0]!.outcome, "succeeded")
        }),
    ))

test("A bot with no role to strip is kicked, and the kick and ban responses do what they say", async () => {
    await start(
        { mode: "enforce" },
        ({ bot, p, store, setRoles, kicks }) =>
            Effect.gen(function* () {
                yield* burst(bot, p.targetId)
                assert.equal(setRoles.requests().length, 0)
                assert.equal(kicks.requests().length, 1)
                assert.equal(opened(store)[0]!.actorKind, "bot")
                assert.equal(opened(store)[0]!.response, "kick")
                assert.equal(finished(store)[0]!.outcome, "succeeded")
            }),
        { targetIsBot: true, targetPermissions: 0n },
    )
    await start({ mode: "enforce", response: "ban" }, ({ bot, p, bans, setRoles }) =>
        Effect.gen(function* () {
            yield* burst(bot, p.targetId)
            assert.equal(bans.requests().length, 1)
            assert.equal(setRoles.requests().length, 0)
        }),
    )
    await start({ mode: "enforce", response: "kick" }, ({ bot, p, kicks }) =>
        Effect.gen(function* () {
            yield* burst(bot, p.targetId)
            assert.equal(kicks.requests().length, 1)
        }),
    )
})

test("The owner, a trusted account and anyone ranked at or above NeonFlux only alert, and NeonFlux itself never counts", async () => {
    await start({ mode: "enforce" }, ({ bot, store, setRoles }) =>
        Effect.gen(function* () {
            yield* burst(bot, bot.fixtures.ids.bot)
            assert.equal(opened(store).length, 0)
            assert.equal(setRoles.requests().length, 0)
        }),
    )
    const trusted = "4242"
    await start({ mode: "enforce", trustedIds: [trusted] }, ({ bot, p, store, setRoles }) =>
        Effect.gen(function* () {
            bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${trusted}`, {
                body: bot.fixtures.member({
                    user: bot.fixtures.user({ id: trusted }),
                    roles: [p.targetRole.id],
                    communication_disabled_until: null,
                }),
            })
            bot.rest.respond(`GET /users/${trusted}`, { body: bot.fixtures.user({ id: trusted }) })
            yield* burst(bot, trusted)
            assert.equal(opened(store)[0]!.actorKind, "trusted")
            assert.equal(opened(store)[0]!.response, "alert")
            assert.equal(finished(store)[0]!.outcome, "alert")
            assert.equal(setRoles.requests().length, 0)
        }),
    )
    // The actor's role outranks NeonFlux's here, so it can only be reported
    await start({ mode: "enforce", lockdown: true }, ({ bot, p, store, setRoles }) =>
        Effect.gen(function* () {
            const above = bot.fixtures.role({ position: 30, permissions: Permissions.Administrator.toString() })
            bot.rest.respond("GET /guilds/:id/roles", { body: [...p.roles, above] })
            bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${p.targetId}`, {
                body: bot.fixtures.member({
                    user: bot.fixtures.user({ id: p.targetId }),
                    roles: [above.id],
                    communication_disabled_until: null,
                }),
            })
            yield* burst(bot, p.targetId)
            assert.equal(opened(store)[0]!.actorKind, "high")
            assert.equal(opened(store)[0]!.response, "alert")
            assert.equal(setRoles.requests().length, 0)
            // No lockdown runtime runs in this test, and an allowed lockdown that cannot start says so
            assert.equal(finished(store)[0]!.lockdown, "not-allowed")
        }),
    )
})

test("A refused write fails, an unknown one stays uncertain, and neither is sent again", async () => {
    for (const [status, outcome] of [
        [403, "failed"],
        [500, "uncertain"],
    ] as const)
        await start({ mode: "enforce" }, ({ bot, p, store }) =>
            Effect.gen(function* () {
                const refused = bot.rest.respond("PATCH /guilds/:id/members/:id", { status })
                yield* burst(bot, p.targetId, 20)
                assert.equal(refused.requests().length, 1)
                assert.equal(finished(store)[0]!.outcome, outcome)
            }),
        )
    // Without the permission no call is made at all
    await start(
        { mode: "enforce" },
        ({ bot, p, store, setRoles }) =>
            Effect.gen(function* () {
                yield* burst(bot, p.targetId)
                assert.equal(setRoles.requests().length, 0)
                assert.equal(finished(store)[0]!.outcome, "failed")
            }),
        { botPermissions: Permissions.ViewAuditLog },
    )
})

test("Audit entries that are harmless or from a server with the module off cost no backend call", async () => {
    await start({ enabled: false }, ({ bot, p, store }) =>
        Effect.gen(function* () {
            yield* burst(bot, p.targetId, 30)
            assert.equal(store.calls.length, 0)
        }),
    )
    await start({ mode: "enforce" }, ({ bot, p, store }) =>
        Effect.gen(function* () {
            yield* burst(bot, p.targetId, 5)
            assert.equal(store.calls.length, 0)
        }),
    )
})

test("Another feature can feed what a member did through NeonFlux", async () => {
    const f = createFixtures(),
        store = fakeStore({ mode: "dry-run" })
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot(
                createBotOptions({ token: Redacted.make("synthetic-anti-nuke-token"), serverId: f.ids.guild }, {}),
            )
            const p = platform(bot, { actorOwner: false })
            bot.rest.respond(`GET /users/${p.targetId}`, { body: bot.fixtures.user({ id: p.targetId }) })
            yield* bot.ready()
            const runtime = createAntiNuke(store.store, f.ids.guild, () => Effect.void)
            yield* runtime.start()
            yield* TestClock.adjust("1 millis")
            yield* Effect.yieldNow
            yield* runtime.reload()
            for (let index = 0; index < 10; index++) yield* runtime.observeBotAction(p.targetId, "ban", bot.client)
            assert.equal(opened(store).length, 1)
        }),
    )
})

test("Status, an incident and turning enforcement on read short, and a member gets no access", async () => {
    const incident: AntiNukeIncident = {
        incidentNo: 3,
        actorId: "55",
        actorKind: "staff",
        rule: "channels",
        counts: { "channel-delete": 6, ban: 2 },
        firstAt: now - 5000,
        lastAt: now,
        mode: "enforce",
        response: "strip",
        outcome: "uncertain",
        removedRoleIds: ["70", "71"],
        lockdown: "started",
        createdAt: now,
    }
    const card = incidentCard(incident, "!")
    assert.ok(card.fields!.length <= 8)
    assert.equal(renderText(card).length, 1)
    assert.match(card.note!, /!antinuke restore <@55>/)
    assert.deepEqual(card.fields!.find(([name]) => name === "Observed")![1], "6 channel-delete, 2 ban")
    assert.deepEqual(card.fields!.find(([name]) => name === "Response")![1], "Remove 2 roles: Not confirmed")
    const status = antiNukeCard({ ...defaultAntiNukeSettings(), enabled: true }, "!")
    assert.match(status.description!, /dry-run/)
    assert.match(status.note!, /cannot stop the owner or anyone ranked above NeonFlux/)
    await start({ mode: "dry-run" }, ({ bot, p, store }) =>
        Effect.gen(function* () {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!antinuke mode enforce" }))
            yield* bot.idle()
            assert.equal(store.settings().mode, "enforce")
            assert.match(
                String((p.replies.requests().at(-1)!.body as { content: string }).content),
                /It cannot stop the owner or anyone ranked above NeonFlux/,
            )
        }),
    )
    const f = createFixtures(),
        store = fakeStore({})
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot(
                createBotOptions(
                    { token: Redacted.make("synthetic-anti-nuke-token"), serverId: f.ids.guild },
                    { antiNuke: store.store },
                ),
            )
            const p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ManageGuild })
            yield* bot.ready()
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!antinuke module off" }))
            yield* bot.idle()
            assert.equal(store.calls.length, 0)
            assert.match(
                String((p.replies.requests().at(-1)!.body as { content: string }).content),
                /Only the server owner or an Administrator/,
            )
        }),
    )
})

test("One account above NeonFlux or two at once start the lockdown where allowed, and a dry run never does", async () => {
    const f = createFixtures()
    const auto: unknown[] = []
    const lockdownStore: LockdownStore = {
        get: () => Effect.die("Unexpected read"),
        manage: () => Effect.die("Unexpected change"),
        auto: (input) =>
            Effect.sync(() => {
                auto.push(input.incidentNo)
                return { settings: { exemptChannelIds: [] }, lockdown: null, started: true }
            }),
        work: () => Effect.succeed({ rows: [], notes: [] }),
    }
    const scenario = (settings: Partial<AntiNukeSettings>, accounts: 1 | 2) =>
        Effect.gen(function* () {
            auto.length = 0
            const store = fakeStore(settings)
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot(
                createBotOptions(
                    { token: Redacted.make("synthetic-anti-nuke-token"), serverId: f.ids.guild },
                    { antiNuke: store.store, lockdown: lockdownStore },
                ),
            )
            const p = platform(bot, { actorOwner: false, targetPermissions: Permissions.BanMembers })
            const second = "4243"
            for (const id of [p.targetId, second])
                bot.rest.respond(`GET /users/${id}`, { body: bot.fixtures.user({ id }) })
            bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${second}`, {
                body: bot.fixtures.member({
                    user: bot.fixtures.user({ id: second }),
                    roles: [p.targetRole.id],
                    communication_disabled_until: null,
                }),
            })
            bot.rest.respond("PATCH /guilds/:id/members/:id", (request) => ({
                body: bot.fixtures.member({
                    user: bot.fixtures.user({ id: request.path.split("/").at(-1)! }),
                    roles: [],
                    communication_disabled_until: null,
                }),
            }))
            bot.rest.respond("GET /guilds/:id/channels", { body: [] })
            yield* bot.ready()
            yield* bot.idle()
            yield* burst(bot, p.targetId)
            if (accounts === 2) yield* burst(bot, second)
            return { lockdown: finished(store).map((call) => call.lockdown), auto: [...auto] }
        })
    await controlled(
        Effect.gen(function* () {
            assert.deepEqual(yield* scenario({ mode: "enforce", lockdown: true }, 1), { lockdown: ["none"], auto: [] })
        }),
    )
    await controlled(
        Effect.gen(function* () {
            assert.deepEqual(yield* scenario({ mode: "enforce", lockdown: true }, 2), {
                lockdown: ["none", "started"],
                auto: [2],
            })
        }),
    )
    await controlled(
        Effect.gen(function* () {
            assert.deepEqual(yield* scenario({ mode: "enforce", lockdown: false }, 2), {
                lockdown: ["none", "not-allowed"],
                auto: [],
            })
        }),
    )
    await controlled(
        Effect.gen(function* () {
            assert.deepEqual(yield* scenario({ mode: "dry-run", lockdown: true }, 2), {
                lockdown: ["none", "not-allowed"],
                auto: [],
            })
        }),
    )
})

test("Anti-nuke counts what a member did through NeonFlux, for !mod bans as well as bot-only rights", () => {
    assert.equal(antiNukeFedAction({ action: "ban" }), "ban")
    assert.equal(antiNukeFedAction({ action: "kick" }), "kick")
    assert.equal(antiNukeFedAction({ action: "timeout" }), undefined)
    assert.equal(antiNukeFedAction({ action: "timeout", viaRight: "timeout" }), "restrict")
})

test("The owner beside a moderator strips nobody, and an alert costs NeonFlux nothing", () =>
    start({ mode: "enforce" }, ({ bot, p, store, setRoles }) =>
        Effect.gen(function* () {
            const remove = (userId: string) =>
                bot.emit("GUILD_AUDIT_LOG_ENTRY_CREATE", {
                    guild_id: bot.fixtures.ids.guild,
                    id: bot.fixtures.nextId(),
                    action_type: 12,
                    user_id: userId,
                    target_id: bot.fixtures.nextId(),
                    changes: [],
                })
            const ownerId = "4100"
            bot.rest.respond("GET /guilds/:id", { body: bot.fixtures.guild({ owner_id: ownerId }) })
            bot.rest.respond(`GET /users/${ownerId}`, { body: bot.fixtures.user({ id: ownerId }) })
            for (let index = 0; index < 3; index++) {
                yield* remove(ownerId)
                yield* remove(p.targetId)
            }
            yield* bot.idle()
            assert.equal(opened(store).length, 0)
            assert.equal(setRoles.requests().length, 0)
        }),
    ))

const entryAt = (bot: Bot, userId: string, at: number, action: number, index = 0, changes: unknown[] = []) =>
    bot.emit("GUILD_AUDIT_LOG_ENTRY_CREATE", {
        guild_id: bot.fixtures.ids.guild,
        id: String(BigInt(snowflakes.boundary(new Date(at))) + BigInt(index)),
        action_type: action,
        user_id: userId,
        target_id: bot.fixtures.nextId(),
        changes,
    })

test("A restore forgets what the account did, so its next action after the cooldown strips nobody", () => {
    const incident: AntiNukeIncident = {
        incidentNo: 1,
        actorId: "0",
        actorKind: "staff",
        rule: "channels",
        counts: { "channel-delete": 12 },
        firstAt: now,
        lastAt: now,
        mode: "enforce",
        response: "strip",
        outcome: "succeeded",
        removedRoleIds: ["1"],
        lockdown: "none",
        createdAt: now,
    }
    return start({ mode: "enforce" }, ({ bot, p, store }) =>
        Effect.gen(function* () {
            store.store.incidents = () =>
                Effect.succeed({
                    incidents: [{ ...incident, actorId: p.targetId, removedRoleIds: [p.targetRole.id] }],
                    more: false,
                })
            for (let index = 0; index < 12; index++) yield* entryAt(bot, p.targetId, now, 12, index)
            yield* bot.idle()
            assert.equal(opened(store).length, 1)
            // The member holds the role again, read fresh, so nothing is written and the count still goes
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!antinuke restore <@${p.targetId}>` }))
            yield* bot.idle()
            assert.match(
                String((p.replies.requests().at(-1)!.body as { content: string }).content),
                /already holds what incident 1 removed/,
            )
            yield* TestClock.adjust("6 minutes")
            yield* entryAt(bot, p.targetId, now + 360000, 12)
            yield* bot.idle()
            assert.equal(opened(store).length, 1)
        }),
    )
})

test("Entries a lost connection held back count at their own time, and a real burst still fires", () =>
    start({ mode: "enforce" }, ({ bot, p, store, setRoles }) =>
        Effect.gen(function* () {
            yield* TestClock.adjust("5 minutes")
            // Five deletions 12 seconds apart, all arriving now
            for (let index = 0; index < 5; index++) yield* entryAt(bot, p.targetId, now + index * 12000, 12)
            yield* bot.idle()
            assert.equal(opened(store).length, 0)
            assert.equal(setRoles.requests().length, 0)
            for (let index = 0; index < 5; index++) yield* entryAt(bot, p.targetId, now + 200000, 12, index)
            yield* bot.idle()
            assert.equal(opened(store).length, 1)
        }),
    ))

test("A dangerous role given by either form Fluxer records counts, and a member update without roles does not", async () => {
    for (const action of [24, 25])
        await start({ mode: "dry-run" }, ({ bot, p, store }) =>
            Effect.gen(function* () {
                for (let index = 0; index < 20; index++)
                    yield* entryAt(bot, p.targetId, now, action, index, [
                        { key: "roles", old_value: [], new_value: [p.targetRole.id] },
                    ])
                yield* bot.idle()
                assert.equal(opened(store)[0]?.rule, "grants", String(action))
            }),
        )
    await start({ mode: "dry-run" }, ({ bot, p, store }) =>
        Effect.gen(function* () {
            for (let index = 0; index < 20; index++)
                yield* entryAt(bot, p.targetId, now, 24, index, [{ key: "nick", old_value: "a", new_value: "b" }])
            yield* bot.idle()
            assert.equal(opened(store).length, 0)
        }),
    )
})

test("A failed read during an incident leaves an alert, and the account's next action can still be acted on", () =>
    start({ mode: "enforce" }, ({ bot, p, store, setRoles }) =>
        Effect.gen(function* () {
            const limited = bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${p.targetId}`, {
                status: 429,
                headers: { "retry-after": "120" },
                body: { message: "Synthetic rate limit", retry_after: 120, global: false },
            })
            for (let index = 0; index < 5; index++) yield* entryAt(bot, p.targetId, now, 12, index)
            yield* bot.idle()
            assert.ok(limited.requests().length > 0)
            assert.equal(opened(store).length, 1)
            assert.equal(opened(store)[0]!.response, "alert")
            assert.equal(opened(store)[0]!.rule, "channels")
            assert.equal(finished(store)[0]!.outcome, "alert")
            assert.equal(setRoles.requests().length, 0)
            bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${p.targetId}`, {
                body: bot.fixtures.member({
                    user: bot.fixtures.user({ id: p.targetId }),
                    roles: [p.targetRole.id],
                    communication_disabled_until: null,
                }),
            })
            // The SDK holds the route until Fluxer's wait ends, and the entry still counts at its own time
            yield* TestClock.adjust("121 seconds")
            yield* entryAt(bot, p.targetId, now + 1000, 12)
            yield* bot.idle()
            assert.equal(opened(store).length, 2)
            assert.equal(opened(store)[1]!.response, "strip")
            assert.equal(setRoles.requests().length, 1)
        }),
    ))

test("A slow burn's text says NeonFlux touched nothing only when it did", () => {
    const incident: AntiNukeIncident = {
        incidentNo: 3,
        actorId: "55",
        actorKind: "bot",
        rule: "slow",
        counts: { "channel-delete": 20 },
        firstAt: now,
        lastAt: now,
        mode: "enforce",
        response: "kick",
        outcome: "succeeded",
        removedRoleIds: [],
        lockdown: "none",
        createdAt: now,
    }
    assert.doesNotMatch(incidentCard(incident, "!").description!, /touched nothing/)
    assert.match(incidentCard({ ...incident, response: "alert" }, "!").description!, /touched nothing/)
    assert.doesNotMatch(antiNukeRuleText("slow", false), /touched nothing/)
})

test("A website restore is bound to its incident, forgets the account, and keeps what stayed out; a settle reads and sends nothing", () => {
    const base: AntiNukeIncident = {
        incidentNo: 3,
        actorId: "0",
        actorKind: "staff",
        rule: "bans",
        counts: { ban: 12 },
        firstAt: now,
        lastAt: now,
        mode: "enforce",
        response: "strip",
        outcome: "succeeded",
        removedRoleIds: [],
        lockdown: "none",
        createdAt: now,
    }
    const job = (operation: unknown) => ({ family: "antinuke", operation }) as never
    return start({ mode: "enforce" }, ({ bot, p, store, setRoles }) =>
        Effect.gen(function* () {
            const above = bot.fixtures.role({ position: 30, permissions: "0" }),
                gone = "4999"
            bot.rest.respond("GET /guilds/:id/roles", { body: [...p.roles, above] })
            bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${p.targetId}`, {
                body: bot.fixtures.member({
                    user: bot.fixtures.user({ id: p.targetId }),
                    roles: [],
                    communication_disabled_until: null,
                }),
            })
            const rows: Record<number, AntiNukeIncident> = {
                3: { ...base, actorId: p.targetId, removedRoleIds: [p.targetRole.id, above.id, gone] },
                4: {
                    ...base,
                    incidentNo: 4,
                    actorId: p.targetId,
                    outcome: "failed",
                    removedRoleIds: [p.targetRole.id],
                },
                5: {
                    ...base,
                    incidentNo: 5,
                    actorId: p.targetId,
                    outcome: "uncertain",
                    removedRoleIds: [p.targetRole.id],
                },
            }
            store.store.incidents = (input) =>
                Effect.succeed({
                    incidents:
                        input.query.type === "one" && rows[input.query.incidentNo]
                            ? [rows[input.query.incidentNo]!]
                            : [],
                    more: false,
                })
            const client = bot.client as never,
                actor = {
                    userId: f0,
                    roleIds: [],
                    isOwner: true,
                    isAdministrator: false,
                    nativePermissionAuthorized: true,
                }
            const prepare = (operation: unknown) =>
                prepareAntiNukeDashboardJob(client, bot.fixtures.ids.guild, job(operation), store.store, actor)
            // The restore names incident 3, whatever is newest, and carries what stayed out
            const done = yield* prepare({ type: "restore", incidentNo: 3 })
            assert.deepEqual(done?.context, {
                result: { incidentNo: 3, outcome: "failed", left: [above.id], gone: [gone] },
            })
            assert.deepEqual((setRoles.requests()[0]!.body as { roles: string[] }).roles, [p.targetRole.id])
            // A failed strip and a missing incident write nothing
            for (const incidentNo of [4, 9]) {
                const refused = yield* Effect.flip(prepare({ type: "restore", incidentNo }))
                assert.ok(refused instanceof AntiNukeHandlingError)
            }
            assert.equal(setRoles.requests().length, 1)
            // A settle reads the member, who no longer holds the role, and records it without writing
            assert.equal(yield* prepare({ type: "settle", incidentNo: 5 }), undefined)
            assert.deepEqual(finished(store).at(-1), {
                serverId: bot.fixtures.ids.guild,
                incidentNo: 5,
                outcome: "succeeded",
            })
            assert.equal(setRoles.requests().length, 1)
            // A settled incident has nothing to read
            const before = finished(store).length
            assert.equal(yield* prepare({ type: "settle", incidentNo: 3 }), undefined)
            assert.equal(finished(store).length, before)
        }),
    )
})

test("A website restore forgets the account in the running detector", () => {
    const base: AntiNukeIncident = {
        incidentNo: 3,
        actorId: "0",
        actorKind: "staff",
        rule: "channels",
        counts: { "channel-delete": 12 },
        firstAt: now,
        lastAt: now,
        mode: "enforce",
        response: "strip",
        outcome: "succeeded",
        removedRoleIds: [],
        lockdown: "none",
        createdAt: now,
    }
    return start({ mode: "enforce" }, ({ bot, p, store }) =>
        Effect.gen(function* () {
            store.store.incidents = () =>
                Effect.succeed({
                    incidents: [{ ...base, actorId: p.targetId, removedRoleIds: [p.targetRole.id] }],
                    more: false,
                })
            for (let index = 0; index < 12; index++) yield* entryAt(bot, p.targetId, now, 12, index)
            yield* bot.idle()
            assert.equal(opened(store).length, 1)
            yield* prepareAntiNukeDashboardJob(
                bot.client as never,
                bot.fixtures.ids.guild,
                { family: "antinuke", operation: { type: "restore", incidentNo: 3 } } as never,
                store.store,
                { userId: f0, roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true },
            )
            yield* TestClock.adjust("6 minutes")
            yield* entryAt(bot, p.targetId, now + 360000, 12)
            yield* bot.idle()
            assert.equal(opened(store).length, 1)
        }),
    )
})

test("A restore names the roles that stayed out and keeps the incident open, and a deleted role cannot hold it", async () => {
    assert.equal(
        restoreReply("55", 3, { written: "succeeded", restored: 1, above: ["70"], deleted: [] }),
        "<@55> has 1 role back from incident 3. <@&70> ranks at or above NeonFlux. Move NeonFlux above and send this again",
    )
    assert.equal(
        restoreReply("55", 3, { written: "succeeded", restored: 0, above: [], deleted: ["71"] }),
        "<@55> got no role back from incident 3. One role was deleted since",
    )
    assert.equal(
        restoreReply("55", 3, { written: "succeeded", restored: 0, above: [], deleted: [] }),
        "<@55> already holds what incident 3 removed",
    )
    await start({ mode: "enforce" }, ({ bot, p, setRoles }) =>
        Effect.gen(function* () {
            const above = bot.fixtures.role({ position: 30, permissions: "0" }),
                gone = "4999"
            bot.rest.respond("GET /guilds/:id/roles", { body: [...p.roles, above] })
            bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${p.targetId}`, {
                body: bot.fixtures.member({
                    user: bot.fixtures.user({ id: p.targetId }),
                    roles: [],
                    communication_disabled_until: null,
                }),
            })
            const incident: AntiNukeIncident = {
                incidentNo: 3,
                actorId: p.targetId,
                actorKind: "staff",
                rule: "bans",
                counts: { ban: 12 },
                firstAt: now,
                lastAt: now,
                mode: "enforce",
                response: "strip",
                outcome: "succeeded",
                removedRoleIds: [p.targetRole.id, above.id, gone],
                lockdown: "none",
                createdAt: now,
            }
            const done = yield* restoreIncidentRoles(bot.client as never, bot.fixtures.ids.guild, incident)
            assert.deepEqual(done, {
                kind: "done",
                written: "succeeded",
                outcome: "failed",
                restored: 1,
                above: [above.id],
                deleted: [gone],
            })
            assert.deepEqual((setRoles.requests()[0]!.body as { roles: string[] }).roles, [p.targetRole.id])
        }),
    )
})

test("An incident reaches the staff log once, as a note that names the account and response", () =>
    start({ mode: "dry-run" }, ({ bot, p, store }) =>
        Effect.gen(function* () {
            const finish = store.store.finish
            store.store.finish = (input) =>
                finish(input).pipe(Effect.map((result) => ({ ...result, logChannelId: "6100" })))
            yield* burst(bot, p.targetId)
            const posted = p.replies.requests().filter((request) => request.path === "/channels/6100/messages")
            assert.equal(posted.length, 1)
            const text = JSON.stringify(posted[0]!.body)
            assert.match(text, /Anti-nuke incident 1/)
            assert.match(text, /Alert only/)
            assert.match(text, /antinuke incident 1/)
        }),
    ))

test("A strip that meets Fluxer's five second 429 waits it out instead of failing for the whole window", () =>
    start({ mode: "enforce" }, ({ bot, p, store }) =>
        Effect.gen(function* () {
            let first = true
            const writes = bot.rest.respond("PATCH /guilds/:id/members/:id", (request) => {
                if (first) {
                    first = false
                    return {
                        status: 429,
                        headers: { "retry-after": "5" },
                        body: { message: "Synthetic rate limit", retry_after: 5, global: false },
                    }
                }
                return {
                    body: bot.fixtures.member({
                        user: bot.fixtures.user({ id: request.path.split("/").at(-1)! }),
                        roles: [],
                        communication_disabled_until: null,
                    }),
                }
            })
            for (let index = 0; index < 10; index++) yield* ban(bot, p.targetId)
            for (let index = 0; index < 8 && !finished(store).length; index++) {
                yield* TestClock.adjust("1 second")
                yield* Effect.yieldNow
            }
            yield* bot.idle()
            assert.equal(writes.requests().length, 2)
            assert.equal(finished(store)[0]!.outcome, "succeeded")
        }),
    ))
