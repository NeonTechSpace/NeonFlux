import assert from "node:assert/strict"
import test from "node:test"
import type { ModerationGateRequest } from "@neonflux/contracts/moderation"
import type {
    TicketIntakeRequest,
    TicketOpenIntake,
    TicketOutcomeRequest,
    TicketOverwrite,
    TicketQueryRequest,
    TicketQueryResult,
    TicketRecord,
    TicketManageRequest,
    TicketPanel,
    TicketSource,
    TicketTranscriptMessage,
    TicketVisibility,
} from "@neonflux/contracts/tickets"
import type { DashboardConfigurationReadyJob } from "@neonflux/contracts/dashboard"
import { ChannelType, Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot, type TestBot } from "@neontechspace/fluxerly/effect/testing"
import { Cause, Clock, Deferred, Effect, Fiber, Redacted, type Types } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { processDashboardConfigurationPass } from "../src/dashboard-configuration.ts"
import { parseServerScope } from "@neonflux/contracts/service"
import { claimed, fakeClient, mockBackend, prefixStore, quietSignal } from "./backend-fake.ts"
import {
    parseTicketCommand,
    ticketDestinationCommand,
    ticketDmOnlyCommand,
    type TicketCommand,
} from "../src/ticket-command.ts"
import { readTicketAuthority } from "../src/ticket-permissions.ts"
import { transcriptChunkBytes, transcriptFileParts } from "../src/ticket-transcripts.ts"
import { processTicketPass } from "../src/ticket-worker.ts"
import { performTicketChain, performTicketGrant } from "../src/tickets.ts"
import { TicketStoreError } from "../src/ticket-store.ts"
import { boundary, platform, token } from "./moderation-fixture.ts"
import { ticketBoundary } from "./ticket-fixture.ts"

type Bot = TestBot
type Body = {
    content?: string
    embeds?: {
        title?: string
        description?: string
        fields?: { name: string; value: string }[]
        footer?: { text: string }
    }[]
}
function native(bot: Bot, options: Parameters<typeof platform>[1] = {}) {
    const p = platform(bot, options),
        f = bot.fixtures
    p.channel.remove()
    p.replies.remove()
    type WireOverwrite = { id: string; type: number; allow: string; deny: string }
    const state = {
        channel: { ...f.channel({ name: "ticket-1", parent_id: null }), permission_overwrites: [] as WireOverwrite[] },
        deleted: false,
    }
    const fetch = bot.rest.respond(`GET /channels/${f.ids.channel}`, () =>
        state.deleted
            ? { status: 404, body: { code: "UNKNOWN_CHANNEL", message: "Synthetic absent channel" } }
            : { body: state.channel },
    )
    const create = bot.rest.respond(`POST /guilds/${f.ids.guild}/channels`, (request) => {
        state.channel = { ...state.channel, ...(request.body as object) }
        return { body: state.channel }
    })
    const overwrite = bot.rest.respond(`PUT /channels/${f.ids.channel}/permissions/:id`, (request) => {
        const id = request.path.split("/").at(-1)!,
            value = { id, ...(request.body as { type: number; allow: string; deny: string }) }
        state.channel = {
            ...state.channel,
            permission_overwrites: [...(state.channel.permission_overwrites ?? []).filter((o) => o.id !== id), value],
        }
        return { status: 204 }
    })
    const remove = bot.rest.respond(`DELETE /channels/${f.ids.channel}`, () => {
        state.deleted = true
        return { status: 204 }
    })
    const send = bot.rest.respond("POST /channels/:id/messages", (request) => {
        // The answer leaves out embeds, which replies render and introductions in these tests never carry
        const body = request.body as { content?: string; embeds?: object[] }
        return {
            body: f.message({
                channel_id: request.path.split("/")[2],
                author: f.botUser(),
                content: body.content ?? "",
                embeds: [],
            }),
        }
    })
    return { ...p, state, fetch, create, overwrite, remove, send }
}
function seed(remote: ReturnType<typeof ticketBoundary>, bot: Bot, visibility: TicketVisibility = "private") {
    return Effect.gen(function* () {
        const f = bot.fixtures,
            facts = yield* readTicketAuthority(bot.client, f.ids.guild, f.ids.user)
        const source: TicketSource = {
            serverId: f.ids.guild,
            messageId: f.nextId(),
            createdAt: yield* Clock.currentTimeMillis,
            context: facts.context,
        }
        remote.categories.set("support", {
            name: "support",
            revision: 1,
            enabled: true,
            visibility,
            parentId: null,
            description: "Synthetic support",
            supportRoleIds: [],
            questions: ["Synthetic question"],
            cannedReplies: [],
        })
        const ticket: Types.DeepMutable<TicketRecord> = {
            ticketNo: 1,
            requesterId: f.ids.user,
            requesterJoinedAt: facts.context.actor.joinedAt,
            categoryName: "support",
            categoryRevision: 1,
            visibility,
            supportRoleIds: [],
            state: "creating",
            generation: 1,
            botId: f.ids.bot,
            priority: "normal",
            createdAt: source.createdAt,
            erased: false,
            entryCount: 0,
        }
        remote.tickets.set(1, ticket)
        return { source, ticket, grant: remote.grant(ticket, source, "create") }
    })
}
const emit = (bot: Bot, content: string, channelId?: string, patch: Parameters<Bot["fixtures"]["message"]>[0] = {}) => {
    const raw = bot.fixtures.message({ content, ...(channelId ? { channel_id: channelId } : {}), ...patch })
    const { guild_id: _guild, ...dm } = raw
    return bot.emit("MESSAGE_CREATE", channelId ? dm : raw).pipe(Effect.andThen(bot.idle()))
}

test("ticket grammar requires audience, confirmation and bounded private input", () => {
    assert.deepEqual(parseTicketCommand(["category", "create", "Support", "private", "none", "none"]), {
        type: "category-create",
        name: "support",
        visibility: "private",
        supportRoleIds: [],
    })
    assert.deepEqual(parseTicketCommand(["submit", "1", "public"]), {
        type: "submit",
        intakeNo: 1,
        visibility: "public",
    })
    assert.deepEqual(parseTicketCommand(["category", "set", "support", "description", "x".repeat(1000)]), {
        type: "category-set",
        name: "support",
        field: "description",
        value: "x".repeat(1000),
    })
    for (const args of [
        ["category", "set", "support", "description", "x".repeat(1001)],
        ["submit", "1"],
        ["delete", "1"],
        ["erase", "1", "yes"],
        ["replay", "1"],
        ["answer", "1", "26", "x"],
        ["question", "support", "set", "26", "x"],
        ["answer", "1", "1", "x".repeat(2001)],
        ["question", "support", "add", "x".repeat(201)],
        ["transcript", "1", "capture", "501"],
    ])
        assert("error" in parseTicketCommand(args))
})

test("ticket grammar binds exact operation numbers, private configuration and explicit confirmations", () => {
    const f = createFixtures(),
        roleId = f.nextId(),
        parentId = f.nextId(),
        // More support roles than the old 20, up to the 250 roles a server may have
        manyRoles = Array.from({ length: 21 }, () => f.nextId())
    const cases: readonly [readonly string[], TicketCommand][] = [
        [
            ["category", "create", "Support", "private", `<#${parentId}>`, `<@&${roleId}>`, roleId],
            { type: "category-create", name: "support", visibility: "private", parentId, supportRoleIds: [roleId] },
        ],
        [
            ["category", "set", "SUPPORT", "parent", "none"],
            { type: "category-set", name: "support", field: "parent", value: null },
        ],
        [
            ["category", "set", "support", "staff", "none"],
            { type: "category-set", name: "support", field: "staff", value: [] },
        ],
        [
            ["question", "Support", "set", "5", "界".repeat(200)],
            { type: "question", name: "support", operation: "set", index: 5, text: "界".repeat(200) },
        ],
        [["answer", "20", "5", "😀".repeat(1000)], { type: "answer", intakeNo: 20, index: 5, text: "😀".repeat(1000) }],
        [["answer", "20", "25", "x"], { type: "answer", intakeNo: 20, index: 25, text: "x" }],
        [
            ["category", "set", "support", "staff", ...manyRoles.map((id) => `<@&${id}>`)],
            { type: "category-set", name: "support", field: "staff", value: manyRoles },
        ],
        [["reply", "20", "canned", "Thanks"], { type: "reply-canned", ticketNo: 20, name: "thanks" }],
        [["list", "next"], { type: "list", next: true }],
        [["note", "20", "list", "next"], { type: "notes", ticketNo: 20, next: true }],
        [["note", "20", "show", "3"], { type: "note-show", ticketNo: 20, noteNo: 3 }],
        [["show", "20"], { type: "show", ticketNo: 20 }],
        [["categories", "next"], { type: "categories", next: true }],
        [["canned", "support", "list", "next"], { type: "canned", category: "support", operation: "list", next: true }],
        [["transcript", "20", "capture"], { type: "transcript-capture", ticketNo: 20 }],
        [["transcript", "20", "file"], { type: "transcript-file", ticketNo: 20 }],
        [["transcript", "20", "file", "3"], { type: "transcript-file", ticketNo: 20, transcriptNo: 3 }],
        [["open"], { type: "open" }],
        [["show"], { type: "show" }],
        [["close"], { type: "close" }],
        [["priority", "high"], { type: "priority", priority: "high" }],
        [["reply", "Synthetic reply"], { type: "reply", text: "Synthetic reply" }],
        [["reply", "canned", "Thanks"], { type: "reply-canned", name: "thanks" }],
        [["panel", "Support", `<#${parentId}>`], { type: "panel", category: "support", channelId: parentId }],
        [["panel", "support", "remove"], { type: "panel-remove", category: "support" }],
        [["panels"], { type: "panels" }],
        [["panels", "next"], { type: "panels", next: true }],
        [["transcript", "20", "list", "next"], { type: "transcript-list", ticketNo: 20, next: true }],
        [["transcript", "20", "show", "2"], { type: "transcript-show", ticketNo: 20, transcriptNo: 2 }],
        [
            ["transcript", "20", "show", "2", "next"],
            { type: "transcript-show", ticketNo: 20, transcriptNo: 2, next: true },
        ],
        [["abandon", "20"], { type: "abandon", ticketNo: 20 }],
        [["attempt", "20"], { type: "attempt", ticketNo: 20 }],
        [["attempt", "20", "8"], { type: "attempt", ticketNo: 20, attemptNo: 8 }],
        [["delete", "20", "confirm"], { type: "delete", ticketNo: 20, confirmed: true }],
        [["erase", "20", "confirm"], { type: "erase", ticketNo: 20, confirmed: true }],
    ]
    for (const [input, expected] of cases) assert.deepEqual(parseTicketCommand(input), expected)
    // Lists page with next, never with a page or continuation number
    for (const args of [
        ["list", "5"],
        ["note", "1", "list", "19"],
        ["transcript", "1", "list", "3"],
        ["transcript", "1", "show", "1", "2"],
        ["categories", "2"],
        ["status", "1"],
        ["note", "1", "show", "0"],
        ["transcript", "1", "capture", "20"],
        ["transcript", "1", "file", "0"],
        ["panel", "support"],
        ["panels", "2"],
    ])
        assert("error" in parseTicketCommand(args))
    for (const args of [
        ["attempt", "1", "0"],
        ["attempt", "1", "9007199254740992"],
        ["transcript", "1", "show", "1", "0"],
        ["abandon", "1", "confirm"],
        ["submit", "01", "private"],
        ["answer", "1", "1", "\u202e\u000c  "],
        ["category", "create", "support", "public", "none"],
        ["category", "create", "support", "private", "none", "none", roleId],
    ])
        assert("error" in parseTicketCommand(args))
    // Only the intake forms stay in a DM, and private reads name who must be the only ones to see the channel
    const parsed = (args: readonly string[]) => {
        const value = parseTicketCommand(args)
        assert(!("error" in value))
        return value as TicketCommand
    }
    for (const args of [
        ["category", "set", "support", "enabled", "off"],
        ["category", "delete", "support"],
        ["question", "support", "clear"],
        ["canned", "support", "remove", "thanks"],
        ["attempt", "1", "1"],
        ["note", "1", "show", "1"],
        ["open", "support"],
        ["list"],
        ["transcript", "1", "capture"],
    ])
        assert(!ticketDmOnlyCommand(parsed(args)))
    for (const args of [
        ["answer", "1", "1", "x"],
        ["review", "1"],
        ["submit", "1", "private"],
        ["cancel", "1"],
    ])
        assert(ticketDmOnlyCommand(parsed(args)))
    assert(ticketDmOnlyCommand({ type: "intake-reply", intakeNo: 1, text: "x" }))
    for (const args of [
        ["intake", "1"],
        ["note", "1", "add", "x"],
        ["note", "1", "list"],
        ["note", "1", "show", "1"],
    ])
        assert.equal(ticketDestinationCommand(parsed(args)), "staff")
    for (const args of [
        ["transcript", "1", "list"],
        ["transcript", "1", "show", "1"],
        ["transcript", "1", "file"],
    ])
        assert.equal(ticketDestinationCommand(parsed(args)), "readers")
    for (const args of [
        ["transcript", "1", "capture"],
        ["attempt", "1"],
        ["show", "1"],
    ])
        assert.equal(ticketDestinationCommand(parsed(args)), undefined)
})

test("ticket commands work in a server channel, and private text answers only where its audience allows", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    p = native(bot)
                const { grant } = yield* seed(remote, bot)
                yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                remote.intakes.set(1, {
                    intakeNo: 1,
                    generation: 2,
                    category: {
                        name: "support",
                        revision: 1,
                        enabled: true,
                        visibility: "private",
                        description: "Synthetic support",
                        parentId: null,
                        supportRoleIds: [],
                        questions: ["Synthetic question"],
                    },
                    requesterId: f.ids.user,
                    joinedAt: remote.tickets.get(1)!.requesterJoinedAt,
                    answers: ["Synthetic intake answer"],
                    state: "submitted",
                    createdAt: 1,
                    expiresAt: Number.MAX_SAFE_INTEGER,
                    ticketNo: 1,
                })
                remote.transcripts.set(1, {
                    record: {
                        transcriptNo: 1,
                        ticketNo: 1,
                        channelId: f.ids.channel,
                        capturedAt: 1,
                        messageCount: 1,
                        truncated: false,
                        erased: false,
                        pages: 1,
                        automatic: true,
                    },
                    messages: [],
                    body: "Synthetic transcript body",
                })
                // A channel only staff see, and one every member sees
                const staffId = bot.fixtures.nextId(),
                    publicId = bot.fixtures.nextId()
                bot.rest.respond(`GET /channels/${staffId}`, {
                    body: f.channel({
                        id: staffId,
                        name: "staff",
                        permission_overwrites: [
                            { id: f.ids.guild, type: 0, allow: "0", deny: Permissions.ViewChannel.toString() },
                        ],
                    }),
                })
                bot.rest.respond(`GET /channels/${publicId}`, {
                    body: f.channel({ id: publicId, name: "general", permission_overwrites: [] }),
                })
                yield* bot.ready()
                const say = (content: string, channelId = f.ids.channel) =>
                    emit(bot, content, undefined, { channel_id: channelId })
                const last = () => JSON.stringify(p.send.requests().at(-1)!.body)
                // Category setup and attempts work in a server channel
                yield* say("!ticket category create billing private none none")
                assert(remote.categories.has("billing"))
                yield* say("!ticket attempt 1")
                assert(
                    remote.calls.some(
                        (c) => c.method === "query" && (c.input as TicketQueryRequest).operation.type === "attempt",
                    ),
                )
                // A channel that another role can see is no staff channel for this ticket, whose category has no support roles
                const otherId = bot.fixtures.nextId()
                bot.rest.respond(`GET /channels/${otherId}`, {
                    body: f.channel({
                        id: otherId,
                        name: "moderators",
                        permission_overwrites: [
                            { id: f.ids.guild, type: 0, allow: "0", deny: Permissions.ViewChannel.toString() },
                            { id: p.actorRole.id, type: 0, allow: Permissions.ViewChannel.toString(), deny: "0" },
                        ],
                    }),
                })
                yield* say('!ticket note 1 add "Synthetic staff note"', otherId)
                assert(last().includes("Staff notes answer only in a DM with NeonFlux"))
                assert(
                    !remote.calls.some(
                        (c) => c.method === "manage" && (c.input as TicketManageRequest).operation.type === "note",
                    ),
                )
                // The requester reads the ticket channel, so a note there is refused before any backend call
                const before = remote.calls.length
                yield* say('!ticket note 1 add "Synthetic staff note"')
                assert.equal(remote.calls.length, before)
                assert(last().includes("Staff notes answer only in a DM with NeonFlux"))
                yield* say('!ticket note 1 add "Synthetic staff note"', staffId)
                assert.equal(remote.entries.length, 1)
                const note = remote.calls.findLast((c) => c.method === "manage")!.input as TicketManageRequest
                assert.equal(note.context.destination?.channelId, staffId)
                assert.equal(note.context.actor.privateChannelVerified, false)
                // Intake answers never appear in the ticket channel, and answer in a staff-only one
                yield* say("!ticket intake 1")
                assert(last().includes("Intake answers show only in a DM with NeonFlux"))
                assert(!last().includes("Synthetic intake answer"))
                yield* say("!ticket intake 1", staffId)
                assert(last().includes("Synthetic intake answer"))
                // Transcripts answer in the private ticket channel, and never in a public one
                yield* say("!ticket transcript 1 show 1")
                assert(last().includes("Synthetic transcript body"))
                yield* say("!ticket transcript 1 show 1", publicId)
                assert(last().includes("This answers only in a DM with NeonFlux, the private ticket channel"))
                // In the ticket's own channel the number may be left out, and a DM asks for it
                yield* say("!ticket show")
                assert(last().includes("Ticket #1"))
                assert(
                    remote.calls.some(
                        (c) =>
                            c.method === "query" &&
                            JSON.stringify((c.input as TicketQueryRequest).operation) ===
                                JSON.stringify({ type: "ticket", channelId: f.ids.channel }),
                    ),
                )
                yield* emit(bot, "!ticket show", p.dmId)
                assert(last().includes("Name the ticket, such as"))
                // Answering an intake stays in a DM
                yield* say('!ticket answer 1 1 "Synthetic answer"')
                assert(last().includes("Answer intake questions only in a one-to-one DM with NeonFlux"))
                // A list in a server channel says when it left tickets out
                const query = remote.store.query
                remote.store.query = (input) =>
                    input.operation.type === "tickets"
                        ? Effect.succeed({ type: "tickets", tickets: [], hidden: true })
                        : query(input)
                yield* say("!ticket list", publicId)
                assert(last().includes("Tickets whose readers differ from this channel's are left out"))
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("private configuration and support queue use verified DM context without public body disclosure", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    p = native(bot)
                const { ticket } = yield* seed(remote, bot)
                remote.categories.get("support")!.questions = ["Synthetic private configuration question"]
                remote.categories.get("support")!.cannedReplies = [
                    {
                        name: "thanks",
                        templateName: "private-template",
                        templateRevision: 1,
                        content: { content: "Synthetic private canned body" },
                    },
                ]
                remote.tickets.set(2, { ...structuredClone(ticket), ticketNo: 2, requesterId: f.nextId() })
                yield* bot.ready()
                yield* emit(bot, "!ticket categories")
                assert(!JSON.stringify(p.send.requests()).includes("Synthetic private configuration"))
                assert(!JSON.stringify(p.send.requests()).includes("Synthetic private canned body"))
                yield* emit(bot, "!ticket category show support", p.dmId)
                yield* emit(bot, "!ticket canned support list", p.dmId)
                yield* emit(bot, "!ticket list", p.dmId)
                const queries = remote.calls
                    .filter((c) => c.method === "query")
                    .map((c) => c.input as TicketQueryRequest)
                assert(
                    queries
                        .filter((q) => q.operation.type !== "categories")
                        .every(
                            (q) =>
                                q.context.actor.privateChannelVerified && q.context.actor.privateChannelId === p.dmId,
                        ),
                )
                assert.deepEqual(queries.at(-1)!.operation, { type: "tickets" })
                assert(
                    p.send
                        .requests()
                        .some(
                            (r) =>
                                r.path.includes(p.dmId) &&
                                (r.body as Body).embeds?.[0]?.description?.includes("**#2** "),
                        ),
                )
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("a new category shows its card, and each change to it answers with one line that names it", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    p = native(bot)
                yield* bot.ready()
                for (const content of [
                    "category create support private none none",
                    'question support add "Synthetic question"',
                    "category set support enabled off",
                    "category set support visibility public",
                    "question support remove 1",
                ])
                    yield* emit(bot, `!ticket ${content}`, p.dmId)
                const dm = p.send
                    .requests()
                    .filter((r) => r.path.includes(p.dmId))
                    .map((r) => r.body as Body)
                assert.equal(dm[0]!.embeds?.[0]?.title, "Ticket category support")
                assert.deepEqual(
                    dm.slice(1).map((body) => body.content),
                    [
                        "Question added to support: Synthetic question. It has 1 question now",
                        "Ticket category support is off",
                        "Ticket category support now opens public conversations",
                        "Question 1 removed from support. It has 0 questions now",
                    ],
                )
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("a definite backend refusal gets its own reply, and only an unknown result warns that the action may have run", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    let status: number | null = 404,
        reason: string | undefined
    remote.store.manage = (input) =>
        Effect.fail(
            new TicketStoreError({
                operation: input.operation.type,
                status,
                ...(reason ? { code: "REFUSED", reason } : {}),
            }),
        )
    remote.categories.set("support", {
        name: "support",
        revision: 1,
        enabled: true,
        visibility: "private",
        parentId: null,
        description: "Synthetic support",
        supportRoleIds: [],
        questions: [],
        cannedReplies: [],
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    p = native(bot)
                yield* bot.ready()
                const replies: (string | undefined)[] = []
                for (const [next, why] of [
                    [404, undefined],
                    [409, undefined],
                    [429, undefined],
                    [null, undefined],
                    [409, "A ticket category with that name already exists. Choose another name"],
                ] as const) {
                    status = next
                    reason = why
                    yield* emit(bot, "!ticket category set support enabled off", p.dmId)
                    replies.push((p.send.requests().at(-1)!.body as Body).content)
                }
                assert.deepEqual(replies, [
                    "NeonFlux could not find that ticket, category or saved reply. Check the number or name",
                    "The ticket changed or does not allow that right now. Check it with `!ticket show <number>` before you try again",
                    "A ticket limit was reached. Close tickets you no longer need, or wait a minute and try again",
                    "The ticket action could not be confirmed. Check the ticket's status before you try again. NeonFlux never repeats an action whose result is unknown",
                    "A ticket category with that name already exists. Choose another name",
                ])
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("private intake through actual gateway uses explicit audience and never posts answers into a public conversation", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                )
                const p = native(bot)
                yield* bot.ready()
                yield* emit(bot, "!ticket category create support public none none", p.dmId)
                yield* emit(bot, '!ticket question support add "Synthetic private question"', p.dmId)
                // Opening in the server starts the intake in the member's DM, and the server reply holds no question
                yield* emit(bot, "!ticket open support")
                assert.equal(remote.intakes.size, 1)
                const opening = p.send
                    .requests()
                    .filter((r) => r.path.includes(p.dmId))
                    .at(-1)!
                assert(JSON.stringify(opening.body).includes("Question 1 of 1: Synthetic private question"))
                assert(
                    JSON.stringify(p.send.requests().at(-1)!.body).includes(
                        "Intake #1 for support started in your DMs with NeonFlux. Answer the questions there",
                    ),
                )
                yield* emit(bot, '!ticket answer 1 1 "Synthetic private answer"', p.dmId)
                yield* emit(bot, "!ticket review 1", p.dmId)
                yield* emit(bot, "!ticket submit 1 public", p.dmId)
                assert.equal(remote.tickets.get(1)?.state, "open")
                assert.equal(p.create.requests().length, 1)
                const envelope = p.create.requests()[0]!.body as {
                    permission_overwrites: { id: string; allow: string }[]
                }
                assert.equal(envelope.permission_overwrites.length, 3)
                assert(
                    BigInt(envelope.permission_overwrites.find((o) => o.id === f.ids.guild)!.allow) &
                        Permissions.ViewChannel,
                )
                const publicBodies = p.send
                    .requests()
                    .filter((r) => r.path.includes(f.ids.channel))
                    .map((r) => JSON.stringify(r.body))
                    .join("\n")
                assert(!publicBodies.includes("Synthetic private answer"))
                assert(!publicBodies.includes("Synthetic private question"))
                assert(
                    p.send
                        .requests()
                        .filter((r) => r.path.includes(p.dmId))
                        .some((r) => JSON.stringify(r.body).includes("Public conversation")),
                )
                for (const request of p.send.requests())
                    assert.deepEqual((request.body as { allowed_mentions: object }).allowed_mentions, {
                        parse: [],
                        users: [],
                        roles: [],
                        replied_user: false,
                    })
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("a server-channel ticket open that cannot reach the DM opens nothing, and a lost first question keeps the intake", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                )
                const p = native(bot)
                yield* bot.ready()
                yield* emit(bot, "!ticket category create support private none none", p.dmId)
                yield* emit(bot, '!ticket question support add "Synthetic private question"', p.dmId)
                // The first question cannot be sent, so the reply says how to continue the intake from a DM
                p.send.remove()
                const sends = bot.rest.respond("POST /channels/:id/messages", (request) =>
                    request.path.includes(p.dmId)
                        ? {
                              status: 403,
                              body: { code: "CANNOT_SEND_MESSAGES_TO_USER", message: "Synthetic closed DMs" },
                          }
                        : {
                              body: f.message({
                                  channel_id: request.path.split("/")[2],
                                  author: f.botUser(),
                                  content: (request.body as Body).content ?? "",
                                  embeds: [],
                              }),
                          },
                )
                yield* emit(bot, "!ticket open support")
                assert.equal(remote.intakes.size, 1)
                const reply = (
                    sends
                        .requests()
                        .filter((r) => r.path === `/channels/${f.ids.channel}/messages`)
                        .at(-1)!.body as Body
                ).content
                assert.equal(
                    reply,
                    "Intake #1 opened, but NeonFlux could not send the first question. Send `!ticket review 1` to NeonFlux in a DM to continue",
                )
                // Without a DM no intake is made, and the reply asks the member to allow DMs
                sends.remove()
                const replies = bot.rest.respond("POST /channels/:id/messages", (request) => ({
                    body: f.message({
                        channel_id: request.path.split("/")[2],
                        author: f.botUser(),
                        content: (request.body as Body).content ?? "",
                        embeds: [],
                    }),
                }))
                p.open.remove()
                const opens = bot.rest.respond("POST /users/@me/channels", {
                    status: 403,
                    body: { code: "CANNOT_SEND_MESSAGES_TO_USER", message: "Synthetic closed DMs" },
                })
                remote.intakes.clear()
                yield* emit(bot, "!ticket open support")
                assert.equal(opens.requests().length, 1)
                assert.equal(remote.intakes.size, 0)
                assert.deepEqual(
                    replies.requests().map((r) => [r.path, (r.body as Body).content]),
                    [
                        [
                            `/channels/${f.ids.channel}/messages`,
                            "NeonFlux could not send you a DM. Allow direct messages from this server, then try again",
                        ],
                    ],
                )
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("ticket gateway ignores unrelated staff gates but preserves native message protection and private recipient checks", async () => {
    const f = createFixtures(),
        remote = ticketBoundary(),
        moderation = boundary()
    moderation.current.defcon = 1
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions(
                        { token, serverId: f.ids.guild },
                        { moderation: moderation.store, tickets: remote.store },
                    ),
                )
                const p = native(bot, {
                    actorOwner: false,
                    actorPermissions:
                        Permissions.ViewChannel | Permissions.ReadMessageHistory | Permissions.SendMessages,
                })
                yield* bot.ready()
                yield* emit(bot, "!ticket categories")
                assert.equal(remote.calls.filter((c) => c.method === "query").length, 1)
                // An empty list is the same card as a full one
                assert.deepEqual((p.send.requests().at(-1)!.body as Body).embeds, [
                    { color: 0x5560e6, title: "Ticket categories", description: "No ticket categories yet" },
                ])
                const gate = moderation.calls.find((c) => c.method === "gate")!.input as ModerationGateRequest
                assert.equal(gate.command, "critical")
                assert.equal(gate.actor.isAdministrator, false)
                moderation.current.automodEnabled = true
                moderation.store.evaluate = () => Effect.succeed({ duplicate: false, blocked: true })
                yield* emit(bot, "!ticket categories")
                assert.equal(remote.calls.filter((c) => c.method === "query").length, 1)
                p.privateFetch.remove()
                bot.rest.respond(`GET /channels/${p.dmId}`, { body: { id: p.dmId, type: 3, recipients: [f.user()] } })
                yield* emit(bot, "!ticket open support", p.dmId)
                assert.equal(remote.calls.filter((c) => c.method === "intake").length, 0)
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("private create sends its entire audience atomically and known identity survives incomplete native snapshots", async () => {
    for (const incomplete of [false, true]) {
        const remote = ticketBoundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                        p = native(bot),
                        f = bot.fixtures
                    const { grant } = yield* seed(remote, bot)
                    if (incomplete) {
                        p.create.remove()
                        bot.rest.respond(`POST /guilds/${f.ids.guild}/channels`, {
                            body: { id: f.ids.channel, guild_id: f.ids.guild, type: 0 },
                        })
                    }
                    const result = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant)
                    assert.equal(result.outcome, incomplete ? "uncertain" : "succeeded")
                    assert.equal("channelId" in result && result.channelId, f.ids.channel)
                    const outcome = remote.calls.find((c) => c.method === "outcome")!.input as TicketOutcomeRequest
                    assert.equal(outcome.channelId, f.ids.channel)
                    if (!incomplete) {
                        const everyone = (
                            p.create.requests()[0]!.body as {
                                permission_overwrites: { id: string; allow: string; deny: string }[]
                            }
                        ).permission_overwrites.find((o) => o.id === f.ids.guild)!
                        assert.equal(BigInt(everyone.allow) & Permissions.ViewChannel, 0n)
                        assert(BigInt(everyone.deny) & Permissions.ViewChannel)
                    }
                    assert.equal(
                        (yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant)).recorded,
                        false,
                    )
                }),
            ),
        )
    }
})

test("native ticket ownership compares overwrite fields independently of backend object property ordering", async () => {
    const remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                    p = native(bot),
                    f = bot.fixtures
                const { grant } = yield* seed(remote, bot),
                    outcome = remote.store.outcome
                const reordered = (entry: TicketOverwrite): TicketOverwrite => ({
                    deny: entry.deny,
                    allow: entry.allow,
                    type: entry.type,
                    id: entry.id,
                })
                grant.overwrites = grant.overwrites!.map(reordered)
                remote.store.outcome = (input) =>
                    outcome(input).pipe(
                        Effect.map((result) =>
                            result.grant?.expectedChannel
                                ? {
                                      ...result,
                                      grant: {
                                          ...result.grant,
                                          expectedChannel: {
                                              ...result.grant.expectedChannel,
                                              overwrites: result.grant.expectedChannel.overwrites.map(reordered),
                                          },
                                      },
                                  }
                                : result,
                        ),
                    )
                const results = yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                assert.deepEqual(
                    results.map((r) => r.outcome),
                    ["succeeded", "succeeded"],
                )
                assert.equal(p.create.requests().length, 1)
                assert.equal(p.send.requests().length, 1)
            }),
        ),
    )
})

test("ticket close and reopen own only posting bits, reverse exact steps and preserve unrelated changes", async () => {
    const threadBits =
        Permissions.SendMessagesInThreads | Permissions.CreatePublicThreads | Permissions.CreatePrivateThreads
    // A bot holding no thread permission owns SendMessages only and leaves thread bits alone
    for (const owned of [Permissions.SendMessages | threadBits, Permissions.SendMessages]) {
        const remote = ticketBoundary({}, owned)
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                        p = native(bot),
                        f = bot.fixtures
                    const { source, ticket, grant } = yield* seed(remote, bot)
                    assert.equal((yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)).length, 2)
                    const original = structuredClone(ticket.channel!)
                    ticket.generation++
                    const close = remote.grant(ticket, source, "close-everyone")
                    p.state.channel.permission_overwrites = p.state.channel.permission_overwrites!.map((o) =>
                        o.id === f.ids.user
                            ? { ...o, allow: (BigInt(o.allow) | Permissions.AddReactions).toString() }
                            : o,
                    )
                    const results = yield* performTicketChain(remote.store, f.ids.guild, bot.client, close)
                    assert(results.every((r) => r.outcome === "succeeded"))
                    assert.equal(ticket.state, "closed")
                    assert.deepEqual(
                        p.overwrite.requests().map((r) => r.path.split("/").at(-1)),
                        [f.ids.guild, f.ids.user],
                    )
                    for (const id of [f.ids.guild, f.ids.user]) {
                        const closed = p.state.channel.permission_overwrites!.find((o) => o.id === id)!
                        assert.equal(BigInt(closed.deny) & (Permissions.SendMessages | threadBits), owned)
                    }
                    ticket.generation++
                    const reopen = remote.grant(ticket, source, "reopen-requester")
                    const reopened = yield* performTicketChain(remote.store, f.ids.guild, bot.client, reopen)
                    assert(reopened.every((r) => r.outcome === "succeeded"))
                    assert.equal(ticket.state, "open")
                    assert.deepEqual(
                        p.overwrite
                            .requests()
                            .slice(2)
                            .map((r) => r.path.split("/").at(-1)),
                        [f.ids.user, f.ids.guild],
                    )
                    for (const o of original.overwrites) {
                        const current = ticket.channel!.overwrites.find((v) => v.id === o.id)!
                        assert.equal(BigInt(current.allow) & owned, BigInt(o.allow) & owned)
                        assert.equal(BigInt(current.deny) & owned, BigInt(o.deny) & owned)
                    }
                    assert(
                        BigInt(ticket.channel!.overwrites.find((o) => o.id === f.ids.user)!.allow) &
                            Permissions.AddReactions,
                    )
                }),
            ),
        )
    }
})

test("a close first allows the bot the posting bits it denies, because Fluxer lets it lift a denial only of bits it holds", async () => {
    const threadBits =
        Permissions.SendMessagesInThreads | Permissions.CreatePublicThreads | Permissions.CreatePrivateThreads
    const held =
        Permissions.ManageRoles |
        Permissions.ManageChannels |
        Permissions.ViewChannel |
        Permissions.ReadMessageHistory |
        Permissions.SendMessages |
        Permissions.EmbedLinks |
        threadBits
    const remote = ticketBoundary({}, Permissions.SendMessages | threadBits)
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                    p = native(bot, { botPermissions: held }),
                    f = bot.fixtures
                const { source, ticket, grant } = yield* seed(remote, bot)
                yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                ticket.generation++
                const close = remote.grant(ticket, source, "close-everyone")
                const results = yield* performTicketChain(remote.store, f.ids.guild, bot.client, close)
                assert(results.every((r) => r.outcome === "succeeded"))
                const botId = (yield* bot.client.users.fetchSelf()).id
                assert.deepEqual(
                    p.overwrite.requests().map((r) => r.path.split("/").at(-1)),
                    [botId, f.ids.guild, f.ids.user],
                )
                const own = p.state.channel.permission_overwrites!.find((o) => o.id === botId)!
                assert.equal(
                    BigInt(own.allow) & (Permissions.SendMessages | threadBits),
                    Permissions.SendMessages | threadBits,
                )
                assert.equal(BigInt(own.deny) & (Permissions.SendMessages | threadBits), 0n)
            }),
        ),
    )
})

test("close refuses widened private audience and nonstaff send grants without a native write", async () => {
    for (const allowed of [Permissions.ViewChannel, Permissions.SendMessages, Permissions.SendMessagesInThreads]) {
        const remote = ticketBoundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                        p = native(bot),
                        f = bot.fixtures
                    const { source, ticket, grant } = yield* seed(remote, bot)
                    yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                    ticket.generation++
                    const close = remote.grant(ticket, source, "close-everyone")
                    p.state.channel.permission_overwrites!.push({
                        id: f.nextId(),
                        type: 1,
                        allow: allowed.toString(),
                        deny: "0",
                    })
                    assert.equal(
                        (yield* performTicketGrant(remote.store, f.ids.guild, bot.client, close)).outcome,
                        "failed",
                    )
                    assert.equal(p.overwrite.requests().length, 0)
                }),
            ),
        )
    }
})

test("lost followup acknowledgement never repeats create or infers introduction delivery", async () => {
    const remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                    p = native(bot),
                    f = bot.fixtures
                const { grant } = yield* seed(remote, bot),
                    outcome = remote.store.outcome
                remote.store.outcome = (input) =>
                    outcome(input).pipe(
                        Effect.andThen(Effect.fail(new TicketStoreError({ operation: "outcome", status: null }))),
                    )
                const result = yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                assert.equal(result.length, 1)
                assert.equal(result[0]!.recorded, false)
                yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                assert.equal(p.create.requests().length, 1)
                assert.equal(p.send.requests().length, 0)
            }),
        ),
    )
})

test("denied and lost exact claims cannot create or finalize another worker", async () => {
    for (const lost of [false, true]) {
        const remote = ticketBoundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                        p = native(bot),
                        f = bot.fixtures
                    const { grant } = yield* seed(remote, bot)
                    remote.store.dispatch = () =>
                        lost
                            ? Effect.fail(new TicketStoreError({ operation: "dispatch", status: null }))
                            : Effect.succeed({
                                  claimed: false,
                                  dispatchExpiresAt: grant.dispatchExpiresAt,
                                  nativeDeadlineMs: 5000,
                              })
                    const result = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant)
                    assert.equal(result.recorded, false)
                    assert.equal(p.create.requests().length, 0)
                    assert.equal(remote.calls.filter((c) => c.method === "outcome").length, 0)
                }),
            ),
        )
    }
})

test("interruption before a confirmed claim cannot write or finalize another claimant", async () => {
    for (const duringClaim of [false, true]) {
        const remote = ticketBoundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                        p = native(bot),
                        f = bot.fixtures
                    const { grant } = yield* seed(remote, bot),
                        entered = yield* Deferred.make<void>(),
                        release = yield* Deferred.make<void>()
                    if (duringClaim)
                        remote.store.dispatch = (input) => {
                            remote.calls.push({ method: "dispatch", input })
                            return Deferred.succeed(entered, undefined).pipe(
                                Effect.andThen(Deferred.await(release)),
                                Effect.as({
                                    claimed: true,
                                    dispatchExpiresAt: grant.dispatchExpiresAt,
                                    nativeDeadlineMs: 5000,
                                }),
                            )
                        }
                    else {
                        p.actor.remove()
                        bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, async () => {
                            await Effect.runPromise(Deferred.succeed(entered, undefined))
                            await Effect.runPromise(Deferred.await(release))
                            return { body: f.member({ roles: [p.actorRole.id], communication_disabled_until: null }) }
                        })
                    }
                    const running = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant).pipe(
                        Effect.forkChild,
                    )
                    yield* Deferred.await(entered)
                    yield* Fiber.interrupt(running)
                    yield* Deferred.succeed(release, undefined)
                    assert.equal(p.create.requests().length, 0)
                    assert.equal(remote.calls.filter((c) => c.method === "outcome").length, 0)
                    assert.equal(remote.calls.filter((c) => c.method === "dispatch").length, duringClaim ? 1 : 0)
                    const result = yield* Fiber.await(running)
                    assert.equal(result._tag, "Failure")
                    if (result._tag === "Failure") assert(Cause.hasInterrupts(result.cause))
                }),
            ),
        )
    }
})

test("ticket expiry is checked after a delayed claim using a controlled clock", async () => {
    const remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                    p = native(bot),
                    f = bot.fixtures
                const { grant } = yield* seed(remote, bot),
                    entered = yield* Deferred.make<void>(),
                    release = yield* Deferred.make<void>()
                grant.dispatchExpiresAt = 180000
                remote.store.dispatch = () =>
                    Deferred.succeed(entered, undefined).pipe(
                        Effect.andThen(Deferred.await(release)),
                        Effect.as({ claimed: true, dispatchExpiresAt: 180000, nativeDeadlineMs: 5000 }),
                    )
                const running = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant).pipe(
                    Effect.forkChild,
                )
                yield* Deferred.await(entered)
                yield* TestClock.adjust("180000 millis")
                yield* Deferred.succeed(release, undefined)
                assert.equal((yield* Fiber.join(running)).outcome, "failed")
                assert.equal(p.create.requests().length, 0)
                const outcome = remote.calls.find((c) => c.method === "outcome")!.input as TicketOutcomeRequest
                assert.equal(outcome.noDispatch, true)
                assert.match(outcome.claimToken!, /^[a-f0-9]{32}$/)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test("native rejection stays uncertain while actual SDK validation proves nondispatch", async () => {
    for (const badInput of [false, true]) {
        const remote = ticketBoundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                        p = native(bot),
                        f = bot.fixtures
                    const { grant } = yield* seed(remote, bot)
                    p.create.remove()
                    const request = bot.rest.respond(`POST /guilds/${f.ids.guild}/channels`, {
                        status: 403,
                        body: { message: "Synthetic denied create" },
                    })
                    if (badInput) grant.channelName = "x".repeat(101)
                    const result = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant)
                    assert.equal(result.outcome, badInput ? "failed" : "uncertain")
                    assert.equal(request.requests().length, badInput ? 0 : 1)
                    assert.equal(
                        (remote.calls.find((c) => c.method === "outcome")!.input as TicketOutcomeRequest).noDispatch,
                        badInput ? true : undefined,
                    )
                }),
            ),
        )
    }
})

test(
    "ticket native create that was sent but not answered within five seconds is uncertain",
    { timeout: 10000 },
    async () => {
        const remote = ticketBoundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                        p = native(bot),
                        f = bot.fixtures
                    const { grant } = yield* seed(remote, bot),
                        entered = yield* Deferred.make<void>(),
                        release = yield* Deferred.make<void>()
                    p.create.remove()
                    const create = bot.rest.respond(`POST /guilds/${f.ids.guild}/channels`, async () => {
                        await Effect.runPromise(Deferred.succeed(entered, undefined))
                        await Effect.runPromise(Deferred.await(release))
                        return { body: p.state.channel }
                    })
                    const running = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant).pipe(
                        Effect.forkChild,
                    )
                    yield* Deferred.await(entered)
                    yield* TestClock.adjust("5 seconds")
                    assert.equal((yield* Fiber.join(running)).outcome, "uncertain")
                    assert.equal(create.requests().length, 1)
                    yield* Deferred.succeed(release, undefined)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

test(
    "ticket native create that Fluxer's rate limit holds past five seconds is never sent and fails",
    { timeout: 10000 },
    async () => {
        const remote = ticketBoundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                        p = native(bot),
                        f = bot.fixtures
                    const { grant } = yield* seed(remote, bot)
                    p.create.remove()
                    // One refused create teaches the SDK a ten-second wait, longer than the ticket's deadline and shorter than the SDK default
                    const create = bot.rest.respond(`POST /guilds/${f.ids.guild}/channels`, {
                        status: 429,
                        body: { message: "Synthetic rate limit", retry_after: 10, global: false },
                    })
                    yield* bot.client.channels
                        .create(f.ids.guild, { type: ChannelType.Text, name: "rate-limit-probe" }, { timeoutMs: 1000 })
                        .pipe(Effect.ignore)
                    assert.equal(create.requests().length, 1)
                    const result = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant)
                    assert.equal(result.outcome, "failed")
                    assert.equal(create.requests().length, 1)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

test("partial close retains the confirmed first step and never claims a rejected second step closed", async () => {
    const remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                    f = bot.fixtures
                native(bot)
                const { source, ticket, grant } = yield* seed(remote, bot)
                yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                ticket.generation++
                const close = remote.grant(ticket, source, "close-everyone")
                bot.rest.respond(`PUT /channels/${f.ids.channel}/permissions/${f.ids.user}`, {
                    status: 403,
                    body: { message: "Synthetic second step failure" },
                })
                const results = yield* performTicketChain(remote.store, f.ids.guild, bot.client, close)
                assert.deepEqual(
                    results.map((r) => r.outcome),
                    ["succeeded", "uncertain"],
                )
                assert.equal(ticket.state, "uncertain")
                assert(
                    BigInt(ticket.channel!.overwrites.find((o) => o.id === f.ids.guild)!.deny) &
                        Permissions.SendMessages,
                )
                assert(
                    BigInt(ticket.channel!.overwrites.find((o) => o.id === f.ids.user)!.allow) &
                        Permissions.SendMessages,
                )
            }),
        ),
    )
})

test("interruption after known create identity preserves ownership in a bounded uncertain finalizer", async () => {
    const remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                    p = native(bot),
                    f = bot.fixtures
                const { grant } = yield* seed(remote, bot),
                    entered = yield* Deferred.make<void>(),
                    release = yield* Deferred.make<void>()
                p.fetch.remove()
                bot.rest.respond(`GET /channels/${f.ids.channel}`, async () => {
                    await Effect.runPromise(Deferred.succeed(entered, undefined))
                    await Effect.runPromise(Deferred.await(release))
                    return { body: p.state.channel }
                })
                const running = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant).pipe(
                    Effect.forkChild,
                )
                yield* Deferred.await(entered)
                yield* Fiber.interrupt(running)
                yield* Deferred.succeed(release, undefined)
                const outcome = remote.calls.find((c) => c.method === "outcome")!.input as TicketOutcomeRequest
                assert.equal(outcome.outcome, "uncertain")
                assert.equal(outcome.channelId, f.ids.channel)
                assert(outcome.channel)
                assert.equal(p.create.requests().length, 1)
            }),
        ),
    )
})

test("native deletion requires positive acknowledgment and typed404 without repeating a delete after read failure", async () => {
    for (const readStatus of [404, 403]) {
        const remote = ticketBoundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                        p = native(bot),
                        f = bot.fixtures
                    const { source, ticket, grant } = yield* seed(remote, bot)
                    yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                    ticket.generation++
                    const remove = remote.grant(ticket, source, "delete")
                    p.fetch.remove()
                    bot.rest.respond(`GET /channels/${f.ids.channel}`, () =>
                        p.state.deleted
                            ? {
                                  status: readStatus,
                                  body: { code: "UNKNOWN_CHANNEL", message: "Synthetic absence or denied visibility" },
                              }
                            : { body: p.state.channel },
                    )
                    const result = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, remove)
                    assert.equal(result.outcome, readStatus === 404 ? "succeeded" : "uncertain")
                    const outcome = remote.calls.filter((c) => c.method === "outcome").at(-1)!
                        .input as TicketOutcomeRequest
                    assert.equal(outcome.nativeDeleteConfirmed, true)
                    assert.equal(outcome.channelAbsent, readStatus === 404 ? true : undefined)
                    yield* performTicketGrant(remote.store, f.ids.guild, bot.client, remove)
                    assert.equal(p.remove.requests().length, 1)
                }),
            ),
        )
    }
})

test(
    "interrupted ticket finalization cannot hold shutdown past its five second budget",
    { timeout: 10000 },
    async () => {
        const remote = ticketBoundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                        p = native(bot),
                        f = bot.fixtures
                    const { grant } = yield* seed(remote, bot),
                        entered = yield* Deferred.make<void>(),
                        release = yield* Deferred.make<void>(),
                        finalizing = yield* Deferred.make<void>(),
                        cancelled = yield* Deferred.make<void>()
                    p.fetch.remove()
                    bot.rest.respond(`GET /channels/${f.ids.channel}`, async () => {
                        await Effect.runPromise(Deferred.succeed(entered, undefined))
                        await Effect.runPromise(Deferred.await(release))
                        return { body: p.state.channel }
                    })
                    remote.store.outcome = () =>
                        Deferred.succeed(finalizing, undefined).pipe(
                            Effect.andThen(Effect.never),
                            Effect.onInterrupt(() => Deferred.succeed(cancelled, undefined)),
                        )
                    const running = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant).pipe(
                        Effect.forkChild,
                    )
                    yield* Deferred.await(entered)
                    const interrupting = yield* Fiber.interrupt(running).pipe(Effect.forkChild)
                    yield* Deferred.await(finalizing)
                    yield* TestClock.adjust("5 seconds")
                    yield* Fiber.join(interrupting)
                    yield* Deferred.await(cancelled)
                    yield* Deferred.succeed(release, undefined)
                    const result = yield* Fiber.await(running)
                    assert.equal(result._tag, "Failure")
                    if (result._tag === "Failure") assert(Cause.hasInterrupts(result.cause))
                    assert.equal(p.create.requests().length, 1)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

test("owner erase uses current server authority and locator generation without requiring channel visibility", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    p = native(bot)
                const { ticket } = yield* seed(remote, bot)
                ticket.channelId = f.ids.channel
                p.fetch.remove()
                const forbidden = bot.rest.respond(`GET /channels/${f.ids.channel}`, {
                    status: 403,
                    body: { message: "Synthetic no channel visibility" },
                })
                yield* bot.ready()
                yield* emit(bot, "!ticket erase 1 confirm")
                assert.equal(ticket.erased, true)
                assert.equal(forbidden.requests().length, 0)
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("reconcile of a ticket without a last action still reports a channel that is gone", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    p = native(bot)
                const { ticket, grant } = yield* seed(remote, bot)
                yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                // Retention removed the last action
                delete ticket.currentAttempt
                p.fetch.remove()
                bot.rest.respond(`GET /channels/${f.ids.channel}`, {
                    status: 404,
                    body: { code: "UNKNOWN_CHANNEL", message: "Synthetic absent channel" },
                })
                yield* bot.ready()
                yield* emit(bot, "!ticket reconcile 1", p.dmId)
                const sent = remote.calls.filter((call) => call.method === "reconcile")
                assert.equal(sent.length, 1)
                const request = sent[0]!.input as { attemptId?: string; observation: { channelAbsent: boolean } }
                assert.equal(request.attemptId, undefined)
                assert.equal(request.observation.channelAbsent, true)
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("show gives a short card, and the private exact attempt keeps older outcomes without rendering authored payloads", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    p = native(bot)
                const { source, ticket, grant } = yield* seed(remote, bot)
                yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                const old = remote.attempts.get(2)!
                old.content = { content: "Synthetic hidden authored payload" }
                old.messageId = f.nextId()
                ticket.generation++
                remote.grant(ticket, source, "reply").content = { content: "Synthetic newer payload" }
                yield* bot.ready()
                yield* emit(bot, "!ticket show 1")
                // The card names the ticket's state, people and place, and leaves the last action's details to !ticket attempt
                const shown = (p.send.requests().at(-1)!.body as Body).embeds!
                assert.equal(shown.length, 1)
                assert.equal(shown[0]!.title, "Ticket #1")
                assert.equal(shown[0]!.description, undefined)
                assert.deepEqual(
                    shown[0]!.fields!.map((field) => field.name),
                    ["Status", "Requester", "Claimed by", "Category", "Priority", "Channel", "Opened"],
                )
                assert.equal(shown[0]!.fields![3]!.value, "support, private conversation")
                yield* emit(bot, "!ticket attempt 1 2", p.dmId)
                const bodies = p.send
                    .requests()
                    .map((r) => JSON.stringify(r.body))
                    .join("\n")
                assert(!bodies.includes("Last action"))
                assert(!bodies.includes("for `!ticket attempt"))
                assert(bodies.includes('"title":"Ticket #1, attempt 2"'))
                assert(
                    bodies.includes(
                        '{"name":"Outcome","value":"Done"},{"name":"Action","value":"Post the introduction"}',
                    ),
                )
                assert(!bodies.includes("Synthetic hidden authored payload"))
                assert(!bodies.includes("Synthetic newer payload"))
                const request = remote.calls
                    .filter((c) => c.method === "query" && (c.input as TicketQueryRequest).operation.type === "attempt")
                    .at(-1)!.input as TicketQueryRequest
                assert.deepEqual(request.operation, { type: "attempt", ticketNo: 1, attemptNo: 2 })
                assert.equal(request.context.actor.privateChannelVerified, true)
                // Without a number it shows the ticket's last action, since attempt numbers count across the server
                const last = ticket.currentAttempt!.attemptNo
                assert.notEqual(last, 2)
                yield* emit(bot, "!ticket attempt 1", p.dmId)
                assert.equal((p.send.requests().at(-1)!.body as Body).embeds![0]!.title, `Ticket #1, attempt ${last}`)
                assert.equal(p.create.requests().length, 1)
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("private transcript display pages through the stored transcript body", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    p = native(bot)
                const { ticket, grant } = yield* seed(remote, bot)
                yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                const body = `Synthetic first page ${"x".repeat(1800)}Synthetic second page`
                remote.transcripts.set(1, {
                    record: {
                        transcriptNo: 1,
                        ticketNo: 1,
                        channelId: f.ids.channel,
                        capturedAt: 1,
                        messageCount: 2,
                        truncated: true,
                        erased: false,
                        pages: 2,
                    },
                    messages: [],
                    body,
                })
                yield* bot.ready()
                yield* emit(bot, "!ticket transcript 1 show 1", p.dmId)
                const first = (p.send.requests().at(-1)!.body as Body).embeds![0]!
                assert.equal(first.title, "Transcript #1 of ticket #1")
                assert(first.description!.startsWith("Synthetic first page"))
                assert(!first.description!.includes("Synthetic second page"))
                assert.deepEqual(first.fields, [{ name: "Next", value: "`!ticket transcript 1 show 1 next`" }])
                assert.equal(
                    first.footer!.text,
                    "An earlier capture of channel text, without attachments or embeds. It was cut short, so older or longer messages are missing",
                )
                yield* emit(bot, "!ticket transcript 1 show 1 next", p.dmId)
                const second = (p.send.requests().at(-1)!.body as Body).embeds![0]!
                assert(second.description!.includes("Synthetic second page"))
                assert.equal(second.fields, undefined)
                yield* emit(bot, "!ticket transcript 1 show 1 next", p.dmId)
                assert.equal(
                    (p.send.requests().at(-1)!.body as { content: string }).content,
                    "There is no next page to show. Send !ticket transcript 1 show 1 to start the list again",
                )
                const queries = remote.calls
                    .filter(
                        (c) => c.method === "query" && (c.input as TicketQueryRequest).operation.type === "transcript",
                    )
                    .map((c) => (c.input as TicketQueryRequest).operation)
                assert.deepEqual(queries, [
                    { type: "transcript", ticketNo: ticket.ticketNo, transcriptNo: 1, page: 1 },
                    { type: "transcript", ticketNo: ticket.ticketNo, transcriptNo: 1, page: 2 },
                ])
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("private ticket, note and transcript lists continue with next from the remembered continuation number", async () => {
    const f = createFixtures(),
        remote = ticketBoundary(),
        query = remote.store.query
    // Every first page has another after it, and a continued page is the last
    remote.store.query = (input) =>
        query(input).pipe(
            Effect.map((result): TicketQueryResult => {
                const op = input.operation as {
                    beforeTicketNo?: number
                    beforeEntryNo?: number
                    beforeTranscriptNo?: number
                }
                if (result.type === "tickets" && !op.beforeTicketNo) return { ...result, nextBeforeTicketNo: 2 }
                if (result.type === "entries" && !op.beforeEntryNo) return { ...result, nextBeforeEntryNo: 3 }
                if (result.type === "transcripts" && !op.beforeTranscriptNo)
                    return { ...result, nextBeforeTranscriptNo: 4 }
                return result
            }),
        )
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    p = native(bot)
                const { grant } = yield* seed(remote, bot)
                yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                yield* bot.ready()
                const say = (content: string) =>
                    emit(bot, content, p.dmId).pipe(Effect.map(() => p.send.requests().at(-1)!.body as Body))
                const tickets = (yield* say("!ticket list")).embeds![0]!
                assert.equal(tickets.title, "Tickets")
                assert.match(
                    tickets.description!,
                    new RegExp(
                        `^\\*\\*#1\\*\\* Open, <@${f.ids.user}> in <#${f.ids.channel}>, opened <t:\\d+:R>\\nDetails: \`!ticket show <number>\`$`,
                    ),
                )
                assert.deepEqual(tickets.fields, [{ name: "Next", value: "`!ticket list next`" }])
                assert.equal((yield* say("!ticket list next")).embeds![0]!.fields, undefined)
                assert.equal(
                    (yield* say("!ticket list next")).content,
                    "There is no next page to show. Send !ticket list to start the list again",
                )
                assert.deepEqual((yield* say("!ticket note 1 list")).embeds, [
                    {
                        color: 0x5560e6,
                        title: "Staff notes on ticket #1",
                        description: "No staff notes yet",
                        fields: [{ name: "Next", value: "`!ticket note 1 list next`" }],
                    },
                ])
                assert.deepEqual((yield* say("!ticket note 1 list next")).embeds, [
                    { color: 0x5560e6, title: "Staff notes on ticket #1", description: "No staff notes yet" },
                ])
                assert.equal(
                    (yield* say("!ticket note 1 list next")).content,
                    "There is no next page to show. Send !ticket note 1 list to start the list again",
                )
                assert.deepEqual((yield* say("!ticket transcript 1 list")).embeds, [
                    {
                        color: 0x5560e6,
                        title: "Transcripts of ticket #1",
                        description: "No transcripts yet",
                        fields: [{ name: "Next", value: "`!ticket transcript 1 list next`" }],
                    },
                ])
                assert.deepEqual((yield* say("!ticket transcript 1 list next")).embeds, [
                    { color: 0x5560e6, title: "Transcripts of ticket #1", description: "No transcripts yet" },
                ])
                const lists = remote.calls
                    .filter((c) => c.method === "query")
                    .map((c) => (c.input as TicketQueryRequest).operation)
                    .filter((op) => op.type === "tickets" || op.type === "entries" || op.type === "transcripts")
                assert.deepEqual(lists, [
                    { type: "tickets" },
                    { type: "tickets", beforeTicketNo: 2 },
                    { type: "entries", ticketNo: 1, kind: "note" },
                    { type: "entries", ticketNo: 1, kind: "note", beforeEntryNo: 3 },
                    { type: "transcripts", ticketNo: 1 },
                    { type: "transcripts", ticketNo: 1, beforeTranscriptNo: 4 },
                ])
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("a ticket list page with no visible tickets but more to look through says so instead of that there are none", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    const base = remote.store.query
    remote.store.query = (input) =>
        input.operation.type === "tickets"
            ? Effect.succeed({ type: "tickets", tickets: [], nextBeforeTicketNo: 5 })
            : base(input)
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    p = native(bot)
                yield* bot.ready()
                yield* emit(bot, "!ticket list", p.dmId)
                const list = (p.send.requests().at(-1)!.body as Body).embeds![0]!
                assert.deepEqual(
                    [list.description, list.fields],
                    ["None of the newest tickets are yours to see", [{ name: "Next", value: "`!ticket list next`" }]],
                )
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("ticket actions answer with one line, notes list as short snippets and categories page at 10", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    p = native(bot)
                const { grant } = yield* seed(remote, bot)
                yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                yield* bot.ready()
                const say = (content: string, channelId?: string) =>
                    emit(bot, content, channelId).pipe(Effect.map(() => p.send.requests().at(-1)!.body as Body))
                assert.equal((yield* say("!ticket claim 1")).content, "Ticket #1 claimed by you")
                assert.equal((yield* say("!ticket priority 1 high")).content, "Ticket #1 now has high priority")
                assert.equal((yield* say("!ticket unclaim 1")).content, "Ticket #1 is no longer claimed")
                // Seven long notes: A page shows 5 numbered snippets and one hint, and show reads one in full
                for (let index = 1; index <= 7; index++)
                    yield* emit(bot, `!ticket note 1 add "Synthetic note ${index} ${"word ".repeat(380)}end"`, p.dmId)
                const notes = (yield* say("!ticket note 1 list", p.dmId)).embeds!
                assert.equal(notes.length, 1)
                const lines = notes[0]!.description!.split("\n")
                assert.equal(lines.length, 6)
                assert.equal(lines.at(-1), "Read one in full with `!ticket note 1 show <number>`")
                assert.match(
                    lines[0]!,
                    new RegExp(`^\\*\\*#7\\*\\* <@${f.ids.user}> <t:\\d+:R>: Synthetic note 7 word`),
                )
                for (const line of lines.slice(0, 5)) assert(line.replace(/^.*<t:\d+:R>: /, "").length <= 150)
                assert.deepEqual(notes[0]!.fields, [{ name: "Next", value: "`!ticket note 1 list next`" }])
                assert.equal(
                    (yield* say("!ticket note 1 list next", p.dmId)).embeds![0]!.description!.split("\n").length,
                    3,
                )
                const full = (yield* say("!ticket note 1 show 2", p.dmId)).embeds![0]!
                assert.equal(full.title, "Staff note #2 on ticket #1")
                assert(full.description!.endsWith(`Synthetic note 2 ${"word ".repeat(380)}end`))
                assert.equal(
                    (yield* say("!ticket note 1 show 9", p.dmId)).content,
                    "Ticket #1 has no staff note #9. Check `!ticket note 1 list`",
                )
                // Twelve categories with long descriptions: 10 short lines, then the other 2
                for (let index = 1; index <= 12; index++)
                    remote.categories.set(`c${index}`, {
                        name: `c${index}`,
                        revision: 1,
                        enabled: true,
                        visibility: "private",
                        parentId: null,
                        description: "x".repeat(500),
                        supportRoleIds: [],
                        questions: [],
                        cannedReplies: [],
                    })
                const categories = (yield* say("!ticket categories")).embeds![0]!
                assert.equal(categories.description!.split("\n").length, 11)
                assert(categories.description!.split("\n").every((line) => line.length <= 150))
                assert.deepEqual(categories.fields, [{ name: "Next", value: "`!ticket categories next`" }])
                assert.equal((yield* say("!ticket categories next")).embeds![0]!.description!.split("\n").length, 4)
                assert.equal(
                    (yield* say("!ticket categories next")).content,
                    "There is no next page to show. Send !ticket categories to start the list again",
                )
                // Each page is one backend read that starts after the last name of the page before
                const asked = remote.calls
                    .map((c) => c.input as TicketQueryRequest)
                    .filter((input) => input.operation?.type === "categories")
                    .map((input) => input.operation)
                assert.deepEqual(asked.slice(-2), [{ type: "categories" }, { type: "categories", after: "c7" }])
                // Without a name, the one category that is on opens, found among many that are off
                for (const category of remote.categories.values()) category.enabled = category.name === "c9"
                yield* emit(bot, "!ticket open", p.dmId)
                assert.deepEqual(
                    [...remote.intakes.values()].map((intake) => intake.category.name),
                    ["c9"],
                )
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("ticket hints in a server channel print the server's prefix, and those for a DM keep the fixed one", async () => {
    const f = createFixtures(),
        remote = ticketBoundary(),
        general = prefixStore("?")
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store, general }),
                    ),
                    p = native(bot)
                const { grant } = yield* seed(remote, bot)
                yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                yield* bot.ready()
                const say = (content: string) =>
                    emit(bot, content).pipe(Effect.map(() => p.send.requests().at(-1)!.body as Body))
                const help = (yield* say("?ticket help")).content!
                assert.match(help, /^\?ticket show \[number\]: /m)
                assert.match(help, /^\?ticket open \[category\]: /m)
                for (let index = 1; index <= 12; index++)
                    remote.categories.set(`c${index}`, { ...remote.categories.get("support")!, name: `c${index}` })
                const categories = (yield* say("?ticket categories")).embeds![0]!
                assert.deepEqual(categories.fields, [{ name: "Next", value: "`?ticket categories next`" }])
                assert.match(
                    categories.description!,
                    /Open a ticket with `\?ticket open <category>`\. NeonFlux asks its questions in a DM/,
                )
                remote.store.manage = (input) =>
                    Effect.fail(new TicketStoreError({ operation: input.operation.type, status: 409 }))
                assert.match((yield* say("?ticket claim 1")).content!, /Check it with `\?ticket show <number>` before/)
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("an intake answered by command says how far it is and how to send it, in one line", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    p = native(bot)
                yield* seed(remote, bot)
                remote.tickets.clear()
                remote.categories.get("support")!.questions = ["First synthetic question", "Second synthetic question"]
                yield* bot.ready()
                yield* emit(bot, "!ticket open support", p.dmId)
                const dm = () => (p.send.requests().at(-1)!.body as Body).content
                yield* emit(bot, '!ticket answer 1 2 "Synthetic second answer"', p.dmId)
                assert.equal(dm(), "Answer 2 saved for intake #1, 1 of 2 answered")
                yield* emit(bot, '!ticket answer 1 1 "Synthetic first answer"', p.dmId)
                assert.equal(
                    dm(),
                    "Answer 1 saved for intake #1, 2 of 2 answered. Send `!ticket submit 1 private` to open a private conversation",
                )
                yield* emit(bot, "!ticket submit 1 private", p.dmId)
                assert.match(dm()!, /^Ticket #\d+ opened in <#\d+>$/)
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("intake retains only the parent ID and refreshes its native category before submit and create dispatch", async () => {
    for (const replaceBeforeDispatch of [false, true]) {
        const f = createFixtures(),
            remote = ticketBoundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                            createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                        ),
                        p = native(bot)
                    yield* seed(remote, bot)
                    const parentId = f.nextId()
                    remote.categories.get("support")!.parentId = parentId
                    const parent = bot.rest.respond(`GET /channels/${parentId}`, {
                        body: f.channel({ id: parentId, type: 4 }),
                    })
                    if (replaceBeforeDispatch) {
                        const intake = remote.store.intake
                        remote.store.intake = (input) =>
                            intake(input).pipe(
                                Effect.tap(() =>
                                    Effect.sync(() => {
                                        if (input.operation.type === "submit") {
                                            parent.remove()
                                            bot.rest.respond(`GET /channels/${parentId}`, {
                                                body: f.channel({ id: parentId, type: 0 }),
                                            })
                                        }
                                    }),
                                ),
                            )
                    }
                    yield* bot.ready()
                    yield* emit(bot, "!ticket open support", p.dmId)
                    yield* emit(bot, '!ticket answer 1 1 "Synthetic answer"', p.dmId)
                    yield* emit(bot, "!ticket submit 1 private", p.dmId)
                    assert.equal(remote.intakes.get(1)!.category.parentId, parentId)
                    assert.equal(p.create.requests().length, replaceBeforeDispatch ? 0 : 1)
                    assert.equal(parent.requests().length, replaceBeforeDispatch ? 1 : 2)
                    if (!replaceBeforeDispatch)
                        assert.equal((p.create.requests()[0]!.body as { parent_id: string }).parent_id, parentId)
                    assert.deepEqual(bot.failures(), [])
                }),
            ),
        )
    }
})

// A ticket channel's history as Fluxer pages it: the 100 messages after the cursor, newest first
function historyRoute(bot: Bot, channelId: string, messages: readonly { id: string }[]) {
    return bot.rest.respond(`GET /channels/${channelId}/messages`, (request) => {
        const after = BigInt(request.query.after ?? "0"),
            limit = Number(request.query.limit ?? "50")
        return {
            body: messages
                .filter((message) => BigInt(message.id) > after)
                .slice(0, limit)
                .reverse(),
        }
    })
}

test("the ticket worker appends every message of the channel and its public threads in order, then only new ones", async () => {
    const remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                    p = native(bot),
                    f = bot.fixtures
                const { grant } = yield* seed(remote, bot)
                yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                let next = BigInt(f.nextId()) + 1000n
                const message = (channelId: string, content: string, patch = {}) =>
                    f.message({ id: (next++).toString(), channel_id: channelId, content, ...patch })
                // 1,234 messages, past the old 500, the first with an attachment, an embed and a sticker
                const channel = Array.from({ length: 1234 }, (_, i) =>
                    message(
                        f.ids.channel,
                        `Synthetic message ${i}`,
                        i === 0
                            ? {
                                  attachments: [
                                      {
                                          id: f.nextId(),
                                          filename: "synthetic.png",
                                          size: 48211,
                                          flags: 0,
                                          url: "https://example.invalid/synthetic.png",
                                          proxy_url: "https://example.invalid/proxy.png",
                                      },
                                  ],
                                  embeds: [
                                      {
                                          type: "rich",
                                          title: "Synthetic title",
                                          description: "Synthetic description",
                                          fields: [{ name: "Synthetic field", value: "value", inline: false }],
                                      },
                                  ],
                                  stickers: [{ id: f.nextId(), name: "Synthetic sticker", animated: false }],
                              }
                            : {},
                    ),
                )
                historyRoute(bot, f.ids.channel, channel)
                // 12 public threads, past the old 10: 3 active and 9 archived over two pages. Private threads and other channels' stay out
                const threads = Array.from({ length: 12 }, (_, i) =>
                    f.thread({
                        name: `Synthetic thread ${i}`,
                        thread_metadata: {
                            archived: i >= 3,
                            auto_archive_duration: 4320,
                            archive_timestamp: new Date(Date.UTC(2026, 0, 30 - i)).toISOString(),
                            locked: false,
                            create_timestamp: new Date(Date.UTC(2026, 0, 1)).toISOString(),
                        },
                    }),
                )
                bot.rest.respond(`GET /guilds/${f.ids.guild}/threads/active`, {
                    body: {
                        threads: [
                            ...threads.slice(0, 3),
                            f.thread({ type: 12, name: "Synthetic private thread" }),
                            f.thread({ parent_id: f.nextId() }),
                        ],
                        members: [],
                    },
                })
                const archived = bot.rest.respond(
                    `GET /channels/${f.ids.channel}/threads/archived/public`,
                    (request) =>
                        request.query.before
                            ? { body: { threads: threads.slice(8), members: [], has_more: false } }
                            : { body: { threads: threads.slice(3, 8), members: [], has_more: true } },
                )
                const threadMessages = new Map(
                    threads.map((thread) => [thread.id, [message(thread.id, `${thread.name} text`)]] as const),
                )
                for (const [id, rows] of threadMessages) historyRoute(bot, id, rows)
                remote.due.set(1, 1_700_000_000_000)
                yield* processTicketPass(remote.store, f.ids.guild, bot.client)
                assert.equal(archived.requests().length, 2)
                assert.equal(archived.requests()[1]!.query.before, threads[7]!.thread_metadata.archive_timestamp)
                const channelAppends = remote.appends.filter((a) => a.sourceId === f.ids.channel)
                assert.deepEqual(
                    channelAppends.flatMap((a) => a.messages.map((m) => m.messageId)),
                    channel.map((m) => m.id),
                )
                assert(channelAppends.every((a) => a.messages.length <= 100))
                assert.deepEqual(
                    channelAppends.map((a) => a.after),
                    [null, ...channelAppends.slice(0, -1).map((a) => a.messages.at(-1)!.messageId)],
                )
                const first: TicketTranscriptMessage = channelAppends[0]!.messages[0]!
                assert.deepEqual(first.attachments, [
                    { filename: "synthetic.png", size: 48211, url: "https://example.invalid/synthetic.png" },
                ])
                assert.deepEqual(first.embeds, ["Synthetic title. Synthetic description. Synthetic field: value"])
                assert.deepEqual(first.stickers, ["Synthetic sticker"])
                assert.deepEqual(
                    remote.appends.filter((a) => a.sourceId !== f.ids.channel).map((a) => a.sourceId),
                    [...threads].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).map((t) => t.id),
                )
                assert.deepEqual(remote.done, [{ ticketNo: 1, outcome: "saved" }])
                assert.equal(remote.due.size, 0)
                // A second save appends only the three messages sent since
                const appended = remote.appends.length
                channel.push(...Array.from({ length: 3 }, (_, i) => message(f.ids.channel, `Synthetic later ${i}`)))
                remote.due.set(1, 1_700_000_100_000)
                yield* processTicketPass(remote.store, f.ids.guild, bot.client)
                assert.deepEqual(
                    remote.appends.slice(appended).map((a) => a.messages.map((m) => m.content)),
                    [["Synthetic later 0", "Synthetic later 1", "Synthetic later 2"]],
                )
                // Saving reads only, so nothing was posted or changed in Fluxer
                assert.equal(p.send.requests().length, 1)
                assert.equal(p.overwrite.requests().length, 0)
            }),
        ),
    )
})

test("a transcript read that fails reports failed and nothing is posted, and a gone channel reports absent", async () => {
    const remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                    p = native(bot),
                    f = bot.fixtures
                const { grant } = yield* seed(remote, bot)
                yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                const sent = p.send.requests().length
                bot.rest.respond(`GET /channels/${f.ids.channel}/messages`, {
                    status: 403,
                    body: { code: "MISSING_PERMISSIONS", message: "Synthetic missing permission" },
                })
                remote.due.set(1, 1)
                yield* processTicketPass(remote.store, f.ids.guild, bot.client)
                assert.deepEqual(remote.done, [{ ticketNo: 1, outcome: "failed" }])
                assert.equal(remote.appends.length, 0)
                assert.equal(p.send.requests().length, sent)
                p.state.deleted = true
                remote.due.set(1, 2)
                yield* processTicketPass(remote.store, f.ids.guild, bot.client)
                assert.deepEqual(remote.done.at(-1), { ticketNo: 1, outcome: "absent" })
            }),
        ),
    )
})

test("transcript appends stay under the backend's request limit even when escaping doubles their size", async () => {
    const remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                    f = bot.fixtures
                native(bot)
                const { grant } = yield* seed(remote, bot)
                yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                let next = BigInt(f.nextId()) + 1000n
                const channel = Array.from({ length: 100 }, () =>
                    f.message({ id: (next++).toString(), content: "\\".repeat(4000) }),
                )
                historyRoute(bot, f.ids.channel, channel)
                bot.rest.respond(`GET /guilds/${f.ids.guild}/threads/active`, { body: { threads: [], members: [] } })
                bot.rest.respond(`GET /channels/${f.ids.channel}/threads/archived/public`, {
                    body: { threads: [], members: [], has_more: false },
                })
                remote.due.set(1, 1)
                yield* processTicketPass(remote.store, f.ids.guild, bot.client)
                const appends = remote.calls.filter((c) => c.method === "transcriptAppend").map((c) => c.input)
                assert(appends.length > 1)
                for (const input of appends) assert(Buffer.byteLength(JSON.stringify(input)) <= 262144)
                assert(
                    remote.appends.every(
                        (a) =>
                            Buffer.byteLength(JSON.stringify(a.messages)) <= transcriptChunkBytes + a.messages.length,
                    ),
                )
                assert.equal(remote.appends.flatMap((a) => a.messages).length, 100)
            }),
        ),
    )
})

test("a transcript file holds every page and splits at line ends past its size", async () => {
    const parts = transcriptFileParts(40),
        full = [...parts.add("Synthetic line one\nSynthetic line two\nSyn"), ...parts.add("thetic line three\n")]
    const decoded = [...full, parts.finish()].map((bytes) => new TextDecoder().decode(bytes))
    assert.deepEqual(decoded, ["Synthetic line one\nSynthetic line two\n", "Synthetic line three\n"])
    const remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const f = createFixtures()
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    p = native(bot)
                const { grant } = yield* seed(remote, bot)
                yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                // More than 100 pages, so the file reads the pages in several batches
                const body = Array.from({ length: 6000 }, (_, i) => `Synthetic transcript line ${i}`).join("\n")
                remote.transcripts.set(4, {
                    record: {
                        transcriptNo: 4,
                        ticketNo: 1,
                        channelId: f.ids.channel,
                        capturedAt: 1,
                        messageCount: 300,
                        truncated: false,
                        erased: false,
                        pages: Math.ceil(body.length / 1500),
                        automatic: true,
                    },
                    messages: [],
                    body,
                })
                yield* bot.ready()
                yield* emit(bot, "!ticket transcript 1 file", p.dmId)
                const sent = p.send.requests().at(-1)!
                assert.deepEqual(
                    sent.files.map((file) => [file.filename, file.contentType, file.size]),
                    [["ticket-1-transcript-4.txt", "text/plain", Buffer.byteLength(body)]],
                )
                assert.equal(sent.path, `/channels/${p.dmId}/messages`)
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("a transcript file in a server channel names NeonFlux's missing Attach files before it sends anything", async () => {
    const remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const f = createFixtures()
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    everything = Object.values(Permissions).reduce((all, bit) => all | bit, 0n),
                    p = native(bot, {
                        botPermissions: everything & ~Permissions.Administrator & ~Permissions.AttachFiles,
                    })
                const { grant } = yield* seed(remote, bot)
                yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                remote.transcripts.set(1, {
                    record: {
                        transcriptNo: 1,
                        ticketNo: 1,
                        channelId: f.ids.channel,
                        capturedAt: 1,
                        messageCount: 1,
                        truncated: false,
                        erased: false,
                        pages: 1,
                        automatic: true,
                    },
                    messages: [],
                    body: "Synthetic transcript body",
                })
                yield* bot.ready()
                const sends = p.send.requests().length
                yield* emit(bot, "!ticket transcript 1 file", undefined, { channel_id: f.ids.channel })
                const replies = p.send.requests().slice(sends)
                assert.equal(replies.length, 1)
                assert.equal(replies[0]!.files.length, 0)
                assert.match(JSON.stringify(replies[0]!.body), /Grant Attach files to the NeonFlux role/)
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})
test("capture asks for the transcript in the background, and deleting waits while it is being saved", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    p = native(bot)
                const { grant } = yield* seed(remote, bot)
                yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
                yield* bot.ready()
                yield* emit(bot, "!ticket transcript 1 capture")
                assert.equal(
                    (p.send.requests().at(-1)!.body as { content: string }).content,
                    "The transcript of ticket #1 is being brought up to date. `!ticket transcript 1 list` shows it once it is saved",
                )
                assert(remote.due.has(1))
                yield* emit(bot, "!ticket show 1")
                assert.deepEqual(
                    (p.send.requests().at(-1)!.body as Body).embeds![0]!.fields!.find((x) => x.name === "Transcript"),
                    { name: "Transcript", value: "Saving" },
                )
                // A save that kept failing names both causes the backend refuses on, permissions and a changed audience
                const saving = remote.tickets.get(1)!.transcript!
                remote.tickets.get(1)!.transcript = { ...saving, state: "failed" }
                yield* emit(bot, "!ticket show 1")
                assert.deepEqual(
                    (p.send.requests().at(-1)!.body as Body).embeds![0]!.fields!.find((x) => x.name === "Transcript"),
                    {
                        name: "Transcript",
                        value: "Not saved after 6 tries. Check NeonFlux's View channel and Read message history there, and that nobody outside the ticket's readers was given access to the channel, then run `!ticket transcript 1 capture`",
                    },
                )
                remote.tickets.get(1)!.transcript = saving
                remote.tickets.get(1)!.state = "closed"
                yield* emit(bot, "!ticket delete 1 confirm")
                assert.equal(
                    (p.send.requests().at(-1)!.body as { content: string }).content,
                    "The closing transcript of ticket #1 is still being saved. Try again once the ticket no longer shows its transcript as Saving",
                )
                assert.equal(p.remove.requests().length, 0)
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("a refused ticket panel post says nothing was posted, and an unknown result says to check the channel", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    p = native(bot)
                remote.categories.set("support", {
                    name: "support",
                    revision: 1,
                    enabled: true,
                    visibility: "private",
                    parentId: null,
                    description: "Synthetic support desk",
                    supportRoleIds: [],
                    questions: ["Synthetic panel question"],
                    cannedReplies: [],
                })
                let status = 403
                p.send.remove()
                const sends = bot.rest.respond("POST /channels/:id/messages", (request) =>
                    request.path.includes(p.dmId)
                        ? {
                              body: f.message({
                                  channel_id: p.dmId,
                                  author: f.botUser(),
                                  content: (request.body as Body).content ?? "",
                                  embeds: [],
                              }),
                          }
                        : { status, body: { code: "MISSING_PERMISSIONS", message: "Synthetic refusal" } },
                )
                yield* bot.ready()
                const last = () => (sends.requests().at(-1)!.body as Body).content
                yield* emit(bot, `!ticket panel support <#${f.ids.channel}>`, p.dmId)
                assert.equal(
                    last(),
                    `Fluxer refused the panel post in <#${f.ids.channel}>, so nothing was posted. Check NeonFlux's permissions there, then post it again`,
                )
                status = 500
                yield* emit(bot, `!ticket panel support <#${f.ids.channel}>`, p.dmId)
                assert.equal(
                    last(),
                    `The panel post was not confirmed, and NeonFlux never repeats it. Check <#${f.ids.channel}> and post again if it is missing`,
                )
                assert.equal(remote.panels.size, 0)
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("a ticket panel reaction opens an intake in the member's DM and removes the reaction, and other messages cost nothing", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    p = native(bot)
                remote.categories.set("support", {
                    name: "support",
                    revision: 1,
                    enabled: true,
                    visibility: "private",
                    parentId: null,
                    description: "Synthetic support desk",
                    supportRoleIds: [],
                    questions: ["Synthetic panel question"],
                    cannedReplies: [],
                })
                const reactions = (method: string) =>
                    bot.rest.respond(
                        (request) => request.method === method && request.path.includes("/reactions/"),
                        () => ({ status: 204 }),
                    )
                const react = reactions("PUT"),
                    unreact = reactions("DELETE")
                yield* bot.ready()
                yield* emit(bot, `!ticket panel support <#${f.ids.channel}>`)
                const panel = [...remote.panels.values()][0]!
                assert.equal(panel.channelId, f.ids.channel)
                const post = p.send.requests().find((r) => r.path === `/channels/${f.ids.channel}/messages`)!
                assert(
                    (post.body as { content: string }).content.startsWith(
                        "**Support tickets**\nSynthetic support desk\nReact with 🎫 to open a ticket",
                    ),
                )
                assert.equal(react.requests().length, 1)
                const reaction = (messageId: string, userId = f.ids.user) =>
                    bot
                        .emit("MESSAGE_REACTION_ADD", {
                            user_id: userId,
                            channel_id: f.ids.channel,
                            message_id: messageId,
                            guild_id: f.ids.guild,
                            emoji: { name: "🎫" },
                        })
                        .pipe(Effect.andThen(bot.idle()))
                yield* reaction(panel.messageId)
                assert.equal(remote.intakes.size, 1)
                const dms = p.send.requests().filter((r) => r.path === `/channels/${p.dmId}/messages`)
                assert(JSON.stringify(dms[0]!.body).includes("Opening a support ticket on"))
                assert(JSON.stringify(dms[1]!.body).includes("Question 1 of 1: Synthetic panel question"))
                assert.equal(unreact.requests().length, 1)
                // Another message's reactions need no backend call once the panels are known
                const calls = remote.calls.length
                yield* reaction(f.nextId())
                assert.equal(remote.calls.length, calls)
                // NeonFlux's own 🎫 on its panel is no request, so it reads no member and leaves the reaction
                const memberReads = p.ownMember.requests().length + p.guildRoute.requests().length
                yield* reaction(panel.messageId, f.ids.bot)
                assert.equal(p.ownMember.requests().length + p.guildRoute.requests().length, memberReads)
                assert.equal(remote.calls.length, calls)
                assert.equal(unreact.requests().length, 1)
                // Without a DM nothing is posted anywhere, and the reaction still goes so that the next one works
                p.open.remove()
                bot.rest.respond("POST /users/@me/channels", {
                    status: 403,
                    body: { code: "CANNOT_SEND_MESSAGES_TO_USER", message: "Synthetic closed DMs" },
                })
                const sends = p.send.requests().length
                yield* reaction(panel.messageId)
                assert.equal(p.send.requests().length, sends)
                assert.equal(remote.intakes.size, 1)
                assert.equal(unreact.requests().length, 2)
                // A new panel replaces the old one and deletes its message once
                const removed = bot.rest.respond("DELETE /channels/:channel/messages/:message", { status: 204 })
                yield* emit(bot, `!ticket panel support <#${f.ids.channel}>`)
                assert.equal(removed.requests().length, 1)
                assert(removed.requests()[0]!.path.endsWith(`/messages/${panel.messageId}`))
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("the panel index reads every page of panels, so a panel past the first page opens an intake", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                        createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                    ),
                    p = native(bot)
                remote.categories.set("support", {
                    name: "support",
                    revision: 1,
                    enabled: true,
                    visibility: "private",
                    parentId: null,
                    description: "",
                    supportRoleIds: [],
                    questions: ["Synthetic panel question"],
                    cannedReplies: [],
                })
                // The fake answers two panels a page, so the support panel comes on the third page
                for (const categoryName of ["alpha", "beta", "delta", "gamma", "support"])
                    remote.panels.set(categoryName, {
                        categoryName,
                        channelId: f.ids.channel,
                        messageId: f.nextId(),
                        createdAt: 1,
                    })
                bot.rest.respond(
                    (request) => request.method === "DELETE" && request.path.includes("/reactions/"),
                    () => ({ status: 204 }),
                )
                yield* bot.ready()
                yield* bot
                    .emit("MESSAGE_REACTION_ADD", {
                        user_id: f.ids.user,
                        channel_id: f.ids.channel,
                        message_id: remote.panels.get("support")!.messageId,
                        guild_id: f.ids.guild,
                        emoji: { name: "🎫" },
                    })
                    .pipe(Effect.andThen(bot.idle()))
                assert.deepEqual(
                    [...remote.intakes.values()].map((intake) => intake.category.name),
                    ["support"],
                )
                yield* emit(bot, "!ticket panels")
                const listed = (p.send.requests().at(-1)!.body as Body).embeds![0]!.description!
                for (const name of ["alpha", "beta", "delta", "gamma", "support"])
                    assert(listed.includes(`**${name}**`))
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("a category deleted on the dashboard takes its panel message and panel with it", async (t) => {
    const f = createFixtures(),
        remote = ticketBoundary()
    let jobs: DashboardConfigurationReadyJob[] = [],
        panel: TicketPanel | undefined
    mockBackend(t, (call) => {
        if (call.path === "/dashboard-configuration/ready") return { jobs }
        if (call.path === "/dashboard-configuration/claim") return claimed(jobs[0]!, undefined, "queued")
        assert.equal(call.path, "/dashboard-configuration/execute")
        const { native: _native, ...stored } = jobs[0]!
        return { job: { ...stored, state: "applied" }, ticketPanel: panel }
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                )
                native(bot)
                remote.categories.set("support", {
                    name: "support",
                    revision: 1,
                    enabled: true,
                    visibility: "private",
                    parentId: null,
                    description: "Synthetic support desk",
                    supportRoleIds: [],
                    questions: [],
                    cannedReplies: [],
                })
                bot.rest.respond(
                    (request) => request.path.includes("/reactions/"),
                    () => ({ status: 204 }),
                )
                const removed = bot.rest.respond("DELETE /channels/:channel/messages/:message", { status: 204 })
                bot.rest.respond("GET /users/@me", { body: f.botUser({ system: false }) })
                bot.rest.respond(`GET /users/${f.ids.user}`, { body: f.user({ bot: false, system: false }) })
                yield* bot.ready()
                yield* emit(bot, `!ticket panel support <#${f.ids.channel}>`)
                panel = [...remote.panels.values()][0]!
                const reaction = () =>
                    bot
                        .emit("MESSAGE_REACTION_ADD", {
                            user_id: f.ids.user,
                            channel_id: f.ids.channel,
                            message_id: panel!.messageId,
                            guild_id: f.ids.guild,
                            emoji: { name: "🎫" },
                        })
                        .pipe(Effect.andThen(bot.idle()))
                // The first reaction loads the panels, so the index holds this one
                yield* reaction()
                const intakes = remote.intakes.size
                jobs = [
                    {
                        native: {},
                        id: "synthetic_ticket_job",
                        actorId: f.ids.user,
                        expectedConfigRevision: 0,
                        state: "queued",
                        createdAt: 0,
                        expiresAt: 120000,
                        family: "tickets",
                        operation: { type: "category-delete", name: "support", expectedRevision: 1 },
                    },
                ]
                yield* processDashboardConfigurationPass(
                    {
                        token,
                        serverId: f.ids.guild,
                        backend: {
                            url: "https://synthetic.invalid",
                            secret: Redacted.make("synthetic-backend-secret"),
                        },
                    },
                    bot.client as unknown as Parameters<typeof processDashboardConfigurationPass>[1],
                )
                assert.deepEqual(
                    removed.requests().map((request) => request.path),
                    [`/channels/${panel.channelId}/messages/${panel.messageId}`],
                )
                // The old panel message no longer opens an intake
                yield* reaction()
                assert.equal(remote.intakes.size, intakes)
                assert.deepEqual(bot.failures(), [])
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})
test("plain DM replies answer the one open intake, step back and send it without command syntax", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                )
                const p = native(bot)
                yield* bot.ready()
                const dm = () =>
                    p.send
                        .requests()
                        .filter((r) => r.path.includes(p.dmId))
                        .map((r) => (r.body as { content: string }).content)
                // Without an open intake a plain DM stays unanswered
                yield* emit(bot, "Synthetic plain message", p.dmId)
                assert.deepEqual(dm(), [])
                yield* emit(bot, "!ticket category create support private none none", p.dmId)
                yield* emit(bot, '!ticket question support add "First synthetic question"', p.dmId)
                yield* emit(bot, '!ticket question support add "Second synthetic question"', p.dmId)
                // Seven support roles show as the first five mentions and how many more
                const roleIds = Array.from({ length: 7 }, (_, index) => String(9000000000000000 + index))
                remote.categories.set("support", { ...remote.categories.get("support")!, supportRoleIds: roleIds })
                yield* emit(bot, "!ticket open support", p.dmId)
                assert.match(
                    dm().at(-1)!,
                    /^Intake #1 opened in category support\nPrivate conversation.*\nQuestion 1 of 2: First synthetic question\nReply with your answer or cancel/,
                )
                assert.ok(
                    dm()
                        .at(-1)!
                        .includes(
                            `Support roles: ${roleIds
                                .slice(0, 5)
                                .map((id) => `<@&${id}>`)
                                .join(", ")} and 2 more.`,
                        ),
                )
                // The rest of the intake runs without them, since the fixture server has no such roles
                remote.categories.set("support", { ...remote.categories.get("support")!, supportRoleIds: [] })
                remote.intakes.set(1, {
                    ...remote.intakes.get(1)!,
                    category: { ...remote.intakes.get(1)!.category, supportRoleIds: [] },
                })
                yield* emit(bot, "back", p.dmId)
                assert.match(dm().at(-1)!, /^There is no earlier answer to change\nQuestion 1 of 2/)
                yield* emit(bot, "  First synthetic answer ", p.dmId)
                assert.deepEqual(remote.intakes.get(1)!.answers, ["First synthetic answer"])
                assert.match(
                    dm().at(-1)!,
                    /^Question 2 of 2: Second synthetic question\nReply with your answer, back to change the previous answer or cancel/,
                )
                yield* emit(bot, "send", p.dmId)
                assert.match(dm().at(-1)!, /^Answer every question before sending\nQuestion 2 of 2/)
                yield* emit(bot, "BACK", p.dmId)
                assert.deepEqual(remote.intakes.get(1)!.answers, [""])
                assert.match(dm().at(-1)!, /^Previous answer: First synthetic answer\nQuestion 1 of 2/)
                yield* emit(bot, "Corrected synthetic answer", p.dmId)
                yield* emit(bot, "Second synthetic answer", p.dmId)
                // Once every question is answered the step is one line, and the answers show only on request
                assert.equal(
                    dm().at(-1),
                    "2 of 2 answered. Sending opens a private conversation. Reply send to create the ticket, back to change the last answer or cancel to stop. `!ticket review 1` shows your answers",
                )
                yield* emit(bot, "Extra synthetic text", p.dmId)
                assert.match(dm().at(-1)!, /^Every question is answered\n2 of 2 answered/)
                yield* emit(bot, "!ticket review 1", p.dmId)
                const review = (p.send.requests().at(-1)!.body as Body).embeds![0]!
                assert.equal(review.title, "Ticket intake #1")
                assert.equal(
                    review.description,
                    "Draft in category support. Sending opens a private conversation\nSend it with `!ticket submit 1 private`",
                )
                assert.deepEqual(review.fields, [
                    { name: "1. First synthetic question", value: "Corrected synthetic answer" },
                    { name: "2. Second synthetic question", value: "Second synthetic answer" },
                ])
                yield* emit(bot, "Send", p.dmId)
                const operations = remote.calls
                    .filter((c) => c.method === "intake")
                    .map((c) => (c.input as TicketIntakeRequest).operation)
                assert.deepEqual(
                    operations.map((o) => o.type),
                    ["open", "answer", "clear", "answer", "answer", "submit"],
                )
                assert.deepEqual(operations.at(-1), {
                    type: "submit",
                    intakeNo: 1,
                    expectedGeneration: 5,
                    visibility: "private",
                    expectedCategoryRevision: 3,
                })
                assert.equal(remote.tickets.get(1)?.state, "open")
                assert.deepEqual(remote.intakes.get(1)!.answers, [
                    "Corrected synthetic answer",
                    "Second synthetic answer",
                ])
                const ticketBodies = p.send
                    .requests()
                    .filter((r) => !r.path.includes(p.dmId))
                    .map((r) => JSON.stringify(r.body))
                    .join("\n")
                assert(!ticketBodies.includes("synthetic answer"))
                const replies = dm().length
                yield* emit(bot, "Synthetic message after sending", p.dmId)
                assert.equal(dm().length, replies)
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("plain DM replies reject attachments and long answers, cancel, and ask which intake when several are open", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                )
                const p = native(bot)
                yield* bot.ready()
                const dm = () =>
                    p.send
                        .requests()
                        .filter((r) => r.path.includes(p.dmId))
                        .map((r) => (r.body as { content: string }).content)
                yield* emit(bot, "!ticket category create support public none none", p.dmId)
                yield* emit(bot, '!ticket question support add "Synthetic question"', p.dmId)
                yield* emit(bot, "!ticket open support", p.dmId)
                const attachment = {
                    id: f.nextId(),
                    filename: "synthetic.txt",
                    size: 5,
                    flags: 0,
                    url: "https://example.invalid/private",
                    proxy_url: "https://example.invalid/private-proxy",
                }
                yield* emit(bot, "Synthetic answer with a file", p.dmId, { attachments: [attachment] })
                assert.equal(
                    dm().at(-1),
                    "Send each answer as text. Attachments and stickers cannot be kept in an intake answer",
                )
                yield* emit(bot, "x".repeat(2001), p.dmId)
                assert.equal(
                    dm().at(-1),
                    "An answer allows at most 2000 characters, and this one has 2001. Send a shorter answer",
                )
                assert.deepEqual(remote.intakes.get(1)!.answers, [])
                yield* emit(bot, "!ticket open support", p.dmId)
                yield* emit(bot, "Synthetic ambiguous answer", p.dmId)
                // One hint covers every open intake instead of a command for each
                assert.equal(
                    dm().at(-1),
                    "You have 2 open ticket intakes: #1, #2. A plain reply cannot tell which one it answers, so answer with " +
                        '`!ticket answer <intake> <question> "answer"`, or cancel the ones you do not need with `!ticket cancel <intake>`',
                )
                assert(
                    remote.calls
                        .filter((c) => c.method === "intake")
                        .every((c) => (c.input as TicketIntakeRequest).operation.type === "open"),
                )
                yield* emit(bot, "!ticket cancel 2", p.dmId)
                yield* emit(bot, "cancel", p.dmId)
                assert.equal(dm().at(-1), "Intake #1 cancelled")
                assert.deepEqual(
                    [...remote.intakes.values()].map((i) => i.state),
                    ["cancelled", "cancelled"],
                )
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})

test("in multi mode a plain DM reaches the server of its one open intake and asks which server when there are several", async () => {
    const first = "1300000000000000001",
        second = "1300000000000000002"
    let open: TicketOpenIntake[] = []
    const client = fakeClient((call) => {
        if (call.path === "/service/scope") return { mode: "multi" }
        if (call.path === "/service/installations/list") return { serverIds: [first, second], nextCursor: null }
        if (call.path === "/service/ticket-intakes") return open
        // Every other read fails, so the routed intake reply answers with the generic failure for its server
        return Response.json({ error: "Backend unavailable" }, { status: 503 })
    }, quietSignal)
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({
                        token,
                        scope: parseServerScope({ NEONFLUX_SERVER_MODE: "multi" }),
                        backend: {
                            url: "https://synthetic.invalid",
                            secret: Redacted.make("synthetic-secret"),
                            client,
                        },
                    }),
                )
                const f = bot.fixtures,
                    dmId = f.nextId()
                bot.rest.respond("GET /users/@me/guilds", (request) => ({
                    body: request.query.after ? [] : [f.guild({ id: first }), f.guild({ id: second })],
                }))
                bot.rest.respond(`GET /channels/${dmId}`, {
                    body: { id: dmId, type: 1, recipients: [f.user()], last_message_id: null },
                })
                const send = bot.rest.respond("POST /channels/:id/messages", (request) => ({
                    body: f.message({
                        channel_id: dmId,
                        author: f.botUser(),
                        content: (request.body as { content: string }).content,
                    }),
                }))
                yield* bot.ready()
                const replies = () => send.requests().map((r) => (r.body as { content: string }).content)
                yield* emit(bot, "Synthetic plain message", dmId)
                assert.deepEqual(replies(), [])
                open = [
                    { serverId: first, intakeNo: 4 },
                    { serverId: second, intakeNo: 7 },
                ]
                yield* emit(bot, "Synthetic ambiguous answer", dmId)
                assert.equal(
                    replies().at(-1),
                    `You have 2 open ticket intakes: #4 on Server ${first} (\`--server ${first}\`), #7 on Server ${second} (\`--server ${second}\`). ` +
                        'A plain reply cannot tell which one it answers, so answer with `!ticket --server <server> answer <intake> <question> "answer"`, or cancel the ones you do not need with `!ticket --server <server> cancel <intake>`',
                )
                // A draft on a server this bot does not serve is left out
                open = [
                    { serverId: "1300000000000000003", intakeNo: 1 },
                    { serverId: second, intakeNo: 7 },
                ]
                yield* emit(bot, "Synthetic answer", dmId)
                assert.match(replies().at(-1)!, new RegExp(`^\\*\\*Server ${second}\\*\\*: `))
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test("in multi mode the help a DM syntax hint points to carries the server selector", async () => {
    const server = "1300000000000000001"
    const client = fakeClient((call) => {
        if (call.path === "/service/scope") return { mode: "multi" }
        if (call.path === "/service/installations/list") return { serverIds: [server], nextCursor: null }
        if (call.path === "/moderation/gate")
            return {
                allowed: true,
                defcon: 3,
                messageProtectionEnabled: false,
                joinProtectionEnabled: false,
                botMessageProtectionEnabled: false,
            }
        return Response.json({ error: "Backend unavailable" }, { status: 503 })
    }, quietSignal)
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({
                        token,
                        scope: parseServerScope({ NEONFLUX_SERVER_MODE: "multi" }),
                        backend: {
                            url: "https://synthetic.invalid",
                            secret: Redacted.make("synthetic-secret"),
                            client,
                        },
                    }),
                )
                const f = bot.fixtures,
                    dmId = f.nextId()
                bot.rest.respond("GET /users/@me/guilds", (request) => ({
                    body: request.query.after ? [] : [f.guild({ id: server })],
                }))
                bot.rest.respond(`GET /channels/${dmId}`, {
                    body: { id: dmId, type: 1, recipients: [f.user()], last_message_id: null },
                })
                const send = bot.rest.respond("POST /channels/:id/messages", (request) => ({
                    body: f.message({
                        channel_id: dmId,
                        author: f.botUser(),
                        content: (request.body as { content: string }).content,
                    }),
                }))
                yield* bot.ready()
                yield* emit(bot, `!ticket --server ${server} nonsense`, dmId)
                assert.match(
                    (send.requests().at(-1)!.body as { content: string }).content,
                    new RegExp(`Use !ticket --server ${server} help for examples$`),
                )
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test("staff run an escalated ticket's creation, which rechecks the requester's membership instead of theirs", async () => {
    for (const member of [true, false]) {
        const remote = ticketBoundary()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot({ token: "synthetic-ticket-token" }),
                        p = native(bot),
                        f = bot.fixtures
                    const { grant } = yield* seed(remote, bot),
                        requesterId = f.nextId(),
                        joinedAt = "2024-05-01T00:00:00.000000+00:00"
                    bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${requesterId}`, {
                        body: f.member({
                            user: f.user({ id: requesterId }),
                            joined_at: joinedAt,
                            communication_disabled_until: null,
                        }),
                    })
                    // The requester rejoined since the escalation in the second run, so the ticket is not created
                    const overwrites = grant
                        .overwrites!.map((o) => (o.id === f.ids.user ? { ...o, id: requesterId } : o))
                        .sort((a, b) =>
                            a.type < b.type ? -1 : a.type > b.type ? 1 : BigInt(a.id) < BigInt(b.id) ? -1 : 1,
                        )
                    const escalated = {
                        ...grant,
                        overwrites,
                        requesterId,
                        requesterJoinedAt: member
                            ? (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: requesterId })).joinedAt
                            : "2020-01-01T00:00:00.000Z",
                        escalatedFrom: "700",
                    }
                    const result = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, escalated)
                    assert.equal(result.outcome, member ? "succeeded" : "failed")
                    assert.equal(p.create.requests().length, member ? 1 : 0)
                }),
            ),
        )
    }
})

test("a category asks up to 25 questions, refuses a 26th with the reason, and the review shows 25 long answers in full", async () => {
    const f = createFixtures(),
        remote = ticketBoundary()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }),
                )
                const p = native(bot)
                yield* bot.ready()
                const last = () => (p.send.requests().at(-1)!.body as Body).content
                yield* emit(bot, "!ticket category create support private none none", p.dmId)
                for (let index = 1; index <= 25; index++)
                    yield* emit(bot, `!ticket question support add "Synthetic question ${index}"`, p.dmId)
                assert.equal(remote.categories.get("support")!.questions.length, 25)
                yield* emit(bot, '!ticket question support add "Synthetic question 26"', p.dmId)
                assert.equal(last(), "support already asks 25 questions, the most a category asks. Remove one first")
                assert.equal(remote.categories.get("support")!.questions.length, 25)
                yield* emit(bot, "!ticket open support", p.dmId)
                const answers = Array.from({ length: 25 }, (_, index) => `${index + 1} `.padEnd(2000, "a"))
                remote.intakes.set(1, { ...remote.intakes.get(1)!, answers })
                const before = p.send.requests().length
                yield* emit(bot, "!ticket review 1", p.dmId)
                // Fluxer takes 25 fields and 6000 characters an embed, so the answers continue in further messages
                const fields = p.send
                    .requests()
                    .slice(before)
                    .flatMap((request) => (request.body as Body).embeds ?? [])
                    .flatMap((embed) => embed.fields ?? [])
                for (let index = 1; index <= 25; index++)
                    assert.equal(
                        fields
                            .filter((field) => field.name.startsWith(`${index}. Synthetic question ${index}`))
                            .map((field) => field.value)
                            .join(""),
                        answers[index - 1],
                    )
                assert.deepEqual(bot.failures(), [])
            }),
        ),
    )
})
