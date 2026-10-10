import assert from "node:assert/strict"
import test from "node:test"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import type { AfkStore } from "../src/afk-store.ts"
import { createOptionalWork, limitAfk, optionalWorkLimits } from "../src/optional-work.ts"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer())))
const allowed = (admit: ReturnType<typeof createOptionalWork>, kind: Parameters<typeof admit>[0], times: number) =>
    Effect.gen(function* () { let count = 0; for (let index = 0; index < times; index++) if (yield* admit(kind)) count++; return count })

test("each server spends its burst at once, then refills at its rate, without touching another server or another kind", () => run(Effect.gen(function* () {
    const busy = createOptionalWork(() => false), quiet = createOptionalWork(() => false)
    const { burst, perMinute } = optionalWorkLimits.responses
    assert.equal(yield* allowed(busy, "responses", burst + 10), burst)
    assert.equal(yield* allowed(busy, "afk", 1), 1)
    assert.equal(yield* allowed(quiet, "responses", 1), 1)
    yield* TestClock.adjust(60000 / perMinute)
    assert.equal(yield* allowed(busy, "responses", 5), 1)
    // A long quiet spell refills only up to the burst
    yield* TestClock.adjust("1 hour")
    assert.equal(yield* allowed(busy, "responses", burst + 10), burst)
    // Analytics counting costs no backend call per message, so only the bill guard stops it
    assert.equal(yield* allowed(busy, "analytics", 1000), 1000)
})))

test("a paused bill guard refuses every kind of optional work until it resumes", () => run(Effect.gen(function* () {
    let paused = true
    const admit = createOptionalWork(() => paused)
    for (const kind of ["afk", "responses", "levels", "analytics"] as const) assert.equal(yield* allowed(admit, kind, 1), 0)
    paused = false
    assert.equal(yield* allowed(admit, "levels", 1), 1)
})))

test("limited AFK skips the backend for a refused message and always sets a status", () => run(Effect.gen(function* () {
    const calls: string[] = []
    const store: AfkStore = {
        set: (userId, reason) => Effect.sync(() => { calls.push("set"); return { userId, reason, since: 0 } }),
        observe: () => Effect.sync(() => { calls.push("observe"); return { cleared: true, statuses: [] } }),
    }
    const limited = limitAfk(store, createOptionalWork(() => true))
    assert.deepEqual(yield* limited.observe("7", ["8"]), { cleared: false, statuses: [] })
    yield* limited.set("7", "Away")
    assert.deepEqual(calls, ["set"])
})))
