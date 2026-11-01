import {
    GIVEAWAY_LENGTH_SECONDS,
    GIVEAWAY_PRIZE_LENGTH,
    GIVEAWAY_WINNERS,
    isGiveawayPrize,
    type GiveawaySettingsPatch,
} from "@neonflux/contracts/giveaways"
import { commands } from "@neontechspace/fluxerly/effect"
import { argument, durationSeconds, freeText, wholeNumber } from "./command-arguments.ts"

export type GiveawayCommand =
    | { type: "help" }
    | { type: "settings" }
    | { type: "list"; next: boolean }
    | { type: "show" | "end" | "cancel"; giveawayNo: number }
    | { type: "reroll"; giveawayNo: number; count?: number }
    | { type: "start"; lengthSeconds: number; winners: number; channelId: string; prize: string }
    | { type: "settings-set"; patch: GiveawaySettingsPatch }

export const giveawayHelp = [
    "!giveaway start <length> <winners> #channel <prize>: Start one, such as !giveaway start 1d 2 #events Game key. Members enter by reacting",
    "!giveaway end <number>: Draw the winners now",
    "!giveaway reroll <number> [count]: Draw new winners, leaving out earlier ones",
    "!giveaway cancel <number>: Cancel a running giveaway",
    "!giveaway list [next]: Giveaways on this server",
    "!giveaway show <number>: One giveaway, its winners and any problem",
    "!giveaway settings: Whether giveaways are on and the required role",
    "!giveaway module on|off or !giveaway role @role|none: Turn giveaways on or off, or set the role a member needs to win",
].join("\n")

const number = (value: string | undefined) => wholeNumber(value?.replace(/^#/, ""), 1, 999999)
/** Turning giveaways off stays in reach at DEFCON 1 */
export const giveawayCritical = (command: GiveawayCommand | { error: string }) =>
    "type" in command && command.type === "settings-set" && command.patch.enabled === false

export function parseGiveawayCommand(args: readonly string[]): GiveawayCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || (verb === "help" && args.length === 1)) return { type: "help" }
    if (verb === "settings" && args.length === 1) return { type: "settings" }
    if (verb === "list" && args.length === 1) return { type: "list", next: false }
    if (verb === "list" && args.length === 2 && args[1]!.toLowerCase() === "next") return { type: "list", next: true }
    if (verb === "show" || verb === "end" || verb === "cancel") {
        const giveawayNo = args.length === 2 ? number(args[1]) : undefined
        return giveawayNo
            ? { type: verb, giveawayNo }
            : { error: `Name the giveaway number, such as !giveaway ${verb} 3` }
    }
    if (verb === "reroll") {
        const giveawayNo = args.length <= 3 ? number(args[1]) : undefined,
            count = args[2] === undefined ? undefined : wholeNumber(args[2], ...GIVEAWAY_WINNERS)
        if (!giveawayNo || (args[2] !== undefined && count === undefined))
            return {
                error: `Use !giveaway reroll <number> [count], with a count from ${GIVEAWAY_WINNERS.join(" to ")}`,
            }
        return { type: "reroll", giveawayNo, ...(count ? { count } : {}) }
    }
    if (verb === "module" && args.length === 2 && ["on", "off"].includes(args[1]!.toLowerCase()))
        return { type: "settings-set", patch: { enabled: args[1]!.toLowerCase() === "on" } }
    if (verb === "role" && args.length === 2) {
        const roleId = args[1]!.toLowerCase() === "none" ? null : commands.parseArgument(args[1], argument.role)
        if (roleId !== undefined) return { type: "settings-set", patch: { requiredRoleId: roleId } }
        return { error: "Name the role with a mention or its ID, or none" }
    }
    if (verb === "start") {
        const lengthSeconds = durationSeconds(args[1], GIVEAWAY_LENGTH_SECONDS[0], GIVEAWAY_LENGTH_SECONDS[1]),
            winners = wholeNumber(args[2], ...GIVEAWAY_WINNERS),
            channelId = commands.parseArgument(args[3], argument.channel),
            prize = freeText(args, 4).trim()
        if (lengthSeconds === undefined)
            return { error: "A giveaway runs from 1 minute to 60 days, such as 30m, 2h or 7d" }
        if (!winners)
            return { error: `Give the number of winners from ${GIVEAWAY_WINNERS.join(" to ")} after the length` }
        if (!channelId)
            return { error: "Name the channel after the winners, such as !giveaway start 1d 2 #events Game key" }
        if (!isGiveawayPrize(prize))
            return { error: `A prize needs 1 to ${GIVEAWAY_PRIZE_LENGTH} characters on one line` }
        return { type: "start", lengthSeconds, winners, channelId, prize }
    }
    return { error: "Check the command. Use !giveaway help" }
}
