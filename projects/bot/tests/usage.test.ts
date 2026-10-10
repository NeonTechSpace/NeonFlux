import assert from "node:assert/strict"
import test from "node:test"
import type { ServiceUsage } from "@neonflux/contracts/service"
import { Effect, Logger, Queue, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { readCosts } from "../src/costs.ts"
import { createUsageGuard, startUsageReporter, usageReportMs } from "../src/usage.ts"
import { fakeClient } from "./backend-fake.ts"

const usage = (state: ServiceUsage["state"], calls: number, warn = false): ServiceUsage => ({ month: "2026-10", calls, budget: 1000, state, warn })

test("usage reports send the calls counted since the last accepted report, and their answers set the bill guard", async () => {
    const reported: number[] = []
    let answer: unknown = usage("normal", 10)
    const client = fakeClient(call => {
        assert.equal(call.path, "/service/usage")
        assert.equal(call.serverId, undefined)
        reported.push((call.body as { calls: number }).calls)
        return answer
    })
    const backend = { url: "https://synthetic-usage.invalid", secret: Redacted.make("synthetic-usage-secret-for-test-only"), client }
    const logs = Effect.runSync(Queue.unbounded<string>())
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const guard = createUsageGuard(), applied = yield* Queue.unbounded<ServiceUsage>()
        const observed = { ...guard, apply: (value: ServiceUsage) => guard.apply(value).pipe(Effect.andThen(Queue.offer(applied, value))) }
        const before = readCosts().backendRequests
        yield* startUsageReporter(backend, observed)
        yield* Queue.take(applied)
        assert.deepEqual(reported, [before])
        // A failed report keeps its calls, so the next one carries both reports' own calls
        answer = Response.json({ error: "Backend unavailable" }, { status: 503 })
        yield* TestClock.adjust(usageReportMs)
        assert.equal(yield* Queue.take(logs), "Backend usage could not be reported. The next report includes these calls")
        answer = usage("warning", 650, true)
        yield* TestClock.adjust(usageReportMs)
        yield* Queue.take(applied)
        assert.deepEqual(reported.slice(1), [1, 2])
        assert.equal(yield* Queue.take(logs), "Backend usage reached 650 of the 1000 backend calls budgeted for 2026-10")
        assert.equal(guard.paused(), false)
        answer = usage("paused", 900)
        yield* TestClock.adjust(usageReportMs)
        yield* Queue.take(applied)
        assert.equal(guard.paused(), true)
        assert.equal(yield* Queue.take(logs), "Optional work is paused at 900 of the 1000 backend calls budgeted for 2026-10. Moderation, protections and commands keep running")
        answer = usage("normal", 900)
        yield* TestClock.adjust(usageReportMs)
        yield* Queue.take(applied)
        assert.equal(guard.paused(), false)
        assert.equal(yield* Queue.take(logs), "Optional work resumed")
        assert.equal(Queue.sizeUnsafe(logs), 0)
    })).pipe(Effect.provide(Logger.layer([Logger.make(({ message }) => { Queue.offerUnsafe(logs, String(Array.isArray(message) ? message[0] : message)) })])),
        Effect.provide(TestClock.layer())))
    // Closing the scope sends one last report
    assert.equal(reported.length, 6)
})
