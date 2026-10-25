import { SuggestionsState } from "@neonflux/contracts/suggestions"
import { commands } from "@neontechspace/fluxerly/effect"
import { argument, freeText } from "./command-arguments.ts"

const suggestionStates = SuggestionsState.literals
/** Each state's name as replies and cards show it */
export const suggestionStateNames: Record<SuggestionsState, string> = {
    "under-review": "Under review",
    planned: "Planned",
    completed: "Completed",
    declined: "Declined",
    withdrawn: "Withdrawn",
}
export type SuggestionCommand =
    | { type: "help" }
    | { type: "settings" }
    | { type: "submit"; text: string }
    | { [K in "show" | "mine" | "publication"]: { type: K; suggestionNo: number } }["show" | "mine" | "publication"]
    | { type: "list"; state?: SuggestionsState; next: boolean }
    | { type: "vote"; suggestionNo: number; vote: "up" | "down" | "clear" }
    | { type: "recount"; suggestionNo: number; next: boolean }
    | { [K in "withdraw" | "forget" | "reconcile" | "replace"]: { type: K; suggestionNo: number; confirmed: boolean } }[
          "withdraw" | "forget" | "reconcile" | "replace"]
    | { type: "configure"; channelId: string | null }
    | { [K in "enable" | "disable"]: { type: K } }["enable" | "disable"]
    | { type: "status"; suggestionNo: number; state: Exclude<SuggestionsState, "withdrawn">; reason: string }

const text = (v: string | undefined, max: number) => v !== undefined && v.trim().length > 0 && v.length <= max
export const suggestionPublic = (c: SuggestionCommand) =>
    ["submit", "show", "list", "vote", "mine", "withdraw", "help"].includes(c.type)
export const suggestionCritical = (c: SuggestionCommand | { error: string }) =>
    !("error" in c) &&
    [
        "show",
        "list",
        "mine",
        "withdraw",
        "settings",
        "publication",
        "reconcile",
        "replace",
        "forget",
        "disable",
        "status",
    ].includes(c.type)
export const suggestionHelp = [
    '!suggest submit "text": Post a suggestion',
    "!suggest list [state] [next]: Suggestions, such as !suggest list planned",
    "!suggest show <number>: One suggestion and its votes",
    "!suggest vote <number> up|down|clear: Vote, or take your vote back",
    "!suggest withdraw <number> [confirm]: Withdraw your suggestion for good",
    "!suggest status <number> under-review|planned|completed|declined <reason>: Set its state, with a public reason",
    "!suggest configure #channel|none: Where suggestions go, or none to clear it and turn suggestions off",
    "!suggest enable|disable: Turn suggestions on or off",
    "Send !suggest help all for the other commands",
].join("\n")
/** The forms !suggest help leaves out, listed by !suggest help all */
export const suggestionHelpAll = [
    "!suggest mine <number>: Your own vote",
    "!suggest settings: The suggestion settings",
    "!suggest publication <number>: Whether its card was posted",
    "!suggest reconcile|replace <number> [confirm]: Check its card, or post it again when it is missing",
    "!suggest forget <number> [confirm]: Remove a closed suggestion's data. Posted cards stay",
]
export function parseSuggestionCommand(args: readonly string[]): SuggestionCommand | { error: string } {
    const error = { error: "Check quoting, numbers and IDs. Use !suggest help for syntax" }
    const verb = args[0]?.toLowerCase()
    if (!verb || (verb === "help" && args.length === 1)) return { type: "help" }
    if (verb === "settings" && args.length === 1) return { type: "settings" }
    if (verb === "submit" && args.length === 2 && text(args[1], 2000)) return { type: "submit", text: args[1]! }
    const suggestionNo = commands.parseArgument(args[1], argument.positive)
    if (["show", "mine", "publication"].includes(verb!) && args.length === 2 && suggestionNo)
        return { type: verb as "show" | "mine" | "publication", suggestionNo }
    if (verb === "list" && args.length <= 3) {
        const state = suggestionStates.includes(args[1] as SuggestionsState)
                ? (args[1] as SuggestionsState)
                : undefined,
            rest = args.slice(state ? 2 : 1)
        if (!rest.length || (rest.length === 1 && rest[0] === "next"))
            return { type: "list", ...(state ? { state } : {}), next: rest[0] === "next" }
    }
    if (verb === "vote" && args.length === 3 && suggestionNo && ["up", "down", "clear"].includes(args[2]!))
        return { type: "vote", suggestionNo, vote: args[2] as "up" | "down" | "clear" }
    const channelId = commands.parseArgument(args[1], argument.channel)
    if (verb === "configure" && args.length === 2 && (channelId || args[1] === "none"))
        return { type: "configure", channelId: channelId ?? null }
    if (["enable", "disable"].includes(verb!) && args.length === 1) return { type: verb as "enable" | "disable" }
    if (!suggestionNo) return error
    if (verb === "recount" && (args.length === 2 || (args.length === 3 && args[2] === "next")))
        return { type: "recount", suggestionNo, next: args[2] === "next" }
    if (
        ["withdraw", "forget", "reconcile", "replace"].includes(verb!) &&
        (args.length === 2 || (args.length === 3 && args[2] === "confirm"))
    )
        return {
            type: verb as "withdraw" | "forget" | "reconcile" | "replace",
            suggestionNo,
            confirmed: args[2] === "confirm",
        }
    // The public reason runs to the end of the command, so it needs no quotes
    if (
        verb === "status" &&
        args.length >= 4 &&
        suggestionStates.slice(0, 4).includes(args[2] as Exclude<SuggestionsState, "withdrawn">) &&
        text(freeText(args, 3), 500)
    )
        return {
            type: "status",
            suggestionNo,
            state: args[2] as Exclude<SuggestionsState, "withdrawn">,
            reason: freeText(args, 3),
        }
    return error
}
