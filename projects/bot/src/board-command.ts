import { BOARD_LIMIT, BOARD_THRESHOLD_DEFAULT, BOARD_THRESHOLD_MAX, isBoardEmoji } from "@neonflux/contracts/boards"
import { isName } from "@neonflux/contracts/common"
import { commands } from "@neontechspace/fluxerly/effect"
import { argument, wholeNumber } from "./command-arguments.ts"

export type BoardSetting =
    { emoji: string } | { channelId: string } | { threshold: number } | { selfReactions: boolean } | { bots: boolean }
export type BoardCommand =
    | { type: "help" }
    | { type: "list" }
    | { type: "show"; name: string }
    | { type: "module"; enabled: boolean }
    | { type: "add"; name: string; emoji: string; channelId: string; threshold: number }
    | { type: "set"; name: string; setting: BoardSetting }
    | { type: "ignore"; name: string; channelId: string; ignored: boolean }
    | { type: "remove"; name: string }

export const boardHelp = [
    `!board add <name> <emoji> #channel [threshold]: Repost a message once enough members react with the emoji, up to ${BOARD_LIMIT} boards. The threshold is ${BOARD_THRESHOLD_DEFAULT} unless named. Such as !board add stars ⭐ #starboard or !board add clowns 🤡 #clownboard`,
    "!board set <name> emoji <emoji>|channel #channel|threshold <number>: Change a board and turn it back on",
    "!board set <name> self on|off|bots on|off: Whether an author's own reaction, or a message of a bot or webhook, counts. Both are off unless changed",
    "!board ignore add|remove <name> #channel: Leave a channel out of a board, or take it back in",
    "!board remove <name>: Remove a board. Its posts stay",
    "!board list: Every board",
    "!board show <name>: One board's settings",
    "!board module on|off: Turn every board on or off",
].join("\n")

const syntax = { error: "Check the board command syntax. Use !board help" }
const badName = { error: "A board's name has 1 to 32 letters, digits, _ or -, such as stars" }
const badEmoji = { error: "Name the emoji itself, such as ⭐ or a custom emoji of this server" }
const badThreshold = { error: `A threshold is a number from 1 to ${BOARD_THRESHOLD_MAX}` }
const named = (value: string | undefined) => {
    const name = value?.toLowerCase()
    return isName(name) ? name : undefined
}
const channelOf = (value: string | undefined) => commands.parseArgument(value, argument.channel)
const onOff = (value: string | undefined) => (value === "on" ? true : value === "off" ? false : undefined)
function setting(what: string | undefined, value: string): BoardSetting | { error: string } {
    switch (what) {
        case "emoji":
            return isBoardEmoji(value) ? { emoji: value } : badEmoji
        case "channel": {
            const channelId = channelOf(value)
            return channelId ? { channelId } : syntax
        }
        case "threshold": {
            const threshold = wholeNumber(value, 1, BOARD_THRESHOLD_MAX)
            return threshold ? { threshold } : badThreshold
        }
        case "self": {
            const selfReactions = onOff(value)
            return selfReactions === undefined ? syntax : { selfReactions }
        }
        case "bots": {
            const bots = onOff(value)
            return bots === undefined ? syntax : { bots }
        }
        default:
            return syntax
    }
}

export function parseBoardCommand(args: readonly string[]): BoardCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || (verb === "list" && args.length === 1)) return { type: "list" }
    if (verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "module") {
        const enabled = args.length === 2 ? onOff(args[1]?.toLowerCase()) : undefined
        return enabled === undefined ? syntax : { type: "module", enabled }
    }
    if (verb === "ignore") {
        const how = args[1]?.toLowerCase()
        if (args.length !== 4 || (how !== "add" && how !== "remove")) return syntax
        const name = named(args[2]),
            channelId = channelOf(args[3])
        if (!name) return badName
        return channelId ? { type: "ignore", name, channelId, ignored: how === "add" } : syntax
    }
    if (verb === "add") {
        if (args.length !== 4 && args.length !== 5) return syntax
        const name = named(args[1])
        if (!name) return badName
        if (!isBoardEmoji(args[2]!)) return badEmoji
        const channelId = channelOf(args[3])
        if (!channelId) return { error: "Name the channel for the posts, such as !board add stars ⭐ #starboard" }
        const threshold = args[4] === undefined ? BOARD_THRESHOLD_DEFAULT : wholeNumber(args[4], 1, BOARD_THRESHOLD_MAX)
        return threshold ? { type: "add", name, emoji: args[2]!, channelId, threshold } : badThreshold
    }
    if (verb === "set") {
        if (args.length !== 4) return syntax
        const name = named(args[1])
        if (!name) return badName
        const value = setting(
            args[2]?.toLowerCase(),
            args[2]?.toLowerCase() === "emoji" ? args[3]! : args[3]!.toLowerCase(),
        )
        return "error" in value ? value : { type: "set", name, setting: value }
    }
    if (verb === "show" || verb === "remove") {
        if (args.length !== 2) return syntax
        const name = named(args[1])
        return name ? { type: verb, name } : badName
    }
    return syntax
}
