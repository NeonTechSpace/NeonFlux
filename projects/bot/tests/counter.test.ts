import assert from "node:assert/strict"
import test from "node:test"
import type { Counter, CounterOperation, CounterView } from "@neonflux/contracts/counters"
import { CounterTemplate, renderCounter } from "@neonflux/contracts/counters"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted, Schema, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { counterHelp, parseCounterCommand } from "../src/counter-command.ts"
import { counterList } from "../src/counter-management.ts"
import type { CounterStore } from "../src/counter-store.ts"
import { COUNTER_AUDIT_REASON, COUNTER_INTERVAL_MS, counterOffset, counterRuntimes } from "../src/counter-worker.ts"
import type { MetadataLogsStore } from "../src/metadata-log-store.ts"
import { reloadServerRuntime } from "../src/runtime-reload.ts"
import type { StructureStore } from "../src/structure-store.ts"
import { platform } from "./moderation-fixture.ts"

const bot0 = createFixtures(),
    token = Redacted.make("synthetic-counter-token"),
    now = Date.parse("2026-10-01T00:00:00Z")
type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const run = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) =>
    Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))
const counter = (channelId: string, overrides: Partial<Counter> = {}): Counter => ({
    channelId,
    kind: "members",
    template: "Members: {count}",
    enabled: true,
    createdAt: now,
    ...overrides,
})
function storeOf(initial: CounterView) {
    let view = initial
    const calls: string[] = [],
        operations: CounterOperation[] = [],
        blocked: { channelId: string; reason: string }[] = [],
        counted: (string | null)[] = []
    const store: CounterStore = {
        query: () =>
            Effect.sync(() => {
                calls.push("query")
                return view
            }),
        manage: (input) =>
            Effect.sync(() => {
                calls.push("manage")
                const op = input.operation
                operations.push(op)
                if (op.type === "module") view = { ...view, enabled: op.enabled }
                else if (op.type === "remove")
                    view = { ...view, counters: view.counters.filter((row) => row.channelId !== op.channelId) }
                else if (op.type === "add") {
                    const { type: _type, ...row } = op
                    view = {
                        ...view,
                        counters: [
                            ...view.counters.filter((row) => row.channelId !== op.channelId),
                            { ...row, enabled: true, createdAt: now },
                        ],
                    }
                } else
                    view = {
                        ...view,
                        counters: view.counters.map((row) =>
                            row.channelId === op.channelId ? counter(row.channelId, { template: op.template }) : row,
                        ),
                    }
                return view
            }),
        work: (input) =>
            Effect.sync(() => {
                calls.push("work")
                if ("countProblem" in input) {
                    counted.push(input.countProblem)
                    view = {
                        ...view,
                        counters: view.counters.map((row) => {
                            if (row.channelId !== input.channelId) return row
                            const { countProblem: _old, ...rest } = row
                            return input.countProblem ? { ...rest, countProblem: input.countProblem } : rest
                        }),
                    }
                    return { recorded: true }
                }
                blocked.push({ channelId: input.channelId, reason: input.reason })
                view = {
                    ...view,
                    counters: view.counters.map((row) =>
                        row.channelId === input.channelId ? { ...row, enabled: false, problem: input.reason } : row,
                    ),
                }
                return { recorded: true }
            }),
    }
    return {
        store,
        calls,
        operations,
        blocked,
        counted,
        set: (next: CounterView) => {
            view = next
        },
    }
}
/** Answers the bot's gateway count requests with this member count, as Fluxer does */
const answerCounts = (bot: Bot, serverId: string, count: () => number) =>
    Effect.gen(function* () {
        let seen = 0
        for (;;) {
            const sent = bot.commands().filter((command) => command.op === 15)
            for (; seen < sent.length; seen++)
                yield* bot.emit("GUILD_COUNTS_UPDATE", {
                    nonce: (sent[seen]!.d as { nonce: string }).nonce,
                    counts: [{ guild_id: serverId, member_count: count(), online_count: 0 }],
                })
            yield* Effect.yieldNow
        }
    }).pipe(Effect.forkScoped)
const settle = (bot: Bot) =>
    Effect.gen(function* () {
        for (let round = 0; round < 3; round++) {
            yield* bot.idle()
            for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow
        }
    })
/** Moves time to a server's first check, or on by one interval */
const toNextCheck = (bot: Bot, serverId: string, first: boolean) =>
    TestClock.adjust(first ? counterOffset(serverId) : COUNTER_INTERVAL_MS).pipe(Effect.andThen(settle(bot)))
const started = (view: CounterView, stores: { metadata?: MetadataLogsStore; structure?: StructureStore } = {}) =>
    Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const r = storeOf(view)
        const bot = yield* createTestBot(
            createBotOptions({ token, serverId: bot0.ids.guild }, { counters: r.store, ...stores }),
        )
        bot.rest.respond("GET /users/@me", { body: bot.fixtures.botUser() })
        const channelId = bot.fixtures.ids.channel,
            serverId = bot.fixtures.ids.guild
        return { r, bot, channelId, serverId }
    })

const channelOf = (bot: Bot, id: string, name: string) => bot.fixtures.channel({ id, name, type: 2 })

test("commands parse a members or role counter with its name, and bad values get a short hint", () => {
    assert.deepEqual(parseCounterCommand(["add", "members", "<#5001>", "Members: {count}"]), {
        type: "add",
        kind: "members",
        channelId: "5001",
        template: "Members: {count}",
    })
    assert.deepEqual(parseCounterCommand(["add", "role", "<@&77>", "<#5001>", "Staff:", "{count}"]), {
        type: "add",
        kind: "role",
        roleId: "77",
        channelId: "5001",
        template: "Staff: {count}",
    })
    assert.deepEqual(parseCounterCommand(["set", "<#5001>", "Now  {count} "]), {
        type: "set",
        channelId: "5001",
        template: "Now {count}",
    })
    assert.deepEqual(parseCounterCommand(["remove", "<#5001>"]), { type: "remove", channelId: "5001" })
    assert.deepEqual(parseCounterCommand(["module", "off"]), { type: "module", enabled: false })
    assert.deepEqual(parseCounterCommand([]), { type: "list" })
    assert.deepEqual(parseCounterCommand(["list"]), { type: "list" })
    assert.deepEqual(parseCounterCommand(["help"]), { type: "help" })
    assert.match(
        (parseCounterCommand(["add", "members", "<#5001>", "No placeholder"]) as { error: string }).error,
        /\{count\}/,
    )
    assert.ok("error" in parseCounterCommand(["add", "online", "<#5001>", "x {count}"]))
    assert.ok("error" in parseCounterCommand(["add", "role", "<#5001>", "x {count}"]))
    assert.ok(counterHelp.split("\n").length <= 10)
})

test("a template renders the count plainly and stays within a channel name's limit", () => {
    assert.equal(renderCounter("Members: {count}", 12345), "Members: 12345")
    assert.equal(renderCounter("{count} of {count}", 7), "7 of 7")
    const longest = `${"x".repeat(93)}{count}`
    assert.ok(Schema.is(CounterTemplate)(longest))
    assert.equal(renderCounter(longest, 1234567).length, 100)
    assert.ok(!Schema.is(CounterTemplate)(`${"x".repeat(94)}{count}`))
    assert.ok(!Schema.is(CounterTemplate)("No count"))
})

test("a counter renames only when the name differs, at its offset and every ten minutes, with no backend call per check", () =>
    run(
        Effect.gen(function* () {
            const channelId = "5001",
                { r, bot, serverId } = yield* started({ enabled: true, counters: [counter(channelId)] })
            let members = 40
            const channel = bot.rest.respond(`GET /channels/${channelId}`, () => ({
                body: channelOf(bot, channelId, name),
            }))
            let name = "Members: 40"
            const renames = bot.rest.respond(`PATCH /channels/${channelId}`, (request) => {
                name = (request.body as { name: string }).name
                return { body: channelOf(bot, channelId, name) }
            })
            yield* answerCounts(bot, serverId, () => members)
            yield* bot.ready()
            yield* settle(bot)
            assert.deepEqual(r.calls, ["query"])
            yield* toNextCheck(bot, serverId, true)
            assert.equal(channel.requests().length, 1)
            assert.equal(renames.requests().length, 0, "the same name is not sent again")
            members = 41
            yield* toNextCheck(bot, serverId, false)
            assert.deepEqual(
                renames.requests().map((request) => request.body),
                [{ name: "Members: 41" }],
            )
            assert.deepEqual(r.calls, ["query"], "a check makes no backend call")
            assert.equal(bot.failures().length, 0)
        }),
    ))

test("Fluxer's own normal form of a name does not cause a rename each check", () =>
    run(
        Effect.gen(function* () {
            const channelId = "5001",
                { bot, serverId } = yield* started({ enabled: true, counters: [counter(channelId)] })
            const normalized = "members 40"
            let current = "Old"
            bot.rest.respond(`GET /channels/${channelId}`, () => ({ body: channelOf(bot, channelId, current) }))
            const renames = bot.rest.respond(`PATCH /channels/${channelId}`, () => {
                current = normalized
                return { body: channelOf(bot, channelId, normalized) }
            })
            yield* answerCounts(bot, serverId, () => 40)
            yield* bot.ready()
            yield* settle(bot)
            yield* toNextCheck(bot, serverId, true)
            yield* toNextCheck(bot, serverId, false)
            assert.equal(renames.requests().length, 1)
        }),
    ))

test("a role counter reads Fluxer's member search once per role, and an index still building renames nothing", () =>
    run(
        Effect.gen(function* () {
            const roleId = "77",
                { bot, serverId } = yield* started({
                    enabled: true,
                    counters: [
                        counter("5001", { kind: "role", roleId, template: "Staff: {count}" }),
                        counter("5002", { kind: "role", roleId, template: "Team: {count}" }),
                    ],
                })
            let indexing = true
            const searches = bot.rest.respond("POST /guilds/:id/members-search", () => ({
                body: {
                    guild_id: serverId,
                    members: [],
                    page_result_count: 0,
                    total_result_count: 9,
                    indexing,
                },
            }))
            for (const id of ["5001", "5002"]) {
                bot.rest.respond(`GET /channels/${id}`, { body: channelOf(bot, id, "Old") })
            }
            const first = bot.rest.respond("PATCH /channels/5001", { body: channelOf(bot, "5001", "Staff: 9") }),
                second = bot.rest.respond("PATCH /channels/5002", { body: channelOf(bot, "5002", "Team: 9") })
            yield* bot.ready()
            yield* settle(bot)
            yield* toNextCheck(bot, serverId, true)
            assert.equal(first.requests().length, 0)
            indexing = false
            const before = searches.requests().length
            yield* toNextCheck(bot, serverId, false)
            assert.equal(searches.requests().length - before, 1)
            assert.deepEqual(first.requests()[0]!.body, { name: "Staff: 9" })
            assert.deepEqual(second.requests()[0]!.body, { name: "Team: 9" })
        }),
    ))

for (const [status, reason] of [
    [403, "permission"],
    [404, "channel"],
] as const)
    test(`a rename answered ${status} turns its counter off once, with a server note, and the timer stops`, () =>
        run(
            Effect.gen(function* () {
                const channelId = "5001",
                    { r, bot, serverId } = yield* started({ enabled: true, counters: [counter(channelId)] })
                bot.rest.respond(`GET /channels/${channelId}`, { body: channelOf(bot, channelId, "Old") })
                const renames = bot.rest.respond(`PATCH /channels/${channelId}`, { status })
                platform(bot, {})
                bot.rest.respond("GET /guilds/:id/channels", { body: [bot.fixtures.channel({ id: "5900", type: 0 })] })
                const notes = bot.rest.respond("POST /channels/:id/messages", {
                    body: bot.fixtures.message({ content: "note" }),
                })
                yield* answerCounts(bot, serverId, () => 40)
                yield* bot.ready()
                yield* settle(bot)
                yield* toNextCheck(bot, serverId, true)
                assert.deepEqual(r.blocked, [{ channelId, reason }])
                assert.equal(notes.requests().length, 1)
                assert.match((notes.requests()[0]!.body as { content: string }).content, /A counter is off/)
                yield* toNextCheck(bot, serverId, false)
                assert.equal(renames.requests().length, 1)
                assert.equal(r.blocked.length, 1)
            }),
        ))

test("a gone channel found by the read turns its counter off without a rename", () =>
    run(
        Effect.gen(function* () {
            const channelId = "5001",
                { r, bot, serverId } = yield* started({ enabled: true, counters: [counter(channelId)] })
            bot.rest.respond(`GET /channels/${channelId}`, { status: 404 })
            const renames = bot.rest.respond(`PATCH /channels/${channelId}`, { status: 500 })
            platform(bot, {})
            bot.rest.respond("POST /channels/:id/messages", { body: bot.fixtures.message({ content: "note" }) })
            yield* answerCounts(bot, serverId, () => 40)
            yield* bot.ready()
            yield* settle(bot)
            yield* toNextCheck(bot, serverId, true)
            assert.deepEqual(r.blocked, [{ channelId, reason: "channel" }])
            assert.equal(renames.requests().length, 0)
        }),
    ))

test("a rename with an unknown outcome shows as not confirmed, and the next check reads the channel before anything is sent", () =>
    run(
        Effect.gen(function* () {
            const channelId = "5001",
                { bot, serverId } = yield* started({ enabled: true, counters: [counter(channelId)] })
            // The rename took effect although its answer never came
            let current = "Old"
            const reads = bot.rest.respond(`GET /channels/${channelId}`, () => ({
                body: channelOf(bot, channelId, current),
            }))
            const renames = bot.rest.respond(`PATCH /channels/${channelId}`, () => {
                current = "Members: 40"
                return { status: 500 }
            })
            yield* answerCounts(bot, serverId, () => 40)
            yield* bot.ready()
            yield* settle(bot)
            yield* toNextCheck(bot, serverId, true)
            const sends = renames.requests().length
            assert.ok(sends >= 1)
            const runtime = counterRuntimes.get(serverId)!
            assert.equal(runtime.uncertain(channelId), true)
            const list = counterList({ enabled: true, counters: [counter(channelId)] }, "!", runtime.uncertain)
            assert.match(String(list.description), /not confirmed/)
            const readsBefore = reads.requests().length
            yield* toNextCheck(bot, serverId, false)
            assert.equal(reads.requests().length, readsBefore + 1)
            assert.equal(renames.requests().length, sends, "the name matches, so nothing is sent again")
            assert.equal(runtime.uncertain(channelId), false)
        }),
    ))

test("a server without counters runs no timer and makes no calls, and a dashboard change starts it", () =>
    run(
        Effect.gen(function* () {
            const channelId = "5001",
                { r, bot, serverId } = yield* started({ enabled: true, counters: [] })
            yield* answerCounts(bot, serverId, () => 40)
            yield* bot.ready()
            yield* settle(bot)
            const before = bot.requests().length
            yield* TestClock.adjust(3 * COUNTER_INTERVAL_MS)
            yield* settle(bot)
            assert.equal(bot.requests().length, before)
            assert.deepEqual(r.calls, ["query"])
            // The dashboard's change reaches the bot as a reload, which checks at once
            bot.rest.respond(`GET /channels/${channelId}`, { body: channelOf(bot, channelId, "Old") })
            const renames = bot.rest.respond(`PATCH /channels/${channelId}`, {
                body: channelOf(bot, channelId, "Members: 40"),
            })
            r.set({ enabled: true, counters: [counter(channelId)] })
            yield* reloadServerRuntime(bot.client, serverId, "counters")
            yield* settle(bot)
            assert.equal(renames.requests().length, 1)
            // Turned off, the timer stops and channels keep their names
            r.set({ enabled: false, counters: [counter(channelId)] })
            yield* reloadServerRuntime(bot.client, serverId, "counters")
            yield* TestClock.adjust(3 * COUNTER_INTERVAL_MS)
            yield* settle(bot)
            assert.equal(renames.requests().length, 1)
        }),
    ))

test("managers add, list, change and remove counters, while other members cannot", async () => {
    for (const manager of [false, true])
        await run(
            Effect.gen(function* () {
                const channelId = "5001",
                    { r, bot, serverId } = yield* started({ enabled: true, counters: [] })
                const p = platform(bot, {
                    actorOwner: false,
                    actorPermissions: manager ? Permissions.ManageGuild : Permissions.SendMessages,
                })
                bot.rest.respond(`GET /channels/${channelId}`, { body: channelOf(bot, channelId, "Old") })
                bot.rest.respond(`PATCH /channels/${channelId}`, {
                    body: channelOf(bot, channelId, "Members: 40"),
                })
                yield* answerCounts(bot, serverId, () => 40)
                yield* bot.ready()
                yield* settle(bot)
                const say = (content: string) =>
                    bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(settle(bot)))
                yield* say(`!counter add members <#${channelId}> "Members: {count}"`)
                if (!manager) {
                    assert.deepEqual(r.operations, [])
                    assert.match(
                        (p.replies.requests()[0]!.body as { content: string }).content,
                        /Only the server owner/,
                    )
                    return
                }
                yield* say(`!counter set <#${channelId}> "Now {count}"`)
                yield* say("!counter list")
                yield* say(`!counter remove <#${channelId}>`)
                yield* say("!counter module off")
                assert.deepEqual(r.operations, [
                    { type: "add", kind: "members", channelId, template: "Members: {count}" },
                    { type: "set", channelId, template: "Now {count}" },
                    { type: "remove", channelId },
                    { type: "module", enabled: false },
                ])
                const replies = p.replies
                    .requests()
                    .map((request) => (request.body as { content?: string }).content ?? "")
                assert.match(replies[0]!, /Counter saved/)
                assert.match(replies.at(-2)!, /no longer renames/)
                assert.match(replies.at(-1)!, /Counters are off/)
            }),
        )
})

const metadataStore = () => {
    const admissions: string[] = [],
        details: unknown[] = []
    const store = {
        admit: (input: { event: { type: string; auditAction?: number; details?: unknown } }) =>
            Effect.sync(() => {
                details.push(input.event.details)
                admissions.push(
                    input.event.auditAction === undefined ? input.event.type : `audit:${input.event.auditAction}`,
                )
                return { admitted: false, duplicate: false, reason: "excluded" } as const
            }),
        work: () => Effect.succeed({ type: "messages", logged: true, webhookPosts: false } as const),
    } as unknown as MetadataLogsStore
    return { store, admissions, details }
}
const channelUpdate = (bot: Bot, serverId: string, channel: object) =>
    bot.emit("CHANNEL_UPDATE", { ...channel, guild_id: serverId }).pipe(Effect.andThen(settle(bot)))
const auditEntry = (
    bot: Bot,
    serverId: string,
    entry: { userId: string; target: string; reason?: string; changes: object[] },
) =>
    bot
        .emit("GUILD_AUDIT_LOG_ENTRY_CREATE", {
            id: bot.fixtures.nextId(),
            guild_id: serverId,
            action_type: 11,
            user_id: entry.userId,
            target_id: entry.target,
            changes: entry.changes,
            ...(entry.reason ? { reason: entry.reason } : {}),
        })
        .pipe(Effect.andThen(settle(bot)))
const renamed = [{ key: "name", old_value: "Old", new_value: "Members: 40" }]
/** A bot whose one counter has just renamed its channel from Old to Members: 40 */
const renamedOnce = (type: number, stores: Parameters<typeof started>[1]) =>
    Effect.gen(function* () {
        const channelId = "5001",
            { r, bot, serverId } = yield* started({ enabled: true, counters: [counter(channelId)] }, stores)
        const raw = (name: string) => bot.fixtures.channel({ id: channelId, name, type })
        bot.rest.respond(`GET /channels/${channelId}`, { body: raw("Old") })
        const renames = bot.rest.respond(`PATCH /channels/${channelId}`, { body: raw("Members: 40") })
        yield* answerCounts(bot, serverId, () => 40)
        yield* bot.ready()
        yield* settle(bot)
        yield* toNextCheck(bot, serverId, true)
        assert.equal(renames.requests().length, 1)
        return { r, bot, serverId, channelId, raw }
    })
test("a counter's own rename stays out of metadata logs once, and staff restoring that name is logged", () =>
    run(
        Effect.gen(function* () {
            const logs = metadataStore(),
                { bot, serverId, raw } = yield* renamedOnce(2, { metadata: logs.store })
            yield* channelUpdate(bot, serverId, raw("Members: 40"))
            assert.deepEqual(logs.admissions, [])
            yield* channelUpdate(bot, serverId, raw("A member's name"))
            yield* channelUpdate(bot, serverId, raw("Members: 40"))
            assert.deepEqual(logs.admissions, ["channel-update", "channel-update"])
        }),
    ))

test("only an audit entry with a counter's reason stays out, so NeonFlux's other renames and staff's are logged", () =>
    run(
        Effect.gen(function* () {
            const logs = metadataStore(),
                { bot, serverId, channelId } = yield* renamedOnce(2, { metadata: logs.store }),
                botId = bot.fixtures.ids.bot,
                reason = COUNTER_AUDIT_REASON
            yield* auditEntry(bot, serverId, { userId: botId, target: channelId, reason, changes: renamed })
            assert.deepEqual(logs.admissions, [])
            // The structure editor renames as NeonFlux too, with no counter's reason, also while a channel has a counter
            yield* auditEntry(bot, serverId, { userId: botId, target: channelId, changes: renamed })
            yield* auditEntry(bot, serverId, {
                userId: bot.fixtures.ids.user,
                target: channelId,
                reason,
                changes: renamed,
            })
            yield* auditEntry(bot, serverId, {
                userId: botId,
                target: channelId,
                reason,
                changes: [...renamed, { key: "topic", new_value: "x" }],
            })
            assert.deepEqual(logs.admissions, ["audit:11", "audit:11", "audit:11"])
        }),
    ))

test("a counter's rename with logs off is still spent, so a later rename to that name counts as a change", () =>
    run(
        Effect.gen(function* () {
            let changes = 0
            const structure = {
                serverChanged: () =>
                    Effect.sync(() => {
                        changes++
                    }),
            } as unknown as StructureStore
            const { bot, serverId, raw } = yield* renamedOnce(2, { structure })
            yield* channelUpdate(bot, serverId, raw("Members: 40"))
            assert.equal(changes, 0)
            yield* channelUpdate(bot, serverId, raw("A member's name"))
            yield* channelUpdate(bot, serverId, raw("Members: 40"))
            assert.equal(changes, 2)
        }),
    ))

test("a category counter's rename leaves the structure editor's read current and forgets no channel", () =>
    run(
        Effect.gen(function* () {
            let changes = 0
            const structure = {
                    serverChanged: () =>
                        Effect.sync(() => {
                            changes++
                        }),
                } as unknown as StructureStore,
                logs = metadataStore(),
                { bot, serverId, raw } = yield* renamedOnce(4, { structure, metadata: logs.store })
            const other = (topic: string) => bot.fixtures.channel({ id: "5002", name: "general", type: 0, topic })
            yield* channelUpdate(bot, serverId, other("First"))
            const before = changes
            yield* channelUpdate(bot, serverId, raw("Members: 40"))
            assert.equal(changes, before, "no changed-server signal")
            yield* channelUpdate(bot, serverId, other("Second"))
            // The channel kept in memory is still compared
            assert.deepEqual(logs.details.at(-1), {
                changes: [{ field: "topic", before: "First", after: "Second" }],
            })
        }),
    ))

for (const [answer, text] of [
    [{ status: 403 }, /Manage nicknames/],
    [{ status: 400, body: { code: "TWO_FACTOR_REQUIRED", message: "Synthetic" } }, /two-factor/],
] as const)
    test(`adding a role counter whose count answers ${answer.status} is refused with why`, () =>
        run(
            Effect.gen(function* () {
                const { r, bot } = yield* started({ enabled: true, counters: [] })
                const p = platform(bot)
                const roleId = p.roles.at(-1)!.id
                bot.rest.respond("GET /channels/5001", { body: channelOf(bot, "5001", "Old") })
                bot.rest.respond("POST /guilds/:id/members-search", answer)
                yield* bot.ready()
                yield* settle(bot)
                yield* bot.emit(
                    "MESSAGE_CREATE",
                    bot.fixtures.message({ content: `!counter add role <@&${roleId}> <#5001> "Staff: {count}"` }),
                )
                yield* settle(bot)
                assert.deepEqual(r.operations, [])
                assert.match((p.replies.requests().at(-1)!.body as { content: string }).content, text)
            }),
        ))

test("a role count that turns unreadable is noted once and shown, and clears when a read works again", () =>
    run(
        Effect.gen(function* () {
            const channelId = "5001",
                { r, bot, serverId } = yield* started({
                    enabled: true,
                    counters: [counter(channelId, { kind: "role", roleId: "77", template: "Staff: {count}" })],
                })
            let refused = true
            bot.rest.respond("POST /guilds/:id/members-search", () =>
                refused
                    ? { status: 403 }
                    : {
                          body: {
                              guild_id: serverId,
                              members: [],
                              page_result_count: 0,
                              total_result_count: 9,
                              indexing: false,
                          },
                      },
            )
            bot.rest.respond(`GET /channels/${channelId}`, { body: channelOf(bot, channelId, "Staff: 9") })
            yield* bot.ready()
            yield* settle(bot)
            yield* toNextCheck(bot, serverId, true)
            yield* toNextCheck(bot, serverId, false)
            assert.deepEqual(r.counted, ["permission"])
            const runtime = counterRuntimes.get(serverId)!
            assert.equal(runtime.view().counters[0]!.enabled, true)
            assert.match(String(counterList(runtime.view(), "!", runtime.uncertain).description), /cannot be read/)
            refused = false
            yield* toNextCheck(bot, serverId, false)
            yield* toNextCheck(bot, serverId, false)
            assert.deepEqual(r.counted, ["permission", null])
            assert.doesNotMatch(
                String(counterList(runtime.view(), "!", runtime.uncertain).description),
                /cannot be read/,
            )
        }),
    ))
