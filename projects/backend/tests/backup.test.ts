import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import {
    BACKUP_PLAN_MS,
    BackupManifest,
    BackupManifestHeader,
    BackupQueryResult,
    type BackupPlan,
    type BackupConfigObject,
    BackupItem,
    BACKUP_RESTORE_LIMITS,
    BackupNativeProof,
    type BackupStructureObject,
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
import type { AutomodRule } from "@neonflux/contracts/moderation"
import { TICKET_CANNED_BYTES, ticketCannedBytes } from "@neonflux/contracts/tickets"
import type { RolesPanel } from "@neonflux/contracts/roles"
import { state as moderationState } from "../convex/moderationStore.ts"
import { levelingState } from "../convex/levelingStore.ts"
import { allPermissions, binding, fixture, installBackupEnv, read, secret, status } from "./backup-fixture.ts"
import { backupImports } from "../convex/backupImports.ts"
import { projectBackupConfig } from "../convex/backupProjections.ts"
import { backupRewriteConfig } from "../convex/backupStore.ts"
import { memberDataDelete } from "../convex/memberData.ts"

installBackupEnv()

test("A level-up channel in a leveling backup is a checked channel reference that a restore maps like the others", async () => {
    const {
        revision: _revision,
        mappingRevision: _mapping,
        scoreEpoch: _epoch,
        ...leveling
    } = defaultLevelingSettings()
    const item = backupConfig({
        family: "leveling",
        sourceId: "leveling",
        value: {
            ...leveling,
            onlyChannelIds: ["30"],
            excludedChannelIds: ["31"],
            levelUp: { channelId: "32", rewardsOnly: true },
        },
    })
    assert.deepEqual(
        backupImports.backupConfigReferences(item).filter((ref) => ref.type === "text"),
        [
            { id: "30", type: "text" },
            { id: "31", type: "text" },
            { id: "32", type: "text" },
        ],
    )
    const mapped = await backupRewriteConfig(item, async (id) => `9${id}`)
    assert.deepEqual(
        mapped.family === "leveling" && [
            mapped.value.onlyChannelIds,
            mapped.value.excludedChannelIds,
            mapped.value.levelUp,
        ],
        [["930"], ["931"], { channelId: "932", rewardsOnly: true }],
    )
    // Messages where members level up name no channel to map
    const here = backupConfig({ ...item, value: { ...item.value, levelUp: { channelId: null, rewardsOnly: false } } })
    assert.deepEqual(
        backupImports.backupConfigReferences(here).filter((ref) => ref.type === "text"),
        [
            { id: "30", type: "text" },
            { id: "31", type: "text" },
        ],
    )
})

test("Backup authenticates every route and requires current exact Owner, provider and private DM", async (t) => {
    const f = await fixture(t)
    await status(
        await f.http("/backup/snapshot-page", { serverId: "1", context: f.context(), selected: ["xp"] }, false),
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
            routes: (
                ["membership", "resources", "messages", "audit", "settings", "operations", "security"] as const
            ).map((category) => ({ category, enabled: false })),
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

test("1,200 XP profiles export in pages, plan as twelve pages of members and restore, and a member changed since the check is left", async (t) => {
    const f = await fixture(t)
    await f.db.run(async (ctx) => {
        await levelingState(ctx, "1")
        for (let n = 1; n <= 1200; n++)
            await ctx.db.insert("levelingProfiles", {
                serverId: "1",
                userId: String(n),
                xp: n,
                scoreEpoch: 1,
                adjustmentRevision: 0,
                digests: [],
            })
    })
    // Every profile comes out, 500 to a page, and settings come out apart from XP
    const pages = []
    for (let cursor: string | undefined, page = 0; page < 10; page++) {
        const body = await read(await f.snapshotPage(["xp"], cursor))
        pages.push(body.xp.length)
        if (body.cursor === null) break
        cursor = body.cursor
    }
    assert.deepEqual(pages, [500, 500, 200])
    const xp = (await read(await f.snapshot(["xp"]))).xp as BackupManifest["xp"]
    assert.equal(xp.length, 1200)
    assert.deepEqual((await read(await f.snapshot(["config"]))).xp, [])
    // The archive gives every member one more XP than now
    const planned = await f.plan(
        f.manifest(
            [],
            xp.map((x) => ({ ...x, xp: x.xp + 1 })),
        ),
    )
    // A page holds 100 members, so applying one stays within a function's reads
    assert.equal(planned.plan.itemCount, 12)
    const items: BackupItem[] = []
    for (let cursor: string | undefined, page = 0; page < 5; page++) {
        const body = await read(
            await f.query({ type: "items", binding: binding(planned.plan), ...(cursor ? { cursor } : {}) }),
        )
        items.push(...body.items)
        if (!body.nextCursor) break
        cursor = body.nextCursor
    }
    assert.deepEqual(
        [...new Set(items.map((x) => `${x.category} ${x.disposition} ${x.name?.split(",")[0]}`))],
        ["xp update 100 members"],
    )
    // One member's XP changes after the check, so the restore leaves that member and says so
    await f.db.run(async (ctx) => {
        const row = (await ctx.db.query("levelingProfiles").collect()).find((x) => x.userId === "7")!
        await ctx.db.patch(row._id, { xp: 70000 })
    })
    await f.confirm(planned.plan)
    const applied = []
    for (const item of items) applied.push((await read(await f.apply(item))).item as BackupItem)
    assert.deepEqual([...new Set(applied.map((x) => x.state))], ["updated"])
    assert.deepEqual(
        applied.flatMap((x) => (x.reason ? [x.reason] : [])),
        ["1 member was left alone, since their XP changed after the check"],
    )
    const after = new Map(
        ((await read(await f.snapshot(["xp"]))).xp as BackupManifest["xp"]).map((x) => [x.userId, x.xp]),
    )
    assert.equal(after.get("7"), 70000)
    assert.equal(after.get("1"), 2)
    assert.equal(after.get("1200"), 1201)
})

test("A restore gives XP to new members of a server that already has 50,000 members with a score", async (t) => {
    const f = await fixture(t)
    await f.db.run(async (ctx) => {
        const state = await levelingState(ctx, "1")
        await ctx.db.patch(state._id, { profiles: 50000 })
    })
    const archive = f.manifest(
        [],
        [
            { sourceId: "21", userId: "21", xp: 100 },
            { sourceId: "22", userId: "22", xp: 200 },
        ],
    )
    // An archive may hold more than 50,000 members with XP
    const { config: _config, xp: _xp, structure: _structure, ...header } = archive
    assert.equal(
        decode(BackupManifestHeader, { ...header, counts: { ...header.counts, xp: 600000 } }).counts.xp,
        600000,
    )
    const planned = await f.plan(archive)
    assert.deepEqual(
        planned.items.map((x) => ({ name: x.name, disposition: x.disposition, reason: x.reason })),
        [{ name: "2 members, from <@21> to <@22>", disposition: "create", reason: null }],
    )
    await f.confirm(planned.plan)
    assert.equal(((await read(await f.apply(planned.items[0]!))).item as BackupItem).state, "created")
    const after = await f.db.run(async (ctx) => ({
        xp: Object.fromEntries((await ctx.db.query("levelingProfiles").collect()).map((x) => [x.userId, x.xp])),
        profiles: (await ctx.db.query("levelingSettings").first())!.profiles,
    }))
    assert.deepEqual(after, { xp: { "21": 100, "22": 200 }, profiles: 50002 })
})

test("A restore leaves out the XP of a member who deleted their data after the backup was made, and keeps only when they did", async (t) => {
    const f = await fixture(t)
    await f.db.run(async (ctx) => {
        const state = await levelingState(ctx, "1")
        await ctx.db.patch(state._id, { config: { ...state.config, enabled: true } })
    })
    const xp = (await read(await f.snapshot(["xp"]))).xp as BackupManifest["xp"]
    assert.deepEqual(xp, [])
    // Members 20 and 21 have XP, and the backup is made now
    const first = await f.plan(
        f.manifest(
            [],
            [
                { sourceId: "20", userId: "20", xp: 100 },
                { sourceId: "21", userId: "21", xp: 200 },
            ],
        ),
    )
    await f.confirm(first.plan)
    await read(await f.apply(first.items[0]!))
    const archive = f.manifest(
        [],
        [
            { sourceId: "20", userId: "20", xp: 100 },
            { sourceId: "21", userId: "21", xp: 200 },
            { sourceId: "22", userId: "22", xp: 300 },
        ],
    )
    // Member 20 deletes their data afterwards, and the check of the older backup leaves them out without naming them
    f.advance(1000)
    await f.db.run((ctx) => memberDataDelete(ctx, { userId: "20" }, "1", null))
    const profiles = () =>
        f.db.run(async (ctx) =>
            Object.fromEntries((await ctx.db.query("levelingProfiles").collect()).map((x) => [x.userId, x.xp])),
        )
    assert.deepEqual(await profiles(), { "21": 200 })
    await f.db.run(async (ctx) => {
        const row = (await ctx.db.query("levelingProfiles").collect()).find((x) => x.userId === "21")!
        await ctx.db.patch(row._id, { xp: 150 })
    })
    const planned = await f.plan(archive)
    assert.deepEqual(
        planned.items.map((x) => ({ name: x.name, reason: x.reason })),
        [
            {
                name: "2 members, from <@21> to <@22>",
                reason: "1 member is left out, since they deleted their data with !mydata after the backup was made",
            },
        ],
    )
    // Member 22 deletes their data between the check and the restore, so the step leaves them out too
    f.advance(1000)
    await f.db.run((ctx) => memberDataDelete(ctx, { userId: "22" }, "1", null))
    await f.confirm(planned.plan)
    const applied = (await read(await f.apply(planned.items[0]!))).item as BackupItem
    assert.equal(
        applied.reason,
        "1 member was left out, since they deleted their data with !mydata after the backup was made",
    )
    assert.deepEqual(await profiles(), { "21": 200 })
    // Only who deleted and when is kept
    assert.deepEqual(
        (await f.db.run((ctx) => ctx.db.query("memberDataDeletions").collect())).map(
            ({ _id, _creationTime, ...row }) => row,
        ),
        [
            { serverId: "1", userId: "20", deletedAt: f.now() - 1000 },
            { serverId: "1", userId: "22", deletedAt: f.now() },
        ],
    )
    // A check of only that member names no one, and a backup made after the deletion restores their XP as usual
    const only = await f.plan({
        ...archive,
        backupId: "f".repeat(32),
        xp: archive.xp.slice(0, 1),
        counts: { ...archive.counts, xp: 1 },
    })
    assert.deepEqual(
        only.items.map((x) => ({ name: x.name, disposition: x.disposition })),
        [{ name: "1 member", disposition: "blocked" }],
    )
    f.advance(1000)
    const later = await f.plan(f.manifest([], [{ sourceId: "20", userId: "20", xp: 400 }]))
    await f.confirm(later.plan)
    assert.equal(((await read(await f.apply(later.items[0]!))).item as BackupItem).state, "created")
    assert.deepEqual(await profiles(), { "20": 400, "21": 200 })
})

test("A check refuses a header or segment that does not hold the archive, and no such check becomes a plan", async (t) => {
    const f = await fixture(t),
        c = f.channel(),
        original = f.manifest([], [], [c])
    for (const bad of [
        { ...original, version: 1 },
        { ...original, key: "synthetic-never-stored" },
        { ...original, structure: [c, c], counts: { ...original.counts, structure: 2, overwrites: 2 } },
        { ...original, counts: { ...original.counts, structure: 2 } },
        { ...original, structure: [{ ...c, overwrites: [c.overwrites[0], c.overwrites[0]] }] },
    ] as BackupManifest[])
        await status(await f.preview(bad, f.proof([c])), 400)
    const ready = () =>
        f.db.run(async (ctx) => (await ctx.db.query("backupPlans").collect()).filter((x) => x.state === "ready"))
    assert.equal((await ready()).length, 0)
    await read(await f.preview(original, f.proof([c])))
    assert.equal((await ready()).length, 1)
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
    // The audit entry of the update keeps the restore check's before and after values
    const audited = await f.db.run(async (ctx) => {
        const entry = (await ctx.db.query("auditLogEntries").order("desc").first())!
        return {
            summary: entry.summary,
            detail: entry.detail,
            changes: (await ctx.db
                .query("auditLogChanges")
                .withIndex("by_entry", (q) => q.eq("entryId", entry._id))
                .unique())!.changes,
        }
    })
    assert.deepEqual(audited, {
        summary: "Restored custom_synthetic from a backup",
        detail: true,
        changes: [{ path: "reply.text", before: "Hello", after: "Different" }],
    })
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
    const levelCounts = () => f.db.run((ctx) => ctx.db.query("levelingLevels").collect()),
        blockCounts = () => f.db.run((ctx) => ctx.db.query("levelingBlocks").collect()),
        scoreCounts = () => f.db.run((ctx) => ctx.db.query("levelingScores").collect())
    assert.equal(row!.rankXp, 1234)
    assert.deepEqual(
        (await levelCounts()).map(({ level, count }) => ({ level, count })),
        [{ level: 3, count: 1 }],
    )
    assert.deepEqual(
        (await blockCounts()).map(({ level, block, count }) => ({ level, block, count })),
        [{ level: 3, block: 0, count: 1 }],
    )
    assert.deepEqual(
        (await scoreCounts()).map(({ xp, count }) => ({ xp, count })),
        [{ xp: 1234, count: 1 }],
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
    assert.equal(after!.rankXp, 5)
    assert.deepEqual(
        (await levelCounts()).map(({ level, count }) => ({ level, count })),
        [{ level: 0, count: 1 }],
    )
    assert.deepEqual(
        (await scoreCounts()).map(({ xp, count }) => ({ xp, count })),
        [{ xp: 5, count: 1 }],
    )
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

test("Plan confirmations bind archive, provider, owner and revision, a check confirms for a day and a confirmed plan runs past it", async (t) => {
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
    // A confirmed plan runs whenever its check would have stopped being confirmable
    f.advance(BACKUP_PLAN_MS + 1)
    assert.equal((await read(await f.apply(first.items[0]!))).item.state, "created")
    // Confirming it again past that day continues its run, as `!backup confirm` does for a run that stopped
    const again = await f.confirm(first.plan)
    assert.deepEqual([again.duplicate, again.run], [true, "started"])
    // A check nobody confirmed for a day is no longer confirmed
    const second = await f.plan(f.manifest([], [{ sourceId: "21", userId: "21", xp: 1 }]))
    f.advance(BACKUP_PLAN_MS)
    await status(await f.manage({ type: "confirm", binding: binding(second.plan) }), 409)
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

test("A channel NeonFlux could not read is blocked instead of created, while a deleted one beside it is created", async (t) => {
    const f = await fixture(t),
        hidden = f.channel("100"),
        deleted = f.channel("101")
    const proof = f.proof(
        [deleted],
        [],
        [{ sourceId: "100", observedAt: f.now(), status: "unknown", channel: null, botPermissions: "0" }],
    )
    const planned = await f.plan(f.manifest([], [], [hidden, deleted]), proof)
    assert.deepEqual(planned.items.map((x) => [x.sourceId, x.disposition, x.reason]).sort(), [
        ["100", "blocked", "NeonFlux could not tell whether this channel still exists"],
        ["101", "create", null],
    ])
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
        drafts: BackupConfigObject[] = Array.from({ length: 25 }, (_, n) => ({
            family: "draft",
            sourceId: `draft_d${n}`,
            value: { kind: "draft", name: `d${n}`, content: { content: "Synthetic draft" } },
        })),
        object = f.channel(),
        planned = await f.plan(f.manifest(drafts, [], [object]), f.proof([object]))
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
    f.advance(604800000 + BACKUP_PLAN_MS + 1)
    assert.equal((await f.clean()).removed, 20)
    assert.equal(await count("backupItems"), 6)
    assert.equal((await f.clean()).removed, 6 + 20)
    assert.equal(await count("backupChanges"), 6)
    assert.equal((await f.clean()).removed, 6 + 1)
    assert.deepEqual([await count("backupItems"), await count("backupChanges"), await count("backupPlans")], [0, 0, 0])
    // Configuration leaves no origin. Only the channel the restore created keeps its mapping
    assert.equal(await count("backupOrigins"), 1)
})

test("Only unfinished plans count toward a server's ten: forgetting a plan or finishing its run frees its place", async (t) => {
    const f = await fixture(t)
    // Each plan is confirmed and its run stopped, so it stays unfinished
    const plans: BackupPlan[] = []
    for (let n = 0; n < 10; n++) {
        const made = (await f.plan(f.manifest())).plan
        await f.confirm(made)
        plans.push(made)
    }
    await status(await f.preview(f.manifest()), 429)
    await read(await f.manage({ type: "forget", binding: binding(plans[0]!) }))
    const eleventh = (await f.plan(f.manifest())).plan
    // A run that settles every item finishes its plan, which frees its place at once
    await read(await f.manage({ type: "confirm", binding: binding(eleventh) }))
    const job = await f.db.run(async (ctx) => (await ctx.db.query("backupPreviewJobs").collect())[0]!)
    await read(await f.http("/backup/run-step", { serverId: "1", requestedAt: job.createdAt, recorded: 0 }))
    await read(await f.preview(f.manifest()))
})

test("A plan of 501 members' XP and 499 settings is planned and confirmed", async (t) => {
    const f = await fixture(t),
        config: BackupConfigObject[] = Array.from({ length: 499 }, (_, n) => ({
            family: "draft",
            sourceId: `template_t${n}`,
            value: { kind: "template", name: `t${n}`, content: { content: "Synthetic template" } },
        })),
        xp = Array.from({ length: 501 }, (_, n) => ({ sourceId: String(n + 1), userId: String(n + 1), xp: n }))
    const planned = await f.plan(f.manifest(config, xp))
    // Every setting is an item, and the members are six pages of XP
    assert.deepEqual([planned.plan.itemCount, planned.plan.counts.create], [505, 505])
    assert.equal((await f.confirm(planned.plan)).plan.confirmedAt, f.now())
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

test("Forum and media channel definitions keep their post settings, and other types refuse them", () => {
    const forum = {
        sourceId: "100",
        type: "forum",
        name: "help",
        parentId: null,
        overwrites: [{ id: "1", type: "role", allow: (1n << 38n).toString(), deny: "0" }],
        topic: "x".repeat(4096),
        nsfw: false,
        slowmodeSeconds: 0,
        tags: [{ name: "Answered", moderated: true, emojiId: null, emojiName: "✅" }],
        defaultReaction: { emojiId: "5", emojiName: null },
        defaultAutoArchiveMinutes: 1440,
        sortOrder: 0,
        layout: 1,
        requireTag: true,
        capturedAt: 1,
    }
    assert.deepEqual(backupStructure(forum), forum)
    const { layout: _layout, ...media } = { ...forum, type: "media" }
    assert.deepEqual(backupStructure(media), media)
    const text = { sourceId: "101", type: "text", name: "chat", parentId: null, overwrites: [], capturedAt: 1 }
    for (const invalid of [
        { ...media, layout: 1 },
        { ...text, tags: [] },
        { ...text, requireTag: false },
        { ...forum, defaultAutoArchiveMinutes: 30 },
        { ...forum, topic: "x".repeat(4097) },
        { ...text, topic: "x".repeat(1025) },
        { ...forum, tags: [forum.tags[0], forum.tags[0]] },
        { ...forum, tags: [{ ...forum.tags[0], emojiId: "5" }] },
        { ...forum, bitrate: 64000 },
        { ...forum, tags: Array.from({ length: 21 }, (_, i) => ({ ...forum.tags[0], name: `tag${i}` })) },
    ])
        assert.throws(() => backupStructure(invalid), JSON.stringify(invalid).slice(0, 200))
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
    f.advance(604800000 + BACKUP_PLAN_MS + 1)
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
    const categories = ["membership", "resources", "messages", "audit", "settings", "operations", "security"] as const
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
    const switchable = (family: "publishing" | "milestones" | "cleanup" | "events" | "schedules" | "analytics") =>
        pair(family, family, { enabled: false }, { enabled: true }, ["enabled"], true)
    // Dates ahead of the fixture's clock, which starts on 2026-01-01
    const day = Date.parse("2026-01-10T12:00:00Z")
    const civil = (at: number) => ({ localMinute: new Date(at).toISOString().slice(0, 16), offsetMinutes: 0 })
    const scheduleCalendar = (at: number) => ({
        localMinute: new Date(at).toISOString().slice(0, 16),
        zone: "UTC",
        fold: "reject" as const,
        recurrence: { type: "none" as const },
        dates: [{ ...civil(at), dueAt: at }],
    })
    const event = (title: string, capacity: number | null) => ({
        name: "probe",
        channelId: "30",
        title,
        description: "",
        capacity,
        reminderOffsets: [1440, 60],
    })
    const schedule = (text: string, at: number) => ({
        name: "probe",
        channelId: "30",
        calendar: scheduleCalendar(at),
        source: { kind: "draft" as const, name: "probe", revision: 1 },
        content: { content: text },
        enabled: false,
    })
    const generator = (template: string, userLimit: number | null) => ({
        channelId: "33",
        categoryId: null,
        template,
        userLimit,
        region: null,
    })
    const lfg = (enabled: boolean, channelId: string | null, maxSize: number) => ({
        enabled,
        channelId,
        generatorChannelId: null,
        expiryMinutes: 60,
        maxSize,
        memberGroups: 1,
        serverGroups: 10,
    })
    const lists = (allowRoleIds: string[], blockRoleIds: string[], allowUserIds: string[]) => ({
        feature: "rolepicker" as const,
        allowRoleIds,
        blockRoleIds,
        allowUserIds,
        blockUserIds: [],
    })
    const alerts = (invites: boolean, expectedBotIds: string[], kickBots: boolean) => ({
        invites,
        bots: false,
        webhooks: false,
        privileges: false,
        impersonation: false,
        kickBots,
        deleteWebhooks: false,
        removePermissions: false,
        expectedBotIds,
        expectedWebhookIds: [],
    })
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
            { ...moderation, automodEnabled: false, joinThreshold: 5, caseRetentionDays: 30 },
            // No case period keeps cases until erased
            { ...moderation, automodEnabled: true, joinThreshold: 6, privateDataRoleId: "43" },
            ["automodEnabled", "caseRetentionDays", "joinThreshold", "privateDataRoleId"],
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
        events: pair(
            "events",
            "events",
            { enabled: false, threads: false },
            { enabled: true, threads: true },
            ["enabled", "threads"],
            true,
        ),
        event: pair("event", "probe", event("One", null), event("Two", 10), ["capacity", "title"], false),
        schedules: switchable("schedules"),
        schedule: pair(
            "schedule",
            "probe",
            schedule("One", day),
            schedule("Two", day + 86400000),
            ["calendar", "content"],
            false,
        ),
        general: pair(
            "general",
            "general",
            { prefix: "?", replyStyle: "text", nickname: "Synthetic bot" },
            { prefix: "$", replyStyle: "embed" },
            ["nickname", "prefix", "replyStyle"],
            false,
        ),
        analytics: switchable("analytics"),
        voiceGenerator: pair(
            "voiceGenerator",
            "33",
            generator("{owner} room", null),
            generator("Room of {owner}", 5),
            ["template", "userLimit"],
            false,
        ),
        lfg: pair("lfg", "lfg", lfg(false, null, 5), lfg(true, "30", 6), ["channelId", "enabled", "maxSize"], true),
        rolepicker: pair(
            "rolepicker",
            "rolepicker",
            { enabled: false, menus: [{ name: "probe", mode: "single", roleIds: ["40"] }] },
            { enabled: true, menus: [{ name: "probe", mode: "multi", description: "Pick", roleIds: ["40", "41"] }] },
            ["enabled", "menus"],
            true,
        ),
        access: pair(
            "access",
            "rolepicker",
            lists([], ["41"], []),
            lists(["40"], [], ["20"]),
            ["allowRoleIds", "allowUserIds", "blockRoleIds"],
            false,
        ),
        temproles: pair(
            "temproles",
            "temproles",
            { roles: [{ roleId: "40", defaultSeconds: 3600 }] },
            { roles: [{ roleId: "41", maxSeconds: 7200 }] },
            ["roles"],
            false,
        ),
        onboarding: pair(
            "onboarding",
            "onboarding",
            { enabled: false, delivery: "welcome", steps: [{ type: "rules" }], completionRoleId: null },
            {
                enabled: true,
                delivery: "dm",
                steps: [{ type: "rules" }, { type: "link", channelId: "30", text: "Read the guide" }],
                completionRoleId: "40",
            },
            ["completionRoleId", "delivery", "enabled", "steps"],
            true,
        ),
        sticky: pair(
            "sticky",
            "30",
            { channelId: "30", content: "One", intervalSeconds: 30 },
            { channelId: "30", content: "Two", intervalSeconds: 60 },
            ["content", "intervalSeconds"],
            false,
        ),
        alerts: pair(
            "alerts",
            "alerts",
            alerts(false, ["22"], false),
            alerts(true, ["21"], true),
            ["expectedBotIds", "invites", "kickBots"],
            true,
        ),
        helpdesk: pair(
            "helpdesk",
            "helpdesk",
            {
                forumIds: [],
                greeting: null,
                solvedTag: "Solved",
                nudgeHours: null,
                guardChannelId: null,
                autoArchive: false,
            },
            {
                forumIds: ["31"],
                greeting: "Welcome",
                solvedTag: "Done",
                nudgeHours: 24,
                guardChannelId: "32",
                autoArchive: true,
            },
            ["autoArchive", "forumIds", "greeting", "guardChannelId", "nudgeHours", "solvedTag"],
            false,
        ),
        helpdeskAnswer: pair(
            "helpdeskAnswer",
            "probe",
            { name: "probe", title: "One", content: "First answer" },
            { name: "probe", title: "Two", content: "Second answer" },
            ["content", "title"],
            false,
        ),
        showcase: pair(
            "showcase",
            "showcase",
            { enabled: false, channelId: null, maxPerMember: null, intervalMinutes: null },
            { enabled: true, channelId: "30", maxPerMember: 3, intervalMinutes: 60 },
            ["channelId", "enabled", "intervalMinutes", "maxPerMember"],
            true,
        ),
        profile: pair(
            "profile",
            "profile",
            { enabled: false, cooldownSeconds: null },
            { enabled: true, cooldownSeconds: 30 },
            ["cooldownSeconds", "enabled"],
            true,
        ),
        youtube: pair(
            "youtube",
            youtubeChannel,
            { youtubeChannelId: youtubeChannel, channelId: "30" },
            { youtubeChannelId: youtubeChannel, channelId: "31" },
            ["channelId"],
            false,
        ),
        twitch: pair(
            "twitch",
            "synthetic",
            { twitchChannelId: "synthetic", channelId: "30" },
            { twitchChannelId: "synthetic", channelId: "31" },
            ["channelId"],
            false,
        ),
    }
}
/** A YouTube channel ID of the right shape, which the tests never contact */
const youtubeChannel = "UCsyntheticBackupChannel"

async function restoration(t: TestContext) {
    const f = await fixture(t)
    process.env.NEONFLUX_TWITCH_CLIENT_ID = "synthetic-client"
    process.env.NEONFLUX_TWITCH_CLIENT_SECRET = "synthetic-secret"
    await f.db.run((ctx) =>
        ctx.db.insert("twitchSources", {
            twitchChannelId: "synthetic",
            mode: "subscribe",
            title: "Synthetic",
            dueAt: f.now() + 86400000,
            failures: 0,
            createdAt: f.now(),
        }),
    )
    // YouTube alerts need a hub, and a channel NeonFlux follows already with its title known needs no request to it
    const env = { hub: process.env.NEONFLUX_WEBSUB_HUB_URL, base: process.env.NEONFLUX_WEBSUB_CALLBACK_BASE }
    process.env.NEONFLUX_WEBSUB_HUB_URL = "https://hub.synthetic.invalid/subscribe"
    process.env.NEONFLUX_WEBSUB_CALLBACK_BASE = "https://alerts.synthetic.invalid"
    t.after(() => {
        if (env.hub === undefined) delete process.env.NEONFLUX_WEBSUB_HUB_URL
        else process.env.NEONFLUX_WEBSUB_HUB_URL = env.hub
        if (env.base === undefined) delete process.env.NEONFLUX_WEBSUB_CALLBACK_BASE
        else process.env.NEONFLUX_WEBSUB_CALLBACK_BASE = env.base
    })
    await f.db.run((ctx) =>
        ctx.db.insert("youtubeSources", {
            youtubeChannelId: youtubeChannel,
            mode: "subscribe",
            title: "Synthetic channel",
            dueAt: f.now() + 86400000,
            failures: 0,
            createdAt: f.now(),
        }),
    )
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
                reference("33", "voice", channelPermissions),
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
        const applied = [],
            panels = []
        for (const item of planned.items) {
            const body = await read(await f.apply(item, proof()))
            applied.push(body.item as BackupItem)
            panels.push(body.panel as RolesPanel | undefined)
        }
        return { planned, items: planned.items, applied, panels }
    }
    const projected = async (config: BackupConfigObject) =>
        ((await read(await f.snapshot(["config"]))).config as BackupConfigObject[]).find(
            (x) => x.family === config.family && x.sourceId === config.sourceId,
        )
    return { ...f, proof, reference, restore, projected, wipe }
}

// A role setting without its optional values reads the same as one with them at their defaults
const normalized = (config: BackupConfigObject | undefined) => config && backupNormalized(config)

test("Alert settings written before the action switches existed back up with every action off", () => {
    const projected = projectBackupConfig("alerts", {
        serverId: "1",
        invites: true,
        bots: false,
        webhooks: false,
        privileges: false,
        impersonation: false,
        expectedBotIds: [],
        expectedWebhookIds: [],
        updatedAt: 0,
        updatedBy: "10",
    })
    assert.deepEqual(projected.value, {
        invites: true,
        bots: false,
        webhooks: false,
        privileges: false,
        impersonation: false,
        kickBots: false,
        deleteWebhooks: false,
        removePermissions: false,
        expectedBotIds: [],
        expectedWebhookIds: [],
    })
})

test("Alert settings with full lists of expected bots and webhooks restore in one write, and the same IDs in another order change nothing", async (t) => {
    const r = await restoration(t)
    // 8,192 expected IDs in each list, the most Convex keeps in one array, restore without reading the settings row once for each,
    // and the check shows each list as one row of the IDs it adds, so the item stays small enough to show
    const ids = (from: number) =>
        Array.from({ length: 8192 }, (_, index) => String(BigInt("1456074443980800000") + BigInt(from + index)))
    const sample = {
        family: "alerts",
        sourceId: "alerts",
        value: {
            invites: false,
            bots: true,
            webhooks: true,
            privileges: false,
            impersonation: false,
            kickBots: false,
            deleteWebhooks: true,
            removePermissions: false,
            expectedBotIds: ids(100000),
            expectedWebhookIds: ids(200000),
        },
    } as BackupConfigObject
    const restored = await r.restore(sample)
    assert.deepEqual([restored.items[0]!.disposition, restored.applied[0]!.state], ["create", "created"])
    assert.deepEqual(normalized(await r.projected(sample)), normalized(sample))
    const changes = await r.db.run(async (ctx) => (await ctx.db.query("backupChanges").first())!.changes)
    assert.deepEqual(
        changes
            .flatMap((change) => (change.kind === "field" ? [change] : []))
            .filter((change) => change.path.startsWith("expected"))
            .map((change) => [change.path, "before" in change, (change.after as string[]).length]),
        [
            ["expectedBotIds", false, 8192],
            ["expectedWebhookIds", false, 8192],
        ],
    )
    // The server's lists in another order are the same lists, so the archive restores nothing and writes nothing
    const reversed = async () =>
        r.db.run(async (ctx) => {
            const row = (await ctx.db.query("alertSettings").first())!
            await ctx.db.patch(row._id, {
                expectedBotIds: [...row.expectedBotIds].reverse(),
                expectedWebhookIds: [...row.expectedWebhookIds].reverse(),
            })
        })
    await reversed()
    const audited = await r.db.run(async (ctx) => (await ctx.db.query("auditLogEntries").collect()).length)
    const same = await r.restore(sample)
    assert.deepEqual([same.items[0]!.disposition, same.applied[0]!.state], ["skip", "skipped"])
    assert.equal(await r.db.run(async (ctx) => (await ctx.db.query("auditLogEntries").collect()).length), audited)
    // A changed switch writes the switch, and lists that differ only in order keep their stored order
    const switched = await r.restore({ ...sample, value: { ...sample.value, invites: true } } as BackupConfigObject)
    assert.deepEqual([switched.items[0]!.disposition, switched.applied[0]!.state], ["update", "updated"])
    const stored = await r.db.run(async (ctx) => (await ctx.db.query("alertSettings").first())!)
    assert.deepEqual(
        [stored.invites, stored.expectedBotIds[0], stored.expectedWebhookIds[0]],
        [true, ids(100000).at(-1), ids(200000).at(-1)],
    )
})

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
    // A new server logs every channel, so an archive that lists its channels moves the module revision
    assert.deepEqual([(await logs())!.revision, (await logs())!.configRevision], [2, 1])
    await r.restore(all.metadata.after)
    const after = (await logs())!
    assert.deepEqual(
        [
            after.revision,
            after.configRevision,
            after.routes.map((x) => x.revision),
            after.eventRoutes.map((x) => x.revision),
        ],
        [3, 2, [2, 1, 1, 1, 1, 1, 1], [2]],
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

test("A restore step fits the proof of the setting that names the most references beside the server's 500 channels", async (t) => {
    const f = await fixture(t)
    const id = (n: number) => String(1456074443980800000n + BigInt(n))
    const proof = decode(
        BackupNativeProof,
        {
            originServerId: id(0),
            observedAt: 1792857037676,
            serverId: id(0),
            ownerId: id(1),
            botId: id(2),
            actorPermissions: "18446744073709551615",
            botPermissions: "18446744073709551615",
            actorCanManageChannels: true,
            botCanManageChannels: true,
            references: Array.from({ length: BACKUP_RESTORE_LIMITS.proofReferences }, (_, n) => ({
                originServerId: id(0),
                id: id(1000 + n),
                type: "category",
                serverId: id(0),
                observedAt: 1792857037676,
                exists: true,
                actorCanAccess: true,
                botCanAccess: true,
                actorCanManage: true,
                botCanManage: true,
                permissions: "18446744073709551615",
            })),
            observations: [],
            channels: Array.from({ length: 500 }, (_, n) => ({
                originServerId: id(0),
                id: id(10000 + n),
                type: "announcement",
                name: "x".repeat(100),
                parentId: id(20000),
                botCanManage: true,
                synced: true,
            })),
        },
        "Invalid proof",
    )
    // The route takes it, whatever the step then finds of its plan
    const response = await f.work({ type: "apply", binding: {}, context: {}, native: proof })
    assert.notEqual(response.status, 413)
    assert.ok(JSON.stringify(proof).length > 1000000)
})

test("A posted panel backs up its definition only, returns unposted when missing and changes in place when posted", async (t) => {
    const r = await restoration(t)
    // The longest name a panel may have, so every warning below is shown whole within the bot's 256 characters
    const name = "probe".padEnd(32, "x")
    const mapping = (emoji: string, roleId = "42") => ({ emoji, roleId, prerequisiteRoleIds: [], exclusionRoleIds: [] })
    const value = (mappings: ReturnType<typeof mapping>[]) => ({
        name,
        kind: "reaction" as const,
        enabled: true,
        exclusive: false,
        mappings,
    })
    const panel = (mappings: ReturnType<typeof mapping>[]): BackupConfigObject => ({
        family: "panel",
        sourceId: name,
        value: value(mappings),
    })
    const published = {
        revision: 1,
        publishedAt: 1,
        postNo: 1,
        postGeneration: 1,
        channelId: "30",
        messageId: "500",
        botId: "999",
        content: { content: "Synthetic" },
        mappings: [mapping("✅")],
        exclusive: false,
    }
    const post = (patch: Record<string, unknown> = {}) =>
        r.db.run(async (ctx) => {
            for (const old of await ctx.db.query("rolePanels").collect()) await ctx.db.delete(old._id)
            await ctx.db.insert("rolePanels", {
                serverId: "1",
                revision: 1,
                ...value([mapping("✅")]),
                published,
                withdrawing: false,
                ...patch,
            })
        })
    const stored = () => r.db.run(async (ctx) => (await ctx.db.query("rolePanels").collect())[0])
    const memberRoles = () =>
        r.db.run(async (ctx) => ({
            attempts: (await ctx.db.query("roleAttempts").collect()).length,
            ownership: (await ctx.db.query("roleOwnership").collect()).length,
        }))
    await post()
    // The archive holds what staff authored, never the message, its publication or its reactions to clear
    const exported = await r.projected(panel([mapping("✅")]))
    assert.deepEqual(exported, panel([mapping("✅")]))
    assert(!JSON.stringify(exported).includes("500"))
    // Restored into a server without it, it returns unposted, says how to post it and gives no member a role
    await r.db.run(async (ctx) => {
        for (const old of await ctx.db.query("rolePanels").collect()) await ctx.db.delete(old._id)
    })
    const missing = await r.restore(panel([mapping("✅")]))
    // The bot reads each item through the contract, which holds a warning or reason of at most 256 characters
    decode(BackupItem, missing.items[0], "Invalid item")
    assert.deepEqual(
        [missing.items[0]!.disposition, missing.items[0]!.warning, missing.applied[0]!.state],
        [
            "create",
            `Returns unposted, so members cannot use it until staff post it with !roles publish ${name} #channel <draft-name>`,
            "created",
        ],
    )
    const created = (await stored())!
    assert.deepEqual([created.published, created.withdrawing, created.mappings], [undefined, false, [mapping("✅")]])
    // An unposted panel has no reactions for the bot to clear
    assert.deepEqual(missing.panels, [undefined])
    assert.deepEqual(await memberRoles(), { attempts: 0, ownership: 0 })
    // Over the posted panel, the archived roles change under its message as a staff edit does: The emoji whose role changed waits
    // for its reactions to clear, and the message, revision and post stay
    await post()
    const changed = await r.restore(panel([mapping("✅", "43"), mapping("🎉")]))
    decode(BackupItem, changed.items[0], "Invalid item")
    assert.deepEqual([changed.items[0]!.disposition, changed.applied[0]!.state], ["update", "updated"])
    assert.equal(
        changed.items[0]!.warning,
        `Changes its posted message in place. NeonFlux clears reactions whose role changed now, so members react again, and takes back roles it gave that the panel no longer gives. If clearing fails, !roles reactions ${name} finishes it`,
    )
    const edited = (await stored())!
    assert.deepEqual(
        [edited.revision, edited.published?.messageId, edited.published?.mappings, edited.published?.pendingClear],
        [1, "500", [mapping("✅", "43"), mapping("🎉")], ["✅", "🎉"]],
    )
    assert.equal(edited.published?.clearGeneration, 1)
    // The step answers with the panel, so the bot clears those reactions in the same pass
    assert.deepEqual(
        [changed.panels[0]?.name, changed.panels[0]?.published?.messageId, changed.panels[0]?.published?.pendingClear],
        [name, "500", ["✅", "🎉"]],
    )
    // A panel being withdrawn, a switch to one choice and more reactions to clear than a change may hold are left alone with why
    for (const [patch, archived, reason] of [
        [
            { withdrawing: true },
            panel([mapping("🎉")]),
            "This role panel is being withdrawn, so a restore leaves it alone. Check again once that finished",
        ],
        [
            {},
            { ...panel([mapping("✅")]), value: { ...value([mapping("✅")]), exclusive: true } },
            "Switching a posted role panel to one choice needs a new panel message. Withdraw it first, then check again",
        ],
        [
            { published: { ...published, pendingClear: Array.from({ length: 40 }, (_, i) => `e${i}`) } },
            panel([mapping("🎉")]),
            `Panel ${name} still has reactions to update. Run !roles reactions ${name} first, then check again`,
        ],
    ] as const) {
        await post(patch)
        const planned = await r.plan(r.manifest([archived as BackupConfigObject]), r.proof())
        decode(BackupItem, planned.items[0], "Invalid item")
        assert.deepEqual([planned.items[0]!.disposition, planned.items[0]!.reason], ["blocked", reason])
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
    // It is no switch and gains nothing, so only the warning sorts it with them
    assert.deepEqual([shorter.items[0]!.on, shorter.items[0]!.gain], [undefined, undefined])
    assert.deepEqual(
        (await r.db.run((ctx) => ctx.db.query("backupItems").collect()))
            .filter((x) => x.planId === shorter.plan.planId)
            .map((x) => x.rank),
        [2],
    )
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
    // Canned replies just under the 256 KiB a category holds fit an archive, but their changes against another such set do not fit
    // the 512 KiB the changes of one item may take
    const reply = (n: number, c: string, length: number) => ({
        name: `reply${n}`,
        templateName: "probe",
        templateRevision: 1,
        content: {
            content: c.repeat(Math.min(length, 2000)),
            embed: { description: c.repeat(Math.max(1, length - 2000)) },
        },
    })
    const replies = (c: string) => {
        const rows: ReturnType<typeof reply>[] = []
        while (ticketCannedBytes([...rows, reply(rows.length, c, 6000)]) <= TICKET_CANNED_BYTES)
            rows.push(reply(rows.length, c, 6000))
        let length = 6000
        while (ticketCannedBytes([...rows, reply(rows.length, c, length)]) > TICKET_CANNED_BYTES) length--
        return [...rows, reply(rows.length, c, length)]
    }
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
            cannedReplies: replies(c),
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

test("A plan of 500 items previews in one segment, stores its items and changes, and the next preview replaces it", async (t) => {
    const f = await fixture(t),
        drafts = (text: string): BackupConfigObject[] =>
            Array.from({ length: 500 }, (_, i) => ({
                family: "draft",
                sourceId: `draft_d${i}`,
                value: { kind: "draft", name: `d${i}`, content: { content: text } },
            }))
    const first = await f.plan(f.manifest(drafts("one")))
    assert.equal(first.plan.itemCount, 500)
    const count = (table: "backupItems" | "backupChanges") =>
        f.db.run(async (ctx) => (await ctx.db.query(table).collect()).length)
    assert.deepEqual([await count("backupItems"), await count("backupChanges")], [500, 500])
    // The next preview forgets the first plan, which retention removes in pages, and stores its own
    const second = await f.plan(f.manifest(drafts("two")))
    assert.notEqual(second.plan.planId, first.plan.planId)
    assert.equal((await read(await f.query({ type: "plan", binding: binding(first.plan) }))).plan.forgotten, true)
    assert.deepEqual([await count("backupItems"), await count("backupChanges")], [1000, 1000])
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

test("Automod rules that would pass the server's pattern total are blocked by name, and the restore goes on", async (t) => {
    const r = await restoration(t),
        all = await samples()
    const words = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i}`)
    const automod = (name: string, patterns: string[]): BackupConfigObject =>
        ({
            family: "automod",
            sourceId: name,
            value: { ...(all.automod.before.value as object), name, patterns },
        }) as never
    const insertRule = (name: string, patterns: string[]) =>
        r.db.run((ctx) =>
            ctx.db.insert("automodRules", {
                serverId: "1",
                name,
                rule: { ...(automod(name, patterns).value as never as AutomodRule) },
            }),
        )
    const reason = "The server's automod rules would hold more than 2000 patterns together"
    // The server has another rule of 200 patterns, so two archived rules of 1,000 do not both fit
    await insertRule("theirs", words("t", 200))
    const responses = all.responses.after
    const planned = await r.restore(automod("a", words("a", 1000)), automod("b", words("b", 1000)), responses)
    const outcome = (items: BackupItem[]) =>
        Object.fromEntries(items.map((x) => [x.sourceId, [x.disposition, x.state, x.reason]]))
    assert.deepEqual(outcome(planned.items), {
        a: ["create", "planned", null],
        b: ["blocked", "planned", reason],
        responses: ["create", "planned", null],
    })
    assert.deepEqual(Object.fromEntries(planned.applied.map((x) => [x.sourceId, x.state])), {
        a: "created",
        b: "blocked",
        responses: "created",
    })
    // A rule that fit at the check but no longer does when it runs is blocked with the same reason, and the next item still runs
    await r.wipe()
    await r.db.run(async (ctx) => {
        for (const row of await ctx.db.query("automodRules").collect()) await ctx.db.delete(row._id)
    })
    const plan = await r.plan(r.manifest([automod("a", words("a", 1000)), automod("c", words("c", 10))]), r.proof())
    assert.deepEqual(
        plan.items.map((x) => x.disposition),
        ["create", "create"],
    )
    await r.confirm(plan.plan)
    await insertRule("late", words("l", 1000))
    await insertRule("later", words("m", 500))
    const applied: BackupItem[] = []
    for (const item of plan.items) applied.push((await read(await r.apply(item, r.proof()))).item as BackupItem)
    assert.deepEqual(outcome(applied), {
        a: ["create", "blocked", reason],
        c: ["create", "created", null],
    })
})

test("Automod rules split across two restore segments preview the pattern total their steps will find", async (t) => {
    const r = await restoration(t),
        all = await samples()
    // Patterns of 200 characters, so two rules of 1,000 fill most of a segment's 512 KiB and the third rule comes in the next segment
    const words = (prefix: string, count: number) =>
        Array.from({ length: count }, (_, i) => `${prefix}${i}`.padEnd(200, "z"))
    const automod = (name: string, patterns: string[]): BackupConfigObject =>
        ({
            family: "automod",
            sourceId: name,
            value: { ...(all.automod.before.value as object), name, patterns },
        }) as never
    const planned = await r.restore(
        automod("a", words("a", 1000)),
        automod("b", words("b", 1000)),
        automod("c", words("c", 600)),
    )
    const segments = (await r.db.run((ctx) => ctx.db.query("backupPlans").first()))!.segmentDigests!
    assert.equal(segments.length, 2)
    // The first segment's rules hold the server's 2,000 patterns, so the preview blocks the third rule as its step does
    const reason = "The server's automod rules would hold more than 2000 patterns together"
    const outcome = (items: BackupItem[]) =>
        Object.fromEntries(items.map((x) => [x.sourceId, [x.disposition, x.state, x.reason]]))
    assert.deepEqual(outcome(planned.items), {
        a: ["create", "planned", null],
        b: ["create", "planned", null],
        c: ["blocked", "planned", reason],
    })
    assert.deepEqual(outcome(planned.applied), {
        a: ["create", "created", null],
        b: ["create", "created", null],
        c: ["blocked", "blocked", reason],
    })
    // An update in the first segment counts what it replaces: Rule a drops from 1,000 patterns to 400 and b2 does not fit, so 200 more fit
    await r.db.run(async (ctx) => {
        for (const row of await ctx.db.query("automodRules").collect())
            if (row.name === "b") await ctx.db.delete(row._id)
    })
    const updated = await r.restore(
        automod("a", words("n", 400)),
        automod("b", words("b", 1000)),
        automod("b2", words("o", 1000)),
        automod("c", words("c", 200)),
    )
    assert.equal((await r.db.run((ctx) => ctx.db.query("backupPlans").first()))!.segmentDigests!.length, 2)
    assert.deepEqual(outcome(updated.items), {
        a: ["update", "planned", null],
        b: ["create", "planned", null],
        b2: ["blocked", "planned", reason],
        c: ["create", "planned", null],
    })
    assert.deepEqual(outcome(updated.applied), {
        a: ["update", "updated", null],
        b: ["create", "created", null],
        b2: ["blocked", "blocked", reason],
        c: ["create", "created", null],
    })
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

test("An archive without level-up messages previews as the restore leaves them, so that alone is no change", async (t) => {
    const r = await restoration(t),
        all = await samples()
    const leveling = all.leveling.before as Extract<BackupConfigObject, { family: "leveling" }>
    const { levelUp: _levelUp, ...plain } = leveling.value
    const archived: BackupConfigObject = { ...leveling, value: plain }
    // The server turned level-up messages on after the archive was made
    await r.restore({ ...leveling, value: { ...plain, levelUp: { channelId: "32", rewardsOnly: true } } })
    const same = await r.plan(r.manifest([archived]), r.proof())
    assert.deepEqual([same.items[0]!.disposition, same.items[0]!.changed ?? []], ["skip", []])
    // Another difference updates the setting and shows only that change, and the messages stay on
    const other: BackupConfigObject = { ...leveling, value: { ...plain, xpPerMessage: 30 } }
    const planned = await r.plan(r.manifest([other]), r.proof())
    assert.deepEqual([planned.items[0]!.disposition, planned.items[0]!.changed], ["update", ["xpPerMessage"]])
    await r.confirm(planned.plan)
    assert.equal((await read(await r.apply(planned.items[0]!, r.proof()))).item.state, "updated")
    const settings = (await r.db.run((ctx) => ctx.db.query("levelingSettings").first()))!.config
    assert.deepEqual([settings.xpPerMessage, settings.levelUp], [30, { channelId: "32", rewardsOnly: true }])
    assert.equal((await r.plan(r.manifest([other]), r.proof())).items[0]!.disposition, "skip")
})

test("Restoring leveling sets the archive's channels that earn XP, and an archive without them lets every channel earn again", async (t) => {
    const r = await restoration(t),
        all = await samples()
    const leveling = all.leveling.before as Extract<BackupConfigObject, { family: "leveling" }>
    const { onlyChannelIds: _only, ...plain } = leveling.value
    const listed: BackupConfigObject = { ...leveling, value: { ...plain, onlyChannelIds: ["31"] } }
    const config = async () => (await r.db.run((ctx) => ctx.db.query("levelingSettings").first()))!.config
    await r.restore({ ...leveling, value: plain })
    const planned = await r.plan(r.manifest([listed]), r.proof())
    assert.deepEqual([planned.items[0]!.disposition, planned.items[0]!.changed], ["update", ["onlyChannelIds"]])
    await r.confirm(planned.plan)
    assert.equal((await read(await r.apply(planned.items[0]!, r.proof()))).item.state, "updated")
    assert.deepEqual((await config()).onlyChannelIds, ["31"])
    // An archive from before the setting, or made while every channel earned, clears the list
    const archived: BackupConfigObject = { ...leveling, value: plain }
    const cleared = await r.plan(r.manifest([archived]), r.proof())
    assert.deepEqual([cleared.items[0]!.disposition, cleared.items[0]!.changed], ["update", ["onlyChannelIds"]])
    await r.confirm(cleared.plan)
    assert.equal((await read(await r.apply(cleared.items[0]!, r.proof()))).item.state, "updated")
    assert.equal(Object.hasOwn(await config(), "onlyChannelIds"), false)
    assert.equal((await r.plan(r.manifest([archived]), r.proof())).items[0]!.disposition, "skip")
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

test("Role picker menus that swap roles restore whole, and the restore goes on to the next item", async (t) => {
    const r = await restoration(t)
    const picker = (first: string, second: string): BackupConfigObject => ({
        family: "rolepicker",
        sourceId: "rolepicker",
        value: {
            enabled: true,
            menus: [
                { name: "colors", mode: "single", roleIds: [first] },
                { name: "pings", mode: "multi", description: "Pick", roleIds: [second] },
            ],
        },
    })
    const defaults: BackupConfigObject = {
        family: "temproles",
        sourceId: "temproles",
        value: { roles: [{ roleId: "42", defaultSeconds: 3600 }] },
    }
    await r.restore(picker("40", "41"))
    // Each menu holds the role the other one has on the server
    const swapped = await r.restore(picker("41", "40"), defaults)
    assert.deepEqual(
        swapped.applied.map((x) => [x.family, x.state]),
        [
            ["rolepicker", "updated"],
            ["temproles", "created"],
        ],
    )
    assert.deepEqual(normalized(await r.projected(picker("41", "40"))), normalized(picker("41", "40")))
})

test("A server with 45 ticket categories backs up all of them, and a restore adds one beside a category made after the plan", async (t) => {
    const r = await restoration(t),
        all = await samples()
    await r.db.run(async (ctx) => {
        for (let i = 0; i < 45; i++)
            await ctx.db.insert("ticketCategories", {
                serverId: "1",
                config: {
                    name: `old${String(i).padStart(2, "0")}`,
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
    // Categories come 20 a page, so the last five are on the third
    const snapshot = (await read(await r.snapshot(["config"]))).config as BackupConfigObject[]
    assert.deepEqual(
        snapshot.filter((x) => x.family === "ticketCategory").map((x) => x.sourceId),
        Array.from({ length: 45 }, (_, i) => `old${String(i).padStart(2, "0")}`),
    )
    const category = (name: string): BackupConfigObject => ({
        ...all.ticketCategory.before,
        sourceId: name,
        value: { ...(all.ticketCategory.before.value as object), name } as never,
    })
    const planned = await r.plan(r.manifest([category("mine")]), r.proof())
    assert.equal(planned.items[0]!.disposition, "create")
    await r.confirm(planned.plan)
    await r.db.run((ctx) =>
        ctx.db.insert("ticketCategories", {
            serverId: "1",
            config: { ...(category("theirs").value as never as Record<string, never>), revision: 99 } as never,
        }),
    )
    const applied = (await read(await r.apply(planned.items[0]!, r.proof()))).item
    assert.equal(applied.state, "created")
    assert.equal((await r.db.run((ctx) => ctx.db.query("ticketCategories").collect())).length, 47)
})

test("25 ticket categories restore to an empty server, in one segment and across two", async (t) => {
    const r = await restoration(t),
        all = await samples()
    const category = (name: string): BackupConfigObject => ({
        ...all.ticketCategory.before,
        sourceId: name,
        value: { ...(all.ticketCategory.before.value as object), name } as never,
    })
    const categories = Array.from({ length: 25 }, (_, i) => category(`c${String(i).padStart(2, "0")}`))
    // Drafts come before ticket categories, so 490 of them leave room for only ten categories in the first segment of 500
    const drafts = Array.from({ length: 490 }, (_, i): BackupConfigObject => ({
        family: "draft",
        sourceId: `draft_d${i}`,
        value: { kind: "draft", name: `d${i}`, content: { content: "x" } },
    }))
    // The dispositions of the plan's ticket categories, read from all of its items
    const dispositions = (planId: string) =>
        r.db.run(async (ctx) =>
            (await ctx.db.query("backupItems").collect())
                .filter((x) => x.planId === planId && x.family === "ticketCategory")
                .sort((a, b) => a.itemNo - b.itemNo)
                .map((x) => x.disposition),
        )
    for (const config of [categories, [...drafts, ...categories]]) {
        await r.wipe()
        const planned = await r.plan(r.manifest(config), r.proof())
        const row = await r.db.run((ctx) => ctx.db.get(planned.plan.planId as never))
        assert.equal((row as { segmentDigests: string[] }).segmentDigests.length, config.length > 500 ? 2 : 1)
        assert.deepEqual(await dispositions(planned.plan.planId), Array(25).fill("create"))
    }
})

test("600 templates export in pages and plan across two segments of settings", async (t) => {
    const f = await fixture(t)
    await f.db.run(async (ctx) => {
        await levelingState(ctx, "1")
        for (let i = 0; i < 600; i++)
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
    const config = ((await read(await f.snapshot(["config"]))).config as BackupConfigObject[]).filter(
        (x) => x.family === "draft",
    )
    assert.equal(config.length, 600)
    assert.deepEqual((await read(await f.snapshot(["xp"]))).config, [])
    const changed = config.map((x) =>
        x.family === "draft" ? { ...x, value: { ...x.value, content: { content: "y" } } } : x,
    )
    const planned = await f.plan(f.manifest(changed))
    assert.deepEqual([planned.plan.itemCount, planned.plan.counts.update], [600, 600])
    const row = await f.db.run((ctx) => ctx.db.get(planned.plan.planId as never))
    assert.equal((row as { segmentDigests: string[] }).segmentDigests.length, 2)
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
    const rank = async (planId: string) =>
        (await r.db.run((ctx) => ctx.db.query("backupItems").collect()))
            .filter((x) => x.planId === planId)
            .map((x) => x.rank)
    // The logging module is off while a route stays on, so turning the module on starts the posts
    await r.restore(metadata(true))
    await r.restore(metadata(false))
    const resume = await r.plan(r.manifest([metadata(true)]), r.proof())
    assert.deepEqual(
        [resume.items[0]!.disposition, resume.items[0]!.warning],
        ["update", "Turns on logs: membership logs go to <#30>"],
    )
    // A warned item sorts with the gains and the settings that turn on
    assert.deepEqual(await rank(resume.plan.planId), [2])
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
    // The module's item names the channels of the policies that are on, since turning it on resumes them, so a pass's proof reads them
    const asked = await read(
        await r.query({
            type: "item",
            binding: { ...binding(alone.items[0]!), itemNo: alone.items[0]!.itemNo, generation: 1 },
        }),
    )
    assert.deepEqual(asked.resumed, ["30"])
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

test("A restore adds a cleanup channel past 50, and the module names every channel it resumes", async (t) => {
    const r = await restoration(t),
        all = await samples()
    const channels = Array.from({ length: 60 }, (_, i) => String(200 + i))
    await r.db.run(async (ctx) => {
        await ctx.db.insert("cleanupSettings", {
            serverId: "1",
            enabled: false,
            revision: 1,
            policies: channels.length,
            receipts: 0,
            nextSweepNo: 1,
            nextTargetNo: 1,
        })
        for (const channelId of channels)
            await ctx.db.insert("cleanupPolicies", {
                serverId: "1",
                channelId,
                revision: 1,
                enabled: true,
                ageMs: 86400000,
                ownerId: "10",
                excludedAuthorIds: [],
                excludedMessageIds: [],
                nextCheckAt: r.now(),
            })
    })
    const module: BackupConfigObject = { family: "cleanup", sourceId: "cleanup", value: { enabled: true } }
    const checked = await r.plan(r.manifest([module, all.cleanupPolicy.before]), r.proof())
    const byFamily = Object.fromEntries(checked.items.map((x) => [x.family, x]))
    assert.deepEqual(
        [byFamily.cleanupPolicy!.disposition, byFamily.cleanupPolicy!.reason, byFamily.cleanup!.disposition],
        ["create", null, "update"],
    )
    const asked = await read(
        await r.query({
            type: "item",
            binding: { ...binding(byFamily.cleanup!), itemNo: byFamily.cleanup!.itemNo, generation: 1 },
        }),
    )
    assert.deepEqual(asked.resumed, channels)
    // The bot reads the answer through the contract, which takes as many channels as a server can have cleanup in
    assert.deepEqual(decode(BackupQueryResult, asked), asked)
    await r.confirm(checked.plan)
    assert.equal((await read(await r.apply(byFamily.cleanupPolicy!, r.proof()))).item.state, "created")
    assert.equal((await r.db.run((ctx) => ctx.db.query("cleanupSettings").first()))!.policies, 61)
})

test("A restored cleanup policy keeps thousands of exclusions, up to the server's total across its channels", async (t) => {
    const r = await restoration(t),
        all = await samples(),
        ids = (from: number, count: number) => Array.from({ length: count }, (_, i) => String(from + i))
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
            channelId: "200",
            revision: 1,
            enabled: false,
            ageMs: 86400000,
            ownerId: "10",
            excludedAuthorIds: ids(100000, 8192),
            excludedMessageIds: ids(200000, 8192),
            nextCheckAt: r.now(),
        })
    })
    const archived = (authors: number): BackupConfigObject => ({
        ...all.cleanupPolicy.before,
        value: {
            ...(all.cleanupPolicy.before.value as object),
            excludedAuthorIds: ids(300000, authors),
            excludedMessageIds: ids(400000, 1000),
        } as never,
    })
    // 3,616 more IDs fit beside the 16,384 the server keeps, one more does not
    const over = await r.plan(r.manifest([archived(2617)]), r.proof())
    assert.deepEqual(
        [over.items[0]!.disposition, over.items[0]!.reason],
        ["blocked", "A server keeps at most 20000 excluded authors and messages across its cleanup channels"],
    )
    // The step checks again, so exclusions added after the check block it
    const late = await r.plan(r.manifest([archived(2616)]), r.proof())
    assert.deepEqual([late.items[0]!.disposition, late.items[0]!.reason], ["create", null])
    await r.confirm(late.plan)
    const extra = await r.db.run((ctx) =>
        ctx.db.insert("cleanupPolicies", {
            serverId: "1",
            channelId: "201",
            revision: 1,
            enabled: false,
            ageMs: 86400000,
            ownerId: "10",
            excludedAuthorIds: ["1"],
            excludedMessageIds: [],
            nextCheckAt: r.now(),
        }),
    )
    const stepped = (await read(await r.apply(late.items[0]!, r.proof()))).item
    assert.deepEqual(
        [stepped.state, stepped.reason],
        ["blocked", "A server keeps at most 20000 excluded authors and messages across its cleanup channels"],
    )
    await r.db.run((ctx) => ctx.db.delete(extra))
    const fits = await r.plan(r.manifest([archived(2616)]), r.proof())
    await r.confirm(fits.plan)
    assert.equal((await read(await r.apply(fits.items[0]!, r.proof()))).item.state, "created")
    const restored = await r.db.run(async (ctx) =>
        (await ctx.db.query("cleanupPolicies").collect()).find((x) => x.channelId === "30"),
    )
    assert.deepEqual([restored!.excludedAuthorIds.length, restored!.excludedMessageIds.length], [2616, 1000])
})

const calendarAt = (at: number) => ({
    localMinute: new Date(at).toISOString().slice(0, 16),
    zone: "UTC",
    fold: "reject" as const,
    recurrence: { type: "none" as const },
})
const eventValue = (name: string, at: number) => ({
    name,
    channelId: "30",
    title: "Synthetic event",
    description: "",
    capacity: null,
    reminderOffsets: [1440, 60],
    calendar: {
        ...calendarAt(at),
        durationMinutes: 60,
        dates: [
            {
                localMinute: new Date(at).toISOString().slice(0, 16),
                startsAt: at,
                endsAt: at + 3600000,
                offsetMinutes: 0,
            },
        ],
    },
})
const scheduleValue = (name: string, at: number) => ({
    name,
    channelId: "30",
    calendar: {
        ...calendarAt(at),
        dates: [{ localMinute: new Date(at).toISOString().slice(0, 16), dueAt: at, offsetMinutes: 0 }],
    },
    source: { kind: "draft" as const, name: "probe", revision: 1 },
    content: { content: "Synthetic scheduled post" },
    enabled: true,
})
// The fixture's clock starts on 2026-01-01, so one date lies ahead of it and the other passed
const aheadAt = Date.parse("2026-01-10T12:00:00Z"),
    passedAt = Date.parse("2025-12-20T12:00:00Z")

test("An event restores as a draft that keeps its dates only while they are ahead, and a published event is left alone", async (t) => {
    const r = await restoration(t)
    const event = (value: ReturnType<typeof eventValue>): BackupConfigObject => ({
        family: "event",
        sourceId: value.name,
        value,
    })
    const ahead = await r.restore(event(eventValue("ahead", aheadAt)))
    assert.deepEqual([ahead.items[0]!.disposition, ahead.applied[0]!.state], ["create", "created"])
    const passed = await r.restore(event(eventValue("passed", passedAt)))
    assert.deepEqual(
        [passed.items[0]!.disposition, passed.items[0]!.warning, passed.applied[0]!.state],
        ["create", "Its dates passed, so it returns as a draft without a date", "created"],
    )
    const rows = await r.db.run(async (ctx) => ({
        events: await ctx.db.query("events").collect(),
        occurrences: await ctx.db.query("eventOccurrences").collect(),
        rsvps: await ctx.db.query("eventRsvps").collect(),
    }))
    assert.deepEqual(
        rows.events.map((row) => [row.name, row.state, row.calendar?.dates.length ?? 0, row.cardPostNo]),
        [
            ["ahead", "draft", 1, undefined],
            ["passed", "draft", 0, undefined],
        ],
    )
    assert.deepEqual(
        rows.occurrences.map((row) => [row.eventNo, row.state]),
        [[rows.events[0]!.eventNo, "draft"]],
    )
    assert.deepEqual(rows.rsvps, [])
    // An event members can see and answer is not a draft, so a restore that would change it leaves it as it is
    await r.db.run(async (ctx) => {
        const row = (await ctx.db.query("events").first())!
        await ctx.db.patch(row._id, { state: "open" })
    })
    const blocked = await r.restore(event({ ...eventValue("ahead", aheadAt), title: "Synthetic changed event" }))
    assert.equal(blocked.items[0]!.disposition, "blocked")
    assert.match(blocked.items[0]!.reason!, /published, cancelled or being forgotten/)
})

test("An archived event holds no live progress, such as its next or last skipped date", () => {
    const value = eventValue("ahead", aheadAt)
    backupConfig({ family: "event", sourceId: "ahead", value })
    for (const extra of [
        { lastSkipped: { localMinute: "2026-03-29T02:30", reason: "gap" } },
        { resume: { localMinute: "2026-01-17T12:00" } },
    ])
        assert.throws(() =>
            backupConfig({ family: "event", sourceId: "ahead", value: { ...value, ...extra } as never }),
        )
})

test("A schedule restores on only while every date is ahead, paused otherwise, and a cancelled one blocks", async (t) => {
    const r = await restoration(t)
    const schedule = (value: ReturnType<typeof scheduleValue>): BackupConfigObject => ({
        family: "schedule",
        sourceId: value.name,
        value,
    })
    const ahead = await r.restore(schedule(scheduleValue("ahead", aheadAt)))
    assert.deepEqual(
        [ahead.items[0]!.disposition, ahead.items[0]!.on, ahead.items[0]!.warning, ahead.applied[0]!.state],
        ["create", true, "Turns on scheduled posts: they go to <#30> on its dates", "created"],
    )
    const passed = await r.restore(schedule(scheduleValue("passed", passedAt)))
    assert.deepEqual(
        [passed.items[0]!.on, passed.items[0]!.warning, passed.applied[0]!.state],
        [undefined, "Its dates passed, so it returns paused. Give it new dates, then turn it on", "created"],
    )
    const rows = await r.db.run(async (ctx) => ({
        schedules: await ctx.db.query("schedules").collect(),
        deliveries: await ctx.db.query("scheduleDeliveries").collect(),
    }))
    assert.deepEqual(
        rows.schedules.map((row) => [row.name, row.enabled, row.createdBy]),
        [
            ["ahead", true, "10"],
            ["passed", false, "10"],
        ],
    )
    // Only the date ahead is planned, so a paused schedule never posts for a date that passed
    assert.deepEqual(
        rows.deliveries.map((row) => [row.scheduleNo, row.dueAt]),
        [[rows.schedules[0]!.scheduleNo, aheadAt]],
    )
    await r.db.run(async (ctx) => {
        const row = (await ctx.db.query("schedules").first())!
        await ctx.db.patch(row._id, { cancelled: true, enabled: false })
    })
    const blocked = await r.restore(schedule(scheduleValue("ahead", aheadAt)))
    assert.equal(blocked.items[0]!.disposition, "blocked")
    assert.match(blocked.items[0]!.reason!, /cancelled schedule stays cancelled/)
})

test("A repeating event or schedule whose first dates passed restores from its next date, and one with no date left without dates", async (t) => {
    const r = await restoration(t)
    // Weekly from 2025-12-20, so with the fixture's clock on 2026-01-01 two dates passed and two lie ahead, 2026-01-03 and 2026-01-10
    const week = 7 * 86400000,
        minute = (at: number) => new Date(at).toISOString().slice(0, 16),
        firsts = (count: number) => Array.from({ length: count }, (_, i) => passedAt + i * week),
        repeat = (count: number) => ({
            ...calendarAt(passedAt),
            recurrence: { type: "weekly" as const, interval: 1, count },
        })
    const event = (name: string, count: number): BackupConfigObject => ({
            family: "event",
            sourceId: name,
            value: {
                ...eventValue(name, passedAt),
                calendar: {
                    ...repeat(count),
                    durationMinutes: 60,
                    dates: firsts(count).map((at) => ({
                        localMinute: minute(at),
                        startsAt: at,
                        endsAt: at + 3600000,
                        offsetMinutes: 0,
                    })),
                },
            },
        }),
        schedule = (name: string, count: number): BackupConfigObject => ({
            family: "schedule",
            sourceId: name,
            value: {
                ...scheduleValue(name, passedAt),
                calendar: {
                    ...repeat(count),
                    dates: firsts(count).map((at) => ({ localMinute: minute(at), dueAt: at, offsetMinutes: 0 })),
                },
            },
        })
    const running = await r.restore(event("running", 4), schedule("running", 4))
    assert.deepEqual(
        running.items.map((x) => [x.disposition, x.warning]),
        [
            ["create", "Dates that passed are left out, so it returns as a draft from 2026-01-03 12:00 UTC"],
            [
                "create",
                "Turns on scheduled posts: they go to <#30> from 2026-01-03 12:00 UTC, and dates that passed are left out",
            ],
        ],
    )
    assert.deepEqual(
        running.applied.map((x) => x.state),
        ["created", "created"],
    )
    const ahead = [passedAt + 2 * week, passedAt + 3 * week]
    const rows = await r.db.run(async (ctx) => ({
        event: (await ctx.db.query("events").first())!,
        occurrences: await ctx.db.query("eventOccurrences").collect(),
        rsvps: await ctx.db.query("eventRsvps").collect(),
        schedule: (await ctx.db.query("schedules").first())!,
        deliveries: await ctx.db.query("scheduleDeliveries").collect(),
    }))
    // The repeat goes on from its next date with the two dates left, as a draft event and a schedule that is on
    assert.deepEqual(
        [rows.event.state, rows.event.calendar?.localMinute, rows.event.calendar?.recurrence, rows.event.cardPostNo],
        ["draft", "2026-01-03T12:00", { type: "weekly", interval: 1, count: 2 }, undefined],
    )
    assert.deepEqual(
        rows.occurrences.map((x) => [x.state, x.date.startsAt]),
        ahead.map((at) => ["draft", at]),
    )
    assert.deepEqual(rows.rsvps, [])
    assert.deepEqual(
        [rows.schedule.enabled, rows.schedule.calendar.localMinute, rows.schedule.calendar.recurrence],
        [true, "2026-01-03T12:00", { type: "weekly", interval: 1, count: 2 }],
    )
    // Nothing is planned for a date that passed, so nothing is ever posted for one
    assert.deepEqual(
        rows.deliveries.map((x) => x.dueAt),
        ahead,
    )
    // A repeat whose counted dates have all passed has nothing to go on with
    const ended = await r.restore(event("ended", 2), schedule("ended", 2))
    assert.deepEqual(
        ended.items.map((x) => [x.disposition, x.warning]),
        [
            ["create", "Its dates passed, so it returns as a draft without a date"],
            ["create", "Its dates passed, so it returns paused. Give it new dates, then turn it on"],
        ],
    )
})

test("A restored repeat leaves out a reminder further ahead than its stored dates reach and says so, as !event and the dashboard refuse it", async (t) => {
    const r = await restoration(t)
    const day = 86400000,
        minute = (at: number) => new Date(at).toISOString().slice(0, 16)
    // Daily for 40 dates stores the next 26, so a reminder comes at most 25 days before a date
    const reach = 25 * 1440,
        left =
            "Reminders more than 25 days before a date are left out, since NeonFlux stores this repeat's dates only that far ahead"
    const event = (name: string, start: number, reminderOffsets: number[]): BackupConfigObject => ({
        family: "event",
        sourceId: name,
        value: {
            ...eventValue(name, start),
            reminderOffsets,
            calendar: {
                ...calendarAt(start),
                recurrence: { type: "daily", interval: 1, count: 40 },
                durationMinutes: 60,
                dates: Array.from({ length: 26 }, (_, i) => start + i * day).map((at) => ({
                    localMinute: minute(at),
                    startsAt: at,
                    endsAt: at + 3600000,
                    offsetMinutes: 0,
                })),
            },
        },
    })
    const restored = await r.restore(event("ahead", aheadAt, [60, reach, reach + 1, 50000]))
    assert.deepEqual(
        restored.items.map((x) => [x.disposition, x.warning, x.changed]),
        [["create", left, undefined]],
    )
    assert.deepEqual(
        restored.applied.map((x) => x.state),
        ["created"],
    )
    const offsets = () =>
        r.db.run(async (ctx) => (await ctx.db.query("events").collect()).map((x) => x.reminderOffsets))
    assert.deepEqual(await offsets(), [[reach, 60]])
    // Reminders the rule allows restore as they are, without a warning
    const fits = await r.restore(event("fits", aheadAt, [60, reach]))
    assert.deepEqual(
        fits.items.map((x) => [x.disposition, x.warning]),
        [["create", undefined]],
    )
    // A repeat whose first dates passed says both, and the dates left still store 26 ahead
    const running = await r.restore(event("running", passedAt, [60, 50000]))
    assert.deepEqual(
        running.items.map((x) => [x.disposition, x.warning]),
        [["create", `Dates that passed are left out, so it returns as a draft from 2026-01-01 12:00 UTC. ${left}`]],
    )
    assert.deepEqual(await offsets(), [[reach, 60], [reach, 60], [60]])
})

test("Retained cancelled events and schedules beyond fifty rows back up in pages and restore, and stay out of the archive", async (t) => {
    const r = await restoration(t)
    const event: BackupConfigObject = { family: "event", sourceId: "ahead", value: eventValue("ahead", aheadAt) },
        schedule: BackupConfigObject = {
            family: "schedule",
            sourceId: "ahead",
            value: scheduleValue("ahead", aheadAt),
        }
    await r.restore(event)
    await r.restore(schedule)
    // 120 more of each with distinct names and numbers, more than a snapshot page, of which the first is cancelled and the rest live
    await r.db.run(async (ctx) => {
        const { _id, _creationTime, ...e } = (await ctx.db.query("events").first())!,
            { _id: _sid, _creationTime: _st, ...d } = (await ctx.db.query("schedules").first())!
        for (let i = 0; i < 120; i++) {
            await ctx.db.insert("events", {
                ...e,
                name: `e${i}`,
                eventNo: 100 + i,
                ...(i === 0 ? { state: "cancelled" as const } : {}),
            })
            await ctx.db.insert("schedules", {
                ...d,
                name: `s${i}`,
                scheduleNo: 100 + i,
                ...(i === 0 ? { cancelled: true, enabled: false } : {}),
            })
        }
    })
    const names: Record<string, string[]> = { event: [], schedule: [] }
    for (const x of (await read(await r.snapshot(["config"]))).config as BackupConfigObject[])
        if (x.family === "event" || x.family === "schedule") names[x.family]!.push(x.value.name)
    assert.equal(names.event!.length, 120)
    assert.equal(names.schedule!.length, 120)
    assert.equal(names.event!.includes("e0"), false)
    assert.equal(names.schedule!.includes("s0"), false)
    // A restore compares each one with the row of its name
    const changed = await r.restore(
        { ...event, value: { ...(event.value as object), title: "Synthetic changed event" } as never },
        { ...schedule, value: { ...(schedule.value as object), content: { content: "Changed" } } as never },
    )
    assert.deepEqual(
        changed.items.map((x) => [x.family, x.disposition]),
        [
            ["event", "update"],
            ["schedule", "update"],
        ],
    )
})

test("Events and schedules that ended before they stopped counting leave room for a restored one", async (t) => {
    const r = await restoration(t)
    const first: BackupConfigObject[] = [
        { family: "event", sourceId: "ahead", value: eventValue("ahead", aheadAt) },
        { family: "schedule", sourceId: "ahead", value: scheduleValue("ahead", aheadAt) },
    ]
    await r.restore(...first)
    // The old rule cancelled definitions without releasing them, so 49 cancelled rows still fill the counters up to 50
    await r.db.run(async (ctx) => {
        const { _id, _creationTime, ...e } = (await ctx.db.query("events").first())!,
            { _id: _sid, _creationTime: _st, ...d } = (await ctx.db.query("schedules").first())!
        for (let i = 0; i < 49; i++) {
            await ctx.db.insert("events", {
                ...e,
                name: `e${i}`,
                eventNo: e.eventNo + 1 + i,
                state: "cancelled" as const,
            })
            await ctx.db.insert("schedules", {
                ...d,
                name: `s${i}`,
                scheduleNo: d.scheduleNo + 1 + i,
                cancelled: true,
                enabled: false,
            })
        }
        for (const table of ["eventSettings", "scheduleSettings"] as const) {
            const state = (await ctx.db.query(table).first())!
            await ctx.db.patch(state._id, { definitions: 50 })
        }
    })
    const restored = await r.restore(
        { family: "event", sourceId: "fresh", value: eventValue("fresh", aheadAt) },
        { family: "schedule", sourceId: "fresh", value: scheduleValue("fresh", aheadAt) },
    )
    assert.deepEqual(
        restored.items.map((x) => [x.family, x.disposition]),
        [
            ["event", "create"],
            ["schedule", "create"],
        ],
    )
    assert.deepEqual(
        restored.applied.map((x) => x.state),
        ["created", "created"],
    )
})

test("A finished schedule that a restore starts again takes a place, and one with no place left is blocked while the restore goes on", async (t) => {
    const r = await restoration(t)
    const schedule = (name: string, text = "Synthetic scheduled post"): BackupConfigObject => ({
        family: "schedule",
        sourceId: name,
        value: { ...scheduleValue(name, aheadAt), content: { content: text } },
    })
    const prefix: BackupConfigObject = {
        family: "general",
        sourceId: "general",
        value: { prefix: "?", replyStyle: "text" },
    }
    const full = "The server has reached its limit of 50 schedules"
    await r.restore(schedule("done"), schedule("other"))
    // Both ran out of dates and stopped counting, and live schedules hold the server's other places, which leaves free
    const places = (free: number) =>
        r.db.run(async (ctx) => {
            const rows = await ctx.db.query("schedules").collect()
            for (const row of rows)
                if (row.name === "done" || row.name === "other") await ctx.db.patch(row._id, { released: true })
                else await ctx.db.delete(row._id)
            const { _id, _creationTime, released: _released, ...d } = rows[0]!
            for (let i = 0; i < 50 - free; i++)
                await ctx.db.insert("schedules", { ...d, name: `live${i}`, scheduleNo: 100 + i, extendAt: aheadAt })
            const state = (await ctx.db.query("scheduleSettings").first())!
            await ctx.db.patch(state._id, { definitions: 50 - free })
        })
    const counted = () => r.db.run(async (ctx) => (await ctx.db.query("scheduleSettings").first())!.definitions)
    await places(0)
    const none = await r.restore(schedule("done", "Again"), prefix)
    assert.deepEqual(
        none.applied.map((x) => [x.family, x.state, x.reason]),
        [
            ["schedule", "blocked", full],
            ["general", "created", null],
        ],
    )
    assert.equal(await counted(), 50)
    // With one place free the first starts again in it, and the second has none left, in one segment and across two
    await places(1)
    const drafts = Array.from({ length: 499 }, (_, i): BackupConfigObject => ({
        family: "draft",
        sourceId: `draft_d${i}`,
        value: { kind: "draft", name: `d${i}`, content: { content: "x" } },
    }))
    for (const config of [[], drafts]) {
        await r.wipe()
        const planned = await r.plan(
            r.manifest([...config, schedule("done", "Again"), schedule("other", "Again")]),
            r.proof(),
        )
        const row = await r.db.run((ctx) => ctx.db.get(planned.plan.planId as never))
        assert.equal((row as { segmentDigests: string[] }).segmentDigests.length, config.length ? 2 : 1)
        const items = await r.db.run(async (ctx) =>
            (await ctx.db.query("backupItems").collect())
                .filter((x) => x.planId === planned.plan.planId && x.family === "schedule")
                .map((x) => [x.sourceId, x.disposition, x.reason]),
        )
        assert.deepEqual(items, [
            ["done", "update", null],
            ["other", "blocked", full],
        ])
    }
    const restarted = await r.restore(schedule("done", "Again"), schedule("other", "Again"), prefix)
    assert.deepEqual(
        restarted.applied.map((x) => [x.sourceId, x.state]),
        [
            ["done", "updated"],
            ["other", "blocked"],
            ["general", "skipped"],
        ],
    )
    assert.equal(await counted(), 50)
    // A place taken after the check is found again when the step runs, which blocks the schedule and goes on
    await places(1)
    await r.wipe()
    const planned = await r.plan(
        r.manifest([schedule("done", "Later"), { ...prefix, value: { prefix: "$", replyStyle: "text" } }]),
        r.proof(),
    )
    assert.deepEqual(
        planned.items.map((x) => x.disposition),
        ["update", "update"],
    )
    await r.confirm(planned.plan)
    await r.db.run(async (ctx) => {
        const state = (await ctx.db.query("scheduleSettings").first())!
        await ctx.db.patch(state._id, { definitions: 50 })
    })
    const late = []
    for (const item of planned.items) late.push((await read(await r.apply(item, r.proof()))).item as BackupItem)
    assert.deepEqual(
        late.map((x) => [x.family, x.state, x.reason]),
        [
            ["schedule", "blocked", full],
            ["general", "updated", null],
        ],
    )
})

test("Archived channel places that differ from the server make one order item, whose claim grants the fewest moves", async (t) => {
    const f = await fixture(t)
    // The server lists general, rules and news in this order, and the archive had news first
    const at = (sourceId: string, position: number): BackupStructureObject => ({
        ...f.channel(sourceId),
        name: { "101": "general", "102": "rules", "103": "news" }[sourceId]!,
        position,
    })
    const archived = [at("101", 1), at("102", 2), at("103", 0)],
        live = archived.map(({ position: _position, ...channel }) => channel)
    const proof = () =>
        f.proof(
            [],
            [],
            live.map((x) => f.seen(x)),
            live.map((x) => f.listing(x)),
        )
    const planned = await f.plan(f.manifest([], [], archived), proof())
    assert.equal(planned.plan.itemCount, 4)
    const order = planned.items.find((item) => item.order)!
    assert.deepEqual(
        [order.itemNo, order.disposition, order.sourceId, order.changed],
        [4, "update", "order", ["order"]],
    )
    const changes = (
        await read(
            await f.http("/backup/query", {
                serverId: "1",
                context: f.context(),
                operation: { type: "item", binding: { ...binding(order), itemNo: order.itemNo, generation: 1 } },
            }),
        )
    ).item
    assert.equal(changes.order, true)
    await f.confirm(planned.plan)
    for (const item of planned.items.filter((x) => !x.order))
        assert.equal((await read(await f.apply(item, proof()))).item.state, "skipped")
    const claimed = await read(await f.claim(order, proof()))
    assert.deepEqual(claimed.grant.moves, [{ id: "103", parentId: null, precedingSiblingId: null }])
    assert.equal(claimed.grant.action, "order")
    const done = await read(await f.outcome(order, "updated"))
    assert.equal(done.item.state, "updated")
    // Its audit entry's Details hold the moves the restore check showed
    const audit = await f.db.run(async (ctx) => {
        const entry = (await ctx.db.query("auditLogEntries").order("desc").first())!,
            detail = await ctx.db
                .query("auditLogChanges")
                .withIndex("by_entry", (q) => q.eq("entryId", entry._id))
                .unique(),
            shown = await ctx.db
                .query("backupChanges")
                .withIndex("by_plan", (q) => q.eq("planId", planned.plan.planId as never))
                .collect()
        return {
            setting: entry.setting,
            detail: entry.detail,
            changes: detail?.changes,
            shown: shown.find((x) => x.itemNo === order.itemNo)?.changes,
        }
    })
    assert.deepEqual(audit, {
        setting: "restore channel order",
        detail: true,
        changes: [{ path: "order.news", before: "after rules", after: "first" }],
        shown: [{ kind: "field", path: "order.news", before: "after rules", after: "first" }],
    })
    // Once the server has the archive's order, a new check has nothing to move and makes no order item
    const now = [live[2]!, live[0]!, live[1]!]
    const again = await f.plan(
        f.manifest([], [], archived),
        f.proof(
            [],
            [],
            now.map((x) => f.seen(x)),
            now.map((x) => f.listing(x)),
        ),
    )
    assert.equal(again.plan.itemCount, 3)
    assert(!again.items.some((item) => item.order))
})
