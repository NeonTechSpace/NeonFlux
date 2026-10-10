import assert from "node:assert/strict"
import test from "node:test"
import { adapterFixture } from "./adapter-fixture.ts"
import { createTicketStore, TicketStoreError } from "../../bot/src/ticket-store.ts"

const modules = {
    "../convex/tickets.ts": () => import("../convex/tickets.ts"),
    "../convex/ticketLifecycle.ts": () => import("../convex/ticketLifecycle.ts"),
}

test("ticket adapter round trips configuration, private intake, lifecycle and transcript", async t => {
    const f = await adapterFixture(t, modules)
    const now = f.now(), calls = f.calls
    const store = createTicketStore(f.config)
    const run = (effect: unknown): Promise<any> => f.run(effect)
    const requester = { originServerId: "1", userId: "20", roleIds: [], isOwner: false, isAdministrator: false,
        nativePermissionAuthorized: true, joinedAt: "2023-11-14T22:13:20.000000Z", isBot: false,
        timeoutUntil: null, privateChannelVerified: true, privateChannelId: "600", canView: true,
        canReadHistory: true, canSend: true }
    const owner = { ...requester, userId: "10", isOwner: true }
    const context = (actor = requester, channel?: any) => ({ observedAt: now, actor, botId: "999",
        botAuthorized: true, parentVerified: true, ...(channel ? { channel } : {}) })
    let sequence = 1000
    const source = (actor = requester, channel?: any) => ({ serverId: "1", messageId: String(++sequence),
        createdAt: now, context: context(actor, channel) })
    const manage = (operation: any) => run(store.manage({ ...source(owner), operation }))
    const query = (operation: any, actor = requester, channel?: any) =>
        run(store.query({ serverId: "1", context: context(actor, channel), operation }))
    const intake = (operation: any) => run(store.intake({ ...source(), operation }))
    assert.deepEqual((await manage({ type: "settings", enabled: true })).settings, { enabled: true, retentionDays: 30 })
    let category = (await manage({ type: "category-create", name: "support", visibility: "private",
        description: "Synthetic contract fixture", parentId: null, supportRoleIds: ["40"],
        roles: [{ roleId: "40", permissions: "0", botCanManage: true, actorCanManage: true }] })).category
    category = (await manage({ type: "category-update", name: category.name,
        expectedRevision: category.revision, patch: { questions: ["Synthetic private question"] } })).category
    assert.deepEqual((await query({ type: "settings" }, owner)).settings, { enabled: true, retentionDays: 30 })
    const categories = (await query({ type: "categories" })).categories
    assert.equal(categories[0].revision, category.revision)
    assert.deepEqual(Object.keys(categories[0]).sort(), ["description", "enabled", "name", "revision", "visibility"])
    assert.deepEqual((await query({ type: "category-config", name: "support" }, owner)).category, category)

    let draft = (await intake({ type: "open", categoryName: "support", expectedCategoryRevision: category.revision })).intake
    draft = (await intake({ type: "answer", intakeNo: draft.intakeNo, expectedGeneration: draft.generation,
        question: 1, answer: "Synthetic private answer" })).intake
    assert.deepEqual((await query({ type: "intake", intakeNo: draft.intakeNo })).intake, draft)
    // A plain DM reply finds the draft without a server and steps back by clearing an answer
    assert.deepEqual(await run(store.openIntakes({ userId: "20" })), [{ serverId: "1", intakeNo: draft.intakeNo }])
    draft = (await intake({ type: "clear", intakeNo: draft.intakeNo, expectedGeneration: draft.generation, question: 1 })).intake
    assert.deepEqual(draft.answers, [""])
    draft = (await intake({ type: "answer", intakeNo: draft.intakeNo, expectedGeneration: draft.generation,
        question: 1, answer: "Synthetic private answer" })).intake
    const submitted = await intake({ type: "submit", intakeNo: draft.intakeNo, expectedGeneration: draft.generation,
        expectedCategoryRevision: category.revision, visibility: "private" })
    const ticketNo = submitted.ticket.ticketNo
    assert.deepEqual(await run(store.openIntakes({ userId: "20" })), [])
    assert.deepEqual(await query({ type: "private-intake", ticketNo }), { type: "private-intake", ticketNo,
        questions: ["Synthetic private question"], answers: ["Synthetic private answer"], erased: false })

    // Record synthetic provider evidence through the real lifecycle before uploading
    const grant = submitted.grant
    const channel = { channelId: "301", serverId: "1", type: "text" as const, name: grant.channelName,
        parentId: grant.parentId, overwrites: grant.overwrites }
    const binding = (g: any) => ({ serverId: "1", ticketNo, generation: g.generation,
        attemptId: g.attemptId, sourceId: g.sourceId, claimToken: "a".repeat(32) })
    assert.equal((await run(store.dispatch({ ...binding(grant), context: context() }))).claimed, true)
    const created = await run(store.outcome({ ...binding(grant), outcome: "succeeded", channel, observedAt: now }))
    assert.equal((await run(store.dispatch({ ...binding(created.grant), context: context(requester, channel) }))).claimed, true)
    const opened = await run(store.outcome({ ...binding(created.grant), outcome: "succeeded", channelId: "301", messageId: "2000" }))
    assert.equal(opened.ticket.state, "open")
    const uploadSource = source(requester, channel)
    const messages = [{ messageId: "2001", authorId: "20", content: "Synthetic transcript text", omittedAttachments: 0 }]
    const uploaded = await run(store.transcriptUpload({ ...uploadSource, ticketNo, expectedGeneration: opened.ticket.generation,
        capturedAt: now, messages, truncated: false }))
    assert.equal(uploaded.transcript.messageCount, 1)
    const transcriptNo = uploaded.transcript.transcriptNo
    assert.equal((await query({ type: "transcript", ticketNo, transcriptNo }, requester, channel)).text, "[Unknown time] 20 (2001): Synthetic transcript text")

    await f.reject(createTicketStore(f.wrongConfig)
        .query({ serverId: "1", context: context(), operation: { type: "categories" } }), TicketStoreError, 401)
    await f.reject(store.query({ serverId: "1", context: context(),
        operation: { type: "category-config", name: "support" } }), TicketStoreError, 403)
    await f.reject(store.query({ serverId: "1", context: context({ ...requester, privateChannelVerified: false }),
        operation: { type: "private-intake", ticketNo } }), TicketStoreError, 403)
    assert.equal(calls.filter(call => call.path === "/tickets/transcript").length, 1)
    assert.equal(calls.filter(call => call.status === 200).length, 21)
    assert.deepEqual(calls.slice(-3).map(call => call.status), [401, 403, 403])
    t.diagnostic(`${calls.length} real in-process HTTP calls, 1 transcript upload, 3 authorization rejections, no real network`)
})

