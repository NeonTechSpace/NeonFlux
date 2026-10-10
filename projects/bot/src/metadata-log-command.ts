import { type MetadataLogsEventType, type MetadataLogsAuditAction, type MetadataLogsConfigurationOperation, type MetadataLogsQueryOperation, type MetadataLogsManageOperation, metadataCategories as metadataLogCategories, metadataEventTypes as metadataLogEventTypes, metadataEventSelectors as metadataLogEventSelectors } from "@neonflux/contracts/metadata-logs"
import { commandId } from "./moderation-command.ts"

export { metadataLogCategories, metadataLogEventTypes, metadataLogEventSelectors }
const eventLabels: Record<MetadataLogsEventType, string> = { "member-add": "Member joined", "member-update": "Member changed", "member-remove": "Member departed", "role-create": "Role created", "role-update": "Role changed", "role-delete": "Role deleted",
    "channel-create": "Channel created", "channel-update": "Channel changed", "channel-delete": "Channel deleted", "thread-create": "Thread created", "thread-update": "Thread changed", "thread-delete": "Thread deleted", "server-update": "Server changed",
    "message-update": "Message edited", "message-delete": "Message deleted", "message-bulk-delete": "Messages deleted in bulk", "audit-entry": "Audit log entry", "settings-change": "Settings changed", "backend-failure": "Log processing failed",
    "admission-failure": "Events not recorded", "delivery-failure": "Log post failed", "gateway-discontinuity": "Connection to Fluxer interrupted", "invite-create": "Invite created", "invite-delete": "Invite deleted", "bot-join": "Unexpected bot joined",
    "webhook-change": "Unexpected webhook change", "privilege-change": "Dangerous permissions granted", "impersonation": "Possible impersonation" }
const auditLabels: Record<MetadataLogsAuditAction, string> = { 1: "Server changed", 10: "Channel created", 11: "Channel changed", 12: "Channel deleted", 13: "Channel permission added", 14: "Channel permission changed", 15: "Channel permission removed",
    20: "Member kicked", 22: "Member banned", 23: "Member unbanned", 24: "Member changed", 25: "Member roles changed", 26: "Member moved in voice", 27: "Member disconnected from voice", 28: "Bot added", 30: "Role created", 31: "Role changed", 32: "Role deleted" }
/** A plain name for an event type or audit action selector, such as Member joined for member-add. Replies show it, and commands take it as well as the code */
export function metadataEventLabel(selector: string) {
    const action = /^audit-entry:(\d+)$/.exec(selector)?.[1]
    return action ? `Audit: ${auditLabels[Number(action) as MetadataLogsAuditAction] ?? "Log entry"}` : eventLabels[selector as MetadataLogsEventType] ?? selector
}
// Case, spacing and a name's colon aside, so audit member kicked is Audit: Member kicked. Codes keep theirs, as in audit-entry:20.
// No name or code holds a mention or a channel ID, so a channel or owner never joins one
const selectorKey = (text: string) => text.toLowerCase().replace(/:(?!\d)/g, " ").replace(/\s+/g, " ").trim()
const selectorNames = new Map(metadataLogEventSelectors.flatMap(selector => [[selectorKey(selector), selector], [selectorKey(metadataEventLabel(selector)), selector]] as const))
/** The event typed as its code or its plain name, which may span several words */
const selectorOf = (words: readonly string[]) => words.length ? selectorNames.get(selectorKey(words.join(" "))) : undefined
/** A configuration change as typed in chat. The bot reads its revision right before the write */
type Unrevised<T> = T extends unknown ? Omit<T, "expectedRevision" | "recipientOwner"> : never
export type MetadataLogChange = Unrevised<MetadataLogsConfigurationOperation>
/** A private report. Status, categories and overrides all read the settings */
export type MetadataLogCommand = { type: "query", operation: MetadataLogsQueryOperation, next?: true, view?: "categories" | "overrides" }
    | { type: "manage", operation: MetadataLogChange | Extract<MetadataLogsManageOperation, { type: "forget" }> }
    | { type: "reconcile", recordNo: number }
    | { type: "help" }
export type MetadataLogParse = MetadataLogCommand | { error: string }
const integer = (v: string | undefined, min = 1) => v !== undefined && /^(0|[1-9]\d*)$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) >= min ? Number(v) : undefined
const ids = (v: string | undefined) => v === "none" ? [] : v?.split(",").map(commandId)
export const isMetadataLogCommand = (args: readonly string[]) => ["metadata", "events", "delivery", "counters"].includes(args[0] ?? "")
export function parseMetadataLogCommand(args: readonly string[]): MetadataLogParse {
    const error = { error: "Check values. Use !logs metadata help" }
    if (args[0] === "counters") return args.length === 1 ? { type: "query", operation: { type: "counters" } } : error
    if (args[0] === "events") {
        if ((args[1] ?? "list") === "list" && (args.length <= 2 || args.length === 3 && args[2] === "next")) return { type: "query", operation: { type: "list" }, ...(args[2] ? { next: true as const } : {}) }
        if (args[1] === "show" && args.length === 3 && integer(args[2])) return { type: "query", operation: { type: "show", recordNo: integer(args[2])! } }
        return error
    }
    if (args[0] === "delivery") return args[1] === "show" && args.length === 3 && integer(args[2]) ? { type: "query", operation: { type: "show", recordNo: integer(args[2])! } }
        : args[1] === "reconcile" && args.length === 3 && integer(args[2]) ? { type: "reconcile", recordNo: integer(args[2])! } : error
    if (args[0] !== "metadata") return error
    const verb = args[1]
    if ((verb === undefined || verb === "help") && args.length <= 2) return { type: "help" }
    if (verb === "status" && args.length === 2) return { type: "query", operation: { type: "settings" } }
    if (verb === "categories" && args.length === 2) return { type: "query", operation: { type: "settings" }, view: "categories" }
    if (verb === "overrides" && (args.length === 2 || args.length === 3 && args[2] === "next")) return { type: "query", operation: { type: "settings" }, view: "overrides", ...(args[2] ? { next: true as const } : {}) }
    if (verb === "module" && args.length === 3 && ["on", "off"].includes(args[2]!)) return { type: "manage", operation: { type: "module", enabled: args[2] === "on" } }
    const category = metadataLogCategories.find(v => v === args[2])
    // The event is every word between the verb and the fixed words after it
    const inherited = verb === "inherit" ? selectorOf(args.slice(2)) : undefined
    if (inherited) return { type: "manage", operation: { type: "event-clear", eventType: inherited } }
    const silenced = verb === "event" && args.at(-1) === "off" ? selectorOf(args.slice(2, -1)) : undefined
    if (silenced) return { type: "manage", operation: { type: "event-route", eventType: silenced, enabled: false } }
    const routed = verb === "event" && args.length >= 6 && args.at(-1) === "on" ? selectorOf(args.slice(2, -3)) : undefined, channelId = commandId(args.at(-3)), ownerId = commandId(args.at(-2))
    if (routed && channelId && ownerId) return { type: "manage", operation: { type: "event-route", eventType: routed, enabled: true, channelId, ownerId } }
    if (verb === "clear" && args.length === 3 && category) return { type: "manage", operation: { type: "clear", category } }
    if (verb === "route" && args.length === 6 && category && commandId(args[3]) && commandId(args[4]) && ["on", "off"].includes(args[5]!))
        return { type: "manage", operation: { type: "route", category, channelId: commandId(args[3])!, ownerId: commandId(args[4])!, enabled: args[5] === "on" } }
    if (verb === "channels" && args.length === 4) {
        const channels = ids(args[2]), exclusions = ids(args[3])
        if (channels && exclusions && channels.length <= 50 && exclusions.length <= 50 && channels.every(v => v !== undefined) && exclusions.every(v => v !== undefined)
            && new Set(channels).size === channels.length && new Set(exclusions).size === exclusions.length)
            return { type: "manage", operation: { type: "channels", messageChannelIds: channels as string[], excludedChannelIds: exclusions as string[] } }
    }
    if (verb === "forget" && args.length === 4 && integer(args[2]) && args[3] === "confirm") return { type: "manage", operation: { type: "forget", recordNo: integer(args[2])!, confirm: true } }
    return error
}
export const metadataLogHelp = ["!logs metadata status: Whether metadata logs are on, and any channel NeonFlux cannot post in", "!logs metadata categories: Where each category posts",
    "!logs metadata route <category> <channel> <owner> on|off: Send a category to a channel", "Categories: membership, resources, messages, audit, settings, operations, security",
    "!logs metadata channels <channel IDs|none> <excluded IDs|none>: Channels whose message edits and deletions are logged", "!logs events list [next]: Recent logged events",
    "!logs metadata module on|off: Turn metadata logs on or off", "Send !logs metadata help all for the other commands"].join("\n")
/** The forms !logs metadata help leaves out, listed by !logs metadata help all */
export const metadataLogHelpAll = ["!logs metadata overrides [next]: Events that do not follow their category", "!logs metadata clear <category>: Stop sending a category",
    "!logs metadata event <event> <channel> <owner> on: Send one event to its own channel", "!logs metadata event <event> off: Never log one event", "!logs metadata inherit <event>: Let an event follow its category again",
    "!logs events show <record>: One logged event", "!logs delivery show|reconcile <record>: A log post's delivery, or check one that was not confirmed", "!logs metadata forget <record> confirm: Remove a stored record",
    "!logs counters: Open tickets, stored records and waiting log posts", "An <event> is its name as the logs show it, such as Member joined or Audit: Member kicked, or its code, such as member-add"]
