import { visibleText } from "@neonflux/contracts/common"
import { VOICE_GENERATOR_LIMIT, VOICE_ROOM_LIMIT, type VoiceGenerator, type VoiceRoom } from "@neonflux/contracts/voice"
import {
    format,
    errors,
    ChannelType,
    type Client,
    type VoiceState,
    type VoiceStateSnapshot,
} from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Context, Effect, Scope } from "effect"
import { contained, forkContained } from "./contained.ts"
import type { VoiceStore } from "./voice-store.ts"
import { clip, duration } from "./reply-style.ts"
import { readAuthenticatedBotId } from "./safety-permissions.ts"

/** Rooms stay for this long after they become empty. A member who is mid-join can be invisible for up to 30 seconds */
export const voiceGraceMs = 45000
export const voiceRoomLimit = VOICE_ROOM_LIMIT,
    voiceGeneratorLimit = VOICE_GENERATOR_LIMIT
const loadRetryMs = 60000
const shardRetryMs = 5000
export function renderRoomName(template: string, ownerName: string) {
    return (
        visibleText(clip(visibleText(template.replaceAll("{owner}", visibleText(ownerName))), 100, "")) || "Voice room"
    )
}

/**
 * Voice leaves remembered since the last snapshot, which an older snapshot still waiting to run must not bring back. The leaves that matter
 * arrive while one snapshot waits for its server to start or for a slot, so this is far more than that needs. Past it, the tracker rejects
 * snapshots that are not newer than the newest leave it forgot, and cleanup waits for the next snapshot
 */
const leftLimit = 1000

export type VoiceRuntime = ReturnType<typeof createVoiceRuntime>
/** Each running server's voice runtime, so dashboard changes applied by the bot can refresh it */
export const voiceRuntimes = new Map<string, VoiceRuntime>()

/**
 * Temporary voice rooms for one server. Occupancy comes only from voice events keyed by connection.
 * A new gateway session of the server's shard, a restart or a community outage leaves the tracker unsynced until Fluxer sends
 * a fresh voice snapshot, and nothing is deleted while it is unsynced. A resume replays the missed events, so it keeps the tracker
 * and a due deletion only waits for the shard to be connected. Timers live in memory, so idle servers make no backend calls
 */
export function createVoiceRuntime(store: VoiceStore, serverId: string) {
    const generators = new Map<string, VoiceGenerator>(),
        rooms = new Map<string, VoiceRoom>()
    // Each connection with the receipt of the event that set it, and the receipt of each leave since the last snapshot
    const connections = new Map<string, { userId: string; channelId: string; receipt: number }>(),
        left = new Map<string, number>()
    let snapshotReceipt = 0,
        outageReceipt = 0,
        forgottenLeave = 0
    const timers = new Map<string, number>(),
        creating = new Set<string>()
    let loaded = false,
        lastLoadAt = Number.NEGATIVE_INFINITY,
        synced = false,
        sessionEpoch: number | undefined,
        sequence = 0
    let client: Client | undefined, scope: Scope.Scope | undefined, services: Context.Context<never> | undefined

    // A shard's session epoch changes with every new session, which can miss voice events and then sends the snapshot again.
    // A resume replays the missed events and keeps it
    const shard = () => {
        const shardId = client?.shardIdForGuild(serverId)
        return client?.shards.find((known) => known.shardId === shardId)
    }
    const isSynced = () => {
        if (synced && shard()?.sessionEpoch !== sessionEpoch) {
            synced = false
            timers.clear()
        }
        return synced
    }
    const occupancy = (channelId: string) => {
        let count = 0
        for (const connection of connections.values()) if (connection.channelId === channelId) count++
        return count
    }
    // Room work and timers run with the server runtime's services, such as its Clock, whichever event started them
    const fork = <E, R>(effect: Effect.Effect<void, E, R>, warning: string) =>
        forkContained(effect, warning, scope, services)

    const load = Effect.gen(function* () {
        lastLoadAt = yield* Clock.currentTimeMillis
        const state = yield* store.query({ serverId, operation: { type: "state" } })
        if (state.type !== "state") return
        generators.clear()
        for (const generator of state.generators) generators.set(generator.channelId, generator)
        // Only this process changes room records, so rooms it already knows are kept
        for (const room of state.rooms) rooms.set(room.channelId, room)
        loaded = true
    })
    const ensureLoaded = Effect.gen(function* () {
        if (loaded) return true
        if ((yield* Clock.currentTimeMillis) - lastLoadAt < loadRetryMs) return false
        yield* contained(load, "Voice generators could not be loaded. Rooms pause until the backend answers")
        if (loaded) for (const channelId of [...rooms.keys()]) yield* reconcile(channelId)
        return loaded
    })

    const forget = (channelId: string) =>
        Effect.gen(function* () {
            timers.delete(channelId)
            const room = rooms.delete(channelId),
                generator = generators.delete(channelId)
            if (room || generator)
                yield* contained(
                    store.rooms({ serverId, operation: { type: "forget", channelId } }),
                    "A deleted voice channel could not be forgotten. Its record is checked again when the bot restarts",
                )
        })
    const current = (channelId: string, token: number) =>
        timers.get(channelId) === token && rooms.has(channelId) && isSynced() && occupancy(channelId) === 0
    const connected = () => shard()?.state === "Connected"
    const attemptDelete = (channelId: string, token: number) =>
        Effect.gen(function* () {
            // While the server's shard is down the room's occupancy may have changed unseen, so the deletion waits for the
            // connection and then starts over, since the replayed events may have changed the room
            while (true) {
                if (!current(channelId, token)) return
                if (!connected()) {
                    yield* Effect.sleep(shardRetryMs)
                    continue
                }
                const native = client!
                const read = yield* native.channels.fetch(channelId, { timeoutMs: 5000 }).pipe(
                    Effect.map((channel) => ({ channel, missing: false })),
                    Effect.catch((error) =>
                        Effect.succeed({ channel: undefined, missing: errors.isNotFound(error, "channel") }),
                    ),
                )
                if (read.missing) {
                    yield* forget(channelId)
                    return
                }
                if (!connected()) continue
                if (
                    !read.channel ||
                    read.channel.id !== channelId ||
                    read.channel.guildId !== serverId ||
                    read.channel.type !== ChannelType.Voice
                ) {
                    if (timers.get(channelId) === token) timers.delete(channelId)
                    return
                }
                // A join can arrive while the read is in flight, so emptiness and sync are checked again right before deleting
                if (!current(channelId, token)) return
                timers.delete(channelId)
                const deleted = yield* native.channels
                    .delete(channelId, { auditReason: "Temporary voice room was empty" })
                    .pipe(
                        Effect.as(true),
                        Effect.catch((error) => Effect.succeed(errors.isNotFound(error, "channel"))),
                    )
                if (deleted) yield* forget(channelId)
                else
                    yield* Effect.logWarning(
                        "A temporary voice room could not be deleted. It is checked again when its occupancy changes",
                    )
                return
            }
        })
    const reconcile = (channelId: string): Effect.Effect<void> =>
        Effect.gen(function* () {
            if (!rooms.has(channelId) || occupancy(channelId) > 0 || !isSynced()) {
                timers.delete(channelId)
                return
            }
            if (timers.has(channelId)) return
            const token = ++sequence
            timers.set(channelId, token)
            yield* fork(
                Effect.sleep(voiceGraceMs).pipe(Effect.andThen(attemptDelete(channelId, token))),
                "Temporary voice room cleanup stopped",
            )
        })

    const notice = (generator: VoiceGenerator, userId: string, text: string) =>
        contained(
            client!.messages.send(generator.channelId, {
                content: `${format.userMention(userId)} ${text}`,
            }),
            text,
        )
    // Fluxer refuses to move the server owner and members ranked at or above the bot, whatever its permissions, and into an
    // occupied room whose members all use peer-to-peer voice, so a member who could not be moved is told where their room is
    const move = (state: VoiceState, channelId: string, generator: VoiceGenerator) =>
        client!.members
            .move({ guildId: serverId, userId: state.userId, connectionId: state.connectionId }, channelId, {
                auditReason: "Temporary voice room",
            })
            .pipe(
                Effect.as(true),
                Effect.catchCause((cause) =>
                    Cause.hasInterrupts(cause)
                        ? Effect.failCause(cause)
                        : Effect.logWarning("A member could not be moved into their temporary voice room").pipe(
                              Effect.as(false),
                          ),
                ),
                Effect.flatMap((moved) =>
                    moved
                        ? Effect.void
                        : notice(
                              generator,
                              state.userId,
                              `NeonFlux could not move you into your room ${format.channelMention(channelId)}. Fluxer refuses some moves, such as of the server owner or members ranked at or above the bot, or into a room where everyone uses peer-to-peer voice. Join it directly. An empty room is removed after ${duration(voiceGraceMs / 1000)}`,
                          ),
                ),
            )
    const joinGenerator = (state: VoiceState) =>
        Effect.gen(function* () {
            const native = client!,
                generator = generators.get(state.channelId ?? "")
            if (!generator || creating.has(state.userId) || state.userId === (yield* readAuthenticatedBotId(native)))
                return
            creating.add(state.userId)
            yield* Effect.gen(function* () {
                const owned = [...rooms.values()].find((room) => room.ownerId === state.userId)
                if (owned) {
                    yield* move(state, owned.channelId, generator)
                    return
                }
                const full = `This server has reached its limit of ${voiceRoomLimit} temporary voice rooms`
                if (rooms.size >= voiceRoomLimit) {
                    yield* notice(generator, state.userId, full)
                    return
                }
                // Fluxer usually sends the member with the voice state, which saves a read
                const member =
                    state.member ??
                    (yield* native.members.fetch({ guildId: serverId, userId: state.userId }, { timeoutMs: 5000 }))
                if (member.isBot || member.guildId !== serverId || member.userId !== state.userId) return
                const created = yield* native.channels.create(
                    serverId,
                    {
                        type: ChannelType.Voice,
                        name: renderRoomName(generator.template, member.nickname ?? member.username),
                        parentId: generator.categoryId,
                        userLimit: generator.userLimit ?? 0,
                    },
                    { auditReason: "Temporary voice room" },
                )
                // Fluxer ignores rtc_region on creation, so a fixed region is set with an edit right after
                if (generator.region !== null)
                    yield* contained(
                        native.channels.edit(created.id, { rtcRegion: generator.region }),
                        "A temporary voice room kept automatic region routing because its fixed region could not be applied",
                    )
                const recorded = yield* store
                    .rooms({
                        serverId,
                        operation: {
                            type: "create",
                            channelId: created.id,
                            ownerId: state.userId,
                            generatorChannelId: generator.channelId,
                        },
                    })
                    .pipe(Effect.catch(() => Effect.succeed(undefined)))
                if (recorded?.type !== "created") {
                    // An unrecorded room would never be cleaned up, so the channel created moments ago is removed before anyone is moved in
                    yield* contained(
                        native.channels.delete(created.id, {
                            auditReason: "Temporary voice room could not be recorded",
                        }),
                        "An unrecorded temporary voice room could not be removed",
                    )
                    if (recorded?.type === "refused" && recorded.room) {
                        rooms.set(recorded.room.channelId, recorded.room)
                        yield* move(state, recorded.room.channelId, generator)
                    } else if (recorded?.type === "refused" && recorded.reason === "room-limit")
                        yield* notice(generator, state.userId, full)
                    return
                }
                rooms.set(created.id, recorded.room)
                yield* reconcile(created.id)
                yield* move(state, created.id, generator)
            }).pipe(
                Effect.ensuring(
                    Effect.sync(() => {
                        creating.delete(state.userId)
                    }),
                ),
            )
        })

    const runtime = {
        serverId,
        // Generators and rooms load on the first voice event or room command. Nothing is deleted before a voice snapshot, which loads
        // them too, so a server whose members never use voice costs no backend call at startup
        start: (native: Client) =>
            Effect.gen(function* () {
                client = native
                scope = yield* Effect.scope
                services = yield* Effect.context<never>()
                voiceRuntimes.set(serverId, runtime)
                yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                        if (voiceRuntimes.get(serverId) === runtime) voiceRuntimes.delete(serverId)
                    }),
                )
            }),
        /** Loads generators and rooms once, so a room command finds the rooms recorded before a restart. False while the backend is unavailable */
        ready: ensureLoaded,
        reload: () =>
            contained(
                load.pipe(Effect.andThen(Effect.forEach([...rooms.keys()], reconcile, { discard: true }))),
                "Voice generators could not be refreshed",
            ),
        voiceState: (state: VoiceState, receipt: number) =>
            Effect.gen(function* () {
                // A snapshot received after the update already holds its effect. The server's updates run in the order they were received
                if (state.guildId !== serverId || receipt < snapshotReceipt) return
                const previous = connections.get(state.connectionId)
                left.delete(state.connectionId)
                if (state.channelId === null) {
                    connections.delete(state.connectionId)
                    left.set(state.connectionId, receipt)
                    if (left.size > leftLimit) {
                        const [oldest, at] = left.entries().next().value!
                        left.delete(oldest)
                        forgottenLeave = Math.max(forgottenLeave, at)
                    }
                } else {
                    connections.set(state.connectionId, { userId: state.userId, channelId: state.channelId, receipt })
                }
                for (const channelId of new Set([previous?.channelId, state.channelId]))
                    if (channelId && rooms.has(channelId)) yield* reconcile(channelId)
                if (
                    state.channelId === null ||
                    previous?.channelId === state.channelId ||
                    !(yield* ensureLoaded) ||
                    !generators.has(state.channelId)
                )
                    return
                yield* fork(joinGenerator(state), "A temporary voice room could not be created")
            }),
        // A fresh full list replaces the tracker, the only event that makes deletion safe again. A snapshot received before one that was
        // applied, before an unavailable notice that was applied or before a leave that was forgotten is stale. A connection set by an event received after the snapshot stays
        /** The epoch is the receiving shard's session when the client accepted the snapshot, from the event's context */
        snapshot: (snapshot: VoiceStateSnapshot, epoch: number, receipt: number) =>
            Effect.gen(function* () {
                if (
                    snapshot.guildId !== serverId ||
                    receipt < snapshotReceipt ||
                    receipt < outageReceipt ||
                    receipt <= forgottenLeave
                )
                    return
                const newer = [...connections].filter(([, connection]) => connection.receipt > receipt)
                connections.clear()
                for (const [connectionId, connection] of newer) connections.set(connectionId, connection)
                for (const [connectionId, at] of left) if (at < receipt) left.delete(connectionId)
                const listed = snapshot.voiceStates.filter(
                    (state) => state.channelId && !connections.has(state.connectionId) && !left.has(state.connectionId),
                )
                for (const state of listed)
                    connections.set(state.connectionId, {
                        userId: state.userId,
                        channelId: state.channelId!,
                        receipt,
                    })
                timers.clear()
                synced = true
                sessionEpoch = epoch
                snapshotReceipt = receipt
                if (!(yield* ensureLoaded)) return
                for (const channelId of [...rooms.keys()]) yield* reconcile(channelId)
                for (const state of listed)
                    if (generators.has(state.channelId!))
                        yield* fork(joinGenerator(state), "A temporary voice room could not be created")
            }),
        // An unavailable notice received before an applied snapshot is stale, since the snapshot came after the outage
        unavailable: (receipt: number) =>
            Effect.sync(() => {
                if (receipt < snapshotReceipt) return
                synced = false
                timers.clear()
                outageReceipt = Math.max(outageReceipt, receipt)
            }),
        channelDeleted: (channelId: string) =>
            rooms.has(channelId) || generators.has(channelId) ? forget(channelId) : Effect.void,
        ownedRoom: (userId: string) => [...rooms.values()].find((room) => room.ownerId === userId),
        setGenerator: (generator: VoiceGenerator) => {
            generators.set(generator.channelId, generator)
        },
        removeGenerator: (channelId: string) => {
            generators.delete(channelId)
        },
    }
    return runtime
}
