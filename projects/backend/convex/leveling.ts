import { v } from "convex/values"
import type { LevelingAwardResult, LevelingManageResult, LevelingPreflightResult, LevelingQueryResult, LevelingRejectReason } from "../contracts.js"
import { internalMutation, internalQuery } from "./_generated/server.js"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { actor, administrator } from "./moderationDomain.ts"
import { shape } from "./publishingDomain.ts"
import { evaluationKey, roleSnapshots, safeRole } from "./rolesDomain.ts"
import { onboardingProtection, rolePolicy } from "./roleClaims.ts"
import { rolesAdmin } from "./rolesStore.ts"
import { advance, candidate, defaultLevelingSettings, fence, levelForXp, levelMappings, levelingMember, LEVELING_CAP, LEVELING_DAY, LEVELING_WINDOW, LEVELING_XP_CAP, reason, sameFence, server, settingsPatch } from "./levelingDomain.ts"
import { currentXp, ensureProfile, levelingState, profileFence, publicAudit, publicProfile, queueLeveling, readLeveling, readProfile, startLevelingSweep, type LevelingRead } from "./levelingStore.ts"
import { fail, requireId, integer, source } from "./validation.ts"
async function admission(ctx: LevelingRead, serverId: string, message: ReturnType<typeof candidate>, state: Doc<"levelingSettings"> | null, profile: Doc<"levelingProfiles"> | null): Promise<LevelingRejectReason | null> {
    const now = Date.now(), config = state?.config ?? defaultLevelingSettings()
    if (!config.enabled) return "disabled"
    if (message.createdAt < now - LEVELING_WINDOW || message.createdAt > now + 1000 || message.createdAt <= (state?.resetAt ?? -1) || message.createdAt <= (profile?.resetAt ?? -1)) return "stale"
    if (config.excludedChannelIds.includes(message.channelId)) return "excluded"
    const receipt = await ctx.db.query("levelingAwardReceipts").withIndex("by_source", q => q.eq("serverId", serverId).eq("messageId", message.messageId)).unique()
    if (receipt) return "duplicate"
    if (profile?.digests.some(x => x.creditedAt > now - LEVELING_WINDOW && x.digest === message.digest)) return "duplicate"
    if (profile?.lastEventAt !== undefined && message.createdAt - profile.lastEventAt < config.cooldownSeconds * 1000 || profile?.lastAwardAt !== undefined && now - profile.lastAwardAt < config.cooldownSeconds * 1000) return "cooldown"
    if (!profile && (state?.profiles ?? 0) >= LEVELING_CAP) return "capacity"
    const moderation = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (moderation && moderation.config.defcon !== 3) return "policy"
    return null
}

export const preflight = internalQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<LevelingPreflightResult> => {
    const input = shape(request, ["serverId", "candidate"], ["serverId", "candidate"]), serverId = server(input.serverId), message = candidate(input.candidate)
    const state = await readLeveling(ctx, serverId), profile = await readProfile(ctx, serverId, message.userId), denied = await admission(ctx, serverId, message, state, profile), config = state?.config ?? defaultLevelingSettings()
    return denied ? { eligible: false, reason: denied } : { eligible: true, policyRevision: config.revision, fence: profileFence(config, profile) }
} })

export const award = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<LevelingAwardResult> => {
    const input = shape(request, ["serverId", "candidate", "policyRevision", "fence", "member", "observedAt"], ["serverId", "candidate", "policyRevision", "fence", "member", "observedAt"])
    const serverId = server(input.serverId), message = candidate(input.candidate), member = levelingMember(input.member), now = Date.now()
    const observedAt = integer(input.observedAt, now - 60000, now + 1000), expected = fence(input.fence), policyRevision = integer(input.policyRevision, 1, Number.MAX_SAFE_INTEGER)
    const state = await readLeveling(ctx, serverId), config = state?.config ?? defaultLevelingSettings(), old = await readProfile(ctx, serverId, message.userId)
    if (policyRevision !== config.revision || !sameFence(expected, profileFence(config, old))) return { awarded: false, reason: "fence" }
    const denied = await admission(ctx, serverId, message, state, old)
    if (denied) return { awarded: false, reason: denied }
    if (member.userId !== message.userId || member.isBot || message.createdAt < Date.parse(member.joinedAt) || Date.parse(member.joinedAt) > observedAt + 1000) return { awarded: false, reason: "membership" }
    if (config.excludedRoleIds.some(id => member.roleIds.includes(id))) return { awarded: false, reason: "excluded" }
    await onboardingProtection(ctx, serverId, member.userId, member.timeoutUntil)
    const profile = old ?? await ensureProfile(ctx, serverId, message.userId), before = currentXp(config, profile), xp = Math.min(LEVELING_XP_CAP, before + config.xpPerMessage)
    const digests = [...profile.digests.filter(x => x.creditedAt > now - LEVELING_WINDOW), { digest: message.digest, creditedAt: now }].slice(-64)
    await ctx.db.patch(profile._id, { xp, scoreEpoch: config.scoreEpoch, joinedAt: member.joinedAt, lastEventAt: message.createdAt, lastAwardAt: now, digests, digestExpiresAt: digests[0]!.creditedAt + LEVELING_WINDOW })
    await ctx.db.insert("levelingAwardReceipts", { serverId, messageId: message.messageId, userId: message.userId, createdAt: message.createdAt, digest: message.digest, expiresAt: now + LEVELING_DAY })
    const rewardQueued = config.mappings.length > 0 && (levelForXp(before) !== levelForXp(xp) || profile.joinedAt !== member.joinedAt)
    if (rewardQueued) await queueLeveling(ctx, serverId, message.userId, now)
    return { awarded: true, xpAdded: xp - before, profile: publicProfile(config, message.userId, (await ctx.db.get(profile._id))!), rewardQueued }
} })

async function audit(ctx: MutationCtx, serverId: string, actorId: string, value: { type: "adjust" | "reset-member" | "reset-server", scoreEpoch: number, reason: string, userId?: string, beforeXp?: number, afterXp?: number }) {
    const state = await levelingState(ctx, serverId), now = Date.now()
    await ctx.db.patch(state._id, { nextAuditNo: advance(state.nextAuditNo) })
    const id = await ctx.db.insert("levelingAudits", { serverId, auditNo: state.nextAuditNo, actorId, ...value, createdAt: now, expiresAt: now + 180 * LEVELING_DAY })
    return publicAudit((await ctx.db.get(id))!)
}
export const manage = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<LevelingManageResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "actor", "operation"], ["serverId", "messageId", "createdAt", "actor", "operation"])
    const now = Date.now(), identity = source(input, now), op = shape(input.operation, ["type", "expectedRevision", "patch", "expectedMappingRevision", "mappings", "roles", "userId", "xp", "reason", "confirm"])
    const critical = op.type === "reset-member" || op.type === "reset-server" || op.type === "reconcile" || op.type === "mappings" && Array.isArray(op.mappings) && !op.mappings.length || op.type === "settings" && (op.patch as { enabled?: unknown } | null)?.enabled === false
    const who = await rolesAdmin(ctx, identity.serverId, input.actor, critical)
    const operationKey = evaluationKey(op), previous = await ctx.db.query("levelingManagementReceipts").withIndex("by_source", q => q.eq("serverId", identity.serverId).eq("messageId", identity.messageId)).unique()
    if (previous) {
        if (previous.actorId !== who.userId || previous.operationKey !== operationKey || previous.createdAt !== identity.createdAt) fail(409, "Leveling source binding changed")
        return { duplicate: true }
    }
    const state = await levelingState(ctx, identity.serverId), config = state.config
    let result: LevelingManageResult
    if (op.type === "settings" || op.type === "mappings") {
        result = await applyLevelingConfiguration(ctx, identity.serverId, op, now)
    } else if (op.type === "adjust" || op.type === "reset-member") {
        const fields = ["type", "userId", "reason", op.type === "adjust" ? "xp" : "confirm"]
        shape(op, fields, fields)
        const userId = requireId(op.userId), profile = await ensureProfile(ctx, identity.serverId, userId)
        if (op.type === "reset-member" && op.confirm !== "reset-member") fail(400, "Member reset confirmation required")
        // Corrections apply in source command order, so a delayed older correction cannot restore a superseded score
        if (op.type === "adjust" && identity.createdAt < (profile.correctedAt ?? 0)) fail(409, "A newer correction was already applied")
        const xp = op.type === "adjust" ? integer(op.xp, 0, LEVELING_XP_CAP) : 0, beforeXp = currentXp(config, profile)
        const record = await audit(ctx, identity.serverId, who.userId, { type: op.type, userId, beforeXp, afterXp: xp, scoreEpoch: config.scoreEpoch, reason: reason(op.reason) })
        await ctx.db.patch(profile._id, { xp, scoreEpoch: config.scoreEpoch, adjustmentRevision: advance(profile.adjustmentRevision), correctedAt: Math.max(identity.createdAt, profile.correctedAt ?? 0), ...(op.type === "reset-member" ? { resetAt: Math.max(now, profile.resetAt ?? 0) } : {}) })
        await queueLeveling(ctx, identity.serverId, userId, now)
        result = { duplicate: false, type: "profile", profile: publicProfile(config, userId, (await ctx.db.get(profile._id))!), audit: record }
    } else if (op.type === "reset-server") {
        shape(op, ["type", "confirm", "reason"], ["type", "confirm", "reason"])
        if (op.confirm !== "reset-server") fail(400, "Server reset confirmation required")
        const settings = { ...config, scoreEpoch: advance(config.scoreEpoch) }, record = await audit(ctx, identity.serverId, who.userId, { type: "reset-server", scoreEpoch: settings.scoreEpoch, reason: reason(op.reason) })
        await ctx.db.patch(state._id, { config: settings, resetAt: Math.max(now, state.resetAt ?? 0) }); await startLevelingSweep(ctx, identity.serverId)
        result = { duplicate: false, type: "reset", settings, audit: record }
    } else if (op.type === "reconcile") {
        shape(op, ["type", "userId"], ["type"])
        if (op.userId !== undefined) { const userId = requireId(op.userId); if (await readProfile(ctx, identity.serverId, userId)) await queueLeveling(ctx, identity.serverId, userId, now) }
        else await startLevelingSweep(ctx, identity.serverId)
        result = { duplicate: false, type: "reconcile", queued: op.userId === undefined || Boolean(await readProfile(ctx, identity.serverId, requireId(op.userId))) }
    } else fail(400, "Invalid leveling management operation")
    await ctx.db.insert("levelingManagementReceipts", { serverId: identity.serverId, messageId: identity.messageId, actorId: who.userId, operationKey, createdAt: identity.createdAt, expiresAt: now + LEVELING_DAY })
    return result
} })

export const query = internalQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<LevelingQueryResult> => {
    const input = shape(request, ["serverId", "actor", "member", "observedAt", "operation"], ["serverId", "actor", "member", "observedAt", "operation"]), serverId = server(input.serverId)
    const who = actor(input.actor), member = levelingMember(input.member), now = Date.now(), observedAt = integer(input.observedAt, now - 60000, now + 1000)
    if (who.userId !== member.userId || !who.nativePermissionAuthorized || member.isBot || Date.parse(member.joinedAt) > observedAt + 1000) fail(403, "Current member permission required")
    const op = shape(input.operation, ["type", "userId", "cursor", "beforeAuditNo"]), state = await readLeveling(ctx, serverId), config = state?.config ?? defaultLevelingSettings()
    if (op.type === "settings" || op.type === "status" || op.type === "audits") { if (!administrator(who)) fail(403, "Administrator permission required") }
    else await onboardingProtection(ctx, serverId, member.userId, member.timeoutUntil)
    if (op.type === "settings") { shape(op, ["type"], ["type"]); return { type: "settings", settings: config } }
    if (op.type === "status") { shape(op, ["type"], ["type"]); return { type: "status", dirty: state?.dirty ?? 0, sweepPending: state?.sweepPending ?? false, profiles: state?.profiles ?? 0 } }
    if (op.type === "audits") {
        shape(op, ["type", "beforeAuditNo"], ["type"])
        const before = op.beforeAuditNo === undefined ? Number.MAX_SAFE_INTEGER : integer(op.beforeAuditNo, 1, Number.MAX_SAFE_INTEGER)
        const rows = await ctx.db.query("levelingAudits").withIndex("by_number", q => q.eq("serverId", serverId).lt("auditNo", before)).order("desc").take(21)
        return { type: "audits", audits: rows.slice(0, 20).map(publicAudit), ...(rows.length > 20 ? { nextBeforeAuditNo: rows[19]!.auditNo } : {}) }
    }
    if (op.type === "rank") {
        shape(op, ["type", "userId"], ["type"])
        const userId = op.userId === undefined ? who.userId : requireId(op.userId), profile = publicProfile(config, userId, await readProfile(ctx, serverId, userId))
        if (profile.xp === 0) return { type: "rank", profile, rank: { type: "unranked" } }
        const top = await ctx.db.query("levelingProfiles").withIndex("by_score", q => q.eq("serverId", serverId).eq("scoreEpoch", config.scoreEpoch).gt("xp", 0)).order("desc").take(1000)
        const index = top.findIndex(row => row.userId === userId)
        return { type: "rank", profile, rank: index < 0 ? { type: "outside-top-1000" } : { type: "exact", position: index + 1 } }
    }
    if (op.type === "leaderboard") {
        shape(op, ["type", "cursor"], ["type"])
        let rows: Doc<"levelingProfiles">[]
        if (op.cursor === undefined) rows = await ctx.db.query("levelingProfiles").withIndex("by_score", q => q.eq("serverId", serverId).eq("scoreEpoch", config.scoreEpoch).gt("xp", 0)).order("desc").take(21)
        else {
            const c = shape(op.cursor, ["xp", "userId", "scoreEpoch"], ["xp", "userId", "scoreEpoch"]), xp = integer(c.xp, 1, LEVELING_XP_CAP), userId = requireId(c.userId)
            if (integer(c.scoreEpoch, 1, Number.MAX_SAFE_INTEGER) !== config.scoreEpoch) fail(409, "Leaderboard score epoch changed")
            const ties = await ctx.db.query("levelingProfiles").withIndex("by_score", q => q.eq("serverId", serverId).eq("scoreEpoch", config.scoreEpoch).eq("xp", xp).lt("userId", userId)).order("desc").take(21)
            rows = ties.length === 21 ? ties : [...ties, ...await ctx.db.query("levelingProfiles").withIndex("by_score", q => q.eq("serverId", serverId).eq("scoreEpoch", config.scoreEpoch).gt("xp", 0).lt("xp", xp)).order("desc").take(21 - ties.length)]
        }
        const last = rows[19]
        return { type: "leaderboard", profiles: rows.slice(0, 20).map(row => publicProfile(config, row.userId, row)), ...(rows.length > 20 && last ? { nextCursor: { xp: last.xp, userId: last.userId, scoreEpoch: config.scoreEpoch } } : {}) }
    }
    fail(400, "Invalid leveling query")
} })

export async function applyLevelingConfiguration(ctx: MutationCtx, serverId: string, op: Record<string, unknown>, now: number): Promise<LevelingManageResult> {
    const identity = { serverId }, state = await levelingState(ctx, serverId), config = state.config
    let result: LevelingManageResult
    if (op.type === "settings") {
        shape(op, ["type", "expectedRevision", "patch"], ["type", "expectedRevision", "patch"])
        if (integer(op.expectedRevision, 1, Number.MAX_SAFE_INTEGER) !== config.revision) fail(409, "Leveling settings changed")
        const settings = settingsPatch(config, op.patch)
        await ctx.db.patch(state._id, { config: settings })
        if (!config.enabled && settings.enabled) await startLevelingSweep(ctx, identity.serverId)
        result = { duplicate: false, type: "settings", settings }
    } else if (op.type === "mappings") {
        shape(op, ["type", "expectedMappingRevision", "mappings", "roles"], ["type", "expectedMappingRevision", "mappings", "roles"])
        if (integer(op.expectedMappingRevision, 1, Number.MAX_SAFE_INTEGER) !== config.mappingRevision) fail(409, "Leveling mappings changed")
        const mappings = levelMappings(op.mappings), roles = roleSnapshots(op.roles), policy = await rolePolicy(ctx, identity.serverId)
        for (const map of mappings) safeRole(identity.serverId, map.roleId, roles, policy.staffRoleIds, true)
        const refs = await ctx.db.query("roleReferences").withIndex("by_consumer", q => q.eq("serverId", identity.serverId).eq("consumerKey", "level").eq("configuration", true)).take(21)
        for (const ref of refs) { await ctx.db.delete(ref._id) }
        for (const map of mappings) { await ctx.db.insert("roleReferences", { serverId: identity.serverId, consumerKey: "level", roleId: map.roleId, configuration: true, desired: true, createdAt: now }) }
        const settings = { ...config, mappingRevision: advance(config.mappingRevision), mappings }
        await ctx.db.patch(state._id, { config: settings }); await startLevelingSweep(ctx, identity.serverId)
        result = { duplicate: false, type: "settings", settings }
    } else fail(400, "Invalid leveling configuration")
    return result
}
