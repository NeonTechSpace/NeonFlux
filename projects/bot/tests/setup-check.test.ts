import assert from "node:assert/strict"
import test from "node:test"
import type { DashboardOverviewSection, RecoveryEntry, SetupProblem, SetupStatus } from "@neonflux/contracts/setup"
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
    problemText,
    readSetupProblems,
    recoveryFix,
    recoveryLine,
    type SetupStore,
} from "../src/setup-check.ts"
import { platform, token } from "./moderation-fixture.ts"
import { mockBackend } from "./backend-fake.ts"

// Twenty entries, so !recovery has two pages: A feature that needs setup, a permission problem and unconfirmed posts, newest first
const at = Date.parse("2026-10-01T12:30:00Z")
const inbox: RecoveryEntry[] = [
    { kind: "feature", feature: "autorole" },
    { kind: "setup", at, problem: { kind: "permissions", feature: "moderation", permissions: ["KickMembers"] } },
    ...Array.from({ length: 18 }, (_, i): RecoveryEntry => ({
        kind: "work",
        source: "publishing",
        at: at - (i + 1) * 60000,
        summary: `Post #${18 - i}: NeonFlux could not confirm whether it was sent`,
        next: `!publish reconcile ${18 - i}`,
    })),
]
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
        recovery: (serverId) => Effect.succeed({ serverId, truncated: false, entries: inbox }),
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
    "showcase",
    "profile",
    "youtube",
    "twitch",
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
    recovery: (serverId) => Effect.succeed({ serverId, truncated: false, entries: [] }),
})
// Plain text replies with the ? prefix
const textReplies: GeneralSettingsStore = {
    get: () => Effect.succeed({ prefix: "?", replyStyle: "text" as const, revision: 1 }),
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
const minute = (ms: number) => `<t:${Math.floor(ms / 1000)}:R>`
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
                    "Permissions: Missing 14 permissions used by 17 features: Moderation, Message cleanup, Metadata logs, Reaction roles and 13 more",
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
        recovery: (serverId) => Effect.succeed({ serverId, truncated: false, entries: [] }),
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
                // An empty inbox answers with the same card
                assert.deepEqual(yield* say("!recovery"), ["Recovery inbox\nNothing needs attention"])
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
    "Birthdays and anniversaries, Suggestions, Events, Temporary voice rooms, Analytics, Sticky messages, Dashboard link, Security alerts, Help desk, Looking for group, Showcases, Member profiles, YouTube alerts, Twitch alerts"
const allNames =
    "Custom commands, Autoresponders, Moderation, Message cleanup, Metadata logs, Reaction roles, Autorole, Rules verification, Role picker, Temporary roles, Newcomer checklist, " +
    "Publishing, Welcome and goodbye, Scheduled posts, Tickets, Leveling, Birthdays and anniversaries, Suggestions, Events, Temporary voice rooms, Analytics, Sticky messages, Dashboard link, " +
    "Security alerts, Help desk, Looking for group, Showcases, Member profiles, YouTube alerts, Twitch alerts"

test("setup sums up the features by state in one short card, in both reply styles, with no step per feature", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { say } = yield* setupBot(sectionsStore(mixed), { botPermissions: limited })
                const [summary, ...more] = yield* say("!setup")
                assert.deepEqual(summary!.split("\n"), [
                    "Setup",
                    "7 of 30 features are on",
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
                const { say } = yield* setupBot(sectionsStore(mixed), { botPermissions: limited }, textReplies)
                assert.deepEqual(yield* say("?setup"), [
                    [
                        "**Setup**",
                        "7 of 30 features are on",
                        "Send `?setup <feature>` to see how to set one up, for example `?setup tickets`. `?health` checks NeonFlux's permissions",
                        "**On:** Custom commands, Autoresponders, Moderation, Publishing, Leveling",
                        "**Needs a step:** Autorole, Tickets",
                        `**Off:** ${mixedOff}`,
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
                        "0 of 30 features are on",
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
                const { say } = yield* setupBot(off, { botPermissions: limited }, textReplies)
                const replies = yield* say("?setup")
                assert.equal(replies.length, 1)
                assert.deepEqual(
                    replies[0]!.split("\n").map((line) => line.split(" ")[0]),
                    ["**Setup**", "0", "Send", "**Off:**"],
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
                const { say } = yield* setupBot(setup.store, { botPermissions: limited }, textReplies)
                assert.deepEqual(yield* say("?setup autorole"), [
                    "**Autorole**\nOn, but it needs a step before it works\nNext: Add a role with `?autorole add @role`",
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
                assert.deepEqual(yield* say("!recovery"), [
                    "Only the server owner or members with Manage community can read the recovery inbox",
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
        "YouTube alert": "youtube",
        "Twitch alert": "twitch",
        // Scheduled posts share the publish command, and the earlier feature wins it
        publish: "publishing",
    }
    for (const [word, id] of Object.entries(words)) assert.equal(findFeature(word), id, word)
    for (const word of ["nothing", "s", "role picker menu"]) assert.equal(findFeature(word), undefined, word)
})

test("recovery sums up its entries by area, lists one area 10 at a time without a step on every line and shows one entry with its fix", async () => {
    const setup = setupStore()
    const post = (n: number) =>
        `${minute(at - (19 - n) * 60000)}: Post #${n}: NeonFlux could not confirm whether it was sent`
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { say } = yield* setupBot(setup.store, { botPermissions: limited })
                assert.deepEqual(yield* say("!recovery"), [
                    [
                        "Recovery inbox",
                        "20 things need attention: Setup 1, Permissions 1, Publishing 18",
                        "Send `!recovery <area>` to see one, for example `!recovery setup`",
                    ].join("\n"),
                ])
                assert.deepEqual(yield* say("!recovery publishing"), [
                    [
                        "Recovery inbox: Publishing",
                        ...[18, 17, 16, 15, 14, 13, 12, 11, 10, 9].map((n, i) => `${i + 1}. ${post(n)}`),
                        "Send `!recovery publishing <number>` to see how to fix one",
                        "Next: `!recovery publishing next`",
                    ].join("\n"),
                ])
                assert.deepEqual(yield* say("!recovery publishing next"), [
                    [
                        "Recovery inbox: Publishing",
                        ...[8, 7, 6, 5, 4, 3, 2, 1].map((n, i) => `${i + 11}. ${post(n)}`),
                        "Send `!recovery publishing <number>` to see how to fix one",
                    ].join("\n"),
                ])
                assert.deepEqual(yield* say("!recovery publishing next"), [
                    "There is no next page to show. Send !recovery publishing to start the list again",
                ])
                // One entry by its number in the area, which takes a feature's word too
                assert.deepEqual(yield* say("!recovery publish 2"), [
                    `Recovery inbox: Publishing\n${post(17)}\nNext step: !publish reconcile 17`,
                ])
                assert.deepEqual(yield* say("!recovery publishing 19"), [
                    "Publishing has 18 entries. Send !recovery publishing to see them",
                ])
                // Entries that share a fix name it once
                assert.deepEqual(yield* say("!recovery setup"), [
                    "Recovery inbox: Setup\n1. Now: Autorole: on, but it needs a step before it works\nNext step: Add a role with `!autorole add @role`",
                ])
                assert.deepEqual(yield* say("!recovery Permission"), [
                    `Recovery inbox: Permissions\n1. ${minute(at)}: Moderation: Grant Kick members to the NeonFlux role\nNext step: \`!health\` checks again once it is fixed`,
                ])
                assert.deepEqual(yield* say("!recovery tickets"), ["Recovery inbox: Tickets\nNothing needs attention"])
                assert.deepEqual(yield* say("!recovery tickets 1"), ["Nothing in Tickets needs attention"])
                for (const content of ["!recovery next", "!recovery 2", "!recovery help"])
                    assert.deepEqual(yield* say(content), [
                        "Send !recovery to see what needs attention, then !recovery <area> to see one area",
                    ])
                assert.deepEqual(yield* say("!recovery nothing here"), [
                    "No area called nothing here. Send !recovery to see what needs attention, then !recovery <area> to see one area",
                ])
            }),
        ),
    )
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { say } = yield* setupBot(setup.store, { botPermissions: limited }, textReplies)
                assert.deepEqual(yield* say("?recovery publishing 1"), [
                    `**Recovery inbox: Publishing**\n${post(18)}\n**Next step:** ?publish reconcile 18`,
                ])
            }),
        ),
    )
})

test("recovery lists every stopped role removal, 10 a page with each one's next step, past the inbox's newest 10", async () => {
    // 25 stopped removals, newest first, and the backend pages them before the start time of the last one shown
    const removals = Array.from({ length: 25 }, (_, i): RecoveryEntry => ({
        kind: "work",
        source: "removals",
        at: at - i * 60000,
        summary: `Panel p${i}: Taking back its roles stopped at a role change that needs a check`,
        next: `Continue with !roles next p${i}`,
    }))
    const reads: (number | undefined)[] = []
    const page = (before: number) => {
        const older = removals.filter((entry) => entry.kind === "work" && entry.at! < before),
            shown = older.slice(0, 10)
        return {
            entries: shown,
            ...(older.length > 10 ? { nextRemovalsBefore: (shown.at(-1) as { at: number }).at } : {}),
        }
    }
    const store: SetupStore = {
        ...setupStore().store,
        recovery: (serverId, removalsBefore) =>
            Effect.sync(() => {
                reads.push(removalsBefore)
                return removalsBefore === undefined
                    ? { serverId, truncated: false, ...page(Number.MAX_SAFE_INTEGER) }
                    : { serverId, truncated: false, ...page(removalsBefore) }
            }),
    }
    const lines = (from: number, to: number) =>
        Array.from(
            { length: to - from + 1 },
            (_, i) =>
                `${from + i}. ${recoveryLine(removals[from + i - 1]!)}. Continue with !roles next p${from + i - 1}`,
        )
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { say } = yield* setupBot(store, { botPermissions: limited })
                assert.deepEqual(yield* say("!recovery"), [
                    [
                        "Recovery inbox",
                        "10 or more things need attention: Role removals 10 or more",
                        "Send `!recovery <area>` to see one, for example `!recovery removals`",
                    ].join("\n"),
                ])
                const next = "Next: `!recovery removals next`"
                assert.deepEqual(yield* say("!recovery removals"), [
                    ["Recovery inbox: Role removals", ...lines(1, 10), next].join("\n"),
                ])
                assert.deepEqual(yield* say("!recovery removals next"), [
                    ["Recovery inbox: Role removals", ...lines(11, 20), next].join("\n"),
                ])
                assert.deepEqual(yield* say("!recovery removals next"), [
                    ["Recovery inbox: Role removals", ...lines(21, 25)].join("\n"),
                ])
                assert.match((yield* say("!recovery removals next"))[0]!, /There is no next page/)
                assert.deepEqual(reads, [
                    undefined,
                    Number.MAX_SAFE_INTEGER,
                    removals[9]!.kind === "work" ? removals[9]!.at : 0,
                    removals[19]!.kind === "work" ? removals[19]!.at : 0,
                ])
            }),
        ),
    )
})

test("recovery in its worst case of 100 entries in every area stays one summary line", async () => {
    const sources = [
        "publishing",
        "schedules",
        "events",
        "suggestions",
        "roles",
        "temproles",
        "tickets",
        "cleanup",
        "greetings",
        "milestones",
        "logs",
        "helpdesk",
        "youtube",
        "defcon",
    ] as const
    const entries: RecoveryEntry[] = [
        { kind: "feature", feature: "tickets" },
        { kind: "setup", at, problem: { kind: "gateway", state: "Reconnecting" } },
        ...Array.from({ length: 98 }, (_, i): RecoveryEntry => ({
            kind: "work",
            source: sources[i % sources.length]!,
            at: at - i,
            summary: `Synthetic entry ${i}`,
            next: "Give NeonFlux View channel in <#1514700735009259522>",
        })),
    ]
    const store: SetupStore = {
        ...setupStore().store,
        recovery: (serverId) => Effect.succeed({ serverId, truncated: true, entries }),
    }
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { say } = yield* setupBot(store, { botPermissions: limited })
                assert.deepEqual(yield* say("!recovery"), [
                    [
                        "Recovery inbox",
                        "100 or more things need attention: Setup 1, Permissions 1, Publishing 7, Scheduled posts 7, Events 7, Suggestions 7, Roles 7, Temporary roles 7, " +
                            "Tickets 7, Message cleanup 7, Welcome and goodbye 7, Birthdays and anniversaries 7, Metadata logs 7, Help desk 7, YouTube alerts 7, DEFCON 7",
                        "Send `!recovery <area>` to see one, for example `!recovery setup`",
                    ].join("\n"),
                ])
                // Every area answers to its word, its name or a feature's word
                for (const [word, title] of [
                    ["schedule", "Scheduled posts"],
                    ["temprole", "Temporary roles"],
                    ["welcome", "Welcome and goodbye"],
                    ["birthdays", "Birthdays and anniversaries"],
                    ["Help desk", "Help desk"],
                    ["logs", "Metadata logs"],
                    ["YouTube", "YouTube alerts"],
                    ["defcon", "DEFCON"],
                    ["cleanup", "Message cleanup"],
                ] as const) {
                    const [reply] = yield* say(`!recovery ${word}`)
                    assert.equal(reply!.split("\n")[0], `Recovery inbox: ${title}`, word)
                    // Seven entries that share one fix name it once, after them
                    assert.deepEqual(
                        reply!.split("\n").slice(-1),
                        ["Next step: Give NeonFlux View channel in <#1514700735009259522>"],
                        word,
                    )
                }
            }),
        ),
    )
})

test("the backend's recovery inbox decodes every entry kind", async (t) => {
    mockBackend(t, (call) => {
        assert.equal(call.path, "/recovery/list")
        return { serverId: "10", truncated: true, entries: inbox }
    })
    const read = await Effect.runPromise(
        createSetupStore({
            url: "https://synthetic.invalid",
            secret: Redacted.make("synthetic-backend-secret"),
        }).recovery("10"),
    )
    assert.deepEqual(read.entries, inbox)
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
    assert.equal(
        problemText({ kind: "permissions", feature: "alerts", permissions: ["ViewAuditLog", "ManageGuild"] }),
        "Security alerts: Grant View activity log and Manage community to the NeonFlux role",
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
    assert.equal(
        problemText({ kind: "permissions", feature: "general", permissions: ["SendMessages"] }),
        "Replies: Grant Send messages to the NeonFlux role",
    )
    assert.equal(
        problemText({ kind: "gateway", state: "Recovering" }),
        "Connection: NeonFlux's connection to Fluxer is recovering. It reconnects on its own. If this lasts, tell the bot operator",
    )
})

test("the check reads every role picker role, so the 120th of 150 that ranks above NeonFlux is named in chat and on the dashboard", async () => {
    const recorded: (readonly SetupProblem[])[] = []
    let roleIds: string[] = []
    const store: SetupStore = {
        ...sectionsStore([{ id: "rolepicker", state: "on" }]),
        status: () =>
            Effect.sync(() => ({
                sections: [{ id: "rolepicker", state: "on" as const }],
                managedRoles: [{ feature: "rolepicker" as const, roleIds }],
                staffRoleIds: { moderation: [], cases: [], automod: [], security: [], appeals: [] },
                threadFeatures: [],
            })),
        ready: () => Effect.succeed({ queued: true }),
        record: (_serverId, problems) =>
            Effect.sync(() => {
                recorded.push(problems)
                return { recorded: true }
            }),
    }
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { bot, p, say } = yield* setupBot(store, { botPermissions: limited })
                // NeonFlux's role sits at 20, so only the 120th role, at 30, ranks above it
                const menu = Array.from({ length: 150 }, (_, i) =>
                    bot.fixtures.role({ position: i === 119 ? 30 : 2, name: `Pick ${i + 1}`, permissions: "0" }),
                )
                bot.rest.respond("GET /guilds/:id/roles", { body: [...p.roles, ...menu] })
                roleIds = menu.map((role) => role.id)
                const above = menu[119]!
                assert.deepEqual(yield* say("!health permissions"), [
                    [
                        "Missing permissions",
                        `<@&${above.id}> ranks at or above NeonFlux's role: Role picker`,
                        "Move the NeonFlux role above these roles",
                    ].join("\n"),
                ])
                yield* processSetupCheckPass(store, bot.fixtures.ids.guild, bot.client)
                assert.deepEqual(recorded, [
                    [{ kind: "hierarchy", feature: "rolepicker", roles: [{ id: above.id, name: "Pick 120" }] }],
                ])
            }),
        ),
    )
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

test("alert actions that are on need NeonFlux's own permission for them", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-setup-token" })
                platform(bot, { botPermissions: limited | Permissions.ViewAuditLog | Permissions.ManageGuild })
                const status = (alertActions?: ("kickBots" | "deleteWebhooks" | "removePermissions")[]) => ({
                    sections: [{ id: "alerts" as const, state: "on" as const }],
                    managedRoles: [],
                    staffRoleIds: { moderation: [], cases: [], automod: [], security: [], appeals: [] },
                    threadFeatures: [],
                    ...(alertActions ? { alertActions } : {}),
                })
                const alerts = (problems: readonly SetupProblem[]) =>
                    problems.filter((problem) => "feature" in problem && problem.feature === "alerts")
                assert.deepEqual(alerts(yield* readSetupProblems(bot.client, bot.fixtures.ids.guild, status())), [])
                assert.deepEqual(
                    alerts(
                        yield* readSetupProblems(
                            bot.client,
                            bot.fixtures.ids.guild,
                            status(["kickBots", "deleteWebhooks"]),
                        ),
                    ),
                    [{ kind: "permissions", feature: "alerts", permissions: ["KickMembers", "ManageWebhooks"] }],
                )
            }),
        ),
    )
})

test("suggestions need Add reactions for the vote reactions on each card", async () => {
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-setup-token" })
                platform(bot, { botPermissions: limited })
                const problems = yield* readSetupProblems(bot.client, bot.fixtures.ids.guild, {
                    sections: [{ id: "suggestions", state: "on" }],
                    managedRoles: [],
                    staffRoleIds: { moderation: [], cases: [], automod: [], security: [], appeals: [] },
                    threadFeatures: [],
                })
                assert.deepEqual(
                    problems.filter((problem) => "feature" in problem && problem.feature === "suggestions"),
                    [{ kind: "permissions", feature: "suggestions", permissions: ["AddReactions"] }],
                )
            }),
        ),
    )
})

test("recovery entries keep the members, roles and channels the backend writes as mentions", () => {
    const entry: RecoveryEntry = {
        kind: "work",
        source: "roles",
        at,
        summary: "<@1514700735009259520>: NeonFlux could not confirm whether it gave <@&1514700735009259521>",
        next: "!roles reconcile colors <@1514700735009259520>",
    }
    assert.equal(
        recoveryLine(entry),
        `${minute(at)}: <@1514700735009259520>: NeonFlux could not confirm whether it gave <@&1514700735009259521>`,
    )
    assert.equal(recoveryFix(entry), "!roles reconcile colors <@1514700735009259520>")
    assert.equal(
        recoveryLine({
            kind: "work",
            source: "publishing",
            summary: "Post #18: NeonFlux could not confirm whether it was sent",
            next: "!publish reconcile 18",
        }),
        "Now: Post #18: NeonFlux could not confirm whether it was sent",
    )
})
