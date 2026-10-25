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
import { PublishingContent, PublishingKind, PublishingName } from "./publishing-base.ts"
import { CleanupPolicy } from "./cleanup.ts"
import { GreetingsRouteSettings, GreetingsSettings, type GreetingsRoute } from "./greetings.ts"
import { LEVELING_XP_CAP, LevelingSettings } from "./leveling.ts"
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
import { RolesMappings, RolesPanel, RolesPanelKind, RolesSettings } from "./roles.ts"
import { TicketCategory, TicketSettings } from "./tickets.ts"

// Selective backup and restore, see docs/BOT.md#selective-backup-and-restore

/** A restore plan holds at most 500 items and confirms within 15 minutes. The website confirms it only with at least 5 minutes left to run it */
export const BACKUP_PLAN_MS = 900000,
    BACKUP_CONFIRM_MARGIN_MS = 300000
const BACKUP_PLAN_ITEMS = 500
/** The most items of each category one archive holds */
export const BACKUP_CATEGORY_LIMITS = { config: 500, xp: 500, structure: 100 } as const
/**
 * Restore limits: Items and canonical bytes per plan, plans per server, rows per page of plans, items or origins, overwrites per archive,
 * the bytes of a database snapshot and the origin mappings a server keeps
 */
export const BACKUP_RESTORE_LIMITS = {
    planItems: BACKUP_PLAN_ITEMS,
    planBytes: 524288,
    plans: 10,
    page: 20,
    overwrites: 500,
    snapshotBytes: 1048576,
    originMappings: 5000,
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
    const { sourceId: _id, capturedAt: _at, managed: _managed, ...rest } = channel
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
    "event-definitions",
    "schedule-definitions",
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
/** Each family's authored configuration as an archive keeps it, without revisions, counters or live state */
const values = {
    moderation: Schema.Struct(moderation),
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
    events: enabled,
    schedules: enabled,
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
    entry("schedules"),
])
/** What names a configuration object within its family: a response, draft or template by kind and name, a rule, panel or ticket category by name */
export function backupConfigIdentity(object: typeof configObjects.Type) {
    switch (object.family) {
        case "response":
        case "draft":
            return `${object.value.kind}_${object.value.name}`
        case "automod":
        case "panel":
        case "ticketCategory":
            return object.value.name
        case "milestoneRoute":
            return object.value.kind
        case "cleanupPolicy":
            return object.value.channelId
        default:
            return object.family
    }
}
export const BackupConfigObject = configObjects.check(
    Schema.makeFilter((object) => object.sourceId === backupConfigIdentity(object)),
)
export type BackupConfigObject = typeof BackupConfigObject.Type
export const BackupXpObject = Schema.Struct({ sourceId: Id, userId: Id, xp: Int(0, LEVELING_XP_CAP) }).check(
    Schema.makeFilter((v) => v.sourceId === v.userId),
)
export type BackupXpObject = typeof BackupXpObject.Type
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
 * Announcement channels keep the same settings as text channels. Forum and media channels also keep their tags, default reaction, default auto-archive minutes, sort order, the REQUIRE_TAG flag and,
 * for forums, the layout. Their posts are threads, which are not backed up. managed labels a channel that NeonFlux's tickets or temporary voice rooms
 * made, which a restore never brings back or changes, since NeonFlux forgets those channels after it closes them
 */
export const BackupStructureObject = Schema.Struct({
    sourceId: Id,
    type: BackupChannelType,
    name: channelName,
    parentId: Schema.NullOr(Id),
    overwrites: List(BackupOverwrite, 100).check(Schema.makeFilter((rows) => unique(rows, (row) => row.id))),
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
const configList = List(BackupConfigObject, BACKUP_CATEGORY_LIMITS.config).check(
    Schema.makeFilter((rows) => unique(rows, (row) => `${row.family}:${row.sourceId}`)),
)
const xpList = List(BackupXpObject, BACKUP_CATEGORY_LIMITS.xp).check(
    Schema.makeFilter((rows) => unique(rows, (row) => row.userId)),
)
export const BackupSnapshot = Schema.Struct({
    capturedAt: Millis,
    config: configList,
    xp: xpList,
    counts: Schema.Struct({ config: Int(0, BACKUP_CATEGORY_LIMITS.config), xp: Int(0, BACKUP_CATEGORY_LIMITS.xp) }),
}).check(Schema.makeFilter((v) => v.counts.config === v.config.length && v.counts.xp === v.xp.length))
export type BackupSnapshot = typeof BackupSnapshot.Type
/**
 * What an encrypted archive holds, in format version 1. Category sizes and selection are checked by backupWithinLimits, since a restore
 * refuses those with their own status
 */
export const BackupManifest = Schema.Struct({
    version: Schema.Literal(1),
    backupId: Token,
    provider: BackupProvider,
    serverId: Id,
    selected: selection(["config", "xp", "structure"]),
    capturedAt: Millis,
    observations: Schema.Struct({
        databaseAt: Schema.NullOr(Millis),
        structureStartedAt: Schema.NullOr(Millis),
        structureFinishedAt: Schema.NullOr(Millis),
    }),
    counts: Schema.Struct({ config: Int(), xp: Int(), structure: Int(), overwrites: Int() }),
    exclusions: Schema.mutable(Schema.Array(Schema.String)),
    config: Schema.mutable(Schema.Array(BackupConfigObject)),
    xp: Schema.mutable(Schema.Array(BackupXpObject)),
    structure: Schema.mutable(Schema.Array(BackupStructureObject)),
}).check(
    Schema.makeFilter((v) => {
        const o = v.observations,
            overwrites = v.structure.reduce((total, channel) => total + channel.overwrites.length, 0),
            structure = v.selected.includes("structure")
        const types = new Map(v.structure.map((channel) => [channel.sourceId, channel.type]))
        return (
            overwrites <= BACKUP_RESTORE_LIMITS.overwrites &&
            unique(v.config, (row) => `${row.family}:${row.sourceId}`) &&
            unique(v.xp, (row) => row.userId) &&
            unique(v.structure, (row) => row.sourceId) &&
            v.counts.config === v.config.length &&
            v.counts.xp === v.xp.length &&
            v.counts.structure === v.structure.length &&
            v.counts.overwrites === overwrites &&
            [o.databaseAt, o.structureStartedAt, o.structureFinishedAt].every(
                (at) => at === null || at <= v.capturedAt,
            ) &&
            ((!v.selected.includes("config") && !v.selected.includes("xp")) || o.databaseAt !== null) &&
            (!structure ||
                (o.structureStartedAt !== null &&
                    o.structureFinishedAt !== null &&
                    o.structureStartedAt <= o.structureFinishedAt &&
                    v.structure.every(
                        (channel) =>
                            channel.capturedAt >= o.structureStartedAt! && channel.capturedAt <= o.structureFinishedAt!,
                    ))) &&
            v.exclusions.length === backupExclusions.length &&
            v.exclusions.every((name, i) => name === backupExclusions[i]) &&
            v.structure.every(
                (channel) => channel.parentId === null || (types.get(channel.parentId) ?? "category") === "category",
            )
        )
    }),
)
export type BackupManifest = typeof BackupManifest.Type
/** Each category within its limit, and items only in the categories an archive selected. A restore refuses any other archive as a whole */
export const backupWithinLimits = (manifest: BackupManifest) =>
    (["config", "xp", "structure"] as const).every(
        (key) =>
            manifest[key].length <= BACKUP_CATEGORY_LIMITS[key] &&
            (manifest.selected.includes(key) || !manifest[key].length),
    )
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
/** serverId, ownerId and botId must name the request's server and the context's owner and bot, which the backend checks */
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
    references: List(BackupReference, 1000),
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
    itemNo: Int(1, BACKUP_PLAN_ITEMS),
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
    create: Int(0, BACKUP_PLAN_ITEMS),
    update: Int(0, BACKUP_PLAN_ITEMS),
    delete: Int(0, BACKUP_PLAN_ITEMS),
    skip: Int(0, BACKUP_PLAN_ITEMS),
    blocked: Int(0, BACKUP_PLAN_ITEMS),
})
const total = (value: typeof counts.Type) => value.create + value.update + value.delete + value.skip + value.blocked
/** What a restore plan grants beyond the server as it is: items that gain permissions, the permissions all of them gain and the settings that turn on */
const BackupGainSummary = Schema.Struct({
    items: Int(0, BACKUP_PLAN_ITEMS),
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
    dependencyItemNo: Schema.NullOr(Int(1, BACKUP_PLAN_ITEMS)),
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
    itemCount: Int(0, BACKUP_PLAN_ITEMS),
    counts,
    gain: BackupGainSummary,
    /** The plan also deletes the channels and categories the archive does not hold */
    match: Schema.Boolean,
    forgotten: Schema.Boolean,
}).check(
    Schema.makeFilter(
        (v) =>
            v.expiresAt === v.createdAt + BACKUP_PLAN_MS &&
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
    itemNo: Int(1, BACKUP_PLAN_ITEMS),
    generation: Schema.Literal(1),
    mappedId: Schema.NullOr(label(256)),
    desiredHash: Digest,
    resolved: optional(resolution),
}).check(Schema.makeFilter(nativeMapping))
export type BackupOrigin = typeof BackupOrigin.Type
/**
 * What one claim allows the bot to do to a channel. A create brings the channel to make. An update brings the channel as it should be and from,
 * the channel as it was when the backend decided, which the bot must still find just before it writes. A delete brings the channel as it is,
 * both as channel and as from
 */
export const BackupGrant = Schema.Struct({
    ...BackupItemBinding.fields,
    provider: BackupProvider,
    serverId: Id,
    ownerId: Id,
    botId: Id,
    sourceId: Id,
    action: Schema.Literals(["create", "update", "delete"]),
    channel: BackupStructureObject,
    from: optional(BackupStructureObject),
    dispatchExpiresAt: Millis,
    nativeDeadlineMs: Schema.Literal(5000),
}).check(Schema.makeFilter((v) => (v.action === "create") === (v.from === undefined)))
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
})
export type BackupPreviewJob = typeof BackupPreviewJob.Type

const cursor = optional(label(4096)),
    nextCursor = optional(label(8192))
export const BackupSnapshotRequest = Schema.Struct({
    serverId: Id,
    context: BackupContext,
    selected: selection(["config", "xp"]),
})
export type BackupSnapshotRequest = typeof BackupSnapshotRequest.Type
export const BackupQueryRequest = Schema.Struct({
    serverId: Id,
    context: BackupContext,
    operation: Schema.Union([
        Schema.Struct({ type: Schema.Literal("plans"), cursor }),
        Schema.Struct({ type: Schema.Literal("plan"), binding: BackupBinding }),
        Schema.Struct({ type: Schema.Literal("items"), binding: BackupBinding, cursor }),
        Schema.Struct({ type: Schema.Literal("item"), binding: BackupItemBinding }),
        Schema.Struct({ type: Schema.Literal("origins"), provider: BackupProvider, cursor }),
        Schema.Struct({ type: Schema.Literal("managed"), channelIds: Ids(100) }),
    ]),
})
export type BackupQueryRequest = typeof BackupQueryRequest.Type
const items = List(BackupItem, 20).check(Schema.makeFilter((rows) => unique(rows, (row) => row.itemNo)))
export const BackupQueryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("plans"), plans: List(BackupPlan, 20), nextCursor }),
    Schema.Struct({ type: Schema.Literal("plan"), plan: BackupPlan }),
    Schema.Struct({ type: Schema.Literal("items"), items, nextCursor }),
    Schema.Struct({
        type: Schema.Literal("item"),
        item: BackupItem,
        object: Schema.NullOr(Schema.Union([BackupConfigObject, BackupXpObject, BackupStructureObject])),
    }),
    Schema.Struct({ type: Schema.Literal("origins"), origins: List(BackupOrigin, 20), nextCursor }),
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
    Schema.Struct({ type: Schema.Literal("confirmed"), duplicate: Schema.Boolean, plan: BackupPlan }),
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
    Schema.Struct({ type: Schema.Literal("item"), item: BackupItem }),
    Schema.Struct({ type: Schema.Literal("grant"), item: BackupItem, grant: BackupGrant, claimed: Schema.Boolean }),
])
export type BackupWorkResult = typeof BackupWorkResult.Type
/**
 * archive is the DM message that carries the encrypted archive, so the website can ask the bot to read it again. requestedAt names the website
 * request this answers, and a preview from chat has none
 */
export const BackupPreviewRequest = Schema.Struct({
    requestedAt: optional(Millis),
    serverId: Id,
    context: BackupContext,
    manifest: BackupManifest,
    archiveDigest: Digest,
    native: Schema.NullOr(BackupNativeProof),
    archive: Schema.Struct({ channelId: Id, messageId: Id }),
    /** Also delete the channels and categories the archive does not hold */
    match: Schema.Boolean,
})
export type BackupPreviewRequest = typeof BackupPreviewRequest.Type
/** The restore plan a preview made, which is the same plan a confirmation runs */
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
/** One pass of a restore the website confirmed: how many items it recorded, and owner when the sender no longer owns the server */
export const BackupRunStepRequest = Schema.Struct({
    serverId: Id,
    requestedAt: Millis,
    recorded: Int(0, 20),
    stopped: optional(Schema.Literal("owner")),
})
export type BackupRunStepRequest = typeof BackupRunStepRequest.Type
