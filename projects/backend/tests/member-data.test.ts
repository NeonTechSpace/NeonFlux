import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import type { TableNames } from "../convex/_generated/dataModel.js"
import type {
    MemberDataCursor,
    MemberDataDeletePage,
    MemberDataExportPage,
    MemberDataList,
    MemberDataServerCursor,
    MemberDataServerPage,
} from "@neonflux/contracts/member-data"
import { MEMBER_DATA, MEMBER_DATA_EXEMPT } from "../convex/memberData.ts"
import { defaultLevelingSettings } from "../convex/levelingDomain.ts"
import { insertDocument, serverIndexes, tableNames } from "./schema-documents.ts"
import { botCall } from "./bot-service.ts"
import { admitMetadata, metadataState, removeMetadataRecord } from "../convex/metadataLogsStore.ts"
import type { MetadataLogsEvent } from "@neonflux/contracts/metadata-logs"

const secret = "synthetic-member-data-secret-0000000000000000000"
const keys = ["NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_ID", "NEONFLUX_BOT_API_SECRET"] as const
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
const now = Date.parse("2026-01-01T00:00:00Z"),
    DAY = 86400000
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.NEONFLUX_BOT_API_SECRET = secret
    mock.method(Date, "now", () => now)
})
afterEach(() => {
    mock.restoreAll()
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
const backend = () => convexTest({ schema, modules, transactionLimits: true })
type Backend = ReturnType<typeof backend>
const call = async <T>(t: Backend, path: string, body: unknown) => {
    const response = await botCall(t, path, body)
    assert.equal(response.status, 200, `${path} ${JSON.stringify(await response.clone().json())}`)
    return (await response.json()) as T
}
async function exportAll(t: Backend, userId: string, serverId: string) {
    const records: MemberDataExportPage["records"] = [],
        pages: number[] = []
    let cursor: MemberDataCursor | null = null
    do {
        const page: MemberDataExportPage = await call(t, "/service/member-data/export", { userId, serverId, cursor })
        records.push(...page.records)
        pages.push(page.records.length)
        cursor = page.cursor
    } while (cursor)
    return { records, pages }
}
async function deleteAll(t: Backend, userId: string, serverId: string) {
    const pages: MemberDataDeletePage[] = []
    let cursor: MemberDataCursor | null = null
    do {
        const page: MemberDataDeletePage = await call(t, "/service/member-data/delete", {
            userId,
            userName: "Synthetic member",
            serverId,
            cursor,
        })
        pages.push(page)
        cursor = page.cursor
    } while (cursor)
    return pages
}
const receipts = (t: Backend, serverId: string, userId: string, count: number) =>
    t.run(async (ctx) => {
        for (let index = 0; index < count; index++)
            await ctx.db.insert("levelingAwardReceipts", {
                serverId,
                messageId: String(1000 + index),
                userId,
                createdAt: now,
                expiresAt: now + DAY,
            })
    })

test("Every table keyed by a member's ID has member data rights or a stated exemption", () => {
    const covered = new Map(MEMBER_DATA.map((item) => [item.table, item.field]))
    for (const table of tableNames) {
        const fields = Object.keys(
            (schema.tables[table].validator as unknown as { fields: Record<string, unknown> }).fields,
        )
        const member = fields.filter((field) =>
            ["userId", "ownerId", "authorId", "requesterId", "targetId"].includes(field),
        )
        if (!member.length) continue
        assert.ok(
            covered.has(table) || MEMBER_DATA_EXEMPT[table],
            `${table} stores ${member.join(", ")}. Add it to MEMBER_DATA or MEMBER_DATA_EXEMPT`,
        )
    }
    for (const item of MEMBER_DATA) {
        assert.deepEqual(
            serverIndexes(item.table)
                .find((index) => index.indexDescriptor === "by_member_data")
                ?.fields.slice(0, 2),
            [item.field, "serverId"],
            item.table,
        )
        assert.ok(item.keep !== undefined || item.remove !== undefined, item.table)
    }
    for (const table of Object.keys(MEMBER_DATA_EXEMPT) as TableNames[]) assert.ok(!covered.has(table), table)
})

test("A member sees their own data per server and feature and exports it in bounded pages", async () => {
    const t = backend()
    await t.run(async (ctx) => {
        for (const serverId of ["10", "11"])
            await ctx.db.insert("afkStatuses", { serverId, userId: "70", reason: "Synthetic away reason", since: now })
        await ctx.db.insert("afkStatuses", { serverId: "10", userId: "71", reason: "Another member", since: now })
        await insertDocument(ctx, "moderationCases", "10", {
            targetId: "70",
            caseNo: 1,
            reason: "Synthetic case reason",
            erased: false,
        })
    })
    await receipts(t, "10", "70", 130)
    const list: MemberDataList = await call(t, "/service/member-data/list", { userId: "70" })
    assert.equal(list.complete, false)
    assert.deepEqual(
        list.servers.map((server) => server.serverId),
        ["10", "11"],
    )
    const ten = new Map(list.servers[0]!.features.map((feature) => [feature.feature, feature]))
    assert.equal(ten.get("AFK status")!.count, 1)
    assert.equal(ten.get("Leveling message receipts")!.count, 50)
    assert.match(ten.get("Moderation cases")!.kept!, /kept for the period the server chose, or until erased/)
    assert.equal(ten.get("AFK status")!.kept, null)
    assert.deepEqual(
        list.servers[1]!.features.map((feature) => feature.feature),
        ["AFK status"],
    )

    const { records, pages } = await exportAll(t, "70", "10")
    assert.deepEqual(pages, [100, 32])
    assert.equal(records.filter((record) => record.feature === "Leveling message receipts").length, 130)
    assert.deepEqual(records.find((record) => record.feature === "AFK status")!.data, {
        reason: "Synthetic away reason",
        since: now,
    })
    assert.ok(!JSON.stringify(records).includes("synthetic-digest"))
    assert.ok(!JSON.stringify(records).includes("Another member"))
    assert.equal((await botCall(t, "/service/member-data/list", { userId: "70" }, { secret: null })).status, 401)
})

test("A member's birthday sign-up export says whether their profile shows it", async () => {
    const t = backend()
    await t.run(async (ctx) => {
        await insertDocument(ctx, "milestoneEnrollments", "10", {
            userId: "70",
            kind: "birthday",
            monthDay: "03-03",
            showOnProfile: true,
        })
        await insertDocument(ctx, "milestoneEnrollments", "10", { userId: "70", kind: "anniversary" })
        await insertDocument(ctx, "milestoneEnrollments", "10", { userId: "71", kind: "birthday", monthDay: "04-04" })
    })
    const exported = async (userId: string) =>
        (await exportAll(t, userId, "10")).records
            .filter((record) => record.feature === "Birthday and anniversary enrollment")
            .map((record) => record.data as Record<string, unknown>)
            .map(({ kind, showOnProfile }) => ({ kind, showOnProfile }))
    assert.deepEqual(
        (await exported("70")).sort((a, b) => String(a.kind).localeCompare(String(b.kind))),
        [
            { kind: "anniversary", showOnProfile: undefined },
            { kind: "birthday", showOnProfile: true },
        ],
    )
    assert.deepEqual(await exported("71"), [{ kind: "birthday", showOnProfile: false }])
})

test("Server discovery finds every server with a member's data in bounded calls, where the listing stops at 50 rows a table", async () => {
    const t = backend()
    const servers = Array.from({ length: 120 }, (_, index) => String(1000 + index))
    await t.run(async (ctx) => {
        for (const serverId of servers) {
            await ctx.db.insert("afkStatuses", { serverId, userId: "70", reason: "Synthetic away reason", since: now })
            await ctx.db.insert("levelingAwardReceipts", {
                serverId,
                messageId: "2000",
                userId: "70",
                createdAt: now,
                expiresAt: now + DAY,
            })
        }
        await ctx.db.insert("afkStatuses", { serverId: "1500", userId: "71", reason: "Another member", since: now })
    })
    const list: MemberDataList = await call(t, "/service/member-data/list", { userId: "70" })
    assert.equal(list.complete, false)
    assert.ok(!list.servers.some((server) => server.serverId === "1119"))
    // A list scoped to a server the whole list omits still counts that server's rows
    const omitted: MemberDataList = await call(t, "/service/member-data/list", { userId: "70", serverId: "1119" })
    assert.deepEqual(omitted, {
        servers: [
            {
                serverId: "1119",
                features: omitted.servers[0]!.features,
            },
        ],
        complete: true,
    })
    assert.deepEqual(
        omitted.servers[0]!.features.map((item) => item.count),
        [1, 1],
    )
    // Each call makes at most 200 index reads: one per server and table, and one more where a table ends
    const pages: MemberDataServerPage[] = []
    let cursor: MemberDataServerCursor | null = null
    do {
        const page: MemberDataServerPage = await call(t, "/service/member-data/servers", { userId: "70", cursor })
        pages.push(page)
        cursor = page.cursor
    } while (cursor)
    assert.equal(pages.length, 2)
    assert.deepEqual(pages[0]!.cursor, {
        table: MEMBER_DATA.findIndex((item) => item.table === "levelingAwardReceipts"),
        after: "1076",
    })
    assert.deepEqual([...new Set(pages.flatMap((page) => page.serverIds))].sort(), servers)
    assert.equal(
        (
            await botCall(t, "/service/member-data/servers", {
                userId: "70",
                cursor: { table: 0, after: "not a server" },
            })
        ).status,
        400,
    )
})

test("Deletion removes what may go, keeps protected data with its reason, settles counts and records the deletion", async () => {
    const t = backend(),
        startsAt = now + 7 * DAY
    await t.run(async (ctx) => {
        for (const serverId of ["10", "11"])
            await ctx.db.insert("afkStatuses", { serverId, userId: "70", reason: "Synthetic away reason", since: now })
        await insertDocument(ctx, "levelingSettings", "10", {
            config: defaultLevelingSettings(),
            profiles: 2,
            dirty: 0,
        })
        await insertDocument(ctx, "levelingProfiles", "10", {
            userId: "70",
            xp: 400,
            scoreEpoch: defaultLevelingSettings().scoreEpoch,
            rankXp: 400,
            digests: [],
        })
        const counted = { serverId: "10", scoreEpoch: defaultLevelingSettings().scoreEpoch, count: 1 }
        await ctx.db.insert("levelingLevels", { ...counted, level: 2 })
        await ctx.db.insert("levelingBlocks", { ...counted, level: 2, block: 0 })
        await ctx.db.insert("levelingScores", { ...counted, xp: 400 })
        await insertDocument(ctx, "moderationCases", "10", {
            targetId: "70",
            caseNo: 1,
            reason: "Synthetic private case reason",
            erased: false,
        })
        await insertDocument(ctx, "eventSettings", "10", { rsvps: 2 })
        await insertDocument(ctx, "eventOccurrences", "10", {
            eventNo: 1,
            occurrenceNo: 1,
            state: "open",
            capacity: 1,
            going: 1,
            waitlisted: 1,
            rsvps: 2,
            workActive: false,
            date: { localMinute: "2026-01-08T00:00", startsAt, endsAt: startsAt + 3600000, offsetMinutes: 0 },
        })
        await insertDocument(ctx, "eventRsvps", "10", {
            userId: "70",
            eventNo: 1,
            occurrenceNo: 1,
            choice: "going",
            allocation: "seat",
        })
        await insertDocument(ctx, "eventRsvps", "10", {
            userId: "72",
            eventNo: 1,
            occurrenceNo: 1,
            choice: "going",
            allocation: "waitlist",
            queueOrder: 1,
        })
        await insertDocument(ctx, "suggestionSettings", "10", { voters: 1, dirty: 0, blocked: 0 })
        await insertDocument(ctx, "suggestions", "10", {
            suggestionNo: 1,
            authorId: "72",
            state: "under-review",
            up: 1,
            down: 0,
            voters: 1,
            dirty: false,
            forgetting: false,
        })
        await insertDocument(ctx, "suggestionVotes", "10", { suggestionNo: 1, userId: "70", choice: "up" })
        await insertDocument(ctx, "suggestions", "10", {
            suggestionNo: 2,
            authorId: "70",
            state: "under-review",
            text: "Synthetic open suggestion",
            forgetting: false,
        })
    })
    const pages = await deleteAll(t, "70", "10")
    assert.equal(pages.length, 1)
    assert.deepEqual(
        new Set(pages[0]!.deleted.map((item) => item.feature)),
        new Set(["AFK status", "Leveling XP", "Event RSVPs", "Suggestion votes"]),
    )
    assert.deepEqual(
        pages[0]!.kept.map((item) => [item.feature, item.count]),
        [
            ["Suggestions", 1],
            ["Moderation cases", 1],
        ],
    )
    assert.match(pages[0]!.kept[0]!.reason, /withdraw/)

    const state = await t.run(async (ctx) => ({
        afk: (await ctx.db.query("afkStatuses").collect()).map((row) => row.serverId),
        leveling: await ctx.db.query("levelingSettings").first(),
        levels: await ctx.db.query("levelingLevels").collect(),
        blocks: await ctx.db.query("levelingBlocks").collect(),
        scores: await ctx.db.query("levelingScores").collect(),
        profiles: await ctx.db.query("levelingProfiles").collect(),
        occurrence: await ctx.db.query("eventOccurrences").first(),
        events: await ctx.db.query("eventSettings").first(),
        rsvps: await ctx.db.query("eventRsvps").collect(),
        suggestion: await ctx.db
            .query("suggestions")
            .withIndex("by_number", (q) => q.eq("serverId", "10").eq("suggestionNo", 1))
            .unique(),
        suggestionSettings: await ctx.db.query("suggestionSettings").first(),
        cases: await ctx.db.query("moderationCases").collect(),
        audit: await ctx.db.query("auditLogEntries").collect(),
    }))
    assert.deepEqual(state.afk, ["11"])
    assert.equal(state.profiles.length, 0)
    assert.equal(state.leveling!.profiles, 1)
    assert.deepEqual(state.levels, [])
    assert.deepEqual(state.blocks, [])
    assert.deepEqual(state.scores, [])
    // The freed seat lets the waitlist move up
    assert.deepEqual(
        [state.occurrence!.going, state.occurrence!.waitlisted, state.occurrence!.rsvps, state.occurrence!.workActive],
        [0, 1, 1, true],
    )
    assert.equal(state.events!.rsvps, 1)
    assert.deepEqual(
        state.rsvps.map((row) => row.userId),
        ["72"],
    )
    assert.deepEqual(
        [state.suggestion!.up, state.suggestion!.voters, state.suggestion!.dirty, state.suggestionSettings!.voters],
        [0, 0, true, 0],
    )
    assert.equal(state.cases.length, 1)
    assert.equal(state.audit.length, 1)
    assert.deepEqual(
        [
            state.audit[0]!.serverId,
            state.audit[0]!.kind,
            state.audit[0]!.actorId,
            state.audit[0]!.actorName,
            state.audit[0]!.source,
        ],
        ["10", "member-data-deleted", "70", "Synthetic member", "command"],
    )
    assert.match(state.audit[0]!.summary, /^Deleted 4 records: /)
    assert.ok(!state.audit[0]!.summary.includes("Synthetic"))
})

test("A large deletion continues across bounded calls and repeats harmlessly", async () => {
    const t = backend()
    await receipts(t, "10", "70", 130)
    const pages = await deleteAll(t, "70", "10")
    assert.deepEqual(
        pages.map((page) => page.deleted[0]?.count),
        [100, 30],
    )
    assert.ok(pages[0]!.cursor && !pages[1]!.cursor)
    assert.equal((await t.run((ctx) => ctx.db.query("levelingAwardReceipts").collect())).length, 0)
    assert.equal((await t.run((ctx) => ctx.db.query("auditLogEntries").collect())).length, 2)
    const again = await deleteAll(t, "70", "10")
    assert.deepEqual([again[0]!.deleted, again[0]!.cursor], [[], null])
    assert.equal((await t.run((ctx) => ctx.db.query("auditLogEntries").collect())).length, 2)
})

test("A member's message log records list, export and delete, and one being posted stays until it finishes", async () => {
    const t = backend()
    const record = (recordNo: number, authorId: string, state: "queued" | "reserved" | null) => ({
        serverId: "10",
        recordNo,
        sourceKey: `synthetic-${recordNo}`,
        event: {
            category: "messages" as const,
            type: "message-delete" as const,
            source: { kind: "message-delete" as const, messageId: String(500 + recordNo) },
            observedAt: now,
            actor: { kind: "unknown" as const },
            resourceIds: [String(500 + recordNo)],
            changedFields: [],
            count: 1,
            channelId: "31",
            authorBot: false,
            privateChannel: false,
            details: {
                authorId,
                text: `Synthetic message ${recordNo}`,
                attachments: [{ name: "synthetic.png", size: 10 }],
            },
        },
        authorId,
        admittedAt: now,
        expiresAt: now + 30 * DAY,
        presentation: { format: "embed-v1" as const, embed: { title: "Metadata", description: "Synthetic", color: 0 } },
        delivery:
            state === null
                ? null
                : {
                      recordNo,
                      routeRevision: 1,
                      moduleRevision: 1,
                      generation: 1,
                      channelId: "35",
                      ownerId: "10",
                      state,
                      nextCheckAt: now,
                  },
        actionable: state !== null,
        nextCheckAt: now,
    })
    await t.run(async (ctx) => {
        await ctx.db.insert("metadataLogRecords", record(1, "70", null))
        await ctx.db.insert("metadataLogRecords", record(2, "70", "reserved"))
        await ctx.db.insert("metadataLogRecords", record(3, "71", null))
    })
    const list: MemberDataList = await call(t, "/service/member-data/list", { userId: "70" })
    assert.deepEqual(
        list.servers[0]!.features.find((feature) => feature.feature === "Message and member logs"),
        { feature: "Message and member logs", count: 2, kept: null },
    )
    const { records } = await exportAll(t, "70", "10")
    assert.deepEqual(records.find((item) => item.feature === "Message and member logs")!.data, {
        recordNo: 1,
        type: "message-delete",
        channelId: "31",
        observedAt: now,
        text: "Synthetic message 1",
        attachments: ["synthetic.png"],
    })
    assert.ok(!JSON.stringify(records).includes("Synthetic message 3"))
    const pages = await deleteAll(t, "70", "10")
    assert.deepEqual(
        pages.flatMap((page) => page.deleted.map((item) => [item.feature, item.count])),
        [["Message and member logs", 1]],
    )
    assert.deepEqual(
        pages.flatMap((page) => page.kept.map((item) => [item.feature, item.count, item.reason])),
        [["Message and member logs", 1, "Still being sent. Delete again once it finishes"]],
    )
    const left = await t.run(async (ctx) =>
        (await ctx.db.query("metadataLogRecords").collect()).map((row) => row.recordNo),
    )
    assert.deepEqual(left, [2, 3])
})

test("A bulk deletion's authors and a member's membership records reach their own data request without another member's", async () => {
    const t = backend()
    const event = (extra: Partial<MetadataLogsEvent>): MetadataLogsEvent => ({
        category: "messages",
        type: "message-bulk-delete",
        source: { kind: "observation", sessionId: "1".repeat(32), sequence: 1 },
        observedAt: now,
        actor: { kind: "unknown" },
        resourceIds: ["501", "502", "503"],
        changedFields: [],
        count: 3,
        ...extra,
    })
    await t.run(async (ctx) => {
        const settings = await metadataState(ctx, "10")
        await ctx.db.patch(settings._id, {
            enabled: true,
            routes: settings.routes.map((route) => ({ ...route, enabled: true, channelId: "35", ownerId: "10" })),
        })
        await admitMetadata(
            ctx,
            "10",
            event({
                channelId: "31",
                authorBot: null,
                privateChannel: false,
                details: {
                    authors: [
                        { userId: "70", count: 2 },
                        { userId: "71", count: 1 },
                    ],
                },
            }),
        )
        await admitMetadata(
            ctx,
            "10",
            event({
                category: "membership",
                type: "member-update",
                source: { kind: "observation", sessionId: "1".repeat(32), sequence: 2 },
                resourceIds: ["70"],
                changedFields: ["nickname"],
                count: 1,
                details: { changes: [{ field: "nickname", before: "Synthetic old", after: "Synthetic new" }] },
            }),
        )
    })
    const { records } = await exportAll(t, "70", "10")
    assert.deepEqual(
        records.filter((item) => item.feature.endsWith("logs")),
        [
            {
                feature: "Message and member logs",
                data: {
                    recordNo: 2,
                    type: "member-update",
                    observedAt: now,
                    changes: [{ field: "nickname", before: "Synthetic old", after: "Synthetic new" }],
                },
            },
            { feature: "Bulk deletion logs", data: { recordNo: 1, type: "message-bulk-delete", messages: 2 } },
        ],
    )
    assert.ok(!JSON.stringify(records).includes('"71"'))
    const pages = await deleteAll(t, "70", "10")
    assert.deepEqual(
        pages.flatMap((page) => page.deleted.map((item) => [item.feature, item.count])),
        [
            ["Message and member logs", 1],
            ["Bulk deletion logs", 1],
        ],
    )
    // The bulk record stays for the other author, and its post no longer names the member who asked
    const left = await t.run(async (ctx) => ({
        records: await ctx.db.query("metadataLogRecords").collect(),
        authors: await ctx.db.query("metadataLogAuthors").collect(),
    }))
    assert.deepEqual(
        left.records.map((row) => [row.recordNo, row.event.details]),
        [[1, { authors: [{ userId: "71", count: 1 }] }]],
    )
    assert.doesNotMatch(left.records[0]!.presentation.embed.description, /<@70>/)
    assert.match(left.records[0]!.presentation.embed.description, /<@71>/)
    assert.deepEqual(
        left.authors.map((row) => row.userId),
        ["71"],
    )
    assert.deepEqual(
        (await exportAll(t, "71", "10")).records.map((item) => item.data),
        [{ recordNo: 1, type: "message-bulk-delete", messages: 1 }],
    )
    // A record that expires or is forgotten takes its author links with it
    await t.run(async (ctx) => removeMetadataRecord(ctx, (await ctx.db.query("metadataLogRecords").first())!))
    assert.equal((await t.run((ctx) => ctx.db.query("metadataLogAuthors").collect())).length, 0)
})

test("An audit record about a member, such as a nickname change, is exported and deleted for that member and not for whoever made it", async () => {
    const t = backend()
    await t.run(async (ctx) => {
        const settings = await metadataState(ctx, "10")
        await ctx.db.patch(settings._id, {
            enabled: true,
            routes: settings.routes.map((route) => ({ ...route, enabled: true, channelId: "35", ownerId: "10" })),
        })
        const audit = (auditEntryId: string, auditAction: number, resourceIds: string[]): MetadataLogsEvent => ({
            category: "audit",
            type: "audit-entry",
            source: { kind: "audit", auditEntryId },
            observedAt: now,
            actor: { kind: "audit", userId: "71" },
            resourceIds,
            changedFields: [],
            count: 1,
            auditAction,
            details: {
                changes: [{ field: "nick", before: "Synthetic old", after: "Synthetic new" }],
                reason: "Synthetic reason",
            },
        })
        await admitMetadata(ctx, "10", audit("900", 24, ["70"]))
        // A channel change names no member, so it stays with the server's log
        await admitMetadata(ctx, "10", audit("901", 11, ["31"]))
    })
    assert.deepEqual(
        (await exportAll(t, "70", "10")).records.filter((item) => item.feature === "Message and member logs"),
        [
            {
                feature: "Message and member logs",
                data: {
                    recordNo: 1,
                    type: "audit-entry",
                    observedAt: now,
                    changes: [{ field: "nick", before: "Synthetic old", after: "Synthetic new" }],
                    auditAction: 24,
                    reason: "Synthetic reason",
                },
            },
        ],
    )
    assert.equal((await exportAll(t, "71", "10")).records.length, 0)
    const pages = await deleteAll(t, "70", "10")
    assert.deepEqual(
        pages.flatMap((page) => page.deleted.map((item) => [item.feature, item.count])),
        [["Message and member logs", 1]],
    )
    assert.deepEqual(
        (await t.run((ctx) => ctx.db.query("metadataLogRecords").collect())).map((row) => row.event.auditAction),
        [11],
    )
})

test("Tables that name members in staff settings, cleanup, security records or tickets say truly why they are left out", () => {
    for (const table of [
        "memberAccessLists",
        "roleSettings",
        "cleanupPolicies",
        "cleanupTargets",
        "securityWatchlist",
        "ticketTranscriptPages",
    ] as const)
        assert.ok(MEMBER_DATA_EXEMPT[table], table)
    // The watchlist has no expiry, and cleanup records name message authors
    assert.doesNotMatch(MEMBER_DATA_EXEMPT.securityWatchlist!, /expir/)
    assert.match(MEMBER_DATA_EXEMPT.cleanupTargets!, /authors/)
})
