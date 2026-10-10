import assert from "node:assert/strict"
import test from "node:test"
import { createTestBot, type TestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { readCosts } from "../src/costs.ts"
import { parseDeploymentScope, selectServerCommand, serverCommands, serverOption, serverReply } from "../src/server-scope.ts"
import { backupHelp } from "../src/backup-command.ts"
import { createServerRuntime, verifyBackendScope } from "../src/server-runtime.ts"
import { createBotOptions } from "../src/bot.ts"
import { deriveServiceKey } from "../src/backend-http.ts"
import { fakeClient, type BackendCall, type BackendResponder } from "./backend-fake.ts"

const scope = parseDeploymentScope({ NEONFLUX_SERVER_MODE: "multi" })
// Each test sets the backend's answers. The work signal subscription never changes, so only safety polls dispatch
let respond: BackendResponder = () => { throw new Error("Synthetic backend not scripted") }
const client = fakeClient(call => respond(call), (_name, _args, onValue) => { onValue({ version: 0 }); return () => {} })
const backend = { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-secret"), client }
const config = { token: Redacted.make("synthetic-token"), scope, backend }
const served = (...serverIds: string[]) => (serverId: string) => serverIds.includes(serverId)

test("multi scope needs no server list and rejects the retired list and a single server", () => {
    assert.deepEqual(parseDeploymentScope({ NEONFLUX_SERVER_MODE: "multi" }), { mode: "multi" })
    assert.throws(() => parseDeploymentScope({ NEONFLUX_SERVER_MODE: "multi", NEONFLUX_SERVER_IDS: '["10"]' }), /Remove NEONFLUX_SERVER_IDS/)
    assert.throws(() => parseDeploymentScope({ NEONFLUX_SERVER_MODE: "multi", NEONFLUX_SERVER_ID: "10" }), /Remove NEONFLUX_SERVER_ID in multi mode/)
    assert.throws(() => parseDeploymentScope({ NEONFLUX_SERVER_ID: "10", NEONFLUX_SERVER_IDS: '["10"]' }), /Remove NEONFLUX_SERVER_IDS in single mode/)
})

test("scope agreement requires the same mode, and in single mode the same server, before runtime requests", async () => {
    const observed: BackendCall[] = []
    respond = call => { observed.push(call); return { mode: "multi" } }
    await Effect.runPromise(verifyBackendScope(config))
    assert.deepEqual(observed.map(call => [call.path, call.serverId, call.body]), [["/service/scope", undefined, {}]])
    assert.equal(observed[0]!.key, Redacted.value(deriveServiceKey(backend.secret)))
    for (const value of [{ mode: "multi", serverIds: ["10"] }, { mode: "single", serverIds: ["10"] }, null]) {
        respond = () => value
        assert.equal((await Effect.runPromiseExit(verifyBackendScope(config)))._tag, "Failure")
    }
    const single = { ...config, serverId: "10", scope: parseDeploymentScope({ NEONFLUX_SERVER_ID: "10" }) }
    for (const [value, outcome] of [[{ mode: "single", serverIds: ["10"] }, "Success"], [{ mode: "single", serverIds: ["20"] }, "Failure"], [{ mode: "multi" }, "Failure"]] as const) {
        respond = () => value
        assert.equal((await Effect.runPromiseExit(verifyBackendScope(single)))._tag, outcome)
    }
    assert.equal((await Effect.runPromiseExit(verifyBackendScope({ token: config.token, scope })))._tag, "Failure")
})

test("every concrete adapter is immutable and scope denial retires only its runtime", async () => {
    let retired = 0, writes = 0
    const a = createServerRuntime(config, "10", () => { retired++ }), b = createServerRuntime(config, "20", () => { retired += 10 })
    respond = call => {
        writes++
        assert.equal(call.serverId, "10")
        return Response.json({ error: "Server not allowed", code: "NEONFLUX_SCOPE_DENIED" }, { status: 403 })
    }
    await Effect.runPromiseExit(a.adapters!.afk.observe("7", []))
    assert.equal(a.active(), false)
    assert.equal(b.active(), true)
    assert.equal(retired, 1)
    await Effect.runPromiseExit(a.adapters!.afk.observe("7", []))
    assert.equal(writes, 1)
    assert.equal(Object.isFrozen(a.config.backend), true)
    assert.equal(a.config.backend!.scopeMode, "multi")
    await Effect.runPromiseExit(a.adapters!.general.get())
    assert.equal(writes, 1)
    respond = call => {
        assert.equal(call.serverId, "20")
        assert.equal((call.body as { serverId?: unknown }).serverId, "20")
        return { prefix: "?", revision: 2 }
    }
    assert.deepEqual(await Effect.runPromise(b.adapters!.general.get()), { prefix: "?", revision: 2 })
})

test("private replies name their server without rewriting echoed user text", () => {
    assert.equal(serverReply("Saved draft: !hello friends", "20"), "[Server 20] Saved draft: !hello friends")
})

test("bot-authored follow-up commands carry the server selector a multi-server DM requires", () => {
    const multi = { serverId: "20", scope }
    const single = { serverId: "20", scope: parseDeploymentScope({ NEONFLUX_SERVER_ID: "20" }) }
    const help = serverCommands(backupHelp, multi)
    assert.match(help, /!backup --server 20 confirm <planID>/)
    assert.doesNotMatch(help, /!backup(?! --server 20)\b/)
    for (const line of help.split("\n").filter(line => line.startsWith("!"))) {
        assert.deepEqual(selectServerCommand(line, multi.scope, served("10", "20")), { serverId: "20", content: line.replace(" --server 20", "") })
    }
    assert.equal(`Next: !ticket${serverOption(multi)} list 5`, "Next: !ticket --server 20 list 5")
    assert.equal(serverCommands(backupHelp, single), backupHelp)
    assert.equal(serverOption(single), "")
})

test("selectors preserve quotes and backslashes, reject a reserved option in later position and follow the served set", () => {
    const content = '!backup --server 20 plan "literal --server value" "C:\\file"'
    assert.deepEqual(selectServerCommand(content, scope, served("10", "20")), { serverId: "20", content: '!backup plan "literal --server value" "C:\\file"' })
    assert.ok("error" in selectServerCommand("!backup status --server 20", scope, served("10", "20"))!)
    assert.ok("error" in selectServerCommand("!backup --server 20 --server 10 status", scope, served("10", "20"))!)
    assert.ok("error" in selectServerCommand("!backup --server 20 status", scope, served("10", "20"), "10")!)
    assert.ok("error" in selectServerCommand("!backup --server 20 status", scope, served("10"))!)
    assert.equal(selectServerCommand("hello", scope, served("10"), "20"), undefined)
})

// Multi-mode lifecycle through the public bot options, with an in-memory Fluxer and a scripted backend
const serverA = "1100000000000000001", serverB = "1100000000000000002", serverC = "1100000000000000003", serverD = "1100000000000000004"
function scriptedBackend(installed: string[], gateDenied: string[] = []) {
    const active = new Set(installed), changes: string[] = [], lists: number[] = []
    respond = call => {
        const path = call.path, body = (call.body ?? {}) as { serverId?: string }, server = call.serverId
        if (path === "/service/scope") return Response.json({ mode: "multi" })
        if (path === "/service/installations/list") { lists.push(active.size); return Response.json({ serverIds: [...active], nextCursor: null }) }
        if (path === "/service/installations/join" || path === "/service/installations/leave") {
            const join = path.endsWith("/join")
            changes.push(`${join ? "join" : "leave"} ${body.serverId}`)
            if (join) active.add(body.serverId!); else active.delete(body.serverId!)
            return Response.json({ serverId: body.serverId, active: join })
        }
        assert.equal(body.serverId, server)
        if (!active.has(server!) || path === "/moderation/gate" && gateDenied.includes(server!)) return Response.json({ error: "Server not allowed", code: "NEONFLUX_SCOPE_DENIED" }, { status: 403 })
        if (path === "/moderation/gate") return Response.json({ allowed: true, defcon: 3, messageProtectionEnabled: false, joinProtectionEnabled: false })
        if (path === "/afk/observe") return Response.json({ cleared: false, statuses: [] })
        return Response.json({ error: "Backend unavailable" }, { status: 503 })
    }
    return { active, changes, lists }
}
function multiBot(guilds: string[]) {
    return Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ ...config, customStatus: "Serving every community" }))
        bot.rest.respond("GET /users/@me/guilds", request => ({ body: request.query.after ? [] : guilds.map(id => bot.fixtures.guild({ id })) }))
        bot.rest.respond("GET /channels/:id", request => ({ body: { id: request.path.split("/")[2], type: 1, recipients: [bot.fixtures.user()] } }))
        const sent = bot.rest.respond("POST /channels/:id/messages", request => ({ body: bot.fixtures.message({ channel_id: request.path.split("/")[2]!, content: String((request.body as { content?: unknown }).content) }) }))
        yield* bot.ready()
        return { bot, sent }
    })
}
// Sends one message and returns the bot's reply text, or undefined when it stayed silent
function exchange(bot: TestBot, sent: { requests(): readonly { body: unknown }[] }, content: string, guildId?: string) {
    return Effect.gen(function* () {
        const before = sent.requests().length
        const { guild_id: _, ...direct } = bot.fixtures.message({ content, channel_id: "1200000000000000001" })
        const message = guildId ? bot.fixtures.message({ content, guild_id: guildId }) : direct
        yield* bot.emit("MESSAGE_CREATE", message)
        yield* bot.idle()
        const replies = sent.requests().slice(before).map(request => (request.body as { content: string }).content)
        assert.ok(replies.length <= 1)
        return replies[0]
    })
}
const notServed = "Select an allowed server immediately after the command name with --server <serverId>"

test("multi-mode startup serves zero servers and shows only the configured status", async () => {
    const backendState = scriptedBackend([])
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { bot, sent } = yield* multiBot([])
        assert.equal(yield* exchange(bot, sent, "!ping", serverA), undefined)
        assert.equal(yield* exchange(bot, sent, `!ping --server ${serverA}`), notServed)
        assert.deepEqual(backendState.lists, [0])
        assert.deepEqual(backendState.changes, [])
        const presence = JSON.stringify(bot.commands().filter(command => command.op === 2 || command.op === 3).map(command => command.d))
        assert.match(presence, /Serving every community/)
        assert.doesNotMatch(presence, /DEFCON|Security backend unavailable/)
        assert.equal(bot.failures().length, 0)
    })))
})

test("multi-mode startup records joins and removals, then starts each current server", async () => {
    const backendState = scriptedBackend([serverA, serverB])
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { bot, sent } = yield* multiBot([serverB, serverC])
        assert.equal(yield* exchange(bot, sent, "!ping", serverB), "Pong!")
        assert.equal(yield* exchange(bot, sent, "!ping", serverC), "Pong!")
        assert.equal(yield* exchange(bot, sent, "!ping", serverA), undefined)
        assert.deepEqual(backendState.changes, [`leave ${serverA}`, `join ${serverC}`])
        assert.deepEqual([...backendState.active].sort(), [serverB, serverC])
        // A DM selects only a server this process currently serves
        assert.equal(yield* exchange(bot, sent, `!ping --server ${serverB}`), undefined)
        assert.equal(yield* exchange(bot, sent, `!ping --server ${serverA}`), notServed)
        assert.equal(bot.failures().length, 0)
    })))
})

test("a backend scope denial retires only that server's runtime", async () => {
    scriptedBackend([serverB, serverC], [serverB])
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { bot, sent } = yield* multiBot([serverB, serverC])
        assert.equal(yield* exchange(bot, sent, "!ping", serverB), undefined)
        assert.equal(bot.failures().length, 1)
        assert.equal(yield* exchange(bot, sent, "!ping", serverB), undefined)
        assert.equal(yield* exchange(bot, sent, `!ping --server ${serverB}`), notServed)
        assert.equal(yield* exchange(bot, sent, "!ping", serverC), "Pong!")
        assert.equal(bot.failures().length, 1)
    })))
})

test("guildCreate registers a server once and guildDelete keeps unavailable servers and retires removed ones", async () => {
    const backendState = scriptedBackend([])
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const { bot, sent } = yield* multiBot([])
        assert.equal(yield* exchange(bot, sent, "!ping", serverD), undefined)
        for (let replay = 0; replay < 2; replay++) {
            yield* bot.emit("GUILD_CREATE", bot.fixtures.guildCreate({ guild: { id: serverD }, channels: [] }))
            yield* bot.idle()
        }
        assert.deepEqual(backendState.changes, [`join ${serverD}`])
        assert.equal(yield* exchange(bot, sent, "!ping", serverD), "Pong!")
        assert.equal(yield* exchange(bot, sent, `!ping --server ${serverD}`), undefined)
        yield* bot.emit("GUILD_DELETE", { id: serverD, unavailable: true })
        yield* bot.idle()
        assert.deepEqual(backendState.changes, [`join ${serverD}`])
        assert.equal(yield* exchange(bot, sent, "!ping", serverD), "Pong!")
        yield* bot.emit("GUILD_DELETE", { id: serverD })
        yield* bot.idle()
        assert.deepEqual(backendState.changes, [`join ${serverD}`, `leave ${serverD}`])
        assert.equal(yield* exchange(bot, sent, "!ping", serverD), undefined)
        assert.equal(yield* exchange(bot, sent, `!ping --server ${serverD}`), notServed)
        yield* bot.emit("GUILD_CREATE", bot.fixtures.guildCreate({ guild: { id: serverD }, channels: [] }))
        yield* bot.idle()
        assert.deepEqual(backendState.changes, [`join ${serverD}`, `leave ${serverD}`, `join ${serverD}`])
        assert.equal(yield* exchange(bot, sent, "!ping", serverD), "Pong!")
        assert.equal(bot.failures().length, 0)
    })))
})

// The test clock stops every backend timeout, so no runtime finishes starting until the test releases the backend
test("a restart with many servers starting at once holds each server's events and drops none", { timeout: 120000 }, async () => {
    const servers = Array.from({ length: 24 }, (_, index) => String(1100000000000001000n + BigInt(index)))
    const channelOf = (serverId: string) => String(BigInt(serverId) + 100000000000000n)
    scriptedBackend(servers)
    const scripted = respond
    let release!: () => void
    const released = new Promise<void>(resolve => { release = resolve })
    respond = async call => {
        if (call.serverId) await released
        return call.path === "/general/get" ? { prefix: "!", revision: 1 } : scripted(call)
    }
    const rounds = 20, expected = servers.length * rounds
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions(config))
        bot.rest.respond("GET /users/@me/guilds", request => ({ body: request.query.after ? [] : servers.map(id => bot.fixtures.guild({ id })) }))
        const replies = new Map<string, string[]>()
        let finish!: () => void, count = 0
        const finished = new Promise<void>(resolve => { finish = resolve })
        bot.rest.respond("POST /channels/:id/messages", request => {
            const channelId = request.path.split("/")[2]!, body = request.body as { content?: unknown, message_reference?: { message_id?: string } }
            assert.equal(body.content, "Pong!")
            replies.set(channelId, [...replies.get(channelId) ?? [], body.message_reference!.message_id!])
            if (++count === expected) finish()
            return { body: bot.fixtures.message({ channel_id: channelId }) }
        })
        yield* bot.ready()
        // Each burst stays below the SDK's queue of 256 waiting events. Settling after it shows that no handler waits for a starting server
        const sent = new Map<string, string[]>()
        for (let round = 0; round < rounds; round++) {
            for (const serverId of servers) {
                const message = bot.fixtures.message({ content: "!ping", guild_id: serverId, channel_id: channelOf(serverId) })
                sent.set(channelOf(serverId), [...sent.get(channelOf(serverId)) ?? [], message.id])
                yield* bot.emit("MESSAGE_CREATE", message)
            }
            if (round % 10 === 9) yield* bot.idle({ timeoutMs: 30000 })
        }
        assert.equal(count, 0)
        release()
        yield* Effect.promise(() => finished)
        yield* bot.idle()
        assert.equal(bot.counters().eventsDropped.overflow, 0)
        assert.equal(readCosts().eventsDropped, 0)
        // Every server answered every event, in arrival order
        assert.deepEqual(replies, sent)
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})
