import { v } from "convex/values"
import { query } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import type { DashboardGeneralView, DashboardMessagesView, DashboardOverview, DashboardOverviewState, DashboardRolesView, DashboardTemplatesView } from "../dashboard-contracts.js"
import { dashboardSession } from "./dashboard.ts"
import { readGeneral } from "./generalSettings.ts"
import { readRolesSettings, publicRolePanel } from "./rolesStore.ts"
import { defaultRolesSettings } from "./rolesDomain.ts"
import { publicDashboardRoleJob } from "./dashboardRoles.ts"
import { publicDashboardMessageJob } from "./dashboardMessages.ts"
import { config as moderationConfig, readSettings as readModeration } from "./moderationStore.ts"
import { defaultGreetings } from "./greetingsDomain.ts"
import { defaultTickets } from "./ticketDomain.ts"
import { defaultLevelingSettings } from "./levelingDomain.ts"
import { readRolePicker } from "./rolePickerStore.ts"
import { integer } from "./validation.ts"

// One query per dashboard view, so the website subscribes only to what the open section shows
export const TEMPLATE_VIEW_LIMIT = 500
const viewArgs = { sessionToken: v.string(), serverId: v.string() }

export const general = query({ args: viewArgs, handler: async (ctx, { sessionToken, serverId }): Promise<DashboardGeneralView> => {
    await dashboardSession(ctx, sessionToken, serverId)
    const row = await readGeneral(ctx, serverId)
    return { serverId, prefix: row?.prefix ?? "!", revision: row?.revision ?? 0 }
} })
export const roles = query({ args: viewArgs, handler: async (ctx, { sessionToken, serverId }): Promise<DashboardRolesView> => {
    await dashboardSession(ctx, sessionToken, serverId)
    const general = await readGeneral(ctx, serverId), state = await readRolesSettings(ctx, serverId)
    const panels = await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", serverId)).take(52)
    const jobs = await ctx.db.query("dashboardRoleJobs").withIndex("by_server", q => q.eq("serverId", serverId)).order("desc").take(10)
    return { serverId, general: { prefix: general?.prefix ?? "!" }, roles: { revision: state?.dashboardRevision ?? 0, settings: state?.config ?? defaultRolesSettings(), panels: panels.map(publicRolePanel), jobs: jobs.map(publicDashboardRoleJob) } }
} })
export const messages = query({ args: viewArgs, handler: async (ctx, { sessionToken, serverId }): Promise<DashboardMessagesView> => {
    await dashboardSession(ctx, sessionToken, serverId)
    return { serverId, jobs: (await ctx.db.query("dashboardMessageJobs").withIndex("by_server", q => q.eq("serverId", serverId)).order("desc").take(10)).map(publicDashboardMessageJob) }
} })
// Template pickers need names and revisions only, never the saved message content
export const templates = query({ args: { ...viewArgs, limit: v.number() }, handler: async (ctx, { sessionToken, serverId, limit }): Promise<DashboardTemplatesView> => {
    await dashboardSession(ctx, sessionToken, serverId)
    integer(limit, 1, TEMPLATE_VIEW_LIMIT)
    const read = (kind: "template" | "draft") => ctx.db.query("publishingDrafts").withIndex("by_server_kind_name", q => q.eq("serverId", serverId).eq("kind", kind)).take(limit + 1)
    const saved = await read("template"), drafts = await read("draft")
    const option = (row: Doc<"publishingDrafts">) => ({ kind: row.kind, name: row.name, revision: row.revision })
    return { serverId, templates: [...saved.slice(0, limit), ...drafts.slice(0, limit)].map(option), more: saved.length > limit || drafts.length > limit }
} })

// Setup progress. A feature is on when it is enabled and has what it needs to act, needs setup when it is enabled without that, and off otherwise
const state = (enabled: boolean, ready = true): DashboardOverviewState => !enabled ? "off" : ready ? "on" : "setup"
export const overview = query({ args: viewArgs, handler: async (ctx, { sessionToken, serverId }): Promise<DashboardOverview> => {
    await dashboardSession(ctx, sessionToken, serverId)
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
    return { serverId, sections: [
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
    ] }
} })
