import type { BackupConfigObject, BackupXpObject } from "@neonflux/contracts/backup"
import type { RolesRoleSnapshot } from "@neonflux/contracts/shared"
import type { MutationCtx } from "./_generated/server.js"
import type { ConfigurationIdentity } from "./validation.ts"
import { bumpConfigurationRevision } from "./configurationRevision.ts"
import { recordAudit } from "./auditLog.ts"
import { canonicalBackupJson } from "./backupDomain.ts"
import type { ValueChange } from "./valueDiff.ts"
import type { DashboardConfigurationFamily } from "../dashboard-contracts.js"
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
const feature: Partial<Record<BackupConfigObject["family"], DashboardConfigurationFamily>> = {
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
    schedules: "schedules",
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
        case "moderation":
            await applyModerationConfiguration(ctx, serverId, { type: "settings", patch: item.value }, now)
            break
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
                // Mappings and the exclusive flag take a new panel revision and ledger key, so only a difference is sent
                const patch = {
                    ...(enabled !== exists.enabled ? { enabled } : {}),
                    ...(exclusive !== exists.exclusive ? { exclusive } : {}),
                    ...(canonicalBackupJson(mappings) !== canonicalBackupJson(exists.mappings) ? { mappings } : {}),
                }
                await applyRoleManagement(
                    ctx,
                    { serverId, jobId: `${w.key}:panel` },
                    { type: "panel-update", name, expectedRevision: exists.revision, patch, roles: w.roles },
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
    }
    const family = feature[item.family]
    if (family) await bumpConfigurationRevision(ctx, serverId, family, { kind: "dashboard", createdAt: now })
    // A restore confirmed by the owner records each written item in the audit log
    await recordAudit(
        ctx,
        serverId,
        { userId: ownerId, source: "command" },
        {
            kind: "setting",
            feature: family ?? (item.family === "metadata" ? "logs" : "roles"),
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
