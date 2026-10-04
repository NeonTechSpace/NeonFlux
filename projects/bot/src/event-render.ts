import type * as C from "@neonflux/backend/contracts"
import { Schema } from "effect"
import { publishingContentSchema } from "./publishing-content.ts"
import { resolvedEventDateText } from "./event-calendar.ts"
import { noMentions } from "./responses.ts"

export function renderEventContent(event: C.EventsDefinition, occurrence?: C.EventsResolvedDate): C.PublishingContent {
    const calendar = event.calendar, date = occurrence ?? calendar?.dates[0]
    if (!calendar || !date) throw new Error("Event calendar is unavailable")
    const offset = date.offsetMinutes
    const offsetText = `UTC${offset < 0 ? "-" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`
    const base = event.template?.content ?? { content: "" }
    return Schema.decodeUnknownSync(publishingContentSchema, { onExcessProperty: "error" })({ content: base.content, embed: { ...base.embed, title: event.title, description: event.description,
        fields: [...(base.embed?.fields ?? []), { name: "Event time", value: `${date.localMinute} · ${calendar.zone} · ${offsetText}\n${new Date(date.startsAt).toISOString()}` },
            { name: "Dates", value: String(calendar.dates.length) }, { name: "Capacity", value: event.capacity === null ? "Off" : String(event.capacity) }] } })
}
export function eventDetail(event: C.EventsDefinition, prefix: string) {
    return [`Event ${event.eventNo}: ${event.title}`, `${event.name}, revision ${event.revision}, ${event.state}, destination ${event.channelId}`,
        event.description, `Capacity: ${event.capacity ?? "Off"}. Channel reminders: ${event.reminderOffsets.join(", ") || "Off"} minutes before start`,
        ...(event.calendar ? [resolvedEventDateText(event.calendar.dates[0]!, event.calendar.zone), `${event.calendar.dates.length} frozen dates. All dates: ${prefix}event dates ${event.eventNo}`]
            : [event.state === "draft" ? `No calendar yet. Set ${prefix}event time before publishing` : "Calendar history expired. Retained publishing ownership remains available for exact recovery"]),
        ...(event.participationStarted ? ["Participation recorded. Calendar changes are closed permanently"] : []),
        ...(event.cardPostNo ? [`Managed card post ${event.cardPostNo}. Delivery and event lifecycle are separate`] : []),
    ].filter(Boolean).join("\n")
}
export const eventCard = (event: C.EventsDefinition) => {
    const content = renderEventContent(event)
    return { content: content.content, embeds: content.embed ? [content.embed] : [], allowedMentions: noMentions }
}
export function eventAttendeeText(rsvp: C.EventsRsvp, viewerId: string) {
    const who = rsvp.userId === viewerId ? "You" : `Member ${rsvp.userId}`
    return `${who}: ${rsvp.choice}, ${rsvp.allocation}${rsvp.queueOrder ? `, queue ${rsvp.queueOrder}` : ""}`
}
