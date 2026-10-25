import { CivilLocalDate, type CivilRecurrence } from "@neonflux/contracts/civil"
import { commands } from "@neontechspace/fluxerly/effect"
import { Schema } from "effect"

/** The argument forms the commands share: An ID with only its own kind of mention, and a whole number from 1 */
export const argument = {
    user: { type: "id", mention: "user" },
    role: { type: "id", mention: "role" },
    channel: { type: "id", mention: "channel" },
    id: { type: "id" },
    positive: { type: "integer", min: 1 },
} as const
/** A whole number in a range. The SDK reads -0 as -0, which would show as "-0" in replies and stored records */
export const wholeNumber = (token: string | undefined, min: number, max: number) => {
    const value = commands.parseArgument(token, { type: "integer", min, max })
    return value === undefined ? undefined : value + 0
}
/** Text at the end of a command, such as a reason, which needs no quotes. A quoted part counts as one word */
export const freeText = (args: readonly string[], from: number) => args.slice(from).join(" ")
/** A duration in whole seconds from min through max, written in the units the SDK reads, in either case */
export function durationSeconds(value: string | undefined, min: number, max: number) {
    const ms = commands.parseArgument(value?.toLowerCase(), {
        type: "duration",
        wholeSeconds: true,
        min: min * 1000,
        max: max * 1000,
    })
    return ms === undefined ? undefined : ms / 1000
}
/** A repeat: daily|weekly <every> [<count>|until YYYY-MM-DD|ongoing]. Without an end it never ends */
export function repeatArguments(args: readonly string[]): Exclude<CivilRecurrence, { type: "none" }> | undefined {
    const [type, every, ...end] = args,
        interval = wholeNumber(every, 1, Number.MAX_SAFE_INTEGER)
    if ((type !== "daily" && type !== "weekly") || !interval) return undefined
    if (!end.length || (end.length === 1 && end[0] === "ongoing")) return { type, interval }
    const count = end.length === 1 ? wholeNumber(end[0], 1, Number.MAX_SAFE_INTEGER) : undefined
    if (count) return { type, interval, count }
    return end.length === 2 && end[0] === "until" && Schema.is(CivilLocalDate)(end[1])
        ? { type, interval, until: end[1]! }
        : undefined
}
