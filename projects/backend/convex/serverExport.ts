import { v } from "convex/values"
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import type { ServerExportAppeal, ServerExportCase, ServerExportPage } from "../contracts.js"
import type { DashboardConfigurationCursors, DashboardConfigurationFamily, DashboardExportPage, DashboardExportStart } from "../dashboard-contracts.js"
import { recordAudit, type AuditActor } from "./auditLog.ts"
import { readAnalyticsSettings } from "./analytics.ts"
import { backupContext } from "./backupDomain.ts"
import { configurationFamilies } from "./configurationRevision.ts"
import { configurationData } from "./configurationSnapshot.ts"
import { dashboardSession } from "./dashboard.ts"
import { readGeneral } from "./generalSettings.ts"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { defaultLevelingSettings, levelForXp } from "./levelingDomain.ts"
import { currentXp, readLeveling } from "./levelingStore.ts"
import { publicMetadataSettings, readMetadataSettings } from "./metadataLogsStore.ts"
import { publicCase } from "./moderationStore.ts"
import { freshOwnerCheck, privateCheck } from "./privateData.ts"
import { shape } from "./publishingDomain.ts"
import { defaultRolesSettings } from "./rolesDomain.ts"
import { publicRolePanel, readRolesSettings } from "./rolesStore.ts"
import { fail, integer } from "./validation.ts"

// The readable server export: Authored settings, leveling profiles, moderation cases and appeals as plain JSON that other bots can
// load. Unlike the encrypted backup it never restores into NeonFlux. It holds private moderation data, so only the server owner
// may export, checked with the bot's own fresh Fluxer read. The export is read in bounded pages, one transaction each, so no
// server is too large for it. docs/EXPORT.md documents every field
export const SERVER_EXPORT_VERSION = 1
export const EXPORT_LEVELS = 500, EXPORT_CASES = 100, EXPORT_APPEALS = 200

// Live state in a family's dashboard view, which is not a setting, and the voice generators the lfg view repeats. Presets are computed from other settings, the member list
// order lives in Fluxer and the nickname goes with the prefix, so those families have no settings of their own here
const LIVE_STATE: Partial<Record<DashboardConfigurationFamily, string[]>> = { voice: ["rooms"], temproles: ["grants", "more"], alerts: ["invites"], onboarding: ["completions"], lfg: ["generators", "open"] }
const FAMILIES = ["general", "analytics", "roles", "logs", ...configurationFamilies.filter(family => !["presets", "memberlist", "nickname"].includes(family))]
const PARTS = [...FAMILIES, "levels", "cases", "appeals"]
type Cursor = { part: number, after?: string | number, cursors?: DashboardConfigurationCursors }

const CURSOR_PREFIX = "nf-export-v1:"
const encode = (cursor: Cursor) => `${CURSOR_PREFIX}${JSON.stringify(cursor)}`
function decode(value: unknown): Cursor {
    if (value === null || value === undefined) return { part: 0 }
    if (typeof value !== "string" || value.length > 4096 || !value.startsWith(CURSOR_PREFIX)) fail(400, "Invalid export cursor")
    let parsed: unknown
    try { parsed = JSON.parse(value.slice(CURSOR_PREFIX.length)) } catch { fail(400, "Invalid export cursor") }
    const cursor = shape(parsed, ["part", "after", "cursors"], ["part"]), part = integer(cursor.part, 0, PARTS.length - 1)
    const after = cursor.after, kind = PARTS[part]
    if (after !== undefined && !(kind === "levels" ? typeof after === "string" : typeof after === "number" && Number.isSafeInteger(after) && after > 0)) fail(400, "Invalid export cursor")
    // Configuration cursors are scoped to their server, family and list, and configurationData checks them
    return { part, ...(after !== undefined ? { after: after as string | number } : {}), ...(cursor.cursors !== undefined ? { cursors: cursor.cursors as DashboardConfigurationCursors } : {}) }
}
const next = (part: number) => part + 1 < PARTS.length ? encode({ part: part + 1 }) : null

function exportCase(row: Awaited<ReturnType<typeof publicCase>>): ServerExportCase {
    return { caseNo: row.caseNo, action: row.action, origin: row.origin, ...(row.incident ? { incident: row.incident } : {}), ...(row.actorId ? { actorId: row.actorId } : {}),
        ...(row.targetId ? { targetId: row.targetId } : {}), ...(row.channelId ? { channelId: row.channelId } : {}), ...(row.ruleName ? { ruleName: row.ruleName } : {}),
        ...(row.linkedCaseNo ? { linkedCaseNo: row.linkedCaseNo } : {}), reason: row.erased ? null : row.reason, outcome: row.outcome, voided: row.voided, erased: row.erased,
        createdAt: row.createdAt, corrections: row.erased ? [] : row.corrections.map(item => ({ type: item.type, actorId: item.actorId, previousReason: item.previousReason, reason: item.reason, createdAt: item.createdAt })) }
}
function exportAppeal(row: Doc<"moderationAppeals">): ServerExportAppeal {
    return { appealNo: row.appealNo, caseNo: row.caseNo, userId: row.userId, status: row.status, text: row.erased ? null : row.text,
        ...(row.decisionReason !== undefined ? { decisionReason: row.erased ? null : row.decisionReason } : {}), ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}),
        ...(row.decidedAt !== undefined ? { decidedAt: row.decidedAt } : {}), erased: row.erased, createdAt: row.createdAt }
}

// One family's settings as its dashboard view shows them. A family with more than one page of a list continues with only the lists that continue
async function settingsPage(ctx: QueryCtx, serverId: string, family: string, cursors: DashboardConfigurationCursors | undefined): Promise<{ data: Record<string, unknown>, cursors?: DashboardConfigurationCursors }> {
    if (family === "general") { const row = await readGeneral(ctx, serverId); return { data: { prefix: row?.prefix ?? "!", nickname: row?.nickname ?? null } } }
    if (family === "analytics") return { data: { enabled: (await readAnalyticsSettings(ctx, serverId))?.enabled ?? true } }
    if (family === "roles") {
        const panels = await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", serverId)).take(52)
        return { data: { settings: (await readRolesSettings(ctx, serverId))?.config ?? defaultRolesSettings(), panels: panels.map(publicRolePanel) } }
    }
    if (family === "logs") {
        const { enabled, routes, eventRoutes, messageChannelIds, excludedChannelIds } = publicMetadataSettings(await readMetadataSettings(ctx, serverId))
        return { data: { enabled, routes, eventRoutes, messageChannelIds, excludedChannelIds } }
    }
    const { data, nextCursors } = await configurationData(ctx, serverId, family as DashboardConfigurationFamily, cursors)
    const view = Object.fromEntries(Object.entries(data).filter(([key]) => !LIVE_STATE[family as DashboardConfigurationFamily]?.includes(key)
        // A continuing page carries only the lists it continues, since the view repeats the rest
        && (!cursors || Object.hasOwn(cursors, key))))
    const continuing = Object.fromEntries(Object.entries(nextCursors).filter(([key]) => !cursors || Object.hasOwn(cursors, key)))
    return { data: view, ...(Object.keys(continuing).length ? { cursors: continuing } : {}) }
}

/** One bounded page: One family's settings, or up to 500 leveling profiles, 100 cases with their corrections or 200 appeals */
export async function serverExportPage(ctx: QueryCtx, serverId: string, value: unknown): Promise<ServerExportPage> {
    const cursor = decode(value), kind = PARTS[cursor.part]!
    if (kind === "levels") {
        const policy = (await readLeveling(ctx, serverId))?.config ?? defaultLevelingSettings(), after = cursor.after as string | undefined
        const rows = await ctx.db.query("levelingProfiles").withIndex("by_user", q => after === undefined ? q.eq("serverId", serverId) : q.eq("serverId", serverId).gt("userId", after)).take(EXPORT_LEVELS)
        // Profiles of an earlier season have no current XP, like members who never earned any
        const levels = rows.map(row => ({ userId: row.userId, xp: currentXp(policy, row) })).filter(row => row.xp > 0).map(row => ({ ...row, level: levelForXp(row.xp) }))
        return { section: "levels", levels, cursor: rows.length === EXPORT_LEVELS ? encode({ part: cursor.part, after: rows.at(-1)!.userId }) : next(cursor.part) }
    }
    if (kind === "cases") {
        const after = cursor.after as number | undefined ?? 0
        const rows = await ctx.db.query("moderationCases").withIndex("by_server_case", q => q.eq("serverId", serverId).gt("caseNo", after)).take(EXPORT_CASES)
        const cases = await Promise.all(rows.map(async row => exportCase(await publicCase(ctx, row))))
        return { section: "cases", cases, cursor: rows.length === EXPORT_CASES ? encode({ part: cursor.part, after: rows.at(-1)!.caseNo }) : next(cursor.part) }
    }
    if (kind === "appeals") {
        const after = cursor.after as number | undefined ?? 0
        const rows = await ctx.db.query("moderationAppeals").withIndex("by_server_appeal", q => q.eq("serverId", serverId).gt("appealNo", after)).take(EXPORT_APPEALS)
        return { section: "appeals", appeals: rows.map(exportAppeal), cursor: rows.length === EXPORT_APPEALS ? encode({ part: cursor.part, after: rows.at(-1)!.appealNo }) : next(cursor.part) }
    }
    const page = await settingsPage(ctx, serverId, kind, cursor.cursors)
    return { section: "settings", family: kind, data: page.data, cursor: page.cursors ? encode({ part: cursor.part, cursors: page.cursors }) : next(cursor.part) }
}

// Each export records who started it and from where, never its content. A website export that outlasts the owner's access check
// continues after a new check and records that too
const recordExport = (ctx: MutationCtx, serverId: string, actor: AuditActor, resumed: boolean) => recordAudit(ctx, serverId, actor,
    { kind: "server-exported", feature: "export", setting: "Server export", summary: resumed ? "Continued after a new access check" : `Started a readable export, format version ${SERVER_EXPORT_VERSION}` })

// Website. The export starts after the live access check of private cases passed the owner, and pages read while that check is fresh
const sessionArgs = { sessionToken: v.string(), serverId: v.string() }
export const start = mutation({ args: { ...sessionArgs, resume: v.optional(v.boolean()) }, handler: async (ctx, { sessionToken, serverId, resume }): Promise<DashboardExportStart> => {
    const session = await dashboardSession(ctx, sessionToken, serverId), check = await privateCheck(ctx, serverId, session.userId)
    if ("status" in check) return check
    if (check.owner !== true) return { status: "refused" }
    await recordExport(ctx, serverId, { userId: session.userId, name: session.userName, source: "website" }, resume === true)
    return { status: "ok" }
} })
export const page = query({ args: { ...sessionArgs, cursor: v.union(v.string(), v.null()) }, handler: async (ctx, { sessionToken, serverId, cursor }): Promise<DashboardExportPage> => {
    const session = await dashboardSession(ctx, sessionToken, serverId)
    if (!await freshOwnerCheck(ctx, serverId, session.userId)) return { status: "expired" }
    return { status: "ok", page: await serverExportPage(ctx, serverId, cursor) }
} })

// Bot routes for !export in a verified DM. The bot vouches for the current owner and the private conversation with a fresh read
export const serviceStart = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = shape(request, ["serverId", "context"], ["serverId", "context"]), context = backupContext(input.context)
    await recordExport(ctx, String(input.serverId), { userId: context.ownerId, source: "command" }, false)
    return { version: SERVER_EXPORT_VERSION }
} })
export const servicePage = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ServerExportPage> => {
    const input = shape(request, ["serverId", "context", "cursor"], ["serverId", "context", "cursor"])
    backupContext(input.context)
    return serverExportPage(ctx, String(input.serverId), input.cursor)
} })
