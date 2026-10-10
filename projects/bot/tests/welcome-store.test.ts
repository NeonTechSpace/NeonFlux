import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import { inspect } from "node:util"
import type { PublishingContent } from "@neonflux/contracts/publishing-base"
import type { ModerationActor } from "@neonflux/contracts/shared"
import type { GreetingsBinding, GreetingsContext, GreetingsDelivery, GreetingsDispatchRequest, GreetingsGrant, GreetingsManageRequest, GreetingsMember, GreetingsMemberContext, GreetingsObserveRequest, GreetingsOutcomeRequest, GreetingsQueryRequest, GreetingsReserveRequest, GreetingsSettings } from "@neonflux/contracts/greetings"
import { Deferred, Effect, Exit, Fiber, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createGreetingsStore } from "../src/welcome-store.ts"
import { deriveServiceKey } from "../src/backend-http.ts"
import { mockBackend, type BackendCall } from "./backend-fake.ts"

const serverId = "123456789012345678"
const userId = "123456789012345679"
const botId = "123456789012345680"
const channelId = "123456789012345681"
const otherId = "123456789012345682"
const sourceId = "123456789012345683"
const joinedAt = "2026-10-01T00:00:00.123456789Z"
const actor: ModerationActor = { userId, roleIds: [], isOwner: true, isAdministrator: true, nativePermissionAuthorized: true }
const content: PublishingContent = { content: "Welcome" }
const settings: GreetingsSettings = { routes: {
    welcome: { revision: 2, enabled: true, timing: "verified", channelId, templateName: "hello", templateRevision: 3, content },
    dm: { revision: 1, enabled: false, timing: "join" }, goodbye: { revision: 1, enabled: false, timing: "join" },
}, claimsPerMinute: 10, retentionDays: 30 }
const binding: GreetingsBinding = { serverId, deliveryId: "synthetic_delivery", route: "welcome", routeRevision: 2, userId, joinedAt, memberGeneration: 4 }
const member: GreetingsMemberContext = { userId, userName: "Synthetic User", serverName: "Synthetic Server", joinedAt, isBot: false, roleIds: [], timeoutUntil: null }
const context: GreetingsContext = { botId, botAuthorized: true, observedAt: 2000, member, memberAbsent: false, channelId }
const reserve: GreetingsReserveRequest = { ...binding, context }
const secret = "synthetic-greetings-adapter-secret"
const config = { url: "https://synthetic-test.convex.cloud", secret: Redacted.make(secret) }
function grant(): GreetingsGrant {
    const { serverId: _serverId, ...identity } = binding
    return { ...identity, deliveryNo: 7, templateName: "hello", templateRevision: 3, botId, channelId, content,
        canonicalContent: content, dispatchExpiresAt: 182000, nativeDeadlineMs: 5000 }
}
function delivery(): GreetingsDelivery {
    const { serverId: _serverId, ...identity } = binding
    return { ...identity, deliveryNo: 7, state: "uncertain", createdAt: 2000, pendingExpiresAt: 86402000, nextCheckAt: 2000,
        grant: grant(), claimedAt: 2050, finishedAt: 2100, channelId }
}
function fixture(t: TestContext) {
    let payload: unknown
    const requests: BackendCall[] = []
    mockBackend(t, call => {
        requests.push(call)
        return payload
    })
    return { store: createGreetingsStore(config), requests, respond: (value: unknown) => { payload = value } }
}
async function rejected<A>(operation: Effect.Effect<A, unknown>) {
    await assert.rejects(Effect.runPromise(operation), /GreetingsStoreError/)
}

test("Greeting adapter sends canonical authenticated DTOs with one backend operation per call", async t => {
    const f = fixture(t)
    f.respond({ status: "reserved", grant: grant() })
    assert.deepEqual(await Effect.runPromise(f.store.reserve(reserve)), { status: "reserved", grant: grant() })
    const dispatch: GreetingsDispatchRequest = { ...binding, context, claimToken: "a".repeat(32) }
    f.respond({ claimed: true, dispatchExpiresAt: 182000, nativeDeadlineMs: 5000, nextClaimAt: 8050 })
    assert.equal((await Effect.runPromise(f.store.dispatch(dispatch))).claimed, true)
    const outcome: GreetingsOutcomeRequest = { ...binding, claimToken: dispatch.claimToken, outcome: "uncertain" }
    f.respond({ recorded: true })
    assert.deepEqual(await Effect.runPromise(f.store.outcome(outcome)), { recorded: true })
    assert.deepEqual(f.requests.map(r => r.path), ["/greetings/reserve", "/greetings/dispatch", "/greetings/outcome"])
    assert.deepEqual(f.requests.map(r => r.body), [reserve, dispatch, outcome])
    for (const request of f.requests) {
        assert(request.signal instanceof AbortSignal)
        assert.equal(request.key, Redacted.value(deriveServiceKey(config.secret)))
        assert(!JSON.stringify(request).includes(secret))
    }
})

test("Grant cannot cross delivery, route revision, raw membership epoch, bot or destination", async t => {
    const f = fixture(t)
    for (const patch of [{ deliveryId: "other_delivery" }, { route: "goodbye" }, { routeRevision: 3 }, { userId: otherId },
        { joinedAt: "2026-10-01T00:00:00.123456788Z" }, { memberGeneration: 5 }, { botId: otherId }, { channelId: otherId },
        { nativeDeadlineMs: 10000 }, { dispatchExpiresAt: 0 }, { canonicalContent: { content: "Different" } },
        { claimToken: "synthetic_private_capability" }]) {
        f.respond({ status: "reserved", grant: { ...grant(), ...patch } })
        await rejected(f.store.reserve(reserve))
    }
    for (const status of ["waiting", "cancelled", "expired", "terminal"] as const) {
        f.respond({ status })
        assert.deepEqual(await Effect.runPromise(f.store.reserve(reserve)), { status })
    }
})

test("Private DM grant has no public destination and preserves verified identity under uncertainty", async t => {
    const f = fixture(t)
    const { channelId: _contextChannelId, ...dmContext } = context
    const dmRequest: GreetingsReserveRequest = { ...reserve, route: "dm", context: dmContext }
    const { channelId: _channelId, ...base } = grant()
    const dmGrant = { ...base, route: "dm" as const }
    f.respond({ status: "reserved", grant: dmGrant })
    assert.deepEqual(await Effect.runPromise(f.store.reserve(dmRequest)), { status: "reserved", grant: dmGrant })
    f.respond({ status: "reserved", grant: { ...dmGrant, channelId } })
    await rejected(f.store.reserve(dmRequest))
    const row = { ...delivery(), route: "dm" as const, grant: dmGrant, messageId: sourceId, channelId: otherId }
    f.respond({ type: "delivery", delivery: row })
    assert.deepEqual(await Effect.runPromise(f.store.query({ serverId, actor, operation: { type: "delivery", deliveryNo: 7 } })), { type: "delivery", delivery: row })
})

test("Independent route settings correlate configuration and reject enabled incomplete snapshots", async t => {
    const f = fixture(t)
    const input: GreetingsManageRequest = { serverId, actor, messageId: sourceId, createdAt: 2000,
        operation: { type: "configure", route: "welcome", templateName: "hello", expectedTemplateRevision: 3, channelId, timing: "verified" } }
    f.respond({ duplicate: false, settings })
    assert.deepEqual(await Effect.runPromise(f.store.manage(input)), { duplicate: false, settings })
    for (const patch of [{ templateRevision: 4 }, { templateName: "other" }, { channelId: otherId }, { timing: "join" }, { content: undefined }]) {
        f.respond({ duplicate: false, settings: { ...settings, routes: { ...settings.routes, welcome: { ...settings.routes.welcome, ...patch } } } })
        await rejected(f.store.manage(input))
    }
    f.respond({ duplicate: false, settings: { ...settings, routes: { ...settings.routes, dm: { ...settings.routes.dm, channelId } } } })
    await rejected(f.store.manage(input))
})

test("Public delivery history uses bounded descending numbers and never accepts opaque provider cursors", async t => {
    const f = fixture(t)
    const input: GreetingsQueryRequest = { serverId, actor, operation: { type: "deliveries", beforeDeliveryNo: 20 } }
    const rows = Array.from({ length: 10 }, (_, i) => ({ ...delivery(), deliveryNo: 19 - i, grant: { ...grant(), deliveryNo: 19 - i } }))
    f.respond({ type: "deliveries", deliveries: rows, nextBeforeDeliveryNo: 10 })
    assert.equal((await Effect.runPromise(f.store.query(input))).type, "deliveries")
    for (const response of [{ type: "deliveries", deliveries: rows, nextCursor: "synthetic_private_cursor" },
        { type: "deliveries", deliveries: rows, nextBeforeDeliveryNo: 9 }, { type: "deliveries", deliveries: rows.slice(0, 9), nextBeforeDeliveryNo: 11 },
        { type: "deliveries", deliveries: [rows[1], rows[0]] }, { type: "deliveries", deliveries: [...rows, rows[0]] }]) {
        f.respond(response)
        await rejected(f.store.query(input))
    }
    f.respond({ type: "delivery", delivery: delivery() })
    await rejected(f.store.query({ serverId, actor, operation: { type: "delivery", deliveryNo: 8 } }))
})

test("Clear confirms an off unconfigured route and rejects retained snapshot or destination fields", async t => {
    const f = fixture(t)
    const input: GreetingsManageRequest = { serverId, actor, messageId: sourceId, createdAt: 2000,
        operation: { type: "clear", route: "welcome" } }
    const cleared = { revision: 3, enabled: false, timing: "join" as const }
    const response = { duplicate: false, settings: { ...settings, routes: { ...settings.routes, welcome: cleared } } }
    f.respond(response)
    assert.deepEqual(await Effect.runPromise(f.store.manage(input)), response)
    for (const patch of [{ enabled: true }, { content }, { templateName: "hello" }, { templateRevision: 3 }, { channelId },
        { _id: "synthetic_private_row" }]) {
        f.respond({ ...response, settings: { ...response.settings, routes: { ...response.settings.routes, welcome: { ...cleared, ...patch } } } })
        await rejected(f.store.manage(input))
    }
})

test("Delivery projections bind their grant and native evidence without leaking storage fields", async t => {
    const f = fixture(t)
    const input: GreetingsQueryRequest = { serverId, actor, operation: { type: "delivery", deliveryNo: 7 } }
    for (const patch of [{ grant: { ...grant(), memberGeneration: 5 } }, { grant: { ...grant(), deliveryNo: 8 } },
        { state: "sent", messageId: undefined }, { claimedAt: 182000 }, { noDispatch: true }, { _id: "synthetic_private_row" }]) {
        f.respond({ type: "delivery", delivery: { ...delivery(), ...patch } })
        await rejected(f.store.query(input))
    }
    f.respond({ type: "delivery", delivery: { ...delivery(), state: "sent", messageId: sourceId } })
    assert.equal((await Effect.runPromise(f.store.query(input))).type, "delivery")
    const cancelled = { ...delivery(), state: "cancelled", reason: "configuration", grant: undefined, claimedAt: undefined, noDispatch: true }
    f.respond({ type: "delivery", delivery: cancelled })
    assert.equal((await Effect.runPromise(f.store.query(input))).type, "delivery")
})

test("Member and observed epoch responses cannot impersonate a different target", async t => {
    const f = fixture(t)
    const value: GreetingsMember = { userId, joinedAt, generation: 4, present: true, observedAt: 2000, expiresAt: 86402000 }
    f.respond({ member: value })
    assert.deepEqual(await Effect.runPromise(f.store.member({ serverId, userId })), { member: value })
    f.respond({ member: { ...value, userId: otherId } })
    await rejected(f.store.member({ serverId, userId }))
    const input: GreetingsObserveRequest = { serverId, operation: { type: "join", eventJoinedAt: joinedAt, observedAt: 2000, member } }
    f.respond({ recorded: true, member: value, admitted: 2 })
    assert.equal((await Effect.runPromise(f.store.observe(input))).admitted, 2)
    for (const patch of [{ userId: otherId }, { joinedAt: "2026-10-02T00:00:00Z" }, { _id: "synthetic_private_row" }]) {
        f.respond({ recorded: true, member: { ...value, ...patch }, admitted: 2 })
        await rejected(f.store.observe(input))
    }
    f.respond({ recorded: false, member: null, admitted: 0 })
    assert.equal((await Effect.runPromise(f.store.observe(input))).recorded, false)
    const changed: GreetingsObserveRequest = { serverId, operation: { type: "present", expectedGeneration: 4, observedAt: 2001,
        member: { ...member, joinedAt: "2026-10-02T00:00:00Z" } } }
    const retired = { ...value, generation: 5, present: false, observedAt: 2001 }
    f.respond({ recorded: true, member: retired, admitted: 0 })
    assert.deepEqual(await Effect.runPromise(f.store.observe(changed)), { recorded: true, member: retired, admitted: 0 })
    f.respond({ recorded: true, member: { ...retired, generation: 4 }, admitted: 0 })
    await rejected(f.store.observe(changed))
})

test("Internal pagination accepts synthetic long opaque cursors while bounding pages and identity", async t => {
    const f = fixture(t)
    const { serverId: _serverId, ...identity } = binding
    const candidate = { ...identity, channelId, hasEmbed: false }
    const page = { scanAt: 2000, candidates: [candidate], nextClaimAt: 0, nextCheckAt: 62000, nextCursor: "s".repeat(350) }
    f.respond(page)
    assert.deepEqual(await Effect.runPromise(f.store.pending({ serverId })), page)
    f.respond({ ...page, candidates: [{ ...candidate, userId: otherId }] })
    await rejected(f.store.pending({ serverId, userId }))
    for (const patch of [{ nextCursor: "" }, { nextCursor: "s".repeat(4097) }, { candidates: [candidate, candidate] },
        { candidates: [{ ...candidate, route: "dm" }] }, { candidates: [{ ...candidate, claimToken: "synthetic_private" }] },
        { nextClaimAt: -1 }]) {
        f.respond({ ...page, ...patch })
        await rejected(f.store.pending({ serverId }))
    }
    f.respond({ scanAt: 2000, examined: 10, queued: 9, nextCursor: "d".repeat(350) })
    assert.equal((await Effect.runPromise(f.store.discover({ serverId, scanAt: 2000 }))).queued, 9)
    for (const bad of [{ examined: 10, queued: 11 }, { examined: 11, queued: 0 }, { examined: 1, queued: 2 },
        { examined: 0, queued: 0, nextCursor: "" }, { examined: 1, queued: 0, _id: "synthetic_private" }]) {
        f.respond({ scanAt: 2000, ...bad })
        await rejected(f.store.discover({ serverId }))
    }
    f.respond({ scanAt: 2001, examined: 1, queued: 0 })
    await rejected(f.store.discover({ serverId, scanAt: 2000, cursor: "synthetic_continuation" }))
    f.respond({ ...page, scanAt: 2001 })
    await rejected(f.store.pending({ serverId, scanAt: 2000, cursor: "synthetic_continuation" }))
})

test("Claim denial, deferral and immutable outcomes each remain a single application backend call", async t => {
    const f = fixture(t)
    f.respond({ claimed: false, dispatchExpiresAt: 182000, nativeDeadlineMs: 5000, nextClaimAt: 8050 })
    assert.equal((await Effect.runPromise(f.store.dispatch({ ...binding, context, claimToken: "a".repeat(32) }))).claimed, false)
    f.respond({ deferred: false })
    assert.equal((await Effect.runPromise(f.store.defer({ ...binding, reason: "eligibility" }))).deferred, false)
    f.respond({ recorded: false })
    assert.equal((await Effect.runPromise(f.store.outcome({ ...binding, claimToken: "a".repeat(32), outcome: "uncertain", messageId: sourceId, channelId }))).recorded, false)
    assert.equal(f.requests.length, 3)
})

test("Backend failures and malformed private response bodies are redacted without adapter retry", async t => {
    let count = 0
    mockBackend(t, () => { count++; return new Response("Synthetic private provider body", { status: 429 }) })
    const exit = await Effect.runPromise(Effect.exit(createGreetingsStore(config).reserve(reserve)))
    assert(Exit.isFailure(exit))
    assert(!inspect(exit).includes("Synthetic private provider body"))
    assert(!inspect(exit).includes(secret))
    assert.equal(count, 1)
    t.mock.restoreAll()
    mockBackend(t, () => new Response("Synthetic private malformed JSON", { status: 200 }))
    const malformed = await Effect.runPromise(Effect.exit(createGreetingsStore(config).reserve(reserve)))
    assert(Exit.isFailure(malformed))
    assert(!inspect(malformed).includes("Synthetic private malformed JSON"))
})

test("Cancellation aborts the exact external request without decoding or resending a grant", async t => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const entered = Deferred.makeUnsafe<void>()
        let observedSignal: AbortSignal | undefined
        let calls = 0
        mockBackend(t, call => new Promise<never>((_resolve, reject) => {
            calls++
            observedSignal = call.signal
            observedSignal?.addEventListener("abort", () => reject(new Error("Synthetic private abort")), { once: true })
            Effect.runSync(Deferred.succeed(entered, undefined))
        }))
        const fiber = yield* Effect.forkChild(createGreetingsStore(config).reserve(reserve))
        yield* Deferred.await(entered)
        yield* Fiber.interrupt(fiber)
        assert.equal(observedSignal?.aborted, true)
        assert(Exit.isFailure(yield* Fiber.await(fiber)))
        assert.equal(calls, 1)
    })).pipe(Effect.provide(TestClock.layer())))
})
