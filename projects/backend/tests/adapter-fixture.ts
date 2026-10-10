import assert from "node:assert/strict"
import { createRequire, syncBuiltinESMExports } from "node:module"
import { pathToFileURL } from "node:url"
import type { TestContext } from "node:test"
import net from "node:net"
import tls from "node:tls"
import dgram from "node:dgram"
import { convexTest, type TestConvex } from "convex-test"
import { makeFunctionReference } from "convex/server"
import { ConvexError } from "convex/values"
import schema from "../convex/schema.ts"
import { backendFunction, backendRoutes, type BackendPath } from "../../bot/src/backend-routes.ts"

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
    "../convex/botService.ts": () => import("../convex/botService.ts"),
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
    t.mock.method(globalThis, "fetch", async () => { throw new Error("No network fallback is permitted") })
    const backend: TestConvex<typeof schema> = convexTest({ schema, modules: { ...baseModules, ...modules }, transactionLimits: true })
    const origin = "https://synthetic-adapter.invalid"
    // The bot's own transport runs unchanged. Only the Convex client is replaced by direct calls into the isolated backend
    const paths = new Map((Object.keys(backendRoutes) as BackendPath[]).map(path => [backendFunction(path), path]))
    const calls: { path: string, status: number | null }[] = []
    // Runs after a call the backend applied, so a test can lose its reply on the way back
    let afterApplied: ((path: string) => void) | undefined
    const call = (type: "query" | "mutation") => async (name: string, args: Record<string, unknown>) => {
        const path = paths.get(name)
        assert(path && backendRoutes[path] === type, `${name} is a bot ${type}`)
        try {
            const value = type === "query" ? await backend.query(makeFunctionReference<"query">(name), args) : await backend.mutation(makeFunctionReference<"mutation">(name), args)
            calls.push({ path, status: 200 })
            afterApplied?.(path)
            return value
        } catch (error) {
            const status = error instanceof ConvexError ? (error.data as { status?: unknown } | null)?.status : undefined
            calls.push({ path, status: typeof status === "number" ? status : null })
            throw error
        }
    }
    const client = { query: call("query"), mutation: call("mutation"), subscribe: () => { throw new Error("Adapter contract tests do not subscribe") } }
    t.after(async () => {
        try {
            await backend.finishAllScheduledFunctions(() => { if (controlTimers) t.mock.timers.tick(0) })
            assert.equal(blockedNetwork, 0)
            t.diagnostic(`${calls.length} in-process backend calls, no real network`)
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
        config: { url: origin, secret: Redacted.make(secret), client },
        wrongConfig: { url: origin, secret: Redacted.make("synthetic-wrong-secret-not-a-credential"), client },
        calls,
        afterApplied: (hook?: (path: string) => void) => { afterApplied = hook },
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
