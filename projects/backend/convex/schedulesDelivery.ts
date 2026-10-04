import { v } from "convex/values"
import {
    SchedulesDeliveryRequest,
    type SchedulesDeliveryGrant,
    type SchedulesDeliveryResult,
} from "@neonflux/contracts/schedules"
import { serviceMutation } from "./serviceGuard.ts"
import { internalMutation, type MutationCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import type { Doc } from "./_generated/dataModel.js"
import { age, publicAttempt, reservePublishing } from "./publishing.ts"
import { automationContext, SCHEDULES_BATCH } from "./schedulesDomain.ts"
import {
    boundScheduleDelivery,
    closeScheduleDelivery,
    defconHoldsAutomation,
    publicScheduleDelivery,
    scheduleAutomation,
    scheduleAvailability,
    scheduleState,
} from "./schedulesStore.ts"
import { decode, fail, failedWith } from "./validation.ts"
import { civilDayEnd, civilDayEnded } from "./civilDomain.ts"
import { ringWork } from "./workSignal.ts"

async function available(ctx: MutationCtx, row: Doc<"scheduleDeliveries">, now: number) {
    if (!row.active || row.claimedAt !== undefined) return "terminal" as const
    const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
    if (attempt && (attempt.outcome !== "pending" || attempt.dispatchedAt !== undefined)) return "terminal" as const
    const gate = await scheduleAvailability(ctx, row)
    if (gate.cancelled) {
        await closeScheduleDelivery(ctx, row, "cancelled", "cancelled", now)
        return "cancelled" as const
    }
    if (row.dueAt <= gate.cutoff) {
        await closeScheduleDelivery(ctx, row, "skipped", "activation-cutoff", now)
        return "skipped" as const
    }
    if (civilDayEnded(row.dueAt, row.zone, now)) {
        await closeScheduleDelivery(ctx, row, "skipped", "late-window", now)
        return "skipped" as const
    }
    if (attempt && now >= attempt.dispatchExpiresAt) {
        await age(ctx, attempt, now)
        return "terminal" as const
    }
    return gate.enabled && now >= row.dueAt ? ("ready" as const) : ("waiting" as const)
}
export const delivery = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<SchedulesDeliveryResult> => {
        const { serverId, operation: op } = decode(SchedulesDeliveryRequest, request),
            now = Date.now()
        if (op.type === "list") {
            const current = await scheduleState(ctx, serverId),
                explicit = op.cursor
            if (explicit && explicit.throughAt > now) fail(400, "Invalid schedule delivery cursor")
            const cursor = explicit ? explicit.cursor : (current.discoveryCursor ?? null),
                throughAt = explicit?.throughAt ?? current.discoveryThroughAt ?? now
            const page = await ctx.db
                .query("scheduleDeliveries")
                .withIndex("by_discovery", (q) =>
                    q.eq("serverId", serverId).eq("active", true).lte("nextCheckAt", throughAt),
                )
                .paginate({ cursor, numItems: SCHEDULES_BATCH })
            const deliveries = [],
                held = await defconHoldsAutomation(ctx, serverId)
            for (const row of page.page) {
                const status = await available(ctx, row, now)
                // A post that is due but not ready is waiting for the schedule, the module or publishing to be on
                if ((status === "ready" && held) || (status === "waiting" && now >= row.dueAt)) {
                    // DEFCON or an off switch holds the post, so the bot reads nothing from Fluxer for it and nothing checks it
                    // every minute. DEFCON 3 wakes it. Turning a switch on cannot make it sendable, since the activation
                    // skips it, so it otherwise comes back at local midnight, when it is skipped as late. A post with an open
                    // reservation comes back when the reservation's grant ends, so this list can close the reservation then
                    const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
                    await ctx.db.patch(row._id, {
                        nextCheckAt: Math.min(civilDayEnd(row.dueAt, row.zone), attempt?.dispatchExpiresAt ?? Infinity),
                    })
                    continue
                }
                // A durable visit advances even when native permissions cannot be fetched
                if (status === "ready" || status === "waiting")
                    await ctx.db.patch(row._id, { nextCheckAt: now + 60000 })
                if (status === "ready") deliveries.push(publicScheduleDelivery({ ...row, nextCheckAt: now + 60000 }))
            }
            await ctx.db.patch(current._id, {
                discoveryCursor: page.isDone ? undefined : page.continueCursor,
                discoveryThroughAt: page.isDone ? undefined : throughAt,
            })
            return {
                type: "deliveries",
                deliveries,
                hasMore: !page.isDone,
                ...(!page.isDone ? { nextCursor: { cursor: page.continueCursor, throughAt } } : {}),
            }
        }
        const row = await boundScheduleDelivery(ctx, serverId, op.binding),
            status = await available(ctx, row, now)
        if (op.type === "defer") {
            if (status !== "ready" && status !== "waiting") return { type: "progress", recorded: false }
            await ctx.db.patch(row._id, {
                ...(row.attemptId ? {} : { state: "blocked" as const, reason: "permission" as const }),
                nextCheckAt: now + 60000,
            })
            return { type: "progress", recorded: true }
        }
        if (status !== "ready") return { type: "reservation", status }
        const context = automationContext(op.context)
        try {
            await scheduleAutomation(ctx, serverId, context, row.channelId)
        } catch (error) {
            if (!failedWith(error, 403)) throw error
            await ctx.db.patch(row._id, {
                ...(row.attemptId ? {} : { state: "blocked" as const, reason: "permission" as const }),
                nextCheckAt: now + 60000,
            })
            return { type: "reservation", status: "waiting" }
        }
        if (row.attemptId) {
            const attempt = await ctx.db.get(row.attemptId)
            if (
                !attempt ||
                attempt.consumer?.type !== "schedule" ||
                attempt.consumer.deliveryId !== row._id ||
                attempt.botId !== context.botId
            )
                fail(409, "Reserved schedule publication changed")
            const { outcome, createdAt, finishedAt, dispatchedAt, noDispatch, observation, resolution, ...grant } =
                publicAttempt(attempt)
            return { type: "reservation", status: "reserved", grant: grant as SchedulesDeliveryGrant }
        }
        const reserved = await reservePublishing(ctx, {
            serverId,
            actorId: context.botId,
            botId: context.botId,
            channelId: row.channelId,
            sourceId: `schedule_timer_${row._id}`,
            source: { type: "schedule-timer", deliveryId: row._id, dueAt: row.dueAt },
            provenance: {
                type: "schedule",
                scheduleNo: row.scheduleNo,
                planRevision: row.planRevision,
                source: row.source,
            },
            consumer: {
                type: "schedule",
                scheduleNo: row.scheduleNo,
                planRevision: row.planRevision,
                occurrenceNo: row.occurrenceNo,
                deliveryId: row._id,
            },
            content: row.content,
            expiresAt: now + 180000,
        })
        const attemptId = ctx.db.normalizeId("publishingAttempts", reserved.grant.attemptId)!
        await ctx.db.patch(row._id, {
            state: "reserved",
            reason: undefined,
            postNo: reserved.post.postNo,
            attemptId,
            nextCheckAt: now,
        })
        return { type: "reservation", status: "reserved", grant: reserved.grant as SchedulesDeliveryGrant }
    },
})
/**
 * Makes the due posts that DEFCON held due again once DEFCON is back at 3. Each transaction reads one page of the server's due
 * active deliveries and schedules the next, and stops if DEFCON falls below 3 again
 */
export const wake = internalMutation({
    args: { serverId: v.string(), throughAt: v.number(), cursor: v.union(v.string(), v.null()) },
    handler: async (ctx, { serverId, throughAt, cursor }) => {
        if (await defconHoldsAutomation(ctx, serverId)) return
        const now = Date.now()
        const page = await ctx.db
            .query("scheduleDeliveries")
            .withIndex("by_server_due", (q) => q.eq("serverId", serverId).eq("active", true).lte("dueAt", throughAt))
            .paginate({ cursor, numItems: SCHEDULES_BATCH })
        let woken = false
        for (const row of page.page)
            if (row.claimedAt === undefined && row.nextCheckAt > now) {
                await ctx.db.patch(row._id, { nextCheckAt: now })
                woken = true
            }
        // No bot request reports this new due work, so the work signal tells the bot at once
        if (woken) await ringWork(ctx)
        if (!page.isDone)
            await ctx.scheduler.runAfter(0, internal.schedulesDelivery.wake, {
                serverId,
                throughAt,
                cursor: page.continueCursor,
            })
    },
})
