
export type ResponseKind = "custom" | "auto"
export type ResponseTrigger = { mode: "exact" | "contains", text: string }
export type ResponseReply =
    | { type: "text", text: string }
    | { type: "embed", embed: { title: string, description: string, color?: number } }

export type ResponseDefinition = {
    kind: ResponseKind
    name: string
    reply: ResponseReply
    trigger?: ResponseTrigger
    channelIds: string[]
    roleIds: string[]
    cooldownSeconds: number
    priority: number
    enabled: boolean
    createdAt: number
    updatedAt: number
}

export type ResponseCommonOperation =
    | { type: "show", name: string }
    | { type: "list", page?: number }
    | { type: "update", name: string, field: "response", reply: ResponseReply }
    | { type: "update", name: string, field: "channels", channelIds: string[] }
    | { type: "update", name: string, field: "roles", roleIds: string[] }
    | { type: "update", name: string, field: "cooldown", cooldownSeconds: number }
    | { type: "enable" | "disable" | "delete", name: string }
    | { type: "module", enabled: boolean }

export type ResponseCustomOperation = ResponseCommonOperation
    | { type: "create", name: string, reply: ResponseReply }

export type ResponseAutoOperation = ResponseCommonOperation
    | { type: "create", name: string, trigger: ResponseTrigger, reply: ResponseReply }
    | { type: "update", name: string, field: "trigger", trigger: ResponseTrigger }
    | { type: "update", name: string, field: "priority", priority: number }

export type ResponseManageRequest = {
    serverId: string
    messageId: string
    createdAt: number
    actorId: string
    adminAuthorized: boolean
} & (
    | { kind: "custom", operation: ResponseCustomOperation }
    | { kind: "auto", operation: ResponseAutoOperation }
)

export type ResponseManageResult =
    | { duplicate: true }
    | { duplicate: false, type: "definition", definition: ResponseDefinition }
    | { duplicate: false, type: "list", kind: ResponseKind, page: number, totalPages: number, total: number, moduleEnabled: boolean, definitions: ResponseDefinition[] }
    | { duplicate: false, type: "deleted", kind: ResponseKind, name: string }
    | { duplicate: false, type: "module", kind: ResponseKind, enabled: boolean }

export type ResponseEvaluateRequest = {
    serverId: string
    messageId: string
    createdAt: number
    channelId: string
    userId: string
    userName: string
    roleIds: string[]
    content: string
}

export type ResponseEvaluateResult =
    | { send: false }
    | { send: true, messageId: string, ruleName: string, reply: ResponseReply }

export type StaffClass = "moderation" | "cases" | "automod" | "security" | "appeals"
export type ModerationActor = {
    userId: string
    roleIds: string[]
    isOwner: boolean
    isAdministrator: boolean
    nativePermissionAuthorized: boolean
}
export type PermissionOverwriteSnapshot = { exists: boolean, allow: string, deny: string }
export type ModerationActionContext = {
    botActionAuthorized: boolean
    actorCanManageTarget: boolean
    botCanManageTarget: boolean
    targetProtected: boolean
    botId: string
    currentTimeoutUntil?: string | null
    currentOverwrite?: PermissionOverwriteSnapshot
    recoveryGeneration?: number
    currentSlowmodeSeconds?: number
    botAuthorizedActions?: ModerationActionType[]
}
export type ModerationActionType = "log" | "warn" | "kick" | "ban" | "unban" | "timeout" | "untimeout" | "delete" | "purge" | "slowmode" | "lock" | "unlock" | "quarantine" | "release"
export type ModerationActionInput = {
    type: ModerationActionType
    targetId?: string
    channelId?: string
    messageIds?: string[]
    durationSeconds?: number
    slowmodeSeconds?: number
    reason: string
    linkedCaseNo?: number
    recoveryId?: string
}
export type AutomodRuleType = "spam" | "repeat" | "mentions" | "words" | "domains" | "invites"
export type AutomodAction = "log" | "delete" | "warn" | "timeout"
export type AutomodRule = {
    name: string
    type: AutomodRuleType
    enabled: boolean
    priority: number
    action: AutomodAction
    threshold: number
    windowSeconds: number
    durationSeconds: number
    patterns: string[]
    domainMode: "block" | "allow"
    channelIds: string[]
    exemptChannelIds: string[]
    exemptRoleIds: string[]
}
export type ModerationSettings = {
    manualModerationEnabled: boolean
    staffRoleIds: Record<StaffClass, string[]>
    logChannelId: string | null
    automodEnabled: boolean
    automodMode: "dry-run" | "enforce"
    securityEnabled: boolean
    securityMode: "dry-run" | "enforce"
    joinEnabled: boolean
    joinThreshold: number
    joinWindowSeconds: number
    joinDefcon2: boolean
    honeypotEnabled: boolean
    honeypotChannelIds: string[]
    watchlistEnabled: boolean
    appealsEnabled: boolean
    defcon: 1 | 2 | 3
}
export type ModerationOutcome = "succeeded" | "failed" | "uncertain"
export type ModerationCase = {
    caseNo: number
    actionId: string
    sourceId: string
    action: ModerationActionType
    origin: "manual" | "automod" | "security"
    incident?: SecurityIncidentKind
    actorId?: string
    targetId?: string
    channelId?: string
    reason: string
    ruleName?: string
    linkedCaseNo?: number
    createdAt: number
    expiresAt: number
    outcome: "pending" | ModerationOutcome
    logOutcome: "none" | "pending" | "sent" | "failed" | "uncertain"
    notificationOutcome: "none" | "pending" | "sent" | "failed" | "uncertain"
    erased: boolean
    voided: boolean
    corrections: { actorId: string, createdAt: number, previousReason: string, reason: string, type: "reason" | "void" }[]
    observation?: ProviderObservation
}
export type ProviderObservation = {
    observedAt: number
    memberUserId?: string
    timeoutUntil?: string | null
    banned?: boolean
    banExpiresAt?: string | null
    memberPresent?: boolean
    overwrite?: PermissionOverwriteSnapshot
    slowmodeSeconds?: number
}
export type ModerationActionGrant = {
    actionId: string
    caseNo: number
    sourceId: string
    action: ModerationActionType
    targetId?: string
    channelId?: string
    messageIds?: string[]
    durationSeconds?: number
    slowmodeSeconds?: number
    expectedSlowmodeSeconds?: number
    reason: string
    expectedTimeoutUntil?: string | null
    restoreTimeoutUntil?: string | null
    overwrite?: PermissionOverwriteSnapshot
    expectedOverwrite?: PermissionOverwriteSnapshot
    recoveryId?: string
}
export type StaffLogGrant = {
    logId: string
    channelId: string
    caseNo: number
    action: ModerationActionType
    outcome: ModerationOutcome
    targetId?: string
    reason: string
}
export type SecurityRecovery = {
    recoveryId: string
    generation: number
    type: "timeout" | "lock" | "ban"
    targetId?: string
    channelId?: string
    caseNo: number
    status: "pending" | "active" | "uncertain"
    expectedTimeoutUntil?: string | null
    previousTimeoutUntil?: string | null
    previousOverwrite?: PermissionOverwriteSnapshot
    expectedOverwrite?: PermissionOverwriteSnapshot
    createdAt: number
    knownDeadline?: number
}
export type SecurityIncidentKind = "join-burst" | "honeypot" | "watchlist"
export type WatchlistEntry = { userId: string, reason: string, createdAt: number }
export type ModerationManageOperation =
    | { type: "settings", patch: Partial<Omit<ModerationSettings, "staffRoleIds">> & { staffRoleIds?: Partial<Record<StaffClass, string[]>> } }
    | { type: "action", action: ModerationActionInput, context: ModerationActionContext }
    | { type: "case-reason", caseNo: number, reason: string }
    | { type: "case-void", caseNo: number }
    | { type: "erase", caseNo: number }
    | { type: "rule-create", rule: AutomodRule }
    | { type: "rule-update", name: string, patch: Partial<Omit<AutomodRule, "name" | "type">> }
    | { type: "rule-delete", name: string }
    | { type: "watchlist-add", userId: string, reason: string }
    | { type: "watchlist-remove", userId: string }
export type ModerationSource = { messageId: string, createdAt: number }
export type ModerationManageRequest = ModerationSource & { serverId: string, actor: ModerationActor, operation: ModerationManageOperation }
export type ModerationManageResult =
    | { duplicate: true }
    | { duplicate: false, type: "settings", settings: ModerationSettings }
    | { duplicate: false, type: "case", case: ModerationCase, grant?: ModerationActionGrant }
    | { duplicate: false, type: "rule", rule: AutomodRule }
    | { duplicate: false, type: "deleted", name: string }
    | { duplicate: false, type: "watchlist", entry: WatchlistEntry }
    | { duplicate: false, type: "watchlist-removed", userId: string }
    | { duplicate: false, type: "erased", cases: number, appeals: number }
export type ModerationQueryOperation =
    | { type: "settings" }
    | { type: "case-show", caseNo: number }
    | { type: "case-list", beforeCaseNo?: number, userId?: string }
    | { type: "rule-show", name: string }
    | { type: "rule-list", page?: number }
    | { type: "watchlist-list", page?: number }
    | { type: "watchlist-show", userId: string }
    | { type: "recovery-list", page?: number }
    | { type: "recovery-target", targetId: string }
    | { type: "recovery-channel", channelId: string }
    | { type: "recovery-case", caseNo: number }
export type ModerationQueryRequest = { serverId: string, actor: ModerationActor, privateChannelVerified?: boolean, operation: ModerationQueryOperation }
export type ModerationQueryResult =
    | { type: "settings", settings: ModerationSettings }
    | { type: "case", case: ModerationCase }
    | { type: "cases", cases: ModerationCase[], nextBeforeCaseNo?: number }
    | { type: "rule", rule: AutomodRule }
    | { type: "rules", rules: AutomodRule[], page: number, totalPages: number }
    | { type: "watchlist", entries: WatchlistEntry[], page: number, totalPages: number }
    | { type: "watchlist-entry", entry: WatchlistEntry }
    | { type: "recoveries", recoveries: SecurityRecovery[], page: number, totalPages: number }
    | { type: "recovery", recovery: SecurityRecovery }
export type ModerationEvaluateRequest = ModerationSource & {
    serverId: string
    event: "create" | "edit"
    editedAt?: number
    userId: string
    channelId: string
    roleIds: string[]
    content: string
    contentHash: string
    mentionedUserIds: string[]
    mentionedRoleIds: string[] | null
    mentionedEveryone: boolean | null
    targetIsStaff: boolean
    context: ModerationActionContext
}
export type ModerationEvaluateResult = { duplicate: boolean, blocked: boolean, case?: ModerationCase, grant?: ModerationActionGrant }
export type ModerationJoinRequest = {
    serverId: string
    userId: string
    joinedAt: number
    targetIsStaff: boolean
    context: ModerationActionContext
}
export type ModerationJoinResult = { duplicate: boolean, settings: ModerationSettings, case?: ModerationCase, grant?: ModerationActionGrant }
export type ModerationOutcomeRequest = { serverId: string, actionId: string, caseNo: number, outcome: ModerationOutcome, timeoutUntil?: string | null, banExpiresAt?: string | null }
export type ModerationDispatchRequest = { serverId: string, actionId: string, caseNo: number, dispatch: true }
export type WarningNoticeGrant = { noticeId: string, caseNo: number, targetId: string, reason: string }
export type ModerationOutcomeResult = { recorded: boolean, log?: StaffLogGrant, notice?: WarningNoticeGrant }
export type ModerationNoticeOutcomeRequest = { serverId: string, noticeId: string, caseNo: number, outcome: "sent" | "failed" | "uncertain", sentMessageId?: string }
export type ModerationLogOutcomeRequest = { serverId: string, logId: string, caseNo: number, outcome: "sent" | "failed" | "uncertain", sentMessageId?: string }
export type ModerationReconcileRequest = ModerationSource & { serverId: string, actor: ModerationActor, privateChannelVerified: boolean, actionId: string, observation: ProviderObservation }
export type ModerationReconcileResult = { recorded: boolean, case: ModerationCase }
export type ModerationObserveRequest = { serverId: string }
export type ModerationObserveResult = { settings: ModerationSettings, uncertainActions: number, uncertainLogs: number }
export type ModerationGateRequest = { serverId: string, actor: ModerationActor, command: "public" | "staff" | "critical" | "appeal" }
export type ModerationGateResult = { allowed: boolean, defcon: 1 | 2 | 3, messageProtectionEnabled: boolean, joinProtectionEnabled: boolean }
export type Appeal = { appealNo: number, caseNo: number, userId: string, text: string, createdAt: number, status: "open" | "accepted" | "rejected" | "withdrawn", decisionReason?: string, decidedAt?: number, erased: boolean }
export type AppealCaseSummary = Pick<ModerationCase, "caseNo" | "action" | "createdAt" | "outcome" | "reason">
export type AppealMemberRequest = ModerationSource & { serverId: string, requesterId: string, privateChannelVerified: boolean, operation: { type: "submit", caseNo: number, text: string } | { type: "show", appealNo: number } | { type: "withdraw", appealNo: number } | { type: "list", page?: number } | { type: "cases", beforeCaseNo?: number } }
export type AppealMemberResult = { duplicate: true } | { duplicate: false, type: "appeal", appeal: Appeal } | { duplicate: false, type: "appeals", appeals: Appeal[], page: number, totalPages: number } | { duplicate: false, type: "cases", cases: AppealCaseSummary[], nextBeforeCaseNo?: number }
export type AppealStaffRequest = ModerationSource & { serverId: string, actor: ModerationActor, privateChannelVerified: boolean, operation: { type: "list", page?: number } | { type: "show", appealNo: number } | { type: "decide", appealNo: number, decision: "accepted" | "rejected", reason: string } }
export type AppealStaffResult = { duplicate: true } | { duplicate: false, type: "appeal", appeal: Appeal } | { duplicate: false, type: "appeals", appeals: Appeal[], page: number, totalPages: number }
