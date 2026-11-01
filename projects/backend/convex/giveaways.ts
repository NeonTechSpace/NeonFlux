import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx } from "./_generated/server.js"
import {
    GIVEAWAY_PAGE,
    GIVEAWAY_RUNNING,
    GIVEAWAY_WINNERS_STORED,
    GIVEAWAY_WORK_BATCH,
    GiveawayDeliveryContext,
    GiveawayManageRequest,
    GiveawayQueryRequest,
    GiveawayWorkRequest,
    giveawayCard,
    type GiveawayAction,
    type GiveawayCardOutcome,
    type GiveawayDue,
    type GiveawayManageResult,
    type GiveawayOperation,
    type GiveawayQueryResult,
    type GiveawayWorkResult,
} from "@neonflux/contracts/giveaways"
import { giveawaySourceId, type PublishingGiveawayConsumer } from "@neonflux/contracts/publishing-base"
import { changeConfiguration } from "./configurationChange.ts"
import {
    GIVEAWAY_KEPT_MS,
    applyGiveawaySettings,
    ensureGiveawaySettings,
    giveawayDraws,
    giveawayPosts,
    giveawayRow,
    giveawayWinners,
    newestGiveaways,
    problemFields,
    publicGiveaway,
    readGiveawaySettings,
    runningGiveaways,
} from "./giveawaysStore.ts"
import { actor } from "./moderationDomain.ts"
import { blockingContentRule } from "./protection.ts"
import { reservePublishing } from "./publishing.ts"
import { defconHoldsAutomation, publisherSettings } from "./schedulesStore.ts"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import { decode, fail, source, type ConfigurationIdentity } from "./validation.ts"

/** A claim that never reported counts as lost after this long, more than a draw of the most entries takes */
const CLAIM_MS = 300000,
    RETRY_MS = 60000,
    /** A draw NeonFlux may not read yet tries again this much later */
    PERMISSION_RETRY_MS = 600000
function refuse(status: number, sentence: string): never {
    return fail(status, sentence, "REFUSED")
}

// Chat changes. The bot vouches for a server manager's fresh native authority. Every change reaches the audit log, including each
// start, end, reroll and cancel
export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<GiveawayManageResult> => {
        const input = decode(GiveawayManageRequest, request),
            identity = source(input, Date.now()),
            who = actor(input.actor),
            op = input.operation
        if (!who.nativePermissionAuthorized) fail(403, "Manage community permission required")
        return changeConfiguration(
            ctx,
            identity.serverId,
            "giveaways",
            {
                kind: "chat",
                createdAt: identity.createdAt,
                actor: { userId: who.userId, source: "command" },
                operation: op,
            },
            () =>
                applyGiveawayManagement(
                    ctx,
                    {
                        serverId: identity.serverId,
                        actorId: who.userId,
                        createdAt: identity.createdAt,
                        source: { kind: "chat", messageId: identity.messageId },
                    },
                    op,
                    who.roleIds,
                ),
        )
    },
})

// Chat and dashboard share these rules. They only record what is wanted, and the worker does the native work, so an unknown outcome
// has one owner. A refusal is a sentence for staff, which the dashboard shows too. roleIds are the actor's, which a content rule may exempt
export async function applyGiveawayManagement(
    ctx: MutationCtx,
    identity: ConfigurationIdentity,
    op: GiveawayOperation,
    roleIds: readonly string[],
): Promise<GiveawayManageResult> {
    const { serverId } = identity,
        now = Date.now()
    if (op.type === "settings")
        return { type: "settings", settings: await applyGiveawaySettings(ctx, serverId, op.patch) }
    if (op.type === "start") {
        const settings = await readGiveawaySettings(ctx, serverId)
        if (!settings.enabled) refuse(409, "Giveaways are off here. A manager turns them on with !giveaway module on")
        if ((await runningGiveaways(ctx, serverId)).length >= GIVEAWAY_RUNNING)
            refuse(429, `This server already runs ${GIVEAWAY_RUNNING} giveaways, its limit. End or cancel one first`)
        // A card held back would post late, perhaps past its end, and draw from no entries
        if ((await publisherSettings(ctx, serverId))?.enabled === false)
            refuse(
                409,
                "Publishing is off here, so the giveaway's card cannot go out. Turn it on with !publish module on",
            )
        if (await defconHoldsAutomation(ctx, serverId))
            refuse(409, "DEFCON is below 3, so the giveaway's card cannot go out. Start it once DEFCON is back at 3")
        const rule = await blockingContentRule(ctx, serverId, op.prize, roleIds, op.channelId)
        if (rule) refuse(409, `The server's automod rule ${rule} blocks this prize. Change the text and try again`)
        const row = await ensureGiveawaySettings(ctx, serverId),
            endsAt = now + op.lengthSeconds * 1000,
            giveawayNo = row.nextGiveawayNo
        await ctx.db.patch(row._id, { nextGiveawayNo: giveawayNo + 1 })
        const id = await ctx.db.insert("giveaways", {
            serverId,
            giveawayNo,
            hostId: identity.actorId,
            channelId: op.channelId,
            prize: op.prize,
            winnerCount: op.winners,
            ...(settings.requiredRoleId ? { requiredRoleId: settings.requiredRoleId } : {}),
            endsAt,
            createdAt: now,
            state: "running",
            phase: "post",
            due: true,
            nextCheckAt: now,
            draws: 0,
            drawCount: op.winners,
            expiresAt: endsAt + GIVEAWAY_KEPT_MS,
        })
        return { type: "giveaway", giveaway: await publicGiveaway(ctx, (await ctx.db.get(id))!) }
    }
    const row = await giveawayRow(ctx, serverId, op.giveawayNo)
    if (!row) return refuse(404, `There is no giveaway #${op.giveawayNo}. Check !giveaway list`)
    const answer = async (): Promise<GiveawayManageResult> => ({
        type: "giveaway",
        giveaway: await publicGiveaway(ctx, (await ctx.db.get(row._id))!),
    })
    if (op.type === "end") {
        if (row.state !== "running") return refuse(409, `Giveaway #${row.giveawayNo} has already finished`)
        if (row.phase === "draw") return answer()
        if (row.phase !== "wait")
            return refuse(
                409,
                `Giveaway #${row.giveawayNo} has no posted card yet. Check !giveaway show ${row.giveawayNo}`,
            )
        await ctx.db.patch(row._id, { endsAt: now, nextCheckAt: now })
        return answer()
    }
    if (op.type === "cancel") {
        if (row.state !== "running") return refuse(409, `Giveaway #${row.giveawayNo} has already finished`)
        // A post still on its way or with an unknown outcome leaves the card to edit once its outcome is known
        const waits = row.phase === "sending" || row.phase === "blocked"
        await ctx.db.patch(row._id, {
            state: "cancelled",
            endedAt: now,
            expiresAt: now + GIVEAWAY_KEPT_MS,
            ...(waits
                ? {}
                : row.messageId
                  ? { phase: "cancel" as const, due: true, nextCheckAt: now }
                  : { phase: "done" as const, due: false }),
        })
        return answer()
    }
    if (row.state !== "ended" || row.phase !== "done")
        return refuse(409, `Giveaway #${row.giveawayNo} has not finished its draw. End it first`)
    if (!row.messageId || row.problem === "card" || row.problem === "channel")
        return refuse(409, `Giveaway #${row.giveawayNo} has no card left to read entries from`)
    const count = op.count ?? row.winnerCount
    if ((await giveawayWinners(ctx, serverId, row.giveawayNo)).length + count > GIVEAWAY_WINNERS_STORED)
        return refuse(429, `A giveaway records at most ${GIVEAWAY_WINNERS_STORED} winners. Ask for fewer`)
    await ctx.db.patch(row._id, { phase: "wait", due: true, nextCheckAt: now, drawCount: count })
    return answer()
}

export const query = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<GiveawayQueryResult> => {
        const { serverId, giveawayNo, beforeNo } = decode(GiveawayQueryRequest, request)
        const settings = await readGiveawaySettings(ctx, serverId),
            running = (await runningGiveaways(ctx, serverId)).length
        if (giveawayNo !== undefined) {
            const row = await giveawayRow(ctx, serverId, giveawayNo)
            return { settings, running, giveaways: row ? [await publicGiveaway(ctx, row)] : [] }
        }
        const rows = await newestGiveaways(ctx, serverId, GIVEAWAY_PAGE + 1, beforeNo),
            page = rows.slice(0, GIVEAWAY_PAGE)
        return {
            settings,
            running,
            giveaways: await Promise.all(page.map((row) => publicGiveaway(ctx, row))),
            ...(rows.length > GIVEAWAY_PAGE ? { nextBeforeNo: page.at(-1)!.giveawayNo } : {}),
        }
    },
})

const actionOf = (phase: Doc<"giveaways">["phase"]): GiveawayAction | undefined =>
    phase === "post"
        ? "post"
        : phase === "wait" || phase === "draw"
          ? "draw"
          : phase === "announce"
            ? "announce"
            : phase === "cancel"
              ? "cancel"
              : undefined
/** The state a card edit's outcome leaves as a problem */
const editProblem = (card: GiveawayCardOutcome) =>
    card === "sent"
        ? undefined
        : card === "gone"
          ? ("card" as const)
          : card === "failed"
            ? ("result-failed" as const)
            : ("result-uncertain" as const)

// A giveaway whose end passed before its card went out had no entries to draw from, so it ends instead of posting a finished card
async function endUnposted(ctx: MutationCtx, row: Doc<"giveaways">, now: number) {
    await ctx.db.patch(row._id, {
        state: "ended",
        endedAt: now,
        phase: "done",
        due: false,
        expiresAt: now + GIVEAWAY_KEPT_MS,
        ...problemFields("post-late", now),
    })
}
// An edit claim that never reported may or may not have reached Fluxer, so it is never sent again
async function loseClaim(ctx: MutationCtx, row: Doc<"giveaways">, now: number) {
    for (const winner of await giveawayWinners(ctx, row.serverId, row.giveawayNo))
        if (winner.dm === "sending") await ctx.db.patch(winner._id, { dm: "uncertain" })
    await ctx.db.patch(row._id, { phase: "done", due: false, ...problemFields("result-uncertain", now) })
}

// The bot's giveaway worker. Each step is claimed here before the bot acts, and a draw's winners are recorded once
export const work = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<GiveawayWorkResult> => {
        const { serverId, operation: op } = decode(GiveawayWorkRequest, request),
            now = Date.now()
        if (op.type === "list") {
            const rows = await ctx.db
                .query("giveaways")
                .withIndex("by_server_due", (q) => q.eq("serverId", serverId).eq("due", true).lte("nextCheckAt", now))
                .take(GIVEAWAY_RUNNING * 2)
            const posts = await giveawayPosts(ctx, serverId),
                draws = await giveawayDraws(ctx, serverId),
                held = await defconHoldsAutomation(ctx, serverId)
            const items: GiveawayDue[] = []
            for (const row of rows) {
                if (row.phase === "announcing" || row.phase === "cancelling") {
                    await loseClaim(ctx, row, now)
                    continue
                }
                if (row.phase === "post" && row.endsAt <= now) {
                    await endUnposted(ctx, row, now)
                    continue
                }
                const action = actionOf(row.phase)
                if (
                    !action ||
                    items.length === GIVEAWAY_WORK_BATCH ||
                    (action === "post" ? !posts : action === "cancel" ? held : !draws)
                )
                    continue
                items.push({ giveawayNo: row.giveawayNo, channelId: row.channelId, action })
            }
            return { type: "due", items }
        }
        const row = await giveawayRow(ctx, serverId, op.giveawayNo)
        if (!row) return op.type === "reserve" ? fail(404, "Giveaway not found") : { type: "skipped" }
        const view = () => publicGiveaway(ctx, row)
        switch (op.type) {
            case "reserve": {
                if (row.phase !== "post" || row.state !== "running") return { type: "skipped" }
                if (row.endsAt <= now) {
                    await endUnposted(ctx, row, now)
                    return { type: "skipped" }
                }
                if (!(await giveawayPosts(ctx, serverId))) fail(403, "Giveaways paused")
                const context = decode(GiveawayDeliveryContext, op.context)
                if (context.observedAt < now - 60000 || context.observedAt > now + 1000) fail(400, "Invalid request")
                if (context.channelId !== row.channelId) fail(409, "Giveaway destination changed")
                const consumer: PublishingGiveawayConsumer = { type: "giveaway", giveawayNo: row.giveawayNo }
                const reserved = await reservePublishing(ctx, {
                    serverId,
                    actorId: context.botId,
                    botId: context.botId,
                    channelId: row.channelId,
                    sourceId: giveawaySourceId(row.giveawayNo),
                    source: consumer,
                    provenance: consumer,
                    consumer,
                    content: { content: giveawayCard(await view()) },
                })
                await ctx.db.patch(row._id, {
                    phase: "sending",
                    due: false,
                    postNo: reserved.post.postNo,
                    attemptId: ctx.db.normalizeId("publishingAttempts", reserved.grant.attemptId)!,
                })
                return { type: "reserved", grant: reserved.grant }
            }
            case "blocked":
                // A report about a destination that changed since the bot read it changes nothing
                if (row.phase !== "post" || row.channelId !== op.channelId) return { type: "progress", recorded: false }
                await ctx.db.patch(row._id, {
                    state: row.state === "running" ? "ended" : row.state,
                    endedAt: row.endedAt ?? now,
                    phase: "done",
                    due: false,
                    expiresAt: now + GIVEAWAY_KEPT_MS,
                    ...problemFields(op.reason === "permission" ? "post-failed" : op.reason, now),
                })
                return { type: "progress", recorded: true }
            case "defer":
                if (!row.due) return { type: "progress", recorded: false }
                await ctx.db.patch(row._id, {
                    // A draw that could not read goes back to waiting, so its claim is free again
                    ...(row.phase === "draw" ? { phase: "wait" as const } : {}),
                    nextCheckAt: now + (op.problem ? PERMISSION_RETRY_MS : RETRY_MS),
                    ...(op.problem ? problemFields(op.problem, now) : {}),
                })
                return { type: "progress", recorded: true }
            case "draw-claim": {
                const expired = row.phase === "draw" && row.nextCheckAt <= now
                if ((row.phase !== "wait" && !expired) || row.nextCheckAt > now) return { type: "skipped" }
                if (row.state === "cancelled" || !row.messageId) return { type: "skipped" }
                if (!(await giveawayDraws(ctx, serverId))) return { type: "skipped" }
                await ctx.db.patch(row._id, { phase: "draw", nextCheckAt: now + CLAIM_MS })
                return {
                    type: "draw",
                    giveaway: await view(),
                    count: row.drawCount,
                    excludeIds: (await giveawayWinners(ctx, serverId, row.giveawayNo)).map((winner) => winner.userId),
                }
            }
            case "draw-record": {
                if (row.phase !== "draw") return { type: "progress", recorded: false }
                const drawNo = row.draws + 1
                for (const userId of op.winnerIds.slice(0, row.drawCount))
                    await ctx.db.insert("giveawayWinners", {
                        serverId,
                        giveawayNo: row.giveawayNo,
                        userId,
                        drawNo,
                        dm: "pending",
                        createdAt: now,
                    })
                await ctx.db.patch(row._id, {
                    state: "ended",
                    endedAt: row.endedAt ?? now,
                    phase: "announce",
                    nextCheckAt: now,
                    draws: drawNo,
                    entrants: op.entrants,
                    capped: op.capped || undefined,
                    expiresAt: now + GIVEAWAY_KEPT_MS,
                    ...(row.problem === "permission" ? problemFields(undefined, now) : {}),
                })
                return { type: "progress", recorded: true }
            }
            case "draw-gone":
                if (row.phase !== "draw") return { type: "progress", recorded: false }
                await ctx.db.patch(row._id, {
                    state: "ended",
                    endedAt: row.endedAt ?? now,
                    phase: "done",
                    due: false,
                    expiresAt: now + GIVEAWAY_KEPT_MS,
                    ...problemFields(op.reason, now),
                })
                return { type: "progress", recorded: true }
            case "announce-claim": {
                if (row.phase !== "announce" || !(await giveawayDraws(ctx, serverId))) return { type: "skipped" }
                const winnerIds: string[] = []
                for (const winner of await giveawayWinners(ctx, serverId, row.giveawayNo))
                    if (winner.drawNo === row.draws && winner.dm === "pending") {
                        await ctx.db.patch(winner._id, { dm: "sending" })
                        winnerIds.push(winner.userId)
                    }
                await ctx.db.patch(row._id, { phase: "announcing", nextCheckAt: now + CLAIM_MS })
                return { type: "announce", giveaway: await view(), winnerIds }
            }
            case "announce-outcome": {
                if (row.phase !== "announcing") return { type: "progress", recorded: false }
                for (const winner of await giveawayWinners(ctx, serverId, row.giveawayNo)) {
                    const outcome = op.dms.find((dm) => dm.userId === winner.userId)
                    if (winner.dm === "sending") await ctx.db.patch(winner._id, { dm: outcome?.outcome ?? "uncertain" })
                }
                await ctx.db.patch(row._id, {
                    phase: "done",
                    due: false,
                    ...problemFields(editProblem(op.card), now),
                })
                return { type: "progress", recorded: true }
            }
            case "cancel-claim":
                if (row.phase !== "cancel" || !row.messageId || (await defconHoldsAutomation(ctx, serverId)))
                    return { type: "skipped" }
                await ctx.db.patch(row._id, { phase: "cancelling", nextCheckAt: now + CLAIM_MS })
                return { type: "cancel", giveaway: await view() }
            case "cancel-outcome":
                if (row.phase !== "cancelling") return { type: "progress", recorded: false }
                await ctx.db.patch(row._id, {
                    phase: "done",
                    due: false,
                    ...problemFields(editProblem(op.card), now),
                })
                return { type: "progress", recorded: true }
            case "reaction":
                await ctx.db.patch(row._id, problemFields("reaction", now))
                return { type: "progress", recorded: true }
            case "confirm":
                if (row.problem !== "result-uncertain") return { type: "progress", recorded: false }
                await ctx.db.patch(row._id, problemFields(undefined, now))
                return { type: "progress", recorded: true }
        }
    },
})
