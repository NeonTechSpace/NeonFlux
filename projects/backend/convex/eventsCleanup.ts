import { internal } from "./_generated/api.js"
import { internalMutation } from "./_generated/server.js"
import { EVENTS_BATCH, EVENTS_DAY, advanceEvent } from "./eventsDomain.ts"
import { eventCount } from "./eventsStore.ts"

export const cleanup = internalMutation({ args: {}, handler: async (ctx): Promise<{ removed: number }> => {
    const now = Date.now()
    let removed = 0, participationRemoved = 0
    const receipts = await ctx.db.query("eventReceipts").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(EVENTS_BATCH)
    for (const row of receipts) { await ctx.db.delete(row._id); await eventCount(ctx, row.serverId, "receipts", -1); removed++ }
    const started = await ctx.db.query("eventOccurrences").withIndex("by_state_start", q => q.eq("state", "open").lte("date.startsAt", now)).take(EVENTS_BATCH)
    for (const row of started) await ctx.db.patch(row._id, { state: now >= row.date.endsAt ? "completed" : "started", workActive: false, workGeneration: advanceEvent(row.workGeneration), claimToken: undefined, leaseExpiresAt: undefined, headId: undefined, ...(now >= row.date.endsAt ? { terminalAt: row.date.endsAt, participationExpiresAt: row.date.endsAt + 30 * EVENTS_DAY } : {}) })
    const completed = await ctx.db.query("eventOccurrences").withIndex("by_state_end", q => q.eq("state", "started").lte("date.endsAt", now)).take(EVENTS_BATCH)
    for (const row of completed) await ctx.db.patch(row._id, { state: "completed", terminalAt: row.date.endsAt, participationExpiresAt: row.date.endsAt + 30 * EVENTS_DAY })
    const participation = await ctx.db.query("eventOccurrences").withIndex("by_participation_expiry", q => q.gt("participationExpiresAt", 0).lte("participationExpiresAt", now)).take(EVENTS_BATCH)
    for (const occurrence of participation) {
        const rows = await ctx.db.query("eventRsvps").withIndex("by_occurrence", q => q.eq("serverId", occurrence.serverId).eq("eventNo", occurrence.eventNo).eq("occurrenceNo", occurrence.occurrenceNo)).take(EVENTS_BATCH - participationRemoved)
        for (const row of rows) { await ctx.db.delete(row._id); await eventCount(ctx, row.serverId, "rsvps", -1); removed++; participationRemoved++ }
        const pending = await ctx.db.query("eventRsvps").withIndex("by_occurrence", q => q.eq("serverId", occurrence.serverId).eq("eventNo", occurrence.eventNo).eq("occurrenceNo", occurrence.occurrenceNo)).first()
        if (!pending) await ctx.db.patch(occurrence._id, { rsvps: 0, going: 0, waitlisted: 0, participationExpiresAt: undefined })
        if (participationRemoved >= EVENTS_BATCH) break
    }
    // Definition anchors remain discoverable while protected tracked posts exist
    const events = await ctx.db.query("events").withIndex("by_history", q => q.gt("historyExpiresAt", 0).lte("historyExpiresAt", now)).take(EVENTS_BATCH)
    for (const event of events) {
        const protectedPost = await ctx.db.query("publishingPosts").withIndex("by_event", q => q.eq("serverId", event.serverId).eq("consumer.eventNo", event.eventNo)).first()
        const occurrence = await ctx.db.query("eventOccurrences").withIndex("by_event", q => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo)).first()
        if (occurrence) {
            if (await ctx.db.query("eventRsvps").withIndex("by_occurrence", q => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo).eq("occurrenceNo", occurrence.occurrenceNo)).first()) continue
            await ctx.db.delete(occurrence._id); await eventCount(ctx, event.serverId, "occurrences", -1); removed++; continue
        }
        const delivery = await ctx.db.query("eventDeliveries").withIndex("by_event", q => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo)).first()
        if (delivery) {
            const attempt = delivery.attemptId ? await ctx.db.get(delivery.attemptId) : null
            if (!attempt?.unresolved) { await ctx.db.delete(delivery._id); removed++; continue }
        }
        if (protectedPost || delivery) {
            await ctx.db.patch(event._id, { description: "", template: undefined, calendar: undefined, historyExpiresAt: now + EVENTS_DAY })
            continue
        }
        await ctx.db.delete(event._id); await eventCount(ctx, event.serverId, "definitions", -1); removed++
    }
    const ended = await ctx.db.query("events").withIndex("by_state_end", q => q.eq("state", "open").gt("endsAt", 0).lte("endsAt", now)).take(EVENTS_BATCH)
    for (const event of ended) await ctx.db.patch(event._id, { state: "completed", terminalAt: event.endsAt, historyExpiresAt: event.endsAt! + 180 * EVENTS_DAY })
    // Each full page above leaves its range, so a continuation always makes progress
    if ([receipts, started, completed, ended].some(page => page.length === EVENTS_BATCH)) await ctx.scheduler.runAfter(0, internal.eventsCleanup.cleanup, {})
    return { removed }
} })
