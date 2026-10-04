import assert from "node:assert/strict"
import { test } from "node:test"
import { Effect, Option, Queue, Scheduler } from "effect"
import { startSignalledWorker } from "../src/signalled-worker.ts"

test("A failed pass reports its failure and the loop still runs on the next wake, also one the pass result asks for", async () => {
    // A dispatcher the test flushes by hand, so each wake has run to its end before the assertions look at it
    const dispatcher = new Scheduler.MixedScheduler("sync").makeDispatcher()
    const scheduler: Scheduler.Scheduler = {
        executionMode: "sync",
        shouldYield: () => false,
        makeDispatcher: () => dispatcher,
    }
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const started = yield* Queue.unbounded<number>(),
                    failures = yield* Queue.unbounded<string>()
                let passes = 0
                const worker = yield* startSignalledWorker(
                    Effect.gen(function* () {
                        passes++
                        yield* Queue.offer(started, passes)
                        if (passes === 1) return yield* Effect.fail("synthetic failure")
                        return passes === 2 ? ("more" as const) : ("done" as const)
                    }),
                    Queue.offer(failures, "failed").pipe(Effect.asVoid),
                    (result, wake) => (result === "more" ? wake : Effect.void),
                )
                yield* worker.wake
                dispatcher.flush()
                assert.deepEqual(yield* Queue.poll(started), Option.some(1))
                assert.deepEqual(yield* Queue.poll(failures), Option.some("failed"))
                yield* worker.wake
                dispatcher.flush()
                assert.deepEqual(yield* Queue.poll(started), Option.some(2))
                // The second pass asked for another one, and the third finished
                assert.deepEqual(yield* Queue.poll(started), Option.some(3))
            }),
        ).pipe(Effect.provideService(Scheduler.Scheduler, scheduler)),
    )
})
