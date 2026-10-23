import assert from "node:assert/strict"
import test from "node:test"
import type { ModerationActor } from "@neonflux/contracts/shared"
import type {
    VoiceGenerator,
    VoiceManageResult,
    VoiceQueryResult,
    VoiceRoom,
    VoiceRoomsResult,
} from "@neonflux/contracts/voice"
import type {
    DashboardConfigurationJob,
    DashboardConfigurationNativeTarget,
    DashboardConfigurationOperationMap,
    DashboardConfigurationReadyJob,
} from "@neonflux/contracts/dashboard"
import {
    ChannelType,
    Permissions,
    type Client,
    type VoiceState,
    type VoiceStateSnapshot,
} from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Exit, Fiber, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { processDashboardConfigurationPass } from "../src/dashboard-configuration.ts"
import { parseServerScope } from "@neonflux/contracts/service"
import { VoiceStoreError, type VoiceStore } from "../src/voice-store.ts"
import { createVoiceRuntime, renderRoomName } from "../src/voice-worker.ts"
import { claimed, fakeClient, mockBackend, quietSignal } from "./backend-fake.ts"

const token = Redacted.make("synthetic-voice-test-token")
const generatorId = "5001",
    categoryId = "5002",
    ownerId = "6001",
    strangerId = "6002",
    adminId = "6003",
    serverOwnerId = "6009"
const generator = (fields: Partial<VoiceGenerator> = {}): VoiceGenerator => ({
    channelId: generatorId,
    categoryId,
    template: "{owner}'s room",
    userLimit: 4,
    region: null,
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    ...fields,
})
const room = (channelId: string, owner = ownerId): VoiceRoom => ({
    channelId,
    ownerId: owner,
    generatorChannelId: generatorId,
    createdAt: 0,
})

/** The backend's voice rules in memory: Owners and Administrators are staff, one room per owner and the documented caps */
function memoryStore(initial: { generators?: VoiceGenerator[]; rooms?: VoiceRoom[] } = {}) {
    const generators = new Map((initial.generators ?? []).map((value) => [value.channelId, value])),
        rooms = new Map((initial.rooms ?? []).map((value) => [value.channelId, value]))
    const calls: { method: string; operation: unknown }[] = []
    const staff = (actor: ModerationActor) => actor.isOwner || actor.isAdministrator
    const fail = (status: number) => Effect.fail(new VoiceStoreError({ operation: "manage", status }))
    const store: VoiceStore = {
        query: (input) =>
            Effect.sync((): VoiceQueryResult => {
                calls.push({ method: "query", operation: input.operation })
                const op = input.operation
                if (op.type === "state")
                    return { type: "state", generators: [...generators.values()], rooms: [...rooms.values()] }
                const found = op.channelId
                    ? rooms.get(op.channelId)
                    : [...rooms.values()].find((value) => value.ownerId === op.actor.userId)
                return {
                    type: "authority",
                    staff: staff(op.actor),
                    room: found ?? null,
                    generators: [...generators.values()],
                    rooms: rooms.size,
                }
            }),
        manage: (input) =>
            Effect.suspend((): Effect.Effect<VoiceManageResult, VoiceStoreError> => {
                calls.push({ method: "manage", operation: input.operation })
                const op = input.operation
                if (!staff(input.actor)) return fail(403)
                if (op.type === "generator-add") {
                    if (generators.size >= 10) return fail(429)
                    const created = generator({
                        channelId: op.channelId,
                        categoryId: op.categoryId,
                        template: op.template,
                        userLimit: op.userLimit,
                        region: op.region,
                    })
                    generators.set(created.channelId, created)
                    return Effect.succeed({ type: "generator", generator: created })
                }
                const current = generators.get(op.channelId)
                if (!current) return fail(404)
                if (op.type === "generator-remove") {
                    generators.delete(op.channelId)
                    return Effect.succeed({ type: "removed", channelId: op.channelId })
                }
                const { channelName: _name, ...patch } = op.patch,
                    next = { ...current, ...patch, revision: current.revision + 1 }
                generators.set(op.channelId, next)
                return Effect.succeed({ type: "generator", generator: next })
            }),
        rooms: (input) =>
            Effect.sync((): VoiceRoomsResult => {
                calls.push({ method: "rooms", operation: input.operation })
                const op = input.operation
                if (op.type === "forget")
                    return {
                        type: "forgotten",
                        room: rooms.delete(op.channelId),
                        generator: generators.delete(op.channelId),
                    }
                if (op.type === "transfer") {
                    const current = rooms.get(op.channelId)
                    if (current?.ownerId !== op.expectedOwnerId) return { type: "not-transferred", reason: "changed" }
                    if ([...rooms.values()].some((value) => value.ownerId === op.ownerId))
                        return { type: "not-transferred", reason: "owner" }
                    const moved = { ...current, ownerId: op.ownerId }
                    rooms.set(op.channelId, moved)
                    return { type: "transferred", room: moved }
                }
                if (!generators.has(op.generatorChannelId)) return { type: "refused", reason: "generator" }
                const existing = [...rooms.values()].find((value) => value.ownerId === op.ownerId)
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
    const f = bot.fixtures,
        created: string[] = []
    const botRole = f.role({ position: 20, permissions: Permissions.Administrator.toString() }),
        adminRole = f.role({ position: 10, permissions: Permissions.Administrator.toString() })
    bot.rest.respond("GET /guilds/:id", { body: f.guild({ owner_id: serverOwnerId }) })
    const roles = bot.rest.respond("GET /guilds/:id/roles", {
        body: [f.role({ id: f.ids.guild, permissions: "0" }), botRole, adminRole],
    })
    const member = bot.rest.respond("GET /guilds/:id/members/:id", (request) => {
        const userId = segment(request.path, 4)
        return {
            body: f.member({
                user: userId === f.ids.bot ? f.botUser() : f.user({ id: userId, username: `user${userId}` }),
                roles: userId === f.ids.bot ? [botRole.id] : userId === adminId ? [adminRole.id] : [],
            }),
        }
    })
    const read = bot.rest.respond("GET /channels/:id", (request) => ({
        body: f.channel({ id: segment(request.path, 2), type: segment(request.path, 2) === categoryId ? 4 : 2 }),
    }))
    const create = bot.rest.respond(`POST /guilds/${f.ids.guild}/channels`, (request) => {
        const body = request.body as { name: string; parent_id?: string | null },
            id = f.nextId()
        created.push(id)
        return { body: f.channel({ id, type: 2, name: body.name, parent_id: body.parent_id ?? null }) }
    })
    const edit = bot.rest.respond("PATCH /channels/:id", (request) => ({
        body: f.channel({ id: segment(request.path, 2), type: 2 }),
    }))
    const move = bot.rest.respond("PATCH /guilds/:id/members/:id", (request) => ({
        body: f.member({ user: f.user({ id: segment(request.path, 4) }) }),
    }))
    const remove = bot.rest.respond("DELETE /channels/:id", { status: 204 })
    const overwrite = bot.rest.respond("PUT /channels/:id/permissions/:id", { status: 204 })
    const messages = bot.rest.respond("POST /channels/:id/messages", (request) => ({
        body: f.message({ channel_id: segment(request.path, 2), author: f.botUser() }),
    }))
    return { created, member, read, create, edit, move, remove, overwrite, messages, roles, botRole, adminRole }
}
const voice = (bot: Bot, userId: string, channelId: string | null, connectionId: string) => ({
    guild_id: bot.fixtures.ids.guild,
    channel_id: channelId,
    user_id: userId,
    connection_id: connectionId,
    mute: false,
    deaf: false,
    self_mute: false,
    self_deaf: false,
    is_mobile: false,
    suppress: false,
})
const snapshot = (bot: Bot, states: ReturnType<typeof voice>[] = []) =>
    bot.emit("GUILD_CREATE", bot.fixtures.guildCreate({ voice_states: states }))
const say = (bot: Bot, userId: string, content: string) =>
    bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content, author: bot.fixtures.user({ id: userId }) }))
const replies = (native: ReturnType<typeof platform>) =>
    native.messages.requests().map((request) => (request.body as { content: string }).content)
const deletes = (native: ReturnType<typeof platform>) =>
    native.remove.requests().map((request) => segment(request.path, 2))
function run(
    initial: Parameters<typeof memoryStore>[0],
    body: (
        bot: Bot,
        native: ReturnType<typeof platform>,
        memory: ReturnType<typeof memoryStore>,
    ) => Effect.Effect<void, unknown>,
) {
    const f = createFixtures(),
        memory = memoryStore(initial)
    return Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(
                    createBotOptions({ token, serverId: f.ids.guild }, { voice: memory.store }),
                )
                const native = platform(bot)
                yield* bot.ready()
                yield* body(bot, native, memory)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
}

test("joining a generator creates the owner's room, sets a fixed region after creation and moves them in", async () => {
    await run({ generators: [generator({ region: "eu-west" })] }, (bot, native, memory) =>
        Effect.gen(function* () {
            yield* snapshot(bot)
            yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, ownerId, generatorId, "c1"))
            const moved = yield* native.move.next()
            yield* bot.idle()
            const [roomId] = native.created
            assert.equal(native.created.length, 1)
            assert.deepEqual(native.create.requests()[0]!.body, {
                type: 2,
                name: `user${ownerId}'s room`,
                parent_id: categoryId,
                user_limit: 4,
            })
            // Fluxer ignores rtc_region on creation, so the region follows as an edit of the new room
            assert.deepEqual(
                native.edit.requests().map((request) => [segment(request.path, 2), request.body]),
                [[roomId, { rtc_region: "eu-west" }]],
            )
            assert.deepEqual(memory.rooms.get(roomId!), room(roomId!))
            assert.equal(moved.path, `/guilds/${bot.fixtures.ids.guild}/members/${ownerId}`)
            assert.deepEqual(moved.body, { channel_id: roomId, connection_id: "c1" })
        }),
    )
})

test("a voice state that carries the member names the room without reading the member again", async () => {
    await run({ generators: [generator()] }, (bot, native) =>
        Effect.gen(function* () {
            yield* snapshot(bot)
            const reads = native.member.requests().length
            const member = bot.fixtures.member({
                user: bot.fixtures.user({ id: ownerId, username: "unused" }),
                nick: "Nova",
            })
            yield* bot.emit("VOICE_STATE_UPDATE", { ...voice(bot, ownerId, generatorId, "c1"), member })
            yield* native.move.next()
            yield* bot.idle()
            assert.equal((native.create.requests()[0]!.body as { name: string }).name, "Nova's room")
            assert.equal(native.member.requests().length, reads)
        }),
    )
})

test("a member owns one room at a time and a restart recovers ownership from the backend", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native, memory) =>
        Effect.gen(function* () {
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
            assert.equal(memory.calls.filter((call) => call.method === "rooms").length, 0)
            // Ownership survives the restart for owner controls as well
            yield* say(bot, ownerId, "!voice rename Study hall")
            yield* bot.idle()
            assert.deepEqual(
                native.edit.requests().map((request) => [segment(request.path, 2), request.body]),
                [["7001", { name: "Study hall" }]],
            )
            assert.deepEqual(replies(native), ["Room renamed to Study hall"])
        }),
    )
})

test("an empty room is deleted only after the full grace period and its record is cleared", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native, memory) =>
        Effect.gen(function* () {
            yield* snapshot(bot)
            yield* TestClock.adjust("44999 millis")
            yield* bot.idle()
            assert.deepEqual(deletes(native), [])
            yield* TestClock.adjust("1 millis")
            assert.equal(segment((yield* native.remove.next()).path, 2), "7001")
            yield* bot.idle()
            assert.equal(memory.rooms.has("7001"), false)
            assert.deepEqual(
                memory.calls.filter((call) => call.method === "rooms").map((call) => call.operation),
                [{ type: "forget", channelId: "7001" }],
            )
            // Generators are never deleted automatically
            assert.deepEqual(deletes(native), ["7001"])
        }),
    )
})

test("a member who joins during the grace period keeps the room", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native) =>
        Effect.gen(function* () {
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
        }),
    )
})

test("the final recheck cancels a delete when someone joined while the room was being read", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native) =>
        Effect.gen(function* () {
            let release!: () => void
            const gate = new Promise<void>((resolve) => {
                release = resolve
            })
            const read = bot.rest.respond("GET /channels/7001", async () => {
                await gate
                return { body: bot.fixtures.channel({ id: "7001", type: 2 }) }
            })
            yield* snapshot(bot)
            yield* TestClock.adjust("45 seconds")
            yield* read.next()
            yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, strangerId, "7001", "c1"))
            // Voice events run in order, so the next event's member read proves the join was tracked before the read completes
            yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, adminId, generatorId, "c2"))
            yield* native.member.next()
            release()
            yield* bot.idle()
            assert.deepEqual(
                deletes(native).filter((id) => id === "7001"),
                [],
            )
        }),
    )
})

test("after a resume the empty room is still deleted without a new voice list", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native) =>
        Effect.gen(function* () {
            yield* snapshot(bot)
            yield* bot.disconnect()
            yield* TestClock.adjust("2 minutes")
            yield* bot.idle()
            assert.equal(bot.counters().reconnects, 1)
            assert.equal(bot.client.shards[0]?.sessionEpoch, 1)
            // The deletion is queued by now, so a regression that stops it fails the wait instead of hanging the test
            assert.equal(segment((yield* native.remove.next({ timeoutMs: 5000 })).path, 2), "7001")
        }),
    )
})

/** The runtime beside a fake client, to drive what the test gateway cannot: a shard that stays down and a new session */
function withFakeClient(
    body: (
        runtime: ReturnType<typeof createVoiceRuntime>,
        shards: { shardId: number; state: string; sessionEpoch: number }[],
        deleted: string[],
    ) => Effect.Effect<void, unknown, never>,
    read: () => Effect.Effect<unknown> = () => Effect.void,
) {
    const shards = [
            { shardId: 0, state: "Connected", sessionEpoch: 1 },
            { shardId: 1, state: "Connected", sessionEpoch: 1 },
        ],
        deleted: string[] = []
    const channel = { id: "7001", guildId: "1300000000000000001", type: ChannelType.Voice }
    const client = {
        shards,
        shardIdForGuild: () => 0,
        channels: {
            fetch: () => Effect.as(read(), channel),
            delete: (id: string) => Effect.sync(() => void deleted.push(id)),
        },
    } as unknown as Client
    const runtime = createVoiceRuntime(memoryStore({ rooms: [room("7001")] }).store, "1300000000000000001")
    const snapshot = { guildId: "1300000000000000001", voiceStates: [] } as unknown as VoiceStateSnapshot
    return Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                yield* runtime.start(client)
                yield* runtime.snapshot(snapshot, 1, 1)
                yield* body(runtime, shards, deleted)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
}

test("a deletion that falls due while the server's shard is down waits for the connection and then runs", async () => {
    await withFakeClient((_, shards, deleted) =>
        Effect.gen(function* () {
            shards[0]!.state = "Recovering"
            yield* TestClock.adjust("45 seconds")
            yield* TestClock.adjust("2 minutes")
            assert.deepEqual(deleted, [])
            shards[0]!.state = "Connected"
            yield* TestClock.adjust("5 seconds")
            assert.deepEqual(deleted, ["7001"])
        }),
    )
})

for (const joined of [false, true])
    test(`a shard that goes down while the room is read blocks the deletion and ${joined ? "a join seen after the resume keeps the room" : "the room goes once it is back"}`, async () => {
        const entered = Deferred.makeUnsafe<void>(),
            release = Deferred.makeUnsafe<void>()
        let reads = 0
        await withFakeClient(
            (runtime, shards, deleted) =>
                Effect.gen(function* () {
                    yield* TestClock.adjust("45 seconds")
                    yield* Deferred.await(entered)
                    shards[0]!.state = "Recovering"
                    yield* Deferred.succeed(release, undefined)
                    yield* TestClock.adjust("2 minutes")
                    assert.deepEqual(deleted, [])
                    if (joined)
                        yield* runtime.voiceState(
                            {
                                guildId: "1300000000000000001",
                                userId: ownerId,
                                channelId: "7001",
                                connectionId: "c1",
                            } as unknown as VoiceState,
                            3,
                        )
                    shards[0]!.state = "Connected"
                    yield* TestClock.adjust("5 seconds")
                    assert.deepEqual(deleted, joined ? [] : ["7001"])
                }),
            () =>
                ++reads > 1
                    ? Effect.void
                    : Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
        )
    })

test("a new session of the server's shard pauses deletion until its voice list returns", async () => {
    await withFakeClient((runtime, shards, deleted) =>
        Effect.gen(function* () {
            shards[0]!.sessionEpoch = 2
            yield* TestClock.adjust("5 minutes")
            assert.deepEqual(deleted, [])
            yield* runtime.snapshot(
                { guildId: "1300000000000000001", voiceStates: [] } as unknown as VoiceStateSnapshot,
                2,
                2,
            )
            yield* TestClock.adjust("45 seconds")
            assert.deepEqual(deleted, ["7001"])
        }),
    )
})

test("a voice change received before the applied snapshot is ignored, and a leave received after an older snapshot stays", async () => {
    const state = (connectionId: string, channelId: string | null) =>
        ({ guildId: "1300000000000000001", userId: ownerId, channelId, connectionId }) as unknown as VoiceState
    await withFakeClient((runtime, _, deleted) =>
        Effect.gen(function* () {
            // The leave was received after this snapshot, which still lists the connection in the room
            yield* runtime.voiceState(state("c2", null), 7)
            yield* runtime.snapshot(
                {
                    guildId: "1300000000000000001",
                    voiceStates: [state("c2", "7001")],
                } as unknown as VoiceStateSnapshot,
                1,
                6,
            )
            // The join was received before that snapshot, so the snapshot's list already accounts for it
            yield* runtime.voiceState(state("c1", "7001"), 5)
            yield* TestClock.adjust("45 seconds")
            assert.deepEqual(deleted, ["7001"])
        }),
    )
})

test("a leave forgotten past the limit rejects an older snapshot instead of bringing its connection back", async () => {
    const state = (connectionId: string, channelId: string | null) =>
        ({ guildId: "1300000000000000001", userId: ownerId, channelId, connectionId }) as unknown as VoiceState
    await withFakeClient((runtime, _, deleted) =>
        Effect.gen(function* () {
            const lists = (connectionId: string) =>
                ({
                    guildId: "1300000000000000001",
                    voiceStates: [state(connectionId, "7001")],
                }) as unknown as VoiceStateSnapshot
            yield* runtime.snapshot(lists("c0"), 1, 2)
            // The connection leaves, and a thousand more leaves push its record out while an older snapshot still waits
            yield* runtime.voiceState(state("c0", null), 4)
            for (let leave = 1; leave <= 1000; leave++) yield* runtime.voiceState(state(`x${leave}`, null), 4 + leave)
            yield* runtime.snapshot(lists("c0"), 1, 3)
            yield* TestClock.adjust("45 seconds")
            assert.deepEqual(deleted, ["7001"])
        }),
    )
})

test(
    "held voice snapshots of many starting servers are not dropped for the size of their GUILD_CREATE frames",
    { timeout: 120000 },
    async () => {
        const servers = Array.from({ length: 60 }, (_, index) => String(1300000000000000010n + BigInt(index)))
        const target = servers.at(-1)!
        const starting = gate()
        await receiptWorld(
            servers,
            target,
            ({ path }) => (path === "/sticky/list" ? starting.opened : undefined),
            ({ bot, remove, finished }) =>
                Effect.gen(function* () {
                    // About 6 MB of frames wait for their servers to start, more than the SDK's default 4 MiB queue limit. The frames
                    // arrive one at a time, as from the gateway, so each server's guildCreate handler finishes before the next frame
                    for (const id of servers) {
                        const created = finished("guildCreate")
                        yield* bot.emit("GUILD_CREATE", {
                            ...bot.fixtures.guildCreate({ guild: { id }, channels: [], voice_states: [] }),
                            padding: "x".repeat(100000),
                        })
                        yield* Effect.promise(() => created)
                    }
                    assert.equal(bot.counters().eventsDropped.overflow, 0)
                    starting.open()
                    yield* bot.idle({ timeoutMs: 60000 })
                    yield* TestClock.adjust("5 minutes")
                    yield* bot.idle({ timeoutMs: 60000 })
                    assert.equal(bot.counters().eventsDropped.overflow, 0)
                    assert.equal(remove.requests().length, 1)
                }),
        )
    },
)

test(
    "a server whose GUILD_CREATE frame is over 4 MiB keeps its guild and voice snapshot events",
    { timeout: 120000 },
    async () => {
        const target = "1300000000000000001"
        const starting = gate()
        await receiptWorld(
            [target],
            target,
            ({ path }) => (path === "/sticky/list" ? starting.opened : undefined),
            ({ bot, remove, finished }) =>
                Effect.gen(function* () {
                    const created = finished("guildCreate")
                    // The SDK counts each event of a frame at the whole frame, so each is bigger than its default queue limit
                    yield* bot.emit("GUILD_CREATE", {
                        ...bot.fixtures.guildCreate({ guild: { id: target }, channels: [], voice_states: [] }),
                        padding: "x".repeat(5000000),
                    })
                    assert.equal(bot.counters().eventsDropped.overflow, 0)
                    yield* Effect.promise(() => created)
                    starting.open()
                    yield* bot.idle({ timeoutMs: 60000 })
                    yield* TestClock.adjust("5 minutes")
                    yield* bot.idle({ timeoutMs: 60000 })
                    assert.equal(remove.requests().length, 1)
                }),
        )
    },
)

const refusal = () => Response.json({ error: "Backend unavailable" }, { status: 503 })

test(
    "a server joined while the registration queue is busy keeps its first voice snapshot, held until the server starts",
    { timeout: 60000 },
    async () => {
        const target = "1300000000000000001",
            other = "1300000000000000010"
        const otherJoining = gate(),
            otherJoin = gate()
        await receiptWorld(
            [],
            target,
            async ({ path, body }) => {
                if (path === "/service/installations/join" && (body as { serverId: string }).serverId === other) {
                    otherJoining.open()
                    await otherJoin.opened
                }
            },
            ({ bot, remove, create }) =>
                Effect.gen(function* () {
                    // Another server's registration holds the registry queue, and the target joins behind it
                    yield* create(other)
                    yield* Effect.promise(() => otherJoining.opened)
                    yield* create(target)
                    otherJoin.open()
                    yield* bot.idle({ timeoutMs: 30000 })
                    yield* TestClock.adjust("5 minutes")
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.equal(remove.requests().length, 1)
                }),
        )
    },
)

test(
    "a join that ends without a served runtime releases its held events, which are ignored",
    { timeout: 60000 },
    async () => {
        const target = "1300000000000000001",
            started = "1300000000000000010",
            other = "1300000000000000020"
        const otherJoining = gate(),
            otherJoin = gate(),
            queried = gate(),
            query = gate()
        await receiptWorld(
            [started],
            target,
            async ({ path, serverId, body }) => {
                if (path === "/voice/query" && serverId === started) {
                    queried.open()
                    await query.opened
                }
                if (path === "/service/installations/join") {
                    const joined = (body as { serverId: string }).serverId
                    if (joined === other) {
                        otherJoining.open()
                        await otherJoin.opened
                    }
                    if (joined === target) return refusal()
                }
            },
            ({ bot, remove, completed, create }) =>
                Effect.gen(function* () {
                    // Another registration holds the queue, so the target's refused join has not started and only its
                    // mark holds the snapshot
                    yield* create(other)
                    yield* Effect.promise(() => otherJoining.opened)
                    yield* create(target)
                    // The started server's snapshot, which arrived later, is being handled but cannot finish yet
                    yield* create(started)
                    yield* Effect.promise(() => queried.opened)
                    assert.equal(completed("voiceStateSnapshot"), 0)
                    query.open()
                    otherJoin.open()
                    // The refused registration releases the target's snapshot, and the router ignores a server that is
                    // not served
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.equal(completed("voiceStateSnapshot"), 3)
                    yield* TestClock.adjust("5 minutes")
                    assert.equal(remove.requests().length, 0)
                    assert.equal(bot.failures().length, 0)
                }),
        )
    },
)

test(
    "a join received again for a started server holds nothing, even while the registry queue is busy",
    { timeout: 60000 },
    async () => {
        const started = "1300000000000000010",
            other = "1300000000000000020"
        const otherJoining = gate(),
            otherJoin = gate()
        await receiptWorld(
            [started],
            started,
            async ({ path, body }) => {
                if (path === "/service/installations/join" && (body as { serverId: string }).serverId === other) {
                    otherJoining.open()
                    await otherJoin.opened
                }
            },
            ({ finished, create }) =>
                Effect.gen(function* () {
                    yield* create(other)
                    yield* Effect.promise(() => otherJoining.opened)
                    // The started server's guildCreate waits for the queue, but its snapshot is handled now. The other
                    // server's is held
                    const handled = finished("voiceStateSnapshot")
                    yield* create(started)
                    yield* Effect.promise(() => handled)
                    otherJoin.open()
                }),
        )
    },
)

test(
    "a join that the SDK drops from a full queue is still applied, and holds its server's events until it is",
    { timeout: 120000 },
    async () => {
        const other = "1300000000000000010"
        const otherJoining = gate(),
            otherJoin = gate(),
            handlersHeld = gate()
        // Beyond the 8 running handlers and the 2,000 queued ones, the SDK drops the oldest waiting joins
        const servers = Array.from({ length: 2100 }, (_, index) => String(1300000000000010000n + BigInt(index)))
        const joined = new Set<string>()
        await receiptWorld(
            [],
            other,
            async ({ path, body }) => {
                if (path !== "/service/installations/join") return
                const id = (body as { serverId: string }).serverId
                if (id === other) {
                    otherJoining.open()
                    await otherJoin.opened
                    return
                }
                // The other servers' registrations are refused, which ends their joins without starting a runtime
                joined.add(id)
                return refusal()
            },
            ({ bot, options, create }) =>
                Effect.gen(function* () {
                    // The registry queue stays busy with another join, so every later join waits for it
                    yield* create(other)
                    yield* Effect.promise(() => otherJoining.opened)
                    for (const id of servers) yield* create(id)
                    assert.equal(bot.counters().eventsDroppedByEvent.guildCreate! > 0, true)
                    const ready = (
                        options.events.voiceStateUpdate as unknown as {
                            partitionReady: (key: string) => Effect.Effect<void>
                        }
                    ).partitionReady
                    const held = yield* ready(servers.at(-1)!).pipe(Effect.forkChild({ startImmediately: true }))
                    assert.equal(held.pollUnsafe(), undefined)
                    otherJoin.open()
                    yield* Fiber.join(held)
                    // A counted join is decided only after its backend call, so once no server holds its events, every
                    // join has reached the backend, the dropped ones too. One that was never started is not held
                    yield* Effect.forEach(servers, (id) => ready(id), { discard: true })
                    assert.equal(joined.size, servers.length)
                    handlersHeld.open()
                }),
            (options) => {
                const events = options.events as unknown as Record<
                    string,
                    { handler: (context: never) => Effect.Effect<unknown, unknown> }
                >
                const join = events.guildCreate!.handler
                // The joining servers' handlers stay busy, so the SDK's queue fills. The other server's handler runs
                events.guildCreate!.handler = (context) =>
                    ((context as { event: { id: string } }).event.id === other
                        ? join(context)
                        : Effect.promise(() => handlersHeld.opened).pipe(Effect.andThen(join(context)))) as never
            },
        )
    },
)

test(
    "a server joined again while the SDK kept its key ready from before its removal still gets its first snapshot",
    { timeout: 60000 },
    async () => {
        const target = "1300000000000000001",
            other = "1300000000000000010"
        const queried = gate(),
            query = gate(),
            otherJoining = gate(),
            otherJoin = gate(),
            secondStarted = gate()
        let first = true,
            starts = 0
        await receiptWorld(
            [target],
            target,
            async ({ path, serverId, body }) => {
                if (path === "/voice/query" && serverId === target && first) {
                    first = false
                    queried.open()
                    await query.opened
                }
                if (path === "/service/installations/join" && (body as { serverId: string }).serverId === other) {
                    otherJoining.open()
                    await otherJoin.opened
                }
            },
            ({ bot, remove, finished, completed, create }) =>
                Effect.gen(function* () {
                    // The registered server's snapshot runs, so the SDK keeps its key ready, while the server is
                    // removed and announced again
                    yield* create(target)
                    yield* Effect.promise(() => queried.opened)
                    const left = finished("guildDelete")
                    yield* bot.emit("GUILD_DELETE", { id: target })
                    yield* Effect.promise(() => left)
                    yield* create(other)
                    yield* Effect.promise(() => otherJoining.opened)
                    yield* create(target)
                    query.open()
                    // The new snapshot has passed the SDK's readiness and waits in the router for the join, which is
                    // still blocked
                    yield* Effect.promise(() => secondStarted.opened)
                    assert.equal(completed("voiceStateSnapshot"), 1)
                    otherJoin.open()
                    yield* bot.idle({ timeoutMs: 30000 })
                    yield* TestClock.adjust("5 minutes")
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.equal(remove.requests().length, 1)
                }),
            (options) => {
                const events = options.events as unknown as Record<
                    string,
                    { handler: (context: never) => Effect.Effect<unknown, unknown> }
                >
                const original = events.voiceStateSnapshot!.handler
                events.voiceStateSnapshot!.handler = (context) =>
                    Effect.sync(() => {
                        if (++starts === 2) secondStarted.open()
                    }).pipe(Effect.andThen(original(context)))
            },
        )
    },
)

test(
    "a server announced again during a failing registration keeps the retry's first snapshot",
    { timeout: 60000 },
    async () => {
        const target = "1300000000000000001",
            other = "1300000000000000010"
        const firstJoining = gate(),
            firstJoin = gate(),
            otherJoining = gate(),
            otherJoin = gate()
        let attempts = 0
        await receiptWorld(
            [],
            target,
            async ({ path, body }) => {
                if (path !== "/service/installations/join") return
                const joined = (body as { serverId: string }).serverId
                if (joined === target && ++attempts === 1) {
                    firstJoining.open()
                    await firstJoin.opened
                    return refusal()
                }
                if (joined === other) {
                    otherJoining.open()
                    await otherJoin.opened
                }
            },
            ({ bot, remove, completed, create, finished, options }) =>
                Effect.gen(function* () {
                    // The first registration is pending when another server and then the same server are announced
                    yield* create(target)
                    yield* Effect.promise(() => firstJoining.opened)
                    yield* create(other)
                    yield* create(target)
                    // The first registration fails and the other server's holds the queue, so the retry has not
                    // registered the server yet
                    const firstFinished = finished("guildCreate")
                    firstJoin.open()
                    yield* Effect.promise(() => firstFinished)
                    yield* Effect.promise(() => otherJoining.opened)
                    // The first handler has settled its join. A fresh readiness call must still wait for the admitted
                    // retry
                    const held = yield* (
                        options.events.voiceStateSnapshot as unknown as {
                            partitionReady: (key: string) => Effect.Effect<void>
                        }
                    )
                        .partitionReady(target)
                        .pipe(Effect.forkChild({ startImmediately: true }))
                    assert.equal(held.pollUnsafe(), undefined)
                    assert.equal(attempts, 1)
                    assert.equal(completed("voiceStateSnapshot"), 0)
                    otherJoin.open()
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.equal(attempts, 2)
                    yield* TestClock.adjust("5 minutes")
                    assert.equal(remove.requests().length, 1)
                    assert.equal(bot.failures().length, 0)
                }),
        )
    },
)

test(
    "unavailable notices of servers still joining wait without a handler slot, and a running server's is delivered",
    { timeout: 60000 },
    async () => {
        const running = "1300000000000000010",
            other = "1300000000000000020"
        const otherJoining = gate(),
            otherJoin = gate()
        const joining = Array.from({ length: 8 }, (_, index) => String(1300000000000000100n + BigInt(index)))
        await receiptWorld(
            [running],
            running,
            async ({ path, body }) => {
                if (path === "/service/installations/join" && (body as { serverId: string }).serverId === other) {
                    otherJoining.open()
                    await otherJoin.opened
                }
            },
            ({ bot, completed, finished, options, create }) =>
                Effect.gen(function* () {
                    // A registration holds the queue, so eight announced servers have a pending join and no runtime
                    yield* create(other)
                    yield* Effect.promise(() => otherJoining.opened)
                    for (const id of joining) yield* create(id)
                    for (const id of joining) yield* bot.emit("GUILD_DELETE", { id, unavailable: true })
                    // The running server's notice is delivered, and the eight others are still held in the SDK's queue
                    const delivered = finished("guildDelete")
                    yield* bot.emit("GUILD_DELETE", { id: running, unavailable: true })
                    yield* Effect.promise(() => delivered)
                    assert.equal(completed("guildDelete"), 1)
                    const hook = (
                        options.events.guildDelete as unknown as {
                            partitionReady: (key: string) => Effect.Effect<void>
                        }
                    ).partitionReady
                    for (const id of joining) {
                        const held = yield* hook(id).pipe(Effect.forkChild({ startImmediately: true }))
                        assert.equal(held.pollUnsafe(), undefined)
                    }
                    // Once the registration ends they are delivered
                    otherJoin.open()
                    while (completed("guildDelete") < 9) {
                        const next = finished("guildDelete")
                        yield* Effect.promise(() => next)
                    }
                }),
        )
    },
)

test(
    "an outage notice for a server still joining reaches its runtime, so the older snapshot cannot sync it",
    { timeout: 60000 },
    async () => {
        const target = "1300000000000000001",
            other = "1300000000000000010"
        const otherJoining = gate(),
            otherJoin = gate()
        await receiptWorld(
            [],
            target,
            async ({ path, body }) => {
                if (path === "/service/installations/join" && (body as { serverId: string }).serverId === other) {
                    otherJoining.open()
                    await otherJoin.opened
                }
            },
            ({ bot, remove, options, create }) =>
                Effect.gen(function* () {
                    // The target joins behind a busy registration, and becomes unavailable before its join is decided
                    yield* create(other)
                    yield* Effect.promise(() => otherJoining.opened)
                    yield* create(target)
                    yield* bot.emit("GUILD_DELETE", { id: target, unavailable: true })
                    // The notice is held, not ignored: It reaches the runtime once the join is decided
                    const held = yield* (
                        options.events.guildDelete as unknown as {
                            partitionReady: (key: string) => Effect.Effect<void>
                        }
                    )
                        .partitionReady(target)
                        .pipe(Effect.forkChild({ startImmediately: true }))
                    assert.equal(held.pollUnsafe(), undefined)
                    otherJoin.open()
                    yield* bot.idle({ timeoutMs: 30000 })
                    yield* TestClock.adjust("5 minutes")
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.equal(remove.requests().length, 0)
                }),
        )
    },
)

test("the removal of a server whose join is still queued runs after that join", { timeout: 60000 }, async () => {
    const target = "1300000000000000001",
        blocker = "1300000000000000010"
    const blocking = gate(),
        release = gate(),
        left = gate()
    const calls: string[] = []
    await receiptWorld(
        [],
        target,
        async ({ path, body }) => {
            const id = (body as { serverId?: string } | undefined)?.serverId
            if ((path === "/service/installations/leave" || path === "/service/installations/join") && id === target)
                calls.push(path.split("/").at(-1)!)
            if (path === "/service/installations/leave" && id === target) left.open()
            if (path === "/service/installations/join" && id === blocker) {
                blocking.open()
                await release.opened
            }
        },
        ({ bot, create }) =>
            Effect.gen(function* () {
                yield* create(blocker)
                yield* Effect.promise(() => blocking.opened)
                yield* create(target)
                yield* bot.emit("GUILD_DELETE", { id: target })
                release.open()
                yield* Effect.promise(() => left.opened)
                assert.deepEqual(calls, ["join", "leave"])
                assert.equal(bot.failures().length, 0)
            }),
    )
})

test(
    "an outage notice of a server added again while its removal still runs reaches the new runtime",
    { timeout: 60000 },
    async () => {
        const target = "1300000000000000001",
            other = "1300000000000000010"
        const leaving = gate(),
            leave = gate(),
            noticeStarted = gate()
        let deleteStarts = 0
        await receiptWorld(
            [target],
            target,
            async ({ path, body }) => {
                const id = (body as { serverId?: string } | undefined)?.serverId
                if (path === "/service/installations/leave" && id === target) {
                    leaving.open()
                    await leave.opened
                }
                // The other server's registration holds the queue until the outage notice has started
                if (path === "/service/installations/join" && id === other) await noticeStarted.opened
            },
            ({ bot, remove, options, create }) =>
                Effect.gen(function* () {
                    yield* bot.idle({ timeoutMs: 30000 })
                    // The removal runs and its backend call is held, so the server's guildDelete key stays busy and
                    // ready
                    yield* bot.emit("GUILD_DELETE", { id: target })
                    yield* Effect.promise(() => leaving.opened)
                    // Another server joins first, so its registration takes the queue after the removal, and the server
                    // is added again
                    yield* create(other)
                    yield* create(target)
                    yield* bot.emit("GUILD_DELETE", { id: target, unavailable: true })
                    leave.open()
                    // Once the notice has started, the re-add is still counted: A fresh hook for its snapshot still
                    // waits
                    yield* Effect.promise(() => noticeStarted.opened)
                    const held = yield* (
                        options.events.voiceStateSnapshot as unknown as {
                            partitionReady: (key: string) => Effect.Effect<void>
                        }
                    )
                        .partitionReady(target)
                        .pipe(Effect.forkChild({ startImmediately: true }))
                    assert.equal(held.pollUnsafe(), undefined)
                    yield* bot.idle({ timeoutMs: 30000 })
                    yield* TestClock.adjust("5 minutes")
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.equal(remove.requests().length, 0)
                }),
            (options) => {
                const events = options.events as unknown as Record<
                    string,
                    { handler: (context: never) => Effect.Effect<unknown, unknown> }
                >
                const original = events.guildDelete!.handler
                events.guildDelete!.handler = (context) =>
                    Effect.sync(() => {
                        if (++deleteStarts === 2) noticeStarted.open()
                    }).pipe(Effect.andThen(original(context)))
            },
        )
    },
)

test(
    "an outage notice received after a failing registration's retry waits for both, and the retry stays unsynced",
    { timeout: 60000 },
    async () => {
        const target = "1300000000000000001",
            other = "1300000000000000010"
        const firstJoining = gate(),
            firstJoin = gate(),
            otherJoining = gate(),
            otherJoin = gate()
        let attempts = 0
        await receiptWorld(
            [target],
            target,
            async ({ path, body }) => {
                const id = (body as { serverId?: string } | undefined)?.serverId
                if (path === "/service/installations/join" && id === target && ++attempts === 1) {
                    firstJoining.open()
                    await firstJoin.opened
                    return refusal()
                }
                if (path === "/service/installations/join" && id === other) {
                    otherJoining.open()
                    await otherJoin.opened
                }
            },
            ({ bot, remove, options, create }) =>
                Effect.gen(function* () {
                    yield* bot.idle({ timeoutMs: 30000 })
                    // The removal retires the runtime, and another server's registration holds the queue while the
                    // server is added twice, the second time because the first registration may fail
                    yield* bot.emit("GUILD_DELETE", { id: target })
                    yield* create(other)
                    yield* Effect.promise(() => otherJoining.opened)
                    yield* create(target)
                    yield* create(target)
                    // The notice is received after both announcements
                    yield* bot.emit("GUILD_DELETE", { id: target, unavailable: true })
                    const held = yield* (
                        options.events.guildDelete as unknown as {
                            partitionReady: (key: string) => Effect.Effect<void>
                        }
                    )
                        .partitionReady(target)
                        .pipe(Effect.forkChild({ startImmediately: true }))
                    assert.equal(held.pollUnsafe(), undefined)
                    otherJoin.open()
                    yield* Effect.promise(() => firstJoining.opened)
                    // The first registration is still undecided, and the notice still waits for it
                    assert.equal(held.pollUnsafe(), undefined)
                    firstJoin.open()
                    yield* Fiber.join(held)
                    assert.equal(attempts, 2)
                    yield* bot.idle({ timeoutMs: 30000 })
                    yield* TestClock.adjust("5 minutes")
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.equal(remove.requests().length, 0)
                    // A snapshot received after the outage syncs the retry and cleanup resumes
                    yield* create(target)
                    yield* bot.idle({ timeoutMs: 30000 })
                    yield* TestClock.adjust("5 minutes")
                    assert.equal(remove.requests().length, 1)
                }),
        )
    },
)

test(
    "a second removal received after a rejoin waits for the rejoin, so the backend sees them in receipt order",
    { timeout: 60000 },
    async () => {
        const target = "1300000000000000001"
        const leaving = gate(),
            leave = gate(),
            done = gate()
        const calls: string[] = []
        let leaves = 0
        await receiptWorld(
            [target],
            target,
            async ({ path, body }) => {
                const id = (body as { serverId?: string } | undefined)?.serverId
                if (id !== target || !(path.endsWith("/join") || path.endsWith("/leave"))) return
                calls.push(path.split("/").at(-1)!)
                if (path.endsWith("/leave") && ++leaves === 1) {
                    leaving.open()
                    await leave.opened
                }
                if (calls.length === 3) done.open()
            },
            ({ bot, create }) =>
                Effect.gen(function* () {
                    yield* bot.idle({ timeoutMs: 30000 })
                    // The first removal is running and holds the registry queue when the server is added again and
                    // removed again
                    yield* bot.emit("GUILD_DELETE", { id: target })
                    yield* Effect.promise(() => leaving.opened)
                    yield* create(target)
                    yield* bot.emit("GUILD_DELETE", { id: target })
                    leave.open()
                    yield* Effect.promise(() => done.opened)
                    assert.deepEqual(calls, ["leave", "join", "leave"])
                }),
        )
    },
)

test("a notice received before a server's join does not wait for it, and one received after does", async () => {
    const target = "1300000000000000001"
    const client = fakeClient(async ({ path, body }) => {
        if (path === "/service/scope") return { mode: "multi" }
        if (path === "/service/installations/list") return { serverIds: [], nextCursor: null }
        if (path === "/service/installations/join") return refusal()
        if (path === "/service/installations/leave")
            return { serverId: (body as { serverId: string }).serverId, active: false }
        return Response.json({ error: "Backend unavailable" }, { status: 503 })
    }, quietSignal)
    const options = createBotOptions({
        token,
        scope: parseServerScope({ NEONFLUX_SERVER_MODE: "multi" }),
        backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-secret"), client },
    })
    const events = options.events as unknown as Record<
        string,
        { partition: (event: object) => string; handler: (context: never) => Effect.Effect<unknown, unknown> }
    >
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(options)
                bot.rest.respond("GET /users/@me/guilds", () => ({ body: [] }))
                yield* bot.ready()
                const outage = (event: object) =>
                    events
                        .guildDelete!.handler({ event, client: bot.client } as never)
                        .pipe(Effect.forkChild({ startImmediately: true }))
                // The notice is received first, then the join, then another notice, in the order the SDK would number
                // them
                const before = { id: target, unavailable: true },
                    join = { id: target },
                    after = { id: target, unavailable: true }
                events.guildDelete!.partition(before)
                events.guildCreate!.partition(join)
                events.guildDelete!.partition(after)
                const older = yield* outage(before)
                assert.notEqual(older.pollUnsafe(), undefined)
                const newer = yield* outage(after)
                assert.equal(newer.pollUnsafe(), undefined)
                yield* Fiber.join(newer)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test(
    "an event without a server ID in a joining server's channel waits for the join and is then delivered",
    { timeout: 60000 },
    async () => {
        const target = "1300000000000000001",
            other = "1300000000000000010"
        const otherJoining = gate(),
            otherJoin = gate()
        let admits = 0
        await receiptWorld(
            [],
            target,
            async ({ path, body, serverId }) => {
                if (path === "/metadata-logs/admit" && serverId === target) admits++
                if (path === "/service/installations/join" && (body as { serverId: string }).serverId === other) {
                    otherJoining.open()
                    await otherJoin.opened
                }
            },
            ({ bot, options, create }) =>
                Effect.gen(function* () {
                    // Another registration holds the queue, and the target's join waits behind it
                    yield* create(other)
                    yield* Effect.promise(() => otherJoining.opened)
                    yield* create(target)
                    // A deletion received after the join names only its channel, which a synchronous channel read
                    // places in the target
                    const events = options.events as unknown as Record<
                        string,
                        {
                            partition: (event: object) => string
                            handler: (context: never) => Effect.Effect<unknown, unknown>
                        }
                    >
                    const event = { id: "9002", channelId: "7001" }
                    events.messageDelete!.partition(event)
                    const client = Object.create(bot.client, {
                        rest: {
                            value: {
                                request: () =>
                                    Effect.succeed({ status: 200, body: { id: "7001", guild_id: target, type: 0 } }),
                            },
                        },
                    })
                    const waiting = yield* events
                        .messageDelete!.handler({ event, client } as never)
                        .pipe(Effect.forkChild({ startImmediately: true }))
                    assert.equal(waiting.pollUnsafe(), undefined)
                    assert.equal(admits, 0)
                    otherJoin.open()
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.equal(Exit.isSuccess(yield* Fiber.await(waiting)), true)
                    // The deletion reached the target's runtime, which asks the backend whether to log it
                    assert.equal(admits > 0, true)
                    assert.equal(bot.failures().length, 0)
                }),
        )
    },
)

test(
    "a server whose startup registration failed keeps its first snapshot for the retry that a later join makes",
    { timeout: 60000 },
    async () => {
        const target = "1300000000000000001",
            other = "1300000000000000010"
        const firstJoining = gate(),
            firstJoin = gate(),
            otherJoining = gate(),
            otherJoin = gate()
        let attempts = 0
        await receiptWorld(
            [],
            target,
            async ({ path, body }) => {
                if (path !== "/service/installations/join") return
                const joined = (body as { serverId: string }).serverId
                if (joined === target && ++attempts === 1) {
                    firstJoining.open()
                    await firstJoin.opened
                    return refusal()
                }
                if (joined === other) {
                    otherJoining.open()
                    await otherJoin.opened
                }
            },
            ({ bot, remove, completed, options, create }) =>
                Effect.gen(function* () {
                    // The server was added while the bot was offline, so startup registers it and that registration is
                    // pending
                    yield* Effect.promise(() => firstJoining.opened)
                    yield* create(other)
                    // The startup announcement of the server arrives while its registration is pending
                    yield* create(target)
                    firstJoin.open()
                    yield* Effect.promise(() => otherJoining.opened)
                    const held = yield* (
                        options.events.voiceStateSnapshot as unknown as {
                            partitionReady: (key: string) => Effect.Effect<void>
                        }
                    )
                        .partitionReady(target)
                        .pipe(Effect.forkChild({ startImmediately: true }))
                    assert.equal(held.pollUnsafe(), undefined)
                    assert.equal(completed("voiceStateSnapshot"), 0)
                    otherJoin.open()
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.equal(attempts, 2)
                    yield* TestClock.adjust("5 minutes")
                    assert.equal(remove.requests().length, 1)
                }),
            undefined,
            [target],
        )
    },
)

test("every refused join received after a removal is tried once, after the removal", async () => {
    const target = "1300000000000000001"
    const calls: string[] = [],
        tried = gate()
    const client = fakeClient(async ({ path, body }) => {
        if (path === "/service/scope") return { mode: "multi" }
        if (path === "/service/installations/list") return { serverIds: [target], nextCursor: null }
        if (path === "/service/installations/join" || path === "/service/installations/leave") {
            calls.push(path.split("/").at(-1)!)
            if (calls.length === 3) tried.open()
            if (path.endsWith("/join")) return refusal()
            return { serverId: (body as { serverId: string }).serverId, active: false }
        }
        return Response.json({ error: "Backend unavailable" }, { status: 503 })
    }, quietSignal)
    const options = createBotOptions({
        token,
        scope: parseServerScope({ NEONFLUX_SERVER_MODE: "multi" }),
        backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-secret"), client },
    })
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(options)
                bot.rest.respond("GET /users/@me/guilds", (request) => ({
                    body: request.query.after ? [] : [bot.fixtures.guild({ id: target })],
                }))
                yield* bot.ready()
                yield* bot.idle({ timeoutMs: 30000 })
                // The server is served, so the removal is counted, and so are both announcements after it
                yield* bot.emit("GUILD_DELETE", { id: target })
                for (let announced = 0; announced < 2; announced++)
                    yield* bot.emit(
                        "GUILD_CREATE",
                        bot.fixtures.guildCreate({ guild: { id: target }, channels: [], voice_states: [] }),
                    )
                yield* Effect.promise(() => tried.opened)
                assert.deepEqual(calls, ["leave", "join", "join"])
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test(
    "the joins still waiting when the bot stops no longer hold their servers' events",
    { timeout: 60000 },
    async () => {
        const blocker = "1300000000000000010",
            target = "1300000000000000900"
        const blocking = gate()
        const client = fakeClient(async (call) => {
            if (call.path === "/service/scope") return { mode: "multi" }
            if (call.path === "/service/installations/list") return { serverIds: [], nextCursor: null }
            if (call.path === "/service/installations/join") {
                if ((call.body as { serverId: string }).serverId === blocker) {
                    blocking.open()
                    return new Promise(() => {})
                }
                return { serverId: (call.body as { serverId: string }).serverId, active: true }
            }
            return Response.json({ error: "Backend unavailable" }, { status: 503 })
        }, quietSignal)
        const options = createBotOptions({
            token,
            scope: parseServerScope({ NEONFLUX_SERVER_MODE: "multi" }),
            backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-secret"), client },
        })
        const readiness = (
            options.events.voiceStateSnapshot as unknown as { partitionReady: (key: string) => Effect.Effect<unknown> }
        ).partitionReady(target)
        const waiting = await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(options)
                    bot.rest.respond("GET /users/@me/guilds", () => ({ body: [] }))
                    yield* bot.ready()
                    const create = (id: string) =>
                        bot.emit(
                            "GUILD_CREATE",
                            bot.fixtures.guildCreate({ guild: { id }, channels: [], voice_states: [] }),
                        )
                    // A join that never ends holds the registry queue, so the target's join is received and waits
                    yield* create(blocker)
                    yield* Effect.promise(() => blocking.opened)
                    yield* create(target)
                    // The server's events wait on the join, which stops with the bot
                    const waiting = yield* readiness.pipe(Effect.forkDetach({ startImmediately: true }))
                    assert.equal(waiting.pollUnsafe(), undefined)
                    yield* bot.shutdown()
                    return waiting
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
        // Once the bot's scope has closed, the wait that began before it ends
        assert.equal(Exit.isSuccess(await Effect.runPromise(Fiber.await(waiting))), true)
    },
)

test("another shard being down or starting a new session does not pause this server's deletion", async () => {
    await withFakeClient((_, shards, deleted) =>
        Effect.gen(function* () {
            shards[1]!.state = "Recovering"
            shards[1]!.sessionEpoch = 5
            yield* TestClock.adjust("45 seconds")
            assert.deepEqual(deleted, ["7001"])
        }),
    )
})

test("a community outage pauses deletion until its voice snapshot returns", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native) =>
        Effect.gen(function* () {
            yield* snapshot(bot)
            yield* bot.emit("GUILD_DELETE", { id: bot.fixtures.ids.guild, unavailable: true })
            yield* bot.idle()
            yield* TestClock.adjust("5 minutes")
            yield* bot.idle()
            assert.deepEqual(deletes(native), [])
            yield* snapshot(bot)
            yield* TestClock.adjust("45 seconds")
            assert.equal(segment((yield* native.remove.next()).path, 2), "7001")
        }),
    )
})

test("in multi mode an unavailable server pauses its room deletion until its voice snapshot returns", async () => {
    const serverId = "1300000000000000001",
        forgotten: string[] = []
    // Other features' startup reads fail, which must not stop voice rooms
    await receiptWorld(
        [serverId],
        serverId,
        ({ path, body }) => {
            const operation = (body as { operation?: { type: string; channelId: string } }).operation
            if (path === "/voice/rooms") forgotten.push(`${operation!.type} ${operation!.channelId}`)
            return undefined
        },
        ({ bot, remove, create }) =>
            Effect.gen(function* () {
                yield* create(serverId)
                yield* bot.idle()
                yield* bot.emit("GUILD_DELETE", { id: serverId, unavailable: true })
                yield* bot.idle()
                yield* TestClock.adjust("5 minutes")
                yield* bot.idle()
                assert.equal(remove.requests().length, 0)
                yield* create(serverId)
                yield* bot.idle()
                yield* TestClock.adjust("45 seconds")
                assert.equal(segment((yield* remove.next()).path, 2), "7001")
                yield* bot.idle()
                assert.deepEqual(forgotten, ["forget 7001"])
            }),
    )
})

test("a voice snapshot received before an unavailable notice cannot sync a server that was still starting", async () => {
    const serverId = "1300000000000000001",
        starting = gate()
    await receiptWorld(
        [serverId],
        serverId,
        // Startup stops at the sticky messages read until the test releases it
        ({ path }) => (path === "/sticky/list" ? starting.opened : undefined),
        ({ bot, remove, finished, create }) =>
            Effect.gen(function* () {
                // The snapshot waits for the starting server, and the notice that follows it runs at once
                const handled = finished("guildDelete")
                yield* create(serverId)
                yield* bot.emit("GUILD_DELETE", { id: serverId, unavailable: true })
                yield* Effect.promise(() => handled)
                starting.open()
                yield* bot.idle({ timeoutMs: 30000 })
                yield* TestClock.adjust("5 minutes")
                yield* bot.idle({ timeoutMs: 30000 })
                assert.equal(remove.requests().length, 0)
                // A snapshot received after the outage syncs the server and deletion resumes
                yield* create(serverId)
                yield* bot.idle({ timeoutMs: 30000 })
                yield* TestClock.adjust("45 seconds")
                assert.equal(segment((yield* remove.next()).path, 2), "7001")
            }),
    )
})

// Multi-mode servers whose startup, snapshot reads and removals the test holds. The target server has the room 7001 recorded
const gate = () => {
    let open!: () => void
    const opened = new Promise<void>((resolve) => {
        open = resolve
    })
    return { opened, open }
}
function receiptWorld(
    installed: readonly string[],
    target: string,
    hold: (call: { path: string; serverId?: string | undefined; body?: unknown }) => Promise<unknown> | undefined,
    body: (world: {
        bot: Bot
        remove: ReturnType<Bot["rest"]["respond"]>
        finished: (event: string) => Promise<void>
        completed: (event: string) => number
        options: ReturnType<typeof createBotOptions>
        create: (serverId: string) => ReturnType<Bot["emit"]>
    }) => Effect.Effect<void, unknown, never>,
    prepare?: (options: ReturnType<typeof createBotOptions>) => void,
    guilds: readonly string[] = installed,
) {
    const client = fakeClient(async (call) => {
        const { path } = call
        // A held call resolves to nothing, or to the answer that replaces the usual one
        const answer = await hold(call)
        if (answer !== undefined) return answer
        if (path === "/service/scope") return { mode: "multi" }
        if (path === "/service/installations/list") return { serverIds: installed, nextCursor: null }
        if (path === "/service/installations/join" || path === "/service/installations/leave")
            return { serverId: (call.body as { serverId: string }).serverId, active: path.endsWith("/join") }
        if (path === "/voice/query")
            return call.serverId === target
                ? { type: "state", generators: [generator()], rooms: [room("7001")] }
                : { type: "state", generators: [], rooms: [] }
        if (path === "/voice/rooms") return { type: "forgotten", room: true, generator: false }
        return Response.json({ error: "Backend unavailable" }, { status: 503 })
    }, quietSignal)
    const options = createBotOptions({
        token,
        scope: parseServerScope({ NEONFLUX_SERVER_MODE: "multi" }),
        backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-secret"), client },
    })
    prepare?.(options)
    // Each call to finished returns a promise for the next completed handler of that event
    const waiting = new Map<string, (() => void)[]>()
    const finished = (event: string) =>
        new Promise<void>((resolve) => waiting.set(event, [...(waiting.get(event) ?? []), resolve]))
    const counts = new Map<string, number>()
    const completed = (event: string) => counts.get(event) ?? 0
    return Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot({
                    ...options,
                    observe: (observation) => {
                        options.observe(observation)
                        if (observation.type === "handler") {
                            counts.set(observation.event, completed(observation.event) + 1)
                            for (const resolve of waiting.get(observation.event)?.splice(0) ?? []) resolve()
                        }
                    },
                })
                bot.rest.respond("GET /users/@me/guilds", (request) => ({
                    body: request.query.after ? [] : guilds.map((id) => bot.fixtures.guild({ id })),
                }))
                bot.rest.respond("GET /channels/:id", (request) => ({
                    body: bot.fixtures.channel({ id: segment(request.path, 2), guild_id: target, type: 2 }),
                }))
                const remove = bot.rest.respond("DELETE /channels/:id", { status: 204 })
                yield* bot.ready()
                yield* body({
                    bot,
                    remove,
                    finished,
                    completed,
                    options,
                    create: (serverId) =>
                        bot.emit(
                            "GUILD_CREATE",
                            bot.fixtures.guildCreate({ guild: { id: serverId }, channels: [], voice_states: [] }),
                        ),
                })
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
}
const busyServers = Array.from({ length: 8 }, (_, index) => String(1300000000000000010n + BigInt(index)))

test(
    "a voice update received after a held snapshot is not erased when the snapshot runs second",
    { timeout: 60000 },
    async () => {
        const target = "1300000000000000001"
        const startTarget = gate(),
            targetStarting = gate(),
            busyRead = gate(),
            eightBusy = gate()
        let reads = 0
        await receiptWorld(
            [target, ...busyServers],
            target,
            ({ path, serverId }) => {
                if (path === "/sticky/list" && serverId === target) {
                    targetStarting.open()
                    return startTarget.opened
                }
                // Every other server's first snapshot waits on its voice read, which holds all eight snapshot slots
                if (path === "/voice/query" && serverId !== target) {
                    if (++reads === busyServers.length) eightBusy.open()
                    return busyRead.opened
                }
            },
            ({ bot, remove, finished, create }) =>
                Effect.gen(function* () {
                    for (const id of busyServers) yield* create(id)
                    yield* Effect.promise(() => eightBusy.opened)
                    yield* Effect.promise(() => targetStarting.opened)
                    // The starting server receives its snapshot with nobody in voice, then a member joins its room
                    yield* create(target)
                    const updated = finished("voiceStateUpdate")
                    yield* bot.emit("VOICE_STATE_UPDATE", {
                        guild_id: target,
                        channel_id: "7001",
                        user_id: "6002",
                        connection_id: "c9",
                        mute: false,
                        deaf: false,
                        self_mute: false,
                        self_deaf: false,
                        is_mobile: false,
                        suppress: false,
                    })
                    // The update runs first, because the snapshot slots stay busy until the voice reads are released
                    startTarget.open()
                    yield* Effect.promise(() => updated)
                    busyRead.open()
                    yield* bot.idle({ timeoutMs: 30000 })
                    yield* TestClock.adjust("5 minutes")
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.equal(remove.requests().length, 0)
                }),
        )
    },
)

test(
    "a voice snapshot that waits for a server joined again cannot sync it after the unavailable notice",
    { timeout: 60000 },
    async () => {
        const target = "1300000000000000001"
        const startAgain = gate(),
            startingAgain = gate(),
            busyRead = gate(),
            eightBusy = gate()
        let reads = 0,
            again = false
        await receiptWorld(
            [target, ...busyServers],
            target,
            ({ path, serverId }) => {
                if (path === "/sticky/list" && serverId === target && again) {
                    startingAgain.open()
                    return startAgain.opened
                }
                if (path === "/voice/query" && serverId !== target) {
                    if (++reads === busyServers.length) eightBusy.open()
                    return busyRead.opened
                }
            },
            ({ bot, remove, finished, create }) =>
                Effect.gen(function* () {
                    for (const id of busyServers) yield* create(id)
                    yield* Effect.promise(() => eightBusy.opened)
                    // This snapshot waits for a free slot, and its server then leaves and joins again while it waits
                    yield* create(target)
                    const left = finished("guildDelete")
                    yield* bot.emit("GUILD_DELETE", { id: target })
                    yield* Effect.promise(() => left)
                    again = true
                    yield* create(target)
                    yield* Effect.promise(() => startingAgain.opened)
                    const notice = finished("guildDelete")
                    yield* bot.emit("GUILD_DELETE", { id: target, unavailable: true })
                    yield* Effect.promise(() => notice)
                    busyRead.open()
                    startAgain.open()
                    yield* bot.idle({ timeoutMs: 30000 })
                    yield* TestClock.adjust("5 minutes")
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.equal(remove.requests().length, 0)
                    // A snapshot received after the outage syncs the server and deletion resumes
                    yield* create(target)
                    yield* bot.idle({ timeoutMs: 30000 })
                    yield* TestClock.adjust("45 seconds")
                    assert.equal(segment((yield* remove.next()).path, 2), "7001")
                }),
        )
    },
)

test(
    "an unavailable notice that waits for a slot cannot undo the snapshot that followed it",
    { timeout: 60000 },
    async () => {
        const target = "1300000000000000001"
        const leaving = gate()
        await receiptWorld(
            [target, ...busyServers],
            target,
            ({ path }) => (path === "/service/installations/leave" ? leaving.opened : undefined),
            ({ bot, remove, finished, create }) =>
                Effect.gen(function* () {
                    // Eight removals hold every guildDelete slot while the backend does not answer
                    for (const id of busyServers) yield* bot.emit("GUILD_DELETE", { id })
                    yield* bot.emit("GUILD_DELETE", { id: target, unavailable: true })
                    // The snapshot of the server's return is applied while the notice still waits
                    const applied = finished("voiceStateSnapshot")
                    yield* create(target)
                    yield* Effect.promise(() => applied)
                    leaving.open()
                    yield* bot.idle({ timeoutMs: 30000 })
                    yield* TestClock.adjust("45 seconds")
                    assert.equal(segment((yield* remove.next()).path, 2), "7001")
                }),
        )
    },
)

test("an externally deleted room or generator clears its record and is never deleted again", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native, memory) =>
        Effect.gen(function* () {
            yield* snapshot(bot)
            yield* bot.emit("CHANNEL_DELETE", bot.fixtures.channel({ id: "7001", type: 2 }))
            yield* bot.emit("CHANNEL_DELETE", bot.fixtures.channel({ id: generatorId, type: 2 }))
            yield* bot.idle()
            assert.equal(memory.rooms.size, 0)
            assert.equal(memory.generators.size, 0)
            assert.deepEqual(
                memory.calls.filter((call) => call.method === "rooms").map((call) => call.operation),
                [
                    { type: "forget", channelId: "7001" },
                    { type: "forget", channelId: generatorId },
                ],
            )
            yield* TestClock.adjust("5 minutes")
            yield* bot.idle()
            assert.deepEqual(deletes(native), [])
            yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, ownerId, generatorId, "c1"))
            yield* bot.idle()
            assert.equal(native.create.requests().length, 0)
        }),
    )
})

test("owners control their room, staff can control any room and other members are refused", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native) =>
        Effect.gen(function* () {
            yield* snapshot(bot, [voice(bot, ownerId, "7001", "c1")])
            for (const content of [
                "!voice limit 3",
                "!voice hide",
                `!voice allow <@${strangerId}>`,
                `!voice block <@${strangerId}>`,
                `!voice block <@${ownerId}>`,
                "!voice show",
            ]) {
                yield* say(bot, ownerId, content)
                yield* bot.idle()
            }
            yield* say(bot, strangerId, "!voice rename <#7001> Taken")
            yield* say(bot, strangerId, "!voice limit 2")
            yield* say(bot, adminId, "!voice limit <#7001> 5")
            yield* say(bot, strangerId, "!voice generator list")
            yield* bot.idle()
            const guild = bot.fixtures.ids.guild,
                view = String(Permissions.ViewChannel),
                access = String(Permissions.ViewChannel | Permissions.Connect)
            assert.deepEqual(
                native.edit.requests().map((request) => request.body),
                [{ user_limit: 3 }, { user_limit: 5 }],
            )
            assert.deepEqual(
                native.overwrite
                    .requests()
                    .map((request) => [
                        segment(request.path, 4),
                        (request.body as { allow: string }).allow,
                        (request.body as { deny: string }).deny,
                    ]),
                [
                    [bot.fixtures.ids.bot, access, "0"],
                    [ownerId, access, "0"],
                    [guild, "0", view],
                    [strangerId, access, "0"],
                    [strangerId, "0", access],
                    [guild, "0", "0"],
                ],
            )
            assert.deepEqual(replies(native), [
                "Room limit set to 3 members",
                "Room hidden from everyone without explicit access",
                `<@${strangerId}> can see and join this room`,
                `<@${strangerId}> can no longer see or join this room. Members already inside stay connected`,
                "The room owner and NeonFlux cannot be blocked",
                "Room visible again",
                "Only the room owner or the server owner, an Administrator or a moderation staff role with Manage channels can change this room",
                "You do not own a temporary voice room. Join a generator to create one",
                "Room limit set to 5 members",
                "Only the server owner, an Administrator or a moderation staff role with Manage channels can manage voice generators",
            ])
        }),
    )
})

test("a member in a room whose owner left claims it and controls it at once, and the claim waits for the voice list", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native, memory) =>
        Effect.gen(function* () {
            const claim = (userId: string) => say(bot, userId, "!voice claim").pipe(Effect.andThen(bot.idle()))
            yield* claim(strangerId)
            yield* snapshot(bot, [voice(bot, ownerId, "7001", "c1"), voice(bot, strangerId, "7001", "c2")])
            yield* claim(strangerId)
            yield* claim(adminId)
            yield* claim(ownerId)
            yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, ownerId, null, "c1"))
            yield* claim(strangerId)
            assert.equal(memory.rooms.get("7001")?.ownerId, strangerId)
            // The runtime knows the new owner, so the room answers to them right away and no longer to the old owner
            yield* say(bot, strangerId, "!voice rename Study hall")
            yield* say(bot, ownerId, "!voice limit 2")
            yield* claim(strangerId)
            yield* bot.idle()
            assert.deepEqual(
                native.edit.requests().map((request) => [segment(request.path, 2), request.body]),
                [["7001", { name: "Study hall" }]],
            )
            assert.deepEqual(replies(native), [
                "NeonFlux is still reading who is in voice. Try again in a minute",
                "The owner is still in this room",
                "Join the voice room you want to claim first",
                "You already own this room",
                "You own this room now",
                "Room renamed to Study hall",
                "You do not own a temporary voice room. Join a generator to create one",
                "You already own this room",
            ])
        }),
    )
})

test("an owner gives their room to a member in it, never to someone outside, a bot or another room's owner", async () => {
    await run({ generators: [generator()], rooms: [room("7001"), room("7002", adminId)] }, (bot, native, memory) =>
        Effect.gen(function* () {
            const f = bot.fixtures,
                hidden = String(Permissions.ViewChannel),
                access = String(Permissions.ViewChannel | Permissions.Connect)
            // The room is hidden, so the new owner gets the access hide gives
            bot.rest.respond("GET /channels/7001", {
                body: f.channel({
                    id: "7001",
                    type: 2,
                    permission_overwrites: [{ id: f.ids.guild, type: 0, allow: "0", deny: hidden }],
                }),
            })
            yield* snapshot(bot, [
                voice(bot, ownerId, "7001", "c1"),
                voice(bot, f.ids.bot, "7001", "c2"),
                voice(bot, adminId, "7001", "c3"),
                voice(bot, strangerId, "7001", "c4"),
            ])
            for (const userId of ["6010", f.ids.bot, adminId, strangerId]) {
                yield* say(bot, ownerId, `!voice transfer <@${userId}>`)
                yield* bot.idle()
            }
            assert.equal(memory.rooms.get("7001")?.ownerId, strangerId)
            assert.deepEqual(
                native.overwrite
                    .requests()
                    .map((request) => [
                        segment(request.path, 2),
                        segment(request.path, 4),
                        (request.body as { allow: string }).allow,
                    ]),
                [["7001", strangerId, access]],
            )
            assert.deepEqual(replies(native), [
                "They must be in your room",
                "A bot cannot own a temporary voice room",
                "They already own a temporary voice room",
                `<@${strangerId}> owns this room now`,
            ])
        }),
    )
})

test("a room change the bot lacks a permission for names the permission to grant in that room", async () => {
    await run({ generators: [generator()], rooms: [room("7001")] }, (bot, native) =>
        Effect.gen(function* () {
            const f = bot.fixtures
            yield* snapshot(bot, [voice(bot, ownerId, "7001", "c1")])
            native.roles.remove()
            bot.rest.respond("GET /guilds/:id/roles", {
                body: [
                    f.role({ id: f.ids.guild, permissions: "0" }),
                    f.role({
                        id: native.botRole.id,
                        position: 20,
                        permissions: String(Permissions.ViewChannel | Permissions.Connect | Permissions.ManageChannels),
                    }),
                    native.adminRole,
                ],
            })
            yield* say(bot, ownerId, "!voice hide")
            yield* bot.idle()
            assert.deepEqual(replies(native), ["Grant Manage roles to the NeonFlux role and allow it in <#7001>"])
            assert.equal(native.overwrite.requests().length, 0)
        }),
    )
})

test("staff create, configure and remove generators, capped at ten per server", async () => {
    await run(
        { generators: Array.from({ length: 9 }, (_, index) => generator({ channelId: String(5100 + index) })) },
        (bot, native, memory) =>
            Effect.gen(function* () {
                yield* say(bot, adminId, `!voice generator add "Join to create" ${categoryId}`)
                yield* bot.idle()
                const [created] = native.created
                assert.deepEqual(native.create.requests()[0]!.body, {
                    type: 2,
                    name: "Join to create",
                    parent_id: categoryId,
                })
                assert.deepEqual(
                    memory.generators.get(created!),
                    generator({ channelId: created!, template: "{owner}'s room", userLimit: null, region: null }),
                )
                yield* say(bot, adminId, `!voice generator add "One more"`)
                yield* say(bot, adminId, `!voice generator set <#${created}> region us-east`)
                yield* say(bot, adminId, `!voice generator set <#${created}> name "Gaming"`)
                yield* bot.idle()
                assert.equal(native.create.requests().length, 1)
                assert.equal(memory.generators.get(created!)?.region, "us-east")
                assert.deepEqual(
                    native.edit.requests().map((request) => [segment(request.path, 2), request.body]),
                    [[created, { name: "Gaming" }]],
                )
                yield* say(bot, adminId, `!voice generator remove <#${created}>`)
                yield* bot.idle()
                assert.equal(memory.generators.has(created!), false)
                assert.deepEqual(deletes(native), [])
                const text = replies(native)
                // The follow-up command names the new generator by its mention, never by a raw ID
                assert.equal(
                    text[0],
                    `Generator <#${created}> created. Members who join it get their own room named "{owner}'s room"\nChange its name, room names, limit, region or category with \`!voice generator set\``,
                )
                assert.ok(!text[0]!.replaceAll(`<#${created}>`, "").includes(created!))
                assert.equal(text[1], "A server can have at most 10 generators")
                // Each change answers with one line that names the setting and its new value
                assert.deepEqual(text.slice(2, 4), [
                    `Rooms from <#${created}> now use region us-east`,
                    `Generator <#${created}> renamed to Gaming`,
                ])
                assert.match(text.at(-1)!, /^Generator removed/)
            }),
    )
})

test("dashboard generator requests do their native work first, undo a refused add and refresh the running bot", async (t) => {
    const executions: Record<string, unknown>[] = [],
        failures: unknown[] = []
    let jobs: DashboardConfigurationReadyJob[] = [],
        outcome: DashboardConfigurationJob["state"] = "applied",
        outdated = true
    mockBackend(t, (call) => {
        const { path } = call,
            body = call.body as Record<string, unknown>
        if (path === "/dashboard-configuration/ready") return { jobs }
        if (path === "/dashboard-configuration/fail") {
            failures.push(body)
            return null
        }
        if (path === "/dashboard-configuration/claim")
            return claimed(jobs[0]!, undefined, outdated ? "conflict" : "queued")
        assert.equal(path, "/dashboard-configuration/execute")
        executions.push(body)
        const { native: _native, ...stored } = jobs[0]!
        return { job: { ...stored, state: outcome } }
    })
    await run({ generators: [generator()] }, (bot, native, memory) =>
        Effect.gen(function* () {
            const f = bot.fixtures,
                config = {
                    token,
                    serverId: f.ids.guild,
                    backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-backend-secret") },
                }
            const pass = () =>
                processDashboardConfigurationPass(
                    config,
                    bot.client as unknown as Parameters<typeof processDashboardConfigurationPass>[1],
                )
            bot.rest.respond("GET /users/@me", { body: f.botUser({ system: false }) })
            bot.rest.respond(`GET /users/${adminId}`, { body: f.user({ id: adminId, bot: false, system: false }) })
            const job = (
                operation: DashboardConfigurationOperationMap["voice"],
                target: DashboardConfigurationNativeTarget,
            ): DashboardConfigurationReadyJob => ({
                family: "voice",
                operation,
                native: target,
                id: "synthetic_voice_job",
                actorId: adminId,
                expectedConfigRevision: 0,
                state: "queued",
                createdAt: 0,
                expiresAt: 120000,
            })
            const add = {
                type: "generator-add" as const,
                channelName: "Lobby",
                categoryId,
                template: "{owner} hangout",
                userLimit: 3,
                region: null,
            }
            jobs = [job(add, { channelIds: [categoryId] })]
            memory.generators.set("5100", generator({ channelId: "5100" }))
            // A request the backend finds outdated at its claim creates no channel and is not executed
            yield* pass()
            assert.deepEqual([native.create.requests().length, executions.length], [0, 0])
            outdated = false
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
            jobs = [
                job(
                    {
                        type: "generator-set",
                        channelId: generatorId,
                        expectedRevision: 1,
                        patch: { channelName: "Gaming", userLimit: 8 },
                    },
                    { channelIds: [generatorId] },
                ),
            ]
            yield* pass()
            assert.deepEqual(
                native.edit.requests().map((request) => [segment(request.path, 2), request.body]),
                [[generatorId, { name: "Gaming" }]],
            )
            assert.equal(executions.length, 3)
            assert.deepEqual(failures, [])
            assert.equal("context" in executions[2]!, false)
        }),
    )
})

test("a full server refuses new rooms with a notice in the generator chat", async () => {
    await run(
        {
            generators: [generator()],
            rooms: Array.from({ length: 50 }, (_, index) => room(String(8000 + index), String(9000 + index))),
        },
        (bot, native, memory) =>
            Effect.gen(function* () {
                yield* snapshot(
                    bot,
                    Array.from({ length: 50 }, (_, index) =>
                        voice(bot, String(9000 + index), String(8000 + index), `o${index}`),
                    ),
                )
                yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, ownerId, generatorId, "c1"))
                const notice = yield* native.messages.next()
                yield* bot.idle()
                assert.equal(notice.path, `/channels/${generatorId}/messages`)
                assert.equal(
                    (notice.body as { content: string }).content,
                    `<@${ownerId}> This server has reached its limit of 50 temporary voice rooms`,
                )
                assert.equal(native.create.requests().length, 0)
                assert.equal(memory.rooms.size, 50)
            }),
    )
})

test("a member Fluxer refuses to move, such as the server owner, is told where their room is", async () => {
    await run({ generators: [generator()] }, (bot, native) =>
        Effect.gen(function* () {
            // Fluxer answers a move of the owner or a member ranked at or above the bot with Missing Permissions
            bot.rest.respond("PATCH /guilds/:id/members/:id", {
                status: 403,
                body: { code: "MISSING_PERMISSIONS", message: "Missing Permissions" },
            })
            yield* snapshot(bot)
            yield* bot.emit("VOICE_STATE_UPDATE", voice(bot, ownerId, generatorId, "c1"))
            const notice = yield* native.messages.next()
            yield* bot.idle()
            const [roomId] = native.created
            assert.equal(notice.path, `/channels/${generatorId}/messages`)
            assert.equal(
                (notice.body as { content: string }).content,
                `<@${ownerId}> NeonFlux could not move you into your room <#${roomId}>. Fluxer refuses some moves, such as of the server owner or members ranked at or above the bot, or into a room where everyone uses peer-to-peer voice. Join it directly. An empty room is removed after 45 seconds`,
            )
            assert.equal(native.created.length, 1)
        }),
    )
})

test("a room name is cut without splitting an emoji and survives a lone surrogate in the owner's name", () => {
    assert.equal(renderRoomName("{owner}", `${"a".repeat(99)}😀`), "a".repeat(99))
    assert.equal(renderRoomName("{owner}'s room", "a\ud800b"), "a\ufffdb's room")
})
