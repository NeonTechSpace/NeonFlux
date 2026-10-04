import { commandId } from "./moderation-command.ts"

export type LevelCommand =
    | { type: "help" }
    | { type: "config" }
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
    | { type: "audit", beforeAuditNo?: number }

const integer = (value: string | undefined, min: number, max = Number.MAX_SAFE_INTEGER) =>
    value !== undefined && /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : undefined
const reason = (value: string | undefined) => value !== undefined && value.trim().length > 0 && value.length <= 500 && !/[\u0000-\u001f\u007f]/.test(value)
export const levelCursor = (value: string | undefined) => value !== undefined && value.length <= 128 && /^(0|[1-9]\d*):[1-9]\d{0,19}:[1-9]\d*$/.test(value)
    && integer(value.split(":")[0], 0, 100000000) !== undefined && commandId(value.split(":")[1]) !== undefined && integer(value.split(":")[2], 1) !== undefined ? value : undefined

export function levelHelp() {
    return [
        "!level config | status | help",
        "!level module on|off",
        "!level rate <1-100 XP> <15-3600 seconds>",
        "!level exclude channels|roles <IDs...|none> (At most 50)",
        "!level map <1-1000 level> @role | unmap <level>",
        "!level clear [confirm]",
        '!level correct @user <0-100000000 XP> "reason"',
        '!level reset member @user "reason" [confirm]',
        '!level reset server "reason" [confirm]',
        "!level reconcile [@user] | audit [before-audit-number]",
        "!rank [@user] | !leaderboard [next-page cursor]",
        "Owner or administrator management",
    ].join("\n")
}

export function parseLevelCommand(args: readonly string[]): LevelCommand | { error: string } {
    const verb = args[0]?.toLowerCase(), error = { error: "Check quoting and values. Use !level help for copyable syntax" }
    if (!verb || verb === "help" && args.length === 1) return { type: "help" }
    if (["config", "status"].includes(verb) && args.length === 1) return { type: verb as "config" | "status" }
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
    if (verb === "correct" && args.length === 4 && commandId(args[1]) && integer(args[2], 0, 100000000) !== undefined && reason(args[3]))
        return { type: "correct", userId: commandId(args[1])!, xp: Number(args[2]), reason: args[3]! }
    if (verb === "reset" && args[1] === "member" && (args.length === 4 || args.length === 5 && args[4] === "confirm") && commandId(args[2]) && reason(args[3]))
        return { type: "reset-member", userId: commandId(args[2])!, reason: args[3]!, confirmed: args[4] === "confirm" }
    if (verb === "reset" && args[1] === "server" && (args.length === 3 || args.length === 4 && args[3] === "confirm") && reason(args[2]))
        return { type: "reset-server", reason: args[2]!, confirmed: args[3] === "confirm" }
    if (verb === "reconcile" && args.length <= 2 && (args.length === 1 || commandId(args[1]))) return { type: "reconcile", ...(args[1] ? { userId: commandId(args[1])! } : {}) }
    if (verb === "audit" && args.length <= 2 && (args.length === 1 || integer(args[1], 1) !== undefined)) return { type: "audit", ...(args[1] ? { beforeAuditNo: Number(args[1]) } : {}) }
    return error
}

export function parseRankCommand(args: readonly string[]): { userId?: string } | { error: string } {
    return args.length === 0 ? {} : args.length === 1 && commandId(args[0]) ? { userId: commandId(args[0])! } : { error: "Use !rank [@user or user ID]" }
}
export function parseLeaderboardCommand(args: readonly string[]): { cursor?: string } | { error: string } {
    return args.length === 0 ? {} : args.length === 1 && levelCursor(args[0]) ? { cursor: args[0]! } : { error: "Use !leaderboard or copy the next-page command from its reply" }
}
