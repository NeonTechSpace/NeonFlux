import type { BackupConfigObject, BackupXpObject } from "@neonflux/contracts/backup"
import type { RolesRoleSnapshot } from "@neonflux/contracts/shared"
import type { MutationCtx } from "./_generated/server.js"
import type { ConfigurationIdentity } from "./validation.ts"
import { bumpConfigurationRevision } from "./configurationRevision.ts"
import { recordAudit } from "./auditLog.ts"
import { canonicalBackupJson } from "./backupDomain.ts"
import type { ValueChange } from "./valueDiff.ts"
import type { DashboardAuditFeature, DashboardConfigurationFamily } from "../dashboard-contracts.js"
import { applyModerationConfiguration } from "./moderation.ts"
import { applyResponseManagement } from "./responses.ts"
import { applyResponseConfiguration, responseConfigurationOperation } from "./configurationResponses.ts"
import { applyPublishingConfiguration } from "./publishing.ts"
import { applyRoleManagement } from "./roles.ts"
import { replaceGreetingConfiguration } from "./greetings.ts"
import { applyTicketConfiguration, saveTicketCategory } from "./tickets.ts"
import { applyLevelingConfiguration, correctProfile } from "./leveling.ts"
import { applyMilestonesManagement, saveMilestoneRoute } from "./milestones.ts"
import { applySuggestionsConfiguration, suggestionChannelPatch } from "./suggestions.ts"
import { applyCleanupManagement, saveCleanupPolicy } from "./cleanup.ts"
import { replaceMetadataConfiguration } from "./metadataLogsStore.ts"
import { applyEventsManagement } from "./events.ts"
import { applySchedulesManagement } from "./schedules.ts"
import { canonicalPublishingContent } from "./publishingDomain.ts"
import { milestoneCivil } from "./milestonesDomain.ts"
import { ensureProfile, levelingState } from "./levelingStore.ts"
import { rolesState } from "./rolesStore.ts"
import { milestoneState } from "./milestonesStore.ts"
import { eventState } from "./eventsStore.ts"
import { scheduleState } from "./schedulesStore.ts"
import { cleanupState } from "./cleanupStore.ts"
import { advanceSuggestion } from "./suggestionsDomain.ts"
import { suggestionState } from "./suggestionsStore.ts"
import { restoreEventDraft } from "./events.ts"
import { restoreSchedule } from "./schedules.ts"
import { configurationRevision } from "./configurationRevision.ts"
import { generalView, readGeneral, writeGeneral, writeNickname } from "./generalSettings.ts"
import { writeAnalyticsEnabled } from "./analytics.ts"
import { saveVoiceGenerator } from "./voice.ts"
import { applyLfgSettings } from "./lfg.ts"
import { applyRolePickerConfiguration } from "./rolePicker.ts"
import { readRolePicker } from "./rolePickerStore.ts"
import { applyMemberAccess } from "./memberAccess.ts"
import { applyTemporaryRoleConfiguration } from "./temporaryRoles.ts"
import { readTemporaryRoleSettings } from "./temporaryRolesStore.ts"
import { applyOnboardingConfiguration } from "./onboarding.ts"
import { applyStickyManagement } from "./sticky.ts"
import { applyAlertsManagement, publicAlerts, readAlerts, restoreExpectedAlerts } from "./alerts.ts"
import { applyHelpDeskManagement, publicHelpDesk, readHelpDesk } from "./helpDesk.ts"
import { applyShowcaseConfiguration } from "./showcases.ts"
import { applyProfileConfiguration } from "./profiles.ts"
import { applyYoutubeManagement } from "./youtube.ts"

/** Who writes, when, and the roles the bot read, which a restored setting that names roles is checked against */
type BackupWriter = {
    ctx: MutationCtx
    serverId: string
    ownerId: string
    /** Names the plan item, so every feature operation of one restore step has its own receipt */
    key: string
    /** The item's before and after values from the restore check, which the audit entry keeps */
    changes?: readonly ValueChange[]
    roles: RolesRoleSnapshot[]
    now: number
}
// The dashboard family whose revision a restored setting bumps, so open dashboards reload it. Every family is listed, so a new
// one decides whether it has one. Role settings and panels keep their own ledger revisions, and an access list names its feature
const feature: Record<BackupConfigObject["family"], DashboardConfigurationFamily | null> = {
    roles: null,
    panel: null,
    access: null,
    metadata: null,
    general: null,
    analytics: null,
    moderation: "moderation",
    automod: "moderation",
    responses: "responses",
    response: "responses",
    publishing: "publishing",
    draft: "publishing",
    greetings: "greetings",
    tickets: "tickets",
    ticketCategory: "tickets",
    leveling: "leveling",
    milestones: "milestones",
    milestoneRoute: "milestones",
    suggestions: "suggestions",
    cleanup: "cleanup",
    cleanupPolicy: "cleanup",
    events: "events",
    event: "events",
    schedules: "schedules",
    schedule: "schedules",
    voiceGenerator: "voice",
    lfg: "lfg",
    rolepicker: "rolepicker",
    temproles: "temproles",
    onboarding: "onboarding",
    sticky: "sticky",
    alerts: "alerts",
    helpdesk: "helpdesk",
    helpdeskAnswer: "helpdesk",
    showcase: "showcase",
    profile: "profile",
    youtube: "youtube",
}
/** The audit log's feature for a setting that no dashboard family owns */
const auditFeature: Partial<Record<BackupConfigObject["family"], DashboardAuditFeature>> = {
    metadata: "logs",
    general: "prefix",
    analytics: "analytics",
}
/**
 * Writes one archived setting the way the feature's own settings change does, so revisions, reference ledgers, activation times and worker
 * wakes happen. The row found by identity is updated, and a missing one is created. Every on/off switch is written as archived
 */
export async function backupWriteConfig(w: BackupWriter, item: BackupConfigObject) {
    const { ctx, serverId, ownerId, now } = w
    const identity = (step: string): ConfigurationIdentity => ({
        serverId,
        actorId: ownerId,
        createdAt: now,
        source: { kind: "job", jobId: `${w.key}:${step}` },
    })
    switch (item.family) {
        case "moderation": {
            const { privateDataRoleId, ...settings } = item.value
            // An archive without a case period keeps cases until erased, as the server it came from did
            const patch = { ...settings, caseRetentionDays: settings.caseRetentionDays ?? null }
            await applyModerationConfiguration(ctx, serverId, { type: "settings", patch }, now)
            const row = await ctx.db
                .query("moderationSettings")
                .withIndex("by_server", (q) => q.eq("serverId", serverId))
                .unique()
            if (row?.privateDataRoleId !== privateDataRoleId)
                await applyModerationConfiguration(
                    ctx,
                    serverId,
                    { type: "private-role", roleId: privateDataRoleId ?? null },
                    now,
                )
            break
        }
        case "responses": {
            const state = await ctx.db
                .query("responseSettings")
                .withIndex("by_server", (q) => q.eq("serverId", serverId))
                .unique()
            for (const [kind, enabled, was] of [
                ["custom", item.value.customEnabled, state?.customEnabled],
                ["auto", item.value.autoEnabled, state?.autoEnabled],
            ] as const)
                // A server that never set the switches has no row yet, and writing either switch makes it
                if (!state || enabled !== was)
                    await applyResponseManagement(ctx, { serverId, kind, operation: { type: "module", enabled } }, now)
            break
        }
        case "response": {
            const { kind, ...definition } = item.value,
                exists = await ctx.db
                    .query("responseDefinitions")
                    .withIndex("by_server_kind_name", (q) =>
                        q.eq("serverId", serverId).eq("kind", kind).eq("name", item.value.name),
                    )
                    .unique()
            await applyResponseConfiguration(
                ctx,
                serverId,
                responseConfigurationOperation({
                    kind,
                    operation: { type: exists ? "definition-update" : "definition-create", definition },
                }),
                now,
            )
            break
        }
        case "automod": {
            const exists = await ctx.db
                .query("automodRules")
                .withIndex("by_server_name", (q) => q.eq("serverId", serverId).eq("name", item.value.name))
                .unique()
            const { name, type: _type, ...patch } = item.value
            await applyModerationConfiguration(
                ctx,
                serverId,
                exists ? { type: "rule-update", name, patch } : { type: "rule-create", rule: item.value },
                now,
            )
            break
        }
        case "publishing":
            await applyPublishingConfiguration(ctx, serverId, { type: "settings", patch: item.value }, now)
            break
        case "draft": {
            const { kind, name, content } = item.value,
                exists = await ctx.db
                    .query("publishingDrafts")
                    .withIndex("by_server_kind_name", (q) =>
                        q.eq("serverId", serverId).eq("kind", kind).eq("name", name),
                    )
                    .unique()
            await applyPublishingConfiguration(
                ctx,
                serverId,
                exists
                    ? { type: "draft-set", kind, name, expectedRevision: exists.revision, content }
                    : { type: "draft-create", kind, name, content },
                now,
            )
            break
        }
        case "roles": {
            // The role lists and reservations take a new revision of the role ledger, so they are sent only when they differ. Values the archive
            // leaves out are written as what absent means, since the operation merges into what the server has
            const { config } = await rolesState(ctx, serverId),
                { autoroleIds, reservations, ...flags } = item.value
            await applyRoleManagement(
                ctx,
                { serverId, jobId: `${w.key}:roles` },
                {
                    type: "settings",
                    patch: {
                        ...flags,
                        advancedVerificationEnabled: flags.advancedVerificationEnabled ?? false,
                        ...(canonicalBackupJson(config.autoroleIds) !== canonicalBackupJson(autoroleIds)
                            ? { autoroleIds }
                            : {}),
                        ...(canonicalBackupJson(config.reservations ?? []) !== canonicalBackupJson(reservations ?? [])
                            ? { reservations: reservations ?? [] }
                            : {}),
                    },
                    roles: w.roles,
                },
                now,
            )
            break
        }
        case "panel": {
            const { name, kind, enabled, exclusive, mappings } = item.value,
                exists = await ctx.db
                    .query("rolePanels")
                    .withIndex("by_server_name", (q) => q.eq("serverId", serverId).eq("name", name))
                    .unique()
            if (exists) {
                // Mappings and the exclusive flag take a new panel revision and ledger key, unless the panel changes under its posted message, so
                // only a difference is sent
                const patch = {
                    ...(enabled !== exists.enabled ? { enabled } : {}),
                    ...(exclusive !== exists.exclusive ? { exclusive } : {}),
                    ...(canonicalBackupJson(mappings) !== canonicalBackupJson(exists.mappings) ? { mappings } : {}),
                }
                // A posted reaction panel changes under its message as a staff edit does, which clears the reactions whose role changed
                const inPlace =
                    exists.kind === "reaction" && exists.published && exists.published.revision === exists.revision
                await applyRoleManagement(
                    ctx,
                    { serverId, jobId: `${w.key}:panel` },
                    {
                        type: "panel-update",
                        name,
                        expectedRevision: exists.revision,
                        patch,
                        roles: w.roles,
                        ...(inPlace ? { inPlace: true } : {}),
                    },
                    now,
                )
            } else {
                await applyRoleManagement(
                    ctx,
                    { serverId, jobId: `${w.key}:panel` },
                    { type: "panel-create", name, kind, exclusive, mappings, roles: w.roles },
                    now,
                )
                // A new panel starts on, so an archived panel that is off is turned off here
                if (!enabled) {
                    const created = await ctx.db
                        .query("rolePanels")
                        .withIndex("by_server_name", (q) => q.eq("serverId", serverId).eq("name", name))
                        .unique()
                    await applyRoleManagement(
                        ctx,
                        { serverId, jobId: `${w.key}:panel-off` },
                        { type: "panel-update", name, expectedRevision: created!.revision, patch: { enabled } },
                        now,
                    )
                }
            }
            break
        }
        case "greetings":
            await replaceGreetingConfiguration(ctx, serverId, item.value, now)
            break
        case "tickets":
            await applyTicketConfiguration(ctx, serverId, { type: "settings", ...item.value })
            break
        case "ticketCategory": {
            const exists = await ctx.db
                .query("ticketCategories")
                .withIndex("by_name", (q) => q.eq("serverId", serverId).eq("config.name", item.value.name))
                .unique()
            await saveTicketCategory(ctx, serverId, exists, item.value)
            break
        }
        case "leveling": {
            const { mappings, ...settings } = item.value,
                { config } = await levelingState(ctx, serverId)
            const {
                revision: _revision,
                mappingRevision: _mappingRevision,
                scoreEpoch: _scoreEpoch,
                mappings: was,
                ...current
            } = config
            if (canonicalBackupJson(current) !== canonicalBackupJson(settings))
                await applyLevelingConfiguration(
                    ctx,
                    serverId,
                    // An archive without only-these channels lets every channel earn XP, so the patch clears a current list
                    {
                        type: "settings",
                        expectedRevision: config.revision,
                        patch: { ...settings, onlyChannelIds: settings.onlyChannelIds ?? [] },
                    },
                    now,
                )
            if (canonicalBackupJson(was) !== canonicalBackupJson(mappings))
                await applyLevelingConfiguration(
                    ctx,
                    serverId,
                    {
                        type: "mappings",
                        expectedMappingRevision: config.mappingRevision,
                        mappings,
                        roles: w.roles,
                    },
                    now,
                )
            break
        }
        case "milestones": {
            const state = await milestoneState(ctx, serverId)
            await applyMilestonesManagement(
                ctx,
                identity("settings"),
                undefined,
                { type: "settings", expectedRevision: state.revision, enabled: item.value.enabled },
                now,
            )
            break
        }
        case "milestoneRoute": {
            const { kind, enabled, ...route } = item.value,
                exists = await ctx.db
                    .query("milestoneRoutes")
                    .withIndex("by_kind", (q) => q.eq("serverId", serverId).eq("kind", kind))
                    .unique(),
                civil = milestoneCivil({ zone: route.zone, time: route.time, fold: route.fold })
            const id = await saveMilestoneRoute(
                ctx,
                serverId,
                kind,
                exists,
                ownerId,
                {
                    channelId: route.channelId,
                    ...civil,
                    template: route.template,
                    content: route.content,
                    canonicalContent: canonicalPublishingContent(route.content),
                },
                now,
            )
            const saved = (await ctx.db.get(id))!
            if (saved.enabled !== enabled)
                await applyMilestonesManagement(
                    ctx,
                    identity("route"),
                    undefined,
                    { type: enabled ? "enable" : "disable", kind, expectedRevision: saved.revision },
                    now,
                )
            break
        }
        case "suggestions": {
            const state = await suggestionState(ctx, serverId),
                channelId = item.value.channelId
            if (state.channelId !== channelId)
                await ctx.db.patch(state._id, {
                    ...suggestionChannelPatch(channelId ?? null),
                    revision: advanceSuggestion(state.revision),
                })
            const latest = await suggestionState(ctx, serverId)
            if (latest.enabled !== item.value.enabled)
                await applySuggestionsConfiguration(ctx, identity("settings"), undefined, {
                    type: "settings",
                    expectedRevision: latest.revision,
                    enabled: item.value.enabled,
                })
            break
        }
        case "cleanup": {
            const state = await cleanupState(ctx, serverId)
            await applyCleanupManagement(ctx, identity("module"), undefined, {
                type: "module",
                expectedRevision: state.revision,
                enabled: item.value.enabled,
            })
            break
        }
        case "cleanupPolicy": {
            const exists = await ctx.db
                .query("cleanupPolicies")
                .withIndex("by_channel", (q) => q.eq("serverId", serverId).eq("channelId", item.value.channelId))
                .unique()
            await saveCleanupPolicy(ctx, serverId, exists, item.value)
            break
        }
        case "metadata":
            await replaceMetadataConfiguration(ctx, serverId, item.value)
            break
        case "events": {
            const state = await eventState(ctx, serverId)
            await applyEventsManagement(
                ctx,
                identity("settings"),
                undefined,
                { type: "settings", expectedRevision: state.revision, enabled: item.value.enabled },
                now,
            )
            // Discussion threads have their own switch, which an archive without it leaves off
            const latest = await eventState(ctx, serverId),
                threads = item.value.threads ?? false
            if ((latest.threads ?? false) !== threads)
                await applyEventsManagement(
                    ctx,
                    identity("threads"),
                    undefined,
                    { type: "threads", expectedRevision: latest.revision, enabled: threads },
                    now,
                )
            break
        }
        case "schedules": {
            const state = await scheduleState(ctx, serverId)
            await applySchedulesManagement(
                ctx,
                identity("settings"),
                undefined,
                { type: "settings", expectedRevision: state.revision, enabled: item.value.enabled },
                now,
            )
            break
        }
        case "event":
            await restoreEventDraft(ctx, serverId, item.value, now)
            break
        case "schedule":
            await restoreSchedule(ctx, serverId, ownerId, item.value, now)
            break
        case "general": {
            // The prefix and reply style share the general revision, and the nickname has its own, which the bot applies after this step
            const row = await readGeneral(ctx, serverId),
                view = generalView(row),
                replyStyle = item.value.replyStyle ?? "embed",
                nickname = item.value.nickname ?? null
            if (view.prefix !== item.value.prefix || view.replyStyle !== replyStyle)
                await writeGeneral(
                    ctx,
                    serverId,
                    { userId: ownerId, source: "command" },
                    { prefix: item.value.prefix, replyStyle },
                    row?.revision ?? 0,
                )
            if ((row?.nickname ?? null) !== nickname) {
                await writeNickname(
                    ctx,
                    serverId,
                    ownerId,
                    nickname,
                    (await configurationRevision(ctx, serverId, "nickname")) + 1,
                )
                await bumpConfigurationRevision(ctx, serverId, "nickname", { kind: "dashboard", createdAt: now })
            }
            break
        }
        case "analytics":
            await writeAnalyticsEnabled(ctx, serverId, { userId: ownerId, source: "command" }, item.value.enabled)
            break
        case "voiceGenerator": {
            const { channelId, ...fields } = item.value
            await saveVoiceGenerator(ctx, serverId, channelId, fields, now)
            break
        }
        case "lfg":
            await applyLfgSettings(ctx, serverId, item.value)
            break
        case "rolepicker": {
            // A role belongs to one menu, so the menus the archive does not hold go first, and a menu it holds first lets go of the
            // roles the archive puts in another menu, such as two menus that swap roles. Then each archived menu is set whole
            const current = await readRolePicker(ctx, serverId),
                archived = new Map(item.value.menus.map((menu) => [menu.name, menu]))
            for (const menu of current.menus) {
                const kept = archived.get(menu.name)?.roleIds
                if (!kept) await applyRolePickerConfiguration(ctx, serverId, { type: "menu-remove", name: menu.name })
                else if (menu.roleIds.some((id) => !kept.includes(id)))
                    await applyRolePickerConfiguration(ctx, serverId, {
                        type: "menu-set",
                        name: menu.name,
                        mode: menu.mode,
                        ...(menu.description ? { description: menu.description } : {}),
                        roleIds: menu.roleIds.filter((id) => kept.includes(id)),
                        roles: w.roles,
                    })
            }
            for (const menu of item.value.menus)
                await applyRolePickerConfiguration(ctx, serverId, { type: "menu-set", ...menu, roles: w.roles })
            await applyRolePickerConfiguration(ctx, serverId, { type: "module", enabled: item.value.enabled })
            break
        }
        case "access": {
            const { feature: name, ...lists } = item.value
            await applyMemberAccess(ctx, serverId, name, { type: "access-set", ...lists })
            break
        }
        case "temproles": {
            // A role with no durations leaves the list, so the server's roles the archive does not hold are cleared
            const archived = new Set(item.value.roles.map((role) => role.roleId))
            for (const role of (await readTemporaryRoleSettings(ctx, serverId)).roles)
                if (!archived.has(role.roleId))
                    await applyTemporaryRoleConfiguration(ctx, serverId, {
                        type: "role",
                        roleId: role.roleId,
                        defaultSeconds: null,
                        maxSeconds: null,
                    })
            for (const role of item.value.roles)
                await applyTemporaryRoleConfiguration(ctx, serverId, {
                    type: "role",
                    roleId: role.roleId,
                    defaultSeconds: role.defaultSeconds ?? null,
                    maxSeconds: role.maxSeconds ?? null,
                })
            break
        }
        case "onboarding":
            for (const operation of [
                { type: "steps", steps: item.value.steps },
                { type: "delivery", delivery: item.value.delivery },
                { type: "role", roleId: item.value.completionRoleId, roles: w.roles },
                { type: "module", enabled: item.value.enabled },
            ])
                await applyOnboardingConfiguration(ctx, serverId, operation)
            break
        case "sticky": {
            const { channelId, content, intervalSeconds } = item.value
            await applyStickyManagement(ctx, identity("sticky"), { type: "set", channelId, content, intervalSeconds })
            break
        }
        case "alerts": {
            const current = publicAlerts(await readAlerts(ctx, serverId))
            for (const alert of ["invites", "bots", "webhooks", "privileges", "impersonation"] as const)
                if (current[alert] !== item.value[alert])
                    await applyAlertsManagement(ctx, serverId, ownerId, {
                        type: "set",
                        alert,
                        enabled: item.value[alert],
                    })
            for (const action of ["kickBots", "deleteWebhooks", "removePermissions"] as const)
                if (current[action] !== item.value[action])
                    await applyAlertsManagement(ctx, serverId, ownerId, {
                        type: "action",
                        action,
                        enabled: item.value[action],
                    })
            // The lists are sets, so the same IDs in another order need no write
            const { expectedBotIds, expectedWebhookIds } = item.value,
                same = (a: readonly string[], b: readonly string[]) => {
                    const other = new Set(b)
                    return new Set(a).size === other.size && a.every((id) => other.has(id))
                }
            if (!same(expectedBotIds, current.expectedBotIds) || !same(expectedWebhookIds, current.expectedWebhookIds))
                await restoreExpectedAlerts(ctx, serverId, ownerId, { expectedBotIds, expectedWebhookIds })
            break
        }
        case "helpdesk": {
            const { forumIds, ...settings } = item.value,
                current = publicHelpDesk(await readHelpDesk(ctx, serverId))
            for (const channelId of current.forumIds)
                if (!forumIds.includes(channelId))
                    await applyHelpDeskManagement(ctx, identity("forum"), { type: "forum-remove", channelId })
            for (const channelId of forumIds)
                if (!current.forumIds.includes(channelId))
                    await applyHelpDeskManagement(ctx, identity("forum"), { type: "forum-add", channelId })
            await applyHelpDeskManagement(ctx, identity("settings"), { type: "settings", ...settings })
            break
        }
        case "helpdeskAnswer":
            await applyHelpDeskManagement(ctx, identity("answer"), { type: "answer-set", ...item.value })
            break
        case "showcase":
            await applyShowcaseConfiguration(ctx, serverId, { type: "settings", ...item.value })
            break
        case "profile":
            await applyProfileConfiguration(ctx, serverId, { type: "settings", ...item.value })
            break
        // Following again makes the YouTube subscription NeonFlux needs, with a new secret
        case "youtube":
            await applyYoutubeManagement(ctx, identity("youtube"), { type: "add", ...item.value })
            break
    }
    const family = item.family === "access" ? item.value.feature : (feature[item.family] ?? undefined)
    if (family) await bumpConfigurationRevision(ctx, serverId, family, { kind: "dashboard", createdAt: now })
    // A restore confirmed by the owner records each written item in the audit log
    await recordAudit(
        ctx,
        serverId,
        { userId: ownerId, source: "command" },
        {
            kind: "setting",
            feature: family ?? auditFeature[item.family] ?? "roles",
            setting: `restore ${item.family}`,
            summary: `Restored ${item.sourceId} from a backup`,
            ...(w.changes ? { changes: w.changes } : {}),
        },
    )
}
/** Sets a member's XP in the current season to the archived value, creating the profile when it is missing. Reward roles follow at the member's next activity */
export async function backupWriteXp(w: BackupWriter, item: BackupXpObject) {
    const profile = await ensureProfile(w.ctx, w.serverId, item.userId),
        { config } = await levelingState(w.ctx, w.serverId)
    await correctProfile(w.ctx, w.serverId, config, w.ownerId, profile, {
        type: "adjust",
        xp: item.xp,
        reason: "Restored from a backup",
        correctedAt: w.now,
    })
}
