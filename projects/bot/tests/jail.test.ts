import assert from "node:assert/strict"
import test from "node:test"
import type { JailMemory, JailProblem, JailSettings } from "@neonflux/contracts/jail"
import type { ModerationManageRequest, ModerationOutcomeRequest } from "@neonflux/contracts/moderation"
import { ChannelType, Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { jailCritical, parseJailCommand } from "../src/jail-command.ts"
import { jailCard } from "../src/jail-management.ts"
import { JAIL_CHANNEL_ALLOWED, JAIL_DENIED } from "../src/jail-permissions.ts"
import type { JailStore } from "../src/jail-store.ts"
import { ModerationStoreError, type ModerationStore } from "../src/moderation-store.ts"
import { parseSafetyCommand } from "../src/moderation-command.ts"
import type { RolesStore } from "../src/roles-store.ts"
import { reloadServerRuntime } from "../src/runtime-reload.ts"
import { boundary, caseGrant, platform, settings, token } from "./moderation-fixture.ts"

const now = Date.parse("2026-10-01T00:00:00Z")
const controlled = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) =>
    Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))
type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const emit = (bot: Bot, content: string, overrides = {}) =>
    bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content, ...overrides })).pipe(Effect.andThen(bot.idle()))
const JAIL_ROLE = "6000",
    JAIL_CHANNEL = "6100"
const onSettings: JailSettings = { enabled: true, roleId: JAIL_ROLE, channelId: JAIL_CHANNEL }

function fakeJail(memory: Partial<JailMemory> = {}) {
    const calls: { method: string; input: unknown }[] = []
    const reports: { state: string; total: number; done: number; problems: readonly JailProblem[] }[] = []
    const held: unknown[] = []
    let settings = memory.settings ?? onSettings
    const note = (method: string, input: unknown) => calls.push({ method, input })
    const due: string[][] = []
    const store: JailStore = {
        memory: (input) => {
            note("memory", input)
            return Effect.succeed({
                settings,
                moderationRoleIds: [],
                jailedIds: [],
                confinedIds: memory.confinedIds ?? memory.jailedIds ?? [],
                setupRunning: false,
                ...memory,
                ...(memory.settings ? {} : { settings }),
            })
        },
        status: (input) => {
            note("status", input)
            return Effect.succeed({ settings, setup: null, count: 0 })
        },
        list: (input) => {
            note("list", input)
            return Effect.succeed({ entries: [] })
        },
        manage: (input) => {
            note("manage", input)
            if (input.operation.type === "setup")
                settings = { enabled: true, roleId: input.operation.roleId, channelId: input.operation.channelId }
            if (input.operation.type === "module") settings = { ...settings, enabled: input.operation.enabled }
            return Effect.succeed({ settings })
        },
        report: (input) => {
            note("report", input)
            reports.push(input.setup)
            return Effect.succeed({ recorded: true })
        },
        due: (input) => {
            note("due", input)
            return Effect.succeed({ userIds: due.shift() ?? [] })
        },
        release: (input) => {
            note("release", input)
            return Effect.succeed({})
        },
        held: (input) => {
            note("held", input)
            held.push(input)
            return Effect.succeed({ admitted: false })
        },
    }
    return {
        store,
        calls,
        reports,
        held,
        due,
        count: (method: string) => calls.filter((c) => c.method === method).length,
    }
}
function start(
    run: (f: {
        bot: Bot
        p: ReturnType<typeof platform>
        jail: ReturnType<typeof fakeJail>
        roles: { calls: string[] }
        requests: ModerationManageRequest[]
        outcomes: ModerationOutcomeRequest[]
        setRoles: ReturnType<Bot["rest"]["respond"]>
        overwrites: ReturnType<Bot["rest"]["respond"]>
    }) => Effect.Effect<void, unknown, Scope.Scope>,
    options: {
        jail?: ReturnType<typeof fakeJail>
        manage?: ModerationStore["manage"]
        overrides?: Partial<ModerationStore>
        platform?: Parameters<typeof platform>[1]
        channels?: (bot: Bot) => unknown[]
        /** Routes the worker's first pass needs, which runs as soon as the bot is ready */
        beforeReady?: (bot: Bot) => void
        temporary?: never
    } = {},
) {
    const f = createFixtures(),
        jail = options.jail ?? fakeJail()
    const requests: ModerationManageRequest[] = [],
        outcomes: ModerationOutcomeRequest[] = []
    const b = boundary({
        manage: (input) => {
            requests.push(input)
            return (options.manage ?? ((request) => Effect.succeed(caseGrant(request))))(input)
        },
        outcome: (input) => {
            outcomes.push(input)
            return Effect.succeed({ recorded: true })
        },
        query: (input) =>
            input.operation.type === "jail-record"
                ? Effect.fail(new ModerationStoreError({ operation: "query", status: 404 }))
                : Effect.succeed({ type: "settings", settings: settings() }),
        ...options.overrides,
    })
    const roles = { calls: [] as string[] }
    const rolesStore = new Proxy({} as RolesStore, {
        get: (_target, key) => (input: unknown) => {
            roles.calls.push(String(key))
            return Effect.succeed(
                key === "policy"
                    ? { settings: { autoroleEnabled: false, verificationEnabled: false, humansOnly: false } }
                    : (input ?? {}),
            )
        },
    })
    return controlled(
        Effect.gen(function* () {
            yield* TestClock.adjust(`${now} millis`)
            const bot = yield* createTestBot(
                createBotOptions(
                    { token, serverId: f.ids.guild },
                    {
                        moderation: b.store,
                        jail: jail.store,
                        roles: rolesStore,
                        ...(options.temporary ? { temporaryRoles: options.temporary } : {}),
                    },
                ),
            )
            const p = platform(bot, {
                actorOwner: false,
                actorPermissions: Permissions.ManageRoles,
                moreRoles: [{ id: JAIL_ROLE, position: 5 }],
                ...options.platform,
            })
            bot.rest.respond("GET /guilds/:id/channels", { body: options.channels?.(bot) ?? [] })
            const setRoles = bot.rest.respond("PATCH /guilds/:id/members/:id", (request) => ({
                body: bot.fixtures.member({
                    user: bot.fixtures.user({ id: request.path.split("/").at(-1)! }),
                    roles: (request.body as { roles?: string[] }).roles ?? [],
                    communication_disabled_until: null,
                }),
            }))
            const overwrites = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
            options.beforeReady?.(bot)
            yield* bot.ready()
            yield* TestClock.adjust("1 millis")
            yield* bot.idle()
            yield* run({ bot, p, jail, roles, requests, outcomes, setRoles, overwrites })
        }),
    )
}
const replies = (p: ReturnType<typeof platform>) =>
    p.replies.requests().map((request) => (request.body as { content: string }).content)
/** The role edits, which a disconnect shares its route with */
const sentRoles = (route: ReturnType<Bot["rest"]["respond"]>) =>
    route
        .requests()
        .map((request) => (request.body as { roles?: string[] }).roles)
        .filter((roles) => roles !== undefined)
const disconnects = (route: ReturnType<Bot["rest"]["respond"]>) =>
    route.requests().filter((request) => (request.body as { roles?: string[] }).roles === undefined)

test("The grammar reads each form, and reading jail and turning it off are critical", () => {
    assert.deepEqual(parseJailCommand([]), { type: "status" })
    assert.deepEqual(parseJailCommand(["setup"]), { type: "setup" })
    assert.deepEqual(parseJailCommand(["setup", "<#5>"]), { type: "setup", channelId: "5" })
    assert.deepEqual(parseJailCommand(["role", "<@&5>"]), { type: "role", roleId: "5" })
    assert.deepEqual(parseJailCommand(["channel", "<#5>"]), { type: "channel", channelId: "5" })
    assert.deepEqual(parseJailCommand(["list", "next"]), { type: "list", next: true })
    assert.deepEqual(parseJailCommand(["module", "off"]), { type: "module", enabled: false })
    assert.ok("error" in parseJailCommand(["module", "maybe"]))
    assert.ok("error" in parseJailCommand(["role"]))
    assert.ok("error" in parseJailCommand(["setup", "nope"]))
    assert.equal(jailCritical(parseJailCommand(["status"])), true)
    assert.equal(jailCritical(parseJailCommand(["list"])), true)
    assert.equal(jailCritical(parseJailCommand(["module", "off"])), true)
    assert.equal(jailCritical(parseJailCommand(["module", "on"])), false)
    assert.equal(jailCritical(parseJailCommand(["setup"])), false)
    const jail = parseSafetyCommand("mod", ["jail", "<@9>", "2h", "for", "spam"])
    assert.deepEqual(jail, {
        kind: "action",
        action: { type: "jail", reason: "for spam", targetId: "9", durationSeconds: 7200 },
    })
    assert.deepEqual(parseSafetyCommand("mod", ["jail", "<@9>"]), {
        kind: "action",
        action: { type: "jail", targetId: "9" },
    })
    assert.deepEqual(parseSafetyCommand("mod", ["unjail", "<@9>", "done"]), {
        kind: "action",
        action: { type: "unjail", reason: "done", targetId: "9" },
    })
    // A mistyped length is never read as a reason on a jail with no end
    assert.ok("error" in parseSafetyCommand("mod", ["jail", "<@9>", "2x"]))
    assert.ok("error" in parseSafetyCommand("mod", ["jail", "<@9>", "30s"]))
})

test("Setup makes the role and channel, then denies the role every other channel and opens the jail channel to it and staff", async () => {
    const jail = fakeJail({ settings: { enabled: false, roleId: null, channelId: null }, moderationRoleIds: ["7000"] })
    await start(
        ({ bot, p, overwrites, jail }) =>
            Effect.gen(function* () {
                // Fluxer holds the role once it was made
                const made = bot.fixtures.role({ id: JAIL_ROLE, name: "Jailed", permissions: "0" })
                const roleCreate = bot.rest.respond("POST /guilds/:id/roles", () => {
                    p.roles.push(made)
                    return { body: made }
                })
                const channelCreate = bot.rest.respond("POST /guilds/:id/channels", {
                    body: bot.fixtures.channel({ id: JAIL_CHANNEL, name: "jail" }),
                })
                bot.rest.respond("GET /guilds/:id/channels", () => ({
                    body: [
                        // Fluxer holds the jail channel once it was made
                        ...(channelCreate.requests().length
                            ? [bot.fixtures.channel({ id: JAIL_CHANNEL, name: "jail", type: ChannelType.Text })]
                            : []),
                        bot.fixtures.channel({ id: "6201", type: ChannelType.Text, permission_overwrites: [] }),
                        bot.fixtures.channel({ id: "6202", type: ChannelType.Category, permission_overwrites: [] }),
                        // Already denied, so it needs no write
                        bot.fixtures.channel({
                            id: "6203",
                            type: ChannelType.Voice,
                            permission_overwrites: [
                                { id: JAIL_ROLE, type: 0, allow: "0", deny: JAIL_DENIED.toString() },
                            ],
                        }),
                    ],
                }))
                yield* emit(bot, "!jail setup")
                assert.equal(roleCreate.requests().length, 1)
                assert.equal((roleCreate.requests()[0]!.body as { permissions: string }).permissions, "0")
                assert.equal(channelCreate.requests().length, 1)
                assert.deepEqual(
                    (jail.calls.find((c) => c.method === "manage")!.input as { operation: unknown }).operation,
                    {
                        type: "setup",
                        roleId: JAIL_ROLE,
                        channelId: JAIL_CHANNEL,
                    },
                )
                assert.match(replies(p).at(-1)!, /Jail on with/)
                yield* TestClock.adjust("1 millis")
                yield* bot.idle()
                const writes = overwrites.requests().map((request) => ({
                    channel: request.path.split("/")[2],
                    id: request.path.split("/")[4],
                    allow: (request.body as { allow: string }).allow,
                    deny: (request.body as { deny: string }).deny,
                }))
                for (const channel of ["6201", "6202"])
                    assert.deepEqual(
                        writes.find((write) => write.channel === channel),
                        { channel, id: JAIL_ROLE, allow: "0", deny: JAIL_DENIED.toString() },
                    )
                assert.equal(
                    writes.some((write) => write.channel === "6203"),
                    false,
                )
                const inJail = writes.filter((write) => write.channel === JAIL_CHANNEL)
                assert.deepEqual(
                    inJail.find((write) => write.id === JAIL_ROLE),
                    { channel: JAIL_CHANNEL, id: JAIL_ROLE, allow: JAIL_CHANNEL_ALLOWED.toString(), deny: "0" },
                )
                assert.deepEqual(
                    inJail.find((write) => write.id === "7000"),
                    { channel: JAIL_CHANNEL, id: "7000", allow: JAIL_CHANNEL_ALLOWED.toString(), deny: "0" },
                )
                assert.equal(
                    inJail.find((write) => write.id === bot.fixtures.ids.guild)?.deny,
                    Permissions.ViewChannel.toString(),
                )
                // NeonFlux keeps its own way in before it hides the channel from everyone
                assert.equal(jail.reports.at(-1)?.state, "done")
                assert.equal(jail.reports.at(-1)?.total, 4)
                assert.equal(jail.reports.at(-1)?.done, 4)
            }),
        { jail, platform: { actorOwner: true, moreRoles: [] } },
    )
})

test("A channel it could not change is listed, not repeated, and the next setup reads it first", async () => {
    const jail = fakeJail({ setupRunning: true })
    let refused: ReturnType<Bot["rest"]["respond"]>
    await start(
        ({ bot, jail }) =>
            Effect.sync(() => {
                assert.equal(jail.reports.at(-1)?.state, "done")
                assert.deepEqual(jail.reports.at(-1)?.problems, [{ channelId: "6201", state: "failed" }])
                assert.equal(refused.requests().length, 1)
                assert.match(
                    JSON.stringify(
                        jailCard(
                            {
                                settings: onSettings,
                                setup: {
                                    state: "done",
                                    total: 4,
                                    done: 3,
                                    problems: [{ channelId: "6201", state: "failed" }],
                                    moreProblems: 0,
                                    updatedAt: now,
                                },
                                count: 2,
                            },
                            "!",
                        ),
                    ),
                    /<#6201>: Failed/,
                )
                assert.ok(bot.failures().length === 0)
            }),
        {
            jail,
            beforeReady: (bot) => {
                refused = bot.rest.respond("PUT /channels/6201/permissions/:id", {
                    status: 403,
                    body: { code: "MISSING_PERMISSIONS", message: "Synthetic refusal" },
                })
            },
            channels: (bot) => [
                bot.fixtures.channel({
                    id: JAIL_CHANNEL,
                    permission_overwrites: [
                        { id: JAIL_ROLE, type: 0, allow: JAIL_CHANNEL_ALLOWED.toString(), deny: "0" },
                        { id: bot.fixtures.ids.guild, type: 0, allow: "0", deny: Permissions.ViewChannel.toString() },
                    ],
                }),
                bot.fixtures.channel({ id: "6201" }),
            ],
        },
    )
})

const openChannel = (bot: Bot, id: string, overwrites: unknown[] = []) =>
    bot.fixtures.channel({ id, permission_overwrites: overwrites })
const privateChannelOf = (bot: Bot, id: string) =>
    openChannel(bot, id, [
        { id: bot.fixtures.ids.guild, type: 0, allow: "0", deny: Permissions.ViewChannel.toString() },
    ])
/** A channel event, then the wait the denial holds back for */
const seenAfterWait = (bot: Bot, event: "CHANNEL_CREATE" | "CHANNEL_UPDATE", channel: unknown) =>
    Effect.gen(function* () {
        yield* bot.emit(event, channel as never)
        yield* bot.idle()
        yield* TestClock.adjust("15 seconds")
        yield* bot.idle()
    })

test("With jail off and a member still jailed, channels stay closed to them, at the start and on a new channel", async () => {
    const off = fakeJail({
        settings: { enabled: false, roleId: JAIL_ROLE, channelId: JAIL_CHANNEL },
        jailedIds: ["6500"],
    })
    await start(
        ({ bot, overwrites }) =>
            Effect.gen(function* () {
                assert.ok(overwrites.requests().some((request) => request.path.includes("6201")))
                const before = overwrites.requests().length
                bot.rest.respond("GET /channels/6300", { body: openChannel(bot, "6300") })
                yield* seenAfterWait(bot, "CHANNEL_CREATE", openChannel(bot, "6300"))
                assert.equal(overwrites.requests().length, before + 1)
                assert.equal((overwrites.requests().at(-1)!.body as { deny: string }).deny, JAIL_DENIED.toString())
            }),
        { jail: off, channels: (bot) => [openChannel(bot, "6201")] },
    )
})

test("A public channel gets the denial only after a creating flow can finish reading it back, whichever arrives first", async () => {
    await start(({ bot, overwrites }) =>
        Effect.gen(function* () {
            const before = overwrites.requests().length
            const read = bot.rest.respond("GET /channels/6300", { body: openChannel(bot, "6300") })
            // The event comes first: The flow reads back within the wait and finds exactly what it wrote
            yield* bot.emit("CHANNEL_CREATE", openChannel(bot, "6300"))
            yield* bot.idle()
            yield* TestClock.adjust("14 seconds")
            yield* bot.idle()
            assert.equal(overwrites.requests().length, before)
            assert.equal(read.requests().length, 0)
            yield* TestClock.adjust("1 seconds")
            yield* bot.idle()
            assert.equal(overwrites.requests().length, before + 1)
            assert.equal((overwrites.requests().at(-1)!.body as { deny: string }).deny, JAIL_DENIED.toString())
            // The flow finished first: The event finds a channel it may change right after the same wait, and one with the denial needs nothing
            const denied = openChannel(bot, "6301", [
                { id: JAIL_ROLE, type: 0, allow: "0", deny: JAIL_DENIED.toString() },
            ])
            yield* seenAfterWait(bot, "CHANNEL_CREATE", denied)
            assert.equal(overwrites.requests().length, before + 1)
        }),
    )
})

test("A channel the everyone role cannot view, such as a private ticket, gets no denial and no read", async () => {
    await start(
        ({ bot, overwrites }) =>
            Effect.gen(function* () {
                // The start pass left the private channel alone too
                assert.equal(
                    overwrites.requests().some((request) => request.path.includes("6202")),
                    false,
                )
                const before = overwrites.requests().length
                const read = bot.rest.respond("GET /channels/6300", { body: privateChannelOf(bot, "6300") })
                yield* seenAfterWait(bot, "CHANNEL_CREATE", privateChannelOf(bot, "6300"))
                assert.equal(overwrites.requests().length, before)
                assert.equal(read.requests().length, 0)
            }),
        { channels: (bot) => [privateChannelOf(bot, "6202")] },
    )
})

test("A deleted jail role gets no more overwrites, from a channel event or a start, until setup makes a new one", async () => {
    const gone = fakeJail({ settings: { enabled: true, roleId: "6999", channelId: JAIL_CHANNEL }, setupRunning: true })
    await start(
        ({ bot, overwrites, jail, p }) =>
            Effect.gen(function* () {
                // The pass at the start wrote nothing and ended a setup it could not finish
                assert.equal(overwrites.requests().length, 0)
                assert.equal(jail.reports.at(-1)?.state, "done")
                bot.rest.respond("GET /channels/6300", { body: openChannel(bot, "6300") })
                yield* seenAfterWait(bot, "CHANNEL_CREATE", openChannel(bot, "6300"))
                yield* seenAfterWait(bot, "CHANNEL_UPDATE", openChannel(bot, "6300"))
                assert.equal(overwrites.requests().length, 0)
                // The same channel is written once a role of that ID exists again, so the guard reads fresh and not memory
                p.roles.push(bot.fixtures.role({ id: "6999", position: 5, permissions: "0" }))
                yield* seenAfterWait(bot, "CHANNEL_UPDATE", openChannel(bot, "6300"))
                assert.equal(overwrites.requests().length, 1)
            }),
        { jail: gone, channels: (bot) => [openChannel(bot, "6201")] },
    )
})

test("A channel opened to everyone later gets the denial, and one closed again during the wait does not", async () => {
    await start(({ bot, overwrites }) =>
        Effect.gen(function* () {
            const before = overwrites.requests().length
            bot.rest.respond("GET /channels/6300", { body: openChannel(bot, "6300") })
            yield* seenAfterWait(bot, "CHANNEL_UPDATE", openChannel(bot, "6300"))
            assert.equal(overwrites.requests().length, before + 1)
            bot.rest.respond("GET /channels/6301", { body: privateChannelOf(bot, "6301") })
            yield* seenAfterWait(bot, "CHANNEL_UPDATE", openChannel(bot, "6301"))
            assert.equal(overwrites.requests().length, before + 1)
        }),
    )
})

test("A channel the jail role cannot be denied is listed for !jail status", async () => {
    await start(({ bot, jail }) =>
        Effect.gen(function* () {
            bot.rest.respond("GET /channels/6300", { body: openChannel(bot, "6300") })
            bot.rest.respond("PUT /channels/6300/permissions/:id", {
                status: 403,
                body: { code: "MISSING_PERMISSIONS", message: "Synthetic refusal" },
            })
            yield* seenAfterWait(bot, "CHANNEL_CREATE", openChannel(bot, "6300"))
            assert.deepEqual(jail.reports.at(-1)?.problems, [{ channelId: "6300", state: "failed" }])
        }),
    )
})

test("A new channel costs nothing while jail is off and nobody is jailed", async () => {
    const off = fakeJail({ settings: { enabled: false, roleId: JAIL_ROLE, channelId: JAIL_CHANNEL } })
    await start(
        ({ bot, overwrites, jail }) =>
            Effect.gen(function* () {
                const calls = jail.calls.length
                yield* seenAfterWait(bot, "CHANNEL_CREATE", openChannel(bot, "6300"))
                assert.equal(overwrites.requests().length, 0)
                assert.equal(jail.calls.length, calls)
            }),
        { jail: off },
    )
})

test("A confirmed jail disconnects the member from voice once when NeonFlux holds Move members", async () => {
    const manage: ModerationStore["manage"] = (input) =>
        Effect.succeed(
            caseGrant(input, {
                jailRoleId: JAIL_ROLE,
                expectedRoleIds: (input.operation as { context: { targetRoleIds: string[] } }).context.targetRoleIds,
            }),
        )
    await start(
        ({ bot, p, setRoles }) =>
            Effect.gen(function* () {
                yield* emit(bot, `!mod jail ${p.targetId}`)
                assert.deepEqual(sentRoles(setRoles), [[JAIL_ROLE]])
                assert.equal(disconnects(setRoles).length, 1)
                assert.deepEqual(disconnects(setRoles)[0]!.body, { channel_id: null })
            }),
        { manage },
    )
    // Without the permission it stays out, and a jail with an unknown outcome never reaches it
    await start(
        ({ bot, p, setRoles }) =>
            Effect.gen(function* () {
                yield* emit(bot, `!mod jail ${p.targetId}`)
                assert.deepEqual(sentRoles(setRoles), [[JAIL_ROLE]])
                assert.equal(disconnects(setRoles).length, 0)
            }),
        { manage, platform: { botPermissions: Permissions.ManageRoles } },
    )
    // A failed disconnect leaves the jail as it is, and is not sent again
    await start(
        ({ bot, p, outcomes, setRoles }) =>
            Effect.gen(function* () {
                let edits = 0
                const refusing = bot.rest.respond("PATCH /guilds/:id/members/:id", (request) =>
                    ++edits === 1
                        ? {
                              body: bot.fixtures.member({
                                  user: bot.fixtures.user({ id: p.targetId }),
                                  roles: (request.body as { roles: string[] }).roles,
                                  communication_disabled_until: null,
                              }),
                          }
                        : { status: 400, body: { code: "NOT_CONNECTED", message: "Synthetic refusal" } },
                )
                yield* emit(bot, `!mod jail ${p.targetId}`)
                assert.equal(outcomes.at(-1)?.outcome, "succeeded")
                assert.equal(refusing.requests().length, 2)
                assert.equal(setRoles.requests().length, 0)
            }),
        { manage },
    )
})

test("A jail reads the member's roles fresh, sends them first and sets exactly the jail role in one edit", async () => {
    await start(
        ({ bot, p, requests, setRoles, outcomes }) =>
            Effect.gen(function* () {
                yield* emit(bot, `!mod jail ${p.targetId} 2h spamming`)
                const operation = requests[0]!.operation as {
                    action: { type: string; durationSeconds: number }
                    context: { targetRoleIds?: string[] }
                }
                assert.equal(operation.action.type, "jail")
                assert.equal(operation.action.durationSeconds, 7200)
                assert.deepEqual(operation.context.targetRoleIds, [p.targetRole.id])
                assert.deepEqual(sentRoles(setRoles), [[JAIL_ROLE]])
                // A timeout is left alone: Only the roles are in the edit
                assert.deepEqual(Object.keys(setRoles.requests()[0]!.body as object), ["roles"])
                assert.equal(outcomes.at(-1)?.outcome, "succeeded")
                assert.match(replies(p).at(-1)!, /Jail of <@\d+> for 2 hours succeeded/)
            }),
        {
            manage: (input) =>
                Effect.succeed(
                    caseGrant(input, {
                        jailRoleId: JAIL_ROLE,
                        expectedRoleIds: (input.operation as { context: { targetRoleIds: string[] } }).context
                            .targetRoleIds,
                    }),
                ),
            channels: () => [],
        },
    )
})

test("Status reads fresh and says when the role or channel is gone, and only then suggests setup", async () => {
    const off = fakeJail({ settings: { enabled: false, roleId: "6999", channelId: "6998" } })
    await start(
        ({ bot, p }) =>
            Effect.gen(function* () {
                bot.rest.respond("GET /channels/6998", {
                    status: 404,
                    body: { code: "UNKNOWN_CHANNEL", message: "Synthetic absence" },
                })
                yield* emit(bot, "!jail status")
                const shown = JSON.stringify(p.replies.requests().at(-1)!.body)
                assert.match(shown, /Deleted/)
                assert.match(shown, /gone/)
                assert.match(shown, /jail setup/)
                assert.doesNotMatch(shown, /mod jail/)
            }),
        { jail: off },
    )
    const card = JSON.stringify(jailCard({ settings: { ...onSettings, enabled: false }, setup: null, count: 0 }, "!"))
    assert.match(card, /jail module on/)
    assert.doesNotMatch(card, /mod jail/)
})

test("A later jail writes nothing, and roles that changed since the read stop a first one", async () => {
    await start(
        ({ bot, p, setRoles, outcomes }) =>
            Effect.gen(function* () {
                yield* emit(bot, `!mod jail ${p.targetId} longer now`)
                assert.equal(setRoles.requests().length, 0)
                assert.equal(outcomes.at(-1)?.outcome, "succeeded")
            }),
        { manage: (input) => Effect.succeed(caseGrant(input)) },
    )
    await start(
        ({ bot, p, setRoles, outcomes }) =>
            Effect.gen(function* () {
                yield* emit(bot, `!mod jail ${p.targetId}`)
                assert.equal(setRoles.requests().length, 0)
                assert.equal(outcomes.at(-1)?.outcome, "failed")
            }),
        {
            manage: (input) => Effect.succeed(caseGrant(input, { jailRoleId: JAIL_ROLE, expectedRoleIds: ["1", "2"] })),
        },
    )
})

test("Jail is refused on the owner, an Administrator, a higher-ranked member, and a member holding a role above NeonFlux", async () => {
    const context = (request: ModerationManageRequest) =>
        (
            request.operation as {
                context: { targetProtected: boolean; actorCanManageTarget: boolean; botCanManageTarget: boolean }
            }
        ).context
    await start(
        ({ bot, p, requests, setRoles }) =>
            Effect.gen(function* () {
                yield* emit(bot, `!mod jail ${p.targetId}`)
                assert.equal(context(requests[0]!).targetProtected, true)
                assert.equal(setRoles.requests().length, 0)
            }),
        {
            platform: { targetPermissions: Permissions.Administrator },
            manage: () => Effect.fail(new ModerationStoreError({ operation: "manage", status: 403 })),
        },
    )
    await start(
        ({ bot, p, requests }) =>
            Effect.gen(function* () {
                yield* emit(bot, `!mod jail ${p.targetId}`)
                assert.equal(context(requests[0]!).actorCanManageTarget, false)
                assert.equal(context(requests[0]!).botCanManageTarget, true)
            }),
        { platform: { targetPosition: 15 } },
    )
    await start(
        ({ bot, p, requests }) =>
            Effect.gen(function* () {
                yield* emit(bot, `!mod jail ${p.targetId}`)
                assert.equal(context(requests[0]!).botCanManageTarget, false)
            }),
        { platform: { targetPosition: 25, actorOwner: true } },
    )
})

test("An unjail sets the stored roles back in one edit, leaving out and naming a deleted role and one above NeonFlux", async () => {
    let stored: string[] = []
    await start(
        ({ bot, p, setRoles, outcomes }) =>
            Effect.gen(function* () {
                stored = [p.targetRole.id, p.botRole.id, "999999"]
                yield* emit(bot, `!mod unjail ${p.targetId} served`)
                assert.deepEqual(sentRoles(setRoles), [[p.targetRole.id]])
                assert.equal(outcomes.at(-1)?.outcome, "succeeded")
                const text = replies(p).at(-1)!
                assert.match(text, /Unjail of <@\d+> succeeded/)
                assert.match(text, new RegExp(`Left out: <@&${p.botRole.id}>, role 999999`))
            }),
        {
            manage: (input) => Effect.succeed(caseGrant(input, { restoreRoleIds: stored })),
            overrides: {
                query: () => Effect.succeed({ type: "jail-record", roleIds: stored }),
            },
            platform: { actorOwner: true },
        },
    )
})

test("A low-ranked moderator cannot unjail a member whose stored roles outrank them", async () => {
    let stored: string[] = []
    await start(
        ({ bot, p, requests, setRoles }) =>
            Effect.gen(function* () {
                stored = [p.botRole.id]
                yield* emit(bot, `!mod unjail ${p.targetId}`)
                const context = requests[0]!.operation as { context: { actorCanManageTarget: boolean } }
                assert.equal(context.context.actorCanManageTarget, false)
                assert.equal(setRoles.requests().length, 0)
            }),
        {
            manage: () => Effect.fail(new ModerationStoreError({ operation: "manage", status: 403 })),
            overrides: { query: () => Effect.succeed({ type: "jail-record", roleIds: stored }) },
        },
    )
})

test("A later jail with a short length is a release a minute later, so a low-ranked moderator cannot use one on a senior member", async () => {
    let stored: string[] = []
    await start(
        ({ bot, p, requests, setRoles }) =>
            Effect.gen(function* () {
                stored = [p.botRole.id]
                yield* emit(bot, `!mod jail ${p.targetId} 1m shorter`)
                const context = requests[0]!.operation as { context: { actorCanManageTarget: boolean } }
                assert.equal(context.context.actorCanManageTarget, false)
                assert.equal(setRoles.requests().length, 0)
            }),
        {
            manage: () => Effect.fail(new ModerationStoreError({ operation: "manage", status: 403 })),
            overrides: { query: () => Effect.succeed({ type: "jail-record", roleIds: stored }) },
        },
    )
    // A moderator who outranks the stored roles may change the length
    await start(
        ({ bot, p, requests }) =>
            Effect.gen(function* () {
                stored = [p.targetRole.id]
                yield* emit(bot, `!mod jail ${p.targetId} 1m shorter`)
                const context = requests[0]!.operation as { context: { actorCanManageTarget: boolean } }
                assert.equal(context.context.actorCanManageTarget, true)
            }),
        {
            manage: (input) => Effect.succeed(caseGrant(input)),
            overrides: { query: () => Effect.succeed({ type: "jail-record", roleIds: stored }) },
        },
    )
})

test("A jail with an unknown outcome keeps the command gate on, while nothing sends its edit again", async () => {
    const f = createFixtures()
    const jail = fakeJail({ jailedIds: [], confinedIds: [f.ids.user] })
    await start(
        ({ bot, p, setRoles, requests }) =>
            Effect.gen(function* () {
                yield* emit(bot, "!lfg create x")
                assert.match(replies(p).at(-1)!, /You are jailed/)
                assert.equal(requests.length, 0)
                yield* bot.emit("GUILD_MEMBER_UPDATE", member(bot, f.ids.user, ["6601"]))
                yield* bot.idle()
                assert.equal(setRoles.requests().length, 0)
            }),
        { jail },
    )
})

test("An unjail whose dispatch fails keeps the hold, so a rejoin is still set back", async () => {
    let dispatches = 0
    let stored: string[] = []
    await start(
        ({ bot, p, setRoles }) =>
            Effect.gen(function* () {
                stored = [p.targetRole.id]
                yield* emit(bot, `!mod jail ${p.targetId}`)
                assert.deepEqual(sentRoles(setRoles), [[JAIL_ROLE]])
                yield* emit(bot, `!mod unjail ${p.targetId}`)
                assert.equal(dispatches, 2)
                assert.deepEqual(sentRoles(setRoles), [[JAIL_ROLE]])
                yield* bot.emit("GUILD_MEMBER_ADD", {
                    ...member(bot, p.targetId, []),
                    guild_id: bot.fixtures.ids.guild,
                })
                yield* bot.idle()
                assert.deepEqual(sentRoles(setRoles), [[JAIL_ROLE], [JAIL_ROLE]])
            }),
        {
            manage: (input) => {
                const action = input.operation as { action: { type: string }; context: { targetRoleIds?: string[] } }
                return Effect.succeed(
                    caseGrant(
                        input,
                        action.action.type === "jail"
                            ? { jailRoleId: JAIL_ROLE, expectedRoleIds: action.context.targetRoleIds ?? [] }
                            : { restoreRoleIds: stored },
                    ),
                )
            },
            overrides: {
                query: () => Effect.succeed({ type: "jail-record", roleIds: [] }),
                dispatch: () =>
                    ++dispatches === 1
                        ? Effect.succeed({ recorded: false })
                        : Effect.fail(new ModerationStoreError({ operation: "dispatch", status: 503 })),
            },
        },
    )
})

test("A jailed rejoin moves the member's temporary roles to the new membership, and an ordinary join still does", async () => {
    const jail = fakeJail({ jailedIds: ["6500"] })
    const works: { type: string; userId?: string }[] = []
    const temporary = {
        manage: () => Effect.die("unused"),
        query: () => Effect.die("unused"),
        work: (input: { operation: { type: string; userId?: string } }) => {
            works.push(input.operation)
            return Effect.succeed({ type: "grants", grants: [], held: true })
        },
    } as never
    await start(
        ({ bot, setRoles }) =>
            Effect.gen(function* () {
                works.length = 0
                yield* bot.emit("GUILD_MEMBER_ADD", { ...member(bot, "6500", []), guild_id: bot.fixtures.ids.guild })
                yield* bot.idle()
                assert.deepEqual(sentRoles(setRoles), [[JAIL_ROLE]])
                assert.deepEqual(
                    works.filter((work) => work.type === "rejoin").map((work) => work.userId),
                    ["6500"],
                )
            }),
        { jail, temporary },
    )
})

test("A jailed member may run only a few commands, from memory, and everyone else pays nothing", async () => {
    const f = createFixtures()
    const jail = fakeJail({ jailedIds: [f.ids.user] })
    await start(
        ({ bot, p, requests, jail }) =>
            Effect.gen(function* () {
                const calls = jail.calls.length
                for (const content of [
                    "!mod warn 123",
                    "!lfg create x",
                    "!jail status",
                    "!voice lock",
                    "!customword",
                ]) {
                    const before = p.replies.requests().length
                    yield* emit(bot, content)
                    assert.equal(p.replies.requests().length, before + 1, content)
                    assert.match(replies(p).at(-1)!, /You are jailed, so only/, content)
                }
                assert.equal(requests.length, 0)
                assert.equal(jail.calls.length, calls)
                yield* emit(bot, "!ping")
                assert.equal(replies(p).at(-1), "Pong!")
                // Plain text is not a command, so it gets no line
                const before = p.replies.requests().length
                yield* emit(bot, "just talking")
                assert.equal(p.replies.requests().length, before)
            }),
        { jail },
    )
    const other = fakeJail({ jailedIds: ["6500"] })
    await start(
        ({ bot, p }) =>
            Effect.gen(function* () {
                yield* emit(bot, "!jail status")
                assert.doesNotMatch(JSON.stringify(p.replies.requests().at(-1)!.body), /You are jailed/)
            }),
        { jail: other },
    )
})

test("Who is jailed goes by DM outside a staff channel, and stays in a channel only staff can view", async () => {
    await start(
        ({ bot, p, jail }) =>
            Effect.gen(function* () {
                yield* emit(bot, "!jail list")
                assert.match(replies(p).at(-1)!, /Details sent by DM/)
                const asked = jail.calls.find((call) => call.method === "list")!.input as Record<string, unknown>
                assert.equal(asked.privateChannelVerified, true)
                assert.equal(asked.staffChannelRoleIds, undefined)
            }),
        { platform: { everyonePermissions: Permissions.ViewChannel } },
    )
    await start(({ bot, jail }) =>
        Effect.gen(function* () {
            yield* emit(bot, "!jail list")
            const asked = jail.calls.find((call) => call.method === "list")!.input as Record<string, unknown>
            assert.equal(asked.privateChannelVerified, undefined)
            assert.deepEqual(asked.staffChannelRoleIds, [])
        }),
    )
})

test("A new moderation staff role reads the jail channel without a restart, from a chat change or a dashboard one", async () => {
    const jail = fakeJail()
    let staffNow: string[] = []
    const fresh = {
        ...jail,
        store: {
            ...jail.store,
            memory: (input: Parameters<JailStore["memory"]>[0]) =>
                jail.store.memory(input).pipe(Effect.map((memory) => ({ ...memory, moderationRoleIds: staffNow }))),
        },
    }
    await start(
        ({ bot, overwrites }) =>
            Effect.gen(function* () {
                const opened = () =>
                    overwrites
                        .requests()
                        .filter((request) => request.path.split("/")[2] === JAIL_CHANNEL)
                        .map((request) => request.path.split("/")[4])
                assert.equal(opened().includes("7001"), false)
                staffNow = ["7001"]
                yield* emit(bot, "!mod staff moderation <@&7001>")
                assert.ok(opened().includes("7001"))
                staffNow = ["7001", "7002"]
                yield* reloadServerRuntime(bot.client as never, bot.fixtures.ids.guild, "moderation")
                yield* bot.idle()
                assert.ok(opened().includes("7002"))
            }),
        {
            jail: fresh,
            manage: () => Effect.succeed({ duplicate: false, type: "settings", settings: settings() }),
            platform: {
                actorOwner: true,
                moreRoles: [
                    { id: JAIL_ROLE, position: 5 },
                    { id: "7001", position: 2 },
                    { id: "7002", position: 2 },
                ],
            },
            channels: (bot) => [
                bot.fixtures.channel({
                    id: JAIL_CHANNEL,
                    permission_overwrites: [
                        { id: JAIL_ROLE, type: 0, allow: JAIL_CHANNEL_ALLOWED.toString(), deny: "0" },
                        { id: bot.fixtures.ids.guild, type: 0, allow: "0", deny: Permissions.ViewChannel.toString() },
                    ],
                }),
            ],
        },
    )
})

test("A member who left has no edit: The unjail ends the record", async () => {
    await start(
        ({ bot, p, setRoles, outcomes }) =>
            Effect.gen(function* () {
                bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${p.targetId}`, {
                    status: 404,
                    body: { code: "UNKNOWN_MEMBER", message: "Synthetic absence" },
                })
                yield* emit(bot, `!mod unjail ${p.targetId}`)
                assert.equal(setRoles.requests().length, 0)
                assert.equal(outcomes.at(-1)?.outcome, "succeeded")
            }),
        {
            manage: (input) => Effect.succeed(caseGrant(input, { restoreRoleIds: ["1"] })),
            overrides: { query: () => Effect.succeed({ type: "jail-record", roleIds: ["1"] }) },
        },
    )
})

test("An edit with an unknown outcome is never repeated, and a recovery check only reads the member", async () => {
    const jail = fakeJail()
    await start(
        ({ bot, p, outcomes }) =>
            Effect.gen(function* () {
                const edits = bot.rest.respond("PATCH /guilds/:id/members/:id", {
                    status: 500,
                    body: { code: "UNKNOWN", message: "Synthetic failure" },
                })
                yield* emit(bot, `!mod jail ${p.targetId}`)
                const sent = edits.requests().length
                assert.ok(sent >= 1)
                assert.equal(outcomes.at(-1)?.outcome, "uncertain")
                assert.match(replies(p).at(-1)!, /is not confirmed yet/)
                // The member is not held on a doubt, so a member update or a rejoin never sends the edit again
                yield* bot.emit("GUILD_MEMBER_UPDATE", member(bot, p.targetId, [p.targetRole.id]))
                yield* bot.idle()
                assert.equal(edits.requests().length, sent)
                yield* bot.emit("GUILD_MEMBER_ADD", {
                    ...member(bot, p.targetId, []),
                    guild_id: bot.fixtures.ids.guild,
                })
                yield* bot.idle()
                assert.equal(edits.requests().length, sent)
                yield* emit(bot, "just talking")
                assert.equal(edits.requests().length, sent)
            }),
        {
            jail,
            manage: (input) =>
                Effect.succeed(
                    caseGrant(input, {
                        jailRoleId: JAIL_ROLE,
                        expectedRoleIds: (input.operation as { context: { targetRoleIds: string[] } }).context
                            .targetRoleIds,
                    }),
                ),
        },
    )
})

const member = (bot: Bot, userId: string, roles: string[]) =>
    bot.fixtures.member({
        user: bot.fixtures.user({ id: userId }),
        roles,
        joined_at: new Date(now).toISOString(),
        communication_disabled_until: null,
    })

test("A jailed member who rejoins is set to the jail role right away, and autorole, verification and temporary roles skip them", async () => {
    const jail = fakeJail({ jailedIds: ["6500"] })
    await start(
        ({ bot, setRoles, jail, roles }) =>
            Effect.gen(function* () {
                roles.calls.length = 0
                yield* bot.emit("GUILD_MEMBER_ADD", member(bot, "6500", []))
                yield* bot.idle()
                assert.deepEqual(sentRoles(setRoles), [[JAIL_ROLE]])
                assert.deepEqual(roles.calls, [])
                assert.equal(jail.held.length, 1)
                assert.deepEqual(
                    {
                        kind: (jail.held[0] as { kind: string }).kind,
                        outcome: (jail.held[0] as { outcome: string }).outcome,
                    },
                    { kind: "rejoin", outcome: "succeeded" },
                )
            }),
        { jail },
    )
})

test("An ordinary join reads memory only: No jail call and no edit", async () => {
    const jail = fakeJail({ jailedIds: ["6500"] })
    await start(
        ({ bot, setRoles, jail, roles }) =>
            Effect.gen(function* () {
                const calls = jail.calls.length
                roles.calls.length = 0
                yield* bot.emit("GUILD_MEMBER_ADD", member(bot, "6501", []))
                yield* bot.idle()
                assert.equal(setRoles.requests().length, 0)
                assert.equal(jail.calls.length, calls)
                // The features that give roles run for this member, as they skip the jailed one above
                assert.deepEqual(roles.calls, ["policy"])
            }),
        { jail },
    )
})

test("A role added to a jailed member goes again in one edit, without touching the stored roles, and is logged", async () => {
    const jail = fakeJail({ jailedIds: ["6500"] })
    await start(
        ({ bot, setRoles, jail, requests }) =>
            Effect.gen(function* () {
                yield* bot.emit("GUILD_MEMBER_UPDATE", member(bot, "6500", [JAIL_ROLE, "6601"]))
                yield* bot.idle()
                assert.deepEqual(sentRoles(setRoles), [[JAIL_ROLE]])
                assert.equal((jail.held[0] as { kind: string }).kind, "stripped")
                assert.equal(requests.length, 0)
                // Its own edit's update holds only the jail role, so nothing loops
                yield* bot.emit("GUILD_MEMBER_UPDATE", member(bot, "6500", [JAIL_ROLE]))
                yield* bot.idle()
                assert.equal(setRoles.requests().length, 1)
                // Nobody else is touched, and it costs no call
                const calls = jail.calls.length
                yield* bot.emit("GUILD_MEMBER_UPDATE", member(bot, "6502", ["6601"]))
                yield* bot.idle()
                assert.equal(setRoles.requests().length, 1)
                assert.equal(jail.calls.length, calls)
            }),
        { jail },
    )
})

test("A release lets the member go before its edit, so the update it causes is not taken back", async () => {
    const jail = fakeJail({ jailedIds: [] })
    let stored: string[] = []
    await start(
        ({ bot, p, setRoles }) =>
            Effect.gen(function* () {
                stored = [p.targetRole.id]
                yield* emit(bot, `!mod jail ${p.targetId}`)
                assert.deepEqual(sentRoles(setRoles), [[JAIL_ROLE]])
                yield* emit(bot, `!mod unjail ${p.targetId}`)
                assert.deepEqual(sentRoles(setRoles).at(-1), [p.targetRole.id])
                const edits = setRoles.requests().length
                yield* bot.emit("GUILD_MEMBER_UPDATE", member(bot, p.targetId, [p.targetRole.id]))
                yield* bot.idle()
                assert.equal(setRoles.requests().length, edits)
            }),
        {
            jail,
            manage: (input) => {
                const action = input.operation as { action: { type: string }; context: { targetRoleIds?: string[] } }
                return Effect.succeed(
                    caseGrant(
                        input,
                        action.action.type === "jail"
                            ? { jailRoleId: JAIL_ROLE, expectedRoleIds: action.context.targetRoleIds ?? [] }
                            : { restoreRoleIds: stored },
                    ),
                )
            },
            overrides: { query: () => Effect.succeed({ type: "jail-record", roleIds: stored }) },
        },
    )
})

test("A jail whose length ended is released by the worker, from a fresh read, with no staff member behind it", async () => {
    const base = fakeJail({ jailedIds: ["6500"] })
    base.due.push(["6500"])
    const outcomes: ModerationOutcomeRequest[] = []
    let stored: string[] = []
    const jail = {
        ...base,
        store: {
            ...base.store,
            release: (input: Parameters<JailStore["release"]>[0]) =>
                base.store.release(input).pipe(
                    Effect.as({
                        grant: {
                            actionId: "synthetic_release",
                            caseNo: 7,
                            sourceId: "jail:1",
                            action: "unjail" as const,
                            targetId: "6500",
                            reason: "Jail length ended",
                            restoreRoleIds: stored,
                        },
                    }),
                ),
        },
    }
    await start(
        ({ bot, setRoles }) =>
            Effect.gen(function* () {
                // The first pass ran at the start, and the dispatcher's wake reads the same work
                assert.equal(base.count("release"), 1)
                assert.equal(bot.failures().length, 0)
                assert.deepEqual(sentRoles(setRoles), [stored])
                assert.equal(outcomes.at(-1)?.outcome, "succeeded")
                yield* bot.idle()
            }),
        {
            jail,
            overrides: {
                outcome: (input) => {
                    outcomes.push(input)
                    return Effect.succeed({ recorded: true })
                },
            },
            beforeReady: (bot) => {
                stored = ["7100"]
                bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/6500`, {
                    body: member(bot, "6500", [JAIL_ROLE]),
                })
            },
            platform: {
                actorPermissions: Permissions.ManageRoles,
                moreRoles: [
                    { id: JAIL_ROLE, position: 5 },
                    { id: "7100", position: 3 },
                ],
            },
        },
    )
})

test("A failed start does not leave a rejoin free: The next member event loads again", async () => {
    const jail = fakeJail({ jailedIds: ["6500"] })
    let attempts = 0
    const failing: JailStore = {
        ...jail.store,
        memory: (input) =>
            ++attempts === 1 ? Effect.fail({ _tag: "JailStoreError" } as never) : jail.store.memory(input),
    }
    await start(
        ({ bot, setRoles }) =>
            Effect.gen(function* () {
                assert.equal(attempts, 1)
                yield* TestClock.adjust("61 seconds")
                yield* bot.emit("GUILD_MEMBER_ADD", member(bot, "6500", []))
                yield* bot.idle()
                assert.equal(attempts, 2)
                assert.deepEqual(sentRoles(setRoles), [[JAIL_ROLE]])
            }),
        { jail: { ...jail, store: failing } },
    )
})
