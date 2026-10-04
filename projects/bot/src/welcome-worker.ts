import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Exit, Fiber, Queue } from "effect"
import type { GreetingsStore } from "./welcome-store.ts"
import { greetingsBinding, processGreetingsCandidate } from "./welcome.ts"

export const greetingsCandidateBudget = 20
export function processGreetingsPass(store: GreetingsStore, serverId: string, client: Client, userId?: string) {
    return Effect.gen(function* () {
        let cursor: string | undefined
        let scanAt: number | undefined
        let considered = 0
        let nextWakeAt: number | undefined
        do {
            const page = yield* store.pending({ serverId, ...(userId ? { userId } : {}), ...(cursor ? { cursor, scanAt: scanAt! } : {}) })
            scanAt = page.scanAt
            const now = yield* Clock.currentTimeMillis
            // Due waiting rows outside this bounded discovery pass need a later pass, not a zero-delay scan loop.
            const eligibilityWake = page.nextCheckAt === undefined ? undefined : Math.max(page.nextCheckAt, now + (page.nextCheckAt <= now ? 60000 : 0))
            if (page.nextClaimAt > now) return { considered, nextWakeAt: page.candidates.length ? page.nextClaimAt : Math.max(page.nextClaimAt, eligibilityWake ?? 0) }
            for (const candidate of page.candidates) {
                if (considered >= greetingsCandidateBudget) return { considered, nextWakeAt: (yield* Clock.currentTimeMillis) + 60000 }
                considered++
                const result = yield* Effect.exit(processGreetingsCandidate(store, serverId, client, candidate))
                if (Exit.isFailure(result) && Cause.hasInterrupts(result.cause)) return yield* Effect.failCause(result.cause)
                if (Exit.isFailure(result)) {
                    // Only unclaimed candidates can defer. An already reserved delivery cannot replay.
                    yield* store.defer({ ...greetingsBinding(serverId, candidate), reason: "eligibility" }).pipe(Effect.catchCause((cause) => Cause.hasInterrupts(cause)
                        ? Effect.failCause(cause) : Effect.logWarning("Greeting eligibility deferred. Inspect delivery status for claimed uncertainty")))
                }
                // Fetch the next server pacing bound before considering another write.
                const pace = yield* store.pending({ serverId, ...(userId ? { userId } : {}) })
                if (pace.nextClaimAt > (yield* Clock.currentTimeMillis)) return { considered, nextWakeAt: pace.nextClaimAt }
            }
            nextWakeAt = eligibilityWake
            cursor = page.nextCursor
        } while (cursor && considered < greetingsCandidateBudget)
        return { considered, ...(cursor ? { nextWakeAt: (yield* Clock.currentTimeMillis) + 60000 } : nextWakeAt !== undefined ? { nextWakeAt } : {}) }
    })
}

export function startGreetingsWorker(store: GreetingsStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const queue = yield* Queue.make<string>({ capacity: 1001, strategy: "dropping" })
        const pending = new Set<string>()
        let timer: Fiber.Fiber<void, never> | undefined
        let scheduledAt: number | undefined
        let discoveryCursor: string | undefined
        let discoveryScanAt: number | undefined
        const notify = (userId?: string) => Effect.gen(function* () {
            const key = userId ?? "server"
            if (pending.has(key)) return
            pending.add(key)
            if (!(yield* Queue.offer(queue, key))) pending.delete(key)
        })
        const worker = Effect.gen(function* () {
            for (;;) {
                const key = yield* Queue.take(queue)
                pending.delete(key)
                const result = yield* Effect.gen(function* () {
                    if (discoveryScanAt !== undefined && (yield* Clock.currentTimeMillis) - discoveryScanAt >= 86400000) {
                        discoveryCursor = undefined; discoveryScanAt = undefined
                    }
                    let cursor = key === "server" ? discoveryCursor : undefined
                    let scanAt = key === "server" ? discoveryScanAt : undefined
                    for (let pages = 0; pages < 2; pages++) {
                        const found = yield* store.discover({ serverId, ...(key !== "server" ? { userId: key } : {}), ...(cursor ? { cursor, scanAt: scanAt! } : {}) })
                        scanAt = found.scanAt
                        cursor = found.nextCursor
                        if (!cursor) break
                    }
                    if (key === "server") { discoveryCursor = cursor; discoveryScanAt = cursor ? scanAt : undefined }
                    const pass = yield* processGreetingsPass(store, serverId, client, key === "server" ? undefined : key)
                    return cursor ? { ...pass, nextWakeAt: Math.min(pass.nextWakeAt ?? Infinity, (yield* Clock.currentTimeMillis) + 60000) } : pass
                }).pipe(Effect.catchCause((cause) => Cause.hasInterrupts(cause)
                    ? Effect.failCause(cause) : Effect.sync(() => { if (key === "server") { discoveryCursor = undefined; discoveryScanAt = undefined } }).pipe(
                        Effect.andThen(Effect.logWarning("Greeting worker paused. Retained delivery status remains available")),
                        Effect.andThen(Clock.currentTimeMillis), Effect.map((now) => ({ considered: 0, nextWakeAt: now + 60000 })))))
                if (result && result.nextWakeAt !== undefined && (scheduledAt === undefined || result.nextWakeAt < scheduledAt)) {
                    if (timer) yield* Fiber.interrupt(timer)
                    scheduledAt = result.nextWakeAt
                    const wait = Math.max(0, result.nextWakeAt - (yield* Clock.currentTimeMillis))
                    timer = yield* Effect.sleep(`${wait} millis`).pipe(Effect.andThen(Effect.sync(() => { scheduledAt = undefined })),
                        Effect.andThen(notify()), Effect.forkScoped({ startImmediately: true }))
                }
            }
        })
        yield* worker.pipe(Effect.forkScoped({ startImmediately: true }))
        yield* notify()
        return { notify }
    })
}
