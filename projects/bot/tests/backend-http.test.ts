import assert from "node:assert/strict"
import test from "node:test"
import { Effect, Exit, Redacted } from "effect"
import type { BackendClient } from "../src/config.ts"
import { BackendRequestError, createBackendRequest, deriveServiceKey } from "../src/backend-http.ts"
import { BOT_FUNCTIONS } from "@neonflux/contracts/service"
import { backendFunction, backendKind, backendRoutes, type BackendPath } from "../src/backend-routes.ts"
import { fakeClient } from "./backend-fake.ts"

const secret = Redacted.make("synthetic-transport-secret-not-a-credential")
const url = "https://synthetic-transport.convex.cloud"
const status = async (effect: Effect.Effect<unknown, BackendRequestError>) => {
    const exit = await Effect.runPromiseExit(effect)
    assert(Exit.isFailure(exit))
    const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error
    assert(error instanceof BackendRequestError)
    return error.status
}

test("every path names one contract function, and queries and mutations keep their kind", () => {
    assert.equal(backendFunction("/general/manage"), "botService:generalManage")
    const names = (Object.keys(backendRoutes) as BackendPath[]).map(backendFunction)
    assert.equal(new Set(names).size, names.length)
    // Every function the contracts list has exactly one path, so no backend entry point is left unreachable
    assert.deepEqual(new Set(Object.values(backendRoutes)), new Set(Object.keys(BOT_FUNCTIONS)))
    assert.equal(backendKind("/general/get"), "query")
    assert.equal(backendKind("/general/manage"), "mutation")
})

test("requests call their function with the derived key, the bound server and the body", async () => {
    const calls: { kind: "query" | "mutation"; name: string; args: Record<string, unknown> }[] = []
    const client: BackendClient = {
        query: async (name, args) => {
            calls.push({ kind: "query", name, args })
            return { prefix: "?", revision: 1 }
        },
        mutation: async (name, args) => {
            calls.push({ kind: "mutation", name, args })
            return { revision: 2 }
        },
    }
    const request = createBackendRequest({ url, secret, serverId: "10", client })
    assert.deepEqual(await Effect.runPromise(request("/general/get", { serverId: "10", at: 0 })), {
        prefix: "?",
        revision: 1,
    })
    assert.deepEqual(await Effect.runPromise(request("/general/manage", { serverId: "10", prefix: "?" })), {
        revision: 2,
    })
    const key = Redacted.value(deriveServiceKey(secret))
    assert.deepEqual(calls, [
        {
            kind: "query",
            name: "botService:generalGet",
            args: { key, serverId: "10", request: { serverId: "10", at: 0 } },
        },
        {
            kind: "mutation",
            name: "botService:generalManage",
            args: { key, serverId: "10", request: { serverId: "10", prefix: "?" } },
        },
    ])
    assert.ok(!JSON.stringify(calls).includes(Redacted.value(secret)))
    // Requests that bind no server send none
    calls.length = 0
    await Effect.runPromise(createBackendRequest({ url, secret, client })("/service/scope", {}))
    assert.deepEqual(calls[0]!.args, { key, request: {} })
})

test("backend answers keep their statuses, and only a scope denial retires the runtime", async () => {
    let denied = 0
    const answers = new Map<number, Response>([
        [400, Response.json({ error: "Invalid request" }, { status: 400 })],
        [401, Response.json({ error: "Unauthorized" }, { status: 401 })],
        [404, Response.json({ error: "Not found" }, { status: 404 })],
        [409, Response.json({ error: "Conflict" }, { status: 409 })],
        [413, Response.json({ error: "Request too large" }, { status: 413 })],
        [429, Response.json({ error: "Capacity" }, { status: 429 })],
        [503, Response.json({ error: "Backend unavailable" }, { status: 503 })],
        [403, Response.json({ error: "Forbidden" }, { status: 403 })],
    ])
    for (const [expected, answer] of answers) {
        const request = createBackendRequest({
            url,
            secret,
            serverId: "10",
            client: fakeClient(() => answer.clone()),
            onScopeDenied: () => {
                denied++
            },
        })
        assert.equal(await status(request("/afk/set", { serverId: "10" })), expected)
    }
    assert.equal(denied, 0)
    const scope = createBackendRequest({
        url,
        secret,
        serverId: "10",
        client: fakeClient(() =>
            Response.json({ error: "Server not allowed", code: "NEONFLUX_SCOPE_DENIED" }, { status: 403 }),
        ),
        onScopeDenied: () => {
            denied++
        },
    })
    assert.equal(await status(scope("/general/get", { serverId: "10" })), 403)
    assert.equal(denied, 1)
    // Lost connections, broken replies and errors without a backend answer have no status
    for (const respond of [
        () => {
            throw new Error("Synthetic connection lost")
        },
        () => new Response("not json", { status: 200 }),
        () => {
            throw Object.assign(new Error("x"), { data: { status: 700, error: "x" } })
        },
    ]) {
        assert.equal(
            await status(createBackendRequest({ url, secret, client: fakeClient(respond) })("/service/scope", {})),
            null,
        )
    }
})

test("a retired runtime, a body for another server and an unknown path send nothing", async () => {
    let calls = 0
    const client = fakeClient(() => {
        calls++
        return {}
    })
    assert.equal(
        await status(
            createBackendRequest({ url, secret, serverId: "10", client, isActive: () => false })("/general/get", {
                serverId: "10",
            }),
        ),
        403,
    )
    assert.equal(
        await status(createBackendRequest({ url, secret, serverId: "10", client })("/general/get", { serverId: "20" })),
        403,
    )
    assert.equal(await status(createBackendRequest({ url, secret, serverId: "10", client })("/general/get", {})), 403)
    assert.equal(await status(createBackendRequest({ url, secret, client })("/general/unknown", {})), null)
    assert.equal(calls, 0)
})
