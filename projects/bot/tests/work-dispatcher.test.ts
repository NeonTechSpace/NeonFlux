import assert from "node:assert/strict"
import test from "node:test"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Queue, Redacted } from "effect"
import { TestClock } from "effect/testing"
import type { ServiceWork, ServiceWorkKind } from "@neonflux/contracts/service"
import type { BackendClient } from "../src/config.ts"
import { deriveServiceKey } from "../src/backend-http.ts"
import { createBotOptions } from "../src/bot.ts"
import {
    createWorkNotices,
    startWorkDispatcher,
    workDelay,
    workKinds,
    workMinGapMs,
    workPagesPerPass,
    workSafetyPollMs,
} from "../src/work-dispatcher.ts"
import { fakeClient, quietSignal, type BackendCall } from "./backend-fake.ts"

const secret = Redacted.make("synthetic-dispatch-secret")
const noWork = Object.fromEntries(workKinds.map((kind) => [kind, []])) as unknown as Record<ServiceWorkKind, string[]>
const work = (
    kinds: Partial<Record<ServiceWorkKind, string[]>>,
    cursor: string | null = null,
    nextDueIn: number | null = null,
): ServiceWork => ({ kinds: { ...noWork, ...kinds }, cursor, nextDueIn })
const sentAt = (call: BackendCall) => (call.body as { requestedAt: number }).requestedAt
const sentCursor = (call: BackendCall) => (call.body as { cursor: unknown }).cursor
const sentHeld = (call: BackendCall) => (call.body as { held?: unknown }).held

// A scripted backend under the test clock. Each dispatch takes the next answer, or no work, and is queued for the test to
// take, so a test sees every pass in order with the clock time it ran. An answer that is a function runs while its request
// is in flight. The test drives the work signal
function scripted(answers: unknown[]) {
    return Effect.gen(function* () {
        const calls = yield* Queue.unbounded<BackendCall>(),
            subscriptions: Record<string, unknown>[] = []
        let emit: ((value: unknown) => void) | undefined, fail: ((error: unknown) => void) | undefined
        const subscribe: BackendClient["subscribe"] = (_name, args, onValue, onError) => {
            subscriptions.push(args)
            emit = onValue
            fail = onError
            return () => {
                emit = undefined
            }
        }
        const client = fakeClient((call) => {
            Queue.offerUnsafe(calls, call)
            const answer = answers.length ? answers.shift() : work({})
            return typeof answer === "function" ? answer() : answer
        }, subscribe)
        return {
            backend: { url: "https://synthetic.invalid", secret, client },
            subscriptions,
            next: Queue.take(calls),
            signal: (version: number) => Effect.sync(() => emit?.({ version })),
            signalFails: Effect.sync(() => fail?.(new Error("Synthetic subscription error"))),
        }
    })
}
const run = <A>(body: Effect.Effect<A, never, any>) =>
    Effect.runPromise(Effect.scoped(body).pipe(Effect.provide(TestClock.layer())) as Effect.Effect<A>)

test("a pass starts at once, binds no server, wakes every reported server and kind before its next page and returns the cursor", () =>
    run(
        Effect.gen(function* () {
            const backend = yield* scripted([
                work({ schedules: ["10"], levels: ["20", "10"], events: ["30"] }, "synthetic_cursor"),
                work({}),
            ])
            const wakes: string[] = []
            yield* startWorkDispatcher(backend.backend, (serverId, kind) =>
                Effect.sync(() => {
                    wakes.push(`${kind} ${serverId}`)
                }),
            )
            const first = yield* backend.next
            assert.deepEqual(
                [first.path, first.serverId, sentCursor(first), sentAt(first)],
                ["/service/work", undefined, null, 0],
            )
            assert.equal(first.key, Redacted.value(deriveServiceKey(secret)))
            assert.deepEqual(backend.subscriptions, [{ key: Redacted.value(deriveServiceKey(secret)) }])
            const second = yield* backend.next
            assert.deepEqual([sentCursor(second), sentAt(second)], ["synthetic_cursor", 0])
            assert.deepEqual(wakes, ["events 30", "schedules 10", "levels 20", "levels 10"])
        }),
    ))

test("full pages are read back to back up to the pass limit, and only a pass that found work continues after the gap", () =>
    run(
        Effect.gen(function* () {
            const pages = (found: boolean) =>
                Array.from({ length: workPagesPerPass }, (_, page) =>
                    work(found && page === 0 ? { levels: ["10"] } : {}, `cursor_${found}_${page}`),
                )
            const backend = yield* scripted([...pages(true), ...pages(false), work({}, "cursor_fresh")])
            yield* startWorkDispatcher(backend.backend, () => Effect.void)
            const firstPass: BackendCall[] = []
            for (let page = 0; page < workPagesPerPass; page++) firstPass.push(yield* backend.next)
            assert.deepEqual(firstPass.map(sentAt), Array(workPagesPerPass).fill(0))
            assert.deepEqual(firstPass.map(sentCursor), [
                null,
                ...Array.from({ length: workPagesPerPass - 1 }, (_, page) => `cursor_true_${page}`),
            ])
            // The pass woke a server and left pages, so the next pass continues from its cursor as soon as the gap allows
            yield* TestClock.adjust(workMinGapMs)
            const secondPass: BackendCall[] = []
            for (let page = 0; page < workPagesPerPass; page++) secondPass.push(yield* backend.next)
            assert.deepEqual(secondPass.map(sentAt), Array(workPagesPerPass).fill(workMinGapMs))
            assert.equal(sentCursor(secondPass[0]!), `cursor_true_${workPagesPerPass - 1}`)
            // Pages of rows no worker acts on wait for the next trigger, here the safety pass, and keep their cursor. That
            // pass reads its first page fresh, since the cursor skips every source it does not name, and holds the cursor
            // for the backend to go on with
            yield* TestClock.adjust(workMinGapMs)
            yield* TestClock.adjust(workSafetyPollMs - workMinGapMs)
            const fresh = yield* backend.next,
                resumed = yield* backend.next
            assert.deepEqual(
                [sentAt(fresh), sentCursor(fresh), sentHeld(fresh), sentCursor(resumed), sentHeld(resumed)],
                [
                    workMinGapMs + workSafetyPollMs,
                    null,
                    `cursor_false_${workPagesPerPass - 1}`,
                    "cursor_fresh",
                    undefined,
                ],
            )
        }),
    ))

test("a changed signal after pages of rows no worker acts on reads every source again, so new work is not skipped", () =>
    run(
        Effect.gen(function* () {
            const unserved = Array.from({ length: workPagesPerPass }, (_, page) => work({}, `cursor_${page}`))
            const backend = yield* scripted([...unserved, work({ events: ["30"] })])
            const wakes: string[] = []
            yield* startWorkDispatcher(backend.backend, (serverId, kind) =>
                Effect.sync(() => {
                    wakes.push(`${kind} ${serverId}`)
                }),
            )
            for (let page = 0; page < workPagesPerPass; page++) yield* backend.next
            // New work changes the signal while the cursor still names only the unserved source
            yield* backend.signal(1)
            yield* TestClock.adjust(workMinGapMs)
            const next = yield* backend.next
            assert.deepEqual([sentAt(next), sentCursor(next)], [workMinGapMs, null])
            assert.deepEqual(wakes, ["events 30"])
        }),
    ))

test("a signal while the last page of a pass that woke servers is in flight still starts the next pass fresh", () =>
    run(
        Effect.gen(function* () {
            const pages: unknown[] = Array.from({ length: workPagesPerPass }, (_, page) =>
                work({ levels: ["10"] }, `cursor_${page}`),
            )
            const backend = yield* scripted(pages)
            // The signal changes while the last page of the pass is in flight
            const last = pages[workPagesPerPass - 1]
            pages[workPagesPerPass - 1] = () => {
                Effect.runSync(backend.signal(1))
                return last
            }
            yield* startWorkDispatcher(backend.backend, () => Effect.void)
            for (let page = 0; page < workPagesPerPass; page++) yield* backend.next
            yield* TestClock.adjust(workMinGapMs)
            const next = yield* backend.next
            assert.deepEqual(
                [sentAt(next), sentCursor(next), sentHeld(next)],
                [workMinGapMs, null, `cursor_${workPagesPerPass - 1}`],
            )
        }),
    ))

test("a changed work signal dispatches at once, at most every three seconds, and an unchanged signal does nothing", () =>
    run(
        Effect.gen(function* () {
            const backend = yield* scripted([])
            yield* startWorkDispatcher(backend.backend, () => Effect.void)
            assert.equal(sentAt(yield* backend.next), 0)
            // The first signal value counts as a change. The pass just ran, so it waits for the gap
            yield* backend.signal(1)
            yield* TestClock.adjust(1000)
            yield* TestClock.adjust(workMinGapMs - 1000)
            assert.equal(sentAt(yield* backend.next), workMinGapMs)
            yield* backend.signal(1)
            yield* TestClock.adjust(workMinGapMs)
            // Once the gap has passed, a change dispatches without waiting
            yield* backend.signal(2)
            assert.equal(sentAt(yield* backend.next), 2 * workMinGapMs)
        }),
    ))

test("due times from a dispatch and from mutation answers set the timer, and a safety pass runs every two minutes", () =>
    run(
        Effect.gen(function* () {
            const backend = yield* scripted([work({}, null, 60000)]),
                notices = createWorkNotices()
            yield* startWorkDispatcher(backend.backend, () => Effect.void, notices)
            assert.equal(sentAt(yield* backend.next), 0)
            yield* TestClock.adjust(59999)
            yield* TestClock.adjust(1)
            assert.equal(sentAt(yield* backend.next), 60000)
            // A mutation answer reports work due ten seconds later
            yield* Effect.sync(() => notices.report(70000))
            yield* TestClock.adjust(10000)
            assert.equal(sentAt(yield* backend.next), 70000)
            // A report already due waits only for the gap
            yield* Effect.sync(() => notices.report(70000))
            yield* TestClock.adjust(workMinGapMs)
            assert.equal(sentAt(yield* backend.next), 70000 + workMinGapMs)
            yield* TestClock.adjust(workSafetyPollMs)
            assert.equal(sentAt(yield* backend.next), 70000 + workMinGapMs + workSafetyPollMs)
        }),
    ))

test("a changed signal during a backoff gets one early probe per interval, after the usual gap", () =>
    run(
        Effect.gen(function* () {
            const unavailable = () => Response.json({ error: "Backend unavailable" }, { status: 503 })
            const backend = yield* scripted([unavailable(), unavailable(), unavailable()])
            yield* startWorkDispatcher(backend.backend, () => Effect.void)
            assert.equal(sentAt(yield* backend.next), 0)
            // The first signal value is a change. The probe waits for the gap, not for the ten-second backoff
            yield* backend.signal(1)
            yield* TestClock.adjust(workMinGapMs)
            assert.equal(sentAt(yield* backend.next), workMinGapMs)
            // The failed probe started a new interval and spent its probe, so another change waits for the retry
            yield* backend.signal(2)
            yield* TestClock.adjust(workDelay(2) - 1)
            yield* TestClock.adjust(1)
            assert.equal(sentAt(yield* backend.next), workMinGapMs + workDelay(2))
            // The retry's own interval has a probe again, and the backend answering ends the backoff
            yield* backend.signal(3)
            yield* TestClock.adjust(workMinGapMs)
            assert.equal(sentAt(yield* backend.next), 2 * workMinGapMs + workDelay(2))
        }),
    ))

test("failures back off from ten seconds to five minutes, restart the cursor and wake nothing", () =>
    run(
        Effect.gen(function* () {
            const failures: unknown[] = [
                Response.json({ error: "Backend unavailable" }, { status: 503 }),
                Response.json({ error: "Unauthorized" }, { status: 401 }),
                work({}).kinds,
                { kinds: { ...noWork, schedules: ["01"] }, cursor: null, nextDueIn: null },
                { kinds: { ...noWork, schedules: ["10", "10"] }, cursor: null, nextDueIn: null },
                { kinds: noWork, cursor: "", nextDueIn: null },
                {
                    kinds: { ...noWork, schedules: Array.from({ length: 101 }, (_, index) => String(100 + index)) },
                    cursor: null,
                    nextDueIn: null,
                },
                { kinds: noWork, cursor: null, nextDueIn: -1 },
                { kinds: noWork, cursor: null },
            ]
            const backend = yield* scripted([
                work({ schedules: ["10"] }, "synthetic_cursor"),
                ...failures,
                work({ levels: ["10"] }),
            ])
            const wakes: string[] = []
            yield* startWorkDispatcher(backend.backend, (serverId, kind) =>
                Effect.sync(() => {
                    wakes.push(`${kind} ${serverId}`)
                }),
            )
            assert.equal(sentAt(yield* backend.next), 0)
            // The cursor continues the same pass, whose next page fails
            const first = yield* backend.next
            assert.deepEqual([sentAt(first), sentCursor(first)], [0, "synthetic_cursor"])
            let time = 0
            for (let failure = 1; failure <= failures.length; failure++) {
                yield* TestClock.adjust(workDelay(failure) - 1)
                yield* TestClock.adjust(1)
                time += workDelay(failure)
                const retry = yield* backend.next
                assert.deepEqual([sentAt(retry), sentCursor(retry)], [time, null])
            }
            assert.deepEqual(
                failures.map((_, index) => workDelay(index + 1)),
                [10000, 20000, 40000, 80000, 160000, 300000, 300000, 300000, 300000],
            )
            assert.deepEqual(wakes, ["schedules 10", "levels 10"])
        }),
    ))

test("a failing wake neither stops the dispatcher nor skips the other wakes, and a broken subscription leaves timed passes", () =>
    run(
        Effect.gen(function* () {
            const backend = yield* scripted([work({ schedules: ["10", "20"] }), work({ schedules: ["20"] })])
            const wakes: string[] = []
            yield* startWorkDispatcher(backend.backend, (serverId) =>
                serverId === "10"
                    ? Effect.die(new Error("Synthetic worker stopped"))
                    : Effect.sync(() => {
                          wakes.push(serverId)
                      }),
            )
            yield* backend.next
            yield* backend.signalFails
            yield* TestClock.adjust(workSafetyPollMs)
            assert.equal(sentAt(yield* backend.next), workSafetyPollMs)
            yield* TestClock.adjust(workSafetyPollMs)
            yield* backend.next
            assert.deepEqual(wakes, ["20", "20"])
        }),
    ))

// A bot with every worker started. Worker functions answer 503, which still proves that a wake ran the worker's pass.
// The test clock keeps request timeouts and later passes from running, so the first pass waits for the test
const serverA = "1100000000000000001"
const workerPaths: Record<ServiceWorkKind, string> = {
    events: "/events/delivery",
    schedules: "/schedules/delivery",
    milestones: "/milestones/delivery",
    suggestions: "/suggestions/work",
    levels: "/levels/work",
}
type Seen = { path: string; server: string | undefined; body: unknown }
function dispatchBackend(firstPass: Promise<ServiceWork>) {
    const seen: Seen[] = [],
        waiters = new Map<string, () => void>()
    let passes = 0
    const called = (path: string, server: string) =>
        new Promise<void>((resolve) => {
            if (seen.some((request) => request.path === path && request.server === server)) resolve()
            else waiters.set(`${path} ${server}`, resolve)
        })
    const client = fakeClient(async (call) => {
        const { path } = call,
            body = (call.body ?? {}) as { serverId?: string },
            server = call.serverId
        seen.push({ path, server, body })
        waiters.get(`${path} ${server}`)?.()
        if (path === "/service/work") return passes++ === 0 ? await firstPass : work({})
        if (path === "/publishing/observe" || path === "/roles/observe") return { uncertainAttempts: 0 }
        if (path === "/roles/reaction-jobs") return { type: "jobs", jobs: [] }
        if (path === "/moderation/gate")
            return {
                allowed: true,
                defcon: 3,
                messageProtectionEnabled: false,
                joinProtectionEnabled: false,
            }
        if (path === "/afk/observe") return { cleared: false, statuses: [] }
        return Response.json({ error: "Backend unavailable" }, { status: 503 })
    }, quietSignal)
    const workerCalls = (server: string) =>
        seen
            .filter((request) => request.server === server && Object.values(workerPaths).includes(request.path))
            .map((request) => request.path)
    return { client, seen, called, workerCalls }
}
function dispatchBot(client: BackendClient) {
    return Effect.gen(function* () {
        const config = {
            token: Redacted.make("synthetic-token"),
            serverId: serverA,
            backend: { url: "https://synthetic.invalid", secret, client },
        }
        const bot = yield* createTestBot(createBotOptions(config))
        yield* bot.ready()
        // A reply proves that the server's runtime finished starting its workers
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!ping", guild_id: serverA }))
        yield* bot.idle()
        return bot
    })
}

test("the bot's one dispatcher wakes only the reported workers of its server", async () => {
    let release!: (value: ServiceWork) => void
    const state = dispatchBackend(
        new Promise((resolve) => {
            release = resolve
        }),
    )
    // Suggestions are not reported. Levels is woken last, so a wrong wake of the suggestions worker would run before it
    const reported = workKinds.filter((kind) => kind !== "suggestions"),
        paths = reported.map((kind) => workerPaths[kind])
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* dispatchBot(state.client)
                assert.deepEqual(state.workerCalls(serverA), [])
                assert.equal(workKinds.at(-1), "levels")
                release(work(Object.fromEntries(reported.map((kind) => [kind, [serverA]]))))
                yield* Effect.promise(() => Promise.all(paths.map((path) => state.called(path, serverA))))
                assert.deepEqual(new Set(state.workerCalls(serverA)), new Set(paths))
                assert.equal(
                    state.seen
                        .filter((request) => request.path === "/service/work")
                        .every((request) => request.server === undefined),
                    true,
                )
                assert.equal(bot.failures().length, 0)
            }),
        ).pipe(Effect.provide(TestClock.layer())),
    )
})
