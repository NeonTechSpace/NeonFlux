import assert from "node:assert/strict"
import { createRequire, syncBuiltinESMExports } from "node:module"
import { pathToFileURL } from "node:url"
import type { TestContext } from "node:test"
import net from "node:net"
import tls from "node:tls"
import dgram from "node:dgram"
import { convexTest, type TestConvex } from "convex-test"
import schema from "../convex/schema.ts"

// Node isolates each test file, so these adapter tests never read real configuration
for (const key of Object.keys(process.env)) delete process.env[key]
process.env.GOMAXPROCS = "1"
process.env.UV_THREADPOOL_SIZE = "1"
const secret = "synthetic-adapter-secret-not-a-credential-0000"
process.env.NEONFLUX_SERVER_ID = "1"
process.env.NEONFLUX_BOT_API_SECRET = secret

type Modules = Record<string, () => Promise<unknown>>
const baseModules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"),
    "../convex/http.ts": () => import("../convex/http.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}

export async function adapterFixture(t: TestContext, modules: Modules, scopeEnvironment?: Readonly<Record<string, string | undefined>>, controlTimers = true) {
    const scopeKeys = ["NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_IDS"] as const
    const previousScope = Object.fromEntries(scopeKeys.map(key => [key, process.env[key]]))
    for (const key of scopeKeys) {
        const value = scopeEnvironment ? scopeEnvironment[key] : key === "NEONFLUX_SERVER_ID" ? "1" : undefined
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
    let blockedNetwork = 0
    const blockNetwork = () => {
        blockedNetwork++
        throw new Error("Real network is blocked in adapter contract tests")
    }
    t.mock.method(net.Socket.prototype, "connect", blockNetwork)
    t.mock.method(tls, "connect", blockNetwork)
    t.mock.method(dgram, "createSocket", blockNetwork)
    syncBuiltinESMExports()
    let now = 1700000000000, sequence = 1000
    t.mock.method(Date, "now", () => now)
    if (controlTimers) t.mock.timers.enable({ apis: ["setTimeout"] })
    let backend: TestConvex<typeof schema>
    const origin = "https://synthetic-adapter.invalid"
    const calls: { path: string, status: number }[] = []
    let transformResponse: ((path: string, response: Response) => Response) | undefined
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        assert.equal(url.origin, origin, "No network fallback is permitted")
        assert.equal(init?.method, url.pathname === "/service/scope" ? "GET" : "POST")
        assert.equal(init?.redirect, "error")
        const original = await backend.fetch(url.pathname, init)
        const response = transformResponse ? transformResponse(url.pathname, original) : original
        assert.equal(response.headers.get("cache-control"), "no-store")
        calls.push({ path: url.pathname, status: response.status })
        return response
    })
    backend = convexTest({ schema, modules: { ...baseModules, ...modules }, transactionLimits: true })
    t.after(async () => {
        try {
            await backend.finishAllScheduledFunctions(() => { if (controlTimers) t.mock.timers.tick(0) })
            assert.equal(blockedNetwork, 0)
            t.diagnostic(`${calls.length} real in-process HTTP calls, no real network`)
        } finally {
            for (const key of scopeKeys) {
                const value = previousScope[key]
                if (value === undefined) delete process.env[key]
                else process.env[key] = value
            }
            t.mock.restoreAll()
            syncBuiltinESMExports()
        }
    })

    // Resolve the adapter's runtime from its owning package, without a backend dependency
    const botRequire = createRequire(new URL("../../bot/package.json", import.meta.url))
    const { Effect, Exit, Redacted } = await import(pathToFileURL(botRequire.resolve("effect")).href)
    return {
        backend,
        config: { siteUrl: origin, secret: Redacted.make(secret) },
        wrongConfig: { siteUrl: origin, secret: Redacted.make("synthetic-wrong-secret-not-a-credential") },
        calls,
        transformResponse: (transform?: (path: string, response: Response) => Response) => { transformResponse = transform },
        now: () => now,
        advance: (milliseconds: number) => { now += milliseconds },
        source: () => ({ serverId: "1", messageId: String(++sequence), createdAt: now }),
        run: <A>(effect: unknown): Promise<A> => Effect.runPromise(effect),
        reject: async (effect: unknown, errorClass: abstract new (...args: any[]) => Error, status: number) => {
            const exit = await Effect.runPromise(Effect.exit(effect))
            assert(Exit.isFailure(exit))
            assert(exit.cause.reasons.some((reason: { _tag: string, error: unknown }) => reason._tag === "Fail"
                && reason.error instanceof errorClass && "status" in reason.error && reason.error.status === status))
            assert(!JSON.stringify(exit).includes(secret))
        },
    }
}
