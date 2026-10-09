import { v, ConvexError } from "convex/values"
import type { EventsMemberCursor, EventsPromotionBinding, EventsWorkResult } from "../contracts.js"
import { serviceMutation } from "./installations.ts"
import type { MutationCtx } from "./_generated/server.js"
import { claimToken, epoch } from "./rolesDomain.ts"
import { advanceEvent, epochOrder } from "./eventsDomain.ts"
import { shape } from "./publishingDomain.ts"
import { eventRow, eventSettings, lifecycle, occurrenceRow, wakePromotion } from "./eventsStore.ts"
import { eventGate } from "./schedulesStore.ts"
import { fail, object, requireId, requireServer, integer } from "./validation.ts"
import { eventContext, eventEligible } from "./publishingContext.ts"

function memberCursor(value: unknown): EventsMemberCursor | undefined {
    if (value === undefined) return undefined
    const row = shape(value, ["eventNo", "occurrenceNo"], ["eventNo", "occurrenceNo"])
    return { eventNo: integer(row.eventNo, 1, Number.MAX_SAFE_INTEGER), occurrenceNo: integer(row.occurrenceNo, 1, Number.MAX_SAFE_INTEGER) }
}

function binding(value: unknown): EventsPromotionBinding {
    const r = shape(value, ["eventNo", "occurrenceNo", "revision", "generation", "claimToken", "rsvpRevision", "membershipGeneration", "userId", "joinedAt", "queueOrder"], ["eventNo", "occurrenceNo", "revision", "generation", "claimToken", "rsvpRevision", "membershipGeneration", "userId", "joinedAt", "queueOrder"])
    return { eventNo: integer(r.eventNo, 1, Number.MAX_SAFE_INTEGER), occurrenceNo: integer(r.occurrenceNo, 1, Number.MAX_SAFE_INTEGER), revision: integer(r.revision, 1, Number.MAX_SAFE_INTEGER), generation: integer(r.generation, 1, Number.MAX_SAFE_INTEGER), claimToken: claimToken(r.claimToken), rsvpRevision: integer(r.rsvpRevision, 1, Number.MAX_SAFE_INTEGER), membershipGeneration: integer(r.membershipGeneration, 1, Number.MAX_SAFE_INTEGER), userId: requireId(r.userId), joinedAt: epoch(r.joinedAt), queueOrder: integer(r.queueOrder, 1, Number.MAX_SAFE_INTEGER) }
}
async function bound(ctx: MutationCtx, serverId: string, b: EventsPromotionBinding) {
    const occurrence = await occurrenceRow(ctx, serverId, b.eventNo, b.occurrenceNo, b.revision)
    const head = occurrence.headId ? await ctx.db.get(occurrence.headId) : null
    if (!occurrence.workActive || occurrence.workGeneration !== b.generation || occurrence.claimToken !== b.claimToken || (occurrence.leaseExpiresAt ?? 0) <= Date.now() || !head || head.userId !== b.userId || head.joinedAt !== b.joinedAt || head.revision !== b.rsvpRevision || head.membershipGeneration !== b.membershipGeneration || head.queueOrder !== b.queueOrder || head.allocation !== "waitlist") fail(409, "Promotion binding changed")
    if (lifecycle({ ...occurrence.date, state: occurrence.state }) !== "open") fail(409, "Promotion closed")
    return { occurrence, head }
}
export const work = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<EventsWorkResult> => {
    const input = shape(request, ["serverId", "operation"], ["serverId", "operation"]), serverId = requireId(input.serverId); requireServer(serverId)
    const op = object(input.operation), now = Date.now()
    // Validate explicit continuation before even disabled-state reads or progress
    const cursor = op.type === "list" || op.type === "member-targets" ? memberCursor(op.cursor) : undefined
    if (op.type === "list") shape(op, ["type", "cursor", "limit"], ["type"])
    if (op.type === "member-targets") {
        shape(op, ["type", "userId", "cursor"], ["type", "userId"])
        const userId = requireId(op.userId)
        const afterEvent = cursor?.eventNo ?? 0, afterOccurrence = cursor?.occurrenceNo ?? 0
        // Lexicographic continuation uses two independently indexed bounded ranges
        const sameEvent = cursor === undefined ? [] : await ctx.db.query("eventRsvps").withIndex("by_member", q => q.eq("serverId", serverId).eq("userId", userId).eq("eventNo", afterEvent).gt("occurrenceNo", afterOccurrence)).take(21)
        const laterEvents = sameEvent.length >= 21 ? [] : await ctx.db.query("eventRsvps").withIndex("by_member", q => q.eq("serverId", serverId).eq("userId", userId).gt("eventNo", afterEvent)).take(21 - sameEvent.length)
        const rows = [...sameEvent, ...laterEvents], page = rows.slice(0, 20), targets = []
        for (const row of page) if (row.allocation !== "none") {
            const occurrence = await occurrenceRow(ctx, serverId, row.eventNo, row.occurrenceNo)
            if (lifecycle({ ...occurrence.date, state: occurrence.state }) === "open") targets.push({ eventNo: row.eventNo, occurrenceNo: row.occurrenceNo, revision: occurrence.revision, generation: occurrence.workGeneration, userId, joinedAt: row.joinedAt, membershipGeneration: row.membershipGeneration, rsvpRevision: row.revision })
        }
        const last = page.at(-1)
        return { type: "member-targets", targets, ...(rows.length > 20 && last ? { nextCursor: { eventNo: last.eventNo, occurrenceNo: last.occurrenceNo } } : {}) }
    }
    if (op.type === "observe") {
        shape(op, ["type", "eventNo", "occurrenceNo", "revision", "generation", "userId", "joinedAt", "membershipGeneration", "rsvpRevision", "observedAt", "memberAbsent"], ["type", "eventNo", "occurrenceNo", "revision", "generation", "userId", "joinedAt", "membershipGeneration", "rsvpRevision", "observedAt", "memberAbsent"])
        const occurrence = await occurrenceRow(ctx, serverId, integer(op.eventNo, 1, Number.MAX_SAFE_INTEGER), op.occurrenceNo, op.revision), observedAt = integer(op.observedAt, now - 60000, now + 1000)
        if (op.memberAbsent !== true) fail(400, "Typed absence required")
        const row = await ctx.db.query("eventRsvps").withIndex("by_occurrence", q => q.eq("serverId", serverId).eq("eventNo", occurrence.eventNo).eq("occurrenceNo", occurrence.occurrenceNo).eq("userId", requireId(op.userId))).unique()
        const generation = integer(op.membershipGeneration, 1, Number.MAX_SAFE_INTEGER), revision = integer(op.rsvpRevision, 1, Number.MAX_SAFE_INTEGER), joinedAt = epoch(op.joinedAt)
        if (occurrence.workGeneration !== integer(op.generation, 1, Number.MAX_SAFE_INTEGER) || lifecycle({ ...occurrence.date, state: occurrence.state }) !== "open" || !row || row.joinedAt !== joinedAt || row.membershipGeneration !== generation || row.revision !== revision || observedAt < row.observedAt || row.allocation === "none") return { type: "progress", recorded: false }
        await ctx.db.patch(row._id, { choice: "none", allocation: "none", queueOrder: undefined, deferredUntil: undefined, revision: row.revision + 1, observedAt })
        await wakePromotion(ctx, occurrence, { going: occurrence.going - (row.allocation === "seat" ? 1 : 0), waitlisted: occurrence.waitlisted - (row.allocation === "waitlist" ? 1 : 0) })
        return { type: "progress", recorded: true }
    }
    if (op.type === "defer") {
        shape(op, ["type", "binding"], ["type", "binding"])
        const { occurrence } = await bound(ctx, serverId, binding(op.binding))
        // Ambiguous reads defer this occurrence without passing its head
        await ctx.db.patch(occurrence._id, { nextCheckAt: now + 60000, claimToken: undefined, leaseExpiresAt: undefined, headId: undefined })
        return { type: "progress", recorded: true }
    }
    const enabled = (await eventSettings(ctx, serverId))?.enabled
    if (!enabled) return op.type === "list" ? { type: "jobs", jobs: [] } : op.type === "claim" ? { type: "head", claimed: false } : { type: "progress", recorded: false }
    await eventGate(ctx, serverId)
    if (op.type === "list") {
        const limit = op.limit === undefined ? 20 : integer(op.limit, 1, 20)
        const afterEvent = cursor?.eventNo ?? 0, afterOccurrence = cursor?.occurrenceNo ?? 0
        const sameEvent = cursor === undefined ? [] : await ctx.db.query("eventOccurrences").withIndex("by_number", q => q.eq("serverId", serverId).eq("eventNo", afterEvent).gt("occurrenceNo", afterOccurrence)).take(limit + 1)
        const laterEvents = sameEvent.length > limit ? [] : await ctx.db.query("eventOccurrences").withIndex("by_number", q => q.eq("serverId", serverId).gt("eventNo", afterEvent)).take(limit + 1 - sameEvent.length)
        const rows = [...sameEvent, ...laterEvents], page = rows.slice(0, limit)
        const jobs = []
        for (const row of page) {
            if (!row.workActive) continue
            if (lifecycle({ ...row.date, state: row.state }) !== "open") {
                await ctx.db.patch(row._id, { workActive: false, workGeneration: advanceEvent(row.workGeneration), claimToken: undefined, leaseExpiresAt: undefined, headId: undefined })
                continue
            }
            if (row.nextCheckAt > now || (row.leaseExpiresAt ?? 0) > now) continue
            const event = await eventRow(ctx, serverId, row.eventNo, row.revision)
            if (!event.forgetting && event.state !== "cancelled") jobs.push({ eventNo: row.eventNo, occurrenceNo: row.occurrenceNo, revision: row.revision, generation: row.workGeneration, nextCheckAt: row.nextCheckAt, channelId: event.channelId })
        }
        const last = page.at(-1)
        return { type: "jobs", jobs, ...(rows.length > limit && last ? { nextCursor: { eventNo: last.eventNo, occurrenceNo: last.occurrenceNo } } : {}) }
    }
    if (op.type === "claim") {
        shape(op, ["type", "eventNo", "occurrenceNo", "revision", "generation", "claimToken"], ["type", "eventNo", "occurrenceNo", "revision", "generation", "claimToken"])
        const occurrence = await occurrenceRow(ctx, serverId, integer(op.eventNo, 1, Number.MAX_SAFE_INTEGER), op.occurrenceNo, op.revision), token = claimToken(op.claimToken)
        if (occurrence.workGeneration !== integer(op.generation, 1, Number.MAX_SAFE_INTEGER) || !occurrence.workActive || occurrence.nextCheckAt > now || (occurrence.leaseExpiresAt ?? 0) > now || lifecycle({ ...occurrence.date, state: occurrence.state }) !== "open") return { type: "head", claimed: false }
        // At most 1000 rows by the participation contract, but pages inspect twenty
        const after = occurrence.workAfterQueue ?? 0
        const rows = await ctx.db.query("eventRsvps").withIndex("by_queue", q => q.eq("serverId", serverId).eq("eventNo", occurrence.eventNo).eq("occurrenceNo", occurrence.occurrenceNo).eq("allocation", "waitlist").gt("queueOrder", after)).take(21)
        const page = rows.slice(0, 20)
        const head = page.find(row => (row.deferredUntil ?? 0) <= now)
        if (!head) {
            const resetAt = Math.min(occurrence.workResetAt ?? now + 60000, ...page.map(r => r.deferredUntil ?? now + 60000))
            await ctx.db.patch(occurrence._id, { nextCheckAt: rows.length > 20 ? now : resetAt, workAfterQueue: rows.length > 20 ? page.at(-1)!.queueOrder : undefined, workResetAt: rows.length > 20 ? resetAt : undefined })
            return { type: "head", claimed: false }
        }
        const leaseExpiresAt = Math.min(now + 60000, occurrence.date.startsAt)
        await ctx.db.patch(occurrence._id, { claimToken: token, leaseExpiresAt, headId: head._id, nextCheckAt: leaseExpiresAt })
        return { type: "head", claimed: true, leaseExpiresAt, binding: { eventNo: occurrence.eventNo, occurrenceNo: occurrence.occurrenceNo, revision: occurrence.revision, generation: occurrence.workGeneration, claimToken: token, rsvpRevision: head.revision, membershipGeneration: head.membershipGeneration, userId: head.userId, joinedAt: head.joinedAt, queueOrder: head.queueOrder! } }
    }
    if (op.type === "promote") {
        shape(op, ["type", "binding", "context"], ["type", "binding", "context"])
        const b = binding(op.binding), { occurrence, head } = await bound(ctx, serverId, b), context = eventContext(op.context), event = await eventRow(ctx, serverId, b.eventNo, b.revision), member = context.member
        if (context.observedAt < head.observedAt || !member || member.userId !== head.userId || context.channelId !== event.channelId) fail(409, "Promotion observation changed")
        if (member.joinedAt !== head.joinedAt) {
            if (epochOrder(member.joinedAt) <= epochOrder(head.joinedAt)) fail(409, "Stale promotion membership")
            await ctx.db.patch(head._id, { choice: "none", allocation: "none", queueOrder: undefined, deferredUntil: undefined, revision: head.revision + 1, observedAt: context.observedAt })
            await wakePromotion(ctx, occurrence, { waitlisted: occurrence.waitlisted - 1 })
            return { type: "progress", recorded: true, promoted: false }
        }
        try { await eventEligible(ctx, serverId, context, event.channelId, head.userId) }
        catch (error) {
            if (!(error instanceof ConvexError) || error.data === null || typeof error.data !== "object" || !("status" in error.data) || error.data.status !== 403) throw error
            await ctx.db.patch(head._id, { deferredUntil: now + 60000, observedAt: context.observedAt })
            await wakePromotion(ctx, occurrence)
            await ctx.db.patch(occurrence._id, { workAfterQueue: head.queueOrder, workResetAt: Math.min(occurrence.workResetAt ?? now + 60000, now + 60000) })
            return { type: "progress", recorded: true, promoted: false }
        }
        if (occurrence.capacity !== null && occurrence.going >= occurrence.capacity) fail(409, "No promotion seat available")
        await ctx.db.patch(head._id, { allocation: "seat", queueOrder: undefined, deferredUntil: undefined, revision: head.revision + 1, observedAt: context.observedAt })
        await wakePromotion(ctx, occurrence, { going: occurrence.going + 1, waitlisted: occurrence.waitlisted - 1 })
        return { type: "progress", recorded: true, promoted: true }
    }
    fail(400, "Invalid event work operation")
} })
