import type { BackupConfigFamily, BackupConfigObject, BackupSnapshot } from "@neonflux/contracts/backup"
import type { QueryCtx, MutationCtx } from "./_generated/server.js"
import type { TableNames } from "./_generated/dataModel.js"
import { backupConfig, backupConfigIdentity, backupFamilies, canonicalBackupJson, backupXp } from "./backupDomain.ts"
import { backupConfigValues } from "./backupValidators.ts"
import { defaultLevelingSettings } from "./levelingDomain.ts"
import { currentXp, readLeveling } from "./levelingStore.ts"
import { fail, object } from "./validation.ts"

// Each query is indexed by the configured server. Caps include one sentinel row
export const BACKUP_CONFIG_PROJECTIONS = {
    moderation: { table: "moderationSettings", index: "by_server", cap: 1, path: "config" },
    responses: { table: "responseSettings", index: "by_server", cap: 1, path: "" },
    response: { table: "responseDefinitions", index: "by_server", cap: 100, path: "" },
    automod: { table: "automodRules", index: "by_server_name", cap: 100, path: "rule" },
    publishing: { table: "publishingSettings", index: "by_server", cap: 1, path: "" },
    draft: { table: "publishingDrafts", index: "by_server_kind_name", cap: 100, path: "" },
    roles: { table: "roleSettings", index: "by_server", cap: 1, path: "config" },
    panel: { table: "rolePanels", index: "by_server_name", cap: 51, path: "" },
    greetings: { table: "greetingSettings", index: "by_server", cap: 1, path: "config" },
    tickets: { table: "ticketSettings", index: "by_server", cap: 1, path: "config" },
    ticketCategory: { table: "ticketCategories", index: "by_name", cap: 20, path: "config" },
    leveling: { table: "levelingSettings", index: "by_server", cap: 1, path: "config" },
    milestones: { table: "milestoneSettings", index: "by_server", cap: 1, path: "" },
    milestoneRoute: { table: "milestoneRoutes", index: "by_kind", cap: 2, path: "" },
    suggestions: { table: "suggestionSettings", index: "by_server", cap: 1, path: "" },
    cleanup: { table: "cleanupSettings", index: "by_server", cap: 1, path: "" },
    cleanupPolicy: { table: "cleanupPolicies", index: "by_channel", cap: 50, path: "" },
    metadata: { table: "metadataLogSettings", index: "by_server", cap: 1, path: "" },
    events: { table: "eventSettings", index: "by_server", cap: 1, path: "" },
    schedules: { table: "scheduleSettings", index: "by_server", cap: 1, path: "" },
} as const satisfies Record<BackupConfigFamily, { table: TableNames, index: string, cap: number, path: string }>
type Read = QueryCtx | MutationCtx
type JsonSchema = { type: string, value?: unknown }
function project(value: unknown, schema: JsonSchema): unknown {
    if (schema.type === "object") { const r = object(value), fields = schema.value as Record<string, { fieldType: JsonSchema }>; return Object.fromEntries(Object.entries(fields).filter(([k]) => r[k] !== undefined).map(([k, field]) => [k, project(r[k], field.fieldType)])) }
    if (schema.type === "array") return (value as unknown[]).map(x => project(x, schema.value as JsonSchema))
    // Union objects are already authored finite domain values, checked by backupConfig
    return value
}
export function projectBackupConfig(family: BackupConfigFamily, row: unknown): BackupConfigObject {
    const r = object(row), spec = BACKUP_CONFIG_PROJECTIONS[family], raw = spec.path ? r[spec.path] : family === "publishing" ? { ...r, retentionDays: 180 } : r, value = project(raw, (backupConfigValues[family] as unknown as { json: JsonSchema }).json)
    const sourceId = backupConfigIdentity({ family, sourceId: "", value } as BackupConfigObject)
    try { return backupConfig({ family, sourceId, value }) } catch { fail(409, `Existing configuration is incompatible with backup projection: ${family}`) }
}
export async function backupConfigRows(ctx: Read, serverId: string, family: BackupConfigFamily): Promise<(Record<string, unknown> & { _id: string })[]> {
    const spec = BACKUP_CONFIG_PROJECTIONS[family]
    // The descriptor owns this table's actual index, checked against every family in tests
    const rows = await ctx.db.query(spec.table).withIndex(spec.index as never, q => q.eq("serverId" as never, serverId as never)).take(spec.cap + 1)
    if (rows.length > spec.cap) fail(413, `Configuration family exceeds snapshot capacity: ${family}`)
    return rows
}
export async function selectedBackupSnapshot(ctx: Read, serverId: string, selected: string[]): Promise<BackupSnapshot> {
    const config: BackupConfigObject[] = []
    if (selected.includes("config")) for (const family of backupFamilies) for (const row of await backupConfigRows(ctx, serverId, family)) {
        const r = object(row)
        if (family === "panel" && (r.published !== undefined || r.withdrawing === true) || family === "milestoneRoute" && r.configured !== true) continue
        config.push(projectBackupConfig(family, row))
    }
    const xp: BackupSnapshot["xp"] = []
    if (selected.includes("xp")) {
        const state = await readLeveling(ctx, serverId), policy = state?.config ?? defaultLevelingSettings()
        const rows = await ctx.db.query("levelingProfiles").withIndex("by_user", q => q.eq("serverId", serverId)).take(1001)
        if (rows.length > 1000) fail(413, "XP snapshot exceeds 1000 profiles")
        for (const row of rows) xp.push(backupXp({ sourceId: row.userId, userId: row.userId, xp: currentXp(policy, row) }))
    }
    const result = { capturedAt: Date.now(), config, xp, counts: { config: config.length, xp: xp.length } }
    if (new TextEncoder().encode(canonicalBackupJson(result)).length > 1048576) fail(413, "Database snapshot exceeds 1 MiB")
    return result
}
