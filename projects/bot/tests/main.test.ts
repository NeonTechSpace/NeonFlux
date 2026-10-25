import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

const entrypoint = fileURLToPath(new URL("../dist/main.js", import.meta.url))
// The shell's own bot settings, such as an exported CONVEX_URL or server mode, must not change what the entrypoint sees
const environment = (overrides: Record<string, string>) => ({
    ...Object.fromEntries(
        Object.entries(process.env).filter(([name]) => name !== "CONVEX_URL" && !name.startsWith("NEONFLUX_")),
    ),
    ...overrides,
})

test("the built entrypoint exits unsuccessfully when the token is missing", () => {
    const result = spawnSync(process.execPath, [entrypoint], {
        env: environment({ FLUXER_BOT_TOKEN: "", NEONFLUX_SERVER_ID: "123456789012345678" }),
        encoding: "utf8",
        timeout: 10_000,
    })

    assert.ifError(result.error)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Set FLUXER_BOT_TOKEN/)
})

test("the built entrypoint rejects a missing server ID without a backend and without exposing the token", () => {
    const token = "synthetic-neonflux-test-token"
    const result = spawnSync(process.execPath, [entrypoint], {
        env: environment({ FLUXER_BOT_TOKEN: token }),
        encoding: "utf8",
        timeout: 10_000,
    })

    assert.ifError(result.error)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Without a backend, set NEONFLUX_SERVER_ID/)
    assert.ok(!(result.stdout + result.stderr).includes(token))
})

test("the built entrypoint refuses a server ID in the bot environment with a backend, before any request and without exposing secrets", () => {
    const token = "synthetic-neonflux-test-token"
    const secret = "synthetic-neonflux-backend-secret-for-tests"
    const result = spawnSync(process.execPath, [entrypoint], {
        env: environment({
            FLUXER_BOT_TOKEN: token,
            // An unreachable deployment, so a request would fail with a different message
            CONVEX_URL: "https://synthetic-test.invalid",
            NEONFLUX_BOT_API_SECRET: secret,
            NEONFLUX_SERVER_ID: "123456789012345678",
        }),
        encoding: "utf8",
        timeout: 10_000,
    })

    assert.ifError(result.error)
    assert.equal(result.status, 1)
    assert.match(
        result.stderr,
        /Remove NEONFLUX_SERVER_ID from the bot environment\. With a backend, the server mode and server ID are set only in the Convex deployment/,
    )
    const output = result.stdout + result.stderr
    for (const value of [token, secret, "123456789012345678"]) assert.ok(!output.includes(value))
})
