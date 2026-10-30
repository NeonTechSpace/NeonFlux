import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "node:test"
import type { TestContext } from "node:test"
import { cleanupModeration } from "../convex/moderation.ts"
import { blockingContentRule } from "../convex/protection.ts"
import { retentionPass } from "../convex/retentionStore.ts"
import { internal } from "../convex/_generated/api.js"
import type {
    AutomodRule,
    ModerationManageResult,
    ModerationEvaluateResult,
    ModerationCase,
    ModerationActionContext,
} from "@neonflux/contracts/moderation"
import type { ModerationActor } from "@neonflux/contracts/shared"
import { BATCH, CORRECTION_BATCH, DAY, KEEP, wordMatches, foldWords } from "../convex/moderationDomain.ts"
import { memberDataExport } from "../convex/memberData.ts"
import { convexBackend } from "./convex-backend.ts"
import { botCall } from "./bot-service.ts"

const originalServer = process.env.NEONFLUX_SERVER_ID
const originalSecret = process.env.NEONFLUX_BOT_API_SECRET
const secret = "synthetic-moderation-secret-not-a-real-key-0000"
beforeEach(() => {
    process.env.NEONFLUX_SERVER_ID = "1"
    process.env.NEONFLUX_BOT_API_SECRET = secret
})
afterEach(() => {
    if (originalServer === undefined) delete process.env.NEONFLUX_SERVER_ID
    else process.env.NEONFLUX_SERVER_ID = originalServer
    if (originalSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET
    else process.env.NEONFLUX_BOT_API_SECRET = originalSecret
})
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"),
    "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/afk.ts": () => import("../convex/afk.ts"),
    "../convex/responses.ts": () => import("../convex/responses.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/metadataLogsWork.ts": () => import("../convex/metadataLogsWork.ts"),
    "../convex/schedulesDelivery.ts": () => import("../convex/schedulesDelivery.ts"),
    "../convex/milestonesDelivery.ts": () => import("../convex/milestonesDelivery.ts"),
    "../convex/levelingWork.ts": () => import("../convex/levelingWork.ts"),
    "../convex/protection.ts": () => import("../convex/protection.ts"),
    "../convex/appeals.ts": () => import("../convex/appeals.ts"),
    "../convex/moderationRetention.ts": () => import("../convex/moderationRetention.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const owner: ModerationActor = {
    originServerId: "1",
    userId: "10",
    roleIds: [],
    isOwner: true,
    isAdministrator: false,
    nativePermissionAuthorized: true,
}
const context: ModerationActionContext = {
    botId: "999",
    botActionAuthorized: true,
    actorCanManageTarget: true,
    botCanManageTarget: true,
    targetProtected: false,
    currentTimeoutUntil: null,
    botAuthorizedActions: [
        "log",
        "warn",
        "kick",
        "ban",
        "unban",
        "timeout",
        "untimeout",
        "delete",
        "purge",
        "slowmode",
        "lock",
        "unlock",
        "quarantine",
        "release",
    ],
}
function fixture(ctx: TestContext) {
    let now = 1700000000000
    let sequence = 1000
    ctx.mock.method(Date, "now", () => now)
    const t = convexBackend(modules)
    const post = (path: string, body: unknown, auth = true) => botCall(t, path, body, auth ? {} : { secret: null })
    const source = () => ({ serverId: "1", messageId: String(++sequence), createdAt: now })
    const manageRequest = (operation: unknown, actor = owner) => ({ ...source(), actor, operation })
    const manage = async (operation: unknown, actor = owner) =>
        read<ModerationManageResult>(await post("/moderation/manage", manageRequest(operation, actor)))
    const settings = (patch: unknown) => manage({ type: "settings", patch })
    const query = (operation: unknown, actor = owner) =>
        post("/moderation/query", { serverId: "1", actor, privateChannelVerified: true, operation })
    const action = async (
        type = "warn",
        extras: Record<string, unknown> = {},
        proof: ModerationActionContext = context,
    ) => {
        const result = await manage({
            type: "action",
            action: { type, targetId: "20", reason: "Synthetic reason", ...extras },
            context: proof,
        })
        assert.ok(!result.duplicate && result.type === "case" && result.grant)
        return { ...result, grant: result.grant }
    }
    const event = (content = "ordinary", extras: Record<string, unknown> = {}) => ({
        ...source(),
        event: "create",
        userId: "20",
        channelId: "30",
        roleIds: [],
        content,
        contentHash: "a".repeat(64),
        mentionedUserIds: [],
        mentionedRoleIds: [],
        mentionedEveryone: false,
        targetIsStaff: false,
        context,
        ...extras,
    })
    const evaluate = (content?: string, extras?: Record<string, unknown>) =>
        post("/moderation/evaluate", event(content, extras))
    const outcome = (c: ModerationCase, result = "succeeded", extra = {}) =>
        post("/moderation/outcome", {
            serverId: "1",
            actionId: c.actionId,
            caseNo: c.caseNo,
            outcome: result,
            ...extra,
        })
    const member = (operation: unknown, requesterId = "20", extra = {}) =>
        post("/appeals/member", { ...source(), requesterId, privateChannelVerified: true, operation, ...extra })
    const staff = (operation: unknown, extra = {}) =>
        post("/appeals/staff", { ...source(), actor: owner, privateChannelVerified: true, operation, ...extra })
    const join = (userId = "20", extra = {}) =>
        post("/moderation/join", { serverId: "1", userId, joinedAt: now, targetIsStaff: false, context, ...extra })
    return {
        t,
        post,
        source,
        manageRequest,
        manage,
        settings,
        query,
        action,
        event,
        evaluate,
        outcome,
        member,
        staff,
        join,
        now: () => now,
        advance: (ms: number) => {
            now += ms
        },
    }
}
async function read<T = Record<string, any>>(response: Response): Promise<T> {
    assert.equal(response.status, 200)
    return (await response.json()) as T
}
async function status(response: Response, expected: number) {
    assert.equal(response.status, expected)
    const body = await response.json()
    assert.equal(typeof body.error, "string")
    assert.ok(!JSON.stringify(body).includes(secret))
}
function rule(type: AutomodRule["type"] = "words", extra: Partial<AutomodRule> = {}): AutomodRule {
    return {
        name: "test",
        type,
        enabled: true,
        priority: 0,
        action: "warn",
        threshold: type === "spam" ? 5 : type === "repeat" ? 3 : type === "mentions" ? 5 : 1,
        windowSeconds: type === "repeat" ? 30 : 10,
        durationSeconds: 900,
        patterns: ["blocked"],
        domainMode: "block",
        channelIds: [],
        exemptChannelIds: [],
        exemptRoleIds: [],
        ...extra,
    }
}

test("All moderation and appeals routes authenticate before input and preserve server isolation", async (ctx) => {
    const f = fixture(ctx)
    for (const path of [
        "manage",
        "query",
        "evaluate",
        "join",
        "outcome",
        "warning-penalty",
        "log-outcome",
        "notice-outcome",
        "reconcile",
        "observe",
        "gate",
    ]
        .map((p) => `/moderation/${p}`)
        .concat(["/appeals/member", "/appeals/staff"])) {
        await status(await f.post(path, "private synthetic malformed input", false), 401)
        await status(await f.post(path, { serverId: "2" }), 403)
    }
    await status(await f.post("/moderation/manage", { serverId: "1", content: "x".repeat(65537) }), 413)
    process.env.NEONFLUX_BOT_API_SECRET = "short"
    await status(await f.post("/moderation/manage", {}), 503)
})
test("Configuration defaults are disabled and dry-run and reject unknown or inherited patch fields", async (ctx) => {
    const f = fixture(ctx)
    const initial = await read(await f.query({ type: "settings" }))
    assert.equal(initial.settings.defcon, 3)
    assert.equal(initial.settings.automodEnabled, false)
    assert.equal(initial.settings.securityEnabled, false)
    assert.equal(initial.settings.automodMode, "dry-run")
    for (const patch of [
        { constructor: true },
        { toString: true },
        { retentionDays: 29 },
        { staffRoleIds: { unknown: [] } },
        { joinWindowSeconds: 301 },
    ])
        await status(await f.post("/moderation/manage", f.manageRequest({ type: "settings", patch })), 400)
    await f.settings({ staffRoleIds: { moderation: ["40"], cases: ["41"] } })
    await f.settings({ staffRoleIds: { moderation: ["42"] } })
    assert.deepEqual((await read(await f.query({ type: "settings" }))).settings.staffRoleIds.cases, ["41"])
})
test("Channel and role lists hold as many channels and roles as a server can have", async (ctx) => {
    const f = fixture(ctx)
    const many = (count: number, from: number) => Array.from({ length: count }, (_, index) => String(from + index))
    await f.settings({ honeypotChannelIds: many(500, 1000), staffRoleIds: { cases: many(250, 3000) } })
    const { settings } = await read(await f.query({ type: "settings" }))
    assert.deepEqual([settings.honeypotChannelIds.length, settings.staffRoleIds.cases.length], [500, 250])
    for (const patch of [{ honeypotChannelIds: many(501, 1000) }, { staffRoleIds: { cases: many(251, 3000) } }])
        await status(await f.post("/moderation/manage", f.manageRequest({ type: "settings", patch })), 400)
    const lists = { channelIds: many(500, 1000), exemptChannelIds: many(500, 2000), exemptRoleIds: many(250, 3000) }
    await f.manage({ type: "rule-create", rule: rule("spam", lists) })
    const stored = (await read(await f.query({ type: "rule-show", name: "test" }))).rule
    assert.deepEqual([stored.channelIds, stored.exemptChannelIds, stored.exemptRoleIds], Object.values(lists))
    for (const patch of [
        { channelIds: many(501, 1000) },
        { exemptChannelIds: many(501, 2000) },
        { exemptRoleIds: many(251, 3000) },
    ])
        await status(
            await f.post("/moderation/manage", f.manageRequest({ type: "rule-update", name: "test", patch })),
            400,
        )
})
test("The watchlist and recovery lists page after their last row shown, to their true end", async (ctx) => {
    const f = fixture(ctx)
    await f.t.run(async (ctx) => {
        for (let i = 0; i < 5005; i++)
            await ctx.db.insert("securityWatchlist", {
                serverId: "1",
                userId: String(100000 + i),
                reason: "Synthetic",
                createdAt: f.now(),
            })
        for (let i = 0; i < 1005; i++)
            await ctx.db.insert("securityRecoveries", {
                serverId: "1",
                generation: 1,
                type: "timeout",
                targetId: String(100000 + i),
                caseNo: i + 1,
                status: "active",
                createdAt: f.now(),
            })
    })
    // A list of 5005 needs 501 pages, so a cursor that never moves stops at 600
    const users: string[] = []
    for (let after: string | undefined, pages = 0; (pages === 0 || after !== undefined) && pages < 600; pages++) {
        const page = await read(await f.query({ type: "watchlist-list", ...(after ? { afterUserId: after } : {}) }))
        users.push(...page.entries.map((entry: { userId: string }) => entry.userId))
        after = page.nextAfterUserId
    }
    assert.deepEqual(
        users,
        Array.from({ length: 5005 }, (_, i) => String(100000 + i)),
    )
    const cases: number[] = []
    for (let after: number | undefined, pages = 0; (pages === 0 || after !== undefined) && pages < 600; pages++) {
        const page = await read(await f.query({ type: "recovery-list", ...(after ? { after } : {}) }))
        cases.push(...page.recoveries.map((recovery: { caseNo: number }) => recovery.caseNo))
        after = page.nextAfter
    }
    assert.deepEqual(
        cases,
        Array.from({ length: 1005 }, (_, i) => i + 1),
    )
})
test("Staff role access is operation-scoped and requires native permissions and private case reads", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ staffRoleIds: { moderation: ["40"] } })
    const staff = { ...owner, userId: "11", roleIds: ["40"], isOwner: false }
    await status(
        await f.post("/moderation/manage", f.manageRequest({ type: "settings", patch: { defcon: 2 } }, staff)),
        403,
    )
    await status(await f.query({ type: "case-list" }, staff), 403)
    await status(
        await f.post(
            "/moderation/manage",
            f.manageRequest(
                { type: "action", action: { type: "warn", targetId: "20", reason: "Reason" }, context },
                { ...staff, nativePermissionAuthorized: false },
            ),
        ),
        403,
    )
    await f.action()
    await status(
        await f.post("/moderation/query", { serverId: "1", actor: owner, operation: { type: "case-list" } }),
        403,
    )
})
test("Staff of any area read the settings, and the appeals switch can be turned off at DEFCON 1", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ staffRoleIds: { appeals: ["43"] }, appealsEnabled: true })
    const reviewer = { ...owner, userId: "12", roleIds: ["43"], isOwner: false }
    assert.equal((await read(await f.query({ type: "settings", appeals: true }, reviewer))).openAppeals, 0)
    await status(await f.query({ type: "settings" }, { ...reviewer, roleIds: ["44"] }), 403)
    await status(await f.query({ type: "settings" }, { ...reviewer, nativePermissionAuthorized: false }), 403)
    await f.settings({ defcon: 1 })
    await status(await f.query({ type: "settings" }, reviewer), 403)
    await f.settings({ appealsEnabled: false })
    assert.equal((await read(await f.query({ type: "settings" }))).settings.appealsEnabled, false)
})
test("Source freshness, immutable management replay, and unsafe action contexts are rejected", async (ctx) => {
    const f = fixture(ctx)
    const body = f.manageRequest({
        type: "action",
        action: { type: "warn", targetId: "20", reason: "Reason" },
        context,
    })
    const first = await read(await f.post("/moderation/manage", body))
    assert.ok(first.grant)
    assert.deepEqual(await read(await f.post("/moderation/manage", body)), { duplicate: true })
    await status(await f.post("/moderation/manage", { ...body, messageId: "9999", createdAt: f.now() - 900001 }), 400)
    // Each refusal carries the reason code the bot turns into a reply that names the fix
    for (const [proof, code] of [
        [{ ...context, targetProtected: true }, "TARGET_PROTECTED"],
        [{ ...context, botCanManageTarget: false }, "BOT_BELOW_TARGET"],
        [{ ...context, botActionAuthorized: false }, "BOT_PERMISSION"],
        [{ ...context, actorCanManageTarget: false }, "ACTOR_BELOW_TARGET"],
    ] as const) {
        const refused = await f.post(
            "/moderation/manage",
            f.manageRequest({
                type: "action",
                action: { type: "warn", targetId: "20", reason: "Reason" },
                context: proof,
            }),
        )
        assert.deepEqual([refused.status, ((await refused.json()) as { code?: string }).code], [403, code])
    }
    await status(
        await f.post(
            "/moderation/manage",
            f.manageRequest({
                type: "action",
                action: { type: "kick", targetId: owner.userId, reason: "Reason" },
                context,
            }),
        ),
        403,
    )
    await status(
        await f.post(
            "/moderation/manage",
            f.manageRequest({
                type: "action",
                action: { type: "slowmode", channelId: "30", slowmodeSeconds: 21601, reason: "Reason" },
                context: { ...context, currentSlowmodeSeconds: 0 },
            }),
        ),
        400,
    )
})
test("Action outcome, staff log, and warning notice are independent once-only bound grants", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ logChannelId: "31" })
    const created = await f.action()
    const result = await read(await f.outcome(created.case))
    assert.ok(result.log)
    assert.ok(result.notice)
    assert.deepEqual(await read(await f.outcome(created.case)), { recorded: false })
    await status(await f.outcome(created.case, "failed"), 409)
    await status(
        await f.post("/moderation/outcome", {
            serverId: "1",
            actionId: created.case.actionId,
            caseNo: created.case.caseNo + 1,
            outcome: "succeeded",
        }),
        409,
    )
    for (const [path, idField] of [
        ["log-outcome", "logId"],
        ["notice-outcome", "noticeId"],
    ] as const) {
        const body = {
            serverId: "1",
            [idField]: created.case.actionId,
            caseNo: created.case.caseNo,
            outcome: "uncertain",
        }
        assert.deepEqual(await read(await f.post(`/moderation/${path}`, body)), { recorded: true })
        assert.deepEqual(await read(await f.post(`/moderation/${path}`, body)), { recorded: false })
    }
    const queried = await read(await f.query({ type: "case-show", caseNo: created.case.caseNo }))
    assert.equal(queried.case.outcome, "succeeded")
    assert.equal(queried.case.notificationOutcome, "uncertain")
    assert.equal(queried.case.logOutcome, "uncertain")
})
test("Case corrections preserve attribution and warning void produces a linked audit generation", async (ctx) => {
    const f = fixture(ctx)
    const created = await f.action()
    await f.outcome(created.case)
    const corrected = await f.manage({ type: "case-reason", caseNo: created.case.caseNo, reason: "Corrected" })
    assert.ok(!corrected.duplicate && corrected.type === "case")
    assert.equal(corrected.case.correctionCount, 1)
    const history = await read(await f.query({ type: "case-history", caseNo: created.case.caseNo }))
    assert.equal(history.corrections[0]?.previousReason, "Synthetic reason")
    assert.equal(history.corrections[0]?.actorId, owner.userId)
    const voided = await f.manage({ type: "case-void", caseNo: created.case.caseNo })
    assert.ok(!voided.duplicate && voided.type === "case" && voided.grant)
    assert.equal(voided.case.linkedCaseNo, created.case.caseNo)
    assert.equal((await read(await f.query({ type: "case-show", caseNo: created.case.caseNo }))).case.voided, true)
})
test("A case takes any number of corrections, pages them oldest first and shows them in the member's data", async (ctx) => {
    const f = fixture(ctx)
    const created = await f.action()
    await f.outcome(created.case)
    for (let no = 1; no <= 25; no++) {
        f.advance(1000)
        const corrected = await f.manage({ type: "case-reason", caseNo: created.case.caseNo, reason: `Reason ${no}` })
        assert.ok(!corrected.duplicate && corrected.type === "case")
        assert.equal(corrected.case.correctionCount, no)
    }
    const pages: string[][] = []
    let after: number | undefined
    for (;;) {
        const page = await read(
            await f.query({ type: "case-history", caseNo: created.case.caseNo, ...(after ? { after } : {}) }),
        )
        assert.equal(page.erased, false)
        pages.push(page.corrections.map((row: { reason: string }) => row.reason))
        after = page.nextAfter
        if (after === undefined) break
    }
    assert.deepEqual(
        pages.map((page) => page.length),
        [10, 10, 5],
    )
    assert.deepEqual(
        pages.flat(),
        Array.from({ length: 25 }, (_, index) => `Reason ${index + 1}`),
    )
    // The member's own data lists each correction of a case about them, without the staff member who made it
    const exported = await f.t.run((ctx) => memberDataExport(ctx, "20", "1", null))
    const corrections = exported.records.filter((record) => record.feature === "Case corrections")
    assert.equal(corrections.length, 25)
    assert.deepEqual(corrections[24]!.data, {
        caseNo: created.case.caseNo,
        type: "reason",
        previousReason: "Reason 24",
        reason: "Reason 25",
        createdAt: f.now(),
    })
})
test("Erasure and retention delete a case's corrections past one run's batch in the next runs", async (ctx) => {
    const f = fixture(ctx)
    // Scheduled runs wait for the test to start them
    ctx.mock.timers.enable({ apis: ["setTimeout"] })
    const many = async () => {
        const created = await f.action()
        await f.outcome(created.case)
        await f.manage({ type: "case-reason", caseNo: created.case.caseNo, reason: "Corrected" })
        await f.t.run(async (ctx) => {
            const row = (await ctx.db
                .query("moderationCases")
                .withIndex("by_server_case", (q) => q.eq("serverId", "1").eq("caseNo", created.case.caseNo))
                .unique())!
            for (let no = 1; no < CORRECTION_BATCH + 6; no++)
                await ctx.db.insert("moderationCorrections", {
                    caseId: row._id,
                    actorId: owner.userId,
                    createdAt: f.now(),
                    previousReason: "Corrected",
                    reason: "Corrected",
                    type: "reason",
                    serverId: "1",
                    caseNo: row.caseNo,
                    targetId: "20",
                })
        })
        return created.case.caseNo
    }
    const left = () => f.t.run(async (ctx) => (await ctx.db.query("moderationCorrections").collect()).length)
    // Erasure hides the corrections at once and schedules the rest
    const erased = await many()
    await f.manage({ type: "erase", caseNo: erased })
    const history = await read(await f.query({ type: "case-history", caseNo: erased }))
    assert.deepEqual([history.erased, history.corrections], [true, []])
    assert.equal(await left(), 6)
    const scheduled = await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())
    const job = scheduled.find((row) => row.name.includes("eraseCorrections"))
    assert.ok(job)
    await f.t.mutation(internal.moderationRetention.eraseCorrections, job.args[0])
    assert.equal(await left(), 0)
    // A case due for retention stays until a run has deleted all of its corrections
    await f.settings({ caseRetentionDays: 30 })
    const retired = await many()
    f.advance(31 * DAY)
    await f.t.run((ctx) => retentionPass(ctx, cleanupModeration))
    await read(await f.query({ type: "case-show", caseNo: retired }))
    assert.equal(await left(), 6)
    await f.t.run((ctx) => retentionPass(ctx, cleanupModeration))
    await status(await f.query({ type: "case-show", caseNo: retired }), 404)
    assert.equal(await left(), 0)
})
test("Only a warning can be voided, and the refusal says so", async (ctx) => {
    const f = fixture(ctx)
    const created = await f.action("kick")
    await f.outcome(created.case)
    const refused = await f.post(
        "/moderation/manage",
        f.manageRequest({ type: "case-void", caseNo: created.case.caseNo }),
    )
    const answer = (await refused.json()) as { code?: string; error?: string }
    assert.deepEqual([refused.status, answer.code], [409, "REFUSED"])
    assert.match(answer.error!, /Only a warning can be voided/)
    assert.equal((await read(await f.query({ type: "case-show", caseNo: created.case.caseNo }))).case.voided, false)
})
test("Timeout ownership preserves stronger and prior sanctions and superseded generations", async (ctx) => {
    const f = fixture(ctx)
    const prior = new Date(f.now() + 300000).toISOString()
    await status(
        await f.post(
            "/moderation/manage",
            f.manageRequest({
                type: "action",
                action: { type: "quarantine", targetId: "20", durationSeconds: 60, reason: "Reason" },
                context: { ...context, currentTimeoutUntil: prior },
            }),
        ),
        409,
    )
    const created = await f.action("quarantine", { durationSeconds: 900 }, { ...context, currentTimeoutUntil: prior })
    const expected = new Date(f.now() + 900000).toISOString()
    await read(await f.outcome(created.case, "succeeded", { timeoutUntil: expected }))
    const recovery = (await read(await f.query({ type: "recovery-target", targetId: "20" }))).recovery
    await status(
        await f.post(
            "/moderation/manage",
            f.manageRequest({
                type: "action",
                action: { type: "release", targetId: "20", recoveryId: recovery.recoveryId, reason: "Release" },
                context: { ...context, currentTimeoutUntil: expected, recoveryGeneration: recovery.generation },
            }),
        ),
        409,
    )
    f.advance(300001)
    const next = await f.action("timeout", { durationSeconds: 1200 }, { ...context, currentTimeoutUntil: expected })
    const newerExpiry = new Date(f.now() + 1200000).toISOString()
    await read(await f.outcome(next.case, "succeeded", { timeoutUntil: newerExpiry }))
    await status(
        await f.post(
            "/moderation/manage",
            f.manageRequest({
                type: "action",
                action: { type: "release", targetId: "20", recoveryId: recovery.recoveryId, reason: "Stale" },
                context: { ...context, currentTimeoutUntil: expected, recoveryGeneration: recovery.generation },
            }),
        ),
        409,
    )
})
test("Lock recovery restores only owned bits and preserves unrelated staff overwrite changes", async (ctx) => {
    // SendMessages, CreatePublicThreads, CreatePrivateThreads and SendMessagesInThreads
    const f = fixture(ctx)
    const owned = String(2048n | (1n << 35n) | (1n << 36n) | (1n << 38n)),
        publicThreads = String(1n << 35n)
    // Locking also denies sending in threads and starting them, and unlock restores the explicit thread allow that was there before
    const locked = await f.action(
        "lock",
        { targetId: undefined, channelId: "30" },
        {
            ...context,
            botPostingPermissions: owned,
            currentOverwrite: { exists: true, allow: publicThreads, deny: "0" },
        },
    )
    assert.deepEqual(locked.grant.overwrite, { exists: true, allow: "0", deny: owned })
    assert.equal(locked.grant.ownedPermissions, owned)
    await read(await f.outcome(locked.case))
    const recovery = (await read(await f.query({ type: "recovery-channel", channelId: "30" }))).recovery
    await status(
        await f.post(
            "/moderation/manage",
            f.manageRequest({
                type: "action",
                action: { type: "unlock", channelId: "30", recoveryId: recovery.recoveryId, reason: "Changed" },
                context: {
                    ...context,
                    currentOverwrite: { exists: true, allow: "0", deny: "2048" },
                    recoveryGeneration: recovery.generation,
                },
            }),
        ),
        409,
    )
    const unlocked = await f.action(
        "unlock",
        { targetId: undefined, channelId: "30", recoveryId: recovery.recoveryId },
        {
            ...context,
            currentOverwrite: { exists: true, allow: "1024", deny: owned },
            recoveryGeneration: recovery.generation,
        },
    )
    assert.deepEqual(unlocked.grant.overwrite, { exists: true, allow: String(1024n | (1n << 35n)), deny: "0" })
    assert.equal(unlocked.grant.expectedOverwrite?.deny, owned)
    assert.equal(unlocked.grant.ownedPermissions, owned)
    await read(await f.outcome(unlocked.case))
    await status(await f.query({ type: "recovery-channel", channelId: "30" }), 404)
    // A bot holding only some thread permissions owns only those, since it could not restore the others on unlock
    const partial = await f.action(
        "lock",
        { targetId: undefined, channelId: "30" },
        {
            ...context,
            botPostingPermissions: String(1n << 38n),
            currentOverwrite: { exists: false, allow: "0", deny: "0" },
        },
    )
    assert.deepEqual(partial.grant.overwrite, { exists: true, allow: "0", deny: String(2048n | (1n << 38n)) })
    assert.equal(partial.grant.ownedPermissions, String(2048n | (1n << 38n)))
    await status(
        await f.post(
            "/moderation/manage",
            f.manageRequest({
                type: "action",
                action: { type: "lock", channelId: "31", reason: "Malformed" },
                context: {
                    ...context,
                    botPostingPermissions: "-1",
                    currentOverwrite: { exists: false, allow: "0", deny: "0" },
                },
            }),
        ),
        400,
    )
})
test("A lock owning SendMessages only unlocks it alone and keeps later thread overwrite changes", async (ctx) => {
    // A bot holding no thread permission owns SendMessages only
    const f = fixture(ctx)
    const locked = await f.action(
        "lock",
        { targetId: undefined, channelId: "30" },
        { ...context, botPostingPermissions: "2048", currentOverwrite: { exists: false, allow: "0", deny: "0" } },
    )
    assert.equal(locked.grant.ownedPermissions, "2048")
    await read(await f.outcome(locked.case))
    const recovery = (await read(await f.query({ type: "recovery-channel", channelId: "30" }))).recovery
    const staffDeny = String(2048n | (1n << 35n))
    const unlocked = await f.action(
        "unlock",
        { targetId: undefined, channelId: "30", recoveryId: recovery.recoveryId },
        {
            ...context,
            currentOverwrite: { exists: true, allow: "0", deny: staffDeny },
            recoveryGeneration: recovery.generation,
        },
    )
    assert.deepEqual(unlocked.grant.overwrite, { exists: true, allow: "0", deny: String(1n << 35n) })
    assert.equal(unlocked.grant.ownedPermissions, "2048")
    await read(await f.outcome(unlocked.case, "uncertain"))
    // Observation compares the same SendMessages-only ownership, so a changed thread bit alone never retires the recovery
    const observed = await read(
        await f.post("/moderation/reconcile", {
            ...f.source(),
            actor: owner,
            privateChannelVerified: true,
            actionId: unlocked.case.actionId,
            observation: { observedAt: f.now(), overwrite: { exists: true, allow: "0", deny: staffDeny } },
        }),
    )
    assert.equal(observed.recorded, true)
    assert.equal(
        (await read(await f.query({ type: "recovery-channel", channelId: "30" }))).recovery.recoveryId,
        recovery.recoveryId,
    )
})
test("Restart observation consumes pending outcomes, blocks stale dispatch and reconciliation is observational", async (ctx) => {
    const f = fixture(ctx)
    const created = await f.action("timeout", { durationSeconds: 900 })
    const dispatch = { serverId: "1", actionId: created.case.actionId, caseNo: created.case.caseNo, dispatch: true }
    assert.deepEqual(await read(await f.post("/moderation/outcome", dispatch)), { recorded: false })
    f.advance(1000)
    await read(await f.post("/moderation/observe", { serverId: "1" }))
    assert.equal(
        (await read(await f.query({ type: "case-show", caseNo: created.case.caseNo }))).case.outcome,
        "uncertain",
    )
    await status(await f.post("/moderation/outcome", dispatch), 409)
    await status(
        await f.outcome(created.case, "succeeded", { timeoutUntil: new Date(f.now() + 900000).toISOString() }),
        409,
    )
    const body = {
        ...f.source(),
        actor: owner,
        privateChannelVerified: true,
        actionId: created.case.actionId,
        observation: { observedAt: f.now(), timeoutUntil: null },
    }
    const reconciled = await read(await f.post("/moderation/reconcile", body))
    assert.equal(reconciled.case.outcome, "uncertain")
    assert.equal(reconciled.recorded, true)
    const older = {
        ...f.source(),
        actor: owner,
        privateChannelVerified: true,
        actionId: created.case.actionId,
        observation: { observedAt: f.now() - 1, timeoutUntil: new Date(f.now() + 900000).toISOString() },
    }
    assert.equal((await read(await f.post("/moderation/reconcile", older))).recorded, false)
})
test("Dispatch confirmation is a one-time claim of the pending grant, and a kick or ban claim reserves the member's notice", async (ctx) => {
    const f = fixture(ctx)
    const created = await f.action("kick")
    const dispatch = { serverId: "1", actionId: created.case.actionId, caseNo: created.case.caseNo, dispatch: true }
    assert.deepEqual(await read(await f.post("/moderation/outcome", dispatch)), {
        recorded: false,
        notice: {
            noticeId: created.case.actionId,
            caseNo: created.case.caseNo,
            targetId: "20",
            action: "kick",
            reason: "Synthetic reason",
            appeals: true,
        },
    })
    const pending = await read(await f.query({ type: "case-show", caseNo: created.case.caseNo }))
    assert.equal(pending.case.notificationOutcome, "pending")
    // A second claim is refused and carries no notice, and the outcome adds no second notice
    await status(await f.post("/moderation/outcome", dispatch), 409)
    const done = await read(await f.outcome(created.case))
    assert.equal(done.recorded, true)
    assert.equal(done.notice, undefined)
    // A temporary ban's notice carries its length and the appeals switch, and a startup turns an unsent notice uncertain
    await f.settings({ appealsEnabled: false })
    const ban = await f.action("ban", { durationSeconds: 604800 })
    const claimed = await read(
        await f.post("/moderation/outcome", { ...dispatch, actionId: ban.case.actionId, caseNo: ban.case.caseNo }),
    )
    assert.equal(claimed.notice.durationSeconds, 604800)
    assert.equal(claimed.notice.appeals, false)
    f.advance(1000)
    await read(await f.post("/moderation/observe", { serverId: "1" }))
    const observed = await read(await f.query({ type: "case-show", caseNo: ban.case.caseNo }))
    assert.equal(observed.case.notificationOutcome, "uncertain")
    // A bot target and an unban get no notice
    const bot = await f.action("kick", {}, { ...context, targetBot: true })
    assert.deepEqual(
        await read(
            await f.post("/moderation/outcome", { ...dispatch, actionId: bot.case.actionId, caseNo: bot.case.caseNo }),
        ),
        { recorded: false },
    )
    assert.equal(
        (await read(await f.query({ type: "case-show", caseNo: bot.case.caseNo }))).case.notificationOutcome,
        "none",
    )
    const unban = await f.action("unban")
    assert.deepEqual(
        await read(
            await f.post("/moderation/outcome", {
                ...dispatch,
                actionId: unban.case.actionId,
                caseNo: unban.case.caseNo,
            }),
        ),
        { recorded: false },
    )
})

test("A timeout notice follows its success with the provider deadline, and the staff log carries the duration", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ logChannelId: "31" })
    // An action without a reason stores empty text
    const reserved = await f.manage({
        type: "action",
        action: { type: "timeout", targetId: "20", durationSeconds: 600 },
        context,
    })
    assert.ok(!reserved.duplicate && reserved.type === "case" && reserved.grant)
    const created = { case: reserved.case }
    assert.equal(created.case.reason, "")
    assert.equal(reserved.grant.reason, "")
    const until = new Date(f.now() + 600000).toISOString()
    const result = await read(await f.outcome(created.case, "succeeded", { timeoutUntil: until }))
    assert.equal(result.log.durationSeconds, 600)
    assert.equal(result.log.reason, "")
    assert.deepEqual(result.notice, {
        noticeId: created.case.actionId,
        caseNo: created.case.caseNo,
        targetId: "20",
        action: "timeout",
        reason: "",
        durationSeconds: 600,
        timeoutUntil: until,
        appeals: true,
    })
    // A failed timeout sends no notice, and a kick's outcome never adds one
    const failed = await f.action("timeout", { durationSeconds: 600 })
    assert.equal((await read(await f.outcome(failed.case, "failed"))).notice, undefined)
})
test("Startup sweep continuations keep the startup cutoff and leave current actions pending", async (ctx) => {
    const f = fixture(ctx)
    const interrupted = await f.action()
    const cutoff = f.now()
    f.advance(1000)
    const current = await f.action()
    await f.t.mutation(internal.moderation.observe, { request: { serverId: "1", cutoff } })
    assert.equal(
        (await read(await f.query({ type: "case-show", caseNo: interrupted.case.caseNo }))).case.outcome,
        "uncertain",
    )
    assert.equal(
        (await read(await f.query({ type: "case-show", caseNo: current.case.caseNo }))).case.outcome,
        "pending",
    )
})
test("DEFCON blocks public commands and keeps only explicit administrator recovery at level one", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ defcon: 2 })
    const gate = async (command: string, who = owner) =>
        read(await f.post("/moderation/gate", { serverId: "1", actor: who, command }))
    assert.equal((await gate("public")).allowed, false)
    assert.equal((await gate("staff")).allowed, true)
    assert.equal((await gate("appeal", { ...owner, isOwner: false })).allowed, true)
    await f.settings({ defcon: 1 })
    assert.equal((await gate("staff")).allowed, false)
    assert.equal((await gate("critical")).allowed, true)
    await status(await f.member({ type: "list" }), 403)
    await status(
        await f.post(
            "/moderation/manage",
            f.manageRequest({ type: "action", action: { type: "kick", targetId: "20", reason: "Reason" }, context }),
        ),
        403,
    )
    await f.settings({ defcon: 3 })
})
test("Rules validate canonical configuration and module off prevents sanctions", async (ctx) => {
    const f = fixture(ctx)
    await f.manage({ type: "rule-create", rule: rule() })
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("blocked"))).grant, undefined)
    await f.settings({ automodEnabled: true })
    const dry = await read<ModerationEvaluateResult>(await f.evaluate("blocked"))
    assert.equal(dry.grant?.action, "log")
    assert.equal(dry.blocked, false)
    await f.manage({ type: "rule-update", name: "test", patch: { priority: 100, enabled: false } })
    assert.equal((await read(await f.query({ type: "rule-show", name: "test" }))).rule.enabled, false)
    await status(
        await f.post(
            "/moderation/manage",
            f.manageRequest({ type: "rule-update", name: "test", patch: { constructor: true } }),
        ),
        400,
    )
    await f.manage({ type: "rule-delete", name: "test" })
    await status(await f.query({ type: "rule-show", name: "test" }), 404)
})
test("Automod edits reevaluate no-match but never punish the same source twice or count edit spam", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ automodEnabled: true, automodMode: "enforce" })
    await f.manage({ type: "rule-create", rule: rule() })
    const body = f.event("ordinary")
    assert.equal((await read<ModerationEvaluateResult>(await f.post("/moderation/evaluate", body))).grant, undefined)
    f.advance(1)
    const edited = { ...body, event: "edit", editedAt: f.now(), content: "blocked", contentHash: "b".repeat(64) }
    const hit = await read<ModerationEvaluateResult>(await f.post("/moderation/evaluate", edited))
    assert.equal(hit.grant?.action, "warn")
    f.advance(1)
    assert.equal(
        (
            await read<ModerationEvaluateResult>(
                await f.post("/moderation/evaluate", { ...edited, editedAt: f.now(), contentHash: "c".repeat(64) }),
            )
        ).duplicate,
        true,
    )
    assert.equal((await f.t.run((ctx) => ctx.db.query("automodWindows").collect())).length, 1)
})
test("Old source creation may have a fresh edit, while stale edit timestamps cannot replace newer observations", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ automodEnabled: true })
    await f.manage({ type: "rule-create", rule: rule() })
    const old = f.event("ordinary", { event: "edit", createdAt: f.now() - DAY, editedAt: f.now() })
    await read(await f.post("/moderation/evaluate", old))
    await status(await f.post("/moderation/evaluate", { ...old, messageId: "5000", editedAt: f.now() - 900001 }), 400)
    const newer = { ...old, editedAt: f.now() + 1 }
    await read(await f.post("/moderation/evaluate", newer))
    assert.equal(
        (await read(await f.post("/moderation/evaluate", { ...old, content: "blocked", contentHash: "b".repeat(64) })))
            .duplicate,
        true,
    )
})
test("Spam and repeat windows count creates atomically with bounded expiry", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ automodEnabled: true, automodMode: "enforce" })
    await f.manage({ type: "rule-create", rule: rule("spam", { threshold: 2 }) })
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate())).grant, undefined)
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate())).grant?.action, "warn")
    f.advance(11000)
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate())).grant, undefined)
    await f.manage({ type: "rule-delete", name: "test" })
    await f.manage({ type: "rule-create", rule: rule("repeat", { threshold: 2 }) })
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate())).grant?.action, "warn")
})
test("Spam windows count only the rule's qualifying channels before stopping", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ automodEnabled: true, automodMode: "enforce" })
    await f.manage({ type: "rule-create", rule: rule("spam", { threshold: 2, channelIds: ["30"] }) })
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate())).grant, undefined)
    await f.t.run(async (ctx) => {
        for (let i = 0; i < 1000; i++)
            await ctx.db.insert("automodWindows", {
                serverId: "1",
                userId: "20",
                channelId: "40",
                kind: "message",
                contentHash: "b".repeat(64),
                timestamp: f.now(),
                expiresAt: f.now() + 300000,
            })
    })
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate())).grant?.action, "warn")
})
test("Automod scopes, exemptions, windows and honeypots treat a thread as its parent channel", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ automodEnabled: true, automodMode: "enforce" })
    // Thread 31 sits in channel 30. A rule scoped to 30 applies in the thread, and the thread's messages count toward its window
    await f.manage({ type: "rule-create", rule: rule("spam", { threshold: 2, channelIds: ["30"] }) })
    const thread = { channelId: "31", parentChannelId: "30" }
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("one", thread))).grant, undefined)
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("two", thread))).grant?.action, "warn")
    // The same messages without the parent are outside the scope
    assert.equal(
        (await read<ModerationEvaluateResult>(await f.evaluate("three", { userId: "21", channelId: "31" }))).grant,
        undefined,
    )
    assert.equal(
        (await read<ModerationEvaluateResult>(await f.evaluate("four", { userId: "21", channelId: "31" }))).grant,
        undefined,
    )
    await f.manage({ type: "rule-delete", name: "test" })
    await f.manage({ type: "rule-create", rule: rule("words", { exemptChannelIds: ["30"] }) })
    assert.equal(
        (await read<ModerationEvaluateResult>(await f.evaluate("blocked", { ...thread, userId: "22" }))).grant,
        undefined,
    )
    assert.equal(
        (await read<ModerationEvaluateResult>(await f.evaluate("blocked", { channelId: "31", userId: "22" }))).grant
            ?.action,
        "warn",
    )
    await f.settings({
        securityEnabled: true,
        securityMode: "enforce",
        honeypotEnabled: true,
        honeypotChannelIds: ["30"],
    })
    const honeypot = await read<ModerationEvaluateResult>(await f.evaluate("hello", { ...thread, userId: "23" }))
    assert.equal(honeypot.grant?.action, "quarantine")
    assert.equal(honeypot.case?.channelId, "31")
    await status(await f.evaluate("hello", { channelId: "31", parentChannelId: "31", userId: "24" }), 400)
})
test("Mention rules count unique users, roles, and explicit everyone without inventing unknown flags", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ automodEnabled: true, automodMode: "enforce" })
    await f.manage({ type: "rule-create", rule: rule("mentions", { threshold: 3 }) })
    assert.equal(
        (
            await read<ModerationEvaluateResult>(
                await f.evaluate("text", { mentionedUserIds: ["31", "31"], mentionedRoleIds: ["40", "41"] }),
            )
        ).grant?.action,
        "warn",
    )
    assert.equal(
        (
            await read<ModerationEvaluateResult>(
                await f.evaluate("text", { mentionedRoleIds: null, mentionedEveryone: null }),
            )
        ).grant,
        undefined,
    )
    assert.equal(
        (await read<ModerationEvaluateResult>(await f.evaluate("text", { mentionedEveryone: true }))).grant?.action,
        "warn",
    )
})
test("Domain rules honor uppercase WWW, subdomain boundaries, punctuation, and explicit allowlists", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ automodEnabled: true, automodMode: "enforce" })
    await f.manage({ type: "rule-create", rule: rule("domains", { patterns: ["evil.test"] }) })
    for (const content of ["WWW.evil.test", "https://sub.evil.test)"])
        assert.ok((await read<ModerationEvaluateResult>(await f.evaluate(content))).grant)
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("https://notevil.test"))).grant, undefined)
    await f.manage({ type: "rule-update", name: "test", patch: { domainMode: "allow", patterns: ["allowed.test"] } })
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("no links"))).grant, undefined)
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("https://sub.allowed.test"))).grant, undefined)
    assert.ok((await read<ModerationEvaluateResult>(await f.evaluate("https://other.test"))).grant)
})
test("Enforcing rules and honeypots log a member NeonFlux cannot act on instead of dropping the finding", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ automodEnabled: true, automodMode: "enforce" })
    await f.manage({ type: "rule-create", rule: rule("words") })
    const below = { context: { ...context, botCanManageTarget: false, actorCanManageTarget: false } }
    const warned = await read<ModerationEvaluateResult>(await f.evaluate("blocked", below))
    assert.equal(warned.grant?.action, "log")
    assert.equal(warned.blocked, true)
    assert.equal(warned.case?.reason, "Automod test (NeonFlux could not act)")
    await f.manage({ type: "rule-update", name: "test", patch: { action: "delete" } })
    const noDelete = { context: { ...context, botAuthorizedActions: ["log", "warn", "timeout", "quarantine"] } }
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("blocked", noDelete))).grant?.action, "log")
    await f.settings({
        securityEnabled: true,
        securityMode: "enforce",
        honeypotEnabled: true,
        honeypotChannelIds: ["30"],
    })
    const honeypot = await read<ModerationEvaluateResult>(await f.evaluate("hello", below))
    assert.equal(honeypot.grant?.action, "log")
    assert.equal(honeypot.case?.incident, "honeypot")
    const cases = await f.t.run((ctx) => ctx.db.query("moderationCases").collect())
    assert.equal(cases.length, 3)
})
test("Rules use priority and deterministic names, scopes and exemptions, and one sanction", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ automodEnabled: true, automodMode: "enforce" })
    await f.manage({ type: "rule-create", rule: rule("words", { name: "z", priority: 10 }) })
    await f.manage({
        type: "rule-create",
        rule: rule("words", { name: "a", priority: 10, channelIds: ["30"], exemptRoleIds: ["40"] }),
    })
    assert.equal((await read<ModerationEvaluateResult>(await f.evaluate("blocked"))).case?.ruleName, "a")
    assert.equal(
        (await read<ModerationEvaluateResult>(await f.evaluate("blocked", { roleIds: ["40"] }))).case?.ruleName,
        "z",
    )
    assert.equal(
        (await read<ModerationEvaluateResult>(await f.evaluate("blocked", { targetIsStaff: true }))).grant,
        undefined,
    )
})
test("Honeypot enforcement takes one reservation shared with automod and records one honeypot case", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({
        automodEnabled: true,
        automodMode: "enforce",
        securityEnabled: true,
        securityMode: "enforce",
        honeypotEnabled: true,
        honeypotChannelIds: ["30"],
    })
    await f.manage({ type: "rule-create", rule: rule() })
    const body = f.event("blocked")
    const hit = await read<ModerationEvaluateResult>(await f.post("/moderation/evaluate", body))
    assert.equal(hit.grant?.action, "quarantine")
    assert.equal(hit.case?.origin, "security")
    assert.equal(hit.case?.incident, "honeypot")
    assert.equal((await read<ModerationEvaluateResult>(await f.post("/moderation/evaluate", body))).duplicate, true)
    assert.equal((await f.t.run((ctx) => ctx.db.query("moderationCases").collect())).length, 1)
})
test("A dry-run honeypot leaves a matching enforcing automod rule to act", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({
        automodEnabled: true,
        automodMode: "enforce",
        securityEnabled: true,
        securityMode: "dry-run",
        honeypotEnabled: true,
        honeypotChannelIds: ["30"],
    })
    await f.manage({ type: "rule-create", rule: rule("words", { action: "delete" }) })
    const hit = await read<ModerationEvaluateResult>(await f.evaluate("blocked"))
    assert.equal(hit.grant?.action, "delete")
    assert.equal(hit.case?.origin, "automod")
    assert.equal(hit.blocked, true)
})
test("Join bursts are deduplicated and cannot automatically set DEFCON one", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({
        securityEnabled: true,
        securityMode: "enforce",
        joinEnabled: true,
        joinThreshold: 2,
        joinDefcon2: true,
    })
    assert.equal((await read(await f.join("20"))).case, undefined)
    const hit = await read(await f.join("21"))
    assert.equal(hit.settings.defcon, 2)
    assert.equal(hit.case.incident, "join-burst")
    assert.equal((await read(await f.join("21"))).duplicate, true)
    assert.equal((await read(await f.join("22"))).case, undefined)
    // A later burst outside the window opens a new case
    f.advance(11000)
    await read(await f.join("23"))
    assert.equal((await read(await f.join("24"))).case.incident, "join-burst")
})
test("Watchlist joins log locally and watchlist narratives require private reads", async (ctx) => {
    const f = fixture(ctx)
    await f.manage({ type: "watchlist-add", userId: "20", reason: "Private synthetic note" })
    await f.settings({ securityEnabled: true, watchlistEnabled: true })
    const hit = await read(await f.join())
    assert.equal(hit.grant.action, "log")
    assert.equal(hit.case.incident, "watchlist")
    assert.ok(!JSON.stringify(hit).includes("Private synthetic note"))
    await status(
        await f.post("/moderation/query", { serverId: "1", actor: owner, operation: { type: "watchlist-list" } }),
        403,
    )
    await f.manage({ type: "watchlist-remove", userId: "20" })
})
test("Appeal and recovery refusals name the reason", async (ctx) => {
    const f = fixture(ctx)
    const refusal = async (response: Response, expected: number, text: RegExp) => {
        const answer = (await response.json()) as { code?: string; error?: string }
        assert.deepEqual([response.status, answer.code], [expected, "REFUSED"])
        assert.match(answer.error!, text)
    }
    const warned = await f.action("warn")
    await read(await f.outcome(warned.case))
    await f.manage({ type: "case-void", caseNo: warned.case.caseNo })
    await refusal(
        await f.member({ type: "submit", caseNo: warned.case.caseNo, text: "Appeal" }),
        409,
        /cannot be appealed/,
    )
    const banned = await f.action("ban")
    await read(await f.outcome(banned.case))
    await read(await f.member({ type: "submit", caseNo: banned.case.caseNo, text: "Appeal" }))
    await refusal(
        await f.member({ type: "submit", caseNo: banned.case.caseNo, text: "Again" }),
        409,
        /already have an open appeal/,
    )
    await refusal(await f.query({ type: "recovery-target", targetId: "20" }), 404, /no timeout of its own/)
    await refusal(await f.query({ type: "recovery-channel", channelId: "30" }), 404, /no lock of its own/)
    await f.settings({ appealsEnabled: false })
    await refusal(await f.member({ type: "list" }), 403, /Appeals are off/)
    await f.settings({ appealsEnabled: true, defcon: 1 })
    await refusal(await f.member({ type: "list" }), 403, /DEFCON 1/)
})
test("Appeals are actor-bound private, discover own cases, and decision never reverses sanction", async (ctx) => {
    const f = fixture(ctx)
    const created = await f.action("ban")
    await read(await f.outcome(created.case))
    await status(await f.member({ type: "submit", caseNo: created.case.caseNo, text: "Private appeal" }, "21"), 404)
    await status(await f.member({ type: "list" }, "20", { privateChannelVerified: false }), 403)
    const cases = await read(await f.member({ type: "cases" }))
    assert.equal(cases.cases[0].caseNo, created.case.caseNo)
    assert.equal(cases.cases[0].corrections, undefined)
    assert.equal(cases.cases[0].actorId, undefined)
    const opened = await read(await f.member({ type: "submit", caseNo: created.case.caseNo, text: "Private appeal" }))
    await status(await f.member({ type: "submit", caseNo: created.case.caseNo, text: "Second" }), 409)
    await status(await f.member({ type: "show", appealNo: opened.appeal.appealNo }, "21"), 404)
    // !appeal status counts open appeals, and other settings reads do not
    assert.equal((await read(await f.query({ type: "settings", appeals: true }))).openAppeals, 1)
    assert.equal((await read(await f.query({ type: "settings" }))).openAppeals, undefined)
    const decided = await read(
        await f.staff({
            type: "decide",
            appealNo: opened.appeal.appealNo,
            decision: "accepted",
            reason: "Review accepted",
        }),
    )
    assert.equal(decided.appeal.status, "accepted")
    assert.equal((await read(await f.query({ type: "settings", appeals: true }))).openAppeals, 0)
    assert.equal(
        (await read(await f.query({ type: "case-show", caseNo: created.case.caseNo }))).case.outcome,
        "succeeded",
    )
    assert.equal((await read(await f.query({ type: "recovery-list" }))).recoveries[0].type, "ban")
})
test("Appeal lists page ten at a time before the previous page's last appeal number, for members and staff", async (ctx) => {
    const f = fixture(ctx)
    await f.t.run(async (ctx) => {
        for (let appealNo = 1; appealNo <= 15; appealNo++)
            await ctx.db.insert("moderationAppeals", {
                serverId: "1",
                appealNo,
                caseNo: 1,
                userId: appealNo % 5 ? "20" : "21",
                text: "Synthetic appeal",
                createdAt: 1,
                status: "withdrawn",
                erased: false,
            })
    })
    const numbers = (result: Record<string, any>) =>
        result.appeals.map((appeal: { appealNo: number }) => appeal.appealNo)
    const first = await read(await f.member({ type: "list" }))
    assert.deepEqual(numbers(first), [14, 13, 12, 11, 9, 8, 7, 6, 4, 3])
    assert.equal(first.nextBeforeAppealNo, 3)
    const last = await read(await f.member({ type: "list", beforeAppealNo: 3 }))
    assert.deepEqual(numbers(last), [2, 1])
    assert.equal(last.nextBeforeAppealNo, undefined)
    const review = await read(await f.staff({ type: "list" }))
    assert.deepEqual(numbers(review), [15, 14, 13, 12, 11, 10, 9, 8, 7, 6])
    assert.equal(review.nextBeforeAppealNo, 6)
    assert.deepEqual(numbers(await read(await f.staff({ type: "list", beforeAppealNo: 6 }))), [5, 4, 3, 2, 1])
})
test("The waiting appeals queue lists only open appeals, oldest first, from a cursor that never repeats a row", async (ctx) => {
    const f = fixture(ctx)
    await f.t.run(async (ctx) => {
        for (let appealNo = 1; appealNo <= 16; appealNo++)
            await ctx.db.insert("moderationAppeals", {
                serverId: "1",
                appealNo,
                caseNo: 1,
                userId: "20",
                text: "Synthetic appeal",
                createdAt: 1,
                status: appealNo % 4 ? "open" : "rejected",
                erased: false,
            })
    })
    const numbers = (result: Record<string, any>) =>
        result.appeals.map((appeal: { appealNo: number }) => appeal.appealNo)
    const first = await read(await f.staff({ type: "queue" }))
    assert.deepEqual(numbers(first), [1, 2, 3, 5, 6, 7, 9, 10, 11, 13])
    assert.equal(first.nextAfterAppealNo, 13)
    assert.equal(first.nextBeforeAppealNo, undefined)
    // A decided appeal leaves the queue and a new one joins its end
    await read(await f.staff({ type: "decide", appealNo: 14, decision: "accepted", reason: "Review accepted" }))
    await f.t.run((ctx) =>
        ctx.db.insert("moderationAppeals", {
            serverId: "1",
            appealNo: 17,
            caseNo: 1,
            userId: "20",
            text: "Synthetic appeal",
            createdAt: 1,
            status: "open",
            erased: false,
        }),
    )
    const last = await read(await f.staff({ type: "queue", afterAppealNo: 13 }))
    assert.deepEqual(numbers(last), [15, 17])
    assert.equal(last.nextAfterAppealNo, undefined)
    // The full list keeps every status
    assert.equal(numbers(await read(await f.staff({ type: "list" }))).length, 10)
    // Reading the queue needs the appeals permission that the list needs, in a verified private channel
    const unprivileged = { ...owner, userId: "11", roleIds: [], isOwner: false }
    await status(await f.staff({ type: "queue" }, { actor: unprivileged }), 403)
    await status(await f.staff({ type: "list" }, { actor: unprivileged }), 403)
    await status(await f.staff({ type: "queue" }, { privateChannelVerified: false }), 403)
})
test("A member message's evaluation answers its gate too, and stores nothing while message protection is off", async (ctx) => {
    const f = fixture(ctx)
    const gate = {
        actor: {
            originServerId: "1",
            userId: "20",
            roleIds: [],
            isOwner: false,
            isAdministrator: false,
            nativePermissionAuthorized: false,
        },
        command: "public",
    }
    const off = await read(await f.evaluate("blocked", { gate }))
    assert.deepEqual(off, {
        duplicate: false,
        blocked: false,
        gate: {
            allowed: true,
            defcon: 3,
            messageProtectionEnabled: false,
            joinProtectionEnabled: false,
            botMessageProtectionEnabled: false,
        },
    })
    assert.equal((await f.t.run((ctx) => ctx.db.query("moderationReceipts").collect())).length, 0)
    await f.settings({ automodEnabled: true, automodMode: "enforce", defcon: 2 })
    await f.manage({ type: "rule-create", rule: rule() })
    const on = await read(await f.evaluate("blocked", { gate }))
    assert.equal(on.blocked, true)
    assert.equal(on.grant.action, "warn")
    assert.deepEqual(
        {
            allowed: on.gate.allowed,
            defcon: on.gate.defcon,
            messageProtectionEnabled: on.gate.messageProtectionEnabled,
        },
        { allowed: false, defcon: 2, messageProtectionEnabled: true },
    )
})
test("Owner erasure redacts all selected narratives without affecting another case or active recovery", async (ctx) => {
    const f = fixture(ctx)
    const created = await f.action("timeout", { durationSeconds: 900 })
    await f.outcome(created.case, "succeeded", { timeoutUntil: new Date(f.now() + 900000).toISOString() })
    const other = await f.action()
    await f.manage({ type: "case-reason", caseNo: created.case.caseNo, reason: "Corrected private reason" })
    const opened = await read(await f.member({ type: "submit", caseNo: created.case.caseNo, text: "Private appeal" }))
    await status(
        await f.post(
            "/moderation/manage",
            f.manageRequest(
                { type: "erase", caseNo: created.case.caseNo },
                { ...owner, isOwner: false, isAdministrator: true },
            ),
        ),
        403,
    )
    await f.manage({ type: "erase", caseNo: created.case.caseNo })
    const erased = await read(await f.query({ type: "case-show", caseNo: created.case.caseNo }))
    assert.equal(erased.case.reason, "[Erased by owner]")
    assert.equal(erased.case.correctionCount, 0)
    assert.equal(
        (
            await f.t.run((ctx) =>
                ctx.db
                    .query("moderationCases")
                    .withIndex("by_server_case", (q) => q.eq("serverId", "1").eq("caseNo", created.case.caseNo))
                    .unique(),
            )
        )?.grant?.reason,
        "[Erased by owner]",
    )
    assert.equal(
        (await read(await f.member({ type: "show", appealNo: opened.appeal.appealNo }))).appeal.text,
        "[Erased by owner]",
    )
    assert.equal((await read(await f.query({ type: "case-show", caseNo: other.case.caseNo }))).case.erased, false)
    assert.equal((await read(await f.query({ type: "recovery-target", targetId: "20" }))).recovery.status, "active")
})
test("Audit expiry protects active recovery and open appeals, and known timeout expiry retires only metadata", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ caseRetentionDays: 180 })
    const timeoutCase = await f.action("timeout", { durationSeconds: 60 })
    await f.outcome(timeoutCase.case, "succeeded", { timeoutUntil: new Date(f.now() + 60000).toISOString() })
    f.advance(60001)
    await f.t.run((ctx) => retentionPass(ctx, cleanupModeration))
    await status(await f.query({ type: "recovery-target", targetId: "20" }), 404)
    const ban = await f.action("ban")
    await f.outcome(ban.case)
    const warning = await f.action()
    await f.outcome(warning.case)
    await f.member({ type: "submit", caseNo: warning.case.caseNo, text: "Appeal stays open" })
    f.advance(181 * DAY)
    await f.t.run((ctx) => retentionPass(ctx, cleanupModeration))
    await read(await f.query({ type: "case-show", caseNo: ban.case.caseNo }))
    await read(await f.query({ type: "case-show", caseNo: warning.case.caseNo }))
    await status(await f.query({ type: "case-show", caseNo: timeoutCase.case.caseNo }), 404)
})

test("More than thirty-two harmless edits still allow one later content sanction", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ automodEnabled: true, automodMode: "enforce" })
    await f.manage({ type: "rule-create", rule: rule() })
    const original = f.event("ordinary")
    await read(await f.post("/moderation/evaluate", original))
    for (let i = 0; i < 35; i++) {
        f.advance(1)
        await read(
            await f.post("/moderation/evaluate", {
                ...original,
                event: "edit",
                editedAt: f.now(),
                contentHash: i.toString(16).padStart(64, "0"),
            }),
        )
    }
    f.advance(1)
    const result = await read<ModerationEvaluateResult>(
        await f.post("/moderation/evaluate", {
            ...original,
            event: "edit",
            editedAt: f.now(),
            content: "blocked",
            contentHash: "f".repeat(64),
        }),
    )
    assert.equal(result.grant?.action, "warn")
    assert.equal(result.blocked, true)
})
test("Retained source cases prevent repeated punishment after receipt expiry and keep blocking replay", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ automodEnabled: true, automodMode: "enforce" })
    await f.manage({ type: "rule-create", rule: rule() })
    const original = f.event("blocked actual synthetic source content")
    const result = await read<ModerationEvaluateResult>(await f.post("/moderation/evaluate", original))
    assert.ok(result.case)
    f.advance(DAY + 1)
    await f.t.run((ctx) => retentionPass(ctx, cleanupModeration))
    const replay = await read<ModerationEvaluateResult>(
        await f.post("/moderation/evaluate", {
            ...original,
            event: "edit",
            editedAt: f.now(),
            contentHash: "b".repeat(64),
        }),
    )
    assert.equal(replay.duplicate, true)
    assert.equal(replay.blocked, true)
    assert.equal(replay.grant, undefined)
    const stored = await f.t.run(async (ctx) => [
        ...(await ctx.db.query("moderationCases").collect()),
        ...(await ctx.db.query("automodWindows").collect()),
        ...(await ctx.db.query("moderationReceipts").collect()),
    ])
    assert.ok(!JSON.stringify(stored).includes(original.content))
})
test("Failed reversal preserves active ownership with a new generation and supports explicit fresh retry", async (ctx) => {
    const f = fixture(ctx)
    const locked = await f.action(
        "lock",
        { targetId: undefined, channelId: "30" },
        { ...context, currentOverwrite: { exists: false, allow: "0", deny: "0" } },
    )
    await read(await f.outcome(locked.case))
    const original = (await read(await f.query({ type: "recovery-channel", channelId: "30" }))).recovery
    const reverse = await f.action(
        "unlock",
        { targetId: undefined, channelId: "30", recoveryId: original.recoveryId },
        { ...context, currentOverwrite: original.expectedOverwrite, recoveryGeneration: original.generation },
    )
    assert.equal(reverse.case.linkedCaseNo, original.caseNo)
    await read(await f.outcome(reverse.case, "failed"))
    const current = (await read(await f.query({ type: "recovery-channel", channelId: "30" }))).recovery
    assert.equal(current.status, "active")
    assert.equal(current.generation, reverse.case.caseNo)
    assert.ok(!Object.hasOwn(current, "reversalState"))
    await status(
        await f.post(
            "/moderation/manage",
            f.manageRequest({
                type: "action",
                action: { type: "unlock", channelId: "30", recoveryId: original.recoveryId, reason: "Stale" },
                context: {
                    ...context,
                    currentOverwrite: original.expectedOverwrite,
                    recoveryGeneration: original.generation,
                },
            }),
        ),
        409,
    )
    const retried = await f.action(
        "unlock",
        { targetId: undefined, channelId: "30", recoveryId: current.recoveryId },
        { ...context, currentOverwrite: current.expectedOverwrite, recoveryGeneration: current.generation },
    )
    await read(await f.outcome(retried.case))
    assert.equal((await f.t.run((ctx) => ctx.db.query("securityRecoveries").collect())).length, 0)
})
test("Uncertain applied unlock can retire observed restored ownership without inferring sanction outcome", async (ctx) => {
    const f = fixture(ctx)
    const locked = await f.action(
        "lock",
        { targetId: undefined, channelId: "30" },
        { ...context, currentOverwrite: { exists: false, allow: "0", deny: "0" } },
    )
    await read(await f.outcome(locked.case))
    const original = (await read(await f.query({ type: "recovery-channel", channelId: "30" }))).recovery
    const reverse = await f.action(
        "unlock",
        { targetId: undefined, channelId: "30", recoveryId: original.recoveryId },
        { ...context, currentOverwrite: original.expectedOverwrite, recoveryGeneration: original.generation },
    )
    await read(await f.outcome(reverse.case, "uncertain"))
    const observed = await read(
        await f.post("/moderation/reconcile", {
            ...f.source(),
            actor: owner,
            privateChannelVerified: true,
            actionId: reverse.case.actionId,
            observation: { observedAt: f.now(), overwrite: { exists: false, allow: "0", deny: "0" } },
        }),
    )
    assert.equal(observed.case.outcome, "uncertain")
    await status(await f.query({ type: "recovery-channel", channelId: "30" }), 404)
})
test("Security-only staff may manage and reconcile security recovery without unrelated case access", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ staffRoleIds: { security: ["40"] } })
    const staff = { ...owner, userId: "11", roleIds: ["40"], isOwner: false }
    const created = await f.manage(
        {
            type: "action",
            action: { type: "quarantine", targetId: "20", reason: "Security", durationSeconds: 900 },
            context,
        },
        staff,
    )
    assert.ok(!created.duplicate && created.type === "case")
    await read(await f.outcome(created.case, "succeeded", { timeoutUntil: new Date(f.now() + 900000).toISOString() }))
    await read(await f.query({ type: "recovery-case", caseNo: created.case.caseNo }, staff))
    await status(await f.query({ type: "case-show", caseNo: created.case.caseNo }, staff), 403)
    await read(
        await f.post("/moderation/reconcile", {
            ...f.source(),
            actor: staff,
            privateChannelVerified: true,
            actionId: created.case.actionId,
            observation: { observedAt: f.now(), timeoutUntil: new Date(f.now() + 900000).toISOString() },
        }),
    )
})
test("Indexed case cursors provide bounded complete navigation and private own-case summaries", async (ctx) => {
    const f = fixture(ctx)
    for (let i = 0; i < 13; i++) await f.action()
    const first = await read(await f.query({ type: "case-list" }))
    assert.equal(first.cases.length, 10)
    assert.ok(first.nextBeforeCaseNo)
    const next = await read(await f.query({ type: "case-list", beforeCaseNo: first.nextBeforeCaseNo }))
    assert.equal(next.cases.length, 3)
    assert.equal(next.nextBeforeCaseNo, undefined)
    assert.equal(new Set([...first.cases, ...next.cases].map((c) => c.caseNo)).size, 13)
    const own = await read(await f.member({ type: "cases" }))
    assert.equal(own.cases.length, 10)
    assert.ok(own.nextBeforeCaseNo)
    assert.deepEqual(Object.keys(own.cases[0]).sort(), ["action", "caseNo", "createdAt", "outcome", "reason"])
})
test("A member's appealable cases are found past newer automod log cases", async (ctx) => {
    const f = fixture(ctx)
    const warned = await f.action()
    await f.manage({ type: "rule-create", rule: rule() })
    await f.settings({ automodEnabled: true })
    for (let i = 0; i < 11; i++) await read(await f.evaluate("blocked"))
    const own = await read(await f.member({ type: "cases" }))
    assert.deepEqual(
        own.cases.map((c: { caseNo: number }) => c.caseNo),
        [warned.case.caseNo],
    )
    assert.equal(own.nextBeforeCaseNo, undefined)
})
test("A page of appealable cases ends after 200 newer log cases and the next page finds the older case", async (ctx) => {
    const f = fixture(ctx)
    const warned = await f.action()
    await f.t.run(async (ctx) => {
        const { _id, _creationTime, ...row } = (await ctx.db.query("moderationCases").first())!
        for (let i = 0; i < 201; i++)
            await ctx.db.insert("moderationCases", {
                ...row,
                caseNo: warned.case.caseNo + 1 + i,
                sourceId: String(2000 + i),
                action: "log",
                origin: "automod",
            })
    })
    const first = await read(await f.member({ type: "cases" }))
    assert.deepEqual(first.cases, [])
    assert.equal(first.nextBeforeCaseNo, warned.case.caseNo + 2)
    const second = await read(await f.member({ type: "cases", beforeCaseNo: first.nextBeforeCaseNo }))
    assert.deepEqual(
        second.cases.map((c: { caseNo: number }) => c.caseNo),
        [warned.case.caseNo],
    )
    assert.equal(second.nextBeforeCaseNo, undefined)
})
test("Closed appeals keep their linked cases until the appeal's own retention ends", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ caseRetentionDays: 180 })
    const created = await f.action()
    await f.outcome(created.case)
    f.advance(179 * DAY)
    const opened = await read(await f.member({ type: "submit", caseNo: created.case.caseNo, text: "Late appeal" }))
    await read(
        await f.staff({ type: "decide", appealNo: opened.appeal.appealNo, decision: "rejected", reason: "Decision" }),
    )
    f.advance(2 * DAY)
    await f.t.run((ctx) => retentionPass(ctx, cleanupModeration))
    await read(await f.query({ type: "case-show", caseNo: created.case.caseNo }))
    f.advance(180 * DAY)
    await f.t.run((ctx) => retentionPass(ctx, cleanupModeration))
    await status(await f.query({ type: "case-show", caseNo: created.case.caseNo }), 404)
})
test("Restart marks reserved deliveries uncertain and never resends", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ logChannelId: "31" })
    const created = await f.action()
    f.advance(59000)
    await f.outcome(created.case)
    f.advance(2000)
    const before = await read(await f.query({ type: "case-show", caseNo: created.case.caseNo }))
    assert.equal(before.case.logOutcome, "pending")
    assert.equal(before.case.notificationOutcome, "pending")
    await read(await f.post("/moderation/observe", { serverId: "1" }))
    const after = await read(await f.query({ type: "case-show", caseNo: created.case.caseNo }))
    assert.equal(after.case.logOutcome, "uncertain")
    assert.equal(after.case.notificationOutcome, "uncertain")
    assert.equal(after.case.outcome, "succeeded")
    assert.deepEqual(await read(await f.outcome(created.case)), { recorded: false })
})
test("Manual module off blocks new sanctions but preserves case reads and explicit reversals", async (ctx) => {
    const f = fixture(ctx)
    const created = await f.action("ban")
    await f.outcome(created.case)
    await f.settings({ manualModerationEnabled: false })
    const blocked = await f.post(
        "/moderation/manage",
        f.manageRequest({ type: "action", action: { type: "warn", targetId: "20", reason: "Blocked" }, context }),
    )
    // The refusal says the module is off, in words the bot shows as they are
    const answer = (await blocked.json()) as { code?: string; error?: string }
    assert.deepEqual([blocked.status, answer.code], [403, "REFUSED"])
    assert.match(answer.error!, /Manual moderation is off/)
    await read(await f.query({ type: "case-show", caseNo: created.case.caseNo }))
    await f.action("unban", { linkedCaseNo: created.case.caseNo })
    assert.equal((await read(await f.query({ type: "settings" }))).settings.automodEnabled, false)
})
test("A genuinely fresh edit may be evaluated after audit history expires but stale originals remain rejected", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ automodEnabled: true, automodMode: "enforce", caseRetentionDays: 180 })
    await f.manage({ type: "rule-create", rule: rule() })
    const original = f.event("blocked")
    const first = await read<ModerationEvaluateResult>(await f.post("/moderation/evaluate", original))
    assert.ok(first.case)
    await f.outcome(first.case)
    f.advance(181 * DAY)
    await f.t.run((ctx) => retentionPass(ctx, cleanupModeration))
    await status(await f.post("/moderation/evaluate", original), 400)
    const edited = await read<ModerationEvaluateResult>(
        await f.post("/moderation/evaluate", {
            ...original,
            event: "edit",
            editedAt: f.now(),
            contentHash: "c".repeat(64),
        }),
    )
    assert.equal(edited.grant?.action, "warn")
    assert.ok(edited.case && edited.case.caseNo > first.case.caseNo)
})
test("Mention and link rate rules add up a member's mentions or links across messages in the window", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ automodEnabled: true, automodMode: "enforce" })
    const grant = async (content: string, extras?: Record<string, unknown>) =>
        (await read<ModerationEvaluateResult>(await f.evaluate(content, extras))).grant?.action
    // No rule counts mentions yet, so none are kept
    await grant("hi", { mentionedUserIds: ["31", "32"] })
    await f.manage({
        type: "rule-create",
        rule: rule("mention-rate", { threshold: 4, windowSeconds: 30, patterns: [] }),
    })
    assert.equal(await grant("hi", { mentionedUserIds: ["31", "32"] }), undefined)
    assert.equal(await grant("plain"), undefined)
    // Another member's mentions count for that member only
    assert.equal(await grant("hi", { userId: "21", mentionedUserIds: ["31", "32", "33"] }), undefined)
    assert.equal(await grant("hi", { mentionedRoleIds: ["40"], mentionedEveryone: true }), "warn")
    f.advance(31000)
    assert.equal(await grant("hi", { mentionedUserIds: ["31", "32", "33"] }), undefined)
    const kinds = async () =>
        (await f.t.run((ctx) => ctx.db.query("automodWindows").collect())).map(
            (row) => `${row.kind}:${row.count ?? ""}`,
        )
    assert.deepEqual(
        (await kinds()).filter((kind) => kind.startsWith("mention")),
        ["mention:2", "mention:3", "mention:2", "mention:3"],
    )
    await f.manage({ type: "rule-delete", name: "test" })
    await f.manage({ type: "rule-create", rule: rule("link-rate", { threshold: 3, windowSeconds: 30, patterns: [] }) })
    assert.equal(await grant("https://a.test and https://b.test"), undefined)
    assert.equal(await grant("@everyone", { mentionedEveryone: true }), undefined)
    assert.equal(await grant("see www.c.test"), "warn")
    assert.deepEqual(
        (await kinds()).filter((kind) => kind.startsWith("link")),
        ["link:2", "link:1"],
    )
    // An edit adds no count
    assert.equal(
        (
            await read<ModerationEvaluateResult>(
                await f.post(
                    "/moderation/evaluate",
                    f.event("https://d.test https://e.test https://f.test", { event: "edit", editedAt: f.now() }),
                ),
            )
        ).grant,
        undefined,
    )
})
test("Deceptive-link rules flag masked links and lookalike hosts of built-in and configured domains", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ automodEnabled: true, automodMode: "enforce" })
    await status(
        await f.post(
            "/moderation/manage",
            f.manageRequest({ type: "rule-create", rule: rule("deceptive-links", { patterns: ["not a domain"] }) }),
        ),
        400,
    )
    await f.manage({
        type: "rule-create",
        rule: rule("deceptive-links", { patterns: ["example.org"], action: "delete" }),
    })
    for (const content of [
        "[https://discord.com/gift](https://evil.test/gift)",
        "https://dlscord.com/nitro",
        "https://examp1e.org/login",
    ]) {
        assert.equal((await read<ModerationEvaluateResult>(await f.evaluate(content))).grant?.action, "delete", content)
    }
    for (const content of ["[our site](https://example.org)", "https://discord.com/channels", "https://example.org"])
        assert.equal((await read<ModerationEvaluateResult>(await f.evaluate(content))).grant, undefined, content)
})
test("Webhook and bot messages are checked only while bot message checks are on, and only log or delete their message", async (ctx) => {
    const f = fixture(ctx)
    // Bot message checks are off
    await f.t.run(async (ctx) => {
        await ctx.db.insert("moderationSettings", {
            serverId: "1",
            nextCaseNo: 1,
            nextAppealNo: 1,
            config: {
                staffRoleIds: { moderation: [], cases: [], automod: [], security: [], appeals: [] },
                logChannelId: null,
                manualModerationEnabled: true,
                automodEnabled: true,
                automodBotMessagesEnabled: false,
                automodMode: "enforce",
                securityEnabled: true,
                securityMode: "enforce",
                joinEnabled: false,
                joinThreshold: 10,
                joinWindowSeconds: 10,
                joinDefcon2: false,
                honeypotEnabled: true,
                honeypotChannelIds: ["30"],
                watchlistEnabled: false,
                appealsEnabled: true,
                defcon: 3,
            },
        })
    })
    assert.equal((await read(await f.query({ type: "settings" }))).settings.automodBotMessagesEnabled, false)
    await f.manage({ type: "rule-create", rule: rule("words", { action: "timeout" }) })
    const gate = async () =>
        (await read(await f.post("/moderation/gate", { serverId: "1", actor: owner, command: "public" })))
            .botMessageProtectionEnabled
    const webhook = { author: "webhook", userId: "70", channelId: "35" }
    const stored = async () =>
        (await f.t.run((ctx) => ctx.db.query("moderationReceipts").collect())).filter((row) =>
            row.key.startsWith("message:"),
        ).length + (await f.t.run((ctx) => ctx.db.query("automodWindows").collect())).length
    assert.equal(await gate(), false)
    assert.deepEqual(await read(await f.evaluate("blocked", webhook)), { duplicate: false, blocked: false })
    assert.equal(await stored(), 0)
    await f.settings({ automodBotMessagesEnabled: true })
    assert.equal(await gate(), true)
    // A timeout rule deletes a webhook's message, without a member target
    const deleted = await read<ModerationEvaluateResult>(await f.evaluate("blocked", webhook))
    assert.equal(deleted.grant?.action, "delete")
    assert.equal(deleted.grant?.targetId, undefined)
    assert.equal(deleted.case?.reason, "Automod test, webhook 70")
    await f.manage({ type: "rule-update", name: "test", patch: { action: "warn" } })
    assert.equal(
        (await read<ModerationEvaluateResult>(await f.evaluate("blocked", { author: "bot", userId: "71" }))).grant
            ?.action,
        "log",
    )
    // NeonFlux's own messages and honeypots stay out of it
    assert.equal(
        (await read<ModerationEvaluateResult>(await f.evaluate("blocked", { author: "bot", userId: "999" }))).grant,
        undefined,
    )
    assert.equal(
        (await read<ModerationEvaluateResult>(await f.evaluate("hello", { ...webhook, channelId: "30" }))).grant,
        undefined,
    )
    await status(await f.evaluate("blocked", { author: "member" }), 400)
    // Turning it off stays possible at DEFCON 1
    await f.settings({ defcon: 1 })
    await f.settings({ automodBotMessagesEnabled: false })
    assert.equal(await gate(), false)
})

test("Case, watchlist and recovery reads answer for a verified DM or a staff channel the bot checked, and nothing else", async (ctx) => {
    const f = fixture(ctx)
    const created = await f.action()
    const lookup = (proof: Record<string, unknown>, operation: unknown) =>
        f.post("/moderation/query", { serverId: "1", actor: owner, ...proof, operation })
    for (const operation of [
        { type: "case-show", caseNo: created.case.caseNo },
        { type: "case-list" },
        { type: "watchlist-list" },
    ]) {
        await read(await lookup({ originServerId: "1", staffChannelRoleIds: [] }, operation))
        await read(await lookup({ privateChannelVerified: true }, operation))
        await status(await lookup({}, operation), 403)
        await status(await lookup({ privateChannelVerified: false }, operation), 403)
        // A channel a role sees that may not make this read is no staff channel
        await status(await lookup({ originServerId: "1", staffChannelRoleIds: ["900"] }, operation), 403)
    }
    // Each role that sees the channel must be a staff role of the read, case readers for cases and security staff for the watchlist
    await f.settings({ staffRoleIds: { cases: ["900"] } })
    await read(await lookup({ originServerId: "1", staffChannelRoleIds: ["900"] }, { type: "case-list" }))
    await status(await lookup({ originServerId: "1", staffChannelRoleIds: ["900", "901"] }, { type: "case-list" }), 403)
    await status(await lookup({ originServerId: "1", staffChannelRoleIds: ["900"] }, { type: "watchlist-list" }), 403)
    await f.settings({ staffRoleIds: { cases: [] } })
    await status(await lookup({ staffChannelRoleIds: "900" }, { type: "case-show", caseNo: 1 }), 400)
    const check = (proof: Record<string, unknown>) =>
        f.post("/moderation/reconcile", {
            ...f.source(),
            actor: owner,
            ...proof,
            actionId: created.case.actionId,
            observation: { observedAt: f.now() },
        })
    assert.equal((await read(await check({ originServerId: "1", staffChannelRoleIds: [] }))).recorded, true)
    await status(await check({}), 403)
    await status(await check({ originServerId: "1", staffChannelRoleIds: ["900"] }), 403)
})

test("Words rules match whole words by default, a star at an edge opens that edge, and folding covers case and fullwidth", () => {
    const hit = (content: string, pattern: string) => wordMatches(foldWords(content), pattern)
    assert.equal(hit("you ass!", "ass"), true)
    assert.equal(hit("ass", "ass"), true)
    assert.equal(hit("class", "ass"), false)
    assert.equal(hit("pass the salt", "ass"), false)
    assert.equal(hit("class", "*ass*"), true)
    assert.equal(hit("cats", "cat*"), true)
    assert.equal(hit("bobcat", "cat*"), false)
    assert.equal(hit("bobcat", "*cat"), true)
    assert.equal(hit("snake_case", "case"), false)
    assert.equal(hit("a 5*star review", "5*star"), true)
    assert.equal(hit("ＢＡＤ day", "bad"), true)
    assert.equal(hit("BAD", "bad"), true)
    assert.equal(hit("très bien", "très"), true)
    assert.equal(hit("trèsbien", "très"), false)
    // Scripts written without spaces need no boundary at a word's edge
    assert.equal(hit("これは禁止語です", "禁止語"), true)
    assert.equal(hit("ข้อความต้องห้ามนี้", "ต้องห้าม"), true)
    // A later occurrence still matches when an earlier one sits inside a word
    assert.equal(hit("classy ass", "ass"), true)
    assert.equal(hit("anything", "*"), false)
})

test("Automod words rules use whole words, rules hold 1000 patterns and a server 2000, and patterns are added and removed in place", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ automodEnabled: true, automodMode: "enforce" })
    await read(
        await f.post(
            "/moderation/manage",
            f.manageRequest({ type: "rule-create", rule: rule("words", { patterns: ["ass"], action: "log" }) }),
        ),
    )
    const caught = async (content: string) => !!(await read<ModerationEvaluateResult>(await f.evaluate(content))).case
    assert.equal(await caught("first class"), false)
    assert.equal(await caught("you ass!"), true)
    // A words pattern of only its * marks would never match, so it is refused with the reason
    for (const pattern of ["*", "**", " ** "]) {
        const starred = await f.post(
            "/moderation/manage",
            f.manageRequest({ type: "rule-update", name: "test", patch: { addPatterns: [pattern] } }),
        )
        assert.equal(starred.status, 400)
        assert.match((await starred.json()).error, /A words pattern needs text besides its \* marks/)
    }
    // Member content NeonFlux posts uses the same words matching
    assert.equal(await f.t.run((ctx) => blockingContentRule(ctx, "1", "a classic", [])), null)
    assert.equal(await f.t.run((ctx) => blockingContentRule(ctx, "1", "what an ass.", [])), "test")
    const patterns = (count: number, prefix = "w") => Array.from({ length: count }, (_, i) => `${prefix}${i}`)
    await read(
        await f.post(
            "/moderation/manage",
            f.manageRequest({ type: "rule-update", name: "test", patch: { patterns: patterns(1000) } }),
        ),
    )
    await status(
        await f.post(
            "/moderation/manage",
            f.manageRequest({ type: "rule-update", name: "test", patch: { patterns: patterns(1001) } }),
        ),
        400,
    )
    // Adding past a rule's 1000 says why
    const full = await f.post(
        "/moderation/manage",
        f.manageRequest({ type: "rule-update", name: "test", patch: { addPatterns: ["extra"] } }),
    )
    assert.equal(full.status, 429)
    assert.match((await full.json()).error, /An automod rule holds at most 1000 patterns/)
    const create = (name: string, list: string[]) =>
        f.post(
            "/moderation/manage",
            f.manageRequest({ type: "rule-create", rule: rule("words", { name, patterns: list }) }),
        )
    await read(await create("second", patterns(900, "v")))
    const over = await create("third", patterns(101, "u"))
    assert.equal(over.status, 429)
    assert.match((await over.json()).error, /at most 2000 patterns together/)
    await read(await create("third", patterns(100, "u")))
    await status(
        await f.post(
            "/moderation/manage",
            f.manageRequest({ type: "rule-update", name: "second", patch: { addPatterns: ["extra"] } }),
        ),
        429,
    )
    // Removing makes room, adding skips patterns already there, and an edit that does not grow is never refused
    const removed = await read(
        await f.post(
            "/moderation/manage",
            f.manageRequest({ type: "rule-update", name: "second", patch: { removePatterns: ["v0", "V1 "] } }),
        ),
    )
    assert.equal(removed.rule.patterns.length, 898)
    assert.ok(!removed.rule.patterns.includes("v0") && !removed.rule.patterns.includes("v1"))
    const added = await read(
        await f.post(
            "/moderation/manage",
            f.manageRequest({ type: "rule-update", name: "second", patch: { addPatterns: ["v2", "Extra", "more"] } }),
        ),
    )
    assert.equal(added.rule.patterns.length, 900)
    assert.deepEqual(added.rule.patterns.slice(-2), ["extra", "more"])
    await read(
        await f.post(
            "/moderation/manage",
            f.manageRequest({ type: "rule-update", name: "second", patch: { enabled: false } }),
        ),
    )
})

test("Cases are kept until erased by default, a chosen period removes them, and a change moves stored expiries", async (ctx) => {
    const f = fixture(ctx)
    const kept = await f.action()
    await f.outcome(kept.case)
    assert.equal(kept.case.expiresAt, KEEP)
    f.advance(181 * DAY)
    await f.t.run((ctx) => retentionPass(ctx, cleanupModeration))
    await read(await f.query({ type: "case-show", caseNo: kept.case.caseNo }))
    // Thirty days removes a case and its corrections after 31 days
    await f.settings({ caseRetentionDays: 30 })
    const short = await f.action()
    await f.outcome(short.case)
    await f.manage({ type: "case-reason", caseNo: short.case.caseNo, reason: "Corrected" })
    f.advance(31 * DAY)
    await f.t.run((ctx) => retentionPass(ctx, cleanupModeration))
    await status(await f.query({ type: "case-show", caseNo: short.case.caseNo }), 404)
    assert.equal((await f.t.run((ctx) => ctx.db.query("moderationCorrections").collect())).length, 0)
    // A case stamped under the old rule survives once the setting keeps it longer, even before any restamp
    const old = await f.action()
    await f.settings({ caseRetentionDays: null })
    f.advance(31 * DAY)
    await f.t.run((ctx) => retentionPass(ctx, cleanupModeration))
    await read(await f.query({ type: "case-show", caseNo: old.case.caseNo }))
    // The change schedules a restamp, which stamps every case and closed appeal with the current setting
    const scheduled = await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())
    assert.ok(scheduled.some((job) => job.name.includes("moderationRetention") && job.args[0].table === "cases"))
    await f.settings({ caseRetentionDays: 90 })
    await f.t.mutation(internal.moderationRetention.restamp, { serverId: "1", table: "cases", after: 0 })
    const stamped = await read(await f.query({ type: "case-show", caseNo: old.case.caseNo }))
    assert.equal(stamped.case.expiresAt, old.case.createdAt + 90 * DAY)
    await f.settings({ caseRetentionDays: null })
    await f.t.mutation(internal.moderationRetention.restamp, { serverId: "1", table: "cases", after: 0 })
    assert.equal((await read(await f.query({ type: "case-show", caseNo: old.case.caseNo }))).case.expiresAt, KEEP)
    // The setting is bounded and reads back in the settings
    await status(
        await f.post("/moderation/manage", f.manageRequest({ type: "settings", patch: { caseRetentionDays: 0 } })),
        400,
    )
    await status(
        await f.post("/moderation/manage", f.manageRequest({ type: "settings", patch: { caseRetentionDays: 3651 } })),
        400,
    )
    const longest = await f.settings({ caseRetentionDays: 3650 })
    assert.ok(!longest.duplicate && longest.type === "settings" && longest.settings.caseRetentionDays === 3650)
})

test("A restamp past one page of cases goes on from the last case of that page", async (ctx) => {
    const f = fixture(ctx)
    // Scheduled pages run only when this test runs them
    ctx.mock.timers.enable({ apis: ["setTimeout"] })
    const first = await f.action()
    // Copies of the case fill more than one page
    await f.t.run(async (ctx) => {
        const { _id, _creationTime, ...row } = (await ctx.db.query("moderationCases").first())!
        for (let caseNo = 2; caseNo <= BATCH + 2; caseNo++) await ctx.db.insert("moderationCases", { ...row, caseNo })
    })
    await f.settings({ caseRetentionDays: 7 })
    const expiries = async () =>
        (await f.t.run((ctx) => ctx.db.query("moderationCases").collect()))
            .sort((a, b) => a.caseNo - b.caseNo)
            .map((row) => row.expiresAt)
    const week = first.case.createdAt + 7 * DAY
    await f.t.mutation(internal.moderationRetention.restamp, { serverId: "1", table: "cases", after: 0 })
    assert.deepEqual(await expiries(), [...Array<number>(BATCH).fill(week), KEEP, KEEP])
    const next = (await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter(
        (job) => job.name.includes("moderationRetention") && job.args[0].after === BATCH,
    )
    assert.deepEqual(
        next.map((job) => job.args[0].table),
        ["cases"],
    )
    await f.t.mutation(internal.moderationRetention.restamp, { serverId: "1", table: "cases", after: BATCH })
    assert.deepEqual(await expiries(), Array<number>(BATCH + 2).fill(week))
})
test("A closed appeal takes the server's case retention from its closing, and a restamp pages appeals after cases", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ caseRetentionDays: 10 })
    const created = await f.action()
    await f.outcome(created.case)
    const opened = await read(await f.member({ type: "submit", caseNo: created.case.caseNo, text: "Appeal" }))
    await read(await f.staff({ type: "decide", appealNo: opened.appeal.appealNo, decision: "rejected", reason: "No" }))
    const appeal = async () => (await f.t.run((ctx) => ctx.db.query("moderationAppeals").collect()))[0]!
    assert.equal((await appeal()).expiresAt, f.now() + 10 * DAY)
    await f.settings({ caseRetentionDays: null })
    await f.t.mutation(internal.moderationRetention.restamp, { serverId: "1", table: "appeals", after: 0 })
    assert.equal((await appeal()).expiresAt, KEEP)
    f.advance(11 * DAY)
    await f.t.run((ctx) => retentionPass(ctx, cleanupModeration))
    assert.ok(await appeal())
})

// The warning limit: A warning's report answers warningPenaltyDue, and the bot's fresh read then opens the penalty case
const enforcing = { warningPenaltyEnabled: true, automodMode: "enforce" }
const warned = async (f: ReturnType<typeof fixture>, result = "succeeded") => {
    const { case: warning } = await f.action("warn")
    return { warning, report: await read(await f.outcome(warning, result)) }
}
const penalty = (f: ReturnType<typeof fixture>, warning: ModerationCase, extra: Record<string, unknown> = {}) =>
    f.post("/moderation/warning-penalty", {
        serverId: "1",
        actionId: warning.actionId,
        caseNo: warning.caseNo,
        userId: "20",
        roleIds: [],
        context,
        ...extra,
    })
const memberCases = async (f: ReturnType<typeof fixture>) =>
    (await read(await f.query({ type: "case-list", userId: "20" }))).cases as ModerationCase[]
const warnTimes = async (f: ReturnType<typeof fixture>, times: number) => {
    let last
    for (let i = 0; i < times; i++) last = await warned(f)
    return last!
}

test("The warning limit is off by default, also for settings stored before it existed, and keeps to its bounds", async (ctx) => {
    const f = fixture(ctx)
    const initial = await read(await f.query({ type: "settings" }))
    assert.equal(initial.settings.warningPenaltyEnabled, undefined)
    for (let i = 0; i < 3; i++) assert.equal((await warned(f)).report.warningPenaltyDue, undefined)
    const { warning } = await warned(f)
    assert.deepEqual(await read(await penalty(f, warning)), {})
    assert.equal((await memberCases(f)).length, 4)
    for (const patch of [
        { warningPenaltyCount: 1 },
        { warningPenaltyCount: 21 },
        { warningPenaltyDays: 0 },
        { warningPenaltyDays: 366 },
        { warningPenaltySeconds: 0 },
        { warningPenaltySeconds: 31536001 },
    ])
        await status(await f.post("/moderation/manage", f.manageRequest({ type: "settings", patch })), 400)
    for (const patch of [
        { warningPenaltyCount: 2 },
        { warningPenaltyCount: 20 },
        { warningPenaltyDays: 1 },
        { warningPenaltyDays: 365 },
        { warningPenaltySeconds: 1 },
        { warningPenaltySeconds: 31536000 },
    ])
        await f.settings(patch)
    // Turning it off stays possible at DEFCON 1, and turning it on does not
    await f.settings({ warningPenaltyEnabled: true, defcon: 1 })
    await f.settings({ warningPenaltyEnabled: false })
    await status(
        await f.post(
            "/moderation/manage",
            f.manageRequest({ type: "settings", patch: { warningPenaltyEnabled: true } }),
        ),
        403,
    )
})

test("The third warning opens one ordinary timeout case, linked to it, that reads as automatic and can be appealed and reversed", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ ...enforcing, logChannelId: "500" })
    for (let i = 0; i < 2; i++) assert.equal((await warned(f)).report.warningPenaltyDue, undefined)
    const { warning, report } = await warned(f)
    assert.equal(report.warningPenaltyDue, true)
    assert.equal(report.notice.action, "warn")
    assert.equal((await memberCases(f)).length, 3)
    const { case: opened, grant } = await read(await penalty(f, warning))
    assert.equal(grant.action, "timeout")
    assert.equal(grant.durationSeconds, 3600)
    assert.equal(grant.targetId, "20")
    assert.equal(grant.sourceId, `warnings:${warning.caseNo}`)
    assert.equal(grant.expectedTimeoutUntil, null)
    assert.equal(opened.caseNo, warning.caseNo + 1)
    assert.equal(opened.action, "timeout")
    assert.equal(opened.origin, "penalty")
    assert.equal(opened.actorId, undefined)
    assert.equal(opened.reason, "Automatic: 3 warnings in 30 days")
    assert.equal(opened.linkedCaseNo, warning.caseNo)
    const until = new Date(f.now() + 3600000).toISOString()
    const done = await read(await f.outcome(opened, "succeeded", { timeoutUntil: until }))
    assert.equal(done.log.action, "timeout")
    assert.equal(done.log.reason, "Automatic: 3 warnings in 30 days")
    assert.equal(done.log.durationSeconds, 3600)
    assert.equal(done.notice.action, "timeout")
    assert.equal(done.notice.timeoutUntil, until)
    assert.equal(done.warningPenaltyDue, undefined)
    assert.equal((await memberCases(f))[0]?.caseNo, opened.caseNo)
    const appeal = await read(await f.member({ type: "submit", caseNo: opened.caseNo, text: "Please review" }))
    assert.equal(appeal.appeal.caseNo, opened.caseNo)
    const reversed = await f.action(
        "untimeout",
        { linkedCaseNo: opened.caseNo },
        { ...context, currentTimeoutUntil: until },
    )
    assert.equal(reversed.grant.expectedTimeoutUntil, until)
    await read(await f.outcome(reversed.case, "succeeded", { timeoutUntil: null }))
})

test("The warning limit takes its own count, window and length", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({
        ...enforcing,
        warningPenaltyCount: 2,
        warningPenaltyDays: 1,
        warningPenaltySeconds: 600,
    })
    await warned(f)
    const { warning, report } = await warned(f)
    assert.equal(report.warningPenaltyDue, true)
    const { case: opened, grant } = await read(await penalty(f, warning))
    assert.equal(opened.reason, "Automatic: 2 warnings in 1 day")
    assert.equal(grant.durationSeconds, 600)
})

test("A warning counts for exactly the window's days", async (ctx) => {
    const f = fixture(ctx)
    await f.settings(enforcing)
    await warned(f)
    f.advance(DAY)
    await warned(f)
    f.advance(29 * DAY + 1)
    // The first warning is now one millisecond too old, so this one is the second that counts
    assert.equal((await warned(f)).report.warningPenaltyDue, undefined)
    f.advance(DAY - 1)
    // The second warning is exactly 30 days old, and this one is the third that counts
    assert.equal((await warned(f)).report.warningPenaltyDue, true)
})

test("Voiding before the limit lowers the count, and voiding after a penalty neither undoes it nor counts again", async (ctx) => {
    const f = fixture(ctx)
    await f.settings(enforcing)
    const first = await warned(f)
    await warned(f)
    await f.manage({ type: "case-void", caseNo: first.warning.caseNo })
    assert.equal((await warned(f)).report.warningPenaltyDue, undefined)
    const { warning, report } = await warned(f)
    assert.equal(report.warningPenaltyDue, true)
    const { case: opened } = await read(await penalty(f, warning))
    await f.manage({ type: "case-void", caseNo: warning.caseNo })
    const kept = (await memberCases(f)).find((row) => row.caseNo === opened.caseNo)
    assert.equal(kept?.voided, false)
    assert.equal(kept?.action, "timeout")
    assert.equal((await warned(f)).report.warningPenaltyDue, undefined)
    // A trigger voided before the bot's request opens nothing
    await warned(f)
    const late = await warned(f)
    assert.equal(late.report.warningPenaltyDue, true)
    await f.manage({ type: "case-void", caseNo: late.warning.caseNo })
    assert.deepEqual(await read(await penalty(f, late.warning)), {})
})

test("Warnings with a failed or unknown outcome do not count, nor do any still pending", async (ctx) => {
    const f = fixture(ctx)
    await f.settings(enforcing)
    await warned(f)
    await warned(f, "failed")
    await warned(f, "uncertain")
    await f.action("warn")
    assert.equal((await warned(f, "failed")).report.warningPenaltyDue, undefined)
    const { warning, report } = await warned(f, "uncertain")
    assert.equal(report.warningPenaltyDue, undefined)
    assert.deepEqual(await read(await penalty(f, warning)), {})
    assert.equal((await warned(f)).report.warningPenaltyDue, undefined)
    assert.equal((await warned(f)).report.warningPenaltyDue, true)
})

test("A penalty never triggers again from warnings before it, and only a full new count triggers the next", async (ctx) => {
    const f = fixture(ctx)
    await f.settings(enforcing)
    const { warning } = await warnTimes(f, 3)
    const { case: opened } = await read(await penalty(f, warning))
    await read(await f.outcome(opened, "succeeded", { timeoutUntil: new Date(f.now() + 3600000).toISOString() }))
    f.advance(DAY)
    assert.equal((await warned(f)).report.warningPenaltyDue, undefined)
    assert.equal((await warned(f)).report.warningPenaltyDue, undefined)
    const next = await warned(f)
    assert.equal(next.report.warningPenaltyDue, true)
    const again = await read(await penalty(f, next.warning))
    assert.equal(again.case.linkedCaseNo, next.warning.caseNo)
    assert.equal((await memberCases(f)).filter((row) => row.origin === "penalty").length, 2)
    // A failed timeout also spends the count, so it is seen once and never retried
    await read(await f.outcome(again.case, "failed"))
    assert.equal((await warned(f)).report.warningPenaltyDue, undefined)
})

test("A retried outcome report and a retried penalty request produce one penalty", async (ctx) => {
    const f = fixture(ctx)
    await f.settings(enforcing)
    const { warning, report } = await warnTimes(f, 3)
    assert.equal(report.warningPenaltyDue, true)
    assert.deepEqual(await read(await f.outcome(warning)), { recorded: false })
    const { grant } = await read(await penalty(f, warning))
    assert.ok(grant)
    assert.deepEqual(await read(await f.outcome(warning)), { recorded: false })
    assert.deepEqual(await read(await penalty(f, warning)), {})
    assert.equal((await memberCases(f)).filter((row) => row.origin === "penalty").length, 1)
    // A warning's report answers before the bot's request runs, so two at once both ask and only the first opens a case
    const [first, second] = [await warned(f), await warned(f)]
    const third = await warned(f)
    assert.equal(third.report.warningPenaltyDue, true)
    await read(await penalty(f, third.warning))
    assert.deepEqual(await read(await penalty(f, second.warning)), {})
    assert.deepEqual(await read(await penalty(f, first.warning)), {})
    await status(await penalty(f, third.warning, { userId: "21" }), 409)
    await status(await penalty(f, third.warning, { caseNo: third.warning.caseNo + 1 }), 409)
    const timeout = (await memberCases(f)).find((row) => row.origin === "penalty")!
    await status(await penalty(f, timeout), 409)
})

test("Automod warnings count with manual ones, while its dry run warns nobody", async (ctx) => {
    const f = fixture(ctx)
    await f.manage({ type: "rule-create", rule: rule("words", { action: "warn", patterns: ["blocked"] }) })
    await f.settings({ warningPenaltyEnabled: true, automodEnabled: true })
    assert.equal((await read(await f.evaluate("blocked"))).case.action, "log")
    await f.settings({ automodMode: "enforce" })
    await warned(f)
    const automated = async () => {
        const result = await read<ModerationEvaluateResult>(await f.evaluate("blocked"))
        assert.equal(result.grant?.action, "warn")
        return { warning: result.case!, report: await read(await f.outcome(result.case!)) }
    }
    assert.equal((await automated()).report.warningPenaltyDue, undefined)
    const { warning, report } = await automated()
    assert.equal(report.warningPenaltyDue, true)
    const opened = await read(await penalty(f, warning))
    assert.equal(opened.grant.action, "timeout")
    assert.equal(opened.case.origin, "penalty")
    assert.equal(opened.case.linkedCaseNo, warning.caseNo)
    // DEFCON does not hold automod, so its warnings and their penalty go on
    await f.settings({ warningPenaltyCount: 2 })
    await f.settings({ defcon: 1 })
    await automated()
    const held = await automated()
    assert.equal(held.report.warningPenaltyDue, true)
    assert.equal((await read(await penalty(f, held.warning))).grant.action, "timeout")
})

test("What NeonFlux may not time out is logged once, and the member starts again from zero", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ ...enforcing, warningPenaltyCount: 2, logChannelId: "500" })
    await f.settings({ staffRoleIds: { moderation: ["700"] } })
    const logged = async (extra: Record<string, unknown>, reason: string) => {
        const { warning } = await warnTimes(f, 2)
        const { case: opened, grant } = await read(await penalty(f, warning, extra))
        assert.equal(grant.action, "log")
        assert.equal(grant.durationSeconds, undefined)
        assert.equal(opened.action, "log")
        assert.equal(opened.origin, "penalty")
        assert.equal(opened.reason, reason)
        assert.equal(opened.linkedCaseNo, warning.caseNo)
        const done = await read(await f.outcome(opened))
        assert.equal(done.log.reason, reason)
        assert.equal(done.notice, undefined)
        assert.equal((await warned(f)).report.warningPenaltyDue, undefined)
        await f.manage({ type: "case-void", caseNo: (await memberCases(f))[0]!.caseNo })
    }
    const protectedReason = "Automatic: 2 warnings in 30 days (protected member)"
    const unableReason = "Automatic: 2 warnings in 30 days (NeonFlux could not act)"
    await logged({ context: { ...context, targetProtected: true, botCanManageTarget: false } }, protectedReason)
    await logged({ roleIds: ["700"] }, protectedReason)
    await logged({ context: { ...context, botActionAuthorized: false } }, unableReason)
    await logged({ context: { ...context, botCanManageTarget: false } }, unableReason)
    const { currentTimeoutUntil: _unread, ...unread } = context
    await logged({ context: unread }, unableReason)
})

test("A longer timeout stays and a shorter one is extended", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ ...enforcing, warningPenaltyCount: 2 })
    const reading = (ms: number) => ({
        context: { ...context, currentTimeoutUntil: new Date(f.now() + ms).toISOString() },
    })
    const first = await warnTimes(f, 2)
    const longer = await read(await penalty(f, first.warning, reading(3600000 + 1)))
    assert.equal(longer.grant.action, "log")
    assert.equal(longer.case.reason, "Automatic: 2 warnings in 30 days (a longer timeout stays)")
    await read(await f.outcome(longer.case))
    const second = await warnTimes(f, 2)
    const equal = await read(await penalty(f, second.warning, reading(3600000)))
    assert.equal(equal.grant.action, "log")
    await read(await f.outcome(equal.case))
    const third = await warnTimes(f, 2)
    const shorter = await read(await penalty(f, third.warning, reading(3600000 - 1)))
    assert.equal(shorter.grant.action, "timeout")
    assert.equal(shorter.grant.durationSeconds, 3600)
})

test("In dry-run mode reaching the limit only logs, with the mode automod enforcement follows", async (ctx) => {
    const f = fixture(ctx)
    await f.settings({ warningPenaltyEnabled: true, logChannelId: "500" })
    const { warning, report } = await warnTimes(f, 3)
    assert.equal(report.warningPenaltyDue, true)
    const { case: opened, grant } = await read(await penalty(f, warning))
    assert.equal(grant.action, "log")
    assert.equal(opened.reason, "Automatic: 3 warnings in 30 days (dry run)")
    const done = await read(await f.outcome(opened))
    assert.equal(done.log.action, "log")
    assert.equal(done.notice, undefined)
    assert.equal((await warned(f)).report.warningPenaltyDue, undefined)
})
