import type {
    EventsResolvedDate,
    EventsDefinition,
    EventsLifecycle,
    EventsChoice,
    EventsNoticePage,
    EventsRsvp,
} from "@neonflux/contracts/events"
import { neutralMentions } from "@neonflux/contracts/member-content"
import { civilRepeatText } from "@neonflux/contracts/civil"
import { format } from "@neontechspace/fluxerly/effect"
import { at, code, duration, type Card } from "./reply-style.ts"
import { skippedDate } from "./civil-calendar.ts"

/** When a date runs, shown in each reader's own time, and the zone the event was planned in. The backend's public card uses the same words */
export const eventTimes = (date: Pick<EventsResolvedDate, "startsAt" | "endsAt">) =>
    `${at(date.startsAt)} to ${at(date.endsAt)}`
export const eventWhen = (date: Pick<EventsResolvedDate, "startsAt" | "endsAt">, zone: string) =>
    `${eventTimes(date)}\nPlanned in ${zone} time`
const seats = (capacity: number | null) =>
    capacity === null ? "No limit" : `${capacity} seat${capacity === 1 ? "" : "s"}`
export const eventStates: Record<EventsLifecycle, string> = {
    draft: "Draft",
    open: "Open",
    started: "Started",
    completed: "Completed",
    cancelled: "Cancelled",
}
const minutes = (offsets: readonly number[]) =>
    offsets.length ? `${offsets.map((m) => duration(m * 60)).join(" and ")} before the start` : "Off"
/** An event's staff detail. The name is what every event command takes */
export function eventDetail(event: EventsDefinition, prefix: string, now: number): Card {
    const calendar = event.calendar,
        next = event.next ?? calendar?.dates.find((date) => date.endsAt > now)
    return {
        title: `Event ${event.name}`,
        description: [`**${event.title}**`, event.description].filter(Boolean).join("\n"),
        fields: [
            ["Status", eventStates[event.state]],
            ["Channel", format.channelMention(event.channelId)],
            calendar
                ? ["Next date", next ? eventWhen(next, calendar.zone) : "None left"]
                : [
                      "Dates",
                      event.state === "draft"
                          ? `Not set. Run ${code(`${prefix}event time ${event.name} …`)} before publishing`
                          : "No longer stored",
                  ],
            ...(calendar
                ? [
                      [
                          "Dates",
                          calendar.recurrence.type === "none"
                              ? "Once"
                              : `${civilRepeatText(calendar.recurrence)}. See them with ${code(`${prefix}event dates ${event.name}`)}`,
                      ] as const,
                      ...(event.lastSkipped
                          ? [["Skipped", skippedDate(event.lastSkipped, calendar.zone)] as const]
                          : []),
                  ]
                : []),
            ["Capacity", seats(event.capacity)],
            ["Reminders", minutes(event.reminderOffsets)],
            ...(event.cardPostNo
                ? [
                      [
                          "Card",
                          `Published in ${format.channelMention(event.postId ?? event.channelId)}. See it with ${code(`${prefix}event status ${event.name}`)}`,
                      ] as const,
                  ]
                : []),
        ],
    }
}
const yours: Record<EventsChoice, string> = {
    going: "You're going",
    maybe: "You might go",
    "not-going": "You're not going",
    none: "You have not replied",
}
const theirs: Record<EventsChoice, string> = {
    going: "Going",
    maybe: "Maybe",
    "not-going": "Not going",
    none: "No reply",
}
/** One reply to an event date. A member sees their own as You, others by mention */
export function eventAttendeeText(rsvp: EventsRsvp, viewerId: string) {
    // The queue order only ever grows, so it is not the member's place in line once someone ahead leaves it
    const waiting = "on the waiting list"
    if (rsvp.userId === viewerId)
        return `${yours[rsvp.choice]}${rsvp.allocation === "seat" ? ", and you have a seat" : rsvp.allocation === "waitlist" ? `, and you are ${waiting}` : ""}`
    return `${format.userMention(rsvp.userId)}: ${theirs[rsvp.choice]}${rsvp.allocation === "seat" ? ", has a seat" : rsvp.allocation === "waitlist" ? `, ${waiting}` : ""}`
}
/** The DM that tells a member which dates they replied Going or Maybe to moved or were cancelled */
export function eventNoticeText(
    page: Pick<EventsNoticePage, "title" | "channelId">,
    target: EventsNoticePage["targets"][number],
    server: string,
    prefix: string,
) {
    return [
        `Event ${neutralMentions(page.title)} in ${server} changed`,
        ...target.dates.map((date) =>
            date.cancelled
                ? `Date #${date.occurrenceNo} was cancelled`
                : `Date #${date.occurrenceNo} now starts ${at(date.startsAt)}, it was ${at(date.fromStartsAt)}. Your reply stays ${theirs[date.choice]}`,
        ),
        ...(target.more
            ? [`And ${target.more} more. See ${prefix}event mine in ${format.channelMention(page.channelId)}`]
            : []),
    ].join("\n")
}
