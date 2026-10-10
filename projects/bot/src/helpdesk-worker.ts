import type { HelpDeskSettings, HelpDeskWorkResult } from "@neonflux/contracts/helpdesk"
import { ChannelFlags, ChannelType, ThreadAutoArchiveMinutes, type Client, type GuildChannel, type GuildThreadChannel, type ThreadCreateEvent } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Context, Effect, Queue, Scope } from "effect"
import type { HelpDeskStore } from "./helpdesk-store.ts"
import { noMentions } from "./responses.ts"

const loadRetryMs = 60000
/** Threads one budget pass gives their channel's default auto-archive time. The rest wait for the next pass, ten minutes later */
export const helpDeskArchiveEditsPerPass = 25
/** Fluxer allows this many active threads per server */
export const helpDeskThreadCap = 1000
const archiveMinutes: readonly number[] = Object.values(ThreadAutoArchiveMinutes)

export type HelpDeskRuntime = ReturnType<typeof createHelpDeskRuntime>
/** Each running server's help desk runtime, so dashboard changes applied by the bot reach it */
export const helpDeskRuntimes = new Map<string, HelpDeskRuntime>()

const contained = <A, E, R>(effect: Effect.Effect<A, E, R>, warning: string) => effect.pipe(Effect.asVoid,
    Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning(warning)))

/**
 * The help desk of one server. Settings are read once at startup and kept in memory, and the bot's own chat and dashboard
 * changes update them, so new posts and messages cost no backend read. A new post in a help desk forum gets the greeting,
 * and while reminders are on it is recorded once for its reminder, which the optional work limits and bill guard may skip
 */
export function createHelpDeskRuntime(store: HelpDeskStore, serverId: string, allowed: Effect.Effect<boolean>) {
    let settings: HelpDeskSettings | undefined, lastLoadAt = Number.NEGATIVE_INFINITY
    let client: Client | undefined, scope: Scope.Scope | undefined, services: Context.Context<never> | undefined
    const fork = <E, R>(effect: Effect.Effect<void, E, R>, warning: string) => {
        const work = services ? Effect.provideContext(contained(effect, warning), services) : contained(effect, warning)
        return Effect.asVoid(scope ? Effect.forkIn(work, scope) : Effect.forkDetach(work))
    }
    const load = Effect.gen(function* () {
        lastLoadAt = yield* Clock.currentTimeMillis
        settings = (yield* store.get({ serverId })).settings
    })
    const runtime = {
        serverId,
        start: (native: Client) => Effect.gen(function* () {
            client = native; scope = yield* Effect.scope; services = yield* Effect.context<never>()
            helpDeskRuntimes.set(serverId, runtime)
            yield* Effect.addFinalizer(() => Effect.sync(() => { if (helpDeskRuntimes.get(serverId) === runtime) helpDeskRuntimes.delete(serverId) }))
            yield* contained(load, "Help desk settings could not be loaded. The help desk pauses until the backend answers")
        }),
        /** The settings in memory, or undefined while they could not be loaded */
        settings: () => settings,
        saved: (next: HelpDeskSettings) => Effect.sync(() => { settings = next }),
        /** After a dashboard change applied by the bot */
        reload: () => contained(load, "Help desk settings could not be refreshed"),
        /** A thread event. Only a post just created in a help desk forum gets the greeting and a reminder record */
        threadCreated: (thread: ThreadCreateEvent) => Effect.gen(function* () {
            if (!thread.isNewlyCreated || thread.guildId !== serverId || !client) return
            if (!settings && (yield* Clock.currentTimeMillis) - lastLoadAt >= loadRetryMs) yield* fork(load, "Help desk settings could not be loaded. The help desk pauses until the backend answers")
            const current = settings
            if (!current?.forumIds.includes(thread.parentId)) return
            const native = client
            if (current.greeting) yield* fork(native.messages.send(thread.id, { content: current.greeting, allowedMentions: noMentions }, { timeoutMs: 5000 }), "A help desk greeting could not be posted")
            if (current.nudgeHours !== null && (yield* allowed)) yield* fork(store.opened({ serverId, threadId: thread.id, forumId: thread.parentId }), "A help post could not be recorded for its reply reminder")
        }),
    }
    return runtime
}

// A post gets its reminder only while it is open and nobody but its author and bots has written in its 50 newest messages
function remind(client: Client, threadId: string) {
    return Effect.gen(function* () {
        const thread = yield* client.channels.fetch(threadId, { timeoutMs: 5000 })
        if (!isOpenThread(thread)) return false
        const history = yield* client.messages.fetchHistory(threadId, { limit: 50 }, { timeoutMs: 5000 })
        if (history.some(message => message.author.id !== thread.ownerId && !message.author.isBot)) return false
        yield* client.messages.send(threadId, { content: `<@${thread.ownerId}> Nobody has replied to this post yet. Adding details, such as what you tried and any error text, helps others answer. Send !solved once it is answered`,
            allowedMentions: { users: [thread.ownerId], roles: [], everyone: false, repliedUser: false } }, { timeoutMs: 5000 })
        return true
    }).pipe(Effect.catchIf(error => (error as { reason?: unknown }).reason === "notFound", () => Effect.succeed(false)))
}
const isOpenThread = (channel: GuildChannel): channel is GuildThreadChannel => (channel.type === ChannelType.PublicThread || channel.type === ChannelType.PrivateThread || channel.type === ChannelType.AnnouncementThread)
    && !channel.archived && !channel.locked

// Counts the server's active threads, gives threads their channel's stored default auto-archive time, which Fluxer keeps but
// does not apply, and warns staff near the cap. Changing a thread's time restarts its inactivity period. Pinned posts keep theirs
function budgetPass(store: HelpDeskStore, serverId: string, client: Client, guard: NonNullable<HelpDeskWorkResult["guard"]>) {
    return Effect.gen(function* () {
        const threads = yield* client.threads.fetchActive(serverId, { timeoutMs: 10000 })
        let more = false
        if (guard.autoArchive) {
            const defaults = new Map<string, number>()
            for (const channel of yield* client.channels.fetchAll(serverId, { timeoutMs: 10000 })) {
                const minutes = "defaultAutoArchiveMinutes" in channel ? channel.defaultAutoArchiveMinutes : undefined
                if (typeof minutes === "number" && archiveMinutes.includes(minutes)) defaults.set(channel.id, minutes)
            }
            const pending = threads.filter(thread => defaults.has(thread.parentId) && thread.autoArchiveMinutes !== defaults.get(thread.parentId) && ((thread.flags ?? 0) & ChannelFlags.Pinned) === 0)
            for (const thread of pending.slice(0, helpDeskArchiveEditsPerPass)) {
                const refused = yield* client.threads.edit(thread.id, { autoArchiveMinutes: defaults.get(thread.parentId)! }, { timeoutMs: 5000 }).pipe(
                    Effect.as(false), Effect.catch(error => Effect.succeed((error as { status?: unknown }).status === 403)))
                // Without Manage Threads every edit fails alike, so the pass stops and !health names the fix
                if (refused) return yield* Effect.logWarning("Help desk auto-archive needs Manage Threads")
            }
            more = pending.length > helpDeskArchiveEditsPerPass
        }
        if (threads.length < guard.threshold && !more) return
        const report = yield* store.guard({ serverId, activeThreads: threads.length, more })
        if (report.warn && guard.channelId) yield* client.messages.send(guard.channelId, {
            content: `This server has ${threads.length} of Fluxer's ${helpDeskThreadCap} active threads. At the cap no new thread or forum post can start. Close answered help posts with !solved and archive threads that are done`,
            allowedMentions: noMentions }, { timeoutMs: 5000 })
    })
}

/** One work pass: due reply reminders, then a due thread budget pass */
export function processHelpDeskPass(store: HelpDeskStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const work = yield* store.work({ serverId })
        let reminded = 0
        for (const nudge of work.nudges) if (yield* remind(client, nudge.threadId).pipe(Effect.catch(() => Effect.succeed(false)))) reminded++
        if (work.guard) yield* contained(budgetPass(store, serverId, client, work.guard), "The help desk thread budget pass stopped")
        return { reminded, more: work.more }
    })
}

export function startHelpDeskWorker(store: HelpDeskStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const queue = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" })
        const notify = () => Queue.offer(queue, undefined).pipe(Effect.asVoid)
        yield* Effect.gen(function* () {
            for (;;) {
                yield* Queue.take(queue)
                yield* processHelpDeskPass(store, serverId, client).pipe(Effect.flatMap(result => result.more ? notify() : Effect.void),
                    Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning("Help desk work paused until the backend answers")))
            }
        }).pipe(Effect.forkScoped({ startImmediately: true }))
        // The work dispatcher wakes this worker when a reminder or a thread budget pass of this server is due
        return { notify }
    })
}
