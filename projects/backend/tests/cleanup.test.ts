import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import type {
    CleanupContext,
    CleanupGrant,
    CleanupMessage,
    CleanupSweep,
    CleanupSweepBinding,
    CleanupTarget,
    CleanupTargetBinding,
} from "@neonflux/contracts/cleanup"
import { cleanupCleanupMetadata } from "../convex/cleanupRetention.ts"
import { retentionPass } from "../convex/retentionStore.ts"
import {
    cleanupBoundary,
    cleanupEligibility,
    CLEANUP_DAY,
    CLEANUP_EPOCH,
    CLEANUP_GRANT_MS,
    CLEANUP_REST_MS,
    CLEANUP_RETENTION,
    CLEANUP_SETTLE_MS,
} from "../convex/cleanupDomain.ts"
import { defaultSettings } from "../convex/moderationDomain.ts"
import { convexBackend } from "./convex-backend.ts"
import { botCall } from "./bot-service.ts"
import { applyCleanupManagement } from "../convex/cleanup.ts"
import { changeConfiguration } from "../convex/configurationChange.ts"

const oldServer = process.env.NEONFLUX_SERVER_ID,
    oldSecret = process.env.NEONFLUX_BOT_API_SECRET
const secret = "synthetic-cleanup-secret-not-a-real-credential-000"
beforeEach(() => {
    process.env.NEONFLUX_SERVER_ID = "1"
    process.env.NEONFLUX_BOT_API_SECRET = secret
})
afterEach(() => {
    if (oldServer === undefined) delete process.env.NEONFLUX_SERVER_ID
    else process.env.NEONFLUX_SERVER_ID = oldServer
    if (oldSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET
    else process.env.NEONFLUX_BOT_API_SECRET = oldSecret
})
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"),
    "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/cleanup.ts": () => import("../convex/cleanup.ts"),
    "../convex/cleanupWork.ts": () => import("../convex/cleanupWork.ts"),
    "../convex/cleanupRetention.ts": () => import("../convex/cleanupRetention.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"),
    "../convex/recovery.ts": () => import("../convex/recovery.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const owner = {
    originServerId: "1",
    userId: "10",
    roleIds: [],
    isOwner: true,
    isAdministrator: false,
    nativePermissionAuthorized: true,
}
const member = (userId: string, isBot = false) => ({
    userId,
    joinedAt: "2024-01-01T00:00:00.000001Z",
    roleIds: [],
    isBot,
    timeoutUntil: null,
    canView: true,
    canReadHistory: true,
})
async function read(response: Response): Promise<any> {
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
    return response.json()
}
async function status(response: Response, expected: number) {
    assert.equal(response.status, expected, JSON.stringify(await response.clone().json()))
    assert(!JSON.stringify(await response.json()).includes(secret))
}
async function refused(response: Response, expected: number, text: RegExp) {
    const answer = (await response.json()) as { code?: string; error?: string }
    assert.deepEqual([response.status, answer.code], [expected, "REFUSED"])
    assert.match(answer.error!, text)
}
// Convex's older published limits per transaction, which are stricter than the current ones
const strictLimits = {
    bytesRead: 8 * 1048576,
    bytesWritten: 8 * 1048576,
    documentsRead: 16384,
    documentsWritten: 8192,
}
async function fixture(t: TestContext, transactionLimits: true | typeof strictLimits = true) {
    let now = Date.parse("2026-01-01T00:00:00Z"),
        sequence = 1000
    t.mock.method(Date, "now", () => now)
    const db = convexBackend(modules, transactionLimits),
        source = () => ({ serverId: "1", messageId: String(++sequence), createdAt: now })
    const context = (userId = "10", channelId = "30"): CleanupContext => ({
        observedAt: now,
        actor: { ...owner, userId, isOwner: userId === "10", isAdministrator: userId === "11" },
        actorKind: "human",
        botKind: "bot",
        channelId,
        channelType: 0,
        botId: "999",
        actorAuthorized: true,
        botAuthorized: true,
        member: member(userId),
        botMember: member("999", true),
    })
    const message = (at = now - 3600001, flags: Partial<CleanupMessage> = {}): CleanupMessage => ({
        messageId: (BigInt(cleanupBoundary(at)) + 1n).toString(),
        channelId: "30",
        serverId: "1",
        observedAt: now,
        createdAt: new Date(at).toISOString(),
        authorId: "20",
        authorBot: false,
        authorSystem: false,
        type: 0,
        pinned: false,
        webhookId: null,
        ...flags,
    })
    const http = (path: string, body: unknown, authenticated = true) =>
        botCall(db, path, body, authenticated ? {} : { secret: null })
    const manage = (operation: unknown, proof = context()) =>
        http("/cleanup/manage", { ...source(), context: proof, operation })
    const query = (operation: unknown, proof = context()) =>
        http("/cleanup/query", { serverId: "1", context: proof, operation })
    const work = (operation: unknown) => http("/cleanup/work", { serverId: "1", operation })
    const policy = (channelId = "30") =>
        query({ type: "show", channelId })
            .then(read)
            .then((r) => r.policy)
    const binding = (r: CleanupSweepBinding) => ({
        channelId: r.channelId,
        policyRevision: r.policyRevision,
        moduleRevision: r.moduleRevision,
        sweepNo: r.sweepNo,
    })
    const targetBinding = (r: CleanupTarget | CleanupGrant): CleanupTargetBinding => ({
        ...binding(r),
        pageNo: r.pageNo,
        targetNo: r.targetNo,
        messageId: r.messageId,
    })
    const open = async (channelId = "30", ageMs = 3600000) => {
        const settings = await query({ type: "settings" }).then(read)
        if (!settings.settings.enabled)
            await read(await manage({ type: "module", expectedRevision: settings.settings.revision, enabled: true }))
        const p = await read(
            await manage({ type: "configure", channelId, expectedRevision: 0, ageMs }, context("10", channelId)),
        )
        await read(
            await manage(
                { type: "enable", channelId, expectedRevision: p.policy.revision, enabled: true, confirm: true },
                context("10", channelId),
            ),
        )
    }
    const start = async (channelId = "30") =>
        work({
            type: "start",
            channelId,
            expectedRevision: (await policy(channelId)).revision,
            context: context("10", channelId),
        }).then(read)
    const page = (sweep: CleanupSweep, messages: CleanupMessage[]) =>
        work({
            type: "page",
            binding: binding(sweep),
            pageNo: sweep.pageNo,
            before: sweep.before,
            messages,
            context: context(sweep.ownerId, sweep.channelId),
        })
    const prepare = async (messages = [message()]) => {
        await open()
        const s = await start()
        const p = await page(s.sweep, messages).then(read)
        return { sweep: s.sweep as CleanupSweep, page: p.page, targets: p.targets as CleanupTarget[] }
    }
    const claim = (
        target: CleanupTarget,
        proof = context(),
        m = { ...target.message, observedAt: now },
        claimToken = "a".repeat(32),
    ) => work({ type: "claim", binding: targetBinding(target), context: proof, message: m, claimToken })
    const outcome = (
        target: CleanupTarget,
        result = "deleted",
        extra: Record<string, unknown> = { claimToken: "a".repeat(32) },
    ) => work({ type: "outcome", binding: targetBinding(target), outcome: result, ...extra })
    const claimBatch = (
        targets: CleanupTarget[],
        flags: Record<string, Partial<CleanupMessage>> = {},
        extra: Record<string, unknown> = {},
    ) =>
        work({
            type: "claim-batch",
            items: targets.map((target) => ({
                binding: targetBinding(target),
                message: { ...target.message, observedAt: now, ...flags[target.messageId] },
            })),
            context: context(),
            claimToken: "a".repeat(32),
            ...extra,
        })
    const outcomeBatch = (
        targets: (CleanupTarget | CleanupGrant)[],
        result = "deleted",
        extra: Record<string, unknown> = { claimToken: "a".repeat(32) },
    ) => work({ type: "outcome-batch", bindings: targets.map(targetBinding), outcome: result, ...extra })
    const advance = (sweep: CleanupSweep) => work({ type: "advance", binding: binding(sweep), pageNo: sweep.pageNo })
    const view = (channelId = "30") => query({ type: "status", channelId }).then(read)
    const cleanup = () => db.run((ctx) => retentionPass(ctx, cleanupCleanupMetadata))
    const defcon = async (level: 1 | 2 | 3) =>
        db.run(async (ctx) => {
            const old = await ctx.db
                .query("moderationSettings")
                .withIndex("by_server", (q) => q.eq("serverId", "1"))
                .unique()
            if (old) await ctx.db.patch(old._id, { config: { ...old.config, defcon: level } })
            else
                await ctx.db.insert("moderationSettings", {
                    serverId: "1",
                    config: { ...defaultSettings(), defcon: level },
                    nextCaseNo: 1,
                    nextAppealNo: 1,
                })
        })
    return {
        db,
        source,
        context,
        message,
        http,
        manage,
        query,
        work,
        policy,
        binding,
        targetBinding,
        open,
        start,
        page,
        prepare,
        claim,
        claimBatch,
        outcome,
        outcomeBatch,
        advance,
        view,
        cleanup,
        defcon,
        now: () => now,
        advanceTime: (ms: number) => {
            now += ms
        },
    }
}

test("Cleanup starts independently disabled, strict request shapes and age bounds are enforced", async (t) => {
    const f = await fixture(t),
        settings = (await read(await f.query({ type: "settings" }))).settings
    assert.equal(settings.enabled, false)
    await status(await f.work({ type: "start", channelId: "30", expectedRevision: 1, context: f.context() }), 404)
    for (const ageMs of [3599999, 365 * CLEANUP_DAY + 1, 3600000.5])
        await status(await f.manage({ type: "configure", channelId: "30", expectedRevision: 0, ageMs }), 400)
    await status(
        await f.manage({ type: "configure", channelId: "30", expectedRevision: 0, ageMs: 3600000, extra: true }),
        400,
    )
    await status(
        await f.manage({ type: "configure", channelId: "30", expectedRevision: 0, ageMs: 3600000 }, f.context("20")),
        403,
    )
    await status(
        await f.manage(
            { type: "configure", channelId: "30", expectedRevision: 0, ageMs: 3600000 },
            { ...f.context(), actorKind: "unknown" },
        ),
        403,
    )
    await read(await f.manage({ type: "configure", channelId: "30", expectedRevision: 0, ageMs: 365 * CLEANUP_DAY }))
    assert.equal((await f.policy()).enabled, false)
    await status(await f.manage({ type: "enable", channelId: "30", expectedRevision: 1, enabled: true }), 400)
    await status(
        await f.http("/cleanup/query", { serverId: "1", context: f.context(), operation: { type: "settings" } }, false),
        401,
    )
    await status(
        await f.http("/cleanup/query", { serverId: "2", context: f.context(), operation: { type: "settings" } }),
        403,
    )
})

test("Any current Administrator can enable a policy another one configured and becomes its owner", async (t) => {
    const f = await fixture(t)
    await read(await f.manage({ type: "module", expectedRevision: 1, enabled: true }))
    await read(await f.manage({ type: "configure", channelId: "30", expectedRevision: 0, ageMs: 3600000 }))
    assert.equal((await f.policy()).ownerId, "10")
    await read(
        await f.manage(
            { type: "enable", channelId: "30", expectedRevision: 1, enabled: true, confirm: true },
            f.context("11"),
        ),
    )
    const policy = await f.policy()
    assert.deepEqual([policy.enabled, policy.ownerId], [true, "11"])
})

test("a retained verification panel does not gate cleanup configuration, enablement or preview", async (t) => {
    const f = await fixture(t)
    await f.db.run((ctx) =>
        ctx.db.insert("rolePanels", {
            serverId: "1",
            name: "retired-rules",
            kind: "verification",
            revision: 1,
            enabled: false,
            exclusive: false,
            mappings: [{ emoji: "check", roleId: "40", prerequisiteRoleIds: [], exclusionRoleIds: [] }],
            withdrawing: false,
        }),
    )
    await f.open()
    const preview = await read(await f.query({ type: "preview", channelId: "30", messages: [f.message()] }))
    assert.equal(preview.eligible, 1)
    for (const proof of [
        f.context("20"),
        { ...f.context(), actorAuthorized: false },
        { ...f.context(), botAuthorized: false },
    ]) {
        await status(
            await f.manage(
                { type: "configure", channelId: "31", expectedRevision: 0, ageMs: 3600000 },
                { ...proof, channelId: "31" },
            ),
            403,
        )
    }
})

test("Policy source receipts bind actual actor, keep ordered mutation fence after receipt expiry", async (t) => {
    const f = await fixture(t),
        source = f.source(),
        operation = { type: "configure", channelId: "30", expectedRevision: 0, ageMs: 3600000 }
    const send = (op = operation, proof = f.context()) =>
        f.http("/cleanup/manage", { ...source, context: proof, operation: op })
    await read(await send())
    assert.equal((await read(await send())).duplicate, true)
    await status(await send({ ...operation, ageMs: 7200000 }), 409)
    await status(await send(operation, f.context("11")), 409)
    f.advanceTime(CLEANUP_DAY + 1)
    await f.cleanup()
    await status(
        await f.http("/cleanup/manage", {
            ...source,
            createdAt: f.now(),
            context: f.context(),
            operation: { ...operation, expectedRevision: 1 },
        }),
        409,
    )
    assert.equal((await f.policy()).ageMs, 3600000)
})

test("Preview counts include unknown skips and fail closed for absent raw identity flags, unknown pins and timestamps", async (t) => {
    const f = await fixture(t)
    await f.open()
    const flags: Partial<CleanupMessage>[] = [
        {},
        { authorBot: null },
        { authorSystem: null },
        { pinned: null },
        { createdAt: null },
        { authorBot: true },
        { webhookId: "55" },
        { type: 7 },
        { pinned: true },
        { type: null },
        { authorId: null },
        { createdAt: new Date(f.now()).toISOString() },
    ]
    const messages = flags.map((flags, index) => f.message(f.now() - 3600001 - index, flags))
    const preview = await read(await f.query({ type: "preview", channelId: "30", messages }))
    assert.equal(preview.eligible, 1)
    assert.equal(preview.skipped, 11)
    assert.equal(preview.unknown, 7)
    assert.equal(preview.eligible + preview.skipped, messages.length)
    assert.equal((await f.view()).targets.length, 0)
    const policy = await f.policy(),
        cutoff = f.now() - policy.ageMs
    assert.equal(cleanupEligibility(f.message(cutoff), policy, cutoff), "too-new")
    assert.equal(cleanupEligibility(f.message(cutoff - 1), policy, cutoff), null)
    assert.equal(cleanupBoundary(cutoff), ((BigInt(cutoff) - BigInt(CLEANUP_EPOCH)) << 22n).toString())
})

test("Eligibility names the reason a message is kept", async (t) => {
    const f = await fixture(t)
    await f.open()
    const policy = await f.policy(),
        cutoff = f.now() - policy.ageMs,
        at = cutoff - 1
    const reasons: [Partial<CleanupMessage>, string | null][] = [
        [{}, null],
        [{ pinned: true }, "pinned"],
        [{ pinned: null }, "pin-unknown"],
        [{ authorBot: true }, "bot"],
        [{ authorBot: null }, "identity-unknown"],
        [{ type: 7 }, "system"],
        [{ webhookId: "55" }, "webhook"],
        [{ createdAt: new Date(f.now()).toISOString() }, "timestamp-unknown"],
    ]
    for (const [flags, reason] of reasons)
        assert.equal(cleanupEligibility(f.message(at, flags), policy, cutoff), reason)
    const message = f.message(at)
    assert.equal(
        cleanupEligibility(message, { ...policy, excludedAuthorIds: [message.authorId!] }, cutoff),
        "excluded-author",
    )
    assert.equal(
        cleanupEligibility(message, { ...policy, excludedMessageIds: [message.messageId] }, cutoff),
        "excluded-message",
    )
})

test("An empty page moves the sweep to a later thread created before the cutoff and reads its messages", async (t) => {
    const f = await fixture(t)
    await f.open()
    const sweep = (await f.start()).sweep as CleanupSweep
    const boundary = BigInt(cleanupBoundary(f.now() - 3600000)),
        thread = (boundary - 100n).toString()
    const next = (s: CleanupSweep, nextThreadId: string) =>
        f.work({ type: "advance", binding: f.binding(s), pageNo: s.pageNo, nextThreadId })
    await read(await f.page(sweep, []))
    await status(await next(sweep, boundary.toString()), 400)
    assert.equal((await read(await next(sweep, thread))).complete, false)
    f.advanceTime(60000)
    const moved = (await f.start()).sweep as CleanupSweep
    assert.equal(moved.threadId, thread)
    assert.equal(moved.before, boundary.toString())
    await status(await f.page(moved, [f.message(moved.cutoffAt - 1)]), 409)
    const saved = await read(await f.page(moved, [f.message(moved.cutoffAt - 1, { channelId: thread })]))
    assert.equal(saved.page.threadId, thread)
    assert.equal(saved.targets[0].threadId, thread)
    // Only an empty page may move on to another thread
    await status(await next(moved, (boundary - 50n).toString()), 400)
    await f
        .outcome(saved.targets[0], "absent", {
            noDispatch: true,
            observation: {
                messageId: saved.targets[0].messageId,
                channelId: "30",
                observedAt: f.now(),
                status: "absent",
                channelVisible: true,
            },
        })
        .then(read)
    await read(await f.advance(moved))
    f.advanceTime(60000)
    const last = (await f.start()).sweep as CleanupSweep
    await read(await f.page(last, []))
    await status(await next(last, thread), 400)
    assert.equal((await read(await f.advance(last))).complete, true)
})

test("Frozen cutoff uses public boundary and short raw skipped pages advance without treating short page as end", async (t) => {
    const f = await fixture(t)
    await f.open()
    const first = await f.start(),
        sweep = first.sweep as CleanupSweep
    assert.equal(sweep.before, cleanupBoundary(f.now() - 3600000))
    const raw = [f.message(f.now() - 3600001, { pinned: true }), f.message(f.now() - 3600002, { authorBot: true })]
    const saved = await read(await f.page(sweep, raw))
    assert.equal(saved.targets.length, 0)
    assert.equal(saved.page.nextBefore, raw[1]!.messageId)
    await read(await f.advance(sweep))
    f.advanceTime(60000)
    const resumed = await f.start()
    assert.equal(resumed.sweep.cutoffAt, sweep.cutoffAt)
    assert.equal(resumed.sweep.before, raw[1]!.messageId)
    assert.equal(resumed.sweep.state, "active")
    assert.equal(resumed.page, null)
    assert.equal(resumed.sweep.counts.skipped, 2)
    await read(await f.page(resumed.sweep, []))
    const ended = await read(await f.advance(resumed.sweep))
    assert.equal(ended.complete, true)
    f.advanceTime(60000)
    const next = await f.start()
    assert(next.sweep.cutoffAt > sweep.cutoffAt)
    assert.notEqual(next.sweep.sweepNo, sweep.sweepNo)
})

test("Durable raw pages reject malformed order, duplicate IDs, channel mismatch and boundary equality", async (t) => {
    const f = await fixture(t)
    await f.open()
    const started = await f.start(),
        s = started.sweep as CleanupSweep,
        m1 = f.message(),
        m2 = f.message(f.now() - 3600002)
    for (const raw of [
        [m1, m1],
        [m2, m1],
        [{ ...m1, channelId: "31" }],
        [{ ...m1, serverId: "2" }],
        [f.message(s.cutoffAt)],
    ])
        await status(await f.page(s, raw), 409)
    assert.equal((await f.view()).page, null)
    const saved = await read(await f.page(s, [m1, m2]))
    assert.equal(saved.targets.length, 2)
    assert.equal((await read(await f.page(s, [m1, m2]))).targets.length, 2)
    await status(await f.page(s, [{ ...m1, pinned: true }, m2]), 409)
})

test("Channel status pages handled messages by 10, newest first", async (t) => {
    const f = await fixture(t),
        p = await f.prepare(Array.from({ length: 12 }, (_, index) => f.message(f.now() - 3600001 - index))),
        numbers = p.targets.map((target) => target.targetNo).sort((a, b) => b - a)
    const first = await f.view()
    assert.equal(numbers.length, 12)
    assert.deepEqual(
        first.targets.map((target: CleanupTarget) => target.targetNo),
        numbers.slice(0, 10),
    )
    assert.equal(first.nextBeforeTargetNo, numbers[9])
    const second = await read(
        await f.query({ type: "status", channelId: "30", beforeTargetNo: first.nextBeforeTargetNo }),
    )
    assert.deepEqual(
        second.targets.map((target: CleanupTarget) => target.targetNo),
        numbers.slice(10),
    )
    assert.equal(second.nextBeforeTargetNo, undefined)
})

test("Partial page retains queued remainder, exact claims are one-time and completion compacts raw skips", async (t) => {
    const f = await fixture(t),
        p = await f.prepare([
            f.message(),
            f.message(f.now() - 3600002),
            f.message(f.now() - 3600003, { pinned: true }),
        ]),
        first = p.targets[0]!,
        second = p.targets[1]!
    assert.equal((await read(await f.advance(p.sweep))).recorded, false)
    const g = await read(await f.claim(first))
    assert.equal(g.claimed, true)
    assert.equal(g.grant.dispatchExpiresAt, f.now() + CLEANUP_GRANT_MS)
    assert.equal((await read(await f.claim(first))).claimed, false)
    assert.equal((await read(await f.claim(first, f.context(), first.message, "b".repeat(32)))).claimed, false)
    await status(await f.outcome(first, "deleted", { claimToken: "b".repeat(32) }), 403)
    await read(await f.outcome(first))
    assert.equal((await read(await f.outcome(first))).recorded, false)
    assert.equal((await read(await f.advance(p.sweep))).recorded, false)
    f.advanceTime(60000)
    const resumed = await f.start()
    assert(resumed.page)
    assert.equal(resumed.targets[1].state, "queued")
    assert.equal(resumed.sweep.before, p.sweep.before)
    await read(await f.outcome(second, "failed", { noDispatch: true }))
    await read(await f.advance(p.sweep))
    const state = await f.view()
    assert.equal(state.page, null)
    assert.equal(state.sweep.before, p.page.nextBefore)
    assert.equal(state.sweep.counts.acknowledged, 1)
    assert.equal(state.sweep.counts.attempted, 1)
    assert.equal(state.sweep.counts.submitted, 1)
    assert.equal(state.sweep.counts.failed, 1)
    assert.equal(state.sweep.counts.skipped, 1)
    assert(!JSON.stringify(state).includes("claimToken"))
    assert(!JSON.stringify(state).includes("content"))
})

test("Fresh exact eligibility and publisher/panel references are checked atomically at claim", async (t) => {
    const f = await fixture(t),
        p = await f.prepare(),
        target = p.targets[0]!
    await f.db.run((ctx) =>
        ctx.db.insert("publishingPosts", {
            serverId: "1",
            postNo: 1,
            generation: 1,
            channelId: "30",
            botId: "999",
            messageId: target.messageId,
            outcome: "uncertain",
            createdAt: f.now(),
            updatedAt: f.now(),
        }),
    )
    const blocked = await read(await f.claim(target))
    assert.equal(blocked.type, "target")
    assert.equal(blocked.target.state, "skipped")
    assert.equal(blocked.target.reason, "protected")
    assert.equal(blocked.target.noDispatch, true)
    const extra = f.message(f.now() - 3600004)
    await f.db.run((ctx) =>
        ctx.db.insert("rolePanels", {
            serverId: "1",
            name: "disabled-panel",
            kind: "reaction",
            revision: 1,
            enabled: false,
            exclusive: false,
            mappings: [],
            withdrawing: false,
            published: {
                revision: 1,
                publishedAt: f.now(),
                postNo: 99,
                postGeneration: 1,
                channelId: "30",
                messageId: extra.messageId,
                botId: "999",
                content: { content: "" },
                mappings: [],
                exclusive: false,
            },
        }),
    )
    const preview = await read(await f.query({ type: "preview", channelId: "30", messages: [extra] }))
    assert.equal(preview.items[0].reason, "protected")
})

test("Fresh pin and explicit exclusion changes close undispatched work truthfully", async (t) => {
    const f = await fixture(t),
        p = await f.prepare(),
        target = p.targets[0]!
    const pinned = await read(await f.claim(target, f.context(), { ...target.message, pinned: true }))
    assert.equal(pinned.target.state, "skipped")
    assert.equal(pinned.target.reason, "pinned")
    await read(
        await f.manage({
            type: "exclude",
            channelId: "30",
            expectedRevision: 2,
            kind: "author",
            ids: ["20"],
            add: true,
        }),
    )
    const preview = await read(await f.query({ type: "preview", channelId: "30", messages: [f.message()] }))
    assert.equal(preview.items[0].reason, "excluded-author")
    assert.equal((await f.view()).sweep, null)
})

test("Bot identity, permissions, participant timeouts and DEFCON gate automatic work, never the configuring admin", async (t) => {
    const f = await fixture(t),
        p = await f.prepare(),
        target = p.targets[0]!
    const contexts: CleanupContext[] = [
        { ...f.context(), botKind: "unknown" },
        { ...f.context(), botAuthorized: false },
        {
            ...f.context(),
            botMember: { ...f.context().botMember, timeoutUntil: new Date(f.now() + 1000).toISOString() },
        },
    ]
    for (const proof of contexts) await status(await f.claim(target, proof), 403)
    // The configuring admin may leave or lose permissions. Automatic work only needs the bot
    await f.defcon(2)
    assert.equal((await read(await f.claim(target, { ...f.context("20"), actorAuthorized: false }))).claimed, true)
    await f.defcon(1)
    await status(await f.work({ type: "list" }), 403)
    await read(
        await f.manage({ type: "enable", channelId: "30", expectedRevision: 2, enabled: false }, f.context("11")),
    )
    await read(await f.outcome(target))
    assert.equal((await f.view()).targets[0].state, "deleted")
})

test("A lost claim response ages uncertain without replay", async (t) => {
    const f = await fixture(t),
        p = await f.prepare(),
        target = p.targets[0]!
    await read(await f.claim(target))
    f.advanceTime(CLEANUP_GRANT_MS + CLEANUP_SETTLE_MS + 1)
    await f.cleanup()
    const state = await f.view(),
        uncertain = state.targets.find((r: CleanupTarget) => r.targetNo === target.targetNo)
    assert.equal(uncertain.state, "uncertain")
    assert.equal(uncertain.noDispatch, undefined)
    assert.equal(uncertain.expiresAt, f.now() + CLEANUP_RETENTION)
    assert.equal(state.sweep.counts.submitted, 0)
    assert.equal(state.sweep.counts.unresolved, 1)
    await status(await f.claim(target), 409)
    await read(await f.advance(p.sweep))
    const next = await f.start()
    await read(await f.page(next.sweep, []))
    await read(await f.advance(next.sweep))
    const fresh = await f.start()
    const saved = await read(await f.page(fresh.sweep, [f.message(Date.parse(target.message.createdAt!))]))
    assert.equal(saved.targets.length, 0)
    assert.equal(saved.page.items[0].reason, "retained-attempt")
})

test("Revision/module invalidation cancels only unclaimed targets and accepts old claimed actual outcome", async (t) => {
    const f = await fixture(t),
        p = await f.prepare([f.message(), f.message(f.now() - 3600002)]),
        claimed = p.targets[0]!,
        queued = p.targets[1]!
    await read(await f.claim(claimed))
    await read(await f.manage({ type: "module", expectedRevision: 2, enabled: false }))
    assert.equal((await f.policy()).revision, 2)
    await status(await f.claim(queued), 409)
    await read(await f.outcome(claimed))
    const state = await f.view()
    assert.equal(state.page, null)
    assert.equal(state.sweep, null)
    assert.equal(state.targets.find((r: CleanupTarget) => r.targetNo === queued.targetNo).state, "cancelled")
    assert.equal(state.targets.find((r: CleanupTarget) => r.targetNo === claimed.targetNo).state, "deleted")
})

test("Indexed discovery cursor is fair after deferred first twenty policies and reaches all fifty", async (t) => {
    const f = await fixture(t)
    for (let i = 0; i < 50; i++) await f.open(String(30 + i))
    const first = await read(await f.work({ type: "list" }))
    assert.equal(first.policies.length, 20)
    assert.equal(first.hasMore, true)
    for (const policy of first.policies)
        await read(
            await f.work({
                type: "defer",
                channelId: policy.channelId,
                expectedRevision: policy.revision,
                reason: "authority",
            }),
        )
    const second = await read(await f.work({ type: "list", cursor: first.nextCursor }))
    assert.equal(second.policies.length, 20)
    assert(
        second.policies.every(
            (p: { channelId: string }) =>
                !first.policies.some((old: { channelId: string }) => old.channelId === p.channelId),
        ),
    )
    const third = await read(await f.work({ type: "list", cursor: second.nextCursor }))
    assert.equal(third.policies.length, 10)
    assert.equal(third.hasMore, false)
})

test("Cleanup runs in more than 50 channels, and a module switch stops every sweep within Convex's limits", async (t) => {
    const f = await fixture(t, strictLimits)
    // One channel's sweep holds a full page of 50 waiting deletions, the most a module switch cancels for one policy
    await f.open("100")
    const { sweep } = await f.start("100")
    const messages = Array.from({ length: 50 }, (_, i) => ({
        ...f.message(f.now() - 3600001 - i * 1000),
        channelId: "100",
    }))
    assert.equal((await read(await f.page(sweep, messages))).targets.length, 50)
    // 80 more channels each get a copy of that policy, sweep, page and targets, as many as an unpaged switch could not stop at once
    for (let batch = 0; batch < 4; batch++)
        await f.db.run(async (ctx) => {
            const policy = (await ctx.db.query("cleanupPolicies").first())!,
                first = (await ctx.db.query("cleanupSweeps").first())!,
                page = (await ctx.db.query("cleanupPages").first())!,
                targets = await ctx.db
                    .query("cleanupTargets")
                    .withIndex("by_page", (q) => q.eq("serverId", "1").eq("sweepNo", first.sweepNo))
                    .collect()
            for (let i = 1 + batch * 20; i <= 20 + batch * 20; i++) {
                const channelId = String(100 + i),
                    sweepNo = first.sweepNo + i,
                    copy = <T extends { _id: unknown; _creationTime: unknown }>({ _id, _creationTime, ...row }: T) =>
                        row
                await ctx.db.insert("cleanupPolicies", { ...copy(policy), channelId, sweepNo })
                await ctx.db.insert("cleanupSweeps", { ...copy(first), channelId, sweepNo })
                await ctx.db.insert("cleanupPages", { ...copy(page), channelId, sweepNo })
                for (const target of targets)
                    await ctx.db.insert("cleanupTargets", {
                        ...copy(target),
                        channelId,
                        sweepNo,
                        targetNo: target.targetNo + i * 100,
                    })
            }
            const state = (await ctx.db.query("cleanupSettings").first())!
            await ctx.db.patch(state._id, { policies: 21 + batch * 20, nextSweepNo: first.sweepNo + 200 })
        })
    // The 82nd channel is set up like any other
    await read(
        await f.manage(
            { type: "configure", channelId: "200", expectedRevision: 0, ageMs: 3600000 },
            f.context("10", "200"),
        ),
    )
    const settings = (await read(await f.query({ type: "settings" }))).settings
    assert.equal(settings.policies, 82)
    assert.equal((await read(await f.query({ type: "list" }))).policies.length, 82)
    t.mock.timers.enable({ apis: ["setTimeout"] })
    await read(await f.manage({ type: "module", expectedRevision: settings.revision, enabled: false }))
    await f.db.finishAllScheduledFunctions(() => t.mock.timers.tick(1))
    const left = await f.db.run(async (ctx) => ({
        sweeps: (await ctx.db.query("cleanupSweeps").collect()).filter((x) => x.state === "active").length,
        cancelled: (await ctx.db.query("cleanupTargets").collect()).filter((x) => x.state === "cancelled").length,
        bound: (await ctx.db.query("cleanupPolicies").collect()).filter((x) => x.sweepNo !== undefined).length,
    }))
    assert.deepEqual(left, { sweeps: 0, cancelled: 81 * 50, bound: 0 })
    // The counter stops a server at Fluxer's 500 channels
    await f.db.run(async (ctx) => {
        const row = (await ctx.db.query("cleanupSettings").first())!
        await ctx.db.patch(row._id, { policies: 500 })
    })
    await refused(
        await f.manage(
            { type: "configure", channelId: "90", expectedRevision: 0, ageMs: 3600000 },
            f.context("10", "90"),
        ),
        429,
        /already set up in 500 channels/,
    )
})

test("Observed absence is counted separately, and failed claimed outcomes cannot be made retryable", async (t) => {
    const f = await fixture(t),
        p = await f.prepare([f.message(), f.message(f.now() - 3600002)]),
        absent = p.targets[0]!,
        failed = p.targets[1]!
    await status(await f.outcome(absent, "absent", { noDispatch: true }), 400)
    await read(
        await f.outcome(absent, "absent", {
            noDispatch: true,
            observation: {
                messageId: absent.messageId,
                channelId: "30",
                observedAt: f.now(),
                status: "absent",
                channelVisible: true,
            },
        }),
    )
    await read(await f.claim(failed))
    await read(await f.outcome(failed, "failed"))
    const original = (await f.view()).targets.find((r: CleanupTarget) => r.targetNo === failed.targetNo)
    assert.equal(original.noDispatch, undefined)
    assert.equal(original.expiresAt, original.finishedAt + CLEANUP_RETENTION)
    const reassessment = await read(await f.outcome(failed, "uncertain"))
    assert.equal(reassessment.target.state, "failed")
    assert.equal(reassessment.target.finishedAt, original.finishedAt)
    assert.equal(reassessment.target.reassessedAt, f.now())
    assert.equal(reassessment.target.expiresAt, original.expiresAt)
    assert.equal((await read(await f.outcome(failed, "uncertain"))).recorded, false)
    const counts = (await f.view()).sweep.counts
    assert.equal(counts.acknowledged, 0)
    assert.equal(counts.observedAbsent, 1)
    assert.equal(counts.unresolved, 1)
})

test("A channel keeps thousands of exclusions, changed several at once or replaced whole, within the server's total", async (t) => {
    const f = await fixture(t, strictLimits),
        ids = (from: number, count: number) => Array.from({ length: count }, (_, i) => String(from + i))
    // The dashboard saves whole lists as a job, recorded in the audit log like every change
    const job = async (operation: Record<string, unknown>) => {
        // A chat change after it is a later one
        f.advanceTime(1000)
        await f.db.run((ctx) =>
            changeConfiguration(
                ctx,
                "1",
                "cleanup",
                { kind: "dashboard", createdAt: f.now(), actor: { userId: "10", source: "website" }, operation },
                () =>
                    applyCleanupManagement(
                        ctx,
                        { serverId: "1", actorId: "10", createdAt: f.now(), source: { kind: "job", jobId: "job1" } },
                        undefined,
                        operation,
                    ),
            ),
        )
        f.advanceTime(1000)
    }
    await f.open()
    // Far more than the old 50 authors and 100 messages, in one change of each kind
    await job({
        type: "exclusions",
        channelId: "30",
        expectedRevision: 2,
        excludedAuthorIds: ids(100000, 8192),
        excludedMessageIds: ids(200000, 1000),
    })
    assert.deepEqual(
        [(await f.policy()).excludedAuthorIds.length, (await f.policy()).excludedMessageIds.length],
        [8192, 1000],
    )
    await refused(
        await f.manage({
            type: "exclude",
            channelId: "30",
            expectedRevision: 3,
            kind: "author",
            ids: ["9999"],
            add: true,
        }),
        429,
        /at most 8192 excluded authors and 8192 excluded messages\. Remove some first/,
    )
    await read(
        await f.manage({
            type: "exclude",
            channelId: "30",
            expectedRevision: 3,
            kind: "message",
            ids: ["200000", "200001", "9999"],
            add: false,
        }),
    )
    assert.equal((await f.policy()).excludedMessageIds.length, 998)
    await read(
        await f.manage({
            type: "exclude",
            channelId: "30",
            expectedRevision: 4,
            kind: "message",
            ids: ["200000", "200500"],
            add: true,
        }),
    )
    assert.equal((await f.policy()).excludedMessageIds.length, 999)
    // Other channels hold the rest of the server's 20,000
    await f.open("31")
    await job({
        type: "exclusions",
        channelId: "31",
        expectedRevision: 2,
        excludedAuthorIds: ids(300000, 8192),
        excludedMessageIds: ids(400000, 20000 - 8192 - 8192 - 999),
    })
    await f.open("32")
    await refused(
        await f.manage(
            { type: "exclude", channelId: "32", expectedRevision: 2, kind: "author", ids: ["1"], add: true },
            f.context("10", "32"),
        ),
        429,
        /at most 20000 excluded authors and messages across its cleanup channels/,
    )
    // Shrinking always works, and replacing a list with an empty one clears it
    await read(
        await f.manage({
            type: "exclusions",
            channelId: "30",
            expectedRevision: 5,
            excludedAuthorIds: [],
            excludedMessageIds: ["200000"],
        }),
    )
    assert.deepEqual([(await f.policy()).excludedAuthorIds, (await f.policy()).excludedMessageIds], [[], ["200000"]])
    await status(
        await f.manage({
            type: "exclusions",
            channelId: "30",
            expectedRevision: 6,
            excludedAuthorIds: ["1", "1"],
            excludedMessageIds: [],
        }),
        400,
    )
})

test("Target-free cycles compact their old aggregate", async (t) => {
    const f = await fixture(t)
    await f.open()
    for (let i = 0; i < 3; i++) {
        const s = await f.start()
        await read(await f.page(s.sweep, []))
        await read(await f.advance(s.sweep))
        f.advanceTime(60000)
    }
    assert.equal((await f.db.run((ctx) => ctx.db.query("cleanupSweeps").collect())).length, 1)
})

test("Overlapping workers receive exactly one atomic claim capability", async (t) => {
    const f = await fixture(t),
        p = await f.prepare(),
        target = p.targets[0]!
    const responses = await Promise.all([
            f.claim(target),
            f.claim(target, f.context(), target.message, "b".repeat(32)),
        ]),
        claims = await Promise.all(responses.map(read))
    assert.equal(claims.filter((r) => r.claimed).length, 1)
    assert.equal((await f.view()).targets[0].claimedAt, f.now())
})

test("Known unresolved publisher attempt protects its native ID without a current tracked post", async (t) => {
    const f = await fixture(t)
    await f.open()
    const message = f.message()
    await f.db.run((ctx) =>
        ctx.db.insert("publishingAttempts", {
            serverId: "1",
            postNo: 1,
            generation: 1,
            sourceId: "100",
            actorId: "10",
            botId: "999",
            action: "send",
            channelId: "30",
            messageId: message.messageId,
            content: { content: "" },
            canonicalContent: { content: "" },
            dispatchExpiresAt: f.now() - 1000,
            nativeDeadlineMs: 5000,
            outcome: "uncertain",
            unresolved: true,
            createdAt: f.now() - 121000,
            finishedAt: f.now() - 1000,
        }),
    )
    const preview = await read(await f.query({ type: "preview", channelId: "30", messages: [message] }))
    assert.equal(preview.items[0].reason, "protected")
    const s = await f.start(),
        page = await read(await f.page(s.sweep, [message]))
    assert.equal(page.targets.length, 0)
    assert.equal(page.page.items[0].reason, "protected")
})
test("Retention moves kept expired targets out of the way, so twenty of them never stop later expired targets from being removed", async (t) => {
    const f = await fixture(t)
    const { targets } = await f.prepare(
        Array.from({ length: 21 }, (_, index) => f.message(f.now() - 3600001 - index * 1000)),
    )
    const now = f.now(),
        last = targets.at(-1)!.targetNo
    await f.db.run(async (ctx) => {
        for (const target of targets) {
            const row = (await ctx.db
                .query("cleanupTargets")
                .withIndex("by_number", (q) => q.eq("serverId", "1").eq("targetNo", target.targetNo))
                .unique())!
            await ctx.db.patch(
                row._id,
                target.targetNo !== last
                    ? { active: true, expiresAt: now - 2 }
                    : { active: false, state: "skipped", noDispatch: true, expiresAt: now - 1 },
            )
        }
    })
    await f.cleanup()
    await f.cleanup()
    const rows = await f.db.run((ctx) => ctx.db.query("cleanupTargets").collect())
    assert.equal(rows.length, 20)
    assert(rows.every((row) => row.active && row.expiresAt === now + 86400000))
})

test("A batch claim reserves each eligible target once and settles pinned, bot and protected ones without a grant", async (t) => {
    const f = await fixture(t),
        p = await f.prepare(Array.from({ length: 5 }, (_, index) => f.message(f.now() - 3600001 - index * 1000))),
        [a, b, pinned, bot, kept] = p.targets as [
            CleanupTarget,
            CleanupTarget,
            CleanupTarget,
            CleanupTarget,
            CleanupTarget,
        ]
    await f.db.run((ctx) =>
        ctx.db.insert("publishingPosts", {
            serverId: "1",
            postNo: 1,
            generation: 1,
            channelId: "30",
            botId: "999",
            messageId: kept.messageId,
            outcome: "uncertain",
            createdAt: f.now(),
            updatedAt: f.now(),
        }),
    )
    const claimed = await read(
        await f.claimBatch(p.targets, {
            [pinned.messageId]: { pinned: true },
            [bot.messageId]: { authorBot: true },
        }),
    )
    assert.equal(claimed.type, "claimed-batch")
    assert.deepEqual(
        claimed.grants.map((grant: CleanupGrant) => grant.messageId),
        [a.messageId, b.messageId],
    )
    assert(claimed.grants.every((grant: CleanupGrant) => grant.dispatchExpiresAt === f.now() + CLEANUP_GRANT_MS))
    const state = await f.view()
    const byId = new Map<string, CleanupTarget>(
        state.targets.map((target: CleanupTarget) => [target.messageId, target]),
    )
    for (const target of [a, b]) {
        assert.equal(byId.get(target.messageId)!.state, "reserved")
        assert.notEqual(byId.get(target.messageId)!.claimedAt, undefined)
    }
    for (const [target, reason] of [
        [pinned, "pinned"],
        [bot, "bot"],
        [kept, "protected"],
    ] as const) {
        assert.equal(byId.get(target.messageId)!.state, "skipped")
        assert.equal(byId.get(target.messageId)!.reason, reason)
        assert.equal(byId.get(target.messageId)!.noDispatch, true)
    }
    assert.equal(state.sweep.counts.attempted, 2)
    // A second batch finds the first two reserved and has nothing to delete
    const again = await read(await f.claimBatch([a, b], {}, { claimToken: "b".repeat(32) }))
    assert.deepEqual(again.grants, [])
})

test("Overlapping batch claims give each target to exactly one of them", async (t) => {
    const f = await fixture(t),
        p = await f.prepare(Array.from({ length: 4 }, (_, index) => f.message(f.now() - 3600001 - index * 1000)))
    const [first, second] = await Promise.all([
        f.claimBatch(p.targets.slice(0, 3)).then(read),
        f.claimBatch(p.targets.slice(1), {}, { claimToken: "b".repeat(32) }).then(read),
    ])
    const ids = [...first.grants, ...second.grants].map((grant: CleanupGrant) => grant.messageId)
    assert.equal(ids.length, 4)
    assert.deepEqual(new Set(ids), new Set(p.targets.map((target) => target.messageId)))
    assert.equal((await f.view()).sweep.counts.attempted, 4)
})

test("A batch claim is refused for a changed sweep, mixed channels, repeated targets and a bot without authority", async (t) => {
    const f = await fixture(t),
        p = await f.prepare([f.message(), f.message(f.now() - 3600002)]),
        [a, b] = p.targets as [CleanupTarget, CleanupTarget]
    const stale = (target: CleanupTarget) => ({ ...f.targetBinding(target), policyRevision: target.policyRevision + 1 })
    await status(
        await f.work({
            type: "claim-batch",
            items: [{ binding: stale(a), message: { ...a.message, observedAt: f.now() } }],
            context: f.context(),
            claimToken: "a".repeat(32),
        }),
        409,
    )
    await status(await f.claimBatch([a, b], { [b.messageId]: { channelId: "31" } }), 400)
    await status(await f.claimBatch([a, a]), 400)
    await status(await f.claimBatch([a], {}, { context: { ...f.context(), botAuthorized: false } }), 403)
    // A message older than a minute is refused with the page it came from, so the bot reads it again
    await status(await f.claimBatch([a], { [a.messageId]: { observedAt: f.now() - 61000 } }), 400)
    await status(
        await f.work({ type: "claim-batch", items: [], context: f.context(), claimToken: "a".repeat(32) }),
        400,
    )
    assert.equal((await f.view()).sweep.counts.attempted, 0)
    assert((await f.view()).targets.every((target: CleanupTarget) => target.state === "queued"))
})

test("A batch outcome records every claimed target once, refuses another claim's token and keeps no dispatch distinct", async (t) => {
    const f = await fixture(t),
        p = await f.prepare(Array.from({ length: 3 }, (_, index) => f.message(f.now() - 3600001 - index * 1000))),
        [a, b, c] = p.targets as [CleanupTarget, CleanupTarget, CleanupTarget]
    const claimed = await read(await f.claimBatch([a, b]))
    await status(await f.outcomeBatch(claimed.grants, "deleted", { claimToken: "b".repeat(32) }), 403)
    assert((await f.view()).targets.filter((target: CleanupTarget) => target.state === "reserved").length === 2)
    const recorded = await read(await f.outcomeBatch(claimed.grants, "deleted"))
    assert.deepEqual(recorded, { type: "outcome-batch", recorded: 2 })
    assert.deepEqual(await read(await f.outcomeBatch(claimed.grants, "deleted")), {
        type: "outcome-batch",
        recorded: 0,
    })
    const state = await f.view()
    assert.equal(state.sweep.counts.acknowledged, 2)
    assert.equal(state.sweep.counts.submitted, 2)
    for (const target of [a, b])
        assert.equal(state.targets.find((x: CleanupTarget) => x.messageId === target.messageId).state, "deleted")
    // A bulk request that was never sent fails its targets with no dispatch, and an unclaimed target takes no outcome
    await status(await f.outcomeBatch([c], "failed", { claimToken: "a".repeat(32), noDispatch: true }), 409)
    const second = await read(await f.claimBatch([c]))
    await read(await f.outcomeBatch(second.grants, "failed", { claimToken: "a".repeat(32), noDispatch: true }))
    const failed = (await f.view()).targets.find((x: CleanupTarget) => x.messageId === c.messageId)
    assert.equal(failed.state, "failed")
    assert.equal(failed.noDispatch, true)
    // A deleted outcome cannot claim that nothing was sent
    await status(await f.outcomeBatch(second.grants, "deleted", { claimToken: "a".repeat(32), noDispatch: true }), 400)
    assert.equal((await read(await f.advance(p.sweep))).recorded, true)
})

test("A channel whose sweep reached its end rests before the next one, and an unfinished sweep is due again at once", async (t) => {
    const f = await fixture(t),
        p = await f.prepare([f.message(), f.message(f.now() - 3600002)])
    await read(await f.outcome(p.targets[0]!, "skipped", { noDispatch: true }))
    await read(await f.outcome(p.targets[1]!, "skipped", { noDispatch: true }))
    await read(await f.advance(p.sweep))
    assert.equal((await f.policy()).nextCheckAt, f.now())
    assert.equal((await read(await f.work({ type: "list" }))).policies.length, 1)
    const last = await read(await f.page((await f.view()).sweep, []))
    assert.equal(last.page.empty, true)
    assert.equal((await read(await f.advance((await f.view()).sweep))).complete, true)
    assert.equal((await f.policy()).nextCheckAt, f.now() + CLEANUP_REST_MS)
    assert.equal((await read(await f.work({ type: "list" }))).policies.length, 0)
    f.advanceTime(CLEANUP_REST_MS)
    assert.equal((await read(await f.work({ type: "list" }))).policies.length, 1)
})

test("A page with a failed or unconfirmed deletion waits a minute before the channel's next page", async (t) => {
    const f = await fixture(t),
        p = await f.prepare([f.message(), f.message(f.now() - 3600002)])
    await read(await f.claim(p.targets[0]!))
    await read(await f.outcome(p.targets[0]!, "failed"))
    await read(await f.outcome(p.targets[1]!, "skipped", { noDispatch: true }))
    assert.equal((await read(await f.advance(p.sweep))).recorded, true)
    assert.equal((await f.policy()).nextCheckAt, f.now() + 60000)
    assert.equal((await read(await f.work({ type: "list" }))).policies.length, 0)
    f.advanceTime(60000)
    assert.equal((await read(await f.work({ type: "list" }))).policies.length, 1)
})

test("A deletion that was not confirmed leaves the inbox after a week and expires like any other", async (t) => {
    const f = await fixture(t),
        p = await f.prepare([f.message()]),
        target = p.targets[0]!
    await read(await f.claim(target))
    await read(await f.outcome(target, "uncertain"))
    await read(await f.advance(p.sweep))
    const current = await f.policy()
    await read(await f.manage({ type: "enable", channelId: "30", expectedRevision: current.revision, enabled: false }))
    const entries = async () =>
        (await f.http("/recovery/list", { serverId: "1" }).then(read)).entries.filter(
            (entry: { source: string }) => entry.source === "cleanup",
        )
    assert.equal((await entries()).length, 1)
    f.advanceTime(7 * CLEANUP_DAY + 1)
    assert.equal((await entries()).length, 0)
    f.advanceTime(CLEANUP_RETENTION - 7 * CLEANUP_DAY)
    await f.cleanup()
    assert.equal((await f.db.run((ctx) => ctx.db.query("cleanupTargets").collect())).length, 0)
})

test("A policy can be deleted while a not confirmed deletion is still within its retention", async (t) => {
    const f = await fixture(t),
        p = await f.prepare([f.message()]),
        target = p.targets[0]!
    await read(await f.claim(target))
    await read(await f.outcome(target, "uncertain"))
    await read(await f.advance(p.sweep))
    const current = await f.policy()
    await read(await f.manage({ type: "enable", channelId: "30", expectedRevision: current.revision, enabled: false }))
    const after = await f.policy()
    await f.db.run((ctx) =>
        applyCleanupManagement(
            ctx,
            { serverId: "1", actorId: "10", createdAt: f.now(), source: { kind: "job", jobId: "job1" } },
            undefined,
            { type: "policy-delete", channelId: "30", expectedRevision: after.revision, confirm: true },
        ),
    )
    await status(await f.query({ type: "show", channelId: "30" }), 404)
})

test("A channel without a cleanup policy is refused with a sentence that says so", async (t) => {
    const f = await fixture(t)
    await f.open()
    await refused(await f.query({ type: "show", channelId: "31" }), 404, /No cleanup is set up for that channel/)
})
