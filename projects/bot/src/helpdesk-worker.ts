import type { HelpDeskSettings, HelpDeskWorkResult } from "@neonflux/contracts/helpdesk"
import {
    format,
    errors,
    ChannelFlags,
    ChannelType,
    ThreadAutoArchiveMinutes,
    type Client,
    type GuildChannel,
    type GuildThreadChannel,
    type ThreadCreateEvent,
} from "@neontechspace/fluxerly/effect"
import { Clock, Context, Effect, Scope } from "effect"
import { contained, forkContained, warnFailure } from "./contained.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import type { HelpDeskStore } from "./helpdesk-store.ts"
import { startSignalledWorker } from "./signalled-worker.ts"

const loadRetryMs = 60000
/** Threads one budget pass gives their channel's default auto-archive time. The rest wait for the next pass, ten minutes later */
export const helpDeskArchiveEditsPerPass = 25
/** Fluxer allows this many active threads per server */
export const helpDeskThreadCap = 1000
const archiveMinutes: readonly number[] = Object.values(ThreadAutoArchiveMinutes)

export type HelpDeskRuntime = ReturnType<typeof createHelpDeskRuntime>
/** Each running server's help desk runtime, so dashboard changes applied by the bot reach it */
export const helpDeskRuntimes = new Map<string, HelpDeskRuntime>()

/**
 * The help desk of one server. Settings are read once at startup and kept in memory, and the bot's own chat and dashboard
 * changes update them, so new posts and messages cost no backend read. A new post in a help desk forum gets the greeting,
 * and while reminders are on it is recorded once for its reminder, which the optional work limits and bill guard may skip
 */
export function createHelpDeskRuntime(store: HelpDeskStore, serverId: string, allowed: Effect.Effect<boolean>) {
    let settings: HelpDeskSettings | undefined,
        lastLoadAt = Number.NEGATIVE_INFINITY
    let client: Client | undefined, scope: Scope.Scope | undefined, services: Context.Context<never> | undefined
    const fork = <E, R>(effect: Effect.Effect<void, E, R>, warning: string) =>
        forkContained(effect, warning, scope, services)
    const load = Effect.gen(function* () {
        lastLoadAt = yield* Clock.currentTimeMillis
        settings = (yield* store.get({ serverId })).settings
    })
    const runtime = {
        serverId,
        start: (native: Client) =>
            Effect.gen(function* () {
                client = native
                scope = yield* Effect.scope
                services = yield* Effect.context<never>()
                helpDeskRuntimes.set(serverId, runtime)
                yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                        if (helpDeskRuntimes.get(serverId) === runtime) helpDeskRuntimes.delete(serverId)
                    }),
                )
                yield* contained(
                    load,
                    "Help desk settings could not be loaded. The help desk pauses until the backend answers",
                )
            }),
        /** The settings in memory, or undefined while they could not be loaded */
        settings: () => settings,
        saved: (next: HelpDeskSettings) =>
            Effect.sync(() => {
                settings = next
            }),
        /** After a dashboard change applied by the bot */
        reload: () => contained(load, "Help desk settings could not be refreshed"),
        /** A thread event. Only a post just created in a help desk forum gets the greeting and a reminder record */
        threadCreated: (thread: ThreadCreateEvent) =>
            Effect.gen(function* () {
                if (!thread.isNewlyCreated || thread.guildId !== serverId || !client) return
                if (!settings && (yield* Clock.currentTimeMillis) - lastLoadAt >= loadRetryMs)
                    yield* fork(
                        load,
                        "Help desk settings could not be loaded. The help desk pauses until the backend answers",
                    )
                const current = settings
                if (!current?.forumIds.includes(thread.parentId)) return
                const native = client
                if (current.greeting)
                    yield* fork(
                        native.messages.send(thread.id, { content: current.greeting }, { timeoutMs: 5000 }),
                        "A help desk greeting could not be posted",
                    )
                if (current.nudgeHours !== null && (yield* allowed))
                    yield* fork(
                        store.opened({ serverId, threadId: thread.id, forumId: thread.parentId }),
                        "A help post could not be recorded for its reply reminder",
                    )
            }),
    }
    return runtime
}

// A post gets its reminder only while it is open and nobody but its author and bots has written in its 50 newest messages
function remind(client: Client, serverId: string, threadId: string) {
    return Effect.gen(function* () {
        const thread = yield* client.channels.fetch(threadId, { timeoutMs: 5000 })
        if (!isOpenThread(thread)) return
        const history = yield* client.messages.fetchHistory(threadId, { limit: 50 }, { timeoutMs: 5000 })
        if (history.some((message) => message.author.id !== thread.ownerId && !message.author.isBot)) return
        yield* client.messages.send(
            threadId,
            {
                content: withPrefix(
                    `${format.userMention(thread.ownerId)} Nobody has replied to this post yet. Adding details, such as what you tried and any error text, helps others answer. Send !solved once it is answered`,
                    replyPrefix(serverId, serverId),
                ),
                allowedMentions: { users: [thread.ownerId], roles: [], everyone: false, repliedUser: false },
            },
            { timeoutMs: 5000 },
        )
    }).pipe(
        Effect.catchIf(
            (error) => errors.isNotFound(error),
            () => Effect.void,
        ),
    )
}
const isOpenThread = (channel: GuildChannel): channel is GuildThreadChannel =>
    (channel.type === ChannelType.PublicThread ||
        channel.type === ChannelType.PrivateThread ||
        channel.type === ChannelType.AnnouncementThread) &&
    !channel.archived &&
    !channel.locked

// Counts the server's active threads, gives threads their channel's stored default auto-archive time, which Fluxer keeps but
// does not apply, and warns staff near the cap. Changing a thread's time restarts its inactivity period. Pinned posts keep theirs
function budgetPass(
    store: HelpDeskStore,
    serverId: string,
    client: Client,
    guard: NonNullable<HelpDeskWorkResult["guard"]>,
) {
    return Effect.gen(function* () {
        const threads = yield* client.threads.fetchActive(serverId, { timeoutMs: 10000 })
        let more = false
        if (guard.autoArchive) {
            const defaults = new Map<string, number>()
            for (const channel of yield* client.channels.fetchAll(serverId, { timeoutMs: 10000 })) {
                const minutes = "defaultAutoArchiveMinutes" in channel ? channel.defaultAutoArchiveMinutes : undefined
                if (typeof minutes === "number" && archiveMinutes.includes(minutes)) defaults.set(channel.id, minutes)
            }
            const pending = threads.filter(
                (thread) =>
                    defaults.has(thread.parentId) &&
                    thread.autoArchiveMinutes !== defaults.get(thread.parentId) &&
                    ((thread.flags ?? 0) & ChannelFlags.Pinned) === 0,
            )
            let stopped = false
            for (const thread of pending.slice(0, helpDeskArchiveEditsPerPass)) {
                const refused = yield* client.threads
                    .edit(thread.id, { autoArchiveMinutes: defaults.get(thread.parentId)! }, { timeoutMs: 5000 })
                    .pipe(
                        Effect.as(undefined),
                        Effect.catch((error) =>
                            Effect.succeed((error as { status?: unknown }).status === 403 ? { error } : undefined),
                        ),
                    )
                // A refusal repeats for every edit, so the edits stop, and the count and the cap warning still follow. Only a missing
                // permission is cured by Manage threads, and another refusal, such as a bot that is timed out, must not be answered
                // with that fix
                if (refused) {
                    yield* warnFailure(
                        errors.apiCode(refused.error) === "missingPermissions"
                            ? "Help desk auto-archive needs Manage threads"
                            : "Fluxer refused help desk auto-archive edits for a reason other than a missing permission",
                        refused.error,
                    )
                    stopped = true
                    break
                }
            }
            more = !stopped && pending.length > helpDeskArchiveEditsPerPass
        }
        if (threads.length < guard.threshold && !more) return
        const report = yield* store.guard({ serverId, activeThreads: threads.length, more })
        if (report.warn && guard.channelId)
            yield* client.messages.send(
                guard.channelId,
                {
                    content: withPrefix(
                        `This server has ${threads.length} of Fluxer's ${helpDeskThreadCap} active threads. At the cap no new thread or forum post can start. Close answered help posts with !solved and archive threads that are done`,
                        replyPrefix(serverId, serverId),
                    ),
                },
                { timeoutMs: 5000 },
            )
    })
}

/** One work pass: due reply reminders, then a due thread budget pass */
export function processHelpDeskPass(store: HelpDeskStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const work = yield* store.work({ serverId })
        for (const nudge of work.nudges) yield* remind(client, serverId, nudge.threadId).pipe(Effect.ignore)
        if (work.guard)
            yield* contained(
                budgetPass(store, serverId, client, work.guard),
                "The help desk thread budget pass stopped",
            )
        return { more: work.more }
    })
}

export function startHelpDeskWorker(store: HelpDeskStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const { wake } = yield* startSignalledWorker(
            processHelpDeskPass(store, serverId, client),
            Effect.logWarning("Help desk work paused until the backend answers"),
            (result, again) => (result.more ? again : Effect.void),
        )
        // The work dispatcher wakes this worker when a reminder or a thread budget pass of this server is due
        return { notify: () => wake }
    })
}
