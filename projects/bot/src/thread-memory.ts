import {
    isThreadChannel,
    type Client,
    type GuildChannel,
    type GuildThreadChannel,
} from "@neontechspace/fluxerly/effect"

// What the bot last saw of each thread, for metadata logs. The SDK's channel cache replaces a thread before a handler runs and
// Fluxer sends no previous values, so a thread update names its changed fields only against this copy. Fluxer also deletes a
// channel's threads with it without thread events, and the SDK's cache cannot say which threads that took.
// Doubt forgets them: a lost gateway connection of the server's shard, a server becoming available or unavailable, or a category
// or bulk channel change
const THREAD_LIMIT = 20000
interface Memory {
    readonly threads: Map<string, GuildThreadChannel>
    /** Counts every forget, so a read that overlapped one is not kept */
    forgets: number
}
const memories = new WeakMap<Client, Memory>()
const memoryOf = (client: Client) => {
    let memory = memories.get(client)
    if (!memory) memories.set(client, (memory = { threads: new Map(), forgets: 0 }))
    return memory
}

// An insertion moves an entry last, and one past the limit drops the first
function keep(memory: Memory, thread: GuildThreadChannel) {
    memory.threads.delete(thread.id)
    memory.threads.set(thread.id, thread)
    if (memory.threads.size > THREAD_LIMIT) memory.threads.delete(memory.threads.keys().next().value!)
}

/** Keep a thread from an event, and return the thread the bot knew before, if any */
export function rememberThread(client: Client, thread: GuildThreadChannel) {
    const memory = memoryOf(client),
        previous = memory.threads.get(thread.id)
    keep(memory, thread)
    return previous
}

/** The forget count to take before a read, which noticeThread compares */
export const threadForgets = (client: Client) => memoryOf(client).forgets

/** Keep a thread the bot read, unless an event taught it the thread already or something was forgotten since the read began */
export function noticeThread(client: Client, channel: GuildChannel, forgetsBefore: number) {
    const memory = memoryOf(client)
    if (isThreadChannel(channel) && memory.forgets === forgetsBefore && !memory.threads.has(channel.id))
        keep(memory, channel)
}

export function forgetThread(client: Client, threadId: string) {
    const memory = memoryOf(client)
    memory.forgets++
    memory.threads.delete(threadId)
}

/** Forget the threads Fluxer deletes with their parent channel without thread events, and return their IDs */
export function forgetThreadsOf(client: Client, parentId: string) {
    const memory = memoryOf(client)
    memory.forgets++
    const threadIds = [...memory.threads.values()]
        .filter((thread) => thread.parentId === parentId)
        .map((thread) => thread.id)
    for (const id of threadIds) memory.threads.delete(id)
    return threadIds
}

function forgetWhere(client: Client, forgotten: (thread: GuildThreadChannel) => boolean) {
    const memory = memoryOf(client)
    memory.forgets++
    for (const [id, thread] of memory.threads) if (forgotten(thread)) memory.threads.delete(id)
}

/** Forget a server's threads, as after a category or bulk channel change or when the server became available or unavailable */
export const forgetServerThreads = (client: Client, guildId: string) =>
    forgetWhere(client, (thread) => thread.guildId === guildId)

/** Forget the threads of the servers on a shard that lost its connection, since a new session or a resume does not replay its thread lists */
export const forgetShardThreads = (client: Client, shardId: number) =>
    forgetWhere(client, (thread) => client.shardIdForGuild(thread.guildId) === shardId)
