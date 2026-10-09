import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Queue, Redacted } from "effect"
import { TestClock } from "effect/testing"
import type { ServiceWork, ServiceWorkKind } from "@neonflux/backend/contracts"
import { parseDeploymentScope } from "../src/server-scope.ts"
import { createBotOptions } from "../src/bot.ts"
import { startWorkDispatcher, workDelay, workKinds } from "../src/work-dispatcher.ts"

const backend = { siteUrl: "https://synthetic.invalid", secret: Redacted.make("synthetic-secret") }
const noWork = Object.fromEntries(workKinds.map(kind => [kind, []])) as unknown as Record<ServiceWorkKind, string[]>
const work = (kinds: Partial<Record<ServiceWorkKind, string[]>>, cursor: string | null = null): ServiceWork => ({ kinds: { ...noWork, ...kinds }, cursor })
type Seen = { path: string, server: string | undefined, body: unknown }

// One poll per scripted response. The dispatcher's sleep is a barrier, so each poll runs only when the test allows it
function scriptedPolls(t: TestContext, responses: (ServiceWork | Response)[]) {
    const seen: Seen[] = []
    t.mock.method(globalThis, "fetch", async (input: URL, init: RequestInit) => {
        seen.push({ path: new URL(input).pathname, server: (init.headers as Record<string, string>)["X-NeonFlux-Server-ID"], body: JSON.parse(String(init.body)) })
        const next = responses.shift() ?? work({})
        return next instanceof Response ? next : Response.json(next)
    })
    return seen
}
function barrier() {
    return Effect.gen(function* () {
        const sleeps = yield* Queue.unbounded<number>(), ticks = yield* Queue.unbounded<void>()
        return { sleeps, next: () => Queue.offer(ticks, undefined), sleep: (millis: number) => Queue.offer(sleeps, millis).pipe(Effect.andThen(Queue.take(ticks)), Effect.asVoid) }
    })
}

test("one poll binds no server, wakes every reported server and kind before sleeping and returns the cursor", async t => {
    const seen = scriptedPolls(t, [work({ schedules: ["10"], cleanup: ["20", "10"], dashboard: ["30"] }, "synthetic_cursor"), work({})])
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const clock = yield* barrier(), wakes: string[] = []
        yield* startWorkDispatcher(backend, (serverId, kind) => Effect.sync(() => { wakes.push(`${kind} ${serverId}`) }), { sleep: clock.sleep })
        assert.equal(yield* Queue.take(clock.sleeps), 5000)
        assert.deepEqual(wakes, ["dashboard 30", "schedules 10", "cleanup 20", "cleanup 10"])
        assert.deepEqual(seen, [{ path: "/service/work", server: undefined, body: { cursor: null } }])
        yield* clock.next()
        assert.equal(yield* Queue.take(clock.sleeps), 5000)
        assert.deepEqual(seen.map(request => request.body), [{ cursor: null }, { cursor: "synthetic_cursor" }])
        assert.equal(wakes.length, 4)
    })))
})

test("failures and malformed responses back off up to five minutes, restart the cursor and wake nothing", async t => {
    const failures = [
        Response.json({ error: "Backend unavailable" }, { status: 503 }), Response.json({ error: "Unauthorized" }, { status: 401 }),
        work({}).kinds as unknown as ServiceWork, { kinds: { ...noWork, cleanup: ["01"] }, cursor: null }, { kinds: { ...noWork, cleanup: ["10", "10"] }, cursor: null },
        { kinds: noWork, cursor: "" }, { kinds: { ...noWork, metadata: Array.from({ length: 101 }, (_, index) => String(100 + index)) }, cursor: null },
    ] as (ServiceWork | Response)[]
    const seen = scriptedPolls(t, [work({}, "synthetic_cursor"), ...failures, work({ levels: ["10"] })])
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const clock = yield* barrier(), wakes: string[] = [], delays: number[] = []
        yield* startWorkDispatcher(backend, (serverId, kind) => Effect.sync(() => { wakes.push(`${kind} ${serverId}`) }), { sleep: clock.sleep })
        for (let poll = 0; poll < failures.length + 2; poll++) {
            delays.push(yield* Queue.take(clock.sleeps))
            yield* clock.next()
        }
        assert.deepEqual(delays, [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000, 5000])
        assert.deepEqual(delays.slice(1, -1), failures.map((_, index) => workDelay(index + 1)))
        assert.deepEqual(wakes, ["levels 10"])
        // Only the poll after a success sends its cursor
        assert.deepEqual(seen.slice(0, 3).map(request => request.body), [{ cursor: null }, { cursor: "synthetic_cursor" }, { cursor: null }])
    })))
})

test("a failing wake neither stops the dispatcher nor skips the other wakes", async t => {
    scriptedPolls(t, [work({ schedules: ["10", "20"] }), work({ schedules: ["20"] })])
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const clock = yield* barrier(), wakes: string[] = []
        yield* startWorkDispatcher(backend, serverId => serverId === "10" ? Effect.die(new Error("Synthetic worker stopped")) : Effect.sync(() => { wakes.push(serverId) }), { sleep: clock.sleep })
        assert.equal(yield* Queue.take(clock.sleeps), 5000)
        yield* clock.next()
        assert.equal(yield* Queue.take(clock.sleeps), 5000)
        assert.deepEqual(wakes, ["20", "20"])
    })))
})

// A multi-mode bot with every worker started. Worker routes answer 503, which still proves that a wake ran the worker's pass.
// The test clock keeps request timeouts and the dispatcher's next poll from running, so the first poll waits for the test
const serverA = "1100000000000000001", serverB = "1100000000000000002"
const workerPaths: Record<ServiceWorkKind, string> = {
    dashboard: "/dashboard-roles/ready", verification: "/verification/ready", events: "/events/delivery", schedules: "/schedules/delivery", milestones: "/milestones/delivery",
    suggestions: "/suggestions/work", cleanup: "/cleanup/work", metadata: "/metadata-logs/work", levels: "/levels/work",
}
function multiBackend(t: TestContext, firstPoll: Promise<ServiceWork>) {
    const active = new Set([serverA, serverB]), seen: Seen[] = [], waiters = new Map<string, () => void>(), changes: string[] = []
    let polls = 0
    const called = (path: string, server: string) => new Promise<void>(resolve => {
        if (seen.some(request => request.path === path && request.server === server)) resolve()
        else waiters.set(`${path} ${server}`, resolve)
    })
    t.mock.method(globalThis, "fetch", async (input: URL, init: RequestInit) => {
        const path = new URL(input).pathname, body = init.body ? JSON.parse(String(init.body)) as { serverId?: string } : {}
        const server = (init.headers as Record<string, string>)["X-NeonFlux-Server-ID"]
        seen.push({ path, server, body })
        waiters.get(`${path} ${server}`)?.()
        if (path === "/service/scope") return Response.json({ mode: "multi" })
        if (path === "/service/installations/list") return Response.json({ serverIds: [...active], nextCursor: null })
        if (path === "/service/installations/leave") { changes.push(`leave ${body.serverId}`); active.delete(body.serverId!); return Response.json({ serverId: body.serverId, active: false }) }
        if (path === "/service/work") return Response.json(polls++ === 0 ? await firstPoll : work({}))
        if (!active.has(server!)) return Response.json({ error: "Server not allowed", code: "NEONFLUX_SCOPE_DENIED" }, { status: 403 })
        if (path === "/publishing/observe" || path === "/roles/observe") return Response.json({ uncertainAttempts: 0 })
        if (path === "/roles/reaction-jobs") return Response.json({ type: "jobs", jobs: [] })
        if (path === "/moderation/gate") return Response.json({ allowed: true, defcon: 3, messageProtectionEnabled: false, joinProtectionEnabled: false })
        if (path === "/afk/observe") return Response.json({ cleared: false, statuses: [] })
        return Response.json({ error: "Backend unavailable" }, { status: 503 })
    })
    const workerCalls = (server: string) => seen.filter(request => request.server === server && Object.values(workerPaths).includes(request.path)).map(request => request.path)
    return { seen, called, changes, workerCalls }
}
function multiBot() {
    return Effect.gen(function* () {
        const config = { token: Redacted.make("synthetic-token"), scope: parseDeploymentScope({ NEONFLUX_SERVER_MODE: "multi" }), backend, websiteUrl: "https://dashboard.synthetic.invalid" }
        const bot = yield* createTestBot(createBotOptions(config))
        bot.rest.respond("GET /users/@me/guilds", request => ({ body: request.query.after ? [] : [serverA, serverB].map(id => bot.fixtures.guild({ id })) }))
        yield* bot.ready()
        // A reply proves that server's runtime finished starting its workers
        for (const guild_id of [serverA, serverB]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!ping", guild_id }))
            yield* bot.idle()
        }
        return bot
    })
}

test("the bot's one dispatcher wakes every polled worker of a reported server and only the reported kinds of another", async t => {
    let release!: (value: ServiceWork) => void
    const state = multiBackend(t, new Promise(resolve => { release = resolve }))
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* multiBot()
        assert.deepEqual(state.workerCalls(serverA), [])
        assert.deepEqual(state.workerCalls(serverB), [])
        // Levels is woken last, so a wrong wake of server B's other workers would run before its level worker
        assert.equal(workKinds.at(-1), "levels")
        release(work({ ...Object.fromEntries(workKinds.map(kind => [kind, [serverA]])), levels: [serverA, serverB] }))
        yield* Effect.promise(() => Promise.all([...Object.values(workerPaths).map(path => state.called(path, serverA)), state.called("/levels/work", serverB)]))
        assert.deepEqual(new Set(state.workerCalls(serverA)), new Set(Object.values(workerPaths)))
        assert.deepEqual(state.workerCalls(serverB), ["/levels/work"])
        assert.equal(state.seen.filter(request => request.path === "/service/work").every(request => request.server === undefined), true)
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("a runtime retired after leaving its server makes no worker requests when the backend still reports it", async t => {
    let release!: (value: ServiceWork) => void
    const state = multiBackend(t, new Promise(resolve => { release = resolve }))
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* multiBot()
        yield* bot.emit("GUILD_DELETE", { id: serverA })
        yield* bot.idle()
        assert.deepEqual(state.changes, [`leave ${serverA}`])
        release(work({ schedules: [serverA, serverB], cleanup: [serverA] }))
        yield* Effect.promise(() => state.called("/schedules/delivery", serverB))
        assert.deepEqual(state.workerCalls(serverA), [])
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})
