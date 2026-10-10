import { Cause, Effect, type Semaphore } from "effect"
import { countHeldEventDropped } from "./costs.ts"

/** Events one server holds while its runtime starts. A fuller backlog drops that server's oldest held event, never another server's */
export const serverHeldEventLimit = 100

export interface ServerAdmission {
    /** Runs an event's work at once when the server is open and holds nothing, otherwise holds it behind the server's earlier events */
    admit(work: Effect.Effect<unknown, unknown>): Effect.Effect<unknown, unknown>
    /** Runs the held events in arrival order, then admits later events directly */
    readonly open: Effect.Effect<void>
    /** Drops the held events and every later one, for a retired runtime */
    close(): void
}

// Stands in for per-partition readiness in the SDK. Waiting inside a handler would hold one of the SDK's shared handler
// slots, and its bounded queue drops the oldest waiting event of any server when full, so a restart with many starting
// servers could stall or drop every server's events. Holding them here returns the slot at once. Once Fluxerly offers a
// readiness hook per partition, such as partitionReady(key), the SDK can hold a server's partition and this goes away.
// Held events run under the shared permits, so many servers opening together stay within the usual handler concurrency
export function createServerAdmission(permits: Semaphore.Semaphore, limit = serverHeldEventLimit): ServerAdmission {
    let state: "starting" | "draining" | "open" | "closed" = "starting"
    const held: Effect.Effect<unknown, unknown>[] = []
    return {
        admit: work => Effect.suspend(() => {
            if (state === "open") return work
            if (state === "closed") return Effect.void
            if (held.length >= limit) { held.shift(); countHeldEventDropped() }
            held.push(work)
            return Effect.void
        }),
        open: Effect.gen(function* () {
            if (state !== "starting") return
            state = "draining"
            // Events that arrive meanwhile join the end, so the server's order holds until nothing is left
            for (let next = held.shift(); next; next = held.shift()) {
                yield* permits.withPermit(next).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.logError("A held event failed", cause)))
            }
            if (state === "draining") state = "open"
        }),
        close: () => { state = "closed"; held.length = 0 },
    }
}
