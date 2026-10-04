import assert from "node:assert/strict"
import test from "node:test"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { parseServerScope } from "@neonflux/contracts/service"
import { adoptBackendScope, createServerRuntime, ServerScopeError } from "../src/server-runtime.ts"
import type { BotRootConfig } from "../src/config.ts"
import { createBotOptions } from "../src/bot.ts"
import { deriveServiceKey } from "../src/backend-http.ts"
import { fakeClient, type BackendCall, type BackendResponder } from "./backend-fake.ts"

const scope = parseServerScope({ NEONFLUX_SERVER_ID: "10" })
// Each test sets the backend's answers
let respond: BackendResponder = () => {
    throw new Error("Synthetic backend not scripted")
}
const client = fakeClient((call) => respond(call))
const backend = { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-secret"), client }
const config = { token: Redacted.make("synthetic-token"), scope, backend }

const adopted = async (root: BotRootConfig) => {
    const exit = await Effect.runPromiseExit(adoptBackendScope(root))
    if (exit._tag === "Success") return exit.value
    const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error
    assert(error instanceof ServerScopeError)
    return error.message
}
test("the bot adopts the backend's scope, and its own scope variable must match", async () => {
    const observed: BackendCall[] = [],
        { scope: _scope, ...unscoped } = config
    respond = (call) => {
        observed.push(call)
        return { serverIds: ["10"] }
    }
    const root = await adopted(unscoped)
    assert.ok(typeof root !== "string")
    assert.deepEqual([root.scope, root.serverId], [{ serverIds: ["10"] }, "10"])
    assert.deepEqual(
        observed.map((call) => [call.path, call.serverId, call.body]),
        [["/service/scope", undefined, {}]],
    )
    assert.equal(observed[0]!.key, Redacted.value(deriveServiceKey(backend.secret)))
    // A mismatch names the variable to fix
    respond = () => ({ serverIds: ["20"] })
    assert.match(
        String(await adopted({ ...config, serverId: "10", scope: parseServerScope({ NEONFLUX_SERVER_ID: "10" }) })),
        /different server than NEONFLUX_SERVER_ID/,
    )
    // Authentication, configuration, connection and unknown answers each get their own startup error
    for (const [answer, message] of [
        [Response.json({ error: "Unauthorized" }, { status: 401 }), /NEONFLUX_BOT_API_SECRET/],
        [Response.json({ error: "Backend not configured" }, { status: 503 }), /logs name the variable/],
        [new Error("Synthetic connection lost"), /could not be reached.*CONVEX_URL/],
        [{ serverIds: ["10"], serverId: "10" }, /not one this bot understands/],
        [{ serverIds: [] }, /not one this bot understands/],
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

// A message event reports its channel's type, and 1 is a DM, so the bot reads no channel for it. Without the type it
// still reads the channel, and a failed read ignores the message
test(
    "a DM that reports its channel type is answered without a channel read, and a group DM is ignored",
    { timeout: 60000 },
    async () => {
        const server = "1100000000000000001",
            direct = "1200000000000000001",
            refused = "1200000000000000002"
        respond = (call) => {
            if (call.path === "/moderation/gate")
                return { allowed: true, defcon: 3, messageProtectionEnabled: false, joinProtectionEnabled: false }
            return Response.json({ error: "Backend unavailable" }, { status: 503 })
        }
        await Effect.runPromise(
            Effect.scoped(
                Effect.gen(function* () {
                    const bot = yield* createTestBot(
                        createBotOptions({ token: config.token, serverId: server, backend }),
                    )
                    const f = bot.fixtures,
                        reads: string[] = []
                    // The appeal command's own check of the one-to-one DM reads it too, so only the refused channel tells the router's read apart
                    bot.rest.respond("GET /channels/:id", (request) => {
                        const id = request.path.split("/")[2]!
                        reads.push(id)
                        return id === direct
                            ? { body: { id, type: 1, recipients: [f.user()] } }
                            : { status: 403, body: { message: "Synthetic refusal" } }
                    })
                    const sent = bot.rest.respond("POST /channels/:id/messages", (request) => ({
                        body: f.message({ channel_id: request.path.split("/")[2]! }),
                    }))
                    yield* bot.ready()
                    yield* bot.idle()
                    const dm = (channelId: string, channelType?: number) => {
                        const { guild_id: _, ...message } = f.message({
                            content: "!appeal help",
                            channel_id: channelId,
                            ...(channelType === undefined ? {} : { channel_type: channelType }),
                        })
                        return message
                    }
                    yield* bot.emit("MESSAGE_CREATE", dm(direct, 1))
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.deepEqual(reads, [direct])
                    assert.equal(sent.requests().length, 1)
                    assert.match(
                        (sent.requests()[0]!.body as { content: string }).content,
                        /submit <case> <text>: Appeal a case, in a DM/,
                    )
                    yield* bot.emit("MESSAGE_CREATE", dm(refused))
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.deepEqual(reads, [direct, refused])
                    assert.equal(sent.requests().length, 1)
                    // A group DM is ignored without a read
                    yield* bot.emit("MESSAGE_CREATE", dm(direct, 3))
                    yield* bot.idle({ timeoutMs: 30000 })
                    assert.deepEqual(reads, [direct, refused])
                    assert.equal(sent.requests().length, 1)
                    assert.equal(bot.failures().length, 0)
                }),
            ).pipe(Effect.provide(TestClock.layer())),
        )
    },
)
