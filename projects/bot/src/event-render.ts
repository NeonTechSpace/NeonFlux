import type { EventsDefinition, EventsRsvp } from "@neonflux/contracts/events"
import { resolvedEventDateText } from "./event-calendar.ts"

export function eventDetail(event: EventsDefinition, prefix: string) {
    return [`Event ${event.eventNo}: ${event.title}`, `${event.name}, revision ${event.revision}, ${event.state}, destination ${event.channelId}`,
        event.description, `Capacity: ${event.capacity ?? "Off"}. Channel reminders: ${event.reminderOffsets.join(", ") || "Off"} minutes before start`,
        ...(event.calendar ? [resolvedEventDateText(event.calendar.dates[0]!, event.calendar.zone), `${event.calendar.dates.length} frozen dates. All dates: ${prefix}event dates ${event.eventNo}`]
            : [event.state === "draft" ? `No calendar yet. Set ${prefix}event time before publishing` : "Calendar history expired. Retained publishing ownership remains available for exact recovery"]),
        ...(event.participationStarted ? ["Participation recorded. Calendar changes are closed permanently"] : []),
        ...(event.cardPostNo ? [`Managed card post ${event.cardPostNo}. Delivery and event lifecycle are separate`] : []),
    ].filter(Boolean).join("\n")
}
export function eventAttendeeText(rsvp: EventsRsvp, viewerId: string) {
    const who = rsvp.userId === viewerId ? "You" : `Member ${rsvp.userId}`
    return `${who}: ${rsvp.choice}, ${rsvp.allocation}${rsvp.queueOrder ? `, queue ${rsvp.queueOrder}` : ""}`
}
