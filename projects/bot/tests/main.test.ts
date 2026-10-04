import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

const entrypoint = fileURLToPath(new URL("../dist/main.js", import.meta.url))

test("the built entrypoint exits unsuccessfully when the token is missing", () => {
    const result = spawnSync(process.execPath, [entrypoint], {
        env: { ...process.env, FLUXER_BOT_TOKEN: "", NEONFLUX_SERVER_ID: "123456789012345678" },
        encoding: "utf8",
        timeout: 10_000,
    })

    assert.ifError(result.error)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Set FLUXER_BOT_TOKEN/)
})

test("the built entrypoint rejects a missing server ID without exposing the token", () => {
    const token = "synthetic-neonflux-test-token"
    const result = spawnSync(process.execPath, [entrypoint], {
        env: { ...process.env, FLUXER_BOT_TOKEN: token, NEONFLUX_SERVER_ID: "" },
        encoding: "utf8",
        timeout: 10_000,
    })

    assert.ifError(result.error)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Set NEONFLUX_SERVER_ID/)
    assert.ok(!(result.stdout + result.stderr).includes(token))
})
