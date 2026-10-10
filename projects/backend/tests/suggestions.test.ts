import type { SuggestionsCardContext, SuggestionsCardGrant, SuggestionsContext, SuggestionsDefinition, SuggestionsWorkRow } from "@neonflux/contracts/suggestions"
import type { SuggestionsCardBinding } from "@neonflux/contracts/publishing-base"
import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import { makeFunctionReference } from "convex/server"
import schema from "../convex/schema.ts"
import { renderSuggestion, SUGGESTIONS_DAY } from "../convex/suggestionsDomain.ts"
import { botCall } from "./bot-service.ts"

const oldServer = process.env.NEONFLUX_SERVER_ID, oldSecret = process.env.NEONFLUX_BOT_API_SECRET
const secret = "synthetic-suggestions-secret-not-a-credential-000"
beforeEach(() => { process.env.NEONFLUX_SERVER_ID = "1"; process.env.NEONFLUX_BOT_API_SECRET = secret })
afterEach(() => { if (oldServer === undefined) delete process.env.NEONFLUX_SERVER_ID; else process.env.NEONFLUX_SERVER_ID = oldServer; if (oldSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET; else process.env.NEONFLUX_BOT_API_SECRET = oldSecret })
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"), "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/suggestions.ts": () => import("../convex/suggestions.ts"), "../convex/suggestionsWork.ts": () => import("../convex/suggestionsWork.ts"), "../convex/suggestionsCleanup.ts": () => import("../convex/suggestionsCleanup.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"), "../convex/moderation.ts": () => import("../convex/moderation.ts"), "../convex/_generated/api.js": () => import("../convex/_generated/api.js"), "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const owner = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
async function read(response: Response): Promise<any> { assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); return response.json() }
async function status(response: Response, expected: number) { assert.equal(response.status, expected, JSON.stringify(await response.clone().json())); assert(!JSON.stringify(await response.json()).includes(secret)) }
async function fixture(t: TestContext) {
    let now = Date.parse("2026-01-01T00:00:00Z"), sequence = 1000
    t.mock.method(Date, "now", () => now)
    const db = convexTest({ schema, modules, transactionLimits: true }), source = () => ({ serverId: "1", messageId: String(++sequence), createdAt: now })
    const context = (userId = "10", channelId = "30", joinedAt = "2024-01-01T00:00:00.000001Z"): SuggestionsContext => ({ observedAt: now, actor: { ...owner, userId, isOwner: userId === "10", isAdministrator: userId === "11" }, channelId, botId: "999", botAuthorized: true, actorAuthorized: true, member: { userId, joinedAt, roleIds: [], isBot: false, timeoutUntil: null, canView: true, canReadHistory: true } })
    const cardContext = (channelId = "30"): SuggestionsCardContext => ({ observedAt: now, channelId, botId: "999", botAuthorized: true })
    const http = (path: string, body: unknown, auth = true) => botCall(db, path, body, auth ? {} : { secret: null })
    const manage = (operation: unknown, current = context()) => http("/suggestions/manage", { ...source(), context: current, operation })
    const member = (operation: unknown, current = context("20")) => http("/suggestions/member", { ...source(), context: current, operation })
    const query = (operation: unknown, current = context()) => http("/suggestions/query", { serverId: "1", context: current, operation })
    const work = (operation: unknown) => http("/suggestions/work", { serverId: "1", operation })
    const binding = (row: SuggestionsCardBinding): SuggestionsCardBinding => ({ suggestionNo: row.suggestionNo, cardGeneration: row.cardGeneration, desiredRevision: row.desiredRevision })
    const reserve = (row: SuggestionsCardBinding, proof: unknown = cardContext()) => work({ type: "reserve", binding: binding(row), context: proof })
    const dispatch = (grant: SuggestionsCardGrant, proof: unknown = cardContext(), claimToken = "a".repeat(32)) => http("/publishing/dispatch", { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, claimToken, suggestionContext: proof })
    const outcome = (grant: SuggestionsCardGrant, value = "sent", claimToken: string | undefined = "a".repeat(32)) => http("/publishing/outcome", { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, outcome: value, ...(claimToken ? { claimToken } : {}), ...(value === "sent" ? { messageId: grant.messageId ?? "8000" } : {}) })
    const open = async () => { await read(await manage({ type: "configure", expectedRevision: 1, channelId: "30" })); await read(await manage({ type: "settings", expectedRevision: 2, enabled: true })) }
    const submit = (body = "Immutable proposition", current = context("20")) => member({ type: "submit", text: body }, current).then(read).then(r => r.suggestion as SuggestionsDefinition)
    const show = (suggestionNo = 1) => query({ type: "show", suggestionNo }).then(read).then(r => r.suggestion as SuggestionsDefinition)
    const cards = () => work({ type: "list" }).then(read).then(r => r.cards as SuggestionsWorkRow[])
    const vote = async (choice = "up", userId = "20", proof = context(userId), suggestionNo = 1) => member({ type: "vote", suggestionNo, choice }, proof)
    const publish = async () => { now += 5000; const grant = (await read(await reserve((await cards())[0]!))).grant as SuggestionsCardGrant; assert((await read(await dispatch(grant))).claimed); await read(await outcome(grant)); return grant }
    const cleanup = () => db.mutation(makeFunctionReference<"mutation">("suggestionsCleanup:cleanup"), {})
    const publication = () => query({ type: "publication", suggestionNo: 1 }).then(read)
    const postBinding = async () => { const value = await publication(); return { suggestionNo: 1, expectedRevision: value.suggestion.revision, cardGeneration: value.suggestion.cardGeneration, postNo: value.post.postNo, attemptId: value.post.attempt.attemptId, expectedGeneration: value.post.generation } }
    return { db, source, context, cardContext, http, manage, member, query, work, binding, reserve, dispatch, outcome, open, submit, show, cards, vote, publish, cleanup, publication, postBinding, now: () => now, advance: (ms: number) => { now += ms } }
}

test("Suggestion indexes are distinct and cards expose aggregate opinion without voter identities", () => {
    for (const name of ["suggestionSettings", "suggestions", "suggestionVotes", "suggestionReceipts", "publishingPosts", "publishingAttempts"] as const) {
        const indexes = schema.tables[name][" indexes"]().map(index => JSON.stringify(index.fields)); assert.equal(new Set(indexes).size, indexes.length, name)
    }
    const rendered = renderSuggestion({ suggestionNo: 1, authorId: "20", text: "Public proposition", state: "planned", up: 4, down: 2, reason: "Public reason" })
    assert.equal(rendered.embed!.description, "Public proposition")
    assert.deepEqual(rendered.embed!.fields!.map(field => [field.name, field.value]), [["Author", "<@20>"], ["Status", "Planned"], ["Votes", "4 up, 2 down"], ["Reason", "Public reason"]])
    assert(!JSON.stringify(rendered).includes("joinedAt"))
})

test("Suggestions start disabled and use actual manager and member contexts", async t => {
    const f = await fixture(t)
    assert.equal((await read(await f.query({ type: "settings" }))).settings.enabled, false)
    await status(await f.member({ type: "submit", text: "Test" }), 403)
    await status(await f.manage({ type: "configure", expectedRevision: 1, channelId: "30" }, f.context("20")), 403)
    await status(await f.http("/suggestions/query", { serverId: "1", context: f.context(), operation: { type: "settings" } }, false), 401)
    await f.open()
    const suggestion = await f.submit()
    assert.equal(suggestion.authorId, "20"); assert.equal(suggestion.state, "under-review")
    const receipts = await f.db.run(ctx => ctx.db.query("suggestionReceipts").collect())
    assert(!JSON.stringify(receipts).includes("Immutable proposition"))
    assert(receipts.every(r => /^[a-f0-9]{64}$/.test(r.operationKey)))
})

test("Submission anchor survives receipt expiry and exact original replay returns the retained suggestion", async t => {
    const f = await fixture(t); await f.open()
    const source = f.source(), operation = { type: "submit", text: "Original" }
    const original = await read(await f.http("/suggestions/member", { ...source, context: f.context("20"), operation }))
    f.advance(SUGGESTIONS_DAY + 1); await f.cleanup()
    const replay = await read(await f.http("/suggestions/member", { ...source, context: f.context("20"), operation }))
    assert.equal(replay.duplicate, true); assert.equal(replay.suggestion.suggestionNo, original.suggestion.suggestionNo)
    await status(await f.http("/suggestions/member", { ...source, context: f.context("20"), operation: { ...operation, text: "Changed" } }), 409)
    assert.equal((await f.db.run(ctx => ctx.db.query("suggestions").collect())).length, 1)
})

test("Clear keeps a lifetime source tombstone, duplicate binding and older IDs cannot resurrect a vote", async t => {
    const f = await fixture(t); await f.open(); await f.submit()
    await read(await f.vote())
    const source = f.source(), operation = { type: "vote", suggestionNo: 1, choice: "clear" }
    await read(await f.http("/suggestions/member", { ...source, context: f.context("20"), operation }))
    f.advance(SUGGESTIONS_DAY + 1); await f.cleanup()
    await status(await f.http("/suggestions/member", { ...source, createdAt: f.now(), context: f.context("20"), operation: { ...operation, choice: "up" } }), 409)
    const stale = await read(await f.http("/suggestions/member", { serverId: "1", messageId: String(Number(source.messageId) - 1), createdAt: f.now(), context: f.context("20"), operation: { ...operation, choice: "up" } }))
    assert.equal(stale.accepted, false)
    const suggestion = await f.show(); assert.equal(suggestion.up, 0); assert.equal(suggestion.voters, 1)
    assert.equal((await f.db.run(ctx => ctx.db.query("suggestionVotes").collect()))[0]!.choice, "clear")
})

test("Rejoin replaces one account opinion and protects raw epoch and observed-time fences", async t => {
    const f = await fixture(t); await f.open(); await f.submit(); await read(await f.vote())
    const newer = f.context("20", "30", "2025-01-01T00:00:00.000002Z")
    const changed = await read(await f.vote("down", "20", newer))
    assert.equal(changed.suggestion.up, 0); assert.equal(changed.suggestion.down, 1); assert.equal(changed.suggestion.voters, 1)
    const oldEpoch = await read(await f.vote("up", "20"))
    assert.equal(oldEpoch.accepted, false)
    assert.equal((await f.show()).down, 1)
})

test("First dirty due time is fixed and returned discovery rows remain actionable after rescan metadata", async t => {
    const f = await fixture(t); await f.open(); const submitted = await f.submit()
    assert.deepEqual(await f.cards(), [])
    f.advance(4000); await read(await f.vote())
    f.advance(1000)
    const row = (await f.cards())[0]!
    assert.equal(row.dueAt, submitted.createdAt + 5000); assert(row.nextCheckAt > f.now())
    const grant = (await read(await f.reserve(row))).grant as SuggestionsCardGrant
    assert.equal(grant.actorId, "999"); assert.equal(grant.source.type, "suggestion-card")
    assert.equal(grant.consumer.desiredRevision, 2)
    assert.equal((await read(await f.reserve(row))).grant.attemptId, grant.attemptId)
    assert((await read(await f.dispatch(grant))).claimed)
    assert.equal((await read(await f.dispatch(grant))).claimed, false)
})

test("Unclaimed stale snapshots cannot dispatch and new reservations serialize on the same post", async t => {
    const f = await fixture(t); await f.open(); await f.submit(); f.advance(5000)
    const old = (await read(await f.reserve((await f.cards())[0]!))).grant as SuggestionsCardGrant
    await read(await f.vote())
    assert.equal((await read(await f.dispatch(old))).claimed, false)
    const current = await f.show(), reserved = await Promise.all([f.reserve(current), f.reserve(current)])
    const a = (await read(reserved[0]!)).grant as SuggestionsCardGrant, b = (await read(reserved[1]!)).grant as SuggestionsCardGrant
    assert.equal(a.postNo, old.postNo); assert.equal(a.attemptId, b.attemptId); assert.notEqual(a.attemptId, old.attemptId)
    assert((await read(await f.dispatch(a))).claimed)
    const attempts = await f.db.run(ctx => ctx.db.query("publishingAttempts").collect())
    assert.equal(attempts.filter(a => a.outcome === "pending").length, 1)
})

test("Vote after claim preserves old actual outcome and queues a bounded same-card edit", async t => {
    const f = await fixture(t); await f.open(); await f.submit(); f.advance(5000)
    const first = (await read(await f.reserve((await f.cards())[0]!))).grant as SuggestionsCardGrant
    assert((await read(await f.dispatch(first))).claimed)
    await read(await f.vote())
    await status(await f.reserve(await f.show()), 409)
    await read(await f.outcome(first))
    const dirty = await f.show(); assert.equal(dirty.publishedRevision, 1); assert.equal(dirty.desiredRevision, 2); assert.equal(dirty.cardState, "queued")
    const edit = (await read(await f.reserve((await f.cards())[0]!))).grant as SuggestionsCardGrant
    assert.equal(edit.action, "edit"); assert.equal(edit.postNo, first.postNo); assert.equal(edit.messageId, "8000")
    assert.deepEqual(edit.expectedContent, first.canonicalContent)
    assert((await read(await f.dispatch(edit))).claimed); await read(await f.outcome(edit))
    assert.equal((await f.show()).cardStale, false)
    const state = (await read(await f.query({ type: "settings" }))).settings; assert.equal(state.dirty, 0); assert.equal(state.blocked, 0)
})

test("Unknown claimed work blocks automation without losing canonical votes, and exact reconcile retains evidence", async t => {
    const f = await fixture(t); await f.open(); await f.submit(); await f.publish(); await read(await f.vote())
    f.advance(5000); const edit = (await read(await f.reserve((await f.cards())[0]!))).grant as SuggestionsCardGrant
    await read(await f.dispatch(edit)); await read(await f.outcome(edit, "uncertain")); await read(await f.vote("down"))
    assert.equal((await f.show()).cardState, "blocked"); assert.deepEqual(await f.cards(), [])
    await status(await f.reserve(await f.show()), 409)
    f.advance(190000)
    const binding = await f.postBinding()
    const result = await read(await f.manage({ type: "reconcile", ...binding, observation: { observedAt: f.now(), messageId: edit.messageId!, channelId: "30", botId: "999", content: edit.canonicalContent } }))
    assert.equal(result.post.attempt.outcome, "uncertain"); assert.equal(result.post.attempt.resolution.matched, "intended")
    assert.equal(result.suggestion.publishedRevision, edit.consumer.desiredRevision); assert.equal(result.suggestion.cardState, "queued")
    assert.equal((await f.cards()).length, 1)
})

test("Known typed absence replacement is explicit and keeps old settled publisher evidence", async t => {
    const f = await fixture(t); await f.open(); await f.submit(); const old = await f.publish()
    const binding = await f.postBinding(), observation = { status: "absent", observedAt: f.now(), messageId: "8000", channelId: "30", botId: "999" }
    await status(await f.manage({ type: "replace", ...binding, observation, confirm: true }), 409)
    f.advance(190000)
    await status(await f.manage({ type: "replace", ...binding, observation: { ...observation, observedAt: f.now(), messageId: "8001" }, confirm: true }), 409)
    await read(await f.manage({ type: "replace", ...binding, observation: { ...observation, observedAt: f.now() }, confirm: true }))
    const row = await f.show(); assert.equal(row.cardGeneration, 2); assert.equal(row.postNo, undefined)
    f.advance(5000); const grant = (await read(await f.reserve((await f.cards())[0]!))).grant as SuggestionsCardGrant
    assert.equal(grant.action, "send"); assert.notEqual(grant.postNo, old.postNo)
    assert.equal((await f.db.run(ctx => ctx.db.query("publishingPosts").collect())).length, 2)
})

test("Frozen destinations and fresh visibility protect all interfaces while card automation acts as the bot", async t => {
    const f = await fixture(t); await f.open(); const original = await f.submit()
    await read(await f.manage({ type: "configure", expectedRevision: 3, channelId: "31" }, f.context("10", "31")))
    const next = await f.submit("New destination", f.context("20", "31"))
    assert.equal(original.channelId, "30"); assert.equal(next.channelId, "31")
    for (const operation of [{ type: "show", suggestionNo: 1 }, { type: "mine", suggestionNo: 1 }, { type: "publication", suggestionNo: 1 }]) await status(await f.query(operation, f.context("20", "31")), 403)
    const hidden = { ...f.context("20"), member: { ...f.context("20").member!, canView: false } }
    await status(await f.query({ type: "show", suggestionNo: 1 }, hidden), 403)
    f.advance(5000)
    // The card contract requires botAuthorized: true, so false is malformed input
    await status(await f.reserve(await f.show(), { ...f.cardContext(), botAuthorized: false }), 400)
    await status(await f.reserve(await f.show(), f.cardContext("31")), 403)
    await status(await f.reserve(await f.show(), f.context("10")), 400)
    const grant = (await read(await f.reserve(await f.show()))).grant
    assert.equal(grant.actorId, "999"); assert.equal(grant.botId, "999")
})

test("Disable preserves opinion and author withdrawal, blocks claims, and re-enable resumes latest valid state", async t => {
    const f = await fixture(t); await f.open(); await f.submit(); f.advance(5000)
    const grant = (await read(await f.reserve((await f.cards())[0]!))).grant as SuggestionsCardGrant
    await read(await f.manage({ type: "settings", expectedRevision: 3, enabled: false }))
    assert.equal((await read(await f.dispatch(grant))).claimed, false)
    await status(await f.vote(), 403)
    await read(await f.member({ type: "withdraw", suggestionNo: 1, expectedRevision: 1, confirm: true }))
    assert.equal((await f.show()).state, "withdrawn")
    await read(await f.manage({ type: "settings", expectedRevision: 4, enabled: true }))
    const next = (await read(await f.reserve(await f.show()))).grant as SuggestionsCardGrant
    assert.equal(next.content.embed!.fields![1]!.value, "Withdrawn")
    await status(await f.manage({ type: "status", suggestionNo: 1, expectedRevision: 2, state: "planned", reason: "Reopen" }), 409)
})

test("Staff states keep the latest public reason and actor, reopen unexpired terminal state", async t => {
    const f = await fixture(t); await f.open(); await f.submit(); await read(await f.vote())
    await read(await f.manage({ type: "status", suggestionNo: 1, expectedRevision: 1, state: "completed", reason: "Shipped" }, f.context("11")))
    await status(await f.vote("down"), 403)
    await read(await f.manage({ type: "status", suggestionNo: 1, expectedRevision: 2, state: "planned", reason: "Follow-up" }))
    assert.equal((await f.show()).historyExpiresAt, undefined)
    const row = await f.show()
    assert.equal(row.reason, "Follow-up"); assert.equal(row.statusBy, "10"); assert.equal(row.revision, 3)
    await read(await f.vote("down"))
})

test("Logical terminal expiry precedes cleanup, while unresolved ownership remains physically retained", async t => {
    const f = await fixture(t); await f.open(); await f.submit(); f.advance(5000)
    const grant = (await read(await f.reserve((await f.cards())[0]!))).grant as SuggestionsCardGrant
    await read(await f.dispatch(grant)); await read(await f.outcome(grant, "uncertain"))
    await read(await f.member({ type: "withdraw", suggestionNo: 1, expectedRevision: 1, confirm: true }))
    f.advance(180 * SUGGESTIONS_DAY + 1)
    await status(await f.query({ type: "show", suggestionNo: 1 }), 404)
    await f.cleanup()
    assert.equal((await f.db.run(ctx => ctx.db.query("suggestions").collect())).length, 1)
    await status(await f.manage({ type: "forget", suggestionNo: 1, expectedRevision: 2, confirm: true }), 409)
})

test("Bounded terminal forgetting removes exact vote/tombstone/counter/source data and preserves another suggestion", async t => {
    const f = await fixture(t); await f.open(); await f.submit(); await f.publish(); await f.submit("Preserved")
    for (let i = 0; i < 23; i++) await read(await f.vote(i % 2 ? "up" : "clear", String(100 + i)))
    await read(await f.member({ type: "withdraw", suggestionNo: 1, expectedRevision: 1, confirm: true }))
    const first = await read(await f.manage({ type: "forget", suggestionNo: 1, expectedRevision: 2, confirm: true }))
    assert.equal(first.complete, false); assert.equal(first.removed, 20)
    const second = await read(await f.manage({ type: "forget", suggestionNo: 1, expectedRevision: first.revision, confirm: true }))
    assert.equal(second.complete, true)
    const state = (await read(await f.query({ type: "settings" }))).settings
    assert.equal(state.suggestions, 1); assert.equal(state.voters, 0); assert.equal(state.dirty, 1)
    assert.equal((await f.show(2)).text, "Preserved")
    assert.equal((await f.db.run(ctx => ctx.db.query("publishingPosts").collect())).length, 0)
    assert.equal((await f.db.run(ctx => ctx.db.query("publishingAttempts").collect())).length, 0)
})

test("Capacity refusal counts clear tombstones and rolls back counts and accepted source", async t => {
    const f = await fixture(t); await f.open(); await f.submit()
    await f.db.run(async ctx => { const row = await ctx.db.query("suggestions").first(); await ctx.db.patch(row!._id, { voters: 1000 }) })
    await status(await f.vote("clear"), 429)
    assert.equal((await f.db.run(ctx => ctx.db.query("suggestionVotes").collect())).length, 0)
    await f.db.run(async ctx => { const row = await ctx.db.query("suggestionSettings").first(); await ctx.db.patch(row!._id, { suggestions: 1000 }) })
    await status(await f.member({ type: "submit", text: "Over quota" }), 429)
    assert.equal((await f.db.run(ctx => ctx.db.query("suggestions").collect())).length, 1)
})

test("Fair bounded discovery traverses twenty-row pages and does not delay returned work", async t => {
    const f = await fixture(t); await f.open()
    for (let i = 0; i < 23; i++) await f.submit(`Suggestion ${i}`)
    f.advance(5000)
    const first = await read(await f.work({ type: "list" })); assert.equal(first.cards.length, 20); assert.equal(first.hasMore, true)
    const second = await read(await f.work({ type: "list", cursor: first.nextCursor })); assert.equal(second.cards.length, 3); assert.equal(second.hasMore, false)
    assert.equal(new Set([...first.cards, ...second.cards].map(r => r.suggestionNo)).size, 23)
    assert.equal((await read(await f.reserve(first.cards[0]))).type, "reserved")
})

test("DEFCON and participant protections pause new votes and dispatch while restricted withdrawal and disable remain available", async t => {
    const f = await fixture(t); await f.open(); await f.submit()
    const timedOut = { ...f.context("20"), member: { ...f.context("20").member!, timeoutUntil: new Date(f.now() + 60000).toISOString() } }
    await status(await f.vote("up", "20", timedOut), 403)
    await read(await f.http("/moderation/manage", { ...f.source(), actor: owner, operation: { type: "settings", patch: { defcon: 2 } } }))
    await status(await f.vote(), 403)
    assert.equal((await f.show()).state, "under-review")
    await read(await f.member({ type: "withdraw", suggestionNo: 1, expectedRevision: 1, confirm: true }, timedOut))
    await read(await f.http("/moderation/manage", { ...f.source(), actor: owner, operation: { type: "settings", patch: { defcon: 1 } } }))
    await read(await f.manage({ type: "settings", expectedRevision: 3, enabled: false }))
    assert.equal((await read(await f.query({ type: "settings" }))).settings.enabled, false)
})

test("Quarantine and configured verification independently reject participation without affecting historical opinion", async t => {
    const f = await fixture(t); await f.open(); await f.submit(); await read(await f.vote())
    await read(await f.http("/moderation/manage", { ...f.source(), actor: owner, operation: { type: "action", action: { type: "quarantine", targetId: "20", durationSeconds: 60, reason: "Synthetic quarantine" }, context: { botActionAuthorized: true, actorCanManageTarget: true, botCanManageTarget: true, targetProtected: false, botId: "999", currentTimeoutUntil: null } } }))
    await status(await f.vote("down"), 403)
    assert.equal((await read(await f.query({ type: "mine", suggestionNo: 1 }, f.context("20")))).vote.choice, "up")
    await f.db.run(async ctx => { await ctx.db.insert("rolePanels", { serverId: "1", name: "verify", kind: "verification", enabled: false, revision: 1, exclusive: false, mappings: [{ emoji: "ok", roleId: "40", prerequisiteRoleIds: [], exclusionRoleIds: [] }], withdrawing: false }) })
    await status(await f.vote("down", "21"), 403)
    assert.equal((await f.show()).up, 1)
})

test("Expired unclaimed reservations may resume with a new exact attempt, claimed abandoned work never auto-replays", async t => {
    const f = await fixture(t); await f.open(); await f.submit(); f.advance(5000)
    const first = (await read(await f.reserve((await f.cards())[0]!))).grant as SuggestionsCardGrant
    f.advance(190001)
    assert.equal((await read(await f.dispatch(first))).claimed, false)
    const next = (await read(await f.reserve(await f.show()))).grant as SuggestionsCardGrant
    assert.equal(next.postNo, first.postNo); assert.notEqual(next.attemptId, first.attemptId)
    assert((await read(await f.dispatch(next))).claimed)
    f.advance(190001)
    assert.deepEqual(await f.cards(), [])
    await status(await f.reserve(await f.show()), 409)
    assert.equal((await f.show()).cardState, "blocked")
})

test("Late outcomes after reconciliation are refused and cannot clear dirty work after a newer edit reservation", async t => {
    const f = await fixture(t); await f.open(); await f.submit(); await f.publish(); await read(await f.vote())
    f.advance(5000)
    const unknown = (await read(await f.reserve((await f.cards())[0]!))).grant as SuggestionsCardGrant
    await read(await f.dispatch(unknown)); await read(await f.outcome(unknown, "uncertain")); await read(await f.vote("down")); f.advance(190001)
    await read(await f.manage({ type: "reconcile", ...await f.postBinding(), observation: { observedAt: f.now(), messageId: unknown.messageId!, channelId: "30", botId: "999", content: unknown.canonicalContent } }))
    const next = (await read(await f.reserve(await f.show()))).grant as SuggestionsCardGrant
    await status(await f.outcome(unknown), 409)
    const row = await f.show()
    assert.equal(row.attemptId, next.attemptId); assert.equal(row.cardState, "reserved"); assert.equal(row.cardStale, true)
    assert((await read(await f.dispatch(next))).claimed); await read(await f.outcome(next)); assert.equal((await f.show()).cardStale, false)
})

test("Expiry cleanup traverses unresolved heads fairly and retains the original logical expiry", async t => {
    const f = await fixture(t); await f.open()
    for (let i = 0; i < 21; i++) {
        const row = await f.submit(`Retained ${i}`); f.advance(5000)
        if (i < 20) { const grant = (await read(await f.reserve(row))).grant as SuggestionsCardGrant; await read(await f.dispatch(grant)); await read(await f.outcome(grant, "uncertain")) }
        await read(await f.member({ type: "withdraw", suggestionNo: row.suggestionNo, expectedRevision: 1, confirm: true }))
    }
    f.advance(180 * SUGGESTIONS_DAY + 1)
    const original = await f.db.run(ctx => ctx.db.query("suggestions").withIndex("by_number", q => q.eq("serverId", "1").eq("suggestionNo", 1)).unique())
    await f.cleanup(); await f.cleanup()
    const rows = await f.db.run(ctx => ctx.db.query("suggestions").collect())
    assert.equal(rows.length, 20); assert(!rows.some(r => r.suggestionNo === 21))
    assert.equal(rows.find(r => r.suggestionNo === 1)!.historyExpiresAt, original!.historyExpiresAt)
    await status(await f.query({ type: "show", suggestionNo: 1 }), 404)
})

test("Expired known ownership can still reconcile for exact settled forgetting without reopening native work", async t => {
    const f = await fixture(t); await f.open(); await f.submit(); f.advance(5000)
    const grant = (await read(await f.reserve((await f.cards())[0]!))).grant as SuggestionsCardGrant
    await read(await f.dispatch(grant))
    await read(await f.http("/publishing/outcome", { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, claimToken: "a".repeat(32), outcome: "uncertain", messageId: "8000" }))
    await read(await f.member({ type: "withdraw", suggestionNo: 1, expectedRevision: 1, confirm: true }))
    f.advance(180 * SUGGESTIONS_DAY + 1)
    const binding = await f.postBinding()
    const result = await read(await f.manage({ type: "reconcile", ...binding, observation: { observedAt: f.now(), messageId: "8000", channelId: "30", botId: "999", content: grant.canonicalContent } }))
    assert.equal(result.post.attempt.outcome, "uncertain"); assert.equal(result.post.attempt.resolution.matched, "intended")
    assert.deepEqual(await f.cards(), [])
    await status(await f.reserve(result.suggestion), 404)
    await read(await f.manage({ type: "forget", suggestionNo: 1, expectedRevision: 2, confirm: true }))
    assert.equal((await f.db.run(ctx => ctx.db.query("suggestions").collect())).length, 0)
})

test("A contradictory canonical observation restores blocked recovery and cannot leave a falsely current card", async t => {
    const f = await fixture(t); await f.open(); await f.submit(); f.advance(5000)
    const grant = (await read(await f.reserve((await f.cards())[0]!))).grant as SuggestionsCardGrant
    await read(await f.dispatch(grant))
    await read(await f.http("/publishing/outcome", { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, claimToken: "a".repeat(32), outcome: "uncertain", messageId: "8000" }))
    f.advance(190001)
    const binding = await f.postBinding(), observation = { observedAt: f.now(), messageId: "8000", channelId: "30", botId: "999", content: grant.canonicalContent }
    await read(await f.manage({ type: "reconcile", ...binding, observation }))
    assert.equal((await f.show()).cardStale, false)
    f.advance(1)
    const contradictory = await read(await f.manage({ type: "reconcile", ...binding, observation: { ...observation, observedAt: f.now(), content: { content: "Synthetic unrelated baseline" } } }))
    assert.equal(contradictory.post.attempt.resolution, undefined); assert.equal(contradictory.suggestion.cardState, "blocked"); assert.equal(contradictory.suggestion.cardStale, true)
    assert.equal((await read(await f.query({ type: "settings" }))).settings.blocked, 1)
    assert.deepEqual(await f.cards(), [])
})

test("A forum card creates its post once, and later edits and status changes find the card in that post", async t => {
    const f = await fixture(t); await f.open(); await f.submit("Forum proposition")
    f.advance(5000)
    const [row] = await f.cards()
    assert.equal(row!.suggestionState, "under-review"); assert.equal(row!.threadId, undefined)
    const grant = (await read(await f.reserve(row!))).grant as SuggestionsCardGrant
    assert.equal(grant.forumPostName, "#1 Forum proposition"); assert.equal(grant.channelId, "30")
    assert((await read(await f.dispatch(grant))).claimed)
    const sent = { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, outcome: "sent", claimToken: "a".repeat(32), messageId: "8000" }
    // Only a post send may name the post it created, and only with its first message
    const { messageId: _messageId, ...withoutMessage } = sent
    await status(await f.http("/publishing/outcome", { ...withoutMessage, outcome: "uncertain", threadId: "7000" }), 400)
    await read(await f.http("/publishing/outcome", { ...sent, threadId: "7000" }))
    const published = await f.publication()
    assert.equal(published.suggestion.threadId, "7000"); assert.equal(published.post.channelId, "7000"); assert.equal(published.post.attempt.threadId, "7000")
    await read(await f.manage({ type: "status", suggestionNo: 1, expectedRevision: 1, state: "planned", reason: "Accepted" }))
    f.advance(5000)
    const [edit] = await f.cards()
    assert.equal(edit!.threadId, "7000"); assert.equal(edit!.suggestionState, "planned")
    // The edit acts in the post, so a proof for the destination channel no longer matches
    await status(await f.reserve(edit!), 403)
    const update = (await read(await f.reserve(edit!, f.cardContext("7000")))).grant as SuggestionsCardGrant
    assert.equal(update.action, "edit"); assert.equal(update.channelId, "7000"); assert.equal(update.forumPostName, undefined)
    assert((await read(await f.dispatch(update, f.cardContext("7000")))).claimed)
    await read(await f.outcome(update))
    assert.equal((await f.show()).cardState, "current")
})

test("A text channel card cannot claim a forum post", async t => {
    const f = await fixture(t); await f.open(); await f.submit()
    f.advance(5000)
    const grant = (await read(await f.reserve((await f.cards())[0]!))).grant as SuggestionsCardGrant
    await f.db.run(async ctx => { await ctx.db.patch(ctx.db.normalizeId("publishingAttempts", grant.attemptId)!, { forumPostName: undefined }) })
    assert((await read(await f.dispatch(grant))).claimed)
    await status(await f.http("/publishing/outcome", { serverId: "1", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, outcome: "sent", claimToken: "a".repeat(32), messageId: "8000", threadId: "7000" }), 400)
})
