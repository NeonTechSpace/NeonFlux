import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { GIVEAWAY_RUNNING, GIVEAWAY_WINNERS_STORED, giveawayCard } from "@neonflux/contracts/giveaways"
import { api } from "../convex/_generated/api.js"
import { cleanupGiveaways } from "../convex/giveawaysStore.ts"
import { defaultSettings } from "../convex/moderationDomain.ts"
import { dueWork } from "../convex/workDispatch.ts"
import { botCall } from "./bot-service.ts"
import { convexBackend } from "./convex-backend.ts"

const prior = { ...process.env },
    start = Date.parse("2026-01-01T00:00:00Z"),
    DAY = 86400000
let now = start
const keys = ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_BOT_API_SECRET", "FLUXER_CLIENT_ID"]
beforeEach(() => {
    now = start
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(Date, "now", () => now)
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.FLUXER_CLIENT_ID = "30"
    process.env.NEONFLUX_BOT_API_SECRET = "synthetic-giveaway-test-secret-not-a-credential"
    delete process.env.NEONFLUX_SERVER_MODE
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === "https://fluxer.app/.well-known/fluxer")
            return Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
        if (url.endsWith("/v1/oauth2/@me"))
            return Response.json({
                application: { id: "30" },
                scopes: ["identify", "guilds"],
                user: { id: "99", username: "Manager", bot: false, system: false },
            })
        if (url.endsWith("/v1/users/@me/guilds?limit=100"))
            return Response.json([{ id: "10", name: "Synthetic server", owner_id: "99", permissions: "32" }])
        throw new Error("Unexpected synthetic provider request")
    })
})
afterEach(() => {
    mock.restoreAll()
    mock.timers.reset()
    for (const key of keys)
        if (prior[key] === undefined) delete process.env[key]
        else process.env[key] = prior[key]
})
const modules = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")],
    ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const manager = {
    originServerId: "10",
    userId: "99",
    roleIds: [],
    isOwner: true,
    isAdministrator: false,
    nativePermissionAuthorized: true,
}
const CHANNEL = "50",
    CARD = "700",
    BOT = "900"
const context = () => ({ originServerId: "10", observedAt: now, channelId: CHANNEL, botId: BOT, botAuthorized: true })
const startOp = (fields: object = {}) => ({
    type: "start",
    lengthSeconds: 3600,
    winners: 2,
    channelId: CHANNEL,
    prize: "Game key",
    ...fields,
})

function fixture() {
    const t = convexBackend(modules)
    let sequence = 1000
    const post = async (path: string, body: unknown, expected = 200) => {
        const response = await botCall(t, path, body),
            result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result
    }
    const manage = (operation: unknown, who = manager, expected = 200) =>
        post(
            "/giveaways/manage",
            {
                serverId: "10",
                originServerId: "10",
                messageId: String(++sequence),
                createdAt: now,
                actor: who,
                operation,
            },
            expected,
        )
    const work = (operation: unknown, expected = 200) =>
        post("/giveaways/work", { serverId: "10", operation }, expected)
    const show = async (giveawayNo = 1) => (await post("/giveaways/query", { serverId: "10", giveawayNo })).giveaways[0]
    const list = async () => (await work({ type: "list" })).items
    const dispatch = () => t.run((ctx) => dueWork(ctx as never, now, null))
    const setModeration = (patch: Record<string, unknown>) =>
        t.run(async (ctx) => {
            const row = await ctx.db.query("moderationSettings").first()
            if (row) await ctx.db.patch(row._id, { config: { ...row.config, ...patch } })
            else
                await ctx.db.insert("moderationSettings", {
                    serverId: "10",
                    config: { ...defaultSettings(), ...patch },
                    nextCaseNo: 1,
                    nextAppealNo: 1,
                } as never)
        })
    const reserve = (giveawayNo = 1) => work({ type: "reserve", giveawayNo, context: context() })
    /** The publisher's claim and outcome of a reserved card */
    const settle = async (grant: Record<string, unknown>, outcome: "sent" | "uncertain" | "failed" = "sent") => {
        const base = {
            serverId: "10",
            postNo: grant.postNo,
            attemptId: grant.attemptId,
            generation: grant.generation,
            sourceId: grant.sourceId,
            claimToken: "a".repeat(32),
        }
        const claim = await post("/publishing/dispatch", { ...base, giveawayContext: context() })
        assert.equal(claim.claimed, true)
        await post("/publishing/outcome", {
            ...base,
            outcome,
            ...(outcome === "sent" ? { messageId: CARD } : {}),
        })
    }
    /** A giveaway with its card posted, which comes due after an hour */
    const running = async (fields: object = {}) => {
        const { giveaway } = await manage(startOp(fields))
        const { grant } = await reserve(giveaway.giveawayNo)
        await settle(grant)
        return giveaway.giveawayNo as number
    }
    const drawn = async (giveawayNo: number, winnerIds: string[]) => {
        now += 3600000
        const claim = await work({ type: "draw-claim", giveawayNo })
        assert.equal(claim.type, "draw")
        await work({ type: "draw-record", giveawayNo, winnerIds, entrants: winnerIds.length, capped: false })
        const announce = await work({ type: "announce-claim", giveawayNo })
        await work({
            type: "announce-outcome",
            giveawayNo,
            card: "sent",
            dms: announce.winnerIds.map((userId: string) => ({ userId, outcome: "sent" })),
        })
    }
    return { t, post, manage, work, show, list, dispatch, setModeration, reserve, settle, running, drawn }
}

test("Settings and every action need a manager, and each change reaches the audit log", async () => {
    const f = fixture()
    const member = { ...manager, userId: "21", isOwner: false, nativePermissionAuthorized: false }
    await f.manage(startOp(), member, 403)
    await f.manage({ type: "settings", patch: { enabled: false } }, member, 403)
    assert.deepEqual(await f.manage({ type: "settings", patch: { requiredRoleId: "77" } }), {
        type: "settings",
        settings: { enabled: true, requiredRoleId: "77" },
    })
    const no = await f.running()
    await f.manage({ type: "end", giveawayNo: no })
    const second = await f.running()
    await f.manage({ type: "cancel", giveawayNo: second })
    const entries = await f.t.run((ctx) => ctx.db.query("auditLogEntries").collect())
    assert.deepEqual(
        entries.map((row) => [row.feature, row.setting]),
        [
            ["giveaways", "settings"],
            ["giveaways", "start 50"],
            ["giveaways", "end 1"],
            ["giveaways", "start 50"],
            ["giveaways", "cancel 2"],
        ],
    )
    assert.match(entries[1]!.summary, /giveaways: added 1/)
})

test("The audit log keeps winners and hosts out, also when a new giveaway moves an old one off the dashboard's list", async () => {
    const f = fixture()
    const no = await f.running()
    await f.drawn(no, ["7100000", "7200000"])
    await f.manage({ type: "reroll", giveawayNo: no, count: 1 })
    await f.work({ type: "draw-claim", giveawayNo: no })
    await f.work({ type: "draw-record", giveawayNo: no, winnerIds: [], entrants: 0, capped: false })
    await f.work({ type: "announce-claim", giveawayNo: no })
    await f.work({ type: "announce-outcome", giveawayNo: no, card: "sent", dms: [] })
    // Numbers 2 to 26 fill the view of 25, and starting number 26 leaves number 1 out of it
    for (let i = 0; i < GIVEAWAY_RUNNING; i++) await f.manage(startOp())
    const [entries, changes] = await f.t.run(async (ctx) => [
        await ctx.db.query("auditLogEntries").collect(),
        await ctx.db.query("auditLogChanges").collect(),
    ])
    const text = JSON.stringify([entries, changes])
    assert.equal(text.includes("7100000"), false)
    assert.equal(text.includes("7200000"), false)
    assert.equal(/removed/.test(text), false)
    assert.match(entries.at(-1)!.summary as string, /giveaways: added 26/)
    assert.match(JSON.stringify(changes.at(-1)), /Game key/)
    assert.equal(JSON.stringify(changes.at(-1)).includes("hostId"), false)
})

test("A start is refused with its cause while its card could not go out", async () => {
    const f = fixture()
    await f.setModeration({ defcon: 2 })
    const held = await f.manage(startOp(), manager, 409)
    assert.match(held.reason ?? held.error, /DEFCON is below 3/)
    await f.setModeration({ defcon: 3 })
    await f.t.run(async (ctx) => {
        await ctx.db.insert("publishingSettings", { serverId: "10", enabled: false, nextPostNo: 1 })
    })
    const off = await f.manage(startOp(), manager, 409)
    assert.match(off.reason ?? off.error, /Publishing is off here/)
    assert.equal(await f.show(), undefined)
})

test("Bounds hold: Length, winners, prize, running limit and the module switch", async () => {
    const f = fixture()
    for (const fields of [
        { lengthSeconds: 59 },
        { lengthSeconds: 5184001 },
        { winners: 0 },
        { winners: 21 },
        { prize: "" },
        { prize: "x".repeat(257) },
        { prize: "two\nlines" },
    ])
        await f.manage(startOp(fields), manager, 400)
    assert.equal(
        (await f.manage(startOp({ lengthSeconds: 5184000, winners: 20, prize: "x".repeat(256) }))).type,
        "giveaway",
    )
    for (let i = 1; i < GIVEAWAY_RUNNING; i++) await f.manage(startOp())
    const refused = await f.manage(startOp(), manager, 429)
    assert.match(refused.reason ?? refused.error, /already runs 25/)
    await f.manage({ type: "settings", patch: { enabled: false } })
    const off = await f.manage(startOp(), manager, 409)
    assert.match(off.reason ?? off.error, /Giveaways are off/)
})

test("A prize is checked against the content rules", async () => {
    const f = fixture()
    await f.setModeration({ automodEnabled: true })
    await f.t.run(async (ctx) => {
        await ctx.db.insert("automodRules", {
            serverId: "10",
            name: "words",
            rule: {
                name: "words",
                type: "words",
                enabled: true,
                priority: 1,
                action: "delete",
                threshold: 1,
                windowSeconds: 10,
                durationSeconds: 60,
                patterns: ["free"],
                domainMode: "block",
                channelIds: [],
                exemptChannelIds: [],
                exemptRoleIds: [],
            },
        } as never)
    })
    const blocked = await f.manage(startOp({ prize: "free nitro" }), manager, 409)
    assert.match(blocked.reason ?? blocked.error, /automod rule words blocks this prize/)
    assert.equal((await f.manage(startOp())).type, "giveaway")
})

test("A card goes through the publisher once, and only then does the giveaway wait for its end", async () => {
    const f = fixture()
    const { giveaway } = await f.manage(startOp())
    assert.equal(giveaway.phase, "post")
    assert.deepEqual(await f.list(), [{ giveawayNo: 1, channelId: CHANNEL, action: "post" }])
    assert.deepEqual((await f.dispatch()).kinds.giveaways, ["10"])
    const { grant } = await f.reserve()
    assert.deepEqual(grant.consumer, { type: "giveaway", giveawayNo: 1 })
    assert.equal(grant.sourceId, "giveaway_1")
    assert.match(grant.content.content, /\*\*Giveaway #1: Game key\*\*/)
    assert.match(grant.content.content, /React with \u{1F389} to enter/u)
    assert.match(grant.content.content, /Hosted by <@99>/)
    assert.match(grant.content.content, new RegExp(`<t:${(start + 3600000) / 1000}:f>`))
    // A second reserve hands out nothing
    assert.deepEqual(await f.reserve(), { type: "skipped" })
    assert.deepEqual(await f.list(), [])
    await f.settle(grant)
    const posted = await f.show()
    assert.deepEqual([posted.phase, posted.messageId, posted.postNo], ["wait", CARD, grant.postNo])
    // Nothing is due until its end, which is only a next due time
    const work = await f.dispatch()
    assert.deepEqual(work.kinds.giveaways, [])
    assert.equal(work.nextDueIn, 3600000)
    now += 3600000
    assert.deepEqual(await f.list(), [{ giveawayNo: 1, channelId: CHANNEL, action: "draw" }])
})

test("An unknown post outcome is never reposted, holds the giveaway and goes on once staff settle it", async () => {
    const f = fixture()
    await f.manage(startOp())
    const { grant } = await f.reserve()
    await f.settle(grant, "uncertain")
    const held = await f.show()
    assert.deepEqual([held.phase, held.problem], ["blocked", "post-uncertain"])
    now += 7200000
    assert.deepEqual(await f.list(), [])
    assert.deepEqual((await f.dispatch()).kinds.giveaways, [])
    const inbox = await f.post("/recovery/list", { serverId: "10" })
    assert.ok(
        inbox.entries.some((entry: { summary?: string }) =>
            entry.summary?.startsWith("Card of giveaway #1 for Game key"),
        ),
    )
    // Staff record that it was sent. The end time passed, so the draw is due at once
    const resolved = await f.post("/publishing/manage", {
        serverId: "10",
        messageId: "4001",
        createdAt: now,
        actor: { ...manager, isOwner: true },
        operation: {
            type: "resolve",
            postNo: grant.postNo,
            expectedGeneration: grant.generation,
            outcome: "sent",
            messageId: CARD,
            channelId: CHANNEL,
            botId: BOT,
            content: grant.content,
        },
    })
    assert.equal(resolved.type, "resolved")
    const settled = await f.show()
    assert.deepEqual([settled.phase, settled.messageId, settled.problem], ["wait", CARD, undefined])
    assert.deepEqual(await f.list(), [{ giveawayNo: 1, channelId: CHANNEL, action: "draw" }])
})

test("A card read back after an unknown outcome lets its giveaway go on", async () => {
    const f = fixture()
    await f.manage(startOp())
    const { grant } = await f.reserve()
    const base = {
        serverId: "10",
        postNo: grant.postNo,
        attemptId: grant.attemptId,
        generation: grant.generation,
        sourceId: grant.sourceId,
        claimToken: "a".repeat(32),
    }
    await f.post("/publishing/dispatch", { ...base, giveawayContext: context() })
    await f.post("/publishing/outcome", { ...base, outcome: "uncertain", messageId: CARD })
    assert.equal((await f.show()).phase, "blocked")
    now += 600000
    const { claimToken: _claimToken, sourceId: _sourceId, generation, ...bound } = base
    await f.post("/publishing/reconcile", {
        ...bound,
        expectedGeneration: generation,
        messageId: "4002",
        createdAt: now,
        actor: manager,
        observation: {
            observedAt: now,
            messageId: CARD,
            channelId: CHANNEL,
            botId: BOT,
            content: grant.canonicalContent,
        },
    })
    const settled = await f.show()
    assert.deepEqual([settled.phase, settled.messageId, settled.problem], ["wait", CARD, undefined])
})

test("A card that never reached Fluxer is tried again, and a refused one ends the giveaway with a problem", async () => {
    const f = fixture()
    await f.manage(startOp())
    const first = await f.reserve()
    // The bot gave up before its claim, so nothing was sent
    await f.post("/publishing/outcome", {
        serverId: "10",
        postNo: first.grant.postNo,
        attemptId: first.grant.attemptId,
        generation: first.grant.generation,
        sourceId: first.grant.sourceId,
        outcome: "failed",
    })
    assert.equal((await f.show()).phase, "post")
    assert.deepEqual(await f.list(), [])
    now += 60000
    assert.equal((await f.list()).length, 1)
    const { grant } = await f.reserve()
    await f.settle(grant, "failed")
    const ended = await f.show()
    assert.deepEqual([ended.state, ended.phase, ended.problem], ["ended", "done", "post-failed"])
    const inbox = await f.post("/recovery/list", { serverId: "10" })
    assert.ok(inbox.entries.some((entry: { summary?: string }) => entry.summary?.includes("Fluxer refused its card")))
})

test("A retry past the giveaway's end posts nothing and ends it with a problem staff can read", async () => {
    const f = fixture()
    await f.manage(startOp())
    const { grant } = await f.reserve()
    await f.post("/publishing/outcome", {
        serverId: "10",
        postNo: grant.postNo,
        attemptId: grant.attemptId,
        generation: grant.generation,
        sourceId: grant.sourceId,
        outcome: "failed",
    })
    now += 3600000
    assert.deepEqual((await f.dispatch()).kinds.giveaways, ["10"])
    assert.deepEqual(await f.list(), [])
    const ended = await f.show()
    assert.deepEqual([ended.state, ended.phase, ended.problem, ended.endedAt], ["ended", "done", "post-late", now])
    assert.equal(await f.t.run(async (ctx) => (await ctx.db.query("publishingAttempts").collect()).length), 0)
    assert.deepEqual((await f.dispatch()).kinds.giveaways, [])
    assert.deepEqual(await f.reserve(), { type: "skipped" })
    const inbox = await f.post("/recovery/list", { serverId: "10" })
    assert.ok(inbox.entries.some((entry: { summary?: string }) => entry.summary?.includes("ended unposted")))
})

test("A reserve past the giveaway's end makes no attempt", async () => {
    const f = fixture()
    await f.manage(startOp())
    now += 3600000
    assert.deepEqual(await f.reserve(), { type: "skipped" })
    assert.equal((await f.show()).problem, "post-late")
    assert.equal(await f.t.run(async (ctx) => (await ctx.db.query("publishingPosts").collect()).length), 0)
})

test("A card held past its end by DEFCON ends unposted at any level, and cannot be drawn", async () => {
    const f = fixture()
    await f.manage(startOp())
    await f.setModeration({ defcon: 2 })
    assert.deepEqual((await f.dispatch()).kinds.giveaways, [])
    now += 3600000
    assert.deepEqual((await f.dispatch()).kinds.giveaways, ["10"])
    assert.deepEqual(await f.list(), [])
    assert.equal((await f.show()).problem, "post-late")
    assert.deepEqual(await f.work({ type: "draw-claim", giveawayNo: 1 }), { type: "skipped" })
})

test("A claim after the giveaway's end sends nothing, even with a live grant", async () => {
    const f = fixture()
    await f.manage(startOp({ lengthSeconds: 60 }))
    const { grant } = await f.reserve()
    now += 61000
    const claim = await f.post("/publishing/dispatch", {
        serverId: "10",
        postNo: grant.postNo,
        attemptId: grant.attemptId,
        generation: grant.generation,
        sourceId: grant.sourceId,
        claimToken: "a".repeat(32),
        giveawayContext: context(),
    })
    assert.equal(claim.claimed, false)
    assert.deepEqual(await f.list(), [])
    assert.equal((await f.show()).problem, "post-late")
})

test("A channel that is gone ends the giveaway with a problem shown in recovery", async () => {
    const f = fixture()
    await f.manage(startOp())
    assert.deepEqual(await f.work({ type: "blocked", giveawayNo: 1, channelId: "51", reason: "channel" }), {
        type: "progress",
        recorded: false,
    })
    await f.work({ type: "blocked", giveawayNo: 1, channelId: CHANNEL, reason: "channel" })
    const ended = await f.show()
    assert.deepEqual([ended.state, ended.problem], ["ended", "channel"])
    const inbox = await f.post("/recovery/list", { serverId: "10" })
    assert.ok(inbox.entries.some((entry: { summary?: string }) => entry.summary?.includes("Giveaway #1 ended")))
})

test("A channel NeonFlux cannot post in ends a giveaway that never started, and promises no retry", async () => {
    const f = fixture()
    await f.manage(startOp())
    await f.work({ type: "blocked", giveawayNo: 1, channelId: CHANNEL, reason: "permission" })
    const ended = await f.show()
    assert.deepEqual([ended.state, ended.phase, ended.problem], ["ended", "done", "post-failed"])
    assert.deepEqual(await f.list(), [])
    const inbox = await f.post("/recovery/list", { serverId: "10" })
    const entry = inbox.entries.find((row: { summary?: string }) => row.summary?.includes("Giveaway #1"))
    assert.match(entry.next, /start it again/)
    assert.doesNotMatch(entry.next, /tries again/)
})

test("The draw is claimed once and winners are recorded once, even for a repeated report", async () => {
    const f = fixture()
    const no = await f.running()
    assert.deepEqual(await f.work({ type: "draw-claim", giveawayNo: no }), { type: "skipped" })
    now += 3600000
    const claim = await f.work({ type: "draw-claim", giveawayNo: no })
    assert.deepEqual([claim.type, claim.count, claim.excludeIds], ["draw", 2, []])
    assert.deepEqual(await f.work({ type: "draw-claim", giveawayNo: no }), { type: "skipped" })
    const record = { type: "draw-record", giveawayNo: no, winnerIds: ["71", "72"], entrants: 2, capped: false }
    assert.deepEqual(await f.work(record), { type: "progress", recorded: true })
    assert.deepEqual(await f.work(record), { type: "progress", recorded: false })
    const shown = await f.show(no)
    assert.deepEqual(
        [shown.state, shown.phase, shown.winners.map((w: { userId: string }) => w.userId)],
        ["ended", "announce", ["71", "72"]],
    )
})

test("A draw whose bot stopped is free again after its claim runs out, and nothing was recorded", async () => {
    const f = fixture()
    const no = await f.running()
    now += 3600000
    await f.work({ type: "draw-claim", giveawayNo: no })
    assert.deepEqual(await f.list(), [])
    now += 300000
    assert.deepEqual(await f.list(), [{ giveawayNo: no, channelId: CHANNEL, action: "draw" }])
    assert.equal((await f.work({ type: "draw-claim", giveawayNo: no })).type, "draw")
})

test("The edit is claimed once, a failed DM stops nothing, and a claim that never reported stays uncertain", async () => {
    const f = fixture()
    const no = await f.running()
    now += 3600000
    await f.work({ type: "draw-claim", giveawayNo: no })
    await f.work({ type: "draw-record", giveawayNo: no, winnerIds: ["71", "72"], entrants: 2, capped: true })
    assert.deepEqual(await f.list(), [{ giveawayNo: no, channelId: CHANNEL, action: "announce" }])
    const claim = await f.work({ type: "announce-claim", giveawayNo: no })
    assert.deepEqual(claim.winnerIds, ["71", "72"])
    assert.deepEqual(await f.work({ type: "announce-claim", giveawayNo: no }), { type: "skipped" })
    await f.work({
        type: "announce-outcome",
        giveawayNo: no,
        card: "sent",
        dms: [
            { userId: "71", outcome: "sent" },
            { userId: "72", outcome: "failed" },
        ],
    })
    const done = await f.show(no)
    assert.deepEqual(
        [done.phase, done.problem, done.capped, done.winners.map((w: { dm: string }) => w.dm)],
        ["done", undefined, true, ["sent", "failed"]],
    )
    assert.match(giveawayCard(done), /Only the first 5,000 entries by account age were read/)
    // The same story when the bot stops after its claim: The card's edit and the DM stay uncertain and are never repeated
    const other = await f.running()
    now += 3600000
    await f.work({ type: "draw-claim", giveawayNo: other })
    await f.work({ type: "draw-record", giveawayNo: other, winnerIds: ["73"], entrants: 1, capped: false })
    await f.work({ type: "announce-claim", giveawayNo: other })
    now += 300000
    assert.deepEqual(await f.list(), [])
    const lost = await f.show(other)
    assert.deepEqual([lost.phase, lost.problem, lost.winners[0].dm], ["done", "result-uncertain", "uncertain"])
    // Reading the card settles the edit without sending it again
    await f.work({ type: "confirm", giveawayNo: other })
    assert.equal((await f.show(other)).problem, undefined)
})

test("A reroll draws new winners, excludes earlier ones and keeps both on the card", async () => {
    const f = fixture()
    const no = await f.running()
    // A reroll needs a finished draw
    await f.manage({ type: "reroll", giveawayNo: no }, manager, 409)
    await f.drawn(no, ["71", "72"])
    await f.manage({ type: "reroll", giveawayNo: no, count: 1 })
    const claim = await f.work({ type: "draw-claim", giveawayNo: no })
    assert.deepEqual([claim.count, claim.excludeIds], [1, ["71", "72"]])
    await f.work({ type: "draw-record", giveawayNo: no, winnerIds: ["73"], entrants: 3, capped: false })
    const announce = await f.work({ type: "announce-claim", giveawayNo: no })
    assert.deepEqual(announce.winnerIds, ["73"])
    const card = giveawayCard(announce.giveaway)
    assert.match(card, /Winners: <@71>, <@72>/)
    assert.match(card, /Rerolled: <@73>/)
    await f.work({ type: "announce-outcome", giveawayNo: no, card: "sent", dms: [{ userId: "73", outcome: "sent" }] })
    assert.equal((await f.show(no)).state, "ended")
    // A giveaway stops at the stored limit
    await f.t.run(async (ctx) => {
        for (let i = 0; i < GIVEAWAY_WINNERS_STORED - 3; i++)
            await ctx.db.insert("giveawayWinners", {
                serverId: "10",
                giveawayNo: no,
                userId: String(100 + i),
                drawNo: 1,
                dm: "sent",
                createdAt: now,
            })
    })
    await f.manage({ type: "reroll", giveawayNo: no, count: 1 }, manager, 429)
})

test("Cancel edits the card, and a cancelled giveaway draws nothing", async () => {
    const f = fixture()
    const no = await f.running()
    await f.manage({ type: "cancel", giveawayNo: no })
    now += 3600000
    assert.deepEqual(await f.list(), [{ giveawayNo: no, channelId: CHANNEL, action: "cancel" }])
    assert.deepEqual(await f.work({ type: "draw-claim", giveawayNo: no }), { type: "skipped" })
    const claim = await f.work({ type: "cancel-claim", giveawayNo: no })
    assert.match(giveawayCard(claim.giveaway), /cancelled: Game key/)
    await f.work({ type: "cancel-outcome", giveawayNo: no, card: "sent" })
    const done = await f.show(no)
    assert.deepEqual([done.state, done.phase], ["cancelled", "done"])
    await f.manage({ type: "cancel", giveawayNo: no }, manager, 409)
    await f.manage({ type: "end", giveawayNo: no }, manager, 409)
    // A giveaway cancelled before its card went out has nothing to edit
    await f.manage(startOp())
    await f.manage({ type: "cancel", giveawayNo: no + 1 })
    assert.equal((await f.show(no + 1)).phase, "done")
    // A card still on its way is edited once its post is known
    await f.manage(startOp())
    const { grant } = await f.reserve(no + 2)
    await f.manage({ type: "cancel", giveawayNo: no + 2 })
    await f.post("/publishing/outcome", {
        serverId: "10",
        postNo: grant.postNo,
        attemptId: grant.attemptId,
        generation: grant.generation,
        sourceId: grant.sourceId,
        outcome: "failed",
    })
    assert.equal((await f.show(no + 2)).phase, "done")
})

test("A deleted card ends the giveaway with a problem, and a reroll refuses", async () => {
    const f = fixture()
    const no = await f.running()
    now += 3600000
    await f.work({ type: "draw-claim", giveawayNo: no })
    await f.work({ type: "draw-gone", giveawayNo: no, reason: "card" })
    const ended = await f.show(no)
    assert.deepEqual([ended.state, ended.phase, ended.problem, ended.winners], ["ended", "done", "card", []])
    await f.manage({ type: "reroll", giveawayNo: no }, manager, 409)
    const inbox = await f.post("/recovery/list", { serverId: "10" })
    assert.ok(inbox.entries.some((entry: { summary?: string }) => entry.summary?.includes("was deleted")))
})

test("A draw NeonFlux may not read says so and tries again later", async () => {
    const f = fixture()
    const no = await f.running()
    now += 3600000
    await f.work({ type: "draw-claim", giveawayNo: no })
    await f.work({ type: "defer", giveawayNo: no, problem: "permission" })
    assert.deepEqual([(await f.show(no)).phase, (await f.show(no)).problem], ["wait", "permission"])
    assert.deepEqual(await f.list(), [])
    now += 600000
    assert.equal((await f.list()).length, 1)
    await f.work({ type: "draw-claim", giveawayNo: no })
    await f.work({ type: "draw-record", giveawayNo: no, winnerIds: [], entrants: 0, capped: false })
    assert.equal((await f.show(no)).problem, undefined)
})

test("DEFCON below 3 and the module switch hold draws, and they resume after", async () => {
    const f = fixture()
    const no = await f.running()
    now += 3600000
    assert.deepEqual((await f.dispatch()).kinds.giveaways, ["10"])
    await f.setModeration({ defcon: 2 })
    assert.deepEqual((await f.dispatch()).kinds.giveaways, [])
    assert.deepEqual(await f.list(), [])
    assert.deepEqual(await f.work({ type: "draw-claim", giveawayNo: no }), { type: "skipped" })
    await f.setModeration({ defcon: 3 })
    await f.manage({ type: "settings", patch: { enabled: false } })
    assert.deepEqual((await f.dispatch()).kinds.giveaways, [])
    assert.deepEqual(await f.list(), [])
    assert.deepEqual(await f.work({ type: "draw-claim", giveawayNo: no }), { type: "skipped" })
    // A cancel stays possible while the module is off, and its edit goes out
    await f.manage(startOp(), manager, 409)
    await f.manage({ type: "settings", patch: { enabled: true } })
    assert.deepEqual((await f.dispatch()).kinds.giveaways, ["10"])
    assert.equal((await f.work({ type: "draw-claim", giveawayNo: no })).type, "draw")
})

test("A new card waits while publishing is off", async () => {
    const f = fixture()
    await f.manage(startOp())
    await f.t.run(async (ctx) => {
        await ctx.db.insert("publishingSettings", { serverId: "10", enabled: false, nextPostNo: 1 })
    })
    assert.deepEqual((await f.dispatch()).kinds.giveaways, [])
    assert.deepEqual(await f.list(), [])
    await f.work({ type: "reserve", giveawayNo: 1, context: context() }, 403)
})

test("The required role is copied when a giveaway starts, so a later change does not move it", async () => {
    const f = fixture()
    await f.manage({ type: "settings", patch: { requiredRoleId: "77" } })
    const no = await f.running()
    await f.manage({ type: "settings", patch: { requiredRoleId: null } })
    assert.equal((await f.show(no)).requiredRoleId, "77")
    assert.match(giveawayCard(await f.show(no)), /Needs the role <@&77> to win/)
    const other = await f.running()
    assert.equal((await f.show(other)).requiredRoleId, undefined)
})

test("A winner's data deletion removes only their ID and keeps the giveaway, and a host's follows the giveaway's end", async () => {
    const f = fixture()
    const no = await f.running()
    await f.drawn(no, ["71", "72"])
    const page = await f.post("/service/member-data/export", { userId: "71", serverId: "10", cursor: null })
    assert.deepEqual(
        page.records
            .filter((row: { feature: string }) => row.feature === "Giveaways you won")
            .map((row: { data: { giveawayNo: number } }) => row.data.giveawayNo),
        [no],
    )
    const deleted = await f.post("/service/member-data/delete", {
        userId: "71",
        userName: "Synthetic member",
        serverId: "10",
        cursor: null,
    })
    assert.deepEqual(deleted.deleted, [{ feature: "Giveaways you won", count: 1 }])
    assert.deepEqual(
        (await f.show(no)).winners.map((w: { userId: string }) => w.userId),
        ["72"],
    )
    // A running giveaway keeps its host
    const running = await f.running()
    const kept = await f.post("/service/member-data/delete", {
        userId: "99",
        userName: "Synthetic host",
        serverId: "10",
        cursor: null,
    })
    assert.equal(kept.kept[0].feature, "Giveaways you host")
    assert.equal((await f.show(running)).hostId, "99")
    // The finished one lost its host and its tracked post, which named them
    const finished = await f.show(no)
    assert.deepEqual([finished.hostId, finished.postNo], [undefined, undefined])
    assert.equal(await f.t.run(async (ctx) => (await ctx.db.query("publishingPosts").collect()).length), 1)
})

test("Retention removes a giveaway 90 days after it ended, with its winners and tracked post", async () => {
    const f = fixture()
    const no = await f.running()
    await f.drawn(no, ["71"])
    now += 89 * DAY
    await f.t.run((ctx) => cleanupGiveaways(ctx as never, now))
    assert.ok(await f.show(no))
    now += 2 * DAY
    assert.deepEqual(await f.t.run((ctx) => cleanupGiveaways(ctx as never, now)), { more: false })
    assert.equal(await f.show(no), undefined)
    await f.t.run(async (ctx) => {
        assert.equal((await ctx.db.query("giveawayWinners").collect()).length, 0)
        assert.equal((await ctx.db.query("publishingPosts").collect()).length, 0)
        assert.equal((await ctx.db.query("publishingAttempts").collect()).length, 0)
    })
})

test("A post with an unknown outcome keeps its giveaway past retention", async () => {
    const f = fixture()
    await f.manage(startOp())
    const { grant } = await f.reserve()
    await f.settle(grant, "uncertain")
    now += 100 * DAY
    await f.t.run((ctx) => cleanupGiveaways(ctx as never, now))
    assert.ok(await f.show())
})

test("The dashboard shows settings and giveaways, and queues the same changes", async () => {
    const f = fixture()
    const session = await f.t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }),
        args = { sessionToken: session.sessionToken, serverId: "10" }
    const snapshot = () => f.t.query(api.dashboardConfiguration.snapshot, { ...args, family: "giveaways" })
    let request = 0
    const queue = async (operation: unknown) =>
        (
            await f.t.action(api.dashboardConfiguration.queue, {
                ...args,
                family: "giveaways",
                operation,
                expectedConfigRevision: (await snapshot()).configRevision,
                requestId: `00000000-0000-4000-8000-${String(++request).padStart(12, "0")}`,
            })
        ).jobId
    const execute = async (jobId: string | undefined, references: object[] = []) =>
        f.post("/dashboard-configuration/execute", {
            serverId: "10",
            originServerId: "10",
            jobId,
            actorId: "99",
            managerAuthorized: true,
            observedAt: now,
            actor: { ...manager, userId: "99" },
            ...(references.length ? { references } : {}),
        })
    const channel = { id: CHANNEL, type: "channel", serverId: "10", exists: true }
    const started = await execute(await queue(startOp()), [channel])
    assert.equal(started.job.state, "applied")
    const view = await snapshot()
    assert.equal(view.family, "giveaways")
    assert.deepEqual(view.data.settings, { enabled: true, requiredRoleId: null })
    assert.equal((view.data as { giveaways: { giveawayNo: number }[] }).giveaways[0]!.giveawayNo, 1)
    assert.equal((await f.show()).hostId, "99")
    const { grant } = await f.reserve()
    await f.settle(grant)
    const ended = await execute(await queue({ type: "end", giveawayNo: 1 }))
    assert.equal(ended.job.state, "applied")
    assert.deepEqual(await f.list(), [{ giveawayNo: 1, channelId: CHANNEL, action: "draw" }])
    const entries = await f.t.run((ctx) => ctx.db.query("auditLogEntries").collect())
    assert.deepEqual(
        entries.map((row) => [row.source, row.setting]),
        [
            ["website", "start 50"],
            ["website", "end 1"],
        ],
    )
})
