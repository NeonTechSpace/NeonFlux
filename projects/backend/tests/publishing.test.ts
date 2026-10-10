import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import type { PublishingDraft, PublishingManageResult, PublishingQueryResult } from "@neonflux/contracts/publishing"
import type { PublishingGrant, PublishingPost } from "@neonflux/contracts/publishing-base"
import type { ModerationActor } from "@neonflux/contracts/shared"
import schema from "../convex/schema.ts"
import { internal } from "../convex/_generated/api.js"
import { canonicalPublishingContent, PUBLISHING_DAY } from "../convex/publishingDomain.ts"
import { botCall } from "./bot-service.ts"

const oldServer = process.env.NEONFLUX_SERVER_ID, oldSecret = process.env.NEONFLUX_BOT_API_SECRET
const secret = "synthetic-publishing-secret-not-a-real-key-000"
beforeEach(() => { process.env.NEONFLUX_SERVER_ID = "1"; process.env.NEONFLUX_BOT_API_SECRET = secret })
afterEach(() => { if (oldServer === undefined) delete process.env.NEONFLUX_SERVER_ID; else process.env.NEONFLUX_SERVER_ID = oldServer; if (oldSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET; else process.env.NEONFLUX_BOT_API_SECRET = oldSecret })
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"), "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"), "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/responses.ts": () => import("../convex/responses.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"), "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const owner: ModerationActor = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
const context = { botId: "999", channelId: "30", botAuthorized: true, actorAuthorized: true }
function fixture(ctx: TestContext) {
    let now = 1700000000000, sequence = 1000
    ctx.mock.method(Date, "now", () => now)
    const t = convexTest({ schema, modules, transactionLimits: true })
    const source = () => ({ serverId: "1", messageId: String(++sequence), createdAt: now })
    const request = (operation: unknown, actor = owner) => ({ ...source(), actor, operation })
    const http = (operation: string, body: unknown, auth = true) => botCall(t, `/publishing/${operation}`, body, auth ? {} : { secret: null })
    const manage = (operation: unknown) => http("manage", request(operation))
    const query = (operation: unknown) => http("query", { serverId: "1", actor: owner, operation })
    const create = async (name = "example", kind = "draft") => { const result = await read<PublishingManageResult>(await manage({ type: "draft-create", kind, name })); assert(!result.duplicate && result.type === "draft"); return result.draft }
    const edit = async (draft: PublishingDraft, value: unknown) => { const result = await read<PublishingManageResult>(await manage({ type: "draft-update", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, edit: value })); assert(!result.duplicate && result.type === "draft"); return result.draft }
    const readyDraft = async (name = "example") => edit(await create(name), { type: "content", content: "Synthetic published content" })
    const send = async (draft: PublishingDraft) => { const result = await read<PublishingManageResult>(await manage({ type: "send", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, channelId: "30", context })); assert(!result.duplicate && result.type === "post"); return result }
    const claimToken = (grant: PublishingGrant) => grant.sourceId.padStart(32, "0")
    const dispatch = (grant: PublishingGrant) => http("dispatch", { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, claimToken: claimToken(grant) })
    const outcome = async (grant: PublishingGrant, outcome = "sent", messageId: string | undefined | null = outcome === "failed" ? undefined : "300") => { await dispatch(grant); return http("outcome", { serverId: "1", attemptId: grant.attemptId, sourceId: grant.sourceId, postNo: grant.postNo, generation: grant.generation, outcome, claimToken: claimToken(grant), ...(messageId != null ? { messageId } : {}) }) }
    const getPost = async (postNo: number) => { const result = await read<PublishingQueryResult>(await query({ type: "post-show", postNo })); assert(result.type === "post"); return result.post }
    const reconcileRequest = (post: PublishingPost, content: unknown = post.attempt.content, extra = {}) => ({ ...source(), actor: owner, postNo: post.postNo, attemptId: post.attempt.attemptId, expectedGeneration: post.generation,
        observation: { observedAt: now, messageId: "300", channelId: "30", botId: "999", content }, ...extra })
    return { t, source, request, http, manage, query, create, edit, readyDraft, send, dispatch, claimToken, outcome, getPost, reconcileRequest, advance: (ms: number) => { now += ms }, now: () => now }
}
async function read<T = Record<string, any>>(response: Response): Promise<T> { assert.equal(response.status, 200); return await response.json() as T }
async function status(response: Response, expected: number) { assert.equal(response.status, expected); const body = await response.json(); assert.equal(typeof body.error, "string"); assert.equal(JSON.stringify(body).includes(secret), false) }

test("Public rich drafts default omitted color only after pruning and retain idempotent explicit colors", async ctx => {
    const f = fixture(ctx)
    for (const [index, embed] of [{}, { title: " \u202e", description: "", fields: [] }, { title: "Title" }, { title: "Title", color: 0 }, { title: "Title", color: 4023992 }].entries()) {
        const draft = await f.edit(await f.create(`canonical-${index}`), { type: "embed", embed })
        assert.deepEqual(draft.content.embed, embed)
        const expected = "title" in embed && embed.title === "Title" ? { content: "", embed: { title: "Title", color: "color" in embed ? embed.color : 0 } } : { content: "" }
        assert.deepEqual(draft.canonicalContent, expected)
        assert.deepEqual(canonicalPublishingContent(draft.canonicalContent), expected)
    }
})

test("Legacy confirmed edit baselines upgrade existing snapshots without recreating missing or drifted baselines", async ctx => {
    const f = fixture(ctx), draft = await f.edit(await f.readyDraft(), { type: "embed", embed: { title: "Before" } })
    const sent = await f.send(draft); await read(await f.outcome(sent.grant))
    const legacy = { content: draft.content.content, embed: { title: "Before" } }
    await f.t.run(async c => {
        const row = (await c.db.query("publishingPosts").collect())[0]!
        await c.db.patch(row._id, { confirmedCanonicalContent: legacy })
    })
    assert.deepEqual((await f.getPost(1)).confirmedCanonicalContent, canonicalPublishingContent(legacy))
    const edited = await read(await f.manage({ type: "edit", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, postNo: 1, expectedGeneration: 1, context }))
    assert.deepEqual(edited.grant.expectedContent, canonicalPublishingContent(legacy))
    await read(await f.http("outcome", { serverId: "1", postNo: 1, attemptId: edited.grant.attemptId, generation: 2, sourceId: edited.grant.sourceId, outcome: "failed" }))
    const drifted = { ...legacy, content: "Retained real drift" }
    await f.t.run(async c => {
        const row = (await c.db.query("publishingPosts").collect())[0]!
        await c.db.patch(row._id, { confirmedCanonicalContent: drifted })
    })
    const next = await read(await f.manage({ type: "edit", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, postNo: 1, expectedGeneration: 2, context }))
    assert.deepEqual(next.grant.expectedContent, canonicalPublishingContent(drifted))
    assert.notDeepEqual(next.grant.expectedContent, canonicalPublishingContent(draft.content))
    await read(await f.http("outcome", { serverId: "1", postNo: 1, attemptId: next.grant.attemptId, generation: 3, sourceId: next.grant.sourceId, outcome: "failed" }))
    await f.t.run(async c => {
        const row = (await c.db.query("publishingPosts").collect())[0]!
        await c.db.patch(row._id, { confirmedCanonicalContent: undefined })
    })
    assert.equal((await f.getPost(1)).confirmedCanonicalContent, undefined)
    await status(await f.manage({ type: "edit", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, postNo: 1, expectedGeneration: 3, context }), 409)
})

test("Legacy rich edit reconciliation matches the prior stored baseline and preserves uncertain history", async ctx => {
    const f = fixture(ctx)
    let draft = await f.edit(await f.readyDraft(), { type: "embed", embed: { title: "Before" } })
    const sent = await f.send(draft); await read(await f.outcome(sent.grant))
    const legacy = { content: draft.content.content, embed: { title: "Before" } }
    draft = await f.edit(draft, { type: "content", content: "New intended text" })
    const edited = await read(await f.manage({ type: "edit", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, postNo: 1, expectedGeneration: 1, context }))
    await read(await f.outcome(edited.grant, "uncertain"))
    await f.t.run(async c => {
        const post = (await c.db.query("publishingPosts").collect())[0]!
        await c.db.patch(post._id, { confirmedCanonicalContent: legacy })
        await c.db.patch(post.attemptId!, { expectedContent: legacy })
    })
    f.advance(190001)
    const result = await read(await f.http("reconcile", f.reconcileRequest(await f.getPost(1), { ...legacy, embed: { ...legacy.embed, color: 0 } })))
    assert.equal(result.post.attempt.resolution.matched, "previous")
    assert.equal(result.post.outcome, "uncertain")
    assert.deepEqual(result.post.confirmedContent, sent.grant.content)
    assert.deepEqual(result.post.confirmedCanonicalContent, sent.grant.canonicalContent)
    const stored = await f.t.run(async c => (await c.db.query("publishingAttempts").collect()).find(a => a._id === edited.grant.attemptId)!)
    assert.equal(stored.outcome, "uncertain")
    assert.equal(stored.unresolved, false)
    assert.deepEqual(stored.expectedContent, legacy)
})

test("Publishing authenticates before private input, rejects cross-server input and requires owner or administrator", async ctx => {
    const f = fixture(ctx)
    for (const path of ["manage", "query", "dispatch", "outcome", "reconcile", "observe"]) { await status(await f.http(path, "Synthetic private malformed body", false), 401); await status(await f.http(path, { serverId: "2" }), 403) }
    await status(await f.http("manage", f.request({ type: "draft-create", kind: "draft", name: "example" }, { ...owner, isOwner: false, roleIds: ["20"] })), 403)
    await read(await f.http("manage", f.request({ type: "draft-create", kind: "draft", name: "example" }, { ...owner, isOwner: false, isAdministrator: true })))
    await status(await f.http("manage", { serverId: "1", body: "x".repeat(65537) }), 413)
    process.env.NEONFLUX_BOT_API_SECRET = "short"
    await status(await f.http("query", {}), 503)
})
test("Publishing read-only defaults do not create state and management rejects inherited or unknown fields", async ctx => {
    const f = fixture(ctx)
    assert.deepEqual(await read(await f.query({ type: "settings" })), { type: "settings", settings: { enabled: true } })
    assert.equal((await f.t.run(c => c.db.query("publishingSettings").collect())).length, 0)
    for (const patch of [{ constructor: true }, { enabled: "true" }, { retentionDays: 180 }, {}]) await status(await f.manage({ type: "settings", patch }), 400)
    await status(await f.manage({ type: "draft-create", kind: "draft", name: "example", extra: "Synthetic private value" }), 400)
})
test("Draft and template namespaces, revisions, clone independence and atomic editing remain usable with the module off", async ctx => {
    const f = fixture(ctx); const first = await f.readyDraft(); const template = await f.create("example", "template")
    await read(await f.manage({ type: "settings", patch: { enabled: false } }))
    const cloned = await read(await f.manage({ type: "draft-clone", kind: first.kind, name: first.name, expectedRevision: first.revision, toKind: "template", toName: "copy" }))
    assert.equal(cloned.draft.revision, 1); assert.deepEqual(cloned.draft.content, first.content)
    await f.edit(template, { type: "content", content: "Template change" })
    assert.deepEqual((await read(await f.query({ type: "draft-show", kind: "draft", name: "example" }))).draft.content, first.content)
    await read(await f.manage({ type: "preview", kind: first.kind, name: first.name, expectedRevision: first.revision }))
    await status(await f.manage({ type: "send", kind: first.kind, name: first.name, expectedRevision: first.revision, channelId: "30", context }), 403)
    await status(await f.manage({ type: "draft-update", kind: template.kind, name: template.name, expectedRevision: template.revision, edit: { type: "content", content: "Stale" } }), 409)
})
test("Incomplete draft storage preserves authored values but blank preview or send is rejected", async ctx => {
    const f = fixture(ctx); const empty = await f.create()
    const withEmbed = await f.edit(empty, { type: "embed", embed: {} })
    assert.deepEqual(withEmbed.content, { content: "", embed: {} }); assert.deepEqual(withEmbed.canonicalContent, { content: "" })
    await status(await f.manage({ type: "preview", kind: withEmbed.kind, name: withEmbed.name, expectedRevision: withEmbed.revision }), 400)
    const color = await f.edit(withEmbed, { type: "embed-property", field: "color", value: 0 })
    await status(await f.manage({ type: "preview", kind: color.kind, name: color.name, expectedRevision: color.revision }), 400)
    assert.equal((await f.t.run(c => c.db.query("publishingAttempts").collect())).length, 0)
})
test("Full rich embed editing preserves originals and canonically normalizes only authored fields", async ctx => {
    const f = fixture(ctx); let draft = await f.create()
    draft = await f.edit(draft, { type: "embed", embed: { title: "  Title\u202e ", description: "", url: "HTTPS://EXAMPLE.COM", color: 0, timestamp: "2024-02-29T12:00:00+02:00",
        author: { name: " Author ", iconUrl: "https://EXAMPLE.com/icon" }, footer: { text: " Footer " }, image: { url: "https://example.com/full", description: " Alt " }, thumbnail: { url: "https://example.com/small" }, fields: [{ name: " Field ", value: "", inline: false }] } })
    assert.equal(draft.content.embed?.title, "  Title\u202e ")
    assert.deepEqual(draft.canonicalContent.embed, { title: "Title", url: "https://example.com/", color: 0, timestamp: "2024-02-29T10:00:00.000Z", author: { name: "Author", iconUrl: "https://example.com/icon" }, footer: { text: "Footer" }, image: { url: "https://example.com/full", description: "Alt" }, thumbnail: { url: "https://example.com/small" }, fields: [{ name: "Field", value: "" }] })
    draft = await f.edit(draft, { type: "field-add", field: { name: "Second", value: "2", inline: true } })
    draft = await f.edit(draft, { type: "field-set", index: 1, field: { name: "Changed", value: "1" } })
    draft = await f.edit(draft, { type: "field-remove", index: 2 })
    assert.equal(draft.content.embed?.fields?.[0]?.name, "Changed")
    draft = await f.edit(draft, { type: "embed-property", field: "author", value: null })
    assert.equal(draft.content.embed?.author, undefined)
    draft = await f.edit(draft, { type: "fields-clear" }); assert.deepEqual(draft.content.embed?.fields, [])
    draft = await f.edit(draft, { type: "embed-clear" }); assert.deepEqual(draft.content, { content: "" })
})
test("Native calendar dates and effective nonempty descriptions are enforced through public HTTP", async ctx => {
    const f = fixture(ctx); const draft = await f.create()
    for (const embed of [{ timestamp: "2024-02-30T12:00:00Z" }, { timestamp: "2023-02-29T00:00:00Z" }, { timestamp: "2024-01-01" }, { description: "\u202e" }, { description: " \u000c\u202e " }, { author: { name: "\u202e" } }, { footer: { text: " " } }, { fields: [{ name: "\u202e", value: "" }] }, { image: { url: "https://example.com/image", description: "\u202e" } }]) {
        await status(await f.manage({ type: "draft-update", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, edit: { type: "embed", embed } }), 400)
    }
    const valid = await f.edit(draft, { type: "embed", embed: { description: "", title: "", fields: [{ name: "Valid", value: "\u202e", inline: false }] } })
    assert.equal(valid.canonicalContent.embed?.description, undefined); assert.equal(valid.canonicalContent.embed?.fields?.[0]?.value, "")
})
test("Raw authored length, aggregate media descriptions, field count, and HTTP-only URLs are bounded", async ctx => {
    const f = fixture(ctx); const draft = await f.create()
    const badEmbeds = [{ title: "x".repeat(257) }, { description: "x".repeat(4097) }, { color: -1 }, { color: 0x1000000 }, { url: "javascript:alert(1)" }, { image: { url: "attachment://file.png" } }, { url: "https://user:secret@example.com" }, { footer: { text: "x", extra: true } }, { fields: Array.from({ length: 26 }, () => ({ name: "x", value: "" })) },
        { description: "x".repeat(4000), image: { url: "https://example.com/image", description: "y".repeat(2001) } }, { description: " ".repeat(4000) + "x", footer: { text: " ".repeat(2000) + "y" } }]
    for (const embed of badEmbeds) await status(await f.manage({ type: "draft-update", kind: "draft", name: draft.name, expectedRevision: draft.revision, edit: { type: "embed", embed } }), 400)
    await status(await f.manage({ type: "draft-update", kind: "draft", name: draft.name, expectedRevision: draft.revision, edit: { type: "content", content: "x".repeat(2001) } }), 400)
    await status(await f.manage({ type: "draft-update", kind: "draft", name: draft.name, expectedRevision: draft.revision, edit: { type: "field-remove", index: 1 } }), 400)
})
test("Immutable management source guards survive deletion and recreation and reject stale events", async ctx => {
    const f = fixture(ctx), request = f.request({ type: "draft-create", kind: "draft", name: "example" })
    const created = await read(await f.http("manage", request))
    await read(await f.manage({ type: "draft-delete", kind: "draft", name: "example", expectedRevision: created.draft.revision }))
    assert.deepEqual(await read(await f.http("manage", request)), { duplicate: true })
    await status(await f.query({ type: "draft-show", kind: "draft", name: "example" }), 404)
    await status(await f.http("manage", { ...request, messageId: "9000", createdAt: f.now() - 900001 }), 400)
    await status(await f.http("manage", { ...request, messageId: "9001", createdAt: f.now() + 60001 }), 400)
})
test("Send reserves an immutable revision payload before returning one grant, and duplicate never grants again", async ctx => {
    const f = fixture(ctx); const draft = await f.readyDraft()
    const request = f.request({ type: "send", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, channelId: "30", context })
    const sent = await read(await f.http("manage", request)); assert.equal(sent.post.outcome, "pending"); assert.equal(sent.grant.sourceId, request.messageId)
    await f.edit(draft, { type: "content", content: "Changed after reservation" })
    assert.deepEqual((await f.getPost(sent.post.postNo)).attempt.content, draft.content)
    assert.deepEqual(await read(await f.http("manage", request)), { duplicate: true })
    const attempts = await f.t.run(c => c.db.query("publishingAttempts").collect()); assert.equal(attempts.length, 1)
    await status(await f.manage({ type: "send", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, channelId: "30", context }), 409)
})
test("Channel permission, bot identity, attempt generation, source, and message outcome correlations fail closed", async ctx => {
    const f = fixture(ctx); const draft = await f.readyDraft()
    for (const proof of [{ ...context, botAuthorized: false }, { ...context, actorAuthorized: false }, { ...context, channelId: "31" }]) await status(await f.manage({ type: "send", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, channelId: "30", context: proof }), proof.channelId === "31" ? 409 : 403)
    const sent = await f.send(draft), base = { serverId: "1", ...sent.grant, outcome: "sent", messageId: "300" }
    // Outcome envelopes are explicit rather than accepting grant-only payload fields
    const outcome = { serverId: "1", postNo: sent.post.postNo, attemptId: sent.grant.attemptId, generation: sent.grant.generation, sourceId: sent.grant.sourceId, outcome: "sent", messageId: "300" }
    for (const patch of [{ generation: 2 }, { postNo: 2 }, { sourceId: "9999" }]) await status(await f.http("outcome", { ...outcome, ...patch }), 409)
    await status(await f.http("outcome", base), 400)
    await read(await f.dispatch(sent.grant))
    const { messageId: _messageId, ...missingMessage } = outcome
    await status(await f.http("outcome", { ...missingMessage, claimToken: f.claimToken(sent.grant) }), 400)
    assert.deepEqual(await read(await f.outcome(sent.grant)), { recorded: true })
    assert.deepEqual(await read(await f.outcome(sent.grant)), { recorded: false })
    await status(await f.outcome(sent.grant, "failed", undefined), 409)
    await status(await f.outcome(sent.grant, "sent", "301"), 409)
})
test("An explicit edit binds the known post and its prior canonical snapshot and preserves failed edit history", async ctx => {
    const f = fixture(ctx); let draft = await f.readyDraft(); const sent = await f.send(draft); await read(await f.outcome(sent.grant))
    draft = await f.edit(draft, { type: "content", content: "Replacement" })
    const operation = { type: "edit", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, postNo: sent.post.postNo, expectedGeneration: 1, context }
    await status(await f.manage({ ...operation, context: { ...context, botId: "998" } }), 409)
    const edited = await read(await f.manage(operation)); assert.equal(edited.grant.generation, 2); assert.equal(edited.grant.messageId, "300"); assert.deepEqual(edited.grant.expectedContent, sent.grant.canonicalContent)
    await status(await f.outcome(edited.grant, "sent", "301"), 400)
    await read(await f.outcome(edited.grant, "failed", undefined))
    const tracked = await f.getPost(sent.post.postNo); assert.equal(tracked.outcome, "failed"); assert.deepEqual(tracked.confirmedContent, sent.grant.content)
    assert.deepEqual(await read(await f.outcome(sent.grant)), { recorded: false })
    await status(await f.manage(operation), 409)
})
test("Draft deletion never deletes tracked content and forget removes only resolved tracking", async ctx => {
    const f = fixture(ctx); const draft = await f.readyDraft(); const sent = await f.send(draft)
    await status(await f.manage({ type: "forget", postNo: sent.post.postNo, expectedGeneration: 1 }), 409)
    await read(await f.outcome(sent.grant))
    await read(await f.manage({ type: "draft-delete", kind: draft.kind, name: draft.name, expectedRevision: draft.revision }))
    assert.deepEqual((await f.getPost(sent.post.postNo)).confirmedContent, draft.content)
    await read(await f.manage({ type: "forget", postNo: sent.post.postNo, expectedGeneration: 1 }))
    await status(await f.query({ type: "post-show", postNo: sent.post.postNo }), 404)
    assert.equal((await f.t.run(c => c.db.query("publishingAttempts").collect())).length, 1)
    const next = await f.send(await f.readyDraft("next")); assert.equal(next.post.postNo, 2)
})
test("A known-ID uncertain send reconciles an exact operational baseline without changing its uncertain outcome", async ctx => {
    const f = fixture(ctx); const draft = await f.readyDraft(); const sent = await f.send(draft); await read(await f.outcome(sent.grant, "uncertain"))
    f.advance(190001)
    const request = f.reconcileRequest(await f.getPost(sent.post.postNo))
    const result = await read(await f.http("reconcile", request)); assert.equal(result.post.outcome, "uncertain"); assert.equal(result.post.attempt.outcome, "uncertain")
    assert.deepEqual(result.post.attempt.resolution, { attemptId: sent.grant.attemptId, generation: 1, sourceId: sent.grant.sourceId, observedAt: f.now(), matched: "intended" })
    assert.deepEqual(result.post.confirmedContent, draft.content)
    assert.equal((await read(await f.http("reconcile", request))).recorded, false)
    await read(await f.manage({ type: "forget", postNo: sent.post.postNo, expectedGeneration: 1 }))
})
test("Prior-state observation permits a new explicit edit while retaining the uncertain failed-delivery perspective", async ctx => {
    const f = fixture(ctx); let draft = await f.readyDraft(); const sent = await f.send(draft); await read(await f.outcome(sent.grant))
    draft = await f.edit(draft, { type: "content", content: "Different intended content" })
    const edit = await read(await f.manage({ type: "edit", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, postNo: 1, expectedGeneration: 1, context }))
    await read(await f.outcome(edit.grant, "uncertain", "300"))
    f.advance(190001)
    const reconciled = await read(await f.http("reconcile", f.reconcileRequest(await f.getPost(1), sent.grant.content)))
    assert.equal(reconciled.post.attempt.resolution.matched, "previous"); assert.equal(reconciled.post.attempt.outcome, "uncertain")
    const next = await read(await f.manage({ type: "edit", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, postNo: 1, expectedGeneration: 2, context }))
    assert.equal(next.grant.generation, 3); assert.deepEqual(next.grant.expectedContent, sent.grant.canonicalContent)
    await status(await f.http("reconcile", f.reconcileRequest(reconciled.post, sent.grant.content)), 409)
})
test("Conflicting, cross-message, cross-bot or stale observations cannot resolve uncertainty", async ctx => {
    const f = fixture(ctx); const sent = await f.send(await f.readyDraft()); await read(await f.outcome(sent.grant, "uncertain"))
    f.advance(190001)
    const tracked = await f.getPost(1), request = f.reconcileRequest(tracked)
    for (const patch of [{ messageId: "301" }, { channelId: "31" }, { botId: "998" }]) await status(await f.http("reconcile", { ...request, ...f.source(), observation: { ...request.observation, ...patch } }), 409)
    const conflict = await read(await f.http("reconcile", f.reconcileRequest(tracked, { content: "Unrelated staff change" })))
    assert.equal(conflict.post.attempt.resolution, undefined)
    await status(await f.manage({ type: "forget", postNo: 1, expectedGeneration: 1 }), 409)
    f.advance(1); const resolved = await read(await f.http("reconcile", f.reconcileRequest(tracked))); assert(resolved.post.attempt.resolution)
    f.advance(1); const invalidated = await read(await f.http("reconcile", f.reconcileRequest(tracked, { content: "Later unrelated change" })))
    assert.equal(invalidated.post.attempt.resolution, undefined)
    await status(await f.manage({ type: "forget", postNo: 1, expectedGeneration: 1 }), 409)
    assert.equal((await read(await f.http("reconcile", { ...request, ...f.source() }))).recorded, false)
})
test("Pending attempts age to uncertain without replay, and unknown-ID sends stay unsearchable", async ctx => {
    const f = fixture(ctx); const sent = await f.send(await f.readyDraft())
    await read(await f.dispatch(sent.grant))
    await status(await f.http("reconcile", f.reconcileRequest(sent.post)), 409)
    f.advance(190001); await f.t.mutation(internal.publishing.cleanup, {})
    const tracked = await f.getPost(1); assert.equal(tracked.outcome, "uncertain"); assert.equal(tracked.attempt.resolution, undefined)
    await status(await f.manage({ type: "forget", postNo: 1, expectedGeneration: 1 }), 409)
    await read(await f.outcome(sent.grant, "sent"))
    assert.equal((await f.t.run(c => c.db.query("publishingAttempts").collect())).length, 1)
    const settled = await f.getPost(1); assert.equal(settled.outcome, "sent"); assert.equal(settled.messageId, "300")
    await read(await f.http("reconcile", f.reconcileRequest(await f.getPost(1))))
})
test("Restart uncertainty also preserves a known edit message for later read-only resolution", async ctx => {
    const f = fixture(ctx); const draft = await f.readyDraft(), sent = await f.send(draft); await read(await f.outcome(sent.grant))
    const edited = await read(await f.manage({ type: "edit", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, postNo: 1, expectedGeneration: 1, context }))
    await read(await f.dispatch(edited.grant)); f.advance(190000)
    await read(await f.http("observe", { serverId: "1", mode: "restart" }))
    const tracked = await f.getPost(1); assert.equal(tracked.messageId, "300"); assert.equal(tracked.outcome, "uncertain")
    const result = await read(await f.http("reconcile", f.reconcileRequest(tracked))); assert.equal(result.post.attempt.resolution.generation, edited.grant.generation)
})
test("Terminal history expires in bounded cleanup while durable posts and latest snapshots remain", async ctx => {
    const f = fixture(ctx)
    const draft = await f.readyDraft(), sent = await f.send(draft); await read(await f.outcome(sent.grant))
    const edited = await read(await f.manage({ type: "edit", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, postNo: 1, expectedGeneration: 1, context })); await read(await f.outcome(edited.grant))
    f.advance(181 * PUBLISHING_DAY); await f.t.mutation(internal.publishing.cleanup, {})
    assert.equal((await f.t.run(c => c.db.query("publishingAttempts").collect())).length, 1)
    assert.deepEqual((await f.getPost(1)).confirmedContent, draft.content)
    assert.equal((await f.t.run(c => c.db.query("publishingReceipts").collect())).length, 0)
    assert.equal((await read(await f.query({ type: "draft-show", kind: draft.kind, name: draft.name }))).draft.revision, draft.revision)
})
test("DEFCON1 preserves publishing status, reconciliation and module-off but blocks new authored operations", async ctx => {
    const f = fixture(ctx); const sent = await f.send(await f.readyDraft()); await read(await f.outcome(sent.grant))
    await read(await botCall(f.t, "/moderation/manage", { ...f.source(), actor: owner, operation: { type: "settings", patch: { defcon: 1 } } }))
    await read(await f.query({ type: "post-show", postNo: 1 })); await read(await f.query({ type: "settings" }))
    await read(await f.http("reconcile", f.reconcileRequest(await f.getPost(1))))
    await read(await f.manage({ type: "settings", patch: { enabled: false } }))
    await status(await f.manage({ type: "settings", patch: { enabled: true } }), 403)
    await status(await f.manage({ type: "draft-create", kind: "draft", name: "blocked" }), 403)
    await status(await f.manage({ type: "forget", postNo: 1, expectedGeneration: 1 }), 403)
})
test("Publishing list navigation is bounded and preserves all named namespaces and post anchors", async ctx => {
    const f = fixture(ctx)
    for (let i = 0; i < 12; i++) await f.create(`item${String(i).padStart(2, "0")}`)
    const page = await read(await f.query({ type: "draft-list", kind: "draft", page: 2 })); assert.equal(page.drafts.length, 2); assert.equal(page.totalPages, 2)
    const draft = await f.readyDraft("published")
    for (let i = 0; i < 12; i++) { const sent = await f.send(draft); await read(await f.outcome(sent.grant, "sent", String(300 + i))) }
    const first = await read(await f.query({ type: "post-list" })); assert.equal(first.posts.length, 10); assert.equal(first.nextBeforePostNo, 3)
    const second = await read(await f.query({ type: "post-list", beforePostNo: first.nextBeforePostNo })); assert.deepEqual(second.posts.map((p: PublishingPost) => p.postNo), [2, 1]); assert.equal(second.nextBeforePostNo, undefined)
})

test("A dispatch grant has one current binding and expires before a delayed worker can claim it", async ctx => {
    const f = fixture(ctx), sent = await f.send(await f.readyDraft())
    assert.equal(sent.grant.dispatchExpiresAt, f.now() + 180000); assert.equal(sent.grant.nativeDeadlineMs, 5000)
    assert.deepEqual(await read(await f.dispatch(sent.grant)), { claimed: true, dispatchExpiresAt: sent.grant.dispatchExpiresAt, nativeDeadlineMs: 5000 })
    assert.equal((await read(await f.dispatch(sent.grant))).claimed, false)
    await status(await f.http("dispatch", { serverId: "1", postNo: 1, attemptId: sent.grant.attemptId, generation: 1, sourceId: "9988", claimToken: f.claimToken(sent.grant) }), 409)
    const delayed = await f.send(await f.readyDraft("delayed")); f.advance(180000)
    await status(await f.dispatch(delayed.grant), 409)
    await status(await f.outcome(delayed.grant), 409)
    assert.equal((await f.getPost(2)).outcome, "pending")
    f.advance(10000); await f.t.mutation(internal.publishing.cleanup, {})
    assert.equal((await f.getPost(2)).outcome, "failed"); assert.equal((await f.getPost(2)).attempt.noDispatch, true)
})

test("Restart fences unclaimed work and a claimed worker's old read cannot resolve while dispatch remains permitted", async ctx => {
    const f = fixture(ctx), sent = await f.send(await f.readyDraft()); await read(await f.outcome(sent.grant))
    const edit = await read(await f.manage({ type: "edit", kind: "draft", name: "example", expectedRevision: 2, postNo: 1, expectedGeneration: 1, context }))
    await read(await f.dispatch(edit.grant)); await read(await f.http("observe", { serverId: "1", mode: "restart" }))
    const observedBeforeFence = f.reconcileRequest(await f.getPost(1), sent.grant.content)
    const early = await read(await f.http("reconcile", observedBeforeFence)); assert.equal(early.post.attempt.resolution, undefined)
    await status(await f.manage({ type: "edit", kind: "draft", name: "example", expectedRevision: 2, postNo: 1, expectedGeneration: 2, context }), 409)
    f.advance(190000); await read(await f.http("observe", { serverId: "1", mode: "restart" }))
    const oldRead = await read(await f.http("reconcile", { ...observedBeforeFence, ...f.source(), observation: { ...observedBeforeFence.observation, observedAt: observedBeforeFence.observation.observedAt + 1 } }))
    assert.equal(oldRead.post.attempt.resolution, undefined)
    const fresh = await read(await f.http("reconcile", f.reconcileRequest(await f.getPost(1), sent.grant.content))); assert.equal(fresh.post.attempt.resolution.matched, "intended")
    const next = await read(await f.manage({ type: "edit", kind: "draft", name: "example", expectedRevision: 2, postNo: 1, expectedGeneration: 2, context }))
    await status(await f.dispatch(edit.grant), 409)
    const late = { serverId: "1", postNo: 1, attemptId: edit.grant.attemptId, generation: 2, sourceId: edit.grant.sourceId, outcome: "sent", messageId: "300", claimToken: f.claimToken(edit.grant) }
    await status(await f.http("outcome", late), 409)
    assert.equal((await f.getPost(1)).attempt.attemptId, next.grant.attemptId); assert.equal((await f.getPost(1)).outcome, "pending")
})

test("Public URL validation rejects authored values whose normalized canonical representation exceeds the same limit", async ctx => {
    const f = fixture(ctx), draft = await f.create()
    await status(await f.manage({ type: "draft-update", kind: "draft", name: draft.name, expectedRevision: draft.revision, edit: { type: "embed", embed: { url: `https://example.com/?q=${"é".repeat(1000)}` } } }), 400)
    assert.equal((await read(await f.query({ type: "draft-show", kind: "draft", name: draft.name }))).draft.revision, 1)
})

test("A denied duplicate performer cannot finalize another invocation's one-time dispatch claim", async ctx => {
    const f = fixture(ctx), sent = await f.send(await f.readyDraft())
    const base = { serverId: "1", postNo: 1, attemptId: sent.grant.attemptId, generation: 1, sourceId: sent.grant.sourceId }
    const winner = "a".repeat(32), duplicate = "b".repeat(32)
    const [first, second] = await Promise.all([f.http("dispatch", { ...base, claimToken: winner }), f.http("dispatch", { ...base, claimToken: duplicate })])
    const firstClaim = await read(first), secondClaim = await read(second)
    assert.equal(Number(firstClaim.claimed) + Number(secondClaim.claimed), 1)
    const ownerToken = firstClaim.claimed ? winner : duplicate, deniedToken = firstClaim.claimed ? duplicate : winner
    await status(await f.http("outcome", { ...base, outcome: "failed" }), 409)
    await status(await f.http("outcome", { ...base, claimToken: deniedToken, outcome: "failed" }), 409)
    assert.equal((await f.getPost(1)).outcome, "pending"); assert.equal("claimToken" in (await f.getPost(1)).attempt, false)
    assert.equal((await read(await f.http("outcome", { ...base, claimToken: ownerToken, outcome: "sent", messageId: "300" }))).recorded, true)
    const preDispatch = await f.send(await f.readyDraft("failed"))
    await read(await f.http("outcome", { serverId: "1", postNo: 2, attemptId: preDispatch.grant.attemptId, generation: 1, sourceId: preDispatch.grant.sourceId, outcome: "failed" }))
    await status(await f.dispatch(preDispatch.grant), 409)
})

test("Expired unclaimed work proves no dispatch while a successful pre-expiry claim remains uncertain", async ctx => {
    const f = fixture(ctx), draft = await f.readyDraft(), claimed = await f.send(draft), abandoned = await f.send(draft)
    await read(await f.http("observe", { serverId: "1", mode: "restart" }))
    assert.equal((await f.getPost(1)).outcome, "pending"); assert.equal((await f.getPost(2)).outcome, "pending")
    f.advance(179999); await read(await f.dispatch(claimed.grant)); f.advance(10001)
    const [expiredClaim] = await Promise.all([f.dispatch(abandoned.grant), f.t.mutation(internal.publishing.cleanup, {})])
    await status(expiredClaim, 409)
    const failed = await f.getPost(2), unknown = await f.getPost(1)
    assert.equal(failed.outcome, "failed"); assert.equal(failed.attempt.noDispatch, true)
    assert.equal(unknown.outcome, "uncertain"); assert.equal(unknown.attempt.noDispatch, undefined)
    await read(await f.manage({ type: "forget", postNo: 2, expectedGeneration: 1 }))
    await status(await f.manage({ type: "forget", postNo: 1, expectedGeneration: 1 }), 409)
})

test("A recorded failure cannot become uncertain and outcomes reject missing capability, foreign identity and invented provider IDs", async ctx => {
    const f = fixture(ctx), draft = await f.readyDraft(), sent = await f.send(draft)
    await read(await f.outcome(sent.grant, "failed"))
    const input = { serverId: "1", postNo: 1, attemptId: sent.grant.attemptId, generation: 1, sourceId: sent.grant.sourceId, outcome: "uncertain", claimToken: f.claimToken(sent.grant) }
    const { claimToken: _claimToken, ...withoutCapability } = input
    await status(await f.http("outcome", withoutCapability), 409)
    for (const patch of [{ claimToken: "f".repeat(32) }, { sourceId: "8000" }, { generation: 2 }, { postNo: 2 }, { messageId: "300" }]) await status(await f.http("outcome", { ...input, ...patch }), 409)
    await status(await f.http("outcome", { ...input, serverId: "2" }), 403)
    assert.equal((await f.getPost(1)).outcome, "failed")
    const neverDispatched = await f.send(draft), abandon = { serverId: "1", postNo: 2, attemptId: neverDispatched.grant.attemptId, generation: 1, sourceId: neverDispatched.grant.sourceId }
    await status(await f.http("outcome", { ...abandon, outcome: "uncertain" }), 409)
    await read(await f.http("outcome", { ...abandon, outcome: "failed" }))
    assert.equal((await f.getPost(2)).attempt.noDispatch, true)
    await status(await f.http("outcome", { ...abandon, outcome: "uncertain" }), 409)
    assert.equal((await f.getPost(2)).outcome, "failed")
})

test("A failed older generation cannot change a newer post or its operational baseline", async ctx => {
    const f = fixture(ctx), draft = await f.readyDraft(), sent = await f.send(draft)
    await read(await f.outcome(sent.grant))
    const firstEdit = await read(await f.manage({ type: "edit", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, postNo: 1, expectedGeneration: 1, context }))
    await read(await f.outcome(firstEdit.grant, "failed"))
    const newer = await read(await f.manage({ type: "edit", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, postNo: 1, expectedGeneration: 2, context }))
    const before = await f.getPost(1)
    await status(await f.outcome(firstEdit.grant, "uncertain", null), 409)
    assert.deepEqual(await f.getPost(1), before); assert.equal(before.attempt.attemptId, newer.grant.attemptId)
    const older = await f.t.run(c => { const id = c.db.normalizeId("publishingAttempts", firstEdit.grant.attemptId); assert(id); return c.db.get(id) })
    assert.equal(older?.outcome, "failed"); assert.equal(older?.unresolved, false)
})

test("A late identity-verified message ID survives a repeated uncertain outcome without changing delivery history", async ctx => {
    const f = fixture(ctx), sent = await f.send(await f.readyDraft())
    await read(await f.outcome(sent.grant, "uncertain", null))
    const before = await f.getPost(1); assert.equal(before.messageId, undefined)
    f.advance(1)
    assert.deepEqual(await read(await f.outcome(sent.grant, "uncertain", "300")), { recorded: true })
    const known = await f.getPost(1)
    assert.equal(known.messageId, "300"); assert.equal(known.attempt.messageId, "300"); assert.equal(known.outcome, "uncertain"); assert.equal(known.attempt.outcome, "uncertain")
    assert.equal(known.attempt.finishedAt, before.attempt.finishedAt); assert.deepEqual(known.attempt.content, before.attempt.content)
    f.advance(1); assert.deepEqual(await read(await f.outcome(sent.grant, "uncertain", "300")), { recorded: false })
    assert.deepEqual(await f.getPost(1), known)
    await status(await f.outcome(sent.grant, "uncertain", "301"), 409)
    await status(await f.manage({ type: "forget", postNo: 1, expectedGeneration: 1 }), 409)
    f.advance(190001)
    const resolved = await read(await f.http("reconcile", f.reconcileRequest(await f.getPost(1)))); assert.equal(resolved.post.attempt.resolution.matched, "intended"); assert.equal(resolved.post.outcome, "uncertain")
    const aged = await f.send(await f.readyDraft("aged")); await read(await f.dispatch(aged.grant))
    f.advance(190000); await f.t.mutation(internal.publishing.cleanup, {})
    const expired = await f.getPost(2); assert.equal(expired.attempt.outcome, "uncertain"); assert.equal(expired.attempt.finishedAt, undefined)
    assert.equal((await read(await f.outcome(aged.grant, "uncertain", "400"))).recorded, true)
    const late = await f.getPost(2); assert.equal(late.messageId, "400"); assert.equal(late.attempt.outcome, "uncertain"); assert.equal(late.attempt.finishedAt, undefined)
})

test("Late verified-ID retention requires the exact current claim and refuses conflicting post identities or generations", async ctx => {
    const f = fixture(ctx), sent = await f.send(await f.readyDraft())
    await read(await f.outcome(sent.grant, "uncertain", null))
    const input = { serverId: "1", postNo: 1, attemptId: sent.grant.attemptId, generation: 1, sourceId: sent.grant.sourceId, outcome: "uncertain", messageId: "300", claimToken: f.claimToken(sent.grant) }
    for (const patch of [{ claimToken: "f".repeat(32) }, { sourceId: "9000" }, { generation: 2 }]) await status(await f.http("outcome", { ...input, ...patch }), 409)
    await f.t.run(async c => { const row = await c.db.query("publishingPosts").unique(); assert(row); await c.db.patch(row._id, { messageId: "301" }) })
    await status(await f.http("outcome", input), 409)
    let attempt = await f.t.run(c => { const id = c.db.normalizeId("publishingAttempts", sent.grant.attemptId); assert(id); return c.db.get(id) }); assert.equal(attempt?.messageId, undefined)
    await f.t.run(async c => { const row = await c.db.query("publishingPosts").unique(); assert(row); await c.db.patch(row._id, { messageId: undefined, generation: 2 }) })
    await status(await f.http("outcome", input), 409)
    attempt = await f.t.run(c => { const id = c.db.normalizeId("publishingAttempts", sent.grant.attemptId); assert(id); return c.db.get(id) }); assert.equal(attempt?.messageId, undefined)
    const row = await f.t.run(c => c.db.query("publishingPosts").unique()); assert.equal(row?.generation, 2); assert.equal(row?.messageId, undefined)
})

test("Staff resolve settles an unknown send so edit and forget work again", async ctx => {
    const f = fixture(ctx); let draft = await f.readyDraft(); const sent = await f.send(draft)
    await read(await f.outcome(sent.grant, "uncertain", null))
    await status(await f.manage({ type: "forget", postNo: 1, expectedGeneration: 1 }), 409)
    await status(await f.manage({ type: "edit", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, postNo: 1, expectedGeneration: 1, context }), 409)
    const seen = { channelId: context.channelId, botId: context.botId, content: draft.content }
    for (const op of [{ outcome: "sent" }, { outcome: "sent", messageId: "300" }, { outcome: "failed", messageId: "300" }, { outcome: "failed", ...seen }, { outcome: "pending" }, { outcome: "sent", ...seen, messageId: "invalid" }]) {
        await status(await f.manage({ type: "resolve", postNo: 1, expectedGeneration: 1, ...op }), 400)
    }
    await status(await f.manage({ type: "resolve", postNo: 1, expectedGeneration: 2, outcome: "failed" }), 409)
    for (const patch of [{ channelId: "31" }, { botId: "998" }, { content: { content: "Someone else wrote this" } }]) {
        await status(await f.manage({ type: "resolve", postNo: 1, expectedGeneration: 1, outcome: "sent", messageId: "300", ...seen, ...patch }), 409)
    }
    const resolved = await read(await f.manage({ type: "resolve", postNo: 1, expectedGeneration: 1, outcome: "sent", messageId: "300", ...seen }))
    assert.equal(resolved.type, "resolved"); assert.equal(resolved.post.outcome, "sent"); assert.equal(resolved.post.messageId, "300")
    assert.equal(resolved.post.attempt.outcome, "sent"); assert.deepEqual(resolved.post.confirmedContent, draft.content)
    await status(await f.manage({ type: "resolve", postNo: 1, expectedGeneration: 1, outcome: "failed" }), 409)
    draft = await f.edit(draft, { type: "content", content: "Corrected content" })
    const edited = await read(await f.manage({ type: "edit", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, postNo: 1, expectedGeneration: 1, context }))
    assert.equal(edited.grant.messageId, "300"); assert.deepEqual(edited.grant.expectedContent, sent.grant.canonicalContent)
})

test("Staff resolve of an unknown edit binds the tracked message and failed keeps the prior baseline", async ctx => {
    const f = fixture(ctx); let draft = await f.readyDraft(); const sent = await f.send(draft); await read(await f.outcome(sent.grant))
    draft = await f.edit(draft, { type: "content", content: "Changed intended content" })
    const edited = await read(await f.manage({ type: "edit", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, postNo: 1, expectedGeneration: 1, context }))
    await read(await f.outcome(edited.grant, "uncertain", null))
    await status(await f.manage({ type: "resolve", postNo: 1, expectedGeneration: 2, outcome: "sent", messageId: "301", channelId: context.channelId, botId: context.botId, content: draft.content }), 409)
    const failed = await read(await f.manage({ type: "resolve", postNo: 1, expectedGeneration: 2, outcome: "failed" }))
    assert.equal(failed.post.outcome, "failed"); assert.equal(failed.post.messageId, "300"); assert.deepEqual(failed.post.confirmedContent, sent.grant.content)
    const next = await read(await f.manage({ type: "edit", kind: draft.kind, name: draft.name, expectedRevision: draft.revision, postNo: 1, expectedGeneration: 2, context }))
    assert.equal(next.grant.generation, 3); assert.deepEqual(next.grant.expectedContent, sent.grant.canonicalContent)
    await read(await f.outcome(next.grant, "uncertain", null))
    const sentEdit = await read(await f.manage({ type: "resolve", postNo: 1, expectedGeneration: 3, outcome: "sent", messageId: "300", channelId: context.channelId, botId: context.botId, content: draft.content }))
    assert.equal(sentEdit.post.outcome, "sent"); assert.deepEqual(sentEdit.post.confirmedContent, draft.content)
    await read(await f.manage({ type: "forget", postNo: 1, expectedGeneration: 3 }))
})
