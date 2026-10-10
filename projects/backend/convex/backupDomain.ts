import type { BackupCapabilities, BackupCategory, BackupConfigFamily, BackupConfigObject, BackupContext, BackupManifest, BackupNativeProof, BackupStructureObject, BackupXpObject } from "../contracts.js"
import { defaultSettings, rule, settingsPatch } from "./moderationDomain.ts"
import { publishingContent, publishingName, shape } from "./publishingDomain.ts"
import * as responses from "./responseDomain.ts"
import { defaultLevelingSettings, levelMappings, settingsPatch as levelingPatch } from "./levelingDomain.ts"
import { autoroleIds, epoch, mappings, reservations } from "./rolesDomain.ts"
import { greetingTemplate } from "./greetingsDomain.ts"
import { ticketQuestions, visibility } from "./ticketDomain.ts"
import { milestoneCivil, validateMilestoneTemplate } from "./milestonesDomain.ts"
import { metadataCategories, metadataCategory, metadataEventSelector, metadataEventSelectors, metadataIds } from "./metadataLogsDomain.ts"
import { cleanupAge } from "./cleanupDomain.ts"
import { backupConfigValues } from "./backupValidators.ts"
import { fail, object, requireId, bool, ids, integer, name, text, token } from "./validation.ts"

export const BACKUP_PLAN_MS = 900000, BACKUP_RETENTION = 604800000, BACKUP_DISPATCH_MS = 120000, BACKUP_SETTLE_MS = 10000
export const BACKUP_SAFE_ALLOW = [6,9,10,11,14,15,16,20,21,25,54].reduce((mask, bit) => mask | (1n << BigInt(bit)), 0n)
export const BACKUP_KNOWN_DENY = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,20,21,22,23,24,25,26,27,28,29,30,34,35,36,37,38,40,43,51,52,53,54].reduce((mask, bit) => mask | (1n << BigInt(bit)), 0n)
export const backupExclusions = ["credentials", "native-roles", "server-settings", "messages", "private-history", "participation", "membership", "audit-history", "receipts", "leases", "cooldowns", "claims", "live-ownership", "effective-defcon", "event-definitions", "schedule-definitions"]
export const backupFamilies = Object.keys(backupConfigValues) as BackupConfigFamily[]
export function backupCapabilities(): BackupCapabilities { return { version: 1, configFamilies: backupFamilies, exclusions: backupExclusions, limits: { xp: 1000, structure: 100, overwrites: 500, planItems: 500, plans: 10, page: 20, planMs: 900000, snapshotBytes: 1048576, planBytes: 524288, originMappings: 5000 }, safeAllowMask: BACKUP_SAFE_ALLOW.toString(), knownDenyMask: BACKUP_KNOWN_DENY.toString() } }
export function canonicalBackupJson(value: unknown): string {
    if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(canonicalBackupJson).join(",")}]`
    const row = object(value)
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonicalBackupJson(row[key])}`).join(",")}}`
}
export async function backupHash(value: unknown) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalBackupJson(value))); return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("") }
export function backupDigest(value: unknown) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail(400, "Invalid backup digest"); return value }
export function backupProvider(value: unknown) {
    if (typeof value !== "string" || value.length > 2048) fail(400, "Invalid backup provider")
    try { const url = new URL(value); if (!["https:", "http:"].includes(url.protocol) || url.origin !== value || url.username || url.password) fail(400, "Invalid backup provider") } catch { fail(400, "Invalid backup provider") }
    return value
}
export function backupContext(value: unknown, now = Date.now()): BackupContext {
    const keys = ["provider", "observedAt", "ownerId", "actorId", "actorKind", "botId", "botKind", "ownerJoinedAt", "ownerTimeoutUntil", "botTimeoutUntil", "dmChannelId", "dmType", "recipientIds", "privateReplyAuthorized"], r = shape(value, keys, keys)
    const ownerId = requireId(r.ownerId), actorId = requireId(r.actorId), botId = requireId(r.botId), observedAt = integer(r.observedAt, Math.max(0, now - 60000), now + 1000), recipientIds = metadataIds(r.recipientIds, 2)
    if (actorId !== ownerId || ownerId === botId || r.actorKind !== "human" || r.botKind !== "bot" || r.dmType !== 1 || r.privateReplyAuthorized !== true || recipientIds.length !== 1 || recipientIds[0] !== ownerId) fail(403, "Fresh actual Owner and private one-to-one DM required")
    const ownerJoinedAt = epoch(r.ownerJoinedAt), ownerTimeoutUntil = r.ownerTimeoutUntil === null ? null : epoch(r.ownerTimeoutUntil), botTimeoutUntil = r.botTimeoutUntil === null ? null : epoch(r.botTimeoutUntil)
    if (Date.parse(ownerJoinedAt) > observedAt + 1000 || [ownerTimeoutUntil, botTimeoutUntil].some(x => x !== null && Date.parse(x) > now)) fail(403, "Backup participant restricted")
    return { provider: backupProvider(r.provider), observedAt, ownerId, actorId, actorKind: "human", botId, botKind: "bot", ownerJoinedAt, ownerTimeoutUntil, botTimeoutUntil, dmChannelId: requireId(r.dmChannelId), dmType: 1, recipientIds, privateReplyAuthorized: true }
}
type Schema = { type: string, value?: unknown }
export function backupSchema(value: unknown, schema: Schema): void {
    if (schema.type === "object") {
        const r = object(value), fields = schema.value as Record<string, { fieldType: Schema, optional: boolean }>
        if (Object.keys(r).some(k => !Object.hasOwn(fields, k))) fail(400, "Unknown backup field")
        for (const [k, field] of Object.entries(fields)) { if (!Object.hasOwn(r, k)) { if (!field.optional) fail(400, "Missing backup field") } else backupSchema(r[k], field.fieldType) }
    } else if (schema.type === "array") { if (!Array.isArray(value) || value.length > 1000) fail(400, "Invalid backup array"); for (const x of value) backupSchema(x, schema.value as Schema) }
    else if (schema.type === "union") { const members = schema.value as Schema[]; for (const s of members) { try { backupSchema(value, s); return } catch { /* Try the next finite schema */ } } fail(400, "Invalid backup value") }
    else if (schema.type === "literal") { if (value !== schema.value) fail(400, "Invalid backup literal") }
    else if (schema.type === "null") { if (value !== null) fail(400, "Invalid backup null") }
    else if (typeof value !== schema.type || schema.type === "number" && !Number.isFinite(value)) fail(400, "Invalid backup field")
}
export function backupConfig(value: unknown): BackupConfigObject {
    const r = shape(value, ["family", "sourceId", "value"], ["family", "sourceId", "value"])
    if (!backupFamilies.includes(r.family as BackupConfigFamily)) fail(400, "Unsupported configuration family")
    const family = r.family as BackupConfigFamily, v = object(r.value), schema = (backupConfigValues[family] as unknown as { json: Schema }).json
    backupSchema(v, schema)
    const sourceId = token(r.sourceId)
    const canonicalName = (value: unknown) => { if (name(value) !== value) fail(400, "Noncanonical configuration name") }
    switch (family) {
        case "moderation": settingsPatch(defaultSettings(), v); break
        case "response": {
            if (responses.name(v.name) !== v.name || responses.kind(v.kind) !== v.kind) fail(400, "Noncanonical response identity")
            responses.reply(v.reply); responses.ids(v.channelIds); responses.ids(v.roleIds); responses.cooldown(v.cooldownSeconds); responses.priority(v.priority)
            if (v.kind === "auto") responses.trigger(v.trigger); else if (v.trigger !== undefined) fail(400, "Custom response cannot have a trigger")
            break
        }
        case "automod": if (canonicalBackupJson(rule(v)) !== canonicalBackupJson(v)) fail(400, "Noncanonical automod rule"); break
        case "publishing": integer(v.retentionDays, 30, 3650); break
        case "draft": if (publishingName(v.name) !== v.name) fail(400, "Noncanonical draft name"); publishingContent(v.content); break
        case "roles": {
            const roleIds = ids(v.autoroleIds), reserved = v.reservations === undefined ? [] : reservations(v.reservations)
            if (autoroleIds({ autoroleIds: roleIds, reservations: reserved }).length > 1000) fail(400, "Autorole configuration supports at most 1000 distinct roles")
            break
        }
        case "panel": canonicalName(v.name); mappings(v.mappings); if (v.kind === "verification" && (v.mappings as unknown[]).length > 1) fail(400, "Verification requires one role"); break
        case "greetings": {
            integer(v.claimsPerMinute, 1, 60); integer(v.retentionDays, 30, 3650)
            for (const route of ["welcome", "dm", "goodbye"] as const) { const q = object(object(v.routes)[route]); if (q.content !== undefined) { greetingTemplate(q.content, route); name(q.templateName); integer(q.templateRevision, 1, Number.MAX_SAFE_INTEGER); if (route !== "dm") requireId(q.channelId) } else if (q.channelId !== undefined || q.templateName !== undefined || q.templateRevision !== undefined || q.enabled) fail(400, "Incomplete greeting configuration"); if (route === "dm" && q.channelId !== undefined || route === "goodbye" && q.timing !== "join") fail(400, "Invalid greeting route") }
            break
        }
        case "tickets": integer(v.retentionDays, 1, 365); break
        case "ticketCategory": {
            canonicalName(v.name); visibility(v.visibility); if (v.description !== "") text(v.description, 1000); if (v.parentId !== null) requireId(v.parentId); ids(v.supportRoleIds); ticketQuestions(v.questions)
            const canned = v.cannedReplies as Record<string, unknown>[]; if (canned.length > 20 || new Set(canned.map(x => x.name)).size !== canned.length) fail(400, "Invalid canned reply count")
            for (const c of canned) { canonicalName(c.name); canonicalName(c.templateName); integer(c.templateRevision, 1, Number.MAX_SAFE_INTEGER); publishingContent(c.content) }
            break
        }
        case "leveling": { const { mappings: maps, ...policy } = v; levelingPatch(defaultLevelingSettings(), policy); if (canonicalBackupJson(levelMappings(maps)) !== canonicalBackupJson(maps)) fail(400, "Noncanonical leveling mappings"); break }
        case "milestoneRoute": milestoneCivil({ zone: v.zone, time: v.time, fold: v.fold }); requireId(v.channelId); validateMilestoneTemplate(publishingContent(v.content), v.kind as "birthday" | "anniversary"); name(object(v.template).name); integer(object(v.template).revision, 1, Number.MAX_SAFE_INTEGER); break
        case "suggestions": if (v.enabled && v.channelId === undefined) fail(400, "Incomplete suggestion destination"); if (v.channelId !== undefined) requireId(v.channelId); break
        case "cleanupPolicy": requireId(v.channelId); requireId(v.ownerId); cleanupAge(v.ageMs); metadataIds(v.excludedAuthorIds, 50); metadataIds(v.excludedMessageIds, 100); break
        case "metadata": {
            metadataIds(v.messageChannelIds, 50); metadataIds(v.excludedChannelIds, 50)
            // Backups from before the security category have no route for it
            const routes = v.routes as Record<string, unknown>[]; if (new Set(routes.map(x => x.category)).size !== routes.length || !metadataCategories.every(c => c === "security" || routes.some(x => x.category === c))) fail(400, "All metadata routes required")
            for (const q of routes) { metadataCategory(q.category); if ((q.channelId === undefined) !== (q.ownerId === undefined) || q.enabled && q.channelId === undefined) fail(400, "Incomplete metadata route"); if (q.channelId !== undefined) { requireId(q.channelId); requireId(q.ownerId) } }
            const events = (v.eventRoutes ?? []) as Record<string, unknown>[]
            if (events.length > metadataEventSelectors.length || new Set(events.map(q => q.eventType)).size !== events.length) fail(400, "Invalid metadata event routes")
            for (const q of events) { metadataEventSelector(q.eventType); if ((q.channelId === undefined) !== (q.ownerId === undefined) || q.enabled && q.channelId === undefined) fail(400, "Incomplete metadata event route"); if (q.channelId !== undefined) { requireId(q.channelId); requireId(q.ownerId) } }
            break
        }
    }
    const result = { family, sourceId, value: v } as BackupConfigObject
    if (backupConfigIdentity(result) !== sourceId) fail(400, "Configuration source identity mismatch")
    return result
}
export function backupConfigIdentity(r: BackupConfigObject) { switch (r.family) { case "response": return `${r.value.kind}_${r.value.name}`; case "automod": case "panel": return r.value.name; case "draft": return `${r.value.kind}_${r.value.name}`; case "ticketCategory": return r.value.name; case "milestoneRoute": return r.value.kind; case "cleanupPolicy": return r.value.channelId; default: return r.family } }
export function backupDisabled(r: BackupConfigObject): BackupConfigObject {
    const value = structuredClone(r.value) as unknown as Record<string, unknown>
    for (const key of ["enabled", "customEnabled", "autoEnabled", "manualModerationEnabled", "automodEnabled", "securityEnabled", "joinEnabled", "honeypotEnabled", "watchlistEnabled", "appealsEnabled", "panelsEnabled", "verificationEnabled", "autoroleEnabled"]) if (key in value) value[key] = false
    if (r.family === "greetings") for (const q of Object.values(object(value.routes))) object(q).enabled = false
    if (r.family === "metadata") {
        value.eventRoutes ??= []
        for (const q of [...value.routes as Record<string, unknown>[], ...value.eventRoutes as Record<string, unknown>[]]) q.enabled = false
    }
    return { ...r, value } as BackupConfigObject
}
export function backupSemantic(r: BackupConfigObject) { return backupDisabled(r) }
export function backupXp(value: unknown): BackupXpObject { const r = shape(value, ["sourceId", "userId", "xp"], ["sourceId", "userId", "xp"]), userId = requireId(r.userId); if (r.sourceId !== userId) fail(400, "XP source identity mismatch"); return { sourceId: userId, userId, xp: integer(r.xp, 0, 100000000) } }
export function backupBits(value: unknown) { if (typeof value !== "string" || !/^(0|[1-9]\d{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n) fail(400, "Invalid backup permission mask"); return BigInt(value) }
export function backupStructure(value: unknown): BackupStructureObject {
    const keys = ["sourceId", "type", "name", "parentId", "overwrites", "topic", "nsfw", "slowmodeSeconds", "bitrate", "userLimit", "capturedAt"], r = shape(value, keys, ["sourceId", "type", "name", "parentId", "overwrites", "capturedAt"])
    if (!["category", "text", "voice"].includes(String(r.type)) || typeof r.name !== "string" || !r.name.trim() || r.name.length > 100 || /[\u0000-\u001f\u202e]/.test(r.name)) fail(400, "Invalid channel definition")
    if (!Array.isArray(r.overwrites) || r.overwrites.length > 100) fail(400, "Invalid channel overwrites")
    const overwrites = r.overwrites.map(x => { const q = shape(x, ["id", "type", "allow", "deny"], ["id", "type", "allow", "deny"]); if (q.type !== "role" && q.type !== "member") fail(400, "Invalid overwrite type"); const allow = backupBits(q.allow), deny = backupBits(q.deny); if ((allow & ~BACKUP_SAFE_ALLOW) || (deny & ~BACKUP_KNOWN_DENY) || (allow & deny)) fail(400, "Unsafe channel permissions"); return { id: requireId(q.id), type: q.type as "role" | "member", allow: allow.toString(), deny: deny.toString() } })
    if (new Set(overwrites.map(x => x.id)).size !== overwrites.length) fail(400, "Duplicate overwrite identity")
    const result: BackupStructureObject = { sourceId: requireId(r.sourceId), type: r.type as BackupStructureObject["type"], name: r.name, parentId: r.parentId === null ? null : requireId(r.parentId), overwrites, capturedAt: integer(r.capturedAt, 0, Number.MAX_SAFE_INTEGER) }
    if (r.type === "category" && (result.parentId !== null || ["topic", "nsfw", "slowmodeSeconds", "bitrate", "userLimit"].some(k => k in r))) fail(400, "Unsupported category fields")
    if (r.type === "text") { if (r.bitrate !== undefined || r.userLimit !== undefined) fail(400, "Unsupported text fields"); if (r.topic !== undefined) { if (r.topic !== null && (typeof r.topic !== "string" || r.topic.length > 1024)) fail(400, "Invalid channel topic"); result.topic = r.topic as string | null }; if (r.nsfw !== undefined) result.nsfw = bool(r.nsfw); if (r.slowmodeSeconds !== undefined) result.slowmodeSeconds = integer(r.slowmodeSeconds, 0, 21600) }
    if (r.type === "voice") { if (r.topic !== undefined || r.slowmodeSeconds !== undefined || r.nsfw !== undefined) fail(400, "Unsupported voice fields"); if (r.bitrate !== undefined) result.bitrate = integer(r.bitrate, 8000, 384000); if (r.userLimit !== undefined) result.userLimit = integer(r.userLimit, 0, 99) }
    if (result.parentId === result.sourceId) fail(400, "Invalid channel parent")
    return result
}
export function backupChannelSemantic(r: BackupStructureObject) { const { sourceId: _id, capturedAt: _at, ...rest } = r; return { ...rest, overwrites: [...rest.overwrites].sort((a, b) => a.id.localeCompare(b.id)) } }
export function backupSelection(value: unknown, structure = true): BackupCategory[] { if (!Array.isArray(value) || !value.length || value.length > 3 || new Set(value).size !== value.length || value.some(x => !["config", "xp", ...(structure ? ["structure"] : [])].includes(x))) fail(400, "Explicit backup selection required"); return value as BackupCategory[] }
export function backupManifest(value: unknown): BackupManifest {
    const keys = ["version", "backupId", "provider", "serverId", "selected", "capturedAt", "observations", "counts", "exclusions", "config", "xp", "structure"], r = shape(value, keys, keys)
    if (r.version !== 1) fail(400, "Unsupported backup version")
    const selected = backupSelection(r.selected), arrays: Record<string, unknown[]> = {}
    for (const [key, cap] of [["config", 500], ["xp", 1000], ["structure", 100]] as const) { if (!Array.isArray(r[key]) || (r[key] as unknown[]).length > cap || !selected.includes(key) && (r[key] as unknown[]).length) fail(413, "Backup category capacity exceeded"); arrays[key] = r[key] as unknown[] }
    const config = arrays.config!.map(backupConfig), xp = arrays.xp!.map(backupXp), structure = arrays.structure!.map(backupStructure), overwrites = structure.reduce((n, x) => n + x.overwrites.length, 0)
    if (overwrites > 500 || new Set(config.map(x => `${x.family}:${x.sourceId}`)).size !== config.length || new Set(xp.map(x => x.userId)).size !== xp.length || new Set(structure.map(x => x.sourceId)).size !== structure.length) fail(400, "Duplicate or oversized backup objects")
    const counts = shape(r.counts, ["config", "xp", "structure", "overwrites"], ["config", "xp", "structure", "overwrites"])
    if (counts.config !== config.length || counts.xp !== xp.length || counts.structure !== structure.length || counts.overwrites !== overwrites) fail(400, "Backup count mismatch")
    const observations = shape(r.observations, ["databaseAt", "structureStartedAt", "structureFinishedAt"], ["databaseAt", "structureStartedAt", "structureFinishedAt"]), capturedAt = integer(r.capturedAt, 0, Date.now() + 60000)
    for (const at of Object.values(observations)) if (at !== null) integer(at, 0, capturedAt)
    if ((selected.includes("config") || selected.includes("xp")) && observations.databaseAt === null || selected.includes("structure") && (observations.structureStartedAt === null || observations.structureFinishedAt === null || (observations.structureStartedAt as number) > (observations.structureFinishedAt as number))) fail(400, "Missing capture observation")
    if (structure.some(x => x.capturedAt < (observations.structureStartedAt as number) || x.capturedAt > (observations.structureFinishedAt as number))) fail(400, "Channel capture observation mismatch")
    if (!Array.isArray(r.exclusions) || canonicalBackupJson(r.exclusions) !== canonicalBackupJson(backupExclusions)) fail(400, "Unsupported backup exclusions")
    for (const x of structure) { const parent = structure.find(y => y.sourceId === x.parentId); if (parent && parent.type !== "category") fail(400, "Invalid selected parent") }
    return { version: 1, backupId: token(r.backupId), provider: backupProvider(r.provider), serverId: requireId(r.serverId), selected, capturedAt, observations: observations as BackupManifest["observations"], counts: { config: config.length, xp: xp.length, structure: structure.length, overwrites }, exclusions: backupExclusions, config, xp, structure }
}
export function backupNativeProof(value: unknown, serverId: string, context: BackupContext): BackupNativeProof {
    const keys = ["observedAt", "serverId", "ownerId", "botId", "actorPermissions", "botPermissions", "actorCanManageChannels", "botCanManageChannels", "references", "observations"], r = shape(value, keys, keys), now = Date.now()
    integer(r.observedAt, Math.max(0, now - 60000), now + 1000)
    if (r.serverId !== serverId || r.ownerId !== context.ownerId || r.botId !== context.botId) fail(403, "Native evidence identity mismatch")
    backupBits(r.actorPermissions); backupBits(r.botPermissions); bool(r.actorCanManageChannels); bool(r.botCanManageChannels)
    if (!Array.isArray(r.references) || r.references.length > 1000 || !Array.isArray(r.observations) || r.observations.length > 100) fail(400, "Native evidence limit exceeded")
    const references = r.references.map(x => { const keys = ["id", "type", "serverId", "observedAt", "exists", "actorCanAccess", "botCanAccess", "actorCanManage", "botCanManage", "permissions"], q = shape(x, keys, keys); requireId(q.id); if (!["role", "member", "category", "text", "voice"].includes(String(q.type)) || q.serverId !== serverId) fail(400, "Invalid native reference"); integer(q.observedAt, Math.max(0, now - 60000), now + 1000); for (const k of ["exists", "actorCanAccess", "botCanAccess", "actorCanManage", "botCanManage"]) bool(q[k]); backupBits(q.permissions); return q as BackupNativeProof["references"][number] })
    if (new Set(references.map(x => `${x.type}:${x.id}`)).size !== references.length) fail(400, "Duplicate native reference")
    const observations = r.observations.map(x => { const q = shape(x, ["sourceId", "observedAt", "status", "channel"], ["sourceId", "observedAt", "status", "channel"]); requireId(q.sourceId); integer(q.observedAt, Math.max(0, now - 60000), now + 1000); if (!["present", "absent", "unknown"].includes(String(q.status)) || (q.status === "present") !== (q.channel !== null)) fail(400, "Invalid native observation"); return { sourceId: q.sourceId, observedAt: q.observedAt, status: q.status, channel: q.channel === null ? null : backupStructure(q.channel) } as BackupNativeProof["observations"][number] })
    if (new Set(observations.map(x => x.sourceId)).size !== observations.length) fail(400, "Duplicate native observation")
    return { ...r, references, observations } as BackupNativeProof
}
