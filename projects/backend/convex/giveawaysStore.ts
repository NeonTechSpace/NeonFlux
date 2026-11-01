import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import {
    GIVEAWAY_DEFAULTS,
    GIVEAWAY_RUNNING,
    GIVEAWAY_VIEW,
    GIVEAWAY_WINNERS_STORED,
    GiveawayDeliveryContext,
    type Giveaway,
    type GiveawayProblem,
    type GiveawaySettings,
    type GiveawaySettingsPatch,
    type GiveawayView,
} from "@neonflux/contracts/giveaways"
import { defconHoldsAutomation, publisherSettings } from "./schedulesStore.ts"
import { decode, fail } from "./validation.ts"
import { ringWork } from "./workSignal.ts"

type Read = QueryCtx | MutationCtx
const DAY = 86400000
/** An ended or cancelled giveaway, and one left running this long past its end, expires after this long */
export const GIVEAWAY_KEPT_MS = 90 * DAY
const RETRY_MS = 60000

export const giveawaySettingsRow = (ctx: Read, serverId: string) =>
    ctx.db
        .query("giveawaySettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
export async function readGiveawaySettings(ctx: Read, serverId: string): Promise<GiveawaySettings> {
    const row = await giveawaySettingsRow(ctx, serverId)
    return row ? { enabled: row.enabled, requiredRoleId: row.requiredRoleId } : { ...GIVEAWAY_DEFAULTS }
}
/** The settings row, created on first use because it also numbers the server's giveaways */
export async function ensureGiveawaySettings(ctx: MutationCtx, serverId: string) {
    const row = await giveawaySettingsRow(ctx, serverId)
    if (row) return row
    const id = await ctx.db.insert("giveawaySettings", { serverId, ...GIVEAWAY_DEFAULTS, nextGiveawayNo: 1 })
    return (await ctx.db.get(id))!
}
/** Turning giveaways back on wakes the draws that waited */
export async function applyGiveawaySettings(ctx: MutationCtx, serverId: string, patch: GiveawaySettingsPatch) {
    const row = await ensureGiveawaySettings(ctx, serverId)
    await ctx.db.patch(row._id, patch)
    if (patch.enabled === true && !row.enabled) await ringWork(ctx)
    return readGiveawaySettings(ctx, serverId)
}
export const giveawayRow = (ctx: Read, serverId: string, giveawayNo: number) =>
    ctx.db
        .query("giveaways")
        .withIndex("by_number", (q) => q.eq("serverId", serverId).eq("giveawayNo", giveawayNo))
        .unique()
export const giveawayWinners = (ctx: Read, serverId: string, giveawayNo: number) =>
    ctx.db
        .query("giveawayWinners")
        .withIndex("by_giveaway", (q) => q.eq("serverId", serverId).eq("giveawayNo", giveawayNo))
        .take(GIVEAWAY_WINNERS_STORED)
export const runningGiveaways = (ctx: Read, serverId: string) =>
    ctx.db
        .query("giveaways")
        .withIndex("by_server_state", (q) => q.eq("serverId", serverId).eq("state", "running"))
        .take(GIVEAWAY_RUNNING)
export async function publicGiveaway(ctx: Read, row: Doc<"giveaways">): Promise<Giveaway> {
    const winners = await giveawayWinners(ctx, row.serverId, row.giveawayNo)
    return {
        giveawayNo: row.giveawayNo,
        ...(row.hostId ? { hostId: row.hostId } : {}),
        channelId: row.channelId,
        prize: row.prize,
        winnerCount: row.winnerCount,
        ...(row.requiredRoleId ? { requiredRoleId: row.requiredRoleId } : {}),
        endsAt: row.endsAt,
        createdAt: row.createdAt,
        ...(row.endedAt !== undefined ? { endedAt: row.endedAt } : {}),
        state: row.state,
        phase: row.phase,
        ...(row.messageId ? { messageId: row.messageId } : {}),
        ...(row.postNo !== undefined ? { postNo: row.postNo } : {}),
        ...(row.problem ? { problem: row.problem } : {}),
        ...(row.entrants !== undefined ? { entrants: row.entrants } : {}),
        ...(row.capped ? { capped: true as const } : {}),
        winners: winners
            .sort((a, b) => a.drawNo - b.drawNo || a._creationTime - b._creationTime)
            .map((winner) => ({ userId: winner.userId, drawNo: winner.drawNo, dm: winner.dm })),
    }
}
export const newestGiveaways = (ctx: Read, serverId: string, count: number, beforeNo?: number) =>
    ctx.db
        .query("giveaways")
        .withIndex("by_number", (q) =>
            beforeNo === undefined ? q.eq("serverId", serverId) : q.eq("serverId", serverId).lt("giveawayNo", beforeNo),
        )
        .order("desc")
        .take(count)
export async function giveawayView(ctx: Read, serverId: string): Promise<GiveawayView> {
    return {
        settings: await readGiveawaySettings(ctx, serverId),
        giveaways: await Promise.all(
            (await newestGiveaways(ctx, serverId, GIVEAWAY_VIEW)).map((row) => publicGiveaway(ctx, row)),
        ),
    }
}
/**
 * What the audit log reads: Settings and only the giveaways a change names, without winners or the host. Audit details outlive a member's
 * data deletion for 180 days, so member data stays out of them, and a list that moves on as new giveaways start cannot copy a row in
 */
export async function giveawayAuditView(ctx: Read, serverId: string, giveawayNos: readonly number[]) {
    const rows = await Promise.all(giveawayNos.map((giveawayNo) => giveawayRow(ctx, serverId, giveawayNo)))
    return {
        settings: await readGiveawaySettings(ctx, serverId),
        giveaways: rows
            .filter((row) => row !== null)
            .map((row) => ({
                giveawayNo: row.giveawayNo,
                channelId: row.channelId,
                prize: row.prize,
                winnerCount: row.winnerCount,
                ...(row.requiredRoleId ? { requiredRoleId: row.requiredRoleId } : {}),
                endsAt: row.endsAt,
                state: row.state,
            })),
    }
}
/** The fields that record a problem, or clear it */
export const problemFields = (problem: GiveawayProblem | undefined, now: number) => ({
    problem,
    problemAt: problem ? now : undefined,
})
/** Draws wait while the module is off or DEFCON is below 3, and resume after */
export const giveawayDraws = async (ctx: Read, serverId: string) =>
    (await readGiveawaySettings(ctx, serverId)).enabled && !(await defconHoldsAutomation(ctx, serverId))
/** New cards also wait while publishing is off */
export const giveawayPosts = async (ctx: Read, serverId: string) =>
    (await publisherSettings(ctx, serverId))?.enabled !== false && (await giveawayDraws(ctx, serverId))

// A card's tracked post and attempt, once nothing about them is unknown
export async function releaseGiveawayPost(ctx: MutationCtx, serverId: string, postNo: number) {
    const post = await ctx.db
        .query("publishingPosts")
        .withIndex("by_server_post", (q) => q.eq("serverId", serverId).eq("postNo", postNo))
        .unique()
    const attempts = await ctx.db
        .query("publishingAttempts")
        .withIndex("by_server_post", (q) => q.eq("serverId", serverId).eq("postNo", postNo))
        .take(16)
    if (attempts.some((attempt) => attempt.outcome === "pending" || attempt.unresolved)) return false
    if (post) await ctx.db.delete(post._id)
    for (const attempt of attempts) await ctx.db.delete(attempt._id)
    return true
}
// The publisher reports each outcome here. An attempt that never reached Fluxer is released and the card is tried again. An unknown
// outcome holds the giveaway until staff settle it, and a card that turned out to exist goes on from where the giveaway is by then
export async function syncGiveawayPublishing(
    ctx: MutationCtx,
    attempt: Doc<"publishingAttempts">,
    outcome: "sent" | "failed" | "uncertain",
) {
    const consumer = attempt.consumer
    if (consumer?.type !== "giveaway") return
    const row = await giveawayRow(ctx, attempt.serverId, consumer.giveawayNo)
    if (!row || row.attemptId !== attempt._id) return
    const now = Date.now()
    if (outcome === "sent") {
        const messageId = (await ctx.db.get(attempt._id))?.messageId
        await ctx.db.patch(row._id, {
            ...(messageId ? { messageId } : {}),
            ...problemFields(undefined, now),
            due: true,
            ...(row.state === "cancelled"
                ? { phase: "cancel" as const, nextCheckAt: now }
                : { phase: "wait" as const, nextCheckAt: Math.max(row.endsAt, now) }),
        })
        return
    }
    if (outcome === "failed" && attempt.dispatchedAt === undefined) {
        await releaseGiveawayPost(ctx, row.serverId, attempt.postNo)
        await ctx.db.patch(
            row._id,
            row.state === "cancelled"
                ? { phase: "done", due: false, postNo: undefined, attemptId: undefined }
                : {
                      phase: "post",
                      due: true,
                      // Past its end there is no retry to wait for, and the worker's next list ends it
                      nextCheckAt: row.endsAt <= now ? now : now + RETRY_MS,
                      postNo: undefined,
                      attemptId: undefined,
                  },
        )
        return
    }
    if (outcome === "uncertain") {
        await ctx.db.patch(row._id, { phase: "blocked", due: false, ...problemFields("post-uncertain", now) })
        return
    }
    // Fluxer refused the post, so the giveaway never started
    await ctx.db.patch(row._id, {
        phase: "done",
        due: false,
        ...(row.state === "running" ? { state: "ended" as const, endedAt: now } : {}),
        expiresAt: now + GIVEAWAY_KEPT_MS,
        ...problemFields("post-failed", now),
    })
}
// The publisher's claim: The giveaway must still be running and waiting for this attempt while its posts may go out. Otherwise the
// unclaimed attempt closes without a send
export async function giveawayPublishingFence(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, value: unknown) {
    const consumer = attempt.consumer
    if (consumer?.type !== "giveaway") fail(409, "Giveaway consumer missing")
    const row = await giveawayRow(ctx, attempt.serverId, consumer.giveawayNo)
    if (!row || row.attemptId !== attempt._id) fail(409, "Giveaway changed")
    const now = Date.now()
    if (
        row.state !== "running" ||
        row.endsAt <= now ||
        row.channelId !== attempt.channelId ||
        now >= attempt.dispatchExpiresAt ||
        !(await giveawayPosts(ctx, attempt.serverId))
    ) {
        await ctx.db.patch(attempt._id, { outcome: "failed", noDispatch: true, unresolved: false, finishedAt: now })
        await syncGiveawayPublishing(ctx, (await ctx.db.get(attempt._id))!, "failed")
        return false
    }
    const context = decode(GiveawayDeliveryContext, value)
    if (context.observedAt < now - 60000 || context.observedAt > now + 1000) fail(400, "Invalid request")
    if (context.botId !== attempt.botId || context.channelId !== attempt.channelId)
        fail(409, "Giveaway destination changed")
    return true
}

const RETENTION_BATCH = 64
/** Retention: A giveaway expires 90 days after it ended, with its winners and tracked post, except while its post's outcome is unknown */
export async function cleanupGiveaways(ctx: MutationCtx, now: number) {
    const rows = await ctx.db
        .query("giveaways")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(RETENTION_BATCH)
    for (const row of rows) {
        if (row.postNo !== undefined && !(await releaseGiveawayPost(ctx, row.serverId, row.postNo))) {
            await ctx.db.patch(row._id, { expiresAt: now + GIVEAWAY_KEPT_MS })
            continue
        }
        for (const winner of await giveawayWinners(ctx, row.serverId, row.giveawayNo)) await ctx.db.delete(winner._id)
        await ctx.db.delete(row._id)
    }
    return { more: rows.length === RETENTION_BATCH }
}
