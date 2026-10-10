import { commandId } from "./moderation-command.ts"

export const suggestionStates = ["under-review", "planned", "completed", "declined", "withdrawn"] as const
export type SuggestionState = typeof suggestionStates[number]
export type SuggestionCommand =
    | { type: "help" } | { type: "settings" }
    | { type: "submit", text: string }
    | { [K in "show" | "mine" | "publication"]: { type: K, suggestionNo: number } }["show" | "mine" | "publication"]
    | { type: "list", state?: SuggestionState, cursor?: string }
    | { type: "vote", suggestionNo: number, vote: "up" | "down" | "clear" }
    | { [K in "withdraw" | "forget"]: { type: K, suggestionNo: number, expectedRevision: number, confirmed: boolean } }["withdraw" | "forget"]
    | { type: "configure", expectedRevision: number, channelId: string }
    | { [K in "enable" | "disable"]: { type: K, expectedRevision: number } }["enable" | "disable"]
    | { type: "status", suggestionNo: number, expectedRevision: number, state: Exclude<SuggestionState, "withdrawn">, reason: string }
    | { [K in "reconcile" | "replace"]: { type: K, suggestionNo: number, expectedRevision: number, expectedGeneration: number, confirmed: boolean } }["reconcile" | "replace"]

const integer = (v: string | undefined, min = 1) => v !== undefined && /^(?:0|[1-9]\d*)$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) >= min
const text = (v: string | undefined, max: number) => v !== undefined && v.trim().length > 0 && v.length <= max
export const suggestionPublic = (c: SuggestionCommand) => ["submit", "show", "list", "vote", "mine", "withdraw", "help"].includes(c.type)
export const suggestionCritical = (c: SuggestionCommand | { error: string }) => !("error" in c) && ["show", "list", "mine", "withdraw", "settings", "publication", "reconcile", "replace", "forget", "disable", "status"].includes(c.type)
export const suggestionHelp = [
    '!suggest submit "text" | show <number> | list [state] [cursor]',
    '!suggest vote <number> up|down|clear | mine <number> | withdraw <number> <revision> confirm',
    '!suggest configure <settings-revision> #channel | enable|disable <settings-revision> | settings',
    '!suggest status <number> <revision> under-review|planned|completed|declined "public reason"',
    '!suggest publication <number> | reconcile|replace <number> <revision> <card-generation> confirm',
    '!suggest forget <number> <revision> confirm | help',
    'Command votes only. Text is immutable. Authors and staff reasons are public. Counts retain accepted historical opinions, including self-votes',
    'Mine shows only your vote. Backend administrators can access voter IDs. Withdrawal and forgetting do not delete posted messages',
    'In a forum destination each suggestion is its own post with a status tag, and commands work in any post of the forum',
].join("\n")
export function parseSuggestionCommand(args: readonly string[]): SuggestionCommand | { error: string } {
    const error = { error: "Check quoting, IDs and exact revisions. Use !suggest help for syntax" }
    const verb = args[0]?.toLowerCase()
    if (!verb || verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "settings" && args.length === 1) return { type: "settings" }
    if (verb === "submit" && args.length === 2 && text(args[1], 2000)) return { type: "submit", text: args[1]! }
    if (["show", "mine", "publication"].includes(verb!) && args.length === 2 && integer(args[1])) return { type: verb as "show" | "mine" | "publication", suggestionNo: Number(args[1]) }
    if (verb === "list" && args.length <= 3) {
        const state = suggestionStates.includes(args[1] as SuggestionState) ? args[1] as SuggestionState : undefined
        const cursor = args[state ? 2 : 1]
        if ((!cursor || integer(cursor)) && (state || args.length <= 2)) return { type: "list", ...(state ? { state } : {}), ...(cursor ? { cursor } : {}) }
    }
    if (verb === "vote" && args.length === 3 && integer(args[1]) && ["up", "down", "clear"].includes(args[2]!)) return { type: "vote", suggestionNo: Number(args[1]), vote: args[2] as "up" | "down" | "clear" }
    if (verb === "configure" && args.length === 3 && integer(args[1]) && commandId(args[2])) return { type: "configure", expectedRevision: Number(args[1]), channelId: commandId(args[2])! }
    if (["enable", "disable"].includes(verb!) && args.length === 2 && integer(args[1])) return { type: verb as "enable" | "disable", expectedRevision: Number(args[1]) }
    if (!integer(args[1]) || !integer(args[2])) return error
    const suggestionNo = Number(args[1]), expectedRevision = Number(args[2])
    if (["withdraw", "forget"].includes(verb!) && (args.length === 3 || args.length === 4 && args[3] === "confirm")) return { type: verb as "withdraw" | "forget", suggestionNo, expectedRevision, confirmed: args[3] === "confirm" }
    if (verb === "status" && args.length === 5 && suggestionStates.slice(0, 4).includes(args[3] as Exclude<SuggestionState, "withdrawn">) && text(args[4], 500)) return { type: "status", suggestionNo, expectedRevision, state: args[3] as Exclude<SuggestionState, "withdrawn">, reason: args[4]! }
    if (["reconcile", "replace"].includes(verb!) && integer(args[3]) && (args.length === 4 || args.length === 5 && args[4] === "confirm")) return { type: verb as "reconcile" | "replace", suggestionNo, expectedRevision, expectedGeneration: Number(args[3]), confirmed: args[4] === "confirm" }
    return error
}
