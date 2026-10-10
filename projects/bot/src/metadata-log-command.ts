import type * as C from "@neonflux/backend/contracts"
import { commandId } from "./moderation-command.ts"
import { metadataAuditActions } from "./metadata-log-projector.ts"

export const metadataLogCategories = ["membership", "resources", "messages", "audit", "settings", "operations", "security"] as const
export const metadataLogEventTypes = ["member-add", "member-update", "member-remove", "role-create", "role-update", "role-delete", "channel-create", "channel-update", "channel-delete", "thread-create", "thread-update", "thread-delete", "server-update", "message-update", "message-delete", "message-bulk-delete", "audit-entry", "settings-change", "backend-failure", "admission-failure", "delivery-failure", "gateway-discontinuity", "invite-create", "invite-delete", "bot-join", "webhook-change", "privilege-change", "impersonation"] as const
export const metadataLogEventSelectors = [...metadataLogEventTypes, ...metadataAuditActions.map(action => `audit-entry:${action}` as const)]
/** A configuration change as typed in chat. The bot reads its revision right before the write */
type Unrevised<T> = T extends unknown ? Omit<T, "expectedRevision" | "recipientOwner"> : never
export type MetadataLogChange = Unrevised<C.MetadataLogsConfigurationOperation>
export type MetadataLogCommand = { type: "query", operation: C.MetadataLogsQueryOperation, next?: true }
    | { type: "manage", operation: MetadataLogChange | Extract<C.MetadataLogsManageOperation, { type: "forget" }> }
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
    if (verb === "module" && args.length === 3 && ["on", "off"].includes(args[2]!)) return { type: "manage", operation: { type: "module", enabled: args[2] === "on" } }
    const category = metadataLogCategories.find(v => v === args[2])
    const eventType = metadataLogEventSelectors.find(v => v === args[2])
    if (verb === "inherit" && args.length === 3 && eventType) return { type: "manage", operation: { type: "event-clear", eventType } }
    if (verb === "event" && eventType) {
        if (args.length === 4 && args[3] === "off") return { type: "manage", operation: { type: "event-route", eventType, enabled: false } }
        if (args.length === 6 && commandId(args[3]) && commandId(args[4]) && args[5] === "on") return { type: "manage", operation: { type: "event-route", eventType, enabled: true, channelId: commandId(args[3])!, ownerId: commandId(args[4])! } }
    }
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
export const metadataLogHelp = ["!logs metadata status | module on|off", "!logs metadata route <category> <channel> <owner> on|off | clear <category>",
    "!logs metadata event <event-selector> <channel> <owner> on | event <event-selector> off | inherit <event-selector>",
    "!logs metadata channels <comma-separated channel IDs|none> <excluded IDs|none>", "!logs events list [next] | show <record>", "!logs delivery show|reconcile <record> | metadata forget <record> confirm",
    "Status, counters, events and delivery reports arrive in a private Owner/Admin DM. Status shows the bot's fresh permissions in each destination", "Categories: membership, resources, messages, audit, settings, operations, security. Security carries the alerts !alerts turns on", "Audit action selectors use audit-entry:<action-number>. Inherit removes the override"].join("\n")
