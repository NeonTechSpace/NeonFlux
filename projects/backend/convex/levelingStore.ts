import type { LevelingAudit, LevelingFence, LevelingProfile, LevelingRank } from "@neonflux/contracts/leveling"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import {
    advance,
    defaultLevelingSettings,
    levelForXp,
    levelStartXp,
    LEVELING_XP_CAP,
    nextLevelXp,
} from "./levelingDomain.ts"

export type LevelingRead = MutationCtx | QueryCtx
export const readLeveling = (ctx: LevelingRead, serverId: string) =>
    ctx.db
        .query("levelingSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
export const readProfile = (ctx: LevelingRead, serverId: string, userId: string) =>
    ctx.db
        .query("levelingProfiles")
        .withIndex("by_user", (q) => q.eq("serverId", serverId).eq("userId", userId))
        .unique()
export async function levelingState(ctx: MutationCtx, serverId: string) {
    const old = await readLeveling(ctx, serverId)
    if (old) return old
    const id = await ctx.db.insert("levelingSettings", {
        serverId,
        config: defaultLevelingSettings(),
        profiles: 0,
        nextAuditNo: 1,
        dirty: 0,
        sweepPending: false,
        // A server first used now has nothing to count
        countsReady: true,
    })
    return (await ctx.db.get(id))!
}
// A count row exists only while it counts someone
async function countLevel(ctx: MutationCtx, serverId: string, scoreEpoch: number, level: number, delta: 1 | -1) {
    const row = await ctx.db
        .query("levelingLevels")
        .withIndex("by_level", (q) => q.eq("serverId", serverId).eq("scoreEpoch", scoreEpoch).eq("level", level))
        .unique()
    if (!row) {
        if (delta > 0) await ctx.db.insert("levelingLevels", { serverId, scoreEpoch, level, count: 1 })
    } else if (row.count + delta > 0) await ctx.db.patch(row._id, { count: row.count + delta })
    else await ctx.db.delete(row._id)
}
async function countBlock(
    ctx: MutationCtx,
    serverId: string,
    scoreEpoch: number,
    level: number,
    block: number,
    delta: 1 | -1,
) {
    const row = await ctx.db
        .query("levelingBlocks")
        .withIndex("by_block", (q) =>
            q.eq("serverId", serverId).eq("scoreEpoch", scoreEpoch).eq("level", level).eq("block", block),
        )
        .unique()
    if (!row) {
        if (delta > 0) await ctx.db.insert("levelingBlocks", { serverId, scoreEpoch, level, block, count: 1 })
    } else if (row.count + delta > 0) await ctx.db.patch(row._id, { count: row.count + delta })
    else await ctx.db.delete(row._id)
}
async function countScore(ctx: MutationCtx, serverId: string, scoreEpoch: number, xp: number, delta: 1 | -1) {
    const row = await ctx.db
        .query("levelingScores")
        .withIndex("by_xp", (q) => q.eq("serverId", serverId).eq("scoreEpoch", scoreEpoch).eq("xp", xp))
        .unique()
    if (!row) {
        if (delta > 0) await ctx.db.insert("levelingScores", { serverId, scoreEpoch, xp, count: 1 })
    } else if (row.count + delta > 0) await ctx.db.patch(row._id, { count: row.count + delta })
    else await ctx.db.delete(row._id)
}
/** XP in each block of a level, which a rank adds up above the member's block */
export const RANK_BLOCK = 1000
const blockOf = (xp: number) => Math.floor((xp - levelStartXp(levelForXp(xp))) / RANK_BLOCK)
// Moves a profile's counts to its new score and returns the rankXp to store with that score. A profile counted before the score
// counts existed has only its level counted, and moves to all three. A count changes only where the level, block or score
// changes, and a new epoch counts the profile again
export async function rankProfile(
    ctx: MutationCtx,
    profile: Pick<Doc<"levelingProfiles">, "serverId" | "scoreEpoch" | "rankLevel" | "rankXp">,
    xp: number,
    scoreEpoch: number,
) {
    const next = xp > 0 ? xp : undefined,
        result = { rankXp: next, rankLevel: undefined }
    const was =
            profile.rankXp !== undefined
                ? { xp: profile.rankXp, level: levelForXp(profile.rankXp) }
                : profile.rankLevel !== undefined
                  ? { xp: undefined, level: profile.rankLevel }
                  : undefined,
        now = next !== undefined ? { xp: next, level: levelForXp(next) } : undefined
    const sameEpoch = profile.scoreEpoch === scoreEpoch,
        sameLevel = !!was && !!now && sameEpoch && was.level === now.level,
        sameBlock = sameLevel && was!.xp !== undefined && blockOf(was!.xp) === blockOf(now!.xp)
    if (was?.xp !== undefined && now && sameEpoch && was.xp === now.xp) return result
    const { serverId } = profile
    if (was) {
        if (!sameLevel) await countLevel(ctx, serverId, profile.scoreEpoch, was.level, -1)
        if (was.xp !== undefined) {
            if (!sameBlock) await countBlock(ctx, serverId, profile.scoreEpoch, was.level, blockOf(was.xp), -1)
            await countScore(ctx, serverId, profile.scoreEpoch, was.xp, -1)
        }
    }
    if (now) {
        if (!sameLevel) await countLevel(ctx, serverId, scoreEpoch, now.level, 1)
        if (!sameBlock) await countBlock(ctx, serverId, scoreEpoch, now.level, blockOf(now.xp), 1)
        await countScore(ctx, serverId, scoreEpoch, now.xp, 1)
    }
    return result
}
// A reset starts a new epoch with no counts. The earlier epochs' counts are deleted in the background, a bounded batch per pass,
// and the new epoch's reads never include them
export async function dropRankCounts(ctx: MutationCtx, state: Doc<"levelingSettings">) {
    await ctx.db.patch(state._id, { countsReady: true, countsAfterUserId: undefined, countsDropPending: true })
}
const DROP_BATCH = 500
/** Deletes up to a batch of earlier seasons' counts, and reports whether more remain */
export async function dropOldRankCounts(ctx: MutationCtx, state: Doc<"levelingSettings">) {
    const epoch = state.config.scoreEpoch,
        { serverId } = state
    let left = DROP_BATCH
    for (const table of ["levelingScores", "levelingBlocks", "levelingLevels"] as const) {
        const rows =
            table === "levelingScores"
                ? await ctx.db
                      .query(table)
                      .withIndex("by_xp", (q) => q.eq("serverId", serverId).lt("scoreEpoch", epoch))
                      .take(left)
                : table === "levelingBlocks"
                  ? await ctx.db
                        .query(table)
                        .withIndex("by_block", (q) => q.eq("serverId", serverId).lt("scoreEpoch", epoch))
                        .take(left)
                  : await ctx.db
                        .query(table)
                        .withIndex("by_level", (q) => q.eq("serverId", serverId).lt("scoreEpoch", epoch))
                        .take(left)
        for (const row of rows) await ctx.db.delete(row._id)
        left -= rows.length
        if (!left) return true
    }
    await ctx.db.patch(state._id, { countsDropPending: undefined })
    return false
}
const BACKFILL_BATCH = 200
/** Counts the next profiles of a server that kept its scores before the score counts existed. Returns whether it has more */
export async function backfillRankCounts(ctx: MutationCtx, state: Doc<"levelingSettings">) {
    const { serverId } = state
    const rows = await ctx.db
        .query("levelingProfiles")
        .withIndex("by_user", (q) =>
            state.countsAfterUserId === undefined
                ? q.eq("serverId", serverId)
                : q.eq("serverId", serverId).gt("userId", state.countsAfterUserId),
        )
        .take(BACKFILL_BATCH)
    for (const row of rows)
        if (row.rankXp === undefined && row.xp > 0 && row.scoreEpoch === state.config.scoreEpoch)
            await ctx.db.patch(row._id, await rankProfile(ctx, row, row.xp, row.scoreEpoch))
    const done = rows.length < BACKFILL_BATCH
    await ctx.db.patch(state._id, {
        countsAfterUserId: done ? undefined : rows.at(-1)!.userId,
        countsReady: done ? true : undefined,
    })
    return !done
}
// Exact rank is one plus the members with more XP. They are the members of higher levels, of higher blocks of the member's level
// and of higher scores in the member's block, at most about 2,200 small rows. Equal XP shares a rank, and the member's own score
// row says how many others share it. A server still being counted has no rank yet
export async function levelingRank(
    ctx: LevelingRead,
    state: Doc<"levelingSettings">,
    xp: number,
): Promise<LevelingRank> {
    if (state.countsReady !== true) return { type: "counting" }
    const { serverId } = state,
        scoreEpoch = state.config.scoreEpoch,
        level = levelForXp(xp),
        block = blockOf(xp),
        blockEnd = Math.min(levelStartXp(level) + (block + 1) * RANK_BLOCK, nextLevelXp(xp) ?? LEVELING_XP_CAP + 1)
    const levels = await ctx.db
        .query("levelingLevels")
        .withIndex("by_level", (q) => q.eq("serverId", serverId).eq("scoreEpoch", scoreEpoch).gt("level", level))
        .take(1001)
    const blocks = await ctx.db
        .query("levelingBlocks")
        .withIndex("by_block", (q) =>
            q.eq("serverId", serverId).eq("scoreEpoch", scoreEpoch).eq("level", level).gt("block", block),
        )
        .take(1001)
    const scores = await ctx.db
        .query("levelingScores")
        .withIndex("by_xp", (q) =>
            q.eq("serverId", serverId).eq("scoreEpoch", scoreEpoch).gte("xp", xp).lt("xp", blockEnd),
        )
        .take(1001)
    const sum = (rows: { count: number }[]) => rows.reduce((total, row) => total + row.count, 0),
        own = scores.find((row) => row.xp === xp)?.count ?? 1
    return {
        type: "exact",
        position: sum(levels) + sum(blocks) + sum(scores.filter((row) => row.xp > xp)) + 1,
        tied: own - 1,
    }
}
// The profile count reports stored members, and the dirty count pending reward reconciliation, in !level status
export async function levelingCount(ctx: MutationCtx, serverId: string, field: "profiles" | "dirty", delta: number) {
    const state = await levelingState(ctx, serverId)
    await ctx.db.patch(state._id, { [field]: Math.max(0, state[field] + delta) })
}
export async function ensureProfile(ctx: MutationCtx, serverId: string, userId: string) {
    const old = await readProfile(ctx, serverId, userId)
    if (old) return old
    const state = await levelingState(ctx, serverId)
    await levelingCount(ctx, serverId, "profiles", 1)
    const id = await ctx.db.insert("levelingProfiles", {
        serverId,
        userId,
        xp: 0,
        scoreEpoch: state.config.scoreEpoch,
        adjustmentRevision: 0,
        digests: [],
    })
    return (await ctx.db.get(id))!
}
export function profileFence(
    config: Doc<"levelingSettings">["config"],
    profile: Doc<"levelingProfiles"> | null,
): LevelingFence {
    return {
        scoreEpoch: config.scoreEpoch,
        adjustmentRevision: profile?.adjustmentRevision ?? 0,
        mappingRevision: config.mappingRevision,
    }
}
export const currentXp = (config: Doc<"levelingSettings">["config"], profile: Doc<"levelingProfiles"> | null) =>
    profile?.scoreEpoch === config.scoreEpoch ? profile.xp : 0
export function publicProfile(
    config: Doc<"levelingSettings">["config"],
    userId: string,
    profile: Doc<"levelingProfiles"> | null,
): LevelingProfile {
    const xp = currentXp(config, profile)
    return { userId, xp, level: levelForXp(xp), nextLevelXp: nextLevelXp(xp), fence: profileFence(config, profile) }
}
export function publicAudit(row: Doc<"levelingAudits">): LevelingAudit {
    return {
        auditNo: row.auditNo,
        actorId: row.actorId,
        reason: row.reason,
        createdAt: row.createdAt,
        type: row.type,
        scoreEpoch: row.scoreEpoch,
        ...(row.userId !== undefined ? { userId: row.userId } : {}),
        ...(row.beforeXp !== undefined ? { beforeXp: row.beforeXp } : {}),
        ...(row.afterXp !== undefined ? { afterXp: row.afterXp } : {}),
    }
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
    const query = ctx.db
        .query("levelingProfiles")
        .withIndex("by_user", (q) =>
            state.sweepAfterUserId === undefined
                ? q.eq("serverId", serverId)
                : q.eq("serverId", serverId).gt("userId", state.sweepAfterUserId),
        )
    const rows = await query.take(20)
    for (const row of rows) await queueLeveling(ctx, serverId, row.userId)
    await ctx.db.patch(state._id, {
        sweepAfterUserId: rows.at(-1)?.userId ?? state.sweepAfterUserId,
        sweepPending: rows.length === 20,
    })
}
