import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
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

test("the built entrypoint refuses a server ID in the bot environment with a backend, before any request and without exposing secrets", async () => {
    const token = "synthetic-neonflux-test-token"
    const secret = "synthetic-neonflux-backend-secret-for-tests"
    // A local deployment that records the Convex client's requests, so a request made before the refusal would show.
    // Other software on the machine may probe a loopback port, so a request without the client's header is not counted
    const requests: string[] = []
    const deployment = createServer((request, response) => {
        if (request.headers["convex-client"]) requests.push(`${request.method} ${request.url}`)
        response.writeHead(500).end()
    })
    deployment.listen(0, "127.0.0.1")
    await once(deployment, "listening")
    try {
        const child = spawn(process.execPath, [entrypoint], {
            env: environment({
                FLUXER_BOT_TOKEN: token,
                CONVEX_URL: `http://127.0.0.1:${(deployment.address() as AddressInfo).port}`,
                NEONFLUX_BOT_API_SECRET: secret,
                NEONFLUX_SERVER_ID: "123456789012345678",
            }),
            timeout: 10_000,
        })
        let output = "",
            stderr = ""
        child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk))
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => ((output += chunk), (stderr += chunk)))
        const [status] = (await once(child, "close")) as [number | null]

        assert.equal(status, 1)
        assert.match(
            stderr,
            /Remove NEONFLUX_SERVER_ID from the bot environment\. With a backend, the server mode and server ID are set only in the Convex deployment/,
        )
        assert.deepEqual(requests, [])
        for (const value of [token, secret, "123456789012345678"]) assert.ok(!output.includes(value))
    } finally {
        deployment.close()
        deployment.closeAllConnections()
    }
})
