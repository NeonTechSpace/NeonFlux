import assert from "node:assert/strict"
import test from "node:test"
import type { HelpDeskAnswer, HelpDeskManageRequest, HelpDeskManageResult, HelpDeskSettings, HelpDeskWorkResult } from "@neonflux/contracts/helpdesk"
import type { TicketRecord } from "@neonflux/contracts/tickets"
import { Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { parseAnswerCommand, parseHelpDeskCommand } from "../src/helpdesk-command.ts"
import { HelpDeskStoreError, type HelpDeskStore } from "../src/helpdesk-store.ts"
import { helpDeskArchiveEditsPerPass, processHelpDeskPass } from "../src/helpdesk-worker.ts"
import { ticketBoundary } from "./ticket-fixture.ts"

const token = Redacted.make("synthetic-helpdesk-test-token")
const forumId = "5001", otherForumId = "5002", staffChannelId = "5003", authorId = "6001", staffId = "6002", memberId = "6003", serverOwnerId = "6009", solvedTagId = "7001"
const settings = (fields: Partial<HelpDeskSettings> = {}): HelpDeskSettings => ({ forumIds: [forumId], greeting: "Welcome to the help desk", solvedTag: "Solved", nudgeHours: 24, guardChannelId: null, autoArchive: false, revision: 1, ...fields })

function memoryStore(initial: HelpDeskSettings, work: HelpDeskWorkResult = { nudges: [], more: false, guard: null }) {
    let current = initial
    const calls: { method: string, input: unknown }[] = [], answers = new Map<string, HelpDeskAnswer>([["logs", { name: "logs", title: "Send your logs", content: "Open settings and copy the log", updatedAt: 0 }]])
    const store: HelpDeskStore = {
        get: input => Effect.sync(() => { calls.push({ method: "get", input }); return { settings: current } }),
        answers: input => Effect.sync(() => { calls.push({ method: "answers", input }); return { answers: input.name ? [answers.get(input.name)].filter(answer => answer !== undefined) : [...answers.values()] } }),
        manage: input => Effect.suspend((): Effect.Effect<HelpDeskManageResult, HelpDeskStoreError> => {
            calls.push({ method: "manage", input })
            const op = input.operation
            if (op.type === "answer-set") { answers.set(op.name, { name: op.name, title: op.title, content: op.content, updatedAt: 0 }); return Effect.succeed({ type: "answer", answer: answers.get(op.name)! }) }
            if (op.type === "answer-remove") return answers.delete(op.name) ? Effect.succeed({ type: "answer-removed", name: op.name }) : Effect.fail(new HelpDeskStoreError({ operation: "manage", status: 404 }))
            if (op.type === "forum-add") current = { ...current, forumIds: [...current.forumIds, op.channelId] }
            else if (op.type === "forum-remove") current = { ...current, forumIds: current.forumIds.filter(id => id !== op.channelId) }
            else { const { type: _type, ...patch } = op; current = { ...current, ...patch } }
            current = { ...current, revision: current.revision + 1 }
            return Effect.succeed({ type: "settings", settings: current })
        }),
        opened: input => Effect.sync(() => { calls.push({ method: "opened", input }); return { recorded: true } }),
        work: input => Effect.sync(() => { calls.push({ method: "work", input }); return work }),
        guard: input => Effect.sync(() => { calls.push({ method: "guard", input }); return { warn: input.activeThreads >= 900 } }),
    }
    return { store, calls, answers, settings: () => current }
}

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
type Body = { content?: string, embeds?: { title?: string, description?: string, fields?: { name: string, value: string }[], footer?: { text: string } }[] }
const segment = (path: string, index: number) => path.split("/")[index]!
const metadata = (fields: Partial<{ archived: boolean, locked: boolean, auto_archive_duration: number }> = {}) =>
    ({ archived: false, auto_archive_duration: 4320, archive_timestamp: "2026-01-01T00:00:00.000Z", locked: false, create_timestamp: "2026-01-01T00:00:00.000Z", ...fields })
/** A server with a forum carrying a Solved tag, posts by the author and staff with Manage Threads */
function platform(bot: Bot, options: { botPermissions?: bigint, tags?: string[], applied?: string[], history?: string[] } = {}) {
    const f = bot.fixtures
    const everyone = Permissions.ViewChannel | Permissions.SendMessages | Permissions.SendMessagesInThreads | Permissions.ReadMessageHistory
    const botRole = f.role({ position: 20, permissions: (options.botPermissions ?? Permissions.Administrator).toString() }), staffRole = f.role({ position: 10, permissions: Permissions.ManageThreads.toString() })
    bot.rest.respond("GET /guilds/:id", { body: f.guild({ owner_id: serverOwnerId }) })
    bot.rest.respond("GET /guilds/:id/roles", { body: [f.role({ id: f.ids.guild, permissions: everyone.toString() }), botRole, staffRole] })
    bot.rest.respond("GET /guilds/:id/members/:id", request => {
        const userId = segment(request.path, 4)
        return { body: f.member({ user: userId === f.ids.bot ? f.botUser() : f.user({ id: userId }), roles: userId === f.ids.bot ? [botRole.id] : userId === staffId ? [staffRole.id] : [], communication_disabled_until: null }) }
    })
    const tags = (options.tags ?? ["Bug", "Solved"]).map((name, index) => ({ id: name === "Solved" ? solvedTagId : String(7100 + index), name, moderated: false, emoji_id: null, emoji_name: null }))
    const threads = new Map<string, ReturnType<typeof f.thread>>()
    const thread = (id: string, fields: Partial<ReturnType<typeof f.thread>> = {}) => {
        const value = f.thread({ id, guild_id: f.ids.guild, parent_id: forumId, owner_id: authorId, applied_tags: options.applied ?? [], thread_metadata: metadata(), ...fields })
        threads.set(id, value)
        return value
    }
    bot.rest.respond("GET /channels/:id", request => {
        const id = segment(request.path, 2)
        if (id === forumId || id === otherForumId) return { body: f.forumChannel({ id, guild_id: f.ids.guild, available_tags: tags, default_auto_archive_duration: 1440 }) }
        const known = threads.get(id)
        return known ? { body: known } : id.startsWith("8") ? { status: 404, body: { message: "Synthetic absent thread" } } : { body: f.channel({ id, guild_id: f.ids.guild, type: 0 }) }
    })
    bot.rest.respond("GET /guilds/:id/channels", { body: [f.forumChannel({ id: forumId, guild_id: f.ids.guild, available_tags: tags, default_auto_archive_duration: 1440 }), f.channel({ id: staffChannelId, guild_id: f.ids.guild, type: 0 })] })
    bot.rest.respond("GET /guilds/:id/threads/active", () => ({ body: { threads: [...threads.values()], members: [] } }))
    const edits = bot.rest.respond("PATCH /channels/:id", request => ({ body: { ...threads.get(segment(request.path, 2))!, ...(request.body as object) } }))
    bot.rest.respond("GET /channels/:id/messages", request => ({ body: (options.history ?? [authorId]).map(userId => f.message({ channel_id: segment(request.path, 2), author: f.user({ id: userId }) })) }))
    let next = 9000
    const messages = bot.rest.respond("POST /channels/:id/messages", request => ({ body: f.message({ id: String(++next), channel_id: segment(request.path, 2), author: f.botUser(), content: (request.body as { content?: string }).content ?? "" }) }))
    const sent = (channelId?: string) => messages.requests().filter(request => !channelId || segment(request.path, 2) === channelId).map(request => request.body as Body & { content: string, allowed_mentions?: { users?: string[] } })
    return { thread, edits, sent, threads }
}
const say = (bot: Bot, userId: string, content: string, channelId: string) =>
    bot.emit("MESSAGE_CREATE", bot.fixtures.message({ channel_id: channelId, content, author: bot.fixtures.user({ id: userId }) })).pipe(Effect.andThen(bot.idle()))
function run(initial: HelpDeskSettings, body: (bot: Bot, memory: ReturnType<typeof memoryStore>) => Effect.Effect<void, unknown>, work?: HelpDeskWorkResult) {
    const f = createFixtures(), memory = memoryStore(initial, work)
    return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { helpDesk: memory.store }))
        yield* bot.ready()
        yield* bot.idle()
        yield* body(bot, memory)
    })).pipe(Effect.provide(TestClock.layer())))
}

test("help desk grammar bounds names, tags and waits", () => {
    assert.deepEqual(parseHelpDeskCommand([]), { type: "status" })
    assert.deepEqual(parseHelpDeskCommand(["forum", "add", "<#5001>"]), { type: "forum", add: true, channelId: "5001" })
    assert.deepEqual(parseHelpDeskCommand(["tag", " Answered "]), { type: "tag", name: "Answered" })
    assert.ok("error" in parseHelpDeskCommand(["tag", "x".repeat(51)]))
    assert.deepEqual(parseHelpDeskCommand(["nudge", "off"]), { type: "nudge", hours: null })
    assert.ok("error" in parseHelpDeskCommand(["nudge", "169"]))
    assert.deepEqual(parseHelpDeskCommand(["guard", "off"]), { type: "guard", channelId: null })
    assert.deepEqual(parseAnswerCommand(["logs"]), { type: "post", name: "logs" })
    assert.deepEqual(parseAnswerCommand(["set", "logs", "Title", "Text"]), { type: "set", name: "logs", title: "Title", content: "Text" })
    assert.deepEqual([parseAnswerCommand(["list"]), parseAnswerCommand(["list", "next"])], [{ type: "list", next: false }, { type: "list", next: true }])
    for (const args of [["set", "list", "Title", "Text"], ["set", "logs", "Title", "x".repeat(2001)], ["no space"], ["list", "2"]]) assert.ok("error" in parseAnswerCommand(args))
})

test("a new post in a help desk forum gets the greeting and one reminder record, with no backend read", async () => {
    await run(settings(), (bot, memory) => Effect.gen(function* () {
        const native = platform(bot)
        assert.deepEqual(memory.calls.map(call => call.method), ["get"])
        const post = native.thread("8101")
        // A post in another forum, and a thread the bot only joined, get nothing
        yield* bot.emit("THREAD_CREATE", { ...native.thread("8102", { parent_id: otherForumId }), newly_created: true })
        yield* bot.emit("THREAD_CREATE", { ...post, newly_created: false })
        yield* bot.idle()
        assert.deepEqual(native.sent(), [])
        yield* bot.emit("THREAD_CREATE", { ...post, newly_created: true })
        yield* bot.idle()
        assert.deepEqual(native.sent("8101").map(body => body.content), ["Welcome to the help desk"])
        assert.deepEqual(memory.calls.map(call => call.method), ["get", "opened"])
        assert.deepEqual(memory.calls[1]!.input, { serverId: bot.fixtures.ids.guild, threadId: "8101", forumId })
    }))
})

test("!solved by the author applies the solved tag and closes the post, and others need help desk staff", async () => {
    await run(settings(), bot => Effect.gen(function* () {
        const native = platform(bot, { applied: ["7100", "7101", "7102", "7103", "7104"] })
        native.thread("8201")
        yield* say(bot, memberId, "!solved", "8201")
        assert.deepEqual(native.edits.requests().length, 0)
        assert.match(native.sent("8201").at(-1)!.content, /Only the post's author or help desk staff/)
        yield* say(bot, authorId, "!solved", "8201")
        // A post carries at most five tags, so it keeps its first four beside the solved tag
        assert.deepEqual(native.edits.requests().map(request => request.body), [{ applied_tags: ["7100", "7101", "7102", "7103", solvedTagId], archived: true }])
        assert.match(native.sent("8201").at(-1)!.content, /Marked as solved and closed/)
        yield* say(bot, staffId, "!solved", "8201")
        assert.equal(native.edits.requests().length, 2)
        // Outside a help post the command explains where it works
        yield* say(bot, authorId, "!solved", staffChannelId)
        assert.match(native.sent(staffChannelId).at(-1)!.content, /Use !solved in a post of a help desk forum/)
    }))
})

test("a missing solved tag and a missing permission each name their fix", async () => {
    await run(settings(), bot => Effect.gen(function* () {
        const native = platform(bot, { tags: ["Bug"] })
        native.thread("8301")
        yield* say(bot, authorId, "!solved", "8301")
        assert.equal(native.sent("8301").at(-1)!.content, `<#${forumId}> has no tag named Solved. Add it in the forum's settings, or choose another with !helpdesk tag "name"`)
        assert.equal(native.edits.requests().length, 0)
    }))
    await run(settings(), bot => Effect.gen(function* () {
        const native = platform(bot, { botPermissions: Permissions.ViewChannel | Permissions.SendMessages | Permissions.SendMessagesInThreads | Permissions.ReadMessageHistory })
        native.thread("8302")
        yield* say(bot, authorId, "!solved", "8302")
        assert.equal(native.sent("8302").at(-1)!.content, `Grant Manage Threads to the NeonFlux role and allow it in <#${forumId}>`)
    }))
})

test("staff post and save answers, and the help desk settings accept only forums NeonFlux can serve", async () => {
    await run(settings({ forumIds: [] }), (bot, memory) => Effect.gen(function* () {
        const native = platform(bot)
        native.thread("8401")
        yield* say(bot, memberId, "!answer logs", "8401")
        assert.match(native.sent("8401").at(-1)!.content, /Only help desk staff/)
        yield* say(bot, staffId, "!answer logs", "8401")
        assert.equal(native.sent("8401").at(-1)!.content, "**Send your logs**\nOpen settings and copy the log")
        yield* say(bot, staffId, "!answer set crash \"Crash on start\" \"Reinstall the app\"", staffChannelId)
        assert.deepEqual((memory.calls.at(-1)!.input as HelpDeskManageRequest).operation, { type: "answer-set", name: "crash", title: "Crash on start", content: "Reinstall the app" })
        assert.equal((memory.calls.at(-1)!.input as HelpDeskManageRequest).authorized, "staff")
        // Settings need the server manager, and a text channel is no forum
        yield* say(bot, staffId, `!helpdesk forum add <#${forumId}>`, staffChannelId)
        assert.match(native.sent(staffChannelId).at(-1)!.content, /Only the server owner or members with Manage Server/)
        yield* say(bot, serverOwnerId, `!helpdesk forum add <#${staffChannelId}>`, staffChannelId)
        assert.equal(native.sent(staffChannelId).at(-1)!.content, "Choose a forum or media channel of this server")
        yield* say(bot, serverOwnerId, `!helpdesk forum add <#${forumId}>`, staffChannelId)
        assert.deepEqual(memory.settings().forumIds, [forumId])
        assert.equal(native.sent(staffChannelId).at(-1)!.content, `<#${forumId}> now uses the help desk`)
        yield* say(bot, serverOwnerId, "!helpdesk", staffChannelId)
        assert.deepEqual((native.sent(staffChannelId).at(-1) as Body).embeds, [{ color: 0x5560e6, title: "Help desk", fields: [{ name: "Forums", value: `<#${forumId}>` },
            { name: "Greeting", value: "Welcome to the help desk" }, { name: "Solved tag", value: "Solved" }, { name: "Reply reminder", value: "After 1 day without a reply" },
            { name: "Thread warnings", value: "Off" }, { name: "Default auto-archive", value: "Off" }, { name: "Active threads", value: "1 of 1000" }] }])
        yield* say(bot, staffId, "!answer list", staffChannelId)
        // One page holds every answer, so the card has no Next field, and the count names no limit below 40
        assert.deepEqual((native.sent(staffChannelId).at(-1) as Body).embeds, [{ color: 0x5560e6, title: "Saved answers",
            description: "**logs** Send your logs\n**crash** Crash on start\nPost one with `!answer <name>`", footer: { text: "2 answers saved" } }])
        // The saved settings apply at once, so the next post is greeted
        yield* bot.emit("THREAD_CREATE", { ...native.thread("8402"), newly_created: true })
        yield* bot.idle()
        assert.equal(native.sent("8402").length, 1)
    }))
})

test("!answer list shows 50 answers 10 at a time with one hint, clips long titles and pages with next", async () => {
    await run(settings(), (bot, memory) => Effect.gen(function* () {
        const native = platform(bot)
        memory.answers.clear()
        for (let index = 1; index <= 50; index++) memory.answers.set(`answer-${index}`, { name: `answer-${index}`, title: "Long title ".repeat(9).trim(), content: "Text", updatedAt: 0 })
        const page = () => (native.sent(staffChannelId).at(-1) as Body).embeds!
        yield* say(bot, staffId, "!answer list", staffChannelId)
        const [first] = page(), lines = first!.description!.split("\n")
        // Ten answers and one hint, each answer on one line with its title cut to 80 characters
        assert.equal(lines.length, 11)
        assert.equal(lines[0], `**answer-1** ${"Long title ".repeat(9).slice(0, 79)}…`)
        assert.equal(lines[10], "Post one with `!answer <name>`")
        assert.deepEqual([first!.fields, first!.footer], [[{ name: "Next", value: "`!answer list next`" }], { text: "50 of 50 answers saved" }])
        for (let next = 2; next <= 5; next++) yield* say(bot, staffId, "!answer list next", staffChannelId)
        const [last] = page()
        assert.ok(last!.description!.startsWith("**answer-41** "))
        assert.equal(last!.description!.split("\n").length, 11)
        assert.equal(last!.fields, undefined)
        // The last page forgets the list, so another next says how to start again
        yield* say(bot, staffId, "!answer list next", staffChannelId)
        assert.equal(native.sent(staffChannelId).at(-1)!.content, "There is no next page to show. Send !answer list to start the list again")
    }))
})

test("a work pass reminds an unanswered post's author once, and skips answered, closed and deleted posts", async () => {
    const nudges = ["8501", "8502", "8503", "8504"].map(threadId => ({ threadId, forumId }))
    await run(settings(), (bot, memory) => Effect.gen(function* () {
        const native = platform(bot)
        native.thread("8501")
        native.thread("8503", { thread_metadata: metadata({ archived: true }) })
        // 8504 was deleted. 8502 has a reply from another member
        bot.rest.respond("GET /channels/8502/messages", { body: [bot.fixtures.message({ channel_id: "8502", author: bot.fixtures.user({ id: memberId }) })] })
        native.thread("8502")
        const result = yield* processHelpDeskPass(memory.store, bot.fixtures.ids.guild, bot.client as Client)
        assert.deepEqual(result, { reminded: 1, more: false })
        const reminder = native.sent("8501")[0]!
        assert.match(reminder.content, new RegExp(`^<@${authorId}> Nobody has replied`))
        assert.deepEqual(reminder.allowed_mentions, { parse: [], users: [authorId], roles: [], replied_user: false })
        assert.deepEqual(native.sent("8502"), [])
    }), { nudges, more: false, guard: null })
})

test("a thread budget pass applies stored default auto-archive times in bounded passes and warns staff near the cap", async () => {
    const guard = { channelId: staffChannelId, autoArchive: true, threshold: 900 }
    await run(settings({ guardChannelId: staffChannelId, autoArchive: true }), (bot, memory) => Effect.gen(function* () {
        const native = platform(bot)
        // Threads already at their forum's one-day default and pinned posts keep their time
        native.thread("8600", { thread_metadata: metadata({ auto_archive_duration: 1440 }) })
        native.thread("8601", { flags: 2 })
        for (let index = 0; index < helpDeskArchiveEditsPerPass + 2; index++) native.thread(String(8700 + index))
        yield* processHelpDeskPass(memory.store, bot.fixtures.ids.guild, bot.client as Client)
        assert.equal(native.edits.requests().length, helpDeskArchiveEditsPerPass)
        assert.deepEqual(native.edits.requests()[0]!.body, { auto_archive_duration: 1440 })
        assert.equal(native.edits.requests().some(request => ["8600", "8601"].includes(segment(request.path, 2))), false)
        // Changes left for later are reported, and a server below the threshold is not warned
        assert.deepEqual(memory.calls.at(-1), { method: "guard", input: { serverId: bot.fixtures.ids.guild, activeThreads: helpDeskArchiveEditsPerPass + 4, more: true } })
        assert.deepEqual(native.sent(staffChannelId), [])
    }), { nudges: [], more: false, guard })
    await run(settings({ guardChannelId: staffChannelId }), (bot, memory) => Effect.gen(function* () {
        const native = platform(bot)
        for (let index = 0; index < 950; index++) native.thread(String(10000 + index), { thread_metadata: metadata({ auto_archive_duration: 1440 }) })
        yield* processHelpDeskPass(memory.store, bot.fixtures.ids.guild, bot.client as Client)
        assert.match(native.sent(staffChannelId)[0]!.content, /^This server has 950 of Fluxer's 1000 active threads/)
        assert.equal(native.edits.requests().length, 0)
    }), { nudges: [], more: false, guard: { ...guard, autoArchive: false } })
})

test("!escalate opens a ticket for the post's author and its reply notifies only the author", async () => {
    const f = createFixtures(), memory = memoryStore(settings()), remote = ticketBoundary(), manage = remote.store.manage
    remote.categories.set("support", { name: "support", revision: 1, enabled: true, visibility: "private", parentId: null, description: "Synthetic support", supportRoleIds: [], questions: [], cannedReplies: [] })
    remote.store.manage = input => {
        const op = input.operation
        if (op.type !== "escalate") return manage(input)
        const ticket: TicketRecord = { ticketNo: 1, requesterId: op.requesterId, requesterJoinedAt: op.requesterJoinedAt, categoryName: "support", categoryRevision: 1, visibility: "private",
            supportRoleIds: [], state: "creating", generation: 1, botId: input.context.botId, priority: "normal", createdAt: input.createdAt, erased: false, entryCount: 0 }
        remote.tickets.set(1, ticket)
        return Effect.succeed({ duplicate: false, type: "ticket", ticket: structuredClone(ticket), grant: { ...remote.grant(ticket, input, "create"), escalatedFrom: op.postId } })
    }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { helpDesk: memory.store, tickets: remote.store }))
        yield* bot.ready()
        yield* bot.idle()
        const native = platform(bot)
        native.thread("8501")
        // The ticket channel keeps the permissions NeonFlux created it with
        let channel: object = {}
        bot.rest.respond(`POST /guilds/${f.ids.guild}/channels`, request => { channel = { ...f.channel({ id: "5900", guild_id: f.ids.guild, type: 0, parent_id: null }), ...request.body as object }; return { body: channel } })
        bot.rest.respond("GET /channels/5900", () => ({ body: channel }))
        const command = bot.fixtures.message({ channel_id: "8501", content: "!escalate support", author: bot.fixtures.user({ id: staffId }) })
        yield* bot.emit("MESSAGE_CREATE", command)
        yield* bot.idle()
        const notice = native.sent("8501").at(-1)! as Body & { content: string, allowed_mentions?: unknown, message_reference?: { message_id: string } }
        assert.equal(notice.content, `This post continues in ticket #1, <#5900>. <@${authorId}> can reply there`)
        assert.equal(notice.message_reference?.message_id, command.id)
        assert.deepEqual(notice.allowed_mentions, { parse: [], users: [authorId], roles: [], replied_user: false })
        assert.equal(native.sent("8501").length, 1)
    })).pipe(Effect.provide(TestClock.layer())))
})
