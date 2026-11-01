import { isLimitableCommand, isUnlimitableCommand, type CommandRuleName } from "@neonflux/contracts/command-rules"
import { commands as commandParser } from "@neontechspace/fluxerly/effect"
import { argument } from "./command-arguments.ts"

export type CommandRulesCommand =
    | { type: "help" }
    | { type: "rules"; next?: true }
    | { type: "show"; command: CommandRuleName }
    | { type: "clear"; command: CommandRuleName }
    | { type: "channels"; command: CommandRuleName; channelIds: string[] }
    | { type: "roles"; command: CommandRuleName; roleIds: string[] }

export const commandRulesHelp = [
    "!commands rule <command> channels #a #b: Where a command works",
    "!commands rule <command> roles @a @b: Who can use a command",
    "!commands rule <command> channels all: Remove the channel limit",
    "!commands rule <command> roles all: Remove the role limit",
    "!commands rule <command> clear: Remove the rule",
    "!commands rules: The server's rules",
    "!commands show <command>: One command's rule",
].join("\n")

const usage = { error: "Check the command syntax. Use !commands help" }
/** A command a rule can name, by the name members type, or why it cannot be limited */
function ruleName(word: string | undefined): { command: CommandRuleName } | { error: string } {
    const name = word?.replace(/^!/, "").toLowerCase()
    if (name && isUnlimitableCommand(name))
        return { error: `!${name} always works everywhere, because safety, recovery or access depends on it` }
    return name && isLimitableCommand(name) ? { command: name } : { error: "Name a built-in command, such as rank" }
}
/** The mentions or IDs of one kind, or undefined when one of them is neither */
function ids(values: readonly string[], kind: "channel" | "role") {
    const parsed = values.map((value) =>
        commandParser.parseArgument(value, kind === "channel" ? argument.channel : argument.role),
    )
    return parsed.every((id): id is string => typeof id === "string") ? [...new Set(parsed)] : undefined
}

export function parseCommandRulesCommand(args: readonly string[]): CommandRulesCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || (verb === "help" && args.length === 1)) return { type: "help" }
    if (verb === "rules") {
        if (args.length === 1) return { type: "rules" }
        return args.length === 2 && args[1]!.toLowerCase() === "next" ? { type: "rules", next: true } : usage
    }
    if (verb === "show") {
        if (args.length !== 2) return usage
        const named = ruleName(args[1])
        return "error" in named ? named : { type: "show", command: named.command }
    }
    if (verb !== "rule" || args.length < 3) return usage
    const named = ruleName(args[1])
    if ("error" in named) return named
    const { command } = named,
        field = args[2]!.toLowerCase(),
        values = args.slice(3)
    if (field === "clear") return values.length ? usage : { type: "clear", command }
    if (field !== "channels" && field !== "roles") return usage
    if (!values.length) return usage
    const all = values.length === 1 && values[0]!.toLowerCase() === "all"
    if (field === "channels") {
        const channelIds = all ? [] : ids(values, "channel")
        return channelIds
            ? { type: "channels", command, channelIds }
            : { error: "Name channels, such as #bot-commands" }
    }
    const roleIds = all ? [] : ids(values, "role")
    return roleIds ? { type: "roles", command, roleIds } : { error: "Name roles, such as @Members" }
}
