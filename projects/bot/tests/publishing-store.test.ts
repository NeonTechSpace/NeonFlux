import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import { inspect } from "node:util"
import type * as C from "@neonflux/backend/contracts"
import { Deferred, Effect, Fiber, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { canonicalPublishingContent } from "../src/publishing-content.ts"
import { createPublishingStore } from "../src/publishing-store.ts"

const serverId = "123456789012345678"
const actorId = "123456789012345679"
const botId = "123456789012345680"
const channelId = "123456789012345681"
const sourceId = "123456789012345682"
const messageId = "123456789012345683"
const otherId = "123456789012345684"
const secret = "synthetic-publishing-adapter-secret"
const config = { siteUrl: "https://synthetic-test.convex.site", secret: Redacted.make(secret) }
const actor: C.ModerationActor = { userId: actorId, roleIds: [], isOwner: true, isAdministrator: true, nativePermissionAuthorized: true }
const authored: C.PublishingContent = { content: " Read this ", embed: { title: " Title ", url: "https://example.com", fields: [{ name: " Topic ", value: "", inline: false }] } }
const draft: C.PublishingDraft = { kind: "draft", name: "rules", revision: 2, content: authored, canonicalContent: canonicalPublishingContent(authored), createdAt: 1000, updatedAt: 2000 }
const source = { serverId, actor, messageId: sourceId, createdAt: 2000 }
const request: C.PublishingManageRequest = { ...source, operation: { type: "send", kind: "draft", name: "rules", expectedRevision: 2, channelId,
    context: { botId, channelId, botAuthorized: true, actorAuthorized: true } } }

function fixture(t: TestContext) {
    let payload: unknown
    const requests: { path: string, options: RequestInit }[] = []
    t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
        requests.push({ path: url.pathname, options })
        return Response.json(payload)
    })
    return { store: createPublishingStore(config), requests, respond: (value: unknown) => { payload = value } }
}
function reserved(action: "send" | "edit" = "send"): Extract<C.PublishingManageResult, { type: "post" }> {
    const grant: C.PublishingGrant = { attemptId: "synthetic_attempt", postNo: 7, generation: action === "send" ? 1 : 3,
        sourceId, actorId, botId, action, channelId, draftKind: "draft", draftName: "rules", draftRevision: 2,
        content: authored, canonicalContent: canonicalPublishingContent(authored), dispatchExpiresAt: 182000, nativeDeadlineMs: 5000,
        ...(action === "edit" ? { messageId, expectedContent: { content: "Earlier post" } } : {}) }
    const post: C.PublishingPost = { postNo: grant.postNo, generation: grant.generation, channelId, botId,
        outcome: "pending", createdAt: 1000, updatedAt: 2000, attempt: { ...grant, outcome: "pending", createdAt: 2000 },
        ...(action === "edit" ? { messageId, confirmedContent: { content: "Earlier post" }, confirmedCanonicalContent: { content: "Earlier post" }, confirmedDraftRevision: 1 } : {}) }
    return { duplicate: false, type: "post", post, grant }
}
function terminal(outcome: "sent" | "uncertain" = "sent"): C.PublishingPost {
    const value = reserved().post
    return { ...value, outcome, messageId, attempt: { ...value.attempt, outcome, messageId, dispatchedAt: 2050, finishedAt: 2100 },
        ...(outcome === "sent" ? { confirmedContent: authored, confirmedCanonicalContent: canonicalPublishingContent(authored), confirmedDraftRevision: 2 } : {}) }
}
const show = (postNo = 7): C.PublishingQueryRequest => ({ serverId, actor, operation: { type: "post-show", postNo } })
const rejected = async <A>(operation: Effect.Effect<A, unknown>) => assert.rejects(Effect.runPromise(operation), /PublishingStoreError/)

test("Dashboard message retained posts decode their bounded native grant without weakening human windows", async t => {
    const f = fixture(t), post = terminal()
    const { draftKind: _kind, draftName: _name, draftRevision: _revision, ...attempt } = post.attempt
    const jobId = "synthetic_dashboard_job"
    const { confirmedDraftRevision: _confirmedRevision, ...storedPost } = post
    const dashboard: C.PublishingPost = { ...storedPost, attempt: { ...attempt, sourceId: `dashboard_message_${jobId}`,
        source: { type: "dashboard-message", jobId, createdAt: 1000 }, provenance: { type: "dashboard-message", jobId }, dispatchExpiresAt: 122000 } }
    for (const deadline of [122000, 7000]) {
        const value = { ...dashboard, attempt: { ...dashboard.attempt, dispatchExpiresAt: deadline } }
        f.respond({ type: "post", post: value })
        const decoded = await Effect.runPromise(f.store.query(show()))
        assert.equal(decoded.type, "post")
        f.respond({ type: "posts", posts: [value] })
        assert.equal((await Effect.runPromise(f.store.query({ serverId, actor, operation: { type: "post-list" } }))).type, "posts")
    }
    for (const deadline of [2000, 122001]) {
        f.respond({ type: "post", post: { ...dashboard, attempt: { ...dashboard.attempt, dispatchExpiresAt: deadline } } })
        await rejected(f.store.query(show()))
    }
    f.respond({ type: "post", post: { ...post, attempt: { ...post.attempt, dispatchExpiresAt: 122000 } } })
    await rejected(f.store.query(show()))
    f.respond({ type: "post", post: { ...dashboard, attempt: { ...dashboard.attempt, provenance: { type: "dashboard-message", jobId: "foreign_job" } } } })
    await rejected(f.store.query(show()))
})

test("Publishing adapter sends exact authenticated DTOs and preserves authored and canonical content", async t => {
    const f = fixture(t)
    const response = reserved()
    f.respond(response)
    assert.deepEqual(await Effect.runPromise(f.store.manage(request)), response)
    f.respond({ type: "draft", draft })
    const read: C.PublishingQueryRequest = { serverId, actor, operation: { type: "draft-show", kind: "draft", name: "rules" } }
    assert.deepEqual(await Effect.runPromise(f.store.query(read)), { type: "draft", draft })
    f.respond({ recorded: true })
    const outcome: C.PublishingOutcomeRequest = { serverId, postNo: 7, attemptId: response.grant.attemptId, generation: 1, sourceId, outcome: "sent", messageId, claimToken: "a".repeat(32) }
    assert.deepEqual(await Effect.runPromise(f.store.outcome(outcome)), { recorded: true })
    assert.deepEqual(f.requests.map(value => value.path), ["/publishing/manage", "/publishing/query", "/publishing/outcome"])
    assert.deepEqual(f.requests.map(value => JSON.parse(String(value.options.body))), [request, read, outcome])
    for (const value of f.requests) {
        assert.equal(value.options.method, "POST")
        assert.equal(value.options.redirect, "error")
        assert.ok(value.options.signal instanceof AbortSignal)
        assert.deepEqual(value.options.headers, { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" })
    }
    assert.equal(draft.content.embed!.url, "https://example.com")
    assert.equal(draft.canonicalContent.embed!.url, "https://example.com/")
})

test("Publishing grants cannot substitute another source, actor, destination, revision or operation", async t => {
    const f = fixture(t)
    for (const patch of [
        { sourceId: otherId }, { actorId: otherId }, { botId: otherId }, { channelId: otherId },
        { draftName: "other" }, { draftRevision: 3 }, { generation: 2 },
        { action: "edit" as const, messageId, expectedContent: { content: "Prior" } },
    ]) {
        const value = reserved()
        Object.assign(value.grant, patch)
        Object.assign(value.post.attempt, patch)
        if ("botId" in patch) value.post.botId = patch.botId!
        if ("channelId" in patch) value.post.channelId = patch.channelId!
        if ("generation" in patch) value.post.generation = patch.generation!
        f.respond(value)
        await rejected(f.store.manage(request))
    }
    const editRequest: C.PublishingManageRequest = { ...source, operation: { type: "edit", kind: "draft", name: "rules", expectedRevision: 2, postNo: 7, expectedGeneration: 2,
        context: { botId, channelId, botAuthorized: true, actorAuthorized: true } } }
    const valid = reserved("edit")
    f.respond(valid)
    assert.deepEqual(await Effect.runPromise(f.store.manage(editRequest)), valid)
    for (const changed of [{ ...valid, grant: { ...valid.grant, messageId: otherId } }, { ...valid, grant: { ...valid.grant, generation: 4 } }]) {
        f.respond(changed)
        await rejected(f.store.manage(editRequest))
    }
})

test("Dispatch claims preserve one-shot refusal and the bounded native operation deadline", async t => {
    const f = fixture(t)
    const input: C.PublishingDispatchRequest = { serverId, postNo: 7, attemptId: "synthetic_attempt", generation: 1, sourceId, claimToken: "a".repeat(32) }
    for (const claimed of [true, false]) {
        const response: C.PublishingDispatchResult = { claimed, dispatchExpiresAt: 182000, nativeDeadlineMs: 5000 }
        f.respond(response)
        assert.deepEqual(await Effect.runPromise(f.store.dispatch(input)), response)
    }
    assert.deepEqual(f.requests.map(value => value.path), ["/publishing/dispatch", "/publishing/dispatch"])
    assert.deepEqual(f.requests.map(value => JSON.parse(String(value.options.body))), [input, input])
    for (const changed of [
        { claimed: true, dispatchExpiresAt: 182000, nativeDeadlineMs: 10000 },
        { claimed: true, dispatchExpiresAt: -1, nativeDeadlineMs: 5000 },
        { claimed: true, dispatchExpiresAt: 182000, nativeDeadlineMs: 5000, token: "private_extra" },
    ]) {
        f.respond(changed)
        await rejected(f.store.dispatch(input))
    }
    const invalid = reserved()
    invalid.grant.dispatchExpiresAt++
    invalid.post.attempt.dispatchExpiresAt++
    f.respond(invalid)
    await rejected(f.store.manage(request))
})

test("Publishing decoder rejects malformed rich fields, private storage fields and inconsistent canonical snapshots", async t => {
    const f = fixture(t)
    const read: C.PublishingQueryRequest = { serverId, actor, operation: { type: "draft-show", kind: "draft", name: "rules" } }
    for (const changed of [
        { ...draft, _id: "private_storage_id" }, { ...draft, name: "other" },
        { ...draft, canonicalContent: authored },
        { ...draft, content: { content: "", embed: { timestamp: "2026-02-30T00:00:00Z" } } },
        { ...draft, content: { content: "", embed: { description: "\u000c\u202e" } } },
        { ...draft, content: { content: "", embed: { author: { name: "", iconUrl: "https://example.com" } } } },
        { ...draft, content: { content: "", embed: { image: { url: "attachment://private.png" } } } },
        { ...draft, content: { content: "x".repeat(2001) } },
    ]) {
        f.respond({ type: "draft", draft: changed })
        await rejected(f.store.query(read))
    }
    const incomplete = { ...draft, content: { content: "", embed: {} }, canonicalContent: { content: "" } }
    f.respond({ type: "draft", draft: incomplete })
    assert.deepEqual(await Effect.runPromise(f.store.query(read)), { type: "draft", draft: incomplete })
})

test("Known-ID uncertain posts can be inspected and reconciled without inventing successful delivery", async t => {
    const f = fixture(t)
    const post = terminal("uncertain")
    f.respond({ type: "post", post })
    assert.deepEqual(await Effect.runPromise(f.store.query(show())), { type: "post", post })
    const observation: C.PublishingObservation = { observedAt: 2200, messageId, channelId, botId, content: canonicalPublishingContent(authored) }
    const input: C.PublishingReconcileRequest = { ...source, postNo: 7, attemptId: post.attempt.attemptId, expectedGeneration: 1, observation }
    const observed = { ...post, attempt: { ...post.attempt, observation } }
    f.respond({ recorded: true, post: observed })
    const result = await Effect.runPromise(f.store.reconcile(input))
    assert.equal(result.post.outcome, "uncertain")
    assert.equal(result.post.attempt.outcome, "uncertain")
    assert.deepEqual(result.post.attempt.observation, observation)
    assert.deepEqual(f.requests.map(value => value.path), ["/publishing/query", "/publishing/reconcile"])
    for (const patch of [{ messageId: otherId }, { channelId: otherId }, { botId: otherId }, { generation: 2 }]) {
        f.respond({ recorded: true, post: { ...observed, ...patch } })
        await rejected(f.store.reconcile(input))
    }
})

test("Tracked post identity and recorded observations remain internally correlated", async t => {
    const f = fixture(t)
    const post = terminal()
    f.respond({ type: "post", post })
    await Effect.runPromise(f.store.query(show()))
    for (const changed of [
        { ...post, attempt: { ...post.attempt, messageId: otherId } },
        { ...post, attempt: { ...post.attempt, observation: { observedAt: 2200, messageId: otherId, channelId, botId, content: { content: "Observed" } } } },
        { ...post, attempt: { ...post.attempt, observation: { observedAt: 2200, messageId, channelId: otherId, botId, content: { content: "Observed" } } } },
        { ...post, attempt: { ...post.attempt, observation: { observedAt: 2200, messageId, channelId, botId: otherId, content: { content: "Observed" } } } },
    ]) {
        f.respond({ type: "post", post: changed })
        await rejected(f.store.query(show()))
    }
})

test("Observation-based resolution preserves uncertainty and binds the exact immutable attempt", async t => {
    const f = fixture(t)
    const post = terminal("uncertain")
    const observation: C.PublishingObservation = { observedAt: 192000, messageId, channelId, botId, content: canonicalPublishingContent(authored) }
    const resolution: C.PublishingResolution = { attemptId: post.attempt.attemptId, generation: 1, sourceId, observedAt: 192000, matched: "intended" }
    const resolved: C.PublishingPost = { ...post, confirmedContent: authored, confirmedCanonicalContent: canonicalPublishingContent(authored), confirmedDraftRevision: 2,
        attempt: { ...post.attempt, observation, resolution } }
    f.respond({ type: "post", post: resolved })
    const value = await Effect.runPromise(f.store.query(show()))
    assert.equal(value.type, "post")
    if (value.type !== "post") assert.fail("Expected tracked post")
    assert.equal(value.post.outcome, "uncertain")
    assert.deepEqual(value.post.attempt.resolution, resolution)
    for (const patch of [
        { attemptId: "other_attempt" }, { generation: 2 }, { sourceId: otherId }, { observedAt: 192001 }, { matched: "previous" as const },
    ]) {
        f.respond({ type: "post", post: { ...resolved, attempt: { ...resolved.attempt, resolution: { ...resolution, ...patch } } } })
        await rejected(f.store.query(show()))
    }
    f.respond({ type: "post", post: { ...resolved, outcome: "sent", attempt: { ...resolved.attempt, outcome: "sent" } } })
    await rejected(f.store.query(show()))
    f.respond({ type: "post", post: { ...resolved, attempt: { ...resolved.attempt,
        observation: { ...observation, observedAt: 2200 }, resolution: { ...resolution, observedAt: 2200 } } } })
    await rejected(f.store.query(show()))
})

test("Publishing HTTP failures expose fixed operation and status without remote bodies or retries", async t => {
    const store = createPublishingStore(config)
    const body = "synthetic-private-publishing-body"
    for (const status of [400, 403, 409, 429, 500]) {
        let calls = 0
        const mock = t.mock.method(globalThis, "fetch", async () => { calls++; return new Response(`${body} ${secret}`, { status }) })
        await assert.rejects(Effect.runPromise(store.manage(request)), (error: unknown) => {
            const rendered = `${String(error)} ${inspect(error)} ${JSON.stringify(error)}`
            assert.match(rendered, /PublishingStoreError/)
            assert.ok(!rendered.includes(secret) && !rendered.includes(body))
            return true
        })
        assert.equal(calls, 1)
        mock.mock.restore()
    }
})

test("Publishing HTTP timeout and cancellation abort the external boundary without replay", async t => {
    for (const timeout of [false, true]) {
        const started = Deferred.makeUnsafe<void>()
        let signal: AbortSignal | undefined
        let calls = 0
        const mock = t.mock.method(globalThis, "fetch", async (_url: URL, options: RequestInit) => {
            calls++
            signal = options.signal!
            const pending = new Promise<Response>((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("Synthetic abort")), { once: true }))
            await Effect.runPromise(Deferred.succeed(started, undefined))
            return await pending
        })
        const program = Effect.gen(function* () {
            const fiber = yield* Effect.forkChild(createPublishingStore(config).manage(request))
            yield* Deferred.await(started)
            if (timeout) { yield* TestClock.adjust("5 seconds"); yield* Fiber.await(fiber) }
            else yield* Fiber.interrupt(fiber)
            assert.equal(signal?.aborted, true)
            assert.equal(calls, 1)
        })
        await Effect.runPromise(timeout ? program.pipe(Effect.provide(TestClock.layer())) : program)
        mock.mock.restore()
    }
})

test("Resolve results must bind the requested post, generation, outcome and message", async t => {
    const f = fixture(t)
    const input: C.PublishingManageRequest = { ...source, operation: { type: "resolve", postNo: 7, expectedGeneration: 1, outcome: "sent", messageId, channelId: "30", botId: "999", content: { content: "News" } } }
    f.respond({ duplicate: false, type: "resolved", post: terminal() })
    const result = await Effect.runPromise(f.store.manage(input))
    assert(!result.duplicate && result.type === "resolved")
    assert.equal(result.post.messageId, messageId)
    assert.equal(f.requests.at(-1)!.path, "/publishing/manage")
    for (const post of [{ ...terminal(), postNo: 8 }, { ...terminal(), generation: 2 }, terminal("uncertain")]) {
        f.respond({ duplicate: false, type: "resolved", post })
        await rejected(f.store.manage(input))
    }
})
