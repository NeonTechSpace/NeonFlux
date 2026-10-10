import assert from "node:assert/strict"
import nodeTest, { after, type TestContext } from "node:test"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { readFileSync } from "node:fs"
import { createCipheriv, createHash } from "node:crypto"
import { makeFunctionReference } from "convex/server"
import type * as C from "../contracts.js"
import { adapterFixture } from "./adapter-fixture.ts"
import { BackupCryptoError, backupEnvelopeLimit, backupPlaintextLimit, parseBackupKey, encryptBackupManifest, decryptBackupEnvelope } from "../../bot/src/backup-crypto.ts"

const test = (name: string, body: (t: TestContext) => Promise<void>) => nodeTest(name, { timeout: 30000 }, body)
const proofCalls = { http: 0, sdkReads: 0, sdkCreates: 0, sdkMessages: 0, sdkUploads: 0, downloads: 0 }
after(t => t.diagnostic(`Backup contract call totals ${JSON.stringify(proofCalls)}, zero real network, uploads or native mutations`))
const joinedAt = "2020-02-29T00:30:00.123456789+00:00"
const owner: C.ModerationActor = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
const provider = "https://api.fluxer.app"
const modules = {
    "../convex/backup.ts": () => import("../convex/backup.ts"),
    "../convex/backupRetention.ts": () => import("../convex/backupRetention.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"),
    "../convex/leveling.ts": () => import("../convex/leveling.ts"),
    "../convex/levelingWork.ts": () => import("../convex/levelingWork.ts"),
}
const binding = ({ planId, revision, planHash, archiveDigest }: C.BackupBinding): C.BackupBinding => ({ planId, revision, planHash, archiveDigest })
const itemBinding = (item: C.BackupItem): C.BackupItemBinding => ({ ...binding(item), itemNo: item.itemNo, generation: item.generation })

async function fixture(t: TestContext) {
    const f = await adapterFixture(t, modules)
    t.after(() => { proofCalls.http += f.calls.length })
    const { createBackupStore, BackupStoreError } = await import("../../bot/src/backup-store.ts")
    const store = createBackupStore(f.config), wrongStore = createBackupStore(f.wrongConfig)
    const context = (patch: Partial<C.BackupContext> = {}): C.BackupContext => ({ provider, observedAt: f.now(), ownerId: "10", actorId: "10", actorKind: "human", botId: "999", botKind: "bot", ownerJoinedAt: joinedAt,
        ownerTimeoutUntil: null, botTimeoutUntil: null, dmChannelId: "90", dmType: 1, recipientIds: ["10"], privateReplyAuthorized: true, ...patch })
    const snapshotInput = (selected: C.BackupSnapshotRequest["selected"] = ["config", "xp"], current = context()): C.BackupSnapshotRequest => ({ serverId: "1", context: current, selected })
    const snapshot = (selected?: C.BackupSnapshotRequest["selected"]) => f.run<C.BackupSnapshot>(store.snapshot(snapshotInput(selected)))
    const queryInput = (operation: C.BackupQueryRequest["operation"], current = context()): C.BackupQueryRequest => ({ serverId: "1", context: current, operation })
    const query = (operation: C.BackupQueryRequest["operation"]) => f.run<C.BackupQueryResult>(store.query(queryInput(operation)))
    const manageInput = (operation: C.BackupManageRequest["operation"], current = context()): C.BackupManageRequest => ({ ...f.source(), context: current, operation })
    const manage = (operation: C.BackupManageRequest["operation"]) => f.run<C.BackupManageResult>(store.manage(manageInput(operation)))
    const work = (operation: C.BackupWorkRequest["operation"]) => f.run<C.BackupWorkResult>(store.work({ serverId: "1", operation }))
    const capabilityResult = await query({ type: "capabilities" }); assert.equal(capabilityResult.type, "capabilities")
    const capabilities = capabilityResult.capabilities
    let backupSequence = 0
    const manifest = (values: { config?: C.BackupConfigObject[], xp?: C.BackupXpObject[], structure?: C.BackupStructureObject[], backupId?: string } = {}): C.BackupManifest => {
        const config = values.config ?? [], xp = values.xp ?? [], structure = values.structure ?? []
        return { version: 1, backupId: values.backupId ?? `synthetic-backup-${++backupSequence}`, provider, serverId: "1", selected: [...(values.config ? ["config" as const] : []), ...(values.xp ? ["xp" as const] : []), ...(values.structure ? ["structure" as const] : [])],
            capturedAt: f.now(), observations: { databaseAt: values.config || values.xp ? f.now() : null, structureStartedAt: values.structure ? structure.length ? Math.min(...structure.map(row => row.capturedAt)) : f.now() : null, structureFinishedAt: values.structure ? structure.length ? Math.max(...structure.map(row => row.capturedAt)) : f.now() : null },
            counts: { config: config.length, xp: xp.length, structure: structure.length, overwrites: structure.reduce((total, row) => total + row.overwrites.length, 0) }, exclusions: [...capabilities.exclusions], config, xp, structure }
    }
    const native = (rows: C.BackupStructureObject[] = [], patch: Partial<C.BackupNativeProof> = {}): C.BackupNativeProof => ({ observedAt: f.now(), serverId: "1", ownerId: "10", botId: "999", actorPermissions: capabilities.knownDenyMask, botPermissions: capabilities.knownDenyMask,
        actorCanManageChannels: true, botCanManageChannels: true, references: [{ id: "1", type: "role", serverId: "1", observedAt: f.now(), exists: true, actorCanAccess: true, botCanAccess: true, actorCanManage: true, botCanManage: true, permissions: "0" }, { id: "999", type: "member", serverId: "1", observedAt: f.now(), exists: true, actorCanAccess: true, botCanAccess: true, actorCanManage: true, botCanManage: true, permissions: "0" }],
        observations: rows.map(row => ({ sourceId: row.sourceId, observedAt: f.now(), status: "absent", channel: null })), ...patch })
    const plan = async (archive: C.BackupManifest, proof: C.BackupNativeProof | null = null) => {
        const bytes = encryptBackupManifest(archive, keyring()), result = await manage({ type: "plan", manifest: archive, archiveDigest: createHash("sha256").update(bytes).digest("hex"), native: proof })
        assert.equal(result.type, "plan"); return result
    }
    const confirm = async (plan: C.BackupPlan) => { const result = await manage({ type: "confirm", binding: binding(plan) }); assert.equal(result.type, "confirmed"); return result.plan }
    const show = async (plan: C.BackupPlan) => { const result = await query({ type: "plan", binding: binding(plan) }); assert.equal(result.type, "plan"); return result.plan }
    const items = async (plan: C.BackupPlan) => {
        const values: C.BackupItem[] = []; let cursor: string | undefined
        for (let page = 0; page < 25; page++) {
            const result = await query({ type: "items", binding: binding(plan), ...(cursor ? { cursor } : {}) }); assert.equal(result.type, "items"); assert(result.items.length <= 20)
            values.push(...result.items)
            if (!result.nextCursor) return values
            assert.notEqual(result.nextCursor, cursor); cursor = result.nextCursor
        }
        assert.fail("500-item bounded plan discovery must finish")
    }
    const origins = async () => { const result = await query({ type: "origins", provider }); assert.equal(result.type, "origins"); return result.origins }
    const cleanup = () => f.backend.mutation(makeFunctionReference<"mutation">("backupRetention:cleanup"), {})
    return { ...f, store, wrongStore, BackupStoreError, context, snapshotInput, snapshot, queryInput, query, manageInput, manage, work, capabilities, manifest, native, plan, confirm, show, items, origins, cleanup }
}

async function sdk() {
    const require = createRequire(new URL("../../bot/package.json", import.meta.url))
    const { Clock, Effect, Exit, Fiber, Deferred, Random, Redacted } = await import(pathToFileURL(require.resolve("effect")).href)
    const { TestClock } = await import(pathToFileURL(require.resolve("effect/testing")).href)
    const root = new URL("./", pathToFileURL(require.resolve("@neontechspace/fluxerly/effect")))
    const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"))
    const { Permissions, commands } = await import(new URL(pkg.exports["./effect"].import, root).href)
    const { createTestBot } = await import(new URL(pkg.exports["./effect/testing"].import, root).href)
    return { Clock, Effect, Exit, Fiber, Deferred, Random, Redacted, TestClock, Permissions, commands, createTestBot }
}

async function withNative(f: Awaited<ReturnType<typeof adapterFixture>>, body: (runtime: Awaited<ReturnType<typeof sdk>>, bot: any) => any) {
    const runtime = await sdk(), { Clock, Effect, Random, TestClock, Permissions, createTestBot } = runtime
    return f.run(Effect.scoped(Effect.gen(function* () {
        yield* TestClock.adjust(`${f.now()} millis`)
        const clock = yield* Clock.Clock, origin = clock.monotonicTimeNanosUnsafe()
        const monotonicTimeNanosUnsafe = () => clock.monotonicTimeNanosUnsafe() - origin
        const sdkClock = { ...clock, monotonicTimeNanosUnsafe, monotonicTimeNanos: Effect.sync(monotonicTimeNanosUnsafe) }
        const bot = yield* createTestBot({ token: "synthetic-backup-sdk-token" }).pipe(Effect.provideService(Clock.Clock, sdkClock)), native = bot.fixtures
        const everyone = native.role({ id: "1", position: 0, permissions: (Permissions.ViewChannel | Permissions.ReadMessageHistory).toString() })
        const adminRole = native.role({ id: "50", permissions: Permissions.Administrator.toString() })
        const botRole = native.role({ id: "51", position: 10, permissions: (Permissions.ViewChannel | Permissions.SendMessages | Permissions.AttachFiles | Permissions.ReadMessageHistory | Permissions.ManageChannels | Permissions.ManageRoles).toString() })
        bot.rest.respond("GET /users/@me", { body: native.botUser({ id: "999" }) })
        bot.rest.respond("GET /guilds/1", { body: native.guild({ id: "1", owner_id: "10", name: "Synthetic backup server" }) })
        bot.rest.respond("GET /guilds/1/roles", { body: [everyone, adminRole, botRole] })
        for (const userId of ["10", "11"]) {
            const user = native.user({ id: userId, bot: false, system: false })
            bot.rest.respond(`GET /users/${userId}`, { body: user })
            bot.rest.respond(`GET /guilds/1/members/${userId}`, { body: native.member({ user, roles: ["50"], joined_at: joinedAt, communication_disabled_until: null }) })
        }
        bot.rest.respond("GET /guilds/1/members/999", { body: native.member({ user: native.botUser({ id: "999" }), roles: ["51"], joined_at: joinedAt, communication_disabled_until: null }) })
        const user = native.user({ id: "10", bot: false, system: false })
        bot.rest.respond("GET /channels/90", { body: { id: "90", type: 1, recipients: [user], last_message_id: null } })
        yield* body(runtime, bot).pipe(Effect.ensuring(Effect.sync(() => {
            const calls = bot.requests() as { method: string, path: string, matched: boolean }[]
            assert(calls.every(call => call.matched), JSON.stringify(calls.filter(call => !call.matched).map(({ method, path }) => ({ method, path }))))
            assert(!calls.some(call => ["DELETE", "PATCH", "PUT"].includes(call.method)), "Additive restore never mutates existing native resources")
            assert(!calls.some(call => /\/roles(?:\/|$)/.test(call.path) && call.method !== "GET"), "Backup never creates or assigns native roles")
            proofCalls.sdkReads += calls.filter(call => call.method === "GET").length
            proofCalls.sdkCreates += calls.filter(call => call.method === "POST" && /^\/guilds\/1\/channels$/.test(call.path)).length
            proofCalls.sdkMessages += calls.filter(call => call.method === "POST" && /\/channels\/\d+\/messages$/.test(call.path)).length
            proofCalls.sdkUploads += bot.requests().filter((call: any) => call.files.length > 0).length
        })))
    })).pipe(Random.withSeed("synthetic-backup-sdk"), Effect.provide(TestClock.layer())))
}

// Hold a real adapter boundary without fabricating its response or lifecycle binding
function barrier() {
    let enter!: () => void, release!: () => void, reject!: (error: Error) => void, reached = false
    const entered = new Promise<void>((resolve, fail) => { enter = resolve; reject = fail })
    const released = new Promise<void>(resolve => { release = resolve })
    return { entered, release, finish: () => { if (!reached) reject(new Error("Executor completed before the requested adapter boundary")) }, wait: async () => { reached = true; enter(); await released } }
}

const syntheticKey = Buffer.alloc(32, 17)
const syntheticEnvironment = { NEONFLUX_BACKUP_KEY: syntheticKey.toString("base64") }
function keyring() { const value = parseBackupKey(syntheticEnvironment); assert(value); return value }
function rawEnvelope(plaintext: string): Uint8Array {
    const version = Buffer.from([1]), nonce = Buffer.alloc(12, 7), cipher = createCipheriv("aes-256-gcm", syntheticKey, nonce, { authTagLength: 16 })
    cipher.setAAD(version)
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    return Buffer.concat([version, nonce, cipher.getAuthTag(), ciphertext])
}
function cryptoRejected(body: () => unknown, reason: BackupCryptoError["reason"]) {
    assert.throws(body, (error: unknown) => {
        assert(error instanceof BackupCryptoError)
        assert.equal(error.reason, reason)
        const diagnostic = JSON.stringify(error)
        for (const secret of [syntheticKey.toString("base64"), "Synthetic private authored content", "synthetic-auth-secret-should-never-be-recovery-key"])
            assert(!diagnostic.includes(secret), "Failure diagnostics contain neither recovery material nor plaintext")
        return true
    })
}

test("backup recovery key is optional independent canonical and redacted", async () => {
    assert.equal(parseBackupKey({}), undefined)
    assert(!JSON.stringify(keyring()).includes(syntheticKey.toString("base64")))
    for (const environment of [
        { NEONFLUX_BACKUP_KEY: Buffer.alloc(31).toString("base64") },
        { NEONFLUX_BACKUP_KEY: syntheticKey.toString("base64").replace(/=$/, "") },
        { ...syntheticEnvironment, FLUXER_BOT_TOKEN: syntheticKey.toString("base64") },
        { ...syntheticEnvironment, NEONFLUX_BOT_API_SECRET: syntheticKey.toString("base64") },
    ]) cryptoRejected(() => parseBackupKey(environment), "configuration")
})

test("backup authenticated envelope rejects tamper wrong keys versions and bounds without plaintext", async () => {
    const keys = keyring(), payload = { content: "Synthetic private authored content" }, bytes = encryptBackupManifest(payload, keys)
    assert.deepEqual(JSON.parse(JSON.stringify(decryptBackupEnvelope(bytes, keys))), payload)
    assert.equal(bytes[0], 1)
    assert.notDeepEqual(Buffer.from(encryptBackupManifest(payload, keys)).subarray(1, 13), Buffer.from(bytes).subarray(1, 13))
    assert(!Buffer.from(bytes).includes(Buffer.from(payload.content)))
    const wrong = parseBackupKey({ NEONFLUX_BACKUP_KEY: Buffer.alloc(32, 18).toString("base64") }); assert(wrong)
    cryptoRejected(() => decryptBackupEnvelope(bytes, wrong), "authentication")
    for (const offset of [1, 13, 29]) {
        const altered = Buffer.from(bytes); altered[offset] = altered[offset]! ^ 1
        cryptoRejected(() => decryptBackupEnvelope(altered, keys), "authentication")
    }
    const versioned = Buffer.from(bytes); versioned[0] = 2
    cryptoRejected(() => decryptBackupEnvelope(versioned, keys), "envelope")
    cryptoRejected(() => decryptBackupEnvelope(Buffer.from(bytes).subarray(0, 20), keys), "envelope")
    cryptoRejected(() => decryptBackupEnvelope(rawEnvelope('{"content":"Synthetic private authored content"'), keys), "manifest")
    const largest = "x".repeat(backupPlaintextLimit - 2)
    const roundtrip = decryptBackupEnvelope(encryptBackupManifest(largest, keys), keys)
    assert.equal(typeof roundtrip, "string")
    assert.equal((roundtrip as string).length, largest.length, "An exact 4MiB plaintext archive remains readable")
    cryptoRejected(() => encryptBackupManifest("x".repeat(backupPlaintextLimit), keys), "size")
    cryptoRejected(() => decryptBackupEnvelope(new Uint8Array(backupEnvelopeLimit + 1), keys), "size")
    cryptoRejected(() => decryptBackupEnvelope(rawEnvelope("x".repeat(backupPlaintextLimit + 1)), keys), "size")
})

test("backup authenticates all actual routes and rejects nonowner nonprivate and stale evidence", async t => {
    const f = await fixture(t), archive = f.manifest({ xp: [] }), request = f.manageInput({ type: "plan", manifest: archive, archiveDigest: "a".repeat(64), native: null })
    const fakeBinding: C.BackupItemBinding = { planId: "synthetic-never-created", revision: 1, planHash: "b".repeat(64), archiveDigest: "a".repeat(64), itemNo: 1, generation: 1 }
    for (const effect of [f.wrongStore.snapshot(f.snapshotInput()), f.wrongStore.query(f.queryInput({ type: "capabilities" })), f.wrongStore.manage(request), f.wrongStore.work({ serverId: "1", operation: { type: "apply", binding: fakeBinding, context: f.context(), native: null } })])
        await f.reject(effect, f.BackupStoreError, 401)
    assert.deepEqual(new Set(f.calls.filter(call => call.status === 401).map(call => call.path)), new Set(["/backup/snapshot", "/backup/query", "/backup/manage", "/backup/work"]))
    await f.reject(f.store.snapshot({ ...f.snapshotInput(), serverId: "2" }), f.BackupStoreError, 403)
    for (const patch of [{ actorId: "11" }, { recipientIds: ["10", "11"] }, { recipientIds: ["11", "999"] }, { privateReplyAuthorized: false }, { ownerTimeoutUntil: new Date(f.now() + 10000).toISOString() }, { botTimeoutUntil: new Date(f.now() + 10000).toISOString() }])
        await f.reject(f.store.snapshot(f.snapshotInput(["config"], f.context(patch))), f.BackupStoreError, 403)
    await f.reject(f.store.snapshot(f.snapshotInput(["config"], f.context({ observedAt: f.now() - 60001 }))), f.BackupStoreError, 400)
    const plans = await f.query({ type: "plans" }); assert.equal(plans.type, "plans"); assert.deepEqual(plans.plans, [])
    assert.equal(f.capabilities.version, 1)
    assert.deepEqual(f.capabilities.limits, { xp: 1000, structure: 100, overwrites: 500, planItems: 500, plans: 10, page: 20, planMs: 900000, snapshotBytes: 1048576, planBytes: 524288, originMappings: 5000 })
})

test("backup selected configuration and XP come through one sideeffectfree snapshot request", async t => {
    const f = await fixture(t)
    const tablesBefore = await f.backend.run(async ctx => ({ settings: await ctx.db.query("levelingSettings").collect(), profiles: await ctx.db.query("levelingProfiles").collect(), plans: await ctx.db.query("backupPlans").collect() }))
    const callCount = f.calls.length, snapshot = await f.snapshot()
    assert.equal(f.calls.length, callCount + 1)
    assert.deepEqual(f.calls.at(-1), { path: "/backup/snapshot", status: 200 })
    assert.equal(snapshot.capturedAt, f.now())
    assert.deepEqual(snapshot.counts, { config: snapshot.config.length, xp: snapshot.xp.length })
    assert.deepEqual(snapshot.xp, [])
    const tablesAfter = await f.backend.run(async ctx => ({ settings: await ctx.db.query("levelingSettings").collect(), profiles: await ctx.db.query("levelingProfiles").collect(), plans: await ctx.db.query("backupPlans").collect() }))
    assert.deepEqual(tablesAfter, tablesBefore)
    const xpOnly = await f.snapshot(["xp"]); assert.deepEqual(xpOnly.config, [])
    const configOnly = await f.snapshot(["config"]); assert.deepEqual(configOnly.xp, [])
})

test("backup XP exports effective current epochs and imports missing scores without reward work", async t => {
    const f = await fixture(t), { createLevelingStore } = await import("../../bot/src/level-store.ts"), levels = createLevelingStore(f.config)
    const manage = (operation: C.LevelingManageOperation) => f.run<C.LevelingManageResult>(levels.manage({ ...f.source(), actor: owner, operation }))
    const result = await manage({ type: "adjust", userId: "20", xp: 250, reason: "Synthetic XP fixture" }); assert(!result.duplicate && result.type === "profile")
    const reset = await manage({ type: "reset-server", reason: "Synthetic epoch fixture", confirm: "reset-server" }); assert(!reset.duplicate && reset.type === "reset")
    const exported = await f.snapshot(["xp"])
    assert.deepEqual(exported.xp.map(row => ({ userId: row.userId, xp: row.xp })), [{ userId: "20", xp: 0 }])
    assert(exported.xp.every(row => Object.keys(row).sort().join() === "sourceId,userId,xp"))
    const before = await f.backend.run(async ctx => ({ work: (await ctx.db.query("levelingProfiles").collect()).filter(row => row.rewardDueAt !== undefined), settings: await ctx.db.query("levelingSettings").unique() }))
    assert(before.settings)
    const archive = f.manifest({ xp: [{ sourceId: "21", userId: "21", xp: 350 }] }), planned = await f.plan(archive)
    assert.equal(planned.items[0]!.disposition, "create")
    await f.confirm(planned.plan)
    const item = planned.items[0]!, applied = await f.work({ type: "apply", binding: itemBinding(item), context: f.context(), native: null }); assert.equal(applied.type, "item"); assert.equal(applied.item.state, "created")
    assert.deepEqual(await f.work({ type: "apply", binding: itemBinding(item), context: f.context(), native: null }), applied)
    const after = await f.backend.run(async ctx => ({ work: (await ctx.db.query("levelingProfiles").collect()).filter(row => row.rewardDueAt !== undefined), settings: await ctx.db.query("levelingSettings").unique(), profile: await ctx.db.query("levelingProfiles").withIndex("by_user", q => q.eq("serverId", "1").eq("userId", "21")).unique() }))
    assert(after.settings && after.profile)
    assert.deepEqual(after.work, before.work)
    assert.equal(after.settings.dirty, before.settings.dirty)
    assert.equal(after.profile.scoreEpoch, after.settings.config.scoreEpoch)
    assert.equal(after.profile.scoreEpoch, reset.settings.scoreEpoch)
    assert.deepEqual(after.profile.digests, [])
    assert.equal(after.profile.xp, 350)
    assert.equal(after.profile.adjustmentRevision, 0)
    const identical = await f.plan(f.manifest({ xp: archive.xp })); assert.equal(identical.items[0]!.disposition, "skip")
    const conflict = await f.plan(f.manifest({ xp: [{ ...archive.xp[0]!, xp: 999 }] })); assert.equal(conflict.items[0]!.disposition, "conflict")
    assert.equal((await f.snapshot(["xp"])).xp.find(row => row.userId === "21")!.xp, 350)
})

test("backup XP 1001 profiles fails the bounded snapshot without partial response or mutation", async t => {
    const f = await fixture(t)
    await f.backend.run(async ctx => {
        for (let i = 0; i < 1001; i++) await ctx.db.insert("levelingProfiles", { serverId: "1", userId: String(10000 + i), xp: i, scoreEpoch: 1, adjustmentRevision: 0, digests: [] })
    })
    await f.reject(f.store.snapshot(f.snapshotInput(["xp"])), f.BackupStoreError, 413)
    assert.equal((await f.backend.run(ctx => ctx.db.query("levelingProfiles").collect())).length, 1001)
    assert.deepEqual(await f.origins(), [])
    assert.deepEqual((await f.query({ type: "plans" }) as Extract<C.BackupQueryResult, { type: "plans" }>).plans, [])
})

test("backup confirmation binds owner source archive digest exact plan and fifteen minute expiry", async t => {
    const f = await fixture(t), planned = await f.plan(f.manifest({ xp: [{ sourceId: "20", userId: "20", xp: 10 }] })), row = planned.items[0]!
    await f.reject(f.store.work({ serverId: "1", operation: { type: "apply", binding: itemBinding(row), context: f.context(), native: null } }), f.BackupStoreError, 409)
    for (const patch of [{ planHash: "f".repeat(64) }, { archiveDigest: "f".repeat(64) }]) {
        const bad = { ...binding(planned.plan), ...patch } as C.BackupBinding
        await f.reject(f.store.manage(f.manageInput({ type: "confirm", binding: bad })), f.BackupStoreError, 409)
    }
    await f.reject(f.store.manage(f.manageInput({ type: "confirm", binding: { ...binding(planned.plan), revision: 2 } as unknown as C.BackupBinding })), f.BackupStoreError, 400)
    await f.reject(f.store.manage(f.manageInput({ type: "confirm", binding: binding(planned.plan) }, f.context({ actorId: "11" }))), f.BackupStoreError, 403)
    const confirmed = await f.confirm(planned.plan); assert.equal(confirmed.confirmedAt, f.now())
    assert.equal((await f.confirm(planned.plan)).confirmedAt, confirmed.confirmedAt)
    f.advance(900001)
    await f.reject(f.store.work({ serverId: "1", operation: { type: "apply", binding: itemBinding(row), context: f.context(), native: null } }), f.BackupStoreError, 409)
    assert.deepEqual((await f.snapshot(["xp"])).xp, [])
})

function structure(now: number, sourceId = "30", type: C.BackupStructureObject["type"] = "category", parentId: string | null = null): C.BackupStructureObject {
    return { sourceId, type, name: `synthetic-${type}-${sourceId}`, parentId, overwrites: [{ id: "1", type: "role", allow: "0", deny: "1024" }, { id: "999", type: "member", allow: "1024", deny: "0" }], capturedAt: now,
        ...(type === "text" ? { topic: null, nsfw: false, slowmodeSeconds: 0 } : type === "voice" ? { bitrate: 64000, userLimit: 0 } : {}) }
}

test("backup refuses unsupported identities fields permission grants and duplicate objects before plans", async t => {
    const f = await fixture(t), row = structure(f.now()), archive = f.manifest({ structure: [row] })
    const invalid: unknown[] = [
        { ...archive, version: 2 }, { ...archive, serverId: "2" },
        { ...archive, structure: [{ ...row, type: "role" }] },
        { ...archive, structure: [{ ...row, extra: "Synthetic private authored content" }] },
        { ...archive, structure: [{ ...row, overwrites: [{ ...row.overwrites[0]!, allow: "8" }] }] },
        { ...archive, structure: [{ ...row, overwrites: [{ ...row.overwrites[0]!, allow: (1n << 63n).toString() }] }] },
        { ...archive, structure: [{ ...row, overwrites: [...row.overwrites, ...row.overwrites] }] },
        { ...archive, structure: [row, row], counts: { ...archive.counts, structure: 2, overwrites: 2 } },
        { ...archive, config: [{ family: "private-history", sourceId: "history", value: {} }], selected: ["config"], counts: { config: 1, xp: 0, structure: 0, overwrites: 0 }, structure: [] },
    ]
    for (const value of invalid) {
        const input = f.manageInput({ type: "plan", manifest: value as C.BackupManifest, archiveDigest: "a".repeat(64), native: f.native([row]) })
        const { Effect, Exit } = await sdk(), exit = await f.run<any>(Effect.exit(f.store.manage(input)))
        assert(Exit.isFailure(exit)); assert(!JSON.stringify(exit).includes("Synthetic private authored content"))
        assert.deepEqual((await f.query({ type: "plans" }) as Extract<C.BackupQueryResult, { type: "plans" }>).plans, [])
    }
    assert.deepEqual(await f.origins(), [])
})

test("backup native dependency plan maps category before text and voice and blocks missing audience", async t => {
    const f = await fixture(t), category = structure(f.now()), text = structure(f.now(), "31", "text", "30"), voice = structure(f.now(), "32", "voice", "30"), rows = [text, voice, category]
    const planned = await f.plan(f.manifest({ structure: rows }), f.native(rows))
    const items = await f.items(planned.plan), parent = items.find(i => i.sourceId === "30")!
    assert.equal(parent.disposition, "create")
    for (const child of items.filter(i => i.sourceId !== "30")) assert.equal(child.dependencyItemNo, parent.itemNo)
    await f.confirm(planned.plan)
    const child = items.find(i => i.sourceId === "31")!
    const premature = await f.plan(f.manifest({ structure: rows }), f.native(rows)); await f.confirm(premature.plan)
    const prematureChild = premature.items.find(i => i.sourceId === "31")!, denied = await f.work({ type: "reserve", binding: itemBinding(prematureChild), context: f.context(), native: f.native(rows) })
    assert.equal(denied.type, "item"); assert.equal(denied.item.state, "blocked")
    const reserved = await f.work({ type: "reserve", binding: itemBinding(parent), context: f.context(), native: f.native(rows) }); assert.equal(reserved.type, "grant"); assert.equal(reserved.claimed, false)
    const claimed = await f.work({ type: "claim", binding: itemBinding(parent), context: f.context(), native: f.native(rows), claimToken: "a".repeat(32) }); assert.equal(claimed.type, "grant"); assert.equal(claimed.claimed, true)
    const created = { ...category, sourceId: "130" }
    await f.work({ type: "outcome", binding: itemBinding(parent), claimToken: "a".repeat(32), outcome: "created", mappedId: "130", channel: created })
    const proof = f.native(rows, { observations: [...f.native(rows).observations, { sourceId: "130", observedAt: f.now(), status: "present", channel: created }], references: [...f.native(rows).references, { id: "130", type: "category", serverId: "1", observedAt: f.now(), exists: true, actorCanAccess: true, botCanAccess: true, actorCanManage: true, botCanManage: true, permissions: f.capabilities.safeAllowMask }] })
    const ready = await f.work({ type: "reserve", binding: itemBinding(child), context: f.context(), native: proof }); assert.equal(ready.type, "grant"); assert.equal(ready.grant.channel.parentId, "130")
    assert.deepEqual(ready.grant.channel.overwrites, text.overwrites)
    const blocked = await f.plan(f.manifest({ structure: [structure(f.now(), "35")] }), f.native([structure(f.now(), "35")], { references: [] }))
    assert.equal(blocked.items[0]!.disposition, "blocked")
})

test("backup config-only plans reuse retained native origin mappings before comparison and reference validation", async t => {
    const f = await fixture(t), channel = structure(f.now(), "30", "text"), structural = await f.plan(f.manifest({ structure: [channel] }), f.native([channel])), nativeItem = structural.items[0]!
    await f.confirm(structural.plan)
    await f.work({ type: "reserve", binding: itemBinding(nativeItem), context: f.context(), native: f.native([channel]) })
    await f.work({ type: "claim", binding: itemBinding(nativeItem), context: f.context(), native: f.native([channel]), claimToken: "a".repeat(32) })
    await f.work({ type: "outcome", binding: itemBinding(nativeItem), claimToken: "a".repeat(32), outcome: "created", mappedId: "130", channel: { ...channel, sourceId: "130" } })
    const object: C.BackupConfigObject = { family: "response", sourceId: "custom_mappedprobe", value: { kind: "custom", name: "mappedprobe", reply: { type: "text", text: "Synthetic mapped configuration" }, channelIds: ["30"], roleIds: [], cooldownSeconds: 0, priority: 0, enabled: true } }
    const proof = f.native([], { references: [{ id: "130", type: "text", serverId: "1", observedAt: f.now(), exists: true, actorCanAccess: true, botCanAccess: true, actorCanManage: true, botCanManage: true, permissions: f.capabilities.knownDenyMask }] })
    const created = await f.plan(f.manifest({ config: [object] }), proof), item = created.items[0]!
    assert.equal(item.disposition, "create"); assert.equal(item.sourceId, "custom_mappedprobe")
    const payload = await f.query({ type: "item", binding: itemBinding(item) }); assert.equal(payload.type, "item"); assert.deepEqual(payload.object, object, "Stored archive source identity and original references remain immutable")
    await f.confirm(created.plan)
    const applied = await f.work({ type: "apply", binding: itemBinding(item), context: f.context(), native: proof }); assert.equal(applied.type, "item"); assert.equal(applied.item.state, "created")
    const snapshot = await f.snapshot(["config"]), actual = snapshot.config.find((x): x is Extract<C.BackupConfigObject, { family: "response" }> => x.family === "response" && x.sourceId === object.sourceId)
    assert(actual); assert.deepEqual(actual.value.channelIds, ["130"]); assert.equal(actual.value.enabled, false)
    const newer = await f.plan(f.manifest({ config: [object], backupId: "synthetic-new-mapped-archive" }), proof), identical = newer.items[0]!
    assert.equal(identical.disposition, "skip"); assert.equal(identical.desiredHash, item.desiredHash)
    await f.confirm(newer.plan)
    const skipped = await f.work({ type: "apply", binding: itemBinding(identical), context: f.context(), native: proof }); assert.equal(skipped.type, "item"); assert.equal(skipped.item.state, "skipped")
    assert.equal((await f.backend.run(ctx => ctx.db.query("responseDefinitions").collect())).length, 1)
    const policy: C.BackupConfigObject = { family: "cleanupPolicy", sourceId: "30", value: { channelId: "30", enabled: true, ageMs: 3600000, ownerId: "10", excludedAuthorIds: [], excludedMessageIds: [] } }
    const ownerProof = { ...proof, references: [...proof.references, { id: "10", type: "member" as const, serverId: "1", observedAt: f.now(), exists: true, actorCanAccess: true, botCanAccess: true, actorCanManage: true, botCanManage: true, permissions: "0" }] }
    const policyPlan = await f.plan(f.manifest({ config: [policy] }), ownerProof); assert.equal(policyPlan.items[0]!.sourceId, "30"); assert.equal(policyPlan.items[0]!.disposition, "create"); await f.confirm(policyPlan.plan)
    const policyResult = await f.work({ type: "apply", binding: itemBinding(policyPlan.items[0]!), context: f.context(), native: ownerProof }); assert.equal(policyResult.type, "item"); assert.equal(policyResult.item.state, "created")
    assert.equal((await f.backend.run(ctx => ctx.db.query("cleanupPolicies").first()))!.channelId, "130")
    const policyRepeat = await f.plan(f.manifest({ config: [policy] }), ownerProof); assert.equal(policyRepeat.items[0]!.disposition, "skip"); assert.equal(policyRepeat.items[0]!.sourceId, "30")
})

test("backup origin uncertainty binds across different backup IDs and exact late callback cannot replace mapping", async t => {
    const f = await fixture(t), row = structure(f.now()), planned = await f.plan(f.manifest({ structure: [row] }), f.native([row])), item = planned.items[0]!
    await f.confirm(planned.plan)
    await f.work({ type: "reserve", binding: itemBinding(item), context: f.context(), native: f.native([row]) })
    const claimed = await f.work({ type: "claim", binding: itemBinding(item), context: f.context(), native: f.native([row]), claimToken: "a".repeat(32) }); assert.equal(claimed.type, "grant"); assert(claimed.claimed)
    await f.work({ type: "outcome", binding: itemBinding(item), claimToken: "a".repeat(32), outcome: "uncertain", mappedId: null, channel: null })
    const repeated = await f.plan(f.manifest({ structure: [row], backupId: "synthetic-new-archive" }), f.native([row]))
    assert.equal(repeated.items[0]!.disposition, "blocked")
    assert.equal((await f.origins()).length, 1)
    const created = { ...row, sourceId: "130" }, late = await f.work({ type: "outcome", binding: itemBinding(item), claimToken: "a".repeat(32), outcome: "created", mappedId: "130", channel: created })
    assert.equal(late.type, "item"); assert.equal(late.item.historicalOutcome, "uncertain"); assert.equal(late.item.mappedId, "130")
    const before = await f.origins()
    const { Effect, Exit } = await sdk(), stale = await f.run<any>(Effect.exit(f.store.work({ serverId: "1", operation: { type: "outcome", binding: itemBinding(item), claimToken: "a".repeat(32), outcome: "created", mappedId: "131", channel: { ...row, sourceId: "131" } } })))
    assert(Exit.isFailure(stale) || stale.value.item.mappedId === "130")
    assert.deepEqual(await f.origins(), before)
    f.advance(130001)
    const recovery = f.native([row], { observations: [{ sourceId: "130", observedAt: f.now(), status: "present", channel: created }] })
    const reconciled = await f.work({ type: "reconcile", binding: itemBinding(item), context: f.context(), native: recovery }); assert.equal(reconciled.type, "item")
    assert.equal(reconciled.item.historicalOutcome, "uncertain"); assert.equal(reconciled.item.resolution, "match")
    assert.equal((await f.items(repeated.plan))[0]!.mappedId, null, "Late callback stays bound to its original plan")
})

test("backup committed claim lost response consumes origin without native replay or name adoption", async t => {
    const f = await fixture(t), row = structure(f.now()), planned = await f.plan(f.manifest({ structure: [row] }), f.native([row])), item = planned.items[0]!
    await f.confirm(planned.plan)
    await f.work({ type: "reserve", binding: itemBinding(item), context: f.context(), native: f.native([row]) })
    const { Effect, Exit } = await sdk(), request: C.BackupWorkRequest = { serverId: "1", operation: { type: "claim", binding: itemBinding(item), context: f.context(), native: f.native([row]), claimToken: "a".repeat(32) } }
    const lost = await f.run<any>(Effect.exit(f.store.work(request).pipe(Effect.flatMap(() => Effect.fail(new f.BackupStoreError({ operation: "synthetic-lost-response", status: null }))))))
    assert(Exit.isFailure(lost)); assert.equal((await f.items(planned.plan))[0]!.state, "claimed")
    const replayed = await f.run<C.BackupWorkResult>(f.store.work(request)); assert.equal(replayed.type, "grant"); assert.equal(replayed.claimed, false)
    const different = await f.plan(f.manifest({ structure: [row] }), f.native([row])); assert.equal(different.items[0]!.disposition, "blocked")
    f.advance(130001); await f.cleanup()
    assert.equal((await f.items(planned.plan))[0]!.state, "uncertain")
    assert.equal((await f.origins())[0]!.state, "uncertain")
})

test("backup actual SDK owner authority stays private and administrator alone cannot export", async t => {
    const f = await adapterFixture(t, {}), { readBackupContext } = await import("../../bot/src/backup-permissions.ts")
    await withNative(f, ({ Effect, Exit }, bot) => Effect.gen(function* () {
        const accepted = yield* readBackupContext(bot.client, "1", "10", "90")
        assert.equal(accepted.ownerId, "10"); assert.equal(accepted.actorId, "10"); assert.deepEqual(accepted.recipientIds, ["10"])
        const administrator = yield* Effect.exit(readBackupContext(bot.client, "1", "11", "90")); assert(Exit.isFailure(administrator))
        const group = bot.rest.respond("GET /channels/90", { body: { id: "90", type: 3, owner_id: "10", recipients: [bot.fixtures.user({ id: "10" }), bot.fixtures.user({ id: "11" })] } })
        assert(Exit.isFailure(yield* Effect.exit(readBackupContext(bot.client, "1", "10", "90")))); group.remove()
        const other = bot.rest.respond("GET /channels/90", { body: { id: "90", type: 1, recipients: [bot.fixtures.user({ id: "11" })] } })
        assert(Exit.isFailure(yield* Effect.exit(readBackupContext(bot.client, "1", "10", "90")))); other.remove()
        const changedOwner = bot.rest.respond("GET /guilds/1", { body: bot.fixtures.guild({ id: "1", owner_id: "11" }) })
        assert(Exit.isFailure(yield* Effect.exit(readBackupContext(bot.client, "1", "10", "90")))); changedOwner.remove()
        assert(bot.requests().filter((r: any) => r.path === "/guilds/1").length >= 5, "Owner authority is freshly read for each invocation")
        assert(!bot.requests().some((r: any) => r.method !== "GET"))
    }))
})

test("backup actual SDK private attachment binding origin redirects and length prevent arbitrary download", async t => {
    const f = await adapterFixture(t, {}), { downloadBackupAttachment } = await import("../../bot/src/backup-attachments.ts")
    await withNative(f, ({ Effect, Exit }, bot) => Effect.gen(function* () {
        const instance = yield* bot.client.instance.resolve(), base = instance.endpoints.media.replace(/\/$/, ""), filename = "neonflux-backup-synthetic.nfb", bytes = encryptBackupManifest({ content: "Synthetic private authored content" }, keyring())
        const url = `${base}/attachments/90/70/${filename}`, attachment = { id: "70", filename, size: bytes.length, content_type: "application/octet-stream", flags: 0, url, proxy_url: `${base}/unselected-proxy` }
        const originalWire = { ...bot.fixtures.message({ id: "71", channel_id: "90", author: bot.fixtures.user({ id: "10", bot: false, system: false }), attachments: [attachment] }) }; delete originalWire.guild_id
        let current = originalWire
        bot.rest.respond("GET /channels/90/messages/71", () => ({ body: current }))
        const original = yield* bot.client.messages.fetch({ channelId: "90", id: "71" }), media = bot.rest.respond(url, () => new Response(new Uint8Array(bytes).buffer, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(bytes.length) } }))
        const read = yield* downloadBackupAttachment(bot.client, { serverId: "1", message: original })
        assert.deepEqual(Buffer.from(read), Buffer.from(bytes)); assert.equal(media.requests().length, 1)
        const baseline = media.requests().length
        for (const patch of [{ id: "72" }, { filename: "other.nfb" }, { size: bytes.length + 1 }, { content_type: "text/plain" }, { url: "https://untrusted.invalid/attachments/90/70/neonflux-backup-synthetic.nfb" }, { url: `${base}/attachments/91/70/${filename}` }, { url: `${base}/attachments/90/72/${filename}` }, { url: `${url}#private-secret` }, { url: `${base}/proxy/90/70/${filename}` }]) {
            current = { ...originalWire, attachments: [{ ...attachment, ...patch }] }
            const rejected = yield* Effect.exit(downloadBackupAttachment(bot.client, { serverId: "1", message: original }))
            assert(Exit.isFailure(rejected)); assert(!JSON.stringify(rejected).includes("private-secret")); assert.equal(media.requests().length, baseline)
        }
        for (const patch of [{ author: bot.fixtures.user({ id: "11", bot: false, system: false }) }, { attachments: [attachment, attachment] }, { guild_id: "1" }, { webhook_id: "77" }]) {
            current = { ...originalWire, ...patch }
            assert(Exit.isFailure(yield* Effect.exit(downloadBackupAttachment(bot.client, { serverId: "1", message: original })))); assert.equal(media.requests().length, baseline)
        }
        current = originalWire
        const redirect = bot.rest.respond(url, new Response(null, { status: 302, headers: { Location: "https://untrusted.invalid/redirect" } }))
        assert(Exit.isFailure(yield* Effect.exit(downloadBackupAttachment(bot.client, { serverId: "1", message: original })))); redirect.remove()
        const short = bot.rest.respond(url, new Response(new Uint8Array(1)))
        assert(Exit.isFailure(yield* Effect.exit(downloadBackupAttachment(bot.client, { serverId: "1", message: original })))); short.remove()
        const requests = bot.requests().filter((r: any) => r.path.startsWith("http"))
        assert.equal(requests.length, 3); assert(requests.every((r: any) => r.url === url && r.method === "GET"))
        proofCalls.downloads += requests.length
        assert(!bot.requests().some((r: any) => r.method !== "GET"))
    }))
})

test("backup actual SDK structure captures explicit supported fields, skips unsupported types and refuses oversized snapshots", async t => {
    const f = await adapterFixture(t, {}), { captureBackupStructure } = await import("../../bot/src/backup-permissions.ts")
    await withNative(f, ({ Effect, Exit }, bot) => Effect.gen(function* () {
        const native = (id: string, type: number, parent: string | null = null) => bot.fixtures.channel({ id, guild_id: "1", type, name: `synthetic-${id}`, parent_id: parent, permission_overwrites: [{ id: "1", type: 0, allow: "0", deny: "1024" }], ...(type === 2 ? { bitrate: 64000, user_limit: 0 } : {}) })
        let channels = [native("31", 0, "30"), native("30", 4), native("32", 2, "30")]
        const route = bot.rest.respond("GET /guilds/1/channels", () => ({ body: channels }))
        const captured = yield* captureBackupStructure(bot.client, "1", "10", "90")
        assert.equal(captured.objects.length, 3); assert.equal(captured.objects[0]!.type, "category")
        assert.equal(captured.startedAt, f.now()); assert.equal(captured.finishedAt, f.now())
        assert(captured.objects.every(o => o.capturedAt === f.now() && !Object.hasOwn(o, "guildId") && !Object.hasOwn(o, "position")))
        channels = [native("30", 5), native("31", 0)]; assert.deepEqual((yield* captureBackupStructure(bot.client, "1", "10", "90")).objects.map(o => o.sourceId), ["31"])
        channels = Array.from({ length: 101 }, (_, i) => native(String(300 + i), 0)); assert(Exit.isFailure(yield* Effect.exit(captureBackupStructure(bot.client, "1", "10", "90"))))
        channels = [native("30", 4), native("31", 0, "39")]; assert(Exit.isFailure(yield* Effect.exit(captureBackupStructure(bot.client, "1", "10", "90"))))
        channels = [native("30", 4), native("30", 4)]; assert(Exit.isFailure(yield* Effect.exit(captureBackupStructure(bot.client, "1", "10", "90"))))
        channels = Array.from({ length: 6 }, (_, i) => ({ ...native(String(500 + i), 4), permission_overwrites: Array.from({ length: 100 }, (_, j) => ({ id: String(1000 + j), type: 0, allow: "0", deny: "1024" })) })); assert(Exit.isFailure(yield* Effect.exit(captureBackupStructure(bot.client, "1", "10", "90"))))
        assert.equal(route.requests().length, 6)
        assert(!bot.requests().some((r: any) => r.method !== "GET"))
    }))
})

async function authoredConfig(): Promise<C.BackupConfigObject[]> {
    const { defaultSettings } = await import("../convex/moderationDomain.ts"), { defaultRolesSettings } = await import("../convex/rolesDomain.ts"), { defaultLevelingSettings } = await import("../convex/levelingDomain.ts"), { defaultGreetings } = await import("../convex/greetingsDomain.ts")
    const { defcon: _defcon, ...moderation } = defaultSettings(), { revision: _rolesRevision, ...roles } = defaultRolesSettings(), { revision: _levelRevision, mappingRevision: _mappingRevision, scoreEpoch: _scoreEpoch, ...leveling } = defaultLevelingSettings()
    const defaults = defaultGreetings(), routes = Object.fromEntries(Object.entries(defaults.routes).map(([route, { revision: _revision, ...value }]) => [route, value])) as C.BackupConfigValues["greetings"]["routes"]
    const content: C.PublishingContent = { content: "Synthetic authored backup content" }
    return [
        { family: "moderation", sourceId: "moderation", value: moderation },
        { family: "responses", sourceId: "responses", value: { customEnabled: true, autoEnabled: true } },
        { family: "response", sourceId: "custom_restoreprobe", value: { kind: "custom", name: "restoreprobe", reply: { type: "text", text: "Synthetic custom response" }, channelIds: [], roleIds: [], cooldownSeconds: 0, priority: 0, enabled: true } },
        { family: "response", sourceId: "auto_restoreprobe", value: { kind: "auto", name: "restoreprobe", reply: { type: "text", text: "Synthetic autoresponse" }, trigger: { mode: "exact", text: "Synthetic trigger" }, channelIds: [], roleIds: [], cooldownSeconds: 0, priority: 0, enabled: true } },
        { family: "automod", sourceId: "backup", value: { name: "backup", type: "words", enabled: true, priority: 0, action: "log", threshold: 1, windowSeconds: 30, durationSeconds: 60, patterns: ["synthetic"], domainMode: "block", channelIds: [], exemptChannelIds: [], exemptRoleIds: [] } },
        { family: "publishing", sourceId: "publishing", value: { enabled: true, retentionDays: 180 } },
        { family: "draft", sourceId: "draft_backup", value: { kind: "draft", name: "backup", content } },
        { family: "draft", sourceId: "template_backup", value: { kind: "template", name: "backup", content } },
        { family: "roles", sourceId: "roles", value: { ...roles, panelsEnabled: true, autoroleEnabled: true, verificationEnabled: true } },
        { family: "panel", sourceId: "backup", value: { name: "backup", kind: "reaction", enabled: true, exclusive: false, mappings: [{ emoji: "✅", roleId: "40", prerequisiteRoleIds: [], exclusionRoleIds: [] }] } },
        { family: "greetings", sourceId: "greetings", value: { claimsPerMinute: defaults.claimsPerMinute, retentionDays: defaults.retentionDays, routes } },
        { family: "tickets", sourceId: "tickets", value: { enabled: true, retentionDays: 30 } },
        { family: "ticketCategory", sourceId: "backup", value: { name: "backup", enabled: true, visibility: "private", description: "Synthetic support category", parentId: "30", supportRoleIds: [], questions: ["Synthetic intake question"], cannedReplies: [{ name: "reply", templateName: "backup", templateRevision: 1, content }] } },
        { family: "leveling", sourceId: "leveling", value: { ...leveling, enabled: true } },
        { family: "milestones", sourceId: "milestones", value: { enabled: true } },
        { family: "milestoneRoute", sourceId: "anniversary", value: { kind: "anniversary", channelId: "31", zone: "UTC", time: "12:00", fold: "reject", template: { name: "backup", revision: 1 }, content, enabled: true } },
        { family: "suggestions", sourceId: "suggestions", value: { enabled: true, channelId: "31" } },
        { family: "cleanup", sourceId: "cleanup", value: { enabled: true } },
        { family: "cleanupPolicy", sourceId: "31", value: { channelId: "31", enabled: true, ageMs: 3600000, ownerId: "10", excludedAuthorIds: ["20"], excludedMessageIds: ["60"] } },
        { family: "metadata", sourceId: "metadata", value: { enabled: true, routes: (["membership", "resources", "messages", "audit", "settings", "operations", "security"] as const).map(category => ({ category, enabled: true, channelId: "31", ownerId: "10" })), messageChannelIds: [], excludedChannelIds: [] } },
        { family: "events", sourceId: "events", value: { enabled: true } },
        { family: "schedules", sourceId: "schedules", value: { enabled: true } },
    ]
}
function disabledConfig(rows: C.BackupConfigObject[]): C.BackupConfigObject[] {
    const result = structuredClone(rows)
    for (const row of result) {
        const value = row.value as unknown as Record<string, unknown>
        for (const key of ["enabled", "customEnabled", "autoEnabled", "manualModerationEnabled", "automodEnabled", "securityEnabled", "joinEnabled", "honeypotEnabled", "watchlistEnabled", "appealsEnabled", "panelsEnabled", "verificationEnabled", "autoroleEnabled"]) if (key in value) value[key] = false
        if (row.family === "greetings") Object.values(row.value.routes).forEach(route => { route.enabled = false })
        if (row.family === "metadata") {
            row.value.routes.forEach(route => { route.enabled = false })
            row.value.eventRoutes = (row.value.eventRoutes ?? []).map(route => ({ ...route, enabled: false }))
        }
    }
    return result
}

test("backup complete authored config projection restores disabled definitions and preserves domain ownership", async t => {
    const f = await fixture(t), config = await authoredConfig(), proof = () => f.native([], { references: [...f.native().references,
        ...([['30', 'category'], ['31', 'text'], ['40', 'role'], ['10', 'member']] as const).map(([id, type]) => ({ id, type, serverId: "1", observedAt: f.now(), exists: true, actorCanAccess: true, botCanAccess: true, actorCanManage: true, botCanManage: true, permissions: "0" }))] })
    assert.deepEqual(new Set(config.map(row => row.family)), new Set(f.capabilities.configFamilies))
    const planned = await f.plan(f.manifest({ config }), proof()); assert.equal(planned.plan.itemCount, config.length)
    const items = await f.items(planned.plan); assert(items.every(item => item.disposition === "create"))
    await f.confirm(planned.plan)
    for (const item of items) { const result = await f.work({ type: "apply", binding: itemBinding(item), context: f.context(), native: proof() }); assert.equal(result.type, "item"); assert.equal(result.item.state, "created") }
    await f.backend.run(ctx => ctx.db.insert("afkStatuses", { serverId: "1", userId: "42", reason: "Synthetic excluded historical AFK text", since: f.now() }))
    const privateBefore = await f.backend.run(ctx => ctx.db.query("afkStatuses").collect())
    const snapshot = await f.snapshot(["config"]), expected = disabledConfig(config), sort = (rows: C.BackupConfigObject[]) => [...rows].sort((a, b) => `${a.family}:${a.sourceId}`.localeCompare(`${b.family}:${b.sourceId}`))
    assert.deepEqual(sort(snapshot.config), sort(expected))
    const serialized = JSON.stringify(snapshot)
    assert(!serialized.includes("Synthetic excluded historical AFK text"))
    assert.deepEqual(await f.backend.run(ctx => ctx.db.query("afkStatuses").collect()), privateBefore)
    for (const field of ["defcon", "activatedAt", "canonicalContent", "claimedAt", "claimToken", "acceptedMessageId", "nextCheckAt", "cooldownCount", "intakeAnswers", "monthDay", "acknowledgedAt"]) assert(!serialized.includes(`"${field}"`), `Export omits operational/private field ${field}`)
    assert(snapshot.config.every(row => !("revision" in row.value)), "Object revisions are omitted while authored template revisions remain")
    const actual = await f.backend.run(async ctx => ({ roleReferences: await ctx.db.query("roleReferences").collect(), rewardWork: (await ctx.db.query("levelingProfiles").collect()).filter(row => row.rewardDueAt !== undefined), roles: await ctx.db.query("roleOwnership").collect(), posts: await ctx.db.query("publishingPosts").collect(), moderation: await ctx.db.query("moderationSettings").unique(), profiles: await ctx.db.query("levelingProfiles").collect() }))
    assert.equal(actual.roleReferences.length, 1); assert.equal(actual.roleReferences[0]!.roleId, "40"); assert.equal(actual.roleReferences[0]!.configuration, true)
    assert.deepEqual(actual.rewardWork, []); assert.deepEqual(actual.roles, []); assert.deepEqual(actual.posts, []); assert.deepEqual(actual.profiles, [])
    assert.equal(actual.moderation!.config.defcon, 3)
    const repeated = await f.plan(f.manifest({ config: config.map(row => ({ value: row.value, sourceId: row.sourceId, family: row.family }) as C.BackupConfigObject) }), proof())
    assert((await f.items(repeated.plan)).every(item => item.disposition === "skip"), "Disabled-on-create semantics and object property order compare identically")
})

function nativeChannels(f: Awaited<ReturnType<typeof adapterFixture>>, bot: any, options: { create?: (request: any, wire: any) => any, fetch?: (id: string, wire: any | undefined, count: number) => any } = {}) {
    const channels = new Map<string, any>(), reads = new Map<string, number>(), created: any[] = []
    bot.rest.respond("GET /channels/:id", (request: any) => {
        const id = request.path.split("/").at(-1)!
        if (id === "90") return { body: { id, type: 1, recipients: [bot.fixtures.user({ id: "10", bot: false, system: false })], last_message_id: null } }
        const count = (reads.get(id) ?? 0) + 1; reads.set(id, count)
        if (options.fetch) return options.fetch(id, channels.get(id), count)
        return channels.has(id) ? { body: channels.get(id) } : { status: 404, body: { code: 10003, message: "Synthetic exact channel absence" } }
    })
    const create = bot.rest.respond("POST /guilds/1/channels", (request: any) => {
        const input = request.body, id = String(130 + created.length)
        const wire = bot.fixtures.channel({ id, guild_id: "1", type: input.type, name: input.name, parent_id: input.parent_id ?? null,
            permission_overwrites: input.permission_overwrites, topic: input.topic ?? null, nsfw: input.nsfw ?? false, rate_limit_per_user: input.rate_limit_per_user ?? 0,
            ...(input.type === 2 ? { bitrate: input.bitrate ?? 64000, user_limit: input.user_limit ?? 0 } : {}) })
        created.push(wire)
        if (options.create) return options.create(request, wire)
        channels.set(id, wire); return { body: wire }
    })
    return { channels, reads, created, create }
}

test("backup actual executor resolves same-archive symbolic config references without changing immutable source identity", async t => {
    const f = await fixture(t), { readBackupNativeProof } = await import("../../bot/src/backup-permissions.ts"), { processBackupPlanPass } = await import("../../bot/src/backup.ts"), channel = structure(f.now(), "30", "text")
    const response: C.BackupConfigObject = { family: "response", sourceId: "custom_coselected", value: { kind: "custom", name: "coselected", reply: { type: "text", text: "Synthetic same archive" }, channelIds: ["30"], roleIds: [], cooldownSeconds: 0, priority: 0, enabled: true } }
    const policy: C.BackupConfigObject = { family: "cleanupPolicy", sourceId: "30", value: { channelId: "30", enabled: true, ageMs: 3600000, ownerId: "10", excludedAuthorIds: [], excludedMessageIds: [] } }
    await withNative(f, ({ Effect, Redacted }, bot) => Effect.gen(function* () {
        const native = nativeChannels(f, bot), proof = yield* readBackupNativeProof(bot.client, "1", "10", "90", [channel, response, policy])
        const planned = yield* Effect.promise(() => f.plan(f.manifest({ structure: [channel], config: [response, policy] }), proof))
        assert.equal(planned.plan.counts.create, 3)
        const confirmed = yield* Effect.promise(() => f.confirm(planned.plan)), config = { serverId: "1", token: Redacted.make("synthetic-backup-sdk-token"), backend: f.config, backupKey: keyring() }
        const pass = yield* processBackupPlanPass(f.store, config, bot.client, confirmed, "90"); assert.equal(pass.results.length, 3); assert(pass.results.every(result => result.recorded && result.item.state === "created"), JSON.stringify(pass)); assert.equal(native.create.requests().length, 1)
        const actual = yield* Effect.promise(() => f.backend.run(async ctx => ({ response: await ctx.db.query("responseDefinitions").first(), policy: await ctx.db.query("cleanupPolicies").first() })))
        assert.deepEqual(actual.response!.channelIds, ["130"]); assert.equal(actual.policy!.channelId, "130"); assert.equal(actual.response!.enabled, false); assert.equal(actual.policy!.enabled, false)
        const items: C.BackupItem[] = yield* Effect.promise(() => f.items(confirmed)); assert.equal(items.find(item => item.family === "cleanupPolicy")!.sourceId, "30")
        const mappedProof = yield* readBackupNativeProof(bot.client, "1", "10", "90", [response, policy], new Map([["30", "130"]]))
        const again = yield* Effect.promise(() => f.plan(f.manifest({ config: [response, policy] }), mappedProof)); assert.equal(again.plan.counts.skip, 2); assert.equal(again.plan.counts.conflict, 0)
    }))
})

test("backup actual native executor creates private category then dependent text voice with exact durable mappings", async t => {
    const f = await fixture(t), { readBackupNativeProof } = await import("../../bot/src/backup-permissions.ts"), { processBackupPlanPass } = await import("../../bot/src/backup.ts")
    const rows = [structure(f.now(), "31", "text", "30"), structure(f.now(), "32", "voice", "30"), structure(f.now())]
    await withNative(f, ({ Effect, Redacted }, bot) => Effect.gen(function* () {
        const native = nativeChannels(f, bot), proof = yield* readBackupNativeProof(bot.client, "1", "10", "90", rows)
        const planned = yield* Effect.promise(() => f.plan(f.manifest({ structure: rows }), proof))
        assert.equal(planned.plan.counts.create, 3)
        const confirmed = yield* Effect.promise(() => f.confirm(planned.plan)), config = { serverId: "1", token: Redacted.make("synthetic-backup-sdk-token"), backend: f.config, backupKey: keyring() }
        const pass = yield* processBackupPlanPass(f.store, config, bot.client, confirmed, "90")
        assert.equal(pass.results.length, 3); assert.equal(pass.remaining, 0); assert(pass.results.every(r => r.recorded && r.item.state === "created"), JSON.stringify(pass))
        const requests = native.create.requests(); assert.equal(requests.length, 3)
        assert.equal((requests[0]!.body as any).type, 4)
        for (const request of requests) {
            const body = request.body as any
            assert.deepEqual(body.permission_overwrites, [{ id: "1", type: 0, allow: "0", deny: "1024" }, { id: "999", type: 1, allow: "1024", deny: "0" }])
            if (body.type !== 4) assert.equal(body.parent_id, "130")
        }
        const items: C.BackupItem[] = yield* Effect.promise(() => f.items(confirmed)); assert(items.every(item => item.mappedId && native.channels.has(item.mappedId)))
        const restarted = yield* processBackupPlanPass(f.store, config, bot.client, confirmed, "90"); assert.deepEqual(restarted.results, []); assert.equal(native.create.requests().length, 3)
        assert(!bot.requests().some((r: any) => r.method === "GET" && r.path === "/guilds/1/channels"), "Restore never discovers candidates by name or list difference")
        const mappings = new Map(items.map(item => [item.sourceId, item.mappedId!])), fresh = yield* readBackupNativeProof(bot.client, "1", "10", "90", rows, mappings)
        const newer = yield* Effect.promise(() => f.plan(f.manifest({ structure: rows }), fresh))
        assert.equal(newer.plan.counts.skip, 3)
    }))
})

test("backup actual executor consumes lost claim acknowledgement before any native create and never replays", async t => {
    const f = await fixture(t), { readBackupNativeProof } = await import("../../bot/src/backup-permissions.ts"), { processBackupPlanPass } = await import("../../bot/src/backup.ts"), rows = [structure(f.now())]
    await withNative(f, ({ Effect, Redacted }, bot) => Effect.gen(function* () {
        const native = nativeChannels(f, bot), proof = yield* readBackupNativeProof(bot.client, "1", "10", "90", rows)
        const planned = yield* Effect.promise(() => f.plan(f.manifest({ structure: rows }), proof)), confirmed = yield* Effect.promise(() => f.confirm(planned.plan))
        const config = { serverId: "1", token: Redacted.make("synthetic-backup-sdk-token"), backend: f.config, backupKey: keyring() }
        const wrapped = { ...f.store, work: (input: C.BackupWorkRequest) => f.store.work(input).pipe(Effect.flatMap((result: C.BackupWorkResult) => input.operation.type === "claim" ? Effect.fail(new f.BackupStoreError({ operation: "synthetic-lost-claim-response", status: null })) : Effect.succeed(result))) }
        const pass = yield* processBackupPlanPass(wrapped, config, bot.client, confirmed, "90")
        assert.equal(pass.results.length, 1); assert.equal(pass.results[0]!.recorded, false); assert.equal(native.create.requests().length, 0)
        assert.equal((yield* Effect.promise(() => f.items(confirmed)))[0]!.state, "claimed")
        const restarted = yield* processBackupPlanPass(f.store, config, bot.client, confirmed, "90"); assert.deepEqual(restarted.results, []); assert.equal(native.create.requests().length, 0)
        const newer = yield* Effect.promise(() => f.plan(f.manifest({ structure: rows }), proof)); assert.equal(newer.plan.counts.blocked, 1)
        assert(!bot.requests().some((r: any) => r.method === "GET" && r.path === "/guilds/1/channels"))
    }))
})

test("backup actual unknown native create retains indefinite origin and no restart adoption or replay", async t => {
    const f = await fixture(t), { readBackupNativeProof } = await import("../../bot/src/backup-permissions.ts"), { processBackupPlanPass } = await import("../../bot/src/backup.ts"), rows = [structure(f.now())]
    await withNative(f, ({ Effect, Redacted }, bot) => Effect.gen(function* () {
        const native = nativeChannels(f, bot, { create: () => { throw new Error("Synthetic unknown native create result") } }), proof = yield* readBackupNativeProof(bot.client, "1", "10", "90", rows)
        const planned = yield* Effect.promise(() => f.plan(f.manifest({ structure: rows }), proof)), confirmed = yield* Effect.promise(() => f.confirm(planned.plan))
        const config = { serverId: "1", token: Redacted.make("synthetic-backup-sdk-token"), backend: f.config, backupKey: keyring() }
        const pass = yield* processBackupPlanPass(f.store, config, bot.client, confirmed, "90")
        assert.equal(native.create.requests().length, 1); assert.equal(pass.results[0]!.outcome, "uncertain"); assert.equal(pass.results[0]!.recorded, true)
        const item = (yield* Effect.promise(() => f.items(confirmed)))[0]!
        assert.equal(item.state, "uncertain"); assert.equal(item.mappedId, null)
        yield* processBackupPlanPass(f.store, config, bot.client, confirmed, "90"); assert.equal(native.create.requests().length, 1)
        const newer = yield* Effect.promise(() => f.plan(f.manifest({ structure: rows }), proof)); assert.equal(newer.plan.counts.blocked, 1)
        assert(!bot.requests().some((r: any) => r.method === "GET" && r.path === "/guilds/1/channels"))
    }))
    f.advance(8 * 86400000); await f.cleanup()
    assert.equal((await f.origins())[0]!.state, "uncertain")
    assert.equal((await f.items((await f.query({ type: "plans" }) as Extract<C.BackupQueryResult, { type: "plans" }>).plans[0]!))[0]!.state, "uncertain")
})

test("backup additive conflicts preserve authored records and current DEFCON pauses execution", async t => {
    const f = await fixture(t), { state } = await import("../convex/moderationStore.ts")
    await f.backend.run(async ctx => { const current = await state(ctx, "1"); await ctx.db.patch(current._id, { config: { ...current.config, defcon: 2 } }) })
    const all = await authoredConfig(), moderation = all.find((row): row is Extract<C.BackupConfigObject, { family: "moderation" }> => row.family === "moderation")!
    const archive = f.manifest({ config: [moderation, { family: "draft", sourceId: "draft_conflict", value: { kind: "draft", name: "conflict", content: { content: "Synthetic original draft" } } }] })
    const planned = await f.plan(archive); assert.equal(planned.items.find(i => i.family === "moderation")!.disposition, "skip")
    await f.confirm(planned.plan)
    for (const item of planned.items) await f.work({ type: "apply", binding: itemBinding(item), context: f.context(), native: null })
    const conflicting = await f.plan(f.manifest({ config: [{ family: "draft", sourceId: "draft_conflict", value: { kind: "draft", name: "conflict", content: { content: "Synthetic changed draft" } } }] }))
    assert.equal(conflicting.items[0]!.disposition, "conflict"); await f.confirm(conflicting.plan)
    const conflict = await f.work({ type: "apply", binding: itemBinding(conflicting.items[0]!), context: f.context(), native: null }); assert.equal(conflict.type, "item"); assert.equal(conflict.item.state, "conflict")
    const before = await f.backend.run(async ctx => ({ draft: await ctx.db.query("publishingDrafts").unique(), settings: await ctx.db.query("moderationSettings").unique() }))
    assert.equal(before.draft!.content.content, "Synthetic original draft"); assert.equal(before.settings!.config.defcon, 2)
    const xp = await f.plan(f.manifest({ xp: [{ sourceId: "20", userId: "20", xp: 10 }] })); await f.confirm(xp.plan)
    await f.backend.run(async ctx => { const current = await ctx.db.query("moderationSettings").unique(); assert(current); await ctx.db.patch(current._id, { config: { ...current.config, defcon: 1 } }) })
    await f.reject(f.store.work({ serverId: "1", operation: { type: "apply", binding: itemBinding(xp.items[0]!), context: f.context(), native: null } }), f.BackupStoreError, 403)
    assert.deepEqual((await f.snapshot(["xp"])).xp, [])
    assert.equal((await f.backend.run(ctx => ctx.db.query("moderationSettings").unique()))!.config.defcon, 1)
})

test("backup snapshot family sentinel and plan item cap refuse oversized complete requests", async t => {
    const f = await fixture(t)
    await f.backend.run(async ctx => {
        for (let i = 0; i < 101; i++) await ctx.db.insert("responseDefinitions", { serverId: "1", kind: "custom", name: `synthetic${i}`, reply: { type: "text", text: "Synthetic bounded response" }, channelIds: [], roleIds: [], cooldownSeconds: 0, priority: 0, enabled: false, createdAt: f.now(), updatedAt: f.now() })
    })
    await f.reject(f.store.snapshot(f.snapshotInput()), f.BackupStoreError, 413)
    assert.equal((await f.backend.run(ctx => ctx.db.query("responseDefinitions").collect())).length, 101)
    const xp = Array.from({ length: 501 }, (_, i) => ({ sourceId: String(10000 + i), userId: String(10000 + i), xp: i })), archive = f.manifest({ xp })
    await f.reject(f.store.manage(f.manageInput({ type: "plan", manifest: archive, archiveDigest: "a".repeat(64), native: null })), f.BackupStoreError, 413)
    assert.deepEqual((await f.query({ type: "plans" }) as Extract<C.BackupQueryResult, { type: "plans" }>).plans, [])
})

test("backup ten retained plans refuse capacity until bounded seven day retention releases settled details", async t => {
    const f = await fixture(t), plans: C.BackupPlan[] = []
    for (let i = 0; i < 10; i++) plans.push((await f.plan(f.manifest({ xp: [] }))).plan)
    await f.reject(f.store.manage(f.manageInput({ type: "plan", manifest: f.manifest({ xp: [] }), archiveDigest: "a".repeat(64), native: null })), f.BackupStoreError, 429)
    assert.equal((await f.query({ type: "plans" }) as Extract<C.BackupQueryResult, { type: "plans" }>).plans.length, 10)
    f.advance(8 * 86400000)
    for (let pass = 0; pass < 5; pass++) await f.cleanup()
    assert.deepEqual((await f.query({ type: "plans" }) as Extract<C.BackupQueryResult, { type: "plans" }>).plans, [])
    assert.equal((await f.plan(f.manifest({ xp: [] }))).plan.itemCount, 0)
})

test("backup exact native acknowledgment settles plan retention while bodyfree origin mappings remain", async t => {
    const f = await fixture(t), row = structure(f.now()), planned = await f.plan(f.manifest({ structure: [row] }), f.native([row])), item = planned.items[0]!
    await f.confirm(planned.plan)
    await f.work({ type: "reserve", binding: itemBinding(item), context: f.context(), native: f.native([row]) })
    await f.work({ type: "claim", binding: itemBinding(item), context: f.context(), native: f.native([row]), claimToken: "a".repeat(32) })
    await f.work({ type: "outcome", binding: itemBinding(item), claimToken: "a".repeat(32), outcome: "created", mappedId: "130", channel: { ...row, sourceId: "130" } })
    const forgotten = await f.manage({ type: "forget", binding: binding(planned.plan) }); assert.equal(forgotten.type, "forgotten")
    const payload = await f.query({ type: "item", binding: itemBinding(item) }); assert.equal(payload.type, "item"); assert.equal(payload.object, null)
    f.advance(8 * 86400000)
    await f.cleanup()
    assert.deepEqual((await f.query({ type: "plans" }) as Extract<C.BackupQueryResult, { type: "plans" }>).plans, [])
    const origin = (await f.origins())[0]!; assert.equal(origin.mappedId, "130"); assert.equal(origin.state, "created")
    assert(!JSON.stringify(origin).includes(row.name)); assert(!Object.hasOwn(origin, "overwrites"))
})

test("backup exact knownID recovery preserves uncertainty and releases settled detail forgetting", async t => {
    const f = await fixture(t), row = structure(f.now()), planned = await f.plan(f.manifest({ structure: [row] }), f.native([row])), item = planned.items[0]!
    await f.confirm(planned.plan)
    await f.work({ type: "reserve", binding: itemBinding(item), context: f.context(), native: f.native([row]) })
    await f.work({ type: "claim", binding: itemBinding(item), context: f.context(), native: f.native([row]), claimToken: "a".repeat(32) })
    await f.work({ type: "outcome", binding: itemBinding(item), claimToken: "a".repeat(32), outcome: "uncertain", mappedId: "130", channel: { ...row, sourceId: "130" } })
    await f.reject(f.store.manage(f.manageInput({ type: "forget", binding: binding(planned.plan) })), f.BackupStoreError, 409)
    f.advance(130001)
    const native = f.native([], { observations: [{ sourceId: "130", observedAt: f.now(), status: "present", channel: { ...row, sourceId: "130" } }] })
    const recovered = await f.work({ type: "reconcile", binding: itemBinding(item), context: f.context(), native }); assert.equal(recovered.type, "item")
    assert.equal(recovered.item.historicalOutcome, "uncertain"); assert.equal(recovered.item.resolution, "match")
    const forgotten = await f.manage({ type: "forget", binding: binding(planned.plan) }); assert.equal(forgotten.type, "forgotten")
    assert.equal((await f.origins())[0]!.mappedId, "130")
})

function advanceNative(f: Awaited<ReturnType<typeof adapterFixture>>, runtime: Awaited<ReturnType<typeof sdk>>, milliseconds: number) {
    return runtime.Effect.sync(() => f.advance(milliseconds)).pipe(runtime.Effect.andThen(runtime.TestClock.adjust(`${milliseconds} millis`)))
}

test("backup actual claim response barrier expires the native deadline before dispatch without replay", async t => {
    const f = await fixture(t), { readBackupNativeProof } = await import("../../bot/src/backup-permissions.ts"), { processBackupPlanPass } = await import("../../bot/src/backup.ts"), rows = [structure(f.now())]
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect, Fiber, Redacted } = runtime, native = nativeChannels(f, bot), proof = yield* readBackupNativeProof(bot.client, "1", "10", "90", rows)
        const planned = yield* Effect.promise(() => f.plan(f.manifest({ structure: rows }), proof)), confirmed = yield* Effect.promise(() => f.confirm(planned.plan)), gate = barrier()
        const config = { serverId: "1", token: Redacted.make("synthetic-backup-sdk-token"), backend: f.config, backupKey: keyring() }
        const wrapped = { ...f.store, work: (input: C.BackupWorkRequest) => f.store.work(input).pipe(Effect.tap((result: C.BackupWorkResult) => input.operation.type === "claim" && result.type === "grant" && result.claimed ? Effect.promise(() => gate.wait()) : Effect.void)) }
        const fiber = yield* Effect.forkChild(processBackupPlanPass(wrapped, config, bot.client, confirmed, "90").pipe(Effect.ensuring(Effect.sync(() => gate.finish()))))
        yield* Effect.promise(() => gate.entered)
        assert.equal((yield* Effect.promise(() => f.items(confirmed)))[0]!.state, "claimed"); assert.equal(native.create.requests().length, 0)
        yield* advanceNative(f, runtime, 120001); yield* Effect.sync(() => gate.release())
        const pass = yield* Fiber.join(fiber)
        assert.equal(native.create.requests().length, 0); assert.equal(pass.results[0]!.outcome, "failed"); assert.equal(pass.results[0]!.item.noDispatch, true)
        const newerProof = yield* readBackupNativeProof(bot.client, "1", "10", "90", rows), newer = yield* Effect.promise(() => f.plan(f.manifest({ structure: rows }), newerProof))
        assert.equal(newer.plan.counts.create, 1, "Proven no-dispatch allows only a new explicit preview and confirmation")
        const restarted = yield* processBackupPlanPass(f.store, config, bot.client, confirmed, "90"); assert.deepEqual(restarted.results, []); assert.equal(native.create.requests().length, 0)
        yield* Effect.promise(() => f.reject(f.store.work({ serverId: "1", operation: { type: "reserve", binding: itemBinding(newer.items[0]!), context: f.context(), native: newerProof } }), f.BackupStoreError, 409))
    }))
})

test("backup actual postclaim Owner loss refuses native creation with explicit nondispatch evidence", async t => {
    const f = await fixture(t), { readBackupNativeProof } = await import("../../bot/src/backup-permissions.ts"), { processBackupPlanPass } = await import("../../bot/src/backup.ts"), rows = [structure(f.now())]
    await withNative(f, ({ Effect, Redacted }, bot) => Effect.gen(function* () {
        const native = nativeChannels(f, bot), proof = yield* readBackupNativeProof(bot.client, "1", "10", "90", rows)
        const planned = yield* Effect.promise(() => f.plan(f.manifest({ structure: rows }), proof)), confirmed = yield* Effect.promise(() => f.confirm(planned.plan))
        const config = { serverId: "1", token: Redacted.make("synthetic-backup-sdk-token"), backend: f.config, backupKey: keyring() }
        const wrapped = { ...f.store, work: (input: C.BackupWorkRequest) => f.store.work(input).pipe(Effect.tap((result: C.BackupWorkResult) => Effect.sync(() => {
            if (input.operation.type === "claim" && result.type === "grant" && result.claimed) bot.rest.respond("GET /guilds/1", { body: bot.fixtures.guild({ id: "1", owner_id: "11" }) })
        }))) }
        const pass = yield* processBackupPlanPass(wrapped, config, bot.client, confirmed, "90")
        assert.equal(native.create.requests().length, 0); assert.equal(pass.results[0]!.item.noDispatch, true); assert.equal(pass.results[0]!.item.state, "failed")
    }))
})

test("backup actual known response ID SDK recovery observes the exact channel and preserves original uncertainty", async t => {
    const f = await fixture(t), { readBackupNativeProof } = await import("../../bot/src/backup-permissions.ts"), { processBackupPlanPass, reconcileBackupPlan } = await import("../../bot/src/backup.ts"), rows = [structure(f.now())]
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect, Redacted } = runtime
        const native = nativeChannels(f, bot, { fetch: (id, wire, count) => wire ? id === "130" && count === 1 ? { status: 403, body: { message: "Synthetic postcreate observation refused" } } : { body: wire } : { status: 404, body: { code: 10003, message: "Synthetic exact channel absence" } } })
        const proof = yield* readBackupNativeProof(bot.client, "1", "10", "90", rows), planned = yield* Effect.promise(() => f.plan(f.manifest({ structure: rows }), proof)), confirmed = yield* Effect.promise(() => f.confirm(planned.plan))
        const config = { serverId: "1", token: Redacted.make("synthetic-backup-sdk-token"), backend: f.config, backupKey: keyring() }, pass = yield* processBackupPlanPass(f.store, config, bot.client, confirmed, "90")
        assert.equal(pass.results[0]!.outcome, "uncertain"); assert.equal(pass.results[0]!.item.mappedId, "130"); assert.equal(native.create.requests().length, 1)
        yield* advanceNative(f, runtime, 130001)
        const recovery = yield* reconcileBackupPlan(f.store, config, bot.client, confirmed, "90")
        assert.equal(recovery.length, 1); assert.equal(recovery[0]!.resolution, "match"); assert.equal(recovery[0]!.historicalOutcome, "uncertain")
        yield* processBackupPlanPass(f.store, config, bot.client, confirmed, "90"); assert.equal(native.create.requests().length, 1)
        assert(!bot.requests().some((r: any) => r.method === "GET" && r.path === "/guilds/1/channels"))
    }))
})

test("backup actual acknowledged mismatched native snapshot retains exact returned ID for conflict recovery", async t => {
    const f = await fixture(t), { readBackupNativeProof } = await import("../../bot/src/backup-permissions.ts"), { processBackupPlanPass, reconcileBackupPlan } = await import("../../bot/src/backup.ts"), rows = [structure(f.now())]
    await withNative(f, (runtime, bot) => runtime.Effect.gen(function* () {
        const { Effect, Redacted } = runtime
        const native = nativeChannels(f, bot, { create: (_request, wire) => { const different = { ...wire, name: "synthetic-provider-mismatch" }; native.channels.set(wire.id, different); return { body: different } } })
        const proof = yield* readBackupNativeProof(bot.client, "1", "10", "90", rows), planned = yield* Effect.promise(() => f.plan(f.manifest({ structure: rows }), proof)), confirmed = yield* Effect.promise(() => f.confirm(planned.plan))
        const config = { serverId: "1", token: Redacted.make("synthetic-backup-sdk-token"), backend: f.config, backupKey: keyring() }, pass = yield* processBackupPlanPass(f.store, config, bot.client, confirmed, "90")
        assert.equal(pass.results[0]!.outcome, "uncertain"); assert.equal(pass.results[0]!.recorded, true); assert.equal(pass.results[0]!.item.mappedId, "130")
        yield* advanceNative(f, runtime, 130001)
        const recovery = yield* reconcileBackupPlan(f.store, config, bot.client, confirmed, "90")
        assert.equal(recovery[0]!.resolution, "conflict"); assert.equal(recovery[0]!.historicalOutcome, "uncertain")
        assert.equal(native.create.requests().length, 1)
    }))
})

test("backup atomic import survives lost response and expected current XP epoch changes are conflicts", async t => {
    const f = await fixture(t), planned = await f.plan(f.manifest({ xp: [{ sourceId: "20", userId: "20", xp: 10 }] })); await f.confirm(planned.plan)
    const { Effect, Exit } = await sdk(), request: C.BackupWorkRequest = { serverId: "1", operation: { type: "apply", binding: itemBinding(planned.items[0]!), context: f.context(), native: null } }
    const lost = await f.run<any>(Effect.exit(f.store.work(request).pipe(Effect.flatMap(() => Effect.fail(new f.BackupStoreError({ operation: "synthetic-lost-import-response", status: null })))))); assert(Exit.isFailure(lost))
    const replay = await f.run<C.BackupWorkResult>(f.store.work(request)); assert.equal(replay.type, "item"); assert.equal(replay.item.state, "created")
    assert.equal((await f.backend.run(ctx => ctx.db.query("levelingProfiles").collect())).length, 1)
    const pending = await f.plan(f.manifest({ xp: [{ sourceId: "21", userId: "21", xp: 25 }] })); await f.confirm(pending.plan)
    const { createLevelingStore } = await import("../../bot/src/level-store.ts"), levels = createLevelingStore(f.config)
    await f.run(levels.manage({ ...f.source(), actor: owner, operation: { type: "reset-server", confirm: "reset-server", reason: "Synthetic current epoch change" } }))
    const conflict = await f.work({ type: "apply", binding: itemBinding(pending.items[0]!), context: f.context(), native: null }); assert.equal(conflict.type, "item"); assert.equal(conflict.item.state, "conflict")
    assert.equal((await f.backend.run(ctx => ctx.db.query("levelingProfiles").collect())).length, 1)
})

function privateWire(f: Awaited<ReturnType<typeof adapterFixture>>, bot: any, content: string, attachments: any[] = []) {
    const message = bot.fixtures.message({ id: f.source().messageId, channel_id: "90", author: bot.fixtures.user({ id: "10", bot: false, system: false }), content, timestamp: new Date(f.now()).toISOString(), attachments })
    delete message.guild_id
    return message
}

test("backup actual private handler rejects absent keys malformed archives and bindings before backend mutation", async t => {
    const f = await fixture(t), { handleBackupCommand } = await import("../../bot/src/backup.ts"), archive = f.manifest({ xp: [{ sourceId: "20", userId: "20", xp: 10 }] })
    await withNative(f, ({ Effect, Redacted }, bot) => Effect.gen(function* () {
        const base = { serverId: "1", token: Redacted.make("synthetic-backup-sdk-token"), backend: f.config }, replies = bot.rest.respond("POST /channels/90/messages", (request: any) => {
            const wire = privateWire(f, bot, String(request.body.content)); wire.author = bot.fixtures.botUser({ id: "999" }); return { body: wire }
        })
        const invoke = (wire: any, command: Parameters<typeof handleBackupCommand>[2], config: typeof base & { backupKey?: ReturnType<typeof keyring> }) => Effect.gen(function* () {
            bot.rest.respond(`GET /channels/90/messages/${wire.id}`, { body: wire })
            const message = yield* bot.client.messages.fetch({ channelId: "90", id: wire.id })
            const context = { client: bot.client, message, reply: (value: any) => bot.client.messages.send("90", value) } as Parameters<typeof handleBackupCommand>[3]
            yield* handleBackupCommand(f.store, config, command, context)
        })
        const before = f.calls.length
        yield* invoke(privateWire(f, bot, "!backup export config"), { type: "export", selected: ["config"] }, base)
        assert.match((replies.requests()[0]!.body as any).content, /crypto is disabled/); assert.equal(f.calls.length, before)
        const tampered = Buffer.from(encryptBackupManifest(archive, keyring())); tampered[29] = tampered[29]! ^ 1
        const wrong = parseBackupKey({ NEONFLUX_BACKUP_KEY: Buffer.alloc(32, 18).toString("base64") }); assert(wrong)
        const inputs = [
            tampered, encryptBackupManifest(archive, wrong),
            encryptBackupManifest({ ...archive, version: 2 }, keyring()),
            rawEnvelope('{"private-marker-body":"Synthetic private authored content\\q"}'),
            encryptBackupManifest({ ...archive, serverId: "2" }, keyring()),
            encryptBackupManifest({ ...archive, provider: "https://other-instance.invalid" }, keyring()),
            encryptBackupManifest({ ...archive, extra: "Synthetic private authored content" }, keyring()),
            new Uint8Array(backupEnvelopeLimit + 1),
        ]
        const instance = yield* bot.client.instance.resolve(), mediaBase = instance.endpoints.media.replace(/\/$/, "")
        for (let i = 0; i < inputs.length; i++) {
            const bytes = inputs[i]!, id = String(700 + i), filename = `neonflux-backup-invalid${i}.nfb`, url = `${mediaBase}/attachments/90/${id}/${filename}`
            bot.rest.respond(url, new Response(new Uint8Array(bytes).buffer, { headers: { "Content-Length": String(bytes.length) } }))
            const wire = privateWire(f, bot, "!backup plan", [{ id, filename, content_type: "application/octet-stream", size: bytes.length, url, proxy_url: url, flags: 0 }])
            yield* invoke(wire, { type: "plan" }, { ...base, backupKey: keyring() })
            assert.equal(f.calls.length, before, "Rejected archive cannot call backend query/manage/work")
            assert(!JSON.stringify(replies.requests().at(-1)!.body).includes("Synthetic private authored content"))
        }
        assert.equal(replies.requests().length, inputs.length + 1); assert(replies.requests().every((r: any) => r.files.length === 0))
        assert(!bot.requests().some((r: any) => r.method === "POST" && r.path.startsWith("/guilds/")))
    }))
    assert.deepEqual((await f.query({ type: "plans" }) as Extract<C.BackupQueryResult, { type: "plans" }>).plans, [])
    assert.deepEqual((await f.snapshot(["xp"])).xp, [])
})

test("backup actual SDK export uploads encrypted in-memory bytes after fresh private Owner and import plans exact archive", async t => {
    const f = await fixture(t), { handleBackupCommand } = await import("../../bot/src/backup.ts"), { validateBackupManifest } = await import("../../bot/src/backup-store.ts")
    await f.backend.run(ctx => ctx.db.insert("publishingDrafts", { serverId: "1", kind: "draft", name: "exportprobe", revision: 9, content: { content: "Synthetic private authored content" }, canonicalContent: { content: "Synthetic private authored content" }, createdAt: f.now(), updatedAt: f.now() }))
    await withNative(f, ({ Effect, Redacted }, bot) => Effect.gen(function* () {
        const config = { serverId: "1", token: Redacted.make("synthetic-backup-sdk-token"), backend: f.config, backupKey: keyring() }, uploaded: Uint8Array[] = []
        const send = bot.client.messages.send.bind(bot.client.messages)
        const client = { ...bot.client, messages: { ...bot.client.messages, send: (channelId: string, input: any, options: any) => {
            if (input.attachments?.length) {
                assert.equal(channelId, "90"); assert.equal(bot.requests().at(-1)!.path, "/channels/90", "Private authority was refreshed immediately before upload")
                assert(input.attachments[0].data instanceof Uint8Array)
                uploaded.push(new Uint8Array(input.attachments[0].data))
            }
            return send(channelId, input, options)
        } } }
        const replies = bot.rest.respond("POST /channels/90/messages", (request: any) => { const wire = privateWire(f, bot, String(request.body.content)); wire.author = bot.fixtures.botUser({ id: "999" }); return { body: wire } })
        const invoke = (wire: any, command: Parameters<typeof handleBackupCommand>[2]) => Effect.gen(function* () {
            bot.rest.respond(`GET /channels/90/messages/${wire.id}`, { body: wire })
            const message = yield* bot.client.messages.fetch({ channelId: "90", id: wire.id })
            const context = { client, message, reply: (value: any) => bot.client.messages.send("90", value) } as Parameters<typeof handleBackupCommand>[3]
            yield* handleBackupCommand(f.store, config, command, context)
        })
        const before = f.calls.length
        yield* invoke(privateWire(f, bot, "!backup export config xp"), { type: "export", selected: ["config", "xp"] })
        assert.equal(uploaded.length, 1)
        assert.equal(f.calls.slice(before).filter(call => call.path === "/backup/snapshot").length, 1)
        const bytes = uploaded[0]!, manifest = validateBackupManifest(decryptBackupEnvelope(bytes, keyring()))
        assert.equal(manifest.provider, provider); assert.equal(manifest.serverId, "1"); assert.deepEqual(manifest.selected, ["config", "xp"])
        assert.equal(manifest.config.length, 1); assert.equal(manifest.config[0]!.family, "draft")
        assert(!Buffer.from(bytes).includes(Buffer.from("Synthetic private authored content")))
        assert.equal(replies.requests()[0]!.files.length, 1); assert.equal(replies.requests()[0]!.files[0]!.size, bytes.length)
        assert.equal(replies.requests()[0]!.files[0]!.contentType, "application/octet-stream")
        const instance = yield* bot.client.instance.resolve(), filename = "neonflux-backup-exported.nfb", url = `${instance.endpoints.media.replace(/\/$/, "")}/attachments/90/700/${filename}`
        bot.rest.respond(url, new Response(new Uint8Array(bytes).buffer, { headers: { "Content-Length": String(bytes.length) } }))
        yield* invoke(privateWire(f, bot, "!backup plan", [{ id: "700", filename, content_type: "application/octet-stream", size: bytes.length, url, proxy_url: url, flags: 0 }]), { type: "plan" })
        assert.equal(f.calls.filter(call => call.path === "/backup/manage").length, 1)
        const plans = yield* Effect.promise(() => f.query({ type: "plans" })); assert.equal(plans.type, "plans"); assert.equal(plans.plans.length, 1)
        assert.equal(plans.plans[0]!.backupId, manifest.backupId); assert.equal(plans.plans[0]!.archiveDigest, createHash("sha256").update(bytes).digest("hex"))
        assert.equal(plans.plans[0]!.counts.skip, 1); assert.equal(plans.plans[0]!.confirmedAt, undefined)
        assert(replies.requests().slice(1).every((request: any) => request.files.length === 0))
    }))
})

test("backup repeated source plan is idempotent and changed archive identity cannot reuse that source", async t => {
    const f = await fixture(t), archive = f.manifest({ xp: [{ sourceId: "20", userId: "20", xp: 10 }] }), request = f.manageInput({ type: "plan", manifest: archive, archiveDigest: "a".repeat(64), native: null })
    const first = await f.run<C.BackupManageResult>(f.store.manage(request)); assert.equal(first.type, "plan"); assert.equal(first.duplicate, false)
    const repeated = await f.run<C.BackupManageResult>(f.store.manage(request)); assert.equal(repeated.type, "plan"); assert.equal(repeated.duplicate, true)
    assert.deepEqual(repeated.plan, first.plan); assert.deepEqual(repeated.items, first.items)
    const changed = { ...request, operation: { ...request.operation, type: "plan" as const, manifest: { ...archive, backupId: "synthetic-different-source-archive" }, archiveDigest: "a".repeat(64), native: null } }
    await f.reject(f.store.manage(changed), f.BackupStoreError, 409)
    assert.equal((await f.query({ type: "plans" }) as Extract<C.BackupQueryResult, { type: "plans" }>).plans.length, 1)
})

test("backup actual serial executor discovers21 items and enforces twenty item passes through restart", async t => {
    const f = await fixture(t), { processBackupPlanPass } = await import("../../bot/src/backup.ts"), xp = Array.from({ length: 21 }, (_, i) => ({ sourceId: String(10000 + i), userId: String(10000 + i), xp: i })), planned = await f.plan(f.manifest({ xp })), confirmed = await f.confirm(planned.plan)
    await withNative(f, ({ Effect, Redacted }, bot) => Effect.gen(function* () {
        const config = { serverId: "1", token: Redacted.make("synthetic-backup-sdk-token"), backend: f.config }, first = yield* processBackupPlanPass(f.store, config, bot.client, confirmed, "90")
        assert.equal(first.results.length, 20); assert.equal(first.remaining, 1); assert(first.results.every(result => result.recorded && result.item.state === "created"))
        const second = yield* processBackupPlanPass(f.store, config, bot.client, confirmed, "90"); assert.equal(second.results.length, 1); assert.equal(second.remaining, 0)
        const third = yield* processBackupPlanPass(f.store, config, bot.client, confirmed, "90"); assert.deepEqual(third.results, [])
        assert(!bot.requests().some((request: any) => request.method !== "GET"))
    }))
    assert.equal((await f.snapshot(["xp"])).xp.length, 21)
    assert.deepEqual(await f.backend.run(async ctx => (await ctx.db.query("levelingProfiles").collect()).filter(row => row.rewardDueAt !== undefined)), [])
})

test("backup retained status reconcile and forget remain private and usable after keyring removal", async t => {
    const f = await fixture(t), { handleBackupCommand } = await import("../../bot/src/backup.ts"), row = structure(f.now()), planned = await f.plan(f.manifest({ structure: [row] }), f.native([row])), item = planned.items[0]!
    await f.confirm(planned.plan); await f.work({ type: "reserve", binding: itemBinding(item), context: f.context(), native: f.native([row]) }); await f.work({ type: "claim", binding: itemBinding(item), context: f.context(), native: f.native([row]), claimToken: "a".repeat(32) })
    await f.work({ type: "outcome", binding: itemBinding(item), claimToken: "a".repeat(32), outcome: "uncertain", mappedId: "130", channel: { ...row, sourceId: "130" } }); f.advance(130001)
    await withNative(f, ({ Effect, Redacted }, bot) => Effect.gen(function* () {
        const native = nativeChannels(f, bot), config = { serverId: "1", token: Redacted.make("synthetic-backup-sdk-token"), backend: f.config }
        native.channels.set("130", bot.fixtures.channel({ id: "130", guild_id: "1", type: 4, name: row.name, parent_id: null, permission_overwrites: [{ id: "1", type: 0, allow: "0", deny: "1024" }, { id: "999", type: 1, allow: "1024", deny: "0" }] }))
        const replies = bot.rest.respond("POST /channels/90/messages", (request: any) => { const wire = privateWire(f, bot, String(request.body.content)); wire.author = bot.fixtures.botUser({ id: "999" }); return { body: wire } })
        for (const type of ["status", "reconcile", "forget"] as const) {
            const wire = privateWire(f, bot, `!backup ${type}`); bot.rest.respond(`GET /channels/90/messages/${wire.id}`, { body: wire })
            const message = yield* bot.client.messages.fetch({ channelId: "90", id: wire.id }), context = { client: bot.client, message, reply: (value: any) => bot.client.messages.send("90", value) } as Parameters<typeof handleBackupCommand>[3]
            yield* handleBackupCommand(f.store, config, { type, binding: binding(planned.plan) }, context)
            assert(!String((replies.requests().at(-1)!.body as any).content).includes("refused"))
            assert(!String((replies.requests().at(-1)!.body as any).content).includes("crypto is disabled"))
        }
        const result = yield* Effect.promise(() => f.show(planned.plan)); assert.equal(result.forgotten, true)
        assert.equal(native.create.requests().length, 0)
        const origin = (yield* Effect.promise(() => f.origins()))[0]!; assert.equal(origin.mappedId, "130"); assert.equal(origin.resolved, "match")
    }))
})

test("backup retained unresolved origin capacity refuses native reserve without partial mutation", async t => {
    const f = await fixture(t), empty = await f.plan(f.manifest({ xp: [] })), row = structure(f.now()), planned = await f.plan(f.manifest({ structure: [row] }), f.native([row])); await f.confirm(planned.plan)
    const originPlan = await f.backend.run(async ctx => ctx.db.normalizeId("backupPlans", empty.plan.planId)); assert(originPlan)
    for (let batch = 0; batch < 10; batch++) await f.backend.run(async ctx => {
        for (let i = 0; i < 500; i++) await ctx.db.insert("backupOrigins", { serverId: "1", provider, category: "structure", family: "structure", sourceId: String(10000 + batch * 500 + i), state: "uncertain", planId: originPlan, itemNo: 1, generation: 1, mappedId: null, desiredHash: "a".repeat(64) })
    })
    await f.reject(f.store.work({ serverId: "1", operation: { type: "reserve", binding: itemBinding(planned.items[0]!), context: f.context(), native: f.native([row]) } }), f.BackupStoreError, 429)
    assert.equal((await f.items(planned.plan))[0]!.state, "planned")
    assert.equal((await f.backend.run(ctx => ctx.db.query("backupOrigins").collect())).length, 5000)
})
