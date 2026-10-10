export interface DashboardSession {
    sessionToken: string
    user: { id: string, name: string }
    /** Single-server deployments open straight on their one server, multi-server deployments start on a server picker */
    mode: "single" | "multi"
    /** Icon is a Fluxer CDN image URL, or null when the server has no icon */
    servers: Array<{ id: string, name: string, icon: string | null }>
    /** Servers where the user is a member without managing them, NeonFlux is installed and the server offers a member feature */
    memberServers?: Array<{ id: string, name: string, icon: string | null, features: DashboardMemberFeature[] }>
    expiresAt: number
}
/** Member features a server offers on the website: the role picker, showcases and profiles while they are on, and private cases once the server names a private data role */
export type DashboardMemberFeature = "rolepicker" | "showcase" | "profile" | "private"
/**
 * The viewer's latest access check for private cases. The bot answers it with its own Fluxer read: the viewer passes as the server owner
 * or while holding the private data role. A passed check serves views until validUntil. queued waits for the bot, and failed means the bot
 * did not answer in time or could not read Fluxer. roleConfigured is false while the server names no private data role, so only the owner passes
 */
export interface DashboardPrivateAccess {
    serverId: string
    roleConfigured: boolean
    check: { state: "queued" | "passed" | "refused" | "failed", requestedAt: number, checkedAt?: number, validUntil?: number } | null
}
/** One view of private data. Every view that returns data is recorded in the audit log */
export type DashboardPrivateView =
    | { type: "cases", beforeCaseNo?: number }
    | { type: "case", caseNo: number }
    | { type: "appeals", beforeAppealNo?: number }
    | { type: "history", userId: string, beforeCaseNo?: number }
/** Lists are newest first in pages of 25, and a next number continues with older entries. An erased case or appeal keeps only its erasure marker */
export type DashboardPrivateData =
    | { type: "cases", cases: C.ModerationCase[], nextBeforeCaseNo?: number }
    | { type: "case", case: C.ModerationCase, appeals: C.Appeal[] }
    | { type: "appeals", appeals: C.Appeal[], nextBeforeAppealNo?: number }
    | { type: "history", userId: string, cases: C.ModerationCase[], nextBeforeCaseNo?: number, appeals: C.Appeal[] }
/** checking waits for a live check, which DashboardPrivateAccess reports. refused and failed repeat the latest check's answer */
export type DashboardPrivateResult = { status: "checking" | "refused" | "failed" } | { status: "ok", data: DashboardPrivateData }
/** The start of a server export, which needs the same live check as private cases and passes the server owner only. refused also answers a passed check of someone else */
export type DashboardExportStart = { status: "checking" | "refused" | "failed" | "ok" }
/** expired means the owner's passed check ended, so the export continues after a new start */
export type DashboardExportPage = { status: "expired" } | { status: "ok", page: C.ServerExportPage }
/** Dashboard views. Each section subscribes to the one view it shows */
export interface DashboardGeneralView { serverId: string, prefix: string, revision: number }
/** The prefix is shown in the autorole chat command help */
export interface DashboardRolesView {
    serverId: string
    general: { prefix: string }
    roles: { revision: number, settings: RolesSettings, panels: RolesPanel[], jobs: DashboardRoleJob[] }
}
export interface DashboardMessagesView { serverId: string, jobs: DashboardMessageJob[] }
/** Saved templates first, then drafts, each up to the requested limit. more reports that either kind has more */
export interface DashboardTemplatesView { serverId: string, templates: Array<{ kind: "draft" | "template", name: string, revision: number }>, more: boolean }
export type DashboardOverviewSection = "custom" | "auto" | "moderation" | "cleanup" | "logs" | "reaction" | "autorole" | "verification" | "rolepicker" | "temproles" | "onboarding" | "publishing" | "greetings" | "schedules" | "tickets" | "leveling" | "milestones" | "suggestions" | "events" | "voice" | "analytics" | "sticky" | "sidebar" | "alerts" | "helpdesk" | "lfg" | "showcase" | "profile"
/** On is enabled and able to act, setup is enabled but missing what it needs, such as a channel or a first definition, and off is disabled */
export type DashboardOverviewState = "on" | "setup" | "off"
export interface DashboardOverview { serverId: string, sections: Array<{ id: DashboardOverviewSection, state: DashboardOverviewState }> }
/**
 * One problem the bot found with its own access. permissions are keys of the SDK's Permissions, such as KickMembers, that the bot
 * lacks server-wide for an enabled feature. roles are roles an enabled feature assigns that rank at or above the bot's highest role.
 * general covers what every feature needs, such as sending replies.
 * The safety audit adds roles that give dangerous permissions to many members, with members absent for the everyone role,
 * staff roles that lack the permissions their staff class's commands check, and role features that are on while Fluxer's
 * verification level is set, which Fluxer skips for any member with a role
 */
export type SetupProblem =
    | { kind: "permissions", feature: DashboardOverviewSection | "general", permissions: string[] }
    | { kind: "hierarchy", feature: DashboardOverviewSection, roles: Array<{ id: string, name: string }> }
    | { kind: "gateway", state: string }
    | { kind: "dangerous-role", role: { id: string, name: string }, permissions: string[], members?: number }
    | { kind: "staff-permissions", staffClass: C.StaffClass, role: { id: string, name: string }, permissions: string[] }
    | { kind: "verification-bypass", features: DashboardOverviewSection[] }
/** What the bot reads for !setup, !health and the dashboard check: each section's state, the roles each feature assigns and the moderation staff roles */
/** threadFeatures lists the features that start discussion threads, which need Create Public Threads */
export interface SetupStatus { sections: DashboardOverview["sections"], managedRoles: Array<{ feature: DashboardOverviewSection, roleIds: string[] }>, staffRoleIds: Record<C.StaffClass, string[]>, threadFeatures: DashboardOverviewSection[] }
/** The latest permission check the bot ran for the dashboard. queued waits for the bot, failed means it did not answer in time */
export interface DashboardSetupCheck { serverId: string, state: "queued" | "done" | "failed", requestedAt: number, checkedAt?: number, problems: SetupProblem[] }
export type RecoverySource = "publishing" | "schedules" | "events" | "suggestions" | "roles" | "temproles" | "tickets" | "cleanup" | "greetings" | "milestones" | "logs" | "helpdesk" | "defcon"
/**
 * One entry of the recovery inbox. A work entry says what happened, when, and the command or step that resolves it, and one without at
 * describes the current state. A setup entry is a problem the latest permission check found, and a feature entry a feature that is on but
 * cannot act yet
 */
export type RecoveryEntry =
    | { kind: "work", source: RecoverySource, at?: number, summary: string, next: string }
    | { kind: "setup", at: number, problem: SetupProblem }
    | { kind: "feature", feature: DashboardOverviewSection }
/** The recovery inbox, current state first and then newest first. truncated is true when it held more entries than it shows */
export interface RecoveryInbox { serverId: string, entries: RecoveryEntry[], truncated: boolean }
/** The latest restore preview, for the owner who made it. queued waits for the bot to read the archive and the server again, and failed names why it could not */
export interface DashboardBackupPreview { serverId: string, state: "queued" | "done" | "failed", requestedAt: number, failure?: C.BackupPreviewFailure, preview: C.BackupPreview | null }
/** A setting change, a member's deletion of their own data, a view of private data such as a moderation case, or the owner's export of the server's data */
export type DashboardAuditKind = "setting" | "member-data-deleted" | "private-data-viewed" | "server-exported"
/** Features the audit log names. Configuration families keep their own names */
export type DashboardAuditFeature = DashboardConfigurationFamily | "prefix" | "analytics" | "logs" | "roles" | "member-data" | "private-data" | "export"
/** actorName is present when the change came from the website, which knows the signed-in name */
export interface DashboardAuditEntry {
    id: string
    kind: DashboardAuditKind
    source: "website" | "command"
    actorId: string
    actorName?: string
    feature: DashboardAuditFeature
    setting: string
    summary: string
    createdAt: number
}
/** Newest first. nextCursor reads the next older page, or is null on the last page */
export interface DashboardAuditPage { serverId: string, entries: DashboardAuditEntry[], nextCursor: string | null }
export interface DashboardSave {
    sessionToken: string
    serverId: string
    section: "general"
    expectedRevision: number
    prefix: string
}
export type DashboardSaveResult = { saved: true, revision: number } | { saved: false, conflict: true, revision: number }
export type DashboardRoleOperation =
    | { type: "settings", patch: Partial<Pick<RolesSettings, "panelsEnabled" | "verificationEnabled" | "advancedVerificationEnabled" | "autoroleEnabled" | "humansOnly" | "autoroleIds" | "reservations">> }
    | { type: "panel-create", name: string, kind: "reaction" | "verification", mappings: RolesMapping[], exclusive: boolean }
    | { type: "panel-update", name: string, expectedRevision: number, patch: { enabled?: boolean, exclusive?: boolean, mappings?: RolesMapping[] } }
export interface DashboardRoleJob {
    id: string
    actorId: string
    section: "reaction" | "autorole" | "verification"
    expectedRevision: number
    operation: DashboardRoleOperation
    state: "queued" | "configured" | "applied" | "failed" | "conflict"
    createdAt: number
    expiresAt: number
    error?: string
    publication?: { channelId: string, content: PublishingContent }
}
export interface DashboardRoleRequest {
    sessionToken: string
    serverId: string
    section: "reaction" | "autorole" | "verification"
    requestId?: string
    expectedRevision: number
    operation: DashboardRoleOperation
    publication?: { channelId: string, content: PublishingContent }
}
export interface DashboardCatalog {
    serverId: string
    ownerId?: string
    channels: Array<{ id: string, name: string, type: number, parentId?: string }>
    /** hoist shows the role's members as their own member-list group, ordered by hoistPosition, or by position while it is null */
    roles: Array<{ id: string, name: string, position: number, hoist?: boolean, hoistPosition?: number | null }>
}
export interface DashboardMessageJob {
    id: string
    actorId: string
    channelId: string
    content: PublishingContent
    state: "queued" | "reserved" | "sent" | "failed" | "uncertain"
    createdAt: number
    expiresAt: number
    error?: string
    messageId?: string
}
export type DashboardMetadataOperation =
    | { type: "module", expectedRevision: number, enabled: boolean }
    | { type: "channels", expectedRevision: number, messageChannelIds: string[], excludedChannelIds: string[] }
    | { type: "route", category: MetadataLogsCategory, expectedRevision: number, enabled: boolean, channelId: string, ownerId: string }
    | { type: "clear", category: MetadataLogsCategory, expectedRevision: number }
    | { type: "event-route", eventType: MetadataLogsEventSelector, expectedRevision: number, enabled: boolean, channelId?: string, ownerId?: string }
    | { type: "event-clear", eventType: MetadataLogsEventSelector, expectedRevision: number }
export interface DashboardMetadataJob {
    id: string
    actorId: string
    expectedConfigRevision: number
    operation: DashboardMetadataOperation
    state: "queued" | "applied" | "failed" | "conflict"
    createdAt: number
    expiresAt: number
    error?: string
}
export interface DashboardMetadataSnapshot { serverId: string, settings: MetadataLogsSettings, jobs: DashboardMetadataJob[] }
export interface DashboardMetadataRequest {
    sessionToken: string
    serverId: string
    requestId: string
    expectedConfigRevision: number
    operation: DashboardMetadataOperation
}
export interface DashboardMetadataQueueResult { queued: boolean, conflict: boolean, revision: number, jobId?: string }
export interface DashboardMetadataExecuteRequest extends ServerOrigin {
    serverId: string
    jobId: string
    actorId: string
    managerAuthorized: boolean
    observedAt: number
    recipientOwner?: MetadataLogsContext
}
import type { RolesSettings, RolesPanel, RolesMapping, PublishingContent, MetadataLogsCategory, MetadataLogsEventSelector, MetadataLogsSettings, MetadataLogsContext, ServerOrigin } from "./contracts.js"
import type * as C from "./contracts.js"

export type DashboardConfigurationFamily = "responses" | "moderation" | "publishing" | "greetings" | "tickets" | "leveling" | "milestones" | "suggestions" | "cleanup" | "events" | "schedules" | "nickname" | "voice" | "rolepicker" | "temproles" | "sticky" | "sidebar" | "memberlist" | "alerts" | "helpdesk" | "onboarding" | "presets" | "lfg" | "showcase" | "profile"
type WithoutNative<T> = T extends unknown ? Omit<T, "roles" | "recipientOwner"> : never
export type DashboardEventCalendar = Omit<C.EventsCalendar, "dates">
export type DashboardScheduleCalendar = Omit<C.SchedulesCalendar, "dates">
export type DashboardResponseDefinition = Omit<C.ResponseDefinition, "kind" | "createdAt" | "updatedAt">
export type DashboardResponseSave = { type: "definition-create" | "definition-update", definition: DashboardResponseDefinition }
export interface DashboardConfigurationOperationMap {
    responses: { kind: "custom", operation: Exclude<C.ResponseCustomOperation, { type: "list" | "show" }> | DashboardResponseSave } | { kind: "auto", operation: Exclude<C.ResponseAutoOperation, { type: "list" | "show" }> | DashboardResponseSave }
    moderation: Extract<C.ModerationManageOperation, { type: "settings" | "rule-create" | "rule-update" | "rule-delete" | "watchlist-add" | "watchlist-remove" | "private-role" }>
    publishing: Extract<C.PublishingManageOperation, { type: "settings" | "draft-clone" | "draft-delete" | "draft-update" }> | { type: "draft-create", kind: C.PublishingKind, name: string, content?: C.PublishingContent } | { type: "draft-set", kind: C.PublishingKind, name: string, expectedRevision: number, content: C.PublishingContent }
    greetings: C.GreetingsManageRequest["operation"]
    tickets: WithoutNative<Extract<C.TicketManageOperation, { type: "settings" | "category-create" | "category-update" | "category-delete" | "canned-set" | "canned-remove" }>>
    leveling: WithoutNative<Extract<C.LevelingManageOperation, { type: "settings" | "mappings" }>>
    milestones: WithoutNative<Exclude<C.MilestonesManageOperation, { type: "reconcile" | "forget" }>>
    suggestions: Extract<C.SuggestionsManageOperation, { type: "settings" }> | (Extract<C.SuggestionsManageOperation, { type: "configure" }> & { ownerId: string })
    cleanup: WithoutNative<Exclude<C.CleanupManageOperation, { type: "reconcile" | "configure" | "forget" }>> | (Extract<C.CleanupManageOperation, { type: "configure" }> & { ownerId: string }) | { type: "policy-delete", channelId: string, expectedRevision: number, confirm: true }
    events: Exclude<C.EventsManageOperation, { type: "create" | "calendar" | "publish" | "cancel" | "reconcile" }> | (Extract<C.EventsManageOperation, { type: "create" }> & { ownerId: string }) | { type: "calendar", eventNo: number, expectedRevision: number, calendar: DashboardEventCalendar } | { type: "destination", eventNo: number, expectedRevision: number, channelId: string } | { type: "publish" | "cancel", eventNo: number, expectedRevision: number }
    schedules: WithoutNative<Exclude<C.SchedulesManageOperation, { type: "create" | "calendar" | "reconcile" }>> | (Omit<Extract<C.SchedulesManageOperation, { type: "create" }>, "calendar"> & { calendar: DashboardScheduleCalendar }) | { type: "calendar", scheduleNo: number, expectedRevision: number, calendar: DashboardScheduleCalendar }
    /** Reset clears the nickname, so Fluxer shows the bot's username */
    nickname: { type: "set", nickname: string } | { type: "reset" }
    /** The bot creates the generator channel for an add request, so it carries no channel ID */
    voice: Omit<Extract<C.VoiceManageOperation, { type: "generator-add" }>, "channelId"> | Required<Extract<C.VoiceManageOperation, { type: "generator-set" | "generator-remove" }>>
    /** Menu set creates or replaces one whole menu, and access set replaces all four lists */
    rolepicker: Extract<C.RolePickerOperation, { type: "module" | "menu-set" | "menu-remove" | "access-set" }>
    sticky: C.StickyOperation
    /** The bot creates the link channel for an add request, in the chosen category or at the top level */
    sidebar: { type: "add", name: string, categoryId: string | null } | Extract<C.SidebarOperation, { type: "set" | "remove" }>
    memberlist: C.MemberListOperation
    /** Sets both durations of one role. Two nulls remove the role's defaults */
    temproles: { type: "role", roleId: string, defaultSeconds: number | null, maxSeconds: number | null }
    /** The bot reads the server's invites for a refresh, and revokes the one ref names before it reads them again */
    alerts: C.AlertsOperation | { type: "invites-refresh" } | { type: "invite-revoke", ref: string }
    helpdesk: C.HelpDeskOperation
    /** The website replaces the whole step list */
    onboarding: Extract<C.OnboardingOperation, { type: "module" | "delivery" | "steps" | "role" }>
    /** token is the one of the preview the manager confirmed */
    presets: { type: "apply", name: C.PresetName, token: string }
    lfg: Extract<C.LfgOperation, { type: "settings" }>
    /** The website changes settings and replaces the access lists */
    showcase: Extract<C.ShowcaseOperation, { type: "settings" | "access-set" }>
    profile: Extract<C.ProfileOperation, { type: "settings" | "access-set" }>
}
export type DashboardConfigurationOperation = { [K in DashboardConfigurationFamily]: { family: K, operation: DashboardConfigurationOperationMap[K] } }[DashboardConfigurationFamily]
export interface DashboardConfigurationDataMap {
    responses: { settings: { customEnabled: boolean, autoEnabled: boolean }, definitions: C.ResponseDefinition[] }
    /** privateDataRoleId is the role whose members may view private cases on the website, or null when only the owner may */
    moderation: { settings: C.ModerationSettings, privateDataRoleId: string | null, rules: C.AutomodRule[], watchlist: C.WatchlistEntry[] }
    publishing: { settings: C.PublishingSettings, drafts: C.PublishingDraft[] }
    greetings: { settings: C.GreetingsSettings }
    tickets: { settings: C.TicketSettings, categories: C.TicketCategory[] }
    leveling: { settings: C.LevelingSettings }
    milestones: { settings: C.MilestonesSettings, routes: C.MilestonesRoute[] }
    suggestions: { settings: C.SuggestionsSettings }
    cleanup: { settings: C.CleanupSettings, policies: C.CleanupPolicy[] }
    events: { settings: C.EventsSettings, events: C.EventsDefinition[] }
    schedules: { settings: C.SchedulesSettings, schedules: C.SchedulesDefinition[] }
    nickname: { settings: C.GeneralNickname }
    voice: { generators: C.VoiceGenerator[], rooms: number }
    rolepicker: { settings: C.RolePickerSettings, access: C.MemberAccessLists }
    sticky: { stickies: C.StickyMessage[] }
    sidebar: { link: C.SidebarLink | null }
    /** The current order comes from the server's role list in the catalog */
    memberlist: Record<string, never>
    /** The 100 active grants that end first. more reports that the server has others */
    temproles: { settings: C.TemporaryRoleSettings, grants: C.TemporaryRoleGrant[], more: boolean }
    /** invites is null until a manager first refreshes the list */
    alerts: { settings: C.AlertSettings, invites: C.AlertInviteList | null }
    helpdesk: { settings: C.HelpDeskSettings, answers: C.HelpDeskAnswer[] }
    /** completions counts members who finished the checklist in the last seven UTC days, including today, while analytics counts */
    onboarding: { settings: C.OnboardingSettings, completions: number }
    /** Every preset with the changes it would make now */
    presets: { presets: C.PresetPlan[] }
    /** generators lists the voice generator channels a manager can choose, and open counts the server's open groups */
    lfg: { settings: C.LfgSettings, generators: string[], open: number }
    showcase: { settings: C.ShowcaseSettings, access: C.MemberAccessLists }
    profile: { settings: C.ProfileSettings, access: C.MemberAccessLists }
}
export type DashboardConfigurationCollection = "definitions" | "rules" | "watchlist" | "drafts" | "categories" | "routes" | "policies" | "events" | "schedules"
export type DashboardConfigurationCursors = Partial<Record<DashboardConfigurationCollection, string>>
export type DashboardConfigurationJob = DashboardConfigurationOperation & { id: string, actorId: string, expectedConfigRevision: number, state: "queued" | "applied" | "failed" | "conflict", createdAt: number, expiresAt: number, error?: string }
export type DashboardConfigurationRequest = DashboardConfigurationOperation & { sessionToken: string, serverId: string, requestId: string, expectedConfigRevision: number }
export interface DashboardConfigurationQueueResult { queued: boolean, conflict: boolean, revision: number, jobId?: string }
export type DashboardConfigurationSnapshot = { [K in DashboardConfigurationFamily]: { family: K, serverId: string, configRevision: number, data: DashboardConfigurationDataMap[K], jobs: DashboardConfigurationJob[], nextCursors?: DashboardConfigurationCursors } }[DashboardConfigurationFamily]
export interface DashboardConfigurationNativeTarget { ownerId?: string, channelId?: string, channelIds?: string[], parentId?: string | null, roleIds?: string[], hasEmbed?: boolean, requiresOwnerAdmin?: boolean }
export type DashboardConfigurationReadyJob = DashboardConfigurationJob & { native: DashboardConfigurationNativeTarget }
export interface DashboardConfigurationReference { id: string, type: "channel" | "role", serverId: string, exists: boolean }
export interface DashboardConfigurationExecuteRequest extends ServerOrigin {
    serverId: string
    jobId: string
    actorId: string
    managerAuthorized: boolean
    observedAt: number
    actor: C.ModerationActor
    context?: C.EventsContext | C.SchedulesContext | C.MilestonesContext | C.SuggestionsContext | C.CleanupContext | C.TicketContext
    recipientOwner?: C.EventsContext | C.SchedulesContext | C.MilestonesContext | C.SuggestionsContext | C.CleanupContext
    roles?: C.RolesRoleSnapshot[]
    /** Role picker saves only. The server's current role names, stored with the menus as a display fallback */
    display?: C.RolePickerRoleDisplay[]
    calendar?: C.EventsCalendar | C.SchedulesCalendar
    references?: DashboardConfigurationReference[]
}
export interface DashboardConfigurationExecuteResult { job: DashboardConfigurationJob, grant?: C.EventsDeliveryGrant }

export interface DashboardAnalyticsSnapshot {
    serverId: string
    enabled: boolean
    revision: number
    /** Thirty UTC days ending today, oldest first, with zero-filled gaps */
    members: Array<{ day: number, joins: number, leaves: number, onboarded: number }>
    /** Fourteen UTC days ending today, oldest first, with zero-filled gaps */
    messages: Array<{ day: number, count: number }>
    /** Top channels by messages over the requested range of 7 or 30 days, at most ten */
    range: 7 | 30
    topChannels: Array<{ channelId: string, count: number }>
    /** The channel that hours describe, or null for every channel */
    channelId: string | null
    /** Messages per UTC hour for each day of the range, oldest first, with zero-filled gaps. Counts holds 24 values, from 00:00 to 23:00 */
    hours: Array<{ day: number, counts: number[] }>
}
export interface DashboardAnalyticsSave { sessionToken: string, serverId: string, expectedRevision: number, enabled: boolean }

/** The member view of the role picker. The snapshot is the member's last lookup and expires after ten minutes.
 *  Its roles are the names and colors of menu roles that the bot read with it, which take precedence over the names stored with the menus */
export interface DashboardRolePickerMember {
    serverId: string
    menus: C.RolePickerMenu[]
    snapshot: { roleIds: string[], roles: C.RolePickerRoleDisplay[], allowed: boolean, observedAt: number, expiresAt: number } | null
    /** The member's own recent requests, newest first */
    requests: C.RolePickerJob[]
}
export interface DashboardRolePickerRequest { sessionToken: string, serverId: string, requestId: string, operation: C.RolePickerMemberOperation }
export interface DashboardRolePickerQueueResult { jobId: string }
/** The member view of showcases: The server's showcase settings, the member's own showcases and their recent requests, each newest first */
export interface DashboardShowcaseMember { serverId: string, settings: C.ShowcaseSettings, showcases: C.Showcase[], requests: C.ShowcaseJob[] }
export interface DashboardShowcaseRequest { sessionToken: string, serverId: string, requestId: string, operation: C.ShowcaseMemberOperation }
/** The member view of profiles: The member's own profile and recent requests, newest first */
export interface DashboardProfileMember { serverId: string, profile: C.Profile | null, requests: C.ProfileJob[] }
export interface DashboardProfileRequest { sessionToken: string, serverId: string, requestId: string, operation: C.ProfileMemberOperation }
export interface DashboardMemberQueueResult { jobId: string }
