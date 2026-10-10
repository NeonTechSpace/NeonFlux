import { Schema } from "effect"
import { Id, Ids, Int, IsoTime, List, Millis, PermissionBits, Str, Text, Token, isId, origin } from "./common.ts"
import { PublishingContent, PublishingKind, PublishingName } from "./publishing-base.ts"
import { CleanupPolicy } from "./cleanup.ts"
import { GreetingsRouteSettings, GreetingsSettings, type GreetingsRoute } from "./greetings.ts"
import { LEVELING_XP_CAP, LevelingSettings } from "./leveling.ts"
import { MetadataLogsEventRoute, MetadataLogsRoute, metadataCategories, metadataEventSelectors } from "./metadata-logs.ts"
import { MilestonesRoute } from "./milestones.ts"
import { AutomodRule, ModerationSettings } from "./moderation.ts"
import { ResponseDefinition } from "./responses.ts"
import { RolesMappings, RolesPanel, RolesPanelKind, RolesSettings } from "./roles.ts"
import { TicketCategory, TicketSettings } from "./tickets.ts"

// Selective backup and additive restore, see docs/BOT.md#selective-backup-and-additive-restore

/**
 * A restore plan holds at most 500 items and confirms within 15 minutes. Chat shows a preview ten items a page, so 50 pages cover a plan.
 * The website pages the whole stored preview itself
 */
export const BACKUP_PLAN_ITEMS = 500, BACKUP_PLAN_MS = 900000, BACKUP_PREVIEW_PAGE = 10, BACKUP_PREVIEW_PAGES = 50
/** The most items of each category one archive holds */
export const BACKUP_CATEGORY_LIMITS = { config: 500, xp: 1000, structure: 100 } as const
const bits = (list: number[]) => list.reduce((mask, bit) => mask | (1n << BigInt(bit)), 0n)
/** Permissions a restored overwrite may allow. Bits 35 and 38 let members start and answer posts or threads, which forum channels commonly grant */
export const BACKUP_SAFE_ALLOW = bits([6, 9, 10, 11, 14, 15, 16, 20, 21, 25, 35, 38, 54])
/** Permissions a restored overwrite may deny */
export const BACKUP_KNOWN_DENY = bits([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 34, 35, 36, 37, 38, 40, 43, 51, 52, 53, 54])
/** What no archive holds, in this order */
export const backupExclusions = ["credentials", "native-roles", "server-settings", "messages", "private-history", "participation", "membership", "audit-history", "receipts", "leases", "cooldowns",
    "claims", "live-ownership", "effective-defcon", "event-definitions", "schedule-definitions"]
const optional = Schema.optionalKey
const unique = <A>(values: readonly A[], key: (value: A) => unknown = value => value) => new Set(values.map(key)).size === values.length
const pick = <F extends Schema.Struct.Fields, const K extends keyof F>(fields: F, ...keys: K[]) => Object.fromEntries(keys.map(key => [key, fields[key]])) as Pick<F, K>
const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
/** 1 to max characters, such as a source ID, a reason, a page cursor or a backend row ID */
const label = (max: number) => Str(max).check(Schema.isMinLength(1))
/** An instance's API origin, such as https://api.fluxer.app */
const BackupProvider = Str(2048).check(Schema.makeFilter((value: string) => {
    try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && url.origin === value && !url.username && !url.password } catch { return false }
}))
const selection = <const C extends string>(categories: C[]) => List(Schema.Literals(categories), categories.length).check(Schema.isMinLength(1), Schema.makeFilter((value: C[]) => unique(value)))

export const BackupCategory = Schema.Literals(["config", "xp", "structure"])
export type BackupCategory = typeof BackupCategory.Type

const { defcon: _defcon, automodBotMessagesEnabled: _botMessages, ...moderation } = ModerationSettings.fields
const { createdAt: _createdAt, updatedAt: _updatedAt, ...response } = ResponseDefinition.fields
const { revision: _rolesRevision, ...roles } = RolesSettings.fields
const { revision: _greetingRevision, ...greetingRoute } = GreetingsRouteSettings.fields
const { revision: _categoryRevision, ...ticketCategory } = TicketCategory.fields
const { revision: _levelRevision, mappingRevision: _mappingRevision, scoreEpoch: _scoreEpoch, ...leveling } = LevelingSettings.fields
const { revision: _routeRevision, ...metadataRoute } = MetadataLogsRoute.fields
const { revision: _eventRevision, ...metadataEventRoute } = MetadataLogsEventRoute.fields
const enabled = Schema.Struct({ enabled: Schema.Boolean })
/** A route with a template copy names its template, and its channel unless it is the DM route. One without stays off. Goodbyes follow the join */
const greeting = (route: GreetingsRoute) => Schema.Struct(greetingRoute).check(Schema.makeFilter(v => (v.content !== undefined
    ? v.templateName !== undefined && v.templateRevision !== undefined && (route === "dm" || v.channelId !== undefined)
    : v.channelId === undefined && v.templateName === undefined && v.templateRevision === undefined && !v.enabled) && (route !== "dm" || v.channelId === undefined) && (route !== "goodbye" || v.timing === "join")))
/** A log destination names its channel and owner together, and an enabled one has both */
const destination = (v: { readonly enabled: boolean, readonly channelId?: string, readonly ownerId?: string }) => (v.channelId === undefined) === (v.ownerId === undefined) && (!v.enabled || v.channelId !== undefined)
/** Each family's authored configuration as an archive keeps it, without revisions, counters or live state */
const values = {
    // Backups made before bot message checks lack automodBotMessagesEnabled
    moderation: Schema.Struct({ ...moderation, automodBotMessagesEnabled: optional(Schema.Boolean) }),
    responses: Schema.Struct({ customEnabled: Schema.Boolean, autoEnabled: Schema.Boolean }),
    response: Schema.Struct(response).check(Schema.makeFilter(v => v.kind === "auto" ? v.trigger !== undefined : v.trigger === undefined)),
    automod: AutomodRule,
    publishing: Schema.Struct({ enabled: Schema.Boolean, retentionDays: Int(30, 3650) }),
    draft: Schema.Struct({ kind: PublishingKind, name: PublishingName, content: PublishingContent }),
    roles: Schema.Struct(roles),
    panel: Schema.Struct({ name: RolesPanel.fields.name, kind: RolesPanelKind, enabled: Schema.Boolean, exclusive: Schema.Boolean, mappings: RolesMappings })
        .check(Schema.makeFilter(v => v.kind !== "verification" || v.mappings.length <= 1)),
    greetings: Schema.Struct({ claimsPerMinute: GreetingsSettings.fields.claimsPerMinute, retentionDays: GreetingsSettings.fields.retentionDays,
        routes: Schema.Struct({ welcome: greeting("welcome"), dm: greeting("dm"), goodbye: greeting("goodbye") }) }),
    tickets: TicketSettings,
    ticketCategory: Schema.Struct(ticketCategory).check(Schema.makeFilter(v => unique(v.cannedReplies, reply => reply.name))),
    leveling: Schema.Struct(leveling),
    milestones: enabled,
    milestoneRoute: Schema.Struct(pick(MilestonesRoute.fields, "kind", "channelId", "zone", "time", "fold", "template", "content", "enabled")),
    suggestions: Schema.Struct({ enabled: Schema.Boolean, channelId: optional(Id), ownerId: optional(Id) }).check(Schema.makeFilter(v => !v.enabled || v.channelId !== undefined)),
    cleanup: enabled,
    cleanupPolicy: Schema.Struct(pick(CleanupPolicy.fields, "channelId", "enabled", "ageMs", "ownerId", "excludedAuthorIds", "excludedMessageIds"))
        .check(Schema.makeFilter(v => unique(v.excludedAuthorIds) && unique(v.excludedMessageIds))),
    // Backups from before the security category have no route for it
    metadata: Schema.Struct({ enabled: Schema.Boolean, routes: List(Schema.Struct(metadataRoute), metadataCategories.length),
        eventRoutes: optional(List(Schema.Struct(metadataEventRoute), metadataEventSelectors.length)), messageChannelIds: Ids(50), excludedChannelIds: Ids(50) })
        .check(Schema.makeFilter(v => unique(v.routes, route => route.category) && metadataCategories.every(category => category === "security" || v.routes.some(route => route.category === category))
            && unique(v.eventRoutes ?? [], route => route.eventType) && [...v.routes, ...v.eventRoutes ?? []].every(destination) && unique(v.messageChannelIds) && unique(v.excludedChannelIds))),
    events: enabled,
    schedules: enabled,
}
export const BackupConfigValues = Schema.Struct(values)
export type BackupConfigValues = typeof BackupConfigValues.Type
/** The configuration families, in the order a restore plan lists them */
export const backupConfigFamilies = Object.keys(values) as (keyof typeof values)[]
export const BackupConfigFamily = Schema.Literals(backupConfigFamilies)
export type BackupConfigFamily = typeof BackupConfigFamily.Type
const entry = <K extends BackupConfigFamily>(family: K) => Schema.Struct({ family: Schema.Literal(family), sourceId: Token, value: values[family] })
const configObjects = Schema.Union([entry("moderation"), entry("responses"), entry("response"), entry("automod"), entry("publishing"), entry("draft"), entry("roles"), entry("panel"), entry("greetings"),
    entry("tickets"), entry("ticketCategory"), entry("leveling"), entry("milestones"), entry("milestoneRoute"), entry("suggestions"), entry("cleanup"), entry("cleanupPolicy"), entry("metadata"), entry("events"),
    entry("schedules")])
/** What names a configuration object within its family: a response, draft or template by kind and name, a rule, panel or ticket category by name */
export function backupConfigIdentity(object: typeof configObjects.Type) {
    switch (object.family) {
        case "response": case "draft": return `${object.value.kind}_${object.value.name}`
        case "automod": case "panel": case "ticketCategory": return object.value.name
        case "milestoneRoute": return object.value.kind
        case "cleanupPolicy": return object.value.channelId
        default: return object.family
    }
}
export const BackupConfigObject = configObjects.check(Schema.makeFilter(object => object.sourceId === backupConfigIdentity(object)))
export type BackupConfigObject = typeof BackupConfigObject.Type
export const BackupXpObject = Schema.Struct({ sourceId: Id, userId: Id, xp: Int(0, LEVELING_XP_CAP) }).check(Schema.makeFilter(v => v.sourceId === v.userId))
export type BackupXpObject = typeof BackupXpObject.Type
/** An overwrite allows only safe permissions, denies only known ones and never both */
export const BackupOverwrite = Schema.Struct({ id: Id, type: Schema.Literals(["role", "member"]), allow: PermissionBits, deny: PermissionBits }).check(Schema.makeFilter(v => {
    const allow = BigInt(v.allow), deny = BigInt(v.deny)
    return !(allow & ~BACKUP_SAFE_ALLOW) && !(deny & ~BACKUP_KNOWN_DENY) && !(allow & deny)
}))
export type BackupOverwrite = typeof BackupOverwrite.Type
const emoji = { emojiId: Schema.NullOr(Id), emojiName: Schema.NullOr(label(64)) }
const oneEmoji = (v: { readonly emojiId: string | null, readonly emojiName: string | null }) => v.emojiId === null || v.emojiName === null
/** A forum or media channel tag. Tag IDs are not kept, since a restored channel's tags get new ones */
export const BackupForumTag = Schema.Struct({ name: Text(50), moderated: Schema.Boolean, ...emoji }).check(Schema.makeFilter(oneEmoji))
export type BackupForumTag = typeof BackupForumTag.Type
const forumFields = ["tags", "defaultReaction", "defaultAutoArchiveMinutes", "sortOrder", "layout", "requireTag"] as const
/** Forum and media channels also keep their tags, default reaction, default auto-archive minutes, sort order, the REQUIRE_TAG flag and,
 *  for forums, the layout. Their posts are threads, which are not backed up */
export const BackupStructureObject = Schema.Struct({ sourceId: Id, type: Schema.Literals(["category", "text", "voice", "forum", "media"]),
    name: Str(100).check(Schema.makeFilter((value: string) => value.trim() !== "" && !/[\u0000-\u001f\u202e]/.test(value))), parentId: Schema.NullOr(Id),
    overwrites: List(BackupOverwrite, 100).check(Schema.makeFilter(rows => unique(rows, row => row.id))), topic: optional(Schema.NullOr(Str(4096))), nsfw: optional(Schema.Boolean),
    slowmodeSeconds: optional(Int(0, 21600)), bitrate: optional(Int(8000, 384000)), userLimit: optional(Int(0, 99)), tags: optional(List(BackupForumTag, 20).check(Schema.makeFilter(tags => unique(tags, tag => tag.name)))),
    defaultReaction: optional(Schema.NullOr(Schema.Struct(emoji).check(Schema.makeFilter(oneEmoji)))),
    defaultAutoArchiveMinutes: optional(Schema.NullOr(Int().check(Schema.makeFilter((value: number) => [60, 1440, 4320, 10080].includes(value))))),
    sortOrder: optional(Schema.NullOr(Int(0, 255))), layout: optional(Int(0, 255)), requireTag: optional(Schema.Boolean), capturedAt: Millis })
    .check(Schema.makeFilter(v => v.parentId !== v.sourceId && (v.type === "forum" || v.type === "media"
        ? v.bitrate === undefined && v.userLimit === undefined && (v.type === "forum" || v.layout === undefined)
        : forumFields.every(key => v[key] === undefined) && (v.type === "voice" ? v.topic === undefined && v.nsfw === undefined && v.slowmodeSeconds === undefined
            : v.bitrate === undefined && v.userLimit === undefined && (v.topic ?? "").length <= 1024
                && (v.type === "text" || v.parentId === null && v.topic === undefined && v.nsfw === undefined && v.slowmodeSeconds === undefined)))))
export type BackupStructureObject = typeof BackupStructureObject.Type
const configList = List(BackupConfigObject, BACKUP_CATEGORY_LIMITS.config).check(Schema.makeFilter(rows => unique(rows, row => `${row.family}:${row.sourceId}`)))
const xpList = List(BackupXpObject, BACKUP_CATEGORY_LIMITS.xp).check(Schema.makeFilter(rows => unique(rows, row => row.userId)))
export const BackupSnapshot = Schema.Struct({ capturedAt: Millis, config: configList, xp: xpList, counts: Schema.Struct({ config: Int(0, BACKUP_CATEGORY_LIMITS.config), xp: Int(0, BACKUP_CATEGORY_LIMITS.xp) }) })
    .check(Schema.makeFilter(v => v.counts.config === v.config.length && v.counts.xp === v.xp.length))
export type BackupSnapshot = typeof BackupSnapshot.Type
/**
 * What an encrypted archive holds. The format stays version 1, so older archives keep restoring. Category sizes and selection are
 * checked by backupWithinLimits, since a restore refuses those with their own status
 */
export const BackupManifest = Schema.Struct({ version: Schema.Literal(1), backupId: Token, provider: BackupProvider, serverId: Id, selected: selection(["config", "xp", "structure"]), capturedAt: Millis,
    observations: Schema.Struct({ databaseAt: Schema.NullOr(Millis), structureStartedAt: Schema.NullOr(Millis), structureFinishedAt: Schema.NullOr(Millis) }),
    counts: Schema.Struct({ config: Int(), xp: Int(), structure: Int(), overwrites: Int() }), exclusions: Schema.mutable(Schema.Array(Schema.String)),
    config: Schema.mutable(Schema.Array(BackupConfigObject)), xp: Schema.mutable(Schema.Array(BackupXpObject)), structure: Schema.mutable(Schema.Array(BackupStructureObject)) })
    .check(Schema.makeFilter(v => {
        const o = v.observations, overwrites = v.structure.reduce((total, channel) => total + channel.overwrites.length, 0), structure = v.selected.includes("structure")
        const types = new Map(v.structure.map(channel => [channel.sourceId, channel.type]))
        return overwrites <= 500 && unique(v.config, row => `${row.family}:${row.sourceId}`) && unique(v.xp, row => row.userId) && unique(v.structure, row => row.sourceId)
            && v.counts.config === v.config.length && v.counts.xp === v.xp.length && v.counts.structure === v.structure.length && v.counts.overwrites === overwrites
            && [o.databaseAt, o.structureStartedAt, o.structureFinishedAt].every(at => at === null || at <= v.capturedAt)
            && (!v.selected.includes("config") && !v.selected.includes("xp") || o.databaseAt !== null)
            && (!structure || o.structureStartedAt !== null && o.structureFinishedAt !== null && o.structureStartedAt <= o.structureFinishedAt
                && v.structure.every(channel => channel.capturedAt >= o.structureStartedAt! && channel.capturedAt <= o.structureFinishedAt!))
            && v.exclusions.length === backupExclusions.length && v.exclusions.every((name, i) => name === backupExclusions[i])
            && v.structure.every(channel => channel.parentId === null || (types.get(channel.parentId) ?? "category") === "category")
    }))
export type BackupManifest = typeof BackupManifest.Type
/** Each category within its limit, and items only in the categories an archive selected. A restore refuses any other archive as a whole */
export const backupWithinLimits = (manifest: BackupManifest) => (["config", "xp", "structure"] as const).every(key => manifest[key].length <= BACKUP_CATEGORY_LIMITS[key] && (manifest.selected.includes(key) || !manifest[key].length))
/** The bot's fresh evidence that the current server owner asked in a private one-to-one DM. The backend checks its time, people and audience */
export const BackupContext = Schema.Struct({ ...origin, provider: BackupProvider, observedAt: Millis, ownerId: Id, actorId: Id, actorKind: Schema.Literal("human"), botId: Id, botKind: Schema.Literal("bot"),
    ownerJoinedAt: IsoTime, ownerTimeoutUntil: Schema.NullOr(IsoTime), botTimeoutUntil: Schema.NullOr(IsoTime), dmChannelId: Id, dmType: Schema.Literal(1), recipientIds: Ids(2).check(Schema.isUnique()),
    privateReplyAuthorized: Schema.Boolean })
export type BackupContext = typeof BackupContext.Type
export const BackupReference = Schema.Struct({ ...origin, id: Id, type: Schema.Literals(["role", "member", "category", "text", "voice"]), serverId: Id, observedAt: Millis, exists: Schema.Boolean,
    actorCanAccess: Schema.Boolean, botCanAccess: Schema.Boolean, actorCanManage: Schema.Boolean, botCanManage: Schema.Boolean, permissions: PermissionBits })
export type BackupReference = typeof BackupReference.Type
/** A present channel comes with its snapshot */
export const BackupNativeObservation = Schema.Struct({ ...origin, sourceId: Id, observedAt: Millis, status: Schema.Literals(["present", "absent", "unknown"]), channel: Schema.NullOr(BackupStructureObject) })
    .check(Schema.makeFilter(v => (v.status === "present") === (v.channel !== null)))
export type BackupNativeObservation = typeof BackupNativeObservation.Type
/** serverId, ownerId and botId must name the request's server and the context's owner and bot, which the backend checks */
export const BackupNativeProof = Schema.Struct({ ...origin, observedAt: Millis, serverId: Schema.String, ownerId: Schema.String, botId: Schema.String, actorPermissions: PermissionBits, botPermissions: PermissionBits,
    actorCanManageChannels: Schema.Boolean, botCanManageChannels: Schema.Boolean, references: List(BackupReference, 1000), observations: List(BackupNativeObservation, 100) })
    .check(Schema.makeFilter(v => unique(v.references, row => `${row.type}:${row.id}`) && unique(v.observations, row => row.sourceId)))
export type BackupNativeProof = typeof BackupNativeProof.Type
export const BackupBinding = Schema.Struct({ planId: Str(128), revision: Schema.Literal(1), planHash: Digest, archiveDigest: Digest })
export type BackupBinding = typeof BackupBinding.Type
export const BackupItemBinding = Schema.Struct({ ...BackupBinding.fields, itemNo: Int(1, BACKUP_PLAN_ITEMS), generation: Schema.Literal(1) })
export type BackupItemBinding = typeof BackupItemBinding.Type
export const BackupDisposition = Schema.Literals(["create", "skip", "conflict", "blocked"])
export type BackupDisposition = typeof BackupDisposition.Type
export const BackupItemState = Schema.Literals(["planned", "reserved", "claimed", "created", "skipped", "conflict", "blocked", "failed", "uncertain"])
export type BackupItemState = typeof BackupItemState.Type
const family = Schema.Literals([...backupConfigFamilies, "xp", "structure"])
const resolution = Schema.Literals(["match", "absent", "conflict"])
const counts = Schema.Struct({ create: Int(0, BACKUP_PLAN_ITEMS), skip: Int(0, BACKUP_PLAN_ITEMS), conflict: Int(0, BACKUP_PLAN_ITEMS), blocked: Int(0, BACKUP_PLAN_ITEMS) })
const total = (value: typeof counts.Type) => value.create + value.skip + value.conflict + value.blocked
/** A configuration item belongs to a configuration family, and a channel maps to a Fluxer channel ID */
const familyMatches = (v: { readonly category: BackupCategory, readonly family: typeof family.Type }) => v.category === "config" ? v.family !== "xp" && v.family !== "structure" : v.family === v.category
const nativeMapping = (v: { readonly category: BackupCategory, readonly mappedId: string | null }) => v.category !== "structure" || v.mappedId === null || isId(v.mappedId)
export const BackupItem = Schema.Struct({ ...BackupItemBinding.fields, category: BackupCategory, family, sourceId: label(128), disposition: BackupDisposition, reason: Schema.NullOr(label(256)), state: BackupItemState,
    expectedHash: Digest, desiredHash: Digest, dependencyItemNo: Schema.NullOr(Int(1, BACKUP_PLAN_ITEMS)), mappedId: Schema.NullOr(label(256)), disabledOnCreate: Schema.Boolean, dispatchExpiresAt: optional(Millis),
    claimedAt: optional(Millis), finishedAt: optional(Millis), noDispatch: optional(Schema.Literal(true)), historicalOutcome: optional(Schema.Literals(["created", "failed", "uncertain"])), resolution: optional(resolution) })
    .check(Schema.makeFilter(familyMatches), Schema.makeFilter(nativeMapping))
export type BackupItem = typeof BackupItem.Type
export const BackupPlan = Schema.Struct({ ...BackupBinding.fields, backupId: label(128), manifestDigest: Digest, provider: BackupProvider, serverId: Id, ownerId: Id, createdAt: Millis, expiresAt: Millis,
    confirmedAt: optional(Millis), itemCount: Int(0, BACKUP_PLAN_ITEMS), counts, forgotten: Schema.Boolean })
    .check(Schema.makeFilter(v => v.expiresAt === v.createdAt + BACKUP_PLAN_MS && total(v.counts) === v.itemCount && (v.confirmedAt === undefined || v.confirmedAt >= v.createdAt && v.confirmedAt < v.expiresAt)))
export type BackupPlan = typeof BackupPlan.Type
export const BackupOrigin = Schema.Struct({ provider: BackupProvider, serverId: Id, category: BackupCategory, family, sourceId: label(128), state: Schema.Literals(["reserved", "claimed", "created", "uncertain", "failed"]),
    planId: label(256), itemNo: Int(1, BACKUP_PLAN_ITEMS), generation: Schema.Literal(1), mappedId: Schema.NullOr(label(256)), desiredHash: Digest, resolved: optional(resolution) })
    .check(Schema.makeFilter(nativeMapping))
export type BackupOrigin = typeof BackupOrigin.Type
export const BackupGrant = Schema.Struct({ ...BackupItemBinding.fields, provider: BackupProvider, serverId: Id, ownerId: Id, botId: Id, sourceId: Id, channel: BackupStructureObject, dispatchExpiresAt: Millis,
    nativeDeadlineMs: Schema.Literal(5000) })
export type BackupGrant = typeof BackupGrant.Type
export const BackupCapabilities = Schema.Struct({ version: Schema.Literal(1), configFamilies: List(BackupConfigFamily, 30), exclusions: List(label(256), 100),
    limits: Schema.Struct({ xp: Schema.Literal(1000), structure: Schema.Literal(100), overwrites: Schema.Literal(500), planItems: Schema.Literal(500), plans: Schema.Literal(10), page: Schema.Literal(20),
        planMs: Schema.Literal(900000), snapshotBytes: Schema.Literal(1048576), planBytes: Schema.Literal(524288), originMappings: Schema.Literal(5000) }), safeAllowMask: PermissionBits, knownDenyMask: PermissionBits })
export type BackupCapabilities = typeof BackupCapabilities.Type
/** One archive item as a restore plan made now would treat it. name is a channel's name, since its source ID names a channel that may no longer exist */
export const BackupPreviewItem = Schema.Struct({ itemNo: Int(1, BACKUP_PLAN_ITEMS), category: BackupCategory, family, sourceId: label(128), name: optional(label(100)), disposition: BackupDisposition,
    reason: Schema.NullOr(label(256)) })
export type BackupPreviewItem = typeof BackupPreviewItem.Type
/** A read-only restore preview: The plain list of what a restore would do against the server as it was at checkedAt */
export const BackupPreview = Schema.Struct({ backupId: label(128), archiveDigest: Digest, checkedAt: Millis, counts, items: List(BackupPreviewItem, BACKUP_PLAN_ITEMS) })
export type BackupPreview = typeof BackupPreview.Type
const { items: _items, ...previewFields } = BackupPreview.fields
export const BackupPreviewPage = Schema.Struct({ ...previewFields, itemCount: Int(0, BACKUP_PLAN_ITEMS), page: Int(1, BACKUP_PREVIEW_PAGES), pages: Int(1, BACKUP_PREVIEW_PAGES),
    items: List(BackupPreviewItem, BACKUP_PREVIEW_PAGE) }).check(Schema.makeFilter(v => total(v.counts) === v.itemCount && v.page <= v.pages))
export type BackupPreviewPage = typeof BackupPreviewPage.Type
/** Why the bot could not refresh a preview: owner is a sender who no longer owns the server or a DM that is no longer private, archive an archive message, attachment or key that no longer reads, key a missing backup key, refused an archive the restore refuses as a whole, error a failed read, unanswered no answer in time */
export const BackupPreviewFailure = Schema.Literals(["owner", "archive", "key", "refused", "error", "unanswered"])
export type BackupPreviewFailure = typeof BackupPreviewFailure.Type
export const BackupPreviewJob = Schema.Struct({ ownerId: Id, channelId: Id, messageId: Id })
export type BackupPreviewJob = typeof BackupPreviewJob.Type

const cursor = optional(label(4096)), nextCursor = optional(label(8192))
export const BackupSnapshotRequest = Schema.Struct({ serverId: Id, context: BackupContext, selected: selection(["config", "xp"]) })
export type BackupSnapshotRequest = typeof BackupSnapshotRequest.Type
export const BackupQueryRequest = Schema.Struct({ serverId: Id, context: BackupContext, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("capabilities") }),
    Schema.Struct({ type: Schema.Literal("plans"), cursor }),
    Schema.Struct({ type: Schema.Literal("plan"), binding: BackupBinding }),
    Schema.Struct({ type: Schema.Literal("items"), binding: BackupBinding, cursor }),
    Schema.Struct({ type: Schema.Literal("item"), binding: BackupItemBinding }),
    Schema.Struct({ type: Schema.Literal("origins"), provider: BackupProvider, cursor }),
    Schema.Struct({ type: Schema.Literal("preview"), page: Int(1, BACKUP_PREVIEW_PAGES) }),
]) })
export type BackupQueryRequest = typeof BackupQueryRequest.Type
const items = List(BackupItem, 20).check(Schema.makeFilter(rows => unique(rows, row => row.itemNo)))
export const BackupQueryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("capabilities"), capabilities: BackupCapabilities }),
    Schema.Struct({ type: Schema.Literal("plans"), plans: List(BackupPlan, 20), nextCursor }),
    Schema.Struct({ type: Schema.Literal("plan"), plan: BackupPlan }),
    Schema.Struct({ type: Schema.Literal("items"), items, nextCursor }),
    Schema.Struct({ type: Schema.Literal("item"), item: BackupItem, object: Schema.NullOr(Schema.Union([BackupConfigObject, BackupXpObject, BackupStructureObject])) }),
    Schema.Struct({ type: Schema.Literal("origins"), origins: List(BackupOrigin, 20), nextCursor }),
    Schema.Struct({ type: Schema.Literal("preview"), preview: Schema.NullOr(BackupPreviewPage) }),
])
export type BackupQueryResult = typeof BackupQueryResult.Type
export const BackupManageRequest = Schema.Struct({ serverId: Id, messageId: Id, createdAt: Millis, context: BackupContext, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("plan"), manifest: BackupManifest, archiveDigest: Digest, native: Schema.NullOr(BackupNativeProof) }),
    Schema.Struct({ type: Schema.Literal("confirm"), binding: BackupBinding }),
    Schema.Struct({ type: Schema.Literal("forget"), binding: BackupBinding }),
]) })
export type BackupManageRequest = typeof BackupManageRequest.Type
export const BackupManageResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("plan"), duplicate: Schema.Boolean, plan: BackupPlan, items, nextCursor }),
    Schema.Struct({ type: Schema.Literal("confirmed"), duplicate: Schema.Boolean, plan: BackupPlan }),
    Schema.Struct({ type: Schema.Literal("forgotten"), plan: BackupPlan }),
])
export type BackupManageResult = typeof BackupManageResult.Type
/** The claim token is checked where a claim or outcome uses it, since a repeated claim answers the grant it already holds */
export const BackupWorkRequest = Schema.Struct({ serverId: Id, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("apply"), binding: BackupItemBinding, context: BackupContext, native: Schema.NullOr(BackupNativeProof) }),
    Schema.Struct({ type: Schema.Literals(["reserve", "claim"]), binding: BackupItemBinding, context: BackupContext, native: BackupNativeProof, claimToken: optional(Schema.String) }),
    Schema.Struct({ type: Schema.Literal("outcome"), binding: BackupItemBinding, claimToken: Schema.String, outcome: Schema.Literals(["created", "failed", "uncertain"]), noDispatch: optional(Schema.Literal(true)),
        channel: Schema.NullOr(BackupStructureObject), mappedId: Schema.NullOr(Id) }),
    Schema.Struct({ type: Schema.Literal("reconcile"), binding: BackupItemBinding, context: BackupContext, native: BackupNativeProof }),
]) })
export type BackupWorkRequest = typeof BackupWorkRequest.Type
export const BackupWorkResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("item"), item: BackupItem }),
    Schema.Struct({ type: Schema.Literal("grant"), item: BackupItem, grant: BackupGrant, claimed: Schema.Boolean }),
])
export type BackupWorkResult = typeof BackupWorkResult.Type
/** archive is the DM message that carries the encrypted archive, so the website can ask the bot to read it again */
export const BackupPreviewRequest = Schema.Struct({ serverId: Id, context: BackupContext, manifest: BackupManifest, archiveDigest: Digest, native: Schema.NullOr(BackupNativeProof),
    archive: Schema.Struct({ channelId: Id, messageId: Id }), page: Int(1, BACKUP_PREVIEW_PAGES) })
export type BackupPreviewRequest = typeof BackupPreviewRequest.Type
/** The archive the website waits for the bot to read again */
export const BackupPreviewReadyRequest = Schema.Struct({ serverId: Id })
export type BackupPreviewReadyRequest = typeof BackupPreviewReadyRequest.Type
export const BackupPreviewReadyResult = Schema.Struct({ job: Schema.NullOr(BackupPreviewJob) })
export type BackupPreviewReadyResult = typeof BackupPreviewReadyResult.Type
export const BackupPreviewFailedRequest = Schema.Struct({ serverId: Id, failure: Schema.Literals(["owner", "archive", "key", "refused", "error"]) })
export type BackupPreviewFailedRequest = typeof BackupPreviewFailedRequest.Type
/** recorded is false when no refresh was waiting */
export const BackupPreviewFailedResult = Schema.Struct({ recorded: Schema.Boolean })
export type BackupPreviewFailedResult = typeof BackupPreviewFailedResult.Type
