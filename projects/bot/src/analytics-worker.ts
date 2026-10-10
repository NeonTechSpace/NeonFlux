import type * as C from "@neonflux/backend/contracts"
import { isThreadChannel, type Client } from "@neontechspace/fluxerly/effect"
import { randomUUID } from "node:crypto"
import { Clock, Duration, Effect, Queue, Semaphore } from "effect"
import { AnalyticsStoreError, type AnalyticsStore } from "./analytics-store.ts"
import { fluxerlyNext, readChannelParent } from "./fluxerly-next.ts"

/** Counts wait in memory for one window after the first new count, or until they fill one request, then leave in requests of at most 500 buckets */
export const analyticsWindowMs = 300000
export const analyticsBatchLimit = 500
/** While analytics is off, member activity rereads the setting at most this often */
export const analyticsRecheckMs = 600000
/** An unacknowledged batch is resent each window for at most this long. The backend remembers applied batches for two days */
export const analyticsResendMs = 86400000
// Bound memory while the backend is unreachable. New buckets beyond the pending limit are dropped, and no new batch is formed while the outbox is full
const pendingLimit = 10000, outboxLimit = 20
const HOUR_MS = 3600000, DAY_MS = 86400000

export interface AnalyticsRecorder {
    message(channelId: string): Effect.Effect<void>
    join(): Effect.Effect<void>
    leave(): Effect.Effect<void>
    /** Apply a setting the bot just read or wrote, so counting stops or resumes at once */
    setEnabled(enabled: boolean): Effect.Effect<void>
    /** Send the counts held in memory now, so a summary read next includes them */
    flush(): Effect.Effect<void>
}

type Batch = { readonly createdAt: number, readonly request: C.AnalyticsRecordRequest }

export function startAnalyticsWorker(store: AnalyticsStore, serverId: string, client?: Client) {
    return Effect.gen(function* () {
        const signal = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" }), full = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" })
        const wake = Queue.offer(signal, undefined).pipe(Effect.asVoid)
        const hours = new Map<string, C.AnalyticsHourBucket>(), days = new Map<number, C.AnalyticsDayBucket>()
        // Each worker run is one session. Batches keep their sequence when resent, so the backend applies each once
        const session = randomUUID(), outbox: Batch[] = [], lock = Semaphore.makeUnsafe(1)
        let sequence = 0
        // Unknown counts as on, the default. The first flush response confirms it
        let enabled: boolean | undefined, checkedAt = 0, recheck = false
        const admit = Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            if (enabled !== false) return now
            if (!recheck && now - checkedAt >= analyticsRecheckMs) { recheck = true; yield* wake }
            return undefined
        })
        const added = Effect.suspend(() => hours.size + days.size >= analyticsBatchLimit ? Queue.offer(full, undefined) : Effect.void).pipe(Effect.andThen(wake))
        const addHour = (bucket: C.AnalyticsHourBucket) => {
            const key = `${bucket.channelId}:${bucket.hour}`, row = hours.get(key)
            if (row) row.count += bucket.count
            else if (hours.size + days.size < pendingLimit) hours.set(key, { ...bucket })
        }
        const addDay = (bucket: C.AnalyticsDayBucket) => {
            const row = days.get(bucket.day)
            if (row) { row.joins += bucket.joins; row.leaves += bucket.leaves }
            else if (hours.size + days.size < pendingLimit) days.set(bucket.day, { ...bucket })
        }
        const member = (kind: "joins" | "leaves") => Effect.gen(function* () {
            const now = yield* admit
            if (now === undefined) return
            addDay({ day: Math.floor(now / DAY_MS) * DAY_MS, joins: kind === "joins" ? 1 : 0, leaves: kind === "leaves" ? 1 : 0 })
            yield* added
        })
        // Messages in a thread count under its parent channel, from the channels the bot holds. Another channel costs one channel read, except
        // at shutdown, and a failed read counts it under its own ID this time and tries again next window
        const resolveParents = (read: boolean) => Effect.gen(function* () {
            const parents = new Map<string, string>()
            if (!client) return parents
            for (const id of new Set([...hours.values()].map(row => row.channelId))) {
                const parent = yield* (read ? readChannelParent(client, id)
                    : fluxerlyNext(client).channels.get(id).pipe(Effect.map(channel => channel && isThreadChannel(channel) ? channel.parentId : undefined)))
                    .pipe(Effect.catch(() => Effect.succeed(undefined)))
                if (parent) parents.set(id, parent)
            }
            return parents
        })
        // Moves the pending counts into numbered batches
        const cut = (resolve: boolean) => Effect.gen(function* () {
            yield* Queue.clear(full)
            if (outbox.length >= outboxLimit || !hours.size && !days.size) return
            const parents = yield* resolveParents(resolve)
            const merged = new Map<string, C.AnalyticsHourBucket>()
            for (const row of hours.values()) {
                const channelId = parents.get(row.channelId) ?? row.channelId, key = `${channelId}:${row.hour}`, previous = merged.get(key)
                merged.set(key, { channelId, hour: row.hour, count: (previous?.count ?? 0) + row.count })
            }
            const items: Array<{ hour: C.AnalyticsHourBucket } | { day: C.AnalyticsDayBucket }> = [...[...merged.values()].map(hour => ({ hour })), ...[...days.values()].map(day => ({ day }))]
            hours.clear(); days.clear()
            const createdAt = yield* Clock.currentTimeMillis
            for (let index = 0; index < items.length; index += analyticsBatchLimit) {
                const chunk = items.slice(index, index + analyticsBatchLimit)
                outbox.push({ createdAt, request: { serverId, session, sequence: ++sequence,
                    hours: chunk.flatMap(item => "hour" in item ? [item.hour] : []), days: chunk.flatMap(item => "day" in item ? [item.day] : []) } })
            }
        })
        // Returns whether a request was sent. An empty window costs nothing. Batches leave in sequence order, and an unavailable backend gets the
        // same batch again next window, so a batch saved before its reply was lost is not counted twice
        const flush = (resolve: boolean) => lock.withPermit(Effect.gen(function* () {
            yield* cut(resolve)
            let sent = false
            while (outbox.length) {
                const batch = outbox[0]!
                if ((yield* Clock.currentTimeMillis) - batch.createdAt > analyticsResendMs) {
                    outbox.shift()
                    yield* Effect.logWarning("Analytics counts that could not be saved for a day were dropped")
                    continue
                }
                sent = true
                const outcome = yield* store.record(batch.request).pipe(Effect.catch(error => Effect.succeed(error)))
                if (outcome instanceof AnalyticsStoreError) {
                    if (outcome.status === null || outcome.status === 429 || outcome.status >= 500) {
                        yield* Effect.logWarning("Analytics counts could not be saved. They are sent again in the next window")
                        return sent
                    }
                    // A refused batch would fail again
                    outbox.shift()
                    yield* Effect.logWarning("Analytics counts were refused and dropped")
                    continue
                }
                outbox.shift()
                enabled = outcome.enabled; checkedAt = yield* Clock.currentTimeMillis
                if (!outcome.enabled) { outbox.length = 0; return sent }
            }
            return sent
        }))
        // Best effort on shutdown, without a thread read. Registered before the loop, so closing interrupts the loop first and releases its lock.
        // A crash loses the counts of the open window and any unsent batches
        yield* Effect.addFinalizer(() => flush(false).pipe(Effect.catchCause(() => Effect.void), Effect.asVoid))
        yield* Effect.gen(function* () { for (;;) {
            yield* Queue.take(signal)
            // A window ends early once the pending counts fill one request, but never while an unsaved batch waits for the backend
            const window = Effect.sleep(Duration.millis(analyticsWindowMs))
            yield* outbox.length ? window : Effect.race(window, Queue.take(full))
            const sent = yield* flush(true)
            if (outbox.length) yield* wake
            if (sent || !recheck) continue
            const current = yield* store.settings({ serverId }).pipe(Effect.catch(() => Effect.succeed(undefined)))
            checkedAt = yield* Clock.currentTimeMillis; recheck = false
            if (current) enabled = current.enabled
        } }).pipe(Effect.forkScoped({ startImmediately: true }))
        return {
            message: channelId => Effect.gen(function* () {
                const now = yield* admit
                if (now === undefined) return
                addHour({ channelId, hour: Math.floor(now / HOUR_MS) * HOUR_MS, count: 1 })
                yield* added
            }),
            join: () => member("joins"),
            leave: () => member("leaves"),
            setEnabled: value => Clock.currentTimeMillis.pipe(Effect.map(now => {
                enabled = value; checkedAt = now; recheck = false
                if (!value) { hours.clear(); days.clear(); outbox.length = 0 }
            })),
            flush: () => flush(true).pipe(Effect.asVoid),
        } satisfies AnalyticsRecorder
    })
}
