import { Schema } from "effect"
import type { DashboardConfigurationFamily } from "@neonflux/contracts/dashboard"
import type { DashboardConfigurationCursors, DashboardConfigurationDataMap } from "../dashboard-contracts.js"
import type { QueryCtx } from "./_generated/server.js"
import { configurationCursor, configurationCursorKey } from "./configurationCursor.ts"
import { definition } from "./responses.ts"
import { MAX_DEFINITIONS } from "./responseDomain.ts"
import { config, publicRule, readSettings } from "./moderationStore.ts"
import { publicDraft } from "./publishing.ts"
import { defaultGreetings } from "./greetingsDomain.ts"
import { defaultTickets } from "./ticketDomain.ts"
import { defaultLevelingSettings } from "./levelingDomain.ts"
import { milestoneSettings, publicMilestoneRoute } from "./milestonesStore.ts"
import { suggestionSettings, publicSuggestionSettings } from "./suggestionsStore.ts"
import { cleanupSettings, publicCleanupPolicy, publicCleanupSettings } from "./cleanupStore.ts"
import { eventResume, eventSettings, publicEvent } from "./eventsStore.ts"
import { scheduleSettings, publicSchedule, upcomingSchedule } from "./schedulesStore.ts"
import { publicVoiceGenerator, readVoiceGenerators, readVoiceRooms } from "./voice.ts"
import { decode, fail } from "./validation.ts"
import { publicNickname, readGeneral } from "./generalSettings.ts"
import { configurationRevision } from "./configurationRevision.ts"
import { readRolePicker } from "./rolePickerStore.ts"
import { readAccess } from "./memberAccess.ts"
import { ROLE_PICKER_FEATURE } from "./rolePickerDomain.ts"
import { publicSticky, readStickies } from "./sticky.ts"
import { publicSidebarLink, readSidebarLink } from "./sidebar.ts"
import { publicTemporaryGrant, readTemporaryRoleSettings } from "./temporaryRolesStore.ts"
import { lfgView } from "./lfg.ts"
import { publicAlerts, publicInviteList, readAlerts } from "./alerts.ts"
import { publicHelpDesk, publicHelpDeskAnswer, readHelpDesk, readHelpDeskAnswers } from "./helpDesk.ts"
import { readOnboarding } from "./onboardingStore.ts"
import { recentOnboarded } from "./analytics.ts"
import { presetPlans } from "./presets.ts"
import { readShowcaseSettings } from "./showcases.ts"
import { SHOWCASE_FEATURE } from "./showcasesDomain.ts"
import { readProfileSettings } from "./profiles.ts"
import { PROFILE_FEATURE } from "./profilesDomain.ts"
import { youtubeView } from "./youtubeStore.ts"
import { twitchView } from "./twitchStore.ts"

// Website page cursors, one per list. configurationCursorKey checks each against its server, family and list
const Cursors = Schema.Struct(
    Object.fromEntries(
        ["rules", "watchlist", "drafts", "categories", "policies", "events", "schedules"].map((list) => [
            list,
            Schema.optionalKey(Schema.String),
        ]),
    ),
)
const AUDIT_LIST_ROWS = 1000
/**
 * The entries of long lists that an operation names, by their key. The audit log reads only these entries of such a list, so a
 * change anywhere in a list of any length reaches its Details. A create names the number it is about to take
 */
export type AuditFocus = {
    watchlist?: string[]
    drafts?: Array<readonly [string, string]>
    events?: number[]
    schedules?: number[]
    ticketCategories?: string[]
}
// The rows of the given keys that exist, read one by one through the list's own index
async function keyed<K, T>(keys: readonly K[], read: (key: K) => Promise<T | null>): Promise<T[]> {
    const rows: Array<T | null> = await Promise.all(keys.map(read))
    return rows.filter((row): row is T => row !== null)
}
export async function configurationData(
    ctx: QueryCtx,
    serverId: string,
    family: DashboardConfigurationFamily,
    cursors: DashboardConfigurationCursors = {},
    // The audit log reads every list whole, up to AUDIT_LIST_ROWS rows, so its before and after views of a longer list
    // differ only by the change, and reads the entries focus names instead where the operation names them. The website reads pages
    whole = false,
    focus: AuditFocus = {},
) {
    decode(Cursors, cursors, "Invalid configuration cursor")
    const nextCursors: DashboardConfigurationCursors = {},
        size = whole ? AUDIT_LIST_ROWS : 20
    const key = (collection: keyof DashboardConfigurationCursors) => {
        const result = configurationCursorKey(`${serverId}:${family}:${collection}`, cursors[collection])
        if (
            result !== undefined &&
            typeof result !== (["events", "schedules"].includes(collection) ? "number" : "string")
        )
            fail(400, "Invalid configuration cursor key")
        return result
    }
    const page = <T>(
        collection: keyof DashboardConfigurationCursors,
        result: T[],
        last: (row: T) => string | number,
    ) => {
        if (result.length > size)
            nextCursors[collection] = configurationCursor(
                `${serverId}:${family}:${collection}`,
                last(result[size - 1]!),
            )
        return result.slice(0, size)
    }
    let data: DashboardConfigurationDataMap[DashboardConfigurationFamily]
    switch (family) {
        case "responses": {
            const row = await ctx.db
                    .query("responseSettings")
                    .withIndex("by_server", (q) => q.eq("serverId", serverId))
                    .unique(),
                // A server keeps at most MAX_DEFINITIONS, so one unpaged list gives each kind's section all of its own
                rows = await ctx.db
                    .query("responseDefinitions")
                    .withIndex("by_server_kind_name", (q) => q.eq("serverId", serverId))
                    .take(MAX_DEFINITIONS)
            data = {
                settings: { customEnabled: row?.customEnabled ?? true, autoEnabled: row?.autoEnabled ?? true },
                definitions: rows.map(definition),
            }
            break
        }
        case "moderation": {
            const row = await readSettings(ctx, serverId)
            data = {
                settings: config(row),
                privateDataRoleId: row?.privateDataRoleId ?? null,
                rules: page(
                    "rules",
                    await ctx.db
                        .query("automodRules")
                        .withIndex("by_server_name", (q) =>
                            key("rules") === undefined
                                ? q.eq("serverId", serverId)
                                : q.eq("serverId", serverId).gt("name", key("rules") as string),
                        )
                        .take(size + 1),
                    (row) => row.name,
                ).map(publicRule),
                watchlist: (focus.watchlist
                    ? await keyed(focus.watchlist, (userId) =>
                          ctx.db
                              .query("securityWatchlist")
                              .withIndex("by_server_user", (q) => q.eq("serverId", serverId).eq("userId", userId))
                              .unique(),
                      )
                    : page(
                          "watchlist",
                          await ctx.db
                              .query("securityWatchlist")
                              .withIndex("by_server_user", (q) =>
                                  key("watchlist") === undefined
                                      ? q.eq("serverId", serverId)
                                      : q.eq("serverId", serverId).gt("userId", key("watchlist") as string),
                              )
                              .take(size + 1),
                          (row) => row.userId,
                      )
                ).map(({ userId, reason, createdAt }) => ({ userId, reason, createdAt })),
            }
            break
        }
        case "publishing": {
            const row = await ctx.db
                    .query("publishingSettings")
                    .withIndex("by_server", (q) => q.eq("serverId", serverId))
                    .unique(),
                after = key("drafts") as string | undefined,
                [afterKind, afterName] = (after ?? "draft:").split(":")
            let rows = [] as import("./_generated/dataModel.js").Doc<"publishingDrafts">[]
            if (focus.drafts)
                rows = await keyed(focus.drafts, ([kind, name]) =>
                    ctx.db
                        .query("publishingDrafts")
                        .withIndex("by_server_kind_name", (q) =>
                            q
                                .eq("serverId", serverId)
                                .eq("kind", kind as "draft")
                                .eq("name", name),
                        )
                        .unique(),
                )
            else
                for (const kind of ["draft", "template"] as const) {
                    if (afterKind === "template" && kind === "draft") continue
                    const names = kind === afterKind ? afterName : undefined
                    rows.push(
                        ...(await ctx.db
                            .query("publishingDrafts")
                            .withIndex("by_server_kind_name", (q) =>
                                names
                                    ? q.eq("serverId", serverId).eq("kind", kind).gt("name", names)
                                    : q.eq("serverId", serverId).eq("kind", kind),
                            )
                            .take(size + 1 - rows.length)),
                    )
                    if (rows.length > size) break
                }
            data = {
                settings: { enabled: row?.enabled ?? true },
                drafts: page("drafts", rows, (row) => `${row.kind}:${row.name}`).map(publicDraft),
            }
            break
        }
        case "greetings":
            data = {
                settings:
                    (
                        await ctx.db
                            .query("greetingSettings")
                            .withIndex("by_server", (q) => q.eq("serverId", serverId))
                            .unique()
                    )?.config ?? defaultGreetings(),
            }
            break
        case "tickets":
            data = {
                settings:
                    (
                        await ctx.db
                            .query("ticketSettings")
                            .withIndex("by_server", (q) => q.eq("serverId", serverId))
                            .unique()
                    )?.config ?? defaultTickets(),
                // A server may have any number of categories, so the audit log reads only the one a change names, or none
                // for a settings change
                categories: (whole
                    ? await keyed(focus.ticketCategories ?? [], (name) =>
                          ctx.db
                              .query("ticketCategories")
                              .withIndex("by_name", (q) => q.eq("serverId", serverId).eq("config.name", name))
                              .unique(),
                      )
                    : page(
                          "categories",
                          await ctx.db
                              .query("ticketCategories")
                              .withIndex("by_name", (q) =>
                                  key("categories") === undefined
                                      ? q.eq("serverId", serverId)
                                      : q.eq("serverId", serverId).gt("config.name", key("categories") as string),
                              )
                              .take(size + 1),
                          (row) => row.config.name,
                      )
                ).map((row) => row.config),
            }
            break
        case "leveling":
            data = {
                settings:
                    (
                        await ctx.db
                            .query("levelingSettings")
                            .withIndex("by_server", (q) => q.eq("serverId", serverId))
                            .unique()
                    )?.config ?? defaultLevelingSettings(),
            }
            break
        case "milestones": {
            const row = await milestoneSettings(ctx, serverId)
            data = {
                settings: {
                    enabled: row?.enabled ?? false,
                    revision: row?.revision ?? 1,
                    activatedAt: row?.activatedAt ?? 0,
                },
                routes: (
                    await ctx.db
                        .query("milestoneRoutes")
                        .withIndex("by_kind", (q) => q.eq("serverId", serverId))
                        .take(2)
                )
                    .filter((row) => row.configured)
                    .map(publicMilestoneRoute),
            }
            break
        }
        case "suggestions":
            data = { settings: publicSuggestionSettings(await suggestionSettings(ctx, serverId)) }
            break
        case "cleanup":
            data = {
                settings: publicCleanupSettings(await cleanupSettings(ctx, serverId)),
                policies: page(
                    "policies",
                    await ctx.db
                        .query("cleanupPolicies")
                        .withIndex("by_channel", (q) =>
                            key("policies") === undefined
                                ? q.eq("serverId", serverId)
                                : q.eq("serverId", serverId).gt("channelId", key("policies") as string),
                        )
                        .take(size + 1),
                    (row) => row.channelId,
                ).map(publicCleanupPolicy),
            }
            break
        case "events": {
            const row = await eventSettings(ctx, serverId)
            data = {
                settings: {
                    enabled: row?.enabled ?? false,
                    revision: row?.revision ?? 1,
                    threads: row?.threads ?? false,
                },
                events: (focus.events
                    ? await keyed(focus.events, (eventNo) =>
                          ctx.db
                              .query("events")
                              .withIndex("by_number", (q) => q.eq("serverId", serverId).eq("eventNo", eventNo))
                              .unique(),
                      )
                    : page(
                          "events",
                          await ctx.db
                              .query("events")
                              .withIndex("by_number", (q) =>
                                  key("events") === undefined
                                      ? q.eq("serverId", serverId)
                                      : q.eq("serverId", serverId).gt("eventNo", key("events") as number),
                              )
                              .take(size + 1),
                          (row) => row.eventNo,
                      )
                ).map((row) => ({ ...publicEvent(row), ...eventResume(row, Date.now()) })),
            }
            break
        }
        case "schedules": {
            const row = await scheduleSettings(ctx, serverId)
            data = {
                settings: {
                    enabled: row?.enabled ?? false,
                    revision: row?.revision ?? 1,
                    activatedAt: row?.activatedAt ?? 0,
                },
                // Each schedule lists its stored dates that have not come due
                schedules: await Promise.all(
                    (focus.schedules
                        ? await keyed(focus.schedules, (scheduleNo) =>
                              ctx.db
                                  .query("schedules")
                                  .withIndex("by_number", (q) =>
                                      q.eq("serverId", serverId).eq("scheduleNo", scheduleNo),
                                  )
                                  .unique(),
                          )
                        : page(
                              "schedules",
                              await ctx.db
                                  .query("schedules")
                                  .withIndex("by_number", (q) =>
                                      key("schedules") === undefined
                                          ? q.eq("serverId", serverId)
                                          : q.eq("serverId", serverId).gt("scheduleNo", key("schedules") as number),
                                  )
                                  .take(size + 1),
                              (row) => row.scheduleNo,
                          )
                    ).map(async (row) => publicSchedule(row, await upcomingSchedule(ctx, row, Date.now()))),
                ),
            }
            break
        }
        case "nickname":
            data = {
                settings: publicNickname(
                    await readGeneral(ctx, serverId),
                    await configurationRevision(ctx, serverId, "nickname"),
                ),
            }
            break
        case "voice":
            data = {
                generators: (await readVoiceGenerators(ctx, serverId)).map(publicVoiceGenerator),
                rooms: (await readVoiceRooms(ctx, serverId)).length,
            }
            break
        case "rolepicker":
            data = {
                settings: await readRolePicker(ctx, serverId),
                access: await readAccess(ctx, serverId, ROLE_PICKER_FEATURE),
            }
            break
        case "sticky":
            data = { stickies: (await readStickies(ctx, serverId)).map(publicSticky) }
            break
        case "sidebar": {
            const row = await readSidebarLink(ctx, serverId)
            data = { link: row ? publicSidebarLink(row) : null }
            break
        }
        case "memberlist":
            data = {}
            break
        case "onboarding":
            data = { settings: await readOnboarding(ctx, serverId), completions: await recentOnboarded(ctx, serverId) }
            break
        case "presets":
            data = { presets: await presetPlans(ctx, serverId) }
            break
        case "showcase":
            data = {
                settings: await readShowcaseSettings(ctx, serverId),
                access: await readAccess(ctx, serverId, SHOWCASE_FEATURE),
            }
            break
        case "profile":
            data = {
                settings: await readProfileSettings(ctx, serverId),
                access: await readAccess(ctx, serverId, PROFILE_FEATURE),
            }
            break
        case "temproles": {
            const grants = await ctx.db
                .query("temporaryRoleGrants")
                .withIndex("by_server_end", (q) => q.eq("serverId", serverId))
                .take(101)
            data = {
                settings: await readTemporaryRoleSettings(ctx, serverId),
                grants: grants.slice(0, 100).map(publicTemporaryGrant),
                more: grants.length > 100,
            }
            break
        }
        case "alerts": {
            const row = await readAlerts(ctx, serverId)
            data = { settings: publicAlerts(row), invites: publicInviteList(row) }
            break
        }
        case "helpdesk":
            data = {
                settings: publicHelpDesk(await readHelpDesk(ctx, serverId)),
                answers: (await readHelpDeskAnswers(ctx, serverId)).map(publicHelpDeskAnswer),
            }
            break
        case "lfg":
            data = await lfgView(ctx, serverId)
            break
        case "youtube":
            data = await youtubeView(ctx, serverId)
            break
        case "twitch":
            data = await twitchView(ctx, serverId)
            break
    }
    return { data, nextCursors }
}
