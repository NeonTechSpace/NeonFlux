import type * as C from "@neonflux/backend/contracts"
import { ChannelType, type Client, type VoiceState, type VoiceStateSnapshot } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Context, Effect, Scope } from "effect"
import type { VoiceStore } from "./voice-store.ts"
import { noMentions } from "./responses.ts"
import { readAuthenticatedBotId } from "./safety-permissions.ts"

/** Rooms stay for this long after they become empty. A member who is mid-join can be invisible for up to 30 seconds */
export const voiceGraceMs = 45000
export const voiceRoomLimit = 50, voiceGeneratorLimit = 10
const loadRetryMs = 60000
const notFound = (error: unknown) => error !== null && typeof error === "object" && (error as { reason?: unknown }).reason === "notFound"
const visible = (value: string) => value.replace(/[\u000c\u202e]/g, "").trim()

export function renderRoomName(template: string, ownerName: string) {
    return visible(visible(template.replaceAll("{owner}", visible(ownerName))).slice(0, 100)) || "Voice room"
}

export type VoiceRuntime = ReturnType<typeof createVoiceRuntime>
/** Each running server's voice runtime, so dashboard changes applied by the bot can refresh it */
export const voiceRuntimes = new Map<string, VoiceRuntime>()

/**
 * Temporary voice rooms for one server. Occupancy comes only from voice events keyed by connection.
 * A gateway reconnect or resume, a restart or a community outage leaves the tracker unsynced until Fluxer sends a fresh
 * voice snapshot, and nothing is deleted while it is unsynced. Timers live in memory, so idle servers make no backend calls
 */
export function createVoiceRuntime(store: VoiceStore, serverId: string) {
    const generators = new Map<string, C.VoiceGenerator>(), rooms = new Map<string, C.VoiceRoom>()
    const connections = new Map<string, { userId: string, channelId: string }>()
    const timers = new Map<string, number>(), creating = new Set<string>()
    let loaded = false, lastLoadAt = Number.NEGATIVE_INFINITY, synced = false, mark = "", sequence = 0
    let client: Client | undefined, scope: Scope.Scope | undefined, services: Context.Context<never> | undefined

    // The SDK counts reconnects for the whole client and shows per-shard state only while a shard recovers, so a
    // reconnect or resume on any shard pauses every server. The shard plan is part of the mark, because automatic
    // sharding can move to new sessions without counting a reconnect
    const gatewayMark = () => client ? `${client.diagnostics().counters.reconnects}|${client.shards.map(shard => shard.shardId).join(",")}|${client.shardIdForGuild(serverId) ?? "none"}` : ""
    // A lost connection also shows as a state other than Connected during its backoff
    const isSynced = () => {
        if (synced && (client?.state !== "Connected" || gatewayMark() !== mark)) { synced = false; timers.clear() }
        return synced
    }
    const occupancy = (channelId: string) => { let count = 0; for (const connection of connections.values()) if (connection.channelId === channelId) count++; return count }
    const contained = <A, E, R>(effect: Effect.Effect<A, E, R>, warning: string) => effect.pipe(Effect.asVoid,
        Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning(warning)))
    const fork = <E, R>(effect: Effect.Effect<void, E, R>, warning: string) => {
        // Room work and timers run with the server runtime's services, such as its Clock, whichever event started them
        const work = services ? Effect.provideContext(contained(effect, warning), services) : contained(effect, warning)
        return Effect.asVoid(scope ? Effect.forkIn(work, scope) : Effect.forkDetach(work))
    }

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

    const forget = (channelId: string) => Effect.gen(function* () {
        timers.delete(channelId)
        const room = rooms.delete(channelId), generator = generators.delete(channelId)
        if (room || generator) yield* contained(store.rooms({ serverId, operation: { type: "forget", channelId } }),
            "A deleted voice channel could not be forgotten. Its record is checked again when the bot restarts")
    })
    const current = (channelId: string, token: number) => timers.get(channelId) === token && rooms.has(channelId) && isSynced() && occupancy(channelId) === 0
    const attemptDelete = (channelId: string, token: number) => Effect.gen(function* () {
        if (!current(channelId, token)) return
        const native = client!
        const read = yield* native.channels.fetch(channelId, { timeoutMs: 5000 }).pipe(Effect.map(channel => ({ channel, missing: false })),
            Effect.catch(error => Effect.succeed({ channel: undefined, missing: notFound(error) })))
        if (read.missing) { yield* forget(channelId); return }
        if (!read.channel || read.channel.id !== channelId || read.channel.guildId !== serverId || read.channel.type !== ChannelType.Voice) {
            if (timers.get(channelId) === token) timers.delete(channelId)
            return
        }
        // A join can arrive while the read is in flight, so emptiness and sync are checked again right before deleting
        if (!current(channelId, token)) return
        timers.delete(channelId)
        const deleted = yield* native.channels.delete(channelId, { auditReason: "Temporary voice room was empty" }).pipe(Effect.as(true),
            Effect.catch(error => Effect.succeed(notFound(error))))
        if (deleted) yield* forget(channelId)
        else yield* Effect.logWarning("A temporary voice room could not be deleted. It is checked again when its occupancy changes")
    })
    const reconcile = (channelId: string): Effect.Effect<void> => Effect.gen(function* () {
        if (!rooms.has(channelId) || occupancy(channelId) > 0 || !isSynced()) { timers.delete(channelId); return }
        if (timers.has(channelId)) return
        const token = ++sequence
        timers.set(channelId, token)
        yield* fork(Effect.sleep(voiceGraceMs).pipe(Effect.andThen(attemptDelete(channelId, token))), "Temporary voice room cleanup stopped")
    })

    const notice = (generator: C.VoiceGenerator, userId: string, text: string) => contained(client!.messages.send(generator.channelId,
        { content: `<@${userId}> ${text}`, allowedMentions: noMentions }), text)
    // Fluxer refuses to move the server owner and members ranked at or above the bot, whatever its permissions,
    // so a member who could not be moved is told where their room is
    const move = (state: VoiceState, channelId: string, generator: C.VoiceGenerator) => client!.members.move({ guildId: serverId, userId: state.userId, connectionId: state.connectionId }, channelId,
        { auditReason: "Temporary voice room" }).pipe(Effect.as(true), Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
        : Effect.logWarning("A member could not be moved into their temporary voice room").pipe(Effect.as(false))),
        Effect.flatMap(moved => moved ? Effect.void : notice(generator, state.userId, `I could not move you into your room <#${channelId}>. Fluxer does not let bots move the server owner or members ranked at or above the bot. Join it directly. An empty room is removed after ${voiceGraceMs / 1000} seconds`)))
    const joinGenerator = (state: VoiceState) => Effect.gen(function* () {
        const native = client!, generator = generators.get(state.channelId ?? "")
        if (!generator || creating.has(state.userId) || state.userId === (yield* readAuthenticatedBotId(native))) return
        creating.add(state.userId)
        yield* Effect.gen(function* () {
            const owned = [...rooms.values()].find(room => room.ownerId === state.userId)
            if (owned) { yield* move(state, owned.channelId, generator); return }
            const full = `This server has reached its limit of ${voiceRoomLimit} temporary voice rooms`
            if (rooms.size >= voiceRoomLimit) { yield* notice(generator, state.userId, full); return }
            // Fluxer usually sends the member with the voice state, which saves a read
            const member = state.member ?? (yield* native.members.fetch({ guildId: serverId, userId: state.userId }, { timeoutMs: 5000 }))
            if (member.isBot || member.guildId !== serverId || member.userId !== state.userId) return
            const created = yield* native.channels.create(serverId, { type: ChannelType.Voice, name: renderRoomName(generator.template, member.nickname ?? member.username),
                parentId: generator.categoryId, userLimit: generator.userLimit ?? 0 }, { auditReason: "Temporary voice room" })
            // Fluxer ignores rtc_region on creation, so a fixed region is set with an edit right after
            if (generator.region !== null) yield* contained(native.channels.edit(created.id, { rtcRegion: generator.region }),
                "A temporary voice room kept automatic region routing because its fixed region could not be applied")
            const recorded = yield* store.rooms({ serverId, operation: { type: "create", channelId: created.id, ownerId: state.userId, generatorChannelId: generator.channelId } })
                .pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (recorded?.type !== "created") {
                // An unrecorded room would never be cleaned up, so the channel created moments ago is removed before anyone is moved in
                yield* contained(native.channels.delete(created.id, { auditReason: "Temporary voice room could not be recorded" }), "An unrecorded temporary voice room could not be removed")
                if (recorded?.type === "refused" && recorded.room) { rooms.set(recorded.room.channelId, recorded.room); yield* move(state, recorded.room.channelId, generator) }
                else if (recorded?.type === "refused" && recorded.reason === "room-limit") yield* notice(generator, state.userId, full)
                return
            }
            rooms.set(created.id, recorded.room)
            yield* reconcile(created.id)
            yield* move(state, created.id, generator)
        }).pipe(Effect.ensuring(Effect.sync(() => { creating.delete(state.userId) })))
    })

    const runtime = {
        serverId,
        start: (native: Client) => Effect.gen(function* () {
            client = native; scope = yield* Effect.scope; services = yield* Effect.context<never>()
            voiceRuntimes.set(serverId, runtime)
            yield* Effect.addFinalizer(() => Effect.sync(() => { if (voiceRuntimes.get(serverId) === runtime) voiceRuntimes.delete(serverId) }))
            yield* contained(load, "Voice generators could not be loaded. Rooms pause until the backend answers")
        }),
        reload: () => contained(load.pipe(Effect.andThen(Effect.forEach([...rooms.keys()], reconcile, { discard: true }))), "Voice generators could not be refreshed"),
        voiceState: (state: VoiceState) => Effect.gen(function* () {
            if (state.guildId !== serverId) return
            const previous = connections.get(state.connectionId)
            if (state.channelId === null) connections.delete(state.connectionId)
            else connections.set(state.connectionId, { userId: state.userId, channelId: state.channelId })
            for (const channelId of new Set([previous?.channelId, state.channelId])) if (channelId && rooms.has(channelId)) yield* reconcile(channelId)
            if (state.channelId === null || previous?.channelId === state.channelId || !(yield* ensureLoaded) || !generators.has(state.channelId)) return
            yield* fork(joinGenerator(state), "A temporary voice room could not be created")
        }),
        // A fresh full list replaces the tracker, the only event that makes deletion safe again
        snapshot: (snapshot: VoiceStateSnapshot) => Effect.gen(function* () {
            if (snapshot.guildId !== serverId) return
            connections.clear(); timers.clear()
            for (const state of snapshot.voiceStates) if (state.channelId) connections.set(state.connectionId, { userId: state.userId, channelId: state.channelId })
            synced = true; mark = gatewayMark()
            if (!(yield* ensureLoaded)) return
            for (const channelId of [...rooms.keys()]) yield* reconcile(channelId)
            for (const state of snapshot.voiceStates) if (state.channelId && generators.has(state.channelId)) yield* fork(joinGenerator(state), "A temporary voice room could not be created")
        }),
        unavailable: () => Effect.sync(() => { synced = false; timers.clear() }),
        channelDeleted: (channelId: string) => rooms.has(channelId) || generators.has(channelId) ? forget(channelId) : Effect.void,
        generators: () => [...generators.values()],
        roomCount: () => rooms.size,
        ownedRoom: (userId: string) => [...rooms.values()].find(room => room.ownerId === userId),
        setGenerator: (generator: C.VoiceGenerator) => { generators.set(generator.channelId, generator) },
        removeGenerator: (channelId: string) => { generators.delete(channelId) },
    }
    return runtime
}
