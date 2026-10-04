import assert from "node:assert/strict"
import { inspect } from "node:util"
import test from "node:test"
import { Deferred, Effect, Fiber, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createAfkStore } from "../src/afk-store.ts"

const secret = "synthetic-neonflux-backend-secret-for-tests"
const userId = "123456789012345678"
const mentionedId = "123456789012345679"
const serverId = "123456789012345680"
const config = { siteUrl: "https://synthetic-test.convex.site", secret: Redacted.make(secret) }

test("AFK HTTP adapter sends the agreed authenticated contract and decodes its responses", async (t) => {
    const requests: Array<{ url: string, options: RequestInit }> = []
    t.mock.method(globalThis, "fetch", async (input: URL, options: RequestInit) => {
        requests.push({ url: input.toString(), options })
        return Response.json(input.pathname === "/afk/set"
            ? { userId, reason: "Lunch", since: 1234 }
            : { cleared: true, statuses: [{ userId: mentionedId, reason: "Away", since: 1234 }] })
    })
    const store = createAfkStore(config, serverId)
    assert.deepEqual(await Effect.runPromise(store.set(userId, "Lunch")), { userId, reason: "Lunch", since: 1234 })
    assert.deepEqual(await Effect.runPromise(store.observe(userId, [mentionedId])), {
        cleared: true, statuses: [{ userId: mentionedId, reason: "Away", since: 1234 }],
    })
    assert.deepEqual(requests.map((request) => request.url), [
        "https://synthetic-test.convex.site/afk/set", "https://synthetic-test.convex.site/afk/observe",
    ])
    for (const request of requests) {
        assert.equal(request.options.method, "POST")
        assert.equal(request.options.redirect, "error")
        assert.ok(request.options.signal instanceof AbortSignal)
        assert.deepEqual(request.options.headers, { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" })
    }
    assert.deepEqual(JSON.parse(String(requests[0]!.options.body)), { serverId, userId, reason: "Lunch" })
    assert.deepEqual(JSON.parse(String(requests[1]!.options.body)), { serverId, userId, mentionedUserIds: [mentionedId] })
})

test("HTTP rejection, transport errors, invalid JSON, and malformed data fail once without exposing bodies or secrets", async (t) => {
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
        const mock = t.mock.method(globalThis, "fetch", async () => { count += 1; return respond() })
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
        const mock = t.mock.method(globalThis, "fetch", async () => Response.json(payload))
        await assert.rejects(Effect.runPromise(store.observe(userId, [mentionedId])), /AfkStoreError/)
        mock.mock.restore()
    }
})

test("five-second timeout aborts the HTTP operation under a controlled clock", async (t) => {
    const started = Deferred.makeUnsafe<void>()
    let signal: AbortSignal | undefined
    t.mock.method(globalThis, "fetch", async (_input: URL, options: RequestInit) => {
        signal = options.signal!
        await Effect.runPromise(Deferred.succeed(started, undefined))
        return await new Promise<Response>((_resolve, reject) => {
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

test("interrupting the HTTP adapter aborts its in-flight request", async (t) => {
    const started = Deferred.makeUnsafe<void>()
    let signal: AbortSignal | undefined
    t.mock.method(globalThis, "fetch", async (_input: URL, options: RequestInit) => {
        signal = options.signal!
        await Effect.runPromise(Deferred.succeed(started, undefined))
        return await new Promise<Response>((_resolve, reject) => {
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
