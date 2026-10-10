import { BACKUP_KNOWN_DENY, BACKUP_PLAN_MS, BACKUP_SAFE_ALLOW, BackupConfigObject, BackupContext, BackupStructureObject, BackupXpObject, backupConfigFamilies, backupExclusions, backupWithinLimits, type BackupCapabilities,
    type BackupManifest, type BackupNativeProof } from "@neonflux/contracts/backup"
import { rule } from "./moderationDomain.ts"
import { publishingContent } from "./publishingDomain.ts"
import * as responses from "./responseDomain.ts"
import { levelMappings } from "./levelingDomain.ts"
import { autoroleIds } from "./rolesDomain.ts"
import { greetingTemplate } from "./greetingsDomain.ts"
import { ticketQuestions } from "./ticketDomain.ts"
import { milestoneCivil, validateMilestoneTemplate } from "./milestonesDomain.ts"
import { decode, fail, object, text } from "./validation.ts"

export { BACKUP_KNOWN_DENY, BACKUP_PLAN_MS, BACKUP_SAFE_ALLOW, backupConfigIdentity, backupExclusions } from "@neonflux/contracts/backup"
export const BACKUP_RETENTION = 604800000, BACKUP_DISPATCH_MS = 120000, BACKUP_SETTLE_MS = 10000
export const backupFamilies = backupConfigFamilies
export function backupCapabilities(): BackupCapabilities { return { version: 1, configFamilies: backupFamilies, exclusions: backupExclusions, limits: { xp: 1000, structure: 100, overwrites: 500, planItems: 500, plans: 10, page: 20, planMs: BACKUP_PLAN_MS, snapshotBytes: 1048576, planBytes: 524288, originMappings: 5000 }, safeAllowMask: BACKUP_SAFE_ALLOW.toString(), knownDenyMask: BACKUP_KNOWN_DENY.toString() } }
export function canonicalBackupJson(value: unknown): string {
    if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(canonicalBackupJson).join(",")}]`
    const row = object(value)
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonicalBackupJson(row[key])}`).join(",")}}`
}
export async function backupHash(value: unknown) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalBackupJson(value))); return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("") }
/** The owner, the actor and the private one-to-one DM, read by the bot within the last minute */
export function backupContext(value: unknown, now = Date.now()): BackupContext {
    const context = decode(BackupContext, value), { ownerId, recipientIds } = context
    if (context.observedAt < Math.max(0, now - 60000) || context.observedAt > now + 1000) fail(400, "Stale backup evidence")
    if (context.actorId !== ownerId || ownerId === context.botId || !context.privateReplyAuthorized || recipientIds.length !== 1 || recipientIds[0] !== ownerId) fail(403, "Fresh actual Owner and private one-to-one DM required")
    if (Date.parse(context.ownerJoinedAt) > context.observedAt + 1000 || [context.ownerTimeoutUntil, context.botTimeoutUntil].some(x => x !== null && Date.parse(x) > now)) fail(403, "Backup participant restricted")
    return context
}
// What a restored setting must also meet of its feature's own rules, beyond its shape
function configRules(item: BackupConfigObject) {
    switch (item.family) {
        case "response": if (responses.name(item.value.name) !== item.value.name) fail(400, "Noncanonical response identity"); responses.reply(item.value.reply); break
        case "automod": if (canonicalBackupJson(rule(item.value)) !== canonicalBackupJson(item.value)) fail(400, "Noncanonical automod rule"); break
        case "draft": publishingContent(item.value.content); break
        case "roles": if (autoroleIds(item.value).length > 1000) fail(400, "Autorole configuration supports at most 1000 distinct roles"); break
        case "greetings": for (const route of ["welcome", "dm", "goodbye"] as const) { const content = item.value.routes[route].content; if (content !== undefined) greetingTemplate(content, route) } break
        case "ticketCategory": {
            if (item.value.description !== "") text(item.value.description, 1000)
            ticketQuestions(item.value.questions)
            for (const reply of item.value.cannedReplies) publishingContent(reply.content)
            break
        }
        case "leveling": if (canonicalBackupJson(levelMappings(item.value.mappings)) !== canonicalBackupJson(item.value.mappings)) fail(400, "Noncanonical leveling mappings"); break
        case "milestoneRoute": { const { zone, time, fold, content, kind } = item.value; milestoneCivil({ zone, time, fold }); validateMilestoneTemplate(publishingContent(content), kind); break }
    }
}
export function backupConfig(value: unknown): BackupConfigObject {
    const item = decode(BackupConfigObject, value)
    configRules(item)
    return item
}
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
export const backupXp = (value: unknown): BackupXpObject => decode(BackupXpObject, value)
export const backupBits = (value: string) => BigInt(value)
export const backupStructure = (value: unknown): BackupStructureObject => decode(BackupStructureObject, value)
export function backupChannelSemantic(r: BackupStructureObject) { const { sourceId: _id, capturedAt: _at, ...rest } = r; return { ...rest, overwrites: [...rest.overwrites].sort((a, b) => a.id.localeCompare(b.id)) } }
/** A decoded archive's limits, capture time and configuration rules */
export function backupManifest(manifest: BackupManifest, now = Date.now()): BackupManifest {
    if (!backupWithinLimits(manifest)) fail(413, "Backup category capacity exceeded")
    if (manifest.capturedAt > now + 60000) fail(400, "Invalid backup capture time")
    for (const item of manifest.config) configRules(item)
    return manifest
}
/** Fresh native evidence of the request's server, read for the context's owner and bot */
export function backupNativeProof(proof: BackupNativeProof, serverId: string, context: BackupContext): BackupNativeProof {
    const now = Date.now(), fresh = (at: number) => { if (at < Math.max(0, now - 60000) || at > now + 1000) fail(400, "Stale native evidence") }
    fresh(proof.observedAt)
    if (proof.serverId !== serverId || proof.ownerId !== context.ownerId || proof.botId !== context.botId) fail(403, "Native evidence identity mismatch")
    for (const reference of proof.references) { if (reference.serverId !== serverId) fail(400, "Invalid native reference"); fresh(reference.observedAt) }
    for (const observation of proof.observations) fresh(observation.observedAt)
    // Plan items hash an observation without the server it was read from
    return { ...proof, observations: proof.observations.map(({ originServerId: _origin, ...observation }) => observation) }
}
