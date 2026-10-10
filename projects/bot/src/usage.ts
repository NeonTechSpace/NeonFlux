import { ServiceUsage, type ServiceUsageRequest } from "@neonflux/contracts/service"
import { Duration, Effect, Schema } from "effect"
import { createBackendRequest, rootBackend } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { readCosts } from "./costs.ts"

/** The bot reports its billed calls this often, so the bill guard costs one call every five minutes */
export const usageReportMs = 300000

/** The bill guard state from the latest usage report. Optional work stops while it is paused */
export function createUsageGuard() {
    let state: ServiceUsage["state"] = "normal"
    return {
        paused: () => state === "paused",
        apply: (usage: ServiceUsage) => Effect.gen(function* () {
            const reached = `${usage.calls} of the ${usage.budget} backend calls budgeted for ${usage.month}`
            if (usage.warn) yield* Effect.logWarning(`Backend usage reached ${reached}`)
            if (usage.state === "paused" && state !== "paused") yield* Effect.logWarning(`Optional work is paused at ${reached}. Moderation, protections and commands keep running`)
            if (usage.state !== "paused" && state === "paused") yield* Effect.logInfo("Optional work resumed")
            state = usage.state
        }),
    }
}
export type UsageGuard = ReturnType<typeof createUsageGuard>

// Reports the process's billed calls since the last accepted report, at startup, every five minutes and on shutdown. The
// answer carries the guard state, so checking it costs nothing more. A failed report keeps its calls for the next one, and
// a report whose answer was lost may be counted twice, which errs toward pausing early
export function startUsageReporter(backend: BackendConfig, guard: UsageGuard) {
    const post = createBackendRequest(rootBackend(backend))
    let reported = 0, failing = false
    const report = Effect.gen(function* () {
        const counted = readCosts().backendRequests
        const usage = yield* post("/service/usage", { calls: counted - reported } satisfies ServiceUsageRequest).pipe(Effect.flatMap(Schema.decodeUnknownEffect(ServiceUsage)),
            Effect.catch(() => Effect.succeed(undefined)))
        if (!usage) {
            if (!failing) yield* Effect.logWarning("Backend usage could not be reported. The next report includes these calls")
            failing = true
            return
        }
        failing = false
        reported = counted
        yield* guard.apply(usage)
    })
    return Effect.gen(function* () {
        // Registered before the loop, so closing interrupts the loop first
        yield* Effect.addFinalizer(() => report.pipe(Effect.catchCause(() => Effect.void)))
        yield* Effect.gen(function* () {
            for (;;) {
                yield* report
                yield* Effect.sleep(Duration.millis(usageReportMs))
            }
        }).pipe(Effect.forkScoped({ startImmediately: true }))
    })
}
