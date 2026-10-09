import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import {
    BACKUP_CATEGORY_LIMITS,
    BackupManifest,
    type BackupConfigObject,
    type BackupItem,
    type BackupNativeProof,
} from "@neonflux/contracts/backup"
import {
    backupNormalized,
    backupChannelSemantic,
    backupConfig,
    backupHash,
    backupStructure,
    canonicalBackupJson,
} from "../convex/backupDomain.ts"
import { decode } from "../convex/validation.ts"
import { defaultLevelingSettings } from "../convex/levelingDomain.ts"
import { defaultSettings } from "../convex/moderationDomain.ts"
import { state as moderationState } from "../convex/moderationStore.ts"
import { levelingState } from "../convex/levelingStore.ts"
import { allPermissions, binding, fixture, installBackupEnv, read, secret, status } from "./backup-fixture.ts"

installBackupEnv()

test("Backup authenticates every route and requires current exact Owner, provider and private DM", async (t) => {
    const f = await fixture(t)
    await status(
        await f.http("/backup/snapshot", { serverId: "1", context: f.context(), selected: ["xp"] }, false),
        401,
    )
    for (const patch of [
        { ownerId: "11" },
        { privateReplyAuthorized: false },
        { recipientIds: ["10", "11"] },
        { recipientIds: ["999"] },
        { ownerTimeoutUntil: new Date(f.now() + 60000).toISOString() },
        { provider: `${f.provider}/v1` },
    ])
        await status(
            await f.query({ type: "plans" }, { context: { ...f.context(), ...patch } }),
            patch.provider ? 400 : 403,
        )
    // The contract allows only a human actor, so another kind is malformed
    await status(await f.query({ type: "plans" }, { context: { ...f.context(), actorKind: "unknown" } }), 400)
    await status(await f.snapshot([]), 400)
    await status(await f.snapshot(["all"]), 400)
    await status(await f.query({ type: "plans" }, { serverId: "2" }), 403)
    assert.equal((await read(await f.query({ type: "plans" }))).type, "plans")
})

test("Role reservation backups retain future-user mappings and restore as archived with native safe-role evidence", async (t) => {
    const f = await fixture(t)
    const roleConfig: BackupConfigObject = {
        family: "roles",
        sourceId: "roles",
        value: {
            panelsEnabled: false,
            verificationEnabled: false,
            autoroleEnabled: true,
            humansOnly: true,
            autoroleIds: [],
            reservations: [{ userId: "20", roleIds: ["40"] }],
        },
    }
    const proof = f.proof(
        [],
        [
            {
                id: "40",
                type: "role",
                serverId: "1",
                observedAt: f.now(),
                exists: true,
                actorCanAccess: true,
                botCanAccess: true,
                actorCanManage: true,
                botCanManage: true,
                permissions: "0",
            },
        ],
    )
    const planned = await f.plan(f.manifest([roleConfig]), proof)
    await f.confirm(planned.plan)
    const missingProof = await f.plan(f.manifest([roleConfig]), proof)
    await f.confirm(missingProof.plan)
    assert.equal((await read(await f.apply(missingProof.items[0]!, null))).item.state, "blocked")
    const applied = await read(await f.apply(planned.items[0]!, proof))
    assert.equal(applied.item.state, "created")
    const settings = await f.db.run((ctx) =>
        ctx.db
            .query("roleSettings")
            .withIndex("by_server", (q) => q.eq("serverId", "1"))
            .unique(),
    )
    assert.deepEqual(settings?.config.reservations, roleConfig.value.reservations)
    assert.equal(settings?.config.autoroleEnabled, true)
    const snapshot = await read(await f.snapshot(["config"]))
    const restored = snapshot.config.find((row: BackupConfigObject) => row.family === "roles")
    assert.deepEqual(restored.value.reservations, roleConfig.value.reservations)
    const refs = await f.db.run((ctx) =>
        ctx.db
            .query("roleReferences")
            .withIndex("by_server_role", (q) => q.eq("serverId", "1").eq("roleId", "40"))
            .collect(),
    )
    assert.equal(refs.length, 1)
    assert.equal(refs[0]?.configuration, true)
})

test("Metadata backups restore the module switch and destinations as archived, and a destination the bot cannot post to is blocked", async (t) => {
    const f = await fixture(t)
    const value: BackupConfigObject = {
        family: "metadata",
        sourceId: "metadata",
        value: {
            enabled: true,
            routes: (["membership", "resources", "messages", "audit", "settings", "operations"] as const).map(
                (category) => ({ category, enabled: false }),
            ),
            eventRoutes: [{ eventType: "audit-entry:20", enabled: false, channelId: "30", ownerId: "10" }],
            messageChannelIds: [],
            excludedChannelIds: [],
        },
    }
    const native = f.proof(
        [],
        [
            {
                id: "30",
                type: "text",
                serverId: "1",
                observedAt: f.now(),
                exists: true,
                actorCanAccess: true,
                botCanAccess: true,
                actorCanManage: true,
                botCanManage: true,
                permissions: "0",
            },
            {
                id: "10",
                type: "member",
                serverId: "1",
                observedAt: f.now(),
                exists: true,
                actorCanAccess: true,
                botCanAccess: true,
                actorCanManage: true,
                botCanManage: true,
                permissions: "0",
            },
        ],
    )
    const planned = await f.plan(f.manifest([value]), native)
    await f.confirm(planned.plan)
    assert.equal((await read(await f.apply(planned.items[0]!, native))).item.state, "created")
    const member = (userId: string, isBot = false) => ({
        userId,
        joinedAt: "2024-01-01T00:00:00Z",
        roleIds: [],
        isBot,
        timeoutUntil: null,
        canView: true,
        canReadHistory: true,
    })
    const context = {
        observedAt: f.now(),
        actor: {
            originServerId: "1",
            userId: "10",
            roleIds: [],
            isOwner: true,
            isAdministrator: false,
            nativePermissionAuthorized: true,
        },
        member: member("10"),
        channelId: "30",
        channelType: 0,
        botId: "999",
        botAuthorized: true,
        actorAuthorized: true,
        actorKind: "human",
        botKind: "bot",
        botMember: member("999", true),
    }
    const queried = await read(
        await f.http("/metadata-logs/query", {
            serverId: "1",
            context,
            privateRead: { channelId: "90", recipientIds: ["10", "999"], oneToOne: true },
            operation: { type: "settings" },
        }),
    )
    assert.equal(queried.settings.enabled, true)
    assert.deepEqual(queried.settings.eventRoutes, [
        { eventType: "audit-entry:20", enabled: false, revision: 1, channelId: "30", ownerId: "10" },
    ])
    assert.equal(queried.settings.configRevision, 1)
    const snapshot = await read(await f.snapshot(["config"]))
    const projected = snapshot.config.find((row: BackupConfigObject) => row.family === "metadata")
    assert.deepEqual(projected.value.eventRoutes, [
        { eventType: "audit-entry:20", enabled: false, channelId: "30", ownerId: "10" },
    ])
    // A destination that turns on is written too, once the bot can post there, and the preview says where the logs go
    const turnedOn = await f.plan(
        f.manifest([
            {
                ...value,
                value: {
                    ...value.value,
                    eventRoutes: [{ eventType: "audit-entry:20", enabled: true, channelId: "30", ownerId: "10" }],
                },
            },
        ]),
        native,
    )
    assert.equal(turnedOn.items[0]!.disposition, "blocked")
    assert.match(turnedOn.items[0]!.reason!, /^NeonFlux needs .+ in <#30> to post logs there\./)
})

test("Selected snapshot uses every indexed configuration family and excludes private rows and source state", async (t) => {
    const f = await fixture(t)
    await f.db.run(async (ctx) => {
        const state = await moderationState(ctx, "1")
        await ctx.db.patch(state._id, { config: { ...defaultSettings(), defcon: 1 } })
        await ctx.db.insert("afkStatuses", {
            serverId: "1",
            userId: "12",
            reason: "Synthetic private AFK narrative",
            since: f.now(),
        })
        await ctx.db.insert("responseDefinitions", {
            serverId: "1",
            kind: "custom",
            name: "synthetic",
            reply: { type: "text", text: "Authored config" },
            channelIds: [],
            roleIds: [],
            cooldownSeconds: 0,
            priority: 0,
            enabled: true,
            createdAt: 1,
            updatedAt: 2,
        })
        const level = await levelingState(ctx, "1")
        await ctx.db.patch(level._id, { config: { ...defaultLevelingSettings(), scoreEpoch: 2 } })
        await ctx.db.insert("levelingProfiles", {
            serverId: "1",
            userId: "20",
            xp: 50,
            scoreEpoch: 1,
            adjustmentRevision: 7,
            joinedAt: "2020-01-01T00:00:00Z",
            digests: [{ digest: "d".repeat(64), creditedAt: f.now() }],
        })
    })
    const r = await read(await f.snapshot())
    assert.deepEqual(r.xp, [{ sourceId: "20", userId: "20", xp: 0 }])
    const text = JSON.stringify(r)
    for (const forbidden of [
        "defcon",
        "manualCases",
        "cooldownCount",
        "scoreEpoch",
        "digest",
        "adjustmentRevision",
        "Synthetic private AFK",
        "joinedAt",
        secret,
    ])
        assert(!text.includes(forbidden), forbidden)
    assert.equal(r.config.find((x: BackupConfigObject) => x.family === "response").value.reply.text, "Authored config")
    const onlyXp = await read(await f.snapshot(["xp"]))
    assert.deepEqual(onlyXp.config, [])
})

test("XP snapshot refuses 501 profiles as one transaction and never returns a partial category", async (t) => {
    const f = await fixture(t)
    await f.db.run(async (ctx) => {
        await levelingState(ctx, "1")
        for (let n = 1; n <= 501; n++)
            await ctx.db.insert("levelingProfiles", {
                serverId: "1",
                userId: String(n),
                xp: n,
                scoreEpoch: 1,
                adjustmentRevision: 0,
                digests: [],
            })
    })
    await status(await f.snapshot(["xp"]), 413)
    assert.deepEqual((await read(await f.snapshot(["config"]))).xp, [])
})

test("Manifest validation rejects unknown fields, duplicate identity and invalid counts before persistence", async (t) => {
    const f = await fixture(t),
        c = f.channel(),
        original = f.manifest([], [], [c])
    for (const bad of [
        { ...original, version: 2 },
        { ...original, key: "synthetic-never-stored" },
        { ...original, structure: [c, c], counts: { ...original.counts, structure: 2, overwrites: 2 } },
        { ...original, counts: { ...original.counts, structure: 2 } },
        { ...original, structure: [{ ...c, overwrites: [c.overwrites[0], c.overwrites[0]] }] },
    ] as BackupManifest[])
        await status(await f.preview(bad, f.proof([c])), 400)
    assert.equal((await f.db.run((ctx) => ctx.db.query("backupPlans").collect())).length, 0)
    await read(await f.preview(original, f.proof([c])))
    assert.equal(canonicalBackupJson({ b: 1, a: 2 }), canonicalBackupJson({ a: 2, b: 1 }))
    assert.throws(() => backupConfig({ family: "unknown", sourceId: "x", value: {} }))
})

test("Config restore creates what is missing, updates what differs with its switches as archived and preserves current DEFCON", async (t) => {
    const f = await fixture(t),
        object: BackupConfigObject = {
            family: "response",
            sourceId: "custom_synthetic",
            value: {
                kind: "custom",
                name: "synthetic",
                reply: { type: "text", text: "Hello" },
                channelIds: [],
                roleIds: [],
                cooldownSeconds: 5,
                priority: 0,
                enabled: true,
            },
        }
    const planned = await f.plan(f.manifest([object]))
    assert.deepEqual(
        { disposition: planned.items[0]!.disposition, on: planned.items[0]!.on },
        { disposition: "create", on: true },
    )
    await status(await f.apply(planned.items[0]!), 409)
    await f.confirm(planned.plan)
    const first = await read(await f.apply(planned.items[0]!))
    assert.equal(first.item.state, "created")
    assert.deepEqual(await read(await f.apply(planned.items[0]!)), first)
    const rows = await f.db.run((ctx) => ctx.db.query("responseDefinitions").collect())
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.enabled, true)
    const newer = await f.plan(f.manifest([object]))
    assert.equal(newer.items[0]!.disposition, "skip")
    await f.confirm(newer.plan)
    assert.equal((await read(await f.apply(newer.items[0]!))).item.state, "skipped")
    // A different reply is an update that names what it changes, and it keeps the definition's row
    const different: BackupConfigObject = {
        ...object,
        value: { ...object.value, reply: { type: "text", text: "Different" } },
    }
    const differing = await f.plan(f.manifest([different]))
    assert.deepEqual(
        { disposition: differing.items[0]!.disposition, changed: differing.items[0]!.changed },
        { disposition: "update", changed: ["reply"] },
    )
    assert.deepEqual(differing.plan.counts, { create: 0, update: 1, delete: 0, skip: 0, blocked: 0 })
    await f.confirm(differing.plan)
    assert.equal((await read(await f.apply(differing.items[0]!))).item.state, "updated")
    const updated = await f.db.run((ctx) => ctx.db.query("responseDefinitions").collect())
    assert.deepEqual(
        { count: updated.length, id: updated[0]!._id, text: (updated[0]!.reply as { text: string }).text },
        { count: 1, id: rows[0]!._id, text: "Different" },
    )
    // A switch alone is a difference too, and one that turns on is marked
    const off = await f.plan(f.manifest([{ ...different, value: { ...different.value, enabled: false } }]))
    assert.deepEqual(
        { disposition: off.items[0]!.disposition, changed: off.items[0]!.changed, on: off.items[0]!.on },
        { disposition: "update", changed: ["enabled"], on: undefined },
    )
    await f.confirm(off.plan)
    await read(await f.apply(off.items[0]!))
    assert.equal((await f.db.run((ctx) => ctx.db.query("responseDefinitions").first()))!.enabled, false)
    const on = await f.plan(f.manifest([different]))
    assert.deepEqual(
        { disposition: on.items[0]!.disposition, on: on.items[0]!.on },
        { disposition: "update", on: true },
    )
    assert.equal(on.plan.gain.switches, 1)
    await f.db.run(async (ctx) => {
        const state = await moderationState(ctx, "1")
        await ctx.db.patch(state._id, { config: { ...state.config, defcon: 1 } })
    })
    const onlyPolicy = { ...defaultSettings() }
    const { defcon: _defcon, ...value } = onlyPolicy
    const policy = await f.plan(f.manifest([{ family: "moderation", sourceId: "moderation", value }]))
    await f.confirm(policy.plan)
    await status(await f.apply(policy.items[0]!), 403)
    assert.equal((await f.db.run((ctx) => ctx.db.query("moderationSettings").first()))!.config.defcon, 1)
})

test("XP restore sets the current season, moves the rank counts, queues no reward and orders its correction", async (t) => {
    const f = await fixture(t)
    await f.db.run(async (ctx) => {
        const state = await levelingState(ctx, "1")
        await ctx.db.patch(state._id, { config: { ...state.config, enabled: true, scoreEpoch: 3 } })
    })
    const planned = await f.plan(f.manifest([], [{ sourceId: "20", userId: "20", xp: 1234 }]))
    assert.equal(planned.items[0]!.disposition, "create")
    await f.confirm(planned.plan)
    assert.equal((await read(await f.apply(planned.items[0]!))).item.state, "created")
    const row = await f.db.run((ctx) => ctx.db.query("levelingProfiles").first())
    assert.equal(row!.scoreEpoch, 3)
    assert.equal(row!.xp, 1234)
    assert.equal(row!.adjustmentRevision, 1)
    assert.equal(row!.correctedAt, f.now())
    assert.deepEqual(row!.digests, [])
    assert.equal(row!.joinedAt, undefined)
    const counts = () => f.db.run((ctx) => ctx.db.query("levelingLevels").collect())
    assert.deepEqual(
        (await counts()).map(({ level, count }) => ({ level, count })),
        [{ level: row!.rankLevel, count: 1 }],
    )
    // Reward roles follow the member's next activity, so the restore queues nothing
    assert.equal(
        (
            await f.db.run(async (ctx) =>
                (await ctx.db.query("levelingProfiles").collect()).filter((row) => row.rewardDueAt !== undefined),
            )
        ).length,
        0,
    )
    assert.equal((await f.db.run((ctx) => ctx.db.query("roleOwnership").collect())).length, 0)
    // A different XP is an update that moves the member's rank count to the new level and is audited
    f.advance(1000)
    const different = await f.plan(f.manifest([], [{ sourceId: "20", userId: "20", xp: 5 }]))
    assert.deepEqual(
        { disposition: different.items[0]!.disposition, changed: different.items[0]!.changed },
        { disposition: "update", changed: ["xp"] },
    )
    await f.confirm(different.plan)
    assert.equal((await read(await f.apply(different.items[0]!))).item.state, "updated")
    const after = await f.db.run((ctx) => ctx.db.query("levelingProfiles").first())
    assert.deepEqual(
        { xp: after!.xp, revision: after!.adjustmentRevision, correctedAt: after!.correctedAt },
        { xp: 5, revision: 2, correctedAt: f.now() },
    )
    assert.deepEqual(
        (await counts()).map(({ level, count }) => ({ level, count })),
        [{ level: after!.rankLevel, count: 1 }],
    )
    assert.notEqual(after!.rankLevel, row!.rankLevel)
    const audits = await f.db.run((ctx) => ctx.db.query("levelingAudits").collect())
    assert.deepEqual(
        audits.map(({ type, beforeXp, afterXp, reason }) => ({ type, beforeXp, afterXp, reason })),
        [
            { type: "adjust", beforeXp: 0, afterXp: 1234, reason: "Restored from a backup" },
            { type: "adjust", beforeXp: 1234, afterXp: 5, reason: "Restored from a backup" },
        ],
    )
    // A season reset after the preview changes what the member has, so the step conflicts instead of overwriting
    const fresh = await f.plan(f.manifest([], [{ sourceId: "21", userId: "21", xp: 2000 }]))
    await f.confirm(fresh.plan)
    await f.db.run(async (ctx) => {
        const state = await levelingState(ctx, "1")
        await ctx.db.patch(state._id, { config: { ...state.config, scoreEpoch: 4 } })
    })
    assert.equal((await read(await f.apply(fresh.items[0]!))).item.state, "conflict")
    assert.equal(
        (await f.db.run((ctx) => ctx.db.query("levelingProfiles").collect())).filter((x) => x.userId === "21").length,
        0,
    )
})

test("Plan confirmations bind archive, provider, owner, revision and fifteen minute expiry", async (t) => {
    const f = await fixture(t),
        archive = f.manifest([], [{ sourceId: "20", userId: "20", xp: 1 }])
    const first = await f.plan(archive)
    await status(await f.manage({ type: "confirm", binding: { ...binding(first.plan), revision: 2 } }), 400)
    await status(
        await f.manage({ type: "confirm", binding: { ...binding(first.plan), planHash: "b".repeat(64) } }),
        409,
    )
    await status(
        await f.manage({ type: "confirm", binding: { ...binding(first.plan), archiveDigest: "b".repeat(64) } }),
        409,
    )
    await status(
        await f.query(
            { type: "plan", binding: binding(first.plan) },
            { context: { ...f.context(), provider: "https://different.example.test" } },
        ),
        403,
    )
    await f.confirm(first.plan)
    assert.equal((await f.confirm(first.plan)).duplicate, true)
    f.advance(900000)
    await status(await f.apply(first.items[0]!), 409)
})

test("Native creation reserves once, claims once and blocks origin across different archive IDs", async (t) => {
    const f = await fixture(t),
        object = f.channel(),
        proof = f.proof([object]),
        planned = await f.plan(f.manifest([], [], [object]), proof),
        item = planned.items[0]!
    assert.equal(item.disposition, "create")
    await f.confirm(planned.plan)
    const reserved = await read(await f.reserve(item, proof))
    assert.equal(reserved.grant.channel.sourceId, "100")
    assert.equal(reserved.grant.channel.overwrites[0].deny, "1024")
    assert.equal((await read(await f.claim(item, proof))).claimed, true)
    assert.equal((await read(await f.claim(item, proof, "b".repeat(32)))).claimed, false)
    const newArchive = await f.plan(f.manifest([], [], [object]), proof)
    assert.equal(newArchive.items[0]!.disposition, "blocked")
    await status(await f.outcome(item, "created", { ...object, sourceId: "500" }, { claimToken: "b".repeat(32) }), 409)
    await read(await f.outcome(item, "created", { ...object, sourceId: "500" }))
    const skipProof = {
        ...proof,
        observations: [
            {
                sourceId: "500",
                observedAt: f.now(),
                status: "present" as const,
                channel: { ...object, sourceId: "500" },
                botPermissions: allPermissions,
            },
        ],
    }
    const identical = await f.plan(f.manifest([], [], [object]), skipProof)
    assert.equal(identical.items[0]!.disposition, "skip")
    assert.equal(identical.items[0]!.mappedId, "500")
    await status(await f.outcome(item, "created", { ...object, sourceId: "501" }), 409)
})

test("Unknown creation survives aging and accepts only original late response-bound identity", async (t) => {
    const f = await fixture(t),
        object = f.channel(),
        proof = f.proof([object]),
        planned = await f.plan(f.manifest([], [], [object]), proof),
        item = planned.items[0]!
    await f.confirm(planned.plan)
    await read(await f.reserve(item, proof))
    await read(await f.claim(item, proof))
    f.advance(130001)
    await f.clean()
    const known = { ...object, sourceId: "500" },
        result = await read(await f.outcome(item, "created", known))
    assert.equal(result.item.state, "uncertain")
    assert.equal(result.item.historicalOutcome, "uncertain")
    assert.equal(result.item.mappedId, "500")
    const restartProof = {
        ...f.proof(),
        observations: [
            {
                sourceId: "500",
                observedAt: f.now(),
                status: "present" as const,
                channel: known,
                botPermissions: allPermissions,
            },
        ],
    }
    const reconciled = await read(
        await f.work({
            type: "reconcile",
            binding: { ...binding(item), itemNo: item.itemNo, generation: 1 },
            context: f.context(),
            native: restartProof,
        }),
    )
    assert.equal(reconciled.item.resolution, "match")
    assert.equal(reconciled.item.historicalOutcome, "uncertain")
    await read(await f.manage({ type: "forget", binding: binding(planned.plan) }))
    // A channel that the restore made and somebody deleted since is made again, and the old mapping is not an obstacle
    const deleted = await f.plan(f.manifest([], [], [{ ...object, capturedAt: f.now() }]), {
        ...restartProof,
        observations: [{ sourceId: "500", observedAt: f.now(), status: "absent", channel: null, botPermissions: "0" }],
    })
    assert.equal(deleted.items[0]!.disposition, "create")
})

test("Missing overwrite audience and parent references block creates without dropping private restrictions", async (t) => {
    const f = await fixture(t),
        object = {
            ...f.channel(),
            overwrites: [...f.channel().overwrites, { id: "20", type: "member" as const, allow: "1024", deny: "0" }],
        }
    const planned = await f.plan(f.manifest([], [], [object]), f.proof([object]))
    assert.equal(planned.items[0]!.disposition, "blocked")
    assert.equal(planned.items[0]!.reason, "NeonFlux could not read the member <@20> in its permissions. Check again")
    const child = f.channel("101", "text", "100"),
        parent = f.channel("100", "category"),
        missing = await f.plan(f.manifest([], [], [child]), f.proof([child]))
    assert.equal(missing.items[0]!.disposition, "blocked")
    const dependency = await f.plan(f.manifest([], [], [child, parent]), f.proof([parent, child]))
    assert.equal(dependency.items[0]!.sourceId, "100")
    assert.equal(dependency.items[1]!.dependencyItemNo, 1)
    await f.confirm(dependency.plan)
    assert.equal((await read(await f.reserve(dependency.items[1]!, f.proof([parent, child])))).item.state, "blocked")
})

test("Configuration revisions changing after preview conflict without overwriting current data", async (t) => {
    const f = await fixture(t),
        draft: BackupConfigObject = {
            family: "draft",
            sourceId: "draft_synthetic",
            value: { kind: "draft", name: "synthetic", content: { content: "First" } },
        }
    const planned = await f.plan(f.manifest([draft]))
    await f.confirm(planned.plan)
    await f.db.run((ctx) =>
        ctx.db.insert("publishingDrafts", {
            serverId: "1",
            ...draft.value,
            revision: 2,
            canonicalContent: draft.value.content,
            createdAt: f.now(),
            updatedAt: f.now(),
        }),
    )
    assert.equal((await read(await f.apply(planned.items[0]!))).item.state, "conflict")
    assert.equal((await f.db.run((ctx) => ctx.db.query("publishingDrafts").first()))!.revision, 2)
})

test("Retention bounds settled detail erasure, takes the changes of a plan with it and preserves body-free durable origin maps", async (t) => {
    const f = await fixture(t),
        profiles = Array.from({ length: 25 }, (_, n) => ({
            sourceId: String(n + 1),
            userId: String(n + 1),
            xp: n + 1,
        })),
        object = f.channel(),
        planned = await f.plan(f.manifest([], profiles, [object]), f.proof([object]))
    assert.equal(planned.items.length, 20)
    assert(planned.nextCursor)
    const next = await read(
        await f.query({ type: "items", binding: binding(planned.plan), cursor: planned.nextCursor }),
    )
    assert.equal(next.items.length, 6)
    await f.confirm(planned.plan)
    for (const item of planned.items.filter((x) => x.category !== "structure")) await read(await f.apply(item))
    for (const item of next.items.filter((x: BackupItem) => x.category !== "structure")) await read(await f.apply(item))
    const channel = planned.items.find((x) => x.category === "structure")!
    await read(await f.reserve(channel, f.proof([object])))
    await read(await f.claim(channel, f.proof([object])))
    await read(await f.outcome(channel, "created", { ...object, sourceId: "500" }))
    const count = (table: "backupItems" | "backupChanges" | "backupPlans" | "backupOrigins") =>
        f.db.run(async (ctx) => (await ctx.db.query(table).collect()).length)
    // Every create brings its changes, and every item, change row and plan goes in passes of twenty rows
    assert.equal(await count("backupChanges"), 26)
    f.advance(604800000 + 900001)
    assert.equal((await f.clean()).removed, 20)
    assert.equal(await count("backupItems"), 6)
    assert.equal((await f.clean()).removed, 6 + 20)
    assert.equal(await count("backupChanges"), 6)
    assert.equal((await f.clean()).removed, 6 + 1)
    assert.deepEqual([await count("backupItems"), await count("backupChanges"), await count("backupPlans")], [0, 0, 0])
    // XP and configuration leave no origin. Only the channel the restore created keeps its mapping
    assert.equal(await count("backupOrigins"), 1)
})

test("Capacity refuses an eleventh confirmed plan and a plan of more than 500 items", async (t) => {
    const f = await fixture(t),
        count = () => f.db.run(async (ctx) => (await ctx.db.query("backupPlans").collect()).length)
    for (let n = 0; n < 10; n++) await f.confirm((await f.plan(f.manifest())).plan)
    assert.equal(await count(), 10)
    await status(await f.preview(f.manifest()), 429)
    assert.equal(await count(), 10)
    const big = f.manifest(
        [],
        Array.from({ length: 501 }, (_, n) => ({ sourceId: String(n + 1), userId: String(n + 1), xp: n })),
    )
    await status(await f.preview(big), 413)
    assert.equal(await count(), 10)
})

test("Native channel semantics preserve exact field values and canonicalize overwrite order only", async () => {
    const first = backupStructure({
        sourceId: "100",
        type: "text",
        name: "private",
        parentId: null,
        overwrites: [
            { id: "1", type: "role", allow: "0", deny: "1024" },
            { id: "2", type: "member", allow: "1024", deny: "0" },
        ],
        topic: null,
        nsfw: false,
        slowmodeSeconds: 0,
        capturedAt: 1,
    })
    const reordered = { ...first, sourceId: "200", capturedAt: 2, overwrites: [...first.overwrites].reverse() }
    assert.equal(
        canonicalBackupJson(backupChannelSemantic(first)),
        canonicalBackupJson(backupChannelSemantic(reordered)),
    )
    assert.notEqual(
        await backupHash(backupChannelSemantic(first)),
        await backupHash(backupChannelSemantic({ ...first, topic: "Different" })),
    )
    assert.throws(() => decode(BackupManifest, { version: 2 }))
})

test("Committed backend results remain idempotent after expiry and malformed cached operations are rejected", async (t) => {
    const f = await fixture(t),
        planned = await f.plan(f.manifest([], [{ sourceId: "20", userId: "20", xp: 12 }]))
    await f.confirm(planned.plan)
    const first = await read(await f.apply(planned.items[0]!))
    f.advance(900001)
    assert.deepEqual(await read(await f.apply(planned.items[0]!)), first)
    await status(
        await f.work({
            type: "invalid",
            binding: { ...binding(planned.items[0]!), itemNo: 1, generation: 1 },
            context: f.context(),
            native: null,
        }),
        400,
    )
    await status(
        await f.work({
            type: "apply",
            binding: { ...binding(planned.items[0]!), itemNo: 1, generation: 1 },
            context: f.context(),
            native: null,
            unknownField: true,
        }),
        400,
    )
})

test("Proven no-dispatch origin may be re-previewed and old callback cannot change newer origin", async (t) => {
    const f = await fixture(t),
        object = f.channel(),
        proof = f.proof([object]),
        first = await f.plan(f.manifest([], [], [object]), proof),
        item = first.items[0]!
    await f.confirm(first.plan)
    await read(await f.reserve(item, proof))
    await read(await f.claim(item, proof))
    await read(await f.outcome(item, "failed", null, { noDispatch: true }))
    const next = await f.plan(f.manifest([], [], [object]), proof)
    assert.equal(next.items[0]!.disposition, "create")
    await f.confirm(next.plan)
    await read(await f.reserve(next.items[0]!, proof))
    await read(await f.claim(next.items[0]!, proof, "b".repeat(32)))
    assert.equal((await read(await f.outcome(item, "failed", null, { noDispatch: true }))).item.noDispatch, true)
    await status(await f.outcome(item, "created", { ...object, sourceId: "500" }), 409)
    const origin = await f.db.run((ctx) => ctx.db.query("backupOrigins").first())
    assert.equal(origin!.planId, next.plan.planId)
    assert.equal(origin!.state, "claimed")
    assert.equal(origin!.mappedId, null)
})

test("Unclaimed expiry proves no dispatch while claimed expiry never allows a new origin attempt", async (t) => {
    const f = await fixture(t),
        object = f.channel(),
        first = await f.plan(f.manifest([], [], [object]), f.proof([object]))
    await f.confirm(first.plan)
    await read(await f.reserve(first.items[0]!, f.proof([object])))
    f.advance(130001)
    await f.clean()
    const freshObject = { ...object, capturedAt: f.now() },
        next = await f.plan(f.manifest([], [], [freshObject]), f.proof([freshObject]))
    assert.equal(next.items[0]!.disposition, "create")
    await f.confirm(next.plan)
    await read(await f.reserve(next.items[0]!, f.proof([freshObject])))
    await read(await f.claim(next.items[0]!, f.proof([freshObject])))
    f.advance(130001)
    await f.clean()
    const thirdObject = { ...object, capturedAt: f.now() },
        third = await f.plan(f.manifest([], [], [thirdObject]), f.proof([thirdObject]))
    assert.equal(third.items[0]!.disposition, "blocked")
})

test("Native callbacks retain exact known identity with mismatched or unavailable snapshot and keep conflict history", async (t) => {
    const f = await fixture(t),
        object = f.channel(),
        planned = await f.plan(f.manifest([], [], [object]), f.proof([object])),
        item = planned.items[0]!
    await f.confirm(planned.plan)
    await read(await f.reserve(item, f.proof([object])))
    await read(await f.claim(item, f.proof([object])))
    const actual = { ...object, sourceId: "500", name: "different-native-name" }
    await status(await f.outcome(item, "created", actual), 409)
    const result = await read(await f.outcome(item, "uncertain", actual))
    assert.equal(result.item.mappedId, "500")
    assert.equal(result.item.historicalOutcome, "uncertain")
    f.advance(130001)
    const reconciled = await read(
        await f.work({
            type: "reconcile",
            binding: { ...binding(item), itemNo: item.itemNo, generation: 1 },
            context: f.context(),
            native: {
                ...f.proof(),
                observations: [
                    {
                        sourceId: "500",
                        observedAt: f.now(),
                        status: "present",
                        channel: actual,
                        botPermissions: allPermissions,
                    },
                ],
            },
        }),
    )
    assert.equal(reconciled.item.resolution, "conflict")
    assert.equal(reconciled.item.historicalOutcome, "uncertain")
    await read(await f.manage({ type: "forget", binding: binding(planned.plan) }))
    f.advance(604800000 + 900001)
    await f.clean()
    assert.equal((await f.db.run((ctx) => ctx.db.query("backupPlans").collect())).length, 0)
    assert.equal((await f.db.run((ctx) => ctx.db.query("backupOrigins").first()))!.mappedId, "500")
    const another = { ...f.channel("101"), capturedAt: f.now() },
        second = await f.plan(f.manifest([], [], [another]), f.proof([another]))
    await f.confirm(second.plan)
    await read(await f.reserve(second.items[0]!, f.proof([another])))
    await read(await f.claim(second.items[0]!, f.proof([another])))
    const knownOnly = await read(await f.outcome(second.items[0]!, "uncertain", null, { mappedId: "501" }))
    assert.equal(knownOnly.item.mappedId, "501")
})

test("Backend independently requires ManageRoles for initial overwrites and refuses noncanonical configuration names", async (t) => {
    const f = await fixture(t),
        object = f.channel(),
        proof = { ...f.proof([object]), botPermissions: "1040" }
    const planned = await f.plan(f.manifest([], [], [object]), proof)
    assert.equal(planned.items[0]!.disposition, "blocked")
    assert.equal(
        planned.items[0]!.reason,
        "NeonFlux needs Manage roles. Grant it to the NeonFlux role, then check again",
    )
    for (const family of ["draft", "panel", "ticketCategory"] as const) {
        const value =
            family === "draft"
                ? { kind: "draft", name: "Uppercase", content: { content: "Hello" } }
                : family === "panel"
                  ? { kind: "reaction", name: "Uppercase", enabled: false, exclusive: false, mappings: [] }
                  : {
                        name: "Uppercase",
                        enabled: false,
                        visibility: "private",
                        description: "",
                        parentId: null,
                        supportRoleIds: [],
                        questions: [],
                        cannedReplies: [],
                    }
        assert.throws(() =>
            backupConfig({ family, sourceId: family === "draft" ? "draft_Uppercase" : "Uppercase", value }),
        )
    }
})

type Family = BackupConfigObject["family"]
type Sample = {
    before: BackupConfigObject
    after: BackupConfigObject
    /** The fields the second restore changes, in the order a plan lists them */
    changed: string[]
    /** Whether the second restore turns a setting on */
    on: boolean
}
/** Two settings of each family that differ in a switch and in what the feature authors, with the references they name */
async function samples(): Promise<Record<Family, Sample>> {
    const { defaultRolesSettings } = await import("../convex/rolesDomain.ts"),
        { defaultGreetings } = await import("../convex/greetingsDomain.ts")
    const { defcon: _defcon, ...moderation } = defaultSettings(),
        { revision: _rolesRevision, ...roles } = defaultRolesSettings(),
        {
            revision: _levelRevision,
            mappingRevision: _mappingRevision,
            scoreEpoch: _scoreEpoch,
            ...leveling
        } = defaultLevelingSettings()
    const greetings = defaultGreetings(),
        routes = Object.fromEntries(
            Object.entries(greetings.routes).map(([route, { revision: _revision, ...rest }]) => [route, rest]),
        ) as Extract<BackupConfigObject, { family: "greetings" }>["value"]["routes"]
    const content = { content: "Synthetic" },
        other = { content: "Synthetic changed" }
    const response = (enabled: boolean, text: string, extra = {}) => ({
        kind: "custom" as const,
        name: "probe",
        reply: { type: "text" as const, text },
        channelIds: [],
        roleIds: [],
        cooldownSeconds: 5,
        priority: 0,
        enabled,
        ...extra,
    })
    const automod = (enabled: boolean, patterns: string[]) => ({
        name: "probe",
        type: "words" as const,
        enabled,
        priority: 0,
        action: "log" as const,
        threshold: 1,
        windowSeconds: 30,
        durationSeconds: 60,
        patterns,
        domainMode: "block" as const,
        channelIds: [],
        exemptChannelIds: [],
        exemptRoleIds: [],
    })
    const mapping = (emoji: string) => ({ emoji, roleId: "42", prerequisiteRoleIds: [], exclusionRoleIds: [] })
    const category = (enabled: boolean, description: string, supportRoleIds: string[], questions: string[]) => ({
        name: "probe",
        enabled,
        visibility: "private" as const,
        description,
        parentId: null,
        supportRoleIds,
        questions,
        cannedReplies: [],
    })
    const route = (enabled: boolean, time: string) => ({
        kind: "birthday" as const,
        channelId: "30",
        zone: "UTC",
        time,
        fold: "reject" as const,
        template: { name: "probe", revision: 1 },
        content,
        enabled,
    })
    const policy = (ageMs: number, excludedAuthorIds: string[]) => ({
        channelId: "30",
        enabled: false,
        ageMs,
        ownerId: "10",
        excludedAuthorIds,
        excludedMessageIds: [],
    })
    const categories = ["membership", "resources", "messages", "audit", "settings", "operations"] as const
    const metadata = (enabled: boolean, messageChannelIds: string[], destination: boolean) => ({
        enabled,
        routes: categories.map((category) => ({
            category,
            enabled: false,
            ...(destination && category === "membership" ? { channelId: "30", ownerId: "10" } : {}),
        })),
        eventRoutes: destination
            ? [{ eventType: "audit-entry:20" as const, enabled: false, channelId: "31", ownerId: "10" }]
            : [],
        messageChannelIds,
        excludedChannelIds: [],
    })
    const pair = (
        family: Family,
        id: string,
        before: unknown,
        after: unknown,
        changed: string[],
        on: boolean,
    ): Sample => ({
        before: { family, sourceId: id, value: before } as BackupConfigObject,
        after: { family, sourceId: id, value: after } as BackupConfigObject,
        changed,
        on,
    })
    const switchable = (family: "publishing" | "milestones" | "cleanup" | "events" | "schedules") =>
        pair(family, family, { enabled: false }, { enabled: true }, ["enabled"], true)
    const greeting = {
        enabled: true,
        timing: "join" as const,
        channelId: "30",
        templateName: "welcome",
        templateRevision: 1,
        content,
    }
    return {
        moderation: pair(
            "moderation",
            "moderation",
            { ...moderation, automodEnabled: false, joinThreshold: 5 },
            { ...moderation, automodEnabled: true, joinThreshold: 6 },
            ["automodEnabled", "joinThreshold"],
            true,
        ),
        responses: pair(
            "responses",
            "responses",
            { customEnabled: false, autoEnabled: false },
            { customEnabled: true, autoEnabled: false },
            ["customEnabled"],
            true,
        ),
        response: pair(
            "response",
            "custom_probe",
            response(false, "One"),
            response(true, "Two", { priority: 1 }),
            ["enabled", "priority", "reply"],
            true,
        ),
        automod: pair(
            "automod",
            "probe",
            automod(false, ["one"]),
            automod(true, ["one", "two"]),
            ["enabled", "patterns"],
            true,
        ),
        publishing: switchable("publishing"),
        draft: pair(
            "draft",
            "draft_probe",
            { kind: "draft", name: "probe", content },
            { kind: "draft", name: "probe", content: other },
            ["content"],
            false,
        ),
        roles: pair(
            "roles",
            "roles",
            { ...roles, panelsEnabled: false, humansOnly: false, reservations: [] },
            { ...roles, panelsEnabled: true, humansOnly: true, reservations: [{ userId: "20", roleIds: ["40"] }] },
            ["humansOnly", "panelsEnabled", "reservations"],
            true,
        ),
        panel: pair(
            "panel",
            "probe",
            { name: "probe", kind: "reaction", enabled: false, exclusive: false, mappings: [mapping("✅")] },
            { name: "probe", kind: "reaction", enabled: true, exclusive: true, mappings: [mapping("🎉")] },
            ["enabled", "exclusive", "mappings"],
            true,
        ),
        greetings: pair(
            "greetings",
            "greetings",
            { claimsPerMinute: greetings.claimsPerMinute, retentionDays: greetings.retentionDays, routes },
            { claimsPerMinute: 7, retentionDays: greetings.retentionDays, routes: { ...routes, welcome: greeting } },
            ["claimsPerMinute", "routes"],
            true,
        ),
        tickets: pair(
            "tickets",
            "tickets",
            { enabled: false, retentionDays: 30 },
            { enabled: true, retentionDays: 60 },
            ["enabled", "retentionDays"],
            true,
        ),
        ticketCategory: pair(
            "ticketCategory",
            "probe",
            category(false, "", [], []),
            category(true, "Help", ["41"], ["Why?"]),
            ["description", "enabled", "questions", "supportRoleIds"],
            true,
        ),
        leveling: pair(
            "leveling",
            "leveling",
            { ...leveling, enabled: false, xpPerMessage: 15, mappings: [] },
            { ...leveling, enabled: true, xpPerMessage: 20, mappings: [{ level: 5, roleId: "43" }] },
            ["enabled", "mappings", "xpPerMessage"],
            true,
        ),
        milestones: switchable("milestones"),
        milestoneRoute: pair(
            "milestoneRoute",
            "birthday",
            route(false, "12:00"),
            route(true, "13:00"),
            ["enabled", "time"],
            true,
        ),
        suggestions: pair(
            "suggestions",
            "suggestions",
            { enabled: false, channelId: "30" },
            { enabled: true, channelId: "31" },
            ["channelId", "enabled"],
            true,
        ),
        cleanup: switchable("cleanup"),
        cleanupPolicy: pair(
            "cleanupPolicy",
            "30",
            policy(3600000, []),
            policy(7200000, ["20"]),
            ["ageMs", "excludedAuthorIds"],
            false,
        ),
        metadata: pair(
            "metadata",
            "metadata",
            metadata(false, [], false),
            metadata(true, ["32"], true),
            ["enabled", "eventRoutes", "messageChannelIds", "routes"],
            true,
        ),
        events: switchable("events"),
        schedules: switchable("schedules"),
    }
}

async function restoration(t: TestContext) {
    const f = await fixture(t)
    const reference = (id: string, type: BackupNativeProof["references"][number]["type"], permissions = "0") => ({
        id,
        type,
        serverId: "1",
        observedAt: f.now(),
        exists: true,
        actorCanAccess: true,
        botCanAccess: true,
        actorCanManage: true,
        botCanManage: true,
        permissions,
    })
    // The bot's own permissions in each channel are all of them unless a test narrows them
    const proof = (channelPermissions = allPermissions) =>
        f.proof(
            [],
            [
                ...["40", "41", "42", "43"].map((id) => reference(id, "role")),
                reference("30", "text", channelPermissions),
                reference("31", "text", channelPermissions),
                reference("32", "text", channelPermissions),
                reference("10", "member"),
            ],
        )
    // Plans stay for a week once confirmed, so a table of restores clears them to stay within the server's ten
    const wipe = () =>
        f.db.run(async (ctx) => {
            for (const table of ["backupItems", "backupChanges", "backupPlans"] as const)
                for (const row of await ctx.db.query(table).collect()) await ctx.db.delete(row._id)
        })
    const restore = async (...config: BackupConfigObject[]) => {
        await wipe()
        const planned = await f.plan(f.manifest(config), proof())
        await f.confirm(planned.plan)
        const applied = []
        for (const item of planned.items) applied.push((await read(await f.apply(item, proof()))).item as BackupItem)
        return { planned, items: planned.items, applied }
    }
    const projected = async (config: BackupConfigObject) =>
        ((await read(await f.snapshot(["config"]))).config as BackupConfigObject[]).find(
            (x) => x.family === config.family && x.sourceId === config.sourceId,
        )
    return { ...f, proof, reference, restore, projected, wipe }
}

// A role setting without its optional values reads the same as one with them at their defaults
const normalized = (config: BackupConfigObject | undefined) => config && backupNormalized(config)

test("A milestone route that was cleared is restored from an archive that held it switched off", async (t) => {
    const r = await restoration(t),
        sample = (await samples()).milestoneRoute.before
    await r.restore(sample)
    // Clearing a route keeps its fields and takes it out of the server's setup
    await r.db.run(async (ctx) => {
        const route = (await ctx.db.query("milestoneRoutes").first())!
        await ctx.db.patch(route._id, { configured: false, enabled: false })
    })
    assert.equal(await r.projected(sample), undefined)
    const restored = await r.restore(sample)
    assert.deepEqual([restored.items[0]!.disposition, restored.applied[0]!.state], ["create", "created"])
    assert.deepEqual(normalized(await r.projected(sample)), normalized(sample))
})

test("Every configuration family restores through its feature: created, updated, switched off and settled as identical", async (t) => {
    const r = await restoration(t)
    for (const [family, sample] of Object.entries(await samples())) {
        const created = await r.restore(sample.before)
        assert.deepEqual(
            [created.items[0]!.disposition, created.applied[0]!.state],
            ["create", "created"],
            `${family} create`,
        )
        assert.deepEqual(
            normalized(await r.projected(sample.before)),
            normalized(sample.before),
            `${family} created as archived`,
        )
        const updated = await r.restore(sample.after)
        const item = updated.items[0]!
        assert.deepEqual(
            [item.disposition, updated.applied[0]!.state, [...(item.changed ?? [])].sort(), item.on === true],
            ["update", "updated", sample.changed, sample.on],
            `${family} update`,
        )
        assert.deepEqual(
            normalized(await r.projected(sample.after)),
            normalized(sample.after),
            `${family} updated as archived`,
        )
        // Back to the first setting turns the switches off again, and nothing is marked as turning on
        const reverted = await r.restore(sample.before)
        assert.deepEqual(
            [reverted.items[0]!.disposition, reverted.items[0]!.on, reverted.applied[0]!.state],
            ["update", undefined, "updated"],
            `${family} revert`,
        )
        assert.deepEqual(
            normalized(await r.projected(sample.before)),
            normalized(sample.before),
            `${family} reverted as archived`,
        )
        const same = await r.restore(sample.before)
        assert.deepEqual(
            [same.items[0]!.disposition, same.applied[0]!.state],
            ["skip", "skipped"],
            `${family} identical`,
        )
    }
})

const probe = (patch: Record<string, unknown> = {}): BackupConfigObject => ({
    family: "response",
    sourceId: "custom_probe",
    value: {
        kind: "custom",
        name: "probe",
        reply: { type: "text", text: "Hi" },
        channelIds: [],
        roleIds: ["40"],
        cooldownSeconds: 5,
        priority: 0,
        enabled: true,
        ...patch,
    },
})

test("A restore checks a setting's references at the plan and again when it runs, with the same reason", async (t) => {
    const r = await restoration(t),
        reason = "The role <@&40> is gone, or you or NeonFlux cannot see it"
    const gone = { ...r.proof(), references: r.proof().references.filter((x) => x.id !== "40") }
    const blocked = await r.plan(r.manifest([probe()]), gone)
    assert.deepEqual([blocked.items[0]!.disposition, blocked.items[0]!.reason], ["blocked", reason])
    // The role was there at the plan and went before the step ran
    const planned = await r.plan(r.manifest([probe()]), r.proof())
    assert.equal(planned.items[0]!.disposition, "create")
    await r.confirm(planned.plan)
    const applied = (await read(await r.apply(planned.items[0]!, gone))).item
    assert.deepEqual([applied.state, applied.reason], ["blocked", reason])
    assert.equal((await r.db.run((ctx) => ctx.db.query("responseDefinitions").collect())).length, 0)
    // The same holds for a setting that already exists and would be updated
    await r.restore(probe({ roleIds: [] }))
    const update = await r.plan(r.manifest([probe()]), gone)
    assert.deepEqual([update.items[0]!.disposition, update.items[0]!.reason], ["blocked", reason])
})

test("A staff role or a role that only filters may rank above NeonFlux, and a role members get may not", async (t) => {
    const r = await restoration(t),
        { defcon: _defcon, ...moderation } = defaultSettings()
    const high = {
        ...r.proof(),
        references: r
            .proof()
            .references.map((x) => (x.id === "40" ? { ...x, actorCanManage: false, botCanManage: false } : x)),
    }
    const staff: BackupConfigObject = {
            family: "moderation",
            sourceId: "moderation",
            value: { ...moderation, staffRoleIds: { ...moderation.staffRoleIds, moderation: ["40"] } },
        },
        autorole: BackupConfigObject = {
            family: "roles",
            sourceId: "roles",
            value: {
                panelsEnabled: false,
                verificationEnabled: false,
                autoroleEnabled: true,
                humansOnly: true,
                autoroleIds: ["40"],
                reservations: [],
            },
        }
    const planned = await r.plan(r.manifest([staff, probe(), autorole]), high)
    assert.deepEqual(
        planned.items.map((x) => [x.family, x.disposition, x.reason]),
        [
            ["moderation", "create", null],
            ["response", "create", null],
            ["roles", "blocked", "The role <@&40> ranks at or above your highest role or NeonFlux's"],
        ],
    )
})

test("A step that finds the server's setting changed since the plan conflicts and writes nothing", async (t) => {
    const r = await restoration(t)
    await r.restore(probe({ roleIds: [] }))
    const planned = await r.plan(r.manifest([probe({ reply: { type: "text", text: "Changed" } })]), r.proof())
    assert.equal(planned.items[0]!.disposition, "update")
    await r.confirm(planned.plan)
    await r.db.run(async (ctx) => {
        const row = await ctx.db.query("responseDefinitions").first()
        await ctx.db.patch(row!._id, { priority: 9 })
    })
    const applied = (await read(await r.apply(planned.items[0]!, r.proof()))).item
    assert.deepEqual(
        [applied.state, applied.reason],
        ["conflict", "The server's settings for this changed since the preview"],
    )
    const row = await r.db.run((ctx) => ctx.db.query("responseDefinitions").first())
    assert.deepEqual([(row!.reply as { text: string }).text, row!.priority], ["Hi", 9])
})

test("A switch that turns on, a changed route and a changed mapping reach the pending work of their feature", async (t) => {
    const r = await restoration(t),
        all = await samples(),
        scheduled = () =>
            r.db.run(async (ctx) =>
                (await ctx.db.system.query("_scheduled_functions").collect()).map((x) => ({
                    name: x.name,
                    args: x.args,
                })),
            )
    // Schedules, milestones and publishing restart their activation clock when they turn on
    const turnedOnAt: Record<string, number> = {}
    for (const family of ["schedules", "milestones", "publishing"] as const) {
        await r.restore(all[family].before)
        r.advance(1000)
        await r.restore(all[family].after)
        turnedOnAt[family] = r.now()
    }
    const activated = await r.db.run(async (ctx) => ({
        schedules: (await ctx.db.query("scheduleSettings").first())!.activatedAt,
        milestones: (await ctx.db.query("milestoneSettings").first())!.activatedAt,
        publishing: (await ctx.db.query("publishingSettings").first())!.activatedAt,
    }))
    assert.deepEqual(activated, turnedOnAt)
    // A greeting route that changes takes its next revision, restarts and drops the posts queued under the old one
    await r.restore(all.greetings.before)
    assert.equal((await scheduled()).filter((x) => x.name === "greetings:invalidate").length, 0)
    r.advance(1000)
    await r.restore(all.greetings.after)
    const greetings = await r.db.run((ctx) => ctx.db.query("greetingSettings").first())
    assert.deepEqual(
        [
            greetings!.config.routes.welcome.revision,
            greetings!.config.routes.dm.revision,
            greetings!.activatedAt.welcome,
        ],
        [2, 1, r.now()],
    )
    assert.deepEqual(
        (await scheduled()).filter((x) => x.name === "greetings:invalidate").map((x) => x.args),
        [[{ serverId: "1", route: "welcome" }]],
    )
    // Leveling sweeps its members for rewards when it turns on and when its role mappings change, and keeps its role ledger in step
    await r.restore(all.leveling.before)
    const levelState = () => r.db.run((ctx) => ctx.db.query("levelingSettings").first())
    const levelRefs = () =>
        r.db.run(async (ctx) =>
            (await ctx.db.query("roleReferences").collect())
                .filter((x) => x.consumerKey === "level")
                .map((x) => x.roleId),
        )
    assert.deepEqual([(await levelState())!.sweepPending, await levelRefs()], [false, []])
    await r.restore(all.leveling.after)
    assert.deepEqual([(await levelState())!.sweepPending, await levelRefs()], [true, ["43"]])
    const config = (await levelState())!.config
    assert.deepEqual([config.revision, config.mappingRevision], [2, 2])
    await r.restore(all.leveling.before)
    assert.deepEqual(await levelRefs(), [])
    // A log route that changes takes its next revision, and the module's and the shared revisions move with the settings
    await r.restore(all.metadata.before)
    const logs = () => r.db.run((ctx) => ctx.db.query("metadataLogSettings").first())
    assert.deepEqual([(await logs())!.revision, (await logs())!.configRevision], [1, 1])
    await r.restore(all.metadata.after)
    const after = (await logs())!
    assert.deepEqual(
        [
            after.revision,
            after.configRevision,
            after.routes.map((x) => x.revision),
            after.eventRoutes.map((x) => x.revision),
        ],
        [2, 2, [2, 1, 1, 1, 1, 1], [2]],
    )
    // The ledger of roles a role setting names moves to its next revision. Reservations that read the same as the server's are not sent, so only the second restore takes a revision
    await r.restore(all.roles.before)
    await r.restore(all.roles.after)
    const roleRefs = await r.db.run(async (ctx) =>
        (await ctx.db.query("roleReferences").collect()).filter((x) => x.roleId === "40").map((x) => x.consumerKey),
    )
    assert.deepEqual(roleRefs, ["autorole:2"])
})

test("A ticket category moves its support roles' protection with it and takes the next revision", async (t) => {
    const r = await restoration(t),
        all = await samples()
    const protections = () =>
        r.db.run(async (ctx) =>
            (await ctx.db.query("ticketRoleProtections").collect()).map((x) => [x.roleId, x.configurationRefs]),
        )
    const revision = async () => (await r.db.run((ctx) => ctx.db.query("ticketCategories").first()))!.config.revision
    await r.restore(all.ticketCategory.before)
    const first = await revision()
    assert.deepEqual(await protections(), [])
    await r.restore(all.ticketCategory.after)
    assert.deepEqual(await protections(), [["41", 1]])
    assert.ok((await revision()) > first)
    await r.restore(all.ticketCategory.before)
    assert.deepEqual(await protections(), [])
})

test("A panel that is published or withdrawing belongs to its message, so a restore leaves it alone", async (t) => {
    const r = await restoration(t),
        all = await samples(),
        panel = all.panel.after
    const row = {
        serverId: "1",
        name: "probe",
        kind: "reaction" as const,
        revision: 1,
        enabled: true,
        exclusive: false,
        mappings: [{ emoji: "✅", roleId: "42", prerequisiteRoleIds: [], exclusionRoleIds: [] }],
        withdrawing: false,
    }
    for (const patch of [
        {
            published: {
                revision: 1,
                publishedAt: 1,
                postNo: 1,
                postGeneration: 1,
                channelId: "30",
                messageId: "500",
                botId: "999",
                content: { content: "Synthetic" },
                mappings: row.mappings,
                exclusive: false,
            },
        },
        { withdrawing: true },
    ]) {
        await r.db.run(async (ctx) => {
            for (const old of await ctx.db.query("rolePanels").collect()) await ctx.db.delete(old._id)
            await ctx.db.insert("rolePanels", { ...row, ...patch })
        })
        const planned = await r.plan(r.manifest([panel]), r.proof())
        assert.deepEqual(
            [planned.items[0]!.disposition, planned.items[0]!.reason],
            ["blocked", "Withdraw this role panel first, then check again"],
        )
    }
})

test("A cleanup policy or log route that turns on is restored with a warning, and blocked only when the bot cannot use its channel", async (t) => {
    const r = await restoration(t),
        all = await samples()
    const policy = (enabled: boolean, ageMs = 86400000 * 30): BackupConfigObject => ({
        ...all.cleanupPolicy.before,
        value: { ...(all.cleanupPolicy.before.value as object), enabled, ageMs } as never,
    })
    // The owner's confirmation is the authority, so the preview only says what turning it on does
    const create = await r.plan(r.manifest([policy(true)]), r.proof())
    assert.deepEqual(
        [create.items[0]!.disposition, create.items[0]!.on, create.items[0]!.warning],
        ["create", true, "Turns on message cleanup: messages older than 30 days in <#30> will be deleted"],
    )
    // What the feature's own gate reads of live Fluxer state is the bot's permissions in the channel, and a missing one is named with the fix
    const weak = r.proof("0"),
        refused = await r.plan(r.manifest([policy(true)]), weak)
    assert.deepEqual(
        [refused.items[0]!.disposition, refused.items[0]!.reason, refused.items[0]!.warning],
        [
            "blocked",
            "NeonFlux needs View channel, Manage messages, Read message history in <#30> to clean up there. Give it those permissions, then check again",
            undefined,
        ],
    )
    const partial = await r.plan(r.manifest([policy(true)]), r.proof(((1n << 10n) | (1n << 16n)).toString()))
    assert.match(partial.items[0]!.reason!, /^NeonFlux needs Manage messages in <#30> to clean up there\./)
    // The same check runs again when the step runs
    const step = await r.plan(r.manifest([policy(true)]), r.proof())
    await r.confirm(step.plan)
    const stepRefused = (await read(await r.apply(step.items[0]!, weak))).item
    assert.deepEqual([stepRefused.state, stepRefused.reason], ["blocked", refused.items[0]!.reason])
    assert.equal((await r.db.run((ctx) => ctx.db.query("cleanupPolicies").collect())).length, 0)
    const made = await r.restore(policy(true))
    assert.deepEqual([made.items[0]!.disposition, made.applied[0]!.state], ["create", "created"])
    assert.deepEqual(
        await r.db.run(async (ctx) => {
            const row = (await ctx.db.query("cleanupPolicies").first())!
            return [row.enabled, row.ageMs, row.ownerId]
        }),
        [true, 86400000 * 30, "10"],
    )
    // A policy already on with the same age needs no warning, a shorter age does, and turning it off restores
    assert.equal((await r.plan(r.manifest([policy(true, 86400000 * 30)]), r.proof())).items[0]!.disposition, "skip")
    const shorter = await r.plan(r.manifest([policy(true, 3600000)]), r.proof())
    assert.equal(
        shorter.items[0]!.warning,
        "Turns on message cleanup: messages older than 1 hour in <#30> will be deleted",
    )
    // It is no switch and gains nothing
    assert.deepEqual([shorter.items[0]!.on, shorter.items[0]!.gain], [undefined, undefined])
    // A longer age deletes less, so it needs neither the warning nor the permissions
    const longer = await r.plan(r.manifest([policy(true, 86400000 * 90)]), r.proof("0"))
    assert.deepEqual([longer.items[0]!.disposition, longer.items[0]!.warning], ["update", undefined])
    const off = await r.restore(policy(false))
    assert.deepEqual(
        [off.items[0]!.disposition, off.items[0]!.warning, off.applied[0]!.state],
        ["update", undefined, "updated"],
    )
    assert.equal((await r.db.run((ctx) => ctx.db.query("cleanupPolicies").first()))!.enabled, false)
    // A log route that turns on is written, with the channel that receives which logs, and needs the bot to view, send, embed and read there
    const route = all.metadata.after.value as Extract<BackupConfigObject, { family: "metadata" }>["value"]
    const metadata = (enabled: boolean): BackupConfigObject => ({
        family: "metadata",
        sourceId: "metadata",
        value: {
            ...route,
            routes: route.routes.map((x) => (x.category === "membership" ? { ...x, enabled } : x)),
        },
    })
    const on = await r.plan(r.manifest([metadata(true)]), r.proof())
    assert.deepEqual(
        [on.items[0]!.disposition, on.items[0]!.on, on.items[0]!.warning],
        ["create", true, "Turns on logs: membership logs go to <#30>"],
    )
    const silent = await r.plan(r.manifest([metadata(true)]), r.proof(((1n << 10n) | (1n << 16n)).toString()))
    assert.deepEqual(
        [silent.items[0]!.disposition, silent.items[0]!.reason],
        [
            "blocked",
            "NeonFlux needs Send messages, Embed links in <#30> to post logs there. Give it those permissions, then check again",
        ],
    )
    const written = await r.restore(metadata(true))
    assert.deepEqual([written.items[0]!.disposition, written.applied[0]!.state], ["create", "created"])
    const logs = (await r.db.run((ctx) => ctx.db.query("metadataLogSettings").first()))!
    assert.deepEqual(
        logs.routes.filter((x) => x.enabled).map((x) => [x.category, x.channelId]),
        [["membership", "30"]],
    )
    // A route that is already on, unchanged, needs neither
    assert.equal((await r.plan(r.manifest([metadata(true)]), r.proof("0"))).items[0]!.disposition, "skip")
})

test("A restored XP correction orders after the chat corrections it follows", async (t) => {
    const r = await restoration(t)
    const xp = { sourceId: "20", userId: "20", xp: 700 }
    const planned = await r.plan(r.manifest([], [xp]))
    await r.confirm(planned.plan)
    await read(await r.apply(planned.items[0]!))
    // A chat correction sent before the restore ran, and delivered after it, is refused instead of undoing the restored value
    const stale = await r.http("/levels/manage", {
        serverId: "1",
        messageId: "9001",
        createdAt: r.now() - 1000,
        actor: {
            originServerId: "1",
            userId: "10",
            roleIds: [],
            isOwner: true,
            isAdministrator: false,
            nativePermissionAuthorized: true,
        },
        operation: { type: "adjust", userId: "20", xp: 5, reason: "Stale correction" },
    })
    await status(stale, 409)
    const row = await r.db.run((ctx) => ctx.db.query("levelingProfiles").first())
    assert.deepEqual([row!.xp, row!.correctedAt], [700, r.now()])
})

test("A channel labelled as made by tickets or voice rooms is skipped by a restore, and the backend names which captured channels they are", async (t) => {
    const r = await restoration(t)
    const ticket = { ...r.channel("100"), managed: "ticket" as const },
        room = { ...r.channel("101", "voice"), managed: "voiceRoom" as const },
        plain = r.channel("102")
    const planned = await r.plan(r.manifest([], [], [ticket, room, plain]), r.proof())
    assert.deepEqual(
        planned.items.map((x) => [x.sourceId, x.disposition, x.reason]),
        [
            ["100", "skip", "A ticket channel belongs to its ticket, so a restore leaves it alone"],
            ["101", "skip", "A temporary voice room ends with its call, so a restore leaves it alone"],
            ["102", "blocked", "NeonFlux could not tell whether this channel still exists"],
        ],
    )
    // The label is not a difference between two reads of a channel
    const { managed: _managed, ...unlabelled } = ticket
    assert.equal(
        canonicalBackupJson(backupChannelSemantic(ticket)),
        canonicalBackupJson(backupChannelSemantic(unlabelled)),
    )
    await r.confirm(planned.plan)
    const applied = (await read(await r.apply(planned.items[0]!, r.proof()))).item
    assert.equal(applied.state, "skipped")
    assert.deepEqual(await r.db.run((ctx) => ctx.db.query("backupOrigins").collect()), [])
    // The backend answers which of the channels a backup is about are tickets or temporary voice rooms
    await r.db.run(async (ctx) => {
        await ctx.db.insert("tickets", {
            serverId: "1",
            ticketNo: 1,
            intakeNo: 1,
            requesterId: "20",
            requesterJoinedAt: "2024-01-01T00:00:00Z",
            category: {
                name: "support",
                revision: 1,
                enabled: true,
                visibility: "private",
                description: "",
                parentId: null,
                supportRoleIds: [],
                questions: [],
                cannedReplies: [],
            },
            answers: [],
            state: "open",
            generation: 1,
            botId: "999",
            createdAt: r.now(),
            channelId: "200",
            priority: "normal",
            entryCount: 0,
            active: true,
            nativeProtected: false,
            bodiesProtected: false,
            completedSteps: 0,
            erased: false,
            erasing: false,
        })
        await ctx.db.insert("voiceRooms", {
            serverId: "1",
            channelId: "201",
            ownerId: "20",
            generatorChannelId: "202",
            createdAt: r.now(),
        })
    })
    const answer = await read(await r.query({ type: "managed", channelIds: ["200", "201", "203", "200"] }))
    assert.deepEqual(answer, {
        type: "managed",
        channels: [
            { id: "200", managed: "ticket" },
            { id: "201", managed: "voiceRoom" },
        ],
    })
})

test("An item whose changes are too large to show is blocked instead of shown in part", async (t) => {
    const r = await restoration(t)
    // Twenty canned replies of 8,000 three-byte characters are about 480 KiB, which fits an archive but not its changes against the same size
    const reply = (n: number, c: string) => ({
        name: `reply${n}`,
        templateName: "probe",
        templateRevision: 1,
        content: { content: c.repeat(2000), embed: { description: c.repeat(4000) } },
    })
    const category = (c: string): BackupConfigObject => ({
        family: "ticketCategory",
        sourceId: "probe",
        value: {
            name: "probe",
            enabled: true,
            visibility: "private",
            description: "",
            parentId: null,
            supportRoleIds: [],
            questions: [],
            cannedReplies: Array.from({ length: 20 }, (_, n) => reply(n, c)),
        },
    })
    await r.restore(category("\u20ac"))
    await r.wipe()
    const planned = await r.plan(r.manifest([category("\u00e9")]), r.proof())
    assert.deepEqual(
        [planned.items[0]!.disposition, planned.items[0]!.reason, planned.plan.counts.blocked],
        ["blocked", "Its changes are too large to show", 1],
    )
    assert.equal(planned.items[0]!.changed, undefined)
    assert.equal((await r.db.run((ctx) => ctx.db.query("backupChanges").collect())).length, 0)
})

test("Forgetting a settled plan drops the archive values and changes it held and keeps what it restored", async (t) => {
    const r = await restoration(t)
    const planned = await r.plan(
        r.manifest([probe({ roleIds: [] })], [{ sourceId: "20", userId: "20", xp: 9 }]),
        r.proof(),
    )
    await r.confirm(planned.plan)
    for (const item of planned.items) await read(await r.apply(item, r.proof()))
    const held = () =>
        r.db.run(async (ctx) => ({
            changes: (await ctx.db.query("backupChanges").collect()).length,
            objects: (await ctx.db.query("backupItems").collect()).filter((x) => x.object !== undefined).length,
        }))
    assert.deepEqual(await held(), { changes: 2, objects: 2 })
    const forgotten = await read(await r.manage({ type: "forget", binding: binding(planned.plan) }))
    assert.equal(forgotten.plan.forgotten, true)
    assert.deepEqual(await held(), { changes: 0, objects: 0 })
    assert.equal((await r.db.run((ctx) => ctx.db.query("responseDefinitions").collect())).length, 1)
    assert.equal((await r.db.run((ctx) => ctx.db.query("levelingProfiles").collect())).length, 1)
})

test("A plan of 500 items previews, stores its items and changes, and is replaced by the next preview within one transaction", async (t) => {
    const f = await fixture(t),
        xp = (n: number) =>
            Array.from({ length: 500 }, (_, i) => ({ sourceId: String(10000 + i), userId: String(10000 + i), xp: n }))
    const first = await f.plan(f.manifest([], xp(5)))
    assert.equal(first.plan.itemCount, 500)
    const count = (table: "backupItems" | "backupChanges") =>
        f.db.run(async (ctx) => (await ctx.db.query(table).collect()).length)
    assert.deepEqual([await count("backupItems"), await count("backupChanges")], [500, 500])
    // The next preview deletes the 1,000 rows of the first plan and writes 1,000 of its own, which fits a mutation
    const second = await f.plan(f.manifest([], xp(6)))
    assert.notEqual(second.plan.planId, first.plan.planId)
    assert.deepEqual([await count("backupItems"), await count("backupChanges")], [500, 500])
})

test("A backup of 100 custom commands with the longest replies previews within one transaction", async (t) => {
    const f = await fixture(t)
    await f.db.run(async (ctx) => {
        for (let i = 0; i < 100; i++)
            await ctx.db.insert("responseDefinitions", {
                serverId: "1",
                kind: "custom",
                name: `probe${i}`,
                reply: { type: "text", text: "x".repeat(2000) },
                channelIds: [],
                roleIds: [],
                cooldownSeconds: 0,
                priority: 0,
                enabled: true,
                createdAt: 1,
                updatedAt: 1,
            })
    })
    const { config } = await read(await f.snapshot(["config"])),
        responses = (config as BackupConfigObject[]).filter((x) => x.family === "response")
    assert.equal(responses.length, 100)
    const planned = await f.plan(f.manifest(responses))
    assert.deepEqual(planned.plan.counts, { create: 0, update: 0, delete: 0, skip: 100, blocked: 0 })
})

test("A permission mask above 63 bits is archived, and a restore blocks the channel that holds it", async (t) => {
    const f = await fixture(t),
        object = {
            ...f.channel(),
            overwrites: [{ id: "1", type: "role" as const, allow: "0", deny: (1n << 63n).toString() }],
        }
    const planned = await f.plan(f.manifest([], [], [object]), f.proof([object]))
    assert.deepEqual(
        [planned.items[0]!.disposition, planned.items[0]!.reason],
        ["blocked", "Fluxer cannot store this channel's permission mask"],
    )
    // The largest mask Fluxer stores is fine
    const fits = { ...object, overwrites: [{ ...object.overwrites[0]!, deny: ((1n << 63n) - 1n).toString() }] }
    assert.equal((await f.plan(f.manifest([], [], [fits]), f.proof([fits]))).items[0]!.disposition, "create")
})

test("A rule or panel that keeps its name but has another type or kind is blocked, since a type or kind cannot change", async (t) => {
    const r = await restoration(t),
        all = await samples()
    const rule = all.automod.before
    await r.restore(rule)
    const domains = {
        ...rule,
        value: { ...(rule.value as object), type: "invites", patterns: ["one"] },
    } as BackupConfigObject
    const type = await r.plan(r.manifest([domains]), r.proof())
    assert.deepEqual(
        [type.items[0]!.disposition, type.items[0]!.reason],
        ["blocked", "An automod rule with that name has a different type"],
    )
    await r.restore(all.panel.before)
    const verification = {
        ...all.panel.before,
        value: { ...(all.panel.before.value as object), kind: "verification" },
    } as BackupConfigObject
    const kind = await r.plan(r.manifest([verification]), r.proof())
    assert.deepEqual(
        [kind.items[0]!.disposition, kind.items[0]!.reason],
        ["blocked", "A panel with that name has a different kind"],
    )
})

test("A role setting restored from an archive that leaves out its optional values clears them on the server", async (t) => {
    const r = await restoration(t),
        all = await samples()
    const roles = all.roles.before as Extract<BackupConfigObject, { family: "roles" }>
    const { reservations: _reservations, advancedVerificationEnabled: _advanced, ...plain } = roles.value
    const archived: BackupConfigObject = { ...roles, value: plain }
    // The server later got reservations and advanced verification
    await r.restore({
        ...roles,
        value: { ...plain, advancedVerificationEnabled: true, reservations: [{ userId: "20", roleIds: ["40"] }] },
    })
    const planned = await r.plan(r.manifest([archived]), r.proof())
    assert.deepEqual(
        [planned.items[0]!.disposition, [...planned.items[0]!.changed!].sort()],
        ["update", ["advancedVerificationEnabled", "reservations"]],
    )
    await r.confirm(planned.plan)
    assert.equal((await read(await r.apply(planned.items[0]!, r.proof()))).item.state, "updated")
    const settings = (await r.db.run((ctx) => ctx.db.query("roleSettings").first()))!.config
    assert.deepEqual([settings.advancedVerificationEnabled, settings.reservations], [false, []])
    // The same archive now reads as identical, and so does one that spells the defaults out
    assert.equal((await r.plan(r.manifest([archived]), r.proof())).items[0]!.disposition, "skip")
    const spelled: BackupConfigObject = {
        ...roles,
        value: { ...plain, advancedVerificationEnabled: false, reservations: [] },
    }
    assert.equal((await r.plan(r.manifest([spelled]), r.proof())).items[0]!.disposition, "skip")
})

test("A switch-only difference of a role panel keeps its revision and its role ledger", async (t) => {
    const r = await restoration(t),
        all = await samples(),
        panel = all.panel.before as Extract<BackupConfigObject, { family: "panel" }>
    await r.restore(panel)
    const state = () =>
        r.db.run(async (ctx) => ({
            panel: (await ctx.db.query("rolePanels").first())!,
            refs: (await ctx.db.query("roleReferences").collect()).map((x) => x.consumerKey).sort(),
        }))
    const before = await state()
    await r.restore({ ...panel, value: { ...panel.value, enabled: true } })
    const after = await state()
    assert.deepEqual(
        [after.panel.enabled, after.panel.revision, after.refs],
        [true, before.panel.revision, before.refs],
    )
    // Changing its mappings takes the next revision
    await r.restore(all.panel.after)
    assert.ok((await state()).panel.revision > before.panel.revision)
})

test("A restore that created a ticket category after the plan cannot go past the limit", async (t) => {
    const r = await restoration(t),
        all = await samples()
    await r.db.run(async (ctx) => {
        for (let i = 0; i < 19; i++)
            await ctx.db.insert("ticketCategories", {
                serverId: "1",
                config: {
                    name: `old${i}`,
                    revision: i + 1,
                    enabled: false,
                    visibility: "private",
                    description: "",
                    parentId: null,
                    supportRoleIds: [],
                    questions: [],
                    cannedReplies: [],
                },
            })
    })
    const category = (name: string): BackupConfigObject => ({
        ...all.ticketCategory.before,
        sourceId: name,
        value: { ...(all.ticketCategory.before.value as object), name } as never,
    })
    const planned = await r.plan(r.manifest([category("mine")]), r.proof())
    assert.equal(planned.items[0]!.disposition, "create")
    await r.confirm(planned.plan)
    // Another change takes the last slot after the preview
    await r.db.run((ctx) =>
        ctx.db.insert("ticketCategories", {
            serverId: "1",
            config: { ...(category("theirs").value as never as Record<string, never>), revision: 99 } as never,
        }),
    )
    const applied = (await read(await r.apply(planned.items[0]!, r.proof()))).item
    assert.equal(applied.state, "blocked")
    assert.match(applied.reason!, /reached its limit/)
    assert.equal((await r.db.run((ctx) => ctx.db.query("ticketCategories").collect())).length, 20)
})

test("A settings snapshot over the archive's item limit is refused like any other oversized category", async (t) => {
    const f = await fixture(t)
    await f.db.run(async (ctx) => {
        await levelingState(ctx, "1")
        for (let i = 0; i < BACKUP_CATEGORY_LIMITS.config; i++)
            await ctx.db.insert("publishingDrafts", {
                serverId: "1",
                kind: "template",
                name: `t${i}`,
                revision: 1,
                content: { content: "x" },
                canonicalContent: { content: "x" },
                createdAt: 1,
                updatedAt: 1,
            })
    })
    await status(await f.snapshot(["config"]), 413)
    assert.deepEqual((await read(await f.snapshot(["xp"]))).config, [])
})

test("A server with more than 100 drafts and templates backs up all of them and restores another draft", async (t) => {
    const r = await restoration(t)
    await r.db.run(async (ctx) => {
        for (let i = 0; i < 150; i++)
            await ctx.db.insert("publishingDrafts", {
                serverId: "1",
                kind: i % 2 ? "template" : "draft",
                name: `old${i}`,
                revision: 1,
                content: { content: "x" },
                canonicalContent: { content: "x" },
                createdAt: 1,
                updatedAt: 1,
            })
    })
    const snapshot = (await read(await r.snapshot(["config"]))).config as BackupConfigObject[]
    assert.equal(snapshot.filter((x) => x.family === "draft").length, 150)
    const restored = await r.restore({
        family: "draft",
        sourceId: "draft_new",
        value: { kind: "draft", name: "new", content: { content: "x" } },
    })
    assert.deepEqual([restored.items[0]!.disposition, restored.applied[0]!.state], ["create", "created"])
    assert.equal((await r.db.run((ctx) => ctx.db.query("publishingDrafts").collect())).length, 151)
})

test("Turning a paused module back on warns about the policies and routes it resumes, and an administrator's setting restores", async (t) => {
    const r = await restoration(t),
        all = await samples()
    const route = all.metadata.after.value as Extract<BackupConfigObject, { family: "metadata" }>["value"]
    const metadata = (enabled: boolean): BackupConfigObject => ({
        family: "metadata",
        sourceId: "metadata",
        value: {
            ...route,
            enabled,
            routes: route.routes.map((x) => (x.category === "membership" ? { ...x, enabled: true } : x)),
        },
    })
    // The logging module is off while a route stays on, so turning the module on starts the posts
    await r.restore(metadata(true))
    await r.restore(metadata(false))
    const resume = await r.plan(r.manifest([metadata(true)]), r.proof())
    assert.deepEqual(
        [resume.items[0]!.disposition, resume.items[0]!.warning],
        ["update", "Turns on logs: membership logs go to <#30>"],
    )
    const silent = await r.plan(r.manifest([metadata(true)]), r.proof(((1n << 10n) | (1n << 16n)).toString()))
    assert.equal(
        silent.items[0]!.reason,
        "NeonFlux needs Send messages, Embed links in <#30> to post logs there. Give it those permissions, then check again",
    )
    const step = await r.plan(r.manifest([metadata(true)]), r.proof())
    await r.confirm(step.plan)
    const lost = (await read(await r.apply(step.items[0]!, r.proof("0")))).item
    assert.deepEqual(
        [lost.state, lost.reason],
        [
            "blocked",
            "NeonFlux needs View channel, Send messages, Embed links, Read message history in <#30> to post logs there. Give it those permissions, then check again",
        ],
    )
    // The cleanup module resumes the policies that are on. With the policy in the archive the bot has read its channel
    await r.db.run(async (ctx) => {
        await ctx.db.insert("cleanupSettings", {
            serverId: "1",
            enabled: false,
            revision: 1,
            policies: 1,
            receipts: 0,
            nextSweepNo: 1,
            nextTargetNo: 1,
        })
        await ctx.db.insert("cleanupPolicies", {
            serverId: "1",
            channelId: "30",
            revision: 1,
            enabled: true,
            ageMs: 86400000 * 30,
            ownerId: "10",
            excludedAuthorIds: [],
            excludedMessageIds: [],
            nextCheckAt: r.now(),
        })
    })
    const policy = {
        ...all.cleanupPolicy.before,
        value: { ...(all.cleanupPolicy.before.value as object), enabled: true, ageMs: 86400000 * 30 },
    } as BackupConfigObject
    const module: BackupConfigObject = { family: "cleanup", sourceId: "cleanup", value: { enabled: true } }
    const cleanup = await r.plan(r.manifest([module, policy]), r.proof())
    const byFamily = Object.fromEntries(cleanup.items.map((x) => [x.family, x]))
    assert.deepEqual(
        [
            byFamily.cleanup!.disposition,
            byFamily.cleanup!.warning,
            byFamily.cleanupPolicy!.disposition,
            byFamily.cleanupPolicy!.warning,
        ],
        ["update", "Turns on message cleanup: messages older than 30 days in <#30> will be deleted", "skip", undefined],
    )
    const weak = await r.plan(r.manifest([module, policy]), r.proof("0"))
    assert.equal(weak.items.find((x) => x.family === "cleanup")!.disposition, "blocked")
    assert.match(
        weak.items.find((x) => x.family === "cleanup")!.reason!,
        /^NeonFlux needs View channel, Manage messages, Read message history in <#30> to clean up there\./,
    )
    // Without the policy in the archive the bot read nothing of its channel, so the warning says what resumes and the worker checks the channel
    const unread = { ...r.proof("0"), references: r.proof("0").references.filter((x) => x.id !== "30") },
        alone = await r.plan(r.manifest([module]), unread)
    assert.deepEqual(
        [alone.items[0]!.disposition, alone.items[0]!.warning],
        ["update", "Turns on message cleanup: messages older than 30 days in <#30> will be deleted"],
    )
    // A policy that changed after the preview is not the one the owner confirmed, so the module conflicts and stays off
    const fresh = await r.plan(r.manifest([module, policy]), r.proof())
    await r.confirm(fresh.plan)
    await r.db.run(async (ctx) => {
        const row = (await ctx.db.query("cleanupPolicies").first())!
        await ctx.db.patch(row._id, { ageMs: 86400000, revision: row.revision + 1 })
    })
    const changed = (
        await read(
            await r.apply(
                fresh.items.find((x) => x.family === "cleanup")!,
                r.proof(),
            ),
        )
    ).item
    assert.deepEqual(
        [changed.state, changed.reason],
        ["conflict", "The server's settings for this changed since the preview"],
    )
    assert.equal((await r.db.run((ctx) => ctx.db.query("cleanupSettings").first()))!.enabled, false)
    // The archive's policy, unchanged, is read for its channel when the module runs, so lost permissions block the module at the step
    await r.db.run(async (ctx) => {
        const row = (await ctx.db.query("cleanupPolicies").first())!
        await ctx.db.patch(row._id, { ageMs: 86400000 * 30, revision: row.revision + 1 })
    })
    const kept = await r.plan(r.manifest([module, policy]), r.proof())
    await r.confirm(kept.plan)
    const lostChannel = (
        await read(
            await r.apply(
                kept.items.find((x) => x.family === "cleanup")!,
                r.proof("0"),
            ),
        )
    ).item
    assert.deepEqual(
        [lostChannel.state, lostChannel.reason],
        [
            "blocked",
            "NeonFlux needs View channel, Manage messages, Read message history in <#30> to clean up there. Give it those permissions, then check again",
        ],
    )
    assert.equal((await r.db.run((ctx) => ctx.db.query("cleanupSettings").first()))!.enabled, false)
    // A setting an administrator made restores for the owner who confirms it, with the member still on the server
    const admin = {
        ...policy,
        sourceId: "31",
        value: { ...(policy.value as object), channelId: "31", ownerId: "11" },
    } as BackupConfigObject
    const proof = r.proof()
    proof.references.push(r.reference("11", "member"))
    const made = await r.plan(r.manifest([admin]), proof)
    assert.deepEqual([made.items[0]!.disposition, made.items[0]!.reason], ["create", null])
    await r.confirm(made.plan)
    assert.equal((await read(await r.apply(made.items[0]!, proof))).item.state, "created")
    assert.deepEqual(
        await r.db.run(async (ctx) =>
            (await ctx.db.query("cleanupPolicies").collect())
                .filter((x) => x.channelId === "31")
                .map((x) => [x.enabled, x.ownerId]),
        ),
        [[true, "11"]],
    )
})
