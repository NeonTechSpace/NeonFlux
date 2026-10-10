import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import type { StructureChannel, StructureClaim, StructureEntry } from "@neonflux/contracts/structure"
import schema from "../convex/schema.ts"
import { api } from "../convex/_generated/api.js"
import { tokenHash } from "../convex/dashboard.ts"
import { STRUCTURE_APPLY_MS, STRUCTURE_INTERVAL_MS, STRUCTURE_MS, STRUCTURE_SETTLE_MS } from "../convex/structure.ts"
import { structureChanges, structureMerge } from "../convex/structureDomain.ts"
import { botCall } from "./bot-service.ts"

const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"), "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/structure.ts": () => import("../convex/structure.ts"), "../convex/installations.ts": () => import("../convex/installations.ts"),
    "../convex/auditLog.ts": () => import("../convex/auditLog.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"), "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const keys = ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_IDS", "NEONFLUX_BOT_API_SECRET"] as const
const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]))
let now = Date.parse("2026-10-01T00:00:00Z")
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.NEONFLUX_BOT_API_SECRET = "synthetic-structure-editor-secret-00000000"
    mock.method(Date, "now", () => now)
    mock.timers.enable({ apis: ["setTimeout"] })
})
afterEach(() => {
    mock.restoreAll()
    mock.timers.reset()
    for (const key of keys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key] }
})

const entry = (id: string, type: StructureEntry["type"], name: string, parentId: string | null = null): StructureEntry => ({ id, type, name, parentId })
// Info holds rules and news, Chat holds general and lounge, and welcome sits at the top level after them
const base = [entry("100", "category", "Info"), entry("101", "text", "rules", "100"), entry("102", "text", "news", "100"),
    entry("200", "category", "Chat"), entry("201", "text", "general", "200"), entry("202", "voice", "lounge", "200"), entry("300", "text", "welcome")]
const at = (layout: readonly StructureEntry[], id: string) => layout.find(row => row.id === id)!
// The draft renames general to chat, moves news into Chat after it and moves Chat above Info
const draft = [at(base, "200"), { ...at(base, "201"), name: "chat" }, { ...at(base, "102"), parentId: "200" }, at(base, "202"), at(base, "100"), at(base, "101"), at(base, "300")]
const current = (layout: readonly StructureEntry[], manage = (_id: string) => true): StructureChannel[] => layout.map(row => ({ ...row, manage: manage(row.id) }))
const decided = (items: ReturnType<typeof structureMerge>) => items.map(item => [item.change.type, item.change.channelId, item.disposition, item.reason])

test("A draft's changes name each rename and the fewest moves that explain its order", () => {
    assert.deepEqual(structureChanges(base, draft), [
        { type: "rename", channelId: "201", from: "general", to: "chat" },
        { type: "move", channelId: "102", name: "news", from: { parentId: "100", parentName: "Info", afterId: "101", afterName: "rules" }, to: { parentId: "200", parentName: "Chat", afterId: "201", afterName: "chat" } },
        // Moving Info below Chat explains the new top-level order with one move
        { type: "move", channelId: "100", name: "Info", from: { parentId: null, parentName: null, afterId: null, afterName: null }, to: { parentId: null, parentName: null, afterId: "200", afterName: "Chat" } },
    ])
    assert.deepEqual(structureChanges(base, base), [])
})

test("The merge applies changes to a structure nobody else changed, each move after the sibling it follows in the draft", () => {
    const items = structureMerge(base, draft, current(base))
    assert.deepEqual(decided(items), [["rename", "201", "apply", null], ["move", "102", "apply", null], ["move", "100", "apply", null]])
    assert.deepEqual(items.map(item => item.apply), [{ itemNo: 1, type: "rename", channelId: "201", name: "chat" },
        { itemNo: 2, type: "move", channelId: "102", parentId: "200", precedingSiblingId: "201" }, { itemNo: 3, type: "move", channelId: "100", parentId: null, precedingSiblingId: "200" }])
})

test("A channel both sides changed conflicts instead of being overwritten", () => {
    // Elsewhere, general was renamed and news was moved to the top level
    const changed = [at(base, "100"), at(base, "101"), at(base, "200"), { ...at(base, "201"), name: "talk" }, at(base, "202"), at(base, "300"), { ...at(base, "102"), parentId: null }]
    const items = structureMerge(base, draft, current(changed))
    assert.deepEqual(decided(items), [["rename", "201", "conflict", "It was renamed to talk since your draft started"], ["move", "102", "conflict", "It was moved since your draft started"],
        ["move", "100", "apply", null]])
    assert.equal(items[0]!.apply, undefined)
})

test("A channel deleted while the draft was open is blocked, and a move that followed it goes first", () => {
    const items = structureMerge(base, draft, current(base.filter(row => row.id !== "201")))
    assert.deepEqual(decided(items), [["rename", "201", "blocked", "The channel was deleted, or you can no longer see it"], ["move", "102", "apply", null], ["move", "100", "apply", null]])
    assert.deepEqual(items[1]!.apply, { itemNo: 2, type: "move", channelId: "102", parentId: "200", precedingSiblingId: null })
})

test("A move into a category that no longer exists is blocked", () => {
    // Deleting Chat left its channels at the top level
    const gone = [at(base, "100"), at(base, "101"), at(base, "102"), { ...at(base, "201"), parentId: null }, { ...at(base, "202"), parentId: null }, at(base, "300")]
    const items = structureMerge(base, draft, current(gone))
    assert.deepEqual(decided(items), [["rename", "201", "apply", null], ["move", "102", "blocked", "The category Chat was deleted, or you can no longer see it"], ["move", "100", "apply", null]])
    assert.deepEqual(items[2]!.apply, { itemNo: 3, type: "move", channelId: "100", parentId: null, precedingSiblingId: null })
})

test("Changes already made are skipped, changes in channels the manager cannot manage are refused and moves around them do not conflict", () => {
    // Elsewhere, general was renamed to chat already, and lounge was moved above general
    const changed = [at(base, "100"), at(base, "101"), at(base, "102"), at(base, "200"), at(base, "202"), { ...at(base, "201"), name: "chat" }, at(base, "300")]
    const items = structureMerge(base, draft, current(changed, id => id !== "100"))
    assert.deepEqual(decided(items), [["rename", "201", "skip", "It already has this name"], ["move", "102", "apply", null], ["move", "100", "refused", "You need Manage Channels in this channel"]])
    assert.deepEqual(items[1]!.apply, { itemNo: 2, type: "move", channelId: "102", parentId: "200", precedingSiblingId: "201" })
})

const backend = () => convexTest({ schema, modules, transactionLimits: true })
async function session(t: ReturnType<typeof backend>) {
    const sessionToken = "a".repeat(64)
    await t.run(async ctx => { await ctx.db.insert("dashboardSessions", { tokenHash: await tokenHash(sessionToken), accessToken: "synthetic-sealed-token", userId: "20", userName: "Synthetic manager",
        servers: [{ id: "10", name: "Synthetic server" }], expiresAt: now + 3600000, lifetimeAt: now + 86400000 }) })
    return { sessionToken, serverId: "10" }
}
const json = async (response: Response) => { assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); return response.json() as Promise<unknown> }
const read = (layout: readonly StructureEntry[]) => ({ channels: current(layout), threads: [{ id: "900", parentId: "201", name: "plans", private: false, archived: false }], threadsTruncated: false })
const answerRead = (t: ReturnType<typeof backend>, requestedAt: number, layout = base) => botCall(t, "/structure/answer", { serverId: "10", originServerId: "10", userId: "20", requestedAt, work: "read", read: read(layout) })

test("A manager's read, closed threads and change notice run through the bot, which answers with its own reads", async () => {
    const t = backend(), args = await session(t), start = now
    assert.equal(await t.query(api.structure.view, args), null)
    await t.mutation(api.structure.request, args)
    assert.deepEqual(await t.query(api.structure.view, args), { serverId: "10", state: "queued", work: "read", requestedAt: start, read: null, archived: [], save: null })
    // The work dispatcher wakes the server's dashboard worker, which asks for the waiting requests
    assert.deepEqual((await json(await botCall(t, "/service/work", { cursor: null })) as { kinds: { dashboard: string[] } }).kinds.dashboard, ["10"])
    assert.deepEqual(await json(await botCall(t, "/structure/ready", { serverId: "10" })), { jobs: [{ userId: "20", requestedAt: start, work: { type: "read" } }] })
    // Facts about what the manager can see must name this server, and a read must keep categories before their channels
    assert.equal((await botCall(t, "/structure/answer", { serverId: "10", userId: "20", requestedAt: start, work: "read", read: read(base) })).status, 403)
    assert.equal((await answerRead(t, start, [at(base, "101"), ...base.filter(row => row.id !== "101")])).status, 400)
    assert.deepEqual(await json(await answerRead(t, start)), { recorded: true })
    assert.deepEqual(await json(await answerRead(t, start)), { recorded: false })
    const view = await t.query(api.structure.view, args)
    assert.equal(view?.state, "done")
    assert.deepEqual(view?.read, { readAt: start, ...read(base) })

    // Reads wait for the interval, so the refresh button cannot keep the bot reading Fluxer
    now += STRUCTURE_INTERVAL_MS - 1
    await t.mutation(api.structure.request, args)
    assert.equal((await t.query(api.structure.view, args))?.state, "done")

    // A channel event marks the read out of date until the next read
    assert.deepEqual(await json(await botCall(t, "/structure/changed", { serverId: "10" })), { marked: 1 })
    assert.equal((await t.query(api.structure.view, args))?.changedAt, now)
    assert.deepEqual(await json(await botCall(t, "/structure/changed", { serverId: "10" })), { marked: 0 })

    // Closed threads of a channel from the read load on request
    await assert.rejects(t.mutation(api.structure.threads, { ...args, channelId: "200" }))
    await t.mutation(api.structure.threads, { ...args, channelId: "201" })
    assert.deepEqual(await json(await botCall(t, "/structure/ready", { serverId: "10" })), { jobs: [{ userId: "20", requestedAt: now, work: { type: "threads", channelId: "201" } }] })
    const page = { channelId: "201", threads: [{ id: "901", parentId: "201", name: "old plans", private: false, archived: true }], more: false }
    assert.deepEqual(await json(await botCall(t, "/structure/answer", { serverId: "10", originServerId: "10", userId: "20", requestedAt: now, work: "threads", threads: page })), { recorded: true })
    assert.deepEqual((await t.query(api.structure.view, args))?.archived, [page])

    // The next read clears the notice and the closed threads
    now += 1
    await t.mutation(api.structure.request, args)
    assert.deepEqual(await json(await answerRead(t, now)), { recorded: true })
    const fresh = await t.query(api.structure.view, args)
    assert.equal(fresh?.changedAt, undefined)
    assert.deepEqual(fresh?.archived, [])

    // A request the bot does not answer in time fails, and its late answer is dropped
    now += STRUCTURE_INTERVAL_MS
    const late = now
    await t.mutation(api.structure.request, args)
    now += STRUCTURE_MS
    await t.finishAllScheduledFunctions(() => mock.timers.tick(STRUCTURE_MS))
    assert.deepEqual([(await t.query(api.structure.view, args))?.state, (await t.query(api.structure.view, args))?.failure], ["failed", "unanswered"])
    assert.deepEqual(await json(await answerRead(t, late)), { recorded: false })
    // A manager who left the server gets the bot's answer instead of a read
    await t.mutation(api.structure.request, args)
    assert.deepEqual(await json(await botCall(t, "/structure/answer", { serverId: "10", userId: "20", requestedAt: now, work: "read", failure: "access" })), { recorded: true })
    assert.deepEqual((await t.query(api.structure.view, args))?.failure, "access")
})

test("A save is merged with the bot's fresh read when the bot claims it, claimed once, and each confirmed change enters the audit log", async () => {
    const t = backend(), args = await session(t)
    await t.mutation(api.structure.request, args)
    await json(await answerRead(t, now))
    // The preview decides as a save would, against the latest read
    assert.deepEqual((await t.query(api.structure.preview, { ...args, base, draft }))?.items.map(item => [item.change.channelId, item.disposition]), [["201", "apply"], ["102", "apply"], ["100", "apply"]])
    await assert.rejects(t.query(api.structure.preview, { ...args, base, draft: draft.slice(1) }))
    await assert.rejects(t.mutation(api.structure.save, { ...args, base, draft: base }))

    now += 1000
    const saved = now
    assert.deepEqual(await t.mutation(api.structure.save, { ...args, base, draft }), { queued: true, requestedAt: saved })
    assert.deepEqual(await t.mutation(api.structure.save, { ...args, base, draft }), { queued: false })
    // The waiting job carries no draft, which the claim keeps in the backend
    assert.deepEqual(await json(await botCall(t, "/structure/ready", { serverId: "10" })), { jobs: [{ userId: "20", requestedAt: saved, work: { type: "save" } }] })
    // Elsewhere, general was renamed while the draft was open
    const changed = base.map(row => row.id === "201" ? { ...row, name: "talk" } : row)
    const claim = { serverId: "10", originServerId: "10", userId: "20", requestedAt: saved, current: current(changed) }
    const claimed = await json(await botCall(t, "/structure/claim", claim)) as StructureClaim
    assert.deepEqual(claimed, { claimed: true, applyUntil: now + STRUCTURE_APPLY_MS, apply: [{ itemNo: 2, type: "move", channelId: "102", parentId: "200", precedingSiblingId: "201" },
        { itemNo: 3, type: "move", channelId: "100", parentId: null, precedingSiblingId: "200" }] })
    // A second claim, such as after a lost answer, gets nothing to write
    assert.deepEqual(await json(await botCall(t, "/structure/claim", claim)), { claimed: false, applyUntil: 0, apply: [] })
    const applying = await t.query(api.structure.view, args)
    assert.deepEqual([applying?.state, applying?.save], ["applying", null])

    const record = (results: unknown[]) => botCall(t, "/structure/record", { serverId: "10", userId: "20", requestedAt: saved, results })
    assert.equal((await record([{ itemNo: 2, outcome: "applied" }])).status, 400)
    assert.equal((await record([{ itemNo: 1, outcome: "applied" }, { itemNo: 2, outcome: "applied" }, { itemNo: 3, outcome: "applied" }])).status, 400)
    assert.deepEqual(await json(await record([{ itemNo: 2, outcome: "applied" }, { itemNo: 3, outcome: "uncertain", reason: "Fluxer did not confirm the move" }])), { recorded: true })
    assert.deepEqual(await json(await record([{ itemNo: 2, outcome: "applied" }, { itemNo: 3, outcome: "applied" }])), { recorded: false })
    const done = await t.query(api.structure.view, args)
    // The editor reads the server again at once, and the results stay
    assert.deepEqual([done?.state, done?.work], ["queued", "read"])
    assert.deepEqual(done?.save?.results.map(result => [result.itemNo, result.outcome, result.reason]), [[1, "conflict", "It was renamed to talk since your draft started"], [2, "applied", null], [3, "uncertain", "Fluxer did not confirm the move"]])
    const audit = await t.query(api.auditLog.page, { ...args, feature: "structure", cursor: null })
    assert.deepEqual(audit.entries.map(row => [row.actorName, row.setting, row.summary]).reverse(), [["Synthetic manager", "move news", "Info, after rules → Chat, after chat"],
        ["Synthetic manager", "move Info", "top level, first → top level, after Chat, outcome unknown"]])
})

test("A claimed save the bot never confirms becomes uncertain and is recorded as such", async () => {
    const t = backend(), args = await session(t)
    await t.mutation(api.structure.request, args)
    await json(await answerRead(t, now))
    await t.mutation(api.structure.save, { ...args, base, draft })
    await json(await botCall(t, "/structure/claim", { serverId: "10", originServerId: "10", userId: "20", requestedAt: now, current: current(base) }))
    now += STRUCTURE_APPLY_MS + STRUCTURE_SETTLE_MS
    await t.finishAllScheduledFunctions(() => mock.timers.tick(STRUCTURE_APPLY_MS + STRUCTURE_SETTLE_MS))
    const view = await t.query(api.structure.view, args)
    assert.deepEqual([view?.state, view?.failure], ["failed", "uncertain"])
    assert.deepEqual(view?.save?.results.map(result => result.outcome), ["uncertain", "uncertain", "uncertain"])
    assert.equal((await t.query(api.auditLog.page, { ...args, feature: "structure", cursor: null })).entries.length, 3)
    assert.deepEqual(await json(await botCall(t, "/structure/record", { serverId: "10", userId: "20", requestedAt: view!.save!.requestedAt, results: [] })), { recorded: false })
})
