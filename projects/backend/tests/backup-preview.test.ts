import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import type {
    BackupItem,
    BackupManifest,
    BackupNativeProof,
    BackupPlan,
    BackupStructureObject,
} from "@neonflux/contracts/backup"
import { backupHash } from "../convex/backupDomain.ts"
import { allPermissions, binding, fixture, installBackupEnv, read } from "./backup-fixture.ts"

installBackupEnv()

/** The backup fixture with previews from one archive message */
async function backend(t: TestContext) {
    const f = await fixture(t)
    const previewResponse = (
        archive: BackupManifest,
        native: BackupNativeProof | null,
        match = false,
        from = { channelId: "90" },
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
            }),
        )
    const preview = async (archive: BackupManifest, native: BackupNativeProof | null, match = false) =>
        ((await read(await previewResponse(archive, native, match))) as { plan: BackupPlan }).plan
    const items = async (plan: BackupPlan) =>
        ((await read(await f.query({ type: "items", binding: binding(plan) }))) as { items: BackupItem[] }).items
    const counted = () =>
        f.db.run(async (ctx) => ({
            plans: (await ctx.db.query("backupPlans").collect()).length,
            items: (await ctx.db.query("backupItems").collect()).length,
            changes: (await ctx.db.query("backupChanges").collect()).length,
            origins: (await ctx.db.query("backupOrigins").collect()).length,
        }))
    return {
        ...f,
        previewResponse,
        preview,
        items,
        counted,
    }
}

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

test("a valid worst-case preview request is above the old route limit and below the new one", async (t) => {
    const b = await backend(t)
    // 100 text channels, each as the server has it with the most a snapshot may hold: 100 overwrites and a 1,024 character topic
    const present = (n: number): BackupStructureObject => ({
        sourceId: String(1000 + n),
        type: "text",
        name: `text-${n}`,
        parentId: null,
        capturedAt: b.now(),
        topic: "t".repeat(1024),
        nsfw: false,
        slowmodeSeconds: 0,
        overwrites: Array.from({ length: 100 }, (_, i) => ({
            id: String(10_000 + i),
            type: "member" as const,
            allow: "9223372036854775807",
            deny: "0",
        })),
    })
    const live = Array.from({ length: 100 }, (_, n) => present(n))
    // The archive holds the most the restore limits allow: 500 overwrites over its 100 channels
    const archived = live.map((x) => ({ ...x, overwrites: x.overwrites.slice(0, 5), topic: "a".repeat(600) }))
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
        archive: { channelId: "90" },
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
