import assert from "node:assert/strict"
import test from "node:test"
import { createTestBot, type TestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Fiber, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { readCosts } from "../src/costs.ts"
import { parseServerScope } from "@neonflux/contracts/service"
import { selectServerCommand, serverCommands, serverOption, serverReply, serverText } from "../src/server-scope.ts"
import { backupHelp } from "../src/backup-command.ts"
import { adoptBackendScope, createServerRuntime, ServerScopeError } from "../src/server-runtime.ts"
import type { BotRootConfig } from "../src/config.ts"
import { createBotOptions } from "../src/bot.ts"
import { deriveServiceKey } from "../src/backend-http.ts"
import { fakeClient, type BackendCall, type BackendResponder } from "./backend-fake.ts"
import { settings } from "./moderation-fixture.ts"
import { MessageType, Permissions } from "@neontechspace/fluxerly/effect"

const scope = parseServerScope({ NEONFLUX_SERVER_MODE: "multi" })
// Each test sets the backend's answers. The work signal subscription never changes, so only safety polls dispatch
let respond: BackendResponder = () => {
    throw new Error("Synthetic backend not scripted")
}
const client = fakeClient(
    (call) => respond(call),
    (_name, _args, onValue) => {
        onValue({ version: 0 })
        return () => {}
    },
)
const backend = { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-secret"), client }
const config = { token: Redacted.make("synthetic-token"), scope, backend }
const served =
    (...serverIds: string[]) =>
    (serverId: string) =>
        serverIds.includes(serverId)

const adopted = async (root: BotRootConfig) => {
    const exit = await Effect.runPromiseExit(adoptBackendScope(root))
    if (exit._tag === "Success") return exit.value
    const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error
    assert(error instanceof ServerScopeError)
    return error.message
}
test("the bot adopts the backend's scope and website, and its own scope variables must match", async () => {
    const observed: BackendCall[] = [],
        { scope: _scope, ...unscoped } = config
    respond = (call) => {
        observed.push(call)
        return { scope: { mode: "single", serverIds: ["10"] }, websiteUrl: "https://dashboard.synthetic.example" }
    }
    const root = await adopted(unscoped)
    assert.ok(typeof root !== "string")
    assert.deepEqual(
        [root.scope, root.serverId, root.websiteUrl],
        [{ mode: "single", serverIds: ["10"] }, "10", "https://dashboard.synthetic.example"],
    )
    assert.deepEqual(
        observed.map((call) => [call.path, call.serverId, call.body]),
        [["/service/scope", undefined, {}]],
    )
    assert.equal(observed[0]!.key, Redacted.value(deriveServiceKey(backend.secret)))
    // A multi-mode answer replaces the single server the operator's variables named, and a mismatch names the variable to fix
    respond = () => ({ scope: { mode: "multi" }, websiteUrl: null })
    const multi = await adopted(unscoped)
    assert.ok(typeof multi !== "string" && multi.serverId === undefined && multi.websiteUrl === undefined)
    assert.match(
        String(await adopted({ ...config, serverId: "10", scope: parseServerScope({ NEONFLUX_SERVER_ID: "10" }) })),
        /backend serves multi mode.*Remove NEONFLUX_SERVER_MODE/,
    )
    respond = () => ({ scope: { mode: "single", serverIds: ["20"] }, websiteUrl: null })
    assert.match(
        String(await adopted({ ...config, serverId: "10", scope: parseServerScope({ NEONFLUX_SERVER_ID: "10" }) })),
        /different server than NEONFLUX_SERVER_ID/,
    )
    // Authentication, configuration, connection and unknown answers each get their own startup error
    for (const [answer, message] of [
        [Response.json({ error: "Unauthorized" }, { status: 401 }), /NEONFLUX_BOT_API_SECRET/],
        [Response.json({ error: "Backend not configured" }, { status: 503 }), /logs name the variable/],
        [new Error("Synthetic connection lost"), /could not be reached.*CONVEX_URL/],
        [{ mode: "multi" }, /not one this bot understands/],
        [{ scope: { mode: "single", serverIds: [] }, websiteUrl: null }, /not one this bot understands/],
    ] as const) {
        respond = () => {
            if (answer instanceof Error) throw answer
            return answer instanceof Response ? answer.clone() : answer
        }
        assert.match(String(await adopted(unscoped)), message)
    }
})

test("every concrete adapter is immutable and scope denial retires only its runtime", async () => {
    let retired = 0,
        writes = 0
    const a = createServerRuntime(config, "10", () => {
            retired++
        }),
        b = createServerRuntime(config, "20", () => {
            retired += 10
        })
    respond = (call) => {
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
    await Effect.runPromiseExit(a.adapters!.general.get())
    assert.equal(writes, 1)
    respond = (call) => {
        assert.equal(call.serverId, "20")
        assert.equal((call.body as { serverId?: unknown }).serverId, "20")
        return { prefix: "?", revision: 2 }
    }
    assert.deepEqual(await Effect.runPromise(b.adapters!.general.get()), {
        prefix: "?",
        revision: 2,
    })
})

test("a multi-server runtime accepts the event work cursor the backend answers, which names no server", async () => {
    const runtime = createServerRuntime(config, "20", () => {})
    respond = (call) => {
        assert.equal(call.serverId, "20")
        return { type: "jobs", jobs: [], nextCursor: { eventNo: 1, occurrenceNo: 2 } }
    }
    assert.deepEqual(
        await Effect.runPromise(
            runtime.adapters!.events.work({ serverId: "20", operation: { type: "list", limit: 1 } }),
        ),
        { type: "jobs", jobs: [], nextCursor: { eventNo: 1, occurrenceNo: 2 } },
    )
})

test("private replies name their server without rewriting echoed user text", () => {
    assert.equal(
        serverText("Saved draft: !hello friends", "Synthetic Server"),
        "**Synthetic Server**: Saved draft: !hello friends",
    )
    assert.deepEqual(
        serverReply(
            { embeds: [{ title: "First" }, { title: "Last", footer: { text: "Page 2" } }] },
            "Synthetic Server",
        ),
        { embeds: [{ title: "First" }, { title: "Last", footer: { text: "Page 2 · Synthetic Server" } }] },
    )
    assert.deepEqual(serverReply({ embeds: [{ title: "Only" }] }, "Synthetic Server"), {
        embeds: [{ title: "Only", footer: { text: "Synthetic Server" } }],
    })
})

test("bot-authored follow-up commands carry the server selector a multi-server DM requires", () => {
    const multi = { serverId: "20", scope }
    const single = { serverId: "20", scope: parseServerScope({ NEONFLUX_SERVER_ID: "20" }) }
    const help = serverCommands(backupHelp, multi)
    assert.match(help, /!backup --server 20 confirm\b/)
    assert.doesNotMatch(help, /!backup(?! --server 20)\b/)
    for (const line of help.split("\n").filter((line) => line.startsWith("!"))) {
        assert.deepEqual(selectServerCommand(line, multi.scope, served("10", "20")), {
            serverId: "20",
            content: line.replace(" --server 20", ""),
        })
    }
    assert.equal(`Next: !ticket${serverOption(multi)} list 5`, "Next: !ticket --server 20 list 5")
    assert.equal(serverCommands(backupHelp, single), backupHelp)
    assert.equal(serverOption(single), "")
})

test("selectors preserve quotes and backslashes, reject a reserved option in later position and follow the served set", () => {
    const content = '!backup --server 20 plan "literal --server value" "C:\\file"'
    assert.deepEqual(selectServerCommand(content, scope, served("10", "20")), {
        serverId: "20",
        content: '!backup plan "literal --server value" "C:\\file"',
    })
    assert.ok("error" in selectServerCommand("!backup status --server 20", scope, served("10", "20"))!)
    assert.ok("error" in selectServerCommand("!backup --server 20 --server 10 status", scope, served("10", "20"))!)
    assert.ok("error" in selectServerCommand("!backup --server 20 status", scope, served("10", "20"), "10")!)
    assert.ok("error" in selectServerCommand("!backup --server 20 status", scope, served("10"))!)
    assert.equal(selectServerCommand("hello", scope, served("10"), "20"), undefined)
})

// Multi-mode lifecycle through the public bot options, with an in-memory Fluxer and a scripted backend
const serverA = "1100000000000000001",
    serverB = "1100000000000000002",
    serverC = "1100000000000000003",
    serverD = "1100000000000000004"
function scriptedBackend(installed: string[], gateDenied: string[] = []) {
    const active = new Set(installed),
        changes: string[] = [],
        lists: number[] = []
    respond = (call) => {
        const path = call.path,
            body = (call.body ?? {}) as { serverId?: string },
            server = call.serverId
        if (path === "/service/scope") return Response.json({ mode: "multi" })
        if (path === "/service/installations/list") {
            lists.push(active.size)
            return Response.json({ serverIds: [...active], nextCursor: null })
        }
        if (path === "/service/installations/join" || path === "/service/installations/leave") {
            const join = path.endsWith("/join")
            changes.push(`${join ? "join" : "leave"} ${body.serverId}`)
            if (join) active.add(body.serverId!)
            else active.delete(body.serverId!)
            return Response.json({ serverId: body.serverId, active: join })
        }
        assert.equal(body.serverId, server)
        if (!active.has(server!) || (path === "/moderation/gate" && gateDenied.includes(server!)))
            return Response.json({ error: "Server not allowed", code: "NEONFLUX_SCOPE_DENIED" }, { status: 403 })
        if (path === "/moderation/gate")
            return Response.json({
                allowed: true,
                defcon: 3,
                messageProtectionEnabled: false,
                joinProtectionEnabled: false,
                botMessageProtectionEnabled: false,
            })
        if (path === "/afk/observe") return Response.json({ cleared: false, statuses: [] })
        return Response.json({ error: "Backend unavailable" }, { status: 503 })
    }
    return { active, changes, lists }
}
function multiBot(
    guilds: string[],
    options = createBotOptions({ ...config, customStatus: "Serving every community" }),
) {
    return Effect.gen(function* () {
        const bot = yield* createTestBot(options)
        bot.rest.respond("GET /users/@me/guilds", (request) => ({
            body: request.query.after ? [] : guilds.map((id) => bot.fixtures.guild({ id })),
        }))
        bot.rest.respond("GET /channels/:id", (request) => ({
            body: { id: request.path.split("/")[2], type: 1, recipients: [bot.fixtures.user()] },
        }))
        const sent = bot.rest.respond("POST /channels/:id/messages", (request) => ({
            body: bot.fixtures.message({
                channel_id: request.path.split("/")[2]!,
                content: String((request.body as { content?: unknown }).content),
            }),
        }))
        yield* bot.ready()
        // Each runtime opens its events in a forked fiber after startup, so the test waits for that before sending
        yield* bot.idle()
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
        // Bounds a hang if the event never settles
        yield* bot.idle({ timeoutMs: 30000 })
        const replies = sent
            .requests()
            .slice(before)
            .map((request) => (request.body as { content: string }).content)
        assert.ok(replies.length <= 1)
        return replies[0]
    })
}
const notServed = "Select an allowed server immediately after the command name with --server <serverId>"

test("multi-mode startup serves zero servers and shows only the configured status", async () => {
    const backendState = scriptedBackend([])
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { bot, sent } = yield* multiBot([])
                assert.equal(yield* exchange(bot, sent, "!ping", serverA), undefined)
                assert.equal(yield* exchange(bot, sent, `!ping --server ${serverA}`), notServed)
                assert.deepEqual(backendState.lists, [0])
                assert.deepEqual(backendState.changes, [])
                const presence = JSON.stringify(
                    bot
                        .commands()
                        .filter((command) => command.op === 2 || command.op === 3)
                        .map((command) => command.d),
                )
                assert.match(presence, /Serving every community/)
                assert.doesNotMatch(presence, /DEFCON/)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("multi-mode startup records joins and removals, then starts each current server", async () => {
    const backendState = scriptedBackend([serverA, serverB])
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { bot, sent } = yield* multiBot([serverB, serverC])
                assert.equal(yield* exchange(bot, sent, "!ping", serverB), "Pong!")
                assert.equal(yield* exchange(bot, sent, "!ping", serverC), "Pong!")
                assert.equal(yield* exchange(bot, sent, "!ping", serverA), undefined)
                assert.deepEqual(backendState.changes, [`leave ${serverA}`, `join ${serverC}`])
                assert.deepEqual([...backendState.active].sort(), [serverB, serverC])
                // A DM selects only a server this process currently serves, and a command that runs only in a server, such as help, says so
                assert.match(
                    (yield* exchange(bot, sent, `!ping --server ${serverB}`))!,
                    /: Send `!ping` in the server\. It does not work in a DM$/,
                )
                assert.match(
                    (yield* exchange(bot, sent, `!help --server ${serverB}`))!,
                    /: Send `!help` in the server\. It does not work in a DM$/,
                )
                assert.match(
                    (yield* exchange(bot, sent, `!nosuchcommand --server ${serverB}`))!,
                    /: No command matches that\. Send `!help` in the server/,
                )
                assert.equal(yield* exchange(bot, sent, `!ping --server ${serverA}`), notServed)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("replies in a multi-mode server never print the server's ID, and commands typed there need no selector", async () => {
    scriptedBackend([serverB])
    const scripted = respond
    respond = (call) =>
        call.path === "/moderation/query" ? { type: "settings", settings: settings(), openAppeals: 2 } : scripted(call)
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { bot, sent } = yield* multiBot([serverB])
                const f = bot.fixtures,
                    everyone = f.role({ id: serverB, permissions: "0" }),
                    admin = f.role({ position: 10, permissions: Permissions.Administrator.toString() })
                bot.rest.respond(`GET /guilds/${serverB}`, { body: f.guild({ id: serverB, owner_id: f.ids.user }) })
                bot.rest.respond(`GET /guilds/${serverB}/roles`, { body: [everyone, admin] })
                bot.rest.respond(`GET /guilds/${serverB}/members/${f.ids.user}`, {
                    body: f.member({ roles: [admin.id], communication_disabled_until: null }),
                })
                bot.rest.respond(`GET /guilds/${serverB}/members/${f.ids.bot}`, {
                    body: f.member({ user: f.botUser(), roles: [admin.id], communication_disabled_until: null }),
                })
                // A command that only works in a DM says to add the selector once, without the ID
                assert.equal(
                    yield* exchange(bot, sent, "!backup", serverB),
                    "Use !backup help in a one-to-one DM with NeonFlux, adding --server with this server's ID. Backup and restore require the current server Owner",
                )
                // A hint for a command typed in the server shows it as typed there
                yield* bot.emit("MESSAGE_CREATE", f.message({ content: "!appeal status", guild_id: serverB }))
                yield* bot.idle()
                const status = JSON.stringify(sent.requests().at(-1)!.body)
                assert.match(status, /Run `!appeal review` for the list, sent by DM/)
                assert.doesNotMatch(status, new RegExp(`--server|${serverB}`))
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("a backend scope denial retires only that server's runtime", async () => {
    scriptedBackend([serverB, serverC], [serverB])
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { bot, sent } = yield* multiBot([serverB, serverC])
                assert.equal(yield* exchange(bot, sent, "!ping", serverB), undefined)
                assert.equal(bot.failures().length, 1)
                assert.equal(yield* exchange(bot, sent, "!ping", serverB), undefined)
                assert.equal(yield* exchange(bot, sent, `!ping --server ${serverB}`), notServed)
                assert.equal(yield* exchange(bot, sent, "!ping", serverC), "Pong!")
                assert.equal(bot.failures().length, 1)
            }),
        ),
    )
})

test("guildCreate registers a server once and guildDelete keeps unavailable servers and retires removed ones", async () => {
    const backendState = scriptedBackend([])
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const { bot, sent } = yield* multiBot([])
                assert.equal(yield* exchange(bot, sent, "!ping", serverD), undefined)
                for (let replay = 0; replay < 2; replay++) {
                    yield* bot.emit("GUILD_CREATE", bot.fixtures.guildCreate({ guild: { id: serverD }, channels: [] }))
                    yield* bot.idle()
                }
                assert.deepEqual(backendState.changes, [`join ${serverD}`])
                assert.equal(yield* exchange(bot, sent, "!ping", serverD), "Pong!")
                assert.match((yield* exchange(bot, sent, `!ping --server ${serverD}`))!, /Send `!ping` in the server/)
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
            }),
        ),
    )
})

// The test clock stops every backend timeout, so no runtime finishes starting until the test releases the backend
// holds every request of the given servers, or of all, and only those to one path when it is given
function holdStarts(only?: { servers?: readonly string[]; path?: string }) {
    const scripted = respond
    let release!: () => void
    const released = new Promise<void>((resolve) => {
        release = resolve
    })
    respond = async (call) => {
        if (
            call.serverId &&
            (only?.servers === undefined || only.servers.includes(call.serverId)) &&
            (only?.path === undefined || call.path === only.path)
        )
            await released
        return call.path === "/general/get" ? { prefix: "!", revision: 1 } : scripted(call)
    }
    return release
}
const gate = () => {
    let open!: () => void
    const opened = new Promise<void>((resolve) => {
        open = resolve
    })
    return { opened, open }
}
const ids = (count: number) => Array.from({ length: count }, (_, index) => String(1100000000000001000n + BigInt(index)))
const channelOf = (serverId: string) => String(BigInt(serverId) + 100000000000000n)
// Collects the pongs per channel with the message each answers, and any other reply apart. Each promise settles once, when the expected pongs
// have arrived or the first other reply has
function collectReplies(bot: TestBot, expected: number) {
    const replies = new Map<string, string[]>()
    let finish!: () => void,
        other!: () => void,
        count = 0
    const finished = new Promise<void>((resolve) => {
            finish = resolve
        }),
        otherSent = new Promise<void>((resolve) => {
            other = resolve
        })
    const others: string[] = []
    if (expected === 0) finish()
    bot.rest.respond("POST /channels/:id/messages", (request) => {
        const channelId = request.path.split("/")[2]!,
            body = request.body as { content: string; message_reference?: { message_id?: string } }
        if (body.content === "Pong!") {
            replies.set(channelId, [...(replies.get(channelId) ?? []), body.message_reference!.message_id!])
            if (++count === expected) finish()
        } else {
            others.push(body.content)
            other()
        }
        return { body: bot.fixtures.message({ channel_id: channelId }) }
    })
    return {
        replies,
        others,
        finished: Effect.promise(() => finished),
        otherSent: Effect.promise(() => otherSent),
        count: () => count,
    }
}
const ping = (bot: TestBot, serverId: string) =>
    bot.fixtures.message({ content: "!ping", guild_id: serverId, channel_id: channelOf(serverId) })

test(
    "a restart with many servers starting at once holds each server's events and drops none",
    { timeout: 120000 },
    async () => {
        const servers = ids(24)
        scriptedBackend(servers)
        const release = holdStarts()
        const rounds = 20
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(createBotOptions(config))
                    bot.rest.respond("GET /users/@me/guilds", (request) => ({
                        body: request.query.after ? [] : servers.map((id) => bot.fixtures.guild({ id })),
                    }))
                    const answered = collectReplies(bot, servers.length * rounds)
                    yield* bot.ready()
                    // The events outnumber the SDK's default queue of 256, and all wait without a handler slot until their server starts
                    const sent = new Map<string, string[]>()
                    for (let round = 0; round < rounds; round++) {
                        for (const serverId of servers) {
                            const message = ping(bot, serverId)
                            sent.set(channelOf(serverId), [...(sent.get(channelOf(serverId)) ?? []), message.id])
                            yield* bot.emit("MESSAGE_CREATE", message)
                        }
                    }
                    // The held events outnumber the eight handler slots, and a message that needs no server is still answered
                    const direct = bot.fixtures.message({
                        content: `!ping --server ${serverA}`,
                        channel_id: "1200000000000000001",
                    })
                    const { guild_id: _, ...dm } = direct
                    yield* bot.emit("MESSAGE_CREATE", dm)
                    yield* answered.otherSent
                    assert.deepEqual(answered.others, [notServed])
                    assert.equal(answered.count(), 0)
                    assert.equal(bot.counters().eventsDropped.overflow, 0)
                    release()
                    yield* answered.finished
                    yield* bot.idle()
                    assert.equal(bot.counters().eventsDropped.overflow, 0)
                    assert.equal(readCosts(bot.client).eventsDropped, 0)
                    // Every server answered every event, in arrival order
                    assert.deepEqual(answered.replies, sent)
                    assert.equal(bot.failures().length, 0)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

test(
    "a starting server with a long backlog loses its own oldest events, and other starting servers lose none",
    { timeout: 120000 },
    async () => {
        const [busy, ...quiet] = ids(4)
        scriptedBackend([busy!, ...quiet])
        const release = holdStarts()
        // The SDK's queue for messageCreate holds 2000 events, so these overflow it by 103 while the quiet servers hold one each
        const flood = 2100,
            kept = 2000 - quiet.length
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(createBotOptions(config))
                    bot.rest.respond("GET /users/@me/guilds", (request) => ({
                        body: request.query.after ? [] : [busy!, ...quiet].map((id) => bot.fixtures.guild({ id })),
                    }))
                    const answered = collectReplies(bot, kept + quiet.length)
                    yield* bot.ready()
                    const sent: string[] = []
                    for (const serverId of quiet) yield* bot.emit("MESSAGE_CREATE", ping(bot, serverId))
                    for (let count = 0; count < flood; count++) {
                        const message = ping(bot, busy!)
                        sent.push(message.id)
                        yield* bot.emit("MESSAGE_CREATE", message)
                    }
                    assert.equal(bot.counters().eventsDropped.overflow, flood - kept)
                    assert.equal(readCosts(bot.client).eventsDropped, flood - kept)
                    release()
                    yield* answered.finished
                    yield* bot.idle()
                    assert.deepEqual(answered.replies.get(channelOf(busy!)), sent.slice(flood - kept))
                    for (const serverId of quiet) assert.equal(answered.replies.get(channelOf(serverId))?.length, 1)
                    assert.equal(bot.failures().length, 0)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

test(
    "a server that leaves while starting releases its held events, which the router ignores",
    { timeout: 60000 },
    async () => {
        const [server] = ids(1)
        const backendState = scriptedBackend([server!])
        const release = holdStarts()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const { bot, sent } = yield* multiBot([server!])
                    const answered = collectReplies(bot, 0)
                    yield* bot.emit("MESSAGE_CREATE", ping(bot, server!))
                    yield* bot.emit("GUILD_DELETE", { id: server! })
                    // Bounds a hang if the held event is never released
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.deepEqual(backendState.changes, [`leave ${server}`])
                    // Events that arrive after the retirement are ignored the same way
                    yield* bot.emit("MESSAGE_CREATE", ping(bot, server!))
                    yield* bot.idle({ timeoutMs: 30000 })
                    release()
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.equal(answered.count(), 0)
                    assert.equal(sent.requests().length, 0)
                    assert.equal(bot.failures().length, 0)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

test(
    "a DM that selects a starting server is answered at once and holds no handler slot",
    { timeout: 60000 },
    async () => {
        const [server] = ids(1)
        scriptedBackend([server!])
        const release = holdStarts()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const { bot, sent } = yield* multiBot([server!])
                    assert.match(
                        (yield* exchange(bot, sent, `!ticket --server ${server} help`))!,
                        /: This server is still starting\. Try again in a moment$/,
                    )
                    release()
                    yield* bot.idle({ timeoutMs: 30000 })
                    // A command that works in a DM reaches the server's ticket handler. Help needs no reads
                    assert.match(
                        (yield* exchange(bot, sent, `!ticket --server ${server} help`))!,
                        /open <category>: Open a ticket, in a DM with NeonFlux/,
                    )
                    // The test serves no member to read, and a failed read before any write says nothing ran
                    assert.match(
                        (yield* exchange(bot, sent, `!ticket --server ${server} list`))!,
                        /: Current permissions could not be read\. Try again shortly$/,
                    )
                    assert.equal(bot.failures().length, 0)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

test(
    "unavailable notices for starting servers wait for no handler, so removals run at once",
    { timeout: 60000 },
    async () => {
        const starting = ids(10)
        const backendState = scriptedBackend(starting)
        holdStarts()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const { bot } = yield* multiBot(starting)
                    // Nine notices outnumber the eight guildDelete slots, and the first server is then removed while it starts
                    for (const id of starting.slice(0, 9)) yield* bot.emit("GUILD_DELETE", { id, unavailable: true })
                    yield* bot.emit("GUILD_DELETE", { id: starting[9] })
                    yield* bot.emit("GUILD_DELETE", { id: starting[0] })
                    // Bounds a hang if a removal waits behind a notice
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.deepEqual([...backendState.changes].sort(), [`leave ${starting[0]}`, `leave ${starting[9]}`])
                    assert.equal(bot.failures().length, 0)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

// The router handler of an event, called directly. Forked with startImmediately, it runs until its first suspension, which is the
// readiness wait of a starting server when everything before it is synchronous
type RoutedHandler = (context: never) => Effect.Effect<unknown, unknown>
const routed = (options: ReturnType<typeof createBotOptions>, name: "messageCreate") =>
    (options.events![name] as unknown as { handler: RoutedHandler }).handler
const decoded = (id: string, channelId: string, extra: Record<string, unknown>) => ({
    id,
    channelId,
    content: "!ping",
    type: MessageType.Default,
    createdAt: "2026-01-01T00:00:00.000Z",
    author: { id: "1400000000000000001", username: "synthetic", isBot: false, isSystem: false },
    ...extra,
})

test(
    "a message placed in a server by its channel is ignored when the server is removed while the message waits",
    { timeout: 60000 },
    async () => {
        const [server] = ids(1)
        scriptedBackend([server!])
        const backendCalls: string[] = []
        const scripted = respond
        respond = (call) => {
            if (call.serverId) backendCalls.push(call.path)
            return scripted(call)
        }
        holdStarts()
        const options = createBotOptions(config)
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(options)
                    bot.rest.respond("GET /users/@me/guilds", (request) => ({
                        body: request.query.after ? [] : [bot.fixtures.guild({ id: server! })],
                    }))
                    const sent = bot.rest.respond("POST /channels/:id/messages", { body: bot.fixtures.message() })
                    yield* bot.ready()
                    const channelId = channelOf(server!)
                    // The message names no server and a synchronous channel read places it in the starting server
                    const message = decoded(bot.fixtures.nextId(), channelId, {})
                    const client = {
                        rest: {
                            request: () =>
                                Effect.succeed({ status: 200, body: { id: channelId, type: 0, guild_id: server } }),
                        },
                    }
                    const context = { event: message, message, client, reply: () => Effect.die("unexpected reply") }
                    // The handler runs on until the readiness wait, so the removal below finds it parked there
                    const waiting = yield* routed(
                        options,
                        "messageCreate",
                    )(context as never).pipe(Effect.forkChild({ startImmediately: true }))
                    const before = backendCalls.length
                    yield* bot.emit("GUILD_DELETE", { id: server })
                    const exit = yield* Fiber.await(waiting)
                    assert.equal(exit._tag, "Success")
                    assert.equal(sent.requests().length, 0)
                    assert.equal(bot.failures().length, 0)
                    assert.equal(backendCalls.length, before)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

test("a bot's message is not checked for a server before its setup has finished", { timeout: 60000 }, async () => {
    const [target] = ids(1)
    scriptedBackend([target!])
    const scripted = respond
    // The target's setup learns that bot messages are checked, and the test holds that read
    respond = (call) => {
        if (call.serverId === target && call.path === "/moderation/observe")
            return {
                settings: { ...settings(), automodEnabled: true, automodBotMessagesEnabled: true },
            }
        return scripted(call)
    }
    const releaseTarget = holdStarts({ servers: [target!], path: "/moderation/observe" })
    let evaluations = 0
    const held = respond
    respond = (call) => {
        if (call.serverId === target && call.path === "/moderation/evaluate") evaluations++
        return held(call)
    }
    const options = createBotOptions(config)
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(options)
                bot.rest.respond("GET /users/@me/guilds", (request) => ({
                    body: request.query.after ? [] : [bot.fixtures.guild({ id: target! })],
                }))
                yield* bot.ready()
                const channelId = channelOf(target!)
                const message = decoded(bot.fixtures.nextId(), channelId, {
                    guildId: target,
                    webhookId: "1300000000000000098",
                })
                const context = { event: message, message, client: bot.client }
                const checked = () =>
                    evaluations + bot.requests().filter((request) => request.path.includes(target!)).length
                // The handler runs on until the target's readiness wait, before the setting that bot messages are checked is loaded
                const waiting = yield* routed(
                    options,
                    "messageCreate",
                )(context as never).pipe(Effect.forkChild({ startImmediately: true }))
                assert.equal(checked(), 0)
                releaseTarget()
                yield* Fiber.await(waiting)
                assert.equal(checked() > 0, true)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

for (const retry of [false, true]) {
    test(
        `a message placed in a server by its channel waits for ${retry ? "a failing registration and its retry" : "a queued join without a runtime"}`,
        { timeout: 60000 },
        async () => {
            const target = "1300000000000000001",
                blocker = "1300000000000000010"
            const blocking = gate(),
                release = gate(),
                firstJoining = gate(),
                firstRelease = gate()
            scriptedBackend([])
            const scripted = respond
            let attempts = 0
            respond = async (call) => {
                const joined = (call.body as { serverId?: string } | undefined)?.serverId
                if (call.path === "/service/installations/join" && joined === blocker) {
                    blocking.open()
                    await release.opened
                }
                if (call.path === "/service/installations/join" && joined === target && ++attempts === 1 && retry) {
                    firstJoining.open()
                    await firstRelease.opened
                    return Response.json({ error: "Synthetic refusal" }, { status: 503 })
                }
                return scripted(call)
            }
            const options = createBotOptions(config)
            const events = options.events as unknown as Record<
                string,
                {
                    partition: (event: object) => string
                    handler: (context: never) => Effect.Effect<unknown, unknown>
                }
            >
            await Effect.runPromise(
                Effect.scoped(
                    Effect.gen(function* () {
                        const bot = yield* createTestBot(options)
                        bot.rest.respond("GET /users/@me/guilds", { body: [] })
                        bot.rest.respond("POST /channels/:id/messages", { body: bot.fixtures.message() })
                        yield* bot.ready()
                        yield* bot.idle({ timeoutMs: 30000 })
                        const create = (id: string) =>
                            bot.emit(
                                "GUILD_CREATE",
                                bot.fixtures.guildCreate({ guild: { id }, channels: [], voice_states: [] }),
                            )
                        if (retry) {
                            yield* create(target)
                            yield* Effect.promise(() => firstJoining.opened)
                            yield* create(blocker)
                            yield* create(target)
                        } else {
                            yield* create(blocker)
                            yield* Effect.promise(() => blocking.opened)
                            yield* create(target)
                        }
                        // A command in the server's channel, received after the joins, is placed by a synchronous
                        // channel read
                        const message = decoded(bot.fixtures.nextId(), channelOf(target), {})
                        events.messageCreate!.partition(message)
                        const client = Object.create(bot.client, {
                            rest: {
                                value: {
                                    request: () =>
                                        Effect.succeed({
                                            status: 200,
                                            body: { id: message.channelId, guild_id: target, type: 0 },
                                        }),
                                },
                            },
                        })
                        const replies: unknown[] = []
                        const handler = yield* events
                            .messageCreate!.handler({
                                event: message,
                                message,
                                client,
                                reply: (body: unknown) => Effect.sync(() => replies.push(body)),
                            } as never)
                            .pipe(Effect.forkChild({ startImmediately: true }))
                        assert.equal(handler.pollUnsafe(), undefined)
                        if (retry) {
                            firstRelease.open()
                            yield* Effect.promise(() => blocking.opened)
                        }
                        release.open()
                        yield* bot.idle({ timeoutMs: 30000 })
                        yield* Fiber.join(handler)
                        assert.deepEqual(replies, [{ content: "Pong!" }])
                        assert.equal(bot.failures().length, 0)
                    }),
                ).pipe(Effect.provide(TestClock.layer())),
            )
        },
    )
}

test("a DM that names a server whose join is still pending gets an answer at once", { timeout: 60000 }, async () => {
    const target = "1300000000000000001"
    const joining = gate(),
        release = gate()
    scriptedBackend([])
    const scripted = respond
    respond = async (call) => {
        if (
            call.path === "/service/installations/join" &&
            (call.body as { serverId?: string } | undefined)?.serverId === target
        ) {
            joining.open()
            await release.opened
        }
        return scripted(call)
    }
    const options = createBotOptions(config)
    const events = options.events as unknown as Record<
        string,
        { partition: (event: object) => string; handler: (context: never) => Effect.Effect<unknown, unknown> }
    >
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(options)
                bot.rest.respond("GET /users/@me/guilds", { body: [] })
                bot.rest.respond("GET /channels/:id", (request) => ({
                    body: { id: request.path.split("/")[2], type: 1, recipients: [bot.fixtures.user()] },
                }))
                yield* bot.ready()
                yield* bot.idle({ timeoutMs: 30000 })
                // The server is being registered, so it has a runtime that has not started and its join is pending
                yield* bot.emit(
                    "GUILD_CREATE",
                    bot.fixtures.guildCreate({ guild: { id: target }, channels: [], voice_states: [] }),
                )
                yield* Effect.promise(() => joining.opened)
                const message = decoded(bot.fixtures.nextId(), "1400000000000000099", {
                    content: `!ping --server ${target}`,
                })
                events.messageCreate!.partition(message)
                const replies: { content?: string }[] = []
                const handler = yield* events
                    .messageCreate!.handler({
                        event: message,
                        message,
                        client: bot.client,
                        reply: (body: { content?: string }) => Effect.sync(() => replies.push(body)),
                    } as never)
                    .pipe(Effect.forkChild({ startImmediately: true }))
                // It finishes while the join is still blocked
                yield* Fiber.join(handler)
                assert.equal(replies.length, 1)
                assert.match(replies[0]!.content ?? "", /still starting/)
                release.open()
                yield* bot.idle({ timeoutMs: 30000 })
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})

test(
    "a DM that names a server whose join is still queued gets the selector's answer at once",
    { timeout: 60000 },
    async () => {
        const target = "1300000000000000001",
            blocker = "1300000000000000010"
        const blocking = gate(),
            release = gate()
        scriptedBackend([])
        const scripted = respond
        respond = async (call) => {
            if (
                call.path === "/service/installations/join" &&
                (call.body as { serverId?: string } | undefined)?.serverId === blocker
            ) {
                blocking.open()
                await release.opened
            }
            return scripted(call)
        }
        const options = createBotOptions(config)
        const events = options.events as unknown as Record<
            string,
            { partition: (event: object) => string; handler: (context: never) => Effect.Effect<unknown, unknown> }
        >
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(options)
                    bot.rest.respond("GET /users/@me/guilds", { body: [] })
                    bot.rest.respond("GET /channels/:id", (request) => ({
                        body: { id: request.path.split("/")[2], type: 1, recipients: [bot.fixtures.user()] },
                    }))
                    yield* bot.ready()
                    yield* bot.idle({ timeoutMs: 30000 })
                    const create = (id: string) =>
                        bot.emit(
                            "GUILD_CREATE",
                            bot.fixtures.guildCreate({ guild: { id }, channels: [], voice_states: [] }),
                        )
                    yield* create(blocker)
                    yield* Effect.promise(() => blocking.opened)
                    yield* create(target)
                    // The server has no runtime yet, and a DM does not wait for its join
                    const message = decoded(bot.fixtures.nextId(), "1400000000000000099", {
                        content: `!ping --server ${target}`,
                    })
                    events.messageCreate!.partition(message)
                    const replies: { content?: string }[] = []
                    const handler = yield* events
                        .messageCreate!.handler({
                            event: message,
                            message,
                            client: bot.client,
                            reply: (body: { content?: string }) => Effect.sync(() => replies.push(body)),
                        } as never)
                        .pipe(Effect.forkChild({ startImmediately: true }))
                    yield* Fiber.join(handler)
                    assert.equal(replies.length, 1)
                    assert.match(replies[0]!.content ?? "", /Select an allowed server/)
                    release.open()
                    yield* bot.idle({ timeoutMs: 30000 })
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

type Lifecycle = Record<
    string,
    {
        partition: (event: object) => string
        partitionReady?: (key: string) => Effect.Effect<unknown>
        handler: (context: never) => Effect.Effect<unknown, unknown>
    }
>

const createServer = (bot: TestBot, id: string) =>
    bot.emit("GUILD_CREATE", bot.fixtures.guildCreate({ guild: { id }, channels: [], voice_states: [] }))

// Both handlers wait until the lifecycle work is done, so no handler slot is free for it. A join must be
// recorded at receipt, which fails an assertion when it is recorded by a handler. Its work must start without a slot
// too, and that has no sign to assert before the backend is reached, so the timeout only guards against a hang
test(
    "a re-add received behind a waiting removal runs after it, whatever the handlers do",
    { timeout: 60000 },
    async () => {
        const backendState = scriptedBackend([serverA])
        const blocking = gate(),
            release = gate(),
            handlersHeld = gate()
        const scripted = respond
        respond = async (call) => {
            if (
                call.path === "/service/installations/join" &&
                (call.body as { serverId?: string } | undefined)?.serverId === serverB
            ) {
                blocking.open()
                await release.opened
            }
            return scripted(call)
        }
        const options = createBotOptions(config)
        const events = options.events as unknown as Lifecycle
        for (const name of ["guildCreate", "guildDelete"]) {
            const handler = events[name]!.handler
            events[name]!.handler = (context) =>
                Effect.promise(() => handlersHeld.opened).pipe(Effect.andThen(handler(context)))
        }
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const { bot, sent } = yield* multiBot([serverA], options)
                    // Another server's registration holds the queue, so the removal and then the re-add wait for it
                    yield* createServer(bot, serverB)
                    // The server's events hold for the join, which they only do once it is recorded
                    const held = yield* events.messageCreate!.partitionReady!(serverB).pipe(
                        Effect.forkChild({ startImmediately: true }),
                    )
                    assert.equal(
                        held.pollUnsafe(),
                        undefined,
                        "A join must be recorded at receipt while its handler is held",
                    )
                    yield* Effect.promise(() => blocking.opened)
                    yield* bot.emit("GUILD_DELETE", { id: serverA })
                    yield* createServer(bot, serverA)
                    release.open()
                    // Ends when the re-add is decided and its runtime has started
                    yield* events.messageCreate!.partitionReady!(serverA)
                    assert.deepEqual(backendState.changes, [`join ${serverB}`, `leave ${serverA}`, `join ${serverA}`])
                    handlersHeld.open()
                    assert.equal(yield* exchange(bot, sent, "!ping", serverA), "Pong!")
                    assert.equal(bot.failures().length, 0)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

// The queue frees a permit and wakes its waiters in a separate task, so a fiber that runs in between can take it first.
// A re-add received as the queue frees is such a fiber. It must still wait for the removal that was received before it
test(
    "a re-add received as the join queue frees does not overtake the removal waiting for it",
    { timeout: 60000 },
    async () => {
        const backendState = scriptedBackend([serverA])
        const blocking = gate(),
            release = gate(),
            readded = gate()
        const scripted = respond
        let target: TestBot | undefined
        respond = async (call) => {
            if (
                call.path === "/service/installations/join" &&
                (call.body as { serverId?: string } | undefined)?.serverId === serverB
            ) {
                blocking.open()
                await release.opened
                // The re-add is received as this registration is about to leave the queue
                Effect.runSync(createServer(target!, serverA))
                readded.open()
            }
            return scripted(call)
        }
        const options = createBotOptions(config)
        const events = options.events as unknown as Lifecycle
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const { bot, sent } = yield* multiBot([serverA], options)
                    target = bot
                    yield* createServer(bot, serverB)
                    yield* Effect.promise(() => blocking.opened)
                    // The removal's work now waits for the queue
                    yield* bot.emit("GUILD_DELETE", { id: serverA })
                    yield* Effect.yieldNow
                    release.open()
                    yield* Effect.promise(() => readded.opened)
                    yield* events.messageCreate!.partitionReady!(serverA)
                    yield* bot.idle()
                    assert.deepEqual(backendState.changes, [`join ${serverB}`, `leave ${serverA}`, `join ${serverA}`])
                    assert.equal(yield* exchange(bot, sent, "!ping", serverA), "Pong!")
                    assert.equal(bot.failures().length, 0)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

// The SDK's default queue of a subscription holds 256 events. A pending registration holds the outage notices of its
// server in it, so a removal that arrives after them finds the queue full
test(
    "a removal is recorded and a re-add runs after it although the SDK's queue of outage notices is full",
    { timeout: 60000 },
    async () => {
        const backendState = scriptedBackend([serverA])
        const blocking = gate(),
            release = gate()
        const scripted = respond
        respond = async (call) => {
            if (
                call.path === "/service/installations/join" &&
                (call.body as { serverId?: string } | undefined)?.serverId === serverB
            ) {
                blocking.open()
                await release.opened
            }
            return scripted(call)
        }
        const options = createBotOptions(config)
        const events = options.events as unknown as Lifecycle
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const { bot, sent } = yield* multiBot([serverA], options)
                    yield* createServer(bot, serverB)
                    yield* Effect.promise(() => blocking.opened)
                    for (let notice = 0; notice < 256; notice++)
                        yield* bot.emit("GUILD_DELETE", { id: serverB, unavailable: true })
                    yield* bot.emit("GUILD_DELETE", { id: serverA })
                    assert.equal(bot.counters().eventsDroppedByEvent.guildDelete! > 0, true)
                    yield* createServer(bot, serverA)
                    release.open()
                    yield* events.messageCreate!.partitionReady!(serverA)
                    assert.deepEqual(backendState.changes, [`join ${serverB}`, `leave ${serverA}`, `join ${serverA}`])
                    assert.equal(yield* exchange(bot, sent, "!ping", serverA), "Pong!")
                    assert.equal(bot.failures().length, 0)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

test(
    "an event held for a starting server that is removed and added again is not run by the new runtime",
    { timeout: 60000 },
    async () => {
        const [target, ...others] = ids(9)
        scriptedBackend([target!, ...others])
        const startEntered = gate(),
            holdStart = gate(),
            holdAfk = gate(),
            allBusy = gate()
        let starts = 0,
            busy = 0
        const scripted = respond
        respond = async (call) => {
            if (call.path === "/publishing/observe" && call.serverId === target && ++starts === 1) {
                startEntered.open()
                await holdStart.opened
            }
            // A message in another server waits here, so the eight handler slots stay taken
            if (call.path === "/afk/observe" && others.includes(call.serverId!)) {
                if (++busy === others.length) allBusy.open()
                await holdAfk.opened
            }
            return scripted(call)
        }
        const options = createBotOptions(config)
        const events = options.events as unknown as Lifecycle
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const { bot, sent } = yield* multiBot([target!, ...others], options)
                    yield* Effect.promise(() => startEntered.opened)
                    for (const id of others) yield* events.messageCreate!.partitionReady!(id)
                    for (const id of others) yield* bot.emit("MESSAGE_CREATE", ping(bot, id))
                    yield* Effect.promise(() => allBusy.opened)
                    // The target's command is held with its starting runtime, and no handler slot is free for it
                    yield* bot.emit("MESSAGE_CREATE", ping(bot, target!))
                    yield* bot.emit("GUILD_DELETE", { id: target })
                    yield* bot.emit(
                        "GUILD_CREATE",
                        bot.fixtures.guildCreate({ guild: { id: target }, channels: [], voice_states: [] }),
                    )
                    // The new runtime has started when its events are released
                    yield* events.messageCreate!.partitionReady!(target!)
                    holdStart.open()
                    holdAfk.open()
                    yield* bot.idle({ timeoutMs: 30000 })
                    const answers = () =>
                        sent.requests().filter((request) => request.path === `/channels/${channelOf(target!)}/messages`)
                    // The command held before the removal is ignored, and the new runtime answers a later one
                    assert.equal(answers().length, 0)
                    yield* bot.emit("MESSAGE_CREATE", ping(bot, target!))
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.equal(answers().length, 1)
                    assert.equal(bot.failures().length, 0)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

test(
    "an event held between a failing registration and its retry is served by the retried runtime",
    { timeout: 60000 },
    async () => {
        const [target] = ids(1)
        scriptedBackend([])
        const joining = gate(),
            release = gate()
        let attempts = 0
        const scripted = respond
        respond = async (call) => {
            if (
                call.path === "/service/installations/join" &&
                (call.body as { serverId?: string } | undefined)?.serverId === target &&
                ++attempts === 1
            ) {
                joining.open()
                await release.opened
                return Response.json({ error: "Synthetic refusal" }, { status: 503 })
            }
            return scripted(call)
        }
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const { bot, sent } = yield* multiBot([])
                    const create = () =>
                        bot.emit(
                            "GUILD_CREATE",
                            bot.fixtures.guildCreate({ guild: { id: target }, channels: [], voice_states: [] }),
                        )
                    yield* create()
                    yield* Effect.promise(() => joining.opened)
                    // Received after the first announcement and before the second, it waits for both registrations
                    yield* bot.emit("MESSAGE_CREATE", ping(bot, target!))
                    yield* create()
                    release.open()
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.deepEqual(
                        sent.requests().map((request) => (request.body as { content: string }).content),
                        ["Pong!"],
                    )
                    assert.equal(bot.failures().length, 0)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

for (const failing of [undefined, "/publishing/observe", "/roles/observe", "/roles/reaction-jobs"] as const)
    test(
        `${failing ? `a failed ${failing} call` : "a startup without failures"} leaves the later features starting`,
        // Bounds a hang, which no assertion below depends on
        { timeout: 20000 },
        async () => {
            const [target] = ids(1)
            scriptedBackend([target!])
            const scripted = respond,
                calls = new Map<string, number>()
            respond = (call) => {
                calls.set(call.path, (calls.get(call.path) ?? 0) + 1)
                if (call.path === failing) return Response.json({ error: "Backend unavailable" }, { status: 503 })
                if (call.path === "/publishing/observe" || call.path === "/roles/observe")
                    return { uncertainAttempts: 0 }
                if (call.path === "/roles/reaction-jobs") return { type: "jobs", jobs: [] }
                return scripted(call)
            }
            const options = createBotOptions(config)
            const events = options.events as unknown as Lifecycle
            await Effect.runPromise(
                Effect.scoped(
                    Effect.gen(function* () {
                        const { bot } = yield* multiBot([target!], options)
                        // Ends when the server's setup has ended, whether it failed or not
                        yield* events.messageCreate!.partitionReady!(target!)
                        yield* TestClock.adjust(0)
                        // The greetings worker starts after these steps and asks the backend for members at once
                        assert.equal(calls.has("/greetings/discover"), true)
                        // Setup ran once, and neither recovery call was repeated
                        for (const path of ["/publishing/observe", "/roles/observe", "/roles/reaction-jobs"])
                            assert.equal(calls.get(path), 1)
                        assert.equal(bot.failures().length, 0)
                    }),
                ).pipe(Effect.provide(TestClock.layer())),
            )
        },
    )

// Single mode serves one server, and a bot that cannot recover its publishing attempts stops instead of running
// without them, unlike multi mode, where the other servers go on. The control shows that nothing else stops it
for (const [failing, title] of [
    [false, "a working /publishing/observe call keeps a single-server bot running"],
    [true, "a failed /publishing/observe call stops a single-server bot"],
] as const)
    test(title, { timeout: 20000 }, async () => {
        const [target] = ids(1)
        respond = (call) => {
            if (call.path === "/publishing/observe" && failing)
                return Response.json({ error: "Backend unavailable" }, { status: 503 })
            if (call.path === "/publishing/observe" || call.path === "/roles/observe") return { uncertainAttempts: 0 }
            if (call.path === "/roles/reaction-jobs") return { type: "jobs", jobs: [] }
            return Response.json({ error: "Backend unavailable" }, { status: 503 })
        }
        const options = createBotOptions({
            token: config.token,
            scope: parseServerScope({ NEONFLUX_SERVER_ID: target! }),
            serverId: target!,
            backend,
        })
        const exit = await Effect.runPromiseExit(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(options)
                    yield* bot.ready()
                    yield* bot.idle()
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
        assert.equal(exit._tag, failing ? "Failure" : "Success")
    })

// A message event reports its channel's type, and 1 is a DM, so the bot reads no channel for it. Without the type it
// still reads the channel, and a failed read ignores the message
test(
    "a DM that reports its channel type is answered without a channel read, and a group DM is ignored",
    { timeout: 60000 },
    async () => {
        scriptedBackend([serverA])
        // The server is still starting, so the router answers a DM it places itself
        holdStarts()
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const { bot, sent } = yield* multiBot([serverA])
                    let reads = 0
                    bot.rest.respond("GET /channels/:id", () => {
                        reads++
                        return { status: 403, body: { message: "Synthetic refusal" } }
                    })
                    const dm = (channelType?: number) => {
                        const { guild_id: _, ...direct } = bot.fixtures.message({
                            content: `!ping --server ${serverA}`,
                            channel_id: "1200000000000000001",
                            ...(channelType === undefined ? {} : { channel_type: channelType }),
                        })
                        return direct
                    }
                    yield* bot.emit("MESSAGE_CREATE", dm(1))
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.equal(reads, 0)
                    assert.equal(sent.requests().length, 1)
                    assert.match((sent.requests()[0]!.body as { content: string }).content, /still starting/)
                    yield* bot.emit("MESSAGE_CREATE", dm())
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.equal(reads, 1)
                    assert.equal(sent.requests().length, 1)
                    // A group DM is ignored without a read
                    yield* bot.emit("MESSAGE_CREATE", dm(3))
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.equal(reads, 1)
                    assert.equal(sent.requests().length, 1)
                    assert.equal(bot.failures().length, 0)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

// A DM names its server by a selector and holds nothing, so it goes to the server's current runtime, even one that
// started after the DM was received
test(
    "a DM that names a server whose runtime registered after the DM was received is answered by that runtime",
    { timeout: 60000 },
    async () => {
        const target = "1300000000000000001"
        scriptedBackend([])
        const options = createBotOptions(config)
        const events = options.events as unknown as Lifecycle
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(options)
                    bot.rest.respond("GET /users/@me/guilds", { body: [] })
                    bot.rest.respond("GET /channels/:id", (request) => ({
                        body: { id: request.path.split("/")[2], type: 1, recipients: [bot.fixtures.user()] },
                    }))
                    yield* bot.ready()
                    yield* bot.idle()
                    // The member of the DM channel, whose ticket help needs the one-to-one DM check
                    const message = decoded(bot.fixtures.nextId(), "1400000000000000099", {
                        content: `!ticket --server ${target} help`,
                        author: { id: bot.fixtures.ids.user, username: "synthetic", isBot: false, isSystem: false },
                    })
                    events.messageCreate!.partition(message)
                    yield* createServer(bot, target)
                    yield* events.messageCreate!.partitionReady!(target)
                    const replies: { content?: string }[] = []
                    yield* events.messageCreate!.handler({
                        event: message,
                        message,
                        client: bot.client,
                        reply: (body: { content?: string }) => Effect.sync(() => replies.push(body)),
                    } as never)
                    assert.equal(replies.length, 1)
                    assert.match(replies[0]!.content ?? "", /open <category>: Open a ticket, in a DM with NeonFlux/)
                    assert.equal(bot.failures().length, 0)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

test(
    "a bot's message held for a runtime that was removed is not checked by the runtime that replaced it",
    { timeout: 60000 },
    async () => {
        const [target] = ids(1)
        scriptedBackend([target!])
        const scripted = respond
        let evaluations = 0
        // Both runtimes learn from their setup that bot messages are checked
        respond = (call) => {
            if (call.serverId === target && call.path === "/moderation/evaluate") evaluations++
            if (call.serverId === target && call.path === "/moderation/observe")
                return {
                    settings: { ...settings(), automodEnabled: true, automodBotMessagesEnabled: true },
                }
            return scripted(call)
        }
        const options = createBotOptions(config)
        const events = options.events as unknown as Lifecycle
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const { bot } = yield* multiBot([target!], options)
                    yield* events.messageCreate!.partitionReady!(target!)
                    const received = () => {
                        const message = decoded(bot.fixtures.nextId(), channelOf(target!), {
                            guildId: target,
                            webhookId: "1300000000000000098",
                        })
                        events.messageCreate!.partition(message)
                        return { event: message, message, client: bot.client } as never
                    }
                    const held = received()
                    yield* bot.emit("GUILD_DELETE", { id: target })
                    yield* createServer(bot, target!)
                    yield* events.messageCreate!.partitionReady!(target!)
                    const later = received()
                    // A check reads the message's channel before it asks the backend
                    const checked = () =>
                        evaluations +
                        bot.requests().filter((request) => request.path.includes(channelOf(target!))).length
                    const before = checked()
                    yield* events.messageCreate!.handler(held)
                    assert.equal(checked(), before)
                    // A message received after the re-add is checked by the new runtime
                    yield* events.messageCreate!.handler(later)
                    assert.equal(checked() > before, true)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

test(
    "a new gateway session records a server removed meanwhile, and a resume does not look",
    { timeout: 60000 },
    async () => {
        const backendState = scriptedBackend([serverA, serverB])
        const left = gate()
        const scripted = respond
        respond = (call) => {
            if (call.path === "/service/installations/leave") left.open()
            return scripted(call)
        }
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const { bot, sent } = yield* multiBot([serverA, serverB])
                    // The bot was removed from the first server while the shard was down, and nothing says so
                    bot.rest.respond("GET /users/@me/guilds", (request) => ({
                        body: request.query.after ? [] : [bot.fixtures.guild({ id: serverB })],
                    }))
                    yield* bot.disconnect()
                    yield* TestClock.adjust("2 minutes")
                    yield* bot.idle()
                    assert.deepEqual(backendState.lists, [2])
                    assert.deepEqual(backendState.changes, [])
                    yield* bot.disconnect({ endSession: true })
                    yield* TestClock.adjust("2 minutes")
                    yield* Effect.promise(() => left.opened)
                    yield* bot.idle()
                    assert.deepEqual(backendState.changes, [`leave ${serverA}`])
                    assert.equal(yield* exchange(bot, sent, "!ping", serverA), undefined)
                    assert.equal(yield* exchange(bot, sent, "!ping", serverB), "Pong!")
                    assert.equal(bot.failures().length, 0)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

test(
    "a server announced after the check of a new session began is kept although Fluxer's list lacks it",
    { timeout: 60000 },
    async () => {
        const backendState = scriptedBackend([serverA, serverC, serverB])
        const left = gate()
        const scripted = respond
        respond = (call) => {
            if (call.path === "/service/installations/leave") left.open()
            return scripted(call)
        }
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const { bot, sent } = yield* multiBot([serverA, serverB, serverC])
                    // The first server is announced while the check reads Fluxer's list, which then lacks it
                    let announced = false
                    bot.rest.respond("GET /users/@me/guilds", (request) => {
                        if (!announced) {
                            announced = true
                            Effect.runSync(createServer(bot, serverA))
                        }
                        return { body: request.query.after ? [] : [bot.fixtures.guild({ id: serverB })] }
                    })
                    yield* bot.disconnect({ endSession: true })
                    yield* TestClock.adjust("2 minutes")
                    // The check also removes the third server, which comes after the first in its order
                    yield* Effect.promise(() => left.opened)
                    yield* bot.idle()
                    assert.equal(announced, true)
                    assert.deepEqual(backendState.changes, [`leave ${serverC}`])
                    assert.equal(yield* exchange(bot, sent, "!ping", serverA), "Pong!")
                    assert.equal(bot.failures().length, 0)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)

// The check numbers its removal as of when it began, so the removal is marked behind a join received meanwhile. The
// join after it must still inherit the earlier join's receipt, or the first registration failing loses the held
// message. Checks run one at a time, so the start of the next check (its installations list) shows that the previous
// one has marked all its removals
test(
    "a session check cannot reset the receipt that a failed registration's retry inherits",
    { timeout: 60000 },
    async () => {
        const backendState = scriptedBackend([serverA])
        const initialLeft = gate(),
            surveying = gate(),
            surveyRelease = gate(),
            joining = gate(),
            joinRelease = gate(),
            next = gate()
        let lists = 0,
            attempts = 0
        const scripted = respond
        respond = async (call) => {
            if (call.path === "/service/installations/leave") {
                initialLeft.open()
                return Response.json({ error: "Synthetic unavailable" }, { status: 503 })
            }
            if (call.path === "/service/installations/list" && ++lists > 1) {
                if (lists === 2) {
                    surveying.open()
                    await surveyRelease.opened
                } else {
                    next.open()
                    return await new Promise<never>(() => {})
                }
            }
            if (
                call.path === "/service/installations/join" &&
                (call.body as { serverId?: string } | undefined)?.serverId === serverA &&
                ++attempts === 1
            ) {
                joining.open()
                await joinRelease.opened
                return Response.json({ error: "Synthetic unavailable" }, { status: 503 })
            }
            return scripted(call)
        }
        // A short recovery wait keeps each new session within the clock steps below
        const options = {
            ...createBotOptions(config),
            connection: { recovery: { minDelayMs: 100, maxDelayMs: 100 } },
        }
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const { bot, sent } = yield* multiBot([serverA], options)
                    const events = options.events as unknown as Lifecycle
                    yield* events.messageCreate!.partitionReady!(serverA)
                    // A failed removal leaves the installation in the backend without a runtime
                    yield* bot.emit("GUILD_DELETE", { id: serverA })
                    yield* Effect.promise(() => initialLeft.opened)
                    bot.rest.respond("GET /users/@me/guilds", { body: [] })
                    yield* bot.disconnect({ endSession: true })
                    yield* TestClock.adjust("1 second")
                    yield* Effect.promise(() => surveying.opened)
                    // The first re-add is received after the check began and stays pending, with a message behind it
                    yield* createServer(bot, serverA)
                    yield* Effect.promise(() => joining.opened)
                    yield* bot.emit("MESSAGE_CREATE", ping(bot, serverA))
                    // Another new session during the check makes the next check start as soon as this one is done. The
                    // clock step covers its two recovery waits and the Identify spacing. The check never gets an
                    // answer, so it marks nothing
                    yield* bot.disconnect({ endSession: true })
                    yield* TestClock.adjust("2 seconds")
                    surveyRelease.open()
                    yield* Effect.promise(() => next.opened)
                    yield* createServer(bot, serverA)
                    joinRelease.open()
                    yield* events.messageCreate!.partitionReady!(serverA)
                    yield* bot.idle()
                    const replies = sent.requests().map((request) => (request.body as { content: string }).content)
                    assert.equal(attempts, 2)
                    assert.deepEqual(replies, ["Pong!"])
                    assert.equal(bot.failures().length, 0)
                    assert.deepEqual(backendState.changes, [`join ${serverA}`])
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)
