import assert from "node:assert/strict"
import test from "node:test"
import {
    COMMAND_RULE_CHANNELS,
    COMMAND_RULE_LIMIT,
    COMMAND_RULE_ROLES,
    LIMITABLE_COMMANDS,
    UNLIMITABLE_COMMANDS,
    type CommandRule,
    type CommandRuleName,
} from "@neonflux/contracts/command-rules"
import { BUILT_IN_COMMANDS } from "@neonflux/contracts/responses"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { TestClock } from "effect/testing"
import type { DashboardConfigurationReadyJob } from "@neonflux/contracts/dashboard"
import { createBotOptions } from "../src/bot.ts"
import { processDashboardConfigurationPass } from "../src/dashboard-configuration.ts"
import { mockBackend } from "./backend-fake.ts"
import { parseCommandRulesCommand } from "../src/command-rules-command.ts"
import { resetCommandRuleRefusals } from "../src/command-rules-management.ts"
import type { CommandRulesStore } from "../src/command-rules-store.ts"
import { prefixTtlMs, type GeneralSettingsStore } from "../src/general-settings.ts"
import { commandTable } from "../src/help.ts"
import { boundary } from "./moderation-fixture.ts"

// Every command the bot's gate treats as critical as a whole, or that an emergency or a locked-out member depends on. A change that
// makes one of them limitable has to change this list on purpose
const critical = [
    "commands",
    "help",
    "prefix",
    "defcon",
    "security",
    "mod",
    "automod",
    "lockdown",
    "antinuke",
    "jail",
    "appeal",
    "logs",
    "alerts",
    "invites",
    "recovery",
    "setup",
    "health",
    "preset",
    "backup",
    "export",
    "ticket",
    "verify",
    "milestone",
    "cleanup",
]

test("critical commands can never be limited, and each is refused with a reason", () => {
    assert.ok(critical.every((name) => (UNLIMITABLE_COMMANDS as readonly string[]).includes(name)))
    for (const name of critical) {
        assert.ok(!(LIMITABLE_COMMANDS as readonly string[]).includes(name), `${name} is limitable`)
        for (const args of [
            ["rule", name, "channels", "<#100000000000001>"],
            ["rule", `!${name}`, "clear"],
            ["show", name],
        ])
            assert.deepEqual(parseCommandRulesCommand(args), {
                error: `!${name} always works everywhere, because safety, recovery or access depends on it`,
            })
    }
})

test("every command is either limitable or never limitable, so a new one needs a decision", () => {
    const decided = new Set<string>([...LIMITABLE_COMMANDS, ...UNLIMITABLE_COMMANDS])
    for (const name of BUILT_IN_COMMANDS) assert.ok(decided.has(name), `${name} has no decision`)
    for (const { name } of commandTable) assert.ok(decided.has(name), `${name} has no decision`)
    // A rule on a name members cannot type would do nothing
    const inHelp = new Set<string>(commandTable.map(({ name }) => name))
    for (const name of LIMITABLE_COMMANDS) assert.ok(inHelp.has(name), `${name} is not in the help command table`)
    assert.ok(!LIMITABLE_COMMANDS.some((name) => (UNLIMITABLE_COMMANDS as readonly string[]).includes(name)))
    assert.equal(COMMAND_RULE_LIMIT, 25)
})

test("the grammar sets and clears each limit, and names no typed revision", () => {
    const channel = "100000000000001",
        role = "100000000000002"
    assert.deepEqual(parseCommandRulesCommand([]), { type: "help" })
    assert.deepEqual(parseCommandRulesCommand(["rules"]), { type: "rules" })
    assert.deepEqual(parseCommandRulesCommand(["rules", "next"]), { type: "rules", next: true })
    assert.deepEqual(parseCommandRulesCommand(["show", "rank"]), { type: "show", command: "rank" })
    assert.deepEqual(parseCommandRulesCommand(["rule", "RANK", "channels", `<#${channel}>`, channel]), {
        type: "channels",
        command: "rank",
        channelIds: [channel],
    })
    assert.deepEqual(parseCommandRulesCommand(["rule", "rank", "channels", "all"]), {
        type: "channels",
        command: "rank",
        channelIds: [],
    })
    assert.deepEqual(parseCommandRulesCommand(["rule", "level", "roles", `<@&${role}>`]), {
        type: "roles",
        command: "level",
        roleIds: [role],
    })
    assert.deepEqual(parseCommandRulesCommand(["rule", "level", "roles", "all"]), {
        type: "roles",
        command: "level",
        roleIds: [],
    })
    assert.deepEqual(parseCommandRulesCommand(["rule", "rank", "clear"]), { type: "clear", command: "rank" })
    const usage = { error: "Check the command syntax. Use !commands help" }
    for (const args of [
        ["rule", "rank"],
        ["rule", "rank", "channels"],
        ["rule", "rank", "clear", "now"],
        ["rule", "rank", "colour", "red"],
        ["rules", "2"],
        ["nonsense"],
    ])
        assert.deepEqual(parseCommandRulesCommand(args), usage)
    assert.deepEqual(parseCommandRulesCommand(["rule", "nothing", "clear"]), {
        error: "Name a built-in command, such as rank",
    })
    assert.deepEqual(parseCommandRulesCommand(["rule", "rank", "channels", "<@1>"]), {
        error: "Name channels, such as #bot-commands",
    })
    assert.deepEqual(parseCommandRulesCommand(["rule", "rank", "roles", "<#1>"]), {
        error: "Name roles, such as @Members",
    })
    assert.equal(COMMAND_RULE_CHANNELS, 500)
    assert.equal(COMMAND_RULE_ROLES, 250)
})

const f = createFixtures()
const allowedChannel = "7001",
    otherChannel = "7002",
    threadId = "7003",
    allowedRole = "8001",
    memberId = "6001",
    adminId = "6002",
    ownerId = "6009",
    managerId = "6003"
const rule = (command: CommandRuleName, fields: Partial<CommandRule> = {}): CommandRule => ({
    command,
    channelIds: [],
    roleIds: [],
    updatedAt: 1,
    ...fields,
})

/** The bot with these rules, where Fluxer's replies and every read are counted */
function run(
    initial: readonly CommandRule[],
    body: (tools: ReturnType<typeof tooling>) => Effect.Effect<void, unknown>,
    moderation = boundary(),
) {
    resetCommandRuleRefusals()
    return Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                let rules = [...initial],
                    reads = 0
                const manageCalls: unknown[] = []
                const general: GeneralSettingsStore = {
                    get: () =>
                        Effect.sync(() => {
                            reads++
                            return { prefix: "!", replyStyle: "text" as const, revision: 1, commandRules: rules }
                        }),
                    set: () => Effect.die("unused"),
                    nickname: () => Effect.die("unused"),
                    setNickname: () => Effect.die("unused"),
                    recordNickname: () => Effect.die("unused"),
                }
                const commandRules: CommandRulesStore = {
                    manage: (input) =>
                        Effect.sync(() => {
                            manageCalls.push(input.operation)
                            const op = input.operation
                            const current = rules.find((row) => row.command === op.command)
                            rules = rules.filter((row) => row.command !== op.command)
                            if (op.type === "set") {
                                const channelIds = op.channelIds ?? current?.channelIds ?? [],
                                    roleIds = op.roleIds ?? current?.roleIds ?? []
                                if (channelIds.length || roleIds.length)
                                    rules.push(rule(op.command, { channelIds, roleIds }))
                            }
                            return { rules }
                        }),
                }
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token: Redacted.make("synthetic-command-rules-token"), serverId: f.ids.guild },
                        { general, commandRules, moderation: moderation.store },
                    ),
                )
                const tools = tooling(
                    bot,
                    () => reads,
                    manageCalls,
                    () => rules,
                )
                yield* bot.ready()
                yield* bot.idle()
                yield* body(tools)
                assert.deepEqual(bot.failures(), [])
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
}
function tooling(
    bot: Effect.Success<ReturnType<typeof createTestBot>>,
    reads: () => number,
    manageCalls: unknown[],
    rules: () => CommandRule[],
) {
    const fx = bot.fixtures
    const adminRole = fx.role({ id: "8002", position: 10, permissions: Permissions.Administrator.toString() }),
        managerRole = fx.role({ id: "8003", position: 9, permissions: Permissions.ManageGuild.toString() }),
        plainRole = fx.role({ id: allowedRole, position: 5, permissions: "0" })
    bot.rest.respond("GET /guilds/:id", { body: fx.guild({ owner_id: ownerId }) })
    bot.rest.respond("GET /guilds/:id/roles", {
        body: [fx.role({ id: fx.ids.guild, permissions: "0" }), adminRole, managerRole, plainRole],
    })
    const memberRoles = new Map<string, string[]>([
        [adminId, [adminRole.id]],
        [managerId, [managerRole.id]],
    ])
    const members = bot.rest.respond("GET /guilds/:id/members/:id", (request) => {
        const userId = request.path.split("/")[4]!
        return {
            body: fx.member({
                user: userId === fx.ids.bot ? fx.botUser() : fx.user({ id: userId }),
                roles: memberRoles.get(userId) ?? [],
            }),
        }
    })
    const channels = bot.rest.respond("GET /channels/:id", (request) => {
        const id = request.path.split("/")[2]!
        return {
            body: id === threadId ? fx.thread({ id, parent_id: allowedChannel }) : fx.channel({ id, type: 0 }),
        }
    })
    const posts = bot.rest.respond("POST /channels/:id/messages", (request) => ({
        body: fx.message({ channel_id: request.path.split("/")[2]!, author: fx.botUser() }),
    }))
    const say = (content: string, channelId = otherChannel, userId = memberId) =>
        bot
            .emit(
                "MESSAGE_CREATE",
                fx.message({
                    content,
                    channel_id: channelId,
                    author: fx.user({ id: userId }),
                }),
            )
            .pipe(Effect.andThen(bot.idle()))
    return {
        bot,
        say,
        memberRoles,
        members,
        channels,
        reads,
        manageCalls,
        rules,
        replies: () => posts.requests().map((request) => (request.body as { content: string }).content),
    }
}

test("a refused command names where it works, once per member and command per minute", async () => {
    await run([rule("ping", { channelIds: [allowedChannel] })], ({ say, replies }) =>
        Effect.gen(function* () {
            yield* say("!ping")
            yield* say("!ping")
            assert.deepEqual(replies(), [`!ping works in <#${allowedChannel}>`])
            yield* say("!ping", otherChannel, "6010")
            assert.equal(replies().length, 2)
            yield* TestClock.adjust(59000)
            yield* say("!ping")
            assert.equal(replies().length, 2)
            yield* TestClock.adjust(1000)
            yield* say("!ping")
            assert.equal(replies().length, 3)
            yield* say("!ping", allowedChannel)
            assert.equal(replies().at(-1), "Pong!")
        }),
    )
})

test("a thread counts as its parent channel", async () => {
    await run([rule("ping", { channelIds: [allowedChannel] })], ({ say, replies }) =>
        Effect.gen(function* () {
            yield* say("!ping", threadId)
            assert.deepEqual(replies(), ["Pong!"])
        }),
    )
})

test("a role rule asks for one of its roles, and rules never apply to the server owner or an Administrator", async () => {
    await run(
        [
            rule("ping", { roleIds: [allowedRole] }),
            rule("afk", { channelIds: [allowedChannel], roleIds: [allowedRole] }),
        ],
        ({ say, replies, memberRoles }) =>
            Effect.gen(function* () {
                yield* say("!ping")
                yield* say("!afk")
                assert.deepEqual(replies(), [
                    `!ping needs one of these roles: <@&${allowedRole}>`,
                    `!afk works in <#${allowedChannel}> and needs one of these roles: <@&${allowedRole}>`,
                ])
                yield* say("!ping", otherChannel, adminId)
                yield* say("!ping", otherChannel, ownerId)
                assert.deepEqual(replies().slice(2), ["Pong!", "Pong!"])
                memberRoles.set("6011", [allowedRole])
                yield* say("!ping", otherChannel, "6011")
                assert.equal(replies().at(-1), "Pong!")
            }),
    )
})

test("a rule on a group command covers the whole group, and a command without a rule reads nothing more", async () => {
    await run([rule("voice", { channelIds: [allowedChannel] })], ({ say, replies, members, channels }) =>
        Effect.gen(function* () {
            yield* say("!voice lock")
            assert.deepEqual(replies(), [`!voice works in <#${allowedChannel}>`])
            yield* say("!voice generator list", otherChannel, "6012")
            assert.equal(replies().at(-1), `!voice works in <#${allowedChannel}>`)
            const before = [members.requests().length, channels.requests().length]
            yield* say("!ping")
            assert.deepEqual([members.requests().length, channels.requests().length], before)
            assert.equal(replies().at(-1), "Pong!")
            // A channel rule that lets the channel through reads no member either
            yield* say("!voice help", allowedChannel)
            assert.deepEqual([members.requests().length, channels.requests().length], before)
        }),
    )
})

test("DEFCON answers first, and a critical form of a limited command skips the rule", async () => {
    const moderation = boundary()
    moderation.current.defcon = 2
    await run(
        [rule("ping", { channelIds: [allowedChannel] }), rule("level", { channelIds: [allowedChannel] })],
        ({ say, replies, bot }) =>
            Effect.gen(function* () {
                // A member's public command at DEFCON 2 is refused silently, with no line about the rule
                yield* say("!ping")
                assert.deepEqual(replies(), [])
                moderation.current.defcon = 3
                // A critical form, which a rule must not put out of reach. A plain member, since a rule never applies to an Administrator
                yield* say("!level status")
                assert.equal(replies().length, 1)
                assert.ok(!replies().some((line) => line.includes("works in")))
                // The same member's ordinary form of the same command is limited
                yield* say("!level")
                assert.equal(replies().at(-1), `!level works in <#${allowedChannel}>`)
                assert.equal(bot.failures().length, 0)
            }),
        moderation,
    )
})

test("a command in a DM is not limited", async () => {
    await run([rule("ping", { channelIds: [allowedChannel] })], ({ say, replies, bot }) =>
        Effect.gen(function* () {
            // The server's rule is in memory, as the same member's refused command shows
            yield* say("!ping")
            assert.deepEqual(replies(), [`!ping works in <#${allowedChannel}>`])
            yield* TestClock.adjust(60000)
            const fx = bot.fixtures,
                dmId = fx.nextId()
            const { guild_id: _guild, ...direct } = fx.message({
                content: "!ping",
                channel_id: dmId,
                author: fx.user({ id: memberId }),
            })
            bot.rest.respond(`GET /channels/${dmId}`, {
                body: { id: dmId, type: 1, recipients: [fx.user({ id: memberId })], last_message_id: null },
            })
            const dmReplies = bot.rest.respond(`POST /channels/${dmId}/messages`, {
                body: fx.message({ channel_id: dmId, author: fx.botUser() }),
            })
            yield* bot.emit("MESSAGE_CREATE", direct)
            yield* bot.idle()
            // The DM gets the answer every DM gets for this command, and nothing about the server's rule
            assert.equal(replies().length, 1)
            assert.deepEqual(
                dmReplies.requests().map((request) => (request.body as { content: string }).content),
                ["Send `!ping` in the server. It does not work in a DM"],
            )
        }),
    )
})

test("managers change rules in chat, which apply at once, and others cannot", async () => {
    await run([], ({ say, replies, manageCalls, rules }) =>
        Effect.gen(function* () {
            yield* say(`!commands rule ping channels <#${allowedChannel}>`)
            assert.deepEqual(replies(), [
                "Only the server owner or members with Manage community can change command rules",
            ])
            assert.deepEqual(manageCalls, [])
            yield* say(`!commands rule ping channels <#${allowedChannel}>`, otherChannel, managerId)
            assert.deepEqual(rules()[0]!.channelIds, [allowedChannel])
            assert.equal(replies().at(-1), `!ping: In <#${allowedChannel}>, for everyone`)
            // No wait for the next read
            yield* say("!ping")
            assert.equal(replies().at(-1), `!ping works in <#${allowedChannel}>`)
            yield* say("!commands show ping", otherChannel, managerId)
            assert.match(replies().at(-1)!, /In <#7001>, for everyone/)
            yield* say(`!commands rule ping roles <@&${allowedRole}>`, otherChannel, managerId)
            assert.equal(replies().at(-1), `!ping: In <#${allowedChannel}>, for <@&${allowedRole}>`)
            yield* say("!commands rules", otherChannel, managerId)
            assert.match(replies().at(-1)!, /1 of 25 rules/)
            yield* say(`!commands rule ping roles <@&999999>`, otherChannel, managerId)
            assert.match(replies().at(-1)!, /Name existing roles/)
            yield* say(`!commands rule ping clear`, otherChannel, managerId)
            assert.equal(replies().at(-1), "!ping has no rule now, so it works everywhere for everyone")
            assert.deepEqual(rules(), [])
            yield* say("!ping")
            assert.equal(replies().at(-1), "Pong!")
            assert.equal(manageCalls.length, 3)
        }),
    )
})

test("a rule saved on the website applies to the next command once the bot applied the job, with no wait", async (t) => {
    const job: DashboardConfigurationReadyJob = {
        family: "commandrules",
        operation: { type: "set", command: "ping", channelIds: [allowedChannel] },
        native: { channelIds: [allowedChannel] },
        id: "synthetic_rule_job",
        actorId: adminId,
        expectedConfigRevision: 0,
        state: "queued",
        createdAt: 0,
        expiresAt: 120000,
    }
    let rules: readonly CommandRule[] = []
    mockBackend(t, (call) => {
        if (call.path === "/dashboard-configuration/ready") return { jobs: [job] }
        assert.equal(call.path, "/dashboard-configuration/execute")
        rules = [rule("ping", { channelIds: [allowedChannel] })]
        const { native: _native, ...stored } = job
        return { job: { ...stored, state: "applied" } }
    })
    const general = {
        get: () => Effect.sync(() => ({ prefix: "!", replyStyle: "text" as const, revision: 1, commandRules: rules })),
    }
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                resetCommandRuleRefusals()
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token: Redacted.make("synthetic-command-rules-token"), serverId: f.ids.guild },
                        { general: general as unknown as GeneralSettingsStore, moderation: boundary().store },
                    ),
                )
                const tools = tooling(
                    bot,
                    () => 0,
                    [],
                    () => [],
                )
                bot.rest.respond("GET /users/@me", { body: bot.fixtures.botUser({ system: false }) })
                bot.rest.respond(`GET /users/${adminId}`, {
                    body: bot.fixtures.user({ id: adminId, bot: false, system: false }),
                })
                yield* bot.ready()
                yield* tools.say("!ping")
                assert.equal(tools.replies().at(-1), "Pong!")
                yield* processDashboardConfigurationPass(
                    {
                        token: Redacted.make("synthetic-command-rules-token"),
                        serverId: f.ids.guild,
                        backend: {
                            url: "https://synthetic.invalid",
                            secret: Redacted.make("synthetic-backend-secret"),
                        },
                    },
                    bot.client as unknown as Parameters<typeof processDashboardConfigurationPass>[1],
                )
                assert.deepEqual(rules.length, 1)
                // The clock has not moved, so only the applied job can make the bot read the rules again
                yield* tools.say("!ping")
                assert.equal(tools.replies().at(-1), `!ping works in <#${allowedChannel}>`)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test("the rules a website change saved reach the bot within the prefix's memory time", async () => {
    let rules: readonly CommandRule[] = []
    const general = {
        get: () => Effect.succeed({ prefix: "!", replyStyle: "text" as const, revision: 1, commandRules: rules }),
    }
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                resetCommandRuleRefusals()
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token: Redacted.make("synthetic-command-rules-token"), serverId: f.ids.guild },
                        { general: general as unknown as GeneralSettingsStore, moderation: boundary().store },
                    ),
                )
                const tools = tooling(
                    bot,
                    () => 0,
                    [],
                    () => [],
                )
                yield* bot.ready()
                yield* tools.say("!ping")
                assert.equal(tools.replies().at(-1), "Pong!")
                rules = [rule("ping", { channelIds: [allowedChannel] })]
                yield* tools.say("!ping")
                assert.equal(tools.replies().at(-1), "Pong!")
                yield* TestClock.adjust(prefixTtlMs)
                yield* tools.say("!ping")
                assert.equal(tools.replies().at(-1), `!ping works in <#${allowedChannel}>`)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})
