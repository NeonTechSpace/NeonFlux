import type * as C from "@neonflux/backend/contracts"
import { format } from "@neontechspace/fluxerly/effect"
import { ago, at, code, duration, onOff, type Card } from "./reply-style.ts"

/** The full text of a safety command staff type, such as !mod show <case>, with the prefix and server option the reply needs */
export type SafetyCommandText = (feature: string, rest: string) => string
/** Which settings a status reply shows. Each command shows its own feature, honeypots their channels and diagnose the protections behind DEFCON */
export type SettingsView = "mod" | "logs" | "automod" | "security" | "defcon" | "appeal" | "honeypots" | "diagnose"
type Field = readonly [string, string]

export const actionNames: Record<C.ModerationActionType, string> = { log: "Log only", warn: "Warning", kick: "Kick", ban: "Ban", unban: "Unban", timeout: "Timeout", untimeout: "Timeout removal",
    delete: "Message deletion", purge: "Purge", slowmode: "Slowmode", lock: "Lock", unlock: "Unlock", quarantine: "Quarantine", release: "Release" }
const outcomeWords: Record<C.ModerationCase["outcome"], string> = { pending: "in progress", succeeded: "done", failed: "failed", uncertain: "not confirmed yet" }
const deliveryWords: Record<Exclude<C.ModerationCase["logOutcome"], "none" | "sent">, string> = { pending: "still sending", failed: "failed", uncertain: "not confirmed" }
const incidentNames: Record<C.SecurityIncidentKind, string> = { "join-burst": "Join burst", honeypot: "Honeypot", watchlist: "Watchlist" }
const staffNames: Record<C.StaffClass, string> = { moderation: "Moderators", cases: "Case readers", automod: "Automod staff", security: "Security staff", appeals: "Appeal reviewers" }
const defconMeaning = { 3: "Normal operation", 2: "Staff commands and private appeals only", 1: "Only critical owner and Administrator controls" } as const
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
const mentions = (ids: readonly string[], mention: (id: string) => string, empty: string) => ids.map(mention).join(", ") || empty
const staff = (ids: readonly string[]) => mentions(ids, format.roleMention, "Owner and Administrators only")
const mode = (value: "dry-run" | "enforce") => value === "enforce" ? "Enforcing" : "Test mode (logs only, no action)"
const clip = (text: string) => text.length > 80 ? `${text.slice(0, 79)}…` : text
/** A field shown only when its condition holds. Its value is read only then */
const field = (condition: unknown, label: string, value: () => string): Field[] => condition ? [[label, value()]] : []

/** A case's result. One whose outcome is unknown names the command that checks it */
export const caseResult = (value: Pick<C.ModerationCase, "caseNo" | "outcome">, command: SafetyCommandText) => value.outcome === "uncertain"
    ? `Not confirmed yet. Run ${code(command("mod", `recover ${value.caseNo}`))} to check it` : outcomeWords[value.outcome].replace(/^./, letter => letter.toUpperCase())
const subject = (value: { targetId?: string, channelId?: string }) => value.targetId ? ` of ${format.userMention(value.targetId)}` : value.channelId ? ` in ${format.channelMention(value.channelId)}` : ""
function observed(value: C.ProviderObservation) {
    const facts = [...value.memberPresent === undefined ? [] : [value.memberPresent ? "in the server" : "not in the server"], ...value.banned === undefined ? [] : [value.banned ? "banned" : "not banned"],
        ...value.timeoutUntil === undefined ? [] : [value.timeoutUntil === null ? "not timed out" : `timed out until ${at(Date.parse(value.timeoutUntil))}`],
        ...value.slowmodeSeconds === undefined ? [] : [value.slowmodeSeconds ? `slowmode ${duration(value.slowmodeSeconds)}` : "no slowmode"]]
    return `${ago(value.observedAt)}${facts.length ? `: ${facts.join(", ")}` : ""}`
}
/** Who opened a case: A staff member, or the automod rule or security check that acted */
const caseBy = (value: C.ModerationCase) => value.actorId ? format.userMention(value.actorId) : value.origin === "automod" ? `Automod${value.ruleName ? ` rule ${value.ruleName}` : ""}`
    : value.incident ? `Security, ${incidentNames[value.incident].toLowerCase()}` : "Security"
/** A case with its reason and a few facts. Its staff log and member notice show only when they did not arrive, and edits are counted with the command that lists them */
function caseCard(value: C.ModerationCase, command: SafetyCommandText): Card {
    const undelivered = ([["staff log", value.logOutcome], ["member notice", value.notificationOutcome]] as const).flatMap(([name, outcome]) => outcome === "none" || outcome === "sent" ? [] : [`${name} ${deliveryWords[outcome]}`])
    const edits = value.erased ? 0 : value.corrections.length
    return { title: `Case #${value.caseNo}: ${actionNames[value.action]}`, description: value.erased ? "The reason was erased" : value.reason, fields: [
        ["Result", `${caseResult(value, command)}${value.voided ? ", voided" : ""}`],
        ...field(value.targetId, "Member", () => format.userMention(value.targetId!)), ...field(value.channelId, "Channel", () => format.channelMention(value.channelId!)),
        ["By", caseBy(value)], ["When", ago(value.createdAt)], ...field(value.linkedCaseNo, "Linked case", () => `Case #${value.linkedCaseNo}`),
        ...field(undelivered.length, "Not delivered", () => undelivered.join(", ").replace(/^./, letter => letter.toUpperCase())),...field(value.observation, "Last checked", () => observed(value.observation!))],
        ...(edits ? { note: `Edited ${edits === 1 ? "once" : `${edits} times`}. ${code(command("mod", `history ${value.caseNo}`))}` } : {}) }
}
export const CASE_HISTORY_PAGE = 10
/** One page of a case's edits, oldest first, and where the next page starts */
export function caseHistoryCard(value: C.ModerationCase, start: number): { card: Card, next: number | undefined } {
    const corrections = value.erased ? [] : value.corrections, next = start + CASE_HISTORY_PAGE < corrections.length ? start + CASE_HISTORY_PAGE : undefined
    const line = (c: C.ModerationCase["corrections"][number]) => c.type === "void" ? `Voided by ${format.userMention(c.actorId)} ${ago(c.createdAt)}`
        : `Reason changed by ${format.userMention(c.actorId)} ${ago(c.createdAt)}: ${c.previousReason} → ${c.reason}`
    return { card: { title: `Case #${value.caseNo} history`, description: corrections.slice(start, start + CASE_HISTORY_PAGE).map(line).join("\n")
        || (value.erased ? "The case's text was erased, with its edits" : "This case was never edited") }, next }
}
const caseLine = (value: C.ModerationCase) => `**#${value.caseNo}** ${actionNames[value.action]}${subject(value)} by ${value.actorId ? format.userMention(value.actorId) : value.origin === "automod" ? "Automod" : "Security"}, ${outcomeWords[value.outcome]}${value.voided ? ", voided" : ""}, ${ago(value.createdAt)}`

const ruleTypeNames: Record<C.AutomodRuleType, string> = { spam: "Spam", repeat: "Repeated messages", mentions: "Mentions in one message", "mention-rate": "Mention rate", "link-rate": "Link rate",
    words: "Words", domains: "Links to domains", invites: "Invites", "deceptive-links": "Deceptive links" }
const ruleActionNames: Record<C.AutomodAction, string> = { log: "Log only", delete: "Delete the message", warn: "Warn", timeout: "Time out" }
/** The count a rule acts at, as a sentence. Rules that match content have none */
function ruleLimit(rule: C.AutomodRule) {
    const within = ` in ${duration(rule.windowSeconds)}`
    return rule.type === "spam" ? `${plural(rule.threshold, "message")}${within}` : rule.type === "repeat" ? `${plural(rule.threshold, "identical message")}${within}`
        : rule.type === "mention-rate" ? `${plural(rule.threshold, "mention")}${within}` : rule.type === "link-rate" ? `${plural(rule.threshold, "link")}${within}`
            : rule.type === "mentions" ? `${plural(rule.threshold, "mention")} in one message` : undefined
}
/** What a rule matches: The count it acts at, or the content it looks for */
function ruleTrigger(rule: C.AutomodRule) {
    const limit = ruleLimit(rule), patterns = rule.patterns.map(code).join(", ")
    if (limit) return `at ${limit}`
    if (rule.type === "domains") return rule.domainMode === "block" ? `when a message links to ${patterns || "a listed domain"}` : `when a message links to a domain other than ${patterns || "the listed ones"}`
    if (rule.type === "deceptive-links") return `when a link imitates a well-known site${patterns ? ` or ${patterns}` : ""}`
    return `when a message contains ${patterns || "a listed pattern"}`
}
const ruleVerbs: Record<C.AutomodAction, string> = { log: "Logs the message", delete: "Deletes the message", warn: "Warns the member", timeout: "Times the member out" }
/** A rule in one sentence. Exemptions and a priority other than 0 show only when set */
function ruleCard(rule: C.AutomodRule): Card {
    const skips = [...rule.exemptChannelIds.length ? [mentions(rule.exemptChannelIds, format.channelMention, "")] : [], ...rule.exemptRoleIds.length ? [`members with ${mentions(rule.exemptRoleIds, format.roleMention, "")}`] : []]
    return { title: `Automod rule ${rule.name}`, description: `${ruleTypeNames[rule.type]} rule, ${onOff(rule.enabled).toLowerCase()}: ${ruleVerbs[rule.action]}${rule.action === "timeout" ? ` for ${duration(rule.durationSeconds)}` : ""} `
        + `${ruleTrigger(rule)}, in ${mentions(rule.channelIds, format.channelMention, "every channel")}${skips.length ? `, skipping ${skips.join(" and ")}` : ""}${rule.priority ? `. Priority ${rule.priority}` : ""}` }
}
/** The one rule setting an update changed, with its new value in the words of the rule card */
function ruleChange(patch: Partial<C.AutomodRule>, rule: C.AutomodRule) {
    const name = `Automod rule ${rule.name}`, limit = ruleLimit(rule)
    if (patch.enabled !== undefined) return `${name} is now ${onOff(rule.enabled).toLowerCase()}`
    if (patch.patterns) return rule.patterns.length ? `${name} now matches ${rule.patterns.map(code).join(", ")}` : `${name} has no patterns now`
    if (patch.channelIds) return `${name} now checks ${mentions(rule.channelIds, format.channelMention, "every channel")}`
    if (patch.exemptChannelIds) return rule.exemptChannelIds.length ? `${name} now skips ${mentions(rule.exemptChannelIds, format.channelMention, "")}` : `${name} skips no channels now`
    if (patch.exemptRoleIds) return rule.exemptRoleIds.length ? `${name} now skips members with ${mentions(rule.exemptRoleIds, format.roleMention, "")}` : `${name} skips no roles now`
    if (patch.action || patch.durationSeconds) return `${name} now acts with ${rule.action === "timeout" ? `a timeout of ${duration(rule.durationSeconds)}` : ruleActionNames[rule.action].toLowerCase()}`
    if (patch.domainMode) return `${name} now ${rule.domainMode === "block" ? "flags the listed domains" : "flags every domain not listed"}`
    if (patch.priority !== undefined) return `${name} now has priority ${rule.priority}`
    return limit ? `${name} now acts at ${limit}` : `${name} updated`
}
const recoveryTypes: Record<C.SecurityRecovery["type"], string> = { timeout: "Timeout", lock: "Lock", ban: "Ban" }
const recoveryLine = (value: C.SecurityRecovery, command: SafetyCommandText) => `**Case #${value.caseNo}** ${recoveryTypes[value.type]}${subject(value)}: ${value.status === "pending" ? "Starting"
    : value.status === "active" ? "Active" : `Not confirmed yet. Run ${code(command("security", `recover ${value.caseNo}`))}`}${value.knownDeadline ? `, ends ${at(value.knownDeadline)}` : ""}`

/** One feature's settings. A status command shows only the feature it names */
export function settingsCard(s: C.ModerationSettings, view: SettingsView, command: SafetyCommandText, openAppeals?: number): Card {
    const honeypots = s.honeypotEnabled ? s.securityEnabled ? "On" : `On, but security is off. Turn it on with ${code(command("security", "module on"))}` : "Off"
    const appeals = s.appealsEnabled ? s.defcon === 1 ? "On, but paused while DEFCON is 1" : "On" : "Off"
    const joins = `${plural(s.joinThreshold, "join")} in ${duration(s.joinWindowSeconds)}`
    switch (view) {
        case "mod": return { title: "Moderation", fields: [["Status", onOff(s.manualModerationEnabled)],
            ...Object.entries(s.staffRoleIds).map(([kind, ids]): Field => [staffNames[kind as C.StaffClass], staff(ids)])] }
        case "logs": return { title: "Moderation log", fields: [["Log channel", s.logChannelId ? format.channelMention(s.logChannelId) : `Not set. Run ${code(command("logs", "channel #channel"))}`],
            ["Case readers", staff(s.staffRoleIds.cases)]] }
        case "automod": return { title: "Automod", fields: [["Status", onOff(s.automodEnabled)], ["Mode", mode(s.automodMode)],
            ["Bot and webhook messages", s.automodBotMessagesEnabled ? "Checked" : "Not checked"], ["Automod staff", staff(s.staffRoleIds.automod)], ["Rules", code(command("automod", "list"))]] }
        // Three lines: Whether security acts, how it meets a raid and what else watches. Security staff show only when set
        case "security": return { title: "Security", description: [s.securityEnabled ? `On, ${mode(s.securityMode).toLowerCase()}` : "Off",
            `Join protection ${s.joinEnabled ? `on at ${joins}${s.joinDefcon2 ? ", and a join burst sets DEFCON 2" : ""}` : "off"}`,
            `Honeypots ${s.honeypotEnabled ? `on in ${mentions(s.honeypotChannelIds, format.channelMention, "no channels yet")}` : "off"}, watchlist ${onOff(s.watchlistEnabled).toLowerCase()}`,
            ...s.staffRoleIds.security.length ? [`Security staff: ${staff(s.staffRoleIds.security)}`] : []].join("\n") }
        case "honeypots": return { title: "Honeypots", fields: [["Status", honeypots], ["Channels", mentions(s.honeypotChannelIds, format.channelMention, "None")]] }
        case "defcon": return { title: "DEFCON", fields: [["Level", `${s.defcon}: ${defconMeaning[s.defcon]}`]] }
        case "diagnose": return { title: "DEFCON check", fields: [["Level", `${s.defcon}: ${defconMeaning[s.defcon]}`], ["Manual moderation", onOff(s.manualModerationEnabled)],
            ["Automod", `${onOff(s.automodEnabled)}, ${mode(s.automodMode).toLowerCase()}`], ["Security", `${onOff(s.securityEnabled)}, ${mode(s.securityMode).toLowerCase()}`],
            ["Join protection", s.joinEnabled ? `On at ${joins}${s.joinDefcon2 ? ". A join burst sets DEFCON 2" : ""}` : "Off"], ["Honeypots", honeypots], ["Appeals", appeals]] }
        case "appeal": return { title: "Appeals", fields: [["Status", appeals], ["Reviewers", staff(s.staffRoleIds.appeals)],
            ["Waiting for review", `${openAppeals === undefined ? "" : openAppeals ? `${openAppeals}. ` : "None. "}Run ${code(command("appeal", "review"))} for the list, sent by DM`]] }
    }
}
/** A settings change in one sentence per changed setting */
export function settingsChange(patch: Extract<C.ModerationManageOperation, { type: "settings" }>["patch"], s: C.ModerationSettings) {
    const now = (value: boolean) => `now ${onOff(value).toLowerCase()}`
    return Object.keys(patch).map(key => {
        switch (key as keyof typeof patch) {
            case "manualModerationEnabled": return `Manual moderation is ${now(s.manualModerationEnabled)}`
            case "staffRoleIds": return Object.keys(patch.staffRoleIds!).map(kind => `${staffNames[kind as C.StaffClass]} are now ${s.staffRoleIds[kind as C.StaffClass].map(format.roleMention).join(", ") || "only the owner and Administrators"}`).join("\n")
            case "logChannelId": return s.logChannelId ? `Moderation logs now go to ${format.channelMention(s.logChannelId)}` : "Moderation logs are off"
            case "automodEnabled": return `Automod is ${now(s.automodEnabled)}`
            case "automodMode": return s.automodMode === "enforce" ? "Automod now acts on its rules" : "Automod is now in test mode (logs only, no action)"
            case "automodBotMessagesEnabled": return `Automod ${s.automodBotMessagesEnabled ? "now checks" : "no longer checks"} bot and webhook messages`
            case "securityEnabled": return `Security is ${now(s.securityEnabled)}`
            case "securityMode": return s.securityMode === "enforce" ? "Security now acts on what it finds" : "Security is now in test mode (logs only, no action)"
            case "joinEnabled": return `Join protection is ${now(s.joinEnabled)}`
            case "joinThreshold": case "joinWindowSeconds": return `Join protection now acts at ${plural(s.joinThreshold, "join")} in ${duration(s.joinWindowSeconds)}`
            case "joinDefcon2": return s.joinDefcon2 ? "A join burst now sets DEFCON 2" : "A join burst no longer changes DEFCON"
            case "honeypotEnabled": return `Honeypots are ${now(s.honeypotEnabled)}`
            case "honeypotChannelIds": return `Honeypot channels: ${mentions(s.honeypotChannelIds, format.channelMention, "none")}`
            case "watchlistEnabled": return `The watchlist is ${now(s.watchlistEnabled)}`
            case "appealsEnabled": return `Appeals are ${now(s.appealsEnabled)}`
            case "defcon": return `DEFCON is now ${s.defcon}: ${defconMeaning[s.defcon]}`
        }
    }).join("\n")
}

/** A query result as a card. Lists name the command that shows one entry */
export function queryCard(result: C.ModerationQueryResult, view: SettingsView, command: SafetyCommandText): Card {
    switch (result.type) {
        case "settings": return settingsCard(result.settings, view, command, result.openAppeals)
        case "case": return caseCard(result.case, command)
        case "cases": return { title: "Cases", description: result.cases.map(caseLine).join("\n") || "No cases yet",
            fields: result.cases.length ? [["Details", code(command(view === "logs" ? "logs" : "mod", "show <case>"))]] : [] }
        case "rule": return ruleCard(result.rule)
        case "rules": return { title: "Automod rules", description: result.rules.map(rule => `**${rule.name}** ${ruleTypeNames[rule.type]}, ${ruleActionNames[rule.action].toLowerCase()}, ${onOff(rule.enabled).toLowerCase()}`).join("\n") || "No automod rules yet",
            fields: result.rules.length ? [["Details", code(command("automod", "show <name>"))]] : [] }
        case "watchlist": return { title: "Watchlist", description: result.entries.map(entry => `${format.userMention(entry.userId)}: ${clip(entry.reason)}, added ${ago(entry.createdAt)}`).join("\n") || "No watchlist entries yet",
            fields: result.entries.length ? [["Details", code(command("security", "watchlist show @user"))]] : [] }
        case "watchlist-entry": return { title: "Watchlist entry", description: result.entry.reason, fields: [["Member", format.userMention(result.entry.userId)], ["Added", ago(result.entry.createdAt)]] }
        case "recoveries": return { title: "Security recoveries", description: result.recoveries.map(value => recoveryLine(value, command)).join("\n") || "No open recoveries" }
        case "recovery": return { title: "Security recovery", description: recoveryLine(result.recovery, command) }
    }
}
export function manageConfirmation(result: Exclude<C.ModerationManageResult, { duplicate: true }>, operation: C.ModerationManageOperation) {
    switch (result.type) {
        case "settings": return operation.type === "settings" ? settingsChange(operation.patch, result.settings) : "Settings saved"
        case "case": return operation.type === "case-reason" ? `Reason for case #${result.case.caseNo} updated` : operation.type === "case-void" ? `Case #${result.case.caseNo} voided` : `Case #${result.case.caseNo} recorded`
        case "rule": return operation.type === "rule-update" ? ruleChange(operation.patch, result.rule) : `Automod rule ${result.rule.name} created`
        case "deleted": return `Automod rule ${result.name} deleted`
        case "watchlist": return `${format.userMention(result.entry.userId)} is on the watchlist`
        case "watchlist-removed": return `${format.userMention(result.userId)} is no longer on the watchlist`
        case "erased": return `Erased the text of ${plural(result.cases, "case")} and ${plural(result.appeals, "appeal")}. The case records and any active recovery stay`
        case "private-role": return result.roleId ? `Private data role: ${format.roleMention(result.roleId)}. Members with it and the server owner can view private cases on the website`
            : "Private data role cleared. Only the server owner can view private cases on the website"
    }
}

const appealStatus: Record<C.Appeal["status"], string> = { open: "Waiting for review", accepted: "Accepted", rejected: "Rejected", withdrawn: "Withdrawn" }
/** An appeal. Staff also see whose appeal it is */
export function appealCard(value: C.Appeal, staffView: boolean): Card {
    return { title: `Appeal #${value.appealNo}`, description: value.erased ? "The appeal text was erased" : value.text, fields: [["Status", appealStatus[value.status]],
        ...field(staffView, "Member", () => format.userMention(value.userId)), ["Case", `Case #${value.caseNo}`],
        ...field(!value.erased && value.decisionReason, "Decision", () => value.decisionReason!), ["Sent", ago(value.createdAt)],
        ...field(value.decidedAt !== undefined, value.status === "withdrawn" ? "Withdrawn" : "Decided", () => ago(value.decidedAt!))],
        footer: "A decision does not undo the sanction. Staff reverse it separately" }
}
export function appealListCard(appeals: readonly C.Appeal[], staffView: boolean, command: SafetyCommandText): Card {
    return { title: staffView ? "Appeals" : "Your appeals", description: appeals.map(value => `**#${value.appealNo}** Case #${value.caseNo}${staffView ? ` by ${format.userMention(value.userId)}` : ""}, ${appealStatus[value.status].toLowerCase()}, sent ${ago(value.createdAt)}${value.erased ? "" : `: ${clip(value.text)}`}`).join("\n") || "No appeals yet",
        fields: appeals.length ? [["Details", code(command("appeal", staffView ? "review <appeal>" : "show <appeal>"))]] : [] }
}
export function appealCasesCard(cases: readonly C.AppealCaseSummary[], command: SafetyCommandText): Card {
    return { title: "Cases you can appeal", description: cases.map(value => `**Case #${value.caseNo}** ${actionNames[value.action]}, ${ago(value.createdAt)}: ${clip(value.reason)}`).join("\n") || "You have no cases to appeal",
        fields: cases.length ? [["Appeal", code(command("appeal", "submit <case> <your reason>"))]] : [] }
}
