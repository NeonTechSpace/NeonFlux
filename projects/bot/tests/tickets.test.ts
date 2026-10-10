import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot, type TestBot } from "@neontechspace/fluxerly/effect/testing"
import { Cause, Clock, Deferred, Effect, Fiber, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { parseDeploymentScope } from "../src/server-scope.ts"
import { fakeClient, quietSignal } from "./backend-fake.ts"
import { parseTicketCommand, ticketPrivateCommand, type TicketCommand } from "../src/ticket-command.ts"
import { readTicketAuthority } from "../src/ticket-permissions.ts"
import { captureTicketTranscript } from "../src/ticket-transcripts.ts"
import { performTicketChain, performTicketGrant } from "../src/tickets.ts"
import { TicketStoreError } from "../src/ticket-store.ts"
import { boundary, platform, token } from "./moderation-fixture.ts"
import { ticketBoundary } from "./ticket-fixture.ts"

type Bot = TestBot
function native(bot: Bot, options: Parameters<typeof platform>[1] = {}) {
    const p = platform(bot, options), f = bot.fixtures
    p.channel.remove(); p.replies.remove()
    type WireOverwrite = { id: string, type: number, allow: string, deny: string }
    const state = { channel: { ...f.channel({ name: "ticket-1", parent_id: null }), permission_overwrites: [] as WireOverwrite[] }, deleted: false }
    const fetch = bot.rest.respond(`GET /channels/${f.ids.channel}`, () => state.deleted ? { status: 404, body: { message: "Synthetic absent channel" } } : { body: state.channel })
    const create = bot.rest.respond(`POST /guilds/${f.ids.guild}/channels`, request => {
        state.channel = { ...state.channel, ...request.body as object }; return { body: state.channel }
    })
    const overwrite = bot.rest.respond(`PUT /channels/${f.ids.channel}/permissions/:id`, request => {
        const id = request.path.split("/").at(-1)!, value = { id, ...request.body as { type: number, allow: string, deny: string } }
        state.channel = { ...state.channel, permission_overwrites: [...(state.channel.permission_overwrites ?? []).filter(o => o.id !== id), value] }
        return { status: 204 }
    })
    const remove = bot.rest.respond(`DELETE /channels/${f.ids.channel}`, () => { state.deleted = true; return { status: 204 } })
    const send = bot.rest.respond("POST /channels/:id/messages", request => {
        const body = request.body as { content?: string, embeds?: object[] }
        return { body: f.message({ channel_id: request.path.split("/")[2], author: f.botUser(), content: body.content ?? "", embeds: body.embeds ?? [] }) }
    })
    return { ...p, state, fetch, create, overwrite, remove, send }
}
function seed(remote: ReturnType<typeof ticketBoundary>, bot: Bot, visibility: C.TicketVisibility = "private") {
    return Effect.gen(function* () {
        const f = bot.fixtures, facts = yield* readTicketAuthority(bot.client, f.ids.guild, f.ids.user)
        const source: C.TicketSource = { serverId: f.ids.guild, messageId: f.nextId(), createdAt: yield* Clock.currentTimeMillis, context: facts.context }
        remote.categories.set("support", { name: "support", revision: 1, enabled: true, visibility, parentId: null, description: "Synthetic support", supportRoleIds: [], questions: ["Synthetic question"], cannedReplies: [] })
        const ticket: C.TicketRecord = { ticketNo: 1, requesterId: f.ids.user, requesterJoinedAt: facts.context.actor.joinedAt, categoryName: "support", categoryRevision: 1,
            visibility, supportRoleIds: [], state: "creating", generation: 1, botId: f.ids.bot, priority: "normal", createdAt: source.createdAt, erased: false, entryCount: 0 }
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
    assert.deepEqual(parseTicketCommand(["category", "create", "Support", "private", "none", "none"]), { type: "category-create", name: "support", visibility: "private", supportRoleIds: [] })
    assert.deepEqual(parseTicketCommand(["submit", "1", "public"]), { type: "submit", intakeNo: 1, visibility: "public" })
    for (const args of [["submit", "1"], ["delete", "1"], ["erase", "1", "yes"], ["replay", "1"], ["answer", "1", "6", "x"], ["answer", "1", "1", "x".repeat(2001)], ["question", "support", "add", "x".repeat(201)], ["transcript", "1", "capture", "501"]]) assert("error" in parseTicketCommand(args))
})

test("ticket grammar binds exact operation numbers, private configuration and explicit confirmations", () => {
    const f = createFixtures(), roleId = f.nextId(), parentId = f.nextId()
    const cases: readonly [readonly string[], TicketCommand][] = [
        [["category", "create", "Support", "private", `<#${parentId}>`, `<@&${roleId}>`, roleId], { type: "category-create", name: "support", visibility: "private", parentId, supportRoleIds: [roleId] }],
        [["category", "set", "SUPPORT", "parent", "none"], { type: "category-set", name: "support", field: "parent", value: null }],
        [["category", "set", "support", "staff", "none"], { type: "category-set", name: "support", field: "staff", value: [] }],
        [["question", "Support", "set", "5", "界".repeat(200)], { type: "question", name: "support", operation: "set", index: 5, text: "界".repeat(200) }],
        [["answer", "20", "5", "😀".repeat(1000)], { type: "answer", intakeNo: 20, index: 5, text: "😀".repeat(1000) }],
        [["reply", "20", "canned", "Thanks"], { type: "reply-canned", ticketNo: 20, name: "thanks" }],
        [["note", "20", "list", "19"], { type: "notes", ticketNo: 20, beforeEntryNo: 19 }],
        [["transcript", "20", "capture"], { type: "transcript-capture", ticketNo: 20, maxMessages: 500 }],
        [["transcript", "20", "show", "2", "21"], { type: "transcript-show", ticketNo: 20, transcriptNo: 2, page: 21 }],
        [["abandon", "20"], { type: "abandon", ticketNo: 20 }],
        [["attempt", "20", "8"], { type: "attempt", ticketNo: 20, attemptNo: 8 }],
        [["delete", "20", "confirm"], { type: "delete", ticketNo: 20, confirmed: true }],
        [["erase", "20", "confirm"], { type: "erase", ticketNo: 20, confirmed: true }],
    ]
    for (const [input, expected] of cases) assert.deepEqual(parseTicketCommand(input), expected)
    for (const args of [["attempt", "1"], ["attempt", "1", "0"], ["attempt", "1", "9007199254740992"], ["transcript", "1", "show", "1", "0"], ["abandon", "1", "confirm"], ["submit", "01", "private"], ["answer", "1", "1", "\u202e\u000c  "], ["category", "create", "support", "public", "none"], ["category", "create", "support", "private", "none", "none", roleId]]) assert("error" in parseTicketCommand(args))
    for (const args of [["category", "set", "support", "enabled", "off"], ["category", "delete", "support"], ["question", "support", "clear"], ["canned", "support", "remove", "thanks"], ["attempt", "1", "1"]]) {
        const parsed = parseTicketCommand(args); assert(!("error" in parsed)); if (!("error" in parsed)) assert(ticketPrivateCommand(parsed))
    }
})

test("public ticket commands cannot read private configuration, queue, operation history or bodies", async () => {
    const f = createFixtures(), remote = ticketBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store })), p = native(bot)
        yield* bot.ready()
        for (const content of ["category create support private none none", "category show support", "category set support enabled off", "category delete support", "question support clear", "canned support remove thanks", "list", "intake 1", "attempt 1 1", 'note 1 add "Synthetic note"', "note 1 list", "transcript 1 capture", "transcript 1 list", "transcript 1 show 1"]) yield* emit(bot, `!ticket ${content}`)
        assert.equal(remote.calls.length, 0); assert.equal(p.actor.requests().length, 0)
        assert(p.send.requests().every(r => (r.body as { content: string }).content.includes("verified one-to-one DM")))
        assert.deepEqual(bot.failures(), [])
    })))
})

test("private configuration and support queue use verified DM context without public body disclosure", async () => {
    const f = createFixtures(), remote = ticketBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store })), p = native(bot)
        const { ticket } = yield* seed(remote, bot)
        remote.categories.get("support")!.questions = ["Synthetic private configuration question"]
        remote.categories.get("support")!.cannedReplies = [{ name: "thanks", templateName: "private-template", templateRevision: 1, content: { content: "Synthetic private canned body" } }]
        remote.tickets.set(2, { ...structuredClone(ticket), ticketNo: 2, requesterId: f.nextId() })
        yield* bot.ready(); yield* emit(bot, "!ticket categories")
        assert(!JSON.stringify(p.send.requests()).includes("Synthetic private configuration")); assert(!JSON.stringify(p.send.requests()).includes("Synthetic private canned body"))
        yield* emit(bot, "!ticket category show support", p.dmId)
        yield* emit(bot, "!ticket canned support list", p.dmId)
        yield* emit(bot, "!ticket list", p.dmId)
        const queries = remote.calls.filter(c => c.method === "query").map(c => c.input as C.TicketQueryRequest)
        assert(queries.filter(q => q.operation.type !== "categories").every(q => q.context.actor.privateChannelVerified && q.context.actor.privateChannelId === p.dmId))
        assert.deepEqual(queries.at(-1)!.operation, { type: "tickets", own: false })
        assert(p.send.requests().some(r => r.path.includes(p.dmId) && (r.body as { content: string }).content.includes("Ticket 2:")))
        assert.deepEqual(bot.failures(), [])
    })))
})

test("private intake through actual gateway uses explicit audience and never posts answers into a public conversation", async () => {
    const f = createFixtures(), remote = ticketBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }))
        const p = native(bot); yield* bot.ready()
        yield* emit(bot, "!ticket category create support public none none", p.dmId)
        yield* emit(bot, '!ticket question support add "Synthetic private question"', p.dmId)
        yield* emit(bot, "!ticket open support")
        assert.equal(remote.intakes.size, 0)
        yield* emit(bot, "!ticket open support", p.dmId)
        yield* emit(bot, '!ticket answer 1 1 "Synthetic private answer"', p.dmId)
        yield* emit(bot, "!ticket review 1", p.dmId)
        yield* emit(bot, "!ticket submit 1 public", p.dmId)
        assert.equal(remote.tickets.get(1)?.state, "open")
        assert.equal(p.create.requests().length, 1)
        const envelope = p.create.requests()[0]!.body as { permission_overwrites: { id: string, allow: string }[] }
        assert.equal(envelope.permission_overwrites.length, 3)
        assert(BigInt(envelope.permission_overwrites.find(o => o.id === f.ids.guild)!.allow) & Permissions.ViewChannel)
        const publicBodies = p.send.requests().filter(r => r.path.includes(f.ids.channel)).map(r => JSON.stringify(r.body)).join("\n")
        assert(!publicBodies.includes("Synthetic private answer")); assert(!publicBodies.includes("Synthetic private question"))
        assert(p.send.requests().filter(r => r.path.includes(p.dmId)).some(r => JSON.stringify(r.body).includes("Public conversation")))
        for (const request of p.send.requests()) assert.deepEqual((request.body as { allowed_mentions: object }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        assert.deepEqual(bot.failures(), [])
    })))
})

test("ticket gateway ignores unrelated staff gates but preserves native message protection and private recipient checks", async () => {
    const f = createFixtures(), remote = ticketBoundary(), moderation = boundary(); moderation.current.defcon = 1
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, tickets: remote.store }))
        const p = native(bot, { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.ReadMessageHistory | Permissions.SendMessages })
        yield* bot.ready(); yield* emit(bot, "!ticket categories")
        assert.equal(remote.calls.filter(c => c.method === "query").length, 1)
        const gate = moderation.calls.find(c => c.method === "gate")!.input as C.ModerationGateRequest
        assert.equal(gate.command, "critical"); assert.equal(gate.actor.isAdministrator, false)
        moderation.current.automodEnabled = true
        moderation.store.evaluate = () => Effect.succeed({ duplicate: false, blocked: true })
        yield* emit(bot, "!ticket categories")
        assert.equal(remote.calls.filter(c => c.method === "query").length, 1)
        p.privateFetch.remove(); bot.rest.respond(`GET /channels/${p.dmId}`, { body: { id: p.dmId, type: 3, recipients: [f.user()] } })
        yield* emit(bot, "!ticket open support", p.dmId)
        assert.equal(remote.calls.filter(c => c.method === "intake").length, 0)
        assert.deepEqual(bot.failures(), [])
    })))
})

test("private create sends its entire audience atomically and known identity survives incomplete native snapshots", async () => {
    for (const incomplete of [false, true]) {
        const remote = ticketBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-ticket-token" }), p = native(bot), f = bot.fixtures
            const { grant } = yield* seed(remote, bot)
            if (incomplete) { p.create.remove(); bot.rest.respond(`POST /guilds/${f.ids.guild}/channels`, { body: { id: f.ids.channel, guild_id: f.ids.guild, type: 0 } }) }
            const result = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant)
            assert.equal(result.outcome, incomplete ? "uncertain" : "succeeded")
            assert.equal("channelId" in result && result.channelId, f.ids.channel)
            const outcome = remote.calls.find(c => c.method === "outcome")!.input as C.TicketOutcomeRequest
            assert.equal(outcome.channelId, f.ids.channel)
            if (!incomplete) {
                const everyone = (p.create.requests()[0]!.body as { permission_overwrites: { id: string, allow: string, deny: string }[] }).permission_overwrites.find(o => o.id === f.ids.guild)!
                assert.equal(BigInt(everyone.allow) & Permissions.ViewChannel, 0n); assert(BigInt(everyone.deny) & Permissions.ViewChannel)
            }
            assert.equal((yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant)).recorded, false)
        })))
    }
})

test("native ticket ownership compares overwrite fields independently of backend object property ordering", async () => {
    const remote = ticketBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-ticket-token" }), p = native(bot), f = bot.fixtures
        const { grant } = yield* seed(remote, bot), outcome = remote.store.outcome
        const reordered = (entry: C.TicketOverwrite): C.TicketOverwrite => ({ deny: entry.deny, allow: entry.allow, type: entry.type, id: entry.id })
        grant.overwrites = grant.overwrites!.map(reordered)
        remote.store.outcome = input => outcome(input).pipe(Effect.map(result => result.grant?.expectedChannel
            ? { ...result, grant: { ...result.grant, expectedChannel: { ...result.grant.expectedChannel, overwrites: result.grant.expectedChannel.overwrites.map(reordered) } } } : result))
        const results = yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
        assert.deepEqual(results.map(r => r.outcome), ["succeeded", "succeeded"])
        assert.equal(p.create.requests().length, 1); assert.equal(p.send.requests().length, 1)
    })))
})

test("ticket close and reopen own only posting bits, reverse exact steps and preserve unrelated changes", async () => {
    const threadBits = Permissions.SendMessagesInThreads | Permissions.CreatePublicThreads | Permissions.CreatePrivateThreads
    // Grants recorded before thread support own SendMessages only and leave thread bits alone
    for (const legacy of [false, true]) {
        const remote = legacy ? ticketBoundary({}, null) : ticketBoundary()
        const owned = legacy ? Permissions.SendMessages : Permissions.SendMessages | threadBits
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-ticket-token" }), p = native(bot), f = bot.fixtures
            const { source, ticket, grant } = yield* seed(remote, bot)
            assert.equal((yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)).length, 2)
            const original = structuredClone(ticket.channel!)
            ticket.generation++; const close = remote.grant(ticket, source, "close-everyone")
            p.state.channel.permission_overwrites = p.state.channel.permission_overwrites!.map(o => o.id === f.ids.user ? { ...o, allow: (BigInt(o.allow) | Permissions.AddReactions).toString() } : o)
            const results = yield* performTicketChain(remote.store, f.ids.guild, bot.client, close)
            assert(results.every(r => r.outcome === "succeeded")); assert.equal(ticket.state, "closed")
            assert.deepEqual(p.overwrite.requests().map(r => r.path.split("/").at(-1)), [f.ids.guild, f.ids.user])
            for (const id of [f.ids.guild, f.ids.user]) {
                const closed = p.state.channel.permission_overwrites!.find(o => o.id === id)!
                assert.equal(BigInt(closed.deny) & (Permissions.SendMessages | threadBits), owned)
            }
            ticket.generation++; const reopen = remote.grant(ticket, source, "reopen-requester")
            const reopened = yield* performTicketChain(remote.store, f.ids.guild, bot.client, reopen)
            assert(reopened.every(r => r.outcome === "succeeded")); assert.equal(ticket.state, "open")
            assert.deepEqual(p.overwrite.requests().slice(2).map(r => r.path.split("/").at(-1)), [f.ids.user, f.ids.guild])
            for (const o of original.overwrites) {
                const current = ticket.channel!.overwrites.find(v => v.id === o.id)!
                assert.equal(BigInt(current.allow) & owned, BigInt(o.allow) & owned)
                assert.equal(BigInt(current.deny) & owned, BigInt(o.deny) & owned)
            }
            assert(BigInt(ticket.channel!.overwrites.find(o => o.id === f.ids.user)!.allow) & Permissions.AddReactions)
        })))
    }
})

test("close refuses widened private audience and nonstaff send grants without a native write", async () => {
    for (const allowed of [Permissions.ViewChannel, Permissions.SendMessages, Permissions.SendMessagesInThreads]) {
        const remote = ticketBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-ticket-token" }), p = native(bot), f = bot.fixtures
            const { source, ticket, grant } = yield* seed(remote, bot)
            yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
            ticket.generation++; const close = remote.grant(ticket, source, "close-everyone")
            p.state.channel.permission_overwrites!.push({ id: f.nextId(), type: 1, allow: allowed.toString(), deny: "0" })
            assert.equal((yield* performTicketGrant(remote.store, f.ids.guild, bot.client, close)).outcome, "failed")
            assert.equal(p.overwrite.requests().length, 0)
        })))
    }
})

test("lost followup acknowledgement never repeats create or infers introduction delivery", async () => {
    const remote = ticketBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-ticket-token" }), p = native(bot), f = bot.fixtures
        const { grant } = yield* seed(remote, bot), outcome = remote.store.outcome
        remote.store.outcome = input => outcome(input).pipe(Effect.andThen(Effect.fail(new TicketStoreError({ operation: "outcome", status: null }))))
        const result = yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
        assert.equal(result.length, 1); assert.equal(result[0]!.recorded, false)
        yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
        assert.equal(p.create.requests().length, 1); assert.equal(p.send.requests().length, 0)
    })))
})

test("denied and lost exact claims cannot create or finalize another worker", async () => {
    for (const lost of [false, true]) {
        const remote = ticketBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-ticket-token" }), p = native(bot), f = bot.fixtures
            const { grant } = yield* seed(remote, bot)
            remote.store.dispatch = () => lost ? Effect.fail(new TicketStoreError({ operation: "dispatch", status: null })) : Effect.succeed({ claimed: false, dispatchExpiresAt: grant.dispatchExpiresAt, nativeDeadlineMs: 5000 })
            const result = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant)
            assert.equal(result.recorded, false); assert.equal(p.create.requests().length, 0)
            assert.equal(remote.calls.filter(c => c.method === "outcome").length, 0)
        })))
    }
})

test("interruption before a confirmed claim cannot write or finalize another claimant", async () => {
    for (const duringClaim of [false, true]) {
        const remote = ticketBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-ticket-token" }), p = native(bot), f = bot.fixtures
            const { grant } = yield* seed(remote, bot), entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
            if (duringClaim) remote.store.dispatch = input => {
                remote.calls.push({ method: "dispatch", input })
                return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as({ claimed: true, dispatchExpiresAt: grant.dispatchExpiresAt, nativeDeadlineMs: 5000 }))
            }
            else {
                p.actor.remove(); bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, async () => {
                    await Effect.runPromise(Deferred.succeed(entered, undefined)); await Effect.runPromise(Deferred.await(release))
                    return { body: f.member({ roles: [p.actorRole.id], communication_disabled_until: null }) }
                })
            }
            const running = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant).pipe(Effect.forkChild)
            yield* Deferred.await(entered); yield* Fiber.interrupt(running); yield* Deferred.succeed(release, undefined)
            assert.equal(p.create.requests().length, 0); assert.equal(remote.calls.filter(c => c.method === "outcome").length, 0)
            assert.equal(remote.calls.filter(c => c.method === "dispatch").length, duringClaim ? 1 : 0)
            const result = yield* Fiber.await(running)
            assert.equal(result._tag, "Failure"); if (result._tag === "Failure") assert(Cause.hasInterrupts(result.cause))
        })))
    }
})

test("ticket expiry is checked after a delayed claim using a controlled clock", async () => {
    const remote = ticketBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-ticket-token" }), p = native(bot), f = bot.fixtures
        const { grant } = yield* seed(remote, bot), entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
        grant.dispatchExpiresAt = 180000
        remote.store.dispatch = () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as({ claimed: true, dispatchExpiresAt: 180000, nativeDeadlineMs: 5000 }))
        const running = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant).pipe(Effect.forkChild)
        yield* Deferred.await(entered); yield* TestClock.adjust("180000 millis"); yield* Deferred.succeed(release, undefined)
        assert.equal((yield* Fiber.join(running)).outcome, "failed"); assert.equal(p.create.requests().length, 0)
        const outcome = remote.calls.find(c => c.method === "outcome")!.input as C.TicketOutcomeRequest
        assert.equal(outcome.noDispatch, true); assert.match(outcome.claimToken!, /^[a-f0-9]{32}$/)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("native rejection stays uncertain while actual SDK validation proves nondispatch", async () => {
    for (const badInput of [false, true]) {
        const remote = ticketBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-ticket-token" }), p = native(bot), f = bot.fixtures
            const { grant } = yield* seed(remote, bot)
            p.create.remove(); const request = bot.rest.respond(`POST /guilds/${f.ids.guild}/channels`, { status: 403, body: { message: "Synthetic denied create" } })
            if (badInput) grant.channelName = "x".repeat(101)
            const result = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant)
            assert.equal(result.outcome, badInput ? "failed" : "uncertain")
            assert.equal(request.requests().length, badInput ? 0 : 1)
            assert.equal((remote.calls.find(c => c.method === "outcome")!.input as C.TicketOutcomeRequest).noDispatch, badInput ? true : undefined)
        })))
    }
})

for (const [sdkDeadline, advance] of [[30000, "5 seconds"], [1000, "1 second"]] as const) {
    test(`ticket native create respects the bounded operation and shorter SDK ${sdkDeadline}ms deadline`, { timeout: 10000 }, async () => {
        const remote = ticketBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-ticket-token", rest: { defaultTimeoutMs: sdkDeadline } }), p = native(bot), f = bot.fixtures
            const { grant } = yield* seed(remote, bot), entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
            p.create.remove(); const create = bot.rest.respond(`POST /guilds/${f.ids.guild}/channels`, async () => { await Effect.runPromise(Deferred.succeed(entered, undefined)); await Effect.runPromise(Deferred.await(release)); return { body: p.state.channel } })
            const running = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant).pipe(Effect.forkChild)
            yield* Deferred.await(entered); yield* TestClock.adjust(advance)
            assert.equal((yield* Fiber.join(running)).outcome, "uncertain"); assert.equal(create.requests().length, 1)
            yield* Deferred.succeed(release, undefined)
        })).pipe(Effect.provide(TestClock.layer())))
    })
}

test("partial close retains the confirmed first step and never claims a rejected second step closed", async () => {
    const remote = ticketBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-ticket-token" }), p = native(bot), f = bot.fixtures
        const { source, ticket, grant } = yield* seed(remote, bot); yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
        ticket.generation++; const close = remote.grant(ticket, source, "close-everyone")
        bot.rest.respond(`PUT /channels/${f.ids.channel}/permissions/${f.ids.user}`, { status: 403, body: { message: "Synthetic second step failure" } })
        const results = yield* performTicketChain(remote.store, f.ids.guild, bot.client, close)
        assert.deepEqual(results.map(r => r.outcome), ["succeeded", "uncertain"]); assert.equal(ticket.state, "uncertain")
        assert(BigInt(ticket.channel!.overwrites.find(o => o.id === f.ids.guild)!.deny) & Permissions.SendMessages)
        assert(BigInt(ticket.channel!.overwrites.find(o => o.id === f.ids.user)!.allow) & Permissions.SendMessages)
    })))
})

test("interruption after known create identity preserves ownership in a bounded uncertain finalizer", async () => {
    const remote = ticketBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-ticket-token" }), p = native(bot), f = bot.fixtures
        const { grant } = yield* seed(remote, bot), entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
        p.fetch.remove(); bot.rest.respond(`GET /channels/${f.ids.channel}`, async () => { await Effect.runPromise(Deferred.succeed(entered, undefined)); await Effect.runPromise(Deferred.await(release)); return { body: p.state.channel } })
        const running = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant).pipe(Effect.forkChild)
        yield* Deferred.await(entered); yield* Fiber.interrupt(running); yield* Deferred.succeed(release, undefined)
        const outcome = remote.calls.find(c => c.method === "outcome")!.input as C.TicketOutcomeRequest
        assert.equal(outcome.outcome, "uncertain"); assert.equal(outcome.channelId, f.ids.channel); assert(outcome.channel)
        assert.equal(p.create.requests().length, 1)
    })))
})

test("native deletion requires positive acknowledgment and typed404 without repeating a delete after read failure", async () => {
    for (const readStatus of [404, 403]) {
        const remote = ticketBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-ticket-token" }), p = native(bot), f = bot.fixtures
            const { source, ticket, grant } = yield* seed(remote, bot)
            yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
            ticket.generation++; const remove = remote.grant(ticket, source, "delete")
            p.fetch.remove(); bot.rest.respond(`GET /channels/${f.ids.channel}`, () => p.state.deleted ? { status: readStatus, body: { message: "Synthetic absence or denied visibility" } } : { body: p.state.channel })
            const result = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, remove)
            assert.equal(result.outcome, readStatus === 404 ? "succeeded" : "uncertain")
            const outcome = remote.calls.filter(c => c.method === "outcome").at(-1)!.input as C.TicketOutcomeRequest
            assert.equal(outcome.nativeDeleteConfirmed, true); assert.equal(outcome.channelAbsent, readStatus === 404 ? true : undefined)
            yield* performTicketGrant(remote.store, f.ids.guild, bot.client, remove)
            assert.equal(p.remove.requests().length, 1)
        })))
    }
})

test("interrupted ticket finalization cannot hold shutdown past its five second budget", { timeout: 10000 }, async () => {
    const remote = ticketBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-ticket-token" }), p = native(bot), f = bot.fixtures
        const { grant } = yield* seed(remote, bot), entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), finalizing = yield* Deferred.make<void>(), cancelled = yield* Deferred.make<void>()
        p.fetch.remove(); bot.rest.respond(`GET /channels/${f.ids.channel}`, async () => { await Effect.runPromise(Deferred.succeed(entered, undefined)); await Effect.runPromise(Deferred.await(release)); return { body: p.state.channel } })
        remote.store.outcome = () => Deferred.succeed(finalizing, undefined).pipe(Effect.andThen(Effect.never), Effect.onInterrupt(() => Deferred.succeed(cancelled, undefined)))
        const running = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, grant).pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        const interrupting = yield* Fiber.interrupt(running).pipe(Effect.forkChild)
        yield* Deferred.await(finalizing); yield* TestClock.adjust("5 seconds")
        yield* Fiber.join(interrupting); yield* Deferred.await(cancelled); yield* Deferred.succeed(release, undefined)
        const result = yield* Fiber.await(running)
        assert.equal(result._tag, "Failure"); if (result._tag === "Failure") assert(Cause.hasInterrupts(result.cause))
        assert.equal(p.create.requests().length, 1)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("owner erase uses current server authority and locator generation without requiring channel visibility", async () => {
    const f = createFixtures(), remote = ticketBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store })), p = native(bot)
        const { ticket } = yield* seed(remote, bot); ticket.channelId = f.ids.channel
        p.fetch.remove(); const forbidden = bot.rest.respond(`GET /channels/${f.ids.channel}`, { status: 403, body: { message: "Synthetic no channel visibility" } })
        yield* bot.ready(); yield* emit(bot, "!ticket erase 1 confirm")
        assert.equal(ticket.erased, true); assert.equal(forbidden.requests().length, 0)
        assert.deepEqual(bot.failures(), [])
    })))
})

test("status and private exact attempt diagnostics preserve older outcomes without rendering authored payloads", async () => {
    const f = createFixtures(), remote = ticketBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store })), p = native(bot)
        const { source, ticket, grant } = yield* seed(remote, bot); yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
        const old = remote.attempts.get(2)!; old.content = { content: "Synthetic hidden authored payload" }; old.messageId = f.nextId()
        ticket.generation++; remote.grant(ticket, source, "reply").content = { content: "Synthetic newer payload" }
        yield* bot.ready(); yield* emit(bot, "!ticket status 1"); yield* emit(bot, "!ticket attempt 1 2", p.dmId)
        const bodies = p.send.requests().map(r => JSON.stringify(r.body)).join("\n")
        assert(bodies.includes("current attempt 3 reply pending")); assert(bodies.includes("Attempt 2 for ticket 1: introduction, succeeded"))
        assert(!bodies.includes("Synthetic hidden authored payload")); assert(!bodies.includes("Synthetic newer payload"))
        const request = remote.calls.filter(c => c.method === "query" && (c.input as C.TicketQueryRequest).operation.type === "attempt").at(-1)!.input as C.TicketQueryRequest
        assert.deepEqual(request.operation, { type: "attempt", ticketNo: 1, attemptNo: 2 }); assert.equal(request.context.actor.privateChannelVerified, true)
        assert.equal(p.create.requests().length, 1); assert.deepEqual(bot.failures(), [])
    })))
})

test("private transcript display pages through the stored transcript body", async () => {
    const f = createFixtures(), remote = ticketBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store })), p = native(bot)
        const { ticket, grant } = yield* seed(remote, bot); yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
        const body = `Synthetic first page ${"x".repeat(1800)}Synthetic second page`
        remote.transcripts.set(1, { record: { transcriptNo: 1, ticketNo: 1, channelId: f.ids.channel, capturedAt: 1, messageCount: 2, truncated: true, erased: false, pages: 2 }, messages: [], body })
        yield* bot.ready(); yield* emit(bot, "!ticket transcript 1 show 1", p.dmId)
        const first = (p.send.requests().at(-1)!.body as { content: string }).content
        assert(first.includes("Synthetic first page")); assert(!first.includes("Synthetic second page")); assert(first.includes("Next: !ticket transcript 1 show 1 2"))
        assert(first.includes("Bounded capture truncated"))
        yield* emit(bot, "!ticket transcript 1 show 1 2", p.dmId)
        const second = (p.send.requests().at(-1)!.body as { content: string }).content
        assert(second.includes("Synthetic second page")); assert(!second.includes("Next:"))
        const queries = remote.calls.filter(c => c.method === "query" && (c.input as C.TicketQueryRequest).operation.type === "transcript").map(c => (c.input as C.TicketQueryRequest).operation)
        assert.deepEqual(queries, [{ type: "transcript", ticketNo: ticket.ticketNo, transcriptNo: 1, page: 1 }, { type: "transcript", ticketNo: ticket.ticketNo, transcriptNo: 1, page: 2 }])
        assert.deepEqual(bot.failures(), [])
    })))
})

test("intake retains only the parent ID and refreshes its native category before submit and create dispatch", async () => {
    for (const replaceBeforeDispatch of [false, true]) {
        const f = createFixtures(), remote = ticketBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store })), p = native(bot)
            yield* seed(remote, bot)
            const parentId = f.nextId(); remote.categories.get("support")!.parentId = parentId
            const parent = bot.rest.respond(`GET /channels/${parentId}`, { body: f.channel({ id: parentId, type: 4 }) })
            if (replaceBeforeDispatch) {
                const intake = remote.store.intake
                remote.store.intake = input => intake(input).pipe(Effect.tap(() => Effect.sync(() => {
                    if (input.operation.type === "submit") { parent.remove(); bot.rest.respond(`GET /channels/${parentId}`, { body: f.channel({ id: parentId, type: 0 }) }) }
                })))
            }
            yield* bot.ready(); yield* emit(bot, "!ticket open support", p.dmId); yield* emit(bot, '!ticket answer 1 1 "Synthetic answer"', p.dmId); yield* emit(bot, "!ticket submit 1 private", p.dmId)
            assert.equal(remote.intakes.get(1)!.category.parentId, parentId); assert(!("parent" in remote.intakes.get(1)!.category))
            assert.equal(p.create.requests().length, replaceBeforeDispatch ? 0 : 1)
            assert.equal(parent.requests().length, replaceBeforeDispatch ? 1 : 2)
            if (!replaceBeforeDispatch) assert.equal((p.create.requests()[0]!.body as { parent_id: string }).parent_id, parentId)
            assert.deepEqual(bot.failures(), [])
        })))
    }
})

test("bounded transcript continues short pages, truncates long text and excludes attachments", async () => {
    const remote = ticketBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-ticket-token" }), p = native(bot), f = bot.fixtures
        const { source, ticket, grant } = yield* seed(remote, bot); yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
        let page = 0, historyId = BigInt(f.nextId()) + 10000n
        const history = bot.rest.respond(`GET /channels/${f.ids.channel}/messages`, () => ({ body: page++ < 4 ? [f.message({ id: (historyId--).toString(), content: page === 1 ? "😀".repeat(1100) : "Synthetic captured text", attachments: [{ id: f.nextId(), filename: "synthetic.txt", size: 5, flags: 0, url: "https://example.invalid/private", proxy_url: "https://example.invalid/private-proxy" }] })] : [] }))
        const refresh = () => readTicketAuthority(bot.client, f.ids.guild, f.ids.user, { channelId: f.ids.channel }).pipe(Effect.map(value => ({ ...value.context, actor: { ...value.context.actor, privateChannelVerified: true, privateChannelId: p.dmId } })))
        const transcript = yield* captureTicketTranscript(remote.store, bot.client, source, ticket, 500, refresh)
        assert.equal(history.requests().length, 5); assert.equal(transcript.messageCount, 4); assert.equal(transcript.truncated, true)
        const messages = remote.transcripts.get(transcript.transcriptNo)!.messages
        assert(!JSON.stringify(messages).includes("https:")); assert.equal(messages.at(-1)!.omittedAttachments, 1)
        assert.equal(messages.at(-1)!.content.length, 2000)
        assert(history.requests().slice(1).every(request => request.url.includes("before=")))
    })))
})

test("transcript caps its stored body and rechecks private access before upload", async () => {
    for (const revoke of [false, true]) {
        const remote = ticketBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-ticket-token" }), p = native(bot), f = bot.fixtures
            const { source, ticket, grant } = yield* seed(remote, bot); yield* performTicketChain(remote.store, f.ids.guild, bot.client, grant)
            let reads = 0, historyId = BigInt(f.nextId()) + 10000n
            bot.rest.respond(`GET /channels/${f.ids.channel}/messages`, () => ({ body: Array.from({ length: 100 }, () => f.message({ id: (historyId--).toString(), content: "\\".repeat(2000) })) }))
            const refresh = () => readTicketAuthority(bot.client, f.ids.guild, f.ids.user, { channelId: f.ids.channel }).pipe(Effect.map(value => ({ ...value.context, actor: { ...value.context.actor, privateChannelVerified: true, privateChannelId: p.dmId, canReadHistory: !(revoke && ++reads >= 2) } })))
            const result = yield* Effect.exit(captureTicketTranscript(remote.store, bot.client, source, ticket, 500, refresh))
            if (revoke) {
                assert.equal(result._tag, "Failure")
                assert.equal(remote.calls.filter(c => c.method === "transcriptUpload").length, 0)
            } else {
                assert.equal(result._tag, "Success"); if (result._tag !== "Success") return
                // Escaping doubles each backslash, so the serialized request, not the character count, must fit the 262,144-byte body limit
                assert(result.value.messageCount > 0 && result.value.messageCount < 75); assert.equal(result.value.truncated, true)
                const upload = remote.calls.find(c => c.method === "transcriptUpload")!.input
                assert(Buffer.byteLength(JSON.stringify(upload)) <= 262144)
            }
        })))
    }
})

test("plain DM replies answer the one open intake, step back and send it without command syntax", async () => {
    const f = createFixtures(), remote = ticketBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }))
        const p = native(bot); yield* bot.ready()
        const dm = () => p.send.requests().filter(r => r.path.includes(p.dmId)).map(r => (r.body as { content: string }).content)
        // Without an open intake a plain DM stays unanswered
        yield* emit(bot, "Synthetic plain message", p.dmId)
        assert.deepEqual(dm(), [])
        yield* emit(bot, "!ticket category create support private none none", p.dmId)
        yield* emit(bot, '!ticket question support add "First synthetic question"', p.dmId)
        yield* emit(bot, '!ticket question support add "Second synthetic question"', p.dmId)
        yield* emit(bot, "!ticket open support", p.dmId)
        assert.match(dm().at(-1)!, /^Intake 1 opened in category support\nPrivate conversation.*\nQuestion 1 of 2: First synthetic question\nReply with your answer or cancel/)
        yield* emit(bot, "back", p.dmId)
        assert.match(dm().at(-1)!, /^There is no earlier answer to change\nQuestion 1 of 2/)
        yield* emit(bot, "  First synthetic answer ", p.dmId)
        assert.deepEqual(remote.intakes.get(1)!.answers, ["First synthetic answer"])
        assert.match(dm().at(-1)!, /^Question 2 of 2: Second synthetic question\nReply with your answer, back to change the previous answer or cancel/)
        yield* emit(bot, "send", p.dmId)
        assert.match(dm().at(-1)!, /^Answer every question before sending\nQuestion 2 of 2/)
        yield* emit(bot, "BACK", p.dmId)
        assert.deepEqual(remote.intakes.get(1)!.answers, [""])
        assert.match(dm().at(-1)!, /^Previous answer: First synthetic answer\nQuestion 1 of 2/)
        yield* emit(bot, "Corrected synthetic answer", p.dmId)
        yield* emit(bot, "Second synthetic answer", p.dmId)
        assert.match(dm().at(-1)!, /^1\. First synthetic question\nAnswer: Corrected synthetic answer\n2\. Second synthetic question\nAnswer: Second synthetic answer\nPrivate conversation.*\nReply send to create the ticket/)
        yield* emit(bot, "Extra synthetic text", p.dmId)
        assert.match(dm().at(-1)!, /^Every question is answered\n/)
        yield* emit(bot, "Send", p.dmId)
        const operations = remote.calls.filter(c => c.method === "intake").map(c => (c.input as C.TicketIntakeRequest).operation)
        assert.deepEqual(operations.map(o => o.type), ["open", "answer", "clear", "answer", "answer", "submit"])
        assert.deepEqual(operations.at(-1), { type: "submit", intakeNo: 1, expectedGeneration: 5, visibility: "private", expectedCategoryRevision: 3 })
        assert.equal(remote.tickets.get(1)?.state, "open")
        assert.deepEqual(remote.intakes.get(1)!.answers, ["Corrected synthetic answer", "Second synthetic answer"])
        const ticketBodies = p.send.requests().filter(r => !r.path.includes(p.dmId)).map(r => JSON.stringify(r.body)).join("\n")
        assert(!ticketBodies.includes("synthetic answer"))
        const replies = dm().length
        yield* emit(bot, "Synthetic message after sending", p.dmId)
        assert.equal(dm().length, replies)
        assert.deepEqual(bot.failures(), [])
    })))
})

test("plain DM replies reject attachments and long answers, cancel, and ask which intake when several are open", async () => {
    const f = createFixtures(), remote = ticketBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { tickets: remote.store }))
        const p = native(bot); yield* bot.ready()
        const dm = () => p.send.requests().filter(r => r.path.includes(p.dmId)).map(r => (r.body as { content: string }).content)
        yield* emit(bot, "!ticket category create support public none none", p.dmId)
        yield* emit(bot, '!ticket question support add "Synthetic question"', p.dmId)
        yield* emit(bot, "!ticket open support", p.dmId)
        const attachment = { id: f.nextId(), filename: "synthetic.txt", size: 5, flags: 0, url: "https://example.invalid/private", proxy_url: "https://example.invalid/private-proxy" }
        yield* emit(bot, "Synthetic answer with a file", p.dmId, { attachments: [attachment] })
        assert.equal(dm().at(-1), "Send each answer as text. Attachments and stickers cannot be kept in an intake answer")
        yield* emit(bot, "x".repeat(2001), p.dmId)
        assert.equal(dm().at(-1), "An answer allows at most 2000 characters, and this one has 2001. Send a shorter answer")
        assert.deepEqual(remote.intakes.get(1)!.answers, [])
        yield* emit(bot, "!ticket open support", p.dmId)
        yield* emit(bot, "Synthetic ambiguous answer", p.dmId)
        assert.equal(dm().at(-1), [
            "You have 2 open ticket intakes, so a plain reply cannot tell which one it answers. Answer with a command, or cancel the intakes you do not need",
            'Intake 1: !ticket answer 1 <question> "answer"', 'Intake 2: !ticket answer 2 <question> "answer"'].join("\n"))
        assert(remote.calls.filter(c => c.method === "intake").every(c => (c.input as C.TicketIntakeRequest).operation.type === "open"))
        yield* emit(bot, "!ticket cancel 2", p.dmId)
        yield* emit(bot, "cancel", p.dmId)
        assert.equal(dm().at(-1), "Intake 1 cancelled")
        assert.deepEqual([...remote.intakes.values()].map(i => i.state), ["cancelled", "cancelled"])
        assert.deepEqual(bot.failures(), [])
    })))
})

test("in multi mode a plain DM reaches the server of its one open intake and asks which server when there are several", async () => {
    const first = "1300000000000000001", second = "1300000000000000002"
    let open: C.TicketOpenIntake[] = []
    const client = fakeClient((call) => {
        if (call.path === "/service/scope") return { mode: "multi" }
        if (call.path === "/service/installations/list") return { serverIds: [first, second], nextCursor: null }
        if (call.path === "/service/ticket-intakes") return open
        // Every other read fails, so the routed intake reply answers with the generic failure for its server
        return Response.json({ error: "Backend unavailable" }, { status: 503 })
    }, quietSignal)
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, scope: parseDeploymentScope({ NEONFLUX_SERVER_MODE: "multi" }), backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-secret"), client } }))
        const f = bot.fixtures, dmId = f.nextId()
        bot.rest.respond("GET /users/@me/guilds", request => ({ body: request.query.after ? [] : [f.guild({ id: first }), f.guild({ id: second })] }))
        bot.rest.respond(`GET /channels/${dmId}`, { body: { id: dmId, type: 1, recipients: [f.user()], last_message_id: null } })
        const send = bot.rest.respond("POST /channels/:id/messages", request => ({ body: f.message({ channel_id: dmId, author: f.botUser(), content: (request.body as { content: string }).content }) }))
        yield* bot.ready()
        const replies = () => send.requests().map(r => (r.body as { content: string }).content)
        yield* emit(bot, "Synthetic plain message", dmId)
        assert.deepEqual(replies(), [])
        open = [{ serverId: first, intakeNo: 4 }, { serverId: second, intakeNo: 7 }]
        yield* emit(bot, "Synthetic ambiguous answer", dmId)
        assert.equal(replies().at(-1), [
            "You have 2 open ticket intakes, so a plain reply cannot tell which one it answers. Answer with a command, or cancel the intakes you do not need",
            `Intake 4 on server ${first}: !ticket --server ${first} answer 4 <question> "answer"`,
            `Intake 7 on server ${second}: !ticket --server ${second} answer 7 <question> "answer"`].join("\n"))
        // A draft on a server this bot does not serve is left out
        open = [{ serverId: "1300000000000000003", intakeNo: 1 }, { serverId: second, intakeNo: 7 }]
        yield* emit(bot, "Synthetic answer", dmId)
        assert.match(replies().at(-1)!, new RegExp(`^\\[Server ${second}\\] `))
    })).pipe(Effect.provide(TestClock.layer())))
})

test("staff run an escalated ticket's creation, which rechecks the requester's membership instead of theirs", async () => {
    for (const member of [true, false]) {
        const remote = ticketBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-ticket-token" }), p = native(bot), f = bot.fixtures
            const { grant } = yield* seed(remote, bot), requesterId = f.nextId(), joinedAt = "2024-05-01T00:00:00.000000+00:00"
            bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${requesterId}`, { body: f.member({ user: f.user({ id: requesterId }), joined_at: joinedAt, communication_disabled_until: null }) })
            // The requester rejoined since the escalation in the second run, so the ticket is not created
            const overwrites = grant.overwrites!.map(o => o.id === f.ids.user ? { ...o, id: requesterId } : o)
                .sort((a, b) => a.type < b.type ? -1 : a.type > b.type ? 1 : BigInt(a.id) < BigInt(b.id) ? -1 : 1)
            const escalated = { ...grant, overwrites, requesterId, requesterJoinedAt: member ? (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: requesterId })).joinedAt : "2020-01-01T00:00:00.000Z", escalatedFrom: "700" }
            const result = yield* performTicketGrant(remote.store, f.ids.guild, bot.client, escalated)
            assert.equal(result.outcome, member ? "succeeded" : "failed")
            assert.equal(p.create.requests().length, member ? 1 : 0)
        })))
    }
})
