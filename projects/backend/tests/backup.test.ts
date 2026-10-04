import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import { makeFunctionReference } from "convex/server"
import type { BackupBinding, BackupConfigObject, BackupContext, BackupItem, BackupManifest, BackupNativeProof, BackupPlan, BackupStructureObject } from "../contracts.js"
import schema from "../convex/schema.ts"
import { BACKUP_CONFIG_PROJECTIONS } from "../convex/backupProjections.ts"
import { BACKUP_KNOWN_DENY, BACKUP_SAFE_ALLOW, backupCapabilities, backupChannelSemantic, backupConfig, backupHash, backupManifest, backupStructure, canonicalBackupJson } from "../convex/backupDomain.ts"
import { defaultLevelingSettings } from "../convex/levelingDomain.ts"
import { defaultSettings } from "../convex/moderationDomain.ts"
import { state as moderationState } from "../convex/moderationStore.ts"
import { levelingState } from "../convex/levelingStore.ts"

const secret = "synthetic-backup-test-secret-000000000000000000", oldServer = process.env.NEONFLUX_SERVER_ID, oldSecret = process.env.NEONFLUX_BOT_API_SECRET
beforeEach(() => { process.env.NEONFLUX_SERVER_ID = "1"; process.env.NEONFLUX_BOT_API_SECRET = secret })
afterEach(() => { if (oldServer === undefined) delete process.env.NEONFLUX_SERVER_ID; else process.env.NEONFLUX_SERVER_ID = oldServer; if (oldSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET; else process.env.NEONFLUX_BOT_API_SECRET = oldSecret })
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"), "../convex/http.ts": () => import("../convex/http.ts"),
    "../convex/backup.ts": () => import("../convex/backup.ts"), "../convex/backupRetention.ts": () => import("../convex/backupRetention.ts"),
    "../convex/metadataLogs.ts": () => import("../convex/metadataLogs.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"), "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const binding = (r: BackupBinding): BackupBinding => ({ planId: r.planId, revision: r.revision, planHash: r.planHash, archiveDigest: r.archiveDigest })
async function read(r: Response): Promise<any> { assert.equal(r.status, 200, JSON.stringify(await r.clone().json())); assert.equal(r.headers.get("cache-control"), "no-store"); return r.json() }
async function status(r: Response, expected: number) { const body = await r.json(); assert.equal(r.status, expected, JSON.stringify(body)); assert(!JSON.stringify(body).includes(secret)) }
async function fixture(t: TestContext) {
    let now = Date.parse("2026-01-01T00:00:00Z"), sequence = 10000
    t.mock.method(Date, "now", () => now)
    const db = convexTest({ schema, modules, transactionLimits: true }), provider = "https://api.example.test"
    const context = (): BackupContext => ({ provider, observedAt: now, ownerId: "10", actorId: "10", actorKind: "human", botId: "999", botKind: "bot", ownerJoinedAt: "2024-01-01T00:00:00.123456Z", ownerTimeoutUntil: null, botTimeoutUntil: null, dmChannelId: "90", dmType: 1, recipientIds: ["10"], privateReplyAuthorized: true })
    const source = () => ({ serverId: "1", messageId: String(++sequence), createdAt: now })
    const http = (path: string, body: unknown, auth = true) => db.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify(body) })
    const manage = (operation: unknown, extra = {}) => http("/backup/manage", { ...source(), context: context(), operation, ...extra })
    const query = (operation: unknown, extra = {}) => http("/backup/query", { serverId: "1", context: context(), operation, ...extra })
    const work = (operation: unknown) => http("/backup/work", { serverId: "1", operation })
    const snapshot = (selected = ["config", "xp"]) => http("/backup/snapshot", { serverId: "1", context: context(), selected })
    const manifest = (config: BackupConfigObject[] = [], xp: BackupManifest["xp"] = [], structure: BackupStructureObject[] = []): BackupManifest => ({ version: 1, backupId: `test_backup_${++sequence}`, provider, serverId: "1", selected: [...(config.length ? ["config" as const] : []), ...(xp.length ? ["xp" as const] : []), ...(structure.length ? ["structure" as const] : []), ...(!config.length && !xp.length && !structure.length ? ["config" as const] : [])], capturedAt: now, observations: { databaseAt: now, structureStartedAt: now, structureFinishedAt: now }, counts: { config: config.length, xp: xp.length, structure: structure.length, overwrites: structure.reduce((n, x) => n + x.overwrites.length, 0) }, exclusions: backupCapabilities().exclusions, config, xp, structure })
    const proof = (channels: BackupStructureObject[] = [], refs: BackupNativeProof["references"] = []): BackupNativeProof => ({ observedAt: now, serverId: "1", ownerId: "10", botId: "999", actorPermissions: BACKUP_KNOWN_DENY.toString(), botPermissions: BACKUP_KNOWN_DENY.toString(), actorCanManageChannels: true, botCanManageChannels: true, references: [{ id: "1", type: "role", serverId: "1", observedAt: now, exists: true, actorCanAccess: true, botCanAccess: true, actorCanManage: true, botCanManage: true, permissions: "0" }, ...refs], observations: channels.map(x => ({ sourceId: x.sourceId, observedAt: now, status: "absent", channel: null })) })
    const channel = (sourceId = "100", type: BackupStructureObject["type"] = "text", parentId: string | null = null): BackupStructureObject => ({ sourceId, type, name: `channel-${sourceId}`, parentId, capturedAt: now, overwrites: [{ id: "1", type: "role", allow: "0", deny: "1024" }], ...(type === "text" ? { topic: null, nsfw: false, slowmodeSeconds: 0 } : type === "voice" ? { bitrate: 64000, userLimit: 0 } : {}) })
    const plan = async (archive: BackupManifest, native: BackupNativeProof | null = null) => read(await manage({ type: "plan", manifest: archive, archiveDigest: await backupHash(archive), native })) as Promise<{ plan: BackupPlan, items: BackupItem[], nextCursor?: string }>
    const confirm = async (plan: BackupPlan) => read(await manage({ type: "confirm", binding: binding(plan) }))
    const apply = (item: BackupItem, native: BackupNativeProof | null = null) => work({ type: "apply", binding: { ...binding(item), itemNo: item.itemNo, generation: 1 }, context: context(), native })
    const clean = () => db.mutation(makeFunctionReference<"mutation">("backupRetention:cleanup"), {})
    const reserve = (item: BackupItem, native: BackupNativeProof) => work({ type: "reserve", binding: { ...binding(item), itemNo: item.itemNo, generation: 1 }, context: context(), native })
    const claim = (item: BackupItem, native: BackupNativeProof, claimToken = "a".repeat(32)) => work({ type: "claim", binding: { ...binding(item), itemNo: item.itemNo, generation: 1 }, context: context(), native, claimToken })
    const outcome = (item: BackupItem, outcome: string, result: BackupStructureObject | null = null, extra = {}) => work({ type: "outcome", binding: { ...binding(item), itemNo: item.itemNo, generation: 1 }, claimToken: "a".repeat(32), outcome, channel: result, mappedId: result?.sourceId ?? null, ...extra })
    return { db, provider, source, context, http, manage, query, work, snapshot, manifest, proof, channel, plan, confirm, apply, clean, reserve, claim, outcome, now: () => now, advance: (ms: number) => { now += ms } }
}

test("Backup authenticates every route and requires current exact Owner, provider and private DM", async t => {
    const f = await fixture(t)
    await status(await f.http("/backup/snapshot", { serverId: "1", context: f.context(), selected: ["xp"] }, false), 401)
    for (const patch of [{ ownerId: "11" }, { actorKind: "unknown" }, { privateReplyAuthorized: false }, { recipientIds: ["10", "11"] }, { recipientIds: ["999"] }, { ownerTimeoutUntil: new Date(f.now() + 60000).toISOString() }, { provider: `${f.provider}/v1` }]) await status(await f.query({ type: "capabilities" }, { context: { ...f.context(), ...patch } }), patch.provider ? 400 : 403)
    await status(await f.snapshot([]), 400)
    await status(await f.snapshot(["all"]), 400)
    await status(await f.query({ type: "capabilities" }, { serverId: "2" }), 403)
    assert.equal((await read(await f.query({ type: "capabilities" }))).capabilities.safeAllowMask, BACKUP_SAFE_ALLOW.toString())
})

test("Role reservation backups retain future-user mappings and restore disabled with native safe-role evidence", async t => {
    const f = await fixture(t)
    const roleConfig: BackupConfigObject = { family: "roles", sourceId: "roles", value: { panelsEnabled: false, verificationEnabled: false, autoroleEnabled: true, humansOnly: true, autoroleIds: [], reservations: [{ userId: "20", roleIds: ["40"] }] } }
    const proof = f.proof([], [{ id: "40", type: "role", serverId: "1", observedAt: f.now(), exists: true, actorCanAccess: true, botCanAccess: true, actorCanManage: true, botCanManage: true, permissions: "0" }])
    const planned = await f.plan(f.manifest([roleConfig]), proof)
    await f.confirm(planned.plan)
    const missingProof = await f.plan(f.manifest([roleConfig]), proof)
    await f.confirm(missingProof.plan)
    assert.equal((await read(await f.apply(missingProof.items[0]!, null))).item.state, "blocked")
    const applied = await read(await f.apply(planned.items[0]!, proof))
    assert.equal(applied.item.state, "created")
    const settings = await f.db.run(ctx => ctx.db.query("roleSettings").withIndex("by_server", q => q.eq("serverId", "1")).unique())
    assert.deepEqual(settings?.config.reservations, roleConfig.value.reservations)
    assert.equal(settings?.config.autoroleEnabled, false)
    const snapshot = await read(await f.snapshot(["config"]))
    const restored = snapshot.config.find((row: BackupConfigObject) => row.family === "roles")
    assert.deepEqual(restored.value.reservations, roleConfig.value.reservations)
    const refs = await f.db.run(ctx => ctx.db.query("roleReferences").withIndex("by_server_role", q => q.eq("serverId", "1").eq("roleId", "40")).collect())
    assert.equal(refs.length, 1)
    assert.equal(refs[0]?.configuration, true)
})

test("Metadata backups restore event and audit destinations disabled without losing authored references", async t => {
    const f = await fixture(t)
    const value: BackupConfigObject = { family: "metadata", sourceId: "metadata", value: { enabled: true, routes: (["membership", "resources", "messages", "audit", "settings", "operations"] as const).map(category => ({ category, enabled: false })), eventRoutes: [{ eventType: "audit-entry:20", enabled: true, channelId: "30", ownerId: "10" }], messageChannelIds: [], excludedChannelIds: [] } }
    const native = f.proof([], [
        { id: "30", type: "text", serverId: "1", observedAt: f.now(), exists: true, actorCanAccess: true, botCanAccess: true, actorCanManage: true, botCanManage: true, permissions: "0" },
        { id: "10", type: "member", serverId: "1", observedAt: f.now(), exists: true, actorCanAccess: true, botCanAccess: true, actorCanManage: true, botCanManage: true, permissions: "0" },
    ])
    const planned = await f.plan(f.manifest([value]), native)
    await f.confirm(planned.plan)
    assert.equal((await read(await f.apply(planned.items[0]!, native))).item.state, "created")
    const member = (userId: string, isBot = false) => ({ userId, joinedAt: "2024-01-01T00:00:00Z", roleIds: [], isBot, timeoutUntil: null, canView: true, canReadHistory: true })
    const context = { observedAt: f.now(), actor: { userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }, member: member("10"), channelId: "30", channelType: 0, botId: "999", botAuthorized: true, actorAuthorized: true, actorKind: "human", botKind: "bot", botMember: member("999", true) }
    const queried = await read(await f.http("/metadata-logs/query", { serverId: "1", context, privateRead: { channelId: "90", recipientIds: ["10", "999"], oneToOne: true }, operation: { type: "settings" } }))
    assert.equal(queried.settings.enabled, false)
    assert.deepEqual(queried.settings.eventRoutes, [{ eventType: "audit-entry:20", enabled: false, revision: 1, channelId: "30", ownerId: "10" }])
    assert.equal(queried.settings.configRevision, 1)
    const snapshot = await read(await f.snapshot(["config"]))
    const projected = snapshot.config.find((row: BackupConfigObject) => row.family === "metadata")
    assert.deepEqual(projected.value.eventRoutes, [{ eventType: "audit-entry:20", enabled: false, channelId: "30", ownerId: "10" }])
})

test("Selected snapshot uses every indexed configuration family and excludes private rows and source state", async t => {
    const f = await fixture(t)
    await f.db.run(async ctx => {
        const state = await moderationState(ctx, "1"); await ctx.db.patch(state._id, { config: { ...defaultSettings(), defcon: 1 } })
        await ctx.db.insert("afkStatuses", { serverId: "1", userId: "12", reason: "Synthetic private AFK narrative", since: f.now() })
        await ctx.db.insert("responseDefinitions", { serverId: "1", kind: "custom", name: "synthetic", reply: { type: "text", text: "Authored config" }, channelIds: [], roleIds: [], cooldownSeconds: 0, priority: 0, enabled: true, createdAt: 1, updatedAt: 2 })
        const level = await levelingState(ctx, "1"); await ctx.db.patch(level._id, { config: { ...defaultLevelingSettings(), scoreEpoch: 2 } })
        await ctx.db.insert("levelingProfiles", { serverId: "1", userId: "20", xp: 50, scoreEpoch: 1, adjustmentRevision: 7, joinedAt: "2020-01-01T00:00:00Z", digests: [{ digest: "d".repeat(64), creditedAt: f.now() }] })
    })
    const r = await read(await f.snapshot())
    assert.deepEqual(r.xp, [{ sourceId: "20", userId: "20", xp: 0 }])
    const text = JSON.stringify(r)
    for (const forbidden of ["defcon", "manualCases", "cooldownCount", "scoreEpoch", "digest", "adjustmentRevision", "Synthetic private AFK", "joinedAt", secret]) assert(!text.includes(forbidden), forbidden)
    assert.equal(r.config.find((x: BackupConfigObject) => x.family === "response").value.reply.text, "Authored config")
    assert.equal(Object.keys(BACKUP_CONFIG_PROJECTIONS).length, 20)
    const onlyXp = await read(await f.snapshot(["xp"])); assert.deepEqual(onlyXp.config, [])
})

test("XP snapshot refuses 1001 profiles as one transaction and never returns a partial category", async t => {
    const f = await fixture(t)
    await f.db.run(async ctx => { await levelingState(ctx, "1"); for (let n = 1; n <= 1001; n++) await ctx.db.insert("levelingProfiles", { serverId: "1", userId: String(n), xp: n, scoreEpoch: 1, adjustmentRevision: 0, digests: [] }) })
    await status(await f.snapshot(["xp"]), 413)
    assert.deepEqual((await read(await f.snapshot(["config"]))).xp, [])
})

test("Manifest validation rejects unknown fields, duplicate identity, invalid counts and unsafe bits before persistence", async t => {
    const f = await fixture(t), c = f.channel(), original = f.manifest([], [], [c])
    for (const bad of [{ ...original, version: 2 }, { ...original, key: "synthetic-never-stored" }, { ...original, structure: [c, c], counts: { ...original.counts, structure: 2, overwrites: 2 } }, { ...original, counts: { ...original.counts, structure: 2 } }, { ...original, structure: [{ ...c, overwrites: [{ id: "1", type: "role", allow: "8", deny: "0" }] }] }, { ...original, structure: [{ ...c, overwrites: [{ id: "1", type: "role", allow: "0", deny: (1n << 19n).toString() }] }] }, { ...original, structure: [{ ...c, overwrites: [c.overwrites[0], c.overwrites[0]] }] }]) await status(await f.manage({ type: "plan", manifest: bad, archiveDigest: "a".repeat(64), native: f.proof([c]) }), 400)
    assert.equal((await f.db.run(ctx => ctx.db.query("backupPlans").collect())).length, 0)
    assert.equal(canonicalBackupJson({ b: 1, a: 2 }), canonicalBackupJson({ a: 2, b: 1 }))
    assert.throws(() => backupConfig({ family: "unknown", sourceId: "x", value: {} }))
})

test("Config import is additive, disabled, exact-source idempotent and preserves current DEFCON", async t => {
    const f = await fixture(t), object: BackupConfigObject = { family: "response", sourceId: "custom_synthetic", value: { kind: "custom", name: "synthetic", reply: { type: "text", text: "Hello" }, channelIds: [], roleIds: [], cooldownSeconds: 5, priority: 0, enabled: true } }
    const planned = await f.plan(f.manifest([object])); await status(await f.apply(planned.items[0]!), 409); await f.confirm(planned.plan)
    const first = await read(await f.apply(planned.items[0]!)); assert.equal(first.item.state, "created"); assert.equal(first.item.disabledOnCreate, true)
    assert.deepEqual(await read(await f.apply(planned.items[0]!)), first)
    const rows = await f.db.run(ctx => ctx.db.query("responseDefinitions").collect()); assert.equal(rows.length, 1); assert.equal(rows[0]!.enabled, false)
    const newer = await f.plan(f.manifest([object])); assert.equal(newer.items[0]!.disposition, "skip"); await f.confirm(newer.plan); assert.equal((await read(await f.apply(newer.items[0]!))).item.state, "skipped")
    const conflict = await f.plan(f.manifest([{ ...object, value: { ...object.value, reply: { type: "text", text: "Different" } } }])); assert.equal(conflict.items[0]!.disposition, "conflict")
    await f.confirm(conflict.plan); assert.equal((await read(await f.apply(conflict.items[0]!))).item.state, "conflict")
    await f.db.run(async ctx => { const state = await moderationState(ctx, "1"); await ctx.db.patch(state._id, { config: { ...state.config, defcon: 1 } }) })
    const onlyPolicy = { ...defaultSettings() }; const { defcon: _defcon, ...value } = onlyPolicy
    const policy = await f.plan(f.manifest([{ family: "moderation", sourceId: "moderation", value }])); await f.confirm(policy.plan); await status(await f.apply(policy.items[0]!), 403)
    assert.equal((await f.db.run(ctx => ctx.db.query("moderationSettings").first()))!.config.defcon, 1)
})

test("Fresh XP imports current epoch without membership, rewards, cooldowns or old fences", async t => {
    const f = await fixture(t)
    await f.db.run(async ctx => { const state = await levelingState(ctx, "1"); await ctx.db.patch(state._id, { config: { ...state.config, enabled: true, scoreEpoch: 3 } }) })
    const planned = await f.plan(f.manifest([], [{ sourceId: "20", userId: "20", xp: 1234 }])); await f.confirm(planned.plan)
    await read(await f.apply(planned.items[0]!))
    const row = await f.db.run(ctx => ctx.db.query("levelingProfiles").first()); assert.equal(row!.scoreEpoch, 3); assert.equal(row!.xp, 1234); assert.equal(row!.adjustmentRevision, 0); assert.deepEqual(row!.digests, []); assert.equal(row!.joinedAt, undefined)
    assert.equal((await f.db.run(async ctx => (await ctx.db.query("levelingProfiles").collect()).filter(row => row.rewardDueAt !== undefined))).length, 0)
    assert.equal((await f.db.run(ctx => ctx.db.query("roleOwnership").collect())).length, 0)
    const conflict = await f.plan(f.manifest([], [{ sourceId: "20", userId: "20", xp: 1235 }])); assert.equal(conflict.items[0]!.disposition, "conflict")
    const fresh = await f.plan(f.manifest([], [{ sourceId: "21", userId: "21", xp: 2000 }])); await f.confirm(fresh.plan)
    await f.db.run(async ctx => { const state = await levelingState(ctx, "1"); await ctx.db.patch(state._id, { config: { ...state.config, scoreEpoch: 4 } }) })
    assert.equal((await read(await f.apply(fresh.items[0]!))).item.state, "conflict")
})

test("Plan confirmations bind archive, provider, owner, revision and fifteen minute expiry", async t => {
    const f = await fixture(t), archive = f.manifest([], [{ sourceId: "20", userId: "20", xp: 1 }]), source = f.source(), operation = { type: "plan", manifest: archive, archiveDigest: await backupHash(archive), native: null }
    const first = await read(await f.http("/backup/manage", { ...source, context: f.context(), operation }))
    const duplicate = await read(await f.http("/backup/manage", { ...source, context: f.context(), operation })); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.plan.planId, first.plan.planId)
    await status(await f.http("/backup/manage", { ...source, context: f.context(), operation: { ...operation, archiveDigest: "b".repeat(64) } }), 409)
    await status(await f.manage({ type: "confirm", binding: { ...binding(first.plan), revision: 2 } }), 400)
    await status(await f.manage({ type: "confirm", binding: { ...binding(first.plan), planHash: "b".repeat(64) } }), 409)
    await status(await f.query({ type: "plan", binding: binding(first.plan) }, { context: { ...f.context(), provider: "https://different.example.test" } }), 403)
    await f.confirm(first.plan); assert.equal((await f.confirm(first.plan)).duplicate, true)
    f.advance(900000); await status(await f.apply(first.items[0]), 409)
})

test("Native creation reserves once, claims once and blocks origin across different archive IDs", async t => {
    const f = await fixture(t), object = f.channel(), proof = f.proof([object]), planned = await f.plan(f.manifest([], [], [object]), proof), item = planned.items[0]!
    assert.equal(item.disposition, "create"); await f.confirm(planned.plan)
    const reserved = await read(await f.reserve(item, proof)); assert.equal(reserved.grant.channel.sourceId, "100"); assert.equal(reserved.grant.channel.overwrites[0].deny, "1024")
    assert.equal((await read(await f.claim(item, proof))).claimed, true)
    assert.equal((await read(await f.claim(item, proof, "b".repeat(32)))).claimed, false)
    const newArchive = await f.plan(f.manifest([], [], [object]), proof); assert.equal(newArchive.items[0]!.disposition, "blocked")
    await status(await f.outcome(item, "created", { ...object, sourceId: "500" }, { claimToken: "b".repeat(32) }), 409)
    await read(await f.outcome(item, "created", { ...object, sourceId: "500" }))
    const skipProof = { ...proof, observations: [{ sourceId: "500", observedAt: f.now(), status: "present" as const, channel: { ...object, sourceId: "500" } }] }
    const identical = await f.plan(f.manifest([], [], [object]), skipProof); assert.equal(identical.items[0]!.disposition, "skip"); assert.equal(identical.items[0]!.mappedId, "500")
    await status(await f.outcome(item, "created", { ...object, sourceId: "501" }), 409)
})

test("Unknown creation survives aging and accepts only original late response-bound identity", async t => {
    const f = await fixture(t), object = f.channel(), proof = f.proof([object]), planned = await f.plan(f.manifest([], [], [object]), proof), item = planned.items[0]!
    await f.confirm(planned.plan); await read(await f.reserve(item, proof)); await read(await f.claim(item, proof))
    f.advance(130001); await f.clean()
    const known = { ...object, sourceId: "500" }, result = await read(await f.outcome(item, "created", known)); assert.equal(result.item.state, "uncertain"); assert.equal(result.item.historicalOutcome, "uncertain"); assert.equal(result.item.mappedId, "500")
    const restartProof = { ...f.proof(), observations: [{ sourceId: "500", observedAt: f.now(), status: "present" as const, channel: known }] }
    const reconciled = await read(await f.work({ type: "reconcile", binding: { ...binding(item), itemNo: item.itemNo, generation: 1 }, context: f.context(), native: restartProof })); assert.equal(reconciled.item.resolution, "match"); assert.equal(reconciled.item.historicalOutcome, "uncertain")
    await read(await f.manage({ type: "forget", binding: binding(planned.plan) }))
    assert.equal((await f.plan(f.manifest([], [], [{ ...object, capturedAt: f.now() }]), { ...restartProof, observations: [{ sourceId: "500", observedAt: f.now(), status: "absent", channel: null }] })).items[0]!.disposition, "blocked")
})

test("Missing overwrite audience and parent references block creates without dropping private restrictions", async t => {
    const f = await fixture(t), object = { ...f.channel(), overwrites: [...f.channel().overwrites, { id: "20", type: "member" as const, allow: "1024", deny: "0" }] }
    const planned = await f.plan(f.manifest([], [], [object]), f.proof([object])); assert.equal(planned.items[0]!.disposition, "blocked"); assert.match(planned.items[0]!.reason!, /20/)
    const child = f.channel("101", "text", "100"), parent = f.channel("100", "category"), missing = await f.plan(f.manifest([], [], [child]), f.proof([child])); assert.equal(missing.items[0]!.disposition, "blocked")
    const dependency = await f.plan(f.manifest([], [], [child, parent]), f.proof([parent, child])); assert.equal(dependency.items[0]!.sourceId, "100"); assert.equal(dependency.items[1]!.dependencyItemNo, 1)
    await f.confirm(dependency.plan); assert.equal((await read(await f.reserve(dependency.items[1]!, f.proof([parent, child])))).item.state, "blocked")
})

test("Configuration revisions changing after preview conflict without overwriting current data", async t => {
    const f = await fixture(t), draft: BackupConfigObject = { family: "draft", sourceId: "draft_synthetic", value: { kind: "draft", name: "synthetic", content: { content: "First" } } }
    const planned = await f.plan(f.manifest([draft])); await f.confirm(planned.plan)
    await f.db.run(ctx => ctx.db.insert("publishingDrafts", { serverId: "1", ...draft.value, revision: 2, canonicalContent: draft.value.content, createdAt: f.now(), updatedAt: f.now() }))
    assert.equal((await read(await f.apply(planned.items[0]!))).item.state, "conflict")
    assert.equal((await f.db.run(ctx => ctx.db.query("publishingDrafts").first()))!.revision, 2)
})

test("Retention bounds settled detail erasure and preserves body-free durable origin maps", async t => {
    const f = await fixture(t), profiles = Array.from({ length: 25 }, (_, n) => ({ sourceId: String(n + 1), userId: String(n + 1), xp: n })), planned = await f.plan(f.manifest([], profiles))
    assert.equal(planned.items.length, 20); assert(planned.nextCursor)
    const next = await read(await f.query({ type: "items", binding: binding(planned.plan), cursor: planned.nextCursor })); assert.equal(next.items.length, 5)
    await f.confirm(planned.plan)
    for (const item of [...planned.items, ...next.items]) await read(await f.apply(item))
    f.advance(604800000 + 900001)
    const first = await f.clean(); assert.equal(first.removed, 20); assert.equal((await f.db.run(ctx => ctx.db.query("backupItems").collect())).length, 5)
    await f.clean(); assert.equal((await f.db.run(ctx => ctx.db.query("backupPlans").collect())).length, 0); assert.equal((await f.db.run(ctx => ctx.db.query("backupOrigins").collect())).length, 25)
})

test("Capacity refuses eleventh plan and more than 500 items before any partial writes", async t => {
    const f = await fixture(t)
    for (let n = 0; n < 10; n++) await f.plan(f.manifest())
    await status(await f.manage({ type: "plan", manifest: f.manifest(), archiveDigest: "a".repeat(64), native: null }), 429)
    const big = f.manifest([], Array.from({ length: 501 }, (_, n) => ({ sourceId: String(n + 1), userId: String(n + 1), xp: n })))
    await status(await f.manage({ type: "plan", manifest: big, archiveDigest: "a".repeat(64), native: null }), 413)
    assert.equal((await f.db.run(ctx => ctx.db.query("backupPlans").collect())).length, 10)
})

test("Native channel semantics preserve exact field values and canonicalize overwrite order only", async () => {
    const first = backupStructure({ sourceId: "100", type: "text", name: "private", parentId: null, overwrites: [{ id: "1", type: "role", allow: "0", deny: "1024" }, { id: "2", type: "member", allow: "1024", deny: "0" }], topic: null, nsfw: false, slowmodeSeconds: 0, capturedAt: 1 })
    const reordered = { ...first, sourceId: "200", capturedAt: 2, overwrites: [...first.overwrites].reverse() }
    assert.equal(canonicalBackupJson(backupChannelSemantic(first)), canonicalBackupJson(backupChannelSemantic(reordered)))
    assert.notEqual(await backupHash(backupChannelSemantic(first)), await backupHash(backupChannelSemantic({ ...first, topic: "Different" })))
    assert.throws(() => backupManifest({ version: 2 }))
})

test("Committed backend results remain idempotent after expiry and malformed cached operations are rejected", async t => {
    const f = await fixture(t), planned = await f.plan(f.manifest([], [{ sourceId: "20", userId: "20", xp: 12 }]))
    await f.confirm(planned.plan); const first = await read(await f.apply(planned.items[0]!))
    f.advance(900001); assert.deepEqual(await read(await f.apply(planned.items[0]!)), first)
    await status(await f.work({ type: "invalid", binding: { ...binding(planned.items[0]!), itemNo: 1, generation: 1 }, context: f.context(), native: null }), 400)
    await status(await f.work({ type: "apply", binding: { ...binding(planned.items[0]!), itemNo: 1, generation: 1 }, context: f.context(), native: null, unknownField: true }), 400)
})

test("Proven no-dispatch origin may be re-previewed and old callback cannot change newer origin", async t => {
    const f = await fixture(t), object = f.channel(), proof = f.proof([object]), first = await f.plan(f.manifest([], [], [object]), proof), item = first.items[0]!
    await f.confirm(first.plan); await read(await f.reserve(item, proof)); await read(await f.claim(item, proof)); await read(await f.outcome(item, "failed", null, { noDispatch: true }))
    const next = await f.plan(f.manifest([], [], [object]), proof); assert.equal(next.items[0]!.disposition, "create"); await f.confirm(next.plan); await read(await f.reserve(next.items[0]!, proof)); await read(await f.claim(next.items[0]!, proof, "b".repeat(32)))
    assert.equal((await read(await f.outcome(item, "failed", null, { noDispatch: true }))).item.noDispatch, true)
    await status(await f.outcome(item, "created", { ...object, sourceId: "500" }), 409)
    const origin = await f.db.run(ctx => ctx.db.query("backupOrigins").first()); assert.equal(origin!.planId, next.plan.planId); assert.equal(origin!.state, "claimed"); assert.equal(origin!.mappedId, null)
})

test("Unclaimed expiry proves no dispatch while claimed expiry never allows a new origin attempt", async t => {
    const f = await fixture(t), object = f.channel(), first = await f.plan(f.manifest([], [], [object]), f.proof([object])); await f.confirm(first.plan); await read(await f.reserve(first.items[0]!, f.proof([object])))
    f.advance(130001); await f.clean()
    const freshObject = { ...object, capturedAt: f.now() }, next = await f.plan(f.manifest([], [], [freshObject]), f.proof([freshObject])); assert.equal(next.items[0]!.disposition, "create")
    await f.confirm(next.plan); await read(await f.reserve(next.items[0]!, f.proof([freshObject]))); await read(await f.claim(next.items[0]!, f.proof([freshObject])))
    f.advance(130001); await f.clean()
    const thirdObject = { ...object, capturedAt: f.now() }, third = await f.plan(f.manifest([], [], [thirdObject]), f.proof([thirdObject])); assert.equal(third.items[0]!.disposition, "blocked")
})

test("Native callbacks retain exact known identity with mismatched or unavailable snapshot and keep conflict history", async t => {
    const f = await fixture(t), object = f.channel(), planned = await f.plan(f.manifest([], [], [object]), f.proof([object])), item = planned.items[0]!
    await f.confirm(planned.plan); await read(await f.reserve(item, f.proof([object]))); await read(await f.claim(item, f.proof([object])))
    const actual = { ...object, sourceId: "500", name: "different-native-name" }
    await status(await f.outcome(item, "created", actual), 409)
    const result = await read(await f.outcome(item, "uncertain", actual)); assert.equal(result.item.mappedId, "500"); assert.equal(result.item.historicalOutcome, "uncertain")
    f.advance(130001)
    const reconciled = await read(await f.work({ type: "reconcile", binding: { ...binding(item), itemNo: item.itemNo, generation: 1 }, context: f.context(), native: { ...f.proof(), observations: [{ sourceId: "500", observedAt: f.now(), status: "present", channel: actual }] } }))
    assert.equal(reconciled.item.resolution, "conflict"); assert.equal(reconciled.item.historicalOutcome, "uncertain")
    await read(await f.manage({ type: "forget", binding: binding(planned.plan) }))
    f.advance(604800000 + 900001); await f.clean(); assert.equal((await f.db.run(ctx => ctx.db.query("backupPlans").collect())).length, 0); assert.equal((await f.db.run(ctx => ctx.db.query("backupOrigins").first()))!.mappedId, "500")
    const another = { ...f.channel("101"), capturedAt: f.now() }, second = await f.plan(f.manifest([], [], [another]), f.proof([another])); await f.confirm(second.plan); await read(await f.reserve(second.items[0]!, f.proof([another]))); await read(await f.claim(second.items[0]!, f.proof([another])))
    const knownOnly = await read(await f.outcome(second.items[0]!, "uncertain", null, { mappedId: "501" })); assert.equal(knownOnly.item.mappedId, "501")
})

test("Backend independently requires ManageRoles for initial overwrites and refuses noncanonical configuration names", async t => {
    const f = await fixture(t), object = f.channel(), proof = { ...f.proof([object]), botPermissions: "1040" }
    const planned = await f.plan(f.manifest([], [], [object]), proof); assert.equal(planned.items[0]!.disposition, "blocked"); assert.match(planned.items[0]!.reason!, /ManageRoles/)
    for (const family of ["draft", "panel", "ticketCategory"] as const) {
        const value = family === "draft" ? { kind: "draft", name: "Uppercase", content: { content: "Hello" } } : family === "panel" ? { kind: "reaction", name: "Uppercase", enabled: false, exclusive: false, mappings: [] } : { name: "Uppercase", enabled: false, visibility: "private", description: "", parentId: null, supportRoleIds: [], questions: [], cannedReplies: [] }
        assert.throws(() => backupConfig({ family, sourceId: family === "draft" ? "draft_Uppercase" : "Uppercase", value }))
    }
})
