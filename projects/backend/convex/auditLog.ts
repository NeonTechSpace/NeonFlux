import { v } from "convex/values"
import { query, type MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import type {
    DashboardAuditDetail,
    DashboardAuditEntry,
    DashboardAuditFeature,
    DashboardAuditKind,
    DashboardAuditPage,
} from "../dashboard-contracts.js"
import { dashboardSession } from "./dashboard.ts"
import { fail, type AuditActor } from "./validation.ts"
import { valueDiff, type ValueChange } from "./valueDiff.ts"

// The website audit log. Every setting change records one entry, whether it came from the website or a command, and so do
// a member's deletions of their own data. Entries are kept as long as moderation cases and pruned by the retention chain
export const AUDIT_RETENTION_MS = 180 * 86400000
const AUDIT_PAGE_SIZE = 25
const AUDIT_BATCH = 256,
    SUMMARY_LIMIT = 500,
    CHANGES_SHOWN = 8
// A detail value is cut after this many UTF-16 code units, more than any single Fluxer text field holds, so only pasted bulk
// text is shortened. One entry's detail stays under this many bytes of JSON, below Convex's 1 MiB document limit, and rows past
// it are only counted
const DETAIL_VALUE_LIMIT = 8000,
    DETAIL_BYTES = 512 * 1024

const clip = (value: string, limit: number) => (value.length > limit ? `${value.slice(0, limit - 1)}…` : value)
const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const cut = (value: unknown) =>
    typeof value === "string" && value.length > DETAIL_VALUE_LIMIT ? value.slice(0, DETAIL_VALUE_LIMIT) : value
/** The stored rows of a detail within its limits, and how many rows did not fit */
function detailRows(changes: readonly ValueChange[]) {
    const rows: DashboardAuditDetail["changes"] = []
    let bytes = 0
    for (const change of changes) {
        const long = [change.before, change.after].filter((x) => typeof x === "string" && x.length > DETAIL_VALUE_LIMIT)
        const row = {
            path: clip(change.path, 500),
            ...("before" in change ? { before: cut(change.before) } : {}),
            ...("after" in change ? { after: cut(change.after) } : {}),
            ...(long.length ? { cut: Math.max(...long.map((x) => (x as string).length)) } : {}),
        }
        const size = new TextEncoder().encode(JSON.stringify(row)).length
        if (bytes + size > DETAIL_BYTES) break
        bytes += size
        rows.push(row)
    }
    return { rows, more: changes.length - rows.length }
}

/**
 * Records one entry. Changes are the before and after values of every changed leaf, taken from the same views the entry's
 * readers already see, and are kept beside the entry for its Details
 */
export async function recordAudit(
    ctx: MutationCtx,
    serverId: string,
    actor: AuditActor,
    entry: {
        kind: DashboardAuditKind
        feature: DashboardAuditFeature
        setting: string
        summary: string
        changes?: readonly ValueChange[]
    },
) {
    const now = Date.now(),
        expiresAt = now + AUDIT_RETENTION_MS,
        // Only setting changes keep values. A private data view, a member's deletion and an export never do
        detail = entry.kind === "setting" && entry.changes?.length ? detailRows(entry.changes) : undefined
    const entryId = await ctx.db.insert("auditLogEntries", {
        serverId,
        kind: entry.kind,
        source: actor.source,
        actorId: actor.userId,
        ...(actor.name ? { actorName: clip(actor.name, 100) } : {}),
        feature: entry.feature,
        setting: clip(entry.setting, 100),
        summary: clip(entry.summary, SUMMARY_LIMIT),
        ...(detail ? { detail: true as const } : {}),
        createdAt: now,
        expiresAt,
    })
    if (detail)
        await ctx.db.insert("auditLogChanges", {
            serverId,
            entryId,
            changes: detail.rows,
            ...(detail.more ? { more: detail.more } : {}),
            expiresAt,
        })
}

// Bookkeeping that changes with every save and says nothing about the setting itself, and the fields of a stored document that
// name it and its server
const BOOKKEEPING = new Set([
    "revision",
    "configRevision",
    "dashboardRevision",
    "updatedAt",
    "updatedBy",
    "createdAt",
    "activatedAt",
    "observedAt",
    "result",
    "jobs",
    "_id",
    "_creationTime",
    "serverId",
])
// The field that names an item of a list, such as a rule's name or a policy's channel
const IDENTITY = [
    "youtubeChannelId",
    "name",
    "kind",
    "route",
    "category",
    "eventType",
    "channelId",
    "userId",
    "roleId",
    "eventNo",
    "scheduleNo",
]

function shown(value: unknown): string | undefined {
    if (value === undefined || value === null) return "none"
    if (typeof value === "boolean") return value ? "on" : "off"
    if (typeof value === "number") return String(value)
    if (typeof value === "string" && value.length <= 40) return value || "empty"
    return undefined
}
// An absent value, such as a nickname reset to none, leaves no entry, so it reads as none beside any value or nested settings
function flatten(value: unknown, path: string, out: Map<string, unknown>) {
    if (value === null || value === undefined) return
    if (typeof value === "object" && !Array.isArray(value)) {
        for (const [key, child] of Object.entries(value))
            if (!BOOKKEEPING.has(key)) flatten(child, path ? `${path}.${key}` : key, out)
    } else out.set(path, value)
}
const plain = (value: unknown) => {
    const out = new Map<string, unknown>()
    flatten(value, "", out)
    return JSON.stringify([...out].sort(([a], [b]) => a.localeCompare(b)))
}
function identity(row: unknown) {
    const value = IDENTITY.map((key) => record(row)[key]).find(
        (item) => typeof item === "string" || typeof item === "number",
    )
    return value === undefined ? undefined : clip(String(value), 40)
}
function listChanges(label: string, before: unknown[], after: unknown[]): string[] {
    if (![...before, ...after].every((row) => identity(row) !== undefined)) {
        if (plain(before) === plain(after)) return []
        return [
            before.length === after.length ? `${label} changed` : `${label}: ${before.length} → ${after.length} items`,
        ]
    }
    const old = new Map(before.map((row) => [identity(row)!, row])),
        next = new Map(after.map((row) => [identity(row)!, row]))
    return [
        ...[...next.keys()].filter((key) => !old.has(key)).map((key) => `${label}: added ${key}`),
        ...[...old.keys()].filter((key) => !next.has(key)).map((key) => `${label}: removed ${key}`),
        ...[...next.keys()]
            .filter((key) => old.has(key) && plain(old.get(key)) !== plain(next.get(key)))
            .map((key) => `${label}: changed ${key}`),
    ]
}

/** A short before and after summary of two reads of the same settings, such as "enabled: off → on; rules: added spam" */
export function describeChange(before: unknown, after: unknown): string {
    const old = new Map<string, unknown>(),
        next = new Map<string, unknown>(),
        changes: string[] = []
    flatten(before, "", old)
    flatten(after, "", next)
    for (const path of new Set([...old.keys(), ...next.keys()])) {
        const a = old.get(path),
            b = next.get(path),
            label = path.replace(/^settings\./, "")
        if (JSON.stringify(a) === JSON.stringify(b)) continue
        if (Array.isArray(a) || Array.isArray(b)) {
            changes.push(...listChanges(label, Array.isArray(a) ? a : [], Array.isArray(b) ? b : []))
            continue
        }
        const from = shown(a),
            to = shown(b)
        changes.push(from !== undefined && to !== undefined ? `${label}: ${from} → ${to}` : `${label} changed`)
    }
    if (!changes.length) return "Saved"
    const listed = changes.slice(0, CHANGES_SHOWN).join("; ")
    return changes.length > CHANGES_SHOWN ? `${listed}; and ${changes.length - CHANGES_SHOWN} more` : listed
}

// A setting read without its bookkeeping, so only the setting itself is compared
function settingOnly(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(settingOnly)
    if (value === null || typeof value !== "object") return value
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !BOOKKEEPING.has(key))
            .map(([key, child]) => [key, settingOnly(child)]),
    )
}
/** Every changed value of two reads of the same settings, with list entries named like the summary names them */
export const auditChanges = (before: unknown, after: unknown): ValueChange[] =>
    valueDiff(settingOnly(before), settingOnly(after), IDENTITY).map((change) => ({
        ...change,
        path: change.path.replace(/^settings\./, ""),
    }))

/** The operation's type and the item it names, such as "rule-update spam" */
export function operationLabel(operation: unknown): string {
    const op = record(operation)
    if (op.operation !== undefined) return operationLabel(op.operation)
    const named = { ...record(op.definition), ...record(op.rule), ...op }
    const target = [
        "youtubeChannelId",
        "name",
        "categoryName",
        "route",
        "kind",
        "channelId",
        "eventNo",
        "scheduleNo",
        "userId",
    ]
        .map((key) => named[key])
        .find((item) => typeof item === "number" || (typeof item === "string" && item.length > 0 && item.length <= 40))
    return [typeof op.type === "string" ? op.type : "change", ...(target === undefined ? [] : [String(target)])].join(
        " ",
    )
}

/** Reads the settings before and after a change and records what changed. A duplicate source changes nothing and records nothing */
export async function auditedChange<T>(
    ctx: MutationCtx,
    serverId: string,
    actor: AuditActor,
    feature: DashboardAuditFeature,
    operation: unknown,
    read: () => Promise<unknown>,
    apply: () => Promise<T>,
): Promise<T> {
    const before = await read(),
        result = await apply()
    if (record(result).duplicate !== true) {
        const after = await read()
        await recordAudit(ctx, serverId, actor, {
            kind: "setting",
            feature,
            setting: operationLabel(operation),
            summary: describeChange(before, after),
            changes: auditChanges(before, after),
        })
    }
    return result
}

function publicAuditEntry(row: Doc<"auditLogEntries">): DashboardAuditEntry {
    return {
        id: row._id,
        kind: row.kind,
        source: row.source,
        actorId: row.actorId,
        ...(row.actorName ? { actorName: row.actorName } : {}),
        feature: row.feature as DashboardAuditFeature,
        setting: row.setting,
        summary: row.summary,
        ...(row.detail ? { detail: true as const } : {}),
        createdAt: row.createdAt,
    }
}

// Server managers read the log newest first, one page of 25 at a time, optionally for one feature
export const page = query({
    args: {
        sessionToken: v.string(),
        serverId: v.string(),
        feature: v.optional(v.string()),
        cursor: v.union(v.string(), v.null()),
    },
    handler: async (ctx, { sessionToken, serverId, feature, cursor }): Promise<DashboardAuditPage> => {
        await dashboardSession(ctx, sessionToken, serverId)
        if (feature !== undefined && !/^[a-z-]{1,32}$/.test(feature)) fail(400, "Invalid audit feature")
        const rows =
            feature === undefined
                ? ctx.db.query("auditLogEntries").withIndex("by_server", (q) => q.eq("serverId", serverId))
                : ctx.db
                      .query("auditLogEntries")
                      .withIndex("by_server_feature", (q) => q.eq("serverId", serverId).eq("feature", feature))
        const result = await rows.order("desc").paginate({ numItems: AUDIT_PAGE_SIZE, cursor })
        return {
            serverId,
            entries: result.page.map(publicAuditEntry),
            nextCursor: result.isDone ? null : result.continueCursor,
        }
    },
})

// The before and after values of one entry, for the managers who read the log
export const entry = query({
    args: { sessionToken: v.string(), serverId: v.string(), entryId: v.string() },
    handler: async (ctx, { sessionToken, serverId, entryId }): Promise<DashboardAuditDetail | null> => {
        await dashboardSession(ctx, sessionToken, serverId)
        const id = ctx.db.normalizeId("auditLogEntries", entryId),
            found = id ? await ctx.db.get(id) : null
        if (!found || found.serverId !== serverId || !found.detail) return null
        const detail = await ctx.db
            .query("auditLogChanges")
            .withIndex("by_entry", (q) => q.eq("entryId", found._id))
            .unique()
        return detail ? { changes: detail.changes, more: detail.more ?? 0 } : null
    },
})

export async function cleanupAuditLog(ctx: MutationCtx, now: number) {
    const rows = await ctx.db
        .query("auditLogEntries")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(AUDIT_BATCH)
    for (const row of rows) await ctx.db.delete(row._id)
    const details = await ctx.db
        .query("auditLogChanges")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(AUDIT_BATCH)
    for (const row of details) await ctx.db.delete(row._id)
    return { more: rows.length === AUDIT_BATCH || details.length === AUDIT_BATCH }
}
