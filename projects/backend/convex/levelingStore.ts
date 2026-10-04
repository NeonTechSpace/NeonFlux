import type { LevelingAudit, LevelingFence, LevelingProfile } from "../contracts.js"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { advance, defaultLevelingSettings, levelForXp, LEVELING_CAP, nextLevelXp } from "./levelingDomain.ts"
import { fail } from "./validation.ts"

export type LevelingRead = MutationCtx | QueryCtx
export const readLeveling = (ctx: LevelingRead, serverId: string) => ctx.db.query("levelingSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
export const readProfile = (ctx: LevelingRead, serverId: string, userId: string) => ctx.db.query("levelingProfiles").withIndex("by_user", q => q.eq("serverId", serverId).eq("userId", userId)).unique()
export async function levelingState(ctx: MutationCtx, serverId: string) {
    const old = await readLeveling(ctx, serverId)
    if (old) return old
    const id = await ctx.db.insert("levelingSettings", { serverId, config: defaultLevelingSettings(), profiles: 0, nextAuditNo: 1, dirty: 0, sweepPending: false })
    return (await ctx.db.get(id))!
}
// Profile count bounds stored members per server. The dirty count reports pending reward reconciliation.
export async function levelingCount(ctx: MutationCtx, serverId: string, field: "profiles" | "dirty", delta: number) {
    const state = await levelingState(ctx, serverId)
    if (field === "profiles" && state.profiles + delta > LEVELING_CAP) fail(429, "Leveling capacity reached")
    await ctx.db.patch(state._id, { [field]: Math.max(0, state[field] + delta) })
}
export async function ensureProfile(ctx: MutationCtx, serverId: string, userId: string) {
    const old = await readProfile(ctx, serverId, userId)
    if (old) return old
    const state = await levelingState(ctx, serverId)
    await levelingCount(ctx, serverId, "profiles", 1)
    const id = await ctx.db.insert("levelingProfiles", { serverId, userId, xp: 0, scoreEpoch: state.config.scoreEpoch, adjustmentRevision: 0, digests: [] })
    return (await ctx.db.get(id))!
}
export function profileFence(config: Doc<"levelingSettings">["config"], profile: Doc<"levelingProfiles"> | null): LevelingFence {
    return { scoreEpoch: config.scoreEpoch, adjustmentRevision: profile?.adjustmentRevision ?? 0, mappingRevision: config.mappingRevision }
}
export const currentXp = (config: Doc<"levelingSettings">["config"], profile: Doc<"levelingProfiles"> | null) => profile?.scoreEpoch === config.scoreEpoch ? profile.xp : 0
export function publicProfile(config: Doc<"levelingSettings">["config"], userId: string, profile: Doc<"levelingProfiles"> | null): LevelingProfile {
    const xp = currentXp(config, profile)
    return { userId, xp, level: levelForXp(xp), nextLevelXp: nextLevelXp(xp), fence: profileFence(config, profile) }
}
export function publicAudit(row: Doc<"levelingAudits">): LevelingAudit {
    return { auditNo: row.auditNo, actorId: row.actorId, reason: row.reason, createdAt: row.createdAt, type: row.type, scoreEpoch: row.scoreEpoch, ...(row.userId !== undefined ? { userId: row.userId } : {}), ...(row.beforeXp !== undefined ? { beforeXp: row.beforeXp } : {}), ...(row.afterXp !== undefined ? { afterXp: row.afterXp } : {}) }
}
// Marks an account for reward reconciliation. The mark survives crashes until a pass with this mark completes.
export async function queueLeveling(ctx: MutationCtx, serverId: string, userId: string, now = Date.now()) {
    const profile = await readProfile(ctx, serverId, userId)
    if (!profile) return
    if (profile.rewardDueAt === undefined) await levelingCount(ctx, serverId, "dirty", 1)
    await ctx.db.patch(profile._id, { rewardMark: advance(profile.rewardMark ?? 0), rewardDueAt: now })
}
export async function startLevelingSweep(ctx: MutationCtx, serverId: string) {
    const state = await levelingState(ctx, serverId)
    await ctx.db.patch(state._id, { sweepAfterUserId: undefined, sweepPending: true })
}
export async function advanceLevelingSweep(ctx: MutationCtx, serverId: string) {
    const state = await readLeveling(ctx, serverId)
    if (!state?.sweepPending) return
    const query = ctx.db.query("levelingProfiles").withIndex("by_user", q => state.sweepAfterUserId === undefined ? q.eq("serverId", serverId) : q.eq("serverId", serverId).gt("userId", state.sweepAfterUserId))
    const rows = await query.take(20)
    for (const row of rows) await queueLeveling(ctx, serverId, row.userId)
    await ctx.db.patch(state._id, { sweepAfterUserId: rows.at(-1)?.userId ?? state.sweepAfterUserId, sweepPending: rows.length === 20 })
}
