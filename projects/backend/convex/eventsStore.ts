import {
    EventsAutomationContext,
    type EventsDefinition,
    type EventsOccurrence,
    type EventsRsvp,
    type EventsDelivery,
    type EventsLifecycle,
} from "@neonflux/contracts/events"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { EVENTS_DAY, advanceEvent } from "./eventsDomain.ts"
import { defconHoldsAutomation, automationGate, publisherSettings } from "./schedulesStore.ts"
import { decode, fail, integer } from "./validation.ts"
import { composerAdmin, composerContext, eventEligible } from "./publishingContext.ts"
import { CIVIL_HORIZON_DAYS, CIVIL_WINDOW, civilLocalAt } from "@neonflux/contracts/civil"
import { civilResume } from "./civilDomain.ts"

export type EventsRead = MutationCtx | QueryCtx
export const eventSettings = (ctx: EventsRead, serverId: string) =>
    ctx.db
        .query("eventSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
export async function eventState(ctx: MutationCtx, serverId: string) {
    const old = await eventSettings(ctx, serverId)
    if (old) return old
    const id = await ctx.db.insert("eventSettings", {
        serverId,
        enabled: false,
        revision: 1,
        nextEventNo: 1,
        nextOccurrenceNo: 1,
        definitions: 0,
        rsvps: 0,
        receipts: 0,
    })
    return (await ctx.db.get(id))!
}
/**
 * Cancelled or completed events stored before they stopped counting, which the counter still holds until they are forgotten.
 * Event numbers only grow and the old rule kept at most 50 events, so all of them are among the server's first 50
 */
export async function staleEvents(ctx: EventsRead, serverId: string) {
    const rows = await ctx.db
        .query("events")
        .withIndex("by_number", (q) => q.eq("serverId", serverId))
        .take(50)
    return rows.filter((row) => !row.released && (row.state === "cancelled" || row.state === "completed")).length
}
/** Events that are not cancelled or completed count toward the 50. Replies and source receipts are counted without a cap */
export async function eventCount(
    ctx: MutationCtx,
    serverId: string,
    key: "definitions" | "rsvps" | "receipts",
    delta: number,
) {
    const state = await eventState(ctx, serverId)
    if (
        key === "definitions" &&
        state[key] + delta > 50 &&
        state[key] - (await staleEvents(ctx, serverId)) + delta > 50
    )
        fail(429, "Event capacity reached")
    if (state[key] + delta < 0) fail(503, "Event accounting unavailable")
    await ctx.db.patch(state._id, { [key]: state[key] + delta })
}
export async function eventRow(ctx: EventsRead, serverId: string, eventNo: unknown, revision?: unknown) {
    const row = await ctx.db
        .query("events")
        .withIndex("by_number", (q) =>
            q.eq("serverId", serverId).eq("eventNo", integer(eventNo, 1, Number.MAX_SAFE_INTEGER)),
        )
        .unique()
    if (!row) fail(404, "Event not found")
    if (revision !== undefined && row.revision !== integer(revision, 1, Number.MAX_SAFE_INTEGER))
        fail(409, "Event revision changed")
    return row
}
export async function occurrenceRow(
    ctx: EventsRead,
    serverId: string,
    eventNo: number,
    occurrenceNo: unknown,
    revision?: unknown,
) {
    const row = await ctx.db
        .query("eventOccurrences")
        .withIndex("by_number", (q) =>
            q
                .eq("serverId", serverId)
                .eq("eventNo", eventNo)
                .eq("occurrenceNo", integer(occurrenceNo, 1, Number.MAX_SAFE_INTEGER)),
        )
        .unique()
    if (!row) fail(404, "Occurrence not found")
    if (revision !== undefined && row.revision !== integer(revision, 1, Number.MAX_SAFE_INTEGER))
        fail(409, "Occurrence revision changed")
    return row
}
export function lifecycle(
    row: { state: EventsLifecycle; startsAt: number; endsAt: number },
    now = Date.now(),
): EventsLifecycle {
    if (row.state === "draft" || row.state === "cancelled") return row.state
    return now >= row.endsAt ? "completed" : now >= row.startsAt ? "started" : "open"
}
/** Where the card and reminders go: The forum post that holds the card, or the destination channel */
export const eventCardChannel = (row: Pick<Doc<"events">, "postId" | "channelId">) => row.postId ?? row.channelId
/** An event stops counting toward the 50 once, when it is cancelled or completed */
export async function releaseEvent(ctx: MutationCtx, row: Doc<"events">) {
    if (row.released) return
    await eventCount(ctx, row.serverId, "definitions", -1)
    await ctx.db.patch(row._id, { released: true })
}
/**
 * Live dates per state: A repeat stores at most 26 dates that have not started. A repeat's date lasts at most 180 days and its dates
 * are at least a day apart, so about 206 run at once, and the started budget doubles that for dates kept from earlier calendars. A
 * single date of any length runs alone
 */
const LIVE_PER_STATE = { draft: 60, open: 60, started: 2 * (CIVIL_HORIZON_DAYS + CIVIL_WINDOW) }
/**
 * An event's dates that have not ended or been cancelled, soonest first: its drafts, or its open and started dates. Cancelled and
 * completed dates stay out of every live read, however many an event keeps
 */
export async function liveOccurrences(ctx: EventsRead, event: Pick<Doc<"events">, "serverId" | "eventNo">) {
    const rows: Doc<"eventOccurrences">[] = []
    for (const state of ["draft", "open", "started"] as const) {
        const page = await ctx.db
            .query("eventOccurrences")
            .withIndex("by_event_state", (q) =>
                q.eq("serverId", event.serverId).eq("eventNo", event.eventNo).eq("state", state),
            )
            .take(LIVE_PER_STATE[state] + 1)
        if (page.length > LIVE_PER_STATE[state]) fail(503, "Event date accounting unavailable")
        rows.push(...page)
    }
    return rows.sort((a, b) => a.date.startsAt - b.date.startsAt || a.occurrenceNo - b.occurrenceNo)
}
/** Whether an event's repeat still has dates to add, so its stored dates ending does not end it */
export const eventRepeats = (row: Pick<Doc<"events">, "calendar" | "nextIndex">) =>
    !!row.calendar && civilLocalAt(row.calendar, row.nextIndex ?? row.calendar.dates.length) !== undefined
/** The earliest date that has not ended, which a single event's answer and its card show */
export const nextOccurrence = (rows: readonly Doc<"eventOccurrences">[], now = Date.now()) =>
    rows.find((row) => row.date.endsAt > now)
/**
 * Where a change to a published repeat continues, for a single event's answer and the dashboard. Only these resolve dates in the
 * zone, so other answers never depend on its rules
 */
export function eventResume(row: Doc<"events">, now: number): Pick<EventsDefinition, "resume"> {
    const resume =
        row.calendar && row.state === "open"
            ? civilResume(row.calendar, row.calendar.dates[0]!.startsAt, now)
            : undefined
    return resume ? { resume } : {}
}
export function publicEvent(row: Doc<"events">, next?: Doc<"eventOccurrences">): EventsDefinition {
    const {
        _id,
        _creationTime,
        serverId,
        endsAt,
        activatedAt,
        terminalAt,
        historyExpiresAt,
        forgetting,
        threadDueAt,
        nextIndex,
        extendAt,
        lastSkipped,
        released,
        firstStartsAt,
        notice,
        noticeDueAt,
        ...value
    } = row
    const now = Date.now()
    // A repeat that still adds dates has not ended, even while its stored dates have
    if (row.calendar && row.state !== "draft" && row.state !== "cancelled")
        value.state =
            row.state === "completed" || (endsAt !== undefined && now >= endsAt && !eventRepeats(row))
                ? "completed"
                : now >= (firstStartsAt ?? row.calendar.dates[0]!.startsAt)
                  ? "started"
                  : "open"
    return {
        ...value,
        ...(next ? { next: next.date } : {}),
        ...(lastSkipped ? { lastSkipped } : {}),
        ...(notice
            ? {
                  notice: {
                      sent: notice.sent,
                      failed: notice.failed,
                      done: notice.cursor === undefined && noticeDueAt === undefined,
                  },
              }
            : {}),
    }
}
export function publicOccurrence(row: Doc<"eventOccurrences">): EventsOccurrence {
    return {
        eventNo: row.eventNo,
        occurrenceNo: row.occurrenceNo,
        revision: row.revision,
        ...row.date,
        state: lifecycle({ state: row.state, ...row.date }),
        participationStarted: row.participationStarted,
        going: row.going,
        waitlisted: row.waitlisted,
        capacity: row.capacity,
        workGeneration: row.workGeneration,
    }
}
export function publicRsvp(row: Doc<"eventRsvps">): EventsRsvp {
    const { _id, _creationTime, serverId, observedAt, createdAt, deferredUntil, ...value } = row
    return value
}
export function publicDelivery(row: Doc<"eventDeliveries">): EventsDelivery {
    return {
        deliveryId: row._id,
        eventNo: row.eventNo,
        occurrenceNo: row.occurrenceNo,
        revision: row.revision,
        channelId: row.channelId,
        offsetMinutes: row.offsetMinutes,
        dueAt: row.dueAt,
        startsAt: row.startsAt,
        state: row.state,
        nextCheckAt: row.nextCheckAt,
        ...(row.postNo !== undefined ? { postNo: row.postNo } : {}),
        ...(row.attemptId ? { attemptId: row.attemptId } : {}),
    }
}
export function eventAutomationContext(value: unknown, now = Date.now()): EventsAutomationContext {
    const r = decode(EventsAutomationContext, value)
    const observedAt = integer(r.observedAt, Math.max(0, now - 60000), now + 1000)
    return { observedAt, channelId: r.channelId, botId: r.botId, botAuthorized: true }
}
// Automatic reminders follow server policy: module and publishing on, DEFCON open and fresh bot permission in the destination
export async function eventAutomation(
    ctx: EventsRead,
    serverId: string,
    context: EventsAutomationContext,
    channelId: string,
) {
    await automationGate(ctx, serverId)
    const settings = await eventSettings(ctx, serverId),
        publisher = await publisherSettings(ctx, serverId)
    if (!settings?.enabled || publisher?.enabled === false || context.channelId !== channelId)
        fail(403, "Destination permission required")
}
/** Whether automatic reminders may go out now: events and publishing are on and DEFCON allows them, as eventAutomation requires */
export async function eventRemindersOpen(ctx: EventsRead, serverId: string) {
    return (
        !(await defconHoldsAutomation(ctx, serverId)) &&
        (await eventSettings(ctx, serverId))?.enabled === true &&
        (await publisherSettings(ctx, serverId))?.enabled !== false
    )
}
export async function eventReceipt(
    ctx: MutationCtx,
    identity: { serverId: string; messageId: string; createdAt: number },
    actorId: string,
    operation: unknown,
) {
    const old = await ctx.db
            .query("eventReceipts")
            .withIndex("by_source", (q) => q.eq("serverId", identity.serverId).eq("messageId", identity.messageId))
            .unique(),
        key = JSON.stringify(operation)
    if (old) {
        if (old.actorId !== actorId || old.operationKey !== key || old.createdAt !== identity.createdAt)
            fail(409, "Event source binding changed")
        return false
    }
    await eventCount(ctx, identity.serverId, "receipts", 1)
    await ctx.db.insert("eventReceipts", {
        ...identity,
        actorId,
        operationKey: key,
        expiresAt: Date.now() + EVENTS_DAY,
    })
    return true
}
export async function wakePromotion(
    ctx: MutationCtx,
    row: Doc<"eventOccurrences">,
    fields: Partial<Pick<Doc<"eventOccurrences">, "going" | "waitlisted" | "capacity">> = {},
) {
    const next = { ...row, ...fields },
        active =
            next.waitlisted > 0 &&
            (next.capacity === null || next.going < next.capacity) &&
            lifecycle({ ...row.date, state: row.state }) === "open"
    await ctx.db.patch(row._id, {
        ...fields,
        workGeneration: advanceEvent(row.workGeneration),
        workActive: active,
        nextCheckAt: Date.now(),
        workAfterQueue: undefined,
        workResetAt: undefined,
        claimToken: undefined,
        leaseExpiresAt: undefined,
        headId: undefined,
    })
}
export async function eventPublishingFence(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, value: unknown) {
    const consumer = attempt.consumer
    if (consumer?.type !== "event") fail(409, "Event consumer missing")
    const event = await eventRow(ctx, attempt.serverId, consumer.eventNo, consumer.revision)
    if (event.state === "cancelled" || event.forgetting) fail(403, "Event dispatch unavailable")
    if (consumer.purpose === "card") {
        const context = composerContext(value),
            settings = await eventSettings(ctx, attempt.serverId)
        await composerAdmin(ctx, attempt.serverId, context)
        // A send creates the card in the destination, and an edit finds it in the forum post that holds it
        if (
            !settings?.enabled ||
            context.channelId !== attempt.channelId ||
            attempt.channelId !== eventCardChannel(event) ||
            context.botId !== attempt.botId ||
            !context.botAuthorized ||
            !context.actorAuthorized
        )
            fail(403, "Event dispatch unavailable")
        if (
            event.cardPostNo !== attempt.postNo ||
            (attempt.source?.type !== "human" && attempt.source?.type !== "dashboard-configuration")
        )
            fail(409, "Event card changed")
        if (context.actor.userId !== attempt.actorId) fail(403, "Current card invoker required")
        await eventEligible(ctx, attempt.serverId, context, attempt.channelId, attempt.actorId)
    } else {
        const context = eventAutomationContext(value)
        if (
            attempt.actorId !== attempt.botId ||
            context.botId !== attempt.botId ||
            attempt.source?.type !== "event-timer"
        )
            fail(403, "Current reminder automation required")
        await eventAutomation(ctx, attempt.serverId, context, eventCardChannel(event))
        if (attempt.channelId !== eventCardChannel(event)) fail(409, "Event delivery changed")
        const id = consumer.deliveryId ? ctx.db.normalizeId("eventDeliveries", consumer.deliveryId) : null
        const delivery = id ? await ctx.db.get(id) : null
        if (
            !delivery ||
            delivery.serverId !== event.serverId ||
            delivery.eventNo !== event.eventNo ||
            delivery.revision !== event.revision ||
            delivery.channelId !== event.channelId ||
            delivery.attemptId !== attempt._id ||
            delivery.postNo !== attempt.postNo ||
            delivery.occurrenceNo !== consumer.occurrenceNo ||
            delivery.offsetMinutes !== consumer.offsetMinutes ||
            delivery.state !== "reserved"
        )
            fail(409, "Event delivery changed")
        const occurrence = await occurrenceRow(
                ctx,
                event.serverId,
                event.eventNo,
                delivery.occurrenceNo,
                delivery.revision,
            ),
            now = Date.now()
        if (
            lifecycle({ state: occurrence.state, ...occurrence.date }) !== "open" ||
            now < delivery.dueAt ||
            now >= Math.min(delivery.dueAt + 300000, delivery.startsAt, attempt.dispatchExpiresAt)
        )
            fail(409, "Event delivery window closed")
    }
}
// A card's first send in a forum created the post that holds it. With discussion threads on, a card in another channel gets a
// thread now, and the post or thread closes once the event is over
async function syncEventCard(
    ctx: MutationCtx,
    attempt: Doc<"publishingAttempts">,
    outcome: "sent" | "failed" | "uncertain",
) {
    if (attempt.consumer?.type !== "event" || attempt.action !== "send" || outcome === "failed") return
    const eventNo = attempt.consumer.eventNo
    const event = await ctx.db
        .query("events")
        .withIndex("by_number", (q) => q.eq("serverId", attempt.serverId).eq("eventNo", eventNo))
        .unique()
    if (!event || event.cardPostNo !== attempt.postNo || event.postId || event.threadId) return
    const threads = (await eventSettings(ctx, attempt.serverId))?.threads === true
    if (attempt.threadId)
        await ctx.db.patch(event._id, {
            postId: attempt.threadId,
            ...(threads ? { threadDueAt: event.endsAt ?? Date.now() } : {}),
        })
    else if (threads && outcome === "sent") await ctx.db.patch(event._id, { threadDueAt: Date.now() })
}
export async function syncEventPublishing(
    ctx: MutationCtx,
    attempt: Doc<"publishingAttempts">,
    outcome: "sent" | "failed" | "uncertain",
) {
    if (attempt.consumer?.type === "event" && attempt.consumer.purpose === "card")
        return syncEventCard(ctx, attempt, outcome)
    if (attempt.consumer?.type !== "event" || attempt.consumer.purpose !== "reminder") return
    const id = attempt.consumer.deliveryId ? ctx.db.normalizeId("eventDeliveries", attempt.consumer.deliveryId) : null
    const delivery = id ? await ctx.db.get(id) : null
    if (delivery?.serverId === attempt.serverId && delivery.attemptId === attempt._id)
        await ctx.db.patch(delivery._id, { state: outcome })
}
export async function claimEventPublishing(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, now: number) {
    if (attempt.consumer?.type !== "event" || attempt.consumer.purpose !== "reminder" || !attempt.consumer.deliveryId)
        return
    const id = ctx.db.normalizeId("eventDeliveries", attempt.consumer.deliveryId),
        delivery = id ? await ctx.db.get(id) : null
    if (!delivery || delivery.serverId !== attempt.serverId || delivery.attemptId !== attempt._id)
        fail(409, "Event delivery changed")
    await ctx.db.patch(delivery._id, { claimedAt: now })
}
