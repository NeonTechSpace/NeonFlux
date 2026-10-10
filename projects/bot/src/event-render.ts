import type { EventsResolvedDate, EventsDefinition, EventsLifecycle, EventsChoice, EventsRsvp } from "@neonflux/contracts/events"
import { format } from "@neontechspace/fluxerly/effect"
import { Schema } from "effect"
import { PublishingContent } from "@neonflux/contracts/publishing-base"
import { noMentions } from "./responses.ts"
import { at, code, duration, type Card } from "./reply-style.ts"

/** When a date runs, shown in each reader's own time, and the zone the event was planned in. The backend renders the same text */
export const eventTimes = (date: Pick<EventsResolvedDate, "startsAt" | "endsAt">) => `${at(date.startsAt)} to ${at(date.endsAt)}`
export const eventWhen = (date: Pick<EventsResolvedDate, "startsAt" | "endsAt">, zone: string) => `${eventTimes(date)}\nPlanned in ${zone} time`
const seats = (capacity: number | null) => capacity === null ? "No limit" : `${capacity} seat${capacity === 1 ? "" : "s"}`
/** The public card, identical to the backend's renderEvent */
export function renderEventContent(event: EventsDefinition, occurrence?: EventsResolvedDate): PublishingContent {
    const calendar = event.calendar, date = occurrence ?? calendar?.dates[0]
    if (!calendar || !date) throw new Error("Event calendar is unavailable")
    const base = event.template?.content ?? { content: "" }, dates = calendar.dates.length
    return Schema.decodeUnknownSync(PublishingContent, { onExcessProperty: "error" })({ content: base.content, embed: { ...base.embed, title: event.title, description: event.description,
        fields: [...(base.embed?.fields ?? []), { name: "When", value: eventWhen(date, calendar.zone) },
            { name: "Dates", value: dates === 1 ? "Once" : `${dates} dates` }, { name: "Capacity", value: seats(event.capacity) }] } })
}
export const eventStates: Record<EventsLifecycle, string> = { draft: "Draft", open: "Open", started: "Started", completed: "Completed", cancelled: "Cancelled" }
const minutes = (offsets: readonly number[]) => offsets.length ? `${offsets.map(m => duration(m * 60)).join(" and ")} before the start` : "Off"
/** An event's staff detail. The name is what every event command takes */
export function eventDetail(event: EventsDefinition, prefix: string): Card {
    const calendar = event.calendar, dates = calendar?.dates.length ?? 0
    return { title: `Event ${event.name}`, description: [`**${event.title}**`, event.description].filter(Boolean).join("\n"), fields: [
        ["Status", eventStates[event.state]], ["Channel", format.channelMention(event.channelId)],
        calendar ? ["Next date", eventWhen(calendar.dates[0]!, calendar.zone)]
            : ["Dates", event.state === "draft" ? `Not set. Run ${code(`${prefix}event time ${event.name} …`)} before publishing` : "No longer stored"],
        ...(calendar ? [["Dates", dates === 1 ? "Once" : `${dates} dates. See them with ${code(`${prefix}event dates ${event.name}`)}`] as const] : []),
        ["Capacity", seats(event.capacity)], ["Reminders", minutes(event.reminderOffsets)],
        ...(event.participationStarted ? [["Dates locked", "Members have replied, so the dates can no longer change"] as const] : []),
        ...(event.cardPostNo ? [["Card", `Published in ${format.channelMention(event.postId ?? event.channelId)}. See it with ${code(`${prefix}event status ${event.name}`)}`] as const] : [])] }
}
export const eventCard = (event: EventsDefinition) => {
    const content = renderEventContent(event)
    return { content: content.content, embeds: content.embed ? [content.embed] : [], allowedMentions: noMentions }
}
const yours: Record<EventsChoice, string> = { going: "You're going", maybe: "You might go", "not-going": "You're not going", none: "You have not replied" }
const theirs: Record<EventsChoice, string> = { going: "Going", maybe: "Maybe", "not-going": "Not going", none: "No reply" }
/** One reply to an event date. A member sees their own as You, others by mention */
export function eventAttendeeText(rsvp: EventsRsvp, viewerId: string) {
    const waiting = `on the waiting list${rsvp.queueOrder ? ` at place ${rsvp.queueOrder}` : ""}`
    if (rsvp.userId === viewerId) return `${yours[rsvp.choice]}${rsvp.allocation === "seat" ? ", and you have a seat" : rsvp.allocation === "waitlist" ? `, and you are ${waiting}` : ""}`
    return `${format.userMention(rsvp.userId)}: ${theirs[rsvp.choice]}${rsvp.allocation === "seat" ? ", has a seat" : rsvp.allocation === "waitlist" ? `, ${waiting}` : ""}`
}
