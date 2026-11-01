import {
    COUNTER_LIMIT,
    COUNTER_NAME_MAX,
    COUNTER_PLACEHOLDER,
    counterTemplate,
    isCounterTemplate,
    type CounterKind,
} from "@neonflux/contracts/counters"
import { commands } from "@neontechspace/fluxerly/effect"
import { argument } from "./command-arguments.ts"

export type CounterCommand =
    | { type: "help" }
    | { type: "list" }
    | { type: "module"; enabled: boolean }
    | { type: "add"; channelId: string; kind: CounterKind; roleId?: string; template: string }
    | { type: "set"; channelId: string; template: string }
    | { type: "remove"; channelId: string }

export const counterHelp = [
    `!counter add members #channel "Members: {count}": Keep a channel named with the server's member count, up to ${COUNTER_LIMIT} counters`,
    '!counter add role @role #channel "Staff: {count}": The same with how many members hold a role',
    '!counter set #channel "New name: {count}": Change a counter\'s name and turn it back on',
    "!counter remove #channel: Stop renaming a channel, which keeps its name",
    "!counter list: Every counter and whether it is on",
    "!counter module on|off: Turn every counter on or off",
    "NeonFlux checks each counter every 10 minutes and renames its channel only when the name would change. It needs Manage channels there",
].join("\n")

const syntax = { error: "Check the counter command syntax. Use !counter help" }
const badTemplate = {
    error: `Write the name with ${COUNTER_PLACEHOLDER} in it, in at most ${COUNTER_NAME_MAX} characters, such as "Members: {count}"`,
}
const template = (words: readonly string[]) => {
    const value = counterTemplate(words.join(" "))
    return isCounterTemplate(value) ? value : undefined
}
export function parseCounterCommand(args: readonly string[]): CounterCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || (verb === "list" && args.length === 1)) return { type: "list" }
    if (verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "module")
        return args.length === 2 && (args[1] === "on" || args[1] === "off")
            ? { type: "module", enabled: args[1] === "on" }
            : syntax
    if (verb === "remove") {
        const channelId = args.length === 2 ? commands.parseArgument(args[1], argument.channel) : undefined
        return channelId ? { type: "remove", channelId } : syntax
    }
    if (verb === "set") {
        const channelId = args.length >= 3 ? commands.parseArgument(args[1], argument.channel) : undefined
        if (!channelId) return syntax
        const name = template(args.slice(2))
        return name ? { type: "set", channelId, template: name } : badTemplate
    }
    if (verb !== "add") return syntax
    const kind = args[1]?.toLowerCase()
    if (kind === "members") {
        const channelId = args.length >= 4 ? commands.parseArgument(args[2], argument.channel) : undefined
        if (!channelId) return syntax
        const name = template(args.slice(3))
        return name ? { type: "add", kind, channelId, template: name } : badTemplate
    }
    if (kind === "role") {
        const roleId = args.length >= 5 ? commands.parseArgument(args[2], argument.role) : undefined,
            channelId = roleId ? commands.parseArgument(args[3], argument.channel) : undefined
        if (!roleId || !channelId) return syntax
        const name = template(args.slice(4))
        return name ? { type: "add", kind, roleId, channelId, template: name } : badTemplate
    }
    return { error: "A counter counts members or a role's members. Use !counter help" }
}
