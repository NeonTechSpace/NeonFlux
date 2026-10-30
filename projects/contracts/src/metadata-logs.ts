import { Schema } from "effect"
import { Id, Int, InviteCode, IsoTime, List, Millis, Str, Token, origin } from "./common.ts"
import { CleanupContext } from "./cleanup.ts"

export const METADATA_RETENTION = 2592000000,
    METADATA_DAY = 86400000,
    METADATA_CAPACITY = 10000,
    METADATA_PAGE = 20,
    METADATA_GRANT_MS = 120000,
    METADATA_SETTLE_MS = 10000
/** Message text a record keeps per side: Fluxer's longest message, MAX_MESSAGE_LENGTH_PREMIUM, so no text is cut */
export const METADATA_TEXT = 4000
export const metadataCategories = [
    "membership",
    "resources",
    "messages",
    "audit",
    "settings",
    "operations",
    "security",
] as const
export const metadataTypes = {
    membership: ["member-add", "member-update", "member-remove"],
    resources: [
        "role-create",
        "role-update",
        "role-delete",
        "channel-create",
        "channel-update",
        "channel-delete",
        "thread-create",
        "thread-update",
        "thread-delete",
        "server-update",
    ],
    messages: ["message-update", "message-delete", "message-bulk-delete"],
    audit: ["audit-entry"],
    settings: ["settings-change"],
    operations: ["backend-failure", "admission-failure", "delivery-failure", "gateway-discontinuity"],
    // Security alerts and invite logs, which the bot sends only for the alerts a server turned on
    security: [
        "invite-create",
        "invite-delete",
        "bot-join",
        "webhook-change",
        "privilege-change",
        "impersonation",
        "alert-action",
    ],
} as const
/** Every event type, in category order */
export const metadataEventTypes: readonly (typeof metadataTypes)[keyof typeof metadataTypes][number][] =
    metadataCategories.flatMap((category) => metadataTypes[category])
export const metadataChangedFields = {
    membership: ["roles", "nickname", "timeout", "pending", "username", "avatar", "banner", "muted", "deafened"],
    resources: [
        "name",
        "permissions",
        "position",
        "parent",
        "type",
        "topic",
        "slowmode",
        "icon",
        "owner",
        "archived",
        "locked",
        "tags",
        "color",
        "hoist",
        "mentionable",
        "nsfw",
        "bitrate",
        "userLimit",
        "overwrites",
        "banner",
        "splash",
        "systemChannel",
        "afkChannel",
        "afkTimeout",
        "verificationLevel",
        "contentFilter",
        "notifications",
        "mfaLevel",
    ],
    messages: ["update", "pinned", "flags"],
    audit: [],
    settings: [
        "manualModerationEnabled",
        "automodEnabled",
        "securityEnabled",
        "joinEnabled",
        "honeypotEnabled",
        "watchlistEnabled",
        "automodMode",
        "securityMode",
        "staffRoleIds",
        "logChannelId",
        "retentionDays",
        "joinWindowSeconds",
        "joinThreshold",
        "joinDefcon2",
        "honeypotChannelIds",
        "defcon",
        "enabled",
        "route",
        "messageChannelIds",
        "excludedChannelIds",
        "configuration",
    ],
    operations: [],
    // Invite flags, webhook changes, how a privilege was gained and the dangerous permission names, the matched name, and
    // the action NeonFlux took on an alert with its outcome
    security: [
        "never-expires",
        "unlimited-uses",
        "created",
        "updated",
        "role-permissions",
        "member-roles",
        "Administrator",
        "ManageGuild",
        "ManageRoles",
        "ManageChannels",
        "ManageWebhooks",
        "BanMembers",
        "KickMembers",
        "ModerateMembers",
        "username",
        "nickname",
        "kick-bot",
        "delete-webhook",
        "remove-permissions",
        "succeeded",
        "failed",
        "uncertain",
    ],
} as const
/** Every audit action Fluxer lists */
export const metadataAuditActions = [
    1, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 32, 40, 41, 42, 50, 51, 52, 60, 61, 62, 72,
    73, 74, 75, 90, 91, 92, 110, 111, 112,
] as const
export const metadataEventSelectors: readonly (
    (typeof metadataEventTypes)[number] | `audit-entry:${(typeof metadataAuditActions)[number]}`
)[] = [...metadataEventTypes, ...metadataAuditActions.map((action) => `audit-entry:${action}` as const)]
const eventLabels: Record<(typeof metadataEventTypes)[number], string> = {
    "member-add": "Member joined",
    "member-update": "Member changed",
    "member-remove": "Member departed",
    "role-create": "Role created",
    "role-update": "Role changed",
    "role-delete": "Role deleted",
    "channel-create": "Channel created",
    "channel-update": "Channel changed",
    "channel-delete": "Channel deleted",
    "thread-create": "Thread created",
    "thread-update": "Thread changed",
    "thread-delete": "Thread deleted",
    "server-update": "Server changed",
    "message-update": "Message edited",
    "message-delete": "Message deleted",
    "message-bulk-delete": "Messages deleted in bulk",
    "audit-entry": "Audit log entry",
    "settings-change": "Settings changed",
    "backend-failure": "Log processing failed",
    "admission-failure": "Events not recorded",
    "delivery-failure": "Log post failed",
    "gateway-discontinuity": "Connection to Fluxer interrupted",
    "invite-create": "Invite created",
    "invite-delete": "Invite deleted",
    "bot-join": "Unexpected bot joined",
    "webhook-change": "Unexpected webhook change",
    "privilege-change": "Dangerous permissions granted",
    impersonation: "Possible impersonation",
    "alert-action": "Security alert action",
}
const auditLabels: Record<(typeof metadataAuditActions)[number], string> = {
    1: "Server changed",
    10: "Channel created",
    11: "Channel changed",
    12: "Channel deleted",
    13: "Channel permission added",
    14: "Channel permission changed",
    15: "Channel permission removed",
    20: "Member kicked",
    21: "Members pruned",
    22: "Member banned",
    23: "Member unbanned",
    24: "Member changed",
    25: "Member roles changed",
    26: "Member moved in voice",
    27: "Member disconnected from voice",
    28: "Bot added",
    30: "Role created",
    31: "Role changed",
    32: "Role deleted",
    40: "Invite created",
    41: "Invite changed",
    42: "Invite deleted",
    50: "Webhook created",
    51: "Webhook changed",
    52: "Webhook deleted",
    60: "Emoji created",
    61: "Emoji changed",
    62: "Emoji deleted",
    72: "Message deleted",
    73: "Messages deleted in bulk",
    74: "Message pinned",
    75: "Message unpinned",
    90: "Sticker created",
    91: "Sticker changed",
    92: "Sticker deleted",
    110: "Thread created",
    111: "Thread changed",
    112: "Thread deleted",
}
/**
 * A plain name for an event type or audit action selector, such as Member joined for member-add. Log posts, replies and the website
 * show it, and commands take it as well as the code
 */
export function metadataEventLabel(selector: string) {
    const action = /^audit-entry:(\d+)$/.exec(selector)?.[1]
    return action
        ? `Audit: ${auditLabels[Number(action) as (typeof metadataAuditActions)[number]] ?? "Log entry"}`
        : (eventLabels[selector as (typeof metadataEventTypes)[number]] ?? selector)
}
export const MetadataLogsEventSelector = Schema.Literals(metadataEventSelectors)
const metadataLogCategories = metadataCategories
const text = (max = 4096) => Str(max).check(Schema.isMinLength(1))
const array = <S extends Schema.Top>(item: S, max = METADATA_PAGE) => List(item, max)

export const MetadataLogsCategory = Schema.Literals(metadataLogCategories)
export const MetadataLogsSettingsScope = Schema.Literals(["moderation", "metadata", "security"])
/** The dashboard setting families a website change names in its settings record */
export const MetadataLogsDashboardScope = Schema.Literals([
    "metadata",
    "roles",
    "responses",
    "moderation",
    "publishing",
    "greetings",
    "tickets",
    "leveling",
    "milestones",
    "suggestions",
    "cleanup",
    "events",
    "schedules",
    "nickname",
    "voice",
    "rolepicker",
    "temproles",
    "sticky",
    "sidebar",
    "memberlist",
    "alerts",
    "helpdesk",
    "onboarding",
    "presets",
    "lfg",
    "showcase",
    "profile",
    "youtube",
    "twitch",
])
export const MetadataLogsDashboardSettingScope = Schema.Literals(["general", "responses"])
export const MetadataLogsOutcome = Schema.Literals(["observed", "accepted", "failed", "disconnected", "reconnected"])
export const MetadataLogsEventType = Schema.Literals(metadataEventTypes)
export const MetadataLogsSource = Schema.Union([
    Schema.Struct({ kind: Schema.Literal("audit"), auditEntryId: Id }),
    Schema.Struct({ kind: Schema.Literal("message-delete"), messageId: Id }),
    Schema.Struct({
        kind: Schema.Literal("member-add"),
        userId: Id,
        joinedAt: text(64).check(Schema.makeFilter((v) => Number.isFinite(Date.parse(v)))),
    }),
    Schema.Struct({
        kind: Schema.Literal("observation"),
        sessionId: text(32).check(Schema.isPattern(/^[a-f0-9]{32}$/)),
        sequence: Int(1),
    }),
    Schema.Struct({ kind: Schema.Literal("settings"), messageId: Id, scope: MetadataLogsSettingsScope }),
    Schema.Struct({ kind: Schema.Literal("dashboard"), jobId: Token, scope: MetadataLogsDashboardScope }),
    Schema.Struct({
        kind: Schema.Literal("dashboard-setting"),
        scope: MetadataLogsDashboardSettingScope,
        revision: Int(1),
    }),
])
/** event is an account the Fluxer event itself names, such as the creator of a new invite */
export const MetadataLogsActor = Schema.Union([
    Schema.Struct({ kind: Schema.Literal("unknown") }),
    Schema.Struct({ kind: Schema.Literals(["audit", "configuration", "event"]), userId: Id }),
])
/** A message attachment as NeonFlux last saw it. url is left out when Fluxer's link is longer than 512 characters */
export const MetadataLogsAttachment = Schema.Struct({
    name: text(256),
    size: Int(0),
    url: Schema.optionalKey(Str(512)),
})
/**
 * One changed value, ready to show: before and after for a value, added and removed for a list. Names are escaped and
 * mentions formatted by the bot
 */
export const MetadataLogsChange = Schema.Struct({
    field: text(64),
    before: Schema.optionalKey(Str(300)),
    after: Schema.optionalKey(Str(300)),
    added: Schema.optionalKey(Str(600)),
    removed: Schema.optionalKey(Str(600)),
}).check(
    Schema.makeFilter(
        (v) => v.before !== undefined || v.after !== undefined || v.added !== undefined || v.removed !== undefined,
    ),
)
/**
 * What a record shows beyond IDs. text and before are message text, where an absent value is unknown and an empty one is
 * known empty. earlierUnknown says NeonFlux had no earlier copy to compare with. moreChanges counts the changes left out
 */
export const MetadataLogsDetails = Schema.Struct({
    authorId: Schema.optionalKey(Id),
    before: Schema.optionalKey(Str(METADATA_TEXT)),
    text: Schema.optionalKey(Str(METADATA_TEXT)),
    earlierUnknown: Schema.optionalKey(Schema.Literal(true)),
    attachments: Schema.optionalKey(List(MetadataLogsAttachment, 10)),
    attachmentCount: Schema.optionalKey(Int(0)),
    authors: Schema.optionalKey(List(Schema.Struct({ userId: Id, count: Int(1) }), 20)),
    changes: Schema.optionalKey(List(MetadataLogsChange, 20)),
    moreChanges: Schema.optionalKey(Int(1)),
    reason: Schema.optionalKey(text(512)),
    inviteCode: Schema.optionalKey(InviteCode),
})
// The details each kind of record may carry
function detailKeys(type: (typeof metadataEventTypes)[number], category: MetadataLogsCategory): readonly string[] {
    if (type === "message-update")
        return ["authorId", "before", "text", "earlierUnknown", "attachments", "attachmentCount"]
    if (type === "message-delete") return ["authorId", "text", "attachments", "attachmentCount"]
    if (type === "message-bulk-delete") return ["authors"]
    if (category === "membership" || category === "resources") return ["changes", "moreChanges", "earlierUnknown"]
    if (category === "audit") return ["changes", "moreChanges", "reason", "inviteCode"]
    if (type === "invite-create" || type === "invite-delete") return ["inviteCode"]
    return []
}
function validDetails(v: {
    type: (typeof metadataEventTypes)[number]
    category: MetadataLogsCategory
    changedFields: readonly string[]
    details?: typeof MetadataLogsDetails.Type
}) {
    const d = v.details
    if (!d) return true
    const keys = Object.keys(d),
        allowed = detailKeys(v.type, v.category),
        changes = d.changes ?? []
    return (
        keys.length > 0 &&
        keys.every((key) => allowed.includes(key)) &&
        !(d.earlierUnknown && d.before !== undefined) &&
        (d.attachmentCount === undefined || d.attachmentCount >= (d.attachments?.length ?? 0)) &&
        (d.moreChanges === undefined || changes.length === 20) &&
        new Set(changes.map((c) => c.field)).size === changes.length &&
        new Set((d.authors ?? []).map((a) => a.userId)).size === (d.authors ?? []).length &&
        changes.every((c) =>
            v.category === "audit" ? /^[a-z0-9_]{1,64}$/.test(c.field) : v.changedFields.includes(c.field),
        )
    )
}
// Security alerts may carry their own audit entry as source and actor
const auditAlert = (v: { type: string; source: { kind: string } }) =>
    (v.type === "privilege-change" || v.type === "webhook-change") && v.source.kind === "audit"
export const MetadataLogsEvent = Schema.Struct({
    ...origin,
    category: MetadataLogsCategory,
    type: MetadataLogsEventType,
    source: Schema.mutableKey(MetadataLogsSource),
    observedAt: Int(),
    actor: MetadataLogsActor,
    resourceIds: array(Id),
    changedFields: array(text(64)),
    count: Int(1),
    channelId:
        Schema.optionalKey(
            Id,
        ) /** The parent channel of a message's thread, or of the thread a thread event describes */,
    parentChannelId: Schema.optionalKey(Id),
    authorBot: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
    privateChannel: Schema.optionalKey(Schema.Boolean),
    auditAction: Schema.optionalKey(
        Int().check(Schema.makeFilter((v) => (metadataAuditActions as readonly number[]).includes(v))),
    ),
    outcome: Schema.optionalKey(MetadataLogsOutcome),
    details: Schema.optionalKey(MetadataLogsDetails),
}).check(
    Schema.makeFilter((v) => {
        const prefixes: Record<MetadataLogsCategory, readonly string[]> = {
            membership: ["member-"],
            resources: ["role-", "channel-", "thread-", "server-"],
            messages: ["message-"],
            audit: ["audit-entry"],
            settings: ["settings-change"],
            operations: ["backend-failure", "admission-failure", "delivery-failure", "gateway-discontinuity"],
            security: ["invite-", "bot-join", "webhook-change", "privilege-change", "impersonation", "alert-action"],
        }
        return (
            validDetails(v) &&
            prefixes[v.category].some((p) => v.type.startsWith(p)) &&
            new Set(v.resourceIds).size === v.resourceIds.length &&
            new Set(v.changedFields).size === v.changedFields.length &&
            v.changedFields.every((f) => (metadataChangedFields[v.category] as readonly string[]).includes(f)) &&
            (v.actor.kind === "unknown" ||
                (v.actor.kind === "audit" && (v.category === "audit" || auditAlert(v))) ||
                (v.actor.kind === "configuration" && v.category === "settings") ||
                (v.actor.kind === "event" && v.type === "invite-create")) &&
            (v.category === "audit"
                ? v.source.kind === "audit" && v.auditAction !== undefined && v.resourceIds.length <= 1
                : v.auditAction === undefined) &&
            (v.type === "message-delete"
                ? v.source.kind === "message-delete" && v.resourceIds.includes(v.source.messageId)
                : true) &&
            (v.type === "member-add" && v.source.kind === "member-add"
                ? v.resourceIds.includes(v.source.userId)
                : true) &&
            (v.category === "settings"
                ? v.source.kind === "settings" || v.source.kind === "dashboard" || v.source.kind === "dashboard-setting"
                : true) &&
            (v.category === "audit" ||
                v.category === "settings" ||
                v.type === "message-delete" ||
                (v.type === "member-add" && v.source.kind === "member-add") ||
                auditAlert(v) ||
                v.source.kind === "observation") &&
            (v.category === "messages"
                ? v.channelId !== undefined && v.authorBot !== undefined && v.privateChannel !== undefined
                : v.authorBot === undefined && v.privateChannel === undefined) &&
            (v.type.startsWith("thread-")
                ? v.parentChannelId !== undefined && !v.resourceIds.includes(v.parentChannelId)
                : v.parentChannelId === undefined ||
                  (v.category === "messages" && v.parentChannelId !== v.channelId)) &&
            (v.type === "message-bulk-delete" ||
                v.category === "resources" ||
                v.category === "operations" ||
                v.count === 1)
        )
    }),
)
export const MetadataLogsEventInput = MetadataLogsEvent.check(
    Schema.makeFilter((v) => v.source.kind !== "member-add" || Schema.is(IsoTime)(v.source.joinedAt)),
)
export const MetadataLogsRoute = Schema.Struct({
    category: MetadataLogsCategory,
    revision: Int(1),
    enabled: Schema.Boolean,
    channelId: Schema.optionalKey(Id),
    ownerId: Schema.optionalKey(Id),
}).check(Schema.makeFilter((v) => !v.enabled || (!!v.channelId && !!v.ownerId)))
export const MetadataLogsEventRoute = Schema.Struct({
    eventType: MetadataLogsEventSelector,
    revision: Int(1),
    enabled: Schema.Boolean,
    channelId: Schema.optionalKey(Id),
    ownerId: Schema.optionalKey(Id),
}).check(
    Schema.makeFilter(
        (v) =>
            (v.channelId === undefined) === (v.ownerId === undefined) && (!v.enabled || (!!v.channelId && !!v.ownerId)),
    ),
)
/** The most channels a server lists for message events, and the most it excludes */
export const METADATA_CHANNEL_LIMIT = 500
export const MetadataLogsSettings = Schema.Struct({
    enabled: Schema.Boolean,
    revision: Int(1),
    configRevision: Int(),
    routes: array(MetadataLogsRoute, 7),
    eventRoutes: array(MetadataLogsEventRoute, metadataEventSelectors.length),
    /** Message events come from every channel except the excluded ones, instead of only the listed ones */
    allChannels: Schema.Boolean,
    messageChannelIds: array(Id, METADATA_CHANNEL_LIMIT),
    excludedChannelIds: array(Id, METADATA_CHANNEL_LIMIT),
    retained: Int(0, 10000),
    capacity: Schema.Literal(10000),
    retentionMs: Schema.Literal(2592000000),
    suppressed: Int(),
}).check(
    Schema.makeFilter(
        (v) =>
            v.routes.length === 7 &&
            new Set(v.routes.map((r) => r.category)).size === 7 &&
            new Set(v.eventRoutes.map((r) => r.eventType)).size === v.eventRoutes.length &&
            new Set(v.messageChannelIds).size === v.messageChannelIds.length &&
            new Set(v.excludedChannelIds).size === v.excludedChannelIds.length &&
            (!v.allChannels || v.messageChannelIds.length === 0),
    ),
)
export const MetadataLogsBinding = Schema.Struct({
    recordNo: Int(1),
    routeRevision: Int(1),
    moduleRevision: Int(1),
    generation: Int(1),
    channelId: Id,
    ownerId: Id,
    routeEventType: Schema.mutableKey(Schema.optionalKey(MetadataLogsEventSelector)),
})
const bindingFields = MetadataLogsBinding.fields
export const MetadataLogsDeliveryState = Schema.Literals([
    "queued",
    "reserved",
    "sent",
    "failed",
    "uncertain",
    "cancelled",
])
export const MetadataLogsEmbed = Schema.Struct({ title: text(256), description: text(4096), color: Int(0, 16777215) })
export const MetadataLogsGrant = Schema.Struct({
    ...bindingFields,
    botId: Id,
    dispatchExpiresAt: Int(),
    nativeDeadlineMs: Schema.Literal(5000),
    content: Schema.Literal(""),
    embed: MetadataLogsEmbed,
})
export const MetadataLogsDelivery = Schema.Struct({
    ...bindingFields,
    state: MetadataLogsDeliveryState,
    nextCheckAt: Int(),
    grant: Schema.optionalKey(MetadataLogsGrant),
    claimedAt: Schema.optionalKey(Int()),
    finishedAt: Schema.optionalKey(Int()),
    noDispatch: Schema.optionalKey(Schema.Literal(true)),
    messageId: Schema.optionalKey(Id),
    reconciledAt: Schema.optionalKey(Int()),
    resolution: Schema.optionalKey(Schema.Literals(["match", "absent"])),
    /** Fluxer answered that the log channel does not exist, so this post failed unsent and is never tried again */
    problem: Schema.optionalKey(Schema.Literal("channel")),
}).check(
    Schema.makeFilter(
        (v) =>
            (!v.grant || sameMetadataLogBinding(v, v.grant)) &&
            (!v.noDispatch || v.claimedAt === undefined) &&
            (!v.resolution || v.reconciledAt !== undefined) &&
            (!v.problem || (v.state === "failed" && v.noDispatch === true)),
    ),
)
export const MetadataLogsPresentation = Schema.Struct({ format: Schema.Literal("embed-v1"), embed: MetadataLogsEmbed })
export const MetadataLogsRecord = Schema.Struct({
    recordNo: Int(1),
    event: MetadataLogsEvent,
    admittedAt: Int(),
    expiresAt: Int(),
    presentation: Schema.mutableKey(MetadataLogsPresentation),
    delivery: Schema.mutableKey(Schema.NullOr(MetadataLogsDelivery)),
}).check(
    Schema.makeFilter(
        (v) =>
            v.expiresAt >= v.admittedAt &&
            (!v.delivery ||
                (v.delivery.recordNo === v.recordNo &&
                    (v.delivery.routeEventType === undefined ||
                        v.delivery.routeEventType === v.event.type ||
                        (v.event.type === "audit-entry" &&
                            v.delivery.routeEventType === `audit-entry:${v.event.auditAction}`)) &&
                    (!v.delivery.grant ||
                        (v.delivery.grant.content === "" &&
                            equalMetadataEmbed(v.delivery.grant.embed, v.presentation.embed))))),
    ),
)
const definitions = Schema.Struct({
    tickets: Schema.Literal("Active slots including reserved and recovery work"),
    moderation: Schema.Literal("Retained manual, event and critical cases"),
    metadata: Schema.Literal("Retained admitted records, not unique causal actions"),
    deliveries: Schema.Literal("Current delivery states, independent of event admission"),
})
export const MetadataLogsCounters = Schema.Struct({
    activeTicketSlots: Int(),
    retainedModerationCases: Int(),
    retainedMetadataRecords: Int(0, 10000),
    categories: Schema.Struct({
        membership: Int(),
        resources: Int(),
        messages: Int(),
        audit: Int(),
        settings: Int(),
        operations: Int(),
        security: Int(),
    }),
    queued: Int(),
    reserved: Int(),
    failed: Int(),
    uncertain: Int(),
    suppressed: Int(),
    definitions,
}).check(
    Schema.makeFilter(
        (v) =>
            Object.values(v.categories).reduce((a, b) => a + b, 0) === v.retainedMetadataRecords &&
            v.queued + v.reserved + v.failed + v.uncertain <= v.retainedMetadataRecords,
    ),
)
export const MetadataLogsQueryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings: MetadataLogsSettings }),
    Schema.Struct({
        type: Schema.Literal("records"),
        records: array(MetadataLogsRecord),
        nextBeforeRecordNo: Schema.optionalKey(Int(1)),
    }),
    Schema.Struct({ type: Schema.Literal("record"), record: MetadataLogsRecord }),
    Schema.Struct({ type: Schema.Literal("counters"), counters: MetadataLogsCounters }),
])
export const MetadataLogsManageResult = Schema.Union([
    Schema.Struct({ duplicate: Schema.Literal(true) }),
    Schema.Struct({
        duplicate: Schema.Literal(false),
        type: Schema.Literal("settings"),
        settings: MetadataLogsSettings,
    }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("forgotten"), recordNo: Int(1) }),
    Schema.Struct({
        duplicate: Schema.Literal(false),
        type: Schema.Literal("reconciled"),
        recorded: Schema.Boolean,
        record: MetadataLogsRecord,
    }),
])
export const MetadataLogsWorkResult = Schema.Union([
    Schema.Struct({
        type: Schema.Literal("work"),
        records: array(MetadataLogsRecord),
        nextCursor: Schema.optionalKey(text(8192)),
    }),
    Schema.Struct({ type: Schema.Literal("reserved"), grant: MetadataLogsGrant }),
    Schema.Struct({ type: Schema.Literal("claimed"), claimed: Schema.Boolean, grant: MetadataLogsGrant }),
    Schema.Struct({ type: Schema.Literal("record"), record: MetadataLogsRecord }),
    Schema.Struct({ type: Schema.Literal("messages"), logged: Schema.Boolean }),
])
export const MetadataLogsAdmitResult = Schema.Union([
    Schema.Struct({ admitted: Schema.Literal(true), duplicate: Schema.Literal(false), record: MetadataLogsRecord }),
    Schema.Struct({
        admitted: Schema.Literal(false),
        duplicate: Schema.Boolean,
        reason: Schema.Literals(["duplicate", "disabled", "messages-off", "excluded", "rate-limited"]),
    }),
])
/** actorAuthorized is destination View/Send, botAuthorized is View/Send/Embed/History. Neither is inferred from administrator status */
export const MetadataLogsContext = Schema.Struct({ ...CleanupContext.fields, channelType: Schema.Literals([0, 1, 5]) })
export const MetadataLogsPrivateRead = Schema.Struct({
    ...origin,
    channelId: Id,
    recipientIds: List(Id, Number.MAX_SAFE_INTEGER),
    oneToOne: Schema.Literal(true),
})
export const MetadataLogsObservation = Schema.Struct({
    ...origin,
    messageId: Id,
    channelId: Id,
    botId: Id,
    observedAt: Millis,
    status: Schema.Literals(["match", "absent", "conflict", "unknown"]),
    content: Schema.optionalKey(Str(2000)),
    embed: Schema.optionalKey(MetadataLogsEmbed),
})
const moduleOperation = Schema.Struct({
    type: Schema.Literal("module"),
    expectedRevision: Int(),
    enabled: Schema.Boolean,
})
const channelsOperation = Schema.Struct({
    type: Schema.Literal("channels"),
    expectedRevision: Int(),
    /** Every channel except the excluded ones. Absent keeps listed mode */
    allChannels: Schema.optionalKey(Schema.Boolean),
    messageChannelIds: List(Id, METADATA_CHANNEL_LIMIT).check(Schema.makeFilter((v) => new Set(v).size === v.length)),
    excludedChannelIds: List(Id, METADATA_CHANNEL_LIMIT).check(Schema.makeFilter((v) => new Set(v).size === v.length)),
}).check(Schema.makeFilter((v) => !v.allChannels || v.messageChannelIds.length === 0))
const routeOperation = Schema.Struct({
    type: Schema.Literal("route"),
    category: MetadataLogsCategory,
    expectedRevision: Int(),
    enabled: Schema.Boolean,
    channelId: Id,
    ownerId: Id,
})
const clearOperation = Schema.Struct({
    type: Schema.Literal("clear"),
    category: MetadataLogsCategory,
    expectedRevision: Int(),
})
const eventRouteOperation = Schema.Struct({
    type: Schema.Literal("event-route"),
    eventType: MetadataLogsEventSelector,
    expectedRevision: Int(),
    enabled: Schema.Boolean,
    channelId: Schema.optionalKey(Id),
    ownerId: Schema.optionalKey(Id),
}).check(
    Schema.makeFilter((v) =>
        v.enabled
            ? v.channelId !== undefined && v.ownerId !== undefined
            : v.channelId === undefined && v.ownerId === undefined,
    ),
)
const eventClearOperation = Schema.Struct({
    type: Schema.Literal("event-clear"),
    eventType: MetadataLogsEventSelector,
    expectedRevision: Int(),
})
export const MetadataConfigurationOperation = Schema.Union([
    moduleOperation,
    channelsOperation,
    routeOperation,
    clearOperation,
    eventRouteOperation,
    eventClearOperation,
])
export const MetadataLogsConfigurationOperation = Schema.Union([
    moduleOperation,
    channelsOperation,
    Schema.Struct({ ...routeOperation.fields, recipientOwner: MetadataLogsContext }),
    clearOperation,
    Schema.Struct({ ...eventRouteOperation.fields, recipientOwner: Schema.optionalKey(MetadataLogsContext) }).check(
        Schema.makeFilter((v) =>
            v.enabled
                ? v.channelId !== undefined && v.ownerId !== undefined
                : v.channelId === undefined && v.ownerId === undefined,
        ),
    ),
    eventClearOperation,
])
export const MetadataLogsManageOperation = Schema.Union([
    MetadataLogsConfigurationOperation,
    Schema.Struct({ type: Schema.Literal("forget"), recordNo: Int(1), confirm: Schema.Literal(true) }),
    Schema.Struct({
        type: Schema.Literal("reconcile"),
        binding: MetadataLogsBinding,
        observation: MetadataLogsObservation,
    }),
])
export const MetadataLogsManageRequest = Schema.Struct({
    serverId: Id,
    messageId: Id,
    createdAt: Millis,
    context: MetadataLogsContext,
    operation: MetadataLogsManageOperation,
})
export const MetadataLogsAdmitRequest = Schema.Struct({ serverId: Id, event: MetadataLogsEventInput })
export const MetadataLogsQueryOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings") }),
    Schema.Struct({ type: Schema.Literal("list"), beforeRecordNo: Schema.optionalKey(Int(1)) }),
    Schema.Struct({ type: Schema.Literal("show"), recordNo: Int(1) }),
    Schema.Struct({ type: Schema.Literal("counters") }),
])
export const MetadataLogsQueryRequest = Schema.Struct({
    serverId: Id,
    context: MetadataLogsContext,
    privateRead: Schema.optionalKey(MetadataLogsPrivateRead),
    operation: MetadataLogsQueryOperation,
})
export const MetadataLogsWorkOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("discover"), cursor: Schema.optionalKey(Str(8192)) }),
    /** Whether the server's message events reach a log channel, which the bot asks when the server starts so it keeps message text at once */
    Schema.Struct({ type: Schema.Literal("messages") }),
    Schema.Struct({ type: Schema.Literal("reserve"), binding: MetadataLogsBinding, context: MetadataLogsContext }),
    Schema.Struct({
        type: Schema.Literal("claim"),
        binding: MetadataLogsBinding,
        context: MetadataLogsContext,
        claimToken: Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/)),
    }),
    // destination-missing reports that Fluxer answered that the post's channel does not exist
    Schema.Struct({
        type: Schema.Literals(["defer", "destination-missing"]),
        binding: MetadataLogsBinding,
    }),
    Schema.Struct({
        type: Schema.Literal("outcome"),
        binding: MetadataLogsBinding,
        claimToken: Schema.String,
        outcome: Schema.Literals(["sent", "failed", "uncertain"]),
        messageId: Schema.optionalKey(Id),
        /** With a failure: Fluxer's rate limit stopped the post, so nothing was sent and it may be tried again */
        unsent: Schema.optionalKey(Schema.Literal(true)),
        observedAt: Millis,
    }),
])
export const MetadataLogsWorkRequest = Schema.Struct({ serverId: Id, operation: MetadataLogsWorkOperation })
export function sameMetadataLogBinding(a: MetadataLogsBinding, b: MetadataLogsBinding) {
    return (
        a.recordNo === b.recordNo &&
        a.routeRevision === b.routeRevision &&
        a.moduleRevision === b.moduleRevision &&
        a.generation === b.generation &&
        a.channelId === b.channelId &&
        a.ownerId === b.ownerId &&
        a.routeEventType === b.routeEventType
    )
}
export function equalMetadataEmbed(a: MetadataLogsEmbed | undefined, b: MetadataLogsEmbed | undefined) {
    return a === undefined || b === undefined
        ? a === b
        : a.title === b.title && a.description === b.description && a.color === b.color
}

const metadataSources = {
    observation: "Fluxer event",
    "member-add": "Fluxer event",
    "message-delete": "Fluxer event",
    audit: "Audit log",
    settings: "Chat command",
    dashboard: "Dashboard",
    "dashboard-setting": "Dashboard",
} as const
/** The most characters of an embed description, which a log post's text fills */
const DESCRIPTION_LIMIT = 4096
/** A message's link in Fluxer's hosted app, the same URL the SDK's links.message makes */
export const metadataMessageLink = (serverId: string, channelId: string, messageId: string) =>
    `https://fluxer.app/channels/${serverId}/${channelId}/${messageId}`
/** The first max UTF-16 code units of text, without splitting a character made of two */
export function metadataSlice(value: string, max: number) {
    const cut = value.slice(0, max)
    return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut
}
/** Shortens text to max characters with … at the end, without splitting an escape or a character */
export function metadataClip(value: string, max: number) {
    if (value.length <= max) return value
    let cut = value.slice(0, Math.max(0, max - 1))
    if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1)
    if (/(?:^|[^\\])(?:\\\\)*\\$/.test(cut)) cut = cut.slice(0, -1)
    return `${cut}…`
}
// Line breaks, control, bidi and zero-width characters, which could fake a line or hide text. The joining character U+200D
// stays between emoji, where it builds one such as a technologist from a person and a laptop
const hidden =
    /[\u0000-\u001f\u007f-\u009f\u200b\u200c\u200e\u200f\u2028-\u202e\u2060-\u2069\ufeff]|(?<![\p{Extended_Pictographic}\p{Emoji_Modifier}\ufe0f])\u200d|\u200d(?!\p{Extended_Pictographic})/gu
/** A member-chosen name or value for one log line: hidden characters become spaces and markdown is escaped, so it cannot fake a line, a mention or formatting */
export const metadataPlain = (value: string, max = 300) =>
    metadataClip(value.replace(hidden, " ").replace(/[\\*_~`|<>#[\]()@]/g, "\\$&"), max)
const changeLabels: Record<string, string> = {
    afkChannel: "AFK channel",
    afkTimeout: "AFK timeout",
    contentFilter: "Content filter",
    mfaLevel: "MFA level",
    nsfw: "NSFW",
    systemChannel: "System channel",
    userLimit: "User limit",
    verificationLevel: "Verification level",
    overwrites: "Permission overwrites changed for",
}
const changeLabel = (field: string) => changeLabels[field] ?? `${field[0]!.toUpperCase()}${field.slice(1)}`
const oneLine = (value: string) => value.replace(/[\r\n\u2028\u2029]/g, " ")
function changeLine(change: typeof MetadataLogsChange.Type) {
    const parts = [
        // A value with only its new side, such as a changed image, shows just that side
        ...(change.before !== undefined
            ? [`${oneLine(change.before || "(none)")} → ${oneLine(change.after || "(none)")}`]
            : change.after !== undefined
              ? [oneLine(change.after || "(none)")]
              : []),
        ...(change.added ? [`added ${oneLine(change.added)}`] : []),
        ...(change.removed ? [`removed ${oneLine(change.removed)}`] : []),
    ]
    return `**${changeLabel(change.field)}**: ${parts.join(", ")}`
}
const earlierOf: Partial<Record<(typeof metadataEventTypes)[number], string>> = {
    "member-update": "member",
    "role-update": "role",
    "channel-update": "channel",
    "thread-update": "thread",
    "server-update": "server",
}
const sizeOf = (bytes: number) =>
    bytes < 1024
        ? `${bytes} B`
        : bytes < 1048576
          ? `${Math.round(bytes / 1024)} KB`
          : `${Math.round(bytes / 104857.6) / 10} MB`
const joined = (lines: readonly string[]) => lines.reduce((n, line) => n + line.length + 1, 0)

/**
 * A record's post text: the head, then the changed values and attachments, then message text and reasons in code blocks.
 * It always fits an embed description of 4,096 characters after its first line. Change and attachment lines that do not
 * fit are counted in one line, and the text blocks share what is left equally, each shortened with …. The result depends
 * only on the record, since the stored post is compared character for character. notes are extra lines after the head
 */
export function metadataLogContent(
    recordNo: number,
    event: MetadataLogsEvent,
    serverId?: string,
    notes: readonly string[] = [],
) {
    const user = (id: string) => `<@${id}>`,
        role = (id: string) => `<@&${id}>`,
        channel = (id: string) => `<#${id}>`,
        { type, resourceIds: ids } = event,
        d = event.details ?? {},
        action = event.auditAction ?? 0
    const link =
        type === "message-update" && serverId && event.channelId && ids.length === 1
            ? `Message: [Jump to message](${metadataMessageLink(serverId, event.channelId, ids[0]!)})`
            : undefined
    const about = !ids.length
        ? undefined
        : link
          ? link
          : type === "server-update" || action === 1
            ? "About: This server"
            : type.startsWith("message-") || (action >= 72 && action <= 75)
              ? `Messages: ${ids.join(", ")}`
              : type === "webhook-change" ||
                  (type === "alert-action" && event.changedFields.includes("delete-webhook")) ||
                  (action >= 50 && action <= 52)
                ? `Webhook: ${ids.join(", ")}`
                : action >= 60 && action <= 62
                  ? `Emoji: ${ids.join(", ")}`
                  : action >= 90 && action <= 92
                    ? `Sticker: ${ids.join(", ")}`
                    : type === "privilege-change" && event.changedFields.includes("member-roles")
                      ? `About: ${[user(ids[0]!), ...ids.slice(1).map(role)].join(", ")}`
                      : `About: ${ids.map(type.startsWith("member-") || type === "bot-join" || type === "impersonation" || (type === "alert-action" && event.changedFields.includes("kick-bot")) || (action >= 20 && action <= 28) ? user : type.startsWith("role-") || type === "privilege-change" || type === "alert-action" || (action >= 30 && action <= 32) ? role : channel).join(", ")}`
    const head = [
        `Event: ${type} (${event.category})`,
        `By: ${event.actor.kind === "unknown" ? "Unknown" : user(event.actor.userId)}`,
        ...(d.authorId ? [`Author: ${user(d.authorId)}`] : []),
        ...(about ? [about] : []),
        ...(event.channelId ? [`Channel: ${channel(event.channelId)}`] : []),
        ...(event.changedFields.length && !d.changes ? [`Changed: ${event.changedFields.join(", ")}`] : []),
        ...(event.count > 1 ? [`Count: ${event.count}`] : []),
        ...(d.authors
            ? [`Authors: ${d.authors.map((a) => `${user(a.userId)} (${a.count})`).join(", ")}`]
            : type === "message-bulk-delete"
              ? ["Authors: Unknown"]
              : []),
        ...(d.inviteCode ? [`Code: \`${d.inviteCode}\``] : []),
        ...(d.earlierUnknown && earlierOf[type]
            ? [`Earlier values: Unavailable, NeonFlux had not seen this ${earlierOf[type]} since it started`]
            : []),
    ]
    const tail = [
        `Source: ${metadataSources[event.source.kind]}`,
        `When: <t:${Math.floor(event.observedAt / 1000)}:f>`,
        ...notes,
    ]
    // Text blocks, each with its label. Absent text is unknown, empty text is known to be empty. A zero-width space follows
    // every backtick that another follows, so no run of backticks inside can end its block
    const unfenced = (value: string) => value.replace(/`(?=`)/g, "`\u200b")
    const blocks: { label: string; text: string }[] = [],
        fixedText: string[] = []
    const textBlock = (label: string, value: string | undefined, unknown: string) => {
        if (value === undefined) fixedText.push(`${label}: ${unknown}`)
        else if (value === "") fixedText.push(`${label}: (no text)`)
        else blocks.push({ label: `${label}:`, text: unfenced(value) })
    }
    if (type === "message-update") {
        // Known earlier text that equals the new text, as for a pin or a flag change, shows once
        if (d.earlierUnknown) fixedText.push("Before: Earlier text unavailable")
        if (!d.earlierUnknown && d.before === undefined) textBlock("Text", d.text, "Unavailable")
        else {
            if (!d.earlierUnknown) textBlock("Before", d.before, "Unavailable")
            textBlock("After", d.text, "Unavailable")
        }
    } else if (type === "message-delete") textBlock("Text", d.text, "Unavailable")
    if (d.reason !== undefined) blocks.push({ label: "Reason:", text: unfenced(d.reason) })
    // The first line names the record and is not part of the description
    const budget = DESCRIPTION_LIMIT - joined([...head, ...fixedText, ...tail]) + 1
    // A block's size counts its label, its fences and the line breaks around them
    const blockSizes = blocks.map((b) => b.label.length + b.text.length + 10)
    const blockNeed = blocks.length
        ? Math.min(
              blockSizes.reduce((a, b) => a + b, 0),
              Math.floor(budget / 2),
          )
        : 0
    // Attachment and change lines fill what the text blocks leave, and the ones that do not fit are counted
    let lineBudget = budget - blockNeed
    const lines: string[] = []
    const fill = (items: readonly string[], left: number, noun: string) => {
        let shown = 0
        for (const item of items) {
            const reserve = shown + 1 < items.length || left ? 24 : 0
            if (item.length + 1 + reserve > lineBudget) break
            lines.push(item)
            lineBudget -= item.length + 1
            shown++
        }
        const more = items.length - shown + left
        if (more) {
            const summary = `${more} more ${noun}${more === 1 ? "" : "s"}`
            lines.push(summary)
            lineBudget -= summary.length + 1
        }
    }
    const attachments = d.attachments ?? []
    if (attachments.length || d.attachmentCount)
        fill(
            attachments.map(
                (a) =>
                    `Attachment: ${a.url ? `[${metadataPlain(a.name, 256)}](${a.url.replace(/[()\s]/g, (c) => (c === "(" ? "%28" : c === ")" ? "%29" : encodeURIComponent(c)))})` : metadataPlain(a.name, 256)} (${sizeOf(a.size)})`,
            ),
            Math.max(0, (d.attachmentCount ?? attachments.length) - attachments.length),
            "attachment",
        )
    if (d.changes) fill(d.changes.map(changeLine), d.moreChanges ?? 0, "change")
    // Blocks share the rest equally, and a block shorter than its share leaves the difference to the others
    let left = budget - joined(lines)
    const shares = blocks.map(() => 0)
    const order = blocks.map((_, i) => i).sort((a, b) => blockSizes[a]! - blockSizes[b]! || a - b)
    order.forEach((i, n) => {
        const share = Math.min(blockSizes[i]!, Math.floor(left / (order.length - n)))
        shares[i] = share
        left -= share
    })
    const rendered = blocks.map(
        (b, i) => `${b.label}\n\`\`\`\n${metadataClip(b.text, Math.max(1, shares[i]! - b.label.length - 10))}\n\`\`\``,
    )
    const description = [...head, ...lines, ...fixedText, ...rendered, ...tail].join("\n")
    return `Metadata #${recordNo}\n${metadataClip(description, DESCRIPTION_LIMIT)}`
}
export type MetadataLogsEventSelector = typeof MetadataLogsEventSelector.Type
export type MetadataLogsCategory = typeof MetadataLogsCategory.Type
export type MetadataLogsEventType = typeof MetadataLogsEventType.Type
export type MetadataLogsSource = typeof MetadataLogsSource.Type
export type MetadataLogsActor = typeof MetadataLogsActor.Type
export type MetadataLogsEvent = typeof MetadataLogsEvent.Type
export type MetadataLogsRoute = typeof MetadataLogsRoute.Type
export type MetadataLogsEventRoute = typeof MetadataLogsEventRoute.Type
export type MetadataLogsSettings = typeof MetadataLogsSettings.Type
export type MetadataLogsBinding = typeof MetadataLogsBinding.Type
export type MetadataLogsDeliveryState = typeof MetadataLogsDeliveryState.Type
export type MetadataLogsEmbed = typeof MetadataLogsEmbed.Type
export type MetadataLogsGrant = typeof MetadataLogsGrant.Type
export type MetadataLogsDelivery = typeof MetadataLogsDelivery.Type
export type MetadataLogsPresentation = typeof MetadataLogsPresentation.Type
export type MetadataLogsRecord = typeof MetadataLogsRecord.Type
export type MetadataLogsCounters = typeof MetadataLogsCounters.Type
export type MetadataLogsManageResult = typeof MetadataLogsManageResult.Type
export type MetadataLogsWorkResult = typeof MetadataLogsWorkResult.Type
export type MetadataLogsAdmitResult = typeof MetadataLogsAdmitResult.Type
export type MetadataLogsContext = typeof MetadataLogsContext.Type
export type MetadataLogsPrivateRead = typeof MetadataLogsPrivateRead.Type
export type MetadataLogsObservation = typeof MetadataLogsObservation.Type
export type MetadataConfigurationOperation = typeof MetadataConfigurationOperation.Type
export type MetadataLogsConfigurationOperation = typeof MetadataLogsConfigurationOperation.Type
export type MetadataLogsManageOperation = typeof MetadataLogsManageOperation.Type
export type MetadataLogsManageRequest = typeof MetadataLogsManageRequest.Type
export type MetadataLogsAdmitRequest = typeof MetadataLogsAdmitRequest.Type
export type MetadataLogsQueryOperation = typeof MetadataLogsQueryOperation.Type
export type MetadataLogsQueryRequest = typeof MetadataLogsQueryRequest.Type
export type MetadataLogsWorkOperation = typeof MetadataLogsWorkOperation.Type
export type MetadataLogsWorkRequest = typeof MetadataLogsWorkRequest.Type
export type MetadataLogsQueryResult = typeof MetadataLogsQueryResult.Type
export type MetadataLogsEventInput = typeof MetadataLogsEventInput.Type
