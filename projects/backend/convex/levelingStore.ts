import type { LevelingAudit, LevelingFence, LevelingProfile, LevelingRank } from "@neonflux/contracts/leveling"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { advance, defaultLevelingSettings, levelForXp, LEVELING_CAP, LEVELING_XP_CAP, nextLevelXp } from "./levelingDomain.ts"
import { fail } from "./validation.ts"

export type LevelingRead = MutationCtx | QueryCtx
export const readLeveling = (ctx: LevelingRead, serverId: string) => ctx.db.query("levelingSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
export const readProfile = (ctx: LevelingRead, serverId: string, userId: string) => ctx.db.query("levelingProfiles").withIndex("by_user", q => q.eq("serverId", serverId).eq("userId", userId)).unique()
export async function levelingState(ctx: MutationCtx, serverId: string) {
    const old = await readLeveling(ctx, serverId)
    if (old) return old
    const id = await ctx.db.insert("levelingSettings", { serverId, config: defaultLevelingSettings(), profiles: 0, nextAuditNo: 1, dirty: 0, sweepPending: false, ranked: true })
    return (await ctx.db.get(id))!
}
// Moves one profile count of a level. A row exists only while it counts someone
async function rankCount(ctx: MutationCtx, serverId: string, scoreEpoch: number, level: number, delta: 1 | -1) {
    const row = await ctx.db.query("levelingLevels").withIndex("by_level", q => q.eq("serverId", serverId).eq("scoreEpoch", scoreEpoch).eq("level", level)).unique()
    if (!row) { if (delta > 0) await ctx.db.insert("levelingLevels", { serverId, scoreEpoch, level, count: 1 }); return }
    if (row.count + delta > 0) await ctx.db.patch(row._id, { count: row.count + delta })
    else await ctx.db.delete(row._id)
}
// Moves a profile's count to its new score and returns the rankLevel to store with that score. Counts change only when the
// level or epoch changes, so most awards write no count
export async function rankProfile(ctx: MutationCtx, profile: Pick<Doc<"levelingProfiles">, "serverId" | "scoreEpoch" | "rankLevel">, xp: number, scoreEpoch: number) {
    const level = xp > 0 ? levelForXp(xp) : undefined
    if (profile.rankLevel === level && (level === undefined || profile.scoreEpoch === scoreEpoch)) return { rankLevel: level }
    if (profile.rankLevel !== undefined) await rankCount(ctx, profile.serverId, profile.scoreEpoch, profile.rankLevel, -1)
    if (level !== undefined) await rankCount(ctx, profile.serverId, scoreEpoch, level, 1)
    return { rankLevel: level }
}
// Counts 256 profiles of one server whose settings predate rank counts, and marks the server ranked after its last profile.
// Profiles counted by a score change meanwhile already have a rankLevel and are skipped
export async function rankLevelingBackfill(ctx: MutationCtx) {
    const state = await ctx.db.query("levelingSettings").withIndex("by_ranked", q => q.eq("ranked", undefined)).first()
    if (!state) return false
    const after = state.rankAfterUserId
    const rows = await ctx.db.query("levelingProfiles").withIndex("by_user", q => after === undefined ? q.eq("serverId", state.serverId) : q.eq("serverId", state.serverId).gt("userId", after)).take(256)
    for (const row of rows) if (row.rankLevel === undefined && row.scoreEpoch === state.config.scoreEpoch && row.xp > 0) await ctx.db.patch(row._id, await rankProfile(ctx, row, row.xp, row.scoreEpoch))
    await ctx.db.patch(state._id, rows.length === 256 ? { rankAfterUserId: rows.at(-1)!.userId } : { ranked: true, rankAfterUserId: undefined })
    return true
}
// A reset starts a new epoch with no counts, so the older epochs' counts are dropped
export async function dropRankCounts(ctx: MutationCtx, serverId: string, scoreEpoch: number) {
    for (const row of await ctx.db.query("levelingLevels").withIndex("by_level", q => q.eq("serverId", serverId).lt("scoreEpoch", scoreEpoch)).take(2002)) await ctx.db.delete(row._id)
}
const RANK_SCAN = 100
// Exact rank sums the counts of higher levels and reads the profiles above the member in its own level, at most 101 of them.
// When more are above, the rank is the range its level count allows. Before a server's counts exist, rank reads at most
// the 1,000 profiles above the member and is exact within the top 1,000
export async function levelingRank(ctx: LevelingRead, state: Doc<"levelingSettings"> | null, serverId: string, scoreEpoch: number, userId: string, xp: number): Promise<LevelingRank> {
    const profiles = () => ctx.db.query("levelingProfiles")
    const level = levelForXp(xp), limit = state?.ranked === true ? RANK_SCAN + 1 : 1000, upper = nextLevelXp(xp) ?? LEVELING_XP_CAP + 1
    const higherXp = await profiles().withIndex("by_score", q => q.eq("serverId", serverId).eq("scoreEpoch", scoreEpoch).gt("xp", xp).lt("xp", state?.ranked === true ? upper : LEVELING_XP_CAP + 1)).take(limit)
    const ties = higherXp.length < limit ? await profiles().withIndex("by_score", q => q.eq("serverId", serverId).eq("scoreEpoch", scoreEpoch).eq("xp", xp).gt("userId", userId)).take(limit - higherXp.length) : []
    const above = higherXp.length + ties.length
    if (state?.ranked !== true) return above < 1000 ? { type: "exact", position: above + 1 } : { type: "outside-top-1000" }
    const levels = await ctx.db.query("levelingLevels").withIndex("by_level", q => q.eq("serverId", serverId).eq("scoreEpoch", scoreEpoch).gte("level", level)).take(1001)
    const higher = levels.reduce((sum, row) => sum + (row.level > level ? row.count : 0), 0), own = levels.find(row => row.level === level)?.count ?? 1
    if (above <= RANK_SCAN) return { type: "exact", position: higher + above + 1 }
    return { type: "range", from: higher + RANK_SCAN + 2, to: Math.max(higher + own, higher + RANK_SCAN + 2) }
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
