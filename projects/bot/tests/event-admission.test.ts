import assert from "node:assert/strict"
import test from "node:test"
import { Deferred, Effect, Fiber, Semaphore } from "effect"
import { createHeldEventBudget, createServerAdmission } from "../src/event-admission.ts"
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

test("the process budget caps every server's held events together, and a server makes room only from its own events", async () => {
    await Effect.runPromise(Effect.gen(function* () {
        const log: string[] = [], permits = Semaphore.makeUnsafe(1), budget = createHeldEventBudget(3)
        const first = createServerAdmission(permits, 100, budget), second = createServerAdmission(permits, 100, budget), third = createServerAdmission(permits, 100, budget)
        const before = readCosts().eventsDropped
        for (const name of ["a", "b"]) yield* first.admit(record(log, name))
        yield* second.admit(record(log, "c"))
        // Full: the second server drops its own oldest event, and the third, holding none, drops the new one
        yield* second.admit(record(log, "d"))
        yield* third.admit(record(log, "e"))
        assert.equal(readCosts().eventsDropped - before, 2)
        // A server that opens or retires returns its share of the budget
        yield* first.open
        third.close()
        yield* third.admit(record(log, "late"))
        yield* createServerAdmission(permits, 100, budget).admit(record(log, "f"))
        yield* second.open
        assert.deepEqual(log, ["a", "b", "d"])
        assert.equal(budget.full(), false)
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
