import { v } from "convex/values"
import { query } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import type { DashboardGeneralView, DashboardMessagesView, DashboardOverview, DashboardRolesView, DashboardTemplatesView } from "../dashboard-contracts.js"
import { dashboardSession } from "./dashboard.ts"
import { generalView, readGeneral } from "./generalSettings.ts"
import { readRolesSettings, publicRolePanel } from "./rolesStore.ts"
import { defaultRolesSettings } from "./rolesDomain.ts"
import { publicDashboardRoleJob } from "./dashboardRoles.ts"
import { publicDashboardMessageJob } from "./dashboardMessages.ts"
import { integer } from "./validation.ts"
import { readSetupSections } from "./setupCheck.ts"

// One query per dashboard view, so the website subscribes only to what the open section shows
export const TEMPLATE_VIEW_LIMIT = 500
const viewArgs = { sessionToken: v.string(), serverId: v.string() }

export const general = query({ args: viewArgs, handler: async (ctx, { sessionToken, serverId }): Promise<DashboardGeneralView> => {
    await dashboardSession(ctx, sessionToken, serverId)
    const row = await readGeneral(ctx, serverId)
    return { serverId, ...generalView(row), revision: row?.revision ?? 0 }
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

// Setup progress, shared with the bot's !setup and !health
export const overview = query({ args: viewArgs, handler: async (ctx, { sessionToken, serverId }): Promise<DashboardOverview> => {
    await dashboardSession(ctx, sessionToken, serverId)
    return { serverId, sections: await readSetupSections(ctx, serverId) }
} })
