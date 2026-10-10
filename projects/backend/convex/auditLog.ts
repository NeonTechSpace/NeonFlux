import { v } from "convex/values"
import { query, type MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import type { DashboardAuditEntry, DashboardAuditFeature, DashboardAuditKind, DashboardAuditPage } from "../dashboard-contracts.js"
import { dashboardSession } from "./dashboard.ts"
import { fail } from "./validation.ts"

// The website audit log. Every setting change records one entry, whether it came from the website or a command, and so do
// a member's deletions of their own data. Entries are kept as long as moderation cases and pruned by the retention chain
export const AUDIT_RETENTION_MS = 180 * 86400000
export const AUDIT_PAGE_SIZE = 25
const AUDIT_BATCH = 256, SUMMARY_LIMIT = 500, CHANGES_SHOWN = 8

/** Who made a change. The website knows the signed-in name, while commands carry only the member ID */
export type AuditActor = { userId: string, name?: string | undefined, source: "website" | "command" }
const clip = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit - 1)}…` : value
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}

export async function recordAudit(ctx: MutationCtx, serverId: string, actor: AuditActor, entry: { kind: DashboardAuditKind, feature: DashboardAuditFeature, setting: string, summary: string }) {
    const now = Date.now()
    await ctx.db.insert("auditLogEntries", { serverId, kind: entry.kind, source: actor.source, actorId: actor.userId, ...(actor.name ? { actorName: clip(actor.name, 100) } : {}),
        feature: entry.feature, setting: clip(entry.setting, 100), summary: clip(entry.summary, SUMMARY_LIMIT), createdAt: now, expiresAt: now + AUDIT_RETENTION_MS })
}

// Bookkeeping that changes with every save and says nothing about the setting itself
const BOOKKEEPING = new Set(["revision", "configRevision", "dashboardRevision", "updatedAt", "updatedBy", "createdAt", "activatedAt", "observedAt", "result", "jobs"])
// Authored text. A change to it is named, but its value never enters the log
const AUTHORED = /content|text|description|reason|body|title|message|answer|template|footer|author|embed|field|question|reply|trigger|pattern/i
// The field that names an item of a list, such as a rule's name or a policy's channel
const IDENTITY = ["youtubeChannelId", "name", "kind", "route", "category", "eventType", "channelId", "userId", "roleId", "eventNo", "scheduleNo"]

function shown(key: string, value: unknown): string | undefined {
    if (value === undefined || value === null) return "none"
    if (typeof value === "boolean") return value ? "on" : "off"
    if (typeof value === "number") return String(value)
    if (typeof value === "string" && !AUTHORED.test(key) && value.length <= 40) return value || "empty"
    return undefined
}
// An absent value, such as a nickname reset to none, leaves no entry, so it reads as none beside any value or nested settings
function flatten(value: unknown, path: string, out: Map<string, unknown>) {
    if (value === null || value === undefined) return
    if (typeof value === "object" && !Array.isArray(value)) {
        for (const [key, child] of Object.entries(value)) if (!BOOKKEEPING.has(key)) flatten(child, path ? `${path}.${key}` : key, out)
    } else out.set(path, value)
}
const plain = (value: unknown) => { const out = new Map<string, unknown>(); flatten(value, "", out); return JSON.stringify([...out].sort(([a], [b]) => a.localeCompare(b))) }
function identity(row: unknown) {
    const value = IDENTITY.map(key => record(row)[key]).find(item => typeof item === "string" || typeof item === "number")
    return value === undefined ? undefined : clip(String(value), 40)
}
function listChanges(label: string, before: unknown[], after: unknown[]): string[] {
    if (![...before, ...after].every(row => identity(row) !== undefined)) {
        if (plain(before) === plain(after)) return []
        return [before.length === after.length ? `${label} changed` : `${label}: ${before.length} → ${after.length} items`]
    }
    const old = new Map(before.map(row => [identity(row)!, row])), next = new Map(after.map(row => [identity(row)!, row]))
    return [...[...next.keys()].filter(key => !old.has(key)).map(key => `${label}: added ${key}`),
        ...[...old.keys()].filter(key => !next.has(key)).map(key => `${label}: removed ${key}`),
        ...[...next.keys()].filter(key => old.has(key) && plain(old.get(key)) !== plain(next.get(key))).map(key => `${label}: changed ${key}`)]
}

/** A short before and after summary of two reads of the same settings, such as "enabled: off → on; rules: added spam" */
export function describeChange(before: unknown, after: unknown): string {
    const old = new Map<string, unknown>(), next = new Map<string, unknown>(), changes: string[] = []
    flatten(before, "", old); flatten(after, "", next)
    for (const path of new Set([...old.keys(), ...next.keys()])) {
        const a = old.get(path), b = next.get(path), label = path.replace(/^settings\./, "")
        if (JSON.stringify(a) === JSON.stringify(b)) continue
        if (Array.isArray(a) || Array.isArray(b)) { changes.push(...listChanges(label, Array.isArray(a) ? a : [], Array.isArray(b) ? b : [])); continue }
        const key = path.split(".").at(-1)!, from = shown(key, a), to = shown(key, b)
        changes.push(from !== undefined && to !== undefined ? `${label}: ${from} → ${to}` : `${label} changed`)
    }
    if (!changes.length) return "Saved"
    const listed = changes.slice(0, CHANGES_SHOWN).join("; ")
    return changes.length > CHANGES_SHOWN ? `${listed}; and ${changes.length - CHANGES_SHOWN} more` : listed
}

/** The operation's type and the item it names, such as "rule-update spam" */
export function operationLabel(operation: unknown): string {
    const op = record(operation)
    if (op.operation !== undefined) return operationLabel(op.operation)
    const named = { ...record(op.definition), ...record(op.rule), ...op }
    const target = ["youtubeChannelId", "name", "categoryName", "route", "kind", "channelId", "eventNo", "scheduleNo", "userId"].map(key => named[key])
        .find(item => typeof item === "number" || typeof item === "string" && item.length > 0 && item.length <= 40)
    return [typeof op.type === "string" ? op.type : "change", ...(target === undefined ? [] : [String(target)])].join(" ")
}

/** Reads the settings before and after a change and records what changed. A duplicate source changes nothing and records nothing */
export async function auditedChange<T>(ctx: MutationCtx, serverId: string, actor: AuditActor, feature: DashboardAuditFeature, operation: unknown, read: () => Promise<unknown>, apply: () => Promise<T>): Promise<T> {
    const before = await read(), result = await apply()
    if (record(result).duplicate !== true) await recordAudit(ctx, serverId, actor, { kind: "setting", feature, setting: operationLabel(operation), summary: describeChange(before, await read()) })
    return result
}

export function publicAuditEntry(row: Doc<"auditLogEntries">): DashboardAuditEntry {
    return { id: row._id, kind: row.kind, source: row.source, actorId: row.actorId, ...(row.actorName ? { actorName: row.actorName } : {}), feature: row.feature as DashboardAuditFeature,
        setting: row.setting, summary: row.summary, createdAt: row.createdAt }
}

// Server managers read the log newest first, one page of 25 at a time, optionally for one feature
export const page = query({ args: { sessionToken: v.string(), serverId: v.string(), feature: v.optional(v.string()), cursor: v.union(v.string(), v.null()) },
    handler: async (ctx, { sessionToken, serverId, feature, cursor }): Promise<DashboardAuditPage> => {
        await dashboardSession(ctx, sessionToken, serverId)
        if (feature !== undefined && !/^[a-z-]{1,32}$/.test(feature)) fail(400, "Invalid audit feature")
        const rows = feature === undefined ? ctx.db.query("auditLogEntries").withIndex("by_server", q => q.eq("serverId", serverId))
            : ctx.db.query("auditLogEntries").withIndex("by_server_feature", q => q.eq("serverId", serverId).eq("feature", feature))
        const result = await rows.order("desc").paginate({ numItems: AUDIT_PAGE_SIZE, cursor })
        return { serverId, entries: result.page.map(publicAuditEntry), nextCursor: result.isDone ? null : result.continueCursor }
    } })

export async function cleanupAuditLog(ctx: MutationCtx, now: number) {
    const rows = await ctx.db.query("auditLogEntries").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(AUDIT_BATCH)
    for (const row of rows) await ctx.db.delete(row._id)
    return { more: rows.length === AUDIT_BATCH }
}
