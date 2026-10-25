import {
    METADATA_CHANNEL_LIMIT,
    type MetadataLogsConfigurationOperation,
    type MetadataLogsQueryOperation,
    type MetadataLogsManageOperation,
    metadataCategories as metadataLogCategories,
    metadataEventSelectors as metadataLogEventSelectors,
    metadataEventLabel,
} from "@neonflux/contracts/metadata-logs"
import { commands } from "@neontechspace/fluxerly/effect"
import { argument } from "./command-arguments.ts"

export { metadataLogCategories, metadataLogEventSelectors, metadataEventLabel }
// Case, spacing and a name's colon aside, so audit member kicked is Audit: Member kicked. Codes keep theirs, as in audit-entry:20.
// No name or code holds a mention or a channel ID, so a channel or owner never joins one
const selectorKey = (text: string) =>
    text
        .toLowerCase()
        .replace(/:(?!\d)/g, " ")
        .replace(/\s+/g, " ")
        .trim()
const selectorNames = new Map(
    metadataLogEventSelectors.flatMap(
        (selector) =>
            [
                [selectorKey(selector), selector],
                [selectorKey(metadataEventLabel(selector)), selector],
            ] as const,
    ),
)
/** The event typed as its code or its plain name, which may span several words */
const selectorOf = (words: readonly string[]) =>
    words.length ? selectorNames.get(selectorKey(words.join(" "))) : undefined
/** A configuration change as typed in chat. The bot reads its revision right before the write */
type Unrevised<T> = T extends unknown ? Omit<T, "expectedRevision" | "recipientOwner"> : never
// A route's owner may be left out, and the sender owns it then
type Owned<T> = T extends { type: "route" | "event-route" } ? Omit<T, "ownerId"> & { ownerId?: string } : T
export type MetadataLogChange = Owned<Unrevised<MetadataLogsConfigurationOperation>>
/** Channels added to or removed from the listed or the excluded channels, applied to the lists read right before the write */
export type MetadataLogChannelEdit = {
    type: "channel-list"
    list: "listed" | "excluded"
    add: boolean
    channelIds: string[]
}
/** A private report. Status, categories and overrides all read the settings */
export type MetadataLogCommand =
    | { type: "query"; operation: MetadataLogsQueryOperation; next?: true; view?: "categories" | "overrides" }
    | {
          type: "manage"
          operation:
              MetadataLogChange | MetadataLogChannelEdit | Extract<MetadataLogsManageOperation, { type: "forget" }>
      }
    | { type: "reconcile"; recordNo: number }
    | { type: "help" }
export type MetadataLogParse = MetadataLogCommand | { error: string }
const ids = (v: string | undefined) =>
    v === "none" ? [] : v?.split(",").map((id) => commands.parseArgument(id, argument.channel))
export const isMetadataLogCommand = (args: readonly string[]) =>
    ["metadata", "events", "delivery", "counters"].includes(args[0] ?? "")
export function parseMetadataLogCommand(args: readonly string[]): MetadataLogParse {
    const error = { error: "Check values. Use !logs metadata help" }
    const recordNo = commands.parseArgument(args[2], argument.positive)
    if (args[0] === "counters") return args.length === 1 ? { type: "query", operation: { type: "counters" } } : error
    if (args[0] === "events") {
        if ((args[1] ?? "list") === "list" && (args.length <= 2 || (args.length === 3 && args[2] === "next")))
            return { type: "query", operation: { type: "list" }, ...(args[2] ? { next: true as const } : {}) }
        if (args[1] === "show" && args.length === 3 && recordNo)
            return { type: "query", operation: { type: "show", recordNo } }
        return error
    }
    if (args[0] === "delivery")
        return args[1] === "show" && args.length === 3 && recordNo
            ? { type: "query", operation: { type: "show", recordNo } }
            : args[1] === "reconcile" && args.length === 3 && recordNo
              ? { type: "reconcile", recordNo }
              : error
    if (args[0] !== "metadata") return error
    const verb = args[1]
    if ((verb === undefined || verb === "help") && args.length <= 2) return { type: "help" }
    if (verb === "status" && args.length === 2) return { type: "query", operation: { type: "settings" } }
    if (verb === "categories" && args.length === 2)
        return { type: "query", operation: { type: "settings" }, view: "categories" }
    if (verb === "overrides" && (args.length === 2 || (args.length === 3 && args[2] === "next")))
        return {
            type: "query",
            operation: { type: "settings" },
            view: "overrides",
            ...(args[2] ? { next: true as const } : {}),
        }
    if (verb === "module" && args.length === 3 && ["on", "off"].includes(args[2]!))
        return { type: "manage", operation: { type: "module", enabled: args[2] === "on" } }
    const category = metadataLogCategories.find((v) => v === args[2])
    // The event is every word between the verb and the fixed words after it
    const inherited = verb === "inherit" ? selectorOf(args.slice(2)) : undefined
    if (inherited) return { type: "manage", operation: { type: "event-clear", eventType: inherited } }
    const silenced = verb === "event" && args.at(-1) === "off" ? selectorOf(args.slice(2, -1)) : undefined
    if (silenced) return { type: "manage", operation: { type: "event-route", eventType: silenced, enabled: false } }
    // The owner form comes first. An event name never holds an ID or a mention, so both forms cannot match
    if (verb === "event" && args.at(-1) === "on")
        for (const owned of [true, false]) {
            const end = owned ? -3 : -2,
                routed = args.length >= (owned ? 6 : 5) ? selectorOf(args.slice(2, end)) : undefined,
                channelId = commands.parseArgument(args.at(end), argument.channel),
                ownerId = owned ? commands.parseArgument(args.at(-2), argument.user) : undefined
            if (routed && channelId && (!owned || ownerId))
                return {
                    type: "manage",
                    operation: {
                        type: "event-route",
                        eventType: routed,
                        enabled: true,
                        channelId,
                        ...(ownerId ? { ownerId } : {}),
                    },
                }
        }
    const routeChannelId = commands.parseArgument(args[3], argument.channel),
        routeOwnerId = args.length === 6 ? commands.parseArgument(args[4], argument.user) : undefined
    if (verb === "clear" && args.length === 3 && category)
        return { type: "manage", operation: { type: "clear", category } }
    if (
        verb === "route" &&
        (args.length === 5 || (args.length === 6 && routeOwnerId)) &&
        category &&
        routeChannelId &&
        ["on", "off"].includes(args.at(-1)!)
    )
        return {
            type: "manage",
            operation: {
                type: "route",
                category,
                channelId: routeChannelId,
                ...(routeOwnerId ? { ownerId: routeOwnerId } : {}),
                enabled: args.at(-1) === "on",
            },
        }
    // add and remove change one list without retyping the rest. The channels may be split by commas, spaces or both
    if ((verb === "channels" || verb === "exclude") && args.length >= 4 && ["add", "remove"].includes(args[2]!)) {
        const channelIds = args
            .slice(3)
            .flatMap((word) => word.split(","))
            .filter(Boolean)
            .map((id) => commands.parseArgument(id, argument.channel))
        if (
            channelIds?.length &&
            channelIds.length <= METADATA_CHANNEL_LIMIT &&
            channelIds.every((v) => v !== undefined) &&
            new Set(channelIds).size === channelIds.length
        )
            return {
                type: "manage",
                operation: {
                    type: "channel-list",
                    list: verb === "channels" ? "listed" : "excluded",
                    add: args[2] === "add",
                    channelIds: channelIds as string[],
                },
            }
        return error
    }
    if (verb === "channels" && (args[2] === "all" ? args.length >= 3 : args.length === 4)) {
        // all takes message events from every channel except the excluded ones, which may be left out or split by
        // commas, spaces or both
        const all = args[2] === "all",
            channels = all ? [] : ids(args[2]),
            exclusions =
                all && !(args.length === 4 && args[3] === "none")
                    ? args
                          .slice(3)
                          .flatMap((word) => word.split(","))
                          .filter(Boolean)
                          .map((id) => commands.parseArgument(id, argument.channel))
                    : ids(args[3])
        if (
            channels &&
            exclusions &&
            channels.length <= METADATA_CHANNEL_LIMIT &&
            exclusions.length <= METADATA_CHANNEL_LIMIT &&
            channels.every((v) => v !== undefined) &&
            exclusions.every((v) => v !== undefined) &&
            new Set(channels).size === channels.length &&
            new Set(exclusions).size === exclusions.length
        )
            return {
                type: "manage",
                operation: {
                    type: "channels",
                    ...(all ? { allChannels: true } : {}),
                    messageChannelIds: channels as string[],
                    excludedChannelIds: exclusions as string[],
                },
            }
    }
    if (verb === "forget" && args.length === 4 && recordNo && args[3] === "confirm")
        return { type: "manage", operation: { type: "forget", recordNo, confirm: true } }
    return error
}
export const metadataLogHelp = [
    "!logs metadata status: Whether metadata logs are on, and any channel NeonFlux cannot post in",
    "!logs metadata categories: Where each category posts",
    "!logs metadata route <category> <channel> [owner] on|off: Send a category to a channel. The owner is you unless you name one",
    "Categories: membership, resources, messages, audit, settings, operations, security",
    "!logs metadata channels all [excluded IDs]: Log message edits and deletions from every channel except the excluded ones",
    "!logs metadata channels <channel IDs|none> <excluded IDs|none>: Log message edits and deletions from only these channels",
    "!logs metadata channels|exclude add|remove <channel IDs>: Add channels to the listed or excluded channels, or remove them",
    "!logs events list [next]: Recent logged events",
    "!logs metadata module on|off: Turn metadata logs on or off",
    "Send !logs metadata help all for the other commands",
].join("\n")
/** The forms !logs metadata help leaves out, listed by !logs metadata help all */
export const metadataLogHelpAll = [
    "!logs metadata overrides [next]: Events that do not follow their category",
    "!logs metadata clear <category>: Stop sending a category",
    "!logs metadata event <event> <channel> [owner] on: Send one event to its own channel",
    "!logs metadata event <event> off: Never log one event",
    "!logs metadata inherit <event>: Let an event follow its category again",
    "!logs events show <record>: One logged event",
    "!logs delivery show|reconcile <record>: A log post's delivery, or check one that was not confirmed",
    "!logs metadata forget <record> confirm: Remove a stored record",
    "!logs counters: Open tickets, stored records and waiting log posts",
    "An <event> is its name as the logs show it, such as Member joined or Audit: Member kicked, or its code, such as member-add",
]
