import { commandId, freeText } from "./moderation-command.ts"

export type LevelCommand =
    | { type: "help" }
    | { type: "config", list?: LevelConfigList, next?: boolean }
    | { type: "status" }
    | { type: "module", enabled: boolean }
    | { type: "rate", xp: number, cooldown: number }
    | { type: "exclude", field: "channels" | "roles", ids: string[] }
    | { type: "map", level: number, roleId: string }
    | { type: "unmap", level: number }
    | { type: "clear", confirmed: boolean }
    | { type: "correct", userId: string, xp: number, reason: string }
    | { type: "reset-member", userId: string, confirmed: boolean, reason: string }
    | { type: "reset-server", confirmed: boolean, reason: string }
    | { type: "reconcile", userId?: string }
    | { type: "audit", next: boolean }
/** The one list of the settings that `!level config` names */
export type LevelConfigList = "channels" | "roles" | "rewards"

const integer = (value: string | undefined, min: number, max = Number.MAX_SAFE_INTEGER) =>
    value !== undefined && /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : undefined
const reason = (value: string) => value.trim().length > 0 && value.length <= 500 && !/[\u0000-\u001f\u007f]/.test(value)

export function levelHelp() {
    return [
        "!rank [@user]: XP, level and rank",
        "!leaderboard [next]: Members ordered by XP",
        "!level config: The XP settings and reward roles",
        "!level rate <1-100 XP> <15-3600 seconds>: XP per message and the wait between messages",
        "!level map <1-1000> @role: Give a role at a level",
        "!level unmap <level>: Stop giving a level's role",
        "!level module on|off: Turn leveling on or off",
        "Send !level help all for the other commands",
    ].join("\n")
}
/** The forms !level help leaves out, listed by !level help all */
export const levelHelpAll = [
    "!level config channels|roles|rewards [next]: The full list of one setting",
    "!level status: Reward role changes still waiting or blocked",
    "!level exclude channels|roles <IDs...|none>: Channels or roles that earn no XP, up to 50",
    "!level clear [confirm]: Remove every reward role",
    "!level correct @user <0-100000000> <reason>: Set a member's XP",
    "!level reset member @user <reason> [confirm]: Reset one member's XP",
    "!level reset server <reason> [confirm]: Reset everyone's XP",
    "!level reconcile [@user]: Check reward roles again, for everyone or one member",
    "!level audit [next]: Recent XP corrections and resets",
]

export function parseLevelCommand(args: readonly string[]): LevelCommand | { error: string } {
    const verb = args[0]?.toLowerCase(), error = { error: "Check quoting and values. Use !level help for copyable syntax" }
    if (!verb || verb === "help" && args.length === 1) return { type: "help" }
    if (["config", "status"].includes(verb) && args.length === 1) return { type: verb as "config" | "status" }
    if (verb === "config" && ["channels", "roles", "rewards"].includes(args[1]!) && (args.length === 2 || args.length === 3 && args[2] === "next"))
        return { type: "config", list: args[1] as LevelConfigList, next: args.length === 3 }
    if (verb === "module" && args.length === 2 && ["on", "off"].includes(args[1]!)) return { type: "module", enabled: args[1] === "on" }
    if (verb === "rate" && args.length === 3 && integer(args[1], 1, 100) !== undefined && integer(args[2], 15, 3600) !== undefined)
        return { type: "rate", xp: Number(args[1]), cooldown: Number(args[2]) }
    if (verb === "exclude" && args.length >= 3 && ["channels", "roles"].includes(args[1]!)) {
        const field = args[1] as "channels" | "roles", values = args.slice(2), ids = values.map(commandId)
        if (values.length === 1 && values[0] === "none") return { type: "exclude", field, ids: [] }
        if (ids.length <= 50 && ids.every(v => v !== undefined) && new Set(ids).size === ids.length) return { type: "exclude", field, ids: ids as string[] }
    }
    if (verb === "map" && args.length === 3 && integer(args[1], 1, 1000) !== undefined && commandId(args[2]))
        return { type: "map", level: Number(args[1]), roleId: commandId(args[2])! }
    if (verb === "unmap" && args.length === 2 && integer(args[1], 1, 1000) !== undefined) return { type: "unmap", level: Number(args[1]) }
    if (verb === "clear" && args.length <= 2 && (args.length === 1 || args[1] === "confirm")) return { type: "clear", confirmed: args[1] === "confirm" }
    if (verb === "correct" && commandId(args[1]) && integer(args[2], 0, 100000000) !== undefined && reason(freeText(args, 3)))
        return { type: "correct", userId: commandId(args[1])!, xp: Number(args[2]), reason: freeText(args, 3) }
    // A final confirm confirms a reset, and the words before it are the reason
    const confirmed = args.at(-1) === "confirm", reasonWords = confirmed ? args.slice(0, -1) : args
    if (verb === "reset" && args[1] === "member" && commandId(args[2]) && reason(freeText(reasonWords, 3)))
        return { type: "reset-member", userId: commandId(args[2])!, reason: freeText(reasonWords, 3), confirmed }
    if (verb === "reset" && args[1] === "server" && reason(freeText(reasonWords, 2))) return { type: "reset-server", reason: freeText(reasonWords, 2), confirmed }
    if (verb === "reconcile" && args.length <= 2 && (args.length === 1 || commandId(args[1]))) return { type: "reconcile", ...(args[1] ? { userId: commandId(args[1])! } : {}) }
    if (verb === "audit" && (args.length === 1 || args.length === 2 && args[1] === "next")) return { type: "audit", next: args.length === 2 }
    return error
}

export function parseRankCommand(args: readonly string[]): { userId?: string } | { error: string } {
    return args.length === 0 ? {} : args.length === 1 && commandId(args[0]) ? { userId: commandId(args[0])! } : { error: "Use !rank [@user or user ID]" }
}
export function parseLeaderboardCommand(args: readonly string[]): { next: boolean } | { error: string } {
    return args.length === 0 || args.length === 1 && args[0] === "next" ? { next: args.length === 1 } : { error: "Use !leaderboard, then !leaderboard next for the next page" }
}
