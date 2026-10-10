import type * as C from "@neonflux/backend/contracts"
import { commandId } from "./moderation-command.ts"

/** A change to one named event. The handler adds the event's number and current revision */
export type EventChange =
    | { type: "content", title: string, description: string }
    | { type: "capacity", capacity: number | null }
    | { type: "reminders", offsets: number[] }
    | { type: "template", templateName: string | null }
    | { type: "publish" | "cancel" }
export type EventCommand =
    | { type: "help" } | { type: "status" }
    | { type: "list", next: boolean }
    | { type: "show", name: string }
    | { type: "dates", name: string, next: boolean } | { type: "delivery-status", name: string, next: boolean }
    | { type: "attendees", name: string, occurrenceNo: number, next: boolean }
    | { type: "rsvp", name: string, occurrenceNo: number, choice: C.EventsChoice }
    | { type: "create", name: string, channelId: string, title: string, description: string }
    | { type: "module", enabled: boolean } | { type: "threads", enabled: boolean }
    | { type: "time", name: string, localMinute: string, zone: string, durationMinutes: number, fold: C.EventsFoldPolicy }
    | { type: "repeat", name: string, recurrence: C.EventsRecurrence }
    | { type: "change", name: string, change: EventChange }
    | { type: "forget", name: string, confirmed: boolean }
    | { type: "reconcile", name: string, postNo?: number }

const integer = (v: string | undefined, min = 1, max = Number.MAX_SAFE_INTEGER) => v !== undefined && /^(0|[1-9]\d*)$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : undefined
const name = (v: string | undefined): v is string => v !== undefined && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(v)
const text = (v: string | undefined, max: number, empty = false) => v !== undefined && v.length <= max && (empty || v.trim().length > 0) && !/[\u0000-\u001f\u007f]/.test(v)
/** A list ends at `at` arguments, or takes one more `next` that continues it */
const paged = (args: readonly string[], at: number) => args.length === at || args.length === at + 1 && args[at] === "next"
export function eventHelp() {
    return [
        "!event list [next] | show <name> | dates <name> [next]",
        "!event attendees <name> <occurrence> [next]",
        "!event rsvp <name> <occurrence> going|maybe|not-going|none",
        '!event create <name> #channel "title" ["description"]',
        "!event time <name> YYYY-MM-DDTHH:mm IANA/Zone <1-10080 elapsed minutes> [reject|earlier|later]",
        "!event repeat <name> off | daily|weekly <1-12 interval> <1-26 total occurrences>",
        '!event title <name> "title" ["description"]',
        "!event template <name> <template-name> | off",
        "!event capacity <name> off|1-500",
        "!event reminders <name> off|<minutes> [minutes] (At most two, 1-10080)",
        "!event publish|cancel <name> | reconcile <name> [tracked-post-number]",
        "!event forget <name> [confirm]",
        "!event module on|off | threads on|off | status [<name> [next]] | help",
        "Owner/admin management. Public reads and RSVPs stay in the event destination with suppressed mentions. In a forum, any post of it counts",
        "Threads on: Events published afterwards get a discussion thread on their card, and the thread or forum post closes when the event ends",
        "Dates are frozen UTC instants. Gaps always reject. Repeated minutes require earlier or later. Recorded participation permanently blocks calendar changes",
    ].join("\n")
}

export function eventCritical(c: EventCommand | { error: string }) {
    return !("error" in c) && (c.type === "forget" || c.type === "reconcile" || c.type === "delivery-status" || c.type === "status"
        || c.type === "change" && c.change.type === "cancel" || c.type === "module" && !c.enabled)
}
export function eventPublic(c: EventCommand | { error: string }) {
    return !("error" in c) && ["rsvp", "list", "show", "dates", "attendees"].includes(c.type)
}
export function parseEventCommand(args: readonly string[]): EventCommand | { error: string } {
    const error = { error: "Check quoting, names and values. Use !event help for copyable syntax" }
    const verb = args[0]?.toLowerCase()
    if (!verb || verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "status" && args.length === 1) return { type: "status" }
    if (verb === "list" && paged(args, 1)) return { type: "list", next: args.length === 2 }
    if ((verb === "module" || verb === "threads") && args.length === 2 && ["on", "off"].includes(args[1]!)) return { type: verb, enabled: args[1] === "on" }
    // Event names are unique in a server, and any case names the same event
    const event = args[1]?.toLowerCase()
    if (!name(event)) return error
    if (verb === "create" && args.length >= 4 && args.length <= 5 && commandId(args[2]) && text(args[3], 256) && (args.length === 4 || text(args[4], 3000, true))) return { type: "create", name: event, channelId: commandId(args[2])!, title: args[3]!, description: args[4] ?? "" }
    if (verb === "show" && args.length === 2) return { type: "show", name: event }
    if ((verb === "dates" || verb === "status") && paged(args, 2)) return { type: verb === "status" ? "delivery-status" : "dates", name: event, next: args.length === 3 }
    if (verb === "attendees" && integer(args[2]) && paged(args, 3)) return { type: "attendees", name: event, occurrenceNo: Number(args[2]), next: args.length === 4 }
    if (verb === "rsvp" && args.length === 4 && integer(args[2]) && ["going", "maybe", "not-going", "none"].includes(args[3]!)) return { type: "rsvp", name: event, occurrenceNo: Number(args[2]), choice: args[3] as C.EventsChoice }
    if (verb === "time" && args.length >= 5 && args.length <= 6 && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(args[2]!) && text(args[3], 128) && integer(args[4], 1, 10080) && (args.length === 5 || ["reject", "earlier", "later"].includes(args[5]!))) return { type: "time", name: event, localMinute: args[2]!, zone: args[3]!, durationMinutes: Number(args[4]), fold: (args[5] ?? "reject") as C.EventsFoldPolicy }
    if (verb === "repeat") {
        if (args.length === 3 && args[2] === "off") return { type: "repeat", name: event, recurrence: { type: "none" } }
        if (args.length === 5 && ["daily", "weekly"].includes(args[2]!) && integer(args[3], 1, 12) && integer(args[4], 1, 26)) return { type: "repeat", name: event, recurrence: { type: args[2] as "daily" | "weekly", interval: Number(args[3]), count: Number(args[4]) } }
    }
    if ((verb === "publish" || verb === "cancel") && args.length === 2) return { type: "change", name: event, change: { type: verb } }
    if (verb === "reconcile" && args.length <= 3 && (args.length === 2 || integer(args[2]))) return { type: "reconcile", name: event, ...(args[2] ? { postNo: Number(args[2]) } : {}) }
    if (verb === "forget" && args.length <= 3 && (args.length === 2 || args[2] === "confirm")) return { type: "forget", name: event, confirmed: args[2] === "confirm" }
    if (verb === "capacity" && args.length === 3 && (args[2] === "off" || integer(args[2], 1, 500))) return { type: "change", name: event, change: { type: "capacity", capacity: args[2] === "off" ? null : Number(args[2]) } }
    if (verb === "title" && args.length >= 3 && args.length <= 4 && text(args[2], 256) && (args.length === 3 || text(args[3], 3000, true))) return { type: "change", name: event, change: { type: "content", title: args[2]!, description: args[3] ?? "" } }
    if (verb === "template" && args.length === 3 && (args[2] === "off" || name(args[2]))) return { type: "change", name: event, change: { type: "template", templateName: args[2] === "off" ? null : args[2]! } }
    if (verb === "reminders" && args.length >= 3 && args.length <= 4) {
        if (args.length === 3 && args[2] === "off") return { type: "change", name: event, change: { type: "reminders", offsets: [] } }
        const offsets = args.slice(2).map(v => integer(v, 1, 10080))
        if (offsets.every(v => v !== undefined) && new Set(offsets).size === offsets.length) return { type: "change", name: event, change: { type: "reminders", offsets: offsets as number[] } }
    }
    return error
}
