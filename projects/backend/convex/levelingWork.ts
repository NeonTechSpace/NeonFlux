import { v } from "convex/values"
import { LevelingWorkRequest, type LevelingRewardAccount, type LevelingWorkResult } from "@neonflux/contracts/leveling"
import { serviceMutation } from "./installations.ts"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { dropUndesiredReferences } from "./roleClaims.ts"
import { ownerReferences } from "./rolesStore.ts"
import { advance, LEVELING_DEFER, observed, server } from "./levelingDomain.ts"
import { advanceLevelingSweep, levelingCount, readLeveling, readProfile } from "./levelingStore.ts"
import { decode, fail, requireReadMember } from "./validation.ts"
type Skip = Extract<LevelingWorkRequest["operation"], { type: "skip" }>
// A dirty account lists at most this many retained level references per pass. Departed ones are removed as they are seen.
const LEVELING_REFS = 40

// One ledger source per role per dirty mark. A new mark gives every role a fresh source.
export const levelSource = (profile: Doc<"levelingProfiles">, roleId: string) => `level_${profile._id}_${profile.rewardMark ?? 0}_${roleId}`

async function rewardAccount(ctx: MutationCtx, serverId: string, profile: Doc<"levelingProfiles">, mappedRoleIds: string[]): Promise<LevelingRewardAccount> {
    const refs = await ctx.db.query("roleReferences")
        .withIndex("by_level_member", q => q.eq("serverId", serverId).eq("consumerKey", "level").eq("configuration", false).eq("userId", profile.userId))
        .take(LEVELING_REFS + 1)
    const kept = refs.slice(0, LEVELING_REFS).flatMap(ref => ref.joinedAt ? [{ roleId: ref.roleId, joinedAt: ref.joinedAt }] : [])
    const roleIds = [...new Set([...mappedRoleIds, ...kept.map(ref => ref.roleId)])]
    return {
        userId: profile.userId,
        mark: profile.rewardMark ?? 0,
        refs: kept,
        targets: roleIds.map(roleId => ({ roleId, sourceId: levelSource(profile, roleId) })),
        complete: refs.length <= LEVELING_REFS,
    }
}

async function markedProfile(ctx: MutationCtx, serverId: string, userId: string, mark: number) {
    const profile = await readProfile(ctx, serverId, userId)
    return profile && profile.rewardDueAt !== undefined && (profile.rewardMark ?? 0) === mark ? profile : null
}

// Removes a level reference left by an earlier membership. A departed epoch cannot confer ownership on a new membership.
async function releaseDepartedReference(ctx: MutationCtx, serverId: string, profile: Doc<"levelingProfiles">, op: Skip, now: number) {
    const { roleId, joinedAt, currentJoinedAt } = op
    observed(op.observedAt, now)
    if (joinedAt === currentJoinedAt) fail(409, "Current membership requires role evaluation")
    const ref = await ctx.db.query("roleReferences")
        .withIndex("by_level_member", q => q.eq("serverId", serverId).eq("consumerKey", "level").eq("configuration", false)
            .eq("userId", profile.userId).eq("joinedAt", joinedAt).eq("roleId", roleId))
        .first()
    if (!ref) return true
    const owner = ref.ownershipId ? await ctx.db.get(ref.ownershipId) : null
    if (owner) {
        const attempt = owner.attemptId ? await ctx.db.get(owner.attemptId) : null
        const unresolved = attempt?.outcome === "pending" || attempt?.outcome === "uncertain" && attempt.observationAt === undefined
        if (owner.status !== "idle" || unresolved) return false
    }
    await ctx.db.delete(ref._id)
    if (owner && !(await ownerReferences(ctx, owner._id)).some(x => x.desired)) {
        await dropUndesiredReferences(ctx, owner._id)
        await ctx.db.patch(owner._id, { owned: false, protected: false, updatedAt: now })
        if (!(await ownerReferences(ctx, owner._id)).length) { await ctx.db.delete(owner._id) }
    }
    return true
}

export const work = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<LevelingWorkResult> => {
    const input = decode(LevelingWorkRequest, request), serverId = server(input.serverId), now = Date.now(), op = input.operation
    if (op.type === "list") {
        await advanceLevelingSweep(ctx, serverId)
        const state = await readLeveling(ctx, serverId), mappedRoleIds = state?.config.mappings.map(m => m.roleId) ?? []
        const due = await ctx.db.query("levelingProfiles").withIndex("by_reward_due", q => q.eq("serverId", serverId).gte("rewardDueAt", 0).lte("rewardDueAt", now)).take(10)
        const accounts: LevelingRewardAccount[] = []
        for (const profile of due) accounts.push(await rewardAccount(ctx, serverId, profile, mappedRoleIds))
        return { type: "accounts", accounts, sweepPending: state?.sweepPending ?? false }
    }
    if (op.type === "skip") {
        const profile = await markedProfile(ctx, serverId, op.userId, op.mark)
        if (!profile) fail(409, "Leveling reward mark changed")
        requireReadMember(op, profile.userId)
        return { type: "progress", recorded: await releaseDepartedReference(ctx, serverId, profile, op, now) }
    }
    const profile = await markedProfile(ctx, serverId, op.userId, op.mark)
    // A newer mark means newer intent. It stays dirty for the next pass.
    if (!profile) return { type: "progress", recorded: false }
    if (op.complete) {
        await ctx.db.patch(profile._id, { rewardDueAt: undefined })
        await levelingCount(ctx, serverId, "dirty", -1)
    } else await ctx.db.patch(profile._id, { rewardMark: advance(profile.rewardMark ?? 0), rewardDueAt: now + LEVELING_DEFER })
    return { type: "progress", recorded: true }
} })
