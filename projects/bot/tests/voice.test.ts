import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import type * as D from "@neonflux/backend/dashboard-contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { processDashboardConfigurationPass } from "../src/dashboard-configuration.ts"
import { parseDeploymentScope } from "../src/server-scope.ts"
import { VoiceStoreError, type VoiceStore } from "../src/voice-store.ts"
import { fakeClient, mockBackend, quietSignal } from "./backend-fake.ts"

const token = Redacted.make("synthetic-voice-test-token")
const generatorId = "5001", categoryId = "5002", ownerId = "6001", strangerId = "6002", adminId = "6003", serverOwnerId = "6009"
const generator = (fields: Partial<C.VoiceGenerator> = {}): C.VoiceGenerator => ({ channelId: generatorId, categoryId, template: "{owner}'s room", userLimit: 4, region: null, revision: 1, createdAt: 0, updatedAt: 0, ...fields })
const room = (channelId: string, owner = ownerId): C.VoiceRoom => ({ channelId, ownerId: owner, generatorChannelId: generatorId, createdAt: 0 })

/** The backend's voice rules in memory: Owners and Administrators are staff, one room per owner and the documented caps */
function memoryStore(initial: { generators?: C.VoiceGenerator[], rooms?: C.VoiceRoom[] } = {}) {
    const generators = new Map((initial.generators ?? []).map(value => [value.channelId, value])), rooms = new Map((initial.rooms ?? []).map(value => [value.channelId, value]))
    const calls: { method: string, operation: unknown }[] = []
    const staff = (actor: C.ModerationActor) => actor.isOwner || actor.isAdministrator
    const fail = (status: number) => Effect.fail(new VoiceStoreError({ operation: "manage", status }))
    const store: VoiceStore = {
        query: input => Effect.sync((): C.VoiceQueryResult => {
            calls.push({ method: "query", operation: input.operation })
            const op = input.operation
            if (op.type === "state") return { type: "state", generators: [...generators.values()], rooms: [...rooms.values()] }
            const found = op.channelId ? rooms.get(op.channelId) : [...rooms.values()].find(value => value.ownerId === op.actor.userId)
            return { type: "authority", staff: staff(op.actor), room: found ?? null, generators: [...generators.values()], rooms: rooms.size }
        }),
        manage: input => Effect.suspend((): Effect.Effect<C.VoiceManageResult, VoiceStoreError> => {
            calls.push({ method: "manage", operation: input.operation })
            const op = input.operation
            if (!staff(input.actor)) return fail(403)
            if (op.type === "generator-add") {
                if (generators.size >= 10) return fail(429)
                const created = generator({ channelId: op.channelId, categoryId: op.categoryId, template: op.template, userLimit: op.userLimit, region: op.region })
                generators.set(created.channelId, created)
                return Effect.succeed({ type: "generator", generator: created })
            }
            const current = generators.get(op.channelId)
            if (!current) return fail(404)
            if (op.type === "generator-remove") { generators.delete(op.channelId); return Effect.succeed({ type: "removed", channelId: op.channelId }) }
            const { channelName: _name, ...patch } = op.patch, next = { ...current, ...patch, revision: current.revision + 1 }
            generators.set(op.channelId, next)
            return Effect.succeed({ type: "generator", generator: next })
        }),
        rooms: input => Effect.sync((): C.VoiceRoomsResult => {
            calls.push({ method: "rooms", operation: input.operation })
            const op = input.operation
            if (op.type === "forget") return { type: "forgotten", room: rooms.delete(op.channelId), generator: generators.delete(op.channelId) }
            if (!generators.has(op.generatorChannelId)) return { type: "refused", reason: "generator" }
            const existing = [...rooms.values()].find(value => value.ownerId === op.ownerId)
            if (existing) return { type: "refused", reason: "owner", room: existing }
            if (rooms.size >= 50) return { type: "refused", reason: "room-limit" }
            const created = room(op.channelId, op.ownerId)
            rooms.set(created.channelId, created)
            return { type: "created", room: created }
        }),
    }
    return { store, calls, generators, rooms }
}

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const segment = (path: string, index: number) => path.split("/")[index]!
/** Fake Fluxer routes for rooms, members and permission reads. Every created channel is a voice channel */
function platform(bot: Bot) {
    const f = bot.fixtures, created: string[] = []
    const botRole = f.role({ position: 20, permissions: Permissions.Administrator.toString() }), adminRole = f.role({ position: 10, permissions: Permissions.Administrator.toString() })
    bot.rest.respond("GET /guilds/:id", { body: f.guild({ owner_id: serverOwnerId }) })
    const roles = bot.rest.respond("GET /guilds/:id/roles", { body: [f.role({ id: f.ids.guild, permissions: "0" }), botRole, adminRole] })
    const member = bot.rest.respond("GET /guilds/:id/members/:id", request => {
        const userId = segment(request.path, 4)
        return { body: f.member({ user: userId === f.ids.bot ? f.botUser() : f.user({ id: userId, username: `user${userId}` }), roles: userId === f.ids.bot ? [botRole.id] : userId === adminId ? [adminRole.id] : [] }) }
    })
    const read = bot.rest.respond("GET /channels/:id", request => ({ body: f.channel({ id: segment(request.path, 2), type: segment(request.path, 2) === categoryId ? 4 : 2 }) }))
    const create = bot.rest.respond(`POST /guilds/${f.ids.guild}/channels`, request => {
        const body = request.body as { name: string, parent_id?: string | null }, id = f.nextId()
        created.push(id)
        return { body: f.channel({ id, type: 2, name: body.name, parent_id: body.parent_id ?? null }) }
    })
    const edit = bot.rest.respond("PATCH /channels/:id", request => ({ body: f.channel({ id: segment(request.path, 2), type: 2 }) }))
    const move = bot.rest.respond("PATCH /guilds/:id/members/:id", request => ({ body: f.member({ user: f.user({ id: segment(request.path, 4) }) }) }))
    const remove = bot.rest.respond("DELETE /channels/:id", { status: 204 })
    const overwrite = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
    const messages = bot.rest.respond("POST /channels/:id/messages", request => ({ body: f.message({ channel_id: segment(request.path, 2), author: f.botUser() }) }))
    return { created, member, read, create, edit, move, remove, overwrite, messages, roles, botRole, adminRole }
}
const voice = (bot: Bot, userId: string, channelId: string | null, connectionId: string) => ({ guild_id: bot.fixtures.ids.guild, channel_id: channelId, user_id: userId, connection_id: connectionId,
    mute: false, deaf: false, self_mute: false, self_deaf: false, is_mobile: false, suppress: false })
const snapshot = (bot: Bot, states: ReturnType<typeof voice>[] = []) => bot.emit("GUILD_CREATE", bot.fixtures.guildCreate({ voice_states: states }))
const say = (bot: Bot, userId: string, content: string) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content, author: bot.fixtures.user({ id: userId }) }))
const replies = (native: ReturnType<typeof platform>) => native.messages.requests().map(request => (request.body as { content: string }).content)
const deletes = (native: ReturnType<typeof platform>) => native.remove.requests().map(request => segment(request.path, 2))
function run(initial: Parameters<typeof memoryStore>[0], body: (bot: Bot, native: ReturnType<typeof platform>, memory: ReturnType<typeof memoryStore>) => Effect.Effect<void, unknown>) {
    const f = createFixtures(), memory = memoryStore(initial)
    return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { voice: memory.store }))
        const native = platform(bot)
        yield* bot.ready()
        yield* body(bot, native, memory)
    })).pipe(Effect.provide(TestClock.layer())))
}

test("joining a generator creates the owner's room, sets a fixed region after creation and moves them in", async () => {
    await run({ generators: [generator({ region: "eu-west" })] }, (bot, native, memory) => Effect.gen(function* () {
        yield* snapshot(bot)
        yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, ownerId, generatorId, "c1"))
        const moved = yield* native.move.next()
        yield* bot.idle()
        const [roomId] = native.created
        assert.equal(native.created.length, 1)
        assert.deepEqual(native.create.requests()[0]!.body, { type: 2, name: `user${ownerId}'s room`, parent_id: categoryId, user_limit: 4 })
        // Fluxer ignores rtc_region on creation, so the region follows as an edit of the new room
        assert.deepEqual(native.edit.requests().map(request => [segment(request.path, 2), request.body]), [[roomId, { rtc_region: "eu-west" }]])
        assert.deepEqual(memory.rooms.get(roomId!), room(roomId!))
        assert.equal(moved.path, `/guilds/${bot.fixtures.ids.guild}/members/${ownerId}`)
        assert.deepEqual(moved.body, { channel_id: roomId, connection_id: "c1" })
    }))
})

test("a voice state that carries the member names the room without reading the member again", async () => {
    await run({ generators: [generator()] }, (bot, native) => Effect.gen(function* () {
        yield* snapshot(bot)
        const reads = native.member.requests().length
        const member = bot.fixtures.member({ user: bot.fixtures.user({ id: ownerId, username: "unused" }), nick: "Nova" })
        yield* bot.emit("VOICE_STATE_UPDATE", { ...voice(bot, ownerId, generatorId, "c1"), member })
        yield* native.move.next()
        yield* bot.idle()
        assert.equal((native.create.requests()[0]!.body as { name: string }).name, "Nova's room")
        assert.equal(native.member.requests().length, reads)
    }))
})

test("a member owns one room at a time and a restart recovers ownership from the backend", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native, memory) => Effect.gen(function* () {
        yield* snapshot(bot, [voice(bot, strangerId, "7001", "c0")])
        // The recorded owner rejoins the generator and is moved back into the room loaded at startup
        yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, ownerId, generatorId, "c1"))
        assert.deepEqual((yield* native.move.next()).body, { channel_id: "7001", connection_id: "c1" })
        yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, ownerId, "7001", "c2"))
        yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, ownerId, null, "c2"))
        yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, ownerId, generatorId, "c3"))
        assert.deepEqual((yield* native.move.next()).body, { channel_id: "7001", connection_id: "c3" })
        yield* bot.idle()
        assert.equal(native.create.requests().length, 0)
        assert.equal(memory.calls.filter(call => call.method === "rooms").length, 0)
        // Ownership survives the restart for owner controls as well
        yield* say(bot, ownerId, "!voice rename Study hall")
        yield* bot.idle()
        assert.deepEqual(native.edit.requests().map(request => [segment(request.path, 2), request.body]), [["7001", { name: "Study hall" }]])
        assert.deepEqual(replies(native), ["Room renamed to Study hall"])
    }))
})

test("an empty room is deleted only after the full grace period and its record is cleared", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native, memory) => Effect.gen(function* () {
        yield* snapshot(bot)
        yield* TestClock.adjust("44999 millis")
        yield* bot.idle()
        assert.deepEqual(deletes(native), [])
        yield* TestClock.adjust("1 millis")
        assert.equal(segment((yield* native.remove.next()).path, 2), "7001")
        yield* bot.idle()
        assert.equal(memory.rooms.has("7001"), false)
        assert.deepEqual(memory.calls.filter(call => call.method === "rooms").map(call => call.operation), [{ type: "forget", channelId: "7001" }])
        // Generators are never deleted automatically
        assert.deepEqual(deletes(native), ["7001"])
    }))
})

test("a member who joins during the grace period keeps the room", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native) => Effect.gen(function* () {
        yield* snapshot(bot)
        yield* TestClock.adjust("30 seconds")
        yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, strangerId, "7001", "c1"))
        yield* bot.idle()
        yield* TestClock.adjust("5 minutes")
        yield* bot.idle()
        assert.deepEqual(deletes(native), [])
        // Leaving starts a fresh grace period
        yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, strangerId, null, "c1"))
        yield* bot.idle()
        yield* TestClock.adjust("45 seconds")
        assert.equal(segment((yield* native.remove.next()).path, 2), "7001")
    }))
})

test("the final recheck cancels a delete when someone joined while the room was being read", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native) => Effect.gen(function* () {
        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        const read = bot.rest.respond("GET /channels/7001", async () => { await gate; return { body: bot.fixtures.channel({ id: "7001", type: 2 }) } })
        yield* snapshot(bot)
        yield* TestClock.adjust("45 seconds")
        yield* read.next()
        yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, strangerId, "7001", "c1"))
        // Voice events run in order, so the next event's member read proves the join was tracked before the read completes
        yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, adminId, generatorId, "c2"))
        yield* native.member.next()
        release()
        yield* bot.idle()
        assert.deepEqual(deletes(native).filter(id => id === "7001"), [])
    }))
})

test("after a reconnect nothing is deleted until a fresh full voice list arrives", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native) => Effect.gen(function* () {
        yield* snapshot(bot)
        yield* bot.disconnect()
        yield* TestClock.adjust("2 minutes")
        yield* bot.idle()
        assert.equal(bot.client.state, "Connected")
        assert.equal(bot.counters().reconnects, 1)
        yield* TestClock.adjust("5 minutes")
        yield* bot.idle()
        assert.deepEqual(deletes(native), [])
        assert.equal(native.read.requests().length, 0)
        yield* snapshot(bot)
        yield* TestClock.adjust("45 seconds")
        assert.equal(segment((yield* native.remove.next()).path, 2), "7001")
    }))
})

test("a community outage pauses deletion until its voice snapshot returns", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native) => Effect.gen(function* () {
        yield* snapshot(bot)
        yield* bot.emit("GUILD_DELETE", { id: bot.fixtures.ids.guild, unavailable: true })
        yield* bot.idle()
        yield* TestClock.adjust("5 minutes")
        yield* bot.idle()
        assert.deepEqual(deletes(native), [])
        yield* snapshot(bot)
        yield* TestClock.adjust("45 seconds")
        assert.equal(segment((yield* native.remove.next()).path, 2), "7001")
    }))
})

test("in multi mode an unavailable server pauses its room deletion until its voice snapshot returns", async () => {
    const serverId = "1300000000000000001", forgotten: string[] = []
    const client = fakeClient((call) => {
        const { path } = call, body = call.body as { operation?: { type: string, channelId: string } }
        if (path === "/service/scope") return { mode: "multi" }
        if (path === "/service/installations/list") return { serverIds: [serverId], nextCursor: null }
        if (path === "/voice/query") return { type: "state", generators: [generator()], rooms: [room("7001")] }
        if (path === "/voice/rooms") { forgotten.push(`${body.operation!.type} ${body.operation!.channelId}`); return { type: "forgotten", room: true, generator: false } }
        // Other features' startup reads fail, which must not stop voice rooms
        return Response.json({ error: "Backend unavailable" }, { status: 503 })
    }, quietSignal)
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, scope: parseDeploymentScope({ NEONFLUX_SERVER_MODE: "multi" }), backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-secret"), client } }))
        bot.rest.respond("GET /users/@me/guilds", request => ({ body: request.query.after ? [] : [bot.fixtures.guild({ id: serverId })] }))
        bot.rest.respond("GET /channels/:id", request => ({ body: bot.fixtures.channel({ id: segment(request.path, 2), guild_id: serverId, type: 2 }) }))
        const remove = bot.rest.respond("DELETE /channels/:id", { status: 204 })
        yield* bot.ready()
        const available = bot.fixtures.guildCreate({ guild: { id: serverId }, channels: [], voice_states: [] })
        yield* bot.emit("GUILD_CREATE", available)
        yield* bot.idle()
        yield* bot.emit("GUILD_DELETE", { id: serverId, unavailable: true })
        yield* bot.idle()
        yield* TestClock.adjust("5 minutes")
        yield* bot.idle()
        assert.equal(remove.requests().length, 0)
        yield* bot.emit("GUILD_CREATE", available)
        yield* bot.idle()
        yield* TestClock.adjust("45 seconds")
        assert.equal(segment((yield* remove.next()).path, 2), "7001")
        yield* bot.idle()
        assert.deepEqual(forgotten, ["forget 7001"])
    })).pipe(Effect.provide(TestClock.layer())))
})

test("an externally deleted room or generator clears its record and is never deleted again", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native, memory) => Effect.gen(function* () {
        yield* snapshot(bot)
        yield* bot.emit("CHANNEL_DELETE", bot.fixtures.channel({ id: "7001", type: 2 }))
        yield* bot.emit("CHANNEL_DELETE", bot.fixtures.channel({ id: generatorId, type: 2 }))
        yield* bot.idle()
        assert.equal(memory.rooms.size, 0); assert.equal(memory.generators.size, 0)
        assert.deepEqual(memory.calls.filter(call => call.method === "rooms").map(call => call.operation), [{ type: "forget", channelId: "7001" }, { type: "forget", channelId: generatorId }])
        yield* TestClock.adjust("5 minutes")
        yield* bot.idle()
        assert.deepEqual(deletes(native), [])
        yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, ownerId, generatorId, "c1"))
        yield* bot.idle()
        assert.equal(native.create.requests().length, 0)
    }))
})

test("owners control their room, staff can control any room and other members are refused", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native) => Effect.gen(function* () {
        yield* snapshot(bot, [voice(bot, ownerId, "7001", "c1")])
        for (const content of ["!voice limit 3", "!voice hide", `!voice allow <@${strangerId}>`, `!voice block <@${strangerId}>`, `!voice block <@${ownerId}>`, "!voice show"]) {
            yield* say(bot, ownerId, content)
            yield* bot.idle()
        }
        yield* say(bot, strangerId, "!voice rename <#7001> Taken")
        yield* say(bot, strangerId, "!voice limit 2")
        yield* say(bot, adminId, "!voice limit <#7001> 5")
        yield* say(bot, strangerId, "!voice generator list")
        yield* bot.idle()
        const guild = bot.fixtures.ids.guild, view = String(Permissions.ViewChannel), access = String(Permissions.ViewChannel | Permissions.Connect)
        assert.deepEqual(native.edit.requests().map(request => request.body), [{ user_limit: 3 }, { user_limit: 5 }])
        assert.deepEqual(native.overwrite.requests().map(request => [segment(request.path, 4), (request.body as { allow: string }).allow, (request.body as { deny: string }).deny]), [
            [bot.fixtures.ids.bot, access, "0"], [ownerId, access, "0"], [guild, "0", view], [strangerId, access, "0"], [strangerId, "0", access], [guild, "0", "0"],
        ])
        assert.deepEqual(replies(native), ["Room limit set to 3 members", "Room hidden from everyone without explicit access", `<@${strangerId}> can see and join this room`,
            `<@${strangerId}> can no longer see or join this room. Members already inside stay connected`, "The room owner and NeonFlux cannot be blocked", "Room visible again",
            "Only the room owner or the server owner, an Administrator or a moderation staff role with Manage Channels can change this room",
            "You do not own a temporary voice room. Join a generator to create one", "Room limit set to 5 members",
            "Only the server owner, an Administrator or a moderation staff role with Manage Channels can manage voice generators"])
    }))
})

test("a room change the bot lacks a permission for names the permission to grant in that room", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native) => Effect.gen(function* () {
        const f = bot.fixtures
        yield* snapshot(bot, [voice(bot, ownerId, "7001", "c1")])
        native.roles.remove()
        bot.rest.respond("GET /guilds/:id/roles", { body: [f.role({ id: f.ids.guild, permissions: "0" }),
            f.role({ id: native.botRole.id, position: 20, permissions: String(Permissions.ViewChannel | Permissions.Connect | Permissions.ManageChannels) }), native.adminRole] })
        yield* say(bot, ownerId, "!voice hide")
        yield* bot.idle()
        assert.deepEqual(replies(native), ["Grant Manage Roles to the NeonFlux role and allow it in <#7001>"])
        assert.equal(native.overwrite.requests().length, 0)
    }))
})

test("staff create, configure and remove generators, capped at ten per server", async () => {
    await run({ generators: Array.from({ length: 9 }, (_, index) => generator({ channelId: String(5100 + index) })) }, (bot, native, memory) => Effect.gen(function* () {
        yield* say(bot, adminId, `!voice generator add "Join to create" ${categoryId}`)
        yield* bot.idle()
        const [created] = native.created
        assert.deepEqual(native.create.requests()[0]!.body, { type: 2, name: "Join to create", parent_id: categoryId })
        assert.deepEqual(memory.generators.get(created!), generator({ channelId: created!, template: "{owner}'s room", userLimit: null, region: null }))
        yield* say(bot, adminId, `!voice generator add "One more"`)
        yield* say(bot, adminId, `!voice generator set <#${created}> region us-east`)
        yield* say(bot, adminId, `!voice generator set <#${created}> name "Gaming"`)
        yield* bot.idle()
        assert.equal(native.create.requests().length, 1)
        assert.equal(memory.generators.get(created!)?.region, "us-east")
        assert.deepEqual(native.edit.requests().map(request => [segment(request.path, 2), request.body]), [[created, { name: "Gaming" }]])
        yield* say(bot, adminId, `!voice generator remove <#${created}>`)
        yield* bot.idle()
        assert.equal(memory.generators.has(created!), false)
        assert.deepEqual(deletes(native), [])
        const text = replies(native)
        assert.equal(text[1], "A server can have at most 10 generators")
        assert.match(text.at(-1)!, /^Generator removed/)
    }))
})

test("dashboard generator requests do their native work first, undo a refused add and refresh the running bot", async t => {
    const executions: Record<string, unknown>[] = [], failures: unknown[] = []
    let jobs: D.DashboardConfigurationReadyJob[] = [], outcome: D.DashboardConfigurationJob["state"] = "applied"
    mockBackend(t, (call) => {
        const { path } = call, body = call.body as Record<string, unknown>
        if (path === "/dashboard-configuration/ready") return { jobs }
        if (path === "/dashboard-configuration/fail") { failures.push(body); return null }
        assert.equal(path, "/dashboard-configuration/execute")
        executions.push(body)
        const { native: _native, ...stored } = jobs[0]!
        return { job: { ...stored, state: outcome } }
    })
    await run({ generators: [generator()] }, (bot, native, memory) => Effect.gen(function* () {
        const f = bot.fixtures, config = { token, serverId: f.ids.guild, backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-backend-secret") } }
        const pass = () => processDashboardConfigurationPass(config, bot.client as unknown as Parameters<typeof processDashboardConfigurationPass>[1])
        bot.rest.respond("GET /users/@me", { body: f.botUser({ system: false }) })
        bot.rest.respond(`GET /users/${adminId}`, { body: f.user({ id: adminId, bot: false, system: false }) })
        const job = (operation: D.DashboardConfigurationOperationMap["voice"], target: D.DashboardConfigurationNativeTarget): D.DashboardConfigurationReadyJob =>
            ({ family: "voice", operation, native: target, id: "synthetic_voice_job", actorId: adminId, expectedConfigRevision: 0, state: "queued", createdAt: 0, expiresAt: 120000 })
        const add = { type: "generator-add" as const, channelName: "Lobby", categoryId, template: "{owner} hangout", userLimit: 3, region: null }
        jobs = [job(add, { channelIds: [categoryId] })]
        memory.generators.set("5100", generator({ channelId: "5100" }))
        yield* pass()
        const [created] = native.created
        assert.deepEqual(native.create.requests()[0]!.body, { type: 2, name: "Lobby", parent_id: categoryId })
        assert.deepEqual(executions[0]!.context, { originServerId: f.ids.guild, channelId: created })
        assert.deepEqual(deletes(native), [])
        // The running runtime reloads generators the dashboard changed, so joins to them create rooms at once
        yield* snapshot(bot)
        yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, ownerId, "5100", "c1"))
        yield* native.move.next()
        outcome = "conflict"
        yield* pass()
        assert.deepEqual(deletes(native), [native.created[2]])
        outcome = "applied"
        jobs = [job({ type: "generator-set", channelId: generatorId, expectedRevision: 1, patch: { channelName: "Gaming", userLimit: 8 } }, { channelIds: [generatorId] })]
        yield* pass()
        assert.deepEqual(native.edit.requests().map(request => [segment(request.path, 2), request.body]), [[generatorId, { name: "Gaming" }]])
        assert.equal(executions.length, 3); assert.deepEqual(failures, [])
        assert.equal("context" in executions[2]!, false)
    }))
})

test("a full server refuses new rooms with a notice in the generator chat", async () => {
    await run({ generators: [generator()], rooms: Array.from({ length: 50 }, (_, index) => room(String(8000 + index), String(9000 + index))) }, (bot, native, memory) => Effect.gen(function* () {
        yield* snapshot(bot, Array.from({ length: 50 }, (_, index) => voice(bot, String(9000 + index), String(8000 + index), `o${index}`)))
        yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, ownerId, generatorId, "c1"))
        const notice = yield* native.messages.next()
        yield* bot.idle()
        assert.equal(notice.path, `/channels/${generatorId}/messages`)
        assert.equal((notice.body as { content: string }).content, `<@${ownerId}> This server has reached its limit of 50 temporary voice rooms`)
        assert.equal(native.create.requests().length, 0); assert.equal(memory.rooms.size, 50)
    }))
})

test("a member Fluxer refuses to move, such as the server owner, is told where their room is", async () => {
    await run({ generators: [generator()] }, (bot, native) => Effect.gen(function* () {
        // Fluxer answers a move of the owner or a member ranked at or above the bot with Missing Permissions
        bot.rest.respond("PATCH /guilds/:id/members/:id", { status: 403, body: { code: "MISSING_PERMISSIONS", message: "Missing Permissions" } })
        yield* snapshot(bot)
        yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, ownerId, generatorId, "c1"))
        const notice = yield* native.messages.next()
        yield* bot.idle()
        const [roomId] = native.created
        assert.equal(notice.path, `/channels/${generatorId}/messages`)
        assert.equal((notice.body as { content: string }).content, `<@${ownerId}> I could not move you into your room <#${roomId}>. Fluxer does not let bots move the server owner or members ranked at or above the bot. Join it directly. An empty room is removed after 45 seconds`)
        assert.equal(native.created.length, 1)
    }))
})
