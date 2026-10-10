import type { PublishingContent } from "@neonflux/contracts/publishing-base"
import { EventsCalendar, EventsCapacity, EventsReminderOffsets, type EventsResolvedDate } from "@neonflux/contracts/events"
import { resolveCivilInstant, validateCivilCalendar } from "./civilDomain.ts"
import { publishingContent } from "./publishingDomain.ts"
import { decode, fail, integer, text } from "./validation.ts"
export { EVENTS_DAY, EVENTS_BATCH } from "@neonflux/contracts/events"
export const advanceEvent = (n: number) => integer(n + 1, 1, Number.MAX_SAFE_INTEGER)
// Preserve provider tokens while ordering submillisecond membership epochs
export function epochOrder(value: string): bigint {
    const fraction = /\.(\d{1,9})/.exec(value)?.[1] ?? ""
    return BigInt(Math.floor(Date.parse(value) / 1000)) * 1000000000n + BigInt(fraction.padEnd(9, "0"))
}
export const eventOffsets = (value: unknown): number[] => decode(EventsReminderOffsets, value).sort((a, b) => b - a)
export const eventCapacity = (value: unknown) => decode(EventsCapacity, value)
export function resolveCivil(localMinute: string, zone: string, fold: "reject" | "earlier" | "later") {
    const resolved = resolveCivilInstant(localMinute, zone, fold)
    return { startsAt: resolved.instantAt, offsetMinutes: resolved.offsetMinutes }
}
export function validateEventCalendar(value: unknown, now = Date.now()): EventsCalendar {
    const r = decode(EventsCalendar, value)
    const durationMinutes = r.durationMinutes
    const supplied = r.dates
    const calendar = validateCivilCalendar({ localMinute: r.localMinute, zone: r.zone, fold: r.fold, recurrence: r.recurrence, dates: supplied.map(date => ({ localMinute: date.localMinute, instantAt: date.startsAt, offsetMinutes: date.offsetMinutes })) }, now)
    const dates: EventsResolvedDate[] = calendar.dates.map((date, index) => {
        if (supplied[index]!.endsAt !== date.instantAt + durationMinutes * 60000) fail(400, "Civil offset or UTC binding changed")
        return { localMinute: date.localMinute, startsAt: date.instantAt, endsAt: supplied[index]!.endsAt, offsetMinutes: date.offsetMinutes }
    })
    return { localMinute: calendar.localMinute, zone: calendar.zone, fold: calendar.fold, recurrence: calendar.recurrence, durationMinutes, dates }
}
export function renderEvent(event: { title: string, description: string, calendar?: EventsCalendar, capacity: number | null, template?: { content: PublishingContent } }, reminder?: { startsAt: number, endsAt: number }): PublishingContent {
    const calendar = event.calendar
    if (!calendar?.dates.length) fail(409, "Calendar required")
    const date = reminder ?? calendar.dates[0]!
    const base = event.template?.content ?? { content: "" }, dates = calendar.dates.length
    // Fluxer shows timestamp markup in each reader's own time zone. The bot renders the same card
    const at = (ms: number) => `<t:${Math.floor(ms / 1000)}:f>`
    return publishingContent({ content: base.content, embed: { ...base.embed, title: text(event.title, 256), description: event.description,
        fields: [...(base.embed?.fields ?? []), { name: "When", value: `${at(date.startsAt)} to ${at(date.endsAt)}\nPlanned in ${calendar.zone} time` },
            { name: "Dates", value: dates === 1 ? "Once" : `${dates} dates` }, { name: "Capacity", value: event.capacity === null ? "No limit" : `${event.capacity} seat${event.capacity === 1 ? "" : "s"}` }],
    } }, true)
}
