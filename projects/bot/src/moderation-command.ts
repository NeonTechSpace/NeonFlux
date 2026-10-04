import { hasText, isName } from "@neonflux/contracts/common"
import { AutomodRuleType } from "@neonflux/contracts/moderation"
import type { AppealMemberRequest, AppealStaffRequest } from "@neonflux/contracts/appeal"
import type {
    AutomodAction,
    AutomodRule,
    ModerationActionInput,
    ModerationActionType,
    ModerationManageOperation,
    ModerationQueryOperation,
    ModerationSettings,
} from "@neonflux/contracts/moderation"
import { commands } from "@neontechspace/fluxerly/effect"
import type { Types } from "effect"
import { argument, durationSeconds, freeText, wholeNumber } from "./command-arguments.ts"
import type { SettingsView } from "./moderation-format.ts"

export const safetyNames = ["mod", "logs", "automod", "security", "defcon", "appeal"] as const
export type SafetyName = (typeof safetyNames)[number]
/** A list that pages: Its words after the command name, and whether a final next asks for the page after the last one shown */
export type SafetyPage = { list: string; next: boolean }
export type SafetyCommand =
    | { kind: "manage"; operation: ModerationManageOperation }
    /** view names the settings a status reply shows when they are not the command name's own */
    | { kind: "query"; operation: ModerationQueryOperation; private: boolean; page?: SafetyPage; view?: SettingsView }
    | { kind: "action"; action: ModerationActionInput }
    /** Without userId a purge covers every author. confirmed means its last word was "confirm", and reason is what comes before it */
    | { kind: "purge"; count: number; userId?: string; reason: string; confirmed: boolean }
    | { kind: "recover"; caseNo: number }
    /** A case's reason changes and voiding, paged from the case !mod show reads */
    | { kind: "history"; caseNo: number; page: SafetyPage }
    | { kind: "honeypot"; operation: "add" | "remove"; channelId: string }
    | { kind: "member-appeal"; operation: AppealMemberRequest["operation"]; page?: SafetyPage }
    | { kind: "staff-appeal"; operation: AppealStaffRequest["operation"]; page?: SafetyPage }
    | { kind: "help"; name: SafetyName }
export type SafetyParse = SafetyCommand | { error: string }

const idList = (values: readonly string[], kind: typeof argument.role | typeof argument.channel) => {
    if (values.length === 1 && ["all", "none"].includes(values[0]!)) return []
    const ids = values.map((value) => commands.parseArgument(value, kind))
    return ids.length > 0 && ids.length <= 20 && ids.every((value) => value !== undefined)
        ? ([...new Set(ids)] as string[])
        : undefined
}
const narrative = (value: string | undefined, max = 512) =>
    value !== undefined && value.length <= max && hasText(value) ? value : undefined
const nameValue = (value: string | undefined) =>
    value && isName(value.toLowerCase()) ? value.toLowerCase() : undefined
const query = (
    operation: ModerationQueryOperation,
    privateReply = false,
    page?: SafetyPage,
    view?: SettingsView,
): SafetyCommand => ({
    kind: "query",
    operation,
    private: privateReply,
    ...(page ? { page } : {}),
    ...(view ? { view } : {}),
})
/** A list takes only an optional final next, so other trailing words leave it unparsed */
const paging = (list: string, rest: readonly string[]): SafetyPage | undefined =>
    rest.length === 0 || (rest.length === 1 && rest[0] === "next") ? { list, next: rest.length === 1 } : undefined
const settings = (patch: Extract<ModerationManageOperation, { type: "settings" }>["patch"]): SafetyCommand => ({
    kind: "manage",
    operation: { type: "settings", patch },
})
const bool = (value: string | undefined) => (value === "on" ? true : value === "off" ? false : undefined)
// A new rule's threshold and window: Counts of messages within the window, or one mention count per message
function ruleDefaults(type: AutomodRuleType) {
    return type === "spam" || type === "mentions"
        ? { threshold: 5, windowSeconds: 10 }
        : type === "repeat"
          ? { threshold: 3, windowSeconds: 30 }
          : { threshold: 1, windowSeconds: 10 }
}

export function safetyHelp(name: SafetyName) {
    const help = {
        mod: [
            "!mod warn|kick|ban|unban @user <reason>: Act on a member. Reasons need no quotes",
            "!mod timeout @user 10m <reason>: Time out a member for a while",
            "!mod ban @user 1d <reason>: Ban a member for a while",
            "!mod purge <1-100> @user <reason>: Delete recent messages of a member. Without @user, you are asked to confirm a purge of everyone",
            "!mod list [@user] [next]: Cases, newest first",
            "!mod show <case>: One case, sent to you by DM",
            "!mod staff moderation|cases|automod|security|appeals @role|none: The staff roles of each area",
            "!mod module on|off: Turn manual moderation on or off",
        ],
        logs: [
            "!logs channel #channel|off: Where staff logs are posted",
            "!logs status: The staff log settings",
            "!logs list [next]: Recent staff log posts",
            "!logs show <case>: One case's log post",
            "!logs recover <case>: Same as !mod recover, checks the action of a case that was not confirmed",
            "!logs counters: Log counts, sent by DM to the owner or Administrators",
            "!logs metadata help: Metadata logs of server changes",
        ],
        automod: [
            '!automod create <name> <type> log|delete|warn|timeout ["pattern"...]: Add a rule',
            "Types: spam, repeat, mentions, words, domains, invites",
            "!automod list [next]: The rules",
            "!automod show <name>: One rule",
            "!automod enable|disable|delete <name>: Turn a rule on or off, or delete it",
            "!automod mode dry-run|enforce: Only record what rules catch, or act on it",
            "!automod module on|off: Turn automod on or off",
        ],
        security: [
            "!security quarantine @user 10m <reason>: Time out a suspicious member",
            "!security release @user <reason>: End a quarantine",
            "!security lock|unlock #channel <reason>: Stop or allow posting in a channel",
            "!security joins threshold <2-100> | window <1-300>: How many joins in how many seconds count as a raid",
            "!security watchlist add @user <reason>: Flag a member when they join",
            "!security mode dry-run|enforce: Only record what protections catch, or act on it",
            "!security module on|off: Turn security on or off",
        ],
        defcon: [
            "!defcon status: The current lockdown level",
            "!defcon set 3: Normal",
            "!defcon set 2: Staff commands and private appeals only",
            "!defcon set 1: Only owner and Administrator recovery",
            "!defcon diagnose: The level and which protections are on",
        ],
        appeal: [
            "!appeal cases [next]: Your cases, in a DM",
            "!appeal submit <case> <text>: Appeal a case, in a DM",
            "!appeal list [next]: Your appeals, in a DM",
            "!appeal show|withdraw <appeal>: Read or withdraw an appeal, in a DM",
            "!appeal review [next] | review <appeal>: All appeals with their status, newest first",
            "!appeal approve|reject <appeal> <reason>: Decide an appeal. Approving does not undo the action",
            "!appeal module on|off: Turn appeals on or off",
            "!appeal status: Whether appeals are on and how many wait",
        ],
    }
    return [...help[name], ...(name in safetyHelpAll ? [`Send !${name} help all for the other commands`] : [])].join(
        "\n",
    )
}
/** The forms !mod, !automod and !security help leave out, listed by help all */
export const safetyHelpAll = {
    mod: [
        "!mod untimeout @user <reason>: End a timeout",
        "!mod slowmode #channel <0-21600> <reason>: Seconds between messages, 0 to clear",
        "!mod <action> @user case <number> <reason>: Link an action to an earlier case",
        "!mod reason <case> <new reason>: Correct a case's reason",
        "!mod void <case>: Void a warning",
        "!mod history <case> [next]: A case's edits, sent to you by DM",
        "!mod recover <case>: Check an action that was not confirmed",
        "!mod erase <case>: Erase a case's text, for the server owner",
        "!mod status: Whether moderation is on and its staff roles",
    ],
    automod: [
        "!automod update <name> action|threshold|window|duration|priority|domain-mode <value>: Change a rule",
        '!automod update <name> patterns "pattern"...|none: Replace its words or domains',
        "!automod update <name> channels|exempt-channels|exempt-roles <mentions or IDs>...|all: Where it applies and who it skips",
        "!automod status: Whether automod is on and its mode",
    ],
    security: [
        "!security joins module on|off: Turn raid detection on or off",
        "!security joins raid-mode off|defcon2: Raise the lockdown level to 2 during a raid",
        "!security watchlist update @user <reason> | show|remove @user | list [next]: Manage the watchlist",
        "!security watchlist module on|off: Turn the watchlist on or off",
        "!security honeypot add|remove #channel | list: Trap channels that catch anyone who posts there",
        "!security honeypot module on|off: Turn trap channels on or off",
        "!security recovery list [next]: NeonFlux's open timeouts, locks and bans, and any not confirmed yet",
        "!security recover <case>: Check an action that was not confirmed",
        "!security status: The security settings",
        "Add case <number> before a reason to link an earlier case",
    ],
} as const satisfies Partial<Record<SafetyName, readonly string[]>>

export function parseSafetyCommand(name: SafetyName, args: readonly string[]): SafetyParse {
    const error = { error: `Check quoting and values. Use !${name} help for examples` }
    if (args.length === 0 || (args.length === 1 && args[0] === "help")) return { kind: "help", name }
    const verb = args[0]?.toLowerCase()
    if (name === "appeal") {
        // Members use cases, submit, list, show and withdraw in a DM. Staff use review, approve, reject, module and status
        const page = verb === "cases" || verb === "list" || verb === "review" ? paging(verb, args.slice(1)) : undefined
        if (page)
            return verb === "review"
                ? { kind: "staff-appeal", operation: { type: "list" }, page }
                : { kind: "member-appeal", operation: { type: verb === "cases" ? "cases" : "list" }, page }
        const no = commands.parseArgument(args[1], argument.positive)
        if (verb === "submit" && no && narrative(freeText(args, 2), 2000))
            return { kind: "member-appeal", operation: { type: "submit", caseNo: no, text: freeText(args, 2) } }
        if ((verb === "show" || verb === "withdraw") && args.length === 2 && no)
            return { kind: "member-appeal", operation: { type: verb, appealNo: no } }
        if (verb === "review" && args.length === 2 && no)
            return { kind: "staff-appeal", operation: { type: "show", appealNo: no } }
        if ((verb === "approve" || verb === "reject") && no && narrative(freeText(args, 2)))
            return {
                kind: "staff-appeal",
                operation: {
                    type: "decide",
                    appealNo: no,
                    decision: verb === "approve" ? "accepted" : "rejected",
                    reason: freeText(args, 2),
                },
            }
        if (verb === "module" && args.length === 2 && bool(args[1]) !== undefined)
            return settings({ appealsEnabled: bool(args[1])! })
        if (verb === "status" && args.length === 1) return query({ type: "settings", appeals: true })
        return error
    }
    if (name === "defcon") {
        if (verb === "status" || verb === "diagnose")
            return args.length === 1
                ? query({ type: "settings" }, false, undefined, verb === "diagnose" ? "diagnose" : undefined)
                : error
        const level = commands.parseArgument(args[1], { type: "integer", min: 1, max: 3 })
        return verb === "set" && args.length === 2 && level ? settings({ defcon: level as 1 | 2 | 3 }) : error
    }
    if (name === "logs") {
        if (verb === "channel" && args.length === 2) {
            const channelId = args[1] === "off" ? null : commands.parseArgument(args[1], argument.channel)
            if (channelId !== undefined) return settings({ logChannelId: channelId })
        }
        if (verb === "status" && args.length === 1) return query({ type: "settings" })
    }
    if (name === "mod" || name === "logs") {
        const caseNo = commands.parseArgument(args[1], argument.positive)
        if ((verb === "show" || verb === "recover") && args.length === 2 && caseNo)
            return verb === "show" ? query({ type: "case-show", caseNo }, true) : { kind: "recover", caseNo }
        const history =
            name === "mod" && verb === "history" && caseNo ? paging(`history ${caseNo}`, args.slice(2)) : undefined
        if (history) return { kind: "history", caseNo: caseNo!, page: history }
        // !mod list takes an optional member, and !logs list lists every case
        const userId = name === "mod" ? commands.parseArgument(args[1], argument.user) : undefined
        const page =
            verb === "list" ? paging(userId ? `list ${userId}` : "list", args.slice(userId ? 2 : 1)) : undefined
        if (page) return query({ type: "case-list", ...(userId ? { userId } : {}) }, true, page)
        if (name === "logs") return error
        if (verb === "reason" && caseNo && narrative(freeText(args, 2)))
            return { kind: "manage", operation: { type: "case-reason", caseNo, reason: freeText(args, 2) } }
        if (verb === "void" && args.length === 2 && caseNo)
            return { kind: "manage", operation: { type: "case-void", caseNo } }
    }
    if (name === "automod") {
        if (verb === "module" && args.length === 2 && bool(args[1]) !== undefined)
            return settings({ automodEnabled: bool(args[1])! })
        if (verb === "mode" && args.length === 2 && ["dry-run", "enforce"].includes(args[1]!))
            return settings({ automodMode: args[1] as ModerationSettings["automodMode"] })
        if (verb === "status" && args.length === 1) return query({ type: "settings" })
        const page = verb === "list" ? paging("list", args.slice(1)) : undefined
        if (page) return query({ type: "rule-list" }, false, page)
        const ruleName = nameValue(args[1])
        if (!ruleName) return error
        if (verb === "show" && args.length === 2) return query({ type: "rule-show", name: ruleName })
        if (verb === "delete" && args.length === 2)
            return { kind: "manage", operation: { type: "rule-delete", name: ruleName } }
        if ((verb === "enable" || verb === "disable") && args.length === 2)
            return {
                kind: "manage",
                operation: { type: "rule-update", name: ruleName, patch: { enabled: verb === "enable" } },
            }
        if (
            verb === "create" &&
            args.length >= 4 &&
            (AutomodRuleType.literals as readonly string[]).includes(args[2]!) &&
            ["log", "delete", "warn", "timeout"].includes(args[3]!)
        ) {
            const type = args[2] as AutomodRuleType
            const patterns = args.slice(4)
            if (patterns.length > 20 || patterns.some((value) => !narrative(value, 200))) return error
            return {
                kind: "manage",
                operation: {
                    type: "rule-create",
                    rule: {
                        name: ruleName,
                        type,
                        domainMode: "block",
                        enabled: true,
                        priority: 0,
                        action: args[3] as AutomodAction,
                        ...ruleDefaults(type),
                        durationSeconds: 600,
                        patterns,
                        channelIds: [],
                        exemptChannelIds: [],
                        exemptRoleIds: [],
                    },
                },
            }
        }
        if (verb === "update" && args.length >= 4) {
            const field = args[2]
            const values = args.slice(3)
            const patch: Types.Mutable<Partial<Omit<AutomodRule, "name" | "type">>> = {}
            if (field === "patterns") {
                const patterns = values.length === 1 && values[0] === "none" ? [] : values
                if (patterns.length > 20 || patterns.some((value) => !narrative(value, 200))) return error
                patch.patterns = patterns
            } else if (["channels", "exempt-channels", "exempt-roles"].includes(field!)) {
                const ids = idList(values, field === "exempt-roles" ? argument.role : argument.channel)
                if (!ids) return error
                if (field === "channels") patch.channelIds = ids
                else if (field === "exempt-channels") patch.exemptChannelIds = ids
                else patch.exemptRoleIds = ids
            } else if (values.length === 1) {
                if (field === "action" && ["log", "delete", "warn", "timeout"].includes(values[0]!))
                    patch.action = values[0] as AutomodAction
                else if (field === "domain-mode" && ["allow", "block"].includes(values[0]!))
                    patch.domainMode = values[0] as "allow" | "block"
                else if (field === "priority" || field === "threshold" || field === "window") {
                    const [min, max] = field === "priority" ? [-100, 100] : field === "threshold" ? [1, 100] : [1, 300]
                    const count = wholeNumber(values[0], min, max)
                    if (count === undefined) return error
                    if (field === "priority") patch.priority = count
                    else if (field === "threshold") patch.threshold = count
                    else patch.windowSeconds = count
                } else if (field === "duration" && durationSeconds(values[0], 1, 31536000))
                    patch.durationSeconds = durationSeconds(values[0], 1, 31536000)!
                else return error
            } else return error
            return { kind: "manage", operation: { type: "rule-update", name: ruleName, patch } }
        }
        return error
    }
    if (name === "security") {
        if (verb === "module" && args.length === 2 && bool(args[1]) !== undefined)
            return settings({ securityEnabled: bool(args[1])! })
        if (verb === "mode" && args.length === 2 && ["dry-run", "enforce"].includes(args[1]!))
            return settings({ securityMode: args[1] as ModerationSettings["securityMode"] })
        if (verb === "status" && args.length === 1) return query({ type: "settings" })
        const recoverNo =
            verb === "recover" && args.length === 2 ? commands.parseArgument(args[1], argument.positive) : undefined
        if (recoverNo) return { kind: "recover", caseNo: recoverNo }
        const page =
            (verb === "recovery" || verb === "watchlist") && args[1] === "list"
                ? paging(`${verb} list`, args.slice(2))
                : undefined
        if (page) return query({ type: verb === "recovery" ? "recovery-list" : "watchlist-list" }, true, page)
        if (verb === "joins") {
            if (args[1] === "module" && args.length === 3 && bool(args[2]) !== undefined)
                return settings({ joinEnabled: bool(args[2])! })
            const joinCount =
                args.length === 3 && (args[1] === "threshold" || args[1] === "window")
                    ? commands.parseArgument(args[2], {
                          type: "integer",
                          min: args[1] === "threshold" ? 2 : 1,
                          max: args[1] === "threshold" ? 100 : 300,
                      })
                    : undefined
            if (joinCount)
                return settings(
                    args[1] === "threshold" ? { joinThreshold: joinCount } : { joinWindowSeconds: joinCount },
                )
            if (args[1] === "raid-mode" && args.length === 3 && ["off", "defcon2"].includes(args[2]!))
                return settings({ joinDefcon2: args[2] === "defcon2" })
        }
        if (verb === "honeypot" || verb === "watchlist") {
            if (args[1] === "module" && args.length === 3 && bool(args[2]) !== undefined)
                return verb === "honeypot"
                    ? settings({ honeypotEnabled: bool(args[2])! })
                    : settings({ watchlistEnabled: bool(args[2])! })
            if (verb === "honeypot" && args[1] === "list" && args.length === 2)
                return query({ type: "settings" }, false, undefined, "honeypots")
            const id = commands.parseArgument(args[2], verb === "honeypot" ? argument.channel : argument.user)
            if (verb === "watchlist" && args[1] === "show" && args.length === 3 && id)
                return query({ type: "watchlist-show", userId: id }, true)
            if (verb === "honeypot" && (args[1] === "add" || args[1] === "remove") && args.length === 3 && id)
                return { kind: "honeypot", operation: args[1], channelId: id }
            if (
                verb === "watchlist" &&
                (args[1] === "add" || args[1] === "update") &&
                id &&
                narrative(freeText(args, 3))
            )
                return { kind: "manage", operation: { type: "watchlist-add", userId: id, reason: freeText(args, 3) } }
            if (verb === "watchlist" && args[1] === "remove" && args.length === 3 && id)
                return { kind: "manage", operation: { type: "watchlist-remove", userId: id } }
        }
    }
    if (name === "mod") {
        if (verb === "module" && args.length === 2 && bool(args[1]) !== undefined)
            return settings({ manualModerationEnabled: bool(args[1])! })
        if (verb === "status" && args.length === 1) return query({ type: "settings" })
        const eraseNo =
            verb === "erase" && args.length === 2 ? commands.parseArgument(args[1], argument.positive) : undefined
        if (eraseNo) return { kind: "manage", operation: { type: "erase", caseNo: eraseNo } }
        const staffRoleIds = verb === "staff" ? idList(args.slice(2), argument.role) : undefined
        if (staffRoleIds && ["moderation", "cases", "automod", "security", "appeals"].includes(args[1]!))
            return settings({ staffRoleIds: { [args[1]!]: staffRoleIds } })
        const purgeCount =
            verb === "purge" ? commands.parseArgument(args[1], { type: "integer", min: 1, max: 100 }) : undefined
        if (purgeCount) {
            // A member right after the count is always the filter, and it needs a reason like any other purge. Any other text is the
            // reason of a purge of everyone, which only runs when its last word is "confirm" after a matching preview
            const userId = commands.parseArgument(args[2], argument.user)
            if (userId) {
                const reason = narrative(freeText(args, 3))
                if (reason) return { kind: "purge", count: purgeCount, reason, userId, confirmed: false }
            } else {
                const confirmed = args.length > 2 && args.at(-1)!.toLowerCase() === "confirm"
                const reason = narrative(freeText(confirmed ? args.slice(0, -1) : args, 2))
                if (reason) return { kind: "purge", count: purgeCount, reason, confirmed }
            }
        }
        const slowmodeChannelId = verb === "slowmode" ? commands.parseArgument(args[1], argument.channel) : undefined
        const slowmodeSeconds = wholeNumber(args[2], 0, 21600)
        if (slowmodeChannelId && slowmodeSeconds !== undefined && narrative(freeText(args, 3)))
            return {
                kind: "action",
                action: { type: "slowmode", channelId: slowmodeChannelId, slowmodeSeconds, reason: freeText(args, 3) },
            }
    }
    if (name === "mod" || name === "security") {
        const selected = verb as ModerationActionType
        const supported =
            name === "mod"
                ? ["warn", "kick", "ban", "unban", "timeout", "untimeout"]
                : ["quarantine", "release", "lock", "unlock"]
        if (!supported.includes(selected)) return error
        const id = commands.parseArgument(
            args[1],
            ["lock", "unlock"].includes(selected) ? argument.channel : argument.user,
        )
        const timed = selected === "ban" || selected === "timeout" || selected === "quarantine"
        const seconds = timed ? durationSeconds(args[2], 1, selected === "ban" ? 63072000 : 31536000) : undefined
        const needsDuration =
            selected === "timeout" || selected === "quarantine" || (selected === "ban" && seconds !== undefined)
        // case and a number before the reason link an earlier case
        const from = needsDuration ? 3 : 2
        const linkedCaseNo =
            args[from] === "case" ? commands.parseArgument(args[from + 1], argument.positive) : undefined
        const reasonText = freeText(args, linkedCaseNo ? from + 2 : from)
        const reason = narrative(reasonText)
        // A ban is temporary when the word after the member is a length. Otherwise its reason, after any case link, must start
        // with a letter, since anything else may be a length written in a way that is not read, and a permanent ban is not the way
        // to find out. A length further into the reason is not read
        const refusedLength =
            selected === "ban" &&
            seconds === undefined &&
            reasonText.trim() !== "" &&
            !/^\p{L}/u.test(reasonText.trimStart())
        if (refusedLength || (selected === "ban" && seconds !== undefined && seconds < 60))
            return {
                error: `${error.error}. A ban length is a whole number with s, m, h, d or w, from 1m to 730d, such as 7d or 1h30m. A reason starts with a letter, so to begin with a number write a word first, such as \`after 3 strikes\``,
            }
        if (!id || !reason || (needsDuration && !seconds)) return error
        return {
            kind: "action",
            action: {
                type: selected,
                reason,
                ...(["lock", "unlock"].includes(selected) ? { channelId: id } : { targetId: id }),
                ...(seconds ? { durationSeconds: seconds } : {}),
                ...(linkedCaseNo ? { linkedCaseNo } : {}),
            },
        }
    }
    return error
}

export function safetyGateClass(name: SafetyName, command: SafetyParse): "staff" | "critical" | "appeal" {
    // A member's own appeal forms, appeal help and a malformed !appeal use the appeal class. Staff review is staff work
    if (name === "appeal" && (!("kind" in command) || command.kind === "member-appeal" || command.kind === "help"))
        return "appeal"
    if (
        name === "defcon" ||
        ("kind" in command &&
            (command.kind === "recover" ||
                (command.kind === "action" &&
                    ["unlock", "release", "untimeout", "unban"].includes(command.action.type)) ||
                (command.kind === "query" &&
                    (command.operation.type === "settings" || command.operation.type === "recovery-list")) ||
                (command.kind === "manage" &&
                    command.operation.type === "settings" &&
                    Object.values(command.operation.patch).some((value) => value === false))))
    )
        return "critical"
    return "staff"
}
