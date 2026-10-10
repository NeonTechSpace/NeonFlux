import { Schema, Struct } from "effect"
import { Id, Ids, Int, List, Millis, Str, Text, Token, origin } from "./common.ts"
import { ModerationActor, RolesRoleSnapshot } from "./shared.ts"
import { PublishingAttempt, PublishingContent, PublishingGrant } from "./publishing-base.ts"
import { civilIntent } from "./civil.ts"
import { DashboardPublishingContext, PublishingConfigurationOperation } from "./publishing.ts"
import { AlertsDashboardContext, AlertsDashboardOperation } from "./alerts.ts"
import { CleanupContext, CleanupManageOperation, CleanupPolicyDeleteOperation } from "./cleanup.ts"
import { EventsCalendar, EventsConfigurationOperation, EventsContext, EventsDeliveryGrant, EventsManageOperation } from "./events.ts"
import { validNickname } from "./general.ts"
import { GreetingsManageRequest } from "./greetings.ts"
import { HelpDeskOperation } from "./helpdesk.ts"
import { LevelingManageOperation } from "./leveling.ts"
import { LfgOperation } from "./lfg.ts"
import { MemberAccessOperation } from "./member-content.ts"
import { MemberListOperation } from "./member-list.ts"
import { MetadataConfigurationOperation, MetadataLogsContext, MetadataLogsSettings } from "./metadata-logs.ts"
import { MilestonesManageOperation } from "./milestones.ts"
import { ModerationManageOperation } from "./moderation.ts"
import { OnboardingOperation } from "./onboarding.ts"
import { PresetName } from "./presets.ts"
import { ProfileOperation } from "./profiles.ts"
import { ResponseAutoOperation, ResponseCustomOperation, ResponseDefinition, ResponseReplyInput, ResponseTriggerInput } from "./responses.ts"
import { RolePickerManageRequest, RolePickerOperation } from "./role-picker.ts"
import { RolesManageOperation, RolesManageResult, RolesMappingsInput } from "./roles.ts"
import { SchedulesCalendar, SchedulesContext, SchedulesManageOperation } from "./schedules.ts"
import { ShowcaseOperation } from "./showcases.ts"
import { SidebarDashboardContext, SidebarDashboardOperation } from "./sidebar.ts"
import { StickyOperation } from "./sticky.ts"
import { SuggestionsManageOperation } from "./suggestions.ts"
import { TemporaryRoleOperation } from "./temporary-roles.ts"
import { TicketConfigurationOperation, TicketContext } from "./tickets.ts"
import { VoiceDashboardContext, VoiceManageOperation } from "./voice.ts"
import { YoutubeOperation } from "./youtube.ts"

// Website jobs the bot carries out with fresh native evidence: configuration changes, messages, role panels and logging settings,
// see docs/BACKEND.md#dashboard-and-web-verification. Configuration jobs reuse each family's chat operations wherever the website makes the same change

const optional = Schema.optionalKey
const op = <const T extends string, F extends Schema.Struct.Fields>(type: T, fields: F) => Schema.Struct({ type: Schema.Literal(type), ...fields })
type Operation = Schema.Top & { readonly fields: { readonly type: Schema.Literal<string> | Schema.Literals<ReadonlyArray<string>> } }
/** The operations of a union whose types are all among types, like Extract */
function pick<M extends ReadonlyArray<Operation>, const T extends string>(union: Schema.Union<M>, types: ReadonlyArray<T>) {
    const listed = (value: string) => (types as ReadonlyArray<string>).includes(value)
    return Schema.Union(union.members.filter(({ fields: { type } }) => ("literals" in type ? type.literals : [type.literal]).every(listed))) as unknown as
        Schema.Codec<Extract<M[number]["Type"], { readonly type: T }>>
}
const readyJobs = <S extends Schema.Codec<{ readonly id: string }>>(job: S) => List(job, 4).check(Schema.makeFilter(jobs => new Set(jobs.map(row => row.id)).size === jobs.length))

export const DashboardConfigurationFamily = Schema.Literals(["responses", "moderation", "publishing", "greetings", "tickets", "leveling", "milestones", "suggestions", "cleanup", "events", "schedules",
    "nickname", "voice", "rolepicker", "temproles", "sticky", "sidebar", "memberlist", "alerts", "helpdesk", "onboarding", "presets", "lfg", "showcase", "profile", "youtube"])
export type DashboardConfigurationFamily = typeof DashboardConfigurationFamily.Type
/** A calendar as the website asks for it. The bot resolves its dates when it carries out the job */
export const DashboardEventCalendar = Schema.Struct({ ...civilIntent, durationMinutes: EventsCalendar.fields.durationMinutes })
export type DashboardEventCalendar = typeof DashboardEventCalendar.Type
export const DashboardScheduleCalendar = Schema.Struct(civilIntent)
export type DashboardScheduleCalendar = typeof DashboardScheduleCalendar.Type
/** A website save of one whole definition. Autoresponders need a trigger and custom commands have none */
export const DashboardResponseDefinition = Schema.Struct({ name: Schema.String, reply: ResponseReplyInput, trigger: optional(ResponseTriggerInput), channelIds: Ids(20), roleIds: Ids(20),
    cooldownSeconds: ResponseDefinition.fields.cooldownSeconds, priority: ResponseDefinition.fields.priority, enabled: Schema.Boolean })
export type DashboardResponseDefinition = typeof DashboardResponseDefinition.Type
export const DashboardResponseSave = Schema.Struct({ type: Schema.Literals(["definition-create", "definition-update"]), definition: DashboardResponseDefinition })
export type DashboardResponseSave = typeof DashboardResponseSave.Type

const responseChanges = ["update", "enable", "disable", "delete", "module", "create"] as const
const [ticketSettings, categoryCreate, categoryUpdate, ...ticketChanges] = TicketConfigurationOperation.members
const [levelingSettings, levelingMappings] = LevelingManageOperation.members
const [milestoneSettings, milestoneConfigure, milestoneSwitch] = MilestonesManageOperation.members
const [suggestionConfigure, suggestionSettings] = SuggestionsManageOperation.members
const [cleanupModule, cleanupConfigure, cleanupEnable, cleanupExclude, cleanupOwner] = CleanupManageOperation.members
const [eventSettings, eventThreads, eventCreate, eventCalendar, eventContent, eventCapacity, eventReminders, eventTemplate, eventPublish, eventForget] = EventsManageOperation.members
const [scheduleSettings, scheduleCreate, scheduleContent, scheduleCalendar, scheduleDestination, scheduleSwitch, , scheduleForget] = SchedulesManageOperation.members
const [generatorAdd, generatorSet, generatorRemove] = VoiceManageOperation.members
const temporaryRole = TemporaryRoleOperation.members[3], accessSet = MemberAccessOperation.members[0]

/** Each family's operation schema. Families whose chat commands use other operations name the ones the website sends */
export const DashboardConfigurationOperationMap = {
    responses: Schema.Union([
        Schema.Struct({ kind: Schema.Literal("custom"), operation: Schema.Union([pick(ResponseCustomOperation, responseChanges), DashboardResponseSave]) }),
        Schema.Struct({ kind: Schema.Literal("auto"), operation: Schema.Union([pick(ResponseAutoOperation, responseChanges), DashboardResponseSave]) }),
    ]).check(Schema.makeFilter(v => v.operation.type !== "definition-create" && v.operation.type !== "definition-update" || (v.kind === "auto") === (v.operation.definition.trigger !== undefined))),
    moderation: pick(ModerationManageOperation, ["settings", "rule-create", "rule-update", "rule-delete", "watchlist-add", "watchlist-remove", "private-role"]),
    publishing: PublishingConfigurationOperation,
    greetings: GreetingsManageRequest.fields.operation,
    tickets: Schema.Union([ticketSettings, categoryCreate.mapFields(Struct.omit(["roles"])), categoryUpdate.mapFields(Struct.omit(["roles"])), ...ticketChanges]),
    leveling: Schema.Union([levelingSettings, levelingMappings.mapFields(Struct.omit(["roles"]))]),
    milestones: Schema.Union([milestoneSettings, milestoneConfigure, milestoneSwitch]),
    suggestions: Schema.Union([suggestionSettings, Schema.Struct({ ...suggestionConfigure.fields, ownerId: Id })]),
    cleanup: Schema.Union([cleanupModule, cleanupEnable, cleanupExclude, cleanupOwner.mapFields(Struct.omit(["recipientOwner"])), Schema.Struct({ ...cleanupConfigure.fields, ownerId: Id }),
        CleanupPolicyDeleteOperation]),
    events: Schema.Union([eventSettings, eventThreads, Schema.Struct({ ...eventCreate.fields, ownerId: Id }), Schema.Struct({ ...eventCalendar.fields, calendar: DashboardEventCalendar }), eventContent,
        eventCapacity, eventReminders, eventTemplate, EventsConfigurationOperation.members[1], Schema.Struct({ ...eventPublish.fields, type: Schema.Literals(["publish", "cancel"]) }), eventForget]),
    schedules: Schema.Union([scheduleSettings, Schema.Struct({ ...scheduleCreate.fields, calendar: DashboardScheduleCalendar }), scheduleContent,
        Schema.Struct({ ...scheduleCalendar.fields, calendar: DashboardScheduleCalendar }), scheduleDestination, scheduleSwitch, scheduleForget]),
    /** Reset clears the nickname, so Fluxer shows the bot's username */
    nickname: Schema.Union([op("set", { nickname: Schema.String.check(Schema.makeFilter(validNickname)) }), op("reset", {})]),
    /** The bot creates the generator channel for an add request, so it carries no channel ID */
    voice: Schema.Union([generatorAdd.mapFields(Struct.omit(["channelId"])), Schema.Struct({ ...generatorSet.fields, expectedRevision: Int() }),
        Schema.Struct({ ...generatorRemove.fields, expectedRevision: Int() })]),
    /** Menu set creates or replaces one whole menu, and access set replaces all four lists */
    rolepicker: pick(RolePickerOperation, ["module", "menu-set", "menu-remove", "access-set"]),
    sticky: StickyOperation,
    /** The bot creates the link channel for an add request, in the chosen category or at the top level */
    sidebar: SidebarDashboardOperation,
    memberlist: MemberListOperation,
    /** Sets both durations of one role. Two nulls remove the role's defaults */
    temproles: Schema.Struct({ ...temporaryRole.fields, defaultSeconds: temporaryRole.fields.defaultSeconds.schema, maxSeconds: temporaryRole.fields.maxSeconds.schema }),
    /** The bot reads the server's invites for a refresh, and revokes the one ref names before it reads them again */
    alerts: AlertsDashboardOperation,
    helpdesk: HelpDeskOperation,
    /** The website replaces the whole step list */
    onboarding: pick(OnboardingOperation, ["module", "delivery", "steps", "role"]),
    /** token is the one of the preview the manager confirmed */
    presets: op("apply", { name: PresetName, token: Token }),
    lfg: pick(LfgOperation, ["settings"]),
    /** The website changes settings and replaces the access lists */
    showcase: Schema.Union([ShowcaseOperation.members[0], accessSet]),
    profile: Schema.Union([ProfileOperation.members[0], accessSet]),
    youtube: YoutubeOperation,
} satisfies Record<DashboardConfigurationFamily, Schema.Top>
export type DashboardConfigurationOperationMap = { [K in DashboardConfigurationFamily]: (typeof DashboardConfigurationOperationMap)[K]["Type"] }
type PerFamily<F extends Schema.Struct.Fields> = { [K in DashboardConfigurationFamily]: Schema.Struct.Type<F> & { readonly family: K, readonly operation: DashboardConfigurationOperationMap[K] } }[DashboardConfigurationFamily]
/** One member per family, each with these fields beside its family and operation */
const perFamily = <F extends Schema.Struct.Fields>(fields: F) => Schema.Union(DashboardConfigurationFamily.literals.map(family =>
    Schema.Struct({ ...fields, family: Schema.Literal(family), operation: DashboardConfigurationOperationMap[family] }))) as unknown as Schema.Codec<PerFamily<F>>
export const DashboardConfigurationOperation = perFamily({})
export type DashboardConfigurationOperation = typeof DashboardConfigurationOperation.Type
const jobFields = { id: Token, actorId: Id, expectedConfigRevision: Int(), state: Schema.Literals(["queued", "applied", "failed", "conflict"]), createdAt: Millis, expiresAt: Millis, error: optional(Str(512)) }
export const DashboardConfigurationJob = perFamily(jobFields)
export type DashboardConfigurationJob = typeof DashboardConfigurationJob.Type
/** What the bot reads natively before it carries out a job. requiresOwnerAdmin asks for the server owner or an Administrator */
export const DashboardConfigurationNativeTarget = Schema.Struct({ ownerId: optional(Id), channelId: optional(Id), channelIds: optional(Ids(100).check(Schema.isUnique())), parentId: optional(Schema.NullOr(Id)),
    roleIds: optional(Ids(1000).check(Schema.isUnique())), hasEmbed: optional(Schema.Boolean), requiresOwnerAdmin: optional(Schema.Boolean) })
export type DashboardConfigurationNativeTarget = typeof DashboardConfigurationNativeTarget.Type
export const DashboardConfigurationReadyJob = perFamily({ ...jobFields, native: DashboardConfigurationNativeTarget })
export type DashboardConfigurationReadyJob = typeof DashboardConfigurationReadyJob.Type
export const DashboardConfigurationReference = Schema.Struct({ id: Id, type: Schema.Literals(["channel", "role"]), serverId: Id, exists: Schema.Boolean })
export type DashboardConfigurationReference = typeof DashboardConfigurationReference.Type
const proofs = [EventsContext, SchedulesContext, CleanupContext, TicketContext] as const
const executeFields = { ...origin, serverId: Id, jobId: Token, actorId: Id, managerAuthorized: Schema.Boolean, observedAt: Millis, actor: ModerationActor, context: optional(Schema.Union(proofs)),
    recipientOwner: optional(Schema.Union([EventsContext, SchedulesContext, CleanupContext])), roles: optional(List(RolesRoleSnapshot, 1000)),
    /** Role picker saves only. The server's current role names, stored with the menus as a display fallback */
    display: RolePickerManageRequest.fields.display,
    calendar: optional(Schema.Union([EventsCalendar, SchedulesCalendar])), references: optional(List(DashboardConfigurationReference, 1100)) }
export const DashboardConfigurationExecuteRequest = Schema.Struct(executeFields)
export type DashboardConfigurationExecuteRequest = typeof DashboardConfigurationExecuteRequest.Type
/** What the bot sends. An add request of a voice generator or dashboard link carries the channel the bot created, and an invite job the invites the bot read afterwards */
export const DashboardConfigurationExecuteInput = Schema.Struct({ ...executeFields, context: optional(Schema.Union([...proofs, VoiceDashboardContext, SidebarDashboardContext, AlertsDashboardContext])) })
export type DashboardConfigurationExecuteInput = typeof DashboardConfigurationExecuteInput.Type
export const DashboardConfigurationExecuteResult = Schema.Struct({ job: DashboardConfigurationJob, grant: optional(EventsDeliveryGrant) })
export type DashboardConfigurationExecuteResult = typeof DashboardConfigurationExecuteResult.Type
export const DashboardConfigurationReadyResult = Schema.Struct({ jobs: readyJobs(DashboardConfigurationReadyJob) })
export type DashboardConfigurationReadyResult = typeof DashboardConfigurationReadyResult.Type
/** reason names the fix when the bot knows it, such as a forum without room for the suggestion status tags */
export const DashboardConfigurationFailRequest = Schema.Struct({ serverId: Id, jobId: Token, reason: optional(Text(500)) })
export type DashboardConfigurationFailRequest = typeof DashboardConfigurationFailRequest.Type

/** The bot asks for the waiting jobs of each kind, at most four at a time */
export const DashboardReadyRequest = Schema.Struct({ serverId: Id })
export type DashboardReadyRequest = typeof DashboardReadyRequest.Type
/** One job of a message, role or logging request, which the bot completes or gives up on */
export const DashboardJobRequest = Schema.Struct({ serverId: Id, jobId: Token })
export type DashboardJobRequest = typeof DashboardJobRequest.Type
/** The bot's fresh check that the manager may still publish, sent with the reservation and the dispatch of a dashboard post */
export const DashboardPublishingReserveRequest = Schema.Struct({ serverId: Id, ...DashboardPublishingContext.fields })
export type DashboardPublishingReserveRequest = typeof DashboardPublishingReserveRequest.Type
/** A job reserves its post once. Later requests get no grant and the attempt it reserved, which the bot never sends again */
export const DashboardPublishingReserveResult = Schema.Struct({ grant: Schema.NullOr(PublishingGrant), attempt: Schema.NullOr(PublishingAttempt) })
export type DashboardPublishingReserveResult = typeof DashboardPublishingReserveResult.Type

export const DashboardMessageJob = Schema.Struct({ id: Token, actorId: Id, channelId: Id, content: PublishingContent, state: Schema.Literals(["queued", "reserved", "sent", "failed", "uncertain"]),
    createdAt: Millis, expiresAt: Millis, error: optional(Str(512)), messageId: optional(Id) })
export type DashboardMessageJob = typeof DashboardMessageJob.Type
export const DashboardMessageReadyResult = Schema.Struct({ jobs: readyJobs(DashboardMessageJob) })
export type DashboardMessageReadyResult = typeof DashboardMessageReadyResult.Type
export const DashboardMessageCompleteResult = Schema.Struct({ job: DashboardMessageJob })
export type DashboardMessageCompleteResult = typeof DashboardMessageCompleteResult.Type

const [roleSettings, panelCreate, panelUpdate] = RolesManageOperation.members
const roleSection = Schema.Literals(["reaction", "autorole", "verification"]), publication = Schema.Struct({ channelId: Id, content: PublishingContent })
/** A settings patch changes only the settings of its section. A new panel has all its mappings, and a panel update changes at least one setting */
export const DashboardRoleOperation = Schema.Union([
    Schema.Struct({ type: roleSettings.fields.type, patch: roleSettings.fields.patch }),
    Schema.Struct({ type: panelCreate.fields.type, name: panelCreate.fields.name, kind: panelCreate.fields.kind, mappings: RolesMappingsInput, exclusive: Schema.Boolean }),
    Schema.Struct({ type: panelUpdate.fields.type, name: panelUpdate.fields.name, expectedRevision: panelUpdate.fields.expectedRevision,
        patch: panelUpdate.fields.patch.check(Schema.makeFilter(patch => Object.keys(patch).length > 0)) }),
])
export type DashboardRoleOperation = typeof DashboardRoleOperation.Type
export const DashboardRoleJob = Schema.Struct({ id: Token, actorId: Id, section: roleSection, expectedRevision: Int(), operation: DashboardRoleOperation,
    state: Schema.Literals(["queued", "configured", "applied", "failed", "conflict"]), createdAt: Millis, expiresAt: Millis, error: optional(Str(512)), publication: optional(publication) })
export type DashboardRoleJob = typeof DashboardRoleJob.Type
export const DashboardRoleRequest = Schema.Struct({ sessionToken: Schema.String, serverId: Id, section: roleSection, requestId: optional(Schema.String), expectedRevision: Int(),
    operation: DashboardRoleOperation, publication: optional(publication) })
export type DashboardRoleRequest = typeof DashboardRoleRequest.Type
export const DashboardRoleReadyResult = Schema.Struct({ jobs: readyJobs(DashboardRoleJob) })
export type DashboardRoleReadyResult = typeof DashboardRoleReadyResult.Type
export const DashboardRoleExecuteRequest = Schema.Struct({ ...origin, serverId: Id, jobId: Token, actorId: Id, managerAuthorized: Schema.Boolean, observedAt: Millis, roles: List(RolesRoleSnapshot, 1000) })
export type DashboardRoleExecuteRequest = typeof DashboardRoleExecuteRequest.Type
export const DashboardRoleExecuteResult = Schema.Struct({ job: DashboardRoleJob, result: Schema.NullOr(RolesManageResult) })
export type DashboardRoleExecuteResult = typeof DashboardRoleExecuteResult.Type
/** result binds a delivered panel. It is absent while the post is pending and after it failed */
export const DashboardRoleCompleteResult = Schema.Struct({ job: DashboardRoleJob, result: optional(RolesManageResult) })
export type DashboardRoleCompleteResult = typeof DashboardRoleCompleteResult.Type

export const DashboardMetadataOperation = MetadataConfigurationOperation
export type DashboardMetadataOperation = typeof DashboardMetadataOperation.Type
export const DashboardMetadataJob = Schema.Struct({ id: Token, actorId: Id, expectedConfigRevision: Int(), operation: DashboardMetadataOperation, state: Schema.Literals(["queued", "applied", "failed", "conflict"]),
    createdAt: Millis, expiresAt: Millis, error: optional(Str(512)) })
export type DashboardMetadataJob = typeof DashboardMetadataJob.Type
export const DashboardMetadataRequest = Schema.Struct({ sessionToken: Schema.String, serverId: Id, requestId: Schema.String, expectedConfigRevision: Int(), operation: DashboardMetadataOperation })
export type DashboardMetadataRequest = typeof DashboardMetadataRequest.Type
export const DashboardMetadataReadyResult = Schema.Struct({ jobs: readyJobs(DashboardMetadataJob) })
export type DashboardMetadataReadyResult = typeof DashboardMetadataReadyResult.Type
/** A route needs the owner's fresh read of the destination, and so does an event route that turns on */
export const DashboardMetadataExecuteRequest = Schema.Struct({ ...origin, serverId: Id, jobId: Token, actorId: Id, managerAuthorized: Schema.Boolean, observedAt: Millis, recipientOwner: optional(MetadataLogsContext) })
export type DashboardMetadataExecuteRequest = typeof DashboardMetadataExecuteRequest.Type
/** settings holds the logging settings after this request applied the job, and is null otherwise */
export const DashboardMetadataExecuteResult = Schema.Struct({ job: DashboardMetadataJob, settings: Schema.NullOr(MetadataLogsSettings) })
export type DashboardMetadataExecuteResult = typeof DashboardMetadataExecuteResult.Type
