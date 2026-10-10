import { changeConfiguration } from "./configurationChange.ts"
import { v } from "convex/values"
import { LevelingAwardRequest, LevelingManageOperation, LevelingManageRequest, LevelingPreflightRequest, LevelingQueryRequest, type LevelingAwardResult, type LevelingCandidate, type LevelingManageResult,
    type LevelingPreflightResult, type LevelingQueryResult, type LevelingRejectReason } from "@neonflux/contracts/leveling"
import { serviceMutation, serviceQuery } from "./installations.ts"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { actor, administrator } from "./moderationDomain.ts"
import { evaluationKey, roleSnapshots, safeRole } from "./rolesDomain.ts"
import { onboardingProtection, rolePolicy } from "./roleClaims.ts"
import { rolesAdmin } from "./rolesStore.ts"
import { advance, defaultLevelingSettings, levelForXp, levelMappings, LEVELING_CAP, LEVELING_DAY, LEVELING_WINDOW, LEVELING_XP_CAP, observed, sameFence, server, settingsPatch } from "./levelingDomain.ts"
import { currentXp, dropRankCounts, ensureProfile, levelingRank, levelingState, profileFence, publicAudit, publicProfile, queueLeveling, rankProfile, readLeveling, readProfile, startLevelingSweep, type LevelingRead } from "./levelingStore.ts"
import { decode, fail, listsChannel, source } from "./validation.ts"
async function admission(ctx: LevelingRead, serverId: string, message: LevelingCandidate, state: Doc<"levelingSettings"> | null, profile: Doc<"levelingProfiles"> | null): Promise<LevelingRejectReason | null> {
    const now = Date.now(), config = state?.config ?? defaultLevelingSettings()
    if (!config.enabled) return "disabled"
    if (message.createdAt < now - LEVELING_WINDOW || message.createdAt > now + 1000 || message.createdAt <= (state?.resetAt ?? -1) || message.createdAt <= (profile?.resetAt ?? -1)) return "stale"
    if (listsChannel(config.excludedChannelIds, message.channelId, message.parentChannelId)) return "excluded"
    const receipt = await ctx.db.query("levelingAwardReceipts").withIndex("by_source", q => q.eq("serverId", serverId).eq("messageId", message.messageId)).unique()
    if (receipt) return "duplicate"
    if (profile?.digests.some(x => x.creditedAt > now - LEVELING_WINDOW && x.digest === message.digest)) return "duplicate"
    if (profile?.lastEventAt !== undefined && message.createdAt - profile.lastEventAt < config.cooldownSeconds * 1000 || profile?.lastAwardAt !== undefined && now - profile.lastAwardAt < config.cooldownSeconds * 1000) return "cooldown"
    if (!profile && (state?.profiles ?? 0) >= LEVELING_CAP) return "capacity"
    const moderation = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (moderation && moderation.config.defcon !== 3) return "policy"
    return null
}

export const preflight = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<LevelingPreflightResult> => {
    const input = decode(LevelingPreflightRequest, request), serverId = server(input.serverId), message = input.candidate
    const state = await readLeveling(ctx, serverId), profile = await readProfile(ctx, serverId, message.userId), denied = await admission(ctx, serverId, message, state, profile), config = state?.config ?? defaultLevelingSettings()
    return denied ? { eligible: false, reason: denied } : { eligible: true, policyRevision: config.revision, fence: profileFence(config, profile) }
} })

export const award = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<LevelingAwardResult> => {
    const input = decode(LevelingAwardRequest, request), serverId = server(input.serverId), message = input.candidate, member = input.member, now = Date.now()
    const observedAt = observed(input.observedAt, now), expected = input.fence, policyRevision = input.policyRevision
    const state = await readLeveling(ctx, serverId), config = state?.config ?? defaultLevelingSettings(), old = await readProfile(ctx, serverId, message.userId)
    if (policyRevision !== config.revision || !sameFence(expected, profileFence(config, old))) return { awarded: false, reason: "fence" }
    const denied = await admission(ctx, serverId, message, state, old)
    if (denied) return { awarded: false, reason: denied }
    if (member.userId !== message.userId || member.isBot || message.createdAt < Date.parse(member.joinedAt) || Date.parse(member.joinedAt) > observedAt + 1000) return { awarded: false, reason: "membership" }
    if (config.excludedRoleIds.some(id => member.roleIds.includes(id))) return { awarded: false, reason: "excluded" }
    await onboardingProtection(ctx, serverId, member.userId, member.timeoutUntil)
    const profile = old ?? await ensureProfile(ctx, serverId, message.userId), before = currentXp(config, profile), xp = Math.min(LEVELING_XP_CAP, before + config.xpPerMessage)
    const digests = [...profile.digests.filter(x => x.creditedAt > now - LEVELING_WINDOW), { digest: message.digest, creditedAt: now }].slice(-64)
    await ctx.db.patch(profile._id, { xp, scoreEpoch: config.scoreEpoch, joinedAt: member.joinedAt, lastEventAt: message.createdAt, lastAwardAt: now, digests, digestExpiresAt: digests[0]!.creditedAt + LEVELING_WINDOW, ...await rankProfile(ctx, profile, xp, config.scoreEpoch) })
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
export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<LevelingManageResult> => {
    const input = decode(LevelingManageRequest, request), now = Date.now(), identity = source(input, now), op = input.operation
    const critical = op.type === "reset-member" || op.type === "reset-server" || op.type === "reconcile" || op.type === "mappings" && !op.mappings.length || op.type === "settings" && op.patch.enabled === false
    const who = await rolesAdmin(ctx, identity.serverId, input.actor, critical)
    const operationKey = evaluationKey(op), previous = await ctx.db.query("levelingManagementReceipts").withIndex("by_source", q => q.eq("serverId", identity.serverId).eq("messageId", identity.messageId)).unique()
    if (previous) {
        if (previous.actorId !== who.userId || previous.operationKey !== operationKey || previous.createdAt !== identity.createdAt) fail(409, "Leveling source binding changed")
        return { duplicate: true }
    }
    const state = await levelingState(ctx, identity.serverId), config = state.config
    let result: LevelingManageResult
    if (op.type === "settings" || op.type === "mappings") {
        result = await changeConfiguration(ctx, identity.serverId, "leveling", { kind: "chat", createdAt: identity.createdAt, actor: { userId: who.userId, source: "command" }, operation: op },
            () => applyLevelingConfiguration(ctx, identity.serverId, op, now))
    } else if (op.type === "adjust" || op.type === "reset-member") {
        const userId = op.userId, profile = await ensureProfile(ctx, identity.serverId, userId)
        // Corrections apply in source command order, so a delayed older correction cannot restore a superseded score
        if (op.type === "adjust" && identity.createdAt < (profile.correctedAt ?? 0)) fail(409, "A newer correction was already applied")
        const xp = op.type === "adjust" ? op.xp : 0, beforeXp = currentXp(config, profile)
        const record = await audit(ctx, identity.serverId, who.userId, { type: op.type, userId, beforeXp, afterXp: xp, scoreEpoch: config.scoreEpoch, reason: op.reason })
        await ctx.db.patch(profile._id, { xp, scoreEpoch: config.scoreEpoch, adjustmentRevision: advance(profile.adjustmentRevision), correctedAt: Math.max(identity.createdAt, profile.correctedAt ?? 0), ...(op.type === "reset-member" ? { resetAt: Math.max(now, profile.resetAt ?? 0) } : {}), ...await rankProfile(ctx, profile, xp, config.scoreEpoch) })
        await queueLeveling(ctx, identity.serverId, userId, now)
        result = { duplicate: false, type: "profile", profile: publicProfile(config, userId, (await ctx.db.get(profile._id))!), audit: record }
    } else if (op.type === "reset-server") {
        const settings = { ...config, scoreEpoch: advance(config.scoreEpoch) }, record = await audit(ctx, identity.serverId, who.userId, { type: "reset-server", scoreEpoch: settings.scoreEpoch, reason: op.reason })
        await ctx.db.patch(state._id, { config: settings, resetAt: Math.max(now, state.resetAt ?? 0) }); await dropRankCounts(ctx, identity.serverId, settings.scoreEpoch); await startLevelingSweep(ctx, identity.serverId)
        result = { duplicate: false, type: "reset", settings, audit: record }
    } else {
        if (op.userId !== undefined) { if (await readProfile(ctx, identity.serverId, op.userId)) await queueLeveling(ctx, identity.serverId, op.userId, now) }
        else await startLevelingSweep(ctx, identity.serverId)
        result = { duplicate: false, type: "reconcile", queued: op.userId === undefined || Boolean(await readProfile(ctx, identity.serverId, op.userId)) }
    }
    await ctx.db.insert("levelingManagementReceipts", { serverId: identity.serverId, messageId: identity.messageId, actorId: who.userId, operationKey, createdAt: identity.createdAt, expiresAt: now + LEVELING_DAY })
    return result
} })

export const query = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<LevelingQueryResult> => {
    const input = decode(LevelingQueryRequest, request), serverId = server(input.serverId)
    const who = actor(input.actor), member = input.member, now = Date.now(), observedAt = observed(input.observedAt, now)
    if (who.userId !== member.userId || !who.nativePermissionAuthorized || member.isBot || Date.parse(member.joinedAt) > observedAt + 1000) fail(403, "Current member permission required")
    const op = input.operation, state = await readLeveling(ctx, serverId), config = state?.config ?? defaultLevelingSettings()
    if (op.type === "settings" || op.type === "status" || op.type === "audits") { if (!administrator(who)) fail(403, "Administrator permission required") }
    else await onboardingProtection(ctx, serverId, member.userId, member.timeoutUntil)
    if (op.type === "settings") return { type: "settings", settings: config }
    if (op.type === "status") return { type: "status", dirty: state?.dirty ?? 0, sweepPending: state?.sweepPending ?? false, profiles: state?.profiles ?? 0 }
    if (op.type === "audits") {
        const before = op.beforeAuditNo ?? Number.MAX_SAFE_INTEGER
        const rows = await ctx.db.query("levelingAudits").withIndex("by_number", q => q.eq("serverId", serverId).lt("auditNo", before)).order("desc").take(11)
        return { type: "audits", audits: rows.slice(0, 10).map(publicAudit), ...(rows.length > 10 ? { nextBeforeAuditNo: rows[9]!.auditNo } : {}) }
    }
    if (op.type === "rank") {
        const userId = op.userId ?? who.userId, profile = publicProfile(config, userId, await readProfile(ctx, serverId, userId))
        if (profile.xp === 0) return { type: "rank", profile, rank: { type: "unranked" } }
        return { type: "rank", profile, rank: await levelingRank(ctx, state, serverId, config.scoreEpoch, userId, profile.xp) }
    }
    let rows: Doc<"levelingProfiles">[]
    if (op.cursor === undefined) rows = await ctx.db.query("levelingProfiles").withIndex("by_score", q => q.eq("serverId", serverId).eq("scoreEpoch", config.scoreEpoch).gt("xp", 0)).order("desc").take(11)
    else {
        const { xp, userId, scoreEpoch } = op.cursor
        if (scoreEpoch !== config.scoreEpoch) fail(409, "Leaderboard score epoch changed")
        const ties = await ctx.db.query("levelingProfiles").withIndex("by_score", q => q.eq("serverId", serverId).eq("scoreEpoch", config.scoreEpoch).eq("xp", xp).lt("userId", userId)).order("desc").take(11)
        rows = ties.length === 11 ? ties : [...ties, ...await ctx.db.query("levelingProfiles").withIndex("by_score", q => q.eq("serverId", serverId).eq("scoreEpoch", config.scoreEpoch).gt("xp", 0).lt("xp", xp)).order("desc").take(11 - ties.length)]
    }
    const last = rows[9]
    return { type: "leaderboard", profiles: rows.slice(0, 10).map(row => publicProfile(config, row.userId, row)), ...(rows.length > 10 && last ? { nextCursor: { xp: last.xp, userId: last.userId, scoreEpoch: config.scoreEpoch } } : {}) }
} })

// Chat, dashboard jobs and presets change settings and role rewards through here
export async function applyLevelingConfiguration(ctx: MutationCtx, serverId: string, value: unknown, now: number): Promise<LevelingManageResult> {
    const op = decode(LevelingManageOperation, value), identity = { serverId }, state = await levelingState(ctx, serverId), config = state.config
    let result: LevelingManageResult
    if (op.type === "settings") {
        if (op.expectedRevision !== config.revision) fail(409, "Leveling settings changed")
        const settings = settingsPatch(config, op.patch)
        await ctx.db.patch(state._id, { config: settings })
        if (!config.enabled && settings.enabled) await startLevelingSweep(ctx, identity.serverId)
        result = { duplicate: false, type: "settings", settings }
    } else if (op.type === "mappings") {
        if (op.expectedMappingRevision !== config.mappingRevision) fail(409, "Leveling mappings changed")
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
