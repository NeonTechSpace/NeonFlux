import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { boardSourceId, type BoardCard } from "@neonflux/contracts/boards"
import { renderBoardCard, withBoardCount } from "../convex/boardsDomain.ts"
import { cleanupBoards } from "../convex/boardsStore.ts"
import { restoreBoard } from "../convex/boards.ts"
import { MEMBER_DATA_EXEMPT } from "../convex/memberData.ts"
import { defaultSettings } from "../convex/moderationDomain.ts"
import { convexBackend } from "./convex-backend.ts"
import { botCall } from "./bot-service.ts"
import { insertDocument } from "./schema-documents.ts"

const keys = ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_BOT_API_SECRET"] as const
const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]])),
    start = Date.parse("2026-10-01T12:00:00Z"),
    MINUTE = 60000,
    DAY = 86400000,
    SOURCE = "60",
    MESSAGE = "7001",
    AUTHOR = "70"
const modules = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")],
    ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
let clock = start
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    Object.assign(process.env, {
        NEONFLUX_SERVER_ID: "10",
        NEONFLUX_BOT_API_SECRET: "synthetic-boards-service-secret-000000000000000",
    })
    clock = start
    mock.method(Date, "now", () => clock)
    mock.timers.enable({ apis: ["setTimeout"] })
})
afterEach(() => {
    mock.restoreAll()
    mock.timers.reset()
    for (const key of keys)
        if (prior[key] === undefined) delete process.env[key]
        else process.env[key] = prior[key]
})
const actor = {
    originServerId: "10",
    userId: "20",
    roleIds: [],
    isOwner: true,
    isAdministrator: false,
    nativePermissionAuthorized: true,
}
const card = (fields: Partial<BoardCard> = {}): BoardCard => ({
    authorName: "Synthetic Author",
    text: "A fine message",
    link: `https://fluxer.app/channels/10/${SOURCE}/${MESSAGE}`,
    count: 3,
    roleIds: [],
    ...fields,
})
function fixture() {
    const t = convexBackend(modules)
    let sequence = 1000
    const call = async (path: string, body: unknown, expected = 200) => {
        const response = await botCall(t, path, body),
            result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result
    }
    const manage = (operation: unknown, expected = 200) =>
        call(
            "/boards/manage",
            {
                serverId: "10",
                originServerId: "10",
                messageId: String(++sequence),
                createdAt: clock,
                actor,
                managerAuthorized: true,
                operation,
            },
            expected,
        )
    const work = (operation: unknown, expected = 200) => call("/boards/work", { serverId: "10", operation }, expected)
    const context = (channelId = "50") => ({
        originServerId: "10",
        observedAt: clock,
        channelId,
        botId: "99",
        botAuthorized: true,
    })
    const observe = (fields: Record<string, unknown> = {}) =>
        work({
            type: "observe",
            name: "stars",
            channelId: SOURCE,
            messageId: MESSAGE,
            authorId: AUTHOR,
            sourceAt: clock - MINUTE,
            count: 3,
            ...fields,
        })
    const entries = () => t.run((ctx) => ctx.db.query("boardEntries").collect())
    /** Sends what a grant holds and records its outcome, as the bot's publisher does */
    const settle = async (
        grant: Record<string, unknown>,
        outcome: "sent" | "uncertain" | "failed",
        messageId?: string,
    ) => {
        const ids = {
            serverId: "10",
            postNo: grant.postNo,
            attemptId: grant.attemptId,
            generation: grant.generation,
            sourceId: grant.sourceId,
        }
        const claimToken = String(grant.generation).padEnd(32, "0")
        const claim = await call("/publishing/dispatch", { ...ids, claimToken, boardContext: context() })
        assert.equal(claim.claimed, true)
        await call("/publishing/outcome", { ...ids, claimToken, outcome, ...(messageId ? { messageId } : {}) })
    }
    const reserve = (fields: Partial<BoardCard> = {}) =>
        work({ type: "reserve", name: "stars", messageId: MESSAGE, context: context(), card: card(fields) })
    /** A board with one post standing on Fluxer */
    const posted = async () => {
        await manage({ type: "add", name: "stars", emoji: "⭐", channelId: "50", threshold: 3 })
        await observe()
        const { grant } = await reserve()
        await settle(grant, "sent", "8001")
        return grant
    }
    return { t, call, manage, work, context, observe, entries, settle, reserve, posted }
}
const defcon = (t: ReturnType<typeof convexBackend>, level: 1 | 2 | 3) =>
    t.run(async (ctx) => {
        const id = await insertDocument(ctx, "moderationSettings", "10")
        await ctx.db.patch(id, { config: { ...(await ctx.db.get(id))!.config, defcon: level } })
        return id
    })
const body = async (t: ReturnType<typeof convexBackend>) => {
    const posts = await t.run((ctx) => ctx.db.query("publishingAttempts").collect())
    return JSON.stringify(posts)
}

test("Boards start with their defaults, change from chat, and every change reaches the audit log", async () => {
    const f = fixture()
    const added = await f.manage({ type: "add", name: "stars", emoji: "⭐", channelId: "50", threshold: 3 })
    assert.deepEqual(added.boards[0], {
        name: "stars",
        emoji: "⭐",
        channelId: "50",
        threshold: 3,
        selfReactions: false,
        bots: false,
        ignoredChannelIds: [],
        posted: 0,
        createdAt: clock,
    })
    assert.equal(added.enabled, true)
    await f.manage({ type: "add", name: "stars", emoji: "🤡", channelId: "51", threshold: 2 }, 409)
    const changed = await f.manage({ type: "set", name: "stars", threshold: 5, selfReactions: true, bots: true })
    assert.deepEqual(
        [changed.boards[0].threshold, changed.boards[0].selfReactions, changed.boards[0].bots],
        [5, true, true],
    )
    const ignored = await f.manage({ type: "ignore", name: "stars", channelId: "61", ignored: true })
    assert.deepEqual(ignored.boards[0].ignoredChannelIds, ["61"])
    const back = await f.manage({ type: "ignore", name: "stars", channelId: "61", ignored: false })
    assert.deepEqual(back.boards[0].ignoredChannelIds, [])
    await f.manage({ type: "set", name: "other", threshold: 2 }, 404)
    assert.equal((await f.manage({ type: "module", enabled: false })).enabled, false)
    const audit = await f.t.run((ctx) => ctx.db.query("auditLogEntries").collect())
    assert.equal(audit.filter((row) => row.feature === "boards").length, 5)
})

test("A server has at most five boards", async () => {
    const f = fixture()
    for (const name of ["a", "b", "c", "d", "e"])
        await f.manage({ type: "add", name, emoji: "⭐", channelId: "50", threshold: 3 })
    await f.manage({ type: "add", name: "f", emoji: "⭐", channelId: "50", threshold: 3 }, 429)
})

test("A count below the threshold, a board's channel, an ignored channel and a ticket store nothing", async () => {
    const f = fixture()
    await f.manage({ type: "add", name: "stars", emoji: "⭐", channelId: "50", threshold: 3 })
    await f.manage({ type: "ignore", name: "stars", channelId: "61", ignored: true })
    await f.t.run((ctx) => insertDocument(ctx, "tickets", "10", { channelId: "62" }))
    assert.deepEqual(await f.observe({ count: 2 }), { type: "progress", recorded: false })
    for (const channelId of ["50", "61", "62"])
        assert.deepEqual(await f.observe({ channelId }), { type: "progress", recorded: false }, channelId)
    // A thread counts as its parent
    assert.deepEqual(await f.observe({ channelId: "63", parentChannelId: "61" }), {
        type: "progress",
        recorded: false,
    })
    assert.deepEqual(await f.observe({ channelId: "63", parentChannelId: "62" }), {
        type: "progress",
        recorded: false,
    })
    assert.deepEqual(await f.entries(), [])
    assert.deepEqual(await f.observe(), { type: "progress", recorded: true })
    assert.equal((await f.entries()).length, 1)
})

test("A queued post is reserved once with its card, and the record never holds the message's text", async () => {
    const f = fixture()
    await f.manage({ type: "add", name: "stars", emoji: "⭐", channelId: "50", threshold: 3 })
    await f.observe()
    const list = await f.work({ type: "list" })
    assert.deepEqual(list.deliveries, [{ name: "stars", channelId: "50", sourceChannelId: SOURCE, messageId: MESSAGE }])
    const { grant } = await f.reserve({ text: "Hi <@123> @everyone <#55>" })
    const row = (await f.t.run((ctx) => ctx.db.query("boards").first()))!
    assert.equal(grant.sourceId, boardSourceId(row._id, MESSAGE, 1))
    assert.equal(grant.action, "send")
    assert.ok(!grant.content.embed.description.includes("<@123>"))
    assert.ok(!grant.content.embed.description.includes("@everyone"))
    assert.ok(!JSON.stringify(await f.entries()).includes("Hi "))
    // A second reservation of the same message does nothing, so it cannot post twice
    assert.deepEqual(await f.reserve(), { type: "skipped" })
    assert.deepEqual((await f.work({ type: "list" })).deliveries, [])
    await f.settle(grant, "sent", "8001")
    const [entry] = await f.entries()
    assert.deepEqual(
        [entry?.state, entry?.postMessageId, entry?.postChannelId, entry?.expiresAt],
        ["sent", "8001", "50", undefined],
    )
    assert.equal((await f.call("/boards/query", { serverId: "10" })).boards[0].posted, 1)
})

test("Text a content rule catches is left out with a note, and the rest of the card still posts", async () => {
    const f = fixture()
    await f.manage({ type: "add", name: "stars", emoji: "⭐", channelId: "50", threshold: 3 })
    await f.t.run(async (ctx) => {
        await ctx.db.insert("moderationSettings", {
            serverId: "10",
            config: { ...defaultSettings(), automodEnabled: true },
            nextCaseNo: 1,
            nextAppealNo: 1,
        })
        await ctx.db.insert("automodRules", {
            serverId: "10",
            name: "blocked",
            rule: {
                name: "blocked",
                type: "words",
                enabled: true,
                priority: 0,
                action: "warn",
                threshold: 3,
                windowSeconds: 300,
                durationSeconds: 900,
                patterns: ["forbiddenword"],
                domainMode: "block",
                channelIds: [],
                exemptChannelIds: [],
                exemptRoleIds: ["77"],
            },
        })
    })
    await f.observe()
    const { grant } = await f.reserve({
        text: "this has forbiddenword inside",
        imageUrl: "https://cdn.example.test/a.png",
    })
    assert.match(grant.content.embed.description, /withheld/)
    assert.ok(!(await body(f.t)).includes("forbiddenword"))
    assert.equal(grant.content.embed.image.url, "https://cdn.example.test/a.png")
    // A role a rule exempts stays exempt
    await f.observe({ messageId: "7002" })
    const exempt = await f.work({
        type: "reserve",
        name: "stars",
        messageId: "7002",
        context: f.context(),
        card: card({ text: "this has forbiddenword inside", roleIds: ["77"] }),
    })
    assert.match(exempt.grant.content.embed.description, /forbiddenword/)
})

test("DEFCON below 3, publishing off and the module off hold new posts, which go out afterwards", async () => {
    const f = fixture()
    await f.manage({ type: "add", name: "stars", emoji: "⭐", channelId: "50", threshold: 3 })
    await f.observe()
    const hold = await defcon(f.t, 2)
    assert.deepEqual((await f.work({ type: "list" })).deliveries, [])
    assert.deepEqual(await f.reserve(), { type: "skipped" })
    await f.t.run((ctx) => ctx.db.delete(hold))
    await f.manage({ type: "module", enabled: false })
    assert.deepEqual((await f.work({ type: "list" })).deliveries, [])
    await f.manage({ type: "module", enabled: true })
    await f.t.run((ctx) => insertDocument(ctx, "publishingSettings", "10", { enabled: false }))
    assert.deepEqual((await f.work({ type: "list" })).deliveries, [])
    await f.t.run(async (ctx) => {
        const row = (await ctx.db.query("publishingSettings").first())!
        await ctx.db.patch(row._id, { enabled: true })
    })
    assert.equal((await f.work({ type: "list" })).deliveries.length, 1)
})

test("A claim made while the board stopped closes without a send, and the post waits for another try", async () => {
    const f = fixture()
    await f.manage({ type: "add", name: "stars", emoji: "⭐", channelId: "50", threshold: 3 })
    await f.observe()
    const { grant } = await f.reserve()
    await f.work({ type: "blocked", name: "stars", channelId: "50", reason: "permission" })
    const claim = await f.call("/publishing/dispatch", {
        serverId: "10",
        postNo: grant.postNo,
        attemptId: grant.attemptId,
        generation: grant.generation,
        sourceId: grant.sourceId,
        claimToken: "c".repeat(32),
        boardContext: f.context(),
    })
    assert.equal(claim.claimed, false)
    assert.deepEqual([(await f.entries())[0]?.state, (await f.entries())[0]?.postNo], ["queued", undefined])
    // The stopped board drops the wait, and a later reaction asks again once it works
    clock += MINUTE
    assert.deepEqual((await f.work({ type: "list" })).deliveries, [])
    assert.deepEqual(await f.entries(), [])
    await f.manage({ type: "set", name: "stars", channelId: "51" })
    assert.deepEqual(await f.observe(), { type: "progress", recorded: true })
})

test("An unknown outcome is never posted again, shows in recovery and blocks further count changes", async () => {
    const f = fixture()
    await f.manage({ type: "add", name: "stars", emoji: "⭐", channelId: "50", threshold: 3 })
    await f.observe()
    const { grant } = await f.reserve()
    await f.settle(grant, "uncertain")
    assert.equal((await f.entries())[0]?.state, "uncertain")
    assert.deepEqual((await f.work({ type: "list" })).deliveries, [])
    assert.deepEqual(await f.observe({ count: 9, context: f.context() }), { type: "progress", recorded: false })
    assert.match(JSON.stringify(await f.call("/recovery/list", { serverId: "10" })), /A board post/)
    const detail = await f.call("/boards/query", { serverId: "10", detail: "stars" })
    assert.deepEqual(detail.detail, { waiting: 0, uncertain: 1 })
    // Retention keeps a record whose outcome is still unknown
    clock += 31 * DAY
    await f.t.run((ctx) => cleanupBoards(ctx, clock))
    assert.equal((await f.entries()).length, 1)
})

test("A card's count changes at most once a minute, and only when it differs", async () => {
    const f = fixture()
    await f.posted()
    assert.deepEqual(await f.observe({ count: 4, context: f.context() }), { type: "progress", recorded: false })
    clock += MINUTE
    assert.deepEqual(await f.observe({ count: 3, context: f.context() }), { type: "progress", recorded: false })
    const { type, grant } = await f.observe({ count: 4, context: f.context() })
    assert.deepEqual([type, grant.action, grant.messageId], ["reserved", "edit", "8001"])
    assert.equal(grant.content.embed.fields[0].value, "⭐ 4")
    assert.equal(grant.expectedContent.embed.fields[0].value, "⭐ 3")
    await f.settle(grant, "sent", "8001")
    // Below the threshold a post stays, and its count still follows
    clock += MINUTE
    const lower = await f.observe({ count: 1, context: f.context() })
    assert.equal(lower.grant.content.embed.fields[0].value, "⭐ 1")
    await f.settle(lower.grant, "uncertain")
    // An unknown edit stops further updates, so nothing is sent on top of it
    clock += MINUTE
    assert.deepEqual(await f.observe({ count: 2, context: f.context() }), { type: "progress", recorded: false })
})

test("A failed count update stays out of the recovery inbox, while a failed post and an unknown count update show", async () => {
    const f = fixture()
    await f.posted()
    const inbox = async () => JSON.stringify(await f.call("/recovery/list", { serverId: "10" }))
    clock += MINUTE
    const failed = await f.observe({ count: 4, context: f.context() })
    await f.settle(failed.grant, "failed")
    assert.doesNotMatch(await inbox(), /A board post/)
    clock += MINUTE
    const unknown = await f.observe({ count: 5, context: f.context() })
    await f.settle(unknown.grant, "uncertain", "8001")
    assert.match(await inbox(), /A board post/)

    const other = fixture()
    await other.manage({ type: "add", name: "stars", emoji: "⭐", channelId: "50", threshold: 3 })
    await other.observe()
    const { grant } = await other.reserve()
    await other.settle(grant, "failed")
    assert.match(JSON.stringify(await other.call("/recovery/list", { serverId: "10" })), /A board post/)
})

test("A card in a board's old channel keeps its last count once the board moved", async () => {
    const f = fixture()
    await f.posted()
    await f.manage({ type: "set", name: "stars", channelId: "51" })
    clock += MINUTE
    assert.deepEqual(await f.observe({ count: 4, context: f.context("51") }), { type: "progress", recorded: false })
})

test("A deleted source message queues its post's removal once, which claims first and never repeats an unknown outcome", async () => {
    const f = fixture()
    await f.posted()
    assert.deepEqual(await f.work({ type: "source-gone", messageIds: [MESSAGE, "7999"] }), {
        type: "progress",
        recorded: true,
    })
    const [entry] = await f.entries()
    assert.deepEqual(
        [entry?.state, entry?.authorId, entry?.postMessageId, entry?.postNo],
        ["remove", undefined, "8001", undefined],
    )
    assert.ok(!(await body(f.t)).includes("A fine message"), "the card's text left with its tracked post")
    assert.equal((await f.call("/boards/query", { serverId: "10" })).boards[0].posted, 0)
    const { removals } = await f.work({ type: "list" })
    assert.deepEqual(removals, [{ entryId: entry!._id, channelId: "50", messageId: "8001" }])
    assert.deepEqual(await f.work({ type: "remove-claim", entryId: entry!._id }), { type: "progress", recorded: true })
    assert.deepEqual(await f.work({ type: "remove-claim", entryId: entry!._id }), { type: "progress", recorded: false })
    assert.deepEqual((await f.work({ type: "list" })).removals, [])
    // Without an outcome it stays claimed, shows in recovery and ends with retention
    clock += 2 * MINUTE
    assert.match(JSON.stringify(await f.call("/recovery/list", { serverId: "10" })), /may not have been removed/)
    assert.deepEqual((await f.work({ type: "list" })).removals, [])
    clock += 31 * DAY
    await f.t.run((ctx) => cleanupBoards(ctx, clock))
    assert.deepEqual(await f.entries(), [])
})

test("A removal that never left waits a minute and tries again, and one that ended leaves no record", async () => {
    const f = fixture()
    await f.posted()
    await f.work({ type: "source-gone", messageIds: [MESSAGE] })
    const id = (await f.entries())[0]!._id
    await f.work({ type: "remove-claim", entryId: id })
    await f.work({ type: "remove-outcome", entryId: id, outcome: "retry" })
    assert.deepEqual((await f.work({ type: "list" })).removals, [])
    clock += MINUTE
    assert.equal((await f.work({ type: "list" })).removals.length, 1)
    await f.work({ type: "remove-claim", entryId: id })
    await f.work({ type: "remove-outcome", entryId: id, outcome: "removed" })
    assert.deepEqual(await f.entries(), [])
})

test("A deleted channel queues its posts' removal, and its threads' through their parent, a page at a time", async () => {
    const f = fixture()
    await f.posted()
    await f.observe({ messageId: "7002", channelId: "61", parentChannelId: SOURCE })
    await f.observe({ messageId: "7003", channelId: "62" })
    const asThread = await f.work({ type: "source-channel-gone", channelId: "61", parent: false })
    assert.deepEqual(asThread, { type: "progress", recorded: true })
    assert.deepEqual(
        (await f.entries()).map((row) => row.sourceMessageId),
        [MESSAGE, "7003"],
    )
    await f.observe({ messageId: "7004", channelId: "61", parentChannelId: SOURCE })
    await f.work({ type: "source-channel-gone", channelId: SOURCE, parent: false })
    await f.work({ type: "source-channel-gone", channelId: SOURCE, parent: true })
    const rows = await f.entries()
    assert.deepEqual(
        rows.map((row) => [row.sourceMessageId, row.state]),
        [
            [MESSAGE, "remove"],
            ["7003", "queued"],
        ],
    )
})

test("A withdrawn post is queued for removal and takes its text with it", async () => {
    const f = fixture()
    await f.posted()
    assert.deepEqual(await f.work({ type: "withdraw", name: "stars", messageId: MESSAGE }), {
        type: "progress",
        recorded: true,
    })
    assert.equal((await f.entries())[0]?.state, "remove")
    assert.ok(!(await body(f.t)).includes("A fine message"))
    assert.deepEqual(await f.work({ type: "withdraw", name: "stars", messageId: "7999" }), {
        type: "progress",
        recorded: false,
    })
})

/** Runs what a mutation scheduled to run at once */
const scheduled = async (f: ReturnType<typeof fixture>) => {
    for (let round = 0; round < 4; round++) {
        mock.timers.tick(0)
        await f.t.finishInProgressScheduledFunctions()
        await new Promise((done) => setImmediate(done))
    }
}
const resolve = (f: ReturnType<typeof fixture>, grant: Record<string, unknown>, outcome: object) =>
    f.call("/publishing/manage", {
        serverId: "10",
        messageId: "9001",
        createdAt: clock,
        actor,
        operation: { type: "resolve", postNo: grant.postNo, expectedGeneration: grant.generation, ...outcome },
    })

test("A source deleted during an unknown send keeps its removal, which runs once staff settle the post as sent", async () => {
    const f = fixture()
    await f.manage({ type: "add", name: "stars", emoji: "⭐", channelId: "50", threshold: 3 })
    await f.observe()
    const { grant } = await f.reserve()
    await f.settle(grant, "uncertain")
    assert.deepEqual(await f.work({ type: "source-gone", messageIds: [MESSAGE] }), {
        type: "progress",
        recorded: false,
    })
    assert.deepEqual([(await f.entries())[0]?.state, (await f.entries())[0]?.removeWanted], ["uncertain", true])
    clock += 10 * MINUTE
    await resolve(f, grant, {
        outcome: "sent",
        messageId: "8001",
        channelId: "50",
        botId: "99",
        content: grant.canonicalContent,
    })
    await scheduled(f)
    const [entry] = await f.entries()
    assert.deepEqual([entry?.state, entry?.postMessageId, entry?.removeWanted], ["remove", "8001", undefined])
    assert.equal((await f.call("/boards/query", { serverId: "10" })).boards[0].posted, 0)
    assert.equal((await f.work({ type: "list" })).removals.length, 1)
})

test("A source deleted during an unknown send ends with the record when staff settle the post as never sent", async () => {
    const f = fixture()
    await f.manage({ type: "add", name: "stars", emoji: "⭐", channelId: "50", threshold: 3 })
    await f.observe()
    const { grant } = await f.reserve()
    await f.settle(grant, "uncertain")
    await f.work({ type: "source-gone", messageIds: [MESSAGE] })
    clock += 10 * MINUTE
    await resolve(f, grant, { outcome: "failed" })
    await scheduled(f)
    assert.deepEqual(await f.entries(), [])
})

test("A post read back after an unknown outcome stands as sent, keeps its record past retention and never posts twice", async () => {
    const f = fixture()
    await f.manage({ type: "add", name: "stars", emoji: "⭐", channelId: "50", threshold: 3 })
    await f.observe()
    const { grant } = await f.reserve()
    // The message's ID reached the backend, but the outcome stayed unknown
    await f.settle(grant, "uncertain", "8001")
    assert.equal((await f.entries())[0]?.state, "uncertain")
    clock += 10 * MINUTE
    await f.call("/publishing/reconcile", {
        serverId: "10",
        messageId: "9002",
        createdAt: clock,
        actor,
        postNo: grant.postNo,
        attemptId: grant.attemptId,
        expectedGeneration: grant.generation,
        observation: {
            observedAt: clock,
            messageId: "8001",
            channelId: "50",
            botId: "99",
            content: grant.canonicalContent,
        },
    })
    const [entry] = await f.entries()
    assert.deepEqual([entry?.state, entry?.postMessageId, entry?.expiresAt], ["sent", "8001", undefined])
    assert.equal((await f.call("/boards/query", { serverId: "10" })).boards[0].posted, 1)
    clock += 31 * DAY
    await f.t.run((ctx) => cleanupBoards(ctx, clock))
    assert.equal((await f.entries()).length, 1)
    assert.deepEqual(await f.observe(), { type: "progress", recorded: false })
    assert.equal((await f.entries()).length, 1)
})

test("Reading a post back twice counts it once, so a board's records are not evicted early", async () => {
    const f = fixture()
    await f.manage({ type: "add", name: "stars", emoji: "⭐", channelId: "50", threshold: 3 })
    await f.observe()
    const { grant } = await f.reserve()
    await f.settle(grant, "uncertain", "8001")
    for (const messageId of ["9101", "9102"]) {
        clock += 10 * MINUTE
        await f.call("/publishing/reconcile", {
            serverId: "10",
            messageId,
            createdAt: clock,
            actor,
            postNo: grant.postNo,
            attemptId: grant.attemptId,
            expectedGeneration: grant.generation,
            observation: {
                observedAt: clock,
                messageId: "8001",
                channelId: "50",
                botId: "99",
                content: grant.canonicalContent,
            },
        })
    }
    assert.equal((await f.call("/boards/query", { serverId: "10" })).boards[0].posted, 1)
})

test("A board stores its emoji without the selector Fluxer refuses, from chat and a restore, and a custom emoji as typed", async () => {
    const f = fixture()
    const added = await f.manage({ type: "add", name: "stars", emoji: "⭐\ufe0f", channelId: "50", threshold: 3 })
    assert.equal(added.boards[0].emoji, "⭐")
    const set = await f.manage({ type: "set", name: "stars", emoji: "❤\ufe0f" })
    assert.equal(set.boards[0].emoji, "❤")
    const custom = await f.manage({ type: "set", name: "stars", emoji: "<:party:123>" })
    assert.equal(custom.boards[0].emoji, "<:party:123>")
    await f.manage({ type: "add", name: "bare", emoji: "\ufe0f", channelId: "50", threshold: 3 }, 400)
    await f.t.run(async (ctx) => {
        await restoreBoard(
            ctx,
            { serverId: "10", actorId: "20", createdAt: clock, source: { kind: "chat", messageId: "1" } },
            {
                name: "kept",
                emoji: "⭐\ufe0f",
                channelId: "50",
                threshold: 3,
                selfReactions: false,
                bots: false,
                ignoredChannelIds: [],
            },
        )
    })
    const { boards } = await f.call("/boards/query", { serverId: "10" })
    assert.equal(boards.find((row: { name: string }) => row.name === "kept").emoji, "⭐")
})

test("A record's post channel reaches the bot's index, and a board's staff ID stays out of member data by a stated rule", async () => {
    const f = fixture()
    await f.posted()
    const { entries } = await f.work({ type: "index" })
    assert.deepEqual(entries, [{ name: "stars", messageId: MESSAGE, channelId: "50" }])
    assert.ok(MEMBER_DATA_EXEMPT.boards)
})

test("A removal asked for during an unknown count edit runs once the edit is read back", async () => {
    const f = fixture()
    await f.posted()
    clock += MINUTE
    const { grant } = await f.observe({ count: 4, context: f.context() })
    await f.settle(grant, "uncertain", "8001")
    await f.work({ type: "source-gone", messageIds: [MESSAGE] })
    assert.equal((await f.entries())[0]?.state, "sent")
    clock += 10 * MINUTE
    await f.call("/publishing/reconcile", {
        serverId: "10",
        messageId: "9003",
        createdAt: clock,
        actor,
        postNo: grant.postNo,
        attemptId: grant.attemptId,
        expectedGeneration: grant.generation,
        observation: {
            observedAt: clock,
            messageId: "8001",
            channelId: "50",
            botId: "99",
            content: grant.expectedContent,
        },
    })
    await scheduled(f)
    assert.equal((await f.entries())[0]?.state, "remove")
})

test("A deleted source without a post just ends, and a post still being sent is left to its outcome", async () => {
    const f = fixture()
    await f.manage({ type: "add", name: "stars", emoji: "⭐", channelId: "50", threshold: 3 })
    await f.observe()
    await f.work({ type: "source-gone", messageIds: [MESSAGE] })
    assert.deepEqual(await f.entries(), [])
    await f.observe()
    await f.reserve()
    assert.deepEqual(await f.work({ type: "source-gone", messageIds: [MESSAGE] }), {
        type: "progress",
        recorded: false,
    })
    assert.equal((await f.entries())[0]?.state, "reserved")
})

test("Member data shows a member's board posts, and delete queues their removal and keeps them from coming back", async () => {
    const f = fixture()
    await f.posted()
    const list = await f.call("/service/member-data/list", { userId: AUTHOR })
    assert.deepEqual(
        list.servers.flatMap((server: { features: { feature: string }[] }) =>
            server.features.map((row) => row.feature),
        ),
        ["Board posts of your messages"],
    )
    const exported = await f.call("/service/member-data/export", { userId: AUTHOR, serverId: "10", cursor: null })
    assert.equal(exported.records[0].data.postMessageId, "8001")
    const done = await f.call("/service/member-data/delete", {
        userId: AUTHOR,
        userName: "Synthetic member",
        serverId: "10",
        cursor: null,
    })
    assert.deepEqual(done.deleted, [{ feature: "Board posts of your messages", count: 1 }])
    const [entry] = await f.entries()
    assert.deepEqual([entry?.state, entry?.authorId], ["remove", undefined])
    assert.ok(!(await body(f.t)).includes("A fine message"))
    assert.equal((await f.t.run((ctx) => ctx.db.query("workSignal").first()))?.version, 1)
    assert.deepEqual((await f.call("/service/member-data/list", { userId: AUTHOR })).servers, [])
    // A message sent before the deletion is not reposted, even once its record is gone. A later one is
    const id = entry!._id
    await f.work({ type: "remove-claim", entryId: id })
    await f.work({ type: "remove-outcome", entryId: id, outcome: "removed" })
    clock += MINUTE
    assert.deepEqual(await f.observe({ sourceAt: clock - 2 * MINUTE }), { type: "progress", recorded: false })
    assert.deepEqual(await f.entries(), [])
    assert.deepEqual(await f.observe({ messageId: "7002", sourceAt: clock }), { type: "progress", recorded: true })
})

test("Member data keeps a post whose outcome is unknown until staff settle it", async () => {
    const f = fixture()
    await f.manage({ type: "add", name: "stars", emoji: "⭐", channelId: "50", threshold: 3 })
    await f.observe()
    const { grant } = await f.reserve()
    await f.settle(grant, "uncertain")
    const done = await f.call("/service/member-data/delete", {
        userId: AUTHOR,
        userName: "Synthetic member",
        serverId: "10",
        cursor: null,
    })
    assert.deepEqual(done.deleted, [])
    assert.equal(done.kept[0].feature, "Board posts of your messages")
})

test("Removing a board ends its records at the next retention run and leaves removals running", async () => {
    const f = fixture()
    await f.posted()
    await f.observe({ messageId: "7002", count: 3 })
    const second = await f.reserve.call(undefined)
    assert.deepEqual(second, { type: "skipped" })
    await f.manage({ type: "remove", name: "stars" })
    assert.deepEqual((await f.call("/boards/query", { serverId: "10" })).boards, [])
    await f.t.run((ctx) => cleanupBoards(ctx, clock))
    // The posted record ended with its tracked post. The queued one waits for its own expiry, and the worker drops it first
    assert.equal((await f.entries()).filter((row) => row.state === "sent").length, 0)
    assert.deepEqual((await f.work({ type: "list" })).deliveries, [])
    assert.deepEqual(await f.entries(), [])
    assert.deepEqual(await f.t.run((ctx) => ctx.db.query("publishingPosts").collect()), [])
})

test("Records without a post end after 30 days, and a standing post has no end while its board exists", async () => {
    const f = fixture()
    await f.posted()
    await f.observe({ messageId: "7002" })
    clock += 31 * DAY
    await f.t.run((ctx) => cleanupBoards(ctx, clock))
    assert.deepEqual(
        (await f.entries()).map((row) => row.sourceMessageId),
        [MESSAGE],
    )
})

test("A full board forgets its oldest record, whose post stays on Fluxer", async () => {
    const f = fixture()
    await f.posted()
    await f.t.run(async (ctx) => {
        const board = (await ctx.db.query("boards").first())!
        await ctx.db.patch(board._id, { posted: 1000 })
    })
    await f.observe({ messageId: "7002" })
    clock += MINUTE
    const { grant } = await f.work({
        type: "reserve",
        name: "stars",
        messageId: "7002",
        context: f.context(),
        card: card(),
    })
    await f.settle(grant, "sent", "8002")
    assert.deepEqual(
        (await f.entries()).map((row) => row.sourceMessageId),
        ["7002"],
    )
    assert.equal((await f.call("/boards/query", { serverId: "10" })).boards[0].posted, 1000)
})

test("The index names each record's board, and another server's records stay apart", async () => {
    const f = fixture()
    await f.posted()
    await f.t.run(async (ctx) => {
        await ctx.db.insert("boards", {
            serverId: "20",
            name: "other",
            emoji: "⭐",
            channelId: "50",
            threshold: 3,
            selfReactions: false,
            bots: false,
            ignoredChannelIds: [],
            posted: 0,
            createdAt: clock,
            updatedAt: clock,
            updatedBy: "20",
        })
        const board = await ctx.db
            .query("boards")
            .withIndex("by_server", (q) => q.eq("serverId", "20"))
            .first()
        await ctx.db.insert("boardEntries", {
            serverId: "20",
            boardId: board!._id,
            sourceChannelId: SOURCE,
            sourceMessageId: "7555",
            authorId: AUTHOR,
            count: 3,
            state: "queued",
            nextCheckAt: clock,
            createdAt: clock,
        })
    })
    const { entries } = await f.work({ type: "index" })
    assert.deepEqual(entries, [{ name: "stars", messageId: MESSAGE, channelId: "50" }])
})

test("A card shows the author, the cut text, the image, the link and the count, and a new count replaces only the count", () => {
    const content = renderBoardCard(
        card({ authorName: "<@1> Name", text: "x".repeat(3000), imageUrl: "https://cdn.example.test/a.png" }),
        "⭐",
        false,
    )
    const embed = content.embed!
    assert.equal(embed.author!.name, "<​@1> Name")
    assert.equal(embed.description!.length, 2000)
    assert.ok(embed.description!.endsWith("…"))
    assert.equal(embed.image!.url, "https://cdn.example.test/a.png")
    assert.deepEqual(embed.fields, [
        { name: "Reactions", value: "⭐ 3", inline: true },
        { name: "Original", value: `[Jump to the message](${card().link})`, inline: true },
    ])
    const next = withBoardCount(content, "⭐", 12)!
    assert.equal(next.embed!.fields![0]!.value, "⭐ 12")
    assert.deepEqual(next.embed!.fields![1], embed.fields![1])
    assert.equal(withBoardCount({ content: "" }, "⭐", 2), undefined)
    assert.equal(renderBoardCard(card({ text: "" }), "⭐", false).embed!.description, undefined)
})
