import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"

export const safetyNames = ["mod", "case", "logs", "automod", "security", "defcon", "appeal", "appeals"] as const
export type SafetyName = typeof safetyNames[number]
export type SafetyCommand =
    | { kind: "manage", operation: C.ModerationManageOperation }
    | { kind: "query", operation: C.ModerationQueryOperation, private: boolean }
    | { kind: "action", action: C.ModerationActionInput }
    | { kind: "purge", count: number, userId?: string, reason: string }
    | { kind: "recover", caseNo: number }
    | { kind: "honeypot", operation: "add" | "remove", channelId: string }
    | { kind: "member-appeal", operation: C.AppealMemberRequest["operation"] }
    | { kind: "staff-appeal", operation: C.AppealStaffRequest["operation"] }
    | { kind: "help", name: SafetyName }
export type SafetyParse = SafetyCommand | { error: string }

const number = (value: string | undefined, min: number, max = Number.MAX_SAFE_INTEGER) => value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : undefined
export function commandId(value: string | undefined) {
    const candidate = value?.match(/^(?:<@!?|<@&|<#)(\d+)>$/)?.[1] ?? value
    return snowflakes.isValid(candidate) && candidate !== "0" ? candidate : undefined
}
export function commandIds(values: readonly string[]) {
    if (values.length === 1 && ["all", "none"].includes(values[0]!)) return []
    const ids = values.map(commandId)
    return ids.length > 0 && ids.length <= 20 && ids.every((value) => value !== undefined) ? [...new Set(ids)] as string[] : undefined
}
function duration(value: string | undefined, max = 31536000) {
    const match = /^(\d+)(s|m|h|d)$/.exec(value ?? "")
    if (!match) return undefined
    const seconds = Number(match[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[match[2] as "s" | "m" | "h" | "d"])
    return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= max ? seconds : undefined
}
const narrative = (value: string | undefined, max = 512) => value !== undefined && value.length <= max && value.replace(/[\u000c\u202e]/g, "").trim() ? value : undefined
const nameValue = (value: string | undefined) => value && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value.toLowerCase()) ? value.toLowerCase() : undefined
const query = (operation: C.ModerationQueryOperation, privateReply = false): SafetyCommand => ({ kind: "query", operation, private: privateReply })
const settings = (patch: Extract<C.ModerationManageOperation, { type: "settings" }>["patch"]): SafetyCommand => ({ kind: "manage", operation: { type: "settings", patch } })
const bool = (value: string | undefined) => value === "on" ? true : value === "off" ? false : undefined

export function safetyHelp(name: SafetyName) {
    const help = {
        mod: ['!mod warn|kick|ban|unban|untimeout @user "reason" [case <linked-case>]', '!mod timeout @user 10m "reason" [case <linked-case>]', '!mod purge <1-100> [@user] "reason"', '!mod slowmode #channel <0-21600 seconds> "reason"', '!mod staff moderation|cases|automod|security|appeals @role...|none', '!mod module on|off | erase <case> | status'],
        case: ['!case list [@user or user <ID>] [before-case] | show <case> | recover <case>', '!case reason <case> "replacement reason" | void <case>', "Case details are delivered privately after fresh staff authorization"],
        logs: ["!logs channel #channel|off | status | list [before-case] | show <case> | recover <case>", "!logs metadata help | events list | delivery show <record>", "Private Owner/Admin: !logs counters", "Delivery outcomes are durable. Unknown deliveries are never automatically replayed"],
        automod: ['!automod create <name> spam|repeat|mentions|words|domains|invites log|delete|warn|timeout ["pattern"...]', "!automod list [page] | show <name> | enable|disable|delete <name>", '!automod update <name> action|threshold|window|duration|priority|domain-mode <value>', '!automod update <name> patterns "pattern"...|none', "!automod update <name> channels|exempt-channels|exempt-roles <mentions or IDs>...|all", "!automod module on|off | mode dry-run|enforce | status"],
        security: ['!security quarantine @user 10m "reason" | release @user "reason"', '!security lock|unlock #channel "reason"', '!security watchlist add|update @user "reason" | show|remove @user | list [page]', "!security honeypot add|remove #channel | list | module on|off", "!security joins threshold <2-100> | window <1-300 seconds> | module on|off | raid-mode off|defcon2", "!security watchlist module on|off", "!security recovery list [page] | recover <case>", "!security module on|off | mode dry-run|enforce | status"],
        defcon: ["!defcon set 1|2|3 | status | diagnose", "3: Public commands, 2: Staff commands and private appeals, 1: Critical administrator recovery controls", "DEFCON does not change channel permissions"],
        appeal: ['Private DM: !appeal cases [before-case] | submit <case> "reason" | list [page] | show|withdraw <appeal>', "Only your own cases and appeals are visible"],
        appeals: ['!appeals list [page] | show <appeal> | approve|reject <appeal> "reason"', "!appeals module on|off | status", "Review details are private. Decisions do not reverse sanctions"],
    }
    return help[name].join("\n")
}

export function parseSafetyCommand(name: SafetyName, input: readonly string[]): SafetyParse {
    const args = [...input]
    const error = { error: `Check quoting and values. Use !${name} help for examples` }
    if (args.length === 0 || (args.length === 1 && args[0] === "help")) return { kind: "help", name }
    const verb = args[0]?.toLowerCase()
    if (name === "appeal") {
        if ((verb === "list" || verb === "cases") && args.length <= 2) {
            const page = args[1] === undefined ? 1 : number(args[1], 1)
            if (page) return { kind: "member-appeal", operation: verb === "cases" ? { type: "cases", ...(args[1] ? { beforeCaseNo: page } : {}) } : { type: "list", page } }
        }
        const caseNo = number(args[1], 1)
        if (verb === "submit" && args.length === 3 && caseNo && narrative(args[2], 2000)) return { kind: "member-appeal", operation: { type: "submit", caseNo, text: args[2]! } }
        if ((verb === "show" || verb === "withdraw") && args.length === 2 && caseNo) return { kind: "member-appeal", operation: { type: verb, appealNo: caseNo } }
        return error
    }
    if (name === "appeals") {
        if (verb === "module" && args.length === 2 && bool(args[1]) !== undefined) return settings({ appealsEnabled: bool(args[1])! })
        if (verb === "status" && args.length === 1) return query({ type: "settings" })
        if (verb === "list" && args.length <= 2 && (args[1] === undefined || number(args[1], 1))) return { kind: "staff-appeal", operation: { type: "list", page: number(args[1], 1) ?? 1 } }
        const appealNo = number(args[1], 1)
        if (verb === "show" && args.length === 2 && appealNo) return { kind: "staff-appeal", operation: { type: "show", appealNo } }
        if ((verb === "approve" || verb === "reject") && args.length === 3 && appealNo && narrative(args[2])) return { kind: "staff-appeal", operation: { type: "decide", appealNo, decision: verb === "approve" ? "accepted" : "rejected", reason: args[2]! } }
        return error
    }
    if (name === "defcon") {
        if (verb === "status" || verb === "diagnose") return args.length === 1 ? query({ type: "settings" }) : error
        const level = number(args[1], 1, 3)
        return verb === "set" && args.length === 2 && level ? settings({ defcon: level as 1 | 2 | 3 }) : error
    }
    if (name === "logs") {
        if (verb === "channel" && args.length === 2 && (args[1] === "off" || commandId(args[1]))) return settings({ logChannelId: args[1] === "off" ? null : commandId(args[1])! })
        if (verb === "status" && args.length === 1) return query({ type: "settings" })
    }
    if (name === "case" || name === "logs") {
        const caseNo = number(args[1], 1)
        if ((verb === "show" || verb === "recover") && args.length === 2 && caseNo) return verb === "show" ? query({ type: "case-show", caseNo }, true) : { kind: "recover", caseNo }
        if (verb === "list") {
            const mention = args[1]?.startsWith("<@") ? commandId(args[1]) : undefined
            const userId = args[1] === "user" ? commandId(args[2]) : mention
            const cursorArg = userId ? args[args[1] === "user" ? 3 : 2] : args[1]
            const beforeCaseNo = cursorArg === undefined ? undefined : number(cursorArg, 1)
            if (args.length <= (userId ? args[1] === "user" ? 4 : 3 : 2) && (cursorArg === undefined || beforeCaseNo) && (args[1] !== "user" || userId)) return query({ type: "case-list", ...(beforeCaseNo ? { beforeCaseNo } : {}), ...(userId ? { userId } : {}) }, true)
        }
        if (name === "case" && verb === "reason" && args.length === 3 && caseNo && narrative(args[2])) return { kind: "manage", operation: { type: "case-reason", caseNo, reason: args[2]! } }
        if (name === "case" && verb === "void" && args.length === 2 && caseNo) return { kind: "manage", operation: { type: "case-void", caseNo } }
        return error
    }
    if (name === "automod") {
        if (verb === "module" && args.length === 2 && bool(args[1]) !== undefined) return settings({ automodEnabled: bool(args[1])! })
        if (verb === "mode" && args.length === 2 && ["dry-run", "enforce"].includes(args[1]!)) return settings({ automodMode: args[1] as C.ModerationSettings["automodMode"] })
        if (verb === "status" && args.length === 1) return query({ type: "settings" })
        if (verb === "list" && args.length <= 2 && (args[1] === undefined || number(args[1], 1))) return query({ type: "rule-list", page: number(args[1], 1) ?? 1 })
        const ruleName = nameValue(args[1])
        if (!ruleName) return error
        if (verb === "show" && args.length === 2) return query({ type: "rule-show", name: ruleName })
        if (verb === "delete" && args.length === 2) return { kind: "manage", operation: { type: "rule-delete", name: ruleName } }
        if ((verb === "enable" || verb === "disable") && args.length === 2) return { kind: "manage", operation: { type: "rule-update", name: ruleName, patch: { enabled: verb === "enable" } } }
        if (verb === "create" && args.length >= 4 && ["spam", "repeat", "mentions", "words", "domains", "invites"].includes(args[2]!) && ["log", "delete", "warn", "timeout"].includes(args[3]!)) {
            const type = args[2] as C.AutomodRuleType
            const patterns = args.slice(4)
            if (patterns.length > 20 || patterns.some((value) => !narrative(value, 200))) return error
            return { kind: "manage", operation: { type: "rule-create", rule: { name: ruleName, type, domainMode: "block", enabled: true, priority: 0, action: args[3] as C.AutomodAction, threshold: type === "spam" || type === "mentions" ? 5 : type === "repeat" ? 3 : 1, windowSeconds: type === "repeat" ? 30 : 10, durationSeconds: 600, patterns, channelIds: [], exemptChannelIds: [], exemptRoleIds: [] } } }
        }
        if (verb === "update" && args.length >= 4) {
            const field = args[2]
            const values = args.slice(3)
            const patch: Partial<Omit<C.AutomodRule, "name" | "type">> = {}
            if (field === "patterns") {
                const patterns = values.length === 1 && values[0] === "none" ? [] : values
                if (patterns.length > 20 || patterns.some((value) => !narrative(value, 200))) return error
                patch.patterns = patterns
            } else if (["channels", "exempt-channels", "exempt-roles"].includes(field!)) {
                const ids = commandIds(values)
                if (!ids) return error
                if (field === "channels") patch.channelIds = ids
                else if (field === "exempt-channels") patch.exemptChannelIds = ids
                else patch.exemptRoleIds = ids
            } else if (values.length === 1) {
                if (field === "action" && ["log", "delete", "warn", "timeout"].includes(values[0]!)) patch.action = values[0] as C.AutomodAction
                else if (field === "domain-mode" && ["allow", "block"].includes(values[0]!)) patch.domainMode = values[0] as "allow" | "block"
                else if (field === "priority" && /^-?\d+$/.test(values[0]!) && Number(values[0]) >= -100 && Number(values[0]) <= 100) patch.priority = Number(values[0])
                else if (field === "threshold" && number(values[0], 1, 100)) patch.threshold = number(values[0], 1, 100)!
                else if (field === "window" && number(values[0], 1, 300)) patch.windowSeconds = number(values[0], 1, 300)!
                else if (field === "duration" && duration(values[0])) patch.durationSeconds = duration(values[0])!
                else return error
            } else return error
            return { kind: "manage", operation: { type: "rule-update", name: ruleName, patch } }
        }
        return error
    }
    if (name === "security") {
        if (verb === "module" && args.length === 2 && bool(args[1]) !== undefined) return settings({ securityEnabled: bool(args[1])! })
        if (verb === "mode" && args.length === 2 && ["dry-run", "enforce"].includes(args[1]!)) return settings({ securityMode: args[1] as C.ModerationSettings["securityMode"] })
        if (verb === "status" && args.length === 1) return query({ type: "settings" })
        if (verb === "recover" && args.length === 2 && number(args[1], 1)) return { kind: "recover", caseNo: number(args[1], 1)! }
        if (verb === "recovery" && args[1] === "list" && args.length <= 3 && (args[2] === undefined || number(args[2], 1))) return query({ type: "recovery-list", page: number(args[2], 1) ?? 1 }, true)
        if (verb === "joins") {
            if (args[1] === "module" && args.length === 3 && bool(args[2]) !== undefined) return settings({ joinEnabled: bool(args[2])! })
            if (args[1] === "threshold" && args.length === 3 && number(args[2], 2, 100)) return settings({ joinThreshold: number(args[2], 2, 100)! })
            if (args[1] === "window" && args.length === 3 && number(args[2], 1, 300)) return settings({ joinWindowSeconds: number(args[2], 1, 300)! })
            if (args[1] === "raid-mode" && args.length === 3 && ["off", "defcon2"].includes(args[2]!)) return settings({ joinDefcon2: args[2] === "defcon2" })
        }
        if (verb === "honeypot" || verb === "watchlist") {
            if (args[1] === "module" && args.length === 3 && bool(args[2]) !== undefined) return verb === "honeypot" ? settings({ honeypotEnabled: bool(args[2])! }) : settings({ watchlistEnabled: bool(args[2])! })
            if (args[1] === "list" && (verb === "honeypot" ? args.length === 2 : args.length <= 3 && (args[2] === undefined || number(args[2], 1)))) return verb === "honeypot" ? query({ type: "settings" }) : query({ type: "watchlist-list", page: number(args[2], 1) ?? 1 }, true)
            const id = commandId(args[2])
            if (verb === "watchlist" && args[1] === "show" && args.length === 3 && id) return query({ type: "watchlist-show", userId: id }, true)
            if (verb === "honeypot" && (args[1] === "add" || args[1] === "remove") && args.length === 3 && id) return { kind: "honeypot", operation: args[1], channelId: id }
            if (verb === "watchlist" && (args[1] === "add" || args[1] === "update") && args.length === 4 && id && narrative(args[3])) return { kind: "manage", operation: { type: "watchlist-add", userId: id, reason: args[3]! } }
            if (verb === "watchlist" && args[1] === "remove" && args.length === 3 && id) return { kind: "manage", operation: { type: "watchlist-remove", userId: id } }
        }
    }
    if (name === "mod") {
        if (verb === "module" && args.length === 2 && bool(args[1]) !== undefined) return settings({ manualModerationEnabled: bool(args[1])! })
        if (verb === "status" && args.length === 1) return query({ type: "settings" })
        if (verb === "erase" && args.length === 2 && number(args[1], 1)) return { kind: "manage", operation: { type: "erase", caseNo: number(args[1], 1)! } }
        if (verb === "staff" && ["moderation", "cases", "automod", "security", "appeals"].includes(args[1]!) && commandIds(args.slice(2))) return settings({ staffRoleIds: { [args[1]!]: commandIds(args.slice(2))! } })
        if (verb === "purge" && args.length >= 3 && args.length <= 4 && number(args[1], 1, 100)) {
            const userId = args.length === 4 ? commandId(args[2]) : undefined
            const reason = narrative(args.at(-1))
            if (reason && (args.length === 3 || userId)) return { kind: "purge", count: number(args[1], 1, 100)!, reason, ...(userId ? { userId } : {}) }
        }
        if (verb === "slowmode" && args.length === 4 && commandId(args[1]) && number(args[2], 0, 21600) !== undefined && narrative(args[3])) return { kind: "action", action: { type: "slowmode", channelId: commandId(args[1])!, slowmodeSeconds: number(args[2], 0, 21600)!, reason: args[3]! } }
    }
    if (name === "mod" || name === "security") {
        let linkedCaseNo: number | undefined
        if (args.at(-2) === "case" && number(args.at(-1), 1)) { linkedCaseNo = number(args.pop(), 1); args.pop() }
        const selected = verb as C.ModerationActionType
        const supported = name === "mod" ? ["warn", "kick", "ban", "unban", "timeout", "untimeout"] : ["quarantine", "release", "lock", "unlock"]
        if (!supported.includes(selected)) return error
        const id = commandId(args[1])
        const needsDuration = selected === "timeout" || selected === "quarantine" || (selected === "ban" && args.length === 4)
        const seconds = needsDuration ? duration(args[2], selected === "ban" ? 63072000 : 31536000) : undefined
        const reason = narrative(args[needsDuration ? 3 : 2])
        if (!id || !reason || args.length !== (needsDuration ? 4 : 3) || (needsDuration && !seconds) || (selected === "ban" && seconds !== undefined && seconds < 60)) return error
        return { kind: "action", action: { type: selected, reason, ...(["lock", "unlock"].includes(selected) ? { channelId: id } : { targetId: id }), ...(seconds ? { durationSeconds: seconds } : {}), ...(linkedCaseNo ? { linkedCaseNo } : {}) } }
    }
    return error
}

export function safetyGateClass(name: SafetyName, command: SafetyParse): "staff" | "critical" | "appeal" {
    if (name === "appeal") return "appeal"
    if (name === "defcon" || ("kind" in command && (command.kind === "recover"
        || (command.kind === "action" && ["unlock", "release", "untimeout", "unban"].includes(command.action.type))
        || (command.kind === "query" && (command.operation.type === "settings" || command.operation.type === "recovery-list"))
        || (command.kind === "manage" && command.operation.type === "settings" && Object.values(command.operation.patch).some((value) => value === false))))) return "critical"
    return "staff"
}
