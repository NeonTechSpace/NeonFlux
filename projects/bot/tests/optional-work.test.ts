import assert from "node:assert/strict"
import test from "node:test"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import type { AfkStore } from "../src/afk-store.ts"
import { AfkStoreError } from "../src/afk-store.ts"
import { readCosts } from "../src/costs.ts"
import { createOptionalWork, MEMORY_MEMBERS, optionalWorkLimits, rememberAfk } from "../src/optional-work.ts"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer())))
const allowed = (admit: ReturnType<typeof createOptionalWork>, kind: Parameters<typeof admit>[0], times: number) =>
    Effect.gen(function* () {
        let count = 0
        for (let index = 0; index < times; index++) if (yield* admit(kind)) count++
        return count
    })

test("each server spends its burst at once, then refills at its rate, without touching another server or another kind", () =>
    run(
        Effect.gen(function* () {
            const busy = createOptionalWork(() => false),
                quiet = createOptionalWork(() => false)
            const { burst, perMinute } = optionalWorkLimits.responses
            assert.equal(yield* allowed(busy, "responses", burst + 10), burst)
            assert.equal(yield* allowed(busy, "afk", 1), 1)
            assert.equal(yield* allowed(quiet, "responses", 1), 1)
            yield* TestClock.adjust(60000 / perMinute)
            assert.equal(yield* allowed(busy, "responses", 5), 1)
            // A long quiet spell refills only up to the burst
            yield* TestClock.adjust("1 hour")
            assert.equal(yield* allowed(busy, "responses", burst + 10), burst)
            // Custom commands, AFK and XP have no bucket, so only the bill guard stops them
            for (const kind of ["custom", "afk", "levels", "analytics"] as const)
                assert.equal(yield* allowed(busy, kind, 1000), 1000)
        }),
    ))

test("a paused bill guard refuses every kind of optional work until it resumes", () =>
    run(
        Effect.gen(function* () {
            let paused = true
            const admit = createOptionalWork(() => paused)
            for (const kind of ["afk", "responses", "custom", "levels", "analytics"] as const)
                assert.equal(yield* allowed(admit, kind, 1), 0)
            paused = false
            assert.equal(yield* allowed(admit, "levels", 1), 1)
        }),
    ))

test("an autoresponder refusal for an empty bucket counts into the cost summary, and a paused guard does not", () =>
    run(
        Effect.gen(function* () {
            let paused = false
            const admit = createOptionalWork(() => paused),
                before = readCosts().optionalSkipped,
                { burst } = optionalWorkLimits.responses
            assert.equal(yield* allowed(admit, "responses", burst + 3), burst)
            assert.equal(readCosts().optionalSkipped - before, 3)
            paused = true
            assert.equal(yield* allowed(admit, "responses", 5), 0)
            assert.equal(yield* allowed(admit, "custom", 5), 0)
            assert.equal(readCosts().optionalSkipped - before, 3)
        }),
    ))

function afkBackend(statuses: Record<string, string> = {}, failing = false) {
    const calls: string[] = []
    const store: AfkStore = {
        set: (userId, reason) =>
            Effect.sync(() => {
                calls.push(`set ${userId}`)
                statuses[userId] = reason
                return { userId, reason, since: 0 }
            }),
        observe: (userId, mentions) =>
            failing
                ? Effect.fail(new AfkStoreError({ operation: "observe" }))
                : Effect.sync(() => {
                      calls.push(`observe ${userId} ${mentions.join(",")}`)
                      const cleared = userId in statuses
                      delete statuses[userId]
                      return {
                          cleared,
                          statuses: mentions.flatMap((id) =>
                              id in statuses ? [{ userId: id, reason: statuses[id]!, since: 0 }] : [],
                          ),
                      }
                  }),
    }
    return { store, calls, statuses }
}
const afkMemory = (backend: ReturnType<typeof afkBackend>, paused = () => false) =>
    rememberAfk(backend.store, createOptionalWork(paused))

test("AFK memory skips the backend for a message whose author and mentions are all known to have no status", () =>
    run(
        Effect.gen(function* () {
            const backend = afkBackend(),
                afk = afkMemory(backend)
            yield* afk.observe("7", ["8"])
            assert.deepEqual(backend.calls, ["observe 7 8"])
            // The author and the mention are known, so neither a repeat nor a message with no mention calls the backend
            for (const mentions of [["8"], [], ["8"]])
                assert.deepEqual(yield* afk.observe("7", mentions), { cleared: false, statuses: [] })
            assert.equal(backend.calls.length, 1)
            // One unknown mention is enough to ask
            yield* afk.observe("7", ["8", "9"])
            assert.equal(backend.calls.length, 2)
        }),
    ))

test("AFK memory forgets the author before a status is set, so a later message clears it and a mention names it", () =>
    run(
        Effect.gen(function* () {
            const backend = afkBackend(),
                afk = afkMemory(backend)
            yield* afk.observe("7", ["8"])
            yield* afk.set("7", "Away")
            assert.deepEqual(yield* afk.observe("8", ["7"]), {
                cleared: false,
                statuses: [{ userId: "7", reason: "Away", since: 0 }],
            })
            // A mention that has a status is never remembered as clear, and the author's own return clears it
            assert.deepEqual(yield* afk.observe("7", ["8"]), { cleared: true, statuses: [] })
            assert.deepEqual(backend.calls, ["observe 7 8", "set 7", "observe 8 7", "observe 7 8"])
            assert.deepEqual(yield* afk.observe("8", ["7"]), { cleared: false, statuses: [] })
            assert.equal(backend.calls.length, 4)
        }),
    ))

test("AFK memory adds nothing from a failed or paused observation", () =>
    run(
        Effect.gen(function* () {
            const failing = afkBackend({}, true)
            const failed = afkMemory(failing)
            assert.equal((yield* Effect.exit(failed.observe("7", ["8"])))._tag, "Failure")
            // The failed call left nobody remembered, so a message with no mention still asks the backend
            assert.equal((yield* Effect.exit(failed.observe("7", [])))._tag, "Failure")
            let paused = true
            const working = afkBackend(),
                guarded = afkMemory(working, () => paused)
            assert.deepEqual(yield* guarded.observe("7", ["8"]), { cleared: false, statuses: [] })
            paused = false
            yield* guarded.observe("7", ["8"])
            assert.deepEqual(working.calls, ["observe 7 8"])
        }),
    ))

test("AFK memory holds at most the memory bound and forgets the oldest member first", () =>
    run(
        Effect.gen(function* () {
            const backend = afkBackend(),
                afk = afkMemory(backend)
            for (let id = 1; id <= MEMORY_MEMBERS + 1; id++) yield* afk.observe(String(id), [])
            assert.equal(backend.calls.length, MEMORY_MEMBERS + 1)
            // The newest member is known, the oldest was evicted and costs one more call
            yield* afk.observe(String(MEMORY_MEMBERS + 1), [])
            assert.equal(backend.calls.length, MEMORY_MEMBERS + 1)
            yield* afk.observe("1", [])
            assert.equal(backend.calls.length, MEMORY_MEMBERS + 2)
        }),
    ))
