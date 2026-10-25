import type { Client, Guild, GuildChannel, GuildMember, GuildRole } from "@neontechspace/fluxerly/effect"

// What the bot last saw of each role, channel, server and member, for metadata logs. The SDK's caches hold the new state
// before a handler runs and Fluxer sends no earlier values, so an update names its changed values only against these
// copies. They are the frozen snapshots the SDK delivered, kept within the same bounds the bot gives the SDK's caches.
// Doubt forgets them: a server becoming available or unavailable, or a category or bulk channel change. Channels and
// members are learned from events only, since the SDK cannot list a server's cached channels, so their first change after
// a start has no earlier values. Threads stay in thread-memory.ts
const LIMITS = { roles: 50000, channels: 20000, guilds: 5000, members: 20000 } as const

/** A bounded map that also lists its keys by server, so forgetting one server reads only that server's entries */
function serverMap<T extends { readonly guildId: string }>(limit: number) {
    const entries = new Map<string, T>(),
        byServer = new Map<string, Set<string>>()
    const remove = (key: string) => {
        const old = entries.get(key)
        if (!old) return undefined
        entries.delete(key)
        const keys = byServer.get(old.guildId)
        keys?.delete(key)
        if (keys && !keys.size) byServer.delete(old.guildId)
        return old
    }
    return {
        // An insertion moves an entry last, and one past the limit drops the first. Returns the entry it replaced
        keep: (key: string, value: T) => {
            const previous = remove(key)
            entries.set(key, value)
            let keys = byServer.get(value.guildId)
            if (!keys) byServer.set(value.guildId, (keys = new Set()))
            keys.add(key)
            if (entries.size > limit) remove(entries.keys().next().value!)
            return previous
        },
        delete: (key: string) => void remove(key),
        forgetServer: (guildId: string) => {
            for (const key of byServer.get(guildId) ?? []) entries.delete(key)
            byServer.delete(guildId)
        },
    }
}
interface Memory {
    readonly roles: ReturnType<typeof serverMap<GuildRole>>
    readonly channels: ReturnType<typeof serverMap<GuildChannel>>
    readonly guilds: Map<string, Guild>
    /** Keyed by server and user ID */
    readonly members: ReturnType<typeof serverMap<GuildMember>>
}
const memories = new WeakMap<Client, Memory>()
const memoryOf = (client: Client) => {
    let memory = memories.get(client)
    if (!memory)
        memories.set(
            client,
            (memory = {
                roles: serverMap(LIMITS.roles),
                channels: serverMap(LIMITS.channels),
                guilds: new Map(),
                members: serverMap(LIMITS.members),
            }),
        )
    return memory
}
const memberKey = (guildId: string, userId: string) => `${guildId}:${userId}`

/** Keep a role from an event, and return the role the bot knew before, if any */
export const rememberRole = (client: Client, role: GuildRole) => memoryOf(client).roles.keep(role.id, role)
/** Keep a channel other than a thread from an event, and return the channel the bot knew before, if any */
export const rememberChannel = (client: Client, channel: GuildChannel) =>
    memoryOf(client).channels.keep(channel.id, channel)
/** Keep a server from an event, and return the server the bot knew before, if any */
export const rememberGuild = (client: Client, guild: Guild) => {
    const { guilds } = memoryOf(client),
        previous = guilds.get(guild.id)
    guilds.delete(guild.id)
    guilds.set(guild.id, guild)
    if (guilds.size > LIMITS.guilds) guilds.delete(guilds.keys().next().value!)
    return previous
}
/** Keep a member from an event or a message, and return the member the bot knew before, if any */
export const rememberMember = (client: Client, member: GuildMember) =>
    memoryOf(client).members.keep(memberKey(member.guildId, member.userId), member)

export const forgetRole = (client: Client, roleId: string) => memoryOf(client).roles.delete(roleId)
export const forgetChannel = (client: Client, channelId: string) => memoryOf(client).channels.delete(channelId)
export const forgetMember = (client: Client, guildId: string, userId: string) =>
    memoryOf(client).members.delete(memberKey(guildId, userId))

/** Forget a server's channels, as after a category or bulk channel change */
export const forgetServerChannels = (client: Client, guildId: string) => memoryOf(client).channels.forgetServer(guildId)

/** Forget everything kept of a server, as when it became available or unavailable */
export function forgetServerResources(client: Client, guildId: string) {
    const memory = memoryOf(client)
    memory.channels.forgetServer(guildId)
    memory.guilds.delete(guildId)
    memory.roles.forgetServer(guildId)
    memory.members.forgetServer(guildId)
}

/** Start a server's memory again from the server Fluxer just sent and the roles the SDK holds for it */
export function seedServerResources(client: Client, guild: Guild, roles: readonly GuildRole[] | undefined) {
    forgetServerResources(client, guild.id)
    rememberGuild(client, guild)
    for (const role of roles ?? []) rememberRole(client, role)
}
