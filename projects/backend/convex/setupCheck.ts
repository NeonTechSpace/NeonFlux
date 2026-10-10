import { v } from "convex/values"
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import type { DashboardOverview, DashboardOverviewSection, DashboardOverviewState, DashboardSetupCheck, SetupProblem, SetupStatus } from "../dashboard-contracts.js"
import type { StaffClass } from "../contracts.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { dashboardSession } from "./dashboard.ts"
import { readRolesSettings } from "./rolesStore.ts"
import { defaultRolesSettings } from "./rolesDomain.ts"
import { config as moderationConfig, readSettings as readModeration } from "./moderationStore.ts"
import { defaultGreetings } from "./greetingsDomain.ts"
import { defaultTickets } from "./ticketDomain.ts"
import { defaultLevelingSettings } from "./levelingDomain.ts"
import { readRolePicker } from "./rolePickerStore.ts"
import { fail, isId, object } from "./validation.ts"
import { ringWork } from "./workSignal.ts"

/** How long the bot has to answer a dashboard permission check */
export const SETUP_CHECK_MS = 60000
/** A new check waits this long after the previous one, so the refresh button cannot keep the bot reading Fluxer */
export const SETUP_CHECK_INTERVAL_MS = 10000
const ROLES_PER_FEATURE = 100

// Setup progress. A feature is on when it is enabled and has what it needs to act, needs setup when it is enabled without that, and off otherwise
const state = (enabled: boolean, ready = true): DashboardOverviewState => !enabled ? "off" : ready ? "on" : "setup"
export async function readSetupSections(ctx: QueryCtx, serverId: string): Promise<DashboardOverview["sections"]> {
    const exists = (row: unknown) => row !== null
    const responses = await ctx.db.query("responseSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    const definition = async (kind: "custom" | "auto") => exists(await ctx.db.query("responseDefinitions").withIndex("by_server_kind_name", q => q.eq("serverId", serverId).eq("kind", kind)).first())
    const moderation = moderationConfig(await readModeration(ctx, serverId))
    const cleanup = await ctx.db.query("cleanupSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    const logs = await ctx.db.query("metadataLogSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    const roles = (await readRolesSettings(ctx, serverId))?.config ?? defaultRolesSettings()
    const panel = async (kind: "reaction" | "verification") => exists(await ctx.db.query("rolePanels").withIndex("by_server_kind", q => q.eq("serverId", serverId).eq("kind", kind)).first())
    const picker = await readRolePicker(ctx, serverId)
    const publishing = await ctx.db.query("publishingSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    const greetings = (await ctx.db.query("greetingSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique())?.config ?? defaultGreetings()
    const schedules = await ctx.db.query("scheduleSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    const tickets = (await ctx.db.query("ticketSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique())?.config ?? defaultTickets()
    const leveling = (await ctx.db.query("levelingSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique())?.config ?? defaultLevelingSettings()
    const milestones = await ctx.db.query("milestoneSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    const milestoneRoutes = await ctx.db.query("milestoneRoutes").withIndex("by_kind", q => q.eq("serverId", serverId)).take(2)
    const suggestions = await ctx.db.query("suggestionSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    const events = await ctx.db.query("eventSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    const analytics = await ctx.db.query("analyticsSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    const routed = (routes: Array<{ enabled: boolean, channelId?: string }>) => routes.some(route => route.enabled && route.channelId)
    return [
        { id: "custom", state: state(responses?.customEnabled ?? true, await definition("custom")) },
        { id: "auto", state: state(responses?.autoEnabled ?? true, await definition("auto")) },
        { id: "moderation", state: state(moderation.manualModerationEnabled || moderation.automodEnabled || moderation.securityEnabled) },
        { id: "cleanup", state: state(cleanup?.enabled ?? false, exists(await ctx.db.query("cleanupPolicies").withIndex("by_due", q => q.eq("serverId", serverId).eq("enabled", true)).first())) },
        { id: "logs", state: state(logs?.enabled ?? false, Boolean(logs && (routed(logs.routes) || routed(logs.eventRoutes ?? [])))) },
        { id: "reaction", state: state(roles.panelsEnabled, await panel("reaction")) },
        { id: "autorole", state: state(roles.autoroleEnabled, roles.autoroleIds.length > 0 || (roles.reservations ?? []).length > 0) },
        { id: "verification", state: state(roles.verificationEnabled, await panel("verification")) },
        { id: "rolepicker", state: state(picker.enabled, picker.menus.length > 0) },
        { id: "publishing", state: state(publishing?.enabled ?? true) },
        { id: "greetings", state: state(Object.values(greetings.routes).some(route => route.enabled)) },
        { id: "schedules", state: state(schedules?.enabled ?? false, (schedules?.definitions ?? 0) > 0) },
        { id: "tickets", state: state(tickets.enabled, exists(await ctx.db.query("ticketCategories").withIndex("by_name", q => q.eq("serverId", serverId)).first())) },
        { id: "leveling", state: state(leveling.enabled) },
        { id: "milestones", state: state(milestones?.enabled ?? false, milestoneRoutes.some(route => route.configured && route.enabled)) },
        { id: "suggestions", state: state(suggestions?.enabled ?? false, Boolean(suggestions?.channelId)) },
        { id: "events", state: state(events?.enabled ?? false) },
        { id: "voice", state: state(exists(await ctx.db.query("voiceGenerators").withIndex("by_channel", q => q.eq("serverId", serverId)).first())) },
        { id: "analytics", state: state(analytics?.enabled ?? true) },
    ]
}

/** The roles each feature assigns, so the bot can check that its own role ranks above them */
async function managedRoles(ctx: QueryCtx, serverId: string): Promise<SetupStatus["managedRoles"]> {
    const roles = (await readRolesSettings(ctx, serverId))?.config ?? defaultRolesSettings()
    const panels = await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", serverId)).take(100)
    const picker = await readRolePicker(ctx, serverId)
    const leveling = (await ctx.db.query("levelingSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique())?.config
    const panelRoles = (kind: "reaction" | "verification") => panels.filter(panel => panel.kind === kind).flatMap(panel => panel.mappings.map(mapping => mapping.roleId))
    const list = (feature: DashboardOverviewSection, roleIds: string[]) => ({ feature, roleIds: [...new Set(roleIds)].slice(0, ROLES_PER_FEATURE) })
    return [
        list("autorole", [...roles.autoroleIds, ...(roles.reservations ?? []).flatMap(reservation => reservation.roleIds)]),
        list("reaction", panelRoles("reaction")),
        list("verification", panelRoles("verification")),
        list("rolepicker", picker.menus.flatMap(menu => menu.roleIds)),
        list("leveling", leveling?.mappings.map(mapping => mapping.roleId) ?? []),
    ].filter(entry => entry.roleIds.length > 0)
}

const readCheck = (ctx: Pick<QueryCtx, "db">, serverId: string) => ctx.db.query("dashboardSetupJobs").withIndex("by_server", q => q.eq("serverId", serverId)).unique()

/** What !setup, !health and the dashboard check read */
export const status = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<SetupStatus> => {
    const serverId = String(object(request).serverId)
    return { sections: await readSetupSections(ctx, serverId), managedRoles: await managedRoles(ctx, serverId), staffRoleIds: moderationConfig(await readModeration(ctx, serverId)).staffRoleIds }
} })
/** Whether the website waits for a permission check from the bot */
export const ready = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const row = await readCheck(ctx, String(object(request).serverId))
    return { queued: row?.state === "queued" && row.expiresAt > Date.now() }
} })

const features = new Set<string>(["general", "custom", "auto", "moderation", "cleanup", "logs", "reaction", "autorole", "verification", "rolepicker", "publishing",
    "greetings", "schedules", "tickets", "leveling", "milestones", "suggestions", "events", "voice", "analytics"] satisfies Array<DashboardOverviewSection | "general">)
const text = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max
const permissionKeys = (value: unknown) => Array.isArray(value) && value.length > 0 && value.length <= 40 && value.every(name => typeof name === "string" && /^[A-Za-z]{1,40}$/.test(name))
const role = (value: unknown) => isId(object(value).id) && text(object(value).name, 100)
const roleOf = (value: unknown) => { const { id, name } = object(value) as { id: string, name: string }; return { id, name } }
const staffClasses = new Set<string>(["moderation", "cases", "automod", "security", "appeals"] satisfies StaffClass[])
function setupProblems(value: unknown): SetupProblem[] {
    if (!Array.isArray(value) || value.length > 50) fail(400, "Invalid permission check")
    return value.map((item): SetupProblem => {
        const input = object(item)
        if (input.kind === "gateway" && text(input.state, 32)) return { kind: "gateway", state: input.state as string }
        const feature = input.feature as DashboardOverviewSection
        if (input.kind === "permissions" && features.has(feature) && permissionKeys(input.permissions)) return { kind: "permissions", feature, permissions: input.permissions as string[] }
        if (input.kind === "hierarchy" && features.has(feature) && input.feature !== "general" && Array.isArray(input.roles) && input.roles.length <= ROLES_PER_FEATURE
            && input.roles.every(role)) return { kind: "hierarchy", feature, roles: input.roles.map(roleOf) }
        if (input.kind === "dangerous-role" && role(input.role) && permissionKeys(input.permissions) && (input.members === undefined || Number.isSafeInteger(input.members) && (input.members as number) >= 0)) {
            return { kind: "dangerous-role", role: roleOf(input.role), permissions: input.permissions as string[], ...(input.members !== undefined ? { members: input.members as number } : {}) }
        }
        if (input.kind === "staff-permissions" && staffClasses.has(String(input.staffClass)) && role(input.role) && permissionKeys(input.permissions)) {
            return { kind: "staff-permissions", staffClass: input.staffClass as StaffClass, role: roleOf(input.role), permissions: input.permissions as string[] }
        }
        if (input.kind === "verification-bypass" && Array.isArray(input.features) && input.features.length > 0 && input.features.length <= 20
            && input.features.every(name => name !== "general" && features.has(name as string))) return { kind: "verification-bypass", features: input.features as DashboardOverviewSection[] }
        fail(400, "Invalid permission check")
    })
}
/** The bot's answer to a waiting check. A late answer is dropped, since the website already reports that the bot did not answer */
export const record = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = object(request), row = await readCheck(ctx, String(input.serverId)), problems = setupProblems(input.problems), now = Date.now()
    if (row?.state !== "queued" || row.expiresAt <= now) return { recorded: false }
    await ctx.db.patch(row._id, { state: "done", checkedAt: now, problems })
    return { recorded: true }
} })

const viewArgs = { sessionToken: v.string(), serverId: v.string() }
export const view = query({ args: viewArgs, handler: async (ctx, { sessionToken, serverId }): Promise<DashboardSetupCheck | null> => {
    await dashboardSession(ctx, sessionToken, serverId)
    const row = await readCheck(ctx, serverId)
    return row ? { serverId, state: row.state, requestedAt: row.createdAt, ...(row.checkedAt !== undefined ? { checkedAt: row.checkedAt } : {}), problems: row.problems as SetupProblem[] } : null
} })
/** Ask the bot for a fresh check. The bot reads Fluxer with its own token, never the manager's sign-in */
export const request = mutation({ args: viewArgs, handler: async (ctx, { sessionToken, serverId }) => {
    await dashboardSession(ctx, sessionToken, serverId)
    const row = await readCheck(ctx, serverId), now = Date.now()
    if (row && (row.state === "queued" && row.expiresAt > now || row.createdAt > now - SETUP_CHECK_INTERVAL_MS)) return null
    const next = { state: "queued" as const, createdAt: now, expiresAt: now + SETUP_CHECK_MS }
    if (row) await ctx.db.patch(row._id, next)
    else await ctx.db.insert("dashboardSetupJobs", { serverId, ...next, problems: [] })
    await ctx.scheduler.runAt(next.expiresAt, internal.setupCheck.expire, { serverId })
    await ringWork(ctx)
    return null
} })
export const expire = internalMutation({ args: { serverId: v.string() }, handler: async (ctx, { serverId }) => {
    const row = await ctx.db.query("dashboardSetupJobs").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (row?.state === "queued" && row.expiresAt <= Date.now()) await ctx.db.patch(row._id, { state: "failed" })
} })
