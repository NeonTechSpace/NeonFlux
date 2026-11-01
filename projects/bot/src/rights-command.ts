import { commands } from "@neontechspace/fluxerly/effect"
import {
    BOT_RIGHTS,
    RIGHTS_MAX_COUNT,
    RIGHTS_MAX_MINUTES,
    RIGHTS_MIN_MINUTES,
    type BotRight,
    type RightsOperation,
} from "@neonflux/contracts/rights"
import { argument, wholeNumber } from "./command-arguments.ts"

export type RightsCommand = { type: "status" } | { type: "change"; operation: RightsOperation }

const isRight = (value: string | undefined): value is BotRight => BOT_RIGHTS.includes(value as BotRight)
const rightList = (values: readonly string[]) => {
    const lowered = values.map((value) => value.toLowerCase())
    return lowered.length > 0 && lowered.every(isRight) ? ([...new Set(lowered)] as BotRight[]) : undefined
}
export const rightsSyntax = `Check the command. Use !mod rights status, or name rights from ${BOT_RIGHTS.join(", ")}`
/** !mod rights, after those two words */
export function parseRightsCommand(args: readonly string[]): RightsCommand | { error: string } {
    const error = { error: rightsSyntax }
    const verb = args[0]?.toLowerCase()
    if (!verb || (verb === "status" && args.length === 1)) return { type: "status" }
    const change = (operation: RightsOperation) => ({ type: "change" as const, operation })
    if ((verb === "on" || verb === "off") && args.length === 1)
        return change({ type: "module", enabled: verb === "on" })
    if (verb === "grant" || verb === "revoke") {
        const roleId = commands.parseArgument(args[1], argument.role)
        if (!roleId) return error
        const rights = rightList(args.slice(2))
        if (verb === "revoke" && args.length === 2) return change({ type: "revoke", roleId })
        if (!rights) return error
        return change(verb === "grant" ? { type: "grant", roleId, rights } : { type: "revoke", roleId, rights })
    }
    if (verb === "limit" && args.length === 4 && isRight(args[1]?.toLowerCase())) {
        const count = wholeNumber(args[2], 1, RIGHTS_MAX_COUNT),
            minutes = wholeNumber(args[3], RIGHTS_MIN_MINUTES, RIGHTS_MAX_MINUTES)
        return count && minutes
            ? change({ type: "limit", right: args[1]!.toLowerCase() as BotRight, count, minutes })
            : error
    }
    if (verb === "clear" && args.length === 2) {
        const userId = commands.parseArgument(args[1], argument.user)
        return userId ? change({ type: "clear", userId }) : error
    }
    return error
}
export const rightsHelpAll = [
    "!mod rights on|off: Let roles act through NeonFlux without the real permission. Only the owner turns it on",
    "!mod rights grant @role kick|ban|timeout|purge|slowmode|lock|quarantine|jail...: Give a role rights, for the owner",
    "!mod rights revoke @role [right...]: Take rights from a role, for the owner or an Administrator",
    "!mod rights limit <right> <count> <minutes>: What one member may do per right, for the owner",
    "!mod rights clear @member: Lift a member's suspension and start their count again, for the owner",
    "!mod rights status: Who holds what, the limits and who is suspended",
] as const
