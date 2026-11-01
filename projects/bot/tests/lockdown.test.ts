import assert from "node:assert/strict"
import test from "node:test"
import type { LockdownWorkRequest, LockdownWorkResult, LockdownWorkRow } from "@neonflux/contracts/lockdown"
import { ChannelType, Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { processDashboardConfigurationPass } from "../src/dashboard-configuration.ts"
import { mockBackend } from "./backend-fake.ts"
import { lockdownCritical, parseLockdownCommand } from "../src/lockdown-command.ts"
import { LockdownHandlingError, lockdownCard, prepareLockdownDashboardJob } from "../src/lockdown-management.ts"
import { lockdownPlanRow, lockdownSettled } from "../src/lockdown-permissions.ts"
import type { LockdownStore } from "../src/lockdown-store.ts"
import { renderText } from "../src/reply-style.ts"
import { platform } from "./moderation-fixture.ts"

const now = Date.parse("2026-10-01T00:00:00Z")
const controlled = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) =>
    Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))
const BITS = Permissions.SendMessages | Permissions.SendMessagesInThreads,
    View = Permissions.ViewChannel
const BOT_ID = "900",
    SERVER = "100"
const everyone = { id: SERVER, guildId: SERVER, permissions: View | Permissions.SendMessages } as never
const role = (id: string, permissions: bigint, position = 1) =>
    ({ id, guildId: SERVER, permissions, position, name: id, hoist: false, mentionable: false }) as never
const channel = (
    id: string,
    type: number,
    overwrites: { id: string; type: string; allow: bigint; deny: bigint }[] = [],
) => ({ id, type, permissionOverwrites: overwrites }) as never

test("The grammar reads each form, and only lifting and status are critical", () => {
    assert.deepEqual(parseLockdownCommand([]), { type: "status" })
    assert.deepEqual(parseLockdownCommand(["on"]), { type: "on" })
    assert.deepEqual(parseLockdownCommand(["on", "a", "raid"]), { type: "on", reason: "a raid" })
    assert.deepEqual(parseLockdownCommand(["off", "over"]), { type: "off", reason: "over" })
    assert.deepEqual(parseLockdownCommand(["exempt", "add", "<#55>"]), {
        type: "exempt",
        channelId: "55",
        exempt: true,
    })
    assert.deepEqual(parseLockdownCommand(["exempt", "list", "next"]), { type: "exempt-list", next: true })
    assert.ok("error" in parseLockdownCommand(["exempt", "add"]))
    assert.ok("error" in parseLockdownCommand(["on", "x".repeat(513)]))
    assert.equal(lockdownCritical(parseLockdownCommand(["off"])), true)
    assert.equal(lockdownCritical(parseLockdownCommand(["status"])), true)
    assert.equal(lockdownCritical(parseLockdownCommand(["on"])), false)
    assert.equal(lockdownCritical(parseLockdownCommand(["exempt", "list"])), false)
})

test("A plan covers chat channels the everyone role can see and owns only the bits it adds", () => {
    const plan = (item: never, bot = BITS) => lockdownPlanRow(item, SERVER, BOT_ID, [everyone], bot)
    assert.equal(plan(channel("1", ChannelType.Category)), undefined)
    assert.equal(plan(channel("1", ChannelType.PublicThread)), undefined)
    for (const type of [ChannelType.Text, ChannelType.Announcement, ChannelType.Forum, ChannelType.Voice])
        assert.equal(plan(channel("1", type))?.bits, BITS.toString())
    // Fluxer lets a bot lift only what it holds, so a thread bit it lacks stays open
    assert.equal(
        plan(channel("1", ChannelType.Text), Permissions.ManageRoles)?.bits,
        Permissions.SendMessages.toString(),
    )
    assert.deepEqual(plan(channel("1", ChannelType.Text, [{ id: SERVER, type: "role", allow: 0n, deny: View }])), {
        channelId: "1",
        everyone: { exists: true, allow: "0", deny: View.toString() },
        botBefore: { exists: false, allow: "0", deny: "0" },
        skip: "private",
        bits: "0",
    })
    // A channel a !security lock already holds is left to that lock
    assert.equal(
        plan(channel("1", ChannelType.Text, [{ id: SERVER, type: "role", allow: 0n, deny: BITS }]))?.skip,
        "held",
    )
    // Only the missing bit belongs to this lockdown when a lock owns the other
    assert.equal(
        plan(channel("1", ChannelType.Text, [{ id: SERVER, type: "role", allow: 0n, deny: Permissions.SendMessages }]))
            ?.bits,
        Permissions.SendMessagesInThreads.toString(),
    )
    // NeonFlux keeps the right to lift the denial, with its own overwrite remembered
    assert.deepEqual(plan(channel("1", ChannelType.Text))?.botSet, { allow: BITS.toString(), deny: "0" })
    assert.equal(
        plan(channel("1", ChannelType.Text), Permissions.Administrator | Permissions.SendMessages)?.botSet,
        undefined,
    )
})

test("A channel hidden from everyone is private only when no member role can view it", () => {
    const hiddenEveryone = { id: SERVER, guildId: SERVER, permissions: Permissions.SendMessages } as never
    const hidden = [{ id: SERVER, type: "role", allow: 0n, deny: View }]
    const plan = (item: never, roles: never[]) =>
        lockdownPlanRow(item, SERVER, BOT_ID, [hiddenEveryone, ...roles], BITS)
    // A member role shows every channel, so a raid must still lock them all
    const member = role("70", View)
    assert.equal(plan(channel("1", ChannelType.Text), [member])?.skip, undefined)
    // A role overwrite can be what shows it
    assert.equal(
        plan(channel("1", ChannelType.Text, [...hidden, { id: "71", type: "role", allow: View, deny: 0n }]), [
            role("71", 0n),
        ])?.skip,
        undefined,
    )
    // Only staff roles or Administrators see it, or one member through a member overwrite as a ticket does
    assert.equal(plan(channel("1", ChannelType.Text, hidden), [role("72", Permissions.Administrator)])?.skip, "private")
    assert.equal(
        plan(channel("1", ChannelType.Text, [...hidden, { id: "73", type: "role", allow: View, deny: 0n }]), [
            role("73", Permissions.ModerateMembers),
        ])?.skip,
        "private",
    )
    assert.equal(
        plan(channel("1", ChannelType.Text, [...hidden, { id: "74", type: "member", allow: View, deny: 0n }]), [])
            ?.skip,
        "private",
    )
    // A role that lost the channel through its own overwrite does not make it public
    assert.equal(
        plan(channel("1", ChannelType.Text, [...hidden, { id: "70", type: "role", allow: 0n, deny: View }]), [member])
            ?.skip,
        "private",
    )
})

test("A status settles a write by reading what the channel holds", () => {
    const row: LockdownWorkRow = {
        channelId: "1",
        phase: "lock",
        everyone: { exists: false, allow: "0", deny: "0" },
        bits: BITS.toString(),
        botBefore: { exists: false, allow: "0", deny: "0" },
    }
    const holding = channel("1", ChannelType.Text, [{ id: SERVER, type: "role", allow: 0n, deny: BITS }]),
        clear = channel("1", ChannelType.Text)
    assert.equal(lockdownSettled(row, holding, SERVER, BOT_ID), true)
    assert.equal(lockdownSettled(row, clear, SERVER, BOT_ID), false)
    assert.equal(lockdownSettled({ ...row, phase: "restore" }, holding, SERVER, BOT_ID), false)
    assert.equal(lockdownSettled({ ...row, phase: "restore" }, clear, SERVER, BOT_ID), true)
    // A restart between the two writes of a restore leaves NeonFlux's own allow, so the restore is not done yet
    const withAllow = { ...row, phase: "restore" as const, botSet: { allow: BITS.toString(), deny: "0" } }
    const allowLeft = channel("1", ChannelType.Text, [{ id: BOT_ID, type: "member", allow: BITS, deny: 0n }])
    assert.equal(lockdownSettled(withAllow, allowLeft, SERVER, BOT_ID), false)
    assert.equal(lockdownSettled(withAllow, clear, SERVER, BOT_ID), true)
    // An allow someone changed since is theirs
    const changed = channel("1", ChannelType.Text, [{ id: BOT_ID, type: "member", allow: View, deny: 0n }])
    assert.equal(lockdownSettled(withAllow, changed, SERVER, BOT_ID), true)
})

test("The status card shows the state first, counts and at most 10 problem channels", () => {
    const counts = { queued: 2, writing: 1, locked: 40, uncertain: 3, failed: 12, skipped: 5, restored: 0 }
    const card = lockdownCard(
        {
            settings: { exemptChannelIds: [] },
            lockdown: {
                state: "locking",
                origin: "command",
                reason: "A raid",
                startedBy: "7",
                startedAt: now,
                counts,
                problems: Array.from({ length: 13 }, (_, index) => ({
                    channelId: String(1000 + index),
                    state: index < 3 ? ("uncertain" as const) : ("failed" as const),
                    phase: "lock" as const,
                    bits: "1",
                })),
            },
        },
        "!",
    )
    assert.equal(card.description, "On, still locking channels")
    const problems = card.fields!.find(([name]) => name === "Problems")![1]
    assert.equal(problems.split("\n").length, 10)
    assert.ok(card.fields!.length <= 8)
    assert.equal(renderText(card).length, 1)
    assert.match(card.note!, /!lockdown on/)
    assert.equal(
        lockdownCard({ settings: { exemptChannelIds: ["1"] }, lockdown: null }, "!").description,
        "Off. No lockdown has run in this server",
    )
})

// A backend that hands out what the tests queue, with what the worker reported
function fakeStore(queue: LockdownWorkRow[][], exemptChannelIds: readonly string[] = []) {
    const reports: unknown[] = [],
        managed: unknown[] = []
    let result: LockdownWorkResult = { rows: [], notes: [] }
    const store: LockdownStore = {
        get: () =>
            Effect.succeed({
                settings: { exemptChannelIds: [...exemptChannelIds] },
                lockdown: null,
            }),
        manage: (input) => {
            managed.push(input.operation)
            return Effect.succeed({
                settings: { exemptChannelIds: [] },
                lockdown: {
                    state: "locking" as const,
                    origin: "command" as const,
                    reason: "",
                    startedAt: now,
                    counts: { queued: 2, writing: 0, locked: 0, uncertain: 0, failed: 0, skipped: 1, restored: 0 },
                    problems: [],
                },
                started: true,
            })
        },
        auto: () => Effect.die("Unexpected anti-nuke start"),
        work: (input: LockdownWorkRequest) => {
            if (input.type === "report") {
                reports.push(input.rows)
                return Effect.succeed({ rows: [], notes: [] })
            }
            if (input.type === "problems") return Effect.succeed({ rows: queue.shift() ?? [], notes: [] })
            result = { rows: queue.shift() ?? [], notes: [] }
            return Effect.succeed(result)
        },
    }
    return { store, reports, managed }
}
const lockRow = (channelId: string, overrides: Partial<LockdownWorkRow> = {}): LockdownWorkRow => ({
    channelId,
    phase: "lock",
    everyone: { exists: false, allow: "0", deny: "0" },
    bits: BITS.toString(),
    botBefore: { exists: false, allow: "0", deny: "0" },
    ...overrides,
})

test("The command builds a plan from the channels and the worker writes each one, keeping unrelated bits", async () => {
    const f = createFixtures(),
        rows = lockRow("5001"),
        { store, reports, managed } = fakeStore([[rows], []])
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot(
                createBotOptions(
                    { token: Redacted.make("synthetic-lockdown-token"), serverId: f.ids.guild },
                    { lockdown: store },
                ),
            )
            const p = platform(bot, {
                actorOwner: false,
                actorPermissions: Permissions.ManageRoles,
                botPermissions: Permissions.ManageRoles | BITS,
            })
            const existing = bot.fixtures.channel({
                id: "5001",
                type: 0,
                permission_overwrites: [
                    { id: f.ids.guild, type: 0, allow: "1024", deny: Permissions.ManageRoles.toString() },
                ],
            })
            bot.rest.respond("GET /guilds/:id/channels", { body: [existing] })
            const writes = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
            yield* bot.ready()
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!lockdown on a raid" }))
            yield* bot.idle()
            assert.equal((managed[0] as { type: string }).type, "on")
            assert.equal((managed[0] as { plan: unknown[] }).plan.length, 1)
            assert.deepEqual(reports, [[{ channelId: "5001", outcome: "done" }]])
            // The bot first allows itself the bits, then the everyone overwrite denies them and keeps what it held
            const bodies = writes.requests().map((request) => request.body as Record<string, unknown>)
            assert.equal(bodies.length, 2)
            assert.equal(bodies[0]!.type, 1)
            assert.equal(bodies[0]!.allow, BITS.toString())
            assert.equal(bodies[1]!.type, 0)
            assert.equal(BigInt(bodies[1]!.deny as string), Permissions.ManageRoles | BITS)
            assert.match(
                String((p.replies.requests()[0]!.body as { content: string }).content),
                /Lockdown on: 2 channels/,
            )
        }),
    )
})

test("A restore gives back only what this lockdown changed, removes an overwrite it added and keeps later changes", async () => {
    const f = createFixtures()
    const later = Permissions.AddReactions
    const { store, reports } = fakeStore([
        [
            // The overwrite did not exist, and nothing else was added, so it goes. So does the bot's own allow, still what was set
            lockRow("6001", { phase: "restore", botSet: { allow: BITS.toString(), deny: "0" } }),
            // Someone denied something else since, which stays
            lockRow("6002", { phase: "restore" }),
            // Someone already reopened the thread bit, which stays their choice
            lockRow("6003", {
                phase: "restore",
                everyone: { exists: true, allow: Permissions.SendMessages.toString(), deny: "0" },
            }),
            // The bot's overwrite changed since, so it stays
            lockRow("6004", { phase: "restore", botSet: { allow: BITS.toString(), deny: "0" } }),
            // The channel was deleted
            lockRow("6005", { phase: "restore" }),
        ],
        [],
    ])
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot(
                createBotOptions(
                    { token: Redacted.make("synthetic-lockdown-token"), serverId: f.ids.guild },
                    { lockdown: store },
                ),
            )
            const p = platform(bot, { actorOwner: false, botPermissions: Permissions.ManageRoles | BITS })
            const of = (id: string, overwrites: unknown[]) =>
                bot.fixtures.channel({ id, type: 0, permission_overwrites: overwrites as never })
            const everyoneRow = (deny: bigint) => ({ id: f.ids.guild, type: 0, allow: "0", deny: deny.toString() })
            const botRow = (allow: bigint) => ({ id: f.ids.bot, type: 1, allow: allow.toString(), deny: "0" })
            bot.rest.respond("GET /guilds/:id/channels", {
                body: [
                    of("6001", [everyoneRow(BITS), botRow(BITS)]),
                    of("6002", [everyoneRow(BITS | later)]),
                    of("6003", [everyoneRow(Permissions.SendMessages)]),
                    of("6004", [everyoneRow(BITS), botRow(BITS | later)]),
                ],
            })
            const sets = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 }),
                removes = bot.rest.respond("DELETE /channels/:id/permissions/:id", { status: 204 })
            yield* bot.ready()
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!lockdown off" }))
            yield* bot.idle()
            assert.deepEqual(
                removes
                    .requests()
                    .map((request) => request.path)
                    .sort(),
                [
                    `/channels/6001/permissions/${f.ids.bot}`,
                    `/channels/6001/permissions/${f.ids.guild}`,
                    `/channels/6004/permissions/${f.ids.guild}`,
                ].sort(),
            )
            const set = Object.fromEntries(
                sets.requests().map((request) => [request.path.split("/")[2], request.body as Record<string, string>]),
            )
            assert.equal(BigInt(set["6002"]!.deny!), later)
            // Allow comes back on the bit the lockdown took it from, and the thread bit was already open, so it is left alone
            assert.equal(BigInt(set["6003"]!.allow!), Permissions.SendMessages)
            assert.equal(BigInt(set["6003"]!.deny!), 0n)
            assert.deepEqual(reports, [
                [
                    { channelId: "6001", outcome: "done" },
                    { channelId: "6002", outcome: "done" },
                    { channelId: "6003", outcome: "done" },
                    { channelId: "6004", outcome: "done" },
                    { channelId: "6005", outcome: "gone" },
                ],
            ])
            void p
        }),
    )
})

test("A write with an unknown outcome stays uncertain, a refused one failed, and neither is sent again", async () => {
    const f = createFixtures()
    const { store, reports } = fakeStore([[lockRow("7001"), lockRow("7002")], []])
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot(
                createBotOptions(
                    { token: Redacted.make("synthetic-lockdown-token"), serverId: f.ids.guild },
                    { lockdown: store },
                ),
            )
            platform(bot, { actorOwner: false, botPermissions: Permissions.ManageRoles | Permissions.Administrator })
            bot.rest.respond("GET /guilds/:id/channels", {
                body: ["7001", "7002"].map((id) => bot.fixtures.channel({ id, type: 0, permission_overwrites: [] })),
            })
            const unknown = bot.rest.respond("PUT /channels/7001/permissions/:id", { status: 500 }),
                refused = bot.rest.respond("PUT /channels/7002/permissions/:id", { status: 403 })
            yield* bot.ready()
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!lockdown off" }))
            yield* bot.idle()
            assert.deepEqual(reports, [
                [
                    { channelId: "7001", outcome: "uncertain" },
                    { channelId: "7002", outcome: "failed" },
                ],
            ])
            assert.equal(unknown.requests().length, 1)
            assert.equal(refused.requests().length, 1)
        }),
    )
})

test("A status reads an uncertain channel and settles it without writing", async () => {
    const f = createFixtures()
    const { store, reports } = fakeStore([[lockRow("8001")]])
    const counted = store.get
    store.get = (input) =>
        counted(input).pipe(
            Effect.map((status) => ({
                ...status,
                lockdown: {
                    state: "active" as const,
                    origin: "command" as const,
                    reason: "",
                    startedAt: now,
                    counts: { queued: 0, writing: 0, locked: 0, uncertain: 1, failed: 0, skipped: 0, restored: 0 },
                    problems: [],
                },
            })),
        )
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot(
                createBotOptions(
                    { token: Redacted.make("synthetic-lockdown-token"), serverId: f.ids.guild },
                    { lockdown: store },
                ),
            )
            platform(bot, { actorOwner: false, botPermissions: Permissions.ManageRoles })
            bot.rest.respond("GET /channels/8001", {
                body: bot.fixtures.channel({
                    id: "8001",
                    type: 0,
                    permission_overwrites: [{ id: f.ids.guild, type: 0, allow: "0", deny: BITS.toString() }],
                }),
            })
            const writes = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
            yield* bot.ready()
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!lockdown status" }))
            yield* bot.idle()
            assert.deepEqual(reports, [[{ channelId: "8001", outcome: "done" }]])
            assert.equal(writes.requests().length, 0)
        }),
    )
})

test("A member without Manage roles is told so before any read of the backend answers", async () => {
    const f = createFixtures(),
        { store } = fakeStore([])
    store.get = () => Effect.die("Unexpected read")
    store.manage = () => Effect.die("Unexpected change")
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot(
                createBotOptions(
                    { token: Redacted.make("synthetic-lockdown-token"), serverId: f.ids.guild },
                    { lockdown: store },
                ),
            )
            const p = platform(bot, { actorOwner: false, botPermissions: Permissions.SendMessages })
            bot.rest.respond("GET /guilds/:id/channels", { body: [] })
            yield* bot.ready()
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!lockdown on" }))
            yield* bot.idle()
            assert.match(
                String((p.replies.requests()[0]!.body as { content: string }).content),
                /NeonFlux cannot lock channels yet/,
            )
        }),
    )
})

const whyChannelsStayedOut = (exempt: readonly string[], check: (text: string) => void) => {
    const f = createFixtures(),
        { store } = fakeStore([[], []], exempt)
    return controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot(
                createBotOptions(
                    { token: Redacted.make("synthetic-lockdown-token"), serverId: f.ids.guild },
                    { lockdown: store },
                ),
            )
            const p = platform(bot, {
                actorOwner: false,
                actorPermissions: Permissions.ManageRoles,
                botPermissions: Permissions.ManageRoles | BITS,
                everyonePermissions: View,
            })
            const member = bot.fixtures.role({ position: 2, permissions: "0" })
            bot.rest.respond("GET /guilds/:id/roles", { body: [...p.roles, member] })
            const of = (id: string, overwrites: unknown[]) =>
                bot.fixtures.channel({ id, type: 0, permission_overwrites: overwrites as never })
            const hideFromAll = { id: f.ids.guild, type: 0, allow: "0", deny: View.toString() }
            bot.rest.respond("GET /guilds/:id/channels", {
                body: [
                    of("5001", []),
                    of("5002", [{ id: member.id, type: 0, allow: Permissions.SendMessages.toString(), deny: "0" }]),
                    of("5003", [hideFromAll]),
                    of("5004", [{ id: f.ids.guild, type: 0, allow: "0", deny: BITS.toString() }]),
                ],
            })
            yield* bot.ready()
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!lockdown on" }))
            yield* bot.idle()
            const text = String((p.replies.requests()[0]!.body as { content: string }).content)
            assert.match(text, /left alone: 1 only staff can see, 1 already denied/)
            check(text)
        }),
    )
}
test("The reply says why channels stayed out and which still let a role post", () =>
    whyChannelsStayedOut([], (text) => assert.match(text, /1 channel gives a role its own allow for Send messages/)))
test("An exempt channel is not counted among those where a role can still post", () =>
    whyChannelsStayedOut(["5002"], (text) => assert.doesNotMatch(text, /its own allow/)))

test("A write Fluxer answered with a long 429 goes back to the queue, a short wait fits its deadline, and nothing unknown does", async () => {
    const f = createFixtures()
    const { store, reports } = fakeStore([[lockRow("7101"), lockRow("7102")], []])
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot(
                createBotOptions(
                    { token: Redacted.make("synthetic-lockdown-token"), serverId: f.ids.guild },
                    { lockdown: store },
                ),
            )
            platform(bot, { actorOwner: false, botPermissions: Permissions.ManageRoles | Permissions.Administrator })
            bot.rest.respond("GET /guilds/:id/channels", {
                body: ["7101", "7102"].map((id) => bot.fixtures.channel({ id, type: 0, permission_overwrites: [] })),
            })
            const limited = (seconds: number) => ({
                status: 429,
                headers: { "retry-after": String(seconds) },
                body: { message: "Synthetic rate limit", retry_after: seconds, global: false },
            })
            const long = bot.rest.respond("PUT /channels/7101/permissions/:id", limited(120))
            let first = true
            const short = bot.rest.respond("PUT /channels/7102/permissions/:id", () => {
                if (!first) return { status: 204 }
                first = false
                return limited(5)
            })
            yield* bot.ready()
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!lockdown off" }))
            for (let index = 0; index < 8 && !reports.length; index++) {
                yield* TestClock.adjust("1 second")
                yield* Effect.yieldNow
            }
            yield* bot.idle()
            assert.deepEqual(reports, [
                [
                    { channelId: "7101", outcome: "retry" },
                    { channelId: "7102", outcome: "done" },
                ],
            ])
            assert.equal(long.requests().length, 1)
            assert.equal(short.requests().length, 2)
        }),
    )
})

test("A website lockdown reads the plan, says what NeonFlux lacks, and settles without writing", async () => {
    const f = createFixtures(),
        job = (operation: unknown) => ({ family: "lockdown", operation }) as never
    const { store, reports } = fakeStore([[lockRow("8101")]])
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot(
                createBotOptions(
                    { token: Redacted.make("synthetic-lockdown-token"), serverId: f.ids.guild },
                    { lockdown: store },
                ),
            )
            platform(bot, { actorOwner: false, botPermissions: Permissions.ManageRoles | BITS })
            bot.rest.respond("GET /guilds/:id/channels", {
                body: [bot.fixtures.channel({ id: "8102", type: 0, permission_overwrites: [] })],
            })
            bot.rest.respond("GET /channels/8101", {
                body: bot.fixtures.channel({
                    id: "8101",
                    type: 0,
                    permission_overwrites: [{ id: f.ids.guild, type: 0, allow: "0", deny: BITS.toString() }],
                }),
            })
            const writes = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
            yield* bot.ready()
            yield* bot.idle()
            const client = bot.client as never
            const on = yield* prepareLockdownDashboardJob(client, f.ids.guild, job({ type: "on" }))
            assert.deepEqual(
                on?.context.plan.map((row) => row.channelId),
                ["8102"],
            )
            assert.equal(yield* prepareLockdownDashboardJob(client, f.ids.guild, job({ type: "off" })), undefined)
            assert.equal(yield* prepareLockdownDashboardJob(client, f.ids.guild, job({ type: "settle" })), undefined)
            assert.deepEqual(reports, [[{ channelId: "8101", outcome: "done" }]])
            assert.equal(writes.requests().length, 0)
            // Other families are not its business
            assert.equal(
                yield* prepareLockdownDashboardJob(client, f.ids.guild, { family: "alerts", operation: {} } as never),
                undefined,
            )
            platform(bot, { actorOwner: false, botPermissions: Permissions.SendMessages })
            const refused = yield* Effect.flip(prepareLockdownDashboardJob(client, f.ids.guild, job({ type: "on" })))
            assert.ok(refused instanceof LockdownHandlingError)
            assert.match(refused.problem, /NeonFlux cannot lock channels yet.*Manage roles/)
        }),
    )
})

test("Reading the channels waits out Fluxer's five second 429, so a raid's lockdown still starts", async () => {
    const f = createFixtures(),
        { store, managed } = fakeStore([[], []])
    await controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot(
                createBotOptions(
                    { token: Redacted.make("synthetic-lockdown-token"), serverId: f.ids.guild },
                    { lockdown: store },
                ),
            )
            platform(bot, {
                actorOwner: false,
                actorPermissions: Permissions.ManageRoles,
                botPermissions: Permissions.ManageRoles | BITS,
            })
            let first = true
            bot.rest.respond("GET /guilds/:id/channels", () => {
                if (first) {
                    first = false
                    return {
                        status: 429,
                        headers: { "retry-after": "5" },
                        body: { message: "Synthetic rate limit", retry_after: 5, global: false },
                    }
                }
                return { body: [bot.fixtures.channel({ id: "5001", type: 0, permission_overwrites: [] })] }
            })
            yield* bot.ready()
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!lockdown on" }))
            for (let index = 0; index < 8 && !managed.length; index++) {
                yield* TestClock.adjust("1 second")
                yield* Effect.yieldNow
            }
            yield* bot.idle()
            assert.equal((managed[0] as { plan: unknown[] }).plan.length, 1)
        }),
    )
})

test("A website lockdown needs Manage roles of the member who asked, as chat does, and says so", async (t) => {
    const f = createFixtures()
    const seen: { path: string; body: unknown }[] = []
    mockBackend(t, (call) => {
        seen.push({ path: call.path, body: call.body })
        if (call.path === "/dashboard-configuration/ready")
            return {
                jobs: [
                    {
                        native: {},
                        id: "synthetic_lockdown_job",
                        actorId: f.ids.user,
                        expectedConfigRevision: 0,
                        state: "queued",
                        createdAt: 0,
                        expiresAt: now + 120000,
                        family: "lockdown",
                        operation: { type: "off" },
                    },
                ],
            }
        return {}
    })
    const pass = (permissions: bigint) =>
        controlled(
            Effect.gen(function* () {
                yield* TestClock.adjust(`${now} millis`)
                const bot = yield* createTestBot(
                    createBotOptions({ token: Redacted.make("synthetic-lockdown-token"), serverId: f.ids.guild }, {}),
                )
                platform(bot, { actorOwner: false, actorPermissions: permissions })
                bot.rest.respond("GET /users/@me", { body: bot.fixtures.botUser({ system: false }) })
                bot.rest.respond(`GET /users/${f.ids.user}`, {
                    body: bot.fixtures.user({ id: f.ids.user, bot: false, system: false }),
                })
                yield* bot.ready()
                yield* processDashboardConfigurationPass(
                    {
                        token: Redacted.make("synthetic-lockdown-token"),
                        serverId: f.ids.guild,
                        backend: {
                            url: "https://synthetic.invalid",
                            secret: Redacted.make("synthetic-backend-secret"),
                        },
                    },
                    bot.client as never,
                ).pipe(Effect.ignore)
            }),
        )
    await pass(Permissions.ManageGuild)
    assert.equal(
        seen.some((call) => call.path === "/dashboard-configuration/execute"),
        false,
    )
    const failed = seen.find((call) => call.path === "/dashboard-configuration/fail")
    assert.match(JSON.stringify(failed?.body), /A lockdown needs Manage roles/)
    seen.length = 0
    await pass(Permissions.ManageGuild | Permissions.ManageRoles)
    assert.equal(
        seen.some((call) => call.path === "/dashboard-configuration/execute"),
        true,
    )
})
