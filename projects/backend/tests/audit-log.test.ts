import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { api, internal } from "../convex/_generated/api.js"
import type { DashboardAuditPage } from "../dashboard-contracts.js"
import { AUDIT_RETENTION_MS, auditChanges, describeChange, operationLabel, recordAudit } from "../convex/auditLog.ts"
import { RETENTION_PASSES } from "../convex/retention.ts"
import { backupWriteConfig } from "../convex/backupWrites.ts"
import { convexBackend } from "./convex-backend.ts"
import { botCall } from "./bot-service.ts"

const keys = ["NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_ID", "NEONFLUX_BOT_API_SECRET", "FLUXER_CLIENT_ID"] as const
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
const start = Date.parse("2026-01-01T00:00:00Z")
let now = start
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.FLUXER_CLIENT_ID = "30"
    process.env.NEONFLUX_BOT_API_SECRET = "synthetic-audit-log-secret-00000000000000000000"
    now = start
    mock.method(Date, "now", () => now)
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === "https://fluxer.app/.well-known/fluxer")
            return Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
        if (url.endsWith("/v1/oauth2/@me"))
            return Response.json({
                application: { id: "30" },
                scopes: ["identify", "guilds"],
                user: { id: "20", username: "Manager", bot: false, system: false },
            })
        if (url.endsWith("/v1/users/@me/guilds?limit=100"))
            return Response.json([{ id: "10", name: "Synthetic server", owner_id: "99", permissions: "32" }])
        throw new Error("Unexpected synthetic provider request")
    })
})
afterEach(() => {
    mock.restoreAll()
    mock.timers.reset()
    for (const key of keys) {
        if (original[key] === undefined) delete process.env[key]
        else process.env[key] = original[key]
    }
})

const modules = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")],
    ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const manager = {
    originServerId: "10",
    userId: "20",
    roleIds: [],
    isOwner: false,
    isAdministrator: false,
    nativePermissionAuthorized: true,
}
async function fixture() {
    const t = convexBackend(modules),
        session = await t.action(api.dashboard.admit, { accessToken: "synthetic-audit-provider-token" })
    const args = { sessionToken: session.sessionToken, serverId: "10" }
    const page = (extra: { feature?: string; cursor?: string | null } = {}): Promise<DashboardAuditPage> =>
        t.query(api.auditLog.page, { ...args, cursor: null, ...extra })
    const detail = (entryId: string, serverId = "10") => t.query(api.auditLog.entry, { ...args, serverId, entryId })
    return { t, args, page, detail }
}
// Credential fields of stored rows. None may ever appear in a stored detail
const CREDENTIALS = ["accessToken", "tokenHash", "secret", "callbackToken", "claimToken", "leaseToken"]
const credentialFree = async (t: Awaited<ReturnType<typeof fixture>>["t"]) => {
    const stored = JSON.stringify(await t.run((ctx) => ctx.db.query("auditLogChanges").collect()))
    for (const name of CREDENTIALS) assert.ok(!stored.includes(`"${name}"`) && !stored.includes(`.${name}`), name)
}

test("Website and command setting changes record who changed what, newest first, with every value in Details", async () => {
    const { t, args, page, detail } = await fixture()
    const job = await t.action(api.dashboardConfiguration.queue, {
        ...args,
        family: "leveling",
        operation: { type: "settings", expectedRevision: 1, patch: { xpPerMessage: 25 } },
        expectedConfigRevision: 0,
        requestId: "00000000-0000-4000-8000-000000000001",
    })
    const executed = await botCall(t, "/dashboard-configuration/execute", {
        serverId: "10",
        originServerId: "10",
        jobId: job.jobId,
        actorId: "20",
        managerAuthorized: true,
        observedAt: now,
        actor: manager,
    })
    assert.equal(executed.status, 200)
    const create = {
        serverId: "10",
        messageId: "1000",
        createdAt: now,
        actorId: "99",
        adminAuthorized: true,
        kind: "custom",
        operation: { type: "create", name: "rules", reply: { type: "text", text: "Synthetic authored reply" } },
    }
    await t.mutation(internal.responses.manage, { request: create })
    // A redelivered command changes nothing and records nothing
    assert.deepEqual(await t.mutation(internal.responses.manage, { request: create }), { duplicate: true })
    await t.mutation(internal.generalSettings.manage, {
        request: { serverId: "10", actorId: "99", managerAuthorized: true, expectedRevision: 0, prefix: "?" },
    })
    assert.deepEqual(
        await t.action(api.dashboard.save, { ...args, section: "general", expectedRevision: 1, prefix: "$" }),
        { saved: true, revision: 2 },
    )
    await t.mutation(internal.analytics.manage, {
        request: { serverId: "10", actorId: "99", managerAuthorized: true, enabled: false },
    })

    const entries = (await page()).entries.map(({ source, actorId, actorName, feature, setting, summary, kind }) => ({
        source,
        actorId,
        actorName,
        feature,
        setting,
        summary,
        kind,
    }))
    assert.deepEqual(entries, [
        {
            source: "command",
            actorId: "99",
            actorName: undefined,
            feature: "analytics",
            setting: "switch",
            summary: "enabled: on → off",
            kind: "setting",
        },
        {
            source: "website",
            actorId: "20",
            actorName: "Manager",
            feature: "prefix",
            setting: "prefix",
            summary: "prefix: ? → $",
            kind: "setting",
        },
        {
            source: "command",
            actorId: "99",
            actorName: undefined,
            feature: "prefix",
            setting: "prefix",
            summary: "prefix: ! → ?",
            kind: "setting",
        },
        {
            source: "command",
            actorId: "99",
            actorName: undefined,
            feature: "responses",
            setting: "create rules",
            summary: "definitions: added custom:rules",
            kind: "setting",
        },
        {
            source: "website",
            actorId: "20",
            actorName: "Manager",
            feature: "leveling",
            setting: "settings",
            summary: "xpPerMessage: 15 → 25",
            kind: "setting",
        },
    ])
    assert.deepEqual(
        (await page({ feature: "prefix" })).entries.map((entry) => entry.source),
        ["website", "command"],
    )
    // The page stays short and holds no values. Details show every changed value, authored text included
    const listed = (await page()).entries
    assert.ok(!JSON.stringify(listed).includes("Synthetic authored reply"))
    assert.deepEqual(
        listed.map((entry) => entry.detail),
        [true, true, true, true, true],
    )
    const [analytics, website, , created, leveling] = await Promise.all(listed.map((entry) => detail(entry.id)))
    assert.deepEqual(analytics, { changes: [{ path: "enabled", before: true, after: false }], more: 0 })
    assert.deepEqual(website, { changes: [{ path: "prefix", before: "?", after: "$" }], more: 0 })
    assert.deepEqual(leveling!.changes, [{ path: "xpPerMessage", before: 15, after: 25 }])
    assert.ok(
        created!.changes.some(
            (change) =>
                change.path === "definitions[custom:rules].reply.text" &&
                !("before" in change) &&
                change.after === "Synthetic authored reply",
        ),
    )
    assert.ok(!created!.changes.some((change) => /revision|updatedAt|_id|_creationTime/.test(change.path)))
    await credentialFree(t)
})

test("Change summaries name the warning limit's switch and values", () => {
    assert.equal(
        describeChange(
            { settings: { warningPenaltyEnabled: false, warningPenaltyCount: 3 } },
            { settings: { warningPenaltyEnabled: true, warningPenaltyCount: 5 } },
        ),
        "warningPenaltyEnabled: off → on; warningPenaltyCount: 3 → 5",
    )
})
test("Change summaries cover every custom command, which the website reads in one page", async () => {
    const { t, page } = await fixture()
    let messageId = 1000
    const manage = (operation: Record<string, unknown>) =>
        t.mutation(internal.responses.manage, {
            request: {
                serverId: "10",
                messageId: String(messageId++),
                createdAt: now,
                actorId: "99",
                adminAuthorized: true,
                kind: "custom",
                operation,
            },
        })
    const reply = { type: "text", text: "Synthetic reply" }
    for (let index = 1; index <= 21; index++)
        await manage({ type: "create", name: `b${String(index).padStart(2, "0")}`, reply })
    await manage({ type: "create", name: "a01", reply })
    await manage({ type: "disable", name: "b21" })
    assert.deepEqual(
        (await page()).entries.slice(0, 2).map((entry) => entry.summary),
        ["definitions: changed custom:b21", "definitions: added custom:a01"],
    )
})

test("Change summaries cover paged lists longer than one dashboard page", async () => {
    const { t, page } = await fixture()
    let messageId = 1000
    const manage = (operation: Record<string, unknown>) =>
        t.mutation(internal.moderation.manage, {
            request: {
                serverId: "10",
                messageId: String(messageId++),
                createdAt: now,
                actor: { ...manager, userId: "99", isOwner: true },
                operation,
            },
        })
    const rule = (name: string) => ({
        name,
        type: "words",
        enabled: true,
        priority: 0,
        action: "warn",
        threshold: 1,
        windowSeconds: 10,
        durationSeconds: 900,
        patterns: ["blocked"],
        domainMode: "block",
        channelIds: [],
        exemptChannelIds: [],
        exemptRoleIds: [],
    })
    for (let index = 1; index <= 21; index++)
        await manage({ type: "rule-create", rule: rule(`b${String(index).padStart(2, "0")}`) })
    await manage({ type: "rule-create", rule: rule("aaa") })
    await manage({ type: "rule-update", name: "b21", patch: { threshold: 2 } })
    assert.deepEqual(
        (await page()).entries.slice(0, 2).map((entry) => entry.summary),
        ["rules: changed b21", "rules: added aaa"],
    )
})

test("A change to a watchlist entry past the first 1,000 has Details with its reasons, from an update and a removal", async () => {
    const { t, page, detail } = await fixture()
    let messageId = 2000
    const manage = (operation: Record<string, unknown>) =>
        t.mutation(internal.moderation.manage, {
            request: {
                serverId: "10",
                messageId: String(messageId++),
                createdAt: now,
                actor: { ...manager, userId: "99", isOwner: true },
                operation,
            },
        })
    // 1,001 entries, so the last one sorts after the first 1,000 the audit view reads of a list
    const userIds = Array.from({ length: 1001 }, (_, index) => String(5000000 + index))
    await t.run(async (ctx) => {
        for (const userId of userIds)
            await ctx.db.insert("securityWatchlist", {
                serverId: "10",
                userId,
                reason: "Seeded reason",
                createdAt: now,
            })
    })
    const last = userIds.at(-1)!
    await manage({ type: "watchlist-add", userId: last, reason: "New reason" })
    await manage({ type: "watchlist-remove", userId: last })
    const [removed, updated] = (await page()).entries
    assert.deepEqual(
        [updated?.setting, updated?.detail, removed?.setting, removed?.detail],
        [`watchlist-add ${last}`, true, `watchlist-remove ${last}`, true],
    )
    assert.deepEqual(await detail(updated!.id), {
        changes: [{ path: `watchlist[${last}].reason`, before: "Seeded reason", after: "New reason" }],
        more: 0,
    })
    assert.deepEqual(await detail(removed!.id), {
        changes: [
            { path: `watchlist[${last}].reason`, before: "New reason" },
            { path: `watchlist[${last}].userId`, before: last },
        ],
        more: 0,
    })
    assert.deepEqual([updated?.summary, removed?.summary], [`watchlist: changed ${last}`, `watchlist: removed ${last}`])
})

test("Creating and changing a draft past the first 1,000 has Details, as other long lists read by key do", async () => {
    const { t, page, detail } = await fixture()
    let messageId = 3000
    const manage = (operation: Record<string, unknown>) =>
        t.mutation(internal.publishing.manage, {
            request: {
                serverId: "10",
                messageId: String(messageId++),
                createdAt: now,
                actor: { ...manager, userId: "99", isOwner: true },
                operation,
            },
        })
    await t.run(async (ctx) => {
        for (let index = 0; index < 1000; index++)
            await ctx.db.insert("publishingDrafts", {
                serverId: "10",
                kind: "draft",
                name: `d${String(index).padStart(4, "0")}`,
                revision: 1,
                content: { content: "Seeded" },
                canonicalContent: { content: "Seeded" },
                createdAt: now,
                updatedAt: now,
            })
    })
    await manage({ type: "draft-create", kind: "draft", name: " D9999 ", content: { content: "First" } })
    await manage({
        type: "draft-update",
        kind: "draft",
        name: "d9999",
        expectedRevision: 1,
        edit: { type: "content", content: "Second" },
    })
    const [changed, created] = (await page()).entries
    assert.ok(
        (await detail(created!.id))!.changes.some(
            (change) => change.path.endsWith(".content") && change.after === "First",
        ),
    )
    assert.deepEqual(
        (await detail(changed!.id))!.changes.filter((change) => change.path.endsWith(".content")),
        [
            { path: "drafts[draft:d9999].canonicalContent.content", before: "First", after: "Second" },
            { path: "drafts[draft:d9999].content.content", before: "First", after: "Second" },
        ],
    )
})

test("Cloning a draft into a template of the same name, and back, records only the new copy in Details", async () => {
    const { t, page, detail } = await fixture()
    let messageId = 4000
    const manage = (operation: Record<string, unknown>) =>
        t.mutation(internal.publishing.manage, {
            request: {
                serverId: "10",
                messageId: String(messageId++),
                createdAt: now,
                actor: { ...manager, userId: "99", isOwner: true },
                operation,
            },
        })
    await manage({ type: "draft-create", kind: "draft", name: "example", content: { content: "Hello" } })
    await manage({
        type: "draft-clone",
        kind: "draft",
        name: "example",
        expectedRevision: 1,
        toKind: "template",
        toName: "example",
    })
    await manage({ type: "draft-create", kind: "template", name: "card", content: { content: "Card" } })
    await manage({
        type: "draft-clone",
        kind: "template",
        name: "card",
        expectedRevision: 1,
        toKind: "draft",
        toName: "card",
    })
    const [back, , cloned] = (await page()).entries
    for (const [entry, to] of [
        [cloned, "template:example"],
        [back, "draft:card"],
    ] as const) {
        const changes = (await detail(entry!.id))!.changes
        assert.ok(changes.length)
        assert.deepEqual(
            changes.filter((change) => "before" in change || !change.path.startsWith(`drafts[${to}].`)),
            [],
        )
        assert.ok(changes.some((change) => change.path === `drafts[${to}].name`))
    }
    assert.deepEqual([cloned?.summary, back?.summary], ["drafts: added template:example", "drafts: added draft:card"])
})

test("The reply style changes from chat and the website at the prefix's revision, recording only the setting that changed", async () => {
    const { t, args, page } = await fixture()
    await t.mutation(internal.generalSettings.manage, {
        request: { serverId: "10", actorId: "99", managerAuthorized: true, expectedRevision: 0, replyStyle: "text" },
    })
    await assert.rejects(
        t.mutation(internal.generalSettings.manage, {
            request: {
                serverId: "10",
                actorId: "99",
                managerAuthorized: true,
                expectedRevision: 1,
                replyStyle: "plain",
            },
        }),
    )
    await assert.rejects(
        t.mutation(internal.generalSettings.manage, {
            request: {
                serverId: "10",
                actorId: "99",
                managerAuthorized: true,
                expectedRevision: 1,
                prefix: "?",
                replyStyle: "embed",
            },
        }),
    )
    // The website form sends the prefix with the style. Only the changed setting is recorded
    assert.deepEqual(
        await t.action(api.dashboard.save, {
            ...args,
            section: "general",
            expectedRevision: 0,
            prefix: "!",
            replyStyle: "embed",
        }),
        { saved: false, conflict: true, revision: 1 },
    )
    assert.deepEqual(
        await t.action(api.dashboard.save, {
            ...args,
            section: "general",
            expectedRevision: 1,
            prefix: "!",
            replyStyle: "embed",
        }),
        { saved: true, revision: 2 },
    )
    assert.deepEqual(await t.query(api.dashboardViews.general, args), {
        serverId: "10",
        prefix: "!",
        replyStyle: "embed",
        revision: 2,
    })
    const entries = (await page()).entries.map(({ source, feature, setting, summary }) => ({
        source,
        feature,
        setting,
        summary,
    }))
    assert.deepEqual(entries, [
        { source: "website", feature: "replies", setting: "replyStyle", summary: "style: text → embed" },
        { source: "command", feature: "replies", setting: "replyStyle", summary: "style: embed → text" },
    ])
    assert.deepEqual((await page({ feature: "replies" })).entries.length, 2)
})

test("Logging, role settings and a backup restore record through their shared write paths", async () => {
    const { t, page, detail } = await fixture()
    const owner = {
        originServerId: "10",
        userId: "99",
        roleIds: [],
        isOwner: true,
        isAdministrator: false,
        nativePermissionAuthorized: true,
    }
    const member = (userId: string, isBot = false) => ({
        originServerId: "10",
        userId,
        joinedAt: "2020-01-01T00:00:00Z",
        roleIds: [],
        isBot,
        timeoutUntil: null,
        canView: true,
        canReadHistory: true,
    })
    const context = {
        originServerId: "10",
        observedAt: now,
        actor: owner,
        member: member("99"),
        botMember: member("999", true),
        channelId: "50",
        channelType: 0,
        botId: "999",
        botAuthorized: true,
        actorAuthorized: true,
        actorKind: "human",
        botKind: "bot",
    }
    await t.mutation(internal.metadataLogs.manage, {
        request: {
            serverId: "10",
            messageId: "100",
            createdAt: now,
            context,
            operation: { type: "module", expectedRevision: 1, enabled: true },
        },
    })
    await t.mutation(internal.roles.manage, {
        request: {
            serverId: "10",
            messageId: "101",
            createdAt: now,
            actor: owner,
            operation: { type: "settings", patch: { verificationEnabled: true } },
        },
    })
    await t.run((ctx) =>
        backupWriteConfig(
            { ctx, serverId: "10", ownerId: "99", key: "backup:synthetic:1", roles: [], now },
            {
                family: "response",
                sourceId: "custom_restored",
                value: {
                    kind: "custom",
                    name: "restored",
                    reply: { type: "text", text: "Restored" },
                    channelIds: [],
                    roleIds: [],
                    cooldownSeconds: 0,
                    priority: 0,
                    enabled: true,
                },
            },
        ),
    )
    assert.deepEqual(
        (await page()).entries.map(({ feature, setting, summary, actorId }) => ({
            feature,
            setting,
            summary,
            actorId,
        })),
        [
            {
                feature: "responses",
                setting: "restore response",
                summary: "Restored custom_restored from a backup",
                actorId: "99",
            },
            { feature: "roles", setting: "settings", summary: "verificationEnabled: off → on", actorId: "99" },
            { feature: "logs", setting: "module", summary: "enabled: off → on", actorId: "99" },
        ],
    )
    const [, roles] = (await page()).entries
    assert.deepEqual((await detail(roles!.id))!.changes, [{ path: "verificationEnabled", before: false, after: true }])
    // Role panels are read as stored documents, whose system fields and server are no change
    await t.mutation(internal.roles.manage, {
        request: {
            serverId: "10",
            messageId: "102",
            createdAt: now,
            actor: owner,
            operation: { type: "panel-create", name: "colors", kind: "reaction" },
        },
    })
    const [panel] = (await page()).entries
    const created = (await detail(panel!.id))!.changes
    assert.ok(created.some((change) => change.path === "panels[reaction:colors].name" && change.after === "colors"))
    assert.deepEqual(
        created.filter((change) => /_id|_creationTime|serverId|revision/.test(change.path)),
        [],
    )
    await credentialFree(t)
})

test("A confirmed restore item keeps the restore check's before and after values as its Details", async () => {
    const { t, page, detail } = await fixture()
    await t.run((ctx) =>
        backupWriteConfig(
            {
                ctx,
                serverId: "10",
                ownerId: "99",
                key: "backup:synthetic:2",
                roles: [],
                now,
                changes: [
                    { path: "reply.text", before: "Old reply", after: "Restored" },
                    { path: "enabled", after: true },
                ],
            },
            {
                family: "response",
                sourceId: "custom_restored",
                value: {
                    kind: "custom",
                    name: "restored",
                    reply: { type: "text", text: "Restored" },
                    channelIds: [],
                    roleIds: [],
                    cooldownSeconds: 0,
                    priority: 0,
                    enabled: true,
                },
            },
        ),
    )
    const [entry] = (await page()).entries
    assert.deepEqual(await detail(entry!.id), {
        changes: [
            { path: "reply.text", before: "Old reply", after: "Restored" },
            { path: "enabled", after: true },
        ],
        more: 0,
    })
})

test("Details keep the first 8,000 code units of a long value and count what does not fit in 512 KiB", async () => {
    const { t, page, detail } = await fixture()
    const definitions = (text: string) =>
        Array.from({ length: 1000 }, (_, index) => ({ name: `d${index}`, reply: { type: "text", text } }))
    await t.run(async (ctx) => {
        await recordAudit(
            ctx,
            "10",
            { userId: "20", source: "command" },
            {
                kind: "setting",
                feature: "responses",
                setting: "long",
                summary: "description changed",
                changes: auditChanges({ description: "short" }, { description: "x".repeat(9000) }),
            },
        )
        await recordAudit(
            ctx,
            "10",
            { userId: "20", source: "command" },
            {
                kind: "setting",
                feature: "responses",
                setting: "bulk",
                summary: "definitions changed",
                changes: auditChanges(
                    { definitions: definitions("a".repeat(7000)) },
                    { definitions: definitions("b".repeat(7000)) },
                ),
            },
        )
    })
    const [bulk, long] = (await page()).entries
    assert.deepEqual(await detail(long!.id), {
        changes: [{ path: "description", before: "short", after: "x".repeat(8000), cut: 9000 }],
        more: 0,
    })
    const stored = (await detail(bulk!.id))!
    assert.ok(stored.changes.length > 0 && stored.more > 0)
    assert.equal(stored.changes.length + stored.more, 1000)
    assert.equal(stored.changes[0]!.path, "definitions[d0].reply.text")
    assert.ok(new TextEncoder().encode(JSON.stringify(stored.changes)).length <= 512 * 1024)
})

test("Details keep at most 8,192 small rows, Convex's limit for one array, and count the rest", async () => {
    const { t, page, detail } = await fixture()
    const ids = Array.from({ length: 9000 }, (_, index) => String(100000 + index))
    await t.run((ctx) =>
        recordAudit(
            ctx,
            "10",
            { userId: "20", source: "command" },
            {
                kind: "setting",
                feature: "cleanup",
                setting: "exclusions",
                summary: "exclusions changed",
                changes: auditChanges({ excludedAuthorIds: [] }, { excludedAuthorIds: ids }),
            },
        ),
    )
    const [entry] = (await page()).entries
    const stored = (await detail(entry!.id))!
    assert.equal(stored.changes.length, 8192)
    assert.equal(stored.more, 9001 - 8192)
})

test("Details answer only managers of the entry's own server, and private data entries have none", async () => {
    const { t, args, detail } = await fixture()
    const ids = await t.run(async (ctx) => {
        for (const [serverId, kind] of [
            ["11", "setting"],
            ["10", "private-data-viewed"],
            ["10", "setting"],
        ] as const)
            await recordAudit(
                ctx,
                serverId,
                { userId: "20", source: "website" },
                {
                    kind,
                    feature: "moderation",
                    setting: kind,
                    summary: "Synthetic",
                    changes: [{ path: "reason", before: "Synthetic private reason", after: "Synthetic" }],
                },
            )
        return (await ctx.db.query("auditLogEntries").collect()).map((row) => ({
            id: row._id as string,
            serverId: row.serverId,
            kind: row.kind,
            detail: row.detail,
        }))
    })
    const [foreign, viewed, own] = ids
    assert.deepEqual([viewed!.detail, own!.detail], [undefined, true])
    assert.equal((await t.run((ctx) => ctx.db.query("auditLogChanges").collect())).length, 2)
    assert.equal(await detail(viewed!.id), null)
    assert.equal(await detail(foreign!.id), null)
    assert.equal(await detail("not-an-id"), null)
    await assert.rejects(detail(foreign!.id, "11"))
    assert.equal((await detail(own!.id))!.changes.length, 1)
    await t.mutation(api.dashboard.logout, { sessionToken: args.sessionToken })
    await assert.rejects(detail(own!.id))
})

test("Pages hold 25 entries and continue with a cursor, and only server managers read them", async () => {
    const { t, args, page } = await fixture()
    await t.run(async (ctx) => {
        for (let index = 0; index < 30; index++)
            await recordAudit(
                ctx,
                "10",
                { userId: "20", source: "command" },
                { kind: "setting", feature: "voice", setting: `change ${index}`, summary: "Saved" },
            )
    })
    await t.run((ctx) =>
        recordAudit(
            ctx,
            "10",
            { userId: "20", name: "Manager", source: "website" },
            { kind: "private-data-viewed", feature: "moderation", setting: "case 4", summary: "Viewed a private case" },
        ),
    )
    const first = await page()
    assert.equal(first.entries.length, 25)
    assert.deepEqual([first.entries[0]!.kind, first.entries[1]!.setting], ["private-data-viewed", "change 29"])
    assert.ok(first.nextCursor)
    const second = await page({ cursor: first.nextCursor })
    assert.deepEqual([second.entries.length, second.entries.at(-1)!.setting, second.nextCursor], [6, "change 0", null])
    await assert.rejects(t.query(api.auditLog.page, { ...args, serverId: "11", cursor: null }))
})

test("The retention chain removes entries and their details after 180 days", async () => {
    const { t } = await fixture()
    assert.ok(RETENTION_PASSES.some(([name]) => name === "auditLog"))
    await t.run((ctx) =>
        recordAudit(
            ctx,
            "10",
            { userId: "20", source: "command" },
            {
                kind: "setting",
                feature: "voice",
                setting: "old",
                summary: "Saved",
                changes: [{ path: "enabled", before: false, after: true }],
            },
        ),
    )
    now += AUDIT_RETENTION_MS - 1
    await t.run((ctx) =>
        recordAudit(
            ctx,
            "10",
            { userId: "20", source: "command" },
            { kind: "setting", feature: "voice", setting: "new", summary: "Saved" },
        ),
    )
    await t.mutation(internal.retention.run, {})
    assert.equal((await t.run((ctx) => ctx.db.query("auditLogEntries").collect())).length, 2)
    now += 1
    await t.mutation(internal.retention.run, {})
    assert.deepEqual(
        (await t.run((ctx) => ctx.db.query("auditLogEntries").collect())).map((row) => row.setting),
        ["new"],
    )
    assert.deepEqual(await t.run((ctx) => ctx.db.query("auditLogChanges").collect()), [])
})

test("Change summaries show short values of any setting and name long ones and list items", () => {
    assert.equal(
        describeChange(
            { settings: { enabled: false, cooldown: 60, revision: 3 } },
            { settings: { enabled: true, cooldown: 60, revision: 4 } },
        ),
        "enabled: off → on",
    )
    assert.equal(
        describeChange(
            { settings: { description: "Old synthetic words" } },
            { settings: { description: "New synthetic words" } },
        ),
        "description: Old synthetic words → New synthetic words",
    )
    assert.equal(
        describeChange({ settings: { greeting: "Hi there" } }, { settings: { greeting: "x".repeat(41) } }),
        "greeting changed",
    )
    assert.equal(describeChange({ settings: { note: "Old" } }, { settings: { note: "New" } }), "note: Old → New")
    assert.equal(
        describeChange(
            { rules: [{ name: "spam", threshold: 3 }, { name: "links" }] },
            { rules: [{ name: "spam", threshold: 5 }, { name: "caps" }] },
        ),
        "rules: added caps; rules: removed links; rules: changed spam",
    )
    assert.equal(describeChange({ words: ["a"] }, { words: ["a", "b"] }), "words: 1 → 2 items")
    assert.equal(describeChange({ settings: { enabled: true } }, { settings: { enabled: true } }), "Saved")
    assert.equal(
        describeChange({ settings: null, nickname: null }, { settings: { enabled: true }, nickname: "Bot" }),
        "enabled: none → on; nickname: none → Bot",
    )
    assert.equal(
        operationLabel({ kind: "custom", operation: { type: "definition-create", definition: { name: "hello" } } }),
        "definition-create hello",
    )
    assert.equal(operationLabel({ type: "settings", patch: { enabled: false } }), "settings")
})
