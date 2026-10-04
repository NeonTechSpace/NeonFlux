import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Deferred, Effect, Exit, Fiber, Redacted } from "effect"
import { createTicketStore, TicketStoreError } from "../src/ticket-store.ts"

const serverId = "100", userId = "103", botId = "104", channelId = "106", supportId = "107", messageId = "105"
const joinedAt = "2026-10-01T12:00:00.123456789Z"
const context: C.TicketContext = { observedAt: 1000, botId, botAuthorized: true, actor: { userId, roleIds: [serverId, supportId],
    isOwner: true, isAdministrator: true, nativePermissionAuthorized: true, joinedAt, isBot: false, timeoutUntil: null,
    privateChannelVerified: true, privateChannelId: "108", canView: true, canReadHistory: true, canSend: true } }
const source = { serverId, messageId, createdAt: 1000, context }
const config = { siteUrl: "https://synthetic-ticket.example", secret: Redacted.make("synthetic-ticket-secret") }
const envelope: C.TicketOverwrite[] = [
    { id: userId, type: "member", allow: "68608", deny: "0" }, { id: botId, type: "member", allow: "68608", deny: "0" },
    { id: serverId, type: "role", allow: "0", deny: "3072" }, { id: supportId, type: "role", allow: "68608", deny: "0" },
]
const channel: C.TicketChannelSnapshot = { channelId, serverId, type: "text", name: "ticket-1", parentId: null, overwrites: envelope }
const category: C.TicketCategory = { name: "support", revision: 1, enabled: true, visibility: "private", description: "Synthetic support",
    parentId: null, supportRoleIds: [supportId], questions: ["Describe the issue"], cannedReplies: [{ name: "answer", templateName: "reply", templateRevision: 1, content: { content: "Synthetic unpublished canned content" } }] }
const { parentId: _parent, cannedReplies: _canned, supportRoleIds: _staff, questions: _questions, ...summary } = category
const intake: C.TicketIntake = { intakeNo: 1, generation: 1, category: { ...summary, parentId: null, supportRoleIds: [supportId], questions: category.questions },
    requesterId: userId, joinedAt, answers: ["Synthetic private answer"], state: "draft", createdAt: 1000, expiresAt: 86401000 }
const createGrant: C.TicketActionGrant = { attemptId: "synthetic_attempt_1", attemptNo: 1, ticketNo: 1, generation: 1, sourceId: messageId,
    actorId: userId, botId, requesterId: userId, requesterJoinedAt: joinedAt, visibility: "private", supportRoleIds: [supportId], action: "create", dispatchExpiresAt: 181000,
    nativeDeadlineMs: 5000, channelName: "ticket-1", parentId: null, overwrites: envelope }
const record: C.TicketRecord = { ticketNo: 1, requesterId: userId, requesterJoinedAt: joinedAt, categoryName: "support", categoryRevision: 1,
    visibility: "private", supportRoleIds: [supportId], state: "creating", generation: 1, botId, priority: "normal", createdAt: 1000,
    erased: false, entryCount: 0, currentAttempt: { ...createGrant, outcome: "pending", createdAt: 1000 } }
const binding: C.TicketBinding = { serverId, ticketNo: 1, generation: 1, attemptId: createGrant.attemptId, sourceId: messageId }
const store = () => createTicketStore(config)
function respond(t: TestContext, result: unknown) {
    const calls: { url: string, options: RequestInit }[] = []
    t.mock.method(globalThis, "fetch", async (url: unknown, options: RequestInit) => {
        calls.push({ url: String(url), options })
        return new Response(JSON.stringify(result), { status: 200 })
    })
    return calls
}
async function rejected<A, E>(effect: Effect.Effect<A, E>) {
    const result = await Effect.runPromise(Effect.exit(effect))
    assert(Exit.isFailure(result))
    assert(result.cause.reasons.some(reason => reason._tag === "Fail" && reason.error instanceof TicketStoreError))
    return result
}

test("ticket transport authenticates one production HTTP request and preserves exact physical source", async t => {
    const calls = respond(t, { duplicate: false, type: "settings", settings: { enabled: false, retentionDays: 30 } })
    const input: C.TicketManageRequest = { ...source, operation: { type: "settings", enabled: false } }
    assert.equal((await Effect.runPromise(store().manage(input))).duplicate, false)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.url, "https://synthetic-ticket.example/tickets/manage")
    assert.deepEqual(JSON.parse(calls[0]!.options.body as string), input)
    assert.equal(new Headers(calls[0]!.options.headers).get("Authorization"), "Bearer synthetic-ticket-secret")
    assert.equal(calls[0]!.options.redirect, "error")
})

test("public categories and private intake summaries cannot expose an unpublished canned library", async t => {
    respond(t, { type: "categories", categories: [summary] })
    assert.equal((await Effect.runPromise(store().query({ serverId, context, operation: { type: "categories" } }))).type, "categories")
    for (const payload of [{ type: "categories", categories: [category] }, { type: "category", category },
        { type: "intake", intake: { ...intake, category } }]) {
        respond(t, payload)
        const operation: C.TicketQueryRequest["operation"] = payload.type === "categories" ? { type: "categories" }
            : payload.type === "category" ? { type: "category", name: "support" } : { type: "intake", intakeNo: 1 }
        const failure = await rejected(store().query({ serverId, context, operation }))
        assert(!JSON.stringify(failure).includes("Synthetic unpublished canned"))
    }
    respond(t, { type: "category-config", category })
    assert.equal((await Effect.runPromise(store().query({ serverId, context, operation: { type: "category-config", name: "support" } }))).type, "category-config")
})

test("submit grant binds physical source, actor, bot and ticket generation", async t => {
    const input: C.TicketIntakeRequest = { ...source, operation: { type: "submit", intakeNo: 1, expectedGeneration: 1, expectedCategoryRevision: 1, visibility: "private" } }
    respond(t, { duplicate: false, type: "ticket", ticket: record, grant: createGrant })
    assert.equal((await Effect.runPromise(store().intake(input))).duplicate, false)
    for (const patch of [{ sourceId: "109" }, { actorId: "109" }, { botId: "109" }, { generation: 2 }, { nativeDeadlineMs: 10000 }]) {
        respond(t, { duplicate: false, type: "ticket", ticket: record, grant: { ...createGrant, ...patch } })
        await rejected(store().intake(input))
    }
})

test("public ticket metadata refuses raw attempt payloads", async t => {
    respond(t, { type: "ticket", ticket: record })
    assert.equal((await Effect.runPromise(store().query({ serverId, context, operation: { type: "ticket", ticketNo: 1 } }))).type, "ticket")
    respond(t, { type: "ticket", ticket: { ...record, currentAttempt: { ...record.currentAttempt, content: { content: "Synthetic private attempt" } } } })
    assert(!JSON.stringify(await rejected(store().query({ serverId, context, operation: { type: "ticket", ticketNo: 1 } }))).includes("Synthetic private attempt"))
})

test("private query pages accept the backend twenty-row bound and filtered intake continuation", async t => {
    respond(t, { type: "intakes", intakes: [], nextBeforeIntakeNo: 10 })
    assert.equal((await Effect.runPromise(store().query({ serverId, context, operation: { type: "intakes", beforeIntakeNo: 30 } }))).type, "intakes")
    const entries = Array.from({ length: 20 }, (_, index) => ({ entryNo: 30 - index, ticketNo: 1, authorId: userId, kind: "note", createdAt: 1000,
        erased: false, content: { content: "Synthetic private note" } }))
    respond(t, { type: "entries", entries, nextBeforeEntryNo: 11 })
    assert.equal((await Effect.runPromise(store().query({ serverId, context, operation: { type: "entries", ticketNo: 1, kind: "note", beforeEntryNo: 31 } }))).type, "entries")
    const transcripts = Array.from({ length: 20 }, (_, index) => ({ transcriptNo: 30 - index, ticketNo: 1, channelId, capturedAt: 1000,
        messageCount: 0, truncated: false, erased: false, pages: 1 }))
    respond(t, { type: "transcripts", transcripts, nextBeforeTranscriptNo: 11 })
    assert.equal((await Effect.runPromise(store().query({ serverId, context, operation: { type: "transcripts", ticketNo: 1, beforeTranscriptNo: 31 } }))).type, "transcripts")
})

test("outcome follow-up remains bound to the ticket generation and source", async t => {
    const intro: C.TicketActionGrant = { ...createGrant, attemptId: "synthetic_intro", attemptNo: 2, generation: 2, action: "introduction", channelId,
        expectedChannel: channel, content: { content: "Ticket metadata only" } }
    delete intro.channelName
    delete intro.parentId
    delete intro.overwrites
    const row: C.TicketRecord = { ...record, generation: 2, state: "open", channelId, channel, currentAttempt: { ...intro, outcome: "pending", createdAt: 1000 } }
    delete row.currentAttempt!.content
    const input: C.TicketOutcomeRequest = { ...binding, claimToken: "synthetic_claim_capability", outcome: "succeeded", channelId, channel, observedAt: 1000 }
    respond(t, { recorded: true, ticket: row, grant: intro })
    assert.equal((await Effect.runPromise(store().outcome(input))).recorded, true)
    for (const patch of [{ generation: 3 }, { sourceId: "114" }]) {
        respond(t, { recorded: true, ticket: row, grant: { ...intro, ...patch } })
        await rejected(store().outcome(input))
    }
})

test("transcript pages decode one bounded text page and reject unknown fields", async t => {
    const transcript: C.TicketTranscript = { transcriptNo: 1, ticketNo: 1, channelId, capturedAt: 1000, messageCount: 1, truncated: false, erased: false, pages: 1 }
    respond(t, { type: "transcript", transcript, page: 1, text: "Synthetic transcript" })
    const input: C.TicketQueryRequest = { serverId, context, operation: { type: "transcript", ticketNo: 1, transcriptNo: 1, page: 1 } }
    assert.equal((await Effect.runPromise(store().query(input))).type, "transcript")
    for (const payload of [{ type: "transcript", transcript, page: 1, text: "x".repeat(1501) },
        { type: "transcript", transcript, page: 1, text: "", attachmentUrl: "https://synthetic.example/private" }]) {
        respond(t, payload)
        await rejected(store().query(input))
    }
})

test("transcript capture uses the registered production endpoint and binds its ticket", async t => {
    const transcript: C.TicketTranscript = { transcriptNo: 1, ticketNo: 1, channelId, capturedAt: 1000, messageCount: 1, truncated: false, erased: false, pages: 1 }
    const input: C.TicketTranscriptUploadRequest = { ...source, ticketNo: 1, expectedGeneration: 1, capturedAt: 1000, truncated: false,
        messages: [{ messageId: "115", authorId: userId, content: "Synthetic transcript", omittedAttachments: 0 }] }
    const calls = respond(t, { duplicate: false, transcript })
    assert.equal((await Effect.runPromise(store().transcriptUpload(input))).transcript.transcriptNo, 1)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.url, "https://synthetic-ticket.example/tickets/transcript")
    assert.deepEqual(JSON.parse(calls[0]!.options.body as string), input)
    respond(t, { duplicate: false, transcript: { ...transcript, ticketNo: 2 } })
    await rejected(store().transcriptUpload(input))
})

test("malformed and rejected HTTP responses expose only fixed failure metadata without retry", async t => {
    let calls = 0
    t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("Synthetic private backend body", { status: 403 }) })
    const failure = await rejected(store().query({ serverId, context, operation: { type: "settings" } }))
    assert.equal(calls, 1)
    assert(!JSON.stringify(failure).includes("Synthetic private backend"))
    assert(failure.cause.reasons.some(reason => reason._tag === "Fail" && reason.error instanceof TicketStoreError && reason.error.status === 403))
    t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("Synthetic invalid private JSON", { status: 200 }) })
    await rejected(store().dispatch({ ...binding, claimToken: "synthetic_claim_capability", context }))
    assert.equal(calls, 2)
})

test("ticket cancellation interrupts the single external fetch and never starts an outcome or retry", { timeout: 10000 }, async t => {
    const entered = Deferred.makeUnsafe<void>()
    const aborted = Deferred.makeUnsafe<void>()
    let calls = 0
    t.mock.method(globalThis, "fetch", (_url: unknown, options: RequestInit) => {
        calls++
        return new Promise((_resolve, reject) => {
            const cancel = () => {
                void Effect.runPromise(Deferred.succeed(aborted, undefined))
                reject(new Error("Synthetic private abort body"))
            }
            options.signal!.addEventListener("abort", cancel, { once: true })
            if (options.signal!.aborted) cancel()
            void Effect.runPromise(Deferred.succeed(entered, undefined))
        })
    })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(store().dispatch({ ...binding, claimToken: "synthetic_claim_capability", context }))
        yield* Deferred.await(entered)
        yield* Fiber.interrupt(fiber)
        yield* Deferred.await(aborted)
        assert.equal(calls, 1)
    })))
})
