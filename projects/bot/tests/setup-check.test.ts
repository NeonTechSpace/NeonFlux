import assert from "node:assert/strict"
import test from "node:test"
import type { DashboardOverviewSection, SetupProblem, SetupStatus } from "@neonflux/contracts/setup"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { BackendRequestError } from "../src/backend-http.ts"
import { createBotOptions } from "../src/bot.ts"
import type { GeneralSettingsStore } from "../src/general-settings.ts"
import {
    createSetupStore,
    findFeature,
    processSetupCheckPass,
    readSetupProblems,
    type SetupStore,
} from "../src/setup-check.ts"
import { platform, token } from "./moderation-fixture.ts"
import { mockBackend } from "./backend-fake.ts"

// Moderation is on, autorole needs setup and assigns the bot's own top role, and tickets are off
function setupStore(queued = false) {
    const recorded: (readonly SetupProblem[])[] = []
    let statusReads = 0,
        managedRoleId = ""
    const store: SetupStore = {
        status: () =>
            Effect.sync(() => {
                statusReads++
                return {
                    sections: [
                        { id: "moderation", state: "on" },
                        { id: "autorole", state: "setup" },
                        { id: "tickets", state: "off" },
                    ] as const,
                    managedRoles: [{ feature: "autorole", roleIds: [managedRoleId] }] as const,
                    staffRoleIds: { moderation: [], cases: [], automod: [], security: [], appeals: [] },
                    threadFeatures: [],
                }
            }),
        ready: () => Effect.succeed({ queued }),
        record: (_serverId, problems) =>
            Effect.sync(() => {
                recorded.push(problems)
                return { recorded: true }
            }),
    }
    return {
        store,
        recorded,
        reads: () => statusReads,
        manage: (roleId: string) => {
            managedRoleId = roleId
        },
    }
}
const limited =
    Permissions.ViewChannel |
    Permissions.SendMessages |
    Permissions.EmbedLinks |
    Permissions.ReadMessageHistory |
    Permissions.ManageRoles
// Every feature in the backend's order
const allSections = [
    "custom",
    "auto",
    "moderation",
    "cleanup",
    "logs",
    "reaction",
    "autorole",
    "verification",
    "rolepicker",
    "temproles",
    "onboarding",
    "publishing",
    "greetings",
    "schedules",
    "tickets",
    "leveling",
    "milestones",
    "suggestions",
    "events",
    "voice",
    "analytics",
    "sticky",
    "sidebar",
    "alerts",
    "helpdesk",
    "lfg",
] as const satisfies readonly DashboardOverviewSection[]
const sectionsStore = (sections: SetupStatus["sections"]): SetupStore => ({
    status: () =>
        Effect.succeed({
            sections,
            managedRoles: [],
            staffRoleIds: { moderation: [], cases: [], automod: [], security: [], appeals: [] },
            threadFeatures: [],
        }),
    ready: () => Effect.succeed({ queued: false }),
    record: () => Effect.succeed({ recorded: true }),
})
// The ? prefix
const questionPrefix: GeneralSettingsStore = {
    get: () => Effect.succeed({ prefix: "?", revision: 1 }),
    set: () => Effect.die("unused"),
    nickname: () => Effect.die("unused"),
    setNickname: () => Effect.die("unused"),
    recordNickname: () => Effect.die("unused"),
}

type Body = {
    content?: string
    embeds?: {
        title?: string
        description?: string
        fields?: { name: string; value: string }[]
        footer?: { text: string }
    }[]
}
// An embed reply as lines: its title, description, one "name: value" line per field and its footer
const shown = (body: Body) =>
    body.content ??
    body
        .embeds!.flatMap((embed) => [
            embed.title,
            embed.description,
            ...(embed.fields ?? []).map((field) => `${field.name}: ${field.value}`),
            embed.footer?.text,
        ])
        .filter((line) => line !== undefined)
        .join("\n")
function setupBot(
    store: SetupStore | undefined,
    options: Parameters<typeof platform>[1],
    general?: GeneralSettingsStore,
) {
    return Effect.gen(function* () {
        const f = createFixtures()
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { setup: store, general }))
        const p = platform(bot, options)
        yield* bot.ready()
        const say = (content: string) =>
            Effect.gen(function* () {
                const before = p.replies.requests().length
                yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))
                return p.replies
                    .requests()
                    .slice(before)
                    .map((row) => shown(row.body as Body))
            })
        return { bot, p, say }
    })
}

test("health sums up the connection, missing permissions and safety, and lists each missing permission once with the features that need it", async () => {
    const setup = setupStore()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { bot, p, say } = yield* setupBot(setup.store, { botPermissions: limited })
                setup.manage(p.botRole.id)
                assert.deepEqual(yield* say("!health"), [
                    [
                        "Health check",
                        "Send `!health permissions` to see them",
                        "Connection: OK",
                        "Permissions: Missing 4 permissions used by 1 feature: Moderation. 1 role NeonFlux gives ranks at or above its own role",
                        "Safety: No warnings",
                    ].join("\n"),
                ])
                assert.deepEqual(yield* say("!health permissions"), [
                    [
                        "Missing permissions",
                        "Kick members: Moderation",
                        "Ban members: Moderation",
                        "Manage messages: Moderation",
                        "Time out members: Moderation",
                        `<@&${p.botRole.id}> ranks at or above NeonFlux's role: Autorole`,
                        "Grant these permissions to the NeonFlux role and move the NeonFlux role above these roles",
                    ].join("\n"),
                ])
                assert.deepEqual(yield* say("!health safety"), ["Safety warnings\nNo safety warnings"])
                assert.deepEqual(yield* say("!health permissions next"), [
                    "There is no next page to show. Send !health permissions to start the list again",
                ])
                for (const content of ["!health roles", "!health safety 2", "!health next"])
                    assert.deepEqual(yield* say(content), ["Use !health, !health permissions or !health safety"])
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
    // Without its data service NeonFlux checks only what replies need and says whom to tell, without settings names
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const down: SetupStore = {
                    ...setup.store,
                    status: () => Effect.fail(new BackendRequestError({ status: 503 })),
                }
                const { say } = yield* setupBot(down, { botPermissions: limited })
                assert.deepEqual(yield* say("!health"), [
                    [
                        "Health check",
                        "Connection: NeonFlux can't reach its data service. Tell the bot operator",
                        "Permissions: OK",
                        "Safety: Not checked without the data service",
                    ].join("\n"),
                ])
            }),
        ),
    )
    // Without a backend the health card itself answers, so it names no single command that still works
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { say } = yield* setupBot(undefined, { botPermissions: limited })
                assert.deepEqual(yield* say("!health"), [
                    [
                        "Health check",
                        "Connection: NeonFlux has no data service yet, so features that store data are unavailable. Tell the bot operator",
                        "Permissions: OK",
                        "Safety: Not checked without the data service",
                    ].join("\n"),
                ])
            }),
        ),
    )
})

test("health in its worst case stays a short summary, and its permission list pages at 10", async () => {
    // Every feature is on and NeonFlux may only reply
    const store = sectionsStore(allSections.map((id) => ({ id, state: "on" as const })))
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { say } = yield* setupBot(
                    {
                        ...store,
                        status: () =>
                            store
                                .status("")
                                .pipe(Effect.map((status) => ({ ...status, threadFeatures: ["events" as const] }))),
                    },
                    {
                        botPermissions:
                            Permissions.ViewChannel |
                            Permissions.SendMessages |
                            Permissions.EmbedLinks |
                            Permissions.ReadMessageHistory,
                    },
                )
                const [summary, ...rest] = yield* say("!health")
                assert.deepEqual(rest, [])
                assert.deepEqual(summary!.split("\n"), [
                    "Health check",
                    "Send `!health permissions` to see them",
                    "Connection: OK",
                    "Permissions: Missing 14 permissions used by 16 features: Moderation, Message cleanup, Metadata logs, Reaction roles and 12 more",
                    "Safety: No warnings",
                ])
                const [first] = yield* say("!health permissions"),
                    lines = first!.split("\n")
                assert.equal(lines.length, 13)
                assert.deepEqual(
                    [lines[0], lines[1], lines.at(-2), lines.at(-1)],
                    [
                        "Missing permissions",
                        "Kick members: Moderation",
                        "Grant these permissions to the NeonFlux role",
                        "Next: `!health permissions next`",
                    ],
                )
                const [second] = yield* say("!health permissions next")
                assert.deepEqual(second!.split("\n"), [
                    "Missing permissions",
                    "Move members: Temporary voice rooms",
                    "Manage community: Security alerts",
                    "Manage threads: Help desk",
                    "Send messages in threads: Help desk",
                    "Grant these permissions to the NeonFlux role",
                ])
                // Each permission is one line, so features that share one, such as the role features, never repeat its fix
                assert.ok(
                    first!.includes(
                        "Manage roles: Autorole, Rules verification, Role picker, Temporary roles, Newcomer checklist, Tickets, Temporary voice rooms, Looking for group",
                    ),
                )
                assert.ok(first!.includes("Create public threads: Events"))
            }),
        ),
    )
})

test("health audits dangerous roles of the everyone role or many members, staff roles lacking their class's permissions and the verification level bypass", async () => {
    let staffRoleId = ""
    const staff: string[] = []
    const store: SetupStore = {
        status: () =>
            Effect.sync(() => ({
                sections: [
                    { id: "moderation", state: "on" },
                    { id: "autorole", state: "on" },
                    { id: "reaction", state: "on" },
                    { id: "rolepicker", state: "setup" },
                ] as const,
                managedRoles: [],
                staffRoleIds: {
                    moderation: [staffRoleId, ...staff],
                    cases: [staffRoleId],
                    automod: [],
                    security: [],
                    appeals: [],
                },
                threadFeatures: [],
            })),
        ready: () => Effect.succeed({ queued: false }),
        record: () => Effect.succeed({ recorded: true }),
    }
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { bot, p, say } = yield* setupBot(store, {
                    botPermissions: limited,
                    everyonePermissions: Permissions.MentionEveryone,
                    targetPermissions: Permissions.BanMembers | Permissions.ManageWebhooks,
                    guild: { verification_level: 2 },
                })
                staffRoleId = p.targetRole.id
                const counts = new Map([
                    [p.targetRole.id, 25],
                    [p.actorRole.id, 3],
                ])
                const searches = bot.rest.respond("POST /guilds/:id/members-search", (request) => {
                    const roleId = (request.body as { role_ids: string[] }).role_ids[0]!
                    return {
                        body: {
                            guild_id: bot.fixtures.ids.guild,
                            members: [],
                            page_result_count: 0,
                            total_result_count: counts.get(roleId) ?? 1,
                            indexing: false,
                        },
                    }
                })
                const [summary] = yield* say("!health")
                assert.deepEqual(summary!.split("\n").slice(1, 2).concat(summary!.split("\n").at(-1)!), [
                    "Send `!health permissions` or `!health safety` to see each one",
                    "Safety: 4 warnings",
                ])
                // The Administrator role is counted first, and each search counts human members of one role
                assert.deepEqual(
                    searches.requests().map((request) => request.body),
                    [p.actorRole.id, p.targetRole.id, p.botRole.id].map((id) => ({
                        limit: 1,
                        offset: 0,
                        role_ids: [id],
                        is_bot: false,
                    })),
                )
                assert.deepEqual(yield* say("!health safety"), [
                    [
                        "Safety warnings",
                        "The everyone role gives Use @everyone/@here and @roles to every member. Remove it from that role",
                        `<@&${p.targetRole.id}> gives Ban members and Manage webhooks to 25 members. Keep them on a role only trusted staff hold`,
                        `The moderation staff role <@&${p.targetRole.id}> lacks Kick members, Manage channels, Manage messages and Time out members, which its !mod commands need. Grant them to the role`,
                        "Fluxer skips its verification level for members with any role, so Autorole and Reaction roles let members past it. If you rely on it, turn these off or use rules verification with advanced verification on",
                    ].join("\n"),
                ])
                // Twelve more staff roles that lack their permissions page the warnings at 10
                const extra = Array.from({ length: 12 }, () => bot.fixtures.role({ position: 2, permissions: "0" }))
                p.roles.push(...extra)
                staff.push(...extra.map((role) => role.id))
                const [first] = yield* say("!health safety")
                assert.equal(first!.split("\n").length, 12)
                assert.equal(first!.split("\n").at(-1), "Next: `!health safety next`")
                const [second] = yield* say("!health safety next")
                assert.equal(second!.split("\n").length, 7)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

// Five features on, two that need a step and the rest off
const mixed = allSections.map((id) => ({
    id,
    state: ["custom", "auto", "moderation", "publishing", "leveling"].includes(id)
        ? ("on" as const)
        : id === "autorole" || id === "tickets"
          ? ("setup" as const)
          : ("off" as const),
}))
const mixedOff =
    "Message cleanup, Metadata logs, Reaction roles, Rules verification, Role picker, Temporary roles, Newcomer checklist, Welcome and goodbye, Scheduled posts, " +
    "Birthdays and anniversaries, Suggestions, Events, Temporary voice rooms, Analytics, Sticky messages, Dashboard link, Security alerts, Help desk, Looking for group"
const allNames =
    "Custom commands, Autoresponders, Moderation, Message cleanup, Metadata logs, Reaction roles, Autorole, Rules verification, Role picker, Temporary roles, Newcomer checklist, " +
    "Publishing, Welcome and goodbye, Scheduled posts, Tickets, Leveling, Birthdays and anniversaries, Suggestions, Events, Temporary voice rooms, Analytics, Sticky messages, Dashboard link, " +
    "Security alerts, Help desk, Looking for group"

test("setup sums up the features by state in one short card, with no step per feature", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { say } = yield* setupBot(sectionsStore(mixed), { botPermissions: limited })
                const [summary, ...more] = yield* say("!setup")
                assert.deepEqual(summary!.split("\n"), [
                    "Setup",
                    "7 of 26 features are on",
                    "Send `!setup <feature>` to see how to set one up, for example `!setup tickets`. `!health` checks NeonFlux's permissions",
                    "On: Custom commands, Autoresponders, Moderation, Publishing, Leveling",
                    "Needs a step: Autorole, Tickets",
                    `Off: ${mixedOff}`,
                ])
                assert.deepEqual(more, [])
                // The only commands are the closing pointers
                assert.deepEqual(summary!.match(/`[^`]+`/g), ["`!setup <feature>`", "`!setup tickets`", "`!health`"])
            }),
        ),
    )
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { say } = yield* setupBot(sectionsStore(mixed), { botPermissions: limited }, questionPrefix)
                assert.deepEqual(yield* say("?setup"), [
                    [
                        "Setup",
                        "7 of 26 features are on",
                        "Send `?setup <feature>` to see how to set one up, for example `?setup tickets`. `?health` checks NeonFlux's permissions",
                        "On: Custom commands, Autoresponders, Moderation, Publishing, Leveling",
                        "Needs a step: Autorole, Tickets",
                        `Off: ${mixedOff}`,
                    ].join("\n"),
                ])
            }),
        ),
    )
})

test("setup with every feature off stays four lines, leaving out the empty groups", async () => {
    const off = sectionsStore(allSections.map((id) => ({ id, state: "off" as const })))
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { say } = yield* setupBot(off, { botPermissions: limited })
                assert.deepEqual(yield* say("!setup"), [
                    [
                        "Setup",
                        "0 of 26 features are on",
                        "Send `!setup <feature>` to see how to set one up, for example `!setup tickets`. `!health` checks NeonFlux's permissions",
                        `Off: ${allNames}`,
                    ].join("\n"),
                ])
            }),
        ),
    )
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { say } = yield* setupBot(off, { botPermissions: limited }, questionPrefix)
                const replies = yield* say("?setup")
                assert.equal(replies.length, 1)
                assert.deepEqual(
                    replies[0]!.split("\n").map((line) => line.split(" ")[0]),
                    ["Setup", "0", "Send", "Off:"],
                )
            }),
        ),
    )
})

test("setup with a feature shows its state and one next step, and an unknown feature gets one line", async () => {
    const setup = setupStore()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { say } = yield* setupBot(setup.store, { botPermissions: limited })
                for (const content of ["!setup tickets", "!setup Ticket", "!setup TICKETS"])
                    assert.deepEqual(yield* say(content), ["Tickets\nOff\nNext: Turn it on with `!ticket module on`"])
                assert.deepEqual(yield* say("!setup autoroles"), [
                    "Autorole\nOn, but it needs a step before it works\nNext: Add a role with `!autorole add @role`",
                ])
                assert.deepEqual(yield* say("!setup mod"), ["Moderation\nOn"])
                // A feature the status leaves out is off
                assert.deepEqual(yield* say("!setup Message cleanup"), [
                    "Message cleanup\nOff\nNext: Turn it on with `!cleanup module on`",
                ])
                assert.deepEqual(yield* say("!setup nothing here"), [
                    "No feature called nothing here. Send `!setup` to see them all",
                ])
            }),
        ),
    )
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { say } = yield* setupBot(setup.store, { botPermissions: limited }, questionPrefix)
                assert.deepEqual(yield* say("?setup autorole"), [
                    "Autorole\nOn, but it needs a step before it works\nNext: Add a role with `?autorole add @role`",
                ])
                assert.deepEqual(yield* say("?setup nothing"), [
                    "No feature called nothing. Send `?setup` to see them all",
                ])
            }),
        ),
    )
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { say } = yield* setupBot(setup.store, {
                    actorOwner: false,
                    actorPermissions: 0n,
                    botPermissions: limited,
                })
                for (const content of ["!setup", "!setup tickets", "!health"])
                    assert.deepEqual(yield* say(content), [
                        "Only the server owner or members with Manage community can run this check",
                    ])
            }),
        ),
    )
})

test("a feature is found by its ID, its name with or without spaces, in singular or plural, or its command word", () => {
    for (const id of allSections) assert.equal(findFeature(id), id)
    assert.deepEqual(allNames.split(", ").map(findFeature), allSections)
    const words = {
        ticket: "tickets",
        Cleanup: "cleanup",
        messagecleanup: "cleanup",
        lfg: "lfg",
        "looking for group": "lfg",
        "temporary voice room": "voice",
        "role-picker": "rolepicker",
        temprole: "temproles",
        verify: "verification",
        welcome: "greetings",
        stats: "analytics",
        "custom command": "custom",
        level: "leveling",
        schedule: "schedules",
        // Scheduled posts share the publish command, and the earlier feature wins it
        publish: "publishing",
    }
    for (const [word, id] of Object.entries(words)) assert.equal(findFeature(word), id, word)
    for (const word of ["nothing", "s", "role picker menu"]) assert.equal(findFeature(word), undefined, word)
})

test("the backend's setup status decodes every overview section, including sticky messages, the dashboard link and security alerts", async (t) => {
    mockBackend(t, (call) => {
        assert.equal(call.path, "/setup/status")
        return {
            sections: [
                { id: "sticky", state: "on" },
                { id: "sidebar", state: "off" },
                { id: "alerts", state: "setup" },
            ],
            managedRoles: [],
            staffRoleIds: { moderation: [], cases: [], automod: [], security: [], appeals: [] },
            threadFeatures: [],
        }
    })
    const status = await Effect.runPromise(
        createSetupStore({
            url: "https://synthetic.invalid",
            secret: Redacted.make("synthetic-backend-secret"),
        }).status("10"),
    )
    assert.deepEqual(
        status.sections.map((row) => row.id),
        ["sticky", "sidebar", "alerts"],
    )
})

test("the dashboard check answers only a waiting request, with the bot's own reads", async () => {
    for (const queued of [true, false]) {
        const setup = setupStore(queued)
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const { bot, p } = yield* setupBot(setup.store, {
                        botPermissions:
                            limited |
                            Permissions.KickMembers |
                            Permissions.BanMembers |
                            Permissions.ManageMessages |
                            Permissions.ModerateMembers,
                    })
                    setup.manage(p.targetRole.id)
                    yield* processSetupCheckPass(setup.store, bot.fixtures.ids.guild, bot.client)
                }),
            ),
        )
        assert.deepEqual(setup.recorded, queued ? [[]] : [])
        assert.equal(setup.reads(), queued ? 1 : 0)
    }
})

test("events with discussion threads on need Create public threads", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-setup-token" })
                platform(bot, { botPermissions: limited })
                const status = (threadFeatures: "events"[]) => ({
                    sections: [{ id: "events" as const, state: "on" as const }],
                    managedRoles: [],
                    staffRoleIds: { moderation: [], cases: [], automod: [], security: [], appeals: [] },
                    threadFeatures,
                })
                const events = (problems: readonly SetupProblem[]) =>
                    problems.filter((problem) => "feature" in problem && problem.feature === "events")
                assert.deepEqual(events(yield* readSetupProblems(bot.client, bot.fixtures.ids.guild, status([]))), [])
                assert.deepEqual(
                    events(yield* readSetupProblems(bot.client, bot.fixtures.ids.guild, status(["events"]))),
                    [{ kind: "permissions", feature: "events", permissions: ["CreatePublicThreads"] }],
                )
            }),
        ),
    )
})
