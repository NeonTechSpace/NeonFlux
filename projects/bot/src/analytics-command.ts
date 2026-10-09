export type StatsCommand = { type: "summary" } | { type: "help" } | { type: "toggle", enabled: boolean }

export const statsHelp = [
    "!stats shows joins, leaves, messages, the top three channels and the three busiest hours for the last seven UTC days",
    "!stats on | !stats off",
    "Counts only, never per-member data. Owner or Manage Server commands",
].join("\n")

export function parseStatsCommand(args: readonly string[]): StatsCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (args.length === 0) return { type: "summary" }
    if (args.length === 1 && (verb === "on" || verb === "off")) return { type: "toggle", enabled: verb === "on" }
    if (args.length === 1 && verb === "help") return { type: "help" }
    return { error: "Use !stats, !stats on or !stats off" }
}
