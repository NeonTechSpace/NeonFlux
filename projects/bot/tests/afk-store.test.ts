import assert from "node:assert/strict"
import { inspect } from "node:util"
import test from "node:test"
import { Deferred, Effect, Fiber, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createAfkStore } from "../src/afk-store.ts"
import { deriveServiceKey } from "../src/backend-http.ts"
import { mockBackend, type BackendCall } from "./backend-fake.ts"

const secret = "synthetic-neonflux-backend-secret-for-tests"
const userId = "123456789012345678"
const mentionedId = "123456789012345679"
const serverId = "123456789012345680"
const config = { url: "https://synthetic-test.convex.cloud", secret: Redacted.make(secret) }

test("AFK adapter calls its backend functions with the derived key and decodes their results", async (t) => {
    const calls: BackendCall[] = []
    mockBackend(t, (call) => {
        calls.push(call)
        return call.path === "/afk/set"
            ? { userId, reason: "Lunch", since: 1234 }
            : { cleared: true, statuses: [{ userId: mentionedId, reason: "Away", since: 1234 }] }
    })
    const store = createAfkStore(config, serverId)
    assert.deepEqual(await Effect.runPromise(store.set(userId, "Lunch")), { userId, reason: "Lunch", since: 1234 })
    assert.deepEqual(await Effect.runPromise(store.observe(userId, [mentionedId])), {
        cleared: true, statuses: [{ userId: mentionedId, reason: "Away", since: 1234 }],
    })
    assert.deepEqual(calls.map((call) => call.path), ["/afk/set", "/afk/observe"])
    for (const call of calls) {
        assert.equal(call.key, Redacted.value(deriveServiceKey(config.secret)))
        assert.ok(call.signal instanceof AbortSignal)
        assert.ok(!JSON.stringify(call).includes(secret))
    }
    assert.deepEqual(calls[0]!.body, { serverId, userId, reason: "Lunch" })
    assert.deepEqual(calls[1]!.body, { serverId, userId, mentionedUserIds: [mentionedId] })
})

test("Backend rejection, transport errors, broken replies, and malformed data fail once without exposing bodies or secrets", async (t) => {
    const privateBody = "synthetic-private-remote-body"
    const store = createAfkStore(config, serverId)
    const responses = [
        () => new Response(`${privateBody} ${secret}`, { status: 401 }),
        () => { throw new Error(`${privateBody} ${secret}`) },
        () => new Response(`${privateBody} ${secret}`, { status: 200 }),
        () => Response.json({ userId, reason: "", since: 1 }),
        () => Response.json({ userId: mentionedId, reason: "Lunch", since: 1 }),
        () => Response.json({ userId, reason: "Other", since: 1 }),
        () => Response.json({ userId, reason: "Lunch", since: -1 }),
        () => Response.json({ userId, reason: "Lunch", since: "bad" }),
    ]
    for (const respond of responses) {
        let count = 0
        const mock = mockBackend(t, () => { count += 1; return respond() })
        await assert.rejects(Effect.runPromise(store.set(userId, "Lunch")), (error: unknown) => {
            const output = `${String(error)} ${inspect(error)} ${JSON.stringify(error)}`
            assert.match(output, /AfkStoreError/)
            assert.ok(!output.includes(secret))
            assert.ok(!output.includes(privateBody))
            return true
        })
        assert.equal(count, 1)
        mock.mock.restore()
    }
    for (const payload of [
        { cleared: "true", statuses: [] },
        { cleared: false, statuses: [{ userId: serverId, reason: "Away", since: 1 }] },
        { cleared: false, statuses: Array.from({ length: 6 }, () => ({ userId: mentionedId, reason: "Away", since: 1 })) },
        { cleared: false, statuses: [{ userId: mentionedId, reason: "Away", since: 1 }, { userId: mentionedId, reason: "Away", since: 1 }] },
        { cleared: false, statuses: [{ userId: mentionedId, reason: "x".repeat(201), since: 1 }] },
    ]) {
        const mock = mockBackend(t, () => payload)
        await assert.rejects(Effect.runPromise(store.observe(userId, [mentionedId])), /AfkStoreError/)
        mock.mock.restore()
    }
})

test("five-second timeout aborts the backend request under a controlled clock", async (t) => {
    const started = Deferred.makeUnsafe<void>()
    let signal: AbortSignal | undefined
    mockBackend(t, async (call) => {
        signal = call.signal!
        await Effect.runPromise(Deferred.succeed(started, undefined))
        return await new Promise<never>((_resolve, reject) => {
            signal!.addEventListener("abort", () => reject(new Error("Synthetic abort")), { once: true })
        })
    })
    await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(createAfkStore(config, serverId).set(userId, "Lunch"))
        yield* Deferred.await(started)
        yield* TestClock.adjust("5 seconds")
        const exit = yield* Fiber.await(fiber)
        assert.equal(exit._tag, "Failure")
        assert.equal(signal?.aborted, true)
    }).pipe(Effect.provide(TestClock.layer())))
})

test("interrupting the adapter aborts its in-flight request", async (t) => {
    const started = Deferred.makeUnsafe<void>()
    let signal: AbortSignal | undefined
    mockBackend(t, async (call) => {
        signal = call.signal!
        await Effect.runPromise(Deferred.succeed(started, undefined))
        return await new Promise<never>((_resolve, reject) => {
            signal!.addEventListener("abort", () => reject(new Error("Synthetic abort")), { once: true })
        })
    })
    await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(createAfkStore(config, serverId).observe(userId, []))
        yield* Deferred.await(started)
        yield* Fiber.interrupt(fiber)
        assert.equal(signal?.aborted, true)
    }))
})
