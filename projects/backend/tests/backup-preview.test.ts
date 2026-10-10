import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import type { BackupContext, BackupItem, BackupManifest, BackupNativeProof, BackupPreviewPage, BackupStructureObject } from "@neonflux/contracts/backup"
import schema from "../convex/schema.ts"
import { api } from "../convex/_generated/api.js"
import { BACKUP_KNOWN_DENY, backupCapabilities, backupHash } from "../convex/backupDomain.ts"
import { BACKUP_PREVIEW_INTERVAL_MS, BACKUP_PREVIEW_MS } from "../convex/backup.ts"
import { tokenHash } from "../convex/dashboard.ts"
import { botCall } from "./bot-service.ts"

const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"), "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/backup.ts": () => import("../convex/backup.ts"), "../convex/installations.ts": () => import("../convex/installations.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"), "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const keys = ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_IDS", "NEONFLUX_BOT_API_SECRET"] as const
const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]))
let now = Date.parse("2026-10-01T00:00:00Z")
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    process.env.NEONFLUX_SERVER_ID = "1"
    process.env.NEONFLUX_BOT_API_SECRET = "synthetic-backup-preview-secret-00000000000"
    mock.method(Date, "now", () => now)
    mock.timers.enable({ apis: ["setTimeout"] })
})
afterEach(() => {
    mock.restoreAll()
    mock.timers.reset()
    for (const key of keys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key] }
})
const backend = () => convexTest({ schema, modules, transactionLimits: true })
const provider = "https://api.example.test"
const context = (): BackupContext => ({ provider, observedAt: now, ownerId: "10", actorId: "10", actorKind: "human", botId: "999", botKind: "bot", ownerJoinedAt: "2024-01-01T00:00:00.000Z",
    ownerTimeoutUntil: null, botTimeoutUntil: null, dmChannelId: "90", dmType: 1, recipientIds: ["10"], privateReplyAuthorized: true })
const channel = (sourceId: string, roleId = "1"): BackupStructureObject => ({ sourceId, type: "text", name: `channel-${sourceId}`, parentId: null, capturedAt: now,
    overwrites: [{ id: roleId, type: "role", allow: "0", deny: "1024" }], topic: null, nsfw: false, slowmodeSeconds: 0 })
const manifest = (structure: BackupStructureObject[], xp: BackupManifest["xp"] = []): BackupManifest => ({ version: 1, backupId: "synthetic_preview", provider, serverId: "1",
    selected: [...(structure.length ? ["structure" as const] : []), ...(xp.length ? ["xp" as const] : [])], capturedAt: now, observations: { databaseAt: xp.length ? now : null, structureStartedAt: structure.length ? now : null, structureFinishedAt: structure.length ? now : null },
    counts: { config: 0, xp: xp.length, structure: structure.length, overwrites: structure.reduce((n, x) => n + x.overwrites.length, 0) }, exclusions: backupCapabilities().exclusions, config: [], xp, structure })
// Every channel is absent, and only the everyone role is known, so an overwrite for another role is a missing reference
const proof = (channels: BackupStructureObject[]): BackupNativeProof => ({ observedAt: now, serverId: "1", ownerId: "10", botId: "999", actorPermissions: BACKUP_KNOWN_DENY.toString(), botPermissions: BACKUP_KNOWN_DENY.toString(),
    actorCanManageChannels: true, botCanManageChannels: true, references: [{ id: "1", type: "role", serverId: "1", observedAt: now, exists: true, actorCanAccess: true, botCanAccess: true, actorCanManage: true, botCanManage: true, permissions: "0" }],
    observations: channels.map(x => ({ sourceId: x.sourceId, observedAt: now, status: "absent", channel: null })) })
const preview = async (t: ReturnType<typeof backend>, archive: BackupManifest, native: BackupNativeProof | null, page = 1) => {
    const response = await botCall(t, "/backup/preview", { serverId: "1", context: context(), manifest: archive, archiveDigest: await backupHash(archive), native, archive: { channelId: "90", messageId: "500" }, page })
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
    return await response.json() as BackupPreviewPage
}
const counted = async (t: ReturnType<typeof backend>) => t.run(async ctx => ({ plans: (await ctx.db.query("backupPlans").collect()).length, items: (await ctx.db.query("backupItems").collect()).length, origins: (await ctx.db.query("backupOrigins").collect()).length }))
async function session(t: ReturnType<typeof backend>, userId: string, sessionToken: string) {
    await t.run(async ctx => { await ctx.db.insert("dashboardSessions", { tokenHash: await tokenHash(sessionToken), accessToken: "synthetic-sealed-token", userId, userName: "Synthetic manager",
        servers: [{ id: "1", name: "Synthetic server" }], expiresAt: now + 3600000, lifetimeAt: now + 86400000 }) })
    return { sessionToken, serverId: "1" }
}

test("a restore preview decides each item exactly as a plan does, and stores no plan, item or origin", async () => {
    const t = backend(), creatable = channel("100"), blocked = channel("101", "40"), archive = manifest([creatable, blocked]), native = proof([creatable, blocked])
    const shown = await preview(t, archive, native)
    assert.deepEqual(shown.counts, { create: 1, skip: 0, conflict: 0, blocked: 1 })
    // A chat page shows blocked and conflicting items first
    assert.deepEqual(shown.items, [
        { itemNo: 2, category: "structure", family: "structure", sourceId: "101", name: "channel-101", disposition: "blocked", reason: "The role <@&40> in its permissions is gone, or you or NeonFlux cannot see it" },
        { itemNo: 1, category: "structure", family: "structure", sourceId: "100", name: "channel-100", disposition: "create", reason: null },
    ])
    assert.deepEqual(await counted(t), { plans: 0, items: 0, origins: 0 })
    // Without fresh native evidence every channel is blocked, as a plan would block it
    assert.deepEqual((await preview(t, archive, null)).items.map(item => item.reason), Array(2).fill("NeonFlux could not read the server's channels"))
    const planned = await botCall(t, "/backup/manage", { serverId: "1", messageId: "501", createdAt: now, context: context(), operation: { type: "plan", manifest: archive, archiveDigest: await backupHash(archive), native } })
    const items = (await planned.json() as { items: BackupItem[] }).items
    assert.deepEqual(items.map(({ itemNo, sourceId, disposition, reason }) => ({ itemNo, sourceId, disposition, reason })),
        shown.items.map(({ itemNo, sourceId, disposition, reason }) => ({ itemNo, sourceId, disposition, reason })).sort((a, b) => a.itemNo - b.itemNo))
})

test("the owner pages the latest preview in chat, ten items a page, and nobody else reads it", async () => {
    const t = backend(), xp = Array.from({ length: 25 }, (_, i) => ({ sourceId: String(1000 + i), userId: String(1000 + i), xp: 10 }))
    const first = await preview(t, manifest([], xp), null)
    assert.deepEqual({ itemCount: first.itemCount, page: first.page, pages: first.pages, items: first.items.length }, { itemCount: 25, page: 1, pages: 3, items: 10 })
    const read = async (page: number, ownerId = "10") => (await (await botCall(t, "/backup/query", { serverId: "1", context: { ...context(), ownerId, actorId: ownerId, recipientIds: [ownerId] }, operation: { type: "preview", page } })).json() as { preview: BackupPreviewPage | null }).preview
    const last = await read(3)
    assert.deepEqual({ page: last?.page, items: last?.items.map(item => item.itemNo) }, { page: 3, items: [21, 22, 23, 24, 25] })
    // A page past the end shows the last page, and a plan's 500 items fit the 50 pages chat asks for
    assert.equal((await read(50))?.page, 3)
    assert.equal(await read(1, "11"), null)
})

test("the website refreshes the owner's preview through the bot, and a failed refresh says why", async () => {
    const t = backend(), owner = await session(t, "10", "a".repeat(64)), manager = await session(t, "20", "b".repeat(64)), creatable = channel("100")
    assert.equal(await t.query(api.backup.previewView, owner), null)
    await t.mutation(api.backup.previewRequest, owner)
    assert.equal(await t.query(api.backup.previewView, owner), null, "Nothing is queued before the owner previews an archive in chat")
    await preview(t, manifest([creatable]), proof([creatable]))
    assert.equal((await t.query(api.backup.previewView, owner))?.preview?.counts.create, 1)
    assert.equal(await t.query(api.backup.previewView, manager), null)
    // A refresh right after the chat preview is ignored, so the button cannot keep the bot reading Fluxer
    now += BACKUP_PREVIEW_INTERVAL_MS - 1
    await t.mutation(api.backup.previewRequest, owner)
    assert.equal((await t.query(api.backup.previewView, owner))?.state, "done")
    now += 1
    await t.mutation(api.backup.previewRequest, manager)
    assert.equal((await t.query(api.backup.previewView, owner))?.state, "done", "Only the owner who made the preview can refresh it")
    await t.mutation(api.backup.previewRequest, owner)
    assert.equal((await t.query(api.backup.previewView, owner))?.state, "queued")
    assert.deepEqual((await (await botCall(t, "/service/work", { cursor: null })).json() as { kinds: { dashboard: string[] } }).kinds.dashboard, ["1"])
    assert.deepEqual(await (await botCall(t, "/backup/preview-ready", { serverId: "1" })).json(), { job: { ownerId: "10", channelId: "90", messageId: "500" } })
    assert.equal((await botCall(t, "/backup/preview-failed", { serverId: "1", failure: "unanswered" })).status, 400)
    assert.deepEqual(await (await botCall(t, "/backup/preview-failed", { serverId: "1", failure: "archive" })).json(), { recorded: true })
    const failed = await t.query(api.backup.previewView, owner)
    assert.deepEqual({ state: failed?.state, failure: failed?.failure, kept: failed?.preview?.counts.create }, { state: "failed", failure: "archive", kept: 1 })
    // A sender who no longer owns the server loses the stored preview
    now += BACKUP_PREVIEW_INTERVAL_MS
    await t.mutation(api.backup.previewRequest, owner)
    assert.deepEqual(await (await botCall(t, "/backup/preview-failed", { serverId: "1", failure: "owner" })).json(), { recorded: true })
    assert.equal((await t.query(api.backup.previewView, owner))?.preview, null)
    // A refresh the bot does not answer in time fails, and its late answer is dropped
    now += BACKUP_PREVIEW_INTERVAL_MS
    await t.mutation(api.backup.previewRequest, owner)
    now += BACKUP_PREVIEW_MS
    await t.finishAllScheduledFunctions(() => mock.timers.tick(BACKUP_PREVIEW_MS))
    assert.equal((await t.query(api.backup.previewView, owner))?.failure, "unanswered")
    assert.deepEqual(await (await botCall(t, "/backup/preview-ready", { serverId: "1" })).json(), { job: null })
    assert.deepEqual(await (await botCall(t, "/backup/preview-failed", { serverId: "1", failure: "error" })).json(), { recorded: false })
})
