import { ChannelType, isThreadChannel, type ChannelOperationOptions, type Client, type GuildChannel, type GuildOperationOptions, type GuildRole, type RoleReference } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"

// Stand-ins for Fluxerly cache reads that 1000.0.0-rc.7 lacks, so evaluating an ordinary message needs no Fluxer read.
// fluxerlyNext(client) offers them under the names Fluxerly is expected to use, so a release that adds them replaces this
// module, not its callers. Servers and members come from the SDK's own caches, which the bot options enable. Role lists and
// channels are kept here, because the SDK cannot say that a server's role list is complete and clears every cached channel
// whenever the bot changes one.
// A server's role list starts unknown, becomes complete from a full read and stays complete through role events. Channel and
// thread snapshots stay current through channel and thread events. Doubt forgets them: a lost gateway connection, a server
// becoming available or unavailable, a category or bulk channel change, or eviction. Unknown means the caller reads Fluxer
const SERVER_LIMIT = 1000, ROLE_LIMIT = 1000, CHANNEL_LIMIT = 20000

interface State {
    /** Role lists by server, least recently used first. A server without a list is unknown */
    readonly servers: Map<string, { roles?: Map<string, GuildRole>, generation: number }>
    /** Current channel and thread snapshots of every server, least recently used first */
    readonly channels: Map<string, GuildChannel>
    /** Advances with every role event and every forget, so a read that overlapped one is not kept */
    clock: number
}
const states = new WeakMap<Client, State>()
function stateOf(client: Client) {
    let state = states.get(client)
    if (!state) states.set(client, state = { servers: new Map(), channels: new Map(), clock: 0 })
    return state
}
// A use moves an entry last, and an insertion past the limit drops the first
function touch<V>(map: Map<string, V>, key: string, value: V, limit: number) {
    map.delete(key)
    map.set(key, value)
    if (map.size > limit) map.delete(map.keys().next().value!)
}

export function fluxerlyNext(client: Client) {
    const state = stateOf(client)
    return {
        members: {
            /** The bot's own member from the SDK's member cache, or undefined when it is not cached */
            getSelf: (guildId: string) => client.users.getSelf().pipe(Effect.flatMap(self => self ? client.members.get({ guildId, userId: self.id }) : Effect.succeed(undefined))),
        },
        roles: {
            /** Every role of a server, or undefined unless the list is known complete */
            getAll: (guildId: string) => Effect.sync(() => {
                const entry = state.servers.get(guildId)
                if (!entry?.roles) return undefined
                touch(state.servers, guildId, entry, SERVER_LIMIT)
                return [...entry.roles.values()] as readonly GuildRole[]
            }),
            /** Read every role of a server from Fluxer, and keep the list unless a role event or forget overlapped the read */
            fetchAll: (guildId: string, options?: GuildOperationOptions) => Effect.suspend(() => {
                const entry = state.servers.get(guildId) ?? { generation: ++state.clock }, before = entry.generation
                touch(state.servers, guildId, entry, SERVER_LIMIT)
                return client.roles.fetchAll(guildId, options).pipe(Effect.tap(roles => Effect.sync(() => {
                    if (state.servers.get(guildId) === entry && entry.generation === before && roles.length <= ROLE_LIMIT && roles.every(role => role.guildId === guildId)) {
                        entry.roles = new Map(roles.map(role => [role.id, role]))
                    }
                })))
            }),
        },
        channels: {
            /** A channel or thread kept current by events, or undefined when the bot holds none */
            get: (channelId: string) => Effect.sync(() => {
                const channel = state.channels.get(channelId)
                if (channel) touch(state.channels, channelId, channel, CHANNEL_LIMIT)
                return channel
            }),
            /** Read a channel or thread from Fluxer, and keep it unless an event stored it first or a forget overlapped the read */
            fetch: (channelId: string, options?: ChannelOperationOptions) => Effect.suspend(() => {
                const before = state.clock
                return client.channels.fetch(channelId, options).pipe(Effect.tap(channel => Effect.sync(() => {
                    if (state.clock === before && channel.id === channelId && !state.channels.has(channelId)) touch(state.channels, channelId, channel, CHANNEL_LIMIT)
                })))
            }),
        },
    }
}

// The bot's handlers report every role, channel and thread event of a served server here, before their own work
function changeRoles(client: Client, guildId: string, change: (roles: Map<string, GuildRole>) => void) {
    const state = stateOf(client), entry = state.servers.get(guildId)
    if (!entry) return
    entry.generation = ++state.clock
    if (!entry.roles) return
    change(entry.roles)
    if (entry.roles.size > ROLE_LIMIT) delete entry.roles
}
export const rememberRole = (client: Client, role: GuildRole) => changeRoles(client, role.guildId, roles => roles.set(role.id, role))
export const forgetRole = (client: Client, role: RoleReference) => changeRoles(client, role.guildId, roles => roles.delete(role.id))

/** Keep a channel or thread from an event, and return the thread the bot knew before, if any */
export function rememberChannel(client: Client, channel: GuildChannel) {
    const state = stateOf(client), previous = state.channels.get(channel.id)
    touch(state.channels, channel.id, channel, CHANNEL_LIMIT)
    return previous && isThreadChannel(previous) ? previous : undefined
}

/** A changed category can move its channels or change their permissions, so it forgets the server's channels */
export function updateChannel(client: Client, channel: GuildChannel) {
    if (channel.type === ChannelType.Category) forgetChannels(client, channel.guildId)
    else rememberChannel(client, channel)
}

/** Forget a deleted channel and the threads Fluxer deletes with it without thread events, and return those threads' IDs */
export function forgetChannel(client: Client, channel: GuildChannel) {
    if (channel.type === ChannelType.Category) {
        forgetChannels(client, channel.guildId)
        return []
    }
    const state = stateOf(client)
    const threadIds = [...state.channels.values()].filter(known => isThreadChannel(known) && known.parentId === channel.id).map(known => known.id)
    for (const id of [channel.id, ...threadIds]) state.channels.delete(id)
    return threadIds
}

export function forgetThread(client: Client, threadId: string) {
    stateOf(client).channels.delete(threadId)
}

/** Forget a server's channels and threads, as after a bulk channel change whose permissions Fluxer may still be copying */
export function forgetChannels(client: Client, guildId: string) {
    const state = stateOf(client)
    state.clock++
    for (const [id, channel] of state.channels) if (channel.guildId === guildId) state.channels.delete(id)
}

/** Forget a server that became available or unavailable or was left, since it may have changed unseen */
export function forgetServer(client: Client, guildId: string) {
    stateOf(client).servers.delete(guildId)
    forgetChannels(client, guildId)
}

/** Forget every server after a lost gateway connection, whose missed events a new session does not replay */
export function forgetAll(client: Client) {
    const state = stateOf(client)
    state.clock++
    state.servers.clear()
    state.channels.clear()
}

export class ChannelParentError extends Data.TaggedError("ChannelParentError")<{}> {}

function readKnownChannel(client: Client, channelId: string) {
    const local = fluxerlyNext(client)
    return local.channels.get(channelId).pipe(
        Effect.flatMap(known => known ? Effect.succeed(known) : local.channels.fetch(channelId, { timeoutMs: 5000 }).pipe(
            Effect.flatMap(channel => channel.id === channelId ? Effect.succeed(channel) : Effect.fail(new ChannelParentError())))))
}
/** The parent channel of a thread, or undefined for any other channel. A channel the bot does not hold costs one channel read */
export function readChannelParent(client: Client, channelId: string) {
    return readKnownChannel(client, channelId).pipe(Effect.map(channel => isThreadChannel(channel) ? channel.parentId : undefined))
}
/** The forum or media channel that holds a post, so a command in any post counts as in its forum. Any other channel is itself */
export function readCommandChannel(client: Client, channelId: string) {
    return readKnownChannel(client, channelId).pipe(Effect.flatMap(channel => !isThreadChannel(channel) ? Effect.succeed(channelId)
        : readKnownChannel(client, channel.parentId).pipe(Effect.map(parent => parent.type === ChannelType.Forum || parent.type === ChannelType.Media ? parent.id : channelId))))
}
