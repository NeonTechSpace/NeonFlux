import {
    EVENTS_NOTICE_DATES,
    EVENTS_NOTICE_PAGE,
    EventsWorkRequest,
    type EventsNoticeDate,
    type EventsNoticePage,
    type EventsPromotionBinding,
    type EventsWorkResult,
} from "@neonflux/contracts/events"
import { v } from "convex/values"
import { serviceMutation } from "./serviceGuard.ts"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { advanceEvent, epochOrder } from "./eventsDomain.ts"
import { eventRow, eventSettings, lifecycle, occurrenceRow, wakePromotion } from "./eventsStore.ts"
import { automationGate, defconHoldsAutomation } from "./schedulesStore.ts"
import { decode, fail, failedWith, integer } from "./validation.ts"
import { composerContext, eventEligible } from "./publishingContext.ts"

async function bound(ctx: MutationCtx, serverId: string, b: EventsPromotionBinding) {
    const occurrence = await occurrenceRow(ctx, serverId, b.eventNo, b.occurrenceNo, b.revision)
    const head = occurrence.headId ? await ctx.db.get(occurrence.headId) : null
    if (
        !occurrence.workActive ||
        occurrence.workGeneration !== b.generation ||
        occurrence.claimToken !== b.claimToken ||
        (occurrence.leaseExpiresAt ?? 0) <= Date.now() ||
        !head ||
        head.userId !== b.userId ||
        head.joinedAt !== b.joinedAt ||
        head.revision !== b.rsvpRevision ||
        head.membershipGeneration !== b.membershipGeneration ||
        head.queueOrder !== b.queueOrder ||
        head.allocation !== "waitlist"
    )
        fail(409, "Promotion binding changed")
    if (lifecycle({ ...occurrence.date, state: occurrence.state }) !== "open") fail(409, "Promotion closed")
    return { occurrence, head }
}
/** Members one notice page looks at most, so changed dates with many members who did not reply Going or Maybe span pages */
const NOTICE_SCAN = 50
/**
 * Claims the next members to tell that dates they replied Going or Maybe to moved or were cancelled. Members are taken once each
 * in member order across all changed dates, and the cursor moves in the same write, so a member is claimed once and never told
 * twice for one notice, even when they change a reply between pages or the bot stops before it sends. A claimed member is listed
 * with all their changed dates. A date that started before its notice went out is left out
 */
async function claimNotice(ctx: MutationCtx, serverId: string, now: number): Promise<EventsWorkResult> {
    const event = await ctx.db
        .query("events")
        .withIndex("by_notice_due", (q) => q.eq("serverId", serverId).gte("noticeDueAt", 0).lte("noticeDueAt", now))
        .first()
    if (!event) return { type: "notices" }
    const notice = event.notice
    if (!notice || event.state === "cancelled" || event.forgetting) {
        await ctx.db.patch(event._id, { noticeDueAt: undefined })
        return { type: "notices" }
    }
    const occurrences = new Map<number, Doc<"eventOccurrences"> | null>()
    for (const move of notice.moves)
        occurrences.set(
            move.occurrenceNo,
            await ctx.db
                .query("eventOccurrences")
                .withIndex("by_number", (q) =>
                    q.eq("serverId", serverId).eq("eventNo", event.eventNo).eq("occurrenceNo", move.occurrenceNo),
                )
                .unique(),
        )
    const changed = (move: (typeof notice.moves)[number]): Omit<EventsNoticeDate, "choice"> | undefined => {
        const row = occurrences.get(move.occurrenceNo)
        if (!row) return undefined
        if (move.cancelled)
            return row.state === "cancelled"
                ? {
                      occurrenceNo: move.occurrenceNo,
                      startsAt: row.date.startsAt,
                      fromStartsAt: move.fromStartsAt,
                      cancelled: true,
                  }
                : undefined
        return lifecycle({ state: row.state, ...row.date }, now) === "open" && row.date.startsAt !== move.fromStartsAt
            ? { occurrenceNo: move.occurrenceNo, startsAt: row.date.startsAt, fromStartsAt: move.fromStartsAt }
            : undefined
    }
    // The first reply after the given member on one changed date
    const after = (occurrenceNo: number, userId: string) =>
        ctx.db
            .query("eventRsvps")
            .withIndex("by_occurrence", (q) =>
                q
                    .eq("serverId", serverId)
                    .eq("eventNo", event.eventNo)
                    .eq("occurrenceNo", occurrenceNo)
                    .gt("userId", userId),
            )
            .first()
    const targets: EventsNoticePage["targets"] = []
    let afterUserId = notice.cursor?.afterUserId ?? "",
        scanned = 0
    const heads: (Doc<"eventRsvps"> | null)[] = []
    for (const move of notice.moves) heads.push(await after(move.occurrenceNo, afterUserId))
    while (scanned < NOTICE_SCAN && targets.length < EVENTS_NOTICE_PAGE) {
        // The next member in order who replied to any changed date
        const userId = heads.reduce<string | undefined>(
            (least, head) => (head && (least === undefined || head.userId < least) ? head.userId : least),
            undefined,
        )
        if (userId === undefined) break
        scanned++
        afterUserId = userId
        const dates: EventsNoticeDate[] = []
        let joinedAt: string | undefined
        for (const [index, move] of notice.moves.entries()) {
            const head = heads[index]
            if (head?.userId !== userId) continue
            heads[index] = await after(move.occurrenceNo, userId)
            if (head.choice !== "going" && head.choice !== "maybe") continue
            const date = changed(move)
            if (!date) continue
            joinedAt ??= head.joinedAt
            dates.push({ ...date, choice: head.choice })
        }
        if (joinedAt !== undefined)
            targets.push({
                userId,
                joinedAt,
                dates: dates.slice(0, EVENTS_NOTICE_DATES),
                more: Math.max(0, dates.length - EVENTS_NOTICE_DATES),
            })
    }
    const done = heads.every((head) => !head)
    const { cursor, next, ...progress } = notice
    // A finished notice hands over to the changes made while it went out
    await ctx.db.patch(event._id, {
        notice: done ? (next ? { ...next, sent: 0, failed: 0 } : progress) : { ...notice, cursor: { afterUserId } },
        noticeDueAt: done && !next ? undefined : now,
    })
    return {
        type: "notices",
        page: {
            eventNo: event.eventNo,
            revision: notice.revision,
            title: event.title,
            channelId: event.channelId,
            targets,
        },
    }
}
export const work = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<EventsWorkResult> => {
        const input = decode(EventsWorkRequest, request),
            serverId = input.serverId
        const op = input.operation,
            now = Date.now()
        const cursor = op.type === "list" || op.type === "member-targets" ? op.cursor : undefined
        if (op.type === "member-targets") {
            const userId = op.userId
            const afterEvent = cursor?.eventNo ?? 0,
                afterOccurrence = cursor?.occurrenceNo ?? 0
            // Lexicographic continuation uses two independently indexed bounded ranges
            const sameEvent =
                cursor === undefined
                    ? []
                    : await ctx.db
                          .query("eventRsvps")
                          .withIndex("by_member", (q) =>
                              q
                                  .eq("serverId", serverId)
                                  .eq("userId", userId)
                                  .eq("eventNo", afterEvent)
                                  .gt("occurrenceNo", afterOccurrence),
                          )
                          .take(21)
            const laterEvents =
                sameEvent.length >= 21
                    ? []
                    : await ctx.db
                          .query("eventRsvps")
                          .withIndex("by_member", (q) =>
                              q.eq("serverId", serverId).eq("userId", userId).gt("eventNo", afterEvent),
                          )
                          .take(21 - sameEvent.length)
            const rows = [...sameEvent, ...laterEvents],
                page = rows.slice(0, 20),
                targets = []
            for (const row of page)
                if (row.allocation !== "none") {
                    const occurrence = await occurrenceRow(ctx, serverId, row.eventNo, row.occurrenceNo)
                    if (lifecycle({ ...occurrence.date, state: occurrence.state }) === "open")
                        targets.push({
                            eventNo: row.eventNo,
                            occurrenceNo: row.occurrenceNo,
                            revision: occurrence.revision,
                            generation: occurrence.workGeneration,
                            userId,
                            joinedAt: row.joinedAt,
                            membershipGeneration: row.membershipGeneration,
                            rsvpRevision: row.revision,
                        })
                }
            const last = page.at(-1)
            return {
                type: "member-targets",
                targets,
                ...(rows.length > 20 && last
                    ? { nextCursor: { eventNo: last.eventNo, occurrenceNo: last.occurrenceNo } }
                    : {}),
            }
        }
        if (op.type === "observe") {
            const occurrence = await occurrenceRow(ctx, serverId, op.eventNo, op.occurrenceNo, op.revision),
                observedAt = integer(op.observedAt, now - 60000, now + 1000)
            const row = await ctx.db
                .query("eventRsvps")
                .withIndex("by_occurrence", (q) =>
                    q
                        .eq("serverId", serverId)
                        .eq("eventNo", occurrence.eventNo)
                        .eq("occurrenceNo", occurrence.occurrenceNo)
                        .eq("userId", op.userId),
                )
                .unique()
            const generation = op.membershipGeneration,
                revision = op.rsvpRevision,
                joinedAt = op.joinedAt
            if (
                occurrence.workGeneration !== op.generation ||
                lifecycle({ ...occurrence.date, state: occurrence.state }) !== "open" ||
                !row ||
                row.joinedAt !== joinedAt ||
                row.membershipGeneration !== generation ||
                row.revision !== revision ||
                observedAt < row.observedAt ||
                row.allocation === "none"
            )
                return { type: "progress", recorded: false }
            await ctx.db.patch(row._id, {
                choice: "none",
                allocation: "none",
                queueOrder: undefined,
                deferredUntil: undefined,
                revision: row.revision + 1,
                observedAt,
            })
            await wakePromotion(ctx, occurrence, {
                going: occurrence.going - (row.allocation === "seat" ? 1 : 0),
                waitlisted: occurrence.waitlisted - (row.allocation === "waitlist" ? 1 : 0),
            })
            return { type: "progress", recorded: true }
        }
        if (op.type === "notice-outcome") {
            const event = await eventRow(ctx, serverId, op.eventNo)
            if (event.notice?.revision !== op.revision) return { type: "progress", recorded: false }
            await ctx.db.patch(event._id, {
                notice: { ...event.notice, sent: event.notice.sent + op.sent, failed: event.notice.failed + op.failed },
            })
            return { type: "progress", recorded: true }
        }
        if (op.type === "defer") {
            const { occurrence } = await bound(ctx, serverId, op.binding)
            // Ambiguous reads defer this occurrence without passing its head
            await ctx.db.patch(occurrence._id, {
                nextCheckAt: now + 60000,
                claimToken: undefined,
                leaseExpiresAt: undefined,
                headId: undefined,
            })
            return { type: "progress", recorded: true }
        }
        const enabled = (await eventSettings(ctx, serverId))?.enabled
        if (!enabled)
            return op.type === "list"
                ? { type: "jobs", jobs: [] }
                : op.type === "claim"
                  ? { type: "head", claimed: false }
                  : op.type === "notice-claim"
                    ? { type: "notices" }
                    : { type: "progress", recorded: false }
        // Notices wait while DEFCON holds automatic work, as promotions do
        if (op.type === "notice-claim")
            return (await defconHoldsAutomation(ctx, serverId)) ? { type: "notices" } : claimNotice(ctx, serverId, now)
        await automationGate(ctx, serverId)
        if (op.type === "list") {
            const limit = op.limit ?? 20
            const afterEvent = cursor?.eventNo ?? 0,
                afterOccurrence = cursor?.occurrenceNo ?? 0
            const sameEvent =
                cursor === undefined
                    ? []
                    : await ctx.db
                          .query("eventOccurrences")
                          .withIndex("by_number", (q) =>
                              q.eq("serverId", serverId).eq("eventNo", afterEvent).gt("occurrenceNo", afterOccurrence),
                          )
                          .take(limit + 1)
            const laterEvents =
                sameEvent.length > limit
                    ? []
                    : await ctx.db
                          .query("eventOccurrences")
                          .withIndex("by_number", (q) => q.eq("serverId", serverId).gt("eventNo", afterEvent))
                          .take(limit + 1 - sameEvent.length)
            const rows = [...sameEvent, ...laterEvents],
                page = rows.slice(0, limit)
            const jobs = []
            for (const row of page) {
                if (!row.workActive) continue
                if (lifecycle({ ...row.date, state: row.state }) !== "open") {
                    await ctx.db.patch(row._id, {
                        workActive: false,
                        workGeneration: advanceEvent(row.workGeneration),
                        claimToken: undefined,
                        leaseExpiresAt: undefined,
                        headId: undefined,
                    })
                    continue
                }
                if (row.nextCheckAt > now || (row.leaseExpiresAt ?? 0) > now) continue
                const event = await eventRow(ctx, serverId, row.eventNo, row.revision)
                if (!event.forgetting && event.state !== "cancelled")
                    jobs.push({
                        eventNo: row.eventNo,
                        occurrenceNo: row.occurrenceNo,
                        revision: row.revision,
                        generation: row.workGeneration,
                        nextCheckAt: row.nextCheckAt,
                        channelId: event.channelId,
                    })
            }
            const last = page.at(-1)
            return {
                type: "jobs",
                jobs,
                ...(rows.length > limit && last
                    ? { nextCursor: { eventNo: last.eventNo, occurrenceNo: last.occurrenceNo } }
                    : {}),
            }
        }
        if (op.type === "claim") {
            const occurrence = await occurrenceRow(ctx, serverId, op.eventNo, op.occurrenceNo, op.revision),
                token = op.claimToken
            if (
                occurrence.workGeneration !== op.generation ||
                !occurrence.workActive ||
                occurrence.nextCheckAt > now ||
                (occurrence.leaseExpiresAt ?? 0) > now ||
                lifecycle({ ...occurrence.date, state: occurrence.state }) !== "open"
            )
                return { type: "head", claimed: false }
            // Pages inspect twenty rows, so a long waitlist spans pages
            const after = occurrence.workAfterQueue ?? 0
            const rows = await ctx.db
                .query("eventRsvps")
                .withIndex("by_queue", (q) =>
                    q
                        .eq("serverId", serverId)
                        .eq("eventNo", occurrence.eventNo)
                        .eq("occurrenceNo", occurrence.occurrenceNo)
                        .eq("allocation", "waitlist")
                        .gt("queueOrder", after),
                )
                .take(21)
            const page = rows.slice(0, 20)
            const head = page.find((row) => (row.deferredUntil ?? 0) <= now)
            if (!head) {
                const resetAt = Math.min(
                    occurrence.workResetAt ?? now + 60000,
                    ...page.map((r) => r.deferredUntil ?? now + 60000),
                )
                await ctx.db.patch(occurrence._id, {
                    nextCheckAt: rows.length > 20 ? now : resetAt,
                    workAfterQueue: rows.length > 20 ? page.at(-1)!.queueOrder : undefined,
                    workResetAt: rows.length > 20 ? resetAt : undefined,
                })
                return { type: "head", claimed: false }
            }
            const leaseExpiresAt = Math.min(now + 60000, occurrence.date.startsAt)
            await ctx.db.patch(occurrence._id, {
                claimToken: token,
                leaseExpiresAt,
                headId: head._id,
                nextCheckAt: leaseExpiresAt,
            })
            return {
                type: "head",
                claimed: true,
                leaseExpiresAt,
                binding: {
                    eventNo: occurrence.eventNo,
                    occurrenceNo: occurrence.occurrenceNo,
                    revision: occurrence.revision,
                    generation: occurrence.workGeneration,
                    claimToken: token,
                    rsvpRevision: head.revision,
                    membershipGeneration: head.membershipGeneration,
                    userId: head.userId,
                    joinedAt: head.joinedAt,
                    queueOrder: head.queueOrder!,
                },
            }
        }
        if (op.type === "promote") {
            const b = op.binding,
                { occurrence, head } = await bound(ctx, serverId, b),
                context = composerContext(op.context),
                event = await eventRow(ctx, serverId, b.eventNo, b.revision),
                member = context.member
            if (
                context.observedAt < head.observedAt ||
                !member ||
                member.userId !== head.userId ||
                context.channelId !== event.channelId
            )
                fail(409, "Promotion observation changed")
            if (member.joinedAt !== head.joinedAt) {
                if (epochOrder(member.joinedAt) <= epochOrder(head.joinedAt)) fail(409, "Stale promotion membership")
                await ctx.db.patch(head._id, {
                    choice: "none",
                    allocation: "none",
                    queueOrder: undefined,
                    deferredUntil: undefined,
                    revision: head.revision + 1,
                    observedAt: context.observedAt,
                })
                await wakePromotion(ctx, occurrence, { waitlisted: occurrence.waitlisted - 1 })
                return { type: "progress", recorded: true, promoted: false }
            }
            try {
                await eventEligible(ctx, serverId, context, event.channelId, head.userId)
            } catch (error) {
                if (!failedWith(error, 403)) throw error
                await ctx.db.patch(head._id, { deferredUntil: now + 60000, observedAt: context.observedAt })
                await wakePromotion(ctx, occurrence)
                await ctx.db.patch(occurrence._id, {
                    workAfterQueue: head.queueOrder,
                    workResetAt: Math.min(occurrence.workResetAt ?? now + 60000, now + 60000),
                })
                return { type: "progress", recorded: true, promoted: false }
            }
            if (occurrence.capacity !== null && occurrence.going >= occurrence.capacity)
                fail(409, "No promotion seat available")
            await ctx.db.patch(head._id, {
                allocation: "seat",
                queueOrder: undefined,
                deferredUntil: undefined,
                revision: head.revision + 1,
                observedAt: context.observedAt,
            })
            await wakePromotion(ctx, occurrence, { going: occurrence.going + 1, waitlisted: occurrence.waitlisted - 1 })
            return { type: "progress", recorded: true, promoted: true }
        }
        fail(400, "Invalid event work operation")
    },
})
