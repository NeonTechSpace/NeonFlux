import assert from "node:assert/strict"
import { inspect } from "node:util"
import test from "node:test"
import { Effect, Redacted } from "effect"
import { readConfig } from "../src/config.ts"

const token = "synthetic-neonflux-test-token"
const serverId = "123456789012345678"

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

test("complete optional AFK configuration validates its origin and redacts the backend secret", async () => {
    const secret = "synthetic-neonflux-backend-secret-for-tests"
    for (const origin of ["https://synthetic-test.convex.site", "http://localhost:3211", "http://127.0.0.1:3211", "http://[::1]:3211"]) {
        const config = await Effect.runPromise(readConfig({
            FLUXER_BOT_TOKEN: token, NEONFLUX_SERVER_ID: serverId,
            CONVEX_SITE_URL: origin, NEONFLUX_BOT_API_SECRET: secret,
        }))
        assert.equal(config.backend?.siteUrl, origin)
        assert.equal(Redacted.value(config.backend!.secret), secret)
        assert.ok(!inspect(config).includes(secret))
        assert.ok(!JSON.stringify(config).includes(secret))
    }
})

test("partial or invalid AFK configuration fails without exposing supplied credentials", async () => {
    const secret = "synthetic-neonflux-backend-secret-for-tests"
    for (const [siteUrl, backendSecret] of [
        [undefined, secret], ["https://synthetic-test.convex.site", undefined],
        ["https://synthetic-test.convex.site", "short"], ["not a URL", secret],
        ["http://synthetic-test.convex.site", secret], ["https://user:password@synthetic-test.convex.site", secret],
        ["https://synthetic-test.convex.site/path", secret], ["https://synthetic-test.convex.site?key=secret", secret],
        ["https://synthetic-test.convex.site#fragment", secret],
    ]) {
        await assert.rejects(Effect.runPromise(readConfig({
            FLUXER_BOT_TOKEN: token, NEONFLUX_SERVER_ID: serverId,
            CONVEX_SITE_URL: siteUrl, NEONFLUX_BOT_API_SECRET: backendSecret,
        })), (error: unknown) => {
            assert.match(String(error), /Set (CONVEX_SITE_URL|NEONFLUX_BOT_API_SECRET)/)
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
