import {
    BACKUP_RESTORE_LIMITS,
    backupAccessFeatures,
    backupConfigFamilies,
    type BackupConfigFamily,
    type BackupConfigObject,
    type BackupSnapshotPage,
} from "@neonflux/contracts/backup"
import { Int } from "@neonflux/contracts/common"
import { Schema } from "effect"
import type { QueryCtx, MutationCtx } from "./_generated/server.js"
import type { TableNames } from "./_generated/dataModel.js"
import { backupConfig, backupConfigIdentity, backupXp } from "./backupDomain.ts"
import { backupConfigValues } from "./backupValidators.ts"
import { defaultLevelingSettings } from "./levelingDomain.ts"
import { currentXp, readLeveling } from "./levelingStore.ts"
import { decode, fail, object } from "./validation.ts"
import { HELPDESK_ANSWER_LIMIT } from "@neonflux/contracts/helpdesk"
import { STICKY_LIMIT } from "@neonflux/contracts/sticky"
import { CLEANUP_POLICY_LIMIT } from "@neonflux/contracts/cleanup"
import { VOICE_GENERATOR_LIMIT } from "@neonflux/contracts/voice"
import { YOUTUBE_LIMIT } from "@neonflux/contracts/youtube"

// Each query is indexed by the configured server. Caps are the features' own limits, so a larger family is corrupt. Drafts, templates and
// ticket categories have no limit of their own, and events and schedules keep their cancelled and finished definitions beside the live
// ones they limit, so a snapshot pages these families and a restore reads one by its identity
const BACKUP_CONFIG_PROJECTIONS = {
    moderation: { table: "moderationSettings", index: "by_server", cap: 1, path: "config" },
    responses: { table: "responseSettings", index: "by_server", cap: 1, path: "" },
    response: { table: "responseDefinitions", index: "by_server", cap: 100, path: "" },
    automod: { table: "automodRules", index: "by_server_name", cap: 100, path: "rule" },
    publishing: { table: "publishingSettings", index: "by_server", cap: 1, path: "" },
    draft: {
        table: "publishingDrafts",
        index: "by_server_kind_name",
        cap: BACKUP_RESTORE_LIMITS.snapshotDrafts,
        path: "",
    },
    roles: { table: "roleSettings", index: "by_server", cap: 1, path: "config" },
    panel: { table: "rolePanels", index: "by_server_name", cap: 51, path: "" },
    greetings: { table: "greetingSettings", index: "by_server", cap: 1, path: "config" },
    tickets: { table: "ticketSettings", index: "by_server", cap: 1, path: "config" },
    ticketCategory: {
        table: "ticketCategories",
        index: "by_name",
        cap: BACKUP_RESTORE_LIMITS.snapshotTicketCategories,
        path: "config",
    },
    leveling: { table: "levelingSettings", index: "by_server", cap: 1, path: "config" },
    milestones: { table: "milestoneSettings", index: "by_server", cap: 1, path: "" },
    milestoneRoute: { table: "milestoneRoutes", index: "by_kind", cap: 2, path: "" },
    suggestions: { table: "suggestionSettings", index: "by_server", cap: 1, path: "" },
    cleanup: { table: "cleanupSettings", index: "by_server", cap: 1, path: "" },
    cleanupPolicy: { table: "cleanupPolicies", index: "by_channel", cap: CLEANUP_POLICY_LIMIT, path: "" },
    metadata: { table: "metadataLogSettings", index: "by_server", cap: 1, path: "" },
    events: { table: "eventSettings", index: "by_server", cap: 1, path: "" },
    event: { table: "events", index: "by_name", cap: BACKUP_RESTORE_LIMITS.snapshotDrafts, path: "" },
    schedules: { table: "scheduleSettings", index: "by_server", cap: 1, path: "" },
    schedule: { table: "schedules", index: "by_name", cap: BACKUP_RESTORE_LIMITS.snapshotDrafts, path: "" },
    general: { table: "generalSettings", index: "by_server", cap: 1, path: "" },
    analytics: { table: "analyticsSettings", index: "by_server", cap: 1, path: "" },
    voiceGenerator: { table: "voiceGenerators", index: "by_channel", cap: VOICE_GENERATOR_LIMIT, path: "" },
    lfg: { table: "lfgSettings", index: "by_server", cap: 1, path: "" },
    rolepicker: { table: "rolePickerSettings", index: "by_server", cap: 1, path: "" },
    access: { table: "memberAccessLists", index: "by_feature", cap: backupAccessFeatures.length, path: "" },
    temproles: { table: "temporaryRoleSettings", index: "by_server", cap: 1, path: "" },
    onboarding: { table: "onboardingSettings", index: "by_server", cap: 1, path: "" },
    sticky: { table: "stickyMessages", index: "by_channel", cap: STICKY_LIMIT, path: "" },
    alerts: { table: "alertSettings", index: "by_server", cap: 1, path: "" },
    helpdesk: { table: "helpDeskSettings", index: "by_server", cap: 1, path: "" },
    helpdeskAnswer: { table: "helpDeskAnswers", index: "by_name", cap: HELPDESK_ANSWER_LIMIT, path: "" },
    showcase: { table: "showcaseSettings", index: "by_server", cap: 1, path: "" },
    profile: { table: "profileSettings", index: "by_server", cap: 1, path: "" },
    youtube: { table: "youtubeSubscriptions", index: "by_server", cap: YOUTUBE_LIMIT, path: "" },
} as const satisfies Record<BackupConfigFamily, { table: TableNames; index: string; cap: number; path: string }>
type Read = QueryCtx | MutationCtx
type JsonSchema = { type: string; value?: unknown }
function project(value: unknown, schema: JsonSchema): unknown {
    if (schema.type === "object") {
        const r = object(value),
            fields = schema.value as Record<string, { fieldType: JsonSchema }>
        return Object.fromEntries(
            Object.entries(fields)
                .filter(([k]) => r[k] !== undefined)
                .map(([k, field]) => [k, project(r[k], field.fieldType)]),
        )
    }
    if (schema.type === "array") return (value as unknown[]).map((x) => project(x, schema.value as JsonSchema))
    // Union objects are already authored finite domain values, checked by backupConfig
    return value
}
export function projectBackupConfig(family: BackupConfigFamily, row: unknown): BackupConfigObject {
    const r = object(row),
        spec = BACKUP_CONFIG_PROJECTIONS[family],
        // The role that may view private cases sits beside the moderation settings, since DEFCON and the cases do not move with them
        raw =
            family === "moderation" && r.privateDataRoleId !== undefined
                ? { ...object(r.config), privateDataRoleId: r.privateDataRoleId }
                : family === "alerts"
                  ? // An alert action reads as off while its switch was never written
                    { kickBots: false, deleteWebhooks: false, removePermissions: false, ...r }
                  : spec.path
                    ? r[spec.path]
                    : r,
        value = project(raw, (backupConfigValues[family] as unknown as { json: JsonSchema }).json)
    const sourceId = backupConfigIdentity({ family, sourceId: "", value } as BackupConfigObject)
    try {
        return backupConfig({ family, sourceId, value })
    } catch {
        fail(409, `Existing configuration is incompatible with backup projection: ${family}`)
    }
}
/** The families a snapshot pages and a restore reads one setting of by its identity, since they have no cap on their rows */
type PagedFamily = "draft" | "event" | "schedule" | "ticketCategory"
export const backupPagedFamily = (family: BackupConfigFamily): family is PagedFamily =>
    family === "draft" || family === "event" || family === "schedule" || family === "ticketCategory"
export async function backupConfigRows(
    ctx: Read,
    serverId: string,
    family: Exclude<BackupConfigFamily, PagedFamily>,
): Promise<(Record<string, unknown> & { _id: string })[]> {
    const spec = BACKUP_CONFIG_PROJECTIONS[family]
    // The descriptor owns this table's actual index, checked against every family in tests
    const rows = await ctx.db
        .query(spec.table)
        .withIndex(spec.index as never, (q) => q.eq("serverId" as never, serverId as never))
        .take(spec.cap + 1)
    if (rows.length > spec.cap) fail(413, `Configuration family exceeds snapshot capacity: ${family}`)
    return rows
}
/** A milestone route that was cleared keeps its fields, but the server no longer has it */
export const backupClearedRoute = (family: BackupConfigFamily, row: unknown) =>
    family === "milestoneRoute" && object(row).configured !== true
/**
 * The rows a restore compares a setting with: the family's rows, or for a draft or template, event or schedule only the one with its
 * identity
 */
export async function backupFamilyRows(
    ctx: Read,
    serverId: string,
    item: BackupConfigObject,
): Promise<(Record<string, unknown> & { _id: string })[]> {
    let row
    if (item.family === "draft") {
        const { kind, name } = item.value
        row = await ctx.db
            .query("publishingDrafts")
            .withIndex("by_server_kind_name", (q) => q.eq("serverId", serverId).eq("kind", kind).eq("name", name))
            .unique()
    } else if (item.family === "event")
        row = await ctx.db
            .query("events")
            .withIndex("by_name", (q) => q.eq("serverId", serverId).eq("name", item.value.name))
            .unique()
    else if (item.family === "schedule")
        row = await ctx.db
            .query("schedules")
            .withIndex("by_name", (q) => q.eq("serverId", serverId).eq("name", item.value.name))
            .unique()
    else if (item.family === "ticketCategory")
        row = await ctx.db
            .query("ticketCategories")
            .withIndex("by_name", (q) => q.eq("serverId", serverId).eq("config.name", item.value.name))
            .unique()
    else return backupConfigRows(ctx, serverId, item.family)
    return row ? [row as Record<string, unknown> & { _id: string }] : []
}
/** Up to limit events or schedules of a server in name order, after a name when one is given */
function definitionsAfter(
    ctx: Read,
    family: "event" | "schedule",
    serverId: string,
    after: string | undefined,
    limit: number,
) {
    if (family === "event")
        return ctx.db
            .query("events")
            .withIndex("by_name", (q) =>
                after === undefined ? q.eq("serverId", serverId) : q.eq("serverId", serverId).gt("name", after),
            )
            .take(limit)
    return ctx.db
        .query("schedules")
        .withIndex("by_name", (q) =>
            after === undefined ? q.eq("serverId", serverId) : q.eq("serverId", serverId).gt("name", after),
        )
        .take(limit)
}
/**
 * Whether a row of a family is in a snapshot: a cleared route and a cancelled or forgotten definition stay out. A posted role panel is in
 * it with its definition only, since its message, publication and the roles it gave belong to the server
 */
function snapshotted(family: BackupConfigFamily, row: unknown) {
    const r = object(row)
    // A cancelled event or schedule stays cancelled, and an event being forgotten only waits for its rows to go, so an archive does not
    // bring them back
    return !(
        (family === "event" && (r.state === "cancelled" || r.forgetting === true)) ||
        (family === "schedule" && r.cancelled === true) ||
        backupClearedRoute(family, row)
    )
}
const CURSOR_PREFIX = "nf-backup-v2:"
const SnapshotCursor = Schema.Struct({ part: Int(0, 100), after: Schema.optionalKey(Schema.String) })
type Cursor = typeof SnapshotCursor.Type
const encode = (cursor: Cursor) => `${CURSOR_PREFIX}${JSON.stringify(cursor)}`
function readCursor(value: string | undefined): Cursor {
    if (value === undefined) return { part: 0 }
    try {
        if (!value.startsWith(CURSOR_PREFIX)) throw new Error()
        return decode(SnapshotCursor, JSON.parse(value.slice(CURSOR_PREFIX.length)), "Invalid snapshot cursor")
    } catch {
        fail(400, "Invalid snapshot cursor")
    }
}
/**
 * One page of the snapshot an export reads: every setting of the next family that has any, up to 100 drafts and templates, events,
 * schedules or cleanup channels, up to 20 ticket categories, or up to 500
 * members' XP in member order. The bot passes the cursor back unread until it is null
 */
export async function backupSnapshotPage(
    ctx: Read,
    serverId: string,
    selected: readonly string[],
    value: string | undefined,
): Promise<BackupSnapshotPage> {
    const parts = [
            ...(selected.includes("config") ? backupConfigFamilies : []),
            ...(selected.includes("xp") ? (["xp"] as const) : []),
        ],
        capturedAt = Date.now(),
        next = (part: number) => (part + 1 < parts.length ? encode({ part: part + 1 }) : null)
    let { part, after } = readCursor(value)
    for (; part < parts.length; part++, after = undefined) {
        const name = parts[part]!
        if (name === "xp") {
            const policy = (await readLeveling(ctx, serverId))?.config ?? defaultLevelingSettings(),
                from = after
            const rows = await ctx.db
                .query("levelingProfiles")
                .withIndex("by_user", (q) =>
                    from === undefined ? q.eq("serverId", serverId) : q.eq("serverId", serverId).gt("userId", from),
                )
                .take(BACKUP_RESTORE_LIMITS.snapshotXp)
            return {
                capturedAt,
                config: [],
                xp: rows.map((row) =>
                    backupXp({ sourceId: row.userId, userId: row.userId, xp: currentXp(policy, row) }),
                ),
                cursor:
                    rows.length === BACKUP_RESTORE_LIMITS.snapshotXp
                        ? encode({ part, after: rows.at(-1)!.userId })
                        : next(part),
            }
        }
        if (name === "draft") {
            const page = await ctx.db
                .query("publishingDrafts")
                .withIndex("by_server_kind_name", (q) => q.eq("serverId", serverId))
                .paginate({ cursor: after ?? null, numItems: BACKUP_RESTORE_LIMITS.snapshotDrafts })
            const config = page.page.map((row) => projectBackupConfig("draft", row))
            if (config.length || !page.isDone)
                return {
                    capturedAt,
                    config,
                    xp: [],
                    cursor: page.isDone ? next(part) : encode({ part, after: page.continueCursor }),
                }
            continue
        }
        // A server may have any number of ticket categories, so they come 20 a page in name order
        if (name === "ticketCategory") {
            const page = BACKUP_RESTORE_LIMITS.snapshotTicketCategories,
                rows = await ctx.db
                    .query("ticketCategories")
                    .withIndex("by_name", (q) =>
                        after === undefined
                            ? q.eq("serverId", serverId)
                            : q.eq("serverId", serverId).gt("config.name", after),
                    )
                    .take(page)
            const config = rows.map((row) => projectBackupConfig(name, row))
            if (rows.length === page)
                return { capturedAt, config, xp: [], cursor: encode({ part, after: rows.at(-1)!.config.name }) }
            if (config.length) return { capturedAt, config, xp: [], cursor: next(part) }
            continue
        }
        // Cleanup may run in up to 500 channels, so its policies come 100 a page in channel order
        if (name === "cleanupPolicy") {
            const page = BACKUP_RESTORE_LIMITS.snapshotDrafts,
                rows = await ctx.db
                    .query("cleanupPolicies")
                    .withIndex("by_channel", (q) =>
                        after === undefined
                            ? q.eq("serverId", serverId)
                            : q.eq("serverId", serverId).gt("channelId", after),
                    )
                    .take(page)
            const config = rows.map((row) => projectBackupConfig(name, row))
            if (rows.length === page)
                return { capturedAt, config, xp: [], cursor: encode({ part, after: rows.at(-1)!.channelId }) }
            if (config.length) return { capturedAt, config, xp: [], cursor: next(part) }
            continue
        }
        if (name === "event" || name === "schedule") {
            const rows = await definitionsAfter(ctx, name, serverId, after, BACKUP_RESTORE_LIMITS.snapshotDrafts)
            const config = rows.filter((row) => snapshotted(name, row)).map((row) => projectBackupConfig(name, row))
            if (rows.length === BACKUP_RESTORE_LIMITS.snapshotDrafts)
                return { capturedAt, config, xp: [], cursor: encode({ part, after: rows.at(-1)!.name }) }
            if (config.length) return { capturedAt, config, xp: [], cursor: next(part) }
            continue
        }
        const config = (await backupConfigRows(ctx, serverId, name))
            .filter((row) => snapshotted(name, row))
            .map((row) => projectBackupConfig(name, row))
        if (config.length) return { capturedAt, config, xp: [], cursor: next(part) }
    }
    return { capturedAt, config: [], xp: [], cursor: null }
}
