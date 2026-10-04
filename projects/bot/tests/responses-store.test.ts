import assert from "node:assert/strict"
import { inspect } from "node:util"
import test from "node:test"
import type { ResponseDefinition, ResponseEvaluateRequest, ResponseManageRequest } from "@neonflux/backend/contracts"
import { Deferred, Effect, Fiber, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createResponseStore } from "../src/responses-store.ts"

const secret = "synthetic-neonflux-response-backend-secret"
const serverId = "123456789012345678"
const userId = "123456789012345679"
const messageId = "123456789012345680"
const channelId = "123456789012345681"
const config = { siteUrl: "https://synthetic-test.convex.site", secret: Redacted.make(secret) }
const management: ResponseManageRequest = {
    serverId, messageId, createdAt: 1234, actorId: userId, adminAuthorized: true,
    kind: "custom", operation: { type: "show", name: "rules" },
}
const evaluation: ResponseEvaluateRequest = {
    serverId, messageId, createdAt: 1234, channelId, userId, userName: "Synthetic User", roleIds: [serverId], content: "!rules raw args",
}
const definition: ResponseDefinition = {
    kind: "custom", name: "rules", reply: { type: "text", text: "Read rules" },
    channelIds: [], roleIds: [], cooldownSeconds: 5, priority: 0, enabled: true, createdAt: 1, updatedAt: 1,
}

test("responses HTTP boundary sends exact authenticated DTOs and decodes management and evaluation", async (t) => {
    const requests: Array<{ path: string, options: RequestInit }> = []
    t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
        requests.push({ path: url.pathname, options })
        return Response.json(url.pathname === "/responses/manage"
            ? { duplicate: false, type: "definition", definition }
            : url.pathname === "/responses/evaluate"
                ? { send: true, messageId, ruleName: "rules", reply: { type: "text", text: "Rendered" } }
                : { recorded: true })
    })
    const store = createResponseStore(config)
    assert.deepEqual(await Effect.runPromise(store.manage(management)), { duplicate: false, type: "definition", definition })
    assert.deepEqual(await Effect.runPromise(store.evaluate(evaluation)), { send: true, messageId, ruleName: "rules", reply: { type: "text", text: "Rendered" } })
    assert.deepEqual(requests.map((request) => request.path), ["/responses/manage", "/responses/evaluate"])
    assert.deepEqual(requests.map((request) => JSON.parse(String(request.options.body))), [management, evaluation])
    for (const request of requests) {
        assert.equal(request.options.method, "POST")
        assert.equal(request.options.redirect, "error")
        assert.ok(request.options.signal instanceof AbortSignal)
        assert.deepEqual(request.options.headers, { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" })
    }
})

test("response decoders reject mismatched identities, response limits and inconsistent management operations", async (t) => {
    const store = createResponseStore(config)
    const payloads = [
        { send: true, messageId: userId, ruleName: "rules", reply: { type: "text", text: "Hi" } },
        { send: true, messageId, ruleName: "rules", reply: { type: "text", text: "x".repeat(2001) } },
        { send: true, messageId, ruleName: "rules", reply: { type: "text", text: "\u000c\u202e" } },
        { send: true, messageId, ruleName: "rules", reply: { type: "embed", embed: { title: "x".repeat(257), description: "Hi" } } },
        { send: true, messageId, ruleName: "rules", reply: { type: "embed", embed: { title: "", description: "\u202e", color: 0xffffff } } },
        { send: true, messageId, ruleName: "rules", reply: { type: "embed", embed: { title: "", description: "Hi", color: 0x1000000 } } },
        { send: true, messageId, ruleName: "rules", reply: { type: "script", text: "invalid" } },
    ]
    for (const payload of payloads) {
        const mock = t.mock.method(globalThis, "fetch", async () => Response.json(payload))
        await assert.rejects(Effect.runPromise(store.evaluate(evaluation)), /ResponseStoreError/)
        mock.mock.restore()
    }
    const malformedManage = [
        { duplicate: false, type: "definition", definition: { ...definition, name: "another" } },
        { duplicate: false, type: "definition", definition: { ...definition, cooldownSeconds: 3601 } },
        { duplicate: false, type: "definition", definition: { ...definition, roleIds: [serverId, serverId] } },
        { duplicate: false, type: "definition", definition: { ...definition, kind: "auto" } },
        { duplicate: false, type: "deleted", kind: "custom", name: "rules" },
        { duplicate: false, type: "module", kind: "custom", enabled: true },
    ]
    for (const payload of malformedManage) {
        const mock = t.mock.method(globalThis, "fetch", async () => Response.json(payload))
        await assert.rejects(Effect.runPromise(store.manage(management)), /ResponseStoreError/)
        mock.mock.restore()
    }
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ duplicate: false, type: "list", kind: "custom", page: 1, totalPages: 1, total: 2, moduleEnabled: true, definitions: [definition] }))
    await assert.rejects(Effect.runPromise(store.manage({ ...management, operation: { type: "list" } })), /ResponseStoreError/)
    mock.mock.restore()
})

test("duplicate/no-send responses and valid basic embeds are accepted without inventing a send", async (t) => {
    const store = createResponseStore(config)
    let payload: unknown = { duplicate: true }
    t.mock.method(globalThis, "fetch", async () => Response.json(payload))
    assert.deepEqual(await Effect.runPromise(store.manage(management)), { duplicate: true })
    payload = { send: false }
    assert.deepEqual(await Effect.runPromise(store.evaluate(evaluation)), { send: false })
    payload = { send: true, messageId, ruleName: "rules", reply: { type: "embed", embed: { title: "", description: "Hi", color: 0 } } }
    assert.deepEqual(await Effect.runPromise(store.evaluate(evaluation)), payload)
})

test("response HTTP errors retain only safe operation/status and never retry or expose remote bodies", async (t) => {
    const store = createResponseStore(config)
    const privateBody = "synthetic-private-response-body"
    for (const status of [400, 403, 404, 409, 429, 500, 503]) {
        let count = 0
        const mock = t.mock.method(globalThis, "fetch", async () => { count++; return new Response(`${privateBody} ${secret}`, { status }) })
        await assert.rejects(Effect.runPromise(store.manage(management)), (error: unknown) => {
            const output = `${String(error)} ${inspect(error)} ${JSON.stringify(error)}`
            assert.match(output, /ResponseStoreError/)
            assert.ok(!output.includes(secret))
            assert.ok(!output.includes(privateBody))
            return true
        })
        assert.equal(count, 1)
        mock.mock.restore()
    }
    const mock = t.mock.method(globalThis, "fetch", async () => { throw new Error(`${privateBody} ${secret}`) })
    await assert.rejects(Effect.runPromise(store.evaluate(evaluation)), (error: unknown) => {
        assert.ok(!inspect(error).includes(secret))
        assert.ok(!inspect(error).includes(privateBody))
        return true
    })
    mock.mock.restore()
})

test("response HTTP timeout and interruption abort the external request using controlled synchronization", async (t) => {
    const store = createResponseStore(config)
    for (const timeout of [false, true]) {
        const started = Deferred.makeUnsafe<void>()
        let signal: AbortSignal | undefined
        const mock = t.mock.method(globalThis, "fetch", async (_url: URL, options: RequestInit) => {
            signal = options.signal!
            const pending = new Promise<Response>((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("Synthetic abort")), { once: true }))
            await Effect.runPromise(Deferred.succeed(started, undefined))
            return await pending
        })
        const program = Effect.gen(function* () {
            const fiber = yield* Effect.forkChild(store.evaluate(evaluation))
            yield* Deferred.await(started)
            if (timeout) { yield* TestClock.adjust("5 seconds"); yield* Fiber.await(fiber) }
            else yield* Fiber.interrupt(fiber)
            assert.equal(signal?.aborted, true)
        })
        await Effect.runPromise(timeout ? program.pipe(Effect.provide(TestClock.layer())) : program)
        mock.mock.restore()
    }
})
