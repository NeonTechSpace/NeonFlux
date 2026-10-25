import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test, type TestContext } from "node:test"
import { ConvexError } from "convex/values"
import type {
    BackupItem,
    BackupManifest,
    BackupNativeProof,
    BackupPlan,
    BackupStructureObject,
} from "@neonflux/contracts/backup"
import { api, internal } from "../convex/_generated/api.js"
import { BACKUP_PLAN_MS, BACKUP_RETENTION, BACKUP_SETTLE_MS, backupHash } from "../convex/backupDomain.ts"
import { BACKUP_PREVIEW_INTERVAL_MS, BACKUP_PREVIEW_MS } from "../convex/backup.ts"
import { defaultSettings } from "../convex/moderationDomain.ts"
import { state as moderationState } from "../convex/moderationStore.ts"
import { tokenHash } from "../convex/dashboard.ts"
import { allPermissions, binding, fixture, installBackupEnv, read } from "./backup-fixture.ts"

installBackupEnv()
// The scheduled ends and wakes of a job run when a test moves the timers
beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }))
afterEach(() => mock.timers.reset())

const slots = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ sourceId: String(1000 + i), userId: String(1000 + i), xp: 10 }))
const refused = async (work: Promise<unknown>, status: number) => {
    await assert.rejects(
        work,
        (error) => error instanceof ConvexError && (error.data as { status: number }).status === status,
    )
}

/** The backup fixture with what the website adds: sessions, refresh requests from one archive message and the restore job */
async function backend(t: TestContext) {
    const f = await fixture(t)
    const previewResponse = (
        archive: BackupManifest,
        native: BackupNativeProof | null,
        match = false,
        requestedAt?: number,
        from = { channelId: "90", messageId: "500" },
    ) =>
        backupHash(archive).then((archiveDigest) =>
            f.http("/backup/preview", {
                serverId: "1",
                context: f.context(),
                manifest: archive,
                archiveDigest,
                native,
                archive: from,
                match,
                ...(requestedAt !== undefined ? { requestedAt } : {}),
            }),
        )
    const preview = async (archive: BackupManifest, native: BackupNativeProof | null, match = false) =>
        ((await read(await previewResponse(archive, native, match))) as { plan: BackupPlan }).plan
    const items = async (plan: BackupPlan) =>
        ((await read(await f.query({ type: "items", binding: binding(plan) }))) as { items: BackupItem[] }).items
    const apply = async (item: BackupItem) => ((await read(await f.apply(item))) as { item: BackupItem }).item
    const counted = () =>
        f.db.run(async (ctx) => ({
            plans: (await ctx.db.query("backupPlans").collect()).length,
            items: (await ctx.db.query("backupItems").collect()).length,
            changes: (await ctx.db.query("backupChanges").collect()).length,
            origins: (await ctx.db.query("backupOrigins").collect()).length,
        }))
    async function session(userId: string, sessionToken: string) {
        await f.db.run(async (ctx) => {
            await ctx.db.insert("dashboardSessions", {
                memberServers: [],
                tokenHash: await tokenHash(sessionToken),
                accessToken: "synthetic-sealed-token",
                userId,
                userName: "Synthetic manager",
                servers: [{ id: "1", name: "Synthetic server" }],
                expiresAt: f.now() + 3600000,
                lifetimeAt: f.now() + 86400000,
            })
        })
        return { sessionToken, serverId: "1" }
    }
    const jobRow = () => f.db.run(async (ctx) => (await ctx.db.query("backupPreviewJobs").collect())[0]!)
    const runStep = async (body: object) => {
        const response = await f.http("/backup/run-step", { serverId: "1", ...body })
        return {
            status: response.status,
            body: (await response.json()) as { recorded?: boolean },
            due: response.headers.get("X-Due-In"),
        }
    }
    const ready = async () =>
        (
            (await (await f.http("/backup/preview-ready", { serverId: "1" })).json()) as {
                job: Record<string, unknown> | null
            }
        ).job
    const dispatched = async () =>
        ((await (await f.http("/service/work", { cursor: null })).json()) as { kinds: { dashboard: string[] } }).kinds
            .dashboard
    /** A confirmed plan of count XP items that a website confirmation started, with the owner's session */
    async function started(count: number) {
        const owner = await session("10", "a".repeat(64)),
            plan = await preview(f.manifest([], slots(count)), null)
        await f.db.mutation(api.backup.restoreConfirm, { ...owner, planId: plan.planId, planHash: plan.planHash })
        return { owner, plan }
    }
    const view = async (owner: { sessionToken: string; serverId: string }) =>
        (await f.db.query(api.backup.restoreView, owner))!
    return {
        ...f,
        previewResponse,
        preview,
        items,
        apply,
        counted,
        session,
        jobRow,
        runStep,
        ready,
        dispatched,
        started,
        view,
        at: (time: number) => f.advance(time - f.now()),
    }
}
type Backend = Awaited<ReturnType<typeof backend>>

test("a restore preview is the plan a confirmation runs, with the changes of each item stored beside it", async (t) => {
    const b = await backend(t),
        creatable = b.channel("100"),
        blocked: BackupStructureObject = {
            ...b.channel("101"),
            overwrites: [{ id: "40", type: "role", allow: "0", deny: "1024" }],
        },
        archive = b.manifest([], [], [creatable, blocked]),
        native = b.proof([creatable, blocked])
    const plan = await b.preview(archive, native)
    assert.deepEqual(plan.counts, { create: 1, update: 0, delete: 0, skip: 0, blocked: 1 })
    assert.equal(plan.confirmedAt, undefined)
    const planned = await b.items(plan)
    assert.deepEqual(
        planned.map(({ itemNo, sourceId, name, disposition, reason }) => ({
            itemNo,
            sourceId,
            name,
            disposition,
            reason,
        })),
        [
            { itemNo: 1, sourceId: "100", name: "channel-100", disposition: "create", reason: null },
            {
                itemNo: 2,
                sourceId: "101",
                name: "channel-101",
                disposition: "blocked",
                reason: "NeonFlux could not read the role <@&40> in its permissions. Check again",
            },
        ],
    )
    // The create lists the channel's fields and its overwrite against none at all. A blocked item brings no change
    assert.deepEqual(
        await b.db.run(async (ctx) =>
            (await ctx.db.query("backupChanges").collect()).map(({ itemNo, changes }) => ({ itemNo, changes })),
        ),
        [
            {
                itemNo: 1,
                changes: [
                    { kind: "field", path: "name", after: "channel-100" },
                    { kind: "field", path: "nsfw", after: false },
                    { kind: "field", path: "parentId", after: null },
                    { kind: "field", path: "slowmodeSeconds", after: 0 },
                    { kind: "field", path: "topic", after: null },
                    { kind: "field", path: "type", after: "text" },
                    {
                        kind: "overwrite",
                        id: "1",
                        type: "role",
                        before: { allow: "0", deny: "0" },
                        after: { allow: "0", deny: "1024" },
                        gain: "0",
                    },
                ],
            },
        ],
    )
    // Without fresh native evidence every channel is blocked, as the plan decides
    assert.deepEqual(
        (await b.items(await b.preview(archive, null))).map((item) => item.reason),
        Array(2).fill("NeonFlux could not read the server's channels"),
    )
})

test("a channel that gives permissions the server does not have is a gain, and a setting that turns on is counted and named", async (t) => {
    const b = await backend(t),
        owner = await b.session("10", "a".repeat(64)),
        plain = b.channel("100"),
        gaining: BackupStructureObject = {
            ...b.channel("101"),
            overwrites: [{ id: "1", type: "role", allow: "8192", deny: "0" }],
        },
        archive = b.manifest(
            [
                {
                    family: "response",
                    sourceId: "custom_hello",
                    value: {
                        kind: "custom",
                        name: "hello",
                        reply: { type: "text", text: "Hi" },
                        channelIds: [],
                        roleIds: [],
                        cooldownSeconds: 5,
                        priority: 0,
                        enabled: true,
                    },
                },
            ],
            [],
            [plain, gaining],
        )
    const plan = await b.preview(archive, b.proof([plain, gaining]))
    assert.deepEqual(plan.gain, { items: 1, bits: "8192", switches: 1 })
    assert.deepEqual(
        (await b.items(plan)).map(({ sourceId, gain, on }) => ({ sourceId, gain, on })),
        [
            { sourceId: "100", gain: undefined, on: undefined },
            { sourceId: "101", gain: true, on: undefined },
            { sourceId: "custom_hello", gain: undefined, on: true },
        ],
    )
    // The dashboard's view names what turns on, so the page can say which setting it is
    assert.deepEqual((await b.view(owner)).plan!.turnsOn, [
        { category: "config", family: "response", sourceId: "custom_hello" },
    ])
})

test("a newer preview replaces the plan nobody confirmed, never a confirmed plan, and keeps the server within its plans", async (t) => {
    const b = await backend(t),
        creatable = b.channel("100"),
        archive = b.manifest([], [], [creatable]),
        native = b.proof([creatable])
    const first = await b.preview(archive, native),
        second = await b.preview(archive, native)
    assert.notEqual(first.planId, second.planId)
    assert.deepEqual(await b.counted(), { plans: 1, items: 1, changes: 1, origins: 0 })
    // The replaced plan no longer exists, so a confirmation of it is refused instead of running a plan nobody sees
    assert.equal((await b.manage({ type: "confirm", binding: binding(first) })).status, 404)
    await b.confirm(second)
    const third = await b.preview(archive, native)
    assert.notEqual(third.planId, second.planId)
    // The confirmed plan stays with its items beside the new one
    assert.deepEqual(await b.counted(), { plans: 2, items: 2, changes: 2, origins: 0 })
    assert.equal((await b.items(second)).length, 1)
    for (let n = 0; n < 5; n++) await b.preview(archive, native)
    assert.equal((await b.counted()).plans, 2)
})

test("the owner reads the latest plan on the dashboard with its gain and progress by state, and nobody else does", async (t) => {
    const b = await backend(t),
        owner = await b.session("10", "a".repeat(64)),
        manager = await b.session("20", "b".repeat(64))
    assert.equal(await b.db.query(api.backup.restoreView, owner), null)
    const plan = await b.preview(b.manifest([], slots(25)), null)
    const first = (await b.view(owner)).plan!
    assert.deepEqual(
        {
            counts: first.counts,
            gain: first.gain,
            warned: first.warned,
            settled: first.settled,
            states: first.states,
            confirmedAt: first.confirmedAt,
            planHash: first.planHash,
            confirmBefore: first.confirmBefore - first.createdAt,
        },
        {
            counts: { create: 25, update: 0, delete: 0, skip: 0, blocked: 0 },
            gain: { items: 0, bits: "0", switches: 0 },
            warned: 0,
            settled: 0,
            states: { planned: 25 },
            confirmedAt: undefined,
            planHash: plan.planHash,
            confirmBefore: 600000,
        },
    )
    assert.equal(await b.db.query(api.backup.restoreView, manager), null)
    // A confirmed plan shows how many of its items have an outcome as the chat confirmation runs them
    await b.confirm(plan)
    for (const item of (await b.items(plan)).slice(0, 3)) await b.apply(item)
    const running = (await b.view(owner)).plan!
    assert.deepEqual(
        { settled: running.settled, confirmedAt: running.confirmedAt, states: running.states },
        { settled: 3, confirmedAt: b.now(), states: { created: 3, planned: 22 } },
    )
})

test("the dashboard pages items problems first with what each changes, and lists identical items only when asked", async (t) => {
    const b = await backend(t),
        owner = await b.session("10", "a".repeat(64)),
        manager = await b.session("20", "b".repeat(64)),
        creatable = b.channel("100"),
        blocked: BackupStructureObject = {
            ...b.channel("101"),
            overwrites: [{ id: "40", type: "role", allow: "0", deny: "1024" }],
        },
        xp = slots(30)
    await b.db.run((ctx) =>
        Promise.all(
            xp.slice(0, 2).map((x) =>
                ctx.db.insert("levelingProfiles", {
                    serverId: "1",
                    userId: x.userId,
                    xp: x.xp,
                    scoreEpoch: 1,
                    adjustmentRevision: 0,
                    joinedAt: "2020-01-01T00:00:00Z",
                    digests: [],
                }),
            ),
        ),
    )
    const plan = await b.preview(b.manifest([], xp, [creatable, blocked]), b.proof([creatable, blocked]))
    assert.deepEqual(plan.counts, { create: 29, update: 0, delete: 0, skip: 2, blocked: 1 })
    const page = (cursor: string | null, identical = false, who = owner, planId = plan.planId) =>
        b.db.query(api.backup.restoreItems, { ...who, planId, identical, cursor })
    const one = (await page(null))!
    assert.equal(one.items.length, 25)
    // The blocked item sorts first and brings no changes, and the channel to create brings its own
    assert.deepEqual(
        one.items.slice(0, 2).map((x) => [x.sourceId, x.disposition, x.changes.length]),
        [
            ["101", "blocked", 0],
            ["100", "create", 7],
        ],
    )
    assert.equal(
        Object.keys(one.items[0]!).filter((key) => ["planHash", "archiveDigest", "planId"].includes(key)).length,
        0,
    )
    const two = (await page(one.nextCursor!))!
    assert.deepEqual([two.items.length, two.nextCursor], [5, undefined])
    assert.ok([...one.items, ...two.items].every((x) => x.disposition !== "skip"))
    // Identical items come last and only on request
    const all = (await page(null, true))!,
        rest = (await page(all.nextCursor!, true))!
    assert.deepEqual([all.items.length + rest.items.length, rest.items.at(-1)?.disposition], [32, "skip"])
    assert.equal(await page(null, false, manager), null)
    // A plan that is not the job's gives nothing
    assert.equal(await page(null, false, owner, "not-a-plan"), null)
    const newer = await b.preview(b.manifest([], xp), null)
    assert.equal(await page(null, false, owner, plan.planId), null)
    assert.equal((await page(null, false, owner, newer.planId))?.items.length, 25)
})

test("a channel in a category the restore creates names the category by the archive's name on the dashboard", async (t) => {
    const b = await backend(t),
        owner = await b.session("10", "a".repeat(64)),
        category: BackupStructureObject = { ...b.channel("11", "category"), name: "Info" },
        inside = b.channel("100", "text", "11")
    const plan = await b.preview(b.manifest([], [], [category, inside]), b.proof([category, inside]))
    assert.deepEqual(plan.counts, { create: 2, update: 0, delete: 0, skip: 0, blocked: 0 })
    const page = (await b.db.query(api.backup.restoreItems, {
        ...owner,
        planId: plan.planId,
        identical: false,
        cursor: null,
    }))!
    assert.deepEqual(
        page.items.map((x) => [x.sourceId, x.changes.find((c) => c.kind === "field" && c.path === "parentId")]),
        [
            ["11", { kind: "field", path: "parentId", after: null }],
            ["100", { kind: "field", path: "parentId", after: "Info" }],
        ],
    )
})

test("the website refreshes the owner's plan through the bot, and a failed refresh says why", async (t) => {
    const b = await backend(t),
        owner = await b.session("10", "a".repeat(64)),
        manager = await b.session("20", "b".repeat(64)),
        creatable = b.channel("100")
    assert.equal(await b.db.query(api.backup.restoreView, owner), null)
    await b.db.mutation(api.backup.restoreRequest, owner)
    assert.equal(
        await b.db.query(api.backup.restoreView, owner),
        null,
        "Nothing is queued before the owner previews an archive in chat",
    )
    await b.preview(b.manifest([], [], [creatable]), b.proof([creatable]))
    assert.equal((await b.view(owner)).plan?.counts.create, 1)
    assert.equal(await b.db.query(api.backup.restoreView, manager), null)
    // A refresh right after the chat preview is ignored, so the button cannot keep the bot reading Fluxer
    b.advance(BACKUP_PREVIEW_INTERVAL_MS - 1)
    assert.equal(await b.db.mutation(api.backup.restoreRequest, owner), false)
    assert.equal((await b.view(owner)).state, "done")
    b.advance(1)
    assert.equal(await b.db.mutation(api.backup.restoreRequest, manager), false)
    assert.equal((await b.view(owner)).state, "done", "Only the owner who made the preview can refresh it")
    assert.equal(await b.db.mutation(api.backup.restoreRequest, owner), true)
    // A request while another is in flight is not taken either
    assert.equal(await b.db.mutation(api.backup.restoreRequest, owner), false)
    const asked = b.now()
    assert.deepEqual([(await b.view(owner)).state, (await b.jobRow()).createdAt], ["queued", asked])
    assert.deepEqual(await b.dispatched(), ["1"])
    assert.deepEqual(await b.ready(), {
        ownerId: "10",
        channelId: "90",
        messageId: "500",
        requestedAt: asked,
        match: false,
    })
    // The failure names the request it answers, and only the latest request is answered
    assert.equal(
        (await b.http("/backup/preview-failed", { serverId: "1", requestedAt: asked, failure: "unanswered" })).status,
        400,
    )
    assert.deepEqual(
        await (
            await b.http("/backup/preview-failed", { serverId: "1", requestedAt: asked - 1, failure: "archive" })
        ).json(),
        { recorded: false },
    )
    assert.deepEqual(
        await (
            await b.http("/backup/preview-failed", { serverId: "1", requestedAt: asked, failure: "archive" })
        ).json(),
        { recorded: true },
    )
    const failed = await b.view(owner)
    assert.deepEqual(
        { state: failed.state, failure: failed.failure, kept: failed.plan?.counts.create },
        { state: "failed", failure: "archive", kept: 1 },
    )
    // A sender who no longer owns the server loses the plan nobody confirmed
    b.advance(BACKUP_PREVIEW_INTERVAL_MS)
    await b.db.mutation(api.backup.restoreRequest, owner)
    assert.deepEqual(
        await (
            await b.http("/backup/preview-failed", { serverId: "1", requestedAt: b.now(), failure: "owner" })
        ).json(),
        { recorded: true },
    )
    assert.equal((await b.view(owner)).plan, null)
    assert.deepEqual(await b.counted(), { plans: 0, items: 0, changes: 0, origins: 0 })
    // A refresh the bot does not answer in time fails, and its late answer is dropped
    b.advance(BACKUP_PREVIEW_INTERVAL_MS)
    await b.db.mutation(api.backup.restoreRequest, owner)
    const unanswered = b.now()
    b.advance(BACKUP_PREVIEW_MS)
    await b.db.finishAllScheduledFunctions(() => mock.timers.tick(BACKUP_PREVIEW_MS))
    assert.equal((await b.view(owner)).failure, "unanswered")
    assert.equal(await b.ready(), null)
    assert.deepEqual(
        await (
            await b.http("/backup/preview-failed", { serverId: "1", requestedAt: unanswered, failure: "error" })
        ).json(),
        { recorded: false },
    )
})

test("a match plan counts its deletes once, apart from the items that start other work", async (t) => {
    const b = await backend(t),
        owner = await b.session("10", "a".repeat(64)),
        creatable = b.channel("100"),
        extra = {
            id: "900",
            type: "text" as const,
            name: "old-room",
            parentId: null,
            botCanManage: true,
            synced: false,
        }
    const plan = await b.preview(b.manifest([], [], [creatable]), b.proof([creatable], [], [], [extra]), true)
    assert.equal(plan.counts.delete, 1)
    const items = (await b.db.query(api.backup.restoreItems, {
        ...owner,
        planId: plan.planId,
        identical: false,
        cursor: null,
    }))!
    assert.equal(items.items.filter((x) => x.warning).length, 1)
    assert.equal((await b.view(owner)).plan?.warned, 0)
})

test("forgetting the plan a website restore is running ends the job, and a new check starts in chat", async (t) => {
    const b = await backend(t),
        { owner, plan } = await b.started(2)
    assert.equal((await b.jobRow()).state, "running")
    await read(await b.manage({ type: "forget", binding: binding(plan) }))
    assert.equal((await b.jobRow()).state, "done")
    assert.equal(await b.ready(), null)
    b.advance(BACKUP_PREVIEW_INTERVAL_MS)
    assert.equal(await b.db.query(api.backup.restoreView, owner), null)
    assert.equal(await b.db.mutation(api.backup.restoreRequest, owner), false)
    const creatable = b.channel("100"),
        next = await b.preview(b.manifest([], [], [creatable]), b.proof([creatable]))
    assert.equal((await b.view(owner)).plan?.planId, next.planId)
})

test("a check the owner forgot is gone from the website as from chat, and the archive is not read again", async (t) => {
    const b = await backend(t),
        owner = await b.session("10", "a".repeat(64)),
        creatable = b.channel("100"),
        plan = await b.preview(b.manifest([], [], [creatable]), b.proof([creatable]))
    await read(await b.manage({ type: "forget", binding: binding(plan) }))
    b.advance(BACKUP_PREVIEW_INTERVAL_MS)
    assert.equal(await b.db.query(api.backup.restoreView, owner), null)
    assert.equal(await b.db.mutation(api.backup.restoreRequest, owner), false)
    assert.equal(await b.ready(), null)
})

test("a check retention removed is gone from the website, and the archive is not read again", async (t) => {
    const b = await backend(t),
        creatable = b.channel("100"),
        plan = await b.preview(b.manifest([], [], [creatable]), b.proof([creatable]))
    b.at(plan.expiresAt + BACKUP_RETENTION + 1)
    for (let pass = 0; pass < 3; pass++) await b.clean()
    assert.equal((await b.counted()).plans, 0)
    // The owner signs in again a week later
    const owner = await b.session("10", "a".repeat(64))
    assert.equal(await b.db.query(api.backup.restoreView, owner), null)
    assert.equal(await b.db.mutation(api.backup.restoreRequest, owner), false)
    assert.equal(await b.ready(), null)
})

/** A refresh asked before its check was removed ends with it: the bot gets nothing, late answers are rejected and only a new chat check shows */
async function refreshEnded(
    b: Backend,
    owner: { sessionToken: string; serverId: string },
    asked: number,
    archive: BackupManifest,
    native: BackupNativeProof,
) {
    assert.equal(await b.db.query(api.backup.restoreView, owner), null)
    assert.equal(await b.db.mutation(api.backup.restoreRequest, owner), false)
    assert.equal(await b.ready(), null)
    assert.equal((await b.previewResponse(archive, native, false, asked)).status, 409)
    assert.deepEqual(
        await (await b.http("/backup/preview-failed", { serverId: "1", requestedAt: asked, failure: "owner" })).json(),
        { recorded: false },
    )
    assert.equal(await b.db.query(api.backup.restoreView, owner), null)
    const next = await b.preview(archive, native)
    assert.equal((await b.view(owner)).plan?.planId, next.planId)
}

test("forgetting a check while a website refresh of it waits for the bot ends the refresh", async (t) => {
    const b = await backend(t),
        owner = await b.session("10", "a".repeat(64)),
        creatable = b.channel("100"),
        archive = b.manifest([], [], [creatable]),
        native = b.proof([creatable]),
        plan = await b.preview(archive, native)
    b.advance(BACKUP_PREVIEW_INTERVAL_MS)
    assert.equal(await b.db.mutation(api.backup.restoreRequest, owner), true)
    const asked = b.now()
    await read(await b.manage({ type: "forget", binding: binding(plan) }))
    await refreshEnded(b, owner, asked, archive, native)
})

test("retention removing a check while a website refresh of it waits for the bot ends the refresh", async (t) => {
    const b = await backend(t),
        creatable = b.channel("100"),
        plan = await b.preview(b.manifest([], [], [creatable]), b.proof([creatable]))
    b.at(plan.expiresAt + BACKUP_RETENTION + 1)
    // The owner signs in again a week later, and the bot would read the archive and the server then
    const owner = await b.session("10", "a".repeat(64)),
        later = b.channel("100")
    assert.equal(await b.db.mutation(api.backup.restoreRequest, owner), true)
    const asked = b.now()
    for (let pass = 0; pass < 3; pass++) await b.clean()
    assert.equal((await b.counted()).plans, 0)
    await refreshEnded(b, owner, asked, b.manifest([], [], [later]), b.proof([later]))
})

test("an answer to a website request that a newer request replaced is rejected", async (t) => {
    const b = await backend(t),
        owner = await b.session("10", "a".repeat(64)),
        creatable = b.channel("100"),
        archive = b.manifest([], [], [creatable]),
        native = b.proof([creatable])
    await b.preview(archive, native)
    b.advance(BACKUP_PREVIEW_INTERVAL_MS)
    await b.db.mutation(api.backup.restoreRequest, owner)
    const requested = b.now()
    // The owner previews in chat before the bot answers, which is a newer request
    b.advance(1)
    const chat = await b.preview(archive, native)
    assert.equal((await b.view(owner)).state, "done")
    // The chat check is the latest request, so the website's refresh waits for the interval after it
    b.advance(BACKUP_PREVIEW_INTERVAL_MS - 1)
    await b.db.mutation(api.backup.restoreRequest, owner)
    assert.equal((await b.view(owner)).state, "done")
    assert.equal((await b.previewResponse(archive, native, false, requested)).status, 409)
    assert.equal((await b.view(owner)).plan?.planId, chat.planId)
    // An answer without a request, for another archive message or from another sender is rejected too
    b.advance(BACKUP_PREVIEW_INTERVAL_MS)
    await b.db.mutation(api.backup.restoreRequest, owner)
    const latest = b.now()
    assert.equal((await b.previewResponse(archive, native, false, latest - 1)).status, 409)
    assert.equal(
        (await b.previewResponse(archive, native, false, latest, { channelId: "90", messageId: "501" })).status,
        409,
    )
    assert.equal((await b.previewResponse(archive, native, false, latest)).status, 200)
    assert.equal((await b.view(owner)).state, "done")
    assert.equal((await b.previewResponse(archive, native, false, latest)).status, 409, "A request is answered once")
})

test("a refresh from the website keeps the mode of the plan it refreshes unless the owner changes it", async (t) => {
    const b = await backend(t),
        owner = await b.session("10", "a".repeat(64)),
        creatable = b.channel("100")
    const matched = await b.preview(b.manifest([], [], [creatable]), b.proof([creatable]), true)
    assert.equal(matched.match, true)
    b.advance(BACKUP_PREVIEW_INTERVAL_MS)
    await b.db.mutation(api.backup.restoreRequest, owner)
    assert.equal((await b.ready())?.match, true)
    b.advance(BACKUP_PREVIEW_INTERVAL_MS)
    await b.http("/backup/preview-failed", {
        serverId: "1",
        requestedAt: b.now() - BACKUP_PREVIEW_INTERVAL_MS,
        failure: "archive",
    })
    await b.db.mutation(api.backup.restoreRequest, { ...owner, match: false })
    assert.equal((await b.ready())?.match, false)
})

test("a plan the owner confirmed survives the refresh of a sender who no longer owns the server", async (t) => {
    const b = await backend(t),
        owner = await b.session("10", "a".repeat(64)),
        creatable = b.channel("100"),
        plan = await b.preview(b.manifest([], [], [creatable]), b.proof([creatable]))
    await b.confirm(plan)
    b.advance(BACKUP_PREVIEW_INTERVAL_MS)
    await b.db.mutation(api.backup.restoreRequest, owner)
    await b.http("/backup/preview-failed", { serverId: "1", requestedAt: b.now(), failure: "owner" })
    assert.equal((await b.view(owner)).plan, null)
    assert.equal((await b.counted()).plans, 1)
})

test("the owner confirms the plan the page showed, and only that plan, only once and only with time to run it", async (t) => {
    const b = await backend(t),
        owner = await b.session("10", "a".repeat(64)),
        manager = await b.session("20", "b".repeat(64))
    // A plan that was confirmed in chat earlier is not the job's plan, and is not confirmed again from the page
    const earlier = await b.preview(b.manifest([], slots(3)), null)
    await b.confirm(earlier)
    const old = await b.preview(b.manifest([], slots(3)), null),
        plan = await b.preview(b.manifest([], slots(3)), null)
    const confirmWith = (who: typeof owner, planId = plan.planId, planHash = plan.planHash) =>
        b.db.mutation(api.backup.restoreConfirm, { ...who, planId, planHash })
    // A manager who is not the owner, a wrong hash, a plan that is not the job's and a plan that was replaced are refused
    await refused(confirmWith(manager), 403)
    await refused(confirmWith(owner, plan.planId, "0".repeat(64)), 409)
    await refused(confirmWith(owner, old.planId, old.planHash), 409)
    await refused(confirmWith(owner, earlier.planId, earlier.planHash), 409)
    await refused(confirmWith(owner, "not-a-plan"), 409)
    // A request or an answer in flight is not a state to confirm from
    b.advance(BACKUP_PREVIEW_INTERVAL_MS)
    await b.db.mutation(api.backup.restoreRequest, owner)
    await refused(confirmWith(owner), 409)
    const asked = b.now()
    b.advance(1)
    const again = await b.preview(b.manifest([], slots(3)), null)
    assert.equal(asked < b.now(), true)
    // Too little time to run it
    b.at(again.expiresAt - 300000 + 1)
    await refused(confirmWith(owner, again.planId, again.planHash), 409)
    b.at(again.createdAt)
    // An archive or a key in the request is no argument of the confirmation
    await assert.rejects(
        b.db.mutation(api.backup.restoreConfirm, {
            ...owner,
            planId: again.planId,
            planHash: again.planHash,
            archive: "bytes",
        } as never),
    )
    const confirmed = await confirmWith(owner, again.planId, again.planHash)
    assert.deepEqual(confirmed, { confirmedAt: b.now() })
    assert.deepEqual(
        await b.db
            .run((ctx) => ctx.db.get(again.planId as never))
            .then((x) => (x as { confirmedAt: number }).confirmedAt),
        b.now(),
    )
    const row = await b.jobRow()
    assert.deepEqual([row.state, row.expiresAt], ["running", again.expiresAt])
    // A repeat answers the same result and changes nothing
    b.advance(1000)
    assert.deepEqual(await confirmWith(owner, again.planId, again.planHash), confirmed)
    assert.deepEqual(
        await b.db
            .run((ctx) => ctx.db.get(again.planId as never))
            .then((x) => (x as { confirmedAt: number }).confirmedAt),
        confirmed.confirmedAt,
    )
    // The bot is asked to run it, with the plan, and a running restore refuses new checks
    assert.deepEqual(await b.dispatched(), ["1"])
    const job = await b.ready()
    assert.deepEqual(
        {
            requestedAt: job?.requestedAt,
            plan: (job?.plan as BackupPlan).planId,
            confirmedAt: (job?.plan as BackupPlan).confirmedAt,
        },
        { requestedAt: row.createdAt, plan: again.planId, confirmedAt: confirmed.confirmedAt },
    )
    assert.equal((await b.previewResponse(b.manifest([], slots(3)), null)).status, 409)
    b.advance(BACKUP_PREVIEW_INTERVAL_MS)
    await b.db.mutation(api.backup.restoreRequest, owner)
    assert.equal((await b.jobRow()).state, "running")
})

test("a restore runs a pass at a time, goes on while items wait and ends done when every item has an outcome", async (t) => {
    const b = await backend(t),
        { owner, plan } = await b.started(3),
        asked = (await b.jobRow()).createdAt
    const listed = await b.items(plan)
    await b.apply(listed[0]!)
    // Progress reports the job as due again, so the bot runs the next pass at once
    const step = await b.runStep({ requestedAt: asked, recorded: 1 })
    assert.deepEqual([step.body, step.due, (await b.jobRow()).state], [{ recorded: true }, "0", "running"])
    assert.equal((await b.view(owner)).plan?.settled, 1)
    for (const item of listed.slice(1)) await b.apply(item)
    assert.deepEqual((await b.runStep({ requestedAt: asked, recorded: 2 })).body, { recorded: true })
    assert.deepEqual([(await b.jobRow()).state, (await b.jobRow()).failure], ["done", undefined])
    assert.deepEqual(
        { settled: (await b.view(owner)).plan?.settled, states: (await b.view(owner)).plan?.states },
        { settled: 3, states: { created: 3 } },
    )
    assert.equal(await b.ready(), null)
    // The job is not running, so a late step records nothing
    assert.deepEqual((await b.runStep({ requestedAt: asked, recorded: 1 })).body, { recorded: false })
})

test("a restore ends failed when nothing progresses, the sender no longer owns the server or DEFCON 1 pauses it", async (t) => {
    const reason = async (body: (asked: number) => object, before?: (b: Backend) => Promise<void>) => {
        const b = await backend(t),
            { plan } = await b.started(2),
            asked = (await b.jobRow()).createdAt
        await b.apply((await b.items(plan))[0]!)
        await before?.(b)
        await b.runStep({ requestedAt: asked, ...body(asked) })
        const row = await b.jobRow()
        return [row.state, row.failure]
    }
    assert.deepEqual(await reason(() => ({ recorded: 0 })), ["failed", "error"])
    assert.deepEqual(await reason(() => ({ recorded: 1, stopped: "owner" })), ["failed", "owner"])
    assert.deepEqual(
        await reason(
            () => ({ recorded: 1 }),
            (b) =>
                b.db.run(async (ctx) => {
                    const row = await moderationState(ctx, "1")
                    await ctx.db.patch(row._id, { config: { ...defaultSettings(), defcon: 1 } })
                }),
        ),
        ["failed", "paused"],
    )
    // A step that answers another request changes nothing
    const b = await backend(t)
    await b.started(2)
    assert.deepEqual((await b.runStep({ requestedAt: 1, recorded: 0 })).body, { recorded: false })
    assert.equal((await b.jobRow()).state, "running")
    // A step carrying anything but its fields is refused by its shape
    assert.equal(
        (await b.runStep({ requestedAt: (await b.jobRow()).createdAt, recorded: 0, archive: "bytes" })).status,
        400,
    )
})

test("a restore with open claims waits for them to age instead of looping, wakes by itself and ends once they are not confirmed", async (t) => {
    const b = await backend(t),
        owner = await b.session("10", "a".repeat(64)),
        earlier = await b.preview(b.manifest([], slots(1)), null)
    await b.confirm(earlier)
    const plan = await b.preview(b.manifest([], slots(2)), null)
    await b.db.mutation(api.backup.restoreConfirm, { ...owner, planId: plan.planId, planHash: plan.planHash })
    const asked = (await b.jobRow()).createdAt,
        [first, second] = await b.items(plan)
    await b.apply(first!)
    const claimedUntil = b.now() + 1000,
        wakeAt = claimedUntil + BACKUP_SETTLE_MS + 1
    await b.db.run(async (ctx) => {
        const row = (await ctx.db.query("backupItems").collect()).find(
            (x) => x.planId === (plan.planId as never) && x.itemNo === second!.itemNo,
        )!
        await ctx.db.patch(row._id, {
            state: "claimed",
            claimedAt: b.now(),
            claimToken: "synthetic",
            dispatchExpiresAt: claimedUntil,
        })
    })
    const step = await b.runStep({ requestedAt: asked, recorded: 1 })
    assert.deepEqual([step.due, (await b.jobRow()).state], [null, "waiting"])
    // Waiting is not a state the bot is asked to act in, and the page still reads it as a restore in progress
    assert.equal(await b.ready(), null)
    assert.deepEqual(await b.dispatched(), [])
    const wakes = () =>
        b.db.run(async (ctx) =>
            (await ctx.db.system.query("_scheduled_functions").collect())
                .filter((x) => x.name === "backup:runWake")
                .map((x) => x.scheduledTime),
        )
    assert.deepEqual(await wakes(), [wakeAt])
    // A wake for another plan does nothing
    await b.db.mutation(internal.backup.runWake, { serverId: "1", planId: earlier.planId as never })
    assert.equal((await b.jobRow()).state, "waiting")
    const signal = () => b.db.run(async (ctx) => (await ctx.db.query("workSignal").first())?.version ?? 0),
        before = await signal()
    b.at(wakeAt)
    await b.db.finishAllScheduledFunctions(() => mock.timers.tick(wakeAt - claimedUntil + 1000))
    assert.deepEqual(
        [(await b.jobRow()).state, (await signal()) > before, (await b.dispatched()).length],
        ["running", true, 1],
    )
    // The restart of the bot loses nothing: the job gives the same plan to whoever asks
    assert.deepEqual(await b.ready(), await b.ready())
    assert.equal(((await b.ready())?.plan as BackupPlan).planId, plan.planId)
    // The next pass records nothing, ages the claim to not confirmed and ends the job
    await b.runStep({ requestedAt: asked, recorded: 0 })
    const ended = await b.jobRow()
    assert.deepEqual([ended.state, ended.failure], ["done", undefined])
    const after = (await b.view(owner)).plan!
    assert.deepEqual([after.settled, after.states], [1, { created: 1, uncertain: 1 }])
    assert.match((await b.items(plan))[1]!.reason!, /could not confirm whether this was/)
})

for (const state of ["running", "waiting"] as const)
    test(`a ${state} restore that outlives its plan is ended`, async (t) => {
        const b = await backend(t),
            { owner, plan } = await b.started(2)
        const id = (await b.jobRow())._id
        if (state === "waiting") await b.db.run((ctx) => ctx.db.patch(id, { state }))
        // The confirmation scheduled the end of the job at the end of the plan, and before then it does nothing
        assert.deepEqual(
            await b.db.run(async (ctx) =>
                (await ctx.db.system.query("_scheduled_functions").collect())
                    .filter((x) => x.name === "backup:previewExpire")
                    .map((x) => x.scheduledTime),
            ),
            [plan.expiresAt],
        )
        await b.db.mutation(internal.backup.previewExpire, { serverId: "1" })
        assert.equal((await b.jobRow()).state, state)
        b.at(plan.expiresAt)
        await b.db.finishAllScheduledFunctions(() => mock.timers.tick(BACKUP_PLAN_MS))
        const row = await b.jobRow()
        assert.deepEqual([row.state, row.failure], ["failed", "expired"])
        assert.equal((await b.view(owner)).failure, "expired")
    })

test("a valid worst-case preview request is above the old route limit and below the new one", async (t) => {
    const b = await backend(t)
    // 100 forum channels, each as the server has it with the most a snapshot may hold: 100 overwrites, a 4,096 character topic and 20 tags
    const present = (n: number): BackupStructureObject => ({
        sourceId: String(1000 + n),
        type: "forum",
        name: `forum-${n}`,
        parentId: null,
        capturedAt: b.now(),
        topic: "t".repeat(4096),
        nsfw: false,
        slowmodeSeconds: 0,
        tags: Array.from({ length: 20 }, (_, i) => ({
            name: `tag-${String(i).padStart(2, "0")}`.padEnd(50, "x"),
            moderated: false,
            emojiId: null,
            emojiName: "x".repeat(60),
        })),
        overwrites: Array.from({ length: 100 }, (_, i) => ({
            id: String(10_000 + i),
            type: "member" as const,
            allow: "9223372036854775807",
            deny: "0",
        })),
    })
    const live = Array.from({ length: 100 }, (_, n) => present(n))
    // The archive holds the most the restore limits allow: 500 overwrites over its 100 channels
    const archived = live.map((x) => ({ ...x, overwrites: x.overwrites.slice(0, 5), tags: [], topic: "a".repeat(600) }))
    const archive = b.manifest([], [], archived)
    const native: BackupNativeProof = {
        ...b.proof(),
        references: Array.from({ length: 1000 }, (_, i) => ({
            id: String(20_000 + i),
            type: "member" as const,
            serverId: "1",
            observedAt: b.now(),
            exists: true,
            actorCanAccess: true,
            botCanAccess: true,
            actorCanManage: true,
            botCanManage: true,
            permissions: allPermissions,
        })),
        observations: live.map((channelState) => b.seen(channelState)),
        // The server lists its most channels, each with the longest name
        channels: Array.from({ length: 500 }, (_, i) => ({
            id: String(30_000 + i),
            type: "text" as const,
            name: "n".repeat(100),
            parentId: null,
            botCanManage: true,
            synced: false,
        })),
    }
    const body = {
        serverId: "1",
        context: b.context(),
        manifest: archive,
        archiveDigest: await backupHash(archive),
        native,
        archive: { channelId: "90", messageId: "500" },
        match: false,
    }
    const size = JSON.stringify(body).length
    assert.ok(size > 1048576, `the request is ${size} characters`)
    assert.ok(size < 4194304, `the request is ${size} characters`)
    const response = await b.http("/backup/preview", body)
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()).slice(0, 300))
    assert.equal(((await response.json()) as { plan: BackupPlan }).plan.itemCount, 100)
    // Beyond the limit the route refuses before it reads the request
    assert.equal((await b.http("/backup/preview", { ...body, padding: "x".repeat(4194304) })).status, 413)
})
