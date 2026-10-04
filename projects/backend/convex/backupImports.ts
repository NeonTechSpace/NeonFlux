import type { BackupConfigObject, BackupContext, BackupNativeProof, BackupXpObject } from "../contracts.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { backupConfigIdentity, backupDisabled, backupHash, backupSemantic, canonicalBackupJson } from "./backupDomain.ts"
import { backupConfigRows, projectBackupConfig } from "./backupProjections.ts"
import { canonicalPublishingContent } from "./publishingDomain.ts"
import { defaultLevelingSettings } from "./levelingDomain.ts"
import { currentXp, levelingState, levelingCount, readLeveling, readProfile } from "./levelingStore.ts"
import { rolesState, protectedStaffRoles } from "./rolesStore.ts"
import { autoroleIds, consumerKey, safeRole } from "./rolesDomain.ts"
import { rolePolicy } from "./roleClaims.ts"
import { protectTicketRoles, ticketNumber, ticketState } from "./ticketStore.ts"
import { greetingState } from "./greetingLifecycle.ts"
import { state as moderationState } from "./moderationStore.ts"
import { milestoneState } from "./milestonesStore.ts"
import { suggestionState } from "./suggestionsStore.ts"
import { cleanupCount, cleanupState } from "./cleanupStore.ts"
import { metadataState } from "./metadataLogsStore.ts"
import { eventState } from "./eventsStore.ts"
import { scheduleState } from "./schedulesStore.ts"
import { fail, object } from "./validation.ts"

type Read = QueryCtx | MutationCtx
async function backupCurrentConfig(ctx: Read, serverId: string, item: BackupConfigObject): Promise<{ row: (Record<string, unknown> & { _id: string }) | null, value: BackupConfigObject | null, hash: string }> {
    const rows = await backupConfigRows(ctx, serverId, item.family)
    const row = rows.find(row => backupConfigIdentity(projectBackupConfig(item.family, row)) === item.sourceId)
    if (!row) return { row: null, value: null, hash: await backupHash(null) }
    const value = projectBackupConfig(item.family, row), r = object(row), raw = "config" in r ? object(r.config) : r
    // Hash current authored state and domain revisions, excluding operational counters
    const revisions = Object.fromEntries(["revision", "configRevision", "mappingRevision", "scoreEpoch", "intentRevision", "audienceGeneration", "configured", "published", "withdrawing"].filter(k => raw[k] !== undefined).map(k => [k, raw[k]]))
    return { row, value, hash: await backupHash({ id: r._id, value, revisions }) }
}
async function backupCurrentXp(ctx: Read, serverId: string, item: BackupXpObject): Promise<{ row: Doc<"levelingProfiles"> | null, xp: number, hash: string }> {
    const state = await readLeveling(ctx, serverId), policy = state?.config ?? defaultLevelingSettings(), row = await readProfile(ctx, serverId, item.userId)
    const xp = currentXp(policy, row)
    return { row, xp, hash: await backupHash({ id: row?._id ?? null, xp: row ? xp : null, epoch: policy.scoreEpoch, adjustmentRevision: row?.adjustmentRevision ?? null, resetAt: row?.resetAt ?? null }) }
}
async function backupConfigurationCapacity(ctx: Read, serverId: string, item: BackupConfigObject, planned: BackupConfigObject[]): Promise<string | null> {
    const same = planned.filter(x => x.family === item.family), rows = await backupConfigRows(ctx, serverId, item.family)
    if (item.family === "response" || item.family === "automod" || item.family === "draft") {
        if (rows.length + same.length >= 100) return `${item.family} configuration capacity reached`
    }
    if (item.family === "panel" && rows.filter(x => object(x).kind === item.value.kind).length + same.filter(x => x.family === "panel" && x.value.kind === item.value.kind).length >= (item.value.kind === "reaction" ? 50 : 1)) return "Role panel capacity reached"
    if (item.family === "ticketCategory" && rows.length + same.length >= 20) return "Ticket category capacity reached"
    if (item.family === "cleanupPolicy") { const state = await ctx.db.query("cleanupSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique(); if (rows.length + same.length >= 50 || (state?.policies ?? 0) + same.length >= 50) return "Cleanup policy capacity reached" }
    return null
}
function backupConfigReferences(item: BackupConfigObject): { id: string, type: "role" | "member" | "category" | "text", safeRole?: boolean, staff?: boolean }[] {
    const refs: ReturnType<typeof backupConfigReferences> = [], role = (id: string, safe = false, staff = false) => refs.push({ id, type: "role", ...(safe ? { safeRole: true } : {}), ...(staff ? { staff: true } : {}) }), channel = (id: string | null | undefined, type: "category" | "text" = "text") => { if (id) refs.push({ id, type }) }, owner = (id: string | undefined) => { if (id) refs.push({ id, type: "member" }) }
    switch (item.family) {
        case "moderation": Object.values(item.value.staffRoleIds).flat().forEach(id => role(id, false, true)); channel(item.value.logChannelId); item.value.honeypotChannelIds.forEach(id => channel(id)); break
        case "response": item.value.roleIds.forEach(id => role(id)); item.value.channelIds.forEach(id => channel(id)); break
        case "automod": item.value.exemptRoleIds.forEach(id => role(id)); [...item.value.channelIds, ...item.value.exemptChannelIds].forEach(id => channel(id)); break
        case "roles": autoroleIds(item.value).forEach(id => role(id, true)); break
        case "panel": item.value.mappings.forEach(m => { role(m.roleId, true); [...m.prerequisiteRoleIds, ...m.exclusionRoleIds].forEach(id => role(id)) }); break
        case "greetings": Object.values(item.value.routes).forEach(q => channel(q.channelId)); break
        case "ticketCategory": channel(item.value.parentId, "category"); item.value.supportRoleIds.forEach(id => role(id, false, true)); break
        case "leveling": item.value.excludedRoleIds.forEach(id => role(id)); item.value.excludedChannelIds.forEach(id => channel(id)); item.value.mappings.forEach(m => role(m.roleId, true)); break
        case "milestoneRoute": channel(item.value.channelId); break
        case "suggestions": channel(item.value.channelId); break
        case "cleanupPolicy": channel(item.value.channelId); owner(item.value.ownerId); break
        case "metadata": [...item.value.routes, ...item.value.eventRoutes ?? []].forEach(q => { channel(q.channelId); owner(q.ownerId) }); [...item.value.messageChannelIds, ...item.value.excludedChannelIds].forEach(id => channel(id)); break
    }
    return refs
}
async function backupValidateConfigReferences(ctx: Read, serverId: string, item: BackupConfigObject, context: BackupContext, proof: BackupNativeProof | null, pendingChannels: Map<string, string> = new Map()): Promise<string | null> {
    const refs = backupConfigReferences(item)
    if (refs.length && !proof) return "Fresh configuration references required"
    const roles = proof?.references.filter(x => x.type === "role").map(x => ({ roleId: x.id, permissions: x.permissions, actorCanManage: x.actorCanManage, botCanManage: x.botCanManage })) ?? [], policy = await rolePolicy(ctx, serverId)
    for (const ref of refs) {
        if ((ref.type === "text" || ref.type === "category") && pendingChannels.get(ref.id) === ref.type) continue
        const evidence = proof?.references.find(x => x.id === ref.id && x.type === ref.type)
        if (!evidence?.exists || !evidence.actorCanAccess || !evidence.botCanAccess) return `Missing ${ref.type} reference: ${ref.id}`
        if (ref.type === "role" && (!evidence.actorCanManage || !evidence.botCanManage)) return `Role hierarchy blocks reference: ${ref.id}`
        if (ref.type === "member" && ref.id !== context.ownerId) return "Restored route ownership must be current Owner"
        if (ref.safeRole) { try { safeRole(serverId, ref.id, roles, policy.staffRoleIds, true) } catch { return `Role policy blocks reference: ${ref.id}` } }
        if (ref.staff && ref.id === serverId) return "Everyone cannot be a staff role"
        if (ref.staff && (await ctx.db.query("roleReferences").withIndex("by_server_role", q => q.eq("serverId", serverId).eq("roleId", ref.id)).first() || await ctx.db.query("roleOwnership").withIndex("by_server_role", q => q.eq("serverId", serverId).eq("roleId", ref.id).eq("protected", true)).first())) return `Role retained by onboarding: ${ref.id}`
    }
    if (item.family === "metadata") {
        const destinations = [...item.value.routes, ...item.value.eventRoutes ?? []].flatMap(x => x.channelId ? [x.channelId] : []), channels = item.value.messageChannelIds
        if (channels.some(x => destinations.includes(x) || item.value.excludedChannelIds.includes(x))) return "Metadata message channels conflict with exclusions or destinations"
        for (const id of channels) if (await ctx.db.query("tickets").withIndex("by_channel", q => q.eq("serverId", serverId).eq("channelId", id)).first()) return "Private ticket channel cannot be a metadata message source"
    }
    return null
}
async function backupImportXp(ctx: MutationCtx, serverId: string, item: BackupXpObject): Promise<{ created: boolean, mappedId: string }> {
    const current = await backupCurrentXp(ctx, serverId, item)
    if (current.row) { if (current.xp !== item.xp) fail(409, "Effective XP conflicts"); return { created: false, mappedId: current.row._id } }
    const state = await levelingState(ctx, serverId)
    await levelingCount(ctx, serverId, "profiles", 1)
    const id = await ctx.db.insert("levelingProfiles", { serverId, userId: item.userId, xp: item.xp, scoreEpoch: state.config.scoreEpoch, adjustmentRevision: 0, resetAt: Date.now(), digests: [] })
    return { created: true, mappedId: id }
}
async function configurationRefs(ctx: MutationCtx, serverId: string, key: string, roleIds: string[]) {
    for (const roleId of roleIds) { await ctx.db.insert("roleReferences", { serverId, consumerKey: key, roleId, configuration: true, desired: true, createdAt: Date.now() }) }
}
async function backupImportConfig(ctx: MutationCtx, serverId: string, item: BackupConfigObject, ownerId: string): Promise<{ created: boolean, mappedId: string }> {
    const current = await backupCurrentConfig(ctx, serverId, item)
    if (current.row) {
        if (canonicalBackupJson(backupSemantic(current.value!)) !== canonicalBackupJson(backupSemantic(item))) fail(409, "Authored configuration conflicts")
        return { created: false, mappedId: current.row._id }
    }
    const disabled = backupDisabled(item), now = Date.now()
    let mappedId: string
    switch (disabled.family) {
        case "moderation": { await protectedStaffRoles(ctx, serverId, Object.values(disabled.value.staffRoleIds).flat()); const state = await moderationState(ctx, serverId); await ctx.db.patch(state._id, { config: { ...disabled.value, defcon: state.config.defcon } }); mappedId = state._id; break }
        case "responses": mappedId = await ctx.db.insert("responseSettings", { serverId, ...disabled.value, customRevision: 1, autoRevision: 1 }); break
        case "response": { const rows = await backupConfigRows(ctx, serverId, "response"); if (rows.length >= 100) fail(429, "Response definition capacity reached"); mappedId = await ctx.db.insert("responseDefinitions", { serverId, ...disabled.value, createdAt: now, updatedAt: now }); break }
        case "automod": { if ((await backupConfigRows(ctx, serverId, "automod")).length >= 100) fail(429, "Automod capacity reached"); mappedId = await ctx.db.insert("automodRules", { serverId, name: disabled.value.name, rule: disabled.value }); break }
        case "publishing": mappedId = await ctx.db.insert("publishingSettings", { serverId, enabled: disabled.value.enabled, nextPostNo: 1 }); break
        case "draft": {
            const existing = await ctx.db.query("publishingSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
            if (!existing) await ctx.db.insert("publishingSettings", { serverId, enabled: false, nextPostNo: 1 })
            if ((await backupConfigRows(ctx, serverId, "draft")).length >= 100) fail(429, "Publishing draft capacity reached")
            mappedId = await ctx.db.insert("publishingDrafts", { serverId, ...disabled.value, revision: 1, canonicalContent: canonicalPublishingContent(disabled.value.content), createdAt: now, updatedAt: now }); break
        }
        case "roles": { const state = await rolesState(ctx, serverId); await ctx.db.patch(state._id, { config: { ...disabled.value, revision: state.config.revision } }); await configurationRefs(ctx, serverId, `autorole:${state.config.revision}`, autoroleIds(disabled.value)); mappedId = state._id; break }
        case "panel": {
            const rows = await backupConfigRows(ctx, serverId, "panel"); if (rows.filter(x => object(x).kind === disabled.value.kind).length >= (disabled.value.kind === "reaction" ? 50 : 1)) fail(429, "Role panel capacity reached")
            const state = await rolesState(ctx, serverId), revision = state.nextPanelRevision; if (revision >= Number.MAX_SAFE_INTEGER) fail(429, "Panel revision exhausted")
            await ctx.db.patch(state._id, { nextPanelRevision: revision + 1 }); mappedId = await ctx.db.insert("rolePanels", { serverId, ...disabled.value, revision, withdrawing: false }); await configurationRefs(ctx, serverId, consumerKey(disabled.value.name, revision), disabled.value.mappings.map(x => x.roleId)); break
        }
        case "greetings": { const state = await greetingState(ctx, serverId); const routes = { welcome: { ...disabled.value.routes.welcome, revision: 1 }, dm: { ...disabled.value.routes.dm, revision: 1 }, goodbye: { ...disabled.value.routes.goodbye, revision: 1 } }; await ctx.db.patch(state._id, { config: { ...disabled.value, routes } }); mappedId = state._id; break }
        case "tickets": { const state = await ticketState(ctx, serverId); await ctx.db.patch(state._id, { config: disabled.value }); mappedId = state._id; break }
        case "ticketCategory": { await protectTicketRoles(ctx, serverId, disabled.value.supportRoleIds, "configurationRefs", 1); const revision = await ticketNumber(ctx, serverId, "nextCategoryRevision"); mappedId = await ctx.db.insert("ticketCategories", { serverId, config: { ...disabled.value, revision } }); break }
        case "leveling": { const state = await levelingState(ctx, serverId); await ctx.db.patch(state._id, { config: { ...disabled.value, revision: state.config.revision, mappingRevision: state.config.mappingRevision, scoreEpoch: state.config.scoreEpoch } }); await configurationRefs(ctx, serverId, "level", disabled.value.mappings.map(x => x.roleId)); mappedId = state._id; break }
        case "milestones": { const state = await milestoneState(ctx, serverId); mappedId = state._id; break }
        case "milestoneRoute": { await milestoneState(ctx, serverId); mappedId = await ctx.db.insert("milestoneRoutes", { serverId, ...disabled.value, revision: 1, intentRevision: 1, audienceGeneration: 1, createdBy: ownerId, configured: true, canonicalContent: canonicalPublishingContent(disabled.value.content), activatedAt: 0, createdAt: now, updatedAt: now }); break }
        case "suggestions": { const state = await suggestionState(ctx, serverId), { ownerId: _owner, ...value } = disabled.value; await ctx.db.patch(state._id, value); mappedId = state._id; break }
        case "cleanup": mappedId = (await cleanupState(ctx, serverId))._id; break
        case "cleanupPolicy": { await cleanupCount(ctx, serverId, "policies", 1); mappedId = await ctx.db.insert("cleanupPolicies", { serverId, ...disabled.value, revision: 1, nextCheckAt: now }); break }
        case "metadata": { const state = await metadataState(ctx, serverId); await ctx.db.patch(state._id, { ...disabled.value, configRevision: (state.configRevision ?? 0) + 1, routes: disabled.value.routes.map(q => ({ ...q, revision: 1 })), eventRoutes: (disabled.value.eventRoutes ?? []).map(q => ({ ...q, revision: 1 })) }); mappedId = state._id; break }
        case "events": mappedId = (await eventState(ctx, serverId))._id; break
        case "schedules": mappedId = (await scheduleState(ctx, serverId))._id; break
    }
    return { created: true, mappedId }
}

export const backupImports = { backupCurrentConfig, backupCurrentXp, backupConfigurationCapacity, backupConfigReferences, backupValidateConfigReferences, backupImportXp, backupImportConfig }
