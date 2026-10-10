/** Single mode names its one server. Multi mode serves the active installations listed by /service/installations/list */
export type ServiceScope = { mode: "single", serverIds: string[] } | { mode: "multi" }
export type ServiceInstallationPage = { serverIds: string[], nextCursor: string | null }
/** welcome is set by the join that starts an installation, either the first or one after a removal, so the bot posts its note once per install */
export type ServiceInstallation = { serverId: string, active: boolean, welcome?: true }
/** Background workers the bot wakes when /service/work reports due work for their server */
export type ServiceWorkKind = "dashboard" | "verification" | "events" | "schedules" | "milestones" | "suggestions" | "cleanup" | "metadata" | "levels" | "temproles" | "helpdesk" | "lfg"
/**
 * Servers with due work per worker, oldest due first. The cursor is opaque and goes back with the next request.
 * nextDueIn is how many milliseconds from now, by the backend clock, the next listed row becomes due, or null when none waits
 */
export type ServiceWork = { kinds: Record<ServiceWorkKind, string[]>, cursor: string | null, nextDueIn: number | null }
/** The bot's work signal. version changes whenever a writer other than the bot creates work for it */
export type ServiceWorkSignal = { version: number }
/**
 * The month's billed calls after a bot usage report, as /service/usage answers it. budget is null when no budget is set.
 * state is paused from 90 percent of the budget and warning from the warning share. warn is true for the month's first report past the warning share
 */
export type ServiceUsage = { month: string, calls: number, budget: number | null, state: "normal" | "warning" | "paused", warn: boolean }
/** Member data rights through /service/member-data. A cursor continues a server's export or deletion where a bounded call stopped */
export type MemberDataCursor = { table: number, after: number }
/** kept names the rule that keeps a feature's data through deletion, or is null when deletion removes it */
export type MemberDataFeatureCount = { feature: string, count: number, kept: string | null }
/** complete is false when a feature held more rows than one read counts, so some counts are lower bounds and servers may be missing */
export type MemberDataList = { servers: Array<{ serverId: string, features: MemberDataFeatureCount[] }>, complete: boolean }
export type MemberDataExportPage = { records: Array<{ feature: string, data: Record<string, unknown> }>, cursor: MemberDataCursor | null }
/** Where a bounded search for the servers that hold a member's data stopped: the table and the last server found in it, or null at its start */
export type MemberDataServerCursor = { table: number, after: string | null }
/** Servers found by one call of /service/member-data/servers. A later page can repeat a server. cursor is null once every table was searched */
export type MemberDataServerPage = { serverIds: string[], cursor: MemberDataServerCursor | null }
export type MemberDataDeletePage ={ deleted: Array<{ feature: string, count: number }>, kept: Array<{ feature: string, count: number, reason: string }>, cursor: MemberDataCursor | null }
/** The readable server export, documented field by field in docs/EXPORT.md. Times are Unix milliseconds */
export type ServerExportLevel = { userId: string, xp: number, level: number }
/** reason is null when the server owner erased the case. Erasure also removes its corrections */
export type ServerExportCase = { caseNo: number, action: string, origin: string, incident?: string, actorId?: string, targetId?: string, channelId?: string, ruleName?: string, linkedCaseNo?: number,
    reason: string | null, outcome: string, voided: boolean, erased: boolean, createdAt: number, corrections: Array<{ type: "reason" | "void", actorId: string, previousReason: string, reason: string, createdAt: number }> }
/** text and decisionReason are null when the server owner erased the appeal's case */
export type ServerExportAppeal = { appealNo: number, caseNo: number, userId: string, status: string, text: string | null, decisionReason?: string | null, decidedBy?: string, decidedAt?: number, erased: boolean, createdAt: number }
/** One bounded page of the export. A settings page after the first of its family holds only the lists that continue. cursor is null after the last page */
export type ServerExportPage = { cursor: string | null } & ({ section: "settings", family: string, data: Record<string, unknown> } | { section: "levels", levels: ServerExportLevel[] }
    | { section: "cases", cases: ServerExportCase[] } | { section: "appeals", appeals: ServerExportAppeal[] })
/** One export file. A large export from chat arrives in parts, each a file of this shape, and lastPart is true on the final one */
export type ServerExportFile = { format: "neonflux-server-export", version: 1, serverId: string, exportedAt: number, part: number, lastPart: boolean,
    settings: Record<string, Record<string, unknown>>, levels: ServerExportLevel[], cases: ServerExportCase[], appeals: ServerExportAppeal[] }
/** A bot mutation's answer. dueIn is set when its writes created work, in milliseconds from now by the backend clock */
export type ServiceMutationResult<T = unknown> = { value: T, dueIn?: number }
export type ServerOrigin = { originServerId?: string }
/** Website viewers waiting for the bot to check their access to private cases, see /private-data/ready */
export type PrivateAccessReady = { checks: Array<{ userId: string }> }
/**
 * The bot's fresh read of one viewer for /private-data/record: whether they own the server and the roles they hold. present is false
 * when they are not a member, and failed reports that Fluxer could not be read
 */
export type PrivateAccessAnswer = { originServerId: string, isOwner: boolean, present: boolean, roleIds: string[] } | { failed: true }

/** The bot's desired display name in one server. Null means no nickname, so Fluxer shows the bot's username */
export interface GeneralNicknameResult { state: "pending" | "applied" | "failed", nickname: string | null, at: number, error?: string }
export interface GeneralNickname { nickname: string | null, revision: number, result: GeneralNicknameResult | null }
export interface GeneralNicknameRequest extends ServerOrigin { serverId: string, actorId: string, managerAuthorized: boolean, createdAt: number, nickname: string | null }
export interface GeneralNicknameResultRequest extends ServerOrigin { serverId: string, revision: number, nickname: string | null, state: "applied" | "failed", error?: string }

export type ResponseKind = "custom" | "auto"

export type BackupCategory = "config" | "xp" | "structure"
export type BackupConfigValues = {
    // Backups made before bot message checks lack automodBotMessagesEnabled
    moderation: Omit<ModerationSettings, "defcon" | "automodBotMessagesEnabled"> & { automodBotMessagesEnabled?: boolean }
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
/** A forum or media channel tag. Tag IDs are not kept, since a restored channel's tags get new ones */
export type BackupForumTag = { name: string, moderated: boolean, emojiId: string | null, emojiName: string | null }
/** Forum and media channels also keep their tags, default reaction, default auto-archive minutes, sort order, the REQUIRE_TAG flag and,
 *  for forums, the layout. Their posts are threads, which are not backed up */
export type BackupStructureObject = { sourceId: string, type: "category" | "text" | "voice" | "forum" | "media", name: string, parentId: string | null, overwrites: BackupOverwrite[], topic?: string | null, nsfw?: boolean, slowmodeSeconds?: number, bitrate?: number, userLimit?: number,
    tags?: BackupForumTag[], defaultReaction?: { emojiId: string | null, emojiName: string | null } | null, defaultAutoArchiveMinutes?: number | null, sortOrder?: number | null, layout?: number, requireTag?: boolean, capturedAt: number }
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
export type BackupQueryRequest = { serverId: string, context: BackupContext, operation: { type: "capabilities" } | { type: "plans", cursor?: string } | { type: "plan", binding: BackupBinding } | { type: "items", binding: BackupBinding, cursor?: string } | { type: "item", binding: BackupItemBinding } | { type: "origins", provider: string, cursor?: string } | { type: "preview", page: number } }
export type BackupQueryResult = { type: "capabilities", capabilities: BackupCapabilities } | { type: "plans", plans: BackupPlan[], nextCursor?: string } | { type: "plan", plan: BackupPlan } | { type: "items", items: BackupItem[], nextCursor?: string } | { type: "item", item: BackupItem, object: BackupConfigObject | BackupXpObject | BackupStructureObject | null } | { type: "origins", origins: BackupOrigin[], nextCursor?: string } | { type: "preview", preview: BackupPreviewPage | null }
export type BackupManageRequest = { serverId: string, messageId: string, createdAt: number, context: BackupContext, operation: { type: "plan", manifest: BackupManifest, archiveDigest: string, native: BackupNativeProof | null } | { type: "confirm", binding: BackupBinding } | { type: "forget", binding: BackupBinding } }
export type BackupManageResult = { type: "plan", duplicate: boolean, plan: BackupPlan, items: BackupItem[], nextCursor?: string } | { type: "confirmed", duplicate: boolean, plan: BackupPlan } | { type: "forgotten", plan: BackupPlan }
export type BackupWorkRequest = { serverId: string, operation: { type: "apply", binding: BackupItemBinding, context: BackupContext, native: BackupNativeProof | null } | { type: "reserve" | "claim", binding: BackupItemBinding, context: BackupContext, native: BackupNativeProof, claimToken?: string } | { type: "outcome", binding: BackupItemBinding, claimToken: string, outcome: "created" | "failed" | "uncertain", noDispatch?: true, channel: BackupStructureObject | null, mappedId: string | null } | { type: "reconcile", binding: BackupItemBinding, context: BackupContext, native: BackupNativeProof } }
export type BackupWorkResult = { type: "item", item: BackupItem } | { type: "grant", item: BackupItem, grant: BackupGrant, claimed: boolean }
/** One archive item as a restore plan made now would treat it. name is a channel's name, since its source ID names a channel that may no longer exist */
export type BackupPreviewItem = { itemNo: number, category: BackupCategory, family: BackupConfigFamily | "xp" | "structure", sourceId: string, name?: string, disposition: BackupDisposition, reason: string | null }
/** A read-only restore preview: The plain list of what a restore would do against the server as it was at checkedAt */
export type BackupPreview = { backupId: string, archiveDigest: string, checkedAt: number, counts: Record<BackupDisposition, number>, items: BackupPreviewItem[] }
export type BackupPreviewPage = Omit<BackupPreview, "items"> & { itemCount: number, page: number, pages: number, items: BackupPreviewItem[] }
/** Why the bot could not refresh a preview: owner is a sender who no longer owns the server or a DM that is no longer private, archive an archive message, attachment or key that no longer reads, key a missing backup key, refused an archive the restore refuses as a whole, error a failed read, unanswered no answer in time */
export type BackupPreviewFailure = "owner" | "archive" | "key" | "refused" | "error" | "unanswered"
/** archive is the DM message that carries the encrypted archive, so the website can ask the bot to read it again */
export type BackupPreviewRequest = { serverId: string, context: BackupContext, manifest: BackupManifest, archiveDigest: string, native: BackupNativeProof | null, archive: { channelId: string, messageId: string }, page: number }
export type BackupPreviewJob = { ownerId: string, channelId: string, messageId: string }
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
    /** For a message in a thread, the thread's parent channel. Channel restrictions match either channel */
    parentChannelId?: string
    userId: string
    userName: string
    roleIds: string[]
    content: string
}

/** What the bot sends. It omits roleIds until it has read the member, and the backend answers memberRequired when a
 * definition could reply, so every reply follows a fresh member read */
export type ResponseEvaluateInput = Omit<ResponseEvaluateRequest, "roleIds"> & { roleIds?: string[] }

export type ResponseEvaluateResult =
    | { send: false }
    | { send: false, memberRequired: true }
    /** A custom command of that name exists but did not reply, for example during its cooldown */
    | { send: false, defined: true }
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
    /** Decimal SendMessages and thread permission bits the bot holds server-wide. A lock owns SendMessages and only these thread bits,
     * because Fluxer lets a bot stop denying only permissions it holds. Absent means SendMessages only */
    botPostingPermissions?: string
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
/** mention-rate and link-rate count mentions or links across the member's messages in the window. deceptive-links flags masked links
 * whose label names another address and hosts that imitate a protected domain, from the built-in list and the rule's patterns */
export type AutomodRuleType = "spam" | "repeat" | "mentions" | "words" | "domains" | "invites" | "mention-rate" | "link-rate" | "deceptive-links"
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
    /** Automod also checks messages from webhooks and other bots. NeonFlux's own messages are never checked */
    automodBotMessagesEnabled: boolean
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
    /** Decimal permission bits of the everyone overwrite that a lock or unlock owns. Absent means SendMessages only, as locks recorded before thread support */
    ownedPermissions?: string
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
    /** The one role whose members may view private cases, appeals and member history on the website. Only the server owner sets it */
    | { type: "private-role", roleId: string | null }
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
    | { duplicate: false, type: "private-role", roleId: string | null }
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
    /** For a message in a thread, the thread's parent channel. Automod scopes, exemptions and honeypots match either channel */
    parentChannelId?: string
    roleIds: string[]
    content: string
    contentHash: string
    mentionedUserIds: string[]
    mentionedRoleIds: string[] | null
    mentionedEveryone: boolean | null
    targetIsStaff: boolean
    context: ModerationActionContext
    /** A message from a webhook or another bot, which automod checks only while bot message checks are on. Absent for members */
    author?: "bot" | "webhook"
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
export type ModerationGateResult = { allowed: boolean, defcon: 1 | 2 | 3, messageProtectionEnabled: boolean, joinProtectionEnabled: boolean, botMessageProtectionEnabled: boolean }
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
    /** A send to a forum or media channel creates a post with this name, whose first message is the content. threadId is the post it created */
    forumPostName?: string, threadId?: string,
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
export type PublishingOutcomeRequest = { serverId: string, postNo: number, attemptId: string, generation: number, sourceId: string, outcome: Exclude<PublishingOutcome, "pending">, messageId?: string, threadId?: string, claimToken?: string }
export type PublishingOutcomeResult = { recorded: boolean }
export type PublishingReconcileRequest = ModerationSource & { serverId: string, actor: ModerationActor, postNo: number, attemptId: string, expectedGeneration: number, observation: PublishingObservation }
export type PublishingReconcileResult = { recorded: boolean, post: PublishingPost }
export type PublishingObserveRequest = { serverId: string, mode: "restart" | "aged" }
export type PublishingObserveResult = { uncertainAttempts: number }

export type RolesReservation = { userId: string, roleIds: string[] }
export type RolesSettings = { panelsEnabled: boolean, verificationEnabled: boolean, advancedVerificationEnabled?: boolean, autoroleEnabled: boolean, humansOnly: boolean, autoroleIds: string[], reservations?: RolesReservation[], revision: number }
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
    /** A website role picker request. The queued member job binds the menu, role and direction */
    | { type: "pick", jobId: string, menu: string, roleId: string, selected: boolean }
    /** A temporary role. The grant decides the direction: Added before its end time and removed after it. The source is the grant's sourceId */
    | { type: "temporary", roleId: string }
    /** The onboarding completion role, added once. The source is the one the member's onboarding progress names */
    | { type: "onboarding", roleId: string }
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
/** botPostingPermissions holds the decimal SendMessages and thread permission bits the bot holds server-wide. A close owns SendMessages and only these thread bits */
export type TicketContext = ServerOrigin & { observedAt: number, actor: TicketActor, botId: string, botAuthorized: boolean, botPostingPermissions?: string, parentVerified?: boolean, channel?: TicketChannelSnapshot }
export type TicketSettings = { enabled: boolean, retentionDays: number }
export type TicketCannedReply = { name: string, templateName: string, templateRevision: number, content: PublishingContent }
export type TicketCategory = { name: string, revision: number, enabled: boolean, visibility: TicketVisibility, description: string, parentId: string | null, supportRoleIds: string[], questions: string[], cannedReplies: TicketCannedReply[] }
export type TicketCategorySummary = Pick<TicketCategory, "name" | "revision" | "enabled" | "visibility" | "description">
export type TicketIntakeCategory = TicketCategorySummary & Pick<TicketCategory, "parentId" | "supportRoleIds" | "questions">
export type TicketIntake = { intakeNo: number, generation: number, category: TicketIntakeCategory, requesterId: string, joinedAt: string, answers: string[], state: "draft" | "submitted" | "cancelled" | "expired", createdAt: number, expiresAt: number, ticketNo?: number }
export type TicketState = "creating" | "open" | "closing" | "closed" | "reopening" | "deleting" | "retired" | "failed" | "uncertain"
export type TicketRecord = { ticketNo: number, requesterId: string, requesterJoinedAt: string, categoryName: string, categoryRevision: number, visibility: TicketVisibility, supportRoleIds: string[], state: TicketState, generation: number, botId: string, channelId?: string, channel?: TicketChannelSnapshot, claimedBy?: string, priority: "low" | "normal" | "high" | "urgent", createdAt: number, closedAt?: number, retiredAt?: number, bodyExpiresAt?: number, erased: boolean, entryCount: number, currentAttempt?: TicketAttempt, transition?: "close" | "reopen", completedSteps?: number }
export type TicketAction = "create" | "introduction" | "reply" | "close-everyone" | "close-requester" | "reopen-requester" | "reopen-everyone" | "delete"
/** escalatedFrom names the help post of an escalated ticket. Its creation is run by the staff member who escalated it, not the requester */
export type TicketActionGrant = { attemptId: string, attemptNo: number, ticketNo: number, generation: number, sourceId: string, actorId: string, botId: string, requesterId: string, requesterJoinedAt: string, visibility: TicketVisibility, supportRoleIds: string[], action: TicketAction, dispatchExpiresAt: number, nativeDeadlineMs: 5000, channelId?: string, expectedChannel?: TicketChannelSnapshot, desiredChannel?: TicketChannelSnapshot, targetOverwrite?: TicketOverwrite, ownedPermissions?: string, channelName?: string, parentId?: string | null, overwrites?: TicketOverwrite[], content?: PublishingContent, escalatedFrom?: string }
export type TicketLocator = Pick<TicketRecord,"ticketNo"|"requesterId"|"supportRoleIds"|"state"|"generation"|"botId"|"channelId"|"retiredAt">
export type TicketAttempt = TicketActionGrant & { outcome: "pending" | "succeeded" | "failed" | "uncertain", createdAt: number, claimedAt?: number, finishedAt?: number, noDispatch?: true, messageId?: string, observationAt?: number, resolved?: "before" | "desired" | "absent", redacted?: true, nativeDeleteConfirmed?: true }
export type TicketEntry = { entryNo: number, ticketNo: number, authorId: string, kind: "reply" | "note", createdAt: number, content?: PublishingContent, erased: boolean, attemptNo?: number }
export type TicketTranscriptMessage = { messageId: string, authorId: string, createdAt?: string, content: string, omittedAttachments: number }
/** One public thread of the ticket channel with its captured messages, oldest first like the channel's */
export type TicketTranscriptThread = { threadId: string, name: string, messages: TicketTranscriptMessage[] }
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
    /** Staff turn a help desk post into a ticket for its author, whose membership the bot read just before */
    | { type: "escalate", categoryName: string, requesterId: string, requesterJoinedAt: string, postId: string }
export type TicketManageRequest = TicketSource & { operation: TicketManageOperation }
export type TicketManageResult = { duplicate: true } | { duplicate: false, type: "settings", settings: TicketSettings } | { duplicate: false, type: "category", category: TicketCategory } | { duplicate: false, type: "deleted", name: string } | { duplicate: false, type: "ticket", ticket: TicketRecord, grant?: TicketActionGrant } | { duplicate: false, type: "entry", entry: TicketEntry }
export type TicketIntakeRequest = TicketSource & { operation:
    | { type: "open", categoryName: string, expectedCategoryRevision: number }
    | { type: "answer", intakeNo: number, expectedGeneration: number, question: number, answer: string }
    | { type: "clear", intakeNo: number, expectedGeneration: number, question: number }
    | { type: "cancel", intakeNo: number, expectedGeneration: number }
    | { type: "submit", intakeNo: number, expectedGeneration: number, expectedCategoryRevision: number, visibility: TicketVisibility }
}
export type TicketIntakeResult = { duplicate: true } | { duplicate: false, type: "intake", intake: TicketIntake } | { duplicate: false, type: "ticket", ticket: TicketRecord, grant: TicketActionGrant }
/** A member's live draft on any server, so a plain DM reply can find it. Server and intake numbers only */
export type TicketOpenIntake = { serverId: string, intakeNo: number }
export type TicketOpenIntakesRequest = { userId: string }
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
export type TicketTranscriptUploadRequest = TicketSource & { ticketNo: number, expectedGeneration: number, capturedAt: number, messages: TicketTranscriptMessage[], threads?: TicketTranscriptThread[], truncated: boolean }
export type TicketTranscriptUploadResult = { duplicate: boolean, transcript: TicketTranscript }

export type LevelingMapping = { level: number, roleId: string }
export type LevelingFence = { scoreEpoch: number, adjustmentRevision: number, mappingRevision: number }
export type LevelingSettings = { enabled: boolean, xpPerMessage: number, cooldownSeconds: number, excludedChannelIds: string[], excludedRoleIds: string[], revision: number, mappingRevision: number, scoreEpoch: number, mappings: LevelingMapping[] }
export type LevelingMemberContext = ServerOrigin & { userId: string, joinedAt: string, roleIds: string[], isBot: boolean, timeoutUntil: string | null }
/** parentChannelId is the parent of a message's thread. Excluded channels match either channel */
export type LevelingCandidate = { messageId: string, createdAt: number, userId: string, channelId: string, parentChannelId?: string, digest: string }
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
/** A rank is exact unless more than 100 members of the same level score higher, when it is the range the level allows. Servers whose rank counts are still being built report exact ranks only within the top 1,000 */
export type LevelingRank = { type: "exact", position: number } | { type: "range", from: number, to: number } | { type: "outside-top-1000" } | { type: "unranked" }
export type LevelingQueryResult = { type: "settings", settings: LevelingSettings } | { type: "rank", profile: LevelingProfile, rank: LevelingRank } | { type: "leaderboard", profiles: LevelingProfile[], nextCursor?: LevelingLeaderboardCursor } | { type: "status", dirty: number, sweepPending: boolean, profiles: number } | { type: "audits", audits: LevelingAudit[], nextBeforeAuditNo?: number }
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
export type EventsSettings = { enabled: boolean, revision: number, threads: boolean }
/** postId is the forum post that holds the card in a forum or media channel, and threadId the discussion thread started on the card in another channel */
export type EventsDefinition = { eventNo: number, name: string, revision: number, channelId: string, title: string, description: string, capacity: number | null, reminderOffsets: number[], state: EventsLifecycle, participationStarted: boolean, calendar?: EventsCalendar, template?: { name: string, revision: number, content: PublishingContent }, cardPostNo?: number, postId?: string, threadId?: string, createdAt: number, updatedAt: number }
export type EventsOccurrence = EventsResolvedDate & { eventNo: number, occurrenceNo: number, revision: number, state: EventsLifecycle, participationStarted: boolean, going: number, waitlisted: number, capacity: number | null, workGeneration: number }
export type EventsRsvp = { eventNo: number, occurrenceNo: number, userId: string, joinedAt: string, membershipGeneration: number, revision: number, choice: EventsChoice, allocation: "seat" | "waitlist" | "none", queueOrder?: number, acceptedCreatedAt: number, acceptedMessageId: string }
export type EventsSource = ModerationSource & { serverId: string, context: EventsContext }
export type EventsManageOperation =
    | { type: "settings", expectedRevision: number, enabled: boolean }
    | { type: "threads", expectedRevision: number, enabled: boolean }
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
    | { type: "thread", eventNo: number, outcome: "opened", threadId: string }
    | { type: "thread", eventNo: number, outcome: "closed" | "deferred" }
}
/** Discussion thread work: Start a thread on the card message, or archive and lock the thread or forum post once the event is over */
export type EventsThreadWork = { eventNo: number, channelId: string, title: string, action: "open", messageId: string } | { eventNo: number, channelId: string, title: string, action: "close", threadId: string }
export type EventsDeliveryResult = { type: "event", event: EventsDefinition } | { type: "deliveries", deliveries: EventsDelivery[], nextAfterDeliveryId?: string, threads?: EventsThreadWork[] } | { type: "reservation", status: "reserved", grant: EventsDeliveryGrant } | { type: "reservation", status: "waiting" | "skipped" | "cancelled" | "terminal" } | { type: "progress", recorded: boolean }

export type SuggestionsContext = EventsContext
export type SuggestionsCardContext = ServerOrigin & { observedAt: number, channelId: string, botId: string, botAuthorized: true }
export type SuggestionsState = "under-review" | "planned" | "completed" | "declined" | "withdrawn"
export type SuggestionsVoteChoice = "up" | "down" | "clear"
export type SuggestionsSettings = { enabled: boolean, revision: number, channelId?: string, suggestions: number, voters: number, staffReceipts: number, memberReceipts: number, dirty: number, blocked: number }
export type SuggestionsDefinition = {
    suggestionNo: number, revision: number, authorId: string, channelId: string, text: string, state: SuggestionsState,
    up: number, down: number, voters: number, desiredRevision: number, publishedRevision: number, cardGeneration: number,
    cardState: "queued" | "reserved" | "current" | "blocked", cardStale: boolean, createdAt: number, updatedAt: number,
    reason?: string, statusBy?: string, statusAt?: number, historyExpiresAt?: number, forgetting: boolean, postNo?: number, attemptId?: string, threadId?: string,
}
export type SuggestionsVote = { choice: SuggestionsVoteChoice, joinedAt: string, acceptedCreatedAt: number, acceptedMessageId: string }
export type SuggestionsCardBinding = { suggestionNo: number, cardGeneration: number, desiredRevision: number }
export type PublishingSuggestionConsumer = { type: "suggestion-card" } & SuggestionsCardBinding
export type SuggestionsCardGrant = PublishingGrant & { source: Extract<PublishingSource, { type: "suggestion-card" }>, provenance: Extract<PublishingProvenance, { type: "suggestion-card" }>, consumer: PublishingSuggestionConsumer }
/** channelId is the destination and threadId the forum post that holds the card once it exists. suggestionState selects the post's status tag */
export type SuggestionsWorkRow = SuggestionsCardBinding & { channelId: string, threadId?: string, suggestionState: SuggestionsState, dueAt: number, nextCheckAt: number, state: "queued" | "reserved" | "blocked", postNo?: number, attemptId?: string }
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
/** A sweep reads the policy channel's history, then each active thread of it in turn. threadId names the thread being read */
export type CleanupSweep = CleanupSweepBinding & { threadId?: string, ownerId: string, cutoffAt: number, before: string, pageNo: number, state: "active" | "complete" | "cancelled", counts: CleanupCounts, createdAt: number, updatedAt: number }
export type CleanupPageItem = { message: CleanupMessage, disposition: "eligible" | "skipped", reason?: CleanupSkipReason, targetNo?: number }
export type CleanupPage = CleanupSweepBinding & { threadId?: string, pageNo: number, before: string, nextBefore?: string, empty: boolean, items: CleanupPageItem[], persistedAt: number }
export type CleanupTargetBinding = CleanupSweepBinding & { pageNo: number, targetNo: number, messageId: string }
export type CleanupTargetState = "queued" | "reserved" | "deleted" | "failed" | "uncertain" | "absent" | "skipped" | "cancelled"
export type CleanupGrant = CleanupTargetBinding & { ownerId: string, botId: string, cutoffAt: number, createdAt: string, authorId: string, dispatchExpiresAt: number, nativeDeadlineMs: 5000 }
export type CleanupObservation = ServerOrigin & { messageId: string, channelId: string, observedAt: number, status: "present" | "absent" | "unknown", channelVisible: boolean }
export type CleanupTarget = CleanupTargetBinding & { threadId?: string, ownerId: string, state: CleanupTargetState, message: CleanupMessage, createdAt: number, updatedAt: number, grant?: CleanupGrant, claimedAt?: number, finishedAt?: number, noDispatch?: true, expiresAt?: number, reason?: string, observation?: CleanupObservation, lateOutcome?: "deleted" | "failed" | "uncertain", reassessedAt?: number }
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
    /** After an empty page, nextThreadId moves the sweep to that thread of the channel instead of completing it */
    | { type: "advance", binding: CleanupSweepBinding, pageNo: number, nextThreadId?: string }
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
export type MetadataLogsCategory = "membership" | "resources" | "messages" | "audit" | "settings" | "operations" | "security"
export type MetadataLogsEventType = "member-add" | "member-update" | "member-remove" | "role-create" | "role-update" | "role-delete" | "channel-create" | "channel-update" | "channel-delete" | "thread-create" | "thread-update" | "thread-delete" | "server-update" | "message-update" | "message-delete" | "message-bulk-delete" | "audit-entry" | "settings-change" | "backend-failure" | "admission-failure" | "delivery-failure" | "gateway-discontinuity" | "invite-create" | "invite-delete" | "bot-join" | "webhook-change" | "privilege-change" | "impersonation"
export type MetadataLogsSource = { kind: "audit", auditEntryId: string } | { kind: "message-delete", messageId: string } | { kind: "member-add", userId: string, joinedAt: string } | { kind: "observation", sessionId: string, sequence: number } | { kind: "settings", messageId: string, scope: "moderation" | "metadata" | "security" } | { kind: "dashboard", jobId: string, scope: "metadata" | "roles" | "responses" | "moderation" | "publishing" | "greetings" | "tickets" | "leveling" | "milestones" | "suggestions" | "cleanup" | "events" | "schedules" | "nickname" | "voice" | "rolepicker" | "temproles" | "sticky" | "sidebar" | "memberlist" | "alerts" | "helpdesk" | "onboarding" | "presets" | "lfg"} | { kind: "dashboard-setting", scope: "general" | "responses", revision: number }
/** event is an account the Fluxer event itself names, such as the creator of a new invite */
export type MetadataLogsActor = { kind: "unknown" } | { kind: "audit" | "configuration" | "event", userId: string }
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
    /** The parent channel of a message's thread, or of the thread a thread event describes */
    parentChannelId?: string
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
/** One UTC hour of ordinary member messages in one channel. Hour is the hour's start in Unix milliseconds */
export interface AnalyticsHourBucket { channelId: string, hour: number, count: number }
/** One UTC day of member joins and leaves. Day is the day's start in Unix milliseconds */
export interface AnalyticsDayBucket { day: number, joins: number, leaves: number }
/** At most 500 buckets in total. Counts for the same bucket add to the stored rows.
 *  Session names one bot worker run and sequence numbers its batches from 1 upward. The backend applies each session's batches once,
 *  so a batch resent after a lost reply is acknowledged without counting it again. Resend a batch unchanged, and never send a lower sequence after a higher one */
export interface AnalyticsRecordRequest { serverId: string, session: string, sequence: number, hours: AnalyticsHourBucket[], days: AnalyticsDayBucket[] }
/** Recorded is false when analytics is off for the server. Nothing is stored then. A batch the session already applied returns recorded true */
export interface AnalyticsRecordResult { enabled: boolean, recorded: boolean }
export interface AnalyticsSettingsRequest { serverId: string }
export interface AnalyticsSettings { enabled: boolean }
export interface AnalyticsManageRequest extends ServerOrigin { serverId: string, actorId: string, managerAuthorized: true, enabled: boolean }
export interface AnalyticsSummaryRequest { serverId: string }
/** Totals for the last seven UTC days including today. Busiest hours are at most three UTC hours of the day, 0 to 23, busiest first, ties by hour. onboarded counts members who finished the newcomer checklist */
export interface AnalyticsSummary { enabled: boolean, since: number, joins: number, leaves: number, onboarded: number, messages: number, topChannels: Array<{ channelId: string, count: number }>, busiestHours: Array<{ hour: number, count: number }> }

export type VoiceGenerator = { channelId: string, categoryId: string | null, template: string, userLimit: number | null, region: string | null, revision: number, createdAt: number, updatedAt: number }
export type VoiceRoom = { channelId: string, ownerId: string, generatorChannelId: string, createdAt: number }
/** Channel names are applied natively by the bot and validated by the backend, which does not store them */
export type VoiceGeneratorPatch = { channelName?: string, categoryId?: string | null, template?: string, userLimit?: number | null, region?: string | null }
export type VoiceManageOperation =
    | { type: "generator-add", channelId: string, channelName: string, categoryId: string | null, template: string, userLimit: number | null, region: string | null }
    | { type: "generator-set", channelId: string, expectedRevision?: number, patch: VoiceGeneratorPatch }
    | { type: "generator-remove", channelId: string, expectedRevision?: number }
export interface VoiceManageRequest { serverId: string, messageId: string, createdAt: number, actor: ModerationActor, operation: VoiceManageOperation }
export type VoiceManageResult = { type: "generator", generator: VoiceGenerator } | { type: "removed", channelId: string }
export type VoiceQueryOperation = { type: "state" } | { type: "authority", actor: ModerationActor, channelId?: string }
export interface VoiceQueryRequest { serverId: string, operation: VoiceQueryOperation }
export type VoiceQueryResult = { type: "state", generators: VoiceGenerator[], rooms: VoiceRoom[] } | { type: "authority", staff: boolean, room: VoiceRoom | null, generators: VoiceGenerator[], rooms: number }
export type VoiceRoomsOperation = { type: "create", channelId: string, ownerId: string, generatorChannelId: string } | { type: "forget", channelId: string }
export interface VoiceRoomsRequest { serverId: string, operation: VoiceRoomsOperation }
export type VoiceRoomsResult = { type: "created", room: VoiceRoom } | { type: "refused", reason: "generator" | "owner" | "room-limit", room?: VoiceRoom } | { type: "forgotten", room: boolean, generator: boolean }
/** The generator channel the bot created for a dashboard request, read back from Fluxer in the configured server */
export type VoiceDashboardContext = ServerOrigin & { channelId: string }

/** One bot message kept at the bottom of a channel. messageId is the copy the bot posted last, null before its first post */
export type StickyMessage = { channelId: string, content: string, intervalSeconds: number, messageId: string | null, revision: number, updatedAt: number }
/** Set creates a sticky or changes its text or interval. A new sticky needs text and starts with a 30 second interval */
export type StickyOperation = { type: "set", channelId: string, content?: string, intervalSeconds?: number } | { type: "remove", channelId: string }
/** Chat changes carry the server manager's fresh native authority, like the prefix */
export interface StickyManageRequest extends ServerOrigin { serverId: string, messageId: string, createdAt: number, actor: ModerationActor, managerAuthorized: true, operation: StickyOperation }
/** A removal returns the removed sticky, so the bot can delete the copy it posted last */
export type StickyManageResult = { type: "saved", sticky: StickyMessage } | { type: "removed", sticky: StickyMessage }
export interface StickyListRequest { serverId: string }
export interface StickyListResult { stickies: StickyMessage[] }
/** Records a new copy only while the sticky still has this revision and previous copy, so of two racing reposts exactly one is kept */
export interface StickyPostedRequest { serverId: string, channelId: string, revision: number, previousMessageId: string | null, messageId: string }
export type StickyPostedResult = { accepted: true, sticky: StickyMessage } | { accepted: false, sticky: StickyMessage | null }

/** The link channel that opens this server's dashboard page from the server sidebar. Its name and URL live in Fluxer */
export type SidebarLink = { channelId: string, revision: number, updatedAt: number }
/** The bot creates, renames or deletes the link channel and records it here. Names are validated, never stored */
export type SidebarOperation = { type: "add", channelId: string, name: string } | { type: "set", name: string } | { type: "remove" }
export interface SidebarManageRequest extends ServerOrigin { serverId: string, messageId: string, createdAt: number, actor: ModerationActor, managerAuthorized: true, operation: SidebarOperation }
export interface SidebarGetRequest { serverId: string }
export interface SidebarResult { link: SidebarLink | null }
/** The link channel the bot created for a dashboard request, in the configured server */
export type SidebarDashboardContext = ServerOrigin & { channelId: string }

/** Set gives the hoisted roles' member-list display order from top to bottom. Reset clears every display position */
export type MemberListOperation = { type: "set", roleIds: string[] } | { type: "reset" }
/** The bot applies the order natively before it records the change. Reset needs the owner or an Administrator */
export interface MemberListManageRequest extends ServerOrigin { serverId: string, messageId: string, createdAt: number, actor: ModerationActor, managerAuthorized: true, operation: MemberListOperation }
export interface MemberListManageResult { revision: number }

/** Security alerts a server can turn on. Every alert starts off */
export type AlertKind = "invites" | "bots" | "webhooks" | "privileges" | "impersonation"
/** Bots and webhooks staff marked as expected raise no alert */
export interface AlertSettings { invites: boolean, bots: boolean, webhooks: boolean, privileges: boolean, impersonation: boolean, expectedBotIds: string[], expectedWebhookIds: string[] }
export type AlertsOperation = { type: "set", alert: AlertKind, enabled: boolean } | { type: "expect", kind: "bot" | "webhook", id: string, expected: boolean }
/** Chat changes carry the server manager's fresh native authority, like sticky messages */
export interface AlertsManageRequest extends ServerOrigin { serverId: string, messageId: string, createdAt: number, actor: ModerationActor, managerAuthorized: true, operation: AlertsOperation }
export interface AlertsGetRequest { serverId: string }
export interface AlertsResult { settings: AlertSettings }
/** One invite as the bot last read it. ref is a hash that names the invite without its code, which grants access and is never stored */
export interface AlertInvite { ref: string, channelId: string, inviterId: string | null, uses: number, maxUses: number, expiresAt: string | null, createdAt: string, temporary: boolean }
/** The invites the bot last read for the dashboard, at most 100. more reports that the server has more */
export interface AlertInviteList { readAt: number, invites: AlertInvite[], more: boolean }
/**
 * The help desk on up to ten forum or media channels. greeting null sends none, nudgeHours null sends no reply reminders,
 * and the thread budget guard runs while guardChannelId names a staff channel for warnings or autoArchive is on
 */
export type HelpDeskSettings = { forumIds: string[], greeting: string | null, solvedTag: string, nudgeHours: number | null, guardChannelId: string | null, autoArchive: boolean, revision: number }
/** A saved answer staff post with !answer. Names use lowercase letters, digits, - and _ */
export type HelpDeskAnswer = { name: string, title: string, content: string, updatedAt: number }
export type HelpDeskOperation =
    | { type: "forum-add" | "forum-remove", channelId: string }
    | { type: "settings", greeting?: string | null, solvedTag?: string, nudgeHours?: number | null, guardChannelId?: string | null, autoArchive?: boolean }
    | { type: "answer-set", name: string, title: string, content: string }
    | { type: "answer-remove", name: string }
/** Settings changes carry the server manager's fresh authority. Answer changes may carry help desk staff authority instead: The owner, Administrator, Manage Server or Manage Threads */
export interface HelpDeskManageRequest extends ServerOrigin { serverId: string, messageId: string, createdAt: number, actor: ModerationActor, authorized: "manager" | "staff", operation: HelpDeskOperation }
export type HelpDeskManageResult = { type: "settings", settings: HelpDeskSettings } | { type: "answer", answer: HelpDeskAnswer } | { type: "answer-removed", name: string }
export interface HelpDeskGetRequest { serverId: string }
export interface HelpDeskGetResult { settings: HelpDeskSettings }
/** With a name, the one answer of that name or none. Without, the whole library */
export interface HelpDeskAnswersRequest { serverId: string, name?: string }
export interface HelpDeskAnswersResult { answers: HelpDeskAnswer[] }
/** A new post in a help desk forum, recorded for its reply reminder */
export interface HelpDeskOpenedRequest { serverId: string, threadId: string, forumId: string }
export interface HelpDeskOpenedResult { recorded: boolean }
export interface HelpDeskWorkRequest { serverId: string }
/** Claimed reply reminders, whether more are due, and a thread budget pass when one is due */
export interface HelpDeskWorkResult { nudges: { threadId: string, forumId: string }[], more: boolean, guard: { channelId: string | null, autoArchive: boolean, threshold: number } | null }
/** Sent after a pass that counted at least the threshold of active threads or left auto-archive changes for later */
export interface HelpDeskGuardRequest { serverId: string, activeThreads: number, more: boolean }
export interface HelpDeskGuardResult { warn: boolean }

/** Shared member access for one feature. A block always wins, and an empty allow list admits every member who is not blocked */
export interface MemberAccessLists { allowRoleIds: string[], blockRoleIds: string[], allowUserIds: string[], blockUserIds: string[] }
export type RolePickerMode = "single" | "multi"
/** A server role's name and RGB color as the bot read it, zero meaning no color */
export interface RolePickerRoleDisplay { roleId: string, name: string, color: number }
/** At most 25 roles. Single mode lets a member hold one role of the menu at a time. Display keeps the role names the bot read at the last save */
export interface RolePickerMenu { name: string, description?: string, mode: RolePickerMode, roleIds: string[], display?: RolePickerRoleDisplay[] }
/** At most 10 menus per server, and a role belongs to at most one menu */
export interface RolePickerSettings { enabled: boolean, menus: RolePickerMenu[] }
export type RolePickerOperation =
    | { type: "module", enabled: boolean }
    | { type: "menu-set", name: string, description?: string, mode: RolePickerMode, roleIds: string[] }
    | { type: "menu-add", name: string, mode: RolePickerMode, description?: string }
    | { type: "menu-update", name: string, mode?: RolePickerMode, description?: string | null }
    | { type: "menu-role-add" | "menu-role-remove", name: string, roleIds: string[] }
    | { type: "menu-remove", name: string }
    | ({ type: "access-set" } & MemberAccessLists)
    | { type: "access-add" | "access-remove", list: "allow" | "block", kind: "role" | "user", ids: string[] }
export interface RolePickerState { revision: number, settings: RolePickerSettings, access: MemberAccessLists }
/** Display carries the server's current role names, which refresh the names stored with the menus */
export interface RolePickerManageRequest { serverId: string, messageId: string, createdAt: number, actor: ModerationActor, roles?: RolesRoleSnapshot[], display?: RolePickerRoleDisplay[], operation: RolePickerOperation }
export interface RolePickerQueryRequest { serverId: string, actor: ModerationActor }
export type RolePickerMemberOperation = { type: "claim" | "drop", menu: string, roleId: string } | { type: "lookup" }
export interface RolePickerJob { id: string, actorId: string, operation: RolePickerMemberOperation, state: "queued" | "applied" | "failed", createdAt: number, expiresAt: number, error?: string }
export interface RolePickerReadyRequest { serverId: string }
export interface RolePickerReadyResult { jobs: RolePickerJob[] }
/** The member's fresh native read and the server's role names. Lookups finish here, and claims and drops continue only when proceed is true.
 *  The backend keeps names for menu roles only */
export interface RolePickerStartRequest { serverId: string, jobId: string, actorId: string, context: RolesMemberContext, display?: RolePickerRoleDisplay[] }
export interface RolePickerStartResult { proceed: boolean, job: RolePickerJob }
/** The member's roles read after the role change. The backend decides applied or failed from them and the recorded attempts */
export interface RolePickerCompleteRequest { serverId: string, jobId: string, actorId: string, context: RolesMemberContext, display?: RolePickerRoleDisplay[] }
export interface RolePickerCompleteResult { job: RolePickerJob }
export interface RolePickerFailRequest { serverId: string, jobId: string }

/**
 * Why a temporary role is not settled yet. permission: NeonFlux lacks Manage Roles. role: The role ranks at or above NeonFlux's highest role,
 * has more than ordinary member permissions or is a staff role. refused: Fluxer refused the change. uncertain: Fluxer did not confirm a change,
 * which is never repeated until a reconcile reads the member. unavailable: The member or the server's roles could not be read
 */
export type TemporaryRoleProblem = "permission" | "role" | "refused" | "uncertain" | "unavailable"
/** One member's temporary role during one membership. NeonFlux removes the role at endsAt. sourceId names this version of the grant in role attempts */
export interface TemporaryRoleGrant { grantId: string, userId: string, roleId: string, joinedAt: string, endsAt: number, grantedBy: string, createdAt: number, updatedAt: number, sourceId: string, problem?: TemporaryRoleProblem }
/** A role's default and longest duration in seconds */
export interface TemporaryRoleDefault { roleId: string, defaultSeconds?: number, maxSeconds?: number }
export interface TemporaryRoleSettings { roles: TemporaryRoleDefault[] }
export interface TemporaryRoleState { revision: number, settings: TemporaryRoleSettings }
/**
 * add and set need the member's fresh context. add without durationSeconds uses the role's default, and set counts its duration from now.
 * remove ends the grant now, and the bot then removes the role. role changes a role's defaults: An omitted value is kept and null clears it
 */
export type TemporaryRoleOperation =
    | { type: "add", userId: string, roleId: string, durationSeconds?: number }
    | { type: "set", userId: string, roleId: string, durationSeconds: number }
    | { type: "remove", userId: string, roleId: string }
    | { type: "role", roleId: string, defaultSeconds?: number | null, maxSeconds?: number | null }
/** actor.nativePermissionAuthorized means Manage Roles for grants and Manage Server for role defaults */
export interface TemporaryRoleManageRequest { serverId: string, messageId: string, createdAt: number, actor: ModerationActor, context?: RolesMemberContext, operation: TemporaryRoleOperation }
export type TemporaryRoleManageResult = { type: "grant", grant: TemporaryRoleGrant } | ({ type: "settings" } & TemporaryRoleState)
export interface TemporaryRoleQueryRequest { serverId: string, actor: ModerationActor, operation: { type: "list", userId?: string, cursor?: string } | { type: "settings" } }
export type TemporaryRoleQueryResult = { type: "grants", grants: TemporaryRoleGrant[], nextCursor?: string } | ({ type: "settings" } & TemporaryRoleState)
/**
 * list returns the server's due grants. end closes a grant without a role change, because its member left or rejoined or its role was deleted.
 * problem keeps a grant with the reason it is not settled and checks it again later
 */
export type TemporaryRoleWorkOperation =
    | { type: "list" }
    | (ServerOrigin & { type: "end", userId: string, roleId: string, sourceId: string, reason: "member", currentJoinedAt: string | null, memberAbsent?: true, memberUserId?: string, observedAt: number })
    | { type: "end", userId: string, roleId: string, sourceId: string, reason: "role" }
    | { type: "problem", userId: string, roleId: string, sourceId: string, problem: TemporaryRoleProblem }
export interface TemporaryRoleWorkRequest { serverId: string, operation: TemporaryRoleWorkOperation }
export type TemporaryRoleWorkResult = { type: "grants", grants: TemporaryRoleGrant[] } | { type: "recorded", recorded: boolean }

/**
 * One newcomer checklist step. rules is the rules verification, panel a reaction role panel and menu a role picker menu, each by name, and
 * link a channel to visit with a short line. Members finish rules by accepting the current rules, and a panel or menu step by holding one of
 * its roles. A link step is guidance that never needs finishing
 */
export type OnboardingStep = { type: "rules" } | { type: "panel", name: string } | { type: "menu", name: string } | { type: "link", channelId: string, text: string }
/** delivery is the greeting route that carries the checklist. completionRoleId is given once a member finishes every step */
export interface OnboardingSettings { enabled: boolean, delivery: "welcome" | "dm", steps: OnboardingStep[], completionRoleId: string | null }
/** step-remove names a position from 1. steps replaces the whole list. role null clears the completion role */
export type OnboardingOperation =
    | { type: "module", enabled: boolean }
    | { type: "delivery", delivery: "welcome" | "dm" }
    | { type: "step-add", step: OnboardingStep }
    | { type: "step-remove", position: number }
    | { type: "steps", steps: OnboardingStep[] }
    | { type: "role", roleId: string | null }
/** What the bot keeps in memory. roleSteps holds, for each step a member finishes by a role, the roles that can finish it */
export interface OnboardingView { revision: number, settings: OnboardingSettings, roleSteps: string[][] }
export interface OnboardingGetRequest { serverId: string }
/** roles are fresh snapshots of the completion role a role operation names */
export interface OnboardingManageRequest extends ServerOrigin { serverId: string, messageId: string, createdAt: number, actor: ModerationActor, roles?: RolesRoleSnapshot[], operation: OnboardingOperation }
/** done and open steps need finishing, and info is a link step. Steps whose panel, menu or rules verification is unavailable are left out */
export type OnboardingStepState = "done" | "open" | "info"
export interface OnboardingMemberRequest { serverId: string, context: RolesMemberContext }
/** complete means the member finished the checklist during this membership. grant names the completion role change the bot should evaluate */
export interface OnboardingProgress { enabled: boolean, steps: Array<{ text: string, state: OnboardingStepState }>, complete: boolean, completedAt?: number, grant?: { sourceId: string, roleId: string } }

export type PresetName = "gaming" | "support" | "creator" | "relaxed" | "balanced" | "strict"
export type PresetFamily = "moderation" | "leveling" | "tickets" | "events"
/** One setting a preset changes, with its current and new value as managers see them */
export interface PresetChange { family: PresetFamily, setting: string, from: string, to: string }
/** The changes applying a preset makes now. token confirms exactly this preview, and any change to the settings changes it */
export interface PresetPlan { name: PresetName, kind: "community" | "security", description: string, changes: PresetChange[], token: string }
export interface PresetPlansRequest { serverId: string }
export interface PresetPlansResult { presets: PresetPlan[] }
export interface PresetApplyRequest extends ServerOrigin { serverId: string, messageId: string, createdAt: number, actor: ModerationActor, name: PresetName, token: string }
export interface PresetApplyResult { plan: PresetPlan }

/**
 * Looking for group. channelId receives the group cards, and generatorChannelId names the voice generator whose category, member limit
 * and region group rooms use. An open group closes expiryMinutes after it was posted, or after its start time when it names one.
 * memberGroups limits the open groups one member hosts and serverGroups the open groups of the server
 */
export interface LfgSettings { enabled: boolean, channelId: string | null, generatorChannelId: string | null, expiryMinutes: number, maxSize: number, memberGroups: number, serverGroups: number }
export type LfgSettingsPatch = Partial<LfgSettings>
/** One open group. memberIds starts with the host, and size counts the host. messageId is the group's card once the bot posted it */
export interface LfgGroup { groupNo: number, hostId: string, activity: string, size: number, note?: string, startsAt?: number, channelId: string, messageId: string | null, memberIds: string[], expiresAt: number, createdAt: number }
export type LfgOperation =
    | { type: "settings", patch: LfgSettingsPatch }
    | { type: "create", activity: string, size: number, note?: string, startsInMinutes?: number }
    | { type: "join", groupNo: number }
    | { type: "leave", groupNo: number }
    | { type: "cancel", groupNo: number }
    | { type: "card", groupNo: number, messageId: string }
    /** channelId is the room the bot just created for the group */
    | { type: "start", groupNo: number, channelId: string }
/** managerAuthorized is a fresh Manage Server or Administrator read. Settings need it, and so do cancelling and starting another member's group that is not full */
export interface LfgManageRequest extends ServerOrigin { serverId: string, messageId: string, createdAt: number, actor: ModerationActor, managerAuthorized: boolean, operation: LfgOperation }
/** Why a request changed nothing. limit names the size or group limit that applied */
export type LfgRefusal = "off" | "size" | "member-limit" | "server-limit" | "missing" | "joined" | "full" | "host" | "not-joined" | "permission" | "generator" | "room-limit"
export type LfgManageResult =
    | { type: "settings", revision: number, settings: LfgSettings }
    | { type: "group", group: LfgGroup }
    | { type: "closed", group: LfgGroup }
    /** created is false when the host already owns a temporary voice room, which the group uses instead of the new channel */
    | { type: "started", group: LfgGroup, room: VoiceRoom, created: boolean }
    | { type: "refused", reason: LfgRefusal, limit?: number }
export interface LfgQueryRequest { serverId: string, operation: { type: "list" } | { type: "start", groupNo: number } }
export type LfgQueryResult =
    | { type: "groups", revision: number, settings: LfgSettings, groups: LfgGroup[] }
    /** An open group and the generator its room would use, read before the bot creates the room */
    | { type: "start", group: LfgGroup | null, generator: VoiceGenerator | null }
/** Closes up to ten open groups whose time ran out and returns them, so the bot can mark their cards */
export interface LfgWorkRequest { serverId: string }
export interface LfgWorkResult { groups: LfgGroup[] }
