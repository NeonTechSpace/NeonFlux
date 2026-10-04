import type { BackupBinding, BackupContext, BackupItem, BackupItemBinding, BackupNativeProof, BackupOrigin, BackupPlan, BackupStructureObject } from "../contracts.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { backupBits, backupChannelSemantic, backupDigest, backupHash, canonicalBackupJson } from "./backupDomain.ts"
import { shape } from "./publishingDomain.ts"
import { fail, object, integer } from "./validation.ts"

export type BackupRead = MutationCtx | QueryCtx
export const backupItemUnresolved = (item: Doc<"backupItems">) => item.state === "reserved" || item.state === "claimed" || item.state === "uncertain" && !item.resolution || item.state === "failed" && !item.noDispatch && !item.resolution
export async function backupSetRetention(ctx: MutationCtx, plan: Doc<"backupPlans">) {
    const items = await ctx.db.query("backupItems").withIndex("by_plan", q => q.eq("planId", plan._id)).take(501)
    const unresolved = items.some(backupItemUnresolved)
    await ctx.db.patch(plan._id, { cleanupAt: unresolved ? undefined : Math.max(plan.expiresAt, Date.now()) + 604800000 })
}
export function backupBinding(value: unknown, item = false): BackupBinding | BackupItemBinding {
    const keys = ["planId", "revision", "planHash", "archiveDigest", ...(item ? ["itemNo", "generation"] : [])], r = shape(value, keys, keys)
    if (typeof r.planId !== "string" || r.planId.length > 128 || r.revision !== 1 || item && r.generation !== 1) fail(400, "Invalid restore binding")
    const base = { planId: r.planId, revision: 1 as const, planHash: backupDigest(r.planHash), archiveDigest: backupDigest(r.archiveDigest) }
    return item ? { ...base, itemNo: integer(r.itemNo, 1, 500), generation: 1 } : base
}
export async function backupPlanRow(ctx: BackupRead, serverId: string, binding: BackupBinding) {
    const id = ctx.db.normalizeId("backupPlans", binding.planId), row = id ? await ctx.db.get(id) : null
    if (!row || row.serverId !== serverId) fail(404, "Restore plan not found")
    if (row.planHash !== binding.planHash || row.archiveDigest !== binding.archiveDigest || row.revision !== binding.revision) fail(409, "Restore plan binding changed")
    return row
}
export async function backupItemRow(ctx: BackupRead, serverId: string, binding: BackupItemBinding) {
    const plan = await backupPlanRow(ctx, serverId, binding), item = await ctx.db.query("backupItems").withIndex("by_number", q => q.eq("serverId", serverId).eq("planId", plan._id).eq("itemNo", binding.itemNo)).unique()
    if (!item || item.generation !== binding.generation) fail(404, "Restore item not found")
    return { plan, item }
}
export function publicBackupPlan(row: Doc<"backupPlans">): BackupPlan { const { serverId, ownerId, provider, backupId, archiveDigest, manifestDigest, planHash, revision, createdAt, expiresAt, itemCount, counts, forgotten } = row; return { planId: row._id, serverId, ownerId, provider, backupId, archiveDigest, manifestDigest, planHash, revision, createdAt, expiresAt, itemCount, counts, forgotten, ...(row.confirmedAt !== undefined ? { confirmedAt: row.confirmedAt } : {}) } }
export function publicBackupItem(plan: Doc<"backupPlans">, item: Doc<"backupItems">): BackupItem {
    const { category, family, sourceId, itemNo, generation, disposition, reason, state, expectedHash, desiredHash, dependencyItemNo, mappedId, disabledOnCreate } = item
    return { planId: plan._id, revision: 1, planHash: plan.planHash, archiveDigest: plan.archiveDigest, category, family: family as BackupItem["family"], sourceId, itemNo, generation, disposition, reason, state, expectedHash, desiredHash, dependencyItemNo, mappedId, disabledOnCreate, ...(item.dispatchExpiresAt !== undefined ? { dispatchExpiresAt: item.dispatchExpiresAt } : {}), ...(item.claimedAt !== undefined ? { claimedAt: item.claimedAt } : {}), ...(item.finishedAt !== undefined ? { finishedAt: item.finishedAt } : {}), ...(item.noDispatch ? { noDispatch: true } : {}), ...(item.historicalOutcome ? { historicalOutcome: item.historicalOutcome } : {}), ...(item.resolution ? { resolution: item.resolution } : {}) }
}
export function publicBackupOrigin(row: Doc<"backupOrigins">): BackupOrigin { const { provider, serverId, category, family, sourceId, state, planId, itemNo, generation, mappedId, desiredHash, resolved } = row; return { provider, serverId, category, family: family as BackupOrigin["family"], sourceId, state, planId, itemNo, generation, mappedId, desiredHash, ...(resolved ? { resolved } : {}) } }
export async function backupOwner(ctx: BackupRead, serverId: string, context: BackupContext, critical = true) {
    if (!critical) { const config = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique(); if (config?.config.defcon === 1) fail(403, "DEFCON pauses restore execution") }
    for (const userId of [context.ownerId, context.botId]) {
        const rows = await ctx.db.query("securityRecoveries").withIndex("by_server_target", q => q.eq("serverId", serverId).eq("targetId", userId)).take(11)
        if (rows.length > 10) fail(403, "Backup participant restricted")
        for (const r of rows) { const c = await ctx.db.query("moderationCases").withIndex("by_server_case", q => q.eq("serverId", serverId).eq("caseNo", r.caseNo)).unique(); if (c?.action === "quarantine") fail(403, "Backup participant quarantined") }
    }
}
export function backupPlanOwner(plan: Doc<"backupPlans">, context: BackupContext, execute = false) {
    if (plan.ownerId !== context.ownerId || plan.provider !== context.provider) fail(403, "Restore requires the same actual Owner and provider")
    if (execute && (plan.forgotten || plan.confirmedAt === undefined || Date.now() >= plan.expiresAt)) fail(409, "Confirmed unexpired restore plan required")
}
export const backupOriginRow = (ctx: BackupRead, serverId: string, provider: string, category: "config" | "xp" | "structure", family: string, sourceId: string) => ctx.db.query("backupOrigins").withIndex("by_origin", q => q.eq("serverId", serverId).eq("provider", provider).eq("category", category).eq("family", family).eq("sourceId", sourceId)).unique()
export const backupReusableOrigin = (origin: Doc<"backupOrigins"> | null) => origin?.state === "failed" && origin.noDispatch === true && origin.mappedId === null
export async function backupOriginCapacity(ctx: BackupRead, serverId: string, provider: string) { if ((await ctx.db.query("backupOrigins").withIndex("by_server", q => q.eq("serverId", serverId).eq("provider", provider)).take(5001)).length >= 5000) fail(429, "Restore origin mapping capacity reached") }
export function backupNativeAccess(channel: BackupStructureObject, proof: BackupNativeProof, serverId: string): string | null {
    if (!proof.actorCanManageChannels || !proof.botCanManageChannels || !(backupBits(proof.actorPermissions) & (8n | 16n)) || !(backupBits(proof.botPermissions) & (8n | 16n))) return "ManageChannels required"
    if (channel.overwrites.length && !(backupBits(proof.botPermissions) & (8n | (1n << 28n)))) return "ManageRoles required for initial channel permissions"
    for (const overwrite of channel.overwrites) {
        const ref = proof.references.find(x => x.id === overwrite.id && x.type === overwrite.type)
        if (!ref?.exists || !ref.actorCanAccess || !ref.botCanAccess) return `Missing overwrite reference: ${overwrite.id}`
        if (overwrite.type === "role" && overwrite.id !== serverId && (!ref.actorCanManage || !ref.botCanManage)) return `Overwrite hierarchy blocks reference: ${overwrite.id}`
        const allow = backupBits(overwrite.allow), actor = backupBits(proof.actorPermissions), bot = backupBits(proof.botPermissions)
        if (!(actor & 8n) && (allow & ~actor) || !(bot & 8n) && (allow & ~bot)) return "Overwrite exceeds current authority"
    }
    if (channel.parentId !== null) { const p = proof.references.find(x => x.id === channel.parentId && x.type === "category"); if (!p?.exists || !p.actorCanAccess || !p.botCanAccess || !p.actorCanManage || !p.botCanManage) return `Missing category reference: ${channel.parentId}` }
    return null
}
export async function backupMappedChannel(ctx: BackupRead, plan: Doc<"backupPlans">, channel: BackupStructureObject) {
    if (channel.parentId === null) return channel
    const map = await backupOriginRow(ctx, plan.serverId, plan.provider, "structure", "structure", channel.parentId)
    if (map) { if (map.state !== "created" || !map.mappedId || map.resolved === "absent" || map.resolved === "conflict") return null; return { ...channel, parentId: map.mappedId } }
    return channel
}
export async function backupRewriteConfig(value: unknown, mapped: (id: string) => Promise<string>) {
    const item = structuredClone(value) as import("../contracts.js").BackupConfigObject
    const channelKeys = new Set(["channelId", "parentId", "logChannelId"]), arrays = new Set(["channelIds", "exemptChannelIds", "excludedChannelIds", "honeypotChannelIds", "messageChannelIds"])
    async function walk(value: unknown): Promise<void> {
        if (Array.isArray(value)) { for (const x of value) if (x && typeof x === "object") await walk(x); return }
        if (!value || typeof value !== "object") return
        const row = object(value)
        for (const [key, val] of Object.entries(row)) { if (channelKeys.has(key) && typeof val === "string") row[key] = await mapped(val); else if (arrays.has(key) && Array.isArray(val)) { const ids: string[] = []; for (const id of val as string[]) ids.push(await mapped(id)); row[key] = ids } else if (val && typeof val === "object") await walk(val) }
    }
    await walk(item.value)
    if (item.family === "cleanupPolicy") { item.sourceId = item.value.channelId }
    return item
}
export async function backupMappedConfig(ctx: BackupRead, plan: Pick<Doc<"backupPlans">, "serverId" | "provider">, value: unknown) {
    let blocked = false
    const item = await backupRewriteConfig(value, async id => { const origin = await backupOriginRow(ctx, plan.serverId, plan.provider, "structure", "structure", id); if (!origin) return id; if (origin.state !== "created" || !origin.mappedId || origin.resolved === "absent" || origin.resolved === "conflict") { blocked = true; return id }; return origin.mappedId })
    return blocked ? null : item
}
export async function backupConfigMappingsCurrent(ctx: BackupRead, plan: Doc<"backupPlans">, mappings: NonNullable<Doc<"backupItems">["configMappings"]>) {
    for (const mapping of mappings) {
        const origin = await backupOriginRow(ctx, plan.serverId, plan.provider, "structure", "structure", mapping.sourceId)
        if (mapping.targetId === null) {
            if (!origin || origin.state !== "created" || !origin.mappedId || origin.planId !== plan._id || origin.itemNo !== mapping.targetItemNo || origin.resolved === "absent" || origin.resolved === "conflict") return false
        } else if (origin ? origin.state !== "created" || origin.mappedId !== mapping.targetId || origin.resolved === "absent" || origin.resolved === "conflict" : mapping.targetId !== mapping.sourceId) return false
    }
    return true
}
export async function backupNativeDecision(ctx: BackupRead, plan: { serverId: string, provider: string }, channel: BackupStructureObject, proof: BackupNativeProof | null, pendingParents: Set<string> = new Set()) {
    const prior = await backupOriginRow(ctx, plan.serverId, plan.provider, "structure", "structure", channel.sourceId), origin = backupReusableOrigin(prior) ? null : prior, mappedId = origin?.mappedId ?? channel.sourceId
    if (origin && (origin.state !== "created" || origin.resolved === "absent" || origin.resolved === "conflict")) return { disposition: "blocked" as const, reason: "Prior origin creation is unresolved or unavailable", mappedId: origin.mappedId, expectedHash: await backupHash(origin) }
    if (!proof) return { disposition: "blocked" as const, reason: "Fresh native evidence required", mappedId: null, expectedHash: await backupHash(null) }
    const desired = channel.parentId && pendingParents.has(channel.parentId) ? { ...channel, parentId: null } : channel
    const access = backupNativeAccess(desired, proof, plan.serverId)
    const observation = proof.observations.find(x => x.sourceId === mappedId)
    if (!observation || observation.status === "unknown") return { disposition: "blocked" as const, reason: "Exact native identity or typed absence required", mappedId: origin?.mappedId ?? null, expectedHash: await backupHash(null) }
    if (access) return { disposition: "blocked" as const, reason: access, mappedId: origin?.mappedId ?? null, expectedHash: await backupHash(observation) }
    if (observation.status === "absent") return origin ? { disposition: "blocked" as const, reason: "Retained origin mapping is absent, no replay", mappedId: origin.mappedId, expectedHash: await backupHash(null) } : { disposition: "create" as const, reason: null, mappedId: null, expectedHash: await backupHash(null) }
    const observed = observation.channel!
    if (observed.sourceId !== mappedId) fail(400, "Native observation identity mismatch")
    const mappedDesired = channel.parentId ? await backupMappedChannel(ctx, plan as Doc<"backupPlans">, channel) : channel
    const identical = mappedDesired && canonicalBackupJson(backupChannelSemantic(observed)) === canonicalBackupJson(backupChannelSemantic(mappedDesired))
    return { disposition: identical ? "skip" as const : "conflict" as const, reason: identical ? null : "Existing exact native object conflicts", mappedId, expectedHash: await backupHash(backupChannelSemantic(observed)) }
}
export function backupGrant(plan: Doc<"backupPlans">, item: Doc<"backupItems">) {
    if (!item.desiredChannel || !item.botId || item.dispatchExpiresAt === undefined) fail(409, "Native item is not reserved")
    return { planId: plan._id, revision: 1 as const, planHash: plan.planHash, archiveDigest: plan.archiveDigest, itemNo: item.itemNo, generation: 1 as const, provider: plan.provider, serverId: plan.serverId, ownerId: plan.ownerId, botId: item.botId, sourceId: item.sourceId, channel: item.desiredChannel, dispatchExpiresAt: item.dispatchExpiresAt, nativeDeadlineMs: 5000 as const }
}
