
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

export type PublishingKind = "draft" | "template"
export type PublishingEmbedField = { name: string, value: string, inline?: boolean }
export type PublishingEmbed = {
    title?: string
    description?: string
    url?: string
    color?: number
    timestamp?: string
    author?: { name: string, url?: string, iconUrl?: string }
    footer?: { text: string, iconUrl?: string }
    image?: { url: string, description?: string }
    thumbnail?: { url: string, description?: string }
    fields?: PublishingEmbedField[]
}
export type PublishingContent = { content: string, embed?: PublishingEmbed }
export type PublishingSettings = { enabled: boolean }
export type PublishingDraft = { kind: PublishingKind, name: string, revision: number, content: PublishingContent, canonicalContent: PublishingContent, createdAt: number, updatedAt: number }
export type PublishingOutcome = "pending" | "sent" | "failed" | "uncertain"
export type PublishingObservation = { observedAt: number, messageId: string, channelId: string, botId: string, content: PublishingContent }
export type PublishingResolution = { attemptId: string, generation: number, sourceId: string, observedAt: number, matched: "intended" | "previous" }
export type PublishingDispatchPolicy = { windowMs: 180000, nativeDeadlineMs: 5000, marginMs: 5000 }
export type PublishingAttempt = {
    attemptId: string, postNo: number, generation: number, sourceId: string, actorId: string, botId: string,
    action: "send" | "edit", channelId: string, messageId?: string,
    draftKind?: PublishingKind, draftName?: string, draftRevision?: number,
    source?: PublishingSource, provenance?: PublishingProvenance, consumer?: PublishingConsumer,
    content: PublishingContent, canonicalContent: PublishingContent, expectedContent?: PublishingContent,
    dispatchExpiresAt: number, nativeDeadlineMs: 5000, dispatchedAt?: number,
    outcome: PublishingOutcome, createdAt: number, finishedAt?: number, noDispatch?: true, observation?: PublishingObservation, resolution?: PublishingResolution,
}
export type PublishingPost = {
    postNo: number, generation: number, channelId: string, botId: string, messageId?: string,
    outcome: PublishingOutcome, createdAt: number, updatedAt: number,
    confirmedContent?: PublishingContent, confirmedCanonicalContent?: PublishingContent, confirmedDraftRevision?: number,
    attempt: PublishingAttempt, consumer?: PublishingConsumer,
}
export type PublishingGrant = Omit<PublishingAttempt, "outcome" | "createdAt" | "finishedAt" | "noDispatch" | "dispatchedAt" | "observation" | "resolution">
export type PublishingDispatchRequest = { serverId: string, postNo: number, attemptId: string, generation: number, sourceId: string, claimToken: string, scheduleContext?: SchedulesAutomationContext }
export type PublishingDispatchResult = { claimed: boolean, dispatchExpiresAt: number, nativeDeadlineMs: 5000 }
export type PublishingContext = { botId: string, channelId: string, botAuthorized: boolean, actorAuthorized: boolean }
type PublishingEmbedProperty = {
    [K in keyof Omit<PublishingEmbed, "fields">]-?: { type: "embed-property", field: K, value: NonNullable<PublishingEmbed[K]> | null }
}[keyof Omit<PublishingEmbed, "fields">]
export type PublishingDraftEdit =
    | { type: "content", content: string }
    | { type: "embed", embed: PublishingEmbed }
    | { type: "embed-clear" }
    | PublishingEmbedProperty
    | { type: "field-add", field: PublishingEmbedField }
    | { type: "field-set", index: number, field: PublishingEmbedField }
    | { type: "field-remove", index: number }
    | { type: "fields-clear" }
export type PublishingManageOperation =
    | { type: "settings", patch: Partial<PublishingSettings> }
    | { type: "draft-create", kind: PublishingKind, name: string, content?: PublishingContent }
    | { type: "draft-set", kind: PublishingKind, name: string, expectedRevision: number, content: PublishingContent }
    | { type: "draft-clone", kind: PublishingKind, name: string, expectedRevision: number, toKind: PublishingKind, toName: string }
    | { type: "draft-delete", kind: PublishingKind, name: string, expectedRevision: number }
    | { type: "draft-update", kind: PublishingKind, name: string, expectedRevision: number, edit: PublishingDraftEdit }
    | { type: "preview", kind: PublishingKind, name: string, expectedRevision: number }
    | { type: "send", kind: PublishingKind, name: string, expectedRevision: number, channelId: string, context: PublishingContext }
    | { type: "edit", kind: PublishingKind, name: string, expectedRevision: number, postNo: number, expectedGeneration: number, context: PublishingContext }
    | { type: "forget", postNo: number, expectedGeneration: number }
    | { type: "resolve", postNo: number, expectedGeneration: number, outcome: "sent", messageId: string, channelId: string, botId: string, content: PublishingContent }
    | { type: "resolve", postNo: number, expectedGeneration: number, outcome: "failed" }
export type PublishingManageRequest = ModerationSource & { serverId: string, actor: ModerationActor, operation: PublishingManageOperation }
export type PublishingManageResult =
    | { duplicate: true }
    | { duplicate: false, type: "settings", settings: PublishingSettings }
    | { duplicate: false, type: "draft", draft: PublishingDraft }
    | { duplicate: false, type: "deleted", kind: PublishingKind, name: string }
    | { duplicate: false, type: "preview", draft: PublishingDraft }
    | { duplicate: false, type: "post", post: PublishingPost, grant: PublishingGrant }
    | { duplicate: false, type: "forgotten", postNo: number }
    | { duplicate: false, type: "resolved", post: PublishingPost }
export type PublishingQueryRequest = { serverId: string, actor: ModerationActor, operation:
    | { type: "settings" }
    | { type: "draft-show", kind: PublishingKind, name: string }
    | { type: "draft-list", kind: PublishingKind, page?: number }
    | { type: "post-show", postNo: number }
    | { type: "post-list", beforePostNo?: number }
}
export type PublishingQueryResult =
    | { type: "settings", settings: PublishingSettings }
    | { type: "draft", draft: PublishingDraft }
    | { type: "drafts", drafts: PublishingDraft[], kind: PublishingKind, page: number, totalPages: number }
    | { type: "post", post: PublishingPost }
    | { type: "posts", posts: PublishingPost[], nextBeforePostNo?: number }
export type PublishingOutcomeRequest = { serverId: string, postNo: number, attemptId: string, generation: number, sourceId: string, outcome: Exclude<PublishingOutcome, "pending">, messageId?: string, claimToken?: string }
export type PublishingOutcomeResult = { recorded: boolean }
export type PublishingReconcileRequest = ModerationSource & { serverId: string, actor: ModerationActor, postNo: number, attemptId: string, expectedGeneration: number, observation: PublishingObservation }
export type PublishingReconcileResult = { recorded: boolean, post: PublishingPost }
export type PublishingObserveRequest = { serverId: string, mode: "restart" | "aged" }
export type PublishingObserveResult = { uncertainAttempts: number }

export type RolesReservation = { userId: string, roleIds: string[] }
export type RolesSettings = { panelsEnabled: boolean, verificationEnabled: boolean, autoroleEnabled: boolean, humansOnly: boolean, autoroleIds: string[], reservations?: RolesReservation[], revision: number }
export type RolesPanelKind = "reaction" | "verification"
export type RolesMapping = { emoji: string, roleId: string, prerequisiteRoleIds: string[], exclusionRoleIds: string[] }
export type RolesPanelSnapshot = { revision: number, publishedAt: number, postNo: number, postGeneration: number, channelId: string, messageId: string, botId: string, content: PublishingContent, mappings: RolesMapping[], exclusive: boolean }
export type RolesPanel = { name: string, kind: RolesPanelKind, revision: number, enabled: boolean, exclusive: boolean, mappings: RolesMapping[], published?: RolesPanelSnapshot, withdrawing: boolean }
export type RolesRoleSnapshot = { roleId: string, permissions: string, botCanManage: boolean, actorCanManage: boolean }
export type RolesMemberContext = { userId: string, joinedAt: string, roleIds: string[], isBot: boolean, timeoutUntil: string | null, botId: string, botAuthorized: boolean, roles: RolesRoleSnapshot[] }
export type RolesSource = { sourceId: string, createdAt: number }
export type RolesOutcome = "pending" | "succeeded" | "failed" | "uncertain"
export type RolesGrant = { attemptId: string, ownershipId: string, generation: number, sourceId: string, action: "add" | "remove", userId: string, joinedAt: string, roleId: string, botId: string, expectedPresent: boolean, consumerKey: string, dispatchExpiresAt: number, nativeDeadlineMs: 5000 }
export type RolesAttempt = RolesGrant & { outcome: RolesOutcome, createdAt: number, finishedAt?: number, noDispatch?: true, dispatchedAt?: number }
export type RolesClaim = { ownershipId: string, userId: string, joinedAt: string, roleId: string, generation: number, owned: boolean, status: "idle" | "pending" | "uncertain", consumerKeys: string[], attempt?: RolesAttempt }
export type RolesAcknowledgment = { acknowledged: boolean, rulesRevision?: number, acknowledgedAt?: number, accessConfirmed: boolean, accessRolePresent: boolean }
export type RolesManageOperation =
    | { type: "settings", patch: Partial<Omit<RolesSettings, "revision">>, roles?: RolesRoleSnapshot[], expectedRevision?: number }
    | { type: "panel-create", name: string, kind: RolesPanelKind, mappings?: RolesMapping[], roles?: RolesRoleSnapshot[], exclusive?: boolean }
    | { type: "panel-update", name: string, expectedRevision: number, patch: { enabled?: boolean, exclusive?: boolean, mappings?: RolesMapping[] }, roles?: RolesRoleSnapshot[] }
    | { type: "panel-bind", name: string, expectedRevision: number, postNo: number, expectedPostGeneration: number }
    | { type: "withdraw", name: string, revision: number, deletePanel?: boolean }
    | { type: "autorole-withdraw", revision: number }
    | { type: "withdraw-next", withdrawalId: string, expectedStep: number }
    | ({ type: "withdraw-departed", withdrawalId: string, userId: string, joinedAt: string, currentJoinedAt: string | null, observedAt: number, memberUserId?: string })
export type RolesWithdrawal = { withdrawalId: string, consumerKey: string, step: number, status: "pending" | "blocked" | "complete", remainingAtLeast: number, hasMore: boolean, deletePanel: boolean, targets: { userId: string, joinedAt: string, roleId: string }[], nextCursor?: string }
export type RolesManageRequest = ModerationSource & { serverId: string, actor: ModerationActor, operation: RolesManageOperation }
export type RolesManageResult = { duplicate: true } | { duplicate: false, type: "settings", settings: RolesSettings } | { duplicate: false, type: "panel", panel: RolesPanel } | { duplicate: false, type: "withdrawal", withdrawal: RolesWithdrawal }
export type RolesQueryRequest = { serverId: string, actor: ModerationActor, operation:
    | { type: "settings" } | { type: "panel-show", name: string } | { type: "panel-list", page?: number }
    | { type: "claim-list", userId: string, joinedAt: string, cursor?: string }
    | { type: "attempt-show", attemptId: string } | { type: "withdrawal-show", withdrawalId: string, cursor?: string }
    | { type: "configuration-list", name?: string, cursor?: string }
}
export type RolesQueryResult = { type: "settings", settings: RolesSettings } | { type: "panel", panel: RolesPanel } | { type: "panels", panels: RolesPanel[], page: number, totalPages: number }
    | { type: "claims", claims: RolesClaim[], nextCursor?: string } | { type: "attempt", attempt: RolesAttempt } | { type: "withdrawal", withdrawal: RolesWithdrawal }
    | { type: "configurations", references: { consumerKey: string, roleId: string, postNo?: number }[], nextCursor?: string }
export type RolesEvaluateOperation = { type: "choose", name: string, revision: number, roleId: string, selected: boolean }
    | { type: "reaction", name: string, revision: number, messageId: string, presentEmojis: string[], panelVerified: boolean }
    | { type: "verify", name: string, revision: number, messageId?: string, panelVerified?: boolean, reactionPresent?: boolean }
    | { type: "join" }
    | { type: "withdraw", withdrawalId: string, roleId: string }
    | { type: "withdraw-member", consumerKey: string, roleId: string }
export type RolesEvaluateRequest = RolesSource & { serverId: string, context: RolesMemberContext, operation: RolesEvaluateOperation, continuationAttemptId?: string, actor?: ModerationActor, reactionJob?: RolesReactionJobBinding }
export type RolesEvaluateResult = { duplicate: boolean, status: "unchanged" | "acknowledged" | "reserved" | "partial" | "ambiguous" | "blocked", acknowledgment: RolesAcknowledgment, grant?: RolesGrant }
export type RolesDispatchRequest = { serverId: string, attemptId: string, ownershipId: string, generation: number, sourceId: string, claimToken: string, context: RolesMemberContext, actor?: ModerationActor }
export type RolesDispatchResult = { claimed: boolean, dispatchExpiresAt: number, nativeDeadlineMs: 5000 }
export type RolesOutcomeRequest = Omit<RolesDispatchRequest, "claimToken" | "context" | "actor"> & { claimToken?: string, outcome: Exclude<RolesOutcome, "pending"> }
export type RolesOutcomeResult = { recorded: boolean }
export type RolesReconcileRequest = ModerationSource & { serverId: string, actor: ModerationActor, attemptId: string, generation: number, observation: { observedAt: number, userId: string, joinedAt: string, roleId: string, present: boolean } }
export type RolesReconcileResult = { recorded: boolean, claim: RolesClaim }
export type RolesMemberQueryRequest = { serverId: string, context: RolesMemberContext }
export type RolesMemberQueryResult = { settings: RolesSettings, panels: RolesPanel[], acknowledgment: RolesAcknowledgment }
export type RolesObserveRequest = { serverId: string, mode: "restart" | "aged" }
export type RolesObserveResult = { uncertainAttempts: number }
export type RolesPolicyRequest = { serverId: string }
export type RolesPolicyResult = { settings: RolesSettings }
export type RolesReactionJobBinding = { jobId: string, generation: number, claimToken: string, pageStep: number, index: number }
export type RolesReactionJob = { jobId: string, name: string, revision: number, messageId: string, channelId: string, generation: number, pageStep: number, status: "queued" | "running" | "blocked" | "complete" | "cancelled", rerun: boolean, leaseExpiresAt?: number }
export type RolesReactionJobsRequest = { serverId: string, operation:
    | { type: "enqueue", messageId: string }
    | { type: "list" }
    | { type: "claim", jobId: string, claimToken: string }
    | ({ type: "skip", binding: RolesReactionJobBinding, currentJoinedAt: string | null, observedAt?: number, memberUserId?: string })
    | { type: "block", binding: RolesReactionJobBinding }
    | { type: "checkpoint", jobId: string, generation: number, claimToken: string, pageStep: number, blocked: boolean }
}
export type RolesReactionJobsResult = { type: "jobs", jobs: RolesReactionJob[] }
    | { type: "job", job: RolesReactionJob }
    | { type: "page", claimed: false, job: RolesReactionJob }
    | { type: "page", claimed: true, job: RolesReactionJob, targets: { userId: string, joinedAt: string, sourceId: string }[], hasMore: boolean }

export type GreetingsRoute = "welcome" | "dm" | "goodbye"
export type GreetingsRouteSettings = { revision: number, enabled: boolean, timing: "join" | "verified", channelId?: string, templateName?: string, templateRevision?: number, content?: PublishingContent }
export type GreetingsSettings = { routes: Record<GreetingsRoute, GreetingsRouteSettings>, claimsPerMinute: number, retentionDays: number }
export type GreetingsMemberContext = { userId: string, userName: string, serverName: string, joinedAt: string, isBot: boolean, roleIds: string[], timeoutUntil: string | null }
export type GreetingsContext = { botId: string, botAuthorized: boolean, observedAt: number, member: GreetingsMemberContext | null, memberAbsent: boolean, memberUserId?: string, channelId?: string }
export type GreetingsState = "waiting" | "ready" | "reserved" | "sent" | "failed" | "uncertain" | "cancelled" | "expired"
export type GreetingsDelivery = { deliveryId: string, deliveryNo: number, route: GreetingsRoute, routeRevision: number, userId: string, joinedAt: string, memberGeneration: number, state: GreetingsState, createdAt: number, pendingExpiresAt: number, nextCheckAt: number, reason?: "verification" | "eligibility" | "configuration" | "membership" | "lifetime" | "capacity", grant?: GreetingsGrant, claimedAt?: number, finishedAt?: number, noDispatch?: true, messageId?: string, channelId?: string }
export type GreetingsGrant = { deliveryId: string, deliveryNo: number, route: GreetingsRoute, routeRevision: number, templateName: string, templateRevision: number, userId: string, joinedAt: string, memberGeneration: number, botId: string, channelId?: string, content: PublishingContent, canonicalContent: PublishingContent, dispatchExpiresAt: number, nativeDeadlineMs: 5000 }
export type GreetingsBinding = { serverId: string, deliveryId: string, route: GreetingsRoute, routeRevision: number, userId: string, joinedAt: string, memberGeneration: number }
export type GreetingsManageRequest = ModerationSource & { serverId: string, actor: ModerationActor, operation:
    | { type: "configure", route: GreetingsRoute, templateName: string, expectedTemplateRevision: number, channelId?: string, timing?: "join" | "verified" }
    | { type: "module", route: GreetingsRoute, enabled: boolean }
    | { type: "clear", route: GreetingsRoute }
    | { type: "settings", claimsPerMinute?: number, retentionDays?: number }
}
export type GreetingsManageResult = { duplicate: boolean, settings: GreetingsSettings }
export type GreetingsQueryRequest = { serverId: string, actor: ModerationActor, operation: { type: "settings" } | { type: "member", userId: string } | { type: "delivery", deliveryNo: number } | { type: "deliveries", beforeDeliveryNo?: number } | { type: "preview", route: GreetingsRoute, userId: string, userName: string, serverName: string, channelId: string } }
export type GreetingsMember = { userId: string, joinedAt: string, generation: number, present: boolean, observedAt: number, expiresAt: number }
export type GreetingsQueryResult = { type: "settings", settings: GreetingsSettings } | { type: "member", member: GreetingsMember | null } | { type: "delivery", delivery: GreetingsDelivery } | { type: "deliveries", deliveries: GreetingsDelivery[], nextBeforeDeliveryNo?: number } | { type: "preview", content: PublishingContent, canonicalContent: PublishingContent }
export type GreetingsObserveRequest = { serverId: string, operation:
    | { type: "join", eventJoinedAt: string, observedAt: number, member: GreetingsMemberContext }
    | { type: "present", expectedGeneration: number, observedAt: number, member: GreetingsMemberContext }
    | ({ type: "absent", userId: string, expectedGeneration: number, joinedAt: string, observedAt: number, memberAbsent: true })
    | ({ type: "departed", userId: string, userName: string, serverName: string, observedAt: number, memberAbsent: true })
}
export type GreetingsObserveResult = { recorded: boolean, member: GreetingsMember | null, admitted: number }
export type GreetingsPendingRequest = { serverId: string, cursor?: string, userId?: string, scanAt?: number }
export type GreetingsPendingResult = { scanAt: number, candidates: { deliveryId: string, route: GreetingsRoute, routeRevision: number, userId: string, joinedAt: string, memberGeneration: number, channelId?: string, hasEmbed: boolean }[], nextCursor?: string, nextClaimAt: number, nextCheckAt?: number }
export type GreetingsReserveRequest = GreetingsBinding & { context: GreetingsContext }
export type GreetingsReserveResult = { status: "reserved", grant: GreetingsGrant } | { status: "waiting" | "cancelled" | "expired" | "terminal" }
export type GreetingsDispatchRequest = GreetingsBinding & { claimToken: string, context: GreetingsContext }
export type GreetingsDispatchResult = { claimed: boolean, dispatchExpiresAt: number, nativeDeadlineMs: 5000, nextClaimAt: number }
export type GreetingsOutcomeRequest = GreetingsBinding & { claimToken?: string, outcome: "sent" | "failed" | "uncertain", noDispatch?: true, messageId?: string, channelId?: string }
export type GreetingsOutcomeResult = { recorded: boolean }
export type GreetingsDeferRequest = GreetingsBinding & { reason: "verification" | "eligibility" }
export type GreetingsDeferResult = { deferred: boolean }
export type GreetingsMemberRequest = { serverId: string, userId: string }
export type GreetingsMemberResult = { member: GreetingsMember | null }

export type GreetingsDiscoverRequest = { serverId: string, cursor?: string, userId?: string, scanAt?: number }
export type GreetingsDiscoverResult = { scanAt: number, examined: number, queued: number, nextCursor?: string }

export type PublishingSource = { type: "human", messageId: string, createdAt: number } | { type: "schedule-timer", deliveryId: string, dueAt: number }
export type PublishingProvenance = { type: "draft", kind: PublishingKind, name: string, revision: number } | { type: "schedule", scheduleNo: number, planRevision: number, source: SchedulesContentSource }
export type PublishingScheduleConsumer = { type: "schedule", scheduleNo: number, planRevision: number, occurrenceNo: number, deliveryId: string }
export type PublishingConsumer = PublishingScheduleConsumer
export type CivilFoldPolicy = "reject" | "earlier" | "later"
export type CivilRecurrence = { type: "none" } | { type: "daily" | "weekly", interval: number, count: number }
export type CivilResolvedDate = { localMinute: string, instantAt: number, offsetMinutes: number }
export type CivilCalendar = { localMinute: string, zone: string, fold: CivilFoldPolicy, recurrence: CivilRecurrence, dates: CivilResolvedDate[] }
export type SchedulesResolvedDate = { localMinute: string, dueAt: number, offsetMinutes: number }
export type SchedulesCalendar = Omit<CivilCalendar, "dates"> & { dates: SchedulesResolvedDate[] }
export type SchedulesMemberContext = { userId: string, joinedAt: string, roleIds: string[], isBot: boolean, timeoutUntil: string | null, canView: boolean, canReadHistory: boolean }
export type SchedulesContext = { observedAt: number, actor: ModerationActor, channelId: string, botId: string, botAuthorized: boolean, actorAuthorized: boolean, member?: SchedulesMemberContext }
export type SchedulesAutomationContext = { observedAt: number, channelId: string, botId: string, botAuthorized: true }
export type SchedulesContentSource = { kind: PublishingKind, name: string, revision: number }
export type SchedulesSnapshot = { source: SchedulesContentSource, content: PublishingContent, canonicalContent: PublishingContent }
export type SchedulesSettings = { enabled: boolean, revision: number, activatedAt: number }
export type SchedulesDefinition = SchedulesSnapshot & { scheduleNo: number, name: string, revision: number, planRevision: number, createdBy: string, channelId: string, calendar: SchedulesCalendar, enabled: boolean, cancelled: boolean, activatedAt: number, createdAt: number, updatedAt: number }
export type SchedulesDeliveryBinding = { deliveryId: string, scheduleNo: number, planRevision: number, occurrenceNo: number }
export type SchedulesDeliveryState = "queued" | "blocked" | "reserved" | "sent" | "failed" | "uncertain" | "skipped" | "cancelled" | "superseded"
export type SchedulesDeliveryReason = "activation-cutoff" | "late-window" | "superseded" | "cancelled" | "permission" | "capacity" | "dispatch-expired"
export type SchedulesDelivery = SchedulesDeliveryBinding & SchedulesSnapshot & { channelId: string, localMinute: string, zone: string, offsetMinutes: number, dueAt: number, state: SchedulesDeliveryState, nextCheckAt: number, claimedAt?: number, postNo?: number, attemptId?: string, reason?: SchedulesDeliveryReason }
export type SchedulesDeliveryGrant = PublishingGrant & { source: Extract<PublishingSource, { type: "schedule-timer" }>, provenance: Extract<PublishingProvenance, { type: "schedule" }>, consumer: PublishingScheduleConsumer }
export type SchedulesManageOperation =
    | { type: "settings", expectedRevision: number, enabled: boolean }
    | { type: "create", name: string, source: SchedulesContentSource, channelId: string, calendar: SchedulesCalendar }
    | { type: "content", scheduleNo: number, expectedRevision: number, source: SchedulesContentSource }
    | { type: "calendar", scheduleNo: number, expectedRevision: number, calendar: SchedulesCalendar }
    | { type: "destination", scheduleNo: number, expectedRevision: number, channelId: string }
    | { type: "enable" | "disable" | "cancel", scheduleNo: number, expectedRevision: number }
    | { type: "reconcile", scheduleNo: number, expectedRevision: number, deliveryId: string, attemptId: string, expectedGeneration: number, observation: PublishingObservation }
    | { type: "forget", scheduleNo: number, expectedRevision: number, confirm: "forget", occurrenceNos?: number[] }
export type SchedulesManageRequest = ModerationSource & { serverId: string, context: SchedulesContext, operation: SchedulesManageOperation }
export type SchedulesManageResult = { duplicate: true } | { duplicate: false, type: "settings", settings: SchedulesSettings } | { duplicate: false, type: "schedule", schedule: SchedulesDefinition } | { duplicate: false, type: "reconciled", recorded: boolean, post: PublishingPost } | { duplicate: false, type: "forgotten", scheduleNo: number, complete: boolean, removed: number }
export type SchedulesQueryRequest = { serverId: string, context: SchedulesContext, operation:
    | { type: "settings" | "status" }
    | { type: "list", beforeScheduleNo?: number }
    | { type: "show", scheduleNo: number }
    | { type: "deliveries", scheduleNo: number, afterOccurrenceNo?: number }
}
export type SchedulesQueryResult = { type: "settings", settings: SchedulesSettings } | { type: "status", settings: SchedulesSettings, definitions: number, deliveries: number, receipts: number, publishing: { enabled: boolean }, limits: { definitions: 50, deliveries: 200, receipts: 1000 } } | { type: "schedules", schedules: SchedulesDefinition[], nextBeforeScheduleNo?: number } | { type: "schedule", schedule: SchedulesDefinition } | { type: "deliveries", deliveries: SchedulesDelivery[], nextAfterOccurrenceNo?: number }
export type SchedulesDeliveryCursor = { cursor: string, throughAt: number }
export type SchedulesDeliveryRequest = { serverId: string, operation:
    | { type: "list", cursor?: SchedulesDeliveryCursor }
    | { type: "reserve", binding: SchedulesDeliveryBinding, context: SchedulesAutomationContext }
    | { type: "defer", binding: SchedulesDeliveryBinding }
}
export type SchedulesDeliveryResult = { type: "deliveries", deliveries: SchedulesDelivery[], hasMore: boolean, nextCursor?: SchedulesDeliveryCursor } | { type: "reservation", status: "reserved", grant: SchedulesDeliveryGrant } | { type: "reservation", status: "waiting" | "skipped" | "cancelled" | "terminal" } | { type: "progress", recorded: boolean }
