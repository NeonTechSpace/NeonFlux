import type * as F from "@neontechspace/fluxerly/effect"
import { backendRoutes } from "./backend-routes.ts"

// The only values a warning's cause summary shows, field by field. Each one is a fixed name the bot, its backend, the SDK or
// Effect chose, so a value outside these lists, such as a backend's refusal sentence, message text, a member name or a secret,
// never reaches a log even when it sits in a known field. tests/cause-fields.test.ts checks that every error class of the bot
// and every value of its stage, reason and operation fields is listed here. The SDK's operation names are not listed: a summary
// leaves out the operation of an SDK error

type SdkError =
    | F.ApplicationError
    | F.AssetUrlError
    | F.AttachmentDownloadError
    | F.AttachmentRefreshError
    | F.AuthenticationError
    | F.BotApplicationOperationError
    | F.ChannelOperationError
    | F.ClientBusyError
    | F.ClientClosedError
    | F.CollectorError
    | F.ConfigurationError
    | F.ConnectionError
    | F.ConnectionTimeoutError
    | F.CountOperationError
    | F.CriticalWorkerStoppedError
    | F.EventOverflowError
    | F.EventReadBusyError
    | F.EventWaitError
    | F.GatewaySendError
    | F.GuildOperationError
    | F.HelperError
    | F.MemberChunkError
    | F.MessageCleanupError
    | F.MessageError
    | F.MessageOperationError
    | F.OAuthOperationError
    | F.PaginationError
    | F.PresenceError
    | F.RateLimitError
    | F.RestRequestError
    | F.ShardConnectionError
    | F.SupervisorChildError
    | F.SupervisorError
    | F.UserOperationError
    | F.WebhookOperationError
type SdkField<K extends string> = SdkError extends infer E
    ? E extends { readonly [key in K]: infer V }
        ? Extract<V, string>
        : never
    : never
// Keyed by the SDK's own types, so the typecheck fails when an SDK update adds, renames or removes a value
const sdkTags: Record<SdkField<"_tag">, true> = {
    ApplicationError: true,
    AssetUrlError: true,
    AttachmentDownloadError: true,
    AttachmentRefreshError: true,
    AuthenticationError: true,
    BotApplicationOperationError: true,
    ChannelOperationError: true,
    ClientBusyError: true,
    ClientClosedError: true,
    CollectorError: true,
    ConfigurationError: true,
    ConnectionError: true,
    ConnectionTimeoutError: true,
    CountOperationError: true,
    CriticalWorkerStoppedError: true,
    EventOverflowError: true,
    EventReadBusyError: true,
    EventWaitError: true,
    GatewaySendError: true,
    GuildOperationError: true,
    HelperError: true,
    MemberChunkError: true,
    MessageCleanupError: true,
    MessageError: true,
    MessageOperationError: true,
    OAuthOperationError: true,
    PaginationError: true,
    PresenceError: true,
    RateLimitError: true,
    RestRequestError: true,
    ShardConnectionError: true,
    SupervisorChildError: true,
    SupervisorError: true,
    UserOperationError: true,
    WebhookOperationError: true,
}
const sdkReasons: Record<SdkField<"reason">, true> = {
    busy: true,
    closed: true,
    color: true,
    connectionLost: true,
    cursorStalled: true,
    disconnected: true,
    filter: true,
    handler: true,
    hash: true,
    id: true,
    indexing: true,
    input: true,
    limit: true,
    link: true,
    markup: true,
    network: true,
    notConnected: true,
    notFound: true,
    notOwned: true,
    notReady: true,
    options: true,
    overflow: true,
    pageLimit: true,
    permissionBits: true,
    protocol: true,
    rateLimit: true,
    rejected: true,
    reserved: true,
    resource: true,
    response: true,
    restartLimit: true,
    shardCount: true,
    spawn: true,
    startupTimeout: true,
    target: true,
    text: true,
    time: true,
    timeout: true,
    tooLarge: true,
    untrustedUrl: true,
}
const sdkOutcomes: Record<F.OperationOutcome, true> = { notDispatched: true, rejected: true, unknown: true }

/** The SDK's error tags. Their operation names are left out of a summary, which keeps the tag, reason and outcome */
export const sdkErrorTags: ReadonlySet<string> = new Set(Object.keys(sdkTags))

/** Error classes and tags that may name a failure: the bot's, the SDK's, Effect's and JavaScript's built-in errors */
export const errorTags: ReadonlySet<string> = new Set([
    ...[
        "ActionExecutionError",
        "AfkStoreError",
        "AlertsHandlingError",
        "AlertsStoreError",
        "AnalyticsStoreError",
        "BackendRequestError",
        "BackupAttachmentError",
        "BackupCryptoError",
        "BackupHandlingError",
        "BackupPermissionError",
        "BackupStoreError",
        "BotConfigError",
        "ChannelParentError",
        "CleanupEvidenceError",
        "CleanupHandlingError",
        "CleanupPermissionError",
        "CleanupStoreError",
        "ComposerPermissionError",
        "DashboardConfigurationError",
        "DashboardMetadataError",
        "DashboardRoleError",
        "EventsHandlingError",
        "EventsStoreError",
        "GreetingsHandlingError",
        "GreetingsStoreError",
        "HelpDeskStoreError",
        "InstallationError",
        "LevelingHandlingError",
        "LevelingStoreError",
        "LfgStoreError",
        "MemberDataStoreError",
        "MemberEvidenceError",
        "MemberListError",
        "MemberListStoreError",
        "MetadataLogHandlingError",
        "MetadataLogPermissionError",
        "MetadataLogsStoreError",
        "MilestonesHandlingError",
        "MilestonesPermissionError",
        "MilestonesStoreError",
        "ModerationHandlingError",
        "ModerationStoreError",
        "OnboardingStoreError",
        "PresetStoreError",
        "ProfileStoreError",
        "ProtectionHandlingError",
        "PublishingHandlingError",
        "PublishingPermissionError",
        "PublishingStoreError",
        "ResponseHandlingError",
        "ResponseStoreError",
        "RoleHandlingError",
        "RolePermissionError",
        "RolePickerStoreError",
        "RolesStoreError",
        "SafetyPermissionError",
        "SchedulesHandlingError",
        "SchedulesPermissionError",
        "SchedulesStoreError",
        "ServerScopeError",
        "ShowcaseStoreError",
        "SidebarHandlingError",
        "SidebarStoreError",
        "StickyStoreError",
        "SuggestionTagError",
        "SuggestionsHandlingError",
        "SuggestionsPermissionError",
        "SuggestionsStoreError",
        "TemporaryRoleStoreError",
        "TicketHandlingError",
        "TicketPermissionError",
        "TicketStoreError",
        "VerificationHandlingError",
        "VerificationStoreError",
        "VoiceStoreError",
        "WelcomePermissionError",
        "YoutubeHandlingError",
        "YoutubeStoreError",
    ],
    ...sdkErrorTags,
    // SDK errors the Effect entry point does not export by name
    "CancelledError",
    "SdkDefect",
    ...[
        "AsyncFiberError",
        "ExceededCapacityError",
        "IllegalArgumentError",
        "NoSuchElementError",
        "SchemaError",
        "TimeoutError",
        "UnknownError",
    ],
    ...[
        "Error",
        "AggregateError",
        "DOMException",
        "EvalError",
        "RangeError",
        "ReferenceError",
        "SyntaxError",
        "TypeError",
        "URIError",
    ],
])

/** The backend's reason codes, as backend/convex/validation.ts REASON_CODES and the scope denial name them */
export const codes: ReadonlySet<string> = new Set([
    "BOT_PERMISSION",
    "BOT_BELOW_TARGET",
    "ACTOR_BELOW_TARGET",
    "ACTOR_PERMISSION",
    "TARGET_PROTECTED",
    "ROLE_NOT_ELIGIBLE",
    "REFUSED",
    "USAGE_BUDGET_INVALID",
    "MEMBER_NOT_READY",
    "PANEL_CHANGED",
    "NEONFLUX_SCOPE_DENIED",
])

/** The backend paths the bot requests. They hold no IDs, so each is its own route template */
export const routes: ReadonlySet<string> = new Set(Object.keys(backendRoutes))

/**
 * A store names its failed operation by its backend path or the part after the feature, such as reaction-jobs for
 * /roles/reaction-jobs, so every path and every such ending is a known operation
 */
const routeOperations = [...routes].flatMap((route) => {
    const parts = route.split("/").slice(1)
    return [route, ...parts.map((_, i) => parts.slice(i).join("/"))]
})
export const operations: ReadonlySet<string> = new Set([
    ...[
        "actor",
        "authority",
        "bot",
        "channel",
        "evaluate",
        "guild",
        "join",
        "leave",
        "list",
        "manage",
        "member",
        "observe",
        "parent",
        "private-channel",
        "roles",
        "self",
        "set",
        "target",
    ],
    // Store operations that are not a backend path
    "manifest",
    ...routeOperations,
])

export const stages: ReadonlySet<string> = new Set([
    "absent",
    "administrator",
    "authority",
    "authorization",
    "binding",
    "bot",
    "chain",
    "channel",
    "channelType",
    "claim",
    "configuration",
    "content",
    "context",
    "delivery",
    "destination",
    "eligibility",
    "epoch",
    "expired",
    "grant",
    "hierarchy",
    "history",
    "identity",
    "input",
    "invite",
    "member",
    "membership",
    "message",
    "metadata",
    "missing",
    "observation",
    "outcome",
    "overwrites",
    "panel",
    "parent",
    "participant",
    "permissions",
    "private",
    "private-channel",
    "private-delivery",
    "reaction",
    "read",
    "reference",
    "response",
    "result",
    "role",
    "send",
    "snapshot",
    "target",
    "timestamp",
    "transcript",
    "website",
    "work",
])

// A store error's reason is a backend sentence, so it is never one of these
export const reasons: ReadonlySet<string> = new Set([
    ...[
        "actor-rank",
        "archive",
        "authentication",
        "binding",
        "bot-rank",
        "capacity",
        "claim",
        "configuration",
        "envelope",
        "everyone",
        "expired",
        "grant",
        "identity",
        "limit",
        "manifest",
        "metadata",
        "missing",
        "origin",
        "owner",
        "parts",
        "private",
        "privileged",
        "reference",
        "size",
        "snapshot",
        "transport",
        "version",
    ],
    ...Object.keys(sdkReasons),
])

export const outcomes: ReadonlySet<string> = new Set(Object.keys(sdkOutcomes))
