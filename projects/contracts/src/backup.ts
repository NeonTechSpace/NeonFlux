import { Schema } from "effect"
import {
    Id,
    Ids,
    Int,
    IsoTime,
    List,
    Millis,
    PermissionBits,
    STRUCTURE_CHANNELS,
    Str,
    Text,
    Token,
    isId,
    origin,
} from "./common.ts"
import {
    PublishingContent,
    PublishingKind,
    PublishingName,
    PublishingYoutubeConsumer,
    SchedulesContentSource,
} from "./publishing-base.ts"
import { MemberAccessLists } from "./shared.ts"
import { AlertSettings } from "./alerts.ts"
import { CLEANUP_POLICY_LIMIT, CleanupPolicy } from "./cleanup.ts"
import type { DashboardConfigurationFamily } from "./dashboard.ts"
import { EventsDefinition } from "./events.ts"
import { validNickname, validPrefix } from "./general.ts"
import { GreetingsRouteSettings, GreetingsSettings, type GreetingsRoute } from "./greetings.ts"
import { HelpDeskAnswer, HelpDeskSettings } from "./helpdesk.ts"
import { LEVELING_XP_CAP, LevelingSettings } from "./leveling.ts"
import { LfgSettings } from "./lfg.ts"
import { OnboardingSettings } from "./onboarding.ts"
import { ProfileSettings } from "./profiles.ts"
import { ROLE_PICKER_MENUS, RolePickerMenu } from "./role-picker.ts"
import { SchedulesCalendar } from "./schedules.ts"
import { ShowcaseSettings } from "./showcases.ts"
import { StickyMessage } from "./sticky.ts"
import { TemporaryRoleSettings } from "./temporary-roles.ts"
import { VoiceGenerator } from "./voice.ts"
import {
    METADATA_CHANNEL_LIMIT,
    MetadataLogsEventRoute,
    MetadataLogsRoute,
    metadataCategories,
    metadataEventSelectors,
} from "./metadata-logs.ts"
import { MilestonesRoute } from "./milestones.ts"
import { AutomodRule, ModerationSettings } from "./moderation.ts"
import { ResponseDefinition } from "./responses.ts"
import {
    ROLES_MAPPING_SCOPE,
    ROLES_PANEL_MAPPINGS,
    RolesMappings,
    RolesPanel,
    RolesPanelKind,
    RolesSettings,
} from "./roles.ts"
import { TicketCategory, TicketSettings } from "./tickets.ts"

// Selective backup and restore, see docs/BOT.md#selective-backup-and-restore

/**
 * A restore check stays confirmable for a day, since it describes the server at one moment, and a confirmed run goes on until it makes no
 * progress for 10 minutes
 */
export const BACKUP_PLAN_MS = 86400000,
    BACKUP_RUN_IDLE_MS = 600000
// The most roles, members and channels one setting may name, a role panel's mappings with their required and excluded roles, so a
// setting's proof always fits whatever IDs it keeps. Moderation settings name at most 1,752 and role settings 1,200
const BACKUP_PROOF_REFERENCES = ROLES_PANEL_MAPPINGS * (1 + 2 * ROLES_MAPPING_SCOPE)
/**
 * Archive and restore limits, with the reason for each in docs/BOT.md#selective-backup-and-restore: parts of one archive and bytes of a
 * part, the plaintext of one decrypted archive, the canonical bytes and written items of one plan segment, channels of a structure segment,
 * members of an XP page, rows of a snapshot page of XP and of drafts, plans per server that are not finished, rows per page of plans or
 * items, items per chat page, the archive channels one origin lookup names, the roles, members and channels one native proof reads and the
 * members one check segment names
 */
export const BACKUP_RESTORE_LIMITS = {
    parts: 10,
    partBytes: 4194304,
    plaintextBytes: 41943040,
    segmentBytes: 524288,
    segmentItems: 500,
    segmentChannels: 100,
    xpPage: 100,
    snapshotXp: 500,
    snapshotDrafts: 100,
    /** Ticket categories per snapshot page. Each holds up to 256 KiB of canned replies, so 20 stay within one read */
    snapshotTicketCategories: 20,
    plans: 10,
    page: 20,
    chatPage: 10,
    originLookup: 100,
    // The overwrites one channel keeps. Fluxer sets no limit of its own, so a channel keeps as many as one restore check proves beside
    // its category
    channelOverwrites: BACKUP_PROOF_REFERENCES - 1,
    proofReferences: BACKUP_PROOF_REFERENCES,
    /**
     * Members one check segment names, unless one channel or setting alone names more. That is one gateway request, and reading each by
     * its ID when Fluxer leaves all of them out, at its 40 member reads per 10 seconds, fits the proof's 40 seconds
     */
    segmentMembers: 100,
} as const
/** Stable JSON for digests and comparisons, with sorted keys and undefined properties left out. Bot and backend hash it alike. Values JSON cannot hold exactly are refused */
export function canonicalBackupJson(value: unknown): string {
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
    )
        return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(canonicalBackupJson).join(",")}]`
    if (typeof value !== "object") throw new TypeError("Unsupported backup value")
    const row = value as Record<string, unknown>
    return `{${Object.keys(row)
        .sort()
        .filter((key) => row[key] !== undefined)
        .map((key) => `${JSON.stringify(key)}:${canonicalBackupJson(row[key])}`)
        .join(",")}}`
}
/**
 * What a channel restores to, without its source ID, capture time and managed label and with its overwrites in ID order, so two reads of it
 * compare equal
 */
export function backupChannelSemantic(channel: BackupStructureObject) {
    const { sourceId: _id, capturedAt: _at, managed: _managed, position: _position, ...rest } = channel
    return { ...rest, overwrites: [...rest.overwrites].sort((a, b) => a.id.localeCompare(b.id)) }
}
/**
 * The permissions an overwrite change gives that the channel did not have before: Allowed bits it did not allow and denied bits it no longer
 * denies. This is Fluxer's own grant rule for overwrite edits, so the highlight and the block rule are one function. A missing overwrite is zero
 */
export const backupGain = (before: { allow: string; deny: string }, after: { allow: string; deny: string }) =>
    (BigInt(after.allow) & ~BigInt(before.allow)) | (BigInt(before.deny) & ~BigInt(after.deny))
/**
 * A setting's key or leaf path in words, such as cooldownSeconds as cooldown seconds. A parent is a category, and ID and XP keep their capitals, also as IDs.
 * Dots and indexes stay, so a nested path still says where the setting sits
 */
export const backupSettingName = (key: string) =>
    key
        .replaceAll("parentId", "category")
        .replace(/([a-z\d])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .replace(/\b(id|xp)(s?)\b/g, (_, word: string, plural: string) => word.toUpperCase() + plural)
/** What no archive holds, in this order */
export const backupExclusions = [
    "credentials",
    "native-roles",
    "server-settings",
    "messages",
    "private-history",
    "participation",
    "membership",
    "audit-history",
    "receipts",
    "leases",
    "cooldowns",
    "claims",
    "live-ownership",
    "effective-defcon",
]
const optional = Schema.optionalKey
const unique = <A>(values: readonly A[], key: (value: A) => unknown = (value) => value) =>
    new Set(values.map(key)).size === values.length
const pick = <F extends Schema.Struct.Fields, const K extends keyof F>(fields: F, ...keys: K[]) =>
    Object.fromEntries(keys.map((key) => [key, fields[key]])) as Pick<F, K>
const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
/** 1 to max characters, such as a source ID, a reason, a page cursor or a backend row ID */
const label = (max: number) => Str(max).check(Schema.isMinLength(1))
/** An instance's API origin, such as https://api.fluxer.app */
const BackupProvider = Str(2048).check(
    Schema.makeFilter((value: string) => {
        try {
            const url = new URL(value)
            return ["https:", "http:"].includes(url.protocol) && url.origin === value && !url.username && !url.password
        } catch {
            return false
        }
    }),
)
const selection = <const C extends string>(categories: C[]) =>
    List(Schema.Literals(categories), categories.length).check(
        Schema.isMinLength(1),
        Schema.makeFilter((value: C[]) => unique(value)),
    )

export const BackupCategory = Schema.Literals(["config", "xp", "structure"])
export type BackupCategory = typeof BackupCategory.Type

const { defcon: _defcon, ...moderation } = ModerationSettings.fields
const { createdAt: _createdAt, updatedAt: _updatedAt, ...response } = ResponseDefinition.fields
const { revision: _rolesRevision, ...roles } = RolesSettings.fields
const { revision: _greetingRevision, ...greetingRoute } = GreetingsRouteSettings.fields
const { revision: _categoryRevision, ...ticketCategory } = TicketCategory.fields
const {
    revision: _levelRevision,
    mappingRevision: _mappingRevision,
    scoreEpoch: _scoreEpoch,
    ...leveling
} = LevelingSettings.fields
const { revision: _routeRevision, ...metadataRoute } = MetadataLogsRoute.fields
const { revision: _eventRevision, ...metadataEventRoute } = MetadataLogsEventRoute.fields
const enabled = Schema.Struct({ enabled: Schema.Boolean })
/** A route with a template copy names its template, and its channel unless it is the DM route. One without stays off. Goodbyes follow the join */
const greeting = (route: GreetingsRoute) =>
    Schema.Struct(greetingRoute).check(
        Schema.makeFilter(
            (v) =>
                (v.content !== undefined
                    ? v.templateName !== undefined &&
                      v.templateRevision !== undefined &&
                      (route === "dm" || v.channelId !== undefined)
                    : v.channelId === undefined &&
                      v.templateName === undefined &&
                      v.templateRevision === undefined &&
                      !v.enabled) &&
                (route !== "dm" || v.channelId === undefined) &&
                (route !== "goodbye" || v.timing === "join"),
        ),
    )
/** A log destination names its channel and owner together, and an enabled one has both */
const destination = (v: { readonly enabled: boolean; readonly channelId?: string; readonly ownerId?: string }) =>
    (v.channelId === undefined) === (v.ownerId === undefined) && (!v.enabled || v.channelId !== undefined)
const {
    eventNo: _eventNo,
    revision: _eventDefinitionRevision,
    state: _eventState,
    participationStarted: _participationStarted,
    // What the event shows of its live progress, which a restore works out again
    next: _eventNext,
    resume: _eventResume,
    lastSkipped: _eventLastSkipped,
    notice: _eventNotice,
    cardPostNo: _cardPostNo,
    postId: _postId,
    threadId: _threadId,
    createdAt: _eventCreatedAt,
    updatedAt: _eventUpdatedAt,
    ...event
} = EventsDefinition.fields
const { display: _display, ...menu } = RolePickerMenu.fields
const { revision: _helpDeskRevision, ...helpdesk } = HelpDeskSettings.fields
/** The member features whose access lists an archive keeps, each with its own allow and block lists */
export const backupAccessFeatures = ["rolepicker", "showcase", "profile"] as const
/** Each family's authored configuration as an archive keeps it, without revisions, counters or live state */
const values = {
    /** privateDataRoleId opens private cases on the website to a role, so a restore warns when it sets one */
    moderation: Schema.Struct({ ...moderation, privateDataRoleId: optional(Id) }),
    responses: Schema.Struct({ customEnabled: Schema.Boolean, autoEnabled: Schema.Boolean }),
    response: Schema.Struct(response).check(
        Schema.makeFilter((v) => (v.kind === "auto" ? v.trigger !== undefined : v.trigger === undefined)),
    ),
    automod: AutomodRule,
    publishing: enabled,
    draft: Schema.Struct({ kind: PublishingKind, name: PublishingName, content: PublishingContent }),
    roles: Schema.Struct(roles),
    panel: Schema.Struct({
        name: RolesPanel.fields.name,
        kind: RolesPanelKind,
        enabled: Schema.Boolean,
        exclusive: Schema.Boolean,
        mappings: RolesMappings,
    }).check(Schema.makeFilter((v) => v.kind !== "verification" || v.mappings.length <= 1)),
    greetings: Schema.Struct({
        claimsPerMinute: GreetingsSettings.fields.claimsPerMinute,
        retentionDays: GreetingsSettings.fields.retentionDays,
        routes: Schema.Struct({ welcome: greeting("welcome"), dm: greeting("dm"), goodbye: greeting("goodbye") }),
    }),
    tickets: TicketSettings,
    ticketCategory: Schema.Struct(ticketCategory).check(
        Schema.makeFilter((v) => unique(v.cannedReplies, (reply) => reply.name)),
    ),
    leveling: Schema.Struct(leveling),
    milestones: enabled,
    milestoneRoute: Schema.Struct(
        pick(MilestonesRoute.fields, "kind", "channelId", "zone", "time", "fold", "template", "content", "enabled"),
    ),
    suggestions: Schema.Struct({ enabled: Schema.Boolean, channelId: optional(Id) }).check(
        Schema.makeFilter((v) => !v.enabled || v.channelId !== undefined),
    ),
    cleanup: enabled,
    cleanupPolicy: Schema.Struct(
        pick(
            CleanupPolicy.fields,
            "channelId",
            "enabled",
            "ageMs",
            "ownerId",
            "excludedAuthorIds",
            "excludedMessageIds",
        ),
    ).check(Schema.makeFilter((v) => unique(v.excludedAuthorIds) && unique(v.excludedMessageIds))),
    metadata: Schema.Struct({
        enabled: Schema.Boolean,
        routes: List(Schema.Struct(metadataRoute), metadataCategories.length),
        eventRoutes: List(Schema.Struct(metadataEventRoute), metadataEventSelectors.length),
        // Absent in a backup made before the every-channel choice existed, which lists its channels
        allChannels: Schema.optionalKey(Schema.Boolean),
        messageChannelIds: Ids(METADATA_CHANNEL_LIMIT),
        excludedChannelIds: Ids(METADATA_CHANNEL_LIMIT),
    }).check(
        Schema.makeFilter(
            (v) =>
                unique(v.routes, (route) => route.category) &&
                metadataCategories.every((category) => v.routes.some((route) => route.category === category)) &&
                unique(v.eventRoutes, (route) => route.eventType) &&
                [...v.routes, ...v.eventRoutes].every(destination) &&
                unique(v.messageChannelIds) &&
                unique(v.excludedChannelIds) &&
                (!v.allChannels || v.messageChannelIds.length === 0),
        ),
    ),
    events: Schema.Struct({ enabled: Schema.Boolean, threads: optional(Schema.Boolean) }),
    /** An event restores as a draft. Its calendar returns only while every date is ahead */
    event: Schema.Struct(event),
    schedules: enabled,
    /** A schedule restores on only while every date is ahead, and paused otherwise */
    schedule: Schema.Struct({
        name: PublishingName,
        channelId: Id,
        calendar: SchedulesCalendar,
        source: SchedulesContentSource,
        content: PublishingContent,
        enabled: Schema.Boolean,
    }),
    /** The prefix, the reply style and the bot's nickname. Without a nickname the bot shows its username */
    general: Schema.Struct({
        prefix: Schema.String.check(Schema.makeFilter(validPrefix)),
        replyStyle: optional(Schema.Literals(["embed", "text"])),
        nickname: optional(Schema.String.check(Schema.makeFilter(validNickname))),
    }),
    analytics: enabled,
    voiceGenerator: Schema.Struct(
        pick(VoiceGenerator.fields, "channelId", "categoryId", "template", "userLimit", "region"),
    ),
    lfg: LfgSettings,
    rolepicker: Schema.Struct({
        enabled: Schema.Boolean,
        menus: List(Schema.Struct(menu), ROLE_PICKER_MENUS).check(
            Schema.makeFilter((menus) => unique(menus, (row) => row.name)),
        ),
    }),
    access: Schema.Struct({ feature: Schema.Literals(backupAccessFeatures), ...MemberAccessLists.fields }),
    temproles: TemporaryRoleSettings,
    onboarding: OnboardingSettings,
    /** A sticky message posts in its channel again once members write there */
    sticky: Schema.Struct(pick(StickyMessage.fields, "channelId", "content", "intervalSeconds")),
    alerts: AlertSettings,
    helpdesk: Schema.Struct(helpdesk),
    helpdeskAnswer: Schema.Struct(pick(HelpDeskAnswer.fields, "name", "title", "content")),
    showcase: ShowcaseSettings,
    profile: ProfileSettings,
    /** A followed YouTube channel. Its WebSub secret and callback token stay out, and a restore subscribes again with new ones */
    youtube: Schema.Struct({
        youtubeChannelId: PublishingYoutubeConsumer.fields.youtubeChannelId,
        channelId: Id,
    }),
}
export type BackupConfigValues = { readonly [K in keyof typeof values]: (typeof values)[K]["Type"] }
/** The configuration families, in the order a restore plan lists them */
export const backupConfigFamilies = Object.keys(values) as (keyof typeof values)[]
export const BackupConfigFamily = Schema.Literals(backupConfigFamilies)
export type BackupConfigFamily = typeof BackupConfigFamily.Type
const entry = <K extends BackupConfigFamily>(family: K) =>
    Schema.Struct({ family: Schema.Literal(family), sourceId: Token, value: values[family] })
const configObjects = Schema.Union([
    entry("moderation"),
    entry("responses"),
    entry("response"),
    entry("automod"),
    entry("publishing"),
    entry("draft"),
    entry("roles"),
    entry("panel"),
    entry("greetings"),
    entry("tickets"),
    entry("ticketCategory"),
    entry("leveling"),
    entry("milestones"),
    entry("milestoneRoute"),
    entry("suggestions"),
    entry("cleanup"),
    entry("cleanupPolicy"),
    entry("metadata"),
    entry("events"),
    entry("event"),
    entry("schedules"),
    entry("schedule"),
    entry("general"),
    entry("analytics"),
    entry("voiceGenerator"),
    entry("lfg"),
    entry("rolepicker"),
    entry("access"),
    entry("temproles"),
    entry("onboarding"),
    entry("sticky"),
    entry("alerts"),
    entry("helpdesk"),
    entry("helpdeskAnswer"),
    entry("showcase"),
    entry("profile"),
    entry("youtube"),
])
/**
 * What names a configuration object within its family: a response, draft or template by kind and name, a rule, panel, ticket category, event,
 * schedule or saved answer by name, a cleanup policy, voice generator or sticky message by channel, an access list by feature and a YouTube
 * follow by YouTube channel
 */
export function backupConfigIdentity(object: typeof configObjects.Type) {
    switch (object.family) {
        case "response":
        case "draft":
            return `${object.value.kind}_${object.value.name}`
        case "automod":
        case "panel":
        case "ticketCategory":
        case "event":
        case "schedule":
        case "helpdeskAnswer":
            return object.value.name
        case "milestoneRoute":
            return object.value.kind
        case "cleanupPolicy":
        case "voiceGenerator":
        case "sticky":
            return object.value.channelId
        case "access":
            return object.value.feature
        case "youtube":
            return object.value.youtubeChannelId
        default:
            return object.family
    }
}
/**
 * What a backup does with each dashboard family: the configuration families that keep it, or why it stays out. A family the dashboard gains
 * fails the contract check until it is listed here
 */
export const BACKUP_DASHBOARD_COVERAGE: Record<
    DashboardConfigurationFamily,
    BackupConfigFamily[] | { excluded: string }
> = {
    responses: ["responses", "response"],
    moderation: ["moderation", "automod"],
    publishing: ["publishing", "draft"],
    greetings: ["greetings"],
    tickets: ["tickets", "ticketCategory"],
    leveling: ["leveling"],
    milestones: ["milestones", "milestoneRoute"],
    suggestions: ["suggestions"],
    cleanup: ["cleanup", "cleanupPolicy"],
    events: ["events", "event"],
    schedules: ["schedules", "schedule"],
    nickname: ["general"],
    voice: ["voiceGenerator"],
    rolepicker: ["rolepicker", "access"],
    temproles: ["temproles"],
    sticky: ["sticky"],
    sidebar: { excluded: "The dashboard link is a native link channel that !sidebar makes again" },
    memberlist: { excluded: "The member list order is the role order, which Fluxer keeps" },
    alerts: ["alerts"],
    helpdesk: ["helpdesk", "helpdeskAnswer"],
    onboarding: ["onboarding"],
    presets: { excluded: "Presets are computed from the other settings and store nothing of their own" },
    lfg: ["lfg"],
    showcase: ["showcase", "access"],
    profile: ["profile", "access"],
    youtube: ["youtube"],
}
export const BackupConfigObject = configObjects.check(
    Schema.makeFilter((object) => object.sourceId === backupConfigIdentity(object)),
)
export type BackupConfigObject = typeof BackupConfigObject.Type
export const BackupXpObject = Schema.Struct({ sourceId: Id, userId: Id, xp: Int(0, LEVELING_XP_CAP) }).check(
    Schema.makeFilter((v) => v.sourceId === v.userId),
)
export type BackupXpObject = typeof BackupXpObject.Type
/**
 * One XP item of a plan: up to 100 members, each with the archived XP and the XP the check found, or null for a member with no profile. A
 * restore sets only the members whose XP is still the one the check found
 */
export const BackupXpPage = Schema.Struct({
    sourceId: Token,
    /** The XP season the check read, since a new season changes every member's XP at once */
    epoch: Int(),
    members: List(
        Schema.Struct({ userId: Id, xp: Int(0, LEVELING_XP_CAP), expected: Schema.NullOr(Int(0, LEVELING_XP_CAP)) }),
        BACKUP_RESTORE_LIMITS.xpPage,
    ).check(Schema.isMinLength(1)),
})
export type BackupXpPage = typeof BackupXpPage.Type
/** An overwrite as the server has it, with any 64-bit permissions, never allowing and denying the same one */
export const BackupOverwrite = Schema.Struct({
    id: Id,
    type: Schema.Literals(["role", "member"]),
    allow: PermissionBits,
    deny: PermissionBits,
}).check(Schema.makeFilter((v) => !(BigInt(v.allow) & BigInt(v.deny))))
export type BackupOverwrite = typeof BackupOverwrite.Type
const emoji = { emojiId: Schema.NullOr(Id), emojiName: Schema.NullOr(label(64)) }
const oneEmoji = (v: { readonly emojiId: string | null; readonly emojiName: string | null }) =>
    v.emojiId === null || v.emojiName === null
/** A forum or media channel tag. Tag IDs are not kept, since a restored channel's tags get new ones */
const BackupForumTag = Schema.Struct({ name: Text(50), moderated: Schema.Boolean, ...emoji }).check(
    Schema.makeFilter(oneEmoji),
)
const forumFields = [
    "tags",
    "defaultReaction",
    "defaultAutoArchiveMinutes",
    "sortOrder",
    "layout",
    "requireTag",
] as const
const channelName = Str(100).check(
    Schema.makeFilter((value: string) => value.trim() !== "" && !/[\u0000-\u001f\u202e]/.test(value)),
)
const BackupChannelType = Schema.Literals(["category", "text", "voice", "forum", "media", "announcement"])
/**
 * position is the channel's place among the channels of its category, or among the top-level channels and categories, counted from 0 in
 * Fluxer's order. A restore puts the channels back in that order with one order item, and position is not part of what a channel restores to.
 * Announcement channels keep the same settings as text channels. Forum and media channels also keep their tags, default reaction, default auto-archive minutes, sort order, the REQUIRE_TAG flag and,
 * for forums, the layout. Their posts are threads, which are not backed up. managed labels a channel that NeonFlux's tickets or temporary voice rooms
 * made, which a restore never brings back or changes, since NeonFlux forgets those channels after it closes them
 */
export const BackupStructureObject = Schema.Struct({
    sourceId: Id,
    type: BackupChannelType,
    name: channelName,
    parentId: Schema.NullOr(Id),
    overwrites: List(BackupOverwrite, BACKUP_RESTORE_LIMITS.channelOverwrites).check(
        Schema.makeFilter((rows) => unique(rows, (row) => row.id)),
    ),
    topic: optional(Schema.NullOr(Str(4096))),
    nsfw: optional(Schema.Boolean),
    slowmodeSeconds: optional(Int(0, 21600)),
    bitrate: optional(Int(8000, 384000)),
    userLimit: optional(Int(0, 99)),
    tags: optional(List(BackupForumTag, 20).check(Schema.makeFilter((tags) => unique(tags, (tag) => tag.name)))),
    defaultReaction: optional(Schema.NullOr(Schema.Struct(emoji).check(Schema.makeFilter(oneEmoji)))),
    defaultAutoArchiveMinutes: optional(
        Schema.NullOr(Int().check(Schema.makeFilter((value: number) => [60, 1440, 4320, 10080].includes(value)))),
    ),
    sortOrder: optional(Schema.NullOr(Int(0, 255))),
    layout: optional(Int(0, 255)),
    requireTag: optional(Schema.Boolean),
    managed: optional(Schema.Literals(["ticket", "voiceRoom"])),
    position: optional(Int(0, STRUCTURE_CHANNELS - 1)),
    capturedAt: Millis,
}).check(
    Schema.makeFilter(
        (v) =>
            v.parentId !== v.sourceId &&
            (v.type === "forum" || v.type === "media"
                ? v.bitrate === undefined && v.userLimit === undefined && (v.type === "forum" || v.layout === undefined)
                : forumFields.every((key) => v[key] === undefined) &&
                  (v.type === "voice"
                      ? v.topic === undefined && v.nsfw === undefined && v.slowmodeSeconds === undefined
                      : v.bitrate === undefined &&
                        v.userLimit === undefined &&
                        (v.topic ?? "").length <= 1024 &&
                        (v.type === "text" ||
                            v.type === "announcement" ||
                            (v.parentId === null &&
                                v.topic === undefined &&
                                v.nsfw === undefined &&
                                v.slowmodeSeconds === undefined)))),
    ),
)
export type BackupStructureObject = typeof BackupStructureObject.Type
/** One page of a database snapshot: the settings of one family, or up to 500 members' XP. cursor reads the next page, null after the last */
export const BackupSnapshotPage = Schema.Struct({
    capturedAt: Millis,
    config: List(BackupConfigObject, 100),
    xp: List(BackupXpObject, BACKUP_RESTORE_LIMITS.snapshotXp),
    cursor: Schema.NullOr(label(4096)),
})
export type BackupSnapshotPage = typeof BackupSnapshotPage.Type
const headerFields = {
    version: Schema.Literal(2),
    /** 16 random bytes in hex, which every part of the archive carries and authenticates */
    backupId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/)),
    provider: BackupProvider,
    serverId: Id,
    selected: selection(["config", "xp", "structure"]),
    capturedAt: Millis,
    observations: Schema.Struct({
        databaseAt: Schema.NullOr(Millis),
        structureStartedAt: Schema.NullOr(Millis),
        structureFinishedAt: Schema.NullOr(Millis),
    }),
    counts: Schema.Struct({
        config: Int(),
        xp: Int(),
        structure: Int(0, STRUCTURE_CHANNELS),
        overwrites: Int(),
    }),
    exclusions: Schema.mutable(Schema.Array(Schema.String)),
}
type Header = Schema.Struct.Type<typeof headerFields>
/** What every archive's header must say of itself: its times in order, the categories it read and the exclusions of this version */
const headerValid = (v: Header) => {
    const o = v.observations
    return (
        [o.databaseAt, o.structureStartedAt, o.structureFinishedAt].every((at) => at === null || at <= v.capturedAt) &&
        ((!v.selected.includes("config") && !v.selected.includes("xp")) || o.databaseAt !== null) &&
        (!v.selected.includes("structure") ||
            (o.structureStartedAt !== null &&
                o.structureFinishedAt !== null &&
                o.structureStartedAt <= o.structureFinishedAt)) &&
        (["config", "xp", "structure"] as const).every((key) => v.selected.includes(key) || v.counts[key] === 0) &&
        v.exclusions.length === backupExclusions.length &&
        v.exclusions.every((name, i) => name === backupExclusions[i])
    )
}
/** An archive without its objects, which a restore check starts with before the objects come in segments */
export const BackupManifestHeader = Schema.Struct(headerFields).check(Schema.makeFilter(headerValid))
export type BackupManifestHeader = typeof BackupManifestHeader.Type
/**
 * What an encrypted archive holds, in format version 2: every family's settings, the XP of every member with a score and up to 500
 * channels with up to 500 overwrites each, the most a ticket channel holds. The 40 MiB archive bound is the only bound on members
 * with XP. Items appear only in the categories an archive selected
 */
export const BackupManifest = Schema.Struct({
    ...headerFields,
    config: Schema.mutable(Schema.Array(BackupConfigObject)),
    xp: Schema.mutable(Schema.Array(BackupXpObject)),
    structure: Schema.mutable(Schema.Array(BackupStructureObject)),
}).check(
    Schema.makeFilter((v) => {
        const o = v.observations,
            overwrites = v.structure.reduce((total, channel) => total + channel.overwrites.length, 0)
        const types = new Map(v.structure.map((channel) => [channel.sourceId, channel.type]))
        return (
            headerValid(v) &&
            unique(v.config, (row) => `${row.family}:${row.sourceId}`) &&
            unique(v.xp, (row) => row.userId) &&
            unique(v.structure, (row) => row.sourceId) &&
            v.counts.config === v.config.length &&
            v.counts.xp === v.xp.length &&
            v.counts.structure === v.structure.length &&
            v.counts.overwrites === overwrites &&
            v.structure.every(
                (channel) =>
                    channel.capturedAt >= o.structureStartedAt! &&
                    channel.capturedAt <= o.structureFinishedAt! &&
                    (channel.parentId === null || (types.get(channel.parentId) ?? "category") === "category"),
            )
        )
    }),
)
export type BackupManifest = typeof BackupManifest.Type
/** The header of a decoded archive, which a restore check starts with */
export const backupManifestHeader = (manifest: BackupManifest): BackupManifestHeader => {
    const { config: _config, xp: _xp, structure: _structure, ...header } = manifest
    return header
}
/** The bot's fresh evidence that the current server owner asked in a private one-to-one DM. The backend checks its time, people and audience */
export const BackupContext = Schema.Struct({
    ...origin,
    provider: BackupProvider,
    observedAt: Millis,
    ownerId: Id,
    actorId: Id,
    actorKind: Schema.Literal("human"),
    botId: Id,
    botKind: Schema.Literal("bot"),
    ownerJoinedAt: IsoTime,
    ownerTimeoutUntil: Schema.NullOr(IsoTime),
    botTimeoutUntil: Schema.NullOr(IsoTime),
    dmChannelId: Id,
    dmType: Schema.Literal(1),
    recipientIds: Ids(2).check(Schema.isUnique()),
    privateReplyAuthorized: Schema.Boolean,
})
export type BackupContext = typeof BackupContext.Type
export const BackupReference = Schema.Struct({
    ...origin,
    id: Id,
    type: Schema.Literals(["role", "member", "category", "text", "voice"]),
    serverId: Id,
    observedAt: Millis,
    exists: Schema.Boolean,
    actorCanAccess: Schema.Boolean,
    botCanAccess: Schema.Boolean,
    actorCanManage: Schema.Boolean,
    botCanManage: Schema.Boolean,
    permissions: PermissionBits,
})
export type BackupReference = typeof BackupReference.Type
/** A present channel comes with its snapshot and the permissions NeonFlux has in it */
export const BackupNativeObservation = Schema.Struct({
    ...origin,
    sourceId: Id,
    observedAt: Millis,
    status: Schema.Literals(["present", "absent", "unknown"]),
    channel: Schema.NullOr(BackupStructureObject),
    botPermissions: PermissionBits,
}).check(Schema.makeFilter((v) => (v.status === "present") === (v.channel !== null)))
export type BackupNativeObservation = typeof BackupNativeObservation.Type
/**
 * A channel the server has now, of any type, as one listing of its channels shows it. A restore reads these for the channels the archive does
 * not hold and for the channels a category's permission change would also reach: synced means its permissions equal its category's, which is
 * when Fluxer copies a category's change to it
 */
export const BackupLiveChannel = Schema.Struct({
    ...origin,
    id: Id,
    type: Schema.Literals([...BackupChannelType.literals, "link", "other"]),
    name: Str(100),
    parentId: Schema.NullOr(Id),
    botCanManage: Schema.Boolean,
    synced: Schema.Boolean,
})
export type BackupLiveChannel = typeof BackupLiveChannel.Type
/**
 * serverId, ownerId and botId must name the request's server and the context's owner and bot, which the backend checks. channels lists the
 * server's channels in Fluxer's order, each category followed by its channels, so the order item reads the current order from it
 */
export const BackupNativeProof = Schema.Struct({
    ...origin,
    observedAt: Millis,
    serverId: Schema.String,
    ownerId: Schema.String,
    botId: Schema.String,
    actorPermissions: PermissionBits,
    botPermissions: PermissionBits,
    actorCanManageChannels: Schema.Boolean,
    botCanManageChannels: Schema.Boolean,
    references: List(BackupReference, BACKUP_RESTORE_LIMITS.proofReferences),
    observations: List(BackupNativeObservation, 100),
    channels: List(BackupLiveChannel, STRUCTURE_CHANNELS),
}).check(
    Schema.makeFilter(
        (v) =>
            unique(v.references, (row) => `${row.type}:${row.id}`) &&
            unique(v.observations, (row) => row.sourceId) &&
            unique(v.channels, (row) => row.id),
    ),
)
export type BackupNativeProof = typeof BackupNativeProof.Type
export const BackupBinding = Schema.Struct({
    planId: Str(128),
    revision: Schema.Literal(1),
    planHash: Digest,
    archiveDigest: Digest,
})
export type BackupBinding = typeof BackupBinding.Type
export const BackupItemBinding = Schema.Struct({
    ...BackupBinding.fields,
    itemNo: Int(1),
    generation: Schema.Literal(1),
})
export type BackupItemBinding = typeof BackupItemBinding.Type
export const BackupDisposition = Schema.Literals(["create", "update", "delete", "skip", "blocked"])
export type BackupDisposition = typeof BackupDisposition.Type
export const BackupItemState = Schema.Literals([
    "planned",
    "reserved",
    "claimed",
    "created",
    "updated",
    "deleted",
    "skipped",
    "conflict",
    "blocked",
    "failed",
    "uncertain",
])
export type BackupItemState = typeof BackupItemState.Type
const family = Schema.Literals([...backupConfigFamilies, "xp", "structure"])
const resolution = Schema.Literals(["match", "absent", "conflict"])
const counts = Schema.Struct({
    create: Int(),
    update: Int(),
    delete: Int(),
    skip: Int(),
    blocked: Int(),
})
const total = (value: typeof counts.Type) => value.create + value.update + value.delete + value.skip + value.blocked
/** What a restore plan grants beyond the server as it is: items that gain permissions, the permissions all of them gain and the settings that turn on */
const BackupGainSummary = Schema.Struct({
    items: Int(),
    bits: PermissionBits,
    switches: Int(0),
})
/** A configuration item belongs to a configuration family, and a channel maps to a Fluxer channel ID */
const familyMatches = (v: { readonly category: BackupCategory; readonly family: typeof family.Type }) =>
    v.category === "config" ? v.family !== "xp" && v.family !== "structure" : v.family === v.category
const nativeMapping = (v: { readonly category: BackupCategory; readonly mappedId: string | null }) =>
    v.category !== "structure" || v.mappedId === null || isId(v.mappedId)
export const BackupItem = Schema.Struct({
    ...BackupItemBinding.fields,
    category: BackupCategory,
    family,
    sourceId: label(128),
    disposition: BackupDisposition,
    reason: Schema.NullOr(label(512)),
    state: BackupItemState,
    expectedHash: Digest,
    desiredHash: Digest,
    dependencyItemNo: Schema.NullOr(Int(1)),
    mappedId: Schema.NullOr(label(256)),
    /** A channel's name, since its source ID names a channel that may no longer exist */
    name: optional(label(100)),
    /** A channel on the server that the archive does not hold, which a match restore deletes or leaves */
    extra: optional(Schema.Literal(true)),
    /** The fields an update changes, at most ten */
    changed: optional(List(label(64), 10)),
    /** The item grants permissions the server does not have now */
    gain: optional(Schema.Literal(true)),
    /** The item turns a setting on */
    on: optional(Schema.Literal(true)),
    /** What an item that deletes or posts will do, such as a cleanup policy that turns on, for the owner to read before confirming */
    warning: optional(label(256)),
    /** The one item that puts the channels in the archive's order, after every other channel item */
    order: optional(Schema.Literal(true)),
    dispatchExpiresAt: optional(Millis),
    claimedAt: optional(Millis),
    finishedAt: optional(Millis),
    noDispatch: optional(Schema.Literal(true)),
    historicalOutcome: optional(Schema.Literals(["created", "failed", "uncertain"])),
    resolution: optional(resolution),
}).check(Schema.makeFilter(familyMatches), Schema.makeFilter(nativeMapping))
export type BackupItem = typeof BackupItem.Type
export const BackupPlan = Schema.Struct({
    ...BackupBinding.fields,
    backupId: label(128),
    manifestDigest: Digest,
    provider: BackupProvider,
    serverId: Id,
    ownerId: Id,
    createdAt: Millis,
    expiresAt: Millis,
    confirmedAt: optional(Millis),
    itemCount: Int(),
    counts,
    gain: BackupGainSummary,
    /** The plan also deletes the channels and categories the archive does not hold */
    match: Schema.Boolean,
    forgotten: Schema.Boolean,
    /** building while its segments come in, and confirmable only once ready */
    state: Schema.Literals(["building", "ready"]),
    /** The items with a warning other than a channel delete, and how many items are in each state */
    warned: Int(),
    states: Schema.Struct(
        Object.fromEntries(BackupItemState.literals.map((state) => [state, optional(Int())])) as {
            [K in BackupItemState]: Schema.optionalKey<ReturnType<typeof Int>>
        },
    ),
    /** When a confirmed run ended with every item settled */
    settledAt: optional(Millis),
}).check(
    Schema.makeFilter(
        (v) =>
            v.expiresAt > v.createdAt &&
            total(v.counts) === v.itemCount &&
            (v.confirmedAt === undefined || (v.confirmedAt >= v.createdAt && v.confirmedAt < v.expiresAt)),
    ),
)
export type BackupPlan = typeof BackupPlan.Type
export const BackupOrigin = Schema.Struct({
    provider: BackupProvider,
    serverId: Id,
    category: BackupCategory,
    family,
    sourceId: label(128),
    state: Schema.Literals(["reserved", "claimed", "created", "uncertain", "failed"]),
    planId: label(256),
    itemNo: Int(1),
    generation: Schema.Literal(1),
    mappedId: Schema.NullOr(label(256)),
    desiredHash: Digest,
    resolved: optional(resolution),
}).check(Schema.makeFilter(nativeMapping))
export type BackupOrigin = typeof BackupOrigin.Type
const grantFields = {
    ...BackupItemBinding.fields,
    provider: BackupProvider,
    serverId: Id,
    ownerId: Id,
    botId: Id,
    dispatchExpiresAt: Millis,
    nativeDeadlineMs: Schema.Literal(5000),
}
/**
 * What one claim allows the bot to do to a channel. A create brings the channel to make. An update brings the channel as it should be and from,
 * the channel as it was when the backend decided, which the bot must still find just before it writes. A delete brings the channel as it is,
 * both as channel and as from
 */
export const BackupChannelGrant = Schema.Struct({
    ...grantFields,
    sourceId: Id,
    action: Schema.Literals(["create", "update", "delete"]),
    channel: BackupStructureObject,
    from: optional(BackupStructureObject),
}).check(Schema.makeFilter((v) => (v.action === "create") === (v.from === undefined)))
export type BackupChannelGrant = typeof BackupChannelGrant.Type
/** One move of the order item, as the structure editor sends it: the channel's category and the channel right before it there */
export const BackupMove = Schema.Struct({
    id: Id,
    parentId: Schema.NullOr(Id),
    precedingSiblingId: Schema.NullOr(Id),
})
export type BackupMove = typeof BackupMove.Type
/** The fewest moves that put the server's channels in the archive's order, sent in one reorder request */
export const BackupOrderGrant = Schema.Struct({
    ...grantFields,
    action: Schema.Literal("order"),
    moves: List(BackupMove, STRUCTURE_CHANNELS).check(
        Schema.isMinLength(1),
        Schema.makeFilter((rows) => unique(rows, (row) => row.id)),
    ),
})
export type BackupOrderGrant = typeof BackupOrderGrant.Type
export const BackupGrant = Schema.Union([BackupChannelGrant, BackupOrderGrant])
export type BackupGrant = typeof BackupGrant.Type
/**
 * One difference an item makes: a field row names a leaf of the value by path, with the value before and after and on when it turns a setting on.
 * An overwrite row is one role or member overwrite of a channel, with the permissions it gains
 */
export const BackupChange = Schema.Union([
    Schema.Struct({
        kind: Schema.Literal("field"),
        path: label(512),
        before: optional(Schema.Json),
        after: optional(Schema.Json),
        on: optional(Schema.Literal(true)),
    }),
    Schema.Struct({
        kind: Schema.Literal("overwrite"),
        id: Id,
        type: Schema.Literals(["role", "member"]),
        before: Schema.Struct({ allow: PermissionBits, deny: PermissionBits }),
        after: Schema.Struct({ allow: PermissionBits, deny: PermissionBits }),
        gain: PermissionBits,
        /** The role or member is gone, so the overwrite is not restored. before holds what the archive had for it */
        dropped: optional(Schema.Literal(true)),
    }),
])
export type BackupChange = typeof BackupChange.Type
/**
 * Why a website refresh or restore did not finish: owner is a sender who no longer owns the server or a DM that is no longer private, archive an
 * archive message, attachment or key that no longer reads, key a missing backup key, refused an archive the restore refuses as a whole, error a
 * failed read or a restore that stopped making progress, unanswered no answer in time, paused DEFCON 1 stopped the restore, expired the plan ended
 * before the restore did
 */
export const BackupPreviewFailure = Schema.Literals([
    "owner",
    "archive",
    "key",
    "refused",
    "error",
    "unanswered",
    "paused",
    "expired",
])
export type BackupPreviewFailure = typeof BackupPreviewFailure.Type
/** What the bot does for the website: requestedAt names the request it answers, and plan is the confirmed plan whose next items it runs */
export const BackupPreviewJob = Schema.Struct({
    ownerId: Id,
    channelId: Id,
    messageId: Id,
    requestedAt: Millis,
    match: Schema.Boolean,
    plan: optional(BackupPlan),
    /** The run started from chat, so the bot posts its outcome in the DM when it ends */
    notify: optional(Schema.Literal(true)),
    /** The run from chat ended for lack of progress, so the bot claims its outcome and posts it in the DM, and runs nothing */
    ended: optional(Schema.Struct({ failure: optional(BackupPreviewFailure) })),
})
export type BackupPreviewJob = typeof BackupPreviewJob.Type

const cursor = optional(label(4096)),
    nextCursor = optional(label(8192))
/** One page of the snapshot an export reads. cursor names the page after the first, as the last page answered it */
export const BackupSnapshotPageRequest = Schema.Struct({
    serverId: Id,
    context: BackupContext,
    selected: selection(["config", "xp"]),
    cursor,
})
export type BackupSnapshotPageRequest = typeof BackupSnapshotPageRequest.Type
export const BackupQueryRequest = Schema.Struct({
    serverId: Id,
    context: BackupContext,
    operation: Schema.Union([
        Schema.Struct({ type: Schema.Literal("plans"), cursor }),
        Schema.Struct({ type: Schema.Literal("plan"), binding: BackupBinding }),
        Schema.Struct({ type: Schema.Literal("items"), binding: BackupBinding, cursor }),
        /** Ten items in the order a page lists them, problems first */
        Schema.Struct({ type: Schema.Literal("page"), binding: BackupBinding, cursor }),
        /** Up to 20 items still to start, in item order */
        Schema.Struct({ type: Schema.Literal("open"), binding: BackupBinding }),
        /** Up to 20 channel creations whose outcome a check has not confirmed */
        Schema.Struct({ type: Schema.Literal("unconfirmed"), binding: BackupBinding }),
        Schema.Struct({ type: Schema.Literal("item"), binding: BackupItemBinding }),
        /** The channels earlier restores made for these archive channels, so a pass reads only the mappings it uses */
        Schema.Struct({
            type: Schema.Literal("origins"),
            provider: BackupProvider,
            sourceIds: Ids(BACKUP_RESTORE_LIMITS.originLookup).check(Schema.isMinLength(1)),
        }),
        Schema.Struct({ type: Schema.Literal("managed"), channelIds: Ids(100) }),
    ]),
})
export type BackupQueryRequest = typeof BackupQueryRequest.Type
const items = List(BackupItem, 20).check(Schema.makeFilter((rows) => unique(rows, (row) => row.itemNo)))
export const BackupQueryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("plans"), plans: List(BackupPlan, 20), nextCursor }),
    Schema.Struct({ type: Schema.Literal("plan"), plan: BackupPlan }),
    Schema.Struct({ type: Schema.Literal("items"), items, nextCursor }),
    Schema.Struct({ type: Schema.Literal("page"), items, nextCursor }),
    Schema.Struct({ type: Schema.Literal("open"), items }),
    Schema.Struct({ type: Schema.Literal("unconfirmed"), items }),
    Schema.Struct({
        type: Schema.Literal("item"),
        item: BackupItem,
        object: Schema.NullOr(Schema.Union([BackupConfigObject, BackupXpPage, BackupStructureObject])),
        /** For the cleanup module, the channels of the cleanup policies that are on now, which turning it on resumes */
        resumed: optional(Ids(CLEANUP_POLICY_LIMIT)),
    }),
    Schema.Struct({ type: Schema.Literal("origins"), origins: List(BackupOrigin, BACKUP_RESTORE_LIMITS.originLookup) }),
    Schema.Struct({
        type: Schema.Literal("managed"),
        channels: List(Schema.Struct({ id: Id, managed: Schema.Literals(["ticket", "voiceRoom"]) }), 100),
    }),
])
export type BackupQueryResult = typeof BackupQueryResult.Type
export const BackupManageRequest = Schema.Struct({
    serverId: Id,
    messageId: Id,
    createdAt: Millis,
    context: BackupContext,
    operation: Schema.Union([
        Schema.Struct({ type: Schema.Literal("confirm"), binding: BackupBinding }),
        Schema.Struct({ type: Schema.Literal("forget"), binding: BackupBinding }),
    ]),
})
export type BackupManageRequest = typeof BackupManageRequest.Type
export const BackupManageResult = Schema.Union([
    /** run says whether this confirmation started the run or found it running */
    Schema.Struct({
        type: Schema.Literal("confirmed"),
        duplicate: Schema.Boolean,
        plan: BackupPlan,
        run: Schema.Literals(["started", "running"]),
    }),
    Schema.Struct({ type: Schema.Literal("forgotten"), plan: BackupPlan }),
])
export type BackupManageResult = typeof BackupManageResult.Type
/** The claim token is checked where a claim or outcome uses it, since a repeated claim answers the grant it already holds */
export const BackupWorkRequest = Schema.Struct({
    serverId: Id,
    operation: Schema.Union([
        Schema.Struct({
            type: Schema.Literal("apply"),
            binding: BackupItemBinding,
            context: BackupContext,
            native: Schema.NullOr(BackupNativeProof),
        }),
        Schema.Struct({
            type: Schema.Literals(["reserve", "claim"]),
            binding: BackupItemBinding,
            context: BackupContext,
            native: BackupNativeProof,
            claimToken: optional(Schema.String),
        }),
        Schema.Struct({
            type: Schema.Literal("outcome"),
            binding: BackupItemBinding,
            claimToken: Schema.String,
            outcome: Schema.Literals(["created", "updated", "deleted", "failed", "uncertain"]),
            noDispatch: optional(Schema.Literal(true)),
            channel: Schema.NullOr(BackupStructureObject),
            mappedId: Schema.NullOr(Id),
            /** What a failed update or delete left applied, for the owner to read */
            reason: optional(label(512)),
        }),
        Schema.Struct({
            type: Schema.Literal("reconcile"),
            binding: BackupItemBinding,
            context: BackupContext,
            native: BackupNativeProof,
        }),
    ]),
})
export type BackupWorkRequest = typeof BackupWorkRequest.Type
export const BackupWorkResult = Schema.Union([
    /** panel is a restored posted role panel with reactions to clear, which the bot clears at once as after a staff edit */
    Schema.Struct({ type: Schema.Literal("item"), item: BackupItem, panel: optional(RolesPanel) }),
    Schema.Struct({ type: Schema.Literal("grant"), item: BackupItem, grant: BackupGrant, claimed: Schema.Boolean }),
])
export type BackupWorkResult = typeof BackupWorkResult.Type
/**
 * One part of an archive's objects for a restore check, in the order a plan runs them: categories, then other channels, up to 100 a segment,
 * then the structure segment that holds the deletions of a match restore and the order item, then settings, up to 500 a segment, then XP
 * pages of up to 100 members
 */
/**
 * An archived channel as a category's decision reads it: Fluxer copies a category's permission change to the channels that follow it, and
 * the decision compares each one's archived permissions, by the digest of backupOverwritesJson, before the channels come in their own
 * segments
 */
export const BackupChannelSummary = Schema.Struct({
    sourceId: Id,
    parentId: Schema.NullOr(Id),
    overwrites: Digest,
    managed: optional(Schema.Literals(["ticket", "voiceRoom"])),
    position: optional(Int(0, STRUCTURE_CHANNELS - 1)),
})
export type BackupChannelSummary = typeof BackupChannelSummary.Type
/** The overwrites of a channel in ID order, as the digest of a channel summary hashes them */
export const backupOverwritesJson = (overwrites: readonly BackupOverwrite[]) =>
    canonicalBackupJson([...overwrites].sort((a, b) => a.id.localeCompare(b.id)))
const segmentChannels = List(BackupStructureObject, BACKUP_RESTORE_LIMITS.segmentChannels).check(Schema.isMinLength(1))
export const BackupSegment = Schema.Union([
    /** Categories carry every other archived channel as a summary */
    Schema.Struct({
        kind: Schema.Literal("categories"),
        structure: segmentChannels,
        channels: List(BackupChannelSummary, STRUCTURE_CHANNELS),
    }),
    Schema.Struct({ kind: Schema.Literal("channels"), structure: segmentChannels }),
    Schema.Struct({ kind: Schema.Literal("structure") }),
    Schema.Struct({
        kind: Schema.Literal("config"),
        config: List(BackupConfigObject, BACKUP_RESTORE_LIMITS.segmentItems).check(Schema.isMinLength(1)),
    }),
    Schema.Struct({
        kind: Schema.Literal("xp"),
        xp: List(BackupXpObject, BACKUP_RESTORE_LIMITS.xpPage).check(Schema.isMinLength(1)),
    }),
])
export type BackupSegment = typeof BackupSegment.Type
/**
 * Starts a restore check of an archive, whose segments follow in order and must match segmentDigests. archive is the DM message that
 * carries the encrypted archive's parts, so the website can ask the bot to read it again. requestedAt names the website request this
 * answers, and a check from chat has none
 */
export const BackupPreviewStartRequest = Schema.Struct({
    requestedAt: optional(Millis),
    serverId: Id,
    context: BackupContext,
    header: BackupManifestHeader,
    segmentDigests: List(Digest, 1000),
    archiveDigest: Digest,
    archive: Schema.Struct({ channelId: Id, messageId: Id }),
    /** Also delete the channels and categories the archive does not hold */
    match: Schema.Boolean,
})
export type BackupPreviewStartRequest = typeof BackupPreviewStartRequest.Type
/** One segment of the check that previewStart began, with the bot's fresh evidence of the server for it */
export const BackupPreviewSegmentRequest = Schema.Struct({
    serverId: Id,
    context: BackupContext,
    planId: Str(128),
    segmentNo: Int(),
    segment: BackupSegment,
    native: Schema.NullOr(BackupNativeProof),
})
export type BackupPreviewSegmentRequest = typeof BackupPreviewSegmentRequest.Type
/** The restore plan a check made, which is the same plan a confirmation runs. It is building until its last segment came in */
export const BackupPreviewResult = Schema.Struct({ plan: BackupPlan })
export type BackupPreviewResult = typeof BackupPreviewResult.Type
/** The archive the website waits for the bot to read again */
export const BackupPreviewReadyRequest = Schema.Struct({ serverId: Id })
export type BackupPreviewReadyRequest = typeof BackupPreviewReadyRequest.Type
export const BackupPreviewReadyResult = Schema.Struct({ job: Schema.NullOr(BackupPreviewJob) })
export type BackupPreviewReadyResult = typeof BackupPreviewReadyResult.Type
export const BackupPreviewFailedRequest = Schema.Struct({
    serverId: Id,
    requestedAt: Millis,
    failure: Schema.Literals(["owner", "archive", "key", "refused", "error"]),
})
export type BackupPreviewFailedRequest = typeof BackupPreviewFailedRequest.Type
/** recorded is false when no refresh was waiting, or no restore was running for the request */
export const BackupPreviewFailedResult = Schema.Struct({ recorded: Schema.Boolean })
export type BackupPreviewFailedResult = typeof BackupPreviewFailedResult.Type
/** One pass of a confirmed restore: how many items it recorded, and owner when the sender no longer owns the server */
export const BackupRunStepRequest = Schema.Struct({
    serverId: Id,
    requestedAt: Millis,
    recorded: Int(0, 20),
    stopped: optional(Schema.Literal("owner")),
})
export type BackupRunStepRequest = typeof BackupRunStepRequest.Type
/** recorded is false when no restore was running for the request. ended says the run ended with this pass, and why when it stopped */
export const BackupRunStepResult = Schema.Struct({
    recorded: Schema.Boolean,
    ended: optional(Schema.Struct({ failure: optional(BackupPreviewFailure) })),
})
export type BackupRunStepResult = typeof BackupRunStepResult.Type
/** Takes the outcome of the run that requestedAt started, which ended for lack of progress. claimed is false when none is due */
export const BackupOutcomeClaimRequest = Schema.Struct({ serverId: Id, requestedAt: Millis })
export type BackupOutcomeClaimRequest = typeof BackupOutcomeClaimRequest.Type
export const BackupOutcomeClaimResult = Schema.Struct({ claimed: Schema.Boolean })
export type BackupOutcomeClaimResult = typeof BackupOutcomeClaimResult.Type
/**
 * Splits an archive into the segments of its restore check, in the order a plan runs them. Each segment stays within 512 KiB of canonical
 * JSON, its own count of objects and, when references names what an object's evidence reads, the roles, members and channels one native
 * proof reads, which is what the bot reads for one segment, and the members whose reads fit one proof's time. So the members one channel
 * names never take the time of another channel's. summarize gives each channel its summary for the categories' segments
 */
export function backupSegments(
    manifest: BackupManifest,
    summarize: (channel: BackupStructureObject) => BackupChannelSummary,
    references: (object: BackupConfigObject | BackupStructureObject) => readonly string[] = () => [],
): BackupSegment[] {
    const bytes = (value: unknown) => new TextEncoder().encode(canonicalBackupJson(value)).length
    function chunk<T extends BackupConfigObject | BackupStructureObject | BackupXpObject>(
        rows: readonly T[],
        most: number,
        base: number,
    ): T[][] {
        const out: T[][] = []
        let current: T[] = [],
            size = base,
            refs = new Set<string>()
        const members = (keys: ReadonlySet<string>) => [...keys].filter((key) => key.startsWith("member:")).length
        for (const row of rows) {
            const own = bytes(row) + 1,
                named = "userId" in row ? [] : references(row),
                more = new Set([...refs, ...named])
            if (
                current.length &&
                (current.length >= most ||
                    size + own > BACKUP_RESTORE_LIMITS.segmentBytes ||
                    more.size > BACKUP_RESTORE_LIMITS.proofReferences ||
                    members(more) > BACKUP_RESTORE_LIMITS.segmentMembers)
            ) {
                out.push(current)
                current = []
                size = base
                refs = new Set(named)
            } else refs = more
            current.push(row)
            size += own
        }
        if (current.length) out.push(current)
        return out
    }
    const segments: BackupSegment[] = []
    if (manifest.selected.includes("structure")) {
        const byId = (a: BackupStructureObject, b: BackupStructureObject) => a.sourceId.localeCompare(b.sourceId)
        const categories = manifest.structure.filter((x) => x.type === "category").sort(byId),
            others = manifest.structure.filter((x) => x.type !== "category").sort(byId),
            channels = others.map(summarize)
        for (const structure of chunk(categories, BACKUP_RESTORE_LIMITS.segmentChannels, bytes(channels) + 64))
            segments.push({ kind: "categories", structure, channels })
        for (const structure of chunk(others, BACKUP_RESTORE_LIMITS.segmentChannels, 64))
            segments.push({ kind: "channels", structure })
        segments.push({ kind: "structure" })
    }
    const config = [...manifest.config].sort(
        (a, b) =>
            backupConfigFamilies.indexOf(a.family) - backupConfigFamilies.indexOf(b.family) ||
            a.sourceId.localeCompare(b.sourceId),
    )
    for (const rows of chunk(config, BACKUP_RESTORE_LIMITS.segmentItems, 64))
        segments.push({ kind: "config", config: rows })
    const xp = [...manifest.xp].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
    for (const rows of chunk(xp, BACKUP_RESTORE_LIMITS.xpPage, 64)) segments.push({ kind: "xp", xp: rows })
    return segments
}
