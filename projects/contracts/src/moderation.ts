import { Schema } from "effect"
import {
    Id,
    Ids,
    Int,
    List,
    Millis,
    Name,
    NameInput,
    SERVER_ROLES,
    STRUCTURE_CHANNELS,
    Str,
    Text,
    Token,
    isId,
    origin,
} from "./common.ts"
import { ModerationActor, ModerationSource } from "./shared.ts"

// Moderation, automod, security and DEFCON, see docs/BOT.md#moderation-protections-defcon-and-appeals

export const SEND_MESSAGES = 2048n
/** A lock also stops posting in the channel's threads and starting new ones: CreatePublicThreads, CreatePrivateThreads and SendMessagesInThreads */
export const LOCK_PERMISSIONS = SEND_MESSAGES | (1n << 35n) | (1n << 36n) | (1n << 38n)
const unique = Schema.makeFilter((values: string[]) => new Set(values).size === values.length)
const UniqueIds = (max: number) => Ids(max).check(unique)
/** Channel and role lists hold as many IDs as a server can have channels or roles, so no list is ever too short for a real server */
const ChannelIds = Ids(STRUCTURE_CHANNELS),
    RoleIds = Ids(SERVER_ROLES),
    UniqueChannelIds = UniqueIds(STRUCTURE_CHANNELS),
    UniqueRoleIds = UniqueIds(SERVER_ROLES)
/** A rule name as stored: lowercase letters, digits, _ and -, starting with a letter or digit */
const RuleName = Name
/** A rule name as a request may give it. The backend trims and lowercases it */
const RuleNameInput = NameInput
/** Decimal permission bits of at most 63 bits */
const Bits = Schema.String.check(
    Schema.makeFilter((value: string) => /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n),
)
/** An ISO 8601 UTC timestamp, as Fluxer reports the end of a timeout or ban */
const UtcTime = Schema.String.check(
    Schema.makeFilter(
        (value: string) =>
            /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)),
    ),
)
/** A case's source: the message that asked for it, join:<member>:<joined at> for a join, or warnings:<case> for the warning that reached the warning limit */
const SourceId = Schema.String.check(
    Schema.makeFilter(
        (value: string) =>
            isId(value) || /^join:[1-9]\d{0,18}:\d{1,16}$/.test(value) || /^warnings:[1-9]\d{0,15}$/.test(value),
    ),
)
const Slowmode = Int(0, 21600)
/** The same fields, each optional */
const partial = <F extends Schema.Struct.Fields>(fields: F) =>
    Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Schema.optionalKey(value)])) as {
        [K in keyof F]: Schema.optionalKey<F[K]>
    }

export const StaffClass = Schema.Literals(["moderation", "cases", "automod", "security", "appeals"])
export type StaffClass = typeof StaffClass.Type
export const PermissionOverwriteSnapshot = Schema.Struct({ exists: Schema.Boolean, allow: Bits, deny: Bits }).check(
    Schema.makeFilter((value) => value.exists || (value.allow === "0" && value.deny === "0")),
)
export type PermissionOverwriteSnapshot = typeof PermissionOverwriteSnapshot.Type
export const ModerationActionType = Schema.Literals([
    "log",
    "warn",
    "kick",
    "ban",
    "unban",
    "timeout",
    "untimeout",
    "delete",
    "purge",
    "slowmode",
    "lock",
    "unlock",
    "quarantine",
    "release",
])
export type ModerationActionType = typeof ModerationActionType.Type
export const ModerationActionContext = Schema.Struct({
    ...origin,
    botActionAuthorized: Schema.Boolean,
    actorCanManageTarget: Schema.Boolean,
    botCanManageTarget: Schema.Boolean,
    targetProtected: Schema.Boolean,
    botId: Id,
    currentTimeoutUntil: Schema.optionalKey(Schema.NullOr(UtcTime)),
    currentOverwrite: Schema.optionalKey(PermissionOverwriteSnapshot),
    recoveryGeneration: Schema.optionalKey(Int(1)),
    currentSlowmodeSeconds: Schema.optionalKey(Slowmode),
    botAuthorizedActions: Schema.optionalKey(List(ModerationActionType, 15)),
    /** Decimal SendMessages and thread permission bits the bot holds server-wide. A lock owns SendMessages and only these thread bits,
     * because Fluxer lets a bot stop denying only permissions it holds. Absent means SendMessages only */
    botPostingPermissions: Schema.optionalKey(Bits),
    /** The target is a bot account, which gets no member notice */
    targetBot: Schema.optionalKey(Schema.Literal(true)),
})
export type ModerationActionContext = typeof ModerationActionContext.Type
/** A ban lasts 60 seconds to two years, other durations one second to a year. The reason is optional and stored as empty text when left out */
export const ModerationActionInput = Schema.Struct({
    type: ModerationActionType,
    targetId: Schema.optionalKey(Id),
    channelId: Schema.optionalKey(Id),
    messageIds: Schema.optionalKey(Ids(100).check(Schema.isMinLength(1))),
    durationSeconds: Schema.optionalKey(Int(1, 63072000)),
    slowmodeSeconds: Schema.optionalKey(Slowmode),
    reason: Schema.optionalKey(Text(512)),
    linkedCaseNo: Schema.optionalKey(Int(1)),
    recoveryId: Schema.optionalKey(Token),
}).check(
    Schema.makeFilter(
        (value) =>
            value.durationSeconds === undefined ||
            (value.type === "ban" ? value.durationSeconds >= 60 : value.durationSeconds <= 31536000),
    ),
)
export type ModerationActionInput = typeof ModerationActionInput.Type
/** mention-rate and link-rate count mentions or links across the member's messages in the window. deceptive-links flags masked links
 * whose label names another address and hosts that imitate a protected domain, from the built-in list and the rule's patterns */
export const AutomodRuleType = Schema.Literals([
    "spam",
    "repeat",
    "mentions",
    "words",
    "domains",
    "invites",
    "mention-rate",
    "link-rate",
    "deceptive-links",
])
export type AutomodRuleType = typeof AutomodRuleType.Type
export const AutomodAction = Schema.Literals(["log", "delete", "warn", "timeout"])
export type AutomodAction = typeof AutomodAction.Type
const ruleFields = {
    type: AutomodRuleType,
    enabled: Schema.Boolean,
    priority: Int(-100, 100),
    action: AutomodAction,
    threshold: Int(1, 100),
    windowSeconds: Int(1, 300),
    durationSeconds: Int(1, 31536000),
    patterns: List(Text(200), 1000),
    domainMode: Schema.Literals(["block", "allow"]),
}
export const AutomodRule = Schema.Struct({
    name: RuleName,
    ...ruleFields,
    channelIds: UniqueChannelIds,
    exemptChannelIds: UniqueChannelIds,
    exemptRoleIds: UniqueRoleIds,
})
export type AutomodRule = typeof AutomodRule.Type
const domain = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/
/**
 * A rule as a request gives it. The backend trims and lowercases its name and patterns and removes repeated patterns and IDs.
 * Words, domains and invites need a pattern, and the patterns of domains and deceptive-links rules are domains
 */
export const AutomodRuleInput = Schema.Struct({
    name: RuleNameInput,
    ...ruleFields,
    channelIds: ChannelIds,
    exemptChannelIds: ChannelIds,
    exemptRoleIds: RoleIds,
}).check(
    Schema.makeFilter(
        (rule) =>
            rule.patterns.length > 0 || (rule.type !== "words" && rule.type !== "domains" && rule.type !== "invites"),
    ),
    Schema.makeFilter(
        (rule) =>
            (rule.type !== "domains" && rule.type !== "deceptive-links") ||
            rule.patterns.every((pattern) => domain.test(pattern.trim().toLowerCase())),
    ),
)
const { name: _name, type: _type, ...patchFields } = AutomodRuleInput.fields
/** A change to some of a rule's settings. addPatterns and removePatterns change the stored list in place, adding first. The changed rule must still be valid */
export const AutomodRulePatch = Schema.Struct({
    ...partial(patchFields),
    addPatterns: Schema.optionalKey(List(Text(200), 1000)),
    removePatterns: Schema.optionalKey(List(Text(200), 1000)),
}).check(Schema.makeFilter((patch) => Object.keys(patch).length > 0))
export type AutomodRulePatch = typeof AutomodRulePatch.Type
const Mode = Schema.Literals(["dry-run", "enforce"])
const Defcon = Schema.Literals([1, 2, 3])
const settingsFields = {
    manualModerationEnabled: Schema.Boolean,
    logChannelId: Schema.NullOr(Id),
    automodEnabled: Schema.Boolean,
    automodMode: Mode,
    /** Automod also checks messages from webhooks and other bots. NeonFlux's own messages are never checked */
    automodBotMessagesEnabled: Schema.Boolean,
    securityEnabled: Schema.Boolean,
    securityMode: Mode,
    joinEnabled: Schema.Boolean,
    joinThreshold: Int(2, 100),
    joinWindowSeconds: Int(1, 300),
    joinDefcon2: Schema.Boolean,
    honeypotEnabled: Schema.Boolean,
    watchlistEnabled: Schema.Boolean,
    appealsEnabled: Schema.Boolean,
    defcon: Defcon,
}
const staff = <S extends Schema.Top>(ids: S) => ({
    moderation: ids,
    cases: ids,
    automod: ids,
    security: ids,
    appeals: ids,
})
/** How many days cases are kept from their creation and closed appeals from their closing. Absent or null keeps them until erased */
const CaseRetentionDays = Schema.optionalKey(Schema.NullOr(Int(1, 3650)))
/** The warning limit: After Count warnings for one member within Days days, NeonFlux times the member out for Seconds. See warningLimit for what absent values read as */
const warningLimitFields = {
    warningPenaltyEnabled: Schema.optionalKey(Schema.Boolean),
    warningPenaltyCount: Schema.optionalKey(Int(2, 20)),
    warningPenaltyDays: Schema.optionalKey(Int(1, 365)),
    warningPenaltySeconds: Schema.optionalKey(Int(1, 31536000)),
}
export const ModerationSettings = Schema.Struct({
    ...settingsFields,
    honeypotChannelIds: UniqueChannelIds,
    staffRoleIds: Schema.Struct(staff(UniqueRoleIds)),
    caseRetentionDays: CaseRetentionDays,
    ...warningLimitFields,
})
export type ModerationSettings = typeof ModerationSettings.Type
/** The warning limit as it applies: Off, 3 warnings, 30 days and 1 hour where a server stored no value, as every server that never set it */
export const warningLimit = (settings: Pick<ModerationSettings, keyof typeof warningLimitFields>) => ({
    warningPenaltyEnabled: settings.warningPenaltyEnabled ?? false,
    warningPenaltyCount: settings.warningPenaltyCount ?? 3,
    warningPenaltyDays: settings.warningPenaltyDays ?? 30,
    warningPenaltySeconds: settings.warningPenaltySeconds ?? 3600,
})
/** A change to some settings. The backend removes repeated IDs */
export const ModerationSettingsPatch = Schema.Struct({
    ...partial(settingsFields),
    honeypotChannelIds: Schema.optionalKey(ChannelIds),
    staffRoleIds: Schema.optionalKey(Schema.Struct(partial(staff(RoleIds)))),
    caseRetentionDays: CaseRetentionDays,
    ...warningLimitFields,
}).check(Schema.makeFilter((patch) => Object.keys(patch).length > 0))
export const ModerationOutcome = Schema.Literals(["succeeded", "failed", "uncertain"])
export type ModerationOutcome = typeof ModerationOutcome.Type
export const SecurityIncidentKind = Schema.Literals(["join-burst", "honeypot", "watchlist"])
export type SecurityIncidentKind = typeof SecurityIncidentKind.Type
export const ProviderObservation = Schema.Struct({
    ...origin,
    observedAt: Millis,
    memberUserId: Schema.optionalKey(Schema.String),
    timeoutUntil: Schema.optionalKey(Schema.NullOr(UtcTime)),
    banned: Schema.optionalKey(Schema.Boolean),
    banExpiresAt: Schema.optionalKey(Schema.NullOr(UtcTime)),
    memberPresent: Schema.optionalKey(Schema.Boolean),
    overwrite: Schema.optionalKey(PermissionOverwriteSnapshot),
    slowmodeSeconds: Schema.optionalKey(Slowmode),
})
export type ProviderObservation = typeof ProviderObservation.Type
const Delivery = Schema.Literals(["none", "pending", "sent", "failed", "uncertain"])
export const ModerationCase = Schema.Struct({
    caseNo: Int(1),
    actionId: Token,
    sourceId: SourceId,
    action: ModerationActionType,
    /** penalty is a case the warning limit opened by itself */
    origin: Schema.Literals(["manual", "automod", "security", "penalty"]),
    incident: Schema.optionalKey(SecurityIncidentKind),
    actorId: Schema.optionalKey(Id),
    targetId: Schema.optionalKey(Id),
    channelId: Schema.optionalKey(Id),
    reason: Str(512),
    ruleName: Schema.optionalKey(RuleName),
    linkedCaseNo: Schema.optionalKey(Int(1)),
    createdAt: Millis,
    expiresAt: Millis,
    outcome: Schema.Literals(["pending", "succeeded", "failed", "uncertain"]),
    logOutcome: Delivery,
    notificationOutcome: Delivery,
    erased: Schema.Boolean,
    voided: Schema.Boolean,
    /** How many times staff changed the reason or voided the case. case-history pages them */
    correctionCount: Int(),
    observation: Schema.optionalKey(ProviderObservation),
})
export type ModerationCase = typeof ModerationCase.Type
export const ModerationCorrection = Schema.Struct({
    actorId: Id,
    createdAt: Millis,
    previousReason: Str(512),
    reason: Str(512),
    type: Schema.Literals(["reason", "void"]),
})
export type ModerationCorrection = typeof ModerationCorrection.Type
export const ModerationActionGrant = Schema.Struct({
    actionId: Token,
    caseNo: Int(1),
    sourceId: SourceId,
    action: ModerationActionType,
    targetId: Schema.optionalKey(Id),
    channelId: Schema.optionalKey(Id),
    messageIds: Schema.optionalKey(UniqueIds(100).check(Schema.isMinLength(1))),
    durationSeconds: Schema.optionalKey(Int(1, 63072000)),
    slowmodeSeconds: Schema.optionalKey(Slowmode),
    expectedSlowmodeSeconds: Schema.optionalKey(Slowmode),
    reason: Str(512),
    expectedTimeoutUntil: Schema.optionalKey(Schema.NullOr(UtcTime)),
    restoreTimeoutUntil: Schema.optionalKey(Schema.NullOr(UtcTime)),
    overwrite: Schema.optionalKey(PermissionOverwriteSnapshot),
    expectedOverwrite: Schema.optionalKey(PermissionOverwriteSnapshot),
    /** Decimal permission bits of the everyone overwrite that a lock or unlock owns, present on every lock and unlock grant.
     * They are always SendMessages and at most the thread bits beside it, so a grant can never rewrite other permissions */
    ownedPermissions: Schema.optionalKey(
        Schema.String.check(
            Schema.makeFilter(
                (value: string) =>
                    /^[1-9]\d{0,18}$/.test(value) &&
                    (BigInt(value) & ~LOCK_PERMISSIONS) === 0n &&
                    (BigInt(value) & SEND_MESSAGES) !== 0n,
            ),
        ),
    ),
    recoveryId: Schema.optionalKey(Token),
})
export type ModerationActionGrant = typeof ModerationActionGrant.Type
export const StaffLogGrant = Schema.Struct({
    logId: Token,
    channelId: Id,
    caseNo: Int(1),
    action: ModerationActionType,
    outcome: ModerationOutcome,
    targetId: Schema.optionalKey(Id),
    reason: Str(512),
    durationSeconds: Schema.optionalKey(Int(1, 63072000)),
})
export type StaffLogGrant = typeof StaffLogGrant.Type
export const SecurityRecovery = Schema.Struct({
    recoveryId: Token,
    generation: Int(1),
    type: Schema.Literals(["timeout", "lock", "ban"]),
    targetId: Schema.optionalKey(Id),
    channelId: Schema.optionalKey(Id),
    caseNo: Int(1),
    status: Schema.Literals(["pending", "active", "uncertain"]),
    expectedTimeoutUntil: Schema.optionalKey(Schema.NullOr(UtcTime)),
    previousTimeoutUntil: Schema.optionalKey(Schema.NullOr(UtcTime)),
    previousOverwrite: Schema.optionalKey(PermissionOverwriteSnapshot),
    expectedOverwrite: Schema.optionalKey(PermissionOverwriteSnapshot),
    createdAt: Millis,
    knownDeadline: Schema.optionalKey(Millis),
})
export type SecurityRecovery = typeof SecurityRecovery.Type
export const WatchlistEntry = Schema.Struct({ userId: Id, reason: Str(512), createdAt: Millis })
export type WatchlistEntry = typeof WatchlistEntry.Type

const op = <const T extends string, F extends Schema.Struct.Fields>(type: T, fields: F) =>
    Schema.Struct({ type: Schema.Literal(type), ...fields })
const caseNo = { caseNo: Int(1) },
    page = Schema.optionalKey(Int(1, 1100))
export const ModerationManageOperation = Schema.Union([
    op("settings", { patch: ModerationSettingsPatch }),
    op("action", { action: ModerationActionInput, context: ModerationActionContext }),
    op("case-reason", { ...caseNo, reason: Text(512) }),
    op("case-void", caseNo),
    op("erase", caseNo),
    op("rule-create", { rule: AutomodRuleInput }),
    op("rule-update", { name: RuleNameInput, patch: AutomodRulePatch }),
    op("rule-delete", { name: RuleNameInput }),
    op("watchlist-add", { userId: Id, reason: Text(512) }),
    op("watchlist-remove", { userId: Id }),
    /** The one role whose members may view private cases, appeals and member history on the website. Only the server owner sets it */
    op("private-role", { roleId: Schema.NullOr(Id) }),
])
export type ModerationManageOperation = typeof ModerationManageOperation.Type
export const ModerationManageRequest = Schema.Struct({
    ...ModerationSource.fields,
    serverId: Id,
    actor: ModerationActor,
    operation: ModerationManageOperation,
})
export type ModerationManageRequest = typeof ModerationManageRequest.Type
const managed = <F extends Schema.Struct.Fields>(fields: F) =>
    Schema.Struct({ duplicate: Schema.Literal(false), ...fields })
export const ModerationManageResult = Schema.Union([
    Schema.Struct({ duplicate: Schema.Literal(true) }),
    managed({ type: Schema.Literal("settings"), settings: ModerationSettings }),
    managed({ type: Schema.Literal("case"), case: ModerationCase, grant: Schema.optionalKey(ModerationActionGrant) }),
    managed({ type: Schema.Literal("rule"), rule: AutomodRule }),
    managed({ type: Schema.Literal("deleted"), name: RuleName }),
    managed({ type: Schema.Literal("watchlist"), entry: WatchlistEntry }),
    managed({ type: Schema.Literal("watchlist-removed"), userId: Id }),
    managed({ type: Schema.Literal("erased"), cases: Int(), appeals: Int() }),
    managed({ type: Schema.Literal("private-role"), roleId: Schema.NullOr(Id) }),
])
export type ModerationManageResult = typeof ModerationManageResult.Type
export const ModerationQueryOperation = Schema.Union([
    op("settings", { appeals: Schema.optionalKey(Schema.Literal(true)) }),
    op("case-show", caseNo),
    /** A case's reason changes and voids, oldest first. Pages continue after the creation time of the last one shown */
    op("case-history", { caseNo: Int(1), after: Schema.optionalKey(Schema.Finite) }),
    op("case-list", { beforeCaseNo: Schema.optionalKey(Int(1)), userId: Schema.optionalKey(Id) }),
    op("rule-show", { name: RuleNameInput }),
    op("rule-list", { page }),
    /** Pages continue after the last member shown, so a list of any length pages to its end */
    op("watchlist-list", { afterUserId: Schema.optionalKey(Id) }),
    op("watchlist-show", { userId: Id }),
    /** Pages continue after the creation time of the last recovery shown */
    op("recovery-list", { after: Schema.optionalKey(Schema.Finite) }),
    op("recovery-target", { targetId: Id }),
    op("recovery-channel", { channelId: Id }),
    op("recovery-case", caseNo),
])
export type ModerationQueryOperation = typeof ModerationQueryOperation.Type
export const ModerationQueryRequest = Schema.Struct({
    ...origin,
    serverId: Id,
    actor: ModerationActor,
    privateChannelVerified: Schema.optionalKey(Schema.Boolean),
    /**
     * The command came from a server channel only these roles and Administrators can view, as the bot read it fresh. Its answer stays
     * there only when each is a staff role of the read
     */
    staffChannelRoleIds: Schema.optionalKey(UniqueRoleIds),
    operation: ModerationQueryOperation,
})
export type ModerationQueryRequest = typeof ModerationQueryRequest.Type
const paged = { page: Int(1), totalPages: Int(1) }
export const ModerationQueryResult = Schema.Union([
    /** openAppeals counts up to 1000, and moreOpenAppeals marks a count past that */
    Schema.Struct({
        type: Schema.Literal("settings"),
        settings: ModerationSettings,
        openAppeals: Schema.optionalKey(Int(0, 1000)),
        moreOpenAppeals: Schema.optionalKey(Schema.Literal(true)),
    }),
    Schema.Struct({ type: Schema.Literal("case"), case: ModerationCase }),
    /** An erased case lists no corrections */
    Schema.Struct({
        type: Schema.Literal("case-history"),
        caseNo: Int(1),
        erased: Schema.Boolean,
        corrections: List(ModerationCorrection, 10),
        nextAfter: Schema.optionalKey(Schema.Finite),
    }),
    Schema.Struct({
        type: Schema.Literal("cases"),
        cases: List(ModerationCase, 10),
        nextBeforeCaseNo: Schema.optionalKey(Int(1)),
    }),
    Schema.Struct({ type: Schema.Literal("rule"), rule: AutomodRule }),
    Schema.Struct({ type: Schema.Literal("rules"), rules: List(AutomodRule, 10), ...paged }),
    Schema.Struct({
        type: Schema.Literal("watchlist"),
        entries: List(WatchlistEntry, 10),
        nextAfterUserId: Schema.optionalKey(Id),
    }),
    Schema.Struct({ type: Schema.Literal("watchlist-entry"), entry: WatchlistEntry }),
    Schema.Struct({
        type: Schema.Literal("recoveries"),
        recoveries: List(SecurityRecovery, 10),
        nextAfter: Schema.optionalKey(Schema.Finite),
    }),
    Schema.Struct({ type: Schema.Literal("recovery"), recovery: SecurityRecovery }),
])
export type ModerationQueryResult = typeof ModerationQueryResult.Type
const gateFields = { actor: ModerationActor, command: Schema.Literals(["public", "staff", "critical", "appeal"]) }
export const ModerationGateRequest = Schema.Struct({ serverId: Id, ...gateFields })
export type ModerationGateRequest = typeof ModerationGateRequest.Type
export const ModerationGateResult = Schema.Struct({
    allowed: Schema.Boolean,
    defcon: Defcon,
    messageProtectionEnabled: Schema.Boolean,
    joinProtectionEnabled: Schema.Boolean,
    botMessageProtectionEnabled: Schema.Boolean,
})
export type ModerationGateResult = typeof ModerationGateResult.Type
/** The gate's answer from the settings. Staff and administrator are the backend's reading of the actor, and DEFCON 3 admits every command whoever sends it */
export function moderationGate(
    settings: ModerationSettings,
    command: ModerationGateRequest["command"],
    staff = false,
    administrator = false,
): ModerationGateResult {
    const allowed =
        settings.defcon === 3 ||
        (settings.defcon === 2 &&
            (command === "appeal" || ((command === "staff" || command === "critical") && staff))) ||
        (settings.defcon === 1 && command === "critical" && administrator)
    return {
        defcon: settings.defcon,
        allowed,
        messageProtectionEnabled: settings.automodEnabled || (settings.securityEnabled && settings.honeypotEnabled),
        joinProtectionEnabled: settings.securityEnabled && (settings.joinEnabled || settings.watchlistEnabled),
        botMessageProtectionEnabled: settings.automodEnabled && settings.automodBotMessagesEnabled,
    }
}
/** An edit carries its edit time, never before the message was created. A thread's parent is another channel, and the bot reports the actions it may take */
export const ModerationEvaluateRequest = Schema.Struct({
    ...ModerationSource.fields,
    serverId: Id,
    event: Schema.Literals(["create", "edit"]),
    editedAt: Schema.optionalKey(Millis),
    userId: Id,
    channelId: Id,
    /** For a message in a thread, the thread's parent channel. Automod scopes, exemptions and honeypots match either channel */
    parentChannelId: Schema.optionalKey(Id),
    roleIds: Ids(1000),
    content: Str(20000),
    contentHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
    mentionedUserIds: Ids(1000),
    mentionedRoleIds: Schema.NullOr(Ids(1000)),
    mentionedEveryone: Schema.NullOr(Schema.Boolean),
    targetIsStaff: Schema.Boolean,
    context: ModerationActionContext,
    /** A message from a webhook or another bot, which automod checks only while bot message checks are on. Absent for members */
    author: Schema.optionalKey(Schema.Literals(["bot", "webhook"])),
    /** A member's message may carry its gate request, so one call answers the gate and, while message protection is on, judges the message */
    gate: Schema.optionalKey(Schema.Struct(gateFields)),
}).check(
    Schema.makeFilter(
        (value) =>
            value.parentChannelId !== value.channelId &&
            value.context.botAuthorizedActions !== undefined &&
            (value.event === "create" || (value.editedAt !== undefined && value.editedAt >= value.createdAt)),
    ),
)
export type ModerationEvaluateRequest = typeof ModerationEvaluateRequest.Type
export const ModerationEvaluateResult = Schema.Struct({
    duplicate: Schema.Boolean,
    blocked: Schema.Boolean,
    case: Schema.optionalKey(ModerationCase),
    grant: Schema.optionalKey(ModerationActionGrant),
    gate: Schema.optionalKey(ModerationGateResult),
})
export type ModerationEvaluateResult = typeof ModerationEvaluateResult.Type
export const ModerationJoinRequest = Schema.Struct({
    serverId: Id,
    userId: Id,
    joinedAt: Millis,
    targetIsStaff: Schema.Boolean,
    context: ModerationActionContext,
})
export type ModerationJoinRequest = typeof ModerationJoinRequest.Type
export const ModerationJoinResult = Schema.Struct({
    duplicate: Schema.Boolean,
    settings: ModerationSettings,
    case: Schema.optionalKey(ModerationCase),
    grant: Schema.optionalKey(ModerationActionGrant),
})
export type ModerationJoinResult = typeof ModerationJoinResult.Type
export const ModerationOutcomeRequest = Schema.Struct({
    serverId: Id,
    actionId: Token,
    caseNo: Int(1),
    outcome: ModerationOutcome,
    timeoutUntil: Schema.optionalKey(Schema.NullOr(UtcTime)),
    banExpiresAt: Schema.optionalKey(Schema.NullOr(UtcTime)),
})
export type ModerationOutcomeRequest = typeof ModerationOutcomeRequest.Type
/** Claims a grant right before the bot dispatches its provider action. Only the first claim may dispatch */
export const ModerationDispatchRequest = Schema.Struct({
    serverId: Id,
    actionId: Token,
    caseNo: Int(1),
    dispatch: Schema.Literal(true),
})
export type ModerationDispatchRequest = typeof ModerationDispatchRequest.Type
/** Whether a staff log or member notice outcome was recorded */
const Recorded = Schema.Struct({ recorded: Schema.Boolean })
/** The member's DM about a warning, timeout, kick or ban. appeals says whether it may offer the appeal commands */
export const ModerationNoticeGrant = Schema.Struct({
    noticeId: Token,
    caseNo: Int(1),
    targetId: Id,
    action: Schema.Literals(["warn", "timeout", "kick", "ban"]),
    reason: Str(512),
    durationSeconds: Schema.optionalKey(Int(1, 63072000)),
    timeoutUntil: Schema.optionalKey(UtcTime),
    appeals: Schema.Boolean,
})
export type ModerationNoticeGrant = typeof ModerationNoticeGrant.Type
/** A dispatch claim. A kick or ban claim carries the member's notice, which goes out before the member may become unreachable */
export const ModerationDispatchResult = Schema.Struct({
    recorded: Schema.Boolean,
    notice: Schema.optionalKey(ModerationNoticeGrant),
})
export type ModerationDispatchResult = typeof ModerationDispatchResult.Type
export const ModerationOutcomeResult = Schema.Struct({
    recorded: Schema.Boolean,
    log: Schema.optionalKey(StaffLogGrant),
    notice: Schema.optionalKey(ModerationNoticeGrant),
    /** This warning reached the server's warning limit, so the bot reads the member fresh and sends a warning penalty request */
    warningPenaltyDue: Schema.optionalKey(Schema.Literal(true)),
})
export type ModerationOutcomeResult = typeof ModerationOutcomeResult.Type
/** The bot's fresh read of a member whose warning reached the limit. The backend counts again, so a repeated request or a later warning finds nothing due */
export const ModerationWarningPenaltyRequest = Schema.Struct({
    serverId: Id,
    actionId: Token,
    caseNo: Int(1),
    userId: Id,
    roleIds: Ids(1000),
    context: ModerationActionContext,
})
export type ModerationWarningPenaltyRequest = typeof ModerationWarningPenaltyRequest.Type
/** The timeout to perform, or a log case when NeonFlux may not act. Empty when no penalty is due */
export const ModerationWarningPenaltyResult = Schema.Struct({
    case: Schema.optionalKey(ModerationCase),
    grant: Schema.optionalKey(ModerationActionGrant),
})
export type ModerationWarningPenaltyResult = typeof ModerationWarningPenaltyResult.Type
const delivery = {
    caseNo: Int(1),
    outcome: Schema.Literals(["sent", "failed", "uncertain"]),
}
export const ModerationNoticeOutcomeRequest = Schema.Struct({ serverId: Id, noticeId: Token, ...delivery })
export type ModerationNoticeOutcomeRequest = typeof ModerationNoticeOutcomeRequest.Type
export const ModerationNoticeOutcomeResult = Recorded
export type ModerationNoticeOutcomeResult = typeof ModerationNoticeOutcomeResult.Type
export const ModerationLogOutcomeRequest = Schema.Struct({ serverId: Id, logId: Token, ...delivery })
export type ModerationLogOutcomeRequest = typeof ModerationLogOutcomeRequest.Type
export const ModerationLogOutcomeResult = Recorded
export type ModerationLogOutcomeResult = typeof ModerationLogOutcomeResult.Type
export const ModerationReconcileRequest = Schema.Struct({
    ...origin,
    ...ModerationSource.fields,
    serverId: Id,
    actor: ModerationActor,
    privateChannelVerified: Schema.optionalKey(Schema.Boolean),
    staffChannelRoleIds: Schema.optionalKey(UniqueRoleIds),
    actionId: Token,
    observation: ProviderObservation,
})
export type ModerationReconcileRequest = typeof ModerationReconcileRequest.Type
export const ModerationReconcileResult = Schema.Struct({ recorded: Schema.Boolean, case: ModerationCase })
export type ModerationReconcileResult = typeof ModerationReconcileResult.Type
export const ModerationObserveRequest = Schema.Struct({ serverId: Id })
export type ModerationObserveRequest = typeof ModerationObserveRequest.Type
export const ModerationObserveResult = Schema.Struct({ settings: ModerationSettings })
export type ModerationObserveResult = typeof ModerationObserveResult.Type
