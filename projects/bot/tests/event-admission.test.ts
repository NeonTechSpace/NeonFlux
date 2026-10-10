import assert from "node:assert/strict"
import test from "node:test"
import { Deferred, Effect, Fiber, Semaphore } from "effect"
import { createServerAdmission } from "../src/event-admission.ts"
import { readCosts } from "../src/costs.ts"

const record = (log: string[], name: string) => Effect.sync(() => { log.push(name) })

test("a starting server holds its events in order, and later arrivals wait behind them until it opens", async () => {
    await Effect.runPromise(Effect.gen(function* () {
        const log: string[] = [], admission = createServerAdmission(Semaphore.makeUnsafe(1))
        const gate = yield* Deferred.make<void>()
        yield* admission.admit(Deferred.await(gate).pipe(Effect.andThen(record(log, "first"))))
        yield* admission.admit(record(log, "second"))
        assert.deepEqual(log, [])
        const opening = yield* admission.open.pipe(Effect.forkChild({ startImmediately: true }))
        // The first held event is still running, so this one joins the end instead of overtaking
        yield* admission.admit(record(log, "third"))
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(opening)
        assert.deepEqual(log, ["first", "second", "third"])
        yield* admission.admit(record(log, "direct"))
        assert.deepEqual(log, ["first", "second", "third", "direct"])
    }))
})

test("a full backlog drops only that server's oldest event, and a held failure does not stop the rest", async () => {
    await Effect.runPromise(Effect.gen(function* () {
        const log: string[] = [], permits = Semaphore.makeUnsafe(1)
        const busy = createServerAdmission(permits, 3), quiet = createServerAdmission(permits, 3)
        const before = readCosts().eventsDropped
        yield* quiet.admit(record(log, "quiet"))
        for (const name of ["a", "b"]) yield* busy.admit(record(log, name))
        yield* busy.admit(Effect.fail("synthetic failure"))
        for (const name of ["c", "d"]) yield* busy.admit(record(log, name))
        assert.equal(readCosts().eventsDropped - before, 2)
        yield* busy.open
        yield* quiet.open
        assert.deepEqual(log, ["c", "d", "quiet"])
    }))
})

test("a retired server drops its held events and ignores later ones", async () => {
    await Effect.runPromise(Effect.gen(function* () {
        const log: string[] = [], admission = createServerAdmission(Semaphore.makeUnsafe(1))
        yield* admission.admit(record(log, "held"))
        admission.close()
        yield* admission.open
        yield* admission.admit(record(log, "late"))
        assert.deepEqual(log, [])
    }))
})
