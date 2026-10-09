import type { QueryCtx } from "./_generated/server.js"
import type { DashboardOverview } from "../dashboard-contracts.js"
import type { DashboardOverviewState } from "@neonflux/contracts/setup"
import { readRolesSettings } from "./rolesStore.ts"
import { defaultRolesSettings } from "./rolesDomain.ts"
import { config as moderationConfig, readSettings as readModeration } from "./moderationStore.ts"
import { defaultGreetings } from "./greetingsDomain.ts"
import { defaultTickets } from "./ticketDomain.ts"
import { defaultLevelingSettings } from "./levelingDomain.ts"
import { readRolePicker } from "./rolePickerStore.ts"

// Setup progress. A feature is on when it is enabled and has what it needs to act, needs setup when it is enabled without that, and off otherwise
const state = (enabled: boolean, ready = true): DashboardOverviewState => (!enabled ? "off" : ready ? "on" : "setup")
export async function readSetupSections(ctx: QueryCtx, serverId: string): Promise<DashboardOverview["sections"]> {
    const exists = (row: unknown) => row !== null
    const responses = await ctx.db
        .query("responseSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
    const definition = async (kind: "custom" | "auto") =>
        exists(
            await ctx.db
                .query("responseDefinitions")
                .withIndex("by_server_kind_name", (q) => q.eq("serverId", serverId).eq("kind", kind))
                .first(),
        )
    const moderation = moderationConfig(await readModeration(ctx, serverId))
    const cleanup = await ctx.db
        .query("cleanupSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
    const logs = await ctx.db
        .query("metadataLogSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
    const roles = (await readRolesSettings(ctx, serverId))?.config ?? defaultRolesSettings()
    // A rules panel with a role or a published message holds back role grants, events and birthdays even while verification is off,
    // so it counts as needing setup until members can accept it
    const rules = await ctx.db
        .query("rolePanels")
        .withIndex("by_server_kind", (q) => q.eq("serverId", serverId).eq("kind", "verification"))
        .unique()
    const rulesGate = Boolean(rules && (rules.published || rules.mappings.length)),
        rulesOpen = Boolean(roles.verificationEnabled && rules?.enabled && rules.published?.revision === rules.revision)
    const picker = await readRolePicker(ctx, serverId)
    const publishing = await ctx.db
        .query("publishingSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
    const greetings =
        (
            await ctx.db
                .query("greetingSettings")
                .withIndex("by_server", (q) => q.eq("serverId", serverId))
                .unique()
        )?.config ?? defaultGreetings()
    const schedules = await ctx.db
        .query("scheduleSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
    const tickets =
        (
            await ctx.db
                .query("ticketSettings")
                .withIndex("by_server", (q) => q.eq("serverId", serverId))
                .unique()
        )?.config ?? defaultTickets()
    const leveling =
        (
            await ctx.db
                .query("levelingSettings")
                .withIndex("by_server", (q) => q.eq("serverId", serverId))
                .unique()
        )?.config ?? defaultLevelingSettings()
    const milestones = await ctx.db
        .query("milestoneSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
    const milestoneRoutes = await ctx.db
        .query("milestoneRoutes")
        .withIndex("by_kind", (q) => q.eq("serverId", serverId))
        .take(2)
    const suggestions = await ctx.db
        .query("suggestionSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
    const events = await ctx.db
        .query("eventSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
    const analytics = await ctx.db
        .query("analyticsSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
    const routed = (routes: Array<{ enabled: boolean; channelId?: string }>) =>
        routes.some((route) => route.enabled && route.channelId)
    return [
        { id: "custom", state: state(responses?.customEnabled ?? true, await definition("custom")) },
        { id: "auto", state: state(responses?.autoEnabled ?? true, await definition("auto")) },
        {
            id: "moderation",
            state: state(moderation.manualModerationEnabled || moderation.automodEnabled || moderation.securityEnabled),
        },
        {
            id: "cleanup",
            state: state(
                cleanup?.enabled ?? false,
                exists(
                    await ctx.db
                        .query("cleanupPolicies")
                        .withIndex("by_due", (q) => q.eq("serverId", serverId).eq("enabled", true))
                        .first(),
                ),
            ),
        },
        {
            id: "logs",
            state: state(logs?.enabled ?? false, Boolean(logs && (routed(logs.routes) || routed(logs.eventRoutes)))),
        },
        {
            id: "reaction",
            state: state(
                roles.panelsEnabled,
                exists(
                    await ctx.db
                        .query("rolePanels")
                        .withIndex("by_server_kind", (q) => q.eq("serverId", serverId).eq("kind", "reaction"))
                        .first(),
                ),
            ),
        },
        {
            id: "autorole",
            state: state(roles.autoroleEnabled, roles.autoroleIds.length > 0 || (roles.reservations ?? []).length > 0),
        },
        { id: "verification", state: state(roles.verificationEnabled || rulesGate, rulesOpen) },
        { id: "rolepicker", state: state(picker.enabled, picker.menus.length > 0) },
        { id: "publishing", state: state(publishing?.enabled ?? true) },
        { id: "greetings", state: state(Object.values(greetings.routes).some((route) => route.enabled)) },
        { id: "schedules", state: state(schedules?.enabled ?? false, (schedules?.definitions ?? 0) > 0) },
        {
            id: "tickets",
            state: state(
                tickets.enabled,
                exists(
                    await ctx.db
                        .query("ticketCategories")
                        .withIndex("by_name", (q) => q.eq("serverId", serverId))
                        .first(),
                ),
            ),
        },
        { id: "leveling", state: state(leveling.enabled) },
        {
            id: "milestones",
            state: state(
                milestones?.enabled ?? false,
                milestoneRoutes.some((route) => route.configured && route.enabled),
            ),
        },
        { id: "suggestions", state: state(suggestions?.enabled ?? false, Boolean(suggestions?.channelId)) },
        { id: "events", state: state(events?.enabled ?? false) },
        {
            id: "voice",
            state: state(
                exists(
                    await ctx.db
                        .query("voiceGenerators")
                        .withIndex("by_channel", (q) => q.eq("serverId", serverId))
                        .first(),
                ),
            ),
        },
        { id: "analytics", state: state(analytics?.enabled ?? true) },
    ]
}
