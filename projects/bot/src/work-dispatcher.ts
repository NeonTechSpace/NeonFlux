import { Clock, Duration, Effect, Option, Queue, Redacted, Schema } from "effect"
import {
    ServiceWork,
    ServiceWorkSignal,
    type ServiceDashboardWork,
    ServiceWorkKind,
    type ServiceWorkRequest,
} from "@neonflux/contracts/service"
import type { BackendConfig } from "./config.ts"
import { createBackendRequest, deriveServiceKey } from "./backend-http.ts"
import { backendFunction } from "./backend-routes.ts"
import { convexBackendClient } from "./convex-client.ts"

/** Every worker kind, in the contract's order, so a reported kind is never skipped */
export const workKinds = ServiceWorkKind.literals
/** Without any other trigger, the dispatcher still asks the backend this often */
export const workSafetyPollMs = 120000
// Passes start at least this far apart, so a stream of new work costs at most one dispatch call every three seconds
export const workMinGapMs = 3000
/** Full pages are read back to back, up to this many per pass */
export const workPagesPerPass = 10
const workBackoffMaxMs = 300000
// The pause after consecutive failures, from 10 seconds doubling up to five minutes
export const workDelay = (failures: number) => Math.min(workBackoffMaxMs, 5000 * 2 ** failures)

const signalVersion = (value: unknown) =>
    Option.getOrUndefined(Schema.decodeUnknownOption(ServiceWorkSignal)(value))?.version

/** Carries the due times backend answers report from every runtime's requests to the one dispatcher */
export function createWorkNotices() {
    let listener: ((at: number) => void) | undefined
    return {
        report: (at: number) => listener?.(at),
        listen: (next: (at: number) => void) => {
            listener = next
            return () => {
                if (listener === next) listener = undefined
            }
        },
    }
}
type WorkNotices = ReturnType<typeof createWorkNotices>

/** passes names the dashboard passes with work, and undefined runs every pass */
type WorkWake = (
    serverId: string,
    kind: ServiceWorkKind,
    passes?: readonly ServiceDashboardWork[],
) => Effect.Effect<void>
// The one dispatcher for the whole process. It asks the backend which servers have due work and wakes those servers'
// workers, so a server without due work causes no backend requests. A pass runs at once when the work signal changes,
// when a time reported by a dispatch or a mutation answer arrives, and otherwise every two minutes. Wakes only signal a
// worker's queue, so every wake is delivered before the next page and a busy worker never holds the dispatcher
export function startWorkDispatcher(backend: BackendConfig, wake: WorkWake, notices?: WorkNotices) {
    const post = createBackendRequest(backend),
        client = backend.client ?? convexBackendClient(backend.url)
    return Effect.gen(function* () {
        const pokes = yield* Queue.dropping<void>(1)
        // Shared with the subscription and notice callbacks, which run outside this fiber and only set state and poke
        let pending = true,
            dueAt: number | undefined,
            version: number | undefined,
            pushFailed = false,
            // Set while the next pass only continues the pages of a pass that woke servers
            resume = false
        const poke = () => {
            Queue.offerUnsafe(pokes, undefined)
        }
        const subscribe = Effect.try(() =>
            client.subscribe(
                backendFunction("/service/work-signal"),
                { key: Redacted.value(deriveServiceKey(backend.secret)) },
                (value) => {
                    const next = signalVersion(value)
                    pushFailed = next === undefined
                    if (next !== undefined && next !== version) {
                        version = next
                        pending = true
                        resume = false
                    }
                    poke()
                },
                () => {
                    pushFailed = true
                    poke()
                },
            ),
        )
        yield* Effect.acquireRelease(
            subscribe.pipe(
                Effect.catch(() =>
                    Effect.sync(() => {
                        pushFailed = true
                        return () => {}
                    }),
                ),
            ),
            (stop) => Effect.sync(stop),
        )
        if (notices)
            yield* Effect.acquireRelease(
                Effect.sync(() =>
                    notices.listen((at) => {
                        dueAt = Math.min(dueAt ?? at, at)
                        resume = false
                        poke()
                    }),
                ),
                (stop) => Effect.sync(stop),
            )

        yield* Effect.gen(function* () {
            // probed is the pass that started the current backoff interval, once a changed signal has spent that interval's one early probe
            let lastPass: number | undefined,
                failures = 0,
                cursor: string | null = null,
                warned = false,
                probed: number | undefined
            for (;;) {
                const now = yield* Clock.currentTimeMillis
                if (pushFailed !== warned) {
                    warned = pushFailed
                    if (pushFailed)
                        yield* Effect.logWarning(
                            "Background work push is unavailable. Work still runs at its due times and at least every two minutes",
                        )
                }
                // During a backoff a changed work signal gets one early probe per interval, so new work, such as a dashboard job that
                // expires after two minutes, does not wait out a five-minute backoff when the backend is back
                const retry = lastPass === undefined ? now : lastPass + workDelay(failures)
                const probe = failures > 0 && pending && probed !== lastPass
                const target =
                    lastPass === undefined
                        ? now
                        : failures > 0
                          ? probe
                              ? Math.min(retry, Math.max(lastPass + workMinGapMs, now))
                              : retry
                          : Math.max(
                                lastPass + workMinGapMs,
                                Math.min(pending ? now : Infinity, dueAt ?? Infinity, lastPass + workSafetyPollMs),
                            )
                if (target > now) {
                    yield* Effect.raceFirst(Queue.take(pokes), Effect.sleep(Duration.millis(target - now)))
                    continue
                }
                if (probe && now < retry) probed = now
                // A cursor reads only the sources it names, so a pass that a signal or a due time started reads its first
                // page fresh and holds the cursor for the backend to go on with
                let held: string | null =
                    cursor !== null && !(resume && (dueAt === undefined || dueAt > now)) ? cursor : null
                if (held !== null) cursor = null
                lastPass = now
                pending = false
                resume = false
                dueAt = undefined
                let work: ServiceWork | undefined,
                    pages = 0,
                    woke = false
                do {
                    // requestedAt keeps each call distinct, so a cached result never hides work that became due since
                    const requestedAt = yield* Clock.currentTimeMillis
                    work = yield* post("/service/work", {
                        cursor,
                        ...(held === null ? {} : { held }),
                        requestedAt,
                    } satisfies ServiceWorkRequest).pipe(
                        Effect.flatMap(Schema.decodeUnknownEffect(ServiceWork)),
                        Effect.catch(() => Effect.succeed(undefined)),
                    )
                    if (!work) break
                    cursor = work.cursor
                    held = null
                    for (const kind of workKinds)
                        for (const serverId of work.kinds[kind]) {
                            woke = true
                            yield* Effect.exit(
                                wake(serverId, kind, kind === "dashboard" ? work.dashboard?.[serverId] : undefined),
                            )
                        }
                } while (cursor !== null && ++pages < workPagesPerPass)
                if (!work) {
                    failures++
                    // A rejected cursor must not repeat, so the next pass starts over
                    cursor = null
                    yield* Effect.logWarning(
                        `Background work dispatch is unavailable. Retrying in ${workDelay(failures) / 1000} seconds`,
                    )
                    continue
                }
                failures = 0
                const end = yield* Clock.currentTimeMillis
                if (work.nextDueIn !== null) dueAt = Math.min(dueAt ?? Infinity, end + work.nextDueIn)
                // Pages left after a pass that found work continue soon. Pages of rows no worker acts on wait for the next trigger
                // A signal during the pass set pending, so the next pass still reads fresh
                if (cursor !== null && woke) {
                    resume = !pending
                    pending = true
                }
            }
        }).pipe(Effect.forkScoped({ startImmediately: true }))
    }).pipe(Effect.asVoid)
}
