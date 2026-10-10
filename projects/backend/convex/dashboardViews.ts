import { v } from "convex/values"
import { query } from "./_generated/server.js"
import type { DashboardGeneralView, DashboardMessagesView, DashboardOverview, DashboardRolesView, DashboardTemplatesView } from "../dashboard-contracts.js"
import { dashboardSession } from "./dashboard.ts"
import { readGeneral } from "./generalSettings.ts"
import { readRolesSettings, publicRolePanel } from "./rolesStore.ts"
import { defaultRolesSettings } from "./rolesDomain.ts"
import { publicDashboardRoleJob } from "./dashboardRoles.ts"
import { publicDashboardMessageJob } from "./dashboardMessages.ts"
import { readSetupSections } from "./setupCheck.ts"

// One query per dashboard view, so the website subscribes only to what the open section shows
// Template choices come in pages of names. A page also stops once it has read TEMPLATE_PAGE_BYTES, since every row carries
// both copies of its saved content
export const TEMPLATE_PAGE = 100, TEMPLATE_PAGE_BYTES = 4194304
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
// Template pickers need names and revisions only, never the saved message content. Drafts and templates share one name-ordered page chain
export const templates = query({ args: { ...viewArgs, cursor: v.union(v.string(), v.null()) }, handler: async (ctx, { sessionToken, serverId, cursor }): Promise<DashboardTemplatesView> => {
    await dashboardSession(ctx, sessionToken, serverId)
    const page = await ctx.db.query("publishingDrafts").withIndex("by_server_kind_name", q => q.eq("serverId", serverId)).paginate({ cursor, numItems: TEMPLATE_PAGE, maximumBytesRead: TEMPLATE_PAGE_BYTES })
    return { serverId, templates: page.page.map(row => ({ kind: row.kind, name: row.name, revision: row.revision })), cursor: page.isDone ? null : page.continueCursor }
} })

// Setup progress, shared with the bot's !setup and !health
export const overview = query({ args: viewArgs, handler: async (ctx, { sessionToken, serverId }): Promise<DashboardOverview> => {
    await dashboardSession(ctx, sessionToken, serverId)
    return { serverId, sections: await readSetupSections(ctx, serverId) }
} })
