import type * as C from "@neonflux/backend/contracts"

function caseDetails(value: C.ModerationCase) {
    return [
        `Case ${value.caseNo}: ${value.action} (${value.origin}${value.incident ? ` ${value.incident}` : ""}, ${value.outcome})`,
        `Actor: ${value.actorId ?? "Automation"} | User: ${value.targetId ?? "None"} | Channel: ${value.channelId ?? "None"}`,
        `Created: ${new Date(value.createdAt).toISOString()} | Log: ${value.logOutcome} | Notice: ${value.notificationOutcome}`,
        `Linked case: ${value.linkedCaseNo ?? "None"} | Voided: ${value.voided ? "Yes" : "No"}`,
        value.erased ? "Narrative erased" : `Reason: ${value.reason}`,
        ...(!value.erased ? value.corrections.map((correction) => `Correction (${correction.type}, actor ${correction.actorId}, ${new Date(correction.createdAt).toISOString()}): ${correction.previousReason} -> ${correction.reason}`) : []),
        ...(value.observation ? [`Provider observation at ${new Date(value.observation.observedAt).toISOString()}: Member ${value.observation.memberPresent ?? "Unknown"}, banned ${value.observation.banned ?? "Unknown"}, timeout ${value.observation.timeoutUntil === null ? "None" : value.observation.timeoutUntil ?? "Unknown"}`] : []),
    ].join("\n")
}
function ruleDetails(rule: C.AutomodRule) {
    return [`${rule.name}: ${rule.type}, ${rule.enabled ? "Enabled" : "Disabled"}, action ${rule.action}`,
        `Threshold: ${rule.threshold} | Window: ${rule.windowSeconds}s | Timeout: ${rule.durationSeconds}s | Priority: ${rule.priority}`,
        `Domain mode: ${rule.domainMode} | Patterns: ${rule.patterns.join(", ") || "None"}`,
        `Channels: ${rule.channelIds.join(", ") || "All"}`,
        `Exempt channels: ${rule.exemptChannelIds.join(", ") || "None"}`,
        `Exempt roles: ${rule.exemptRoleIds.join(", ") || "None"}`].join("\n")
}
export function settingsDetails(settings: C.ModerationSettings) {
    return [`DEFCON ${settings.defcon}`,
        `Manual moderation: ${settings.manualModerationEnabled ? "On" : "Off"}`,
        `Automod: ${settings.automodEnabled ? "On" : "Off"}, ${settings.automodMode}`,
        `Security: ${settings.securityEnabled ? "On" : "Off"}, ${settings.securityMode}`,
        `Joins: ${settings.joinEnabled ? "On" : "Off"}, ${settings.joinThreshold}/${settings.joinWindowSeconds}s, raid DEFCON 2 ${settings.joinDefcon2 ? "On" : "Off"}`,
        `Honeypots: ${settings.honeypotEnabled ? "On" : "Off"}, channels ${settings.honeypotChannelIds.join(", ") || "None"}`,
        `Watchlist: ${settings.watchlistEnabled ? "On" : "Off"} | Appeals: ${settings.appealsEnabled ? "On" : "Off"}`,
        `Log channel: ${settings.logChannelId ?? "Off"}`,
        ...Object.entries(settings.staffRoleIds).map(([kind, roles]) => `Staff ${kind}: ${roles.join(", ") || "Owner and Administrator only"}`)].join("\n")
}
export function queryDetails(result: C.ModerationQueryResult, operation?: C.ModerationQueryOperation): string {
    switch (result.type) {
        case "settings": return settingsDetails(result.settings)
        case "case": return caseDetails(result.case)
        case "cases": return `Cases\n${result.cases.map((value) => `Case ${value.caseNo}: ${value.action}, ${value.outcome}, actor ${value.actorId ?? "Automation"}, user ${value.targetId ?? "None"}. Details: !case show ${value.caseNo}`).join("\n") || "None"}${result.nextBeforeCaseNo ? `\nNext: !case list ${operation?.type === "case-list" && operation.userId ? `user ${operation.userId} ` : ""}${result.nextBeforeCaseNo}` : ""}`
        case "rule": return ruleDetails(result.rule)
        case "rules": return `Automod rules, page ${result.page}/${result.totalPages}\n${result.rules.map(ruleDetails).join("\n\n") || "None"}`
        case "watchlist": return `Watchlist, page ${result.page}/${result.totalPages}\n${result.entries.map((entry) => `${entry.userId}: ${entry.reason}`).join("\n") || "None"}`
        case "watchlist-entry": return `Watchlist user ${result.entry.userId}: ${result.entry.reason}`
        case "recoveries": return `Recoveries, page ${result.page}/${result.totalPages}\n${result.recoveries.map((value) => `${value.recoveryId}: ${value.type}, case ${value.caseNo}, ${value.status}, user ${value.targetId ?? "None"}, channel ${value.channelId ?? "None"}`).join("\n") || "None"}`
        case "recovery": return `Recovery ${result.recovery.recoveryId}: ${result.recovery.type}, case ${result.recovery.caseNo}, ${result.recovery.status}`
    }
}
export function manageConfirmation(result: C.ModerationManageResult) {
    if (result.duplicate) return undefined
    switch (result.type) {
        case "settings": return settingsDetails(result.settings)
        case "case": return `Case ${result.case.caseNo}: ${result.case.action}, ${result.case.outcome}${result.case.linkedCaseNo ? `, linked to case ${result.case.linkedCaseNo}` : ""}`
        case "rule": return ruleDetails(result.rule)
        case "deleted": return `Deleted automod rule ${result.name}`
        case "watchlist": return `Watchlist entry saved for ${result.entry.userId}`
        case "watchlist-removed": return `Removed watchlist entry for ${result.userId}`
        case "erased": return `Narratives erased: ${result.cases} cases and ${result.appeals} appeals. Audit tombstones and active recovery records remain`
    }
}
export function appealDetails(value: C.Appeal) {
    return [`Appeal ${value.appealNo}, case ${value.caseNo}: ${value.status}`,
        value.erased ? "Narrative erased" : `Appeal: ${value.text}`,
        ...(!value.erased && value.decisionReason ? [`Decision: ${value.decisionReason}`] : []),
        "A decision does not reverse a sanction. Staff must perform a separate linked reversal"].join("\n")
}
export function splitReport(text: string) {
    const pages: string[] = []
    let remaining = text
    while (remaining.length > 1900) {
        let end = remaining.lastIndexOf("\n", 1900)
        if (end < 950) end = 1900
        if (/[\uD800-\uDBFF]/.test(remaining[end - 1]!)) end--
        pages.push(remaining.slice(0, end))
        remaining = remaining.slice(end).replace(/^\n/, "")
    }
    if (remaining) pages.push(remaining)
    return pages
}
