import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { automodRuleTypes } from "./moderation-store.ts"

export const safetyNames = ["mod", "logs", "automod", "security", "defcon", "appeal"] as const
export type SafetyName = typeof safetyNames[number]
/** A list that pages: Its words after the command name, and whether a final next asks for the page after the last one shown */
export type SafetyPage = { list: string, next: boolean }
export type SafetyCommand =
    | { kind: "manage", operation: C.ModerationManageOperation }
    | { kind: "query", operation: C.ModerationQueryOperation, private: boolean, page?: SafetyPage }
    | { kind: "action", action: C.ModerationActionInput }
    | { kind: "purge", count: number, userId?: string, reason: string }
    | { kind: "recover", caseNo: number }
    | { kind: "honeypot", operation: "add" | "remove", channelId: string }
    | { kind: "member-appeal", operation: C.AppealMemberRequest["operation"], page?: SafetyPage }
    | { kind: "staff-appeal", operation: C.AppealStaffRequest["operation"], page?: SafetyPage }
    | { kind: "help", name: SafetyName }
export type SafetyParse = SafetyCommand | { error: string }

const number = (value: string | undefined, min: number, max = Number.MAX_SAFE_INTEGER) => value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : undefined
export function commandId(value: string | undefined) {
    const candidate = value?.match(/^(?:<@!?|<@&|<#)(\d+)>$/)?.[1] ?? value
    return snowflakes.isValid(candidate) && candidate !== "0" ? candidate : undefined
}
/** Text at the end of a command, such as a reason, which needs no quotes. A quoted part counts as one word */
export const freeText = (args: readonly string[], from: number) => args.slice(from).join(" ")
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
const query = (operation: C.ModerationQueryOperation, privateReply = false, page?: SafetyPage): SafetyCommand => ({ kind: "query", operation, private: privateReply, ...(page ? { page } : {}) })
/** A list takes only an optional final next, so other trailing words leave it unparsed */
const paging = (list: string, rest: readonly string[]): SafetyPage | undefined => rest.length === 0 || rest.length === 1 && rest[0] === "next" ? { list, next: rest.length === 1 } : undefined
const settings = (patch: Extract<C.ModerationManageOperation, { type: "settings" }>["patch"]): SafetyCommand => ({ kind: "manage", operation: { type: "settings", patch } })
const bool = (value: string | undefined) => value === "on" ? true : value === "off" ? false : undefined
// A new rule's threshold and window: Counts of messages, mentions or links within the window, or one mention count per message
export function ruleDefaults(type: C.AutomodRuleType) {
    return type === "spam" || type === "mentions" ? { threshold: 5, windowSeconds: 10 } : type === "repeat" ? { threshold: 3, windowSeconds: 30 }
        : type === "mention-rate" ? { threshold: 10, windowSeconds: 30 } : type === "link-rate" ? { threshold: 6, windowSeconds: 30 } : { threshold: 1, windowSeconds: 10 }
}

export function safetyHelp(name: SafetyName) {
    const help = {
        mod: ["!mod warn|kick|ban|unban|untimeout @user [case <linked-case>] <reason>", "!mod timeout @user 10m [case <linked-case>] <reason> | ban @user 1d [case <linked-case>] <reason>", "!mod purge <1-100> [@user] <reason>", "!mod slowmode #channel <0-21600 seconds> <reason>",
            "!mod list [@user or user ID] [next] | show <case> | recover <case>", "!mod reason <case> <new reason> | void <case>", "!mod staff moderation|cases|automod|security|appeals @role...|none",
            "!mod private-role @role|none (owner): The role that may view private cases on the website", "!mod module on|off | erase <case> | status", "Reasons need no quotes. Case details are delivered privately after fresh staff authorization"],
        logs: ["!logs channel #channel|off | status | list [next] | show <case> | recover <case>", "!logs metadata help | events list | delivery show <record>", "Private Owner/Admin: !logs counters", "Delivery outcomes are durable. Unknown deliveries are never automatically replayed"],
        automod: ['!automod create <name> spam|repeat|mentions|mention-rate|link-rate|words|domains|invites|deceptive-links log|delete|warn|timeout ["pattern"...]', "!automod list [next] | show <name> | enable|disable|delete <name>", '!automod update <name> action|threshold|window|duration|priority|domain-mode <value>', '!automod update <name> patterns "pattern"...|none', "!automod update <name> channels|exempt-channels|exempt-roles <mentions or IDs>...|all", "!automod module on|off | mode dry-run|enforce | bots on|off | status"],
        security: ["!security quarantine @user 10m [case <linked-case>] <reason> | release @user [case <linked-case>] <reason>", "!security lock|unlock #channel [case <linked-case>] <reason>", "!security watchlist add|update @user <reason> | show|remove @user | list [next]", "!security honeypot add|remove #channel | list | module on|off", "!security joins threshold <2-100> | window <1-300 seconds> | module on|off | raid-mode off|defcon2", "!security watchlist module on|off", "!security recovery list [next] | recover <case>", "!security module on|off | mode dry-run|enforce | status"],
        defcon: ["!defcon set 1|2|3 | status | diagnose", "3: Public commands, 2: Staff commands and private appeals, 1: Critical administrator recovery controls", "DEFCON does not change channel permissions"],
        appeal: ["Private DM: !appeal cases [next] | submit <case> <text> | list [next] | show|withdraw <appeal>", "Only your own cases and appeals are visible",
            "Staff: !appeal review [next] | review <appeal> | approve|reject <appeal> <reason> | module on|off | status", "Review details are private. Decisions do not reverse sanctions"],
    }
    return help[name].join("\n")
}

export function parseSafetyCommand(name: SafetyName, args: readonly string[]): SafetyParse {
    const error = { error: `Check quoting and values. Use !${name} help for examples` }
    if (args.length === 0 || (args.length === 1 && args[0] === "help")) return { kind: "help", name }
    const verb = args[0]?.toLowerCase()
    if (name === "appeal") {
        // Members use cases, submit, list, show and withdraw in a DM. Staff use review, approve, reject, module and status
        const page = verb === "cases" || verb === "list" || verb === "review" ? paging(verb, args.slice(1)) : undefined
        if (page) return verb === "review" ? { kind: "staff-appeal", operation: { type: "list" }, page } : { kind: "member-appeal", operation: { type: verb === "cases" ? "cases" : "list" }, page }
        const no = number(args[1], 1)
        if (verb === "submit" && no && narrative(freeText(args, 2), 2000)) return { kind: "member-appeal", operation: { type: "submit", caseNo: no, text: freeText(args, 2) } }
        if ((verb === "show" || verb === "withdraw") && args.length === 2 && no) return { kind: "member-appeal", operation: { type: verb, appealNo: no } }
        if (verb === "review" && args.length === 2 && no) return { kind: "staff-appeal", operation: { type: "show", appealNo: no } }
        if ((verb === "approve" || verb === "reject") && no && narrative(freeText(args, 2))) return { kind: "staff-appeal", operation: { type: "decide", appealNo: no, decision: verb === "approve" ? "accepted" : "rejected", reason: freeText(args, 2) } }
        if (verb === "module" && args.length === 2 && bool(args[1]) !== undefined) return settings({ appealsEnabled: bool(args[1])! })
        if (verb === "status" && args.length === 1) return query({ type: "settings" })
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
    if (name === "mod" || name === "logs") {
        const caseNo = number(args[1], 1)
        if ((verb === "show" || verb === "recover") && args.length === 2 && caseNo) return verb === "show" ? query({ type: "case-show", caseNo }, true) : { kind: "recover", caseNo }
        // !mod list takes an optional member, and !logs list lists every case
        const userId = name === "mod" ? commandId(args[1]) : undefined
        const page = verb === "list" ? paging(userId ? `list ${userId}` : "list", args.slice(userId ? 2 : 1)) : undefined
        if (page) return query({ type: "case-list", ...(userId ? { userId } : {}) }, true, page)
        if (name === "logs") return error
        if (verb === "reason" && caseNo && narrative(freeText(args, 2))) return { kind: "manage", operation: { type: "case-reason", caseNo, reason: freeText(args, 2) } }
        if (verb === "void" && args.length === 2 && caseNo) return { kind: "manage", operation: { type: "case-void", caseNo } }
    }
    if (name === "automod") {
        if (verb === "module" && args.length === 2 && bool(args[1]) !== undefined) return settings({ automodEnabled: bool(args[1])! })
        if (verb === "mode" && args.length === 2 && ["dry-run", "enforce"].includes(args[1]!)) return settings({ automodMode: args[1] as C.ModerationSettings["automodMode"] })
        if (verb === "bots" && args.length === 2 && bool(args[1]) !== undefined) return settings({ automodBotMessagesEnabled: bool(args[1])! })
        if (verb === "status" && args.length === 1) return query({ type: "settings" })
        const page = verb === "list" ? paging("list", args.slice(1)) : undefined
        if (page) return query({ type: "rule-list" }, false, page)
        const ruleName = nameValue(args[1])
        if (!ruleName) return error
        if (verb === "show" && args.length === 2) return query({ type: "rule-show", name: ruleName })
        if (verb === "delete" && args.length === 2) return { kind: "manage", operation: { type: "rule-delete", name: ruleName } }
        if ((verb === "enable" || verb === "disable") && args.length === 2) return { kind: "manage", operation: { type: "rule-update", name: ruleName, patch: { enabled: verb === "enable" } } }
        if (verb === "create" && args.length >= 4 && (automodRuleTypes as readonly string[]).includes(args[2]!) && ["log", "delete", "warn", "timeout"].includes(args[3]!)) {
            const type = args[2] as C.AutomodRuleType
            const patterns = args.slice(4)
            if (patterns.length > 20 || patterns.some((value) => !narrative(value, 200))) return error
            return { kind: "manage", operation: { type: "rule-create", rule: { name: ruleName, type, domainMode: "block", enabled: true, priority: 0, action: args[3] as C.AutomodAction, ...ruleDefaults(type), durationSeconds: 600, patterns, channelIds: [], exemptChannelIds: [], exemptRoleIds: [] } } }
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
        const page = (verb === "recovery" || verb === "watchlist") && args[1] === "list" ? paging(`${verb} list`, args.slice(2)) : undefined
        if (page) return query({ type: verb === "recovery" ? "recovery-list" : "watchlist-list" }, true, page)
        if (verb === "joins") {
            if (args[1] === "module" && args.length === 3 && bool(args[2]) !== undefined) return settings({ joinEnabled: bool(args[2])! })
            if (args[1] === "threshold" && args.length === 3 && number(args[2], 2, 100)) return settings({ joinThreshold: number(args[2], 2, 100)! })
            if (args[1] === "window" && args.length === 3 && number(args[2], 1, 300)) return settings({ joinWindowSeconds: number(args[2], 1, 300)! })
            if (args[1] === "raid-mode" && args.length === 3 && ["off", "defcon2"].includes(args[2]!)) return settings({ joinDefcon2: args[2] === "defcon2" })
        }
        if (verb === "honeypot" || verb === "watchlist") {
            if (args[1] === "module" && args.length === 3 && bool(args[2]) !== undefined) return verb === "honeypot" ? settings({ honeypotEnabled: bool(args[2])! }) : settings({ watchlistEnabled: bool(args[2])! })
            if (verb === "honeypot" && args[1] === "list" && args.length === 2) return query({ type: "settings" })
            const id = commandId(args[2])
            if (verb === "watchlist" && args[1] === "show" && args.length === 3 && id) return query({ type: "watchlist-show", userId: id }, true)
            if (verb === "honeypot" && (args[1] === "add" || args[1] === "remove") && args.length === 3 && id) return { kind: "honeypot", operation: args[1], channelId: id }
            if (verb === "watchlist" && (args[1] === "add" || args[1] === "update") && id && narrative(freeText(args, 3))) return { kind: "manage", operation: { type: "watchlist-add", userId: id, reason: freeText(args, 3) } }
            if (verb === "watchlist" && args[1] === "remove" && args.length === 3 && id) return { kind: "manage", operation: { type: "watchlist-remove", userId: id } }
        }
    }
    if (name === "mod") {
        if (verb === "module" && args.length === 2 && bool(args[1]) !== undefined) return settings({ manualModerationEnabled: bool(args[1])! })
        if (verb === "status" && args.length === 1) return query({ type: "settings" })
        if (verb === "erase" && args.length === 2 && number(args[1], 1)) return { kind: "manage", operation: { type: "erase", caseNo: number(args[1], 1)! } }
        if (verb === "staff" && ["moderation", "cases", "automod", "security", "appeals"].includes(args[1]!) && commandIds(args.slice(2))) return settings({ staffRoleIds: { [args[1]!]: commandIds(args.slice(2))! } })
        if (verb === "private-role" && args.length === 2 && (args[1] === "none" || commandId(args[1]))) return { kind: "manage", operation: { type: "private-role", roleId: args[1] === "none" ? null : commandId(args[1])! } }
        if (verb === "purge" && number(args[1], 1, 100)) {
            // The word after the count names a member only when a reason follows it
            const userId = args.length > 3 ? commandId(args[2]) : undefined
            const reason = narrative(freeText(args, userId ? 3 : 2))
            if (reason) return { kind: "purge", count: number(args[1], 1, 100)!, reason, ...(userId ? { userId } : {}) }
        }
        if (verb === "slowmode" && commandId(args[1]) && number(args[2], 0, 21600) !== undefined && narrative(freeText(args, 3))) return { kind: "action", action: { type: "slowmode", channelId: commandId(args[1])!, slowmodeSeconds: number(args[2], 0, 21600)!, reason: freeText(args, 3) } }
    }
    if (name === "mod" || name === "security") {
        const selected = verb as C.ModerationActionType
        const supported = name === "mod" ? ["warn", "kick", "ban", "unban", "timeout", "untimeout"] : ["quarantine", "release", "lock", "unlock"]
        if (!supported.includes(selected)) return error
        const id = commandId(args[1])
        // A ban is temporary when the word after the member is a duration
        const needsDuration = selected === "timeout" || selected === "quarantine" || (selected === "ban" && /^\d+[smhd]$/.test(args[2] ?? ""))
        const seconds = needsDuration ? duration(args[2], selected === "ban" ? 63072000 : 31536000) : undefined
        // case and a number before the reason link an earlier case
        const from = needsDuration ? 3 : 2
        const linkedCaseNo = args[from] === "case" ? number(args[from + 1], 1) : undefined
        const reason = narrative(freeText(args, linkedCaseNo ? from + 2 : from))
        if (!id || !reason || (needsDuration && !seconds) || (selected === "ban" && seconds !== undefined && seconds < 60)) return error
        return { kind: "action", action: { type: selected, reason, ...(["lock", "unlock"].includes(selected) ? { channelId: id } : { targetId: id }), ...(seconds ? { durationSeconds: seconds } : {}), ...(linkedCaseNo ? { linkedCaseNo } : {}) } }
    }
    return error
}

export function safetyGateClass(name: SafetyName, command: SafetyParse): "staff" | "critical" | "appeal" {
    // A member's own appeal forms, appeal help and a malformed !appeal use the appeal class. Staff review is staff work
    if (name === "appeal" && (!("kind" in command) || command.kind === "member-appeal" || command.kind === "help")) return "appeal"
    if (name === "defcon" || ("kind" in command && (command.kind === "recover"
        || (command.kind === "action" && ["unlock", "release", "untimeout", "unban"].includes(command.action.type))
        || (command.kind === "query" && (command.operation.type === "settings" || command.operation.type === "recovery-list"))
        || (command.kind === "manage" && command.operation.type === "settings" && Object.values(command.operation.patch).some((value) => value === false))))) return "critical"
    return "staff"
}
