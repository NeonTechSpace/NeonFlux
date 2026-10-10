import { Clock, Duration, Effect, Queue, Redacted } from "effect"
import type { ServiceWork, ServiceWorkKind } from "@neonflux/backend/contracts"
import type { BackendConfig } from "./config.ts"
import { createBackendRequest, deriveServiceKey, rootBackend } from "./backend-http.ts"
import { backendFunction } from "./backend-routes.ts"
import { convexBackendClient } from "./convex-client.ts"
import { countBackendRequest } from "./costs.ts"
import { validServerId } from "./server-scope.ts"

export const workKinds = ["dashboard", "verification", "events", "schedules", "milestones", "suggestions", "cleanup", "metadata", "levels"] as const satisfies readonly ServiceWorkKind[]
const everyKind: [Exclude<ServiceWorkKind, typeof workKinds[number]>] extends [never] ? true : false = true
void everyKind
/** Without any other trigger, the dispatcher still asks the backend this often */
export const workSafetyPollMs = 120000
// Passes start at least this far apart, so a stream of new work costs at most one dispatch call every three seconds,
// fewer billed calls than the former five-second poll, which ran an HTTP action and a query each time
export const workMinGapMs = 3000
/** Full pages are read back to back, up to this many per pass */
export const workPagesPerPass = 10
export const workBackoffMaxMs = 300000
// The pause after consecutive failures, from 10 seconds doubling up to five minutes
export const workDelay = (failures: number) => Math.min(workBackoffMaxMs, 5000 * 2 ** failures)

function decodeWork(value: unknown): ServiceWork | undefined {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
    const { kinds, cursor, nextDueIn } = value as Partial<ServiceWork>
    if (cursor !== null && (typeof cursor !== "string" || !cursor.length || cursor.length > 4096)) return undefined
    if (nextDueIn !== null && (typeof nextDueIn !== "number" || !Number.isFinite(nextDueIn) || nextDueIn < 0)) return undefined
    if (kinds === null || typeof kinds !== "object") return undefined
    for (const kind of workKinds) {
        const serverIds: unknown = kinds[kind]
        if (!Array.isArray(serverIds) || serverIds.length > 100 || !serverIds.every(validServerId) || new Set(serverIds).size !== serverIds.length) return undefined
    }
    return { kinds, cursor, nextDueIn }
}
function signalVersion(value: unknown): number | undefined {
    const version = value !== null && typeof value === "object" ? (value as { version?: unknown }).version : undefined
    return typeof version === "number" && Number.isSafeInteger(version) && version >= 0 ? version : undefined
}

/** Carries the due times backend answers report from every runtime's requests to the one dispatcher */
export function createWorkNotices() {
    let listener: ((at: number) => void) | undefined
    return {
        report: (at: number) => listener?.(at),
        listen: (next: (at: number) => void) => {
            listener = next
            return () => { if (listener === next) listener = undefined }
        },
    }
}
export type WorkNotices = ReturnType<typeof createWorkNotices>

export type WorkWake = (serverId: string, kind: ServiceWorkKind) => Effect.Effect<void>
// The one dispatcher for the whole process. It asks the backend which servers have due work and wakes those servers'
// workers, so a server without due work causes no backend requests. A pass runs at once when the work signal changes,
// when a time reported by a dispatch or a mutation answer arrives, and otherwise every two minutes. Wakes only signal a
// worker's queue, so every wake is delivered before the next page and a busy worker never holds the dispatcher
export function startWorkDispatcher(backend: BackendConfig, wake: WorkWake, notices?: WorkNotices) {
    const root = rootBackend(backend), post = createBackendRequest(root), client = root.client ?? convexBackendClient(root.url)
    return Effect.gen(function* () {
        const pokes = yield* Queue.dropping<void>(1)
        // Shared with the subscription and notice callbacks, which run outside this fiber and only set state and poke
        let pending = true, dueAt: number | undefined, version: number | undefined, pushFailed = false
        const poke = () => { Queue.offerUnsafe(pokes, undefined) }
        const subscribe = Effect.try(() => client.subscribe(backendFunction("/service/work-signal"), { key: Redacted.value(deriveServiceKey(root.secret)) }, value => {
            countBackendRequest("/service/work-signal")
            const next = signalVersion(value)
            pushFailed = next === undefined
            if (next !== undefined && next !== version) { version = next; pending = true }
            poke()
        }, () => { pushFailed = true; poke() }))
        yield* Effect.acquireRelease(subscribe.pipe(Effect.catch(() => Effect.sync(() => { pushFailed = true; return () => {} }))), stop => Effect.sync(stop))
        if (notices) yield* Effect.acquireRelease(Effect.sync(() => notices.listen(at => { dueAt = Math.min(dueAt ?? at, at); poke() })), stop => Effect.sync(stop))

        yield* Effect.gen(function* () {
            let lastPass: number | undefined, failures = 0, cursor: string | null = null, warned = false
            for (;;) {
                const now = yield* Clock.currentTimeMillis
                if (pushFailed !== warned) {
                    warned = pushFailed
                    if (pushFailed) yield* Effect.logWarning("Background work push is unavailable. Work still runs at its due times and at least every two minutes")
                }
                const target = lastPass === undefined ? now : failures > 0 ? lastPass + workDelay(failures)
                    : Math.max(lastPass + workMinGapMs, Math.min(pending ? now : Infinity, dueAt ?? Infinity, lastPass + workSafetyPollMs))
                if (target > now) {
                    yield* Effect.raceFirst(Queue.take(pokes), Effect.sleep(Duration.millis(target - now)))
                    continue
                }
                lastPass = now
                pending = false
                dueAt = undefined
                let work: ServiceWork | undefined, pages = 0, woke = false
                do {
                    // requestedAt keeps each call distinct, so a cached result never hides work that became due since
                    const requestedAt = yield* Clock.currentTimeMillis
                    work = yield* post("/service/work", { cursor, requestedAt }).pipe(Effect.map(decodeWork), Effect.catch(() => Effect.succeed(undefined)))
                    if (!work) break
                    cursor = work.cursor
                    for (const kind of workKinds) for (const serverId of work.kinds[kind]) {
                        woke = true
                        yield* Effect.exit(wake(serverId, kind))
                    }
                } while (cursor !== null && ++pages < workPagesPerPass)
                if (!work) {
                    failures++
                    // A rejected cursor must not repeat, so the next pass starts over
                    cursor = null
                    yield* Effect.logWarning(`Background work dispatch is unavailable. Retrying in ${workDelay(failures) / 1000} seconds`)
                    continue
                }
                failures = 0
                const end = yield* Clock.currentTimeMillis
                if (work.nextDueIn !== null) dueAt = Math.min(dueAt ?? Infinity, end + work.nextDueIn)
                // Pages left after a pass that found work continue soon. Pages of rows no worker acts on wait for the next trigger
                if (cursor !== null && woke) pending = true
            }
        }).pipe(Effect.forkScoped({ startImmediately: true }))
    }).pipe(Effect.asVoid)
}
