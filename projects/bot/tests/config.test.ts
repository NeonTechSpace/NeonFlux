import assert from "node:assert/strict"
import { inspect } from "node:util"
import test from "node:test"
import { Effect, Redacted } from "effect"
import { readConfig } from "../src/config.ts"

const token = "synthetic-neonflux-test-token"
const serverId = "123456789012345678"

test("optional normal presence status validates bounded text without exposing supplied values", async () => {
    const config = await Effect.runPromise(readConfig({ FLUXER_BOT_TOKEN: token, NEONFLUX_SERVER_ID: serverId, NEONFLUX_CUSTOM_STATUS: "  Ready for commands  " }))
    assert.equal(config.customStatus, "Ready for commands")
    for (const value of ["x".repeat(129), "private\u202evalue", "private\u000cvalue"]) {
        await assert.rejects(Effect.runPromise(readConfig({ FLUXER_BOT_TOKEN: token, NEONFLUX_SERVER_ID: serverId, NEONFLUX_CUSTOM_STATUS: value })), (error: unknown) => {
            assert.match(String(error), /NEONFLUX_CUSTOM_STATUS/)
            assert.equal(String(error).includes(value), false)
            return true
        })
    }
})

test("configuration keeps the token redacted and the server ID as a string", async () => {
    const config = await Effect.runPromise(readConfig({
        FLUXER_BOT_TOKEN: ` ${token} `,
        NEONFLUX_SERVER_ID: ` ${serverId} `,
    }))

    assert.equal(config.serverId, serverId)
    assert.equal(config.backend, undefined)
    assert.equal(Redacted.value(config.token), token)
    assert.ok(!inspect(config).includes(token))
    assert.ok(!JSON.stringify(config).includes(token))
})

test("backend configuration reads the deployment URL and redacts the backend secret", async () => {
    const secret = "synthetic-neonflux-backend-secret-for-tests"
    for (const [environment, url] of [
        [{ CONVEX_URL: "https://synthetic-test.convex.cloud" }, "https://synthetic-test.convex.cloud"],
        [{ CONVEX_URL: "https://backend.synthetic.example" }, "https://backend.synthetic.example"],
        [{ CONVEX_URL: "http://127.0.0.1:3210" }, "http://127.0.0.1:3210"],
        [{ CONVEX_URL: "http://localhost:3210" }, "http://localhost:3210"],
        [{ CONVEX_URL: "http://[::1]:3210" }, "http://[::1]:3210"],
        // A cloud HTTP Actions URL names the same deployment, and CONVEX_URL wins when both are set
        [{ CONVEX_SITE_URL: "https://synthetic-test.convex.site" }, "https://synthetic-test.convex.cloud"],
        [{ CONVEX_URL: "https://other-test.convex.cloud", CONVEX_SITE_URL: "https://synthetic-test.convex.site" }, "https://other-test.convex.cloud"],
    ] as const) {
        const config = await Effect.runPromise(readConfig({ FLUXER_BOT_TOKEN: token, NEONFLUX_SERVER_ID: serverId, ...environment, NEONFLUX_BOT_API_SECRET: secret }))
        assert.equal(config.backend?.url, url)
        assert.equal(Redacted.value(config.backend!.secret), secret)
        assert.ok(!inspect(config).includes(secret))
        assert.ok(!JSON.stringify(config).includes(secret))
    }
})

test("partial or invalid backend configuration fails without exposing supplied credentials", async () => {
    const secret = "synthetic-neonflux-backend-secret-for-tests"
    for (const [environment, backendSecret] of [
        [{}, secret], [{ CONVEX_URL: "https://synthetic-test.convex.cloud" }, undefined],
        [{ CONVEX_URL: "https://synthetic-test.convex.cloud" }, "short"], [{ CONVEX_URL: "not a URL" }, secret],
        [{ CONVEX_URL: "http://synthetic-test.convex.cloud" }, secret], [{ CONVEX_URL: "https://user:password@synthetic-test.convex.cloud" }, secret],
        [{ CONVEX_URL: "https://synthetic-test.convex.cloud/path" }, secret], [{ CONVEX_URL: "https://synthetic-test.convex.cloud?key=secret" }, secret],
        [{ CONVEX_URL: "https://synthetic-test.convex.cloud#fragment" }, secret],
        // The HTTP Actions URL is not a deployment URL, and only a cloud one can be mapped to its deployment
        [{ CONVEX_URL: "https://synthetic-test.convex.site" }, secret], [{ CONVEX_SITE_URL: "http://127.0.0.1:3211" }, secret],
        [{ CONVEX_SITE_URL: "https://actions.synthetic.example" }, secret], [{ CONVEX_SITE_URL: "https://synthetic-test.convex.site:8443" }, secret],
        [{ CONVEX_SITE_URL: "https://synthetic-test.convex.site/path" }, secret],
    ] as const) {
        await assert.rejects(Effect.runPromise(readConfig({
            FLUXER_BOT_TOKEN: token, NEONFLUX_SERVER_ID: serverId, ...environment, NEONFLUX_BOT_API_SECRET: backendSecret,
        })), (error: unknown) => {
            assert.match(String(error), /Set (CONVEX_URL|NEONFLUX_BOT_API_SECRET)/)
            assert.ok(!String(error).includes(secret))
            assert.ok(!String(error).includes("password"))
            return true
        })
    }
})

test("missing or blank tokens fail with an actionable configuration error", async () => {
    for (const value of [undefined, "", "   "]) {
        await assert.rejects(
            Effect.runPromise(readConfig({ FLUXER_BOT_TOKEN: value, NEONFLUX_SERVER_ID: serverId })),
            /Set FLUXER_BOT_TOKEN/,
        )
    }
})

test("invalid server IDs fail without including supplied values", async () => {
    for (const value of [undefined, "", "0", "-1", "01", "1.5", "9223372036854775808", token]) {
        await assert.rejects(
            Effect.runPromise(readConfig({ FLUXER_BOT_TOKEN: token, NEONFLUX_SERVER_ID: value })),
            (error: unknown) => {
                assert.match(String(error), /Set NEONFLUX_SERVER_ID/)
                assert.ok(!String(error).includes(token))
                return true
            },
        )
    }
})

test("multi mode reads no server list and requires the backend that registers its servers", async () => {
    const backend = { CONVEX_URL: "https://synthetic-test.convex.cloud", NEONFLUX_BOT_API_SECRET: "synthetic-neonflux-backend-secret-for-tests" }
    const config = await Effect.runPromise(readConfig({ FLUXER_BOT_TOKEN: token, NEONFLUX_SERVER_MODE: "multi", ...backend }))
    assert.deepEqual(config.scope, { mode: "multi" })
    assert.equal(config.serverId, undefined)
    await assert.rejects(Effect.runPromise(readConfig({ FLUXER_BOT_TOKEN: token, NEONFLUX_SERVER_MODE: "multi" })), /Multi mode registers servers through the backend/)
    await assert.rejects(Effect.runPromise(readConfig({ FLUXER_BOT_TOKEN: token, NEONFLUX_SERVER_MODE: "multi", NEONFLUX_SERVER_IDS: '["10"]', ...backend })), /Remove NEONFLUX_SERVER_IDS/)
    await assert.rejects(Effect.runPromise(readConfig({ FLUXER_BOT_TOKEN: token, NEONFLUX_SERVER_MODE: "multi", NEONFLUX_SERVER_ID: serverId, ...backend })), /Remove NEONFLUX_SERVER_ID in multi mode/)
})
