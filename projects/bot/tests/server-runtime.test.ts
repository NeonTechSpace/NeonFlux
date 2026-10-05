import assert from "node:assert/strict"
import test from "node:test"
import { Effect, Redacted } from "effect"
import { parseDeploymentScope, selectServerCommand, serverCommands, serverOption, serverReply } from "../src/server-scope.ts"
import { backupHelp } from "../src/backup-command.ts"
import { createServerRuntimeRegistry, verifyBackendScope } from "../src/server-runtime.ts"

const scope = parseDeploymentScope({ NEONFLUX_SERVER_MODE: "multi", NEONFLUX_SERVER_IDS: '["20","10"]' })
const config = { token: Redacted.make("synthetic-token"), serverId: "10", scope, backend: { siteUrl: "https://synthetic.invalid", secret: Redacted.make("synthetic-secret") } }

test("scope agreement requires the same mode and exact normalized set before runtime requests", async t => {
    const observed: RequestInit[] = []
    t.mock.method(globalThis, "fetch", async (_url: URL, options: RequestInit) => { observed.push(options); return Response.json(scope) })
    await Effect.runPromise(verifyBackendScope(config))
    assert.equal(observed[0]!.method, "GET")
    assert.equal(observed[0]!.body, undefined)
    assert.deepEqual(Object.keys(observed[0]!.headers!), ["Authorization"])
    for (const value of [{ ...scope, serverIds: ["10"] }, { ...scope, serverIds: ["10", "20", "30"] }, { ...scope, mode: "single" }, null]) {
        t.mock.method(globalThis, "fetch", async () => Response.json(value))
        const result = await Effect.runPromiseExit(verifyBackendScope(config))
        assert.equal(result._tag, "Failure")
    }
})

test("every concrete adapter is immutable and scope denial retires only its registry entry", async t => {
    const registry = createServerRuntimeRegistry(config), a = registry.get("10")!, b = registry.get("20")!
    let writes = 0, retired = 0
    a.onRetire(() => { retired++ })
    t.mock.method(globalThis, "fetch", async (_url: URL, options: RequestInit) => {
        writes++
        assert.equal((options.headers as Record<string, string>)["X-NeonFlux-Server-ID"], "10")
        return Response.json({ error: "Server not allowed", code: "NEONFLUX_SCOPE_DENIED" }, { status: 403 })
    })
    await Effect.runPromiseExit(a.adapters!.afk.observe("7", []))
    assert.equal(a.active(), false)
    assert.equal(b.active(), true)
    assert.equal(retired, 1)
    await Effect.runPromiseExit(a.adapters!.afk.observe("7", []))
    assert.equal(writes, 1)
    assert.equal(Object.isFrozen(a.config.backend), true)
    await Effect.runPromiseExit(a.adapters!.general.get())
    assert.equal(writes, 1)
    t.mock.method(globalThis, "fetch", async (_url: URL, options: RequestInit) => {
        assert.equal((options.headers as Record<string, string>)["X-NeonFlux-Server-ID"], "20")
        assert.equal(JSON.parse(String(options.body)).serverId, "20")
        return Response.json({ prefix: "?", revision: 2 })
    })
    assert.deepEqual(await Effect.runPromise(b.adapters!.general.get()), { prefix: "?", revision: 2 })
})

test("private replies name their server without rewriting echoed user text", () => {
    assert.equal(serverReply("Saved draft: !hello friends", "20"), "[Server 20] Saved draft: !hello friends")
})

test("bot-authored follow-up commands carry the server selector a multi-server DM requires", () => {
    const multi = { serverId: "20", scope: parseDeploymentScope({ NEONFLUX_SERVER_MODE: "multi", NEONFLUX_SERVER_IDS: '["10","20"]' }) }
    const single = { serverId: "20", scope: parseDeploymentScope({ NEONFLUX_SERVER_ID: "20" }) }
    const help = serverCommands(backupHelp, multi)
    assert.match(help, /!backup --server 20 confirm <planID>/)
    assert.doesNotMatch(help, /!backup(?! --server 20)\b/)
    for (const line of help.split("\n").filter(line => line.startsWith("!"))) {
        assert.deepEqual(selectServerCommand(line, multi.scope), { serverId: "20", content: line.replace(" --server 20", "") })
    }
    assert.equal(`Next: !ticket${serverOption(multi)} list 5`, "Next: !ticket --server 20 list 5")
    assert.equal(serverCommands(backupHelp, single), backupHelp)
    assert.equal(serverOption(single), "")
})

test("selectors preserve quotes and backslashes and reject a reserved option in later position", () => {
    const content = '!backup --server 20 plan "literal --server value" "C:\\file"'
    assert.deepEqual(selectServerCommand(content, scope), { serverId: "20", content: '!backup plan "literal --server value" "C:\\file"' })
    assert.ok("error" in selectServerCommand("!backup status --server 20", scope)!)
    assert.ok("error" in selectServerCommand("!backup --server 20 --server 10 status", scope)!)
    assert.ok("error" in selectServerCommand("!backup --server 20 status", scope, "10")!)
})
