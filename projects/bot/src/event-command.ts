import type * as C from "@neonflux/backend/contracts"
import { commandId } from "./moderation-command.ts"

export type EventCommand =
    | { type: "help" }
    | { type: "query", operation: C.EventsQueryRequest["operation"] }
    | { type: "create", name: string, channelId: string, title: string, description: string }
    | { type: "time", eventNo: number, revision: number, localMinute: string, zone: string, durationMinutes: number, fold: C.EventsFoldPolicy }
    | { type: "repeat", eventNo: number, revision: number, recurrence: C.EventsRecurrence }
    | { type: "manage", operation: C.EventsManageOperation }
    | { type: "forget", eventNo: number, revision: number, confirmed: boolean }
    | { type: "rsvp", eventNo: number, occurrenceNo: number, choice: C.EventsChoice }
    | { type: "delivery-status", eventNo: number, page: number }
    | { type: "reconcile", eventNo: number, revision: number, postNo?: number }

const integer = (v: string | undefined, min = 1, max = Number.MAX_SAFE_INTEGER) => v !== undefined && /^(0|[1-9]\d*)$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : undefined
const name = (v: string | undefined) => v !== undefined && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(v)
const text = (v: string | undefined, max: number, empty = false) => v !== undefined && v.length <= max && (empty || v.trim().length > 0) && !/[\u0000-\u001f\u007f]/.test(v)
export function eventHelp() {
    return [
        "!event list [before-event-number] | show <event> | dates <event> [after-occurrence-number]",
        "!event attendees <event> <occurrence> [after-user-ID]",
        "!event rsvp <event> <occurrence> going|maybe|not-going|none",
        '!event create <name> #channel "title" ["description"]',
        "!event time <event> <event-revision> YYYY-MM-DDTHH:mm IANA/Zone <1-10080 elapsed minutes> [reject|earlier|later]",
        "!event repeat <event> <event-revision> off | daily|weekly <1-12 interval> <1-26 total occurrences>",
        '!event title <event> <event-revision> "title" ["description"]',
        "!event template <event> <event-revision> <template-name> <template-revision> | off",
        "!event capacity <event> <event-revision> off|1-500",
        "!event reminders <event> <event-revision> off|<minutes> [minutes] (At most two, 1-10080)",
        "!event publish|cancel <event> <event-revision> | reconcile <event> <event-revision> [tracked-post-number]",
        "!event forget <event> <event-revision> [confirm]",
        "!event module on|off <settings-revision> | threads on|off <settings-revision> | status [event [1-26 page]] | help",
        "Owner/admin management. Public reads and RSVPs stay in the event destination with suppressed mentions. In a forum, any post of it counts",
        "Threads on: Events published afterwards get a discussion thread on their card, and the thread or forum post closes when the event ends",
        "Dates are frozen UTC instants. Gaps always reject. Repeated minutes require earlier or later. Recorded participation permanently blocks calendar changes",
    ].join("\n")
}

export function eventCritical(c: EventCommand | { error: string }) {
    return !("error" in c) && (c.type === "forget" || c.type === "reconcile" || c.type === "delivery-status" || c.type === "query" && ["status", "settings"].includes(c.operation.type)
        || c.type === "manage" && (c.operation.type === "cancel" || c.operation.type === "reconcile" || c.operation.type === "settings" && !c.operation.enabled))
}
export function eventPublic(c: EventCommand | { error: string }) {
    return !("error" in c) && (c.type === "rsvp" || c.type === "query" && ["list", "show", "dates", "attendees"].includes(c.operation.type))
}
export function parseEventCommand(args: readonly string[]): EventCommand | { error: string } {
    const error = { error: "Check quoting, revisions and values. Use !event help for copyable syntax" }
    const verb = args[0]?.toLowerCase()
    if (!verb || verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "status" && args.length === 1) return { type: "query", operation: { type: "status" } }
    if (verb === "status" && args.length >= 2 && args.length <= 3 && integer(args[1]) && (args.length === 2 || integer(args[2], 1, 26))) return { type: "delivery-status", eventNo: Number(args[1]), page: Number(args[2] ?? 1) }
    if (verb === "list" && args.length <= 2 && (args.length === 1 || integer(args[1]))) return { type: "query", operation: { type: "list", ...(args[1] ? { beforeEventNo: Number(args[1]) } : {}) } }
    if (verb === "show" && args.length === 2 && integer(args[1])) return { type: "query", operation: { type: "show", eventNo: Number(args[1]) } }
    if (verb === "dates" && args.length >= 2 && args.length <= 3 && integer(args[1]) && (args.length === 2 || integer(args[2]))) return { type: "query", operation: { type: "dates", eventNo: Number(args[1]), ...(args[2] ? { afterOccurrenceNo: Number(args[2]) } : {}) } }
    if (verb === "attendees" && args.length >= 3 && args.length <= 4 && integer(args[1]) && integer(args[2]) && (args.length === 3 || commandId(args[3]))) return { type: "query", operation: { type: "attendees", eventNo: Number(args[1]), occurrenceNo: Number(args[2]), ...(args[3] ? { afterUserId: commandId(args[3])! } : {}) } }
    if (verb === "rsvp" && args.length === 4 && integer(args[1]) && integer(args[2]) && ["going", "maybe", "not-going", "none"].includes(args[3]!))
        return { type: "rsvp", eventNo: Number(args[1]), occurrenceNo: Number(args[2]), choice: args[3] as C.EventsChoice }
    if (verb === "create" && args.length >= 4 && args.length <= 5 && name(args[1]) && commandId(args[2]) && text(args[3], 256) && (args.length === 4 || text(args[4], 3000, true))) return { type: "create", name: args[1]!, channelId: commandId(args[2])!, title: args[3]!, description: args[4] ?? "" }
    if (verb === "module" && args.length === 3 && ["on", "off"].includes(args[1]!) && integer(args[2])) return { type: "manage", operation: { type: "settings", enabled: args[1] === "on", expectedRevision: Number(args[2]) } }
    if (verb === "threads" && args.length === 3 && ["on", "off"].includes(args[1]!) && integer(args[2])) return { type: "manage", operation: { type: "threads", enabled: args[1] === "on", expectedRevision: Number(args[2]) } }
    if (!integer(args[1]) || !integer(args[2])) return error
    const eventNo = Number(args[1]), revision = Number(args[2]), expectedRevision = revision
    if (verb === "time" && args.length >= 6 && args.length <= 7 && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(args[3]!) && text(args[4], 128) && integer(args[5], 1, 10080) && (args.length === 6 || ["reject", "earlier", "later"].includes(args[6]!))) return { type: "time", eventNo, revision, localMinute: args[3]!, zone: args[4]!, durationMinutes: Number(args[5]), fold: (args[6] ?? "reject") as C.EventsFoldPolicy }
    if (verb === "repeat") {
        if (args.length === 4 && args[3] === "off") return { type: "repeat", eventNo, revision, recurrence: { type: "none" } }
        if (args.length === 6 && ["daily", "weekly"].includes(args[3]!) && integer(args[4], 1, 12) && integer(args[5], 1, 26)) return { type: "repeat", eventNo, revision, recurrence: { type: args[3] as "daily" | "weekly", interval: Number(args[4]), count: Number(args[5]) } }
    }
    if (["publish", "cancel"].includes(verb!) && args.length === 3) return { type: "manage", operation: { type: verb as "publish" | "cancel", eventNo, expectedRevision } }
    if (verb === "reconcile" && args.length >= 3 && args.length <= 4 && (args.length === 3 || integer(args[3]))) return { type: "reconcile", eventNo, revision, ...(args[3] ? { postNo: Number(args[3]) } : {}) }
    if (verb === "forget" && args.length >= 3 && args.length <= 4 && (args.length === 3 || args[3] === "confirm")) return { type: "forget", eventNo, revision, confirmed: args[3] === "confirm" }
    if (verb === "capacity" && args.length === 4 && (args[3] === "off" || integer(args[3], 1, 500))) return { type: "manage", operation: { type: "capacity", eventNo, expectedRevision, capacity: args[3] === "off" ? null : Number(args[3]) } }
    if (verb === "title" && args.length >= 4 && args.length <= 5 && text(args[3], 256) && (args.length === 4 || text(args[4], 3000, true))) return { type: "manage", operation: { type: "content", eventNo, expectedRevision, title: args[3]!, description: args[4] ?? "" } }
    if (verb === "template") {
        if (args.length === 4 && args[3] === "off") return { type: "manage", operation: { type: "template", eventNo, expectedRevision, templateName: null } }
        if (args.length === 5 && name(args[3]) && integer(args[4])) return { type: "manage", operation: { type: "template", eventNo, expectedRevision, templateName: args[3]!, expectedTemplateRevision: Number(args[4]) } }
    }
    if (verb === "reminders" && args.length >= 4 && args.length <= 5) {
        if (args.length === 4 && args[3] === "off") return { type: "manage", operation: { type: "reminders", eventNo, expectedRevision, offsets: [] } }
        const offsets = args.slice(3).map(v => integer(v, 1, 10080))
        if (offsets.every(v => v !== undefined) && new Set(offsets).size === offsets.length) return { type: "manage", operation: { type: "reminders", eventNo, expectedRevision, offsets: offsets as number[] } }
    }
    return error
}
