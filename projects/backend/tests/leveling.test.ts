import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import { Schema } from "effect"
import {
    LevelingQueryResult,
    LevelingWorkResult,
    type LevelingCandidate,
    type LevelingFence,
    type LevelingManageOperation,
    type LevelingMemberContext,
} from "@neonflux/contracts/leveling"
import type { RolesMemberContext } from "@neonflux/contracts/shared"
import { cleanupLeveling } from "../convex/levelingCleanup.ts"
import { levelForXp, LEVELING_DAY, LEVELING_WINDOW } from "../convex/levelingDomain.ts"
import { retentionPass } from "../convex/retentionStore.ts"
import { convexBackend } from "./convex-backend.ts"
import { botCall } from "./bot-service.ts"
import { countedProfile } from "./schema-documents.ts"

const oldServer = process.env.NEONFLUX_SERVER_ID,
    oldSecret = process.env.NEONFLUX_BOT_API_SECRET
const secret = "synthetic-leveling-secret-not-a-credential-000"
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
    "../convex/leveling.ts": () => import("../convex/leveling.ts"),
    "../convex/levelingWork.ts": () => import("../convex/levelingWork.ts"),
    "../convex/levelingCleanup.ts": () => import("../convex/levelingCleanup.ts"),
    "../convex/roles.ts": () => import("../convex/roles.ts"),
    "../convex/roleParticipation.ts": () => import("../convex/roleParticipation.ts"),
    "../convex/roleLifecycle.ts": () => import("../convex/roleLifecycle.ts"),
    "../convex/roleReactions.ts": () => import("../convex/roleReactions.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/metadataLogsWork.ts": () => import("../convex/metadataLogsWork.ts"),
    "../convex/schedulesDelivery.ts": () => import("../convex/schedulesDelivery.ts"),
    "../convex/milestonesDelivery.ts": () => import("../convex/milestonesDelivery.ts"),
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
const human = { ...owner, userId: "20", isOwner: false }
const joinedAt = "2023-11-14T22:00:00.000000Z"
const member = (userId = "20", roleIds: string[] = []): LevelingMemberContext => ({
    userId,
    joinedAt,
    roleIds,
    isBot: false,
    timeoutUntil: null,
})
const roles = Array.from({ length: 25 }, (_, index) => ({
    roleId: String(40 + index),
    permissions: "0",
    botCanManage: true,
    actorCanManage: true,
}))
const native = (roleIds: string[] = [], userId = "20"): RolesMemberContext => ({
    ...member(userId, roleIds),
    botId: "999",
    botAuthorized: true,
    roles,
})
async function read(response: Response): Promise<any> {
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
    return response.json()
}
async function status(response: Response, expected: number) {
    assert.equal(response.status, expected, JSON.stringify(await response.clone().json()))
    assert(!JSON.stringify(await response.json()).includes(secret))
}
function fixture(t: TestContext) {
    let now = 1700000000000,
        sequence = 1000
    t.mock.method(Date, "now", () => now)
    const db = convexBackend(modules)
    const source = () => ({ serverId: "1", messageId: String(++sequence), createdAt: now })
    const http = (path: string, body: unknown, auth = true) => botCall(db, path, body, auth ? {} : { secret: null })
    const manageRequest = (operation: LevelingManageOperation, actor = owner) => ({ ...source(), actor, operation })
    const manage = (operation: LevelingManageOperation, actor = owner) =>
        http("/levels/manage", manageRequest(operation, actor))
    const query = (operation: unknown, actor = human, current = member(actor.userId)) =>
        http("/levels/query", { serverId: "1", actor, member: current, observedAt: now, operation })
    const candidate = (userId = "20", channelId = "30"): LevelingCandidate => {
        const current = source()
        return {
            messageId: current.messageId,
            createdAt: current.createdAt,
            userId,
            channelId,
            digest: (++sequence).toString(16).padStart(64, "0"),
        }
    }
    const preflight = (candidate: LevelingCandidate) => http("/levels/preflight", { serverId: "1", candidate })
    const awardRequest = async (candidate: LevelingCandidate, current = member(candidate.userId)) => {
        const ready = await read(await preflight(candidate))
        assert(ready.eligible)
        return {
            serverId: "1",
            candidate,
            policyRevision: ready.policyRevision,
            fence: ready.fence as LevelingFence,
            member: current,
            observedAt: now,
        }
    }
    const award = async (candidate: LevelingCandidate, current = member(candidate.userId)) =>
        http("/levels/award", await awardRequest(candidate, current))
    const enable = () => manage({ type: "settings", expectedRevision: 1, patch: { enabled: true } })
    const adjust = (xp: number, userId = "20") =>
        manage({ type: "adjust", userId, xp, reason: "Synthetic score correction" })
    const mappings = (count = 1, revision = 1) =>
        manage({
            type: "mappings",
            expectedMappingRevision: revision,
            mappings: roles.slice(0, count).map((role, index) => ({ level: index + 1, roleId: role.roleId })),
            roles,
        })
    const work = (operation: unknown) => http("/levels/work", { serverId: "1", operation })
    const list = async () => (await read(await work({ type: "list" }))).accounts
    const page = async (userId = "20") => {
        const account = (await list()).find((row: any) => row.userId === userId)
        assert(account, "Expected a due dirty account")
        return account
    }
    const evaluate = (page: any, index = 0, context = native()) =>
        http("/roles/evaluate", {
            serverId: "1",
            sourceId: page.targets[index].sourceId,
            createdAt: now,
            context,
            operation: { type: "level-sync", roleId: page.targets[index].roleId },
        })
    const checkpoint = (page: any) => work({ type: "done", userId: page.userId, mark: page.mark, complete: true })
    const roleBinding = (grant: any) => ({
        serverId: "1",
        attemptId: grant.attemptId,
        ownershipId: grant.ownershipId,
        generation: grant.generation,
        sourceId: grant.sourceId,
    })
    const dispatch = (grant: any, context = native()) =>
        http("/roles/dispatch", { ...roleBinding(grant), context, claimToken: "b".repeat(32) })
    const outcome = (grant: any, value = "succeeded", claimed = true) =>
        http("/roles/outcome", {
            ...roleBinding(grant),
            ...(claimed ? { claimToken: "b".repeat(32) } : {}),
            outcome: value,
        })
    const apply = async (grant: any, context = native()) => {
        assert.equal((await read(await dispatch(grant, context))).claimed, true)
        await read(await outcome(grant))
    }
    const mappingPage = (userId = "20") => page(userId)
    return {
        db,
        source,
        http,
        manageRequest,
        manage,
        query,
        candidate,
        preflight,
        awardRequest,
        award,
        enable,
        adjust,
        mappings,
        work,
        list,
        page,
        evaluate,
        checkpoint,
        roleBinding,
        dispatch,
        outcome,
        apply,
        mappingPage,
        advance: (ms: number) => {
            now += ms
        },
        now: () => now,
    }
}

test("Level routes authenticate before decoding, isolate the server and return disabled defaults without collection", async (t) => {
    const f = fixture(t)
    for (const route of ["manage", "query", "preflight", "award", "work"]) {
        await status(await f.http(`/levels/${route}`, "Synthetic malformed body", false), 401)
        await status(await f.http(`/levels/${route}`, { serverId: "2" }), 403)
    }
    const defaults = await read(await f.query({ type: "settings" }, owner))
    assert.deepEqual(defaults.settings, {
        enabled: false,
        xpPerMessage: 15,
        cooldownSeconds: 60,
        excludedChannelIds: [],
        excludedRoleIds: [],
        revision: 1,
        mappingRevision: 1,
        scoreEpoch: 1,
        mappings: [],
    })
    assert.deepEqual(await read(await f.preflight(f.candidate())), { eligible: false, reason: "disabled" })
    assert.equal((await f.db.run((c) => c.db.query("levelingSettings").collect())).length, 0)
    await status(
        await f.enable().then(async (response) => {
            await read(response)
            return f.manage({ type: "settings", expectedRevision: 2, patch: { xpPerMessage: 10 } }, human)
        }),
        403,
    )
    await status(await f.query({ type: "rank" }, human, member("21")), 403)
    await status(await f.query({ type: "status" }), 403)
    await status(await f.http("/levels/query", { serverId: "1", private: "x".repeat(262145) }), 413)
})

test("Configuration validates finite limits, source bindings and independent policy/mapping revisions", async (t) => {
    const f = fixture(t),
        request = f.manageRequest({
            type: "settings",
            expectedRevision: 1,
            patch: { enabled: true, xpPerMessage: 100, cooldownSeconds: 15 },
        })
    await read(await f.http("/levels/manage", request))
    assert.deepEqual(await read(await f.http("/levels/manage", request)), { duplicate: true })
    await status(
        await f.http("/levels/manage", { ...request, operation: { ...request.operation, patch: { enabled: false } } }),
        409,
    )
    for (const patch of [
        { xpPerMessage: 0 },
        { xpPerMessage: 101 },
        { cooldownSeconds: 14 },
        { cooldownSeconds: 3601 },
        { excludedChannelIds: Array.from({ length: 501 }, (_, i) => String(i + 1)) },
        { onlyChannelIds: Array.from({ length: 501 }, (_, i) => String(i + 1)) },
        { excludedRoleIds: Array.from({ length: 251 }, (_, i) => String(i + 1)) },
        { unknown: true },
    ])
        await status(await f.manage({ type: "settings", expectedRevision: 2, patch } as LevelingManageOperation), 400)
    const map = await read(await f.mappings())
    assert.equal(map.settings.revision, 2)
    assert.equal(map.settings.mappingRevision, 2)
    await status(await f.mappings(1), 409)
    await status(
        await f.manage({
            type: "mappings",
            expectedMappingRevision: 2,
            mappings: [{ level: 1, roleId: "1" }],
            roles: [{ ...roles[0]!, roleId: "1" }],
        }),
        403,
    )
    await status(
        await f.manage({
            type: "mappings",
            expectedMappingRevision: 2,
            mappings: Array.from({ length: 251 }, (_, i) => ({ level: i + 1, roleId: String(i + 40) })),
            roles,
        }),
        400,
    )
    await status(
        await f.http("/moderation/manage", {
            ...f.source(),
            actor: owner,
            operation: { type: "settings", patch: { staffRoleIds: { security: ["40"] } } },
        }),
        409,
    )
})

test("Leveling skips up to 500 channels and 250 roles, and the 51st excluded channel and the last excluded role earn no XP", async (t) => {
    const f = fixture(t),
        ids = (from: number, count: number) => Array.from({ length: count }, (_, i) => String(from + i))
    const saved = await read(
        await f.manage({
            type: "settings",
            expectedRevision: 1,
            patch: { enabled: true, excludedChannelIds: ids(1000, 500), excludedRoleIds: ids(5000, 250) },
        }),
    )
    assert.equal(saved.settings.excludedChannelIds.length, 500)
    assert.equal(saved.settings.excludedRoleIds.length, 250)
    assert.equal((await read(await f.preflight(f.candidate("20", "1050")))).reason, "excluded")
    assert.equal((await read(await f.preflight(f.candidate("20", "1499")))).reason, "excluded")
    assert.equal((await read(await f.award(f.candidate("21", "30"), member("21", ["5249"])))).reason, "excluded")
    assert.equal((await read(await f.award(f.candidate("20", "30")))).awarded, true)
})

test("Only up to 500 listed channels and their threads earn XP, excluded channels still apply, and an empty list lets every channel earn again", async (t) => {
    const f = fixture(t),
        ids = (from: number, count: number) => Array.from({ length: count }, (_, i) => String(from + i))
    const saved = await read(
        await f.manage({
            type: "settings",
            expectedRevision: 1,
            patch: { enabled: true, onlyChannelIds: ids(1000, 500), excludedChannelIds: ["1001"] },
        }),
    )
    assert.equal(saved.settings.onlyChannelIds.length, 500)
    assert.equal((await read(await f.preflight(f.candidate("20", "30")))).reason, "excluded")
    assert.equal((await read(await f.preflight(f.candidate("20", "1001")))).reason, "excluded")
    assert.equal((await read(await f.preflight(f.candidate("20", "1499")))).eligible, true)
    // A thread of a listed channel earns, one of another channel does not
    assert.equal(
        (await read(await f.preflight({ ...f.candidate("20", "33"), parentChannelId: "1002" }))).eligible,
        true,
    )
    assert.equal(
        (await read(await f.preflight({ ...f.candidate("20", "33"), parentChannelId: "30" }))).reason,
        "excluded",
    )
    assert.equal((await read(await f.award(f.candidate("20", "1499")))).awarded, true)
    // Repeated IDs are dropped, and an empty list leaves the field out so every channel earns again
    const repeated = await read(
        await f.manage({ type: "settings", expectedRevision: 2, patch: { onlyChannelIds: ["1000", "1000"] } }),
    )
    assert.deepEqual(repeated.settings.onlyChannelIds, ["1000"])
    const every = await read(await f.manage({ type: "settings", expectedRevision: 3, patch: { onlyChannelIds: [] } }))
    assert.equal(Object.hasOwn(every.settings, "onlyChannelIds"), false)
    assert.equal((await read(await f.preflight(f.candidate("21", "30")))).eligible, true)
    assert.equal((await read(await f.preflight(f.candidate("21", "1001")))).reason, "excluded")
})

test("Atomic awards enforce both clocks, digest windows, source replay and fresh member/exclusion evidence without role authority", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    const first = f.candidate(),
        request = await f.awardRequest(first),
        second = f.candidate(),
        secondRequest = await f.awardRequest(second)
    const results = await Promise.all([f.http("/levels/award", request), f.http("/levels/award", request)])
    const answers = await Promise.all(results.map(read))
    assert.deepEqual(answers.map((r) => r.awarded).sort(), [false, true])
    // The award names when the member earns again, and a refusal inside that wait names the same time
    const waitEnds = first.createdAt + 60000
    assert.equal(answers.find((r) => r.awarded).nextAt, waitEnds)
    assert.deepEqual(await read(await f.preflight(f.candidate())), {
        eligible: false,
        reason: "cooldown",
        nextAt: waitEnds,
    })
    assert.deepEqual(await read(await f.http("/levels/award", secondRequest)), {
        awarded: false,
        reason: "cooldown",
        nextAt: waitEnds,
    })
    assert.equal((await read(await f.query({ type: "rank" }))).profile.xp, 15)
    f.advance(60000)
    assert.equal((await read(await f.preflight({ ...f.candidate(), digest: first.digest }))).reason, "duplicate")
    f.advance(60000)
    assert.equal(
        (await read(await f.preflight({ ...f.candidate(), createdAt: first.createdAt + 30000 }))).reason,
        "cooldown",
    )
    await read(
        await f.manage({
            type: "settings",
            expectedRevision: 2,
            patch: { excludedChannelIds: ["31"], excludedRoleIds: ["40"] },
        }),
    )
    assert.equal((await read(await f.preflight(f.candidate("20", "31")))).reason, "excluded")
    // A thread of an excluded channel is excluded too
    assert.equal(
        (await read(await f.preflight({ ...f.candidate("20", "33"), parentChannelId: "31" }))).reason,
        "excluded",
    )
    await status(await f.preflight({ ...f.candidate("20", "33"), parentChannelId: "33" }), 400)
    assert.equal((await read(await f.award(f.candidate(), member("20", ["40"])))).reason, "excluded")
    assert.equal((await read(await f.award(f.candidate(), { ...member(), isBot: true }))).reason, "membership")
    assert.equal(
        (await read(await f.award(f.candidate(), { ...member(), joinedAt: new Date(f.now() + 1).toISOString() })))
            .reason,
        "membership",
    )
    assert.equal(
        (await read(await f.preflight({ ...f.candidate(), createdAt: f.now() - LEVELING_WINDOW - 1 }))).reason,
        "stale",
    )
    assert.equal((await read(await f.preflight({ ...f.candidate(), createdAt: f.now() + 1001 }))).reason, "stale")
    const fresh = await f.awardRequest(f.candidate())
    await status(await f.http("/levels/award", { ...fresh, observedAt: f.now() - 60001 }), 400)
    await status(
        await f.http("/levels/preflight", {
            serverId: "1",
            candidate: { ...f.candidate(), content: "Synthetic body forbidden" },
        }),
        400,
    )
})

test("An award names the new level for a level-up message only while they are on, and only reward levels when asked", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    const settings = async () => (await read(await f.query({ type: "settings" }, owner))).settings
    const patch = async (value: object) =>
        read(await f.manage({ type: "settings", expectedRevision: (await settings()).revision, patch: value }))
    // Each award adds 100 XP after a correction just below the next level, so it crosses into that level
    const award = async (from: number) => {
        await read(await f.adjust(from))
        f.advance(60000)
        return read(await f.award(f.candidate()))
    }
    await patch({ xpPerMessage: 100 })
    assert.equal((await settings()).levelUp, undefined)
    assert.deepEqual([(await award(50)).profile.level, (await award(50)).levelUp], [1, undefined])
    await patch({ levelUp: { channelId: null, rewardsOnly: false } })
    assert.deepEqual((await award(350)).levelUp, { level: 2, channelId: null })
    // An award inside the same level announces nothing
    assert.equal((await award(150)).levelUp, undefined)
    // A higher level names that level
    assert.deepEqual((await award(1550)).levelUp, { level: 4, channelId: null })
    await read(await f.mappings(3))
    await patch({ levelUp: { channelId: "31", rewardsOnly: true } })
    assert.deepEqual((await settings()).levelUp, { channelId: "31", rewardsOnly: true })
    assert.deepEqual((await award(850)).levelUp, { level: 3, channelId: "31" })
    assert.equal((await award(1550)).levelUp, undefined)
    await patch({ levelUp: null })
    assert.equal("levelUp" in (await settings()), false)
    assert.equal((await award(350)).levelUp, undefined)
})

test("Reset cutoffs reject pre-reset queues even with a first preflight after reset and retain anti-replay/account fences", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    const first = f.candidate()
    await read(await f.award(first))
    f.advance(60000)
    const queued = f.candidate(),
        prepared = await f.awardRequest(queued)
    const before = await f.db.run((c) => c.db.query("levelingProfiles").first())
    await read(
        await f.manage({
            type: "reset-member",
            userId: "20",
            confirm: "reset-member",
            reason: "Synthetic member reset",
        }),
    )
    assert.equal((await read(await f.preflight(queued))).reason, "stale")
    assert.equal((await read(await f.http("/levels/award", prepared))).reason, "fence")
    let after = (await f.db.run((c) => c.db.query("levelingProfiles").first()))!
    assert.equal(after.lastAwardAt, before!.lastAwardAt)
    assert.deepEqual(after.digests, before!.digests)
    assert.equal(after.adjustmentRevision, 1)
    f.advance(1)
    await read(await f.award(f.candidate()))
    f.advance(60000)
    const queuedGlobal = f.candidate()
    await read(await f.manage({ type: "reset-server", confirm: "reset-server", reason: "Synthetic server reset" }))
    assert.equal((await read(await f.query({ type: "rank" }))).profile.xp, 0)
    assert.equal((await read(await f.query({ type: "leaderboard" }))).profiles.length, 0)
    assert.equal((await read(await f.preflight(queuedGlobal))).reason, "stale")
    f.advance(1)
    const result = await read(await f.award(f.candidate()))
    assert.equal(result.profile.xp, 15)
    assert.equal(result.profile.fence.adjustmentRevision, 1)
    after = (await f.db.run((c) => c.db.query("levelingProfiles").first()))!
    assert.equal(after.scoreEpoch, 2)
    assert.equal(after.digests.length, 3)
    const receipts = await f.db.run((c) => c.db.query("levelingAwardReceipts").collect())
    assert.equal(receipts.length, 3)
    const audits = await read(await f.query({ type: "audits" }, owner))
    assert.deepEqual(
        audits.audits.map((a: any) => a.type),
        ["reset-server", "reset-member"],
    )
})

test("Policy and account fences reject reset/correction/settings races while bounded score caps and rejoin keep the account", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    const prepared = await f.awardRequest(f.candidate())
    await read(await f.adjust(100))
    assert.equal((await read(await f.http("/levels/award", prepared))).reason, "fence")
    const next = await f.awardRequest(f.candidate())
    await read(await f.manage({ type: "settings", expectedRevision: 2, patch: { xpPerMessage: 100 } }))
    assert.equal((await read(await f.http("/levels/award", next))).reason, "fence")
    await read(await f.adjust(99999999, "20"))
    const rejoined = { ...member(), joinedAt: new Date(f.now() - 1000).toISOString() }
    const capped = await read(await f.award(f.candidate(), rejoined))
    assert.equal(capped.xpAdded, 1)
    assert.equal(capped.profile.xp, 100000000)
    assert.equal(capped.profile.level, 1000)
    assert.equal(capped.profile.nextLevelXp, null)
    assert.equal((await f.db.run((c) => c.db.query("levelingProfiles").collect())).length, 1)
    assert.equal(levelForXp(99), 0)
    assert.equal(levelForXp(100), 1)
    assert.equal(levelForXp(399), 1)
    assert.equal(levelForXp(400), 2)
})

test("A delayed older correction cannot restore a score that a newer correction replaced", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    const older = f.manageRequest({ type: "adjust", userId: "20", xp: 100, reason: "Synthetic older correction" })
    f.advance(1)
    await read(await f.adjust(400))
    await status(await f.http("/levels/manage", older), 409)
    assert.equal((await read(await f.query({ type: "rank" }))).profile.xp, 400)
})

test("Leaderboard tie continuation is bounded and stable, tied members share one exact rank and reset invalidates old cursors", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    // 1,022 profiles in level 1, counted as awards count them
    await f.db.run(async (ctx) => {
        for (let n = 1000; n < 2022; n++) {
            const xp = n < 1025 ? 200 : 100
            await ctx.db.insert("levelingProfiles", {
                serverId: "1",
                userId: String(n),
                xp,
                scoreEpoch: 1,
                adjustmentRevision: 0,
                digests: [],
                ...(await countedProfile(ctx, "1", xp)),
            })
        }
    })
    const pages: string[] = []
    let cursor: any
    for (let n = 0; n < 3; n++) {
        const page = await read(await f.query({ type: "leaderboard", ...(cursor ? { cursor } : {}) }))
        assert(page.profiles.length <= 10)
        pages.push(...page.profiles.map((p: any) => p.userId))
        cursor = page.nextCursor
    }
    assert.equal(new Set(pages).size, 30)
    assert.deepEqual(
        pages.slice(0, 25),
        Array.from({ length: 25 }, (_, i) => String(1024 - i)),
    )
    // The 25 at 200 XP share the first place, and the 997 at 100 XP share the place after them
    assert.deepEqual((await read(await f.query({ type: "rank", userId: "1000" }))).rank, {
        type: "exact",
        position: 1,
        tied: 24,
    })
    assert.deepEqual((await read(await f.query({ type: "rank", userId: "1025" }))).rank, {
        type: "exact",
        position: 26,
        tied: 996,
    })
    await status(await f.query({ type: "leaderboard", cursor: { xp: -1, userId: "1", scoreEpoch: 1 } }), 400)
    await read(await f.manage({ type: "reset-server", confirm: "reset-server", reason: "Synthetic pagination reset" }))
    await status(await f.query({ type: "leaderboard", cursor }), 409)
})

test("Audit pages hold ten entries, newest first, and continue before the last one shown", async (t) => {
    const f = fixture(t)
    await f.db.run(async (ctx) => {
        for (let auditNo = 1; auditNo <= 11; auditNo++)
            await ctx.db.insert("levelingAudits", {
                serverId: "1",
                auditNo,
                actorId: "10",
                userId: "20",
                beforeXp: 0,
                afterXp: auditNo,
                reason: "Synthetic audit",
                createdAt: f.now(),
                type: "adjust",
                scoreEpoch: 1,
                expiresAt: f.now() + LEVELING_DAY,
            })
    })
    const first = await read(await f.query({ type: "audits" }, owner))
    assert.deepEqual(
        first.audits.map((a: any) => a.auditNo),
        [11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
    )
    assert.equal(first.nextBeforeAuditNo, 2)
    const second = await read(await f.query({ type: "audits", beforeAuditNo: first.nextBeforeAuditNo }, owner))
    assert.deepEqual(
        second.audits.map((a: any) => a.auditNo),
        [1],
    )
    assert.equal(second.nextBeforeAuditNo, undefined)
})

test("A server with 50,000 members with a score still gives XP to the next new member and counts them", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    await read(await f.adjust(0))
    const state = (await f.db.run((c) => c.db.query("levelingSettings").first()))!
    await f.db.run((c) => c.db.patch(state._id, { profiles: 50000 }))
    assert.equal((await read(await f.preflight(f.candidate("21")))).eligible, true)
    assert.equal((await read(await f.award(f.candidate("21")))).awarded, true)
    assert.equal((await read(await f.award(f.candidate()))).awarded, true)
    assert.equal((await f.db.run((c) => c.db.query("levelingProfiles").collect())).length, 2)
    const status = await read(await f.query({ type: "status" }, owner, member(owner.userId)))
    assert.equal(status.profiles, 50001)
    // The bot reads a status and a rank past 50,000 members
    assert.doesNotThrow(() => Schema.decodeUnknownSync(LevelingQueryResult)(status))
    const rank = await read(await f.query({ type: "rank", userId: "21" }, owner, member(owner.userId)))
    assert.doesNotThrow(() =>
        Schema.decodeUnknownSync(LevelingQueryResult)({
            ...rank,
            rank: { type: "exact", position: 50001, tied: 50000 },
        }),
    )
})

test("Reward attempts survive a new correction and a newer mark fences the older pass", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    await read(await f.mappings())
    await read(await f.adjust(100))
    const page = await f.mappingPage(),
        result = await read(await f.evaluate(page)),
        grant = result.grant
    assert(grant)
    assert.deepEqual(JSON.parse((await f.db.run((c) => c.db.query("roleAttempts").first()))!.operationKey), {
        type: "level-sync",
        roleId: "40",
    })
    await f.apply(grant)
    await read(await f.checkpoint(page))
    await read(await f.adjust(0, "20"))
    const withdrawal = await f.page(),
        removal = (await read(await f.evaluate(withdrawal, 0, native(["40"])))).grant
    assert.equal(removal.action, "remove")
    assert.equal((await read(await f.dispatch(removal, native(["40"])))).claimed, true)
    await read(await f.adjust(100, "20"))
    await read(await f.outcome(removal))
    assert.deepEqual(await read(await f.checkpoint(withdrawal)), { type: "progress", recorded: false })
    const queued = await f.list()
    assert.equal(queued[0].mark > withdrawal.mark, true)
})

test("A retried reward pass re-adds a role when the member rejoined after an earlier success", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    await read(await f.mappings())
    await read(await f.adjust(100))
    const page = await f.mappingPage()
    await f.apply((await read(await f.evaluate(page))).grant)
    const rejoined = { ...native(), joinedAt: new Date(f.now() - 1000).toISOString() },
        retried = await read(await f.evaluate(page, 0, rejoined))
    assert.equal(retried.status, "reserved")
    assert.equal(retried.grant.joinedAt, rejoined.joinedAt)
})

test("All reward intent changes and newer intent source are checked before the one-time native claim", async (t) => {
    for (const change of ["adjust", "mapping", "reset", "intent"] as const) {
        const f = fixture(t)
        await read(await f.enable())
        await read(await f.mappings())
        await read(await f.adjust(100))
        const page = await f.mappingPage(),
            grant = (await read(await f.evaluate(page))).grant
        if (change === "adjust") await read(await f.adjust(0, "20"))
        if (change === "mapping") await read(await f.mappings(0, 2))
        if (change === "reset")
            await read(
                await f.manage({ type: "reset-server", confirm: "reset-server", reason: "Synthetic fence reset" }),
            )
        if (change === "intent")
            await f.db.run(async (c) => {
                const row = (await c.db.query("roleOwnership").first())!
                await c.db.patch(row._id, { intentSourceId: "newer_intent" })
            })
        const response = await f.dispatch(grant)
        if (change === "intent") assert.equal((await read(response)).claimed, false)
        else await status(response, 409)
        await read(await f.outcome(grant, "failed", false))
    }
})

test("Blocked and uncertain first roles do not starve later roles or members and dirty updates fence old completions", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    await read(await f.mappings(12))
    await read(await f.adjust(20000))
    await read(await f.adjust(20000, "21"))
    let page = await f.mappingPage(),
        grant = (await read(await f.evaluate(page, 0))).grant
    assert.equal((await read(await f.dispatch(grant))).claimed, true)
    await read(await f.outcome(grant, "uncertain"))
    for (let index = 1; index < page.targets.length; index++) {
        const g = (await read(await f.evaluate(page, index))).grant
        await f.apply(g)
    }
    assert.equal(page.targets.length, 12)
    assert.deepEqual(await read(await f.work({ type: "done", userId: "20", mark: page.mark, complete: false })), {
        type: "progress",
        recorded: true,
    })
    assert.equal(
        (await f.list()).some((row: any) => row.userId === "21"),
        true,
    )
    const deferred = (await f.db.run((c) =>
        c.db
            .query("levelingProfiles")
            .withIndex("by_user", (q) => q.eq("serverId", "1").eq("userId", "20"))
            .unique(),
    ))!
    assert.equal(deferred.rewardDueAt! >= f.now() + 60000, true)
    f.advance(60000)
    page = await f.page()
    assert.equal((await read(await f.evaluate(page, 0))).status, "blocked")
    const peer = await f.mappingPage("21")
    await read(await f.adjust(100, "21"))
    assert.deepEqual(await read(await f.checkpoint(peer)), { type: "progress", recorded: false })
    assert.equal(
        (await f.list()).some((row: any) => row.userId === "21" && row.mark > peer.mark),
        true,
    )
})

test("Demotion withdraws level references while disabled and preserves preexisting and other-consumer roles", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    await read(await f.mappings(2))
    await read(await f.adjust(400))
    const page = await f.mappingPage(),
        first = (await read(await f.evaluate(page, 0))).grant
    await f.apply(first)
    assert.equal((await read(await f.evaluate(page, 1, native(["40", "41"])))).grant, undefined)
    await read(await f.checkpoint(page))
    await f.db.run(async (ctx) => {
        const owner = (await ctx.db
            .query("roleOwnership")
            .withIndex("by_server_member_role", (q) =>
                q.eq("serverId", "1").eq("userId", "20").eq("joinedAt", joinedAt).eq("roleId", "40"),
            )
            .unique())!
        await ctx.db.insert("roleReferences", {
            serverId: "1",
            consumerKey: "autorole:1",
            roleId: "40",
            configuration: false,
            desired: true,
            ownershipId: owner._id,
            createdAt: f.now(),
        })
    })
    await read(await f.manage({ type: "settings", expectedRevision: 2, patch: { enabled: false } }))
    await read(await f.adjust(0, "20"))
    const withdrawal = await f.page()
    for (let index = 0; index < withdrawal.targets.length; index++)
        assert.equal((await read(await f.evaluate(withdrawal, index, native(["40", "41"])))).grant, undefined)
    const refs = await f.db.run((c) => c.db.query("roleReferences").collect())
    assert.equal(
        refs.some((x) => x.consumerKey === "autorole:1"),
        true,
    )
    assert.equal(refs.filter((x) => !x.configuration && x.consumerKey === "level").length, 0)
})

test("Mapping clear queues owned withdrawal while disabled and unavailable verification cannot grant", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    await read(await f.mappings())
    await read(await f.adjust(100))
    let page = await f.mappingPage()
    await f.apply((await read(await f.evaluate(page))).grant)
    await read(await f.checkpoint(page))
    await read(await f.manage({ type: "settings", expectedRevision: 2, patch: { enabled: false } }))
    await read(await f.mappings(0, 2))
    page = await f.page()
    const removal = (await read(await f.evaluate(page, 0, native(["40"])))).grant
    assert.equal(removal.action, "remove")
    await f.apply(removal, native(["40"]))
    await read(await f.checkpoint(page))
    assert.equal((await f.db.run((c) => c.db.query("roleReferences").collect())).length, 0)
    await read(await f.manage({ type: "settings", expectedRevision: 3, patch: { enabled: true } }))
    await read(await f.mappings(1, 3))
    await f.db.run((c) =>
        c.db.insert("rolePanels", {
            serverId: "1",
            name: "rules",
            kind: "verification",
            revision: 1,
            enabled: false,
            exclusive: false,
            withdrawing: false,
            mappings: [{ emoji: "✅", roleId: "41", prerequisiteRoleIds: [], exclusionRoleIds: [] }],
        }),
    )
    page = await f.mappingPage()
    await status(await f.evaluate(page), 403)
})

test("Typed absence and raw rejoin epochs retire only level references and never treat a failed read as absence", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    await read(await f.mappings())
    await read(await f.adjust(100))
    let page = await f.mappingPage()
    await f.apply((await read(await f.evaluate(page))).grant)
    await read(await f.checkpoint(page))
    await read(await f.manage({ type: "reconcile", userId: "20" }))
    page = await f.page()
    assert.deepEqual(page.refs, [{ roleId: "40", joinedAt }])
    const skip = (fields: Record<string, unknown>) =>
        f.work({ type: "skip", userId: "20", mark: page.mark, roleId: "40", joinedAt, observedAt: f.now(), ...fields })
    await status(await skip({ currentJoinedAt: null }), 400)
    await status(await skip({ currentJoinedAt: joinedAt }), 409)
    const newEpoch = new Date(f.now()).toISOString()
    assert.deepEqual(await read(await skip({ currentJoinedAt: newEpoch })), { type: "progress", recorded: true })
    const current = { ...native(["40"]), joinedAt: newEpoch }
    assert.equal((await read(await f.evaluate(page, 0, current))).grant, undefined)
    const owners = await f.db.run((c) => c.db.query("roleOwnership").collect())
    assert.equal(owners.length, 1)
    assert.equal(owners[0]!.joinedAt, newEpoch)
    assert.equal(owners[0]!.owned, false)
    assert.equal((await read(await f.query({ type: "rank" }))).profile.xp, 100)
})

const countRows = async (f: ReturnType<typeof fixture>) => {
    const sum = (rows: { count: number }[]) => rows.reduce((total, row) => total + row.count, 0)
    return {
        levels: sum(await f.db.run((c) => c.db.query("levelingLevels").collect())),
        blocks: sum(await f.db.run((c) => c.db.query("levelingBlocks").collect())),
        scores: sum(await f.db.run((c) => c.db.query("levelingScores").collect())),
    }
}

test("Rank counts follow awards, corrections and resets, so ranks stay exact and equal XP shares a rank", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    for (const [userId, xp] of [
        ["21", 500],
        ["22", 9000],
        ["23", 500],
        ["24", 40000],
    ] as const)
        await read(await f.adjust(xp, userId))
    await read(await f.award(f.candidate("20")))
    const rank = async (userId: string) => (await read(await f.query({ type: "rank", userId }))).rank
    const counted = async (expected: number) =>
        assert.deepEqual(await countRows(f), { levels: expected, blocks: expected, scores: expected })
    // 1, 2, 2, 4: the two members at 500 XP share the third place and the member below them is fourth
    assert.deepEqual(await Promise.all(["24", "22", "23", "21", "20"].map(rank)), [
        { type: "exact", position: 1, tied: 0 },
        { type: "exact", position: 2, tied: 0 },
        { type: "exact", position: 3, tied: 1 },
        { type: "exact", position: 3, tied: 1 },
        { type: "exact", position: 5, tied: 0 },
    ])
    await counted(5)
    await read(await f.adjust(0, "22"))
    assert.deepEqual(await rank("22"), { type: "unranked" })
    assert.deepEqual(await rank("21"), { type: "exact", position: 2, tied: 1 })
    assert.deepEqual(await rank("20"), { type: "exact", position: 4, tied: 0 })
    await counted(4)
    // A member's own score moving within a block, across a block and across a level moves exactly one member's counts
    await read(await f.adjust(520, "21"))
    assert.deepEqual(await rank("21"), { type: "exact", position: 2, tied: 0 })
    assert.deepEqual(await rank("23"), { type: "exact", position: 3, tied: 0 })
    await read(await f.adjust(2500, "23"))
    await read(await f.adjust(2999, "21"))
    assert.deepEqual(await rank("21"), { type: "exact", position: 2, tied: 0 })
    assert.deepEqual(await rank("23"), { type: "exact", position: 3, tied: 0 })
    await counted(4)
    // A reset starts a new season, whose counts begin empty while the old season's wait to be deleted in the background
    await read(await f.manage({ type: "reset-server", confirm: "reset-server", reason: "Synthetic rank reset" }))
    assert.deepEqual(await rank("24"), { type: "unranked" })
    await read(await f.adjust(700, "21"))
    assert.deepEqual(await rank("21"), { type: "exact", position: 1, tied: 0 })
    assert.equal((await f.db.run((c) => c.db.query("levelingSettings").first()))!.countsDropPending, true)
    // The member left its old season's counts for the new season's, and the other three members' old counts wait to be deleted
    await counted(4)
    const cleanup = () => f.db.run((ctx) => retentionPass(ctx, cleanupLeveling))
    while ((await cleanup()).more);
    assert.equal((await f.db.run((c) => c.db.query("levelingSettings").first()))!.countsDropPending, undefined)
    await counted(1)
    assert.deepEqual(await rank("21"), { type: "exact", position: 1, tied: 0 })
})

test("The old season's counts are deleted a bounded batch per pass and never read by the new season", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    // 700 profiles with distinct scores leave 1,400 count rows in the old season, plus levels
    await f.db.run(async (ctx) => {
        for (let n = 0; n < 700; n++) {
            const xp = 1 + n * 7
            await ctx.db.insert("levelingProfiles", {
                serverId: "1",
                userId: String(1000 + n),
                xp,
                scoreEpoch: 1,
                adjustmentRevision: 0,
                digests: [],
                ...(await countedProfile(ctx, "1", xp)),
            })
        }
    })
    const before = await countRows(f)
    assert.equal(before.scores, 700)
    await read(await f.manage({ type: "reset-server", confirm: "reset-server", reason: "Synthetic season end" }))
    const rows = async () =>
        (await f.db.run((c) => c.db.query("levelingScores").collect())).length +
        (await f.db.run((c) => c.db.query("levelingBlocks").collect())).length +
        (await f.db.run((c) => c.db.query("levelingLevels").collect())).length
    const total = await rows()
    assert(total > 700)
    const cleanup = () => f.db.run((ctx) => retentionPass(ctx, cleanupLeveling))
    assert.equal((await cleanup()).more, true)
    assert.equal(total - (await rows()), 500)
    // A member of the new season is ranked from its own season's counts alone
    await read(await f.adjust(300, "1000"))
    assert.deepEqual((await read(await f.query({ type: "rank", userId: "1000" }))).rank, {
        type: "exact",
        position: 1,
        tied: 0,
    })
    while ((await cleanup()).more);
    assert.deepEqual(await countRows(f), { levels: 1, blocks: 1, scores: 1 })
})

test("A server counted before the score counts says counting, builds its counts 200 profiles per pass and counts a profile changed meanwhile once", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    const members = 450,
        xpOf = (n: number) => 1 + ((n * 37) % 5000)
    // Profiles as the previous version stored them: counted under their level alone
    await f.db.run(async (ctx) => {
        const levels = new Map<number, number>()
        for (let n = 0; n < members; n++) {
            const level = levelForXp(xpOf(n))
            levels.set(level, (levels.get(level) ?? 0) + 1)
            await ctx.db.insert("levelingProfiles", {
                serverId: "1",
                userId: String(1000 + n),
                xp: xpOf(n),
                scoreEpoch: 1,
                adjustmentRevision: 0,
                digests: [],
                rankLevel: level,
            })
        }
        for (const [level, count] of levels)
            await ctx.db.insert("levelingLevels", { serverId: "1", scoreEpoch: 1, level, count })
        const state = (await ctx.db.query("levelingSettings").first())!
        await ctx.db.patch(state._id, { countsReady: undefined, profiles: members })
    })
    const rank = async (userId: string) => (await read(await f.query({ type: "rank", userId }))).rank
    assert.deepEqual(await rank("1000"), { type: "counting" })
    const cleanup = () => f.db.run((ctx) => retentionPass(ctx, cleanupLeveling))
    const settings = async () => (await f.db.run((c) => c.db.query("levelingSettings").first()))!
    await cleanup()
    assert.deepEqual(await rank("1000"), { type: "counting" })
    assert.equal((await settings()).countsAfterUserId, "1199")
    // A correction of a member the backfill has not reached, and an award to a new member, count them once
    await read(await f.adjust(4000, "1449"))
    await read(await f.award(f.candidate("20")))
    // A member who only the old counts held leaves them when their score is corrected to nothing
    await read(await f.adjust(0, "1001"))
    await cleanup()
    assert.deepEqual(await rank("1000"), { type: "counting" })
    assert.equal((await settings()).countsAfterUserId, "1399")
    await cleanup()
    const state = await settings()
    assert.equal(state.countsReady, true)
    assert.equal(state.countsAfterUserId, undefined)
    assert.deepEqual(await countRows(f), { levels: members, blocks: members, scores: members })
    const xps = [
        ...Array.from({ length: members }, (_, n) => (n === 449 ? 4000 : xpOf(n))).filter((_, n) => n !== 1),
        15,
    ]
    for (const n of [0, 7, 200, 449]) {
        const xp = n === 449 ? 4000 : xpOf(n)
        assert.deepEqual(await rank(String(1000 + n)), {
            type: "exact",
            position: xps.filter((x) => x > xp).length + 1,
            tied: xps.filter((x) => x === xp).length - 1,
        })
    }
    // Profiles with no XP and from an earlier season are not counted
    assert.equal(
        (await f.db.run((c) => c.db.query("levelingProfiles").collect())).filter((row) => row.rankLevel !== undefined)
            .length,
        0,
    )
})

test("A server reset ends the counting of a server counted before the score counts, because the new season starts empty", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    await f.db.run(async (ctx) => {
        await ctx.db.insert("levelingProfiles", {
            serverId: "1",
            userId: "1000",
            xp: 500,
            scoreEpoch: 1,
            adjustmentRevision: 0,
            digests: [],
            rankLevel: 2,
        })
        await ctx.db.insert("levelingLevels", { serverId: "1", scoreEpoch: 1, level: 2, count: 1 })
        const state = (await ctx.db.query("levelingSettings").first())!
        await ctx.db.patch(state._id, { countsReady: undefined, countsAfterUserId: "1000", profiles: 1 })
    })
    await read(await f.adjust(500, "21"))
    assert.deepEqual((await read(await f.query({ type: "rank", userId: "21" }))).rank, { type: "counting" })
    await read(await f.manage({ type: "reset-server", confirm: "reset-server", reason: "Synthetic season end" }))
    const state = (await f.db.run((c) => c.db.query("levelingSettings").first()))!
    assert.equal(state.countsReady, true)
    assert.equal(state.countsAfterUserId, undefined)
    await read(await f.adjust(500, "21"))
    assert.deepEqual((await read(await f.query({ type: "rank", userId: "21" }))).rank, {
        type: "exact",
        position: 1,
        tied: 0,
    })
})

test("Expiry cleanup erases transient digest/receipt/audit state and retains permanent zero account fences", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    await read(await f.award(f.candidate()))
    await read(
        await f.manage({
            type: "reset-member",
            userId: "20",
            confirm: "reset-member",
            reason: "Synthetic cleanup reset",
        }),
    )
    const cleanup = () => f.db.run((ctx) => retentionPass(ctx, cleanupLeveling))
    f.advance(LEVELING_WINDOW)
    await cleanup()
    const profile = (await f.db.run((c) => c.db.query("levelingProfiles").first()))!
    assert.deepEqual(profile.digests, [])
    assert.equal(profile.adjustmentRevision, 1)
    assert(profile.resetAt)
    f.advance(LEVELING_DAY)
    await cleanup()
    assert.equal((await f.db.run((c) => c.db.query("levelingAwardReceipts").collect())).length, 0)
    f.advance(180 * LEVELING_DAY)
    await cleanup()
    assert.equal((await f.db.run((c) => c.db.query("levelingAudits").collect())).length, 0)
    assert.equal((await f.db.run((c) => c.db.query("levelingProfiles").collect())).length, 1)
})

test("XP and reward claims recheck DEFCON, quarantine, timeout and protected-role policy after preflight/reservation", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    const prepared = await f.awardRequest(f.candidate())
    await status(
        await f.http("/levels/award", {
            ...prepared,
            member: { ...member(), timeoutUntil: new Date(f.now() + 60000).toISOString() },
        }),
        403,
    )
    const moderation = (operation: unknown) => f.http("/moderation/manage", { ...f.source(), actor: owner, operation })
    await read(await moderation({ type: "settings", patch: { defcon: 2 } }))
    assert.equal((await read(await f.http("/levels/award", prepared))).reason, "policy")
    await read(await moderation({ type: "settings", patch: { defcon: 3 } }))
    await read(
        await moderation({
            type: "action",
            action: { type: "quarantine", targetId: "20", durationSeconds: 60, reason: "Synthetic quarantine fixture" },
            context: {
                botId: "999",
                botActionAuthorized: true,
                actorCanManageTarget: true,
                botCanManageTarget: true,
                targetProtected: false,
                currentTimeoutUntil: null,
            },
        }),
    )
    await status(await f.http("/levels/award", prepared), 403)
    await f.db.run(async (ctx) => {
        const row = (await ctx.db.query("securityRecoveries").first())!
        await ctx.db.delete(row._id)
    })
    await read(await f.mappings())
    await read(await f.adjust(100))
    const page = await f.mappingPage(),
        grant = (await read(await f.evaluate(page))).grant
    await status(await f.dispatch(grant, { ...native(), botAuthorized: false }), 409)
    await status(await f.dispatch(grant, { ...native(), roles: [{ ...roles[0]!, permissions: "8" }] }), 403)
    await status(await f.dispatch(grant, { ...native(), timeoutUntil: new Date(f.now() + 60000).toISOString() }), 403)
    await f.db.run((c) =>
        c.db.insert("ticketRoleProtections", {
            serverId: "1",
            roleId: "40",
            configurationRefs: 1,
            nativeOwnershipRefs: 0,
            privateBodyRefs: 0,
            protected: true,
        }),
    )
    await status(await f.dispatch(grant), 403)
    await f.db.run(async (c) => {
        const row = (await c.db.query("ticketRoleProtections").first())!
        await c.db.delete(row._id)
    })
    await read(await moderation({ type: "settings", patch: { defcon: 2 } }))
    await status(await f.dispatch(grant), 403)
})

test("Accounts that cannot settle while DEFCON is below 3 wait without polling, are tried hourly and are woken at DEFCON 3", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const f = fixture(t)
    const due = async () => (await read(await f.http("/service/work", { cursor: null }))).kinds.levels
    const signal = () => f.db.run(async (ctx) => (await ctx.db.query("workSignal").first())?.version ?? 0)
    const defcon = async (level: 1 | 2 | 3) =>
        read(
            await f.http("/moderation/manage", {
                ...f.source(),
                actor: owner,
                operation: { type: "settings", patch: { defcon: level } },
            }),
        )
    await read(await f.enable())
    await read(await f.mappings())
    await read(await f.adjust(100))
    await read(await f.adjust(100, "21"))
    await defcon(2)
    // The reward grant is refused, so the pass cannot settle the account
    const first = await f.page("20")
    await status(await f.evaluate(first), 403)
    await read(await f.work({ type: "done", userId: "20", mark: first.mark, complete: false, held: true }))
    const second = await f.page("21")
    await read(await f.work({ type: "done", userId: "21", mark: second.mark, complete: false, held: true }))
    for (const wait of [60000, 1800000]) {
        f.advance(wait)
        assert.deepEqual(await f.list(), [])
        assert.deepEqual(await due(), [])
    }
    // It is still tried again an hour later, in case a pass failed for another reason
    f.advance(1800000)
    assert.deepEqual((await f.list()).map((row: any) => row.userId).sort(), ["20", "21"])
    await read(
        await f.work({ type: "done", userId: "20", mark: (await f.page("20")).mark, complete: false, held: true }),
    )
    await read(
        await f.work({ type: "done", userId: "21", mark: (await f.page("21")).mark, complete: false, held: true }),
    )
    f.advance(60000)
    assert.deepEqual(await f.list(), [])
    // Returning to DEFCON 3 makes them due at once and tells the bot, in the wake itself
    await defcon(3)
    const before = await signal()
    await f.db.finishAllScheduledFunctions(() => t.mock.timers.tick(0))
    assert((await signal()) > before)
    assert.deepEqual(await due(), ["1"])
    assert.deepEqual((await f.list()).map((row: any) => row.userId).sort(), ["20", "21"])
})

test("Only an account whose additions DEFCON refused waits an hour, and removals and other failures keep their minute", async (t) => {
    const f = fixture(t)
    const defcon = async (level: 1 | 2 | 3) =>
        read(
            await f.http("/moderation/manage", {
                ...f.source(),
                actor: owner,
                operation: { type: "settings", patch: { defcon: level } },
            }),
        )
    const dueAt = async (userId: string) =>
        (await f.db.run((ctx) =>
            ctx.db
                .query("levelingProfiles")
                .withIndex("by_user", (q) => q.eq("serverId", "1").eq("userId", userId))
                .unique(),
        ))!.rewardDueAt
    await read(await f.enable())
    await read(await f.mappings())
    for (const userId of ["20", "21", "22"]) await read(await f.adjust(100, userId))
    await defcon(2)
    const done = async (userId: string, extra: object) =>
        read(await f.work({ type: "done", userId, mark: (await f.page(userId)).mark, complete: false, ...extra }))
    // A failed removal, which DEFCON does not refuse, is tried again after a minute
    await done("20", {})
    assert.equal(await dueAt("20"), f.now() + 60000)
    // Additions DEFCON refused wait an hour
    await done("21", { held: true })
    assert.equal(await dueAt("21"), f.now() + 3600000)
    f.advance(60000)
    assert.deepEqual((await f.list()).map((row: any) => row.userId).sort(), ["20", "22"])
    // The backend holds an hour only while DEFCON is below 3
    await defcon(3)
    await done("22", { held: true })
    assert.equal(await dueAt("22"), f.now() + 60000)
})

test("A wake leaves out accounts on the minute retry, so the chain ends with more than twenty failing accounts", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const f = fixture(t)
    const users = Array.from({ length: 45 }, (_, i) => String(100 + i))
    const defcon = async (level: 1 | 2 | 3) =>
        read(
            await f.http("/moderation/manage", {
                ...f.source(),
                actor: owner,
                operation: { type: "settings", patch: { defcon: level } },
            }),
        )
    await read(await f.enable())
    await read(await f.mappings())
    for (const userId of users) await read(await f.adjust(100, userId))
    await defcon(2)
    for (let accounts = await f.list(); accounts.length; accounts = await f.list())
        for (const account of accounts)
            await read(await f.work({ type: "done", userId: account.userId, mark: account.mark, complete: false }))
    const before = (await f.db.run((ctx) => ctx.db.query("levelingProfiles").collect())).map((row) => row.rewardDueAt)
    await defcon(3)
    await f.db.finishAllScheduledFunctions(() => t.mock.timers.tick(0))
    // They are not woken, and one wake ran without continuing
    assert.deepEqual(
        (await f.db.run((ctx) => ctx.db.query("levelingProfiles").collect())).map((row) => row.rewardDueAt),
        before,
    )
    const jobs = await f.db.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())
    assert.equal(jobs.filter((job) => job.name.includes("levelingWork")).length, 1)
})

test("A DEFCON 3 wake makes a full server of waiting accounts due in scheduled batches", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const f = fixture(t)
    const users = Array.from({ length: 45 }, (_, i) => String(100 + i))
    const defcon = async (level: 1 | 2 | 3) =>
        read(
            await f.http("/moderation/manage", {
                ...f.source(),
                actor: owner,
                operation: { type: "settings", patch: { defcon: level } },
            }),
        )
    const dueAt = () =>
        f.db.run(async (ctx) => (await ctx.db.query("levelingProfiles").collect()).map((row) => row.rewardDueAt))
    await read(await f.enable())
    await read(await f.mappings())
    for (const userId of users) await read(await f.adjust(100, userId))
    await defcon(2)
    for (let accounts = await f.list(); accounts.length; accounts = await f.list())
        for (const account of accounts)
            await read(
                await f.work({ type: "done", userId: account.userId, mark: account.mark, complete: false, held: true }),
            )
    assert((await dueAt()).every((at) => at! >= f.now() + 3600000))
    // The DEFCON change only schedules the wake
    await defcon(3)
    assert.equal((await dueAt()).filter((at) => at! <= f.now()).length, 0)
    await f.db.finishAllScheduledFunctions(() => t.mock.timers.tick(0))
    assert.equal((await dueAt()).filter((at) => at! <= f.now()).length, users.length)
})

test("Current configured verification requires acknowledgment, exact epoch access reference and fresh access presence", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    await read(await f.mappings())
    await read(await f.adjust(100))
    const settings = {
        panelsEnabled: false,
        verificationEnabled: true,
        autoroleEnabled: false,
        humansOnly: true,
        autoroleIds: [],
        revision: 1,
    }
    await f.db.run(async (ctx) => {
        await ctx.db.insert("roleSettings", {
            dashboardRevision: 0,
            serverId: "1",
            config: settings,
            nextPanelRevision: 1,
        })
        await ctx.db.insert("rolePanels", {
            serverId: "1",
            name: "rules",
            kind: "verification",
            revision: 1,
            enabled: true,
            exclusive: false,
            withdrawing: false,
            mappings: [{ emoji: "✅", roleId: "41", prerequisiteRoleIds: [], exclusionRoleIds: [] }],
            published: {
                revision: 1,
                publishedAt: f.now(),
                postNo: 1,
                postGeneration: 1,
                channelId: "30",
                messageId: "900",
                botId: "999",
                content: { content: "Synthetic rules" },
                mappings: [{ emoji: "✅", roleId: "41", prerequisiteRoleIds: [], exclusionRoleIds: [] }],
                exclusive: false,
            },
        })
    })
    const page = await f.mappingPage()
    await status(await f.evaluate(page, 0, native(["41"])), 403)
    await f.db.run(async (ctx) => {
        await ctx.db.insert("roleAcknowledgments", {
            advancedVerified: false,
            serverId: "1",
            userId: "20",
            joinedAt,
            rulesRevision: 1,
            panelName: "rules",
            acknowledgedAt: f.now(),
        })
        const ownershipId = await ctx.db.insert("roleOwnership", {
            serverId: "1",
            userId: "20",
            joinedAt,
            roleId: "41",
            generation: 0,
            owned: false,
            protected: false,
            status: "idle",
            updatedAt: f.now(),
        })
        await ctx.db.insert("roleReferences", {
            serverId: "1",
            consumerKey: "panel:rules:1",
            roleId: "41",
            configuration: false,
            desired: true,
            ownershipId,
            createdAt: f.now(),
        })
    })
    await status(await f.evaluate(page), 403)
    const grant = (await read(await f.evaluate(page, 0, native(["41"])))).grant
    assert(grant)
    await status(await f.dispatch(grant), 403)
    await f.apply(grant, native(["41"]))
})

test("A server gives up to 250 reward roles, and a pass evaluates only the rewards a member earned", async (t) => {
    const f = fixture(t),
        many = Array.from({ length: 250 }, (_, index) => ({
            roleId: String(1000 + index),
            permissions: "0",
            botCanManage: true,
            actorCanManage: true,
        }))
    await read(await f.enable())
    const saved = await read(
        await f.manage({
            type: "mappings",
            expectedMappingRevision: 1,
            mappings: many.map((role, index) => ({ level: index + 1, roleId: role.roleId })),
            roles: many,
        }),
    )
    assert.equal(saved.settings.mappings.length, 250)
    assert.equal(
        (await f.db.run((c) => c.db.query("roleReferences").collect())).filter((x) => x.configuration).length,
        250,
    )
    // Level 30 earns the first 30 rewards, so a pass lists those and none of the 220 the member has not reached
    await read(await f.adjust(90000))
    const page = await f.page()
    assert.deepEqual(
        page.targets.map((target: { roleId: string }) => target.roleId),
        many.slice(0, 30).map((role) => role.roleId),
    )
    const grant = (await read(await f.evaluate(page, 20, { ...native(), roles: many }))).grant
    assert.equal(grant.action, "add")
    assert.equal(grant.roleId, "1020")
    // Replacing all 250 rewards at once fits one change
    const replaced = await read(
        await f.manage({
            type: "mappings",
            expectedMappingRevision: 2,
            mappings: many.map((role, index) => ({ level: 250 - index, roleId: role.roleId })),
            roles: many,
        }),
    )
    assert.equal(replaced.settings.mappingRevision, 3)
})

test("A reward pass lists up to 500 retained level references, so one pass holds every reference of 250 rewards", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    await read(await f.adjust(100))
    await f.db.run(async (c) => {
        for (let index = 0; index < 500; index++)
            await c.db.insert("roleReferences", {
                serverId: "1",
                consumerKey: "level",
                roleId: String(1000 + index),
                configuration: false,
                desired: true,
                userId: "20",
                joinedAt,
                createdAt: f.now(),
            })
    })
    const listed = await read(await f.work({ type: "list" }))
    const account = listed.accounts.find((row: { userId: string }) => row.userId === "20")
    assert.equal(account.refs.length, 500)
    assert.equal(account.targets.length, 500)
    assert.equal(account.complete, true)
    assert.doesNotThrow(() => Schema.decodeUnknownSync(LevelingWorkResult)(listed))
})

test("A crashed pass keeps its account dirty and a reset re-marks it for a fresh pass", async (t) => {
    const f = fixture(t)
    await read(await f.enable())
    await read(await f.mappings())
    await read(await f.adjust(100))
    const page = await f.mappingPage()
    assert((await read(await f.evaluate(page))).grant)
    assert.equal((await f.list()).length, 1)
    await read(await f.manage({ type: "reset-server", confirm: "reset-server", reason: "Synthetic crash reset" }))
    const next = (await f.list()).find((row: any) => row.userId === "20")
    assert.equal(next.mark > page.mark, true)
    assert.deepEqual(await read(await f.checkpoint(page)), { type: "progress", recorded: false })
    const state = (await f.db.run((c) => c.db.query("levelingSettings").first()))!
    assert.equal(state.dirty, 1)
})
