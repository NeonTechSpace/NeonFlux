import type * as C from "@neonflux/backend/contracts"
import { Clock, Effect } from "effect"
import { createFixtures } from "@neontechspace/fluxerly/effect/testing"
import { createEventCalendar } from "../src/event-calendar.ts"
import { renderEventContent } from "../src/event-render.ts"
import { canonicalPublishingContent } from "../src/publishing-content.ts"
import { EventsStoreError, type EventsStore } from "../src/event-store.ts"

export const eventNow = Date.parse("2026-01-02T00:00:00Z")
export function eventDefinition(overrides: Partial<C.EventsDefinition> = {}): C.EventsDefinition {
    const f = createFixtures()
    return { eventNo: 1, name: "study", revision: 2, channelId: f.ids.channel, title: "Study", description: "Topic", capacity: 1, reminderOffsets: [60], state: "open", participationStarted: false,
        calendar: createEventCalendar("2026-01-02T01:00", "UTC", 60), cardPostNo: 1, createdAt: eventNow, updatedAt: eventNow, ...overrides }
}
export function eventOccurrence(event = eventDefinition()): C.EventsOccurrence { return { ...event.calendar!.dates[0]!, eventNo: event.eventNo, occurrenceNo: 1, revision: event.revision, state: "open", participationStarted: false, going: 0, waitlisted: 0, capacity: event.capacity, workGeneration: 1 } }
export function eventDelivery(event = eventDefinition(), overrides: Partial<C.EventsDelivery> = {}): C.EventsDelivery { return { deliveryId: "synthetic_event_delivery", eventNo: event.eventNo, occurrenceNo: 1, revision: event.revision, offsetMinutes: 60, dueAt: eventNow, startsAt: eventNow + 3600000, state: "queued", nextCheckAt: eventNow, channelId: event.channelId, ...overrides } }
export function eventTimerGrant(event = eventDefinition(), delivery = eventDelivery(event), reservedAt = eventNow): C.EventsDeliveryGrant {
    const f = createFixtures(), content = renderEventContent(event)
    return { attemptId: "synthetic_event_attempt", postNo: 2, generation: 1, sourceId: `event_timer_${delivery.deliveryId}`, actorId: f.ids.bot, botId: f.ids.bot, action: "send", channelId: event.channelId,
        source: { type: "event-timer", deliveryId: delivery.deliveryId, dueAt: delivery.dueAt }, provenance: { type: "event", eventNo: event.eventNo, revision: event.revision },
        consumer: { type: "event", eventNo: event.eventNo, revision: event.revision, purpose: "reminder", occurrenceNo: delivery.occurrenceNo, offsetMinutes: delivery.offsetMinutes, deliveryId: delivery.deliveryId },
        content, canonicalContent: canonicalPublishingContent(content), dispatchExpiresAt: Math.min(reservedAt + 180000, delivery.dueAt + 300000, delivery.startsAt), nativeDeadlineMs: 5000 }
}
export function eventsBoundary(overrides: Partial<EventsStore> = {}) {
    const calls: { method: string, input: unknown }[] = [], event = eventDefinition()
    const record = <A>(method: string, input: unknown, value: A) => Effect.sync(() => { calls.push({ method, input }); return value })
    const store: EventsStore = {
        query: input => {
            const op = input.operation
            if (op.type === "show") return record<C.EventsQueryResult>("query", input, { type: "event", event })
            if (op.type === "list") return record<C.EventsQueryResult>("query", input, { type: "events", events: [event] })
            if (op.type === "dates") return record<C.EventsQueryResult>("query", input, { type: "dates", dates: [eventOccurrence(event)] })
            if (op.type === "attendees") return record<C.EventsQueryResult>("query", input, { type: "attendees", attendees: [] })
            return record<C.EventsQueryResult>("query", input, op.type === "settings" ? { type: "settings", settings: { enabled: true, revision: 1, threads: false } }
                : { type: "status", settings: { enabled: true, revision: 1, threads: false }, definitions: 1, occurrences: 1, rsvps: 0, receipts: 0 })
        },
        manage: input => record<C.EventsManageResult>("manage", input, { duplicate: true }),
        rsvp: input => record<C.EventsRsvpResult>("rsvp", input, { accepted: true, duplicate: false, occurrence: eventOccurrence(event), rsvp: { eventNo: input.eventNo, occurrenceNo: input.occurrenceNo, revision: 1,
            membershipGeneration: 1, userId: input.context.actor.userId, joinedAt: input.context.member!.joinedAt, choice: input.choice, allocation: input.choice === "going" ? "seat" : "none", acceptedCreatedAt: input.createdAt, acceptedMessageId: input.messageId } }),
        work: input => record<C.EventsWorkResult>("work", input, input.operation.type === "list" ? { type: "jobs", jobs: [] } : input.operation.type === "claim" ? { type: "head", claimed: false } : { type: "progress", recorded: true }),
        delivery: input => record<C.EventsDeliveryResult>("delivery", input, input.operation.type === "show" ? { type: "event", event } : input.operation.type === "list" || input.operation.type === "status" ? { type: "deliveries", deliveries: [] } : input.operation.type === "defer" || input.operation.type === "thread" ? { type: "progress", recorded: true } : { type: "reservation", status: "waiting" }),
        ...overrides,
    }
    return { calls, store, event }
}
