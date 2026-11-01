import {
    renderCounter,
    type Counter,
    type CounterCountProblem,
    type CounterProblem,
    type CounterView,
} from "@neonflux/contracts/counters"
import { ChannelType, errors, format, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Effect, Fiber, Scope } from "effect"
import { contained, warnFailure } from "./contained.ts"
import type { CounterStore } from "./counter-store.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { postServerNote } from "./install-note.ts"

/**
 * How often a counter is checked. Fluxer's measured limit on renames, a bucket of 20 with a 0.5 second refill and no per-channel limit
 * in 14 renames over 24 seconds, allows far more, so the interval is chosen for the channel's noise and the audit log's volume
 */
export const COUNTER_INTERVAL_MS = 600000
/** Where a server's ten minutes start, so servers that start together do not all rename at once */
export const counterOffset = (serverId: string) => Number(BigInt(serverId) % BigInt(COUNTER_INTERVAL_MS))
/** Channels a counter can rename. A forum post or a thread is no lasting place for a count */
export const counterChannel = (channel: { type: unknown } | undefined) =>
    channel?.type === ChannelType.Voice ||
    channel?.type === ChannelType.Category ||
    channel?.type === ChannelType.Text ||
    channel?.type === ChannelType.Announcement
/** What stopped a counter, and its fix */
export const counterProblemText = (problem: CounterProblem, channelId: string) =>
    problem === "channel"
        ? `NeonFlux cannot find ${format.channelMention(channelId)}. Remove the counter and add one for another channel`
        : `NeonFlux lacks View channel or Manage channels in ${format.channelMention(channelId)}. Grant them`

/** The reason on a counter's rename, which tells its audit entry from NeonFlux's other renames */
export const COUNTER_AUDIT_REASON = "NeonFlux counter channel"
/** Whether a member search failed for a reason that lasts, which a later try does not fix by itself */
const countProblemOf = (failure: unknown): CounterCountProblem | undefined => {
    const { status, apiError } = (failure ?? {}) as { status?: unknown; apiError?: { code?: unknown } | null }
    return apiError?.code === "twoFactorRequired" ? "twoFactor" : status === 403 ? "permission" : undefined
}
type CountRead = { readonly count?: number; readonly problem?: CounterCountProblem }
/**
 * One role's member count from Fluxer's member search. While Fluxer builds its member index the count says nothing, so count is absent.
 * problem names a failure that lasts, and any other failed read is absent too
 */
export const readRoleCount = (client: Client, serverId: string, roleId: string) =>
    client.members.search(serverId, { roleIds: [roleId], limit: 1 }, { timeoutMs: 5000 }).pipe(
        Effect.map((page): CountRead => (page.indexing ? {} : { count: page.totalResultCount })),
        Effect.catchCause((cause) => {
            if (Cause.hasInterrupts(cause)) return Effect.failCause(cause)
            const problem = countProblemOf(Cause.squash(cause))
            return Effect.succeed<CountRead>(problem ? { problem } : {})
        }),
    )

type Outcome = { readonly name?: string; readonly problem?: CounterProblem; readonly uncertain?: true }

/**
 * One server's counters, kept in memory. They load once when the server starts and again after a change, so a server without
 * counters runs no timer and its checks cost no backend call. A check reads each count and the channel's name, and renames only
 * when the name would change. A rename with an unknown outcome is never sent again blindly: the next check reads the channel fresh
 * and shows it as not confirmed until then. A rename Fluxer refuses turns its counter off and tells the server
 */
export function createCounterRuntime(store: CounterStore, serverId: string) {
    let view: CounterView = { enabled: false, counters: [] },
        timer: Fiber.Fiber<unknown, unknown> | undefined,
        started: { client: Client; scope: Scope.Scope } | undefined
    // The name each channel took after a rename NeonFlux made, since Fluxer may normalize what it was sent
    const applied = new Map<string, { rendered: string; name: string }>()
    // The names of a rename NeonFlux just sent, as sent and as Fluxer answered, until its channel event arrives once
    const sent = new Map<string, Set<string>>()
    // Channels whose last rename has an unknown outcome
    const unsure = new Set<string>()

    const noteCountProblem = (counter: Counter, countProblem: CounterCountProblem | undefined) =>
        Effect.gen(function* () {
            if (counter.countProblem === countProblem) return
            yield* store.work({
                serverId,
                channelId: counter.channelId,
                template: counter.template,
                countProblem: countProblem ?? null,
            })
            view = {
                ...view,
                counters: view.counters.map((row) => {
                    if (row.channelId !== counter.channelId || row.template !== counter.template) return row
                    const { countProblem: _old, ...rest } = row
                    return countProblem ? { ...rest, countProblem } : rest
                }),
            }
        }).pipe(
            // A note that did not arrive is tried again at the next check
            Effect.catchCause((cause) => (Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.void)),
        )
    // One check reads each count once, whichever counters share it
    const readCount = (client: Client, counter: Counter, counts: Map<string, CountRead>) =>
        Effect.gen(function* () {
            const key = counter.roleId ?? "members"
            const read: CountRead =
                counts.get(key) ??
                (counter.roleId
                    ? yield* readRoleCount(client, serverId, counter.roleId)
                    : yield* client.guilds.fetchCounts([serverId], { timeoutMs: 5000 }).pipe(
                          Effect.map((result): CountRead => {
                              const count = result.counts[0]?.memberCount
                              return count === undefined ? {} : { count }
                          }),
                          Effect.catchCause((cause) =>
                              Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.succeed<CountRead>({}),
                          ),
                      ))
            counts.set(key, read)
            if (read.count !== undefined || read.problem) yield* noteCountProblem(counter, read.problem)
            return read.count
        })
    const readChannel = (client: Client, channelId: string) =>
        Effect.gen(function* () {
            const cached = unsure.has(channelId) ? undefined : yield* client.channels.get(channelId)
            return cached ?? (yield* client.channels.fetch(channelId, { timeoutMs: 5000 }))
        })
    const rename = (client: Client, counter: Counter, name: string) =>
        Effect.gen(function* () {
            sent.set(counter.channelId, new Set([name]))
            const channel = yield* client.channels.edit(
                counter.channelId,
                { name },
                { timeoutMs: 5000, auditReason: COUNTER_AUDIT_REASON },
            )
            unsure.delete(counter.channelId)
            applied.set(counter.channelId, { rendered: name, name: channel.name ?? name })
            if (channel.name) sent.get(counter.channelId)?.add(channel.name)
            return { name } as Outcome
        }).pipe(
            Effect.catchCause((cause) => {
                if (Cause.hasInterrupts(cause)) return Effect.failCause(cause)
                const failure = Cause.squash(cause)
                if (errors.isNotFound(failure)) return Effect.succeed<Outcome>({ problem: "channel" })
                if ((failure as { status?: unknown }).status === 403)
                    return Effect.succeed<Outcome>({ problem: "permission" })
                if (errors.outcome(cause) === "unknown") {
                    unsure.add(counter.channelId)
                    return Effect.succeed<Outcome>({ uncertain: true })
                }
                // A rate limit or a request that never left changed nothing, so the next check simply tries again
                sent.delete(counter.channelId)
                return Effect.succeed<Outcome>({})
            }),
        )
    const stop = (client: Client, counter: Counter, reason: CounterProblem) =>
        Effect.gen(function* () {
            sent.delete(counter.channelId)
            const { recorded } = yield* store.work({
                serverId,
                channelId: counter.channelId,
                template: counter.template,
                reason,
            })
            view = {
                ...view,
                counters: view.counters.map((row) =>
                    row.channelId === counter.channelId && row.template === counter.template
                        ? { ...row, enabled: false, problem: reason }
                        : row,
                ),
            }
            if (recorded)
                yield* postServerNote(
                    client,
                    serverId,
                    withPrefix(
                        `A counter is off. ${counterProblemText(reason, counter.channelId)}${reason === "permission" ? `, then turn it back on with \`!counter set ${format.channelMention(counter.channelId)} "${counter.template}"\`` : ""}`,
                        replyPrefix(serverId, serverId),
                    ),
                ).pipe(
                    Effect.catchCause((cause) =>
                        Cause.hasInterrupts(cause)
                            ? Effect.failCause(cause)
                            : warnFailure("A note about a stopped counter could not be posted", cause),
                    ),
                )
            return { problem: reason } as Outcome
        })
    /** One counter, read once. Nothing is renamed while a count or the channel cannot be read, and a gone channel turns it off */
    const check = (client: Client, counter: Counter, counts: Map<string, CountRead>) =>
        Effect.gen(function* () {
            const count = yield* readCount(client, counter, counts)
            if (count === undefined) return {} as Outcome
            const name = renderCounter(counter.template, count)
            const channel = yield* readChannel(client, counter.channelId).pipe(
                Effect.map((found) => ({ found })),
                Effect.catch((error) =>
                    Effect.succeed(errors.isNotFound(error) ? ("gone" as const) : ("unknown" as const)),
                ),
            )
            if (channel === "gone") return yield* stop(client, counter, "channel")
            if (channel === "unknown") return {} as Outcome
            // The fresh read settles a rename with an unknown outcome, whose channel event may never come
            if (unsure.delete(counter.channelId)) sent.delete(counter.channelId)
            const current = channel.found.name,
                last = applied.get(counter.channelId)
            if (current === name || (last?.rendered === name && last.name === current)) return { name } as Outcome
            const outcome = yield* rename(client, counter, name)
            return outcome.problem ? yield* stop(client, counter, outcome.problem) : outcome
        })
    const checkAll = (client: Client) =>
        contained(
            Effect.gen(function* () {
                if (!view.enabled) return
                const counts = new Map<string, CountRead>()
                for (const counter of view.counters) if (counter.enabled) yield* check(client, counter, counts)
            }),
            "Counter channels could not be checked",
        )
    const hasWork = () => view.enabled && view.counters.some((counter) => counter.enabled)
    // The timer runs only while a counter is on
    const syncTimer = Effect.gen(function* () {
        if (!started) return
        if (hasWork() && !timer) {
            const { client, scope } = started
            timer = yield* Effect.gen(function* () {
                yield* Effect.sleep(counterOffset(serverId))
                for (;;) {
                    yield* checkAll(client)
                    // The last counter NeonFlux turned off ends the timer
                    if (!hasWork()) {
                        timer = undefined
                        return
                    }
                    yield* Effect.sleep(COUNTER_INTERVAL_MS)
                }
            }).pipe(Effect.forkIn(scope, { startImmediately: true }))
        } else if (!hasWork() && timer) {
            const running = timer
            timer = undefined
            yield* Fiber.interrupt(running)
        }
    })
    const load = Effect.gen(function* () {
        view = yield* store.query({ serverId })
        yield* syncTimer
    })
    const runtime = {
        serverId,
        start: (client: Client) =>
            Effect.gen(function* () {
                started = { client, scope: yield* Effect.scope }
                counterRuntimes.set(serverId, runtime)
                yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                        if (counterRuntimes.get(serverId) === runtime) counterRuntimes.delete(serverId)
                    }),
                )
                yield* Effect.forkIn(
                    contained(load, "Counters could not be loaded. They wait for the next change"),
                    started.scope,
                )
            }),
        /** After a chat change: The new counters, and one check of them now, so a new name shows at once */
        changed: (client: Client, next: CounterView) =>
            Effect.gen(function* () {
                view = next
                yield* syncTimer
                yield* checkAll(client)
            }),
        /** After a dashboard change or a restored backup */
        reload: (client: Client) =>
            contained(
                Effect.andThen(load, checkAll(client)),
                "Counters could not be loaded. They wait for the next change",
            ),
        view: () => view,
        /** Whether a channel's last rename has an unknown outcome */
        uncertain: (channelId: string) => unsure.has(channelId),
        /** One check of a counter now, for the reply to a chat change */
        check: (client: Client, counter: Counter) => check(client, counter, new Map()),
        /** Whether a channel's new name is a rename NeonFlux just sent. Each rename answers once, so staff restoring that name later count as a change */
        takeRename: (channelId: string, name: string) => !!sent.get(channelId)?.has(name) && sent.delete(channelId),
    }
    return runtime
}
export type CounterRuntime = ReturnType<typeof createCounterRuntime>
/** Each running server's counters, so dashboard changes reach them and metadata logs can tell their renames apart */
export const counterRuntimes = new Map<string, CounterRuntime>()
