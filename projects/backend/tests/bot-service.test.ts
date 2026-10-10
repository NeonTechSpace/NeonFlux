import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { afterEach, beforeEach, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import * as botService from "../convex/botService.ts"
import { constantTimeEqual, deriveServiceKey, SERVICE_KEY_LABEL } from "../convex/serviceKey.ts"
import { backendFunction, backendRoutes, type BackendPath } from "../../bot/src/backend-routes.ts"
import { deriveServiceKey as deriveBotKey, serviceKeyLabel } from "../../bot/src/backend-http.ts"
import { botCall } from "./bot-service.ts"

const secret = "synthetic-service-key-secret-not-a-credential-00"
const keys = ["NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_IDS", "NEONFLUX_SERVER_ID", "NEONFLUX_BOT_API_SECRET"] as const
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.NEONFLUX_BOT_API_SECRET = secret
})
afterEach(() => { for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key] } })

const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"),
    "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/afk.ts": () => import("../convex/afk.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const backend = () => convexTest({ schema, modules, transactionLimits: true })
type Registered = { isQuery?: boolean, isMutation?: boolean, isAction?: boolean, isPublic?: boolean }

test("Every bot path is one public function of its own kind, and the module exports no other functions", () => {
    const exported = Object.entries(botService as unknown as Record<string, Registered>).filter(([, value]) => value?.isQuery || value?.isMutation || value?.isAction)
    const expected = (Object.keys(backendRoutes) as BackendPath[]).map(path => [backendFunction(path).replace("botService:", ""), backendRoutes[path]] as const)
    assert.deepEqual(new Set(exported.map(([name]) => name)), new Set(expected.map(([name]) => name)))
    for (const [name, kind] of expected) {
        const fn = (botService as unknown as Record<string, Registered>)[name]!
        assert.equal(fn.isPublic, true, name)
        assert.equal(kind === "query" ? fn.isQuery : fn.isMutation, true, `${name} is a ${kind}`)
    }
})

test("Bot entry points make no nested function calls, so each request is billed once", () => {
    const source = readFileSync(new URL("../convex/botService.ts", import.meta.url), "utf8")
    assert.doesNotMatch(source, /\bctx\.run(Query|Mutation|Action)\(|\bscheduler\.run/)
    assert.doesNotMatch(source, /\b(action|internalAction|httpAction)\(/)
    // Handlers receive a context whose nested calls fail rather than run
    const context = botService.inline({ db: "synthetic", runQuery: () => "ran", runMutation: () => "ran" })
    assert.equal(context.db, "synthetic")
    assert.throws(() => context.runQuery(), /cannot call other functions/)
    assert.throws(() => context.runMutation(), /cannot call other functions/)
})

test("The bot and the backend derive the same key from the secret and a versioned label", async () => {
    const require = createRequire(new URL("../../bot/package.json", import.meta.url))
    const { Redacted } = await import(pathToFileURL(require.resolve("effect")).href)
    assert.equal(serviceKeyLabel, SERVICE_KEY_LABEL)
    const key = await deriveServiceKey(secret)
    assert.match(key, /^[0-9a-f]{64}$/)
    assert.equal(Redacted.value(deriveBotKey(Redacted.make(secret))), key)
    assert.notEqual(key, secret)
    assert.notEqual(await deriveServiceKey(`${secret}x`), key)
})

test("Only the derived key opens a bot function, checked before scope, body or installation", async () => {
    const t = backend(), key = await deriveServiceKey(secret)
    const rejected = [{ secret: null }, { key: secret }, { key: key.toUpperCase() }, { key: `${key}0` }, { key: key.slice(0, -1) }, { key: "" }, { key: 7 },
        { secret: "synthetic-other-secret-not-a-credential-00000" }]
    for (const path of ["/service/scope", "/service/work", "/general/get", "/afk/set"] as const) {
        for (const options of rejected) {
            // A foreign server and an invalid body would fail later checks, so 401 shows the key is checked first
            const response = await botCall(t, path, { serverId: "99" }, { ...options, serverId: "99" })
            assert.equal(response.status, 401, `${path} ${JSON.stringify(options)}`)
            assert.deepEqual(await response.json(), { error: "Unauthorized" })
        }
    }
    assert.deepEqual(await t.run(ctx => ctx.db.query("afkStatuses").collect()), [])
    assert.equal((await botCall(t, "/afk/set", { serverId: "10", userId: "20", reason: "Away" }, { key })).status, 200)
    assert.deepEqual(await (await botCall(t, "/service/scope", {}, { key })).json(), { mode: "single", serverIds: ["10"] })
})

test("A missing or short secret answers 503 for every key, so the key never stands in for configuration", async () => {
    const t = backend(), key = await deriveServiceKey(secret)
    for (const configured of [undefined, "synthetic-short"]) {
        if (configured === undefined) delete process.env.NEONFLUX_BOT_API_SECRET
        else process.env.NEONFLUX_BOT_API_SECRET = configured
        for (const options of [{ key }, { key: "" }]) {
            const response = await botCall(t, "/general/get", { serverId: "10" }, options)
            assert.equal(response.status, 503)
            assert.deepEqual(await response.json(), { error: "Backend not configured" })
        }
    }
})

test("The key comparison reads every byte of the expected key wherever a guess differs", () => {
    const expected = new TextEncoder().encode("a".repeat(64))
    const counted = () => {
        let reads = 0
        const proxy = new Proxy(expected, { get: (target, property) => {
            if (typeof property === "string" && /^\d+$/.test(property)) reads++
            return Reflect.get(target, property)
        } })
        return { proxy, reads: () => reads }
    }
    for (const guess of ["b" + "a".repeat(63), "a".repeat(63) + "b", "a".repeat(64), "a".repeat(10), ""]) {
        const { proxy, reads } = counted()
        assert.equal(constantTimeEqual(proxy, new TextEncoder().encode(guess)), guess === "a".repeat(64))
        assert.equal(reads(), 64, guess)
    }
})
