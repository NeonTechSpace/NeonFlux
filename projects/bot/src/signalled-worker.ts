import { Cause, Effect, Queue } from "effect"

/**
 * A background loop that runs `pass` once for each wake. Wakes that arrive during a pass collapse into one more pass,
 * and a failed pass runs `onFailure` and waits for the next wake. `after` sees the result of a finished pass and may wake
 * the loop again
 */
export function startSignalledWorker<A, E, R>(
    pass: Effect.Effect<A, E, R>,
    onFailure: Effect.Effect<void>,
    after?: (result: A, wake: Effect.Effect<void>) => Effect.Effect<void>,
) {
    return Effect.gen(function* () {
        const queue = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" })
        const wake = Queue.offer(queue, undefined).pipe(Effect.asVoid)
        yield* Effect.addFinalizer(() => Queue.shutdown(queue))
        yield* Effect.gen(function* () {
            for (;;) {
                yield* Queue.take(queue)
                yield* pass.pipe(
                    Effect.flatMap((result) => (after ? after(result, wake) : Effect.void)),
                    Effect.catchCause((cause) => (Cause.hasInterrupts(cause) ? Effect.failCause(cause) : onFailure)),
                )
            }
        }).pipe(Effect.forkScoped({ startImmediately: true }))
        return { wake }
    })
}
