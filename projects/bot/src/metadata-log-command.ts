import type * as C from "@neonflux/backend/contracts"
import { commandId } from "./moderation-command.ts"
import { metadataAuditActions } from "./metadata-log-projector.ts"

export const metadataLogCategories = ["membership", "resources", "messages", "audit", "settings", "operations"] as const
export const metadataLogEventTypes = ["member-add", "member-update", "member-remove", "role-create", "role-update", "role-delete", "channel-create", "channel-update", "channel-delete", "thread-create", "thread-update", "thread-delete", "server-update", "message-update", "message-delete", "message-bulk-delete", "audit-entry", "settings-change", "backend-failure", "admission-failure", "delivery-failure", "gateway-discontinuity"] as const
export const metadataLogEventSelectors = [...metadataLogEventTypes, ...metadataAuditActions.map(action => `audit-entry:${action}` as const)]
export type MetadataLogCommand = { type: "query", operation: C.MetadataLogsQueryOperation }
    | { type: "manage", operation: Exclude<C.MetadataLogsManageOperation, { type: "route" | "reconcile" }> }
    | { type: "route", category: C.MetadataLogsCategory, expectedRevision: number, enabled: boolean, channelId: string, ownerId: string }
    | { type: "event-route", eventType: C.MetadataLogsEventSelector, expectedRevision: number, channelId: string, ownerId: string }
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
        if ((args[1] ?? "list") === "list" && args.length <= 3 && (args[2] === undefined || integer(args[2]))) return { type: "query", operation: { type: "list", ...(args[2] ? { beforeRecordNo: integer(args[2])! } : {}) } }
        if (args[1] === "show" && args.length === 3 && integer(args[2])) return { type: "query", operation: { type: "show", recordNo: integer(args[2])! } }
        return error
    }
    if (args[0] === "delivery") return args[1] === "show" && args.length === 3 && integer(args[2]) ? { type: "query", operation: { type: "show", recordNo: integer(args[2])! } }
        : args[1] === "reconcile" && args.length === 3 && integer(args[2]) ? { type: "reconcile", recordNo: integer(args[2])! } : error
    if (args[0] !== "metadata") return error
    const verb = args[1], revision = integer(args[3], 0)
    if ((verb === undefined || verb === "help") && args.length <= 2) return { type: "help" }
    if (verb === "status" && args.length === 2) return { type: "query", operation: { type: "settings" } }
    if (verb === "module" && args.length === 4 && ["on", "off"].includes(args[2]!) && revision !== undefined) return { type: "manage", operation: { type: "module", enabled: args[2] === "on", expectedRevision: revision } }
    const category = metadataLogCategories.find(v => v === args[2])
    const eventType = metadataLogEventSelectors.find(v => v === args[2])
    if (verb === "inherit" && args.length === 4 && eventType && revision !== undefined) return { type: "manage", operation: { type: "event-clear", eventType, expectedRevision: revision } }
    if (verb === "event" && eventType && revision !== undefined) {
        if (args.length === 5 && args[4] === "off") return { type: "manage", operation: { type: "event-route", eventType, expectedRevision: revision, enabled: false } }
        if (args.length === 7 && commandId(args[4]) && commandId(args[5]) && args[6] === "on") return { type: "event-route", eventType, expectedRevision: revision, channelId: commandId(args[4])!, ownerId: commandId(args[5])! }
    }
    if (verb === "clear" && args.length === 4 && category && revision !== undefined) return { type: "manage", operation: { type: "clear", category, expectedRevision: revision } }
    if (verb === "route" && args.length === 7 && category && revision !== undefined && commandId(args[4]) && commandId(args[5]) && ["on", "off"].includes(args[6]!))
        return { type: "route", category, expectedRevision: revision, channelId: commandId(args[4])!, ownerId: commandId(args[5])!, enabled: args[6] === "on" }
    if (verb === "channels" && args.length === 5 && integer(args[2], 0) !== undefined) {
        const channels = ids(args[3]), exclusions = ids(args[4])
        if (channels && exclusions && channels.length <= 50 && exclusions.length <= 50 && channels.every(v => v !== undefined) && exclusions.every(v => v !== undefined)
            && new Set(channels).size === channels.length && new Set(exclusions).size === exclusions.length)
            return { type: "manage", operation: { type: "channels", expectedRevision: integer(args[2], 0)!, messageChannelIds: channels as string[], excludedChannelIds: exclusions as string[] } }
    }
    if (verb === "forget" && args.length === 4 && integer(args[2]) && args[3] === "confirm") return { type: "manage", operation: { type: "forget", recordNo: integer(args[2])!, confirm: true } }
    return error
}
export const metadataLogHelp = ["!logs metadata status | module on|off <revision>", "!logs metadata route <category> <revision> <channel> <owner> on|off | clear <category> <revision>",
    "!logs metadata event <event-selector> <configuration-revision> <channel> <owner> on | event <event-selector> <configuration-revision> off | inherit <event-selector> <configuration-revision>",
    "!logs metadata channels <revision> <comma-separated channel IDs|none> <excluded IDs|none>", "!logs events list [before-record] | show <record>", "!logs delivery show|reconcile <record> | metadata forget <record> confirm",
    "Status, counters, events and delivery reports arrive in a private Owner/Admin DM. Status shows the bot's fresh permissions in each destination", "Categories: membership, resources, messages, audit, settings, operations", "Event overrides use the configuration revision from status. Audit action selectors use audit-entry:<action-number>. Inherit removes the override"].join("\n")
