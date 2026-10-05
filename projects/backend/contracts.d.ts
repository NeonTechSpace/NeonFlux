export type ServiceScope = { mode: "single" | "multi", serverIds: string[] }
export type ServerOrigin = { originServerId?: string }

export type ResponseKind = "custom" | "auto"

export type BackupCategory = "config" | "xp" | "structure"
export type BackupConfigValues = {
    moderation: Omit<ModerationSettings, "defcon">
    responses: { customEnabled: boolean, autoEnabled: boolean }
    response: Omit<ResponseDefinition, "createdAt" | "updatedAt">
    automod: AutomodRule
    publishing: { enabled: boolean, retentionDays: number }
    draft: { kind: PublishingKind, name: string, content: PublishingContent }
    roles: Omit<RolesSettings, "revision">
    panel: { name: string, kind: RolesPanel["kind"], enabled: boolean, exclusive: boolean, mappings: RolesMapping[] }
    greetings: { claimsPerMinute: number, retentionDays: number, routes: Record<GreetingsRoute, Omit<GreetingsRouteSettings, "revision">> }
    tickets: TicketSettings
    ticketCategory: Omit<TicketCategory, "revision">
    leveling: Omit<LevelingSettings, "revision" | "mappingRevision" | "scoreEpoch">
    milestones: { enabled: boolean }
    milestoneRoute: Pick<MilestonesRoute, "kind" | "channelId" | "zone" | "time" | "fold" | "template" | "content" | "enabled">
    suggestions: { enabled: boolean, channelId?: string, ownerId?: string }
    cleanup: { enabled: boolean }
    cleanupPolicy: Pick<CleanupPolicy, "channelId" | "enabled" | "ageMs" | "ownerId" | "excludedAuthorIds" | "excludedMessageIds">
    metadata: { enabled: boolean, routes: Omit<MetadataLogsSettings["routes"][number], "revision">[], eventRoutes?: Omit<MetadataLogsEventRoute, "revision">[], messageChannelIds: string[], excludedChannelIds: string[] }
    events: { enabled: boolean }
    schedules: { enabled: boolean }
}
export type BackupConfigFamily = keyof BackupConfigValues
export type BackupConfigObject = { [K in BackupConfigFamily]: { family: K, sourceId: string, value: BackupConfigValues[K] } }[BackupConfigFamily]
export type BackupXpObject = { sourceId: string, userId: string, xp: number }
export type BackupOverwrite = { id: string, type: "role" | "member", allow: string, deny: string }
export type BackupStructureObject = { sourceId: string, type: "category" | "text" | "voice", name: string, parentId: string | null, overwrites: BackupOverwrite[], topic?: string | null, nsfw?: boolean, slowmodeSeconds?: number, bitrate?: number, userLimit?: number, capturedAt: number }
export type BackupSnapshot = { capturedAt: number, config: BackupConfigObject[], xp: BackupXpObject[], counts: { config: number, xp: number } }
export type BackupManifest = { version: 1, backupId: string, provider: string, serverId: string, selected: BackupCategory[], capturedAt: number, observations: { databaseAt: number | null, structureStartedAt: number | null, structureFinishedAt: number | null }, counts: { config: number, xp: number, structure: number, overwrites: number }, exclusions: string[], config: BackupConfigObject[], xp: BackupXpObject[], structure: BackupStructureObject[] }
export type BackupContext = ServerOrigin & { provider: string, observedAt: number, ownerId: string, actorId: string, actorKind: "human", botId: string, botKind: "bot", ownerJoinedAt: string, ownerTimeoutUntil: string | null, botTimeoutUntil: string | null, dmChannelId: string, dmType: 1, recipientIds: string[], privateReplyAuthorized: boolean }
export type BackupReference = ServerOrigin & { id: string, type: "role" | "member" | "category" | "text" | "voice", serverId: string, observedAt: number, exists: boolean, actorCanAccess: boolean, botCanAccess: boolean, actorCanManage: boolean, botCanManage: boolean, permissions: string }
export type BackupNativeObservation = ServerOrigin & { sourceId: string, observedAt: number, status: "present" | "absent" | "unknown", channel: BackupStructureObject | null }
export type BackupNativeProof = ServerOrigin & { observedAt: number, serverId: string, ownerId: string, botId: string, actorPermissions: string, botPermissions: string, actorCanManageChannels: boolean, botCanManageChannels: boolean, references: BackupReference[], observations: BackupNativeObservation[] }
export type BackupBinding = { planId: string, revision: 1, planHash: string, archiveDigest: string }
export type BackupItemBinding = BackupBinding & { itemNo: number, generation: 1 }
export type BackupDisposition = "create" | "skip" | "conflict" | "blocked"
export type BackupItemState = "planned" | "reserved" | "claimed" | "created" | "skipped" | "conflict" | "blocked" | "failed" | "uncertain"
export type BackupItem = BackupItemBinding & { category: BackupCategory, family: BackupConfigFamily | "xp" | "structure", sourceId: string, disposition: BackupDisposition, reason: string | null, state: BackupItemState, expectedHash: string, desiredHash: string, dependencyItemNo: number | null, mappedId: string | null, disabledOnCreate: boolean, dispatchExpiresAt?: number, claimedAt?: number, finishedAt?: number, noDispatch?: true, historicalOutcome?: "created" | "failed" | "uncertain", resolution?: "match" | "absent" | "conflict" }
export type BackupPlan = BackupBinding & { backupId: string, manifestDigest: string, provider: string, serverId: string, ownerId: string, createdAt: number, expiresAt: number, confirmedAt?: number, itemCount: number, counts: Record<BackupDisposition, number>, forgotten: boolean }
export type BackupOrigin = { provider: string, serverId: string, category: BackupCategory, family: BackupConfigFamily | "xp" | "structure", sourceId: string, state: "reserved" | "claimed" | "created" | "uncertain" | "failed", planId: string, itemNo: number, generation: 1, mappedId: string | null, desiredHash: string, resolved?: "match" | "absent" | "conflict" }
export type BackupGrant = BackupItemBinding & { provider: string, serverId: string, ownerId: string, botId: string, sourceId: string, channel: BackupStructureObject, dispatchExpiresAt: number, nativeDeadlineMs: 5000 }
export type BackupCapabilities = { version: 1, configFamilies: BackupConfigFamily[], exclusions: string[], limits: { xp: 1000, structure: 100, overwrites: 500, planItems: 500, plans: 10, page: 20, planMs: 900000, snapshotBytes: 1048576, planBytes: 524288, originMappings: 5000 }, safeAllowMask: string, knownDenyMask: string }
export type BackupSnapshotRequest = { serverId: string, context: BackupContext, selected: ("config" | "xp")[] }
export type BackupQueryRequest = { serverId: string, context: BackupContext, operation: { type: "capabilities" } | { type: "plans", cursor?: string } | { type: "plan", binding: BackupBinding } | { type: "items", binding: BackupBinding, cursor?: string } | { type: "item", binding: BackupItemBinding } | { type: "origins", provider: string, cursor?: string } }
export type BackupQueryResult = { type: "capabilities", capabilities: BackupCapabilities } | { type: "plans", plans: BackupPlan[], nextCursor?: string } | { type: "plan", plan: BackupPlan } | { type: "items", items: BackupItem[], nextCursor?: string } | { type: "item", item: BackupItem, object: BackupConfigObject | BackupXpObject | BackupStructureObject | null } | { type: "origins", origins: BackupOrigin[], nextCursor?: string }
export type BackupManageRequest = { serverId: string, messageId: string, createdAt: number, context: BackupContext, operation: { type: "plan", manifest: BackupManifest, archiveDigest: string, native: BackupNativeProof | null } | { type: "confirm", binding: BackupBinding } | { type: "forget", binding: BackupBinding } }
export type BackupManageResult = { type: "plan", duplicate: boolean, plan: BackupPlan, items: BackupItem[], nextCursor?: string } | { type: "confirmed", duplicate: boolean, plan: BackupPlan } | { type: "forgotten", plan: BackupPlan }
export type BackupWorkRequest = { serverId: string, operation: { type: "apply", binding: BackupItemBinding, context: BackupContext, native: BackupNativeProof | null } | { type: "reserve" | "claim", binding: BackupItemBinding, context: BackupContext, native: BackupNativeProof, claimToken?: string } | { type: "outcome", binding: BackupItemBinding, claimToken: string, outcome: "created" | "failed" | "uncertain", noDispatch?: true, channel: BackupStructureObject | null, mappedId: string | null } | { type: "reconcile", binding: BackupItemBinding, context: BackupContext, native: BackupNativeProof } }
export type BackupWorkResult = { type: "item", item: BackupItem } | { type: "grant", item: BackupItem, grant: BackupGrant, claimed: boolean }
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

export type ResponseManageRequest = ServerOrigin & {
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
export type ModerationActor = ServerOrigin & {
    userId: string
    roleIds: string[]
    isOwner: boolean
    isAdministrator: boolean
    nativePermissionAuthorized: boolean
}
export type PermissionOverwriteSnapshot = { exists: boolean, allow: string, deny: string }
export type ModerationActionContext = ServerOrigin & {
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
export type ProviderObservation = ServerOrigin & {
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
export type ModerationQueryRequest = ServerOrigin & { serverId: string, actor: ModerationActor, privateChannelVerified?: boolean, operation: ModerationQueryOperation }
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
export type ModerationReconcileRequest = ServerOrigin & ModerationSource & { serverId: string, actor: ModerationActor, privateChannelVerified: boolean, actionId: string, observation: ProviderObservation }
export type ModerationReconcileResult = { recorded: boolean, case: ModerationCase }
export type ModerationObserveRequest = { serverId: string }
export type ModerationObserveResult = { settings: ModerationSettings, uncertainActions: number, uncertainLogs: number }
export type ModerationGateRequest = { serverId: string, actor: ModerationActor, command: "public" | "staff" | "critical" | "appeal" }
export type ModerationGateResult = { allowed: boolean, defcon: 1 | 2 | 3, messageProtectionEnabled: boolean, joinProtectionEnabled: boolean }
export type Appeal = { appealNo: number, caseNo: number, userId: string, text: string, createdAt: number, status: "open" | "accepted" | "rejected" | "withdrawn", decisionReason?: string, decidedAt?: number, erased: boolean }
export type AppealCaseSummary = Pick<ModerationCase, "caseNo" | "action" | "createdAt" | "outcome" | "reason">
export type AppealMemberRequest = ServerOrigin & ModerationSource & { serverId: string, requesterId: string, privateChannelVerified: boolean, operation: { type: "submit", caseNo: number, text: string } | { type: "show", appealNo: number } | { type: "withdraw", appealNo: number } | { type: "list", page?: number } | { type: "cases", beforeCaseNo?: number } }
export type AppealMemberResult = { duplicate: true } | { duplicate: false, type: "appeal", appeal: Appeal } | { duplicate: false, type: "appeals", appeals: Appeal[], page: number, totalPages: number } | { duplicate: false, type: "cases", cases: AppealCaseSummary[], nextBeforeCaseNo?: number }
export type AppealStaffRequest = ServerOrigin & ModerationSource & { serverId: string, actor: ModerationActor, privateChannelVerified: boolean, operation: { type: "list", page?: number } | { type: "show", appealNo: number } | { type: "decide", appealNo: number, decision: "accepted" | "rejected", reason: string } }
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
export type PublishingObservation = ServerOrigin & { observedAt: number, messageId: string, channelId: string, botId: string, content: PublishingContent }
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
export type DashboardPublishingContext = { originServerId?: string, jobId: string, actorId: string, managerAuthorized: boolean, observedAt: number, botId: string, channelId: string }
export type PublishingDispatchRequest = { serverId: string, postNo: number, attemptId: string, generation: number, sourceId: string, claimToken: string, eventContext?: EventsContext | EventsAutomationContext, scheduleContext?: SchedulesAutomationContext, milestoneContext?: MilestonesDeliveryContext, suggestionContext?: SuggestionsCardContext, dashboardContext?: DashboardPublishingContext }
export type PublishingDispatchResult = { claimed: boolean, dispatchExpiresAt: number, nativeDeadlineMs: 5000 }
export type PublishingContext = ServerOrigin & { botId: string, channelId: string, botAuthorized: boolean, actorAuthorized: boolean }
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
export type RolesRoleSnapshot = ServerOrigin & { roleId: string, permissions: string, botCanManage: boolean, actorCanManage: boolean }
export type RolesMemberContext = ServerOrigin & { userId: string, joinedAt: string, roleIds: string[], isBot: boolean, timeoutUntil: string | null, botId: string, botAuthorized: boolean, roles: RolesRoleSnapshot[] }
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
    | (ServerOrigin & { type: "withdraw-departed", withdrawalId: string, userId: string, joinedAt: string, currentJoinedAt: string | null, observedAt: number, memberUserId?: string })
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
    | { type: "level-sync", roleId: string }
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
export type RolesReconcileRequest = ModerationSource & { serverId: string, actor: ModerationActor, attemptId: string, generation: number, observation: ServerOrigin & { observedAt: number, userId: string, joinedAt: string, roleId: string, present: boolean } }
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
    | (ServerOrigin & { type: "skip", binding: RolesReactionJobBinding, currentJoinedAt: string | null, observedAt?: number, memberUserId?: string })
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
export type GreetingsMemberContext = ServerOrigin & { userId: string, userName: string, serverName: string, joinedAt: string, isBot: boolean, roleIds: string[], timeoutUntil: string | null }
export type GreetingsContext = ServerOrigin & { botId: string, botAuthorized: boolean, observedAt: number, member: GreetingsMemberContext | null, memberAbsent: boolean, memberOriginServerId?: string, memberUserId?: string, channelId?: string }
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
    | (ServerOrigin & { type: "absent", userId: string, expectedGeneration: number, joinedAt: string, observedAt: number, memberAbsent: true })
    | (ServerOrigin & { type: "departed", userId: string, userName: string, serverName: string, observedAt: number, memberAbsent: true })
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

export type TicketVisibility = "private" | "public"
export type TicketOverwrite = { id: string, type: "role" | "member", allow: string, deny: string }
export type TicketChannelSnapshot = ServerOrigin & { channelId: string, serverId: string, type: "text", name: string, parentId: string | null, overwrites: TicketOverwrite[] }
export type TicketActor = ModerationActor & { joinedAt: string, isBot: boolean, timeoutUntil: string | null, privateChannelVerified: boolean, privateChannelId?: string, canView: boolean, canReadHistory: boolean, canSend: boolean }
export type TicketContext = ServerOrigin & { observedAt: number, actor: TicketActor, botId: string, botAuthorized: boolean, parentVerified?: boolean, channel?: TicketChannelSnapshot }
export type TicketSettings = { enabled: boolean, retentionDays: number }
export type TicketCannedReply = { name: string, templateName: string, templateRevision: number, content: PublishingContent }
export type TicketCategory = { name: string, revision: number, enabled: boolean, visibility: TicketVisibility, description: string, parentId: string | null, supportRoleIds: string[], questions: string[], cannedReplies: TicketCannedReply[] }
export type TicketCategorySummary = Pick<TicketCategory, "name" | "revision" | "enabled" | "visibility" | "description">
export type TicketIntakeCategory = TicketCategorySummary & Pick<TicketCategory, "parentId" | "supportRoleIds" | "questions">
export type TicketIntake = { intakeNo: number, generation: number, category: TicketIntakeCategory, requesterId: string, joinedAt: string, answers: string[], state: "draft" | "submitted" | "cancelled" | "expired", createdAt: number, expiresAt: number, ticketNo?: number }
export type TicketState = "creating" | "open" | "closing" | "closed" | "reopening" | "deleting" | "retired" | "failed" | "uncertain"
export type TicketRecord = { ticketNo: number, requesterId: string, requesterJoinedAt: string, categoryName: string, categoryRevision: number, visibility: TicketVisibility, supportRoleIds: string[], state: TicketState, generation: number, botId: string, channelId?: string, channel?: TicketChannelSnapshot, claimedBy?: string, priority: "low" | "normal" | "high" | "urgent", createdAt: number, closedAt?: number, retiredAt?: number, bodyExpiresAt?: number, erased: boolean, entryCount: number, currentAttempt?: TicketAttempt, transition?: "close" | "reopen", completedSteps?: number }
export type TicketAction = "create" | "introduction" | "reply" | "close-everyone" | "close-requester" | "reopen-requester" | "reopen-everyone" | "delete"
export type TicketActionGrant = { attemptId: string, attemptNo: number, ticketNo: number, generation: number, sourceId: string, actorId: string, botId: string, requesterId: string, requesterJoinedAt: string, visibility: TicketVisibility, supportRoleIds: string[], action: TicketAction, dispatchExpiresAt: number, nativeDeadlineMs: 5000, channelId?: string, expectedChannel?: TicketChannelSnapshot, desiredChannel?: TicketChannelSnapshot, targetOverwrite?: TicketOverwrite, channelName?: string, parentId?: string | null, overwrites?: TicketOverwrite[], content?: PublishingContent }
export type TicketLocator = Pick<TicketRecord,"ticketNo"|"requesterId"|"supportRoleIds"|"state"|"generation"|"botId"|"channelId"|"retiredAt">
export type TicketAttempt = TicketActionGrant & { outcome: "pending" | "succeeded" | "failed" | "uncertain", createdAt: number, claimedAt?: number, finishedAt?: number, noDispatch?: true, messageId?: string, observationAt?: number, resolved?: "before" | "desired" | "absent", redacted?: true, nativeDeleteConfirmed?: true }
export type TicketEntry = { entryNo: number, ticketNo: number, authorId: string, kind: "reply" | "note", createdAt: number, content?: PublishingContent, erased: boolean, attemptNo?: number }
export type TicketTranscriptMessage = { messageId: string, authorId: string, createdAt?: string, content: string, omittedAttachments: number }
export type TicketTranscript = { transcriptNo: number, ticketNo: number, channelId: string, capturedAt: number, messageCount: number, truncated: boolean, erased: boolean, pages: number }
export type TicketSource = ModerationSource & { serverId: string, context: TicketContext }
export type TicketManageOperation =
    | { type: "settings", enabled?: boolean, retentionDays?: number }
    | { type: "category-create", name: string, visibility: TicketVisibility, description?: string, parentId?: string | null, supportRoleIds: string[], roles: RolesRoleSnapshot[] }
    | { type: "category-update", name: string, expectedRevision: number, patch: Partial<Pick<TicketCategory, "enabled" | "visibility" | "description" | "parentId" | "supportRoleIds" | "questions">>, roles?: RolesRoleSnapshot[] }
    | { type: "category-delete", name: string, expectedRevision: number }
    | { type: "canned-set", name: string, expectedRevision: number, cannedName: string, templateName: string, expectedTemplateRevision: number }
    | { type: "canned-remove", name: string, expectedRevision: number, cannedName: string }
    | { type: "claim" | "unclaim", ticketNo: number, expectedGeneration: number }
    | { type: "priority", ticketNo: number, expectedGeneration: number, priority: TicketRecord["priority"] }
    | { type: "reply", ticketNo: number, expectedGeneration: number, content: PublishingContent }
    | { type: "canned-reply", ticketNo: number, expectedGeneration: number, cannedName: string }
    | { type: "note", ticketNo: number, expectedGeneration: number, content: string }
    | { type: "close" | "reopen", ticketNo: number, expectedGeneration: number }
    | { type: "delete" | "erase", ticketNo: number, expectedGeneration: number, confirm: true }
    | { type: "abandon", ticketNo: number, expectedGeneration: number }
export type TicketManageRequest = TicketSource & { operation: TicketManageOperation }
export type TicketManageResult = { duplicate: true } | { duplicate: false, type: "settings", settings: TicketSettings } | { duplicate: false, type: "category", category: TicketCategory } | { duplicate: false, type: "deleted", name: string } | { duplicate: false, type: "ticket", ticket: TicketRecord, grant?: TicketActionGrant } | { duplicate: false, type: "entry", entry: TicketEntry }
export type TicketIntakeRequest = TicketSource & { operation:
    | { type: "open", categoryName: string, expectedCategoryRevision: number }
    | { type: "answer", intakeNo: number, expectedGeneration: number, question: number, answer: string }
    | { type: "cancel", intakeNo: number, expectedGeneration: number }
    | { type: "submit", intakeNo: number, expectedGeneration: number, expectedCategoryRevision: number, visibility: TicketVisibility }
}
export type TicketIntakeResult = { duplicate: true } | { duplicate: false, type: "intake", intake: TicketIntake } | { duplicate: false, type: "ticket", ticket: TicketRecord, grant: TicketActionGrant }
export type TicketQueryRequest = { serverId: string, context: TicketContext, operation:
    | { type: "settings" }
    | { type: "categories" }
    | { type: "category", name: string }
    | { type: "category-config", name: string }
    | { type: "intake", intakeNo: number }
    | { type: "intakes", beforeIntakeNo?: number }
    | { type: "ticket" | "private-intake", ticketNo: number }
    | { type: "locate", ticketNo: number }
    | { type: "tickets", beforeTicketNo?: number, own?: boolean }
    | { type: "entries", ticketNo: number, kind: "reply" | "note", beforeEntryNo?: number }
    | { type: "attempt", ticketNo: number, attemptNo: number }
    | { type: "transcripts", ticketNo: number, beforeTranscriptNo?: number }
    | { type: "transcript", ticketNo: number, transcriptNo: number, page?: number }
}
export type TicketQueryResult = { type: "settings", settings: TicketSettings } | { type: "categories", categories: TicketCategorySummary[] } | { type: "category", category: TicketCategorySummary } | { type: "category-config", category: TicketCategory } | { type: "intake", intake: TicketIntake } | { type: "intakes", intakes: TicketIntake[], nextBeforeIntakeNo?: number } | { type: "ticket", ticket: TicketRecord } | { type: "locate", ticket: TicketLocator } | { type: "private-intake", ticketNo: number, questions: string[], answers: string[], erased: boolean } | { type: "tickets", tickets: TicketRecord[], nextBeforeTicketNo?: number } | { type: "entries", entries: TicketEntry[], nextBeforeEntryNo?: number } | { type: "attempt", attempt: TicketAttempt } | { type: "transcripts", transcripts: TicketTranscript[], nextBeforeTranscriptNo?: number } | { type: "transcript", transcript: TicketTranscript, page: number, text: string }
export type TicketBinding = { serverId: string, ticketNo: number, generation: number, attemptId: string, sourceId: string }
export type TicketDispatchRequest = TicketBinding & { claimToken: string, context: TicketContext }
export type TicketDispatchResult = { claimed: boolean, dispatchExpiresAt: number, nativeDeadlineMs: 5000 }
export type TicketOutcomeRequest = TicketBinding & { claimToken?: string, outcome: "succeeded" | "failed" | "uncertain", noDispatch?: true, channelId?: string, channel?: TicketChannelSnapshot, messageId?: string, observedAt?: number, channelAbsent?: true, nativeDeleteConfirmed?: true }
export type TicketOutcomeResult = { recorded: boolean, ticket: TicketRecord, grant?: TicketActionGrant }
export type TicketReconcileRequest = TicketSource & { ticketNo: number, expectedGeneration: number, attemptId: string, observation: ServerOrigin & { observedAt: number, channelId: string, channelAbsent: boolean, channel?: TicketChannelSnapshot } }
export type TicketReconcileResult = { recorded: boolean, ticket: TicketRecord }
export type TicketTranscriptUploadRequest = TicketSource & { ticketNo: number, expectedGeneration: number, capturedAt: number, messages: TicketTranscriptMessage[], truncated: boolean }
export type TicketTranscriptUploadResult = { duplicate: boolean, transcript: TicketTranscript }

export type LevelingMapping = { level: number, roleId: string }
export type LevelingFence = { scoreEpoch: number, adjustmentRevision: number, mappingRevision: number }
export type LevelingSettings = { enabled: boolean, xpPerMessage: number, cooldownSeconds: number, excludedChannelIds: string[], excludedRoleIds: string[], revision: number, mappingRevision: number, scoreEpoch: number, mappings: LevelingMapping[] }
export type LevelingMemberContext = ServerOrigin & { userId: string, joinedAt: string, roleIds: string[], isBot: boolean, timeoutUntil: string | null }
export type LevelingCandidate = { messageId: string, createdAt: number, userId: string, channelId: string, digest: string }
export type LevelingProfile = { userId: string, xp: number, level: number, nextLevelXp: number | null, fence: LevelingFence }
export type LevelingAudit = { auditNo: number, actorId: string, userId?: string, beforeXp?: number, afterXp?: number, reason: string, createdAt: number, type: "adjust" | "reset-member" | "reset-server", scoreEpoch: number }
export type LevelingManageOperation =
    | { type: "settings", expectedRevision: number, patch: Partial<Pick<LevelingSettings, "enabled" | "xpPerMessage" | "cooldownSeconds" | "excludedChannelIds" | "excludedRoleIds">> }
    | { type: "mappings", expectedMappingRevision: number, mappings: LevelingMapping[], roles: RolesRoleSnapshot[] }
    | { type: "adjust", userId: string, xp: number, reason: string }
    | { type: "reset-member", userId: string, confirm: "reset-member", reason: string }
    | { type: "reset-server", confirm: "reset-server", reason: string }
    | { type: "reconcile", userId?: string }
export type LevelingManageRequest = ModerationSource & { serverId: string, actor: ModerationActor, operation: LevelingManageOperation }
export type LevelingManageResult = { duplicate: true } | { duplicate: false, type: "settings", settings: LevelingSettings } | { duplicate: false, type: "profile", profile: LevelingProfile, audit: LevelingAudit } | { duplicate: false, type: "reset", settings: LevelingSettings, audit: LevelingAudit } | { duplicate: false, type: "reconcile", queued: boolean }
export type LevelingLeaderboardCursor = { xp: number, userId: string, scoreEpoch: number }
export type LevelingQueryRequest = { serverId: string, actor: ModerationActor, member: LevelingMemberContext, observedAt: number, operation:
    | { type: "settings" }
    | { type: "rank", userId?: string }
    | { type: "leaderboard", cursor?: LevelingLeaderboardCursor }
    | { type: "status" }
    | { type: "audits", beforeAuditNo?: number }
}
export type LevelingQueryResult = { type: "settings", settings: LevelingSettings } | { type: "rank", profile: LevelingProfile, rank: { type: "exact", position: number } | { type: "outside-top-1000" } | { type: "unranked" } } | { type: "leaderboard", profiles: LevelingProfile[], nextCursor?: LevelingLeaderboardCursor } | { type: "status", dirty: number, sweepPending: boolean, profiles: number } | { type: "audits", audits: LevelingAudit[], nextBeforeAuditNo?: number }
export type LevelingPreflightRequest = { serverId: string, candidate: LevelingCandidate }
export type LevelingRejectReason = "disabled" | "stale" | "excluded" | "cooldown" | "duplicate" | "capacity" | "policy" | "membership" | "fence"
export type LevelingPreflightResult = { eligible: false, reason: LevelingRejectReason } | { eligible: true, policyRevision: number, fence: LevelingFence }
export type LevelingAwardRequest = LevelingPreflightRequest & { policyRevision: number, fence: LevelingFence, member: LevelingMemberContext, observedAt: number }
export type LevelingAwardResult = { awarded: false, reason: LevelingRejectReason } | { awarded: true, xpAdded: number, profile: LevelingProfile, rewardQueued: boolean }
export type LevelingRewardAccount = { userId: string, mark: number, refs: { roleId: string, joinedAt: string }[], targets: { roleId: string, sourceId: string }[], complete: boolean }
export type LevelingWorkRequest = { serverId: string, operation:
    | { type: "list" }
    | (ServerOrigin & { type: "skip", userId: string, mark: number, roleId: string, joinedAt: string, observedAt: number, currentJoinedAt: string | null, memberAbsent?: true, memberUserId?: string })
    | { type: "done", userId: string, mark: number, complete: boolean }
}
export type LevelingWorkResult = { type: "accounts", accounts: LevelingRewardAccount[], sweepPending: boolean } | { type: "progress", recorded: boolean }

export type PublishingSource = { type: "dashboard-message", jobId: string, createdAt: number } | { type: "dashboard-role", jobId: string, createdAt: number } | { type: "dashboard-configuration", jobId: string, family: "events", createdAt: number } | { type: "human", messageId: string, createdAt: number } | { type: "event-timer", deliveryId: string, dueAt: number } | { type: "schedule-timer", deliveryId: string, dueAt: number } | { type: "milestone-timer", deliveryId: string, dueAt: number } | ({ type: "suggestion-card" } & SuggestionsCardBinding)
export type PublishingEventConsumer = { type: "event", eventNo: number, revision: number, purpose: "card" | "reminder", occurrenceNo?: number, offsetMinutes?: number, deliveryId?: string }
export type PublishingProvenance = { type: "dashboard-message", jobId: string } | { type: "dashboard-role", jobId: string, panelName: string, panelRevision: number } | { type: "draft", kind: PublishingKind, name: string, revision: number } | { type: "event", eventNo: number, revision: number, template?: { name: string, revision: number } } | { type: "schedule", scheduleNo: number, planRevision: number, source: SchedulesContentSource } | { type: "milestone", kind: MilestonesKind, intentRevision: number, template: MilestonesTemplateSource } | ({ type: "suggestion-card" } & SuggestionsCardBinding)
export type PublishingScheduleConsumer = { type: "schedule", scheduleNo: number, planRevision: number, occurrenceNo: number, deliveryId: string }
export type PublishingConsumer = PublishingEventConsumer | PublishingScheduleConsumer | PublishingMilestoneConsumer | PublishingSuggestionConsumer

export type MilestonesKind = "birthday" | "anniversary"
export type MilestonesContext = SchedulesContext
export type MilestonesTemplateSource = { name: string, revision: number }
export type MilestonesSettings = { enabled: boolean, revision: number, activatedAt: number }
export type MilestonesRoute = { kind: MilestonesKind, revision: number, intentRevision: number, audienceGeneration: number, createdBy: string, channelId: string, zone: string, time: string, fold: CivilFoldPolicy, template: MilestonesTemplateSource, content: PublishingContent, canonicalContent: PublishingContent, enabled: boolean, activatedAt: number, createdAt: number, updatedAt: number }
export type MilestonesDmIdentity = ServerOrigin & { userId: string, channelId: string, isDirectMessage: true, isBot: false, observedAt: number }
export type MilestonesParticipantContext = ServerOrigin & { observedAt: number, channelId: string, botId: string, member: EventsMemberContext, userName: string, serverName: string }
export type MilestonesDeliveryContext = { automation: SchedulesAutomationContext, participant: MilestonesParticipantContext }
export type MilestonesEnrollment = { kind: MilestonesKind, revision: number, joinedAt: string, audienceGeneration: number, channelId: string, consentedAt: number, monthDay?: string, needsReconsent: boolean }
export type MilestonesPersonalRequest = ModerationSource & { serverId: string, identity: MilestonesDmIdentity, operation:
    | { type: "me" }
    | { type: "enroll", kind: "birthday", monthDay: string, confirmChannelId: string, participant: MilestonesParticipantContext }
    | { type: "enroll", kind: "anniversary", confirmChannelId: string, participant: MilestonesParticipantContext }
    | { type: "remove", kind: MilestonesKind | "all" }
}
export type MilestonesPersonalResult = { duplicate: true } | { duplicate: false, type: "me", enrollments: MilestonesEnrollment[], routes: MilestonesRoute[] } | { duplicate: false, type: "enrollment", enrollment: MilestonesEnrollment } | { duplicate: false, type: "removed", removed: number }
export type MilestonesDeliveryBinding = { deliveryId: string, kind: MilestonesKind, intentRevision: number, userId: string, joinedAt: string, consentRevision: number, audienceGeneration: number, celebrationYear: number, completedYears: number, generation: number }
export type PublishingMilestoneConsumer = MilestonesDeliveryBinding & { type: "milestone" }
export type MilestonesDeliveryState = SchedulesDeliveryState
export type MilestonesDeliveryReason = SchedulesDeliveryReason | "consent" | "membership" | "civil-gap" | "civil-fold" | "consumed"
export type MilestonesDelivery = MilestonesDeliveryBinding & { channelId: string, zone: string, dueAt: number, offsetMinutes: number, state: MilestonesDeliveryState, nextCheckAt: number, claimedAt?: number, postNo?: number, attemptId?: string, reason?: MilestonesDeliveryReason }
export type MilestonesDeliveryGrant = PublishingGrant & { source: Extract<PublishingSource, { type: "milestone-timer" }>, provenance: Extract<PublishingProvenance, { type: "milestone" }>, consumer: PublishingMilestoneConsumer }
export type MilestonesManageOperation =
    | { type: "settings", expectedRevision: number, enabled: boolean }
    | { type: "configure", kind: MilestonesKind, expectedRevision: number, channelId: string, zone: string, time: string, fold: CivilFoldPolicy, template: MilestonesTemplateSource }
    | { type: "enable" | "disable" | "clear", kind: MilestonesKind, expectedRevision: number }
    | { type: "reconcile", binding: MilestonesDeliveryBinding, attemptId: string, expectedGeneration: number, observation: PublishingObservation }
    | { type: "forget", binding: MilestonesDeliveryBinding, confirm: "forget" }
export type MilestonesManageRequest = ModerationSource & { serverId: string, context: MilestonesContext, operation: MilestonesManageOperation }
export type MilestonesManageResult = { duplicate: true } | { duplicate: false, type: "settings", settings: MilestonesSettings } | { duplicate: false, type: "route", route: MilestonesRoute } | { duplicate: false, type: "cleared", kind: MilestonesKind } | { duplicate: false, type: "reconciled", recorded: boolean, post: PublishingPost } | { duplicate: false, type: "forgotten", removed: number }
export type MilestonesQueryRequest = { serverId: string, context: MilestonesContext, operation:
    | { type: "settings" | "status" }
    | { type: "preview", kind: MilestonesKind }
    | { type: "deliveries", kind: MilestonesKind, cursor?: string }
}
export type MilestonesQueryResult = { type: "settings", settings: MilestonesSettings, routes: MilestonesRoute[] } | { type: "status", settings: MilestonesSettings, routes: MilestonesRoute[], accounts: number, enrollments: number, deliveries: number, staffReceipts: number, memberReceipts: number, publishing: { enabled: boolean }, limits: { accounts: 1000, slotsPerAccount: 2, deliveries: 4000, staffReceipts: 1000, memberReceipts: 10000 } } | { type: "preview", route: MilestonesRoute, content: PublishingContent } | { type: "deliveries", deliveries: MilestonesDelivery[], nextCursor?: string }
export type MilestonesDeliveryCursor = { cursor: string, throughAt: number }
export type MilestonesMemberCursor = { cursor: string, userId: string, joinedAt: string, observedAt: number }
export type MilestonesMembershipObservation = ServerOrigin & ({ observedAt: number, userId: string, status: "absent" } | { observedAt: number, userId: string, status: "present", joinedAt: string })
export type MilestonesMemberTarget = { kind: MilestonesKind, userId: string, joinedAt: string, consentRevision: number, consentedAt: number }
export type MilestonesDeliveryRequest = { serverId: string, operation:
    | { type: "list", cursor?: MilestonesDeliveryCursor }
    | { type: "reserve", binding: MilestonesDeliveryBinding, context: MilestonesDeliveryContext }
    | { type: "defer", binding: MilestonesDeliveryBinding }
    | { type: "membership", binding: MilestonesDeliveryBinding, observation: MilestonesMembershipObservation, cursor?: MilestonesMemberCursor }
    | { type: "member-targets", userId: string, cursor?: string }
    | { type: "member-observation", target: MilestonesMemberTarget, observation: MilestonesMembershipObservation }
}
export type MilestonesDeliveryResult = { type: "deliveries", deliveries: MilestonesDelivery[], hasMore: boolean, nextCursor?: MilestonesDeliveryCursor } | { type: "reservation", status: "reserved", grant: MilestonesDeliveryGrant } | { type: "reservation", status: "waiting" | "skipped" | "cancelled" | "terminal" } | { type: "progress", recorded: boolean, hasMore?: boolean, nextCursor?: MilestonesMemberCursor } | { type: "member-targets", targets: MilestonesMemberTarget[], hasMore: boolean, nextCursor?: string }

export type CivilFoldPolicy = "reject" | "earlier" | "later"
export type CivilRecurrence = { type: "none" } | { type: "daily" | "weekly", interval: number, count: number }
export type CivilResolvedDate = { localMinute: string, instantAt: number, offsetMinutes: number }
export type CivilCalendar = { localMinute: string, zone: string, fold: CivilFoldPolicy, recurrence: CivilRecurrence, dates: CivilResolvedDate[] }
export type SchedulesResolvedDate = { localMinute: string, dueAt: number, offsetMinutes: number }
export type SchedulesCalendar = Omit<CivilCalendar, "dates"> & { dates: SchedulesResolvedDate[] }
export type SchedulesMemberContext = EventsMemberContext
export type SchedulesContext = ServerOrigin & { observedAt: number, actor: ModerationActor, channelId: string, botId: string, botAuthorized: boolean, actorAuthorized: boolean, member?: SchedulesMemberContext }
export type SchedulesAutomationContext = ServerOrigin & { observedAt: number, channelId: string, botId: string, botAuthorized: true }
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

export type EventsChoice = "going" | "maybe" | "not-going" | "none"
export type EventsLifecycle = "draft" | "open" | "started" | "completed" | "cancelled"
export type EventsFoldPolicy = "reject" | "earlier" | "later"
export type EventsRecurrence = { type: "none" } | { type: "daily" | "weekly", interval: number, count: number }
export type EventsResolvedDate = { localMinute: string, startsAt: number, endsAt: number, offsetMinutes: number }
export type EventsCalendar = { localMinute: string, zone: string, fold: EventsFoldPolicy, durationMinutes: number, recurrence: EventsRecurrence, dates: EventsResolvedDate[] }
export type EventsMemberContext = ServerOrigin & { userId: string, joinedAt: string, roleIds: string[], isBot: boolean, timeoutUntil: string | null, canView: boolean, canReadHistory: boolean }
export type EventsContext = ServerOrigin & { observedAt: number, actor: ModerationActor, channelId: string, botId: string, botAuthorized: boolean, actorAuthorized: boolean, member?: EventsMemberContext }
export type EventsSettings = { enabled: boolean, revision: number }
export type EventsDefinition = { eventNo: number, name: string, revision: number, channelId: string, title: string, description: string, capacity: number | null, reminderOffsets: number[], state: EventsLifecycle, participationStarted: boolean, calendar?: EventsCalendar, template?: { name: string, revision: number, content: PublishingContent }, cardPostNo?: number, createdAt: number, updatedAt: number }
export type EventsOccurrence = EventsResolvedDate & { eventNo: number, occurrenceNo: number, revision: number, state: EventsLifecycle, participationStarted: boolean, going: number, waitlisted: number, capacity: number | null, workGeneration: number }
export type EventsRsvp = { eventNo: number, occurrenceNo: number, userId: string, joinedAt: string, membershipGeneration: number, revision: number, choice: EventsChoice, allocation: "seat" | "waitlist" | "none", queueOrder?: number, acceptedCreatedAt: number, acceptedMessageId: string }
export type EventsSource = ModerationSource & { serverId: string, context: EventsContext }
export type EventsManageOperation =
    | { type: "settings", expectedRevision: number, enabled: boolean }
    | { type: "create", name: string, title: string, description?: string, channelId: string }
    | { type: "calendar", eventNo: number, expectedRevision: number, calendar: EventsCalendar }
    | { type: "content", eventNo: number, expectedRevision: number, title: string, description: string }
    | { type: "capacity", eventNo: number, expectedRevision: number, capacity: number | null }
    | { type: "reminders", eventNo: number, expectedRevision: number, offsets: number[] }
    | { type: "template", eventNo: number, expectedRevision: number, templateName: string | null, expectedTemplateRevision?: number }
    | { type: "publish" | "cancel" | "reconcile", eventNo: number, expectedRevision: number }
    | { type: "forget", eventNo: number, expectedRevision: number, confirm: "forget" }
export type EventsManageRequest = EventsSource & { operation: EventsManageOperation }
export type EventsManageResult = { duplicate: true } | { duplicate: false, type: "settings", settings: EventsSettings } | { duplicate: false, type: "event", event: EventsDefinition, grant?: EventsDeliveryGrant } | { duplicate: false, type: "forgotten", eventNo: number, complete: boolean, removed: number }
export type EventsQueryRequest = { serverId: string, context: EventsContext, operation:
    | { type: "settings" | "status" }
    | { type: "list", beforeEventNo?: number }
    | { type: "show", eventNo: number }
    | { type: "dates", eventNo: number, afterOccurrenceNo?: number }
    | { type: "attendees", eventNo: number, occurrenceNo: number, afterUserId?: string }
}
export type EventsQueryResult = { type: "settings", settings: EventsSettings } | { type: "status", settings: EventsSettings, definitions: number, occurrences: number, rsvps: number, receipts: number } | { type: "events", events: EventsDefinition[], nextBeforeEventNo?: number } | { type: "event", event: EventsDefinition } | { type: "dates", dates: EventsOccurrence[], nextAfterOccurrenceNo?: number } | { type: "attendees", attendees: EventsRsvp[], nextAfterUserId?: string }
export type EventsRsvpRequest = EventsSource & { eventNo: number, occurrenceNo: number, choice: EventsChoice }
export type EventsRsvpResult = { duplicate: boolean, accepted: boolean, rsvp: EventsRsvp | null, occurrence: EventsOccurrence }
export type EventsPromotionJob = { eventNo: number, occurrenceNo: number, revision: number, generation: number, nextCheckAt: number, channelId: string }
export type EventsPromotionBinding = { eventNo: number, occurrenceNo: number, revision: number, generation: number, claimToken: string, rsvpRevision: number, membershipGeneration: number, userId: string, joinedAt: string, queueOrder: number }
export type EventsMemberTarget = { eventNo: number, occurrenceNo: number, revision: number, generation: number, userId: string, joinedAt: string, membershipGeneration: number, rsvpRevision: number }
export type EventsMemberCursor = { eventNo: number, occurrenceNo: number }
export type EventsWorkRequest = { serverId: string, operation:
    | { type: "list", cursor?: EventsMemberCursor, limit?: number }
    | { type: "member-targets", userId: string, cursor?: EventsMemberCursor }
    | { type: "claim", eventNo: number, occurrenceNo: number, revision: number, generation: number, claimToken: string }
    | { type: "promote", binding: EventsPromotionBinding, context: EventsContext }
    | { type: "defer", binding: EventsPromotionBinding }
    | (ServerOrigin & { type: "observe", observedAt: number, memberAbsent: true } & EventsMemberTarget)
}
export type EventsWorkResult = { type: "jobs", jobs: EventsPromotionJob[], nextCursor?: EventsMemberCursor } | { type: "member-targets", targets: EventsMemberTarget[], nextCursor?: EventsMemberCursor } | { type: "head", claimed: false } | { type: "head", claimed: true, binding: EventsPromotionBinding, leaseExpiresAt: number } | { type: "progress", recorded: boolean, promoted?: boolean }
export type EventsAutomationContext = ServerOrigin & { observedAt: number, channelId: string, botId: string, botAuthorized: true }
export type EventsDeliveryBinding = { deliveryId: string, eventNo: number, occurrenceNo: number, revision: number, offsetMinutes: number }
export type EventsDelivery = EventsDeliveryBinding & { dueAt: number, startsAt: number, state: "queued" | "blocked" | "reserved" | "sent" | "failed" | "uncertain" | "skipped" | "cancelled", nextCheckAt: number, channelId: string, postNo?: number, attemptId?: string }
export type EventsDeliveryGrant = PublishingGrant & { source: PublishingSource, provenance: Extract<PublishingProvenance, { type: "event" }>, consumer: PublishingEventConsumer }
export type EventsDeliveryRequest = { serverId: string, operation:
    | { type: "list", beforeDueAt?: number }
    | { type: "status", eventNo: number, afterDeliveryId?: string }
    | { type: "show", eventNo: number }
    | { type: "reserve", binding: EventsDeliveryBinding, context: EventsAutomationContext }
    | { type: "defer", binding: EventsDeliveryBinding }
}
export type EventsDeliveryResult = { type: "event", event: EventsDefinition } | { type: "deliveries", deliveries: EventsDelivery[], nextAfterDeliveryId?: string } | { type: "reservation", status: "reserved", grant: EventsDeliveryGrant } | { type: "reservation", status: "waiting" | "skipped" | "cancelled" | "terminal" } | { type: "progress", recorded: boolean }

export type SuggestionsContext = EventsContext
export type SuggestionsCardContext = ServerOrigin & { observedAt: number, channelId: string, botId: string, botAuthorized: true }
export type SuggestionsState = "under-review" | "planned" | "completed" | "declined" | "withdrawn"
export type SuggestionsVoteChoice = "up" | "down" | "clear"
export type SuggestionsSettings = { enabled: boolean, revision: number, channelId?: string, suggestions: number, voters: number, staffReceipts: number, memberReceipts: number, dirty: number, blocked: number }
export type SuggestionsDefinition = {
    suggestionNo: number, revision: number, authorId: string, channelId: string, text: string, state: SuggestionsState,
    up: number, down: number, voters: number, desiredRevision: number, publishedRevision: number, cardGeneration: number,
    cardState: "queued" | "reserved" | "current" | "blocked", cardStale: boolean, createdAt: number, updatedAt: number,
    reason?: string, statusBy?: string, statusAt?: number, historyExpiresAt?: number, forgetting: boolean, postNo?: number, attemptId?: string,
}
export type SuggestionsVote = { choice: SuggestionsVoteChoice, joinedAt: string, acceptedCreatedAt: number, acceptedMessageId: string }
export type SuggestionsCardBinding = { suggestionNo: number, cardGeneration: number, desiredRevision: number }
export type PublishingSuggestionConsumer = { type: "suggestion-card" } & SuggestionsCardBinding
export type SuggestionsCardGrant = PublishingGrant & { source: Extract<PublishingSource, { type: "suggestion-card" }>, provenance: Extract<PublishingProvenance, { type: "suggestion-card" }>, consumer: PublishingSuggestionConsumer }
export type SuggestionsWorkRow = SuggestionsCardBinding & { channelId: string, dueAt: number, nextCheckAt: number, state: "queued" | "reserved" | "blocked", postNo?: number, attemptId?: string }
export type SuggestionsWorkCursor = { cursor: string, throughAt: number }
export type SuggestionsPostBinding = { suggestionNo: number, expectedRevision: number, cardGeneration: number, postNo: number, attemptId: string, expectedGeneration: number }
export type SuggestionsMissingObservation = ServerOrigin & { status: "absent", observedAt: number, messageId: string, channelId: string, botId: string }
export type SuggestionsManageOperation =
    | { type: "configure", expectedRevision: number, channelId: string }
    | { type: "settings", expectedRevision: number, enabled: boolean }
    | { type: "status", suggestionNo: number, expectedRevision: number, state: Exclude<SuggestionsState, "withdrawn">, reason: string }
    | ({ type: "reconcile", observation: PublishingObservation } & SuggestionsPostBinding)
    | ({ type: "replace", observation: SuggestionsMissingObservation, confirm: true } & SuggestionsPostBinding)
    | { type: "forget", suggestionNo: number, expectedRevision: number, confirm: true }
export type SuggestionsManageRequest = ModerationSource & { serverId: string, context: SuggestionsContext, operation: SuggestionsManageOperation }
export type SuggestionsManageResult = { duplicate: true } | { duplicate: false } & (
    { type: "settings", settings: SuggestionsSettings } | { type: "suggestion", suggestion: SuggestionsDefinition }
    | { type: "reconciled", recorded: boolean, suggestion: SuggestionsDefinition, post: PublishingPost }
    | { type: "forgotten", suggestionNo: number, revision: number, complete: boolean, removed: number })
export type SuggestionsMemberRequest = ModerationSource & { serverId: string, context: SuggestionsContext, operation:
    | { type: "submit", text: string }
    | { type: "vote", suggestionNo: number, choice: SuggestionsVoteChoice }
    | { type: "withdraw", suggestionNo: number, expectedRevision: number, confirm: true } }
export type SuggestionsMemberResult = { duplicate: boolean, type: "suggestion", suggestion: SuggestionsDefinition }
    | { duplicate: boolean, type: "vote", accepted: boolean, vote: SuggestionsVote | null, suggestion: SuggestionsDefinition }
export type SuggestionsQueryRequest = { serverId: string, context: SuggestionsContext, operation:
    | { type: "settings" }
    | { type: "show", suggestionNo: number }
    | { type: "list", state?: SuggestionsState, beforeSuggestionNo?: number }
    | { type: "mine", suggestionNo: number }
    | { type: "publication", suggestionNo: number } }
export type SuggestionsQueryResult = { type: "settings", settings: SuggestionsSettings }
    | { type: "suggestion", suggestion: SuggestionsDefinition }
    | { type: "suggestions", suggestions: SuggestionsDefinition[], nextBeforeSuggestionNo?: number }
    | { type: "vote", vote: SuggestionsVote | null, suggestion: SuggestionsDefinition }
    | { type: "publication", suggestion: SuggestionsDefinition, post: PublishingPost | null }
export type SuggestionsWorkRequest = { serverId: string, operation:
    | { type: "list", cursor?: SuggestionsWorkCursor }
    | { type: "reserve", binding: SuggestionsCardBinding, context: SuggestionsCardContext }
    | { type: "defer", binding: SuggestionsCardBinding } }
export type SuggestionsWorkResult = { type: "cards", cards: SuggestionsWorkRow[], hasMore: boolean, nextCursor?: SuggestionsWorkCursor }
    | { type: "reserved", grant: SuggestionsCardGrant }
    | { type: "progress", recorded: boolean }

export type CleanupContext = ServerOrigin & {
    observedAt: number, actor: ModerationActor, member: EventsMemberContext,
    channelId: string, channelType: 0 | 5, botId: string, botAuthorized: boolean, actorAuthorized: boolean,
    actorKind: "human" | "bot" | "unknown", botKind: "bot" | "unknown", botMember: EventsMemberContext,
}
export type CleanupMessage = ServerOrigin & {
    messageId: string, channelId: string, serverId: string | null, observedAt: number, createdAt: string | null,
    authorId: string | null, authorBot: boolean | null, authorSystem: boolean | null,
    type: number | null, pinned: boolean | null, webhookId: string | null,
}
export type CleanupSkipReason = "pinned" | "pin-unknown" | "bot" | "webhook" | "system" | "identity-unknown" | "timestamp-unknown" | "too-new" | "excluded-author" | "excluded-message" | "protected" | "retained-attempt"
export type CleanupCounts = { scanned: number, skipped: number, attempted: number, submitted: number, acknowledged: number, observedAbsent: number, unresolved: number, failed: number, cancelled: number }
export type CleanupSettings = { enabled: boolean, revision: number, policies: number, retainedTargets: number, retainedSweeps: number, receipts: number, targetCapacity: 10000, quotaPaused: boolean }
export type CleanupPolicy = { channelId: string, revision: number, enabled: boolean, ageMs: number, ownerId: string, excludedAuthorIds: string[], excludedMessageIds: string[], nextCheckAt: number, sweepNo?: number, blockedReason?: string }
export type CleanupSweepBinding = { channelId: string, policyRevision: number, moduleRevision: number, sweepNo: number }
export type CleanupSweep = CleanupSweepBinding & { ownerId: string, cutoffAt: number, before: string, pageNo: number, state: "active" | "complete" | "cancelled", counts: CleanupCounts, createdAt: number, updatedAt: number }
export type CleanupPageItem = { message: CleanupMessage, disposition: "eligible" | "skipped", reason?: CleanupSkipReason, targetNo?: number }
export type CleanupPage = CleanupSweepBinding & { pageNo: number, before: string, nextBefore?: string, empty: boolean, items: CleanupPageItem[], persistedAt: number }
export type CleanupTargetBinding = CleanupSweepBinding & { pageNo: number, targetNo: number, messageId: string }
export type CleanupTargetState = "queued" | "reserved" | "deleted" | "failed" | "uncertain" | "absent" | "skipped" | "cancelled"
export type CleanupGrant = CleanupTargetBinding & { ownerId: string, botId: string, cutoffAt: number, createdAt: string, authorId: string, dispatchExpiresAt: number, nativeDeadlineMs: 5000 }
export type CleanupObservation = ServerOrigin & { messageId: string, channelId: string, observedAt: number, status: "present" | "absent" | "unknown", channelVisible: boolean }
export type CleanupTarget = CleanupTargetBinding & { ownerId: string, state: CleanupTargetState, message: CleanupMessage, createdAt: number, updatedAt: number, grant?: CleanupGrant, claimedAt?: number, finishedAt?: number, noDispatch?: true, expiresAt?: number, reason?: string, observation?: CleanupObservation, lateOutcome?: "deleted" | "failed" | "uncertain", reassessedAt?: number }
export type CleanupManageOperation =
    | { type: "module", expectedRevision: number, enabled: boolean }
    | { type: "configure", channelId: string, expectedRevision: number, ageMs: number }
    | { type: "enable", channelId: string, expectedRevision: number, enabled: boolean, confirm?: true }
    | { type: "exclude", channelId: string, expectedRevision: number, kind: "author" | "message", id: string, add: boolean }
    | { type: "owner", channelId: string, expectedRevision: number, ownerId: string, recipientOwner: CleanupContext }
    | { type: "reconcile", binding: CleanupTargetBinding, observation: CleanupObservation }
    | { type: "forget", channelId: string, confirm: true }
export type CleanupManageRequest = ModerationSource & { serverId: string, context: CleanupContext, operation: CleanupManageOperation }
export type CleanupManageResult = { duplicate: true } | { duplicate: false } & (
    { type: "settings", settings: CleanupSettings } | { type: "policy", policy: CleanupPolicy }
    | { type: "reconciled", recorded: boolean, target: CleanupTarget } | { type: "forgotten", removed: number, complete: boolean })
export type CleanupQueryRequest = { serverId: string, context: CleanupContext, operation:
    | { type: "settings" } | { type: "list" } | { type: "show", channelId: string }
    | { type: "status", channelId: string, beforeTargetNo?: number }
    | { type: "preview", channelId: string, messages: CleanupMessage[] } }
export type CleanupQueryResult = { type: "settings", settings: CleanupSettings } | { type: "policies", policies: CleanupPolicy[] }
    | { type: "policy", policy: CleanupPolicy }
    | { type: "status", settings: CleanupSettings, policy: CleanupPolicy, sweep: CleanupSweep | null, page: CleanupPage | null, targets: CleanupTarget[], nextBeforeTargetNo?: number }
    | { type: "preview", cutoffAt: number, eligible: number, skipped: number, unknown: number, items: CleanupPageItem[] }
export type CleanupWorkCursor = { cursor: string, throughAt: number }
export type CleanupWorkRequest = { serverId: string, operation:
    | { type: "list", cursor?: CleanupWorkCursor }
    | { type: "start", channelId: string, expectedRevision: number, context: CleanupContext }
    | { type: "page", binding: CleanupSweepBinding, pageNo: number, before: string, messages: CleanupMessage[], context: CleanupContext }
    | { type: "advance", binding: CleanupSweepBinding, pageNo: number }
    | { type: "defer", channelId: string, expectedRevision: number, reason: "authority" | "history" | "malformed" | "quota" | "target" }
    | { type: "reserve", binding: CleanupTargetBinding, message: CleanupMessage, context: CleanupContext }
    | { type: "claim", binding: CleanupTargetBinding, message: CleanupMessage, context: CleanupContext, claimToken: string }
    | { type: "check", binding: CleanupTargetBinding, message: CleanupMessage, context: CleanupContext, claimToken: string }
    | { type: "outcome", binding: CleanupTargetBinding, outcome: "deleted" | "failed" | "uncertain" | "absent" | "skipped", claimToken?: string, noDispatch?: true, observation?: CleanupObservation }
    | { type: "recover", binding: CleanupTargetBinding, observation: CleanupObservation }
    | { type: "recovery", beforeTargetNo?: number } }
export type CleanupWorkResult = { type: "policies", policies: CleanupPolicy[], hasMore: boolean, nextCursor?: CleanupWorkCursor, settings: CleanupSettings }
    | { type: "sweep", sweep: CleanupSweep, page: CleanupPage | null, targets: CleanupTarget[] }
    | { type: "page", page: CleanupPage | null, targets: CleanupTarget[], quotaPaused: boolean }
    | { type: "reserved", grant: CleanupGrant } | { type: "claimed", claimed: boolean, grant: CleanupGrant }
    | { type: "target", recorded: boolean, target: CleanupTarget }
    | { type: "progress", recorded: boolean, complete: boolean }
    | { type: "recovery", targets: CleanupTarget[], nextBeforeTargetNo?: number }
export type MetadataLogsCategory = "membership" | "resources" | "messages" | "audit" | "settings" | "operations"
export type MetadataLogsEventType = "member-add" | "member-update" | "member-remove" | "role-create" | "role-update" | "role-delete" | "channel-create" | "channel-update" | "channel-delete" | "server-update" | "message-update" | "message-delete" | "message-bulk-delete" | "audit-entry" | "settings-change" | "backend-failure" | "admission-failure" | "delivery-failure" | "gateway-discontinuity"
export type MetadataLogsSource = { kind: "audit", auditEntryId: string } | { kind: "message-delete", messageId: string } | { kind: "member-add", userId: string, joinedAt: string } | { kind: "observation", sessionId: string, sequence: number } | { kind: "settings", messageId: string, scope: "moderation" | "metadata" | "security" } | { kind: "dashboard", jobId: string, scope: "metadata" | "roles" | "responses" | "moderation" | "publishing" | "greetings" | "tickets" | "leveling" | "milestones" | "suggestions" | "cleanup" | "events" | "schedules" } | { kind: "dashboard-setting", scope: "general" | "responses", revision: number }
export type MetadataLogsActor = { kind: "unknown" } | { kind: "audit" | "configuration", userId: string }
export interface MetadataLogsEvent extends ServerOrigin {
    category: MetadataLogsCategory
    type: MetadataLogsEventType
    source: MetadataLogsSource
    observedAt: number
    actor: MetadataLogsActor
    resourceIds: string[]
    changedFields: string[]
    count: number
    channelId?: string
    authorBot?: boolean | null
    privateChannel?: boolean
    auditAction?: number
    outcome?: "observed" | "accepted" | "failed" | "disconnected" | "reconnected"
}
/** actorAuthorized is destination View/Send, botAuthorized is View/Send/Embed/History. Neither is inferred from administrator status */
export type MetadataLogsContext = Omit<CleanupContext, "channelType"> & { channelType: 0 | 1 | 5 }
export interface MetadataLogsPrivateRead extends ServerOrigin { channelId: string, recipientIds: string[], oneToOne: true }
export interface MetadataLogsRoute { category: MetadataLogsCategory, revision: number, enabled: boolean, channelId?: string, ownerId?: string }
export type MetadataLogsAuditAction = 1 | 10 | 11 | 12 | 13 | 14 | 15 | 20 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 30 | 31 | 32
export type MetadataLogsEventSelector = MetadataLogsEventType | `audit-entry:${MetadataLogsAuditAction}`
export interface MetadataLogsEventRoute { eventType: MetadataLogsEventSelector, revision: number, enabled: boolean, channelId?: string, ownerId?: string }
export interface MetadataLogsEmbed { title: string, description: string, color: number }
export interface MetadataLogsPresentation { format: "embed-v1", embed: MetadataLogsEmbed }
export interface MetadataLogsSettings {
    enabled: boolean
    revision: number
    routes: MetadataLogsRoute[]
    eventRoutes: MetadataLogsEventRoute[]
    configRevision: number
    messageChannelIds: string[]
    excludedChannelIds: string[]
    retained: number
    admissions: number
    admissionWindowStartedAt: number
    capacity: 10000
    admissionCapacity: 10000
    retentionMs: 2592000000
    quotaPaused: boolean
    refused: number
    suppressed: number
}
export interface MetadataLogsBinding { recordNo: number, routeRevision: number, moduleRevision: number, generation: number, channelId: string, ownerId: string, routeEventType?: MetadataLogsEventSelector }
export type MetadataLogsDeliveryState = "queued" | "reserved" | "sent" | "failed" | "uncertain" | "cancelled"
export interface MetadataLogsGrant extends MetadataLogsBinding { botId: string, dispatchExpiresAt: number, nativeDeadlineMs: 5000, content: string, embed?: MetadataLogsEmbed }
export interface MetadataLogsDelivery extends MetadataLogsBinding {
    state: MetadataLogsDeliveryState
    nextCheckAt: number
    grant?: MetadataLogsGrant
    claimedAt?: number
    finishedAt?: number
    noDispatch?: true
    messageId?: string
    reconciledAt?: number
    resolution?: "match" | "absent"
}
export interface MetadataLogsRecord { recordNo: number, event: MetadataLogsEvent, admittedAt: number, expiresAt: number, presentation?: MetadataLogsPresentation, delivery: MetadataLogsDelivery | null }
export interface MetadataLogsCounters {
    activeTicketSlots: number
    retainedModerationCases: number
    retainedMetadataRecords: number
    categories: Record<MetadataLogsCategory, number>
    queued: number
    reserved: number
    failed: number
    uncertain: number
    refused: number
    suppressed: number
    definitions: { tickets: "Active slots including reserved and recovery work", moderation: "Retained manual, event and critical cases", metadata: "Retained admitted records, not unique causal actions", deliveries: "Current delivery states, independent of event admission" }
}
export interface MetadataLogsDiagnosticItem { key: string, supported: boolean, configured: boolean, enabled: boolean | null, channelId?: string, ownerId?: string, roleIds?: string[], action: string }
export type MetadataLogsDiagnosticSection = "core" | "logging" | "modules" | "destinations"
export type MetadataLogsConfigurationOperation = { type: "module", expectedRevision: number, enabled: boolean } | { type: "route", category: MetadataLogsCategory, expectedRevision: number, enabled: boolean, channelId: string, ownerId: string, recipientOwner: MetadataLogsContext } | { type: "clear", category: MetadataLogsCategory, expectedRevision: number } | { type: "channels", expectedRevision: number, messageChannelIds: string[], excludedChannelIds: string[] } | { type: "event-route", eventType: MetadataLogsEventSelector, expectedRevision: number, enabled: boolean, channelId?: string, ownerId?: string, recipientOwner?: MetadataLogsContext } | { type: "event-clear", eventType: MetadataLogsEventSelector, expectedRevision: number }
export type MetadataLogsManageOperation = MetadataLogsConfigurationOperation | { type: "forget", recordNo: number, confirm: true } | { type: "reconcile", binding: MetadataLogsBinding, observation: MetadataLogsObservation }
export interface MetadataLogsObservation extends ServerOrigin { messageId: string, channelId: string, botId: string, observedAt: number, status: "match" | "absent" | "conflict" | "unknown", content?: string, embed?: MetadataLogsEmbed }
export interface MetadataLogsManageRequest { serverId: string, messageId: string, createdAt: number, context: MetadataLogsContext, operation: MetadataLogsManageOperation }
export type MetadataLogsManageResult = { duplicate: true } | { duplicate: false, type: "settings", settings: MetadataLogsSettings } | { duplicate: false, type: "forgotten", recordNo: number } | { duplicate: false, type: "reconciled", recorded: boolean, record: MetadataLogsRecord }
export interface MetadataLogsAdmitRequest { serverId: string, event: MetadataLogsEvent }
export type MetadataLogsAdmitResult = { admitted: true, duplicate: false, record: MetadataLogsRecord } | { admitted: false, duplicate: boolean, reason: "duplicate" | "disabled" | "excluded" | "quota" | "rate-limited" }
export type MetadataLogsQueryOperation = { type: "settings" } | { type: "list", beforeRecordNo?: number } | { type: "show", recordNo: number } | { type: "counters" } | { type: "diagnose", section: MetadataLogsDiagnosticSection, cursor?: string }
export interface MetadataLogsQueryRequest { serverId: string, context: MetadataLogsContext, privateRead?: MetadataLogsPrivateRead, operation: MetadataLogsQueryOperation }
export type MetadataLogsQueryResult = { type: "settings", settings: MetadataLogsSettings } | { type: "records", records: MetadataLogsRecord[], nextBeforeRecordNo?: number } | { type: "record", record: MetadataLogsRecord } | { type: "counters", counters: MetadataLogsCounters } | { type: "diagnostics", section: MetadataLogsDiagnosticSection, items: MetadataLogsDiagnosticItem[], nextCursor?: string, settings?: MetadataLogsSettings, counters?: MetadataLogsCounters }
export type MetadataLogsWorkOperation = { type: "discover", cursor?: string } | { type: "reserve", binding: MetadataLogsBinding, context: MetadataLogsContext } | { type: "claim", binding: MetadataLogsBinding, context: MetadataLogsContext, claimToken: string } | { type: "defer", binding: MetadataLogsBinding } | { type: "no-dispatch", binding: MetadataLogsBinding } | { type: "outcome", binding: MetadataLogsBinding, claimToken: string, outcome: "sent" | "failed" | "uncertain", messageId?: string, observedAt: number }
export interface MetadataLogsWorkRequest { serverId: string, operation: MetadataLogsWorkOperation }
export type MetadataLogsWorkResult = { type: "work", records: MetadataLogsRecord[], nextCursor?: string } | { type: "reserved", grant: MetadataLogsGrant } | { type: "claimed", claimed: boolean, grant: MetadataLogsGrant } | { type: "record", record: MetadataLogsRecord }
