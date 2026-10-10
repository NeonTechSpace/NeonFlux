import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { parseLfgCommand } from "../src/lfg-command.ts"
import { LfgStoreError, type LfgStore } from "../src/lfg-store.ts"
import { startLfgWorker } from "../src/lfg-worker.ts"
import type { VoiceStore } from "../src/voice-store.ts"

const token = Redacted.make("synthetic-lfg-test-token")
const generatorId = "5001", categoryId = "5002", lfgChannelId = "5003", hostId = "6001", otherId = "6002", strangerId = "6003", serverOwnerId = "6009"
const generator: C.VoiceGenerator = { channelId: generatorId, categoryId, template: "{owner}'s room", userLimit: null, region: null, revision: 1, createdAt: 0, updatedAt: 0 }
const settings: C.LfgSettings = { enabled: true, channelId: lfgChannelId, generatorChannelId: generatorId, expiryMinutes: 60, maxSize: 10, memberGroups: 1, serverGroups: 20 }

/** The backend's group rules in memory, enough for the bot's side: hosts and managers, full groups and one room per start */
// startError fails the start with that status, after its writes when committed is true, as a timeout after a commit does. serverGroups replaces the server's open group limit in reads
function lfgMemory(options: { refuseStart?: "room-limit", startError?: { status: number | null, committed: boolean }, serverGroups?: number } = {}) {
    const groups = new Map<number, C.LfgGroup>(), operations: C.LfgOperation[] = [], rooms: C.VoiceRoom[] = []
    let next = 1
    const copy = (group: C.LfgGroup) => ({ ...group, memberIds: [...group.memberIds] })
    const store: LfgStore = {
        query: input => Effect.sync((): C.LfgQueryResult => input.operation.type === "list"
            ? { type: "groups", revision: 1, settings: { ...settings, serverGroups: options.serverGroups ?? settings.serverGroups }, groups: [...groups.values()].map(copy) }
            : { type: "start", group: groups.has(input.operation.groupNo) ? copy(groups.get(input.operation.groupNo)!) : null, generator }),
        manage: input => Effect.suspend(() => {
            const lost = input.operation.type === "start" ? options.startError : undefined
            if (lost && !lost.committed) { operations.push(input.operation); return Effect.fail(new LfgStoreError({ operation: "manage", status: lost.status })) }
            const result = apply(input)
            return lost ? Effect.fail(new LfgStoreError({ operation: "manage", status: lost.status })) : Effect.succeed(result)
        }),
        work: () => Effect.sync(() => { const due = [...groups.values()].map(copy); groups.clear(); return { groups: due } }),
    }
    function apply(input: C.LfgManageRequest): C.LfgManageResult {
        const op = input.operation, who = input.actor.userId
        operations.push(op)
        if (op.type === "settings") return { type: "settings", revision: 2, settings: { ...settings, ...op.patch } }
        if (op.type === "create") {
            const group: C.LfgGroup = { groupNo: next++, hostId: who, activity: op.activity, size: op.size, ...(op.note ? { note: op.note } : {}),
                ...(op.startsInMinutes ? { startsAt: op.startsInMinutes * 60000 } : {}), channelId: lfgChannelId, messageId: null, memberIds: [who], expiresAt: 3600000, createdAt: 0 }
            groups.set(group.groupNo, group)
            return { type: "group", group: copy(group) }
        }
        const group = groups.get(op.groupNo)
        if (!group) return { type: "refused", reason: "missing" }
        if (op.type === "card") group.messageId = op.messageId
        if (op.type === "join") group.memberIds.push(who)
        if (op.type === "leave") group.memberIds = group.memberIds.filter(id => id !== who)
        if (op.type === "cancel") {
            if (group.hostId !== who && !input.managerAuthorized) return { type: "refused", reason: "permission" }
            groups.delete(op.groupNo)
            return { type: "closed", group: copy(group) }
        }
        if (op.type === "start") {
            if (group.hostId !== who && !input.managerAuthorized && group.memberIds.length < group.size) return { type: "refused", reason: "permission" }
            if (options.refuseStart) return { type: "refused", reason: options.refuseStart }
            const room = { channelId: op.channelId, ownerId: group.hostId, generatorChannelId: generatorId, createdAt: 0 }
            rooms.push(room); groups.delete(op.groupNo)
            return { type: "started", group: copy(group), room, created: true }
        }
        return { type: "group", group: copy(group) }
    }
    return { store, groups, operations, rooms }
}
// The rooms the group starts recorded, which the voice runtime reads back
const voiceStore = (rooms: readonly C.VoiceRoom[]): VoiceStore => ({
    query: () => Effect.sync(() => ({ type: "state", generators: [generator], rooms: [...rooms] })),
    manage: () => Effect.die("unused"),
    rooms: input => Effect.succeed({ type: "forgotten", room: input.operation.type === "forget", generator: false }),
})

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
type Embed = { title: string, description: string, fields?: { name: string, value: string }[], footer?: { text: string } }
const segment = (path: string, index: number) => path.split("/")[index]!
function platform(bot: Bot) {
    const f = bot.fixtures
    const botRole = f.role({ position: 20, permissions: Permissions.Administrator.toString() })
    bot.rest.respond("GET /guilds/:id", { body: f.guild({ owner_id: serverOwnerId }) })
    bot.rest.respond("GET /guilds/:id/roles", { body: [f.role({ id: f.ids.guild, permissions: "0" }), botRole] })
    bot.rest.respond("GET /guilds/:id/members/:id", request => {
        const userId = segment(request.path, 4)
        return { body: f.member({ user: userId === f.ids.bot ? f.botUser() : f.user({ id: userId }), roles: userId === f.ids.bot ? [botRole.id] : [] }) }
    })
    bot.rest.respond("GET /channels/:id", request => ({ body: f.channel({ id: segment(request.path, 2), type: segment(request.path, 2) === lfgChannelId ? 0 : 2 }) }))
    const create = bot.rest.respond(`POST /guilds/${f.ids.guild}/channels`, request => ({ body: f.channel({ id: "7001", type: 2, name: (request.body as { name: string }).name, parent_id: categoryId }) }))
    const remove = bot.rest.respond("DELETE /channels/:id", { status: 204 })
    const overwrite = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
    const messages = bot.rest.respond("POST /channels/:id/messages", request => ({ body: f.message({ id: f.nextId(), channel_id: segment(request.path, 2), author: f.botUser() }) }))
    const edits = bot.rest.respond("PATCH /channels/:id/messages/:id", request => ({ body: f.message({ id: segment(request.path, 4), channel_id: segment(request.path, 2), author: f.botUser() }) }))
    const sent = (channelId: string) => messages.requests().filter(request => segment(request.path, 2) === channelId).map(request => request.body as { content: string, allowed_mentions: unknown })
    return { create, remove, overwrite, messages, edits, sent }
}
const say = (bot: Bot, userId: string, content: string) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content, author: bot.fixtures.user({ id: userId }) })).pipe(Effect.andThen(bot.idle()))
function run(memory: ReturnType<typeof lfgMemory>, body: (bot: Bot, native: ReturnType<typeof platform>) => Effect.Effect<void, unknown, Scope.Scope>) {
    const f = createFixtures()
    return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { voice: voiceStore(memory.rooms), lfg: memory.store }))
        const native = platform(bot)
        yield* bot.ready()
        // A fresh voice list lets the voice runtime delete empty rooms
        yield* bot.emit("GUILD_CREATE", bot.fixtures.guildCreate({ voice_states: [] }))
        yield* body(bot, native)
    })).pipe(Effect.provide(TestClock.layer())))
}

test("the group command reads the activity, size, start time and note, and keeps member and manager forms apart", () => {
    assert.deepEqual(parseLfgCommand(["Deep Rock", "4", "in", "2h", "bring", "mics"]), { type: "create", activity: "Deep Rock", size: 4, startsInMinutes: 120, note: "bring mics" })
    assert.deepEqual(parseLfgCommand(["Chess", "2"]), { type: "create", activity: "Chess", size: 2 })
    assert.deepEqual(parseLfgCommand(["join", "#3"]), { type: "join", groupNo: 3 })
    assert.deepEqual(parseLfgCommand(["config", "generator", "none"]), { type: "config-set", patch: { generatorChannelId: null } })
    assert.deepEqual(parseLfgCommand(["config", "hosting", "2"]), { type: "config-set", patch: { memberGroups: 2 } })
    assert.deepEqual([parseLfgCommand(["list"]), parseLfgCommand(["list", "next"])], [{ type: "list", next: false }, { type: "list", next: true }])
    for (const args of [["Chess"], ["Chess", "1"], ["Chess", "26"], ["Chess", "2", "in", "8d"], ["join"], ["config", "size", "30"], ["list", "2"]]) assert.ok("error" in parseLfgCommand(args), args.join(" "))
})

test("!lfg list shows 50 open groups 10 at a time with one join hint, and the settings name the server limit beside the open count", async () => {
    const memory = lfgMemory({ serverGroups: 50 })
    for (let groupNo = 1; groupNo <= 50; groupNo++)
        memory.groups.set(groupNo, { groupNo, hostId, activity: "A".repeat(50), size: 25, channelId: lfgChannelId, messageId: null, memberIds: [hostId], expiresAt: 3600000, createdAt: 0 })
    await run(memory, (bot, native) => Effect.gen(function* () {
        const embed = () => (native.sent(bot.fixtures.ids.channel).at(-1) as unknown as { embeds: Embed[] }).embeds[0]!
        yield* say(bot, otherId, "!lfg list")
        const first = embed(), lines = first.description.split("\n")
        // Ten groups and one hint
        assert.equal(lines.length, 11)
        assert.match(lines[0]!, /^\*\*#1\*\* A{50}, 1 of 25, hosted by <@6001>, open until <t:\d+:f>$/)
        assert.equal(lines[10], "Join one with `!lfg join <group>`")
        assert.deepEqual([first.fields, first.footer], [[{ name: "Next", value: "`!lfg list next`" }], { text: "50 of 50 groups open" }])
        for (let next = 2; next <= 5; next++) yield* say(bot, otherId, "!lfg list next")
        const last = embed()
        assert.ok(last.description.startsWith("**#41** "))
        assert.equal(last.description.split("\n").length, 11)
        assert.equal(last.fields, undefined)
        yield* say(bot, otherId, "!lfg list next")
        assert.equal(native.sent(bot.fixtures.ids.channel).at(-1)!.content, "There is no next page to show. Send !lfg list to start the list again")
        yield* say(bot, serverOwnerId, "!lfg config")
        const config = embed()
        assert.ok(config.fields!.length <= 8)
        assert.deepEqual(config.fields!.at(-1), { name: "Open groups", value: "Up to 50 at once, 50 open now" })
    }))
})

test("a config change answers with one line that names the setting and its new value", async () => {
    const memory = lfgMemory()
    await run(memory, (bot, native) => Effect.gen(function* () {
        for (const content of ["!lfg config off", `!lfg config channel <#${lfgChannelId}>`, "!lfg config expiry 90", "!lfg config hosting 1", "!lfg config generator none"]) yield* say(bot, serverOwnerId, content)
        assert.deepEqual(memory.operations, [{ type: "settings", patch: { enabled: false } }, { type: "settings", patch: { channelId: lfgChannelId } }, { type: "settings", patch: { expiryMinutes: 90 } },
            { type: "settings", patch: { memberGroups: 1 } }, { type: "settings", patch: { generatorChannelId: null } }])
        assert.deepEqual(native.sent(bot.fixtures.ids.channel).map(body => body.content), ["Looking for group is off", `Groups are now posted in <#${lfgChannelId}>`,
            "Groups now stay open for 90 minutes", "Each member can now host up to 1 open group", "No voice generator is chosen for group rooms now, so groups cannot start"])
    }))
})

test("a posted group gets one card in the group channel, which every join keeps current", async () => {
    const memory = lfgMemory()
    await run(memory, (bot, native) => Effect.gen(function* () {
        yield* say(bot, hostId, '!lfg "Deep Rock" 3 in 30m bring mics')
        const [card] = native.sent(lfgChannelId)
        assert.match(card!.content, /^\*\*Group #1: Deep Rock\*\* 1 of 3\nHost: <@6001>\nMembers: <@6001>\nStarts <t:1800:f>\nNote: bring mics\nJoin with `!lfg join 1`/)
        assert.deepEqual(card!.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        const messageId = memory.groups.get(1)!.messageId!
        assert.ok(messageId)
        assert.ok(native.sent(bot.fixtures.ids.channel).some(reply => reply.content === "Group #1 posted in <#5003>. Others join with `!lfg join 1`"))
        yield* say(bot, otherId, "!lfg join 1")
        const [edit] = native.edits.requests()
        assert.equal(edit!.path, `/channels/${lfgChannelId}/messages/${messageId}`)
        assert.match((edit!.body as { content: string }).content, /2 of 3\n.*\nMembers: <@6001>, <@6002>/)
        yield* say(bot, otherId, "!lfg list")
        const [list] = (native.sent(bot.fixtures.ids.channel).at(-1) as unknown as { embeds: Embed[] }).embeds
        assert.equal(list!.title, "Open groups"); assert.match(list!.description, /^\*\*#1\*\* Deep Rock, 2 of 3, hosted by <@6001>, open until <t:\d+:f>\nJoin one with `!lfg join <group>`$/)
        // One page has no Next field, and the count names the server's limit only once it is nearly reached
        assert.deepEqual([list!.fields, list!.footer], [undefined, { text: "1 group open" }])
        // A group that is not full starts only for its host or a manager
        yield* say(bot, strangerId, "!lfg start 1")
        assert.equal(native.create.requests().length, 0)
        assert.ok(native.sent(bot.fixtures.ids.channel).at(-1)!.content.startsWith("Only the host or the server owner or members with Manage Server"))
    }))
})

test("a full group gets a room only it can see, its members are called once and the room waits ten minutes for them", async () => {
    const memory = lfgMemory()
    await run(memory, (bot, native) => Effect.gen(function* () {
        yield* say(bot, hostId, '!lfg "Deep Rock" 2')
        yield* say(bot, otherId, "!lfg join 1")
        assert.deepEqual(native.create.requests()[0]!.body, { type: 2, name: "Deep Rock", parent_id: categoryId, user_limit: 0 })
        assert.deepEqual(memory.rooms, [{ channelId: "7001", ownerId: hostId, generatorChannelId: generatorId, createdAt: 0 }])
        const access = String(Permissions.ViewChannel | Permissions.Connect), view = String(Permissions.ViewChannel)
        assert.deepEqual(native.overwrite.requests().map(request => [segment(request.path, 2), segment(request.path, 4), (request.body as { allow: string }).allow, (request.body as { deny: string }).deny]), [
            ["7001", bot.fixtures.ids.bot, access, "0"], ["7001", hostId, access, "0"], ["7001", otherId, access, "0"], ["7001", bot.fixtures.ids.guild, "0", view]])
        const calls = native.sent(lfgChannelId).filter(message => message.content.includes("is ready"))
        assert.deepEqual(calls.map(message => [message.content, message.allowed_mentions]), [["<@6001> <@6002> Your group for Deep Rock is ready in <#7001>", { parse: [], users: [hostId, otherId], roles: [], replied_user: false }]])
        assert.match((native.edits.requests().at(-1)!.body as { content: string }).content, /Started in <#7001>$/)
        // Generator rooms go after 45 empty seconds, but a group room first waits ten minutes for its members
        yield* TestClock.adjust("9 minutes")
        yield* bot.idle()
        assert.equal(native.remove.requests().length, 0)
        yield* TestClock.adjust("1 minute")
        assert.equal(segment((yield* native.remove.next()).path, 2), "7001")
    }))
})

test("a joined group room follows the usual 45 seconds once its members leave", async () => {
    const memory = lfgMemory()
    await run(memory, (bot, native) => Effect.gen(function* () {
        yield* say(bot, hostId, '!lfg "Deep Rock" 2')
        yield* say(bot, otherId, "!lfg join 1")
        const state = (channelId: string | null) => ({ guild_id: bot.fixtures.ids.guild, channel_id: channelId, user_id: hostId, connection_id: "c1", mute: false, deaf: false, self_mute: false, self_deaf: false, is_mobile: false, suppress: false })
        yield* bot.emit("VOICE_STATE_UPDATE", state("7001"))
        yield* bot.emit("VOICE_STATE_UPDATE", state(null))
        yield* bot.idle()
        yield* TestClock.adjust("45 seconds")
        assert.equal(segment((yield* native.remove.next()).path, 2), "7001")
    }))
})

test("a start the backend refuses removes the new channel and says why", async () => {
    const memory = lfgMemory({ refuseStart: "room-limit" })
    await run(memory, (bot, native) => Effect.gen(function* () {
        yield* say(bot, hostId, '!lfg "Deep Rock" 3')
        yield* say(bot, hostId, "!lfg start 1")
        assert.deepEqual(native.remove.requests().map(request => segment(request.path, 2)), ["7001"])
        assert.equal(native.overwrite.requests().length, 0)
        assert.equal(native.sent(bot.fixtures.ids.channel).at(-1)!.content, "This server has reached its limit of 50 temporary voice rooms. Try again when one is gone")
        assert.equal(memory.groups.size, 1)
    }))
})

test("a start whose answer is lost is never sent again, keeps a room the backend recorded and removes one it did not", async () => {
    const reply = (bot: Bot, native: ReturnType<typeof platform>) => native.sent(bot.fixtures.ids.channel).at(-1)!.content
    // The backend started the group, then the answer timed out
    const committed = lfgMemory({ startError: { status: null, committed: true } })
    await run(committed, (bot, native) => Effect.gen(function* () {
        yield* say(bot, hostId, '!lfg "Deep Rock" 3')
        yield* say(bot, hostId, "!lfg start 1")
        assert.deepEqual([committed.rooms.map(room => room.channelId), committed.groups.size, native.remove.requests().length], [["7001"], 0, 0])
        assert.equal(reply(bot, native), "Group #1 started in <#7001>, but NeonFlux lost the confirmation, so it did not call the group or limit who sees the room. Share the room with your group")
        // The room follows the voice room rules and goes once it stays empty past the group room's first wait
        yield* TestClock.adjust("10 minutes")
        assert.equal(segment((yield* native.remove.next()).path, 2), "7001")
    }))
    assert.equal(committed.operations.filter(op => op.type === "start").length, 1)
    // The answer was lost before anything was written, so the unrecorded channel goes and the group stays open
    const unwritten = lfgMemory({ startError: { status: 503, committed: false } })
    await run(unwritten, (bot, native) => Effect.gen(function* () {
        yield* say(bot, hostId, '!lfg "Deep Rock" 3')
        yield* say(bot, hostId, "!lfg start 1")
        assert.deepEqual([native.remove.requests().map(request => segment(request.path, 2)), unwritten.groups.size], [["7001"], 1])
        assert.equal(reply(bot, native), "NeonFlux could not confirm that group #1 started, and its new room was not recorded, so the room was removed. Check !lfg list and start the group again if it is still open")
    }))
    assert.equal(unwritten.operations.filter(op => op.type === "start").length, 1)
    // A refusal the backend reported removes the channel at once
    const refused = lfgMemory({ startError: { status: 409, committed: false } })
    await run(refused, (bot, native) => Effect.gen(function* () {
        yield* say(bot, hostId, '!lfg "Deep Rock" 3')
        yield* say(bot, hostId, "!lfg start 1")
        assert.deepEqual(native.remove.requests().map(request => segment(request.path, 2)), ["7001"])
        assert.equal(reply(bot, native), "Looking for group settings changed on the website while this command ran. Try again")
    }))
})

test("a card that cannot be posted cancels the group, and cancelling another member's group needs a manager", async () => {
    const memory = lfgMemory()
    await run(memory, (bot, native) => Effect.gen(function* () {
        bot.rest.respond(`POST /channels/${lfgChannelId}/messages`, { status: 403, body: { code: "MISSING_PERMISSIONS", message: "Missing Permissions" } })
        yield* say(bot, hostId, '!lfg "Deep Rock" 3')
        assert.deepEqual(memory.operations.map(op => op.type), ["create", "cancel"])
        assert.equal(memory.groups.size, 0)
        assert.ok(native.sent(bot.fixtures.ids.channel).at(-1)!.content.startsWith("Could not post the group in <#5003>. Grant View Channel and Send Messages to the NeonFlux role"))
    }))
    const second = lfgMemory()
    await run(second, (bot, native) => Effect.gen(function* () {
        yield* say(bot, hostId, '!lfg "Deep Rock" 3')
        yield* say(bot, strangerId, "!lfg cancel 1")
        assert.equal(second.groups.size, 1)
        yield* say(bot, serverOwnerId, "!lfg cancel 1")
        assert.equal(second.groups.size, 0)
        assert.match((native.edits.requests().at(-1)!.body as { content: string }).content, /Cancelled$/)
    }))
})

test("the work dispatcher's wake closes expired groups and marks their cards", async () => {
    const memory = lfgMemory()
    await run(memory, (bot, native) => Effect.gen(function* () {
        yield* say(bot, hostId, '!lfg "Deep Rock" 3')
        // The test bot's client reads partial messages, which the worker never does
        const worker = yield* startLfgWorker(memory.store, bot.fixtures.ids.guild, bot.client as unknown as Client)
        yield* worker.notify()
        yield* native.edits.next()
        assert.match((native.edits.requests()[0]!.body as { content: string }).content, /Closed before it filled$/)
        assert.equal(memory.groups.size, 0)
    }))
})
