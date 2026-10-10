import { commandId, freeText } from "./moderation-command.ts"

export const suggestionStates = ["under-review", "planned", "completed", "declined", "withdrawn"] as const
export type SuggestionState = typeof suggestionStates[number]
export type SuggestionCommand =
    | { type: "help" } | { type: "settings" }
    | { type: "submit", text: string }
    | { [K in "show" | "mine" | "publication"]: { type: K, suggestionNo: number } }["show" | "mine" | "publication"]
    | { type: "list", state?: SuggestionState, next: boolean }
    | { type: "vote", suggestionNo: number, vote: "up" | "down" | "clear" }
    | { [K in "withdraw" | "forget" | "reconcile" | "replace"]: { type: K, suggestionNo: number, confirmed: boolean } }["withdraw" | "forget" | "reconcile" | "replace"]
    | { type: "configure", channelId: string }
    | { [K in "enable" | "disable"]: { type: K } }["enable" | "disable"]
    | { type: "status", suggestionNo: number, state: Exclude<SuggestionState, "withdrawn">, reason: string }

const integer = (v: string | undefined, min = 1) => v !== undefined && /^(?:0|[1-9]\d*)$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) >= min
const text = (v: string | undefined, max: number) => v !== undefined && v.trim().length > 0 && v.length <= max
export const suggestionPublic = (c: SuggestionCommand) => ["submit", "show", "list", "vote", "mine", "withdraw", "help"].includes(c.type)
export const suggestionCritical = (c: SuggestionCommand | { error: string }) => !("error" in c) && ["show", "list", "mine", "withdraw", "settings", "publication", "reconcile", "replace", "forget", "disable", "status"].includes(c.type)
export const suggestionHelp = [
    '!suggest submit "text" | show <number> | list [state] [next]',
    '!suggest vote <number> up|down|clear | mine <number> | withdraw <number> confirm',
    '!suggest configure #channel | enable|disable | settings',
    '!suggest status <number> under-review|planned|completed|declined <public reason>',
    '!suggest publication <number> | reconcile|replace <number> confirm',
    '!suggest forget <number> confirm | help',
    'Command votes only. Text is immutable. Authors and staff reasons are public. Counts retain accepted historical opinions, including self-votes',
    'Mine shows only your vote. Backend administrators can access voter IDs. Withdrawal and forgetting do not delete posted messages',
    'In a forum destination each suggestion is its own post with a status tag, and commands work in any post of the forum',
].join("\n")
export function parseSuggestionCommand(args: readonly string[]): SuggestionCommand | { error: string } {
    const error = { error: "Check quoting, numbers and IDs. Use !suggest help for syntax" }
    const verb = args[0]?.toLowerCase()
    if (!verb || verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "settings" && args.length === 1) return { type: "settings" }
    if (verb === "submit" && args.length === 2 && text(args[1], 2000)) return { type: "submit", text: args[1]! }
    if (["show", "mine", "publication"].includes(verb!) && args.length === 2 && integer(args[1])) return { type: verb as "show" | "mine" | "publication", suggestionNo: Number(args[1]) }
    if (verb === "list" && args.length <= 3) {
        const state = suggestionStates.includes(args[1] as SuggestionState) ? args[1] as SuggestionState : undefined, rest = args.slice(state ? 2 : 1)
        if (!rest.length || rest.length === 1 && rest[0] === "next") return { type: "list", ...(state ? { state } : {}), next: rest[0] === "next" }
    }
    if (verb === "vote" && args.length === 3 && integer(args[1]) && ["up", "down", "clear"].includes(args[2]!)) return { type: "vote", suggestionNo: Number(args[1]), vote: args[2] as "up" | "down" | "clear" }
    if (verb === "configure" && args.length === 2 && commandId(args[1])) return { type: "configure", channelId: commandId(args[1])! }
    if (["enable", "disable"].includes(verb!) && args.length === 1) return { type: verb as "enable" | "disable" }
    if (!integer(args[1])) return error
    const suggestionNo = Number(args[1])
    if (["withdraw", "forget", "reconcile", "replace"].includes(verb!) && (args.length === 2 || args.length === 3 && args[2] === "confirm")) return { type: verb as "withdraw" | "forget" | "reconcile" | "replace", suggestionNo, confirmed: args[2] === "confirm" }
    // The public reason runs to the end of the command, so it needs no quotes
    if (verb === "status" && args.length >= 4 && suggestionStates.slice(0, 4).includes(args[2] as Exclude<SuggestionState, "withdrawn">) && text(freeText(args, 3), 500)) return { type: "status", suggestionNo, state: args[2] as Exclude<SuggestionState, "withdrawn">, reason: freeText(args, 3) }
    return error
}
