import type { MutationCtx } from "./_generated/server.js"
import { EVENTS_BATCH, EVENTS_DAY, advanceEvent } from "./eventsDomain.ts"
import { eventCount, eventRepeats, releaseEvent } from "./eventsStore.ts"
import { extendEvent } from "./events.ts"
import { age } from "./publishing.ts"
import { panelPost } from "./rolesStore.ts"

export async function cleanupEvents(ctx: MutationCtx, now: number) {
    let removed = 0,
        participationRemoved = 0
    const receipts = await ctx.db
        .query("eventReceipts")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(EVENTS_BATCH)
    for (const row of receipts) {
        await ctx.db.delete(row._id)
        await eventCount(ctx, row.serverId, "receipts", -1)
        removed++
    }
    const started = await ctx.db
        .query("eventOccurrences")
        .withIndex("by_state_start", (q) => q.eq("state", "open").lte("date.startsAt", now))
        .take(EVENTS_BATCH)
    for (const row of started) {
        // A started date's reminder that never began sending can no longer go out. Closing it keeps the waiting reminders of a
        // repeat that runs on while the bot is away within its 26 open dates
        const waiting = await ctx.db
            .query("eventDeliveries")
            .withIndex("by_binding", (q) =>
                q.eq("serverId", row.serverId).eq("eventNo", row.eventNo).eq("occurrenceNo", row.occurrenceNo),
            )
            .take(EVENTS_BATCH)
        for (const delivery of waiting)
            if ((delivery.state === "queued" || delivery.state === "blocked") && delivery.attemptId === undefined)
                await ctx.db.patch(delivery._id, { state: "skipped" })
        await ctx.db.patch(row._id, {
            state: now >= row.date.endsAt ? "completed" : "started",
            workActive: false,
            workGeneration: advanceEvent(row.workGeneration),
            claimToken: undefined,
            leaseExpiresAt: undefined,
            headId: undefined,
            ...(now >= row.date.endsAt
                ? {
                      terminalAt: row.date.endsAt,
                      participationExpiresAt: row.date.endsAt + 30 * EVENTS_DAY,
                      historyExpiresAt: row.date.endsAt + 180 * EVENTS_DAY,
                  }
                : {}),
        })
    }
    const completed = await ctx.db
        .query("eventOccurrences")
        .withIndex("by_state_end", (q) => q.eq("state", "started").lte("date.endsAt", now))
        .take(EVENTS_BATCH)
    for (const row of completed)
        await ctx.db.patch(row._id, {
            state: "completed",
            terminalAt: row.date.endsAt,
            participationExpiresAt: row.date.endsAt + 30 * EVENTS_DAY,
            historyExpiresAt: row.date.endsAt + 180 * EVENTS_DAY,
        })
    const participation = await ctx.db
        .query("eventOccurrences")
        .withIndex("by_participation_expiry", (q) =>
            q.gt("participationExpiresAt", 0).lte("participationExpiresAt", now),
        )
        .take(EVENTS_BATCH)
    for (const occurrence of participation) {
        const rows = await ctx.db
            .query("eventRsvps")
            .withIndex("by_occurrence", (q) =>
                q
                    .eq("serverId", occurrence.serverId)
                    .eq("eventNo", occurrence.eventNo)
                    .eq("occurrenceNo", occurrence.occurrenceNo),
            )
            .take(EVENTS_BATCH - participationRemoved)
        for (const row of rows) {
            await ctx.db.delete(row._id)
            await eventCount(ctx, row.serverId, "rsvps", -1)
            removed++
            participationRemoved++
        }
        const pending = await ctx.db
            .query("eventRsvps")
            .withIndex("by_occurrence", (q) =>
                q
                    .eq("serverId", occurrence.serverId)
                    .eq("eventNo", occurrence.eventNo)
                    .eq("occurrenceNo", occurrence.occurrenceNo),
            )
            .first()
        if (!pending)
            await ctx.db.patch(occurrence._id, { rsvps: 0, going: 0, waitlisted: 0, participationExpiresAt: undefined })
        if (participationRemoved >= EVENTS_BATCH) break
    }
    // Each date's record goes 180 days after it ends, with its settled reminders, so a repeat that runs for years keeps a bounded
    // history. A date with a reply left, or a reminder whose post is unsettled or used by a role panel, waits a day
    const history = await ctx.db
        .query("eventOccurrences")
        .withIndex("by_history", (q) => q.gt("historyExpiresAt", 0).lte("historyExpiresAt", now))
        .take(EVENTS_BATCH)
    for (const occurrence of history) {
        let kept = !!(await ctx.db
            .query("eventRsvps")
            .withIndex("by_occurrence", (q) =>
                q
                    .eq("serverId", occurrence.serverId)
                    .eq("eventNo", occurrence.eventNo)
                    .eq("occurrenceNo", occurrence.occurrenceNo),
            )
            .first())
        const deliveries = await ctx.db
            .query("eventDeliveries")
            .withIndex("by_binding", (q) =>
                q
                    .eq("serverId", occurrence.serverId)
                    .eq("eventNo", occurrence.eventNo)
                    .eq("occurrenceNo", occurrence.occurrenceNo),
            )
            .take(EVENTS_BATCH)
        if (deliveries.length === EVENTS_BATCH) kept = true
        for (const delivery of deliveries) {
            let attempt = delivery.attemptId ? await ctx.db.get(delivery.attemptId) : null
            if (attempt?.outcome === "pending") {
                await age(ctx, attempt, now)
                attempt = await ctx.db.get(attempt._id)
            }
            if (
                attempt &&
                (attempt.outcome === "pending" ||
                    attempt.unresolved ||
                    (await panelPost(ctx, occurrence.serverId, attempt.postNo)))
            ) {
                kept = true
                continue
            }
            if (attempt) {
                const post = await ctx.db
                    .query("publishingPosts")
                    .withIndex("by_server_post", (q) =>
                        q.eq("serverId", occurrence.serverId).eq("postNo", attempt.postNo),
                    )
                    .unique()
                if (post?.attemptId === attempt._id) await ctx.db.delete(post._id)
                await ctx.db.delete(attempt._id)
            }
            await ctx.db.delete(delivery._id)
            removed++
        }
        if (kept) await ctx.db.patch(occurrence._id, { historyExpiresAt: now + EVENTS_DAY })
        else {
            await ctx.db.delete(occurrence._id)
            removed++
        }
    }
    // Definition anchors remain discoverable while an unresolved or panel-bound tracked post exists
    const events = await ctx.db
        .query("events")
        .withIndex("by_history", (q) => q.gt("historyExpiresAt", 0).lte("historyExpiresAt", now))
        .take(EVENTS_BATCH)
    for (const event of events) {
        const protectedPost = await ctx.db
            .query("publishingPosts")
            .withIndex("by_event", (q) => q.eq("serverId", event.serverId).eq("consumer.eventNo", event.eventNo))
            .first()
        const occurrence = await ctx.db
            .query("eventOccurrences")
            .withIndex("by_event", (q) => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo))
            .first()
        if (occurrence) {
            if (
                await ctx.db
                    .query("eventRsvps")
                    .withIndex("by_occurrence", (q) =>
                        q
                            .eq("serverId", event.serverId)
                            .eq("eventNo", event.eventNo)
                            .eq("occurrenceNo", occurrence.occurrenceNo),
                    )
                    .first()
            )
                continue
            await ctx.db.delete(occurrence._id)
            removed++
            continue
        }
        const delivery = await ctx.db
            .query("eventDeliveries")
            .withIndex("by_event", (q) => q.eq("serverId", event.serverId).eq("eventNo", event.eventNo))
            .first()
        if (delivery) {
            const attempt = delivery.attemptId ? await ctx.db.get(delivery.attemptId) : null
            if (!attempt?.unresolved) {
                await ctx.db.delete(delivery._id)
                removed++
                continue
            }
        }
        let anchored = !!delivery
        if (protectedPost && !anchored)
            anchored = !!(await ctx.db
                .query("publishingAttempts")
                .withIndex("by_event_unresolved", (q) =>
                    q.eq("serverId", event.serverId).eq("consumer.eventNo", event.eventNo).eq("unresolved", true),
                )
                .first())
        if (protectedPost && !anchored) {
            // Settled posts are released, except one a role panel still uses
            const posts = await ctx.db
                .query("publishingPosts")
                .withIndex("by_event", (q) => q.eq("serverId", event.serverId).eq("consumer.eventNo", event.eventNo))
                .take(EVENTS_BATCH)
            for (const post of posts) {
                if (await panelPost(ctx, event.serverId, post.postNo)) {
                    anchored = true
                    continue
                }
                await ctx.db.delete(post._id)
                if (post.postNo === event.cardPostNo) await ctx.db.patch(event._id, { cardPostNo: undefined })
                removed++
            }
            if (!anchored && posts.length === EVENTS_BATCH) continue
        }
        if (anchored) {
            await ctx.db.patch(event._id, {
                description: "",
                template: undefined,
                calendar: undefined,
                historyExpiresAt: now + EVENTS_DAY,
            })
            continue
        }
        await ctx.db.delete(event._id)
        if (!event.released) await eventCount(ctx, event.serverId, "definitions", -1)
        removed++
    }
    // Repeats get their next dates as earlier ones start
    const extending = await ctx.db
        .query("events")
        .withIndex("by_extend", (q) => q.gt("extendAt", 0).lte("extendAt", now))
        .take(EVENTS_BATCH)
    for (const event of extending) await extendEvent(ctx, event, now)
    const ended = await ctx.db
        .query("events")
        .withIndex("by_state_end", (q) => q.eq("state", "open").gt("endsAt", 0).lte("endsAt", now))
        .take(EVENTS_BATCH)
    for (const event of ended) {
        // A repeat with dates left to add goes on, and its extension moves the end
        if (eventRepeats(event)) continue
        await ctx.db.patch(event._id, {
            state: "completed",
            terminalAt: event.endsAt,
            historyExpiresAt: event.endsAt! + 180 * EVENTS_DAY,
        })
        await releaseEvent(ctx, event)
    }
    // Full pages of participation and history can hold rows that stay due, so retentionPass continues them only after progress
    return {
        removed,
        more:
            [receipts, started, completed, ended, participation, history, events, extending].some(
                (page) => page.length === EVENTS_BATCH,
            ) || participationRemoved >= EVENTS_BATCH,
    }
}
