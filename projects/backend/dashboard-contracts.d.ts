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
    | { type: "cases", cases: ModerationCase[], nextBeforeCaseNo?: number }
    | { type: "case", case: ModerationCase, appeals: Appeal[] }
    | { type: "appeals", appeals: Appeal[], nextBeforeAppealNo?: number }
    | { type: "history", userId: string, cases: ModerationCase[], nextBeforeCaseNo?: number, appeals: Appeal[] }
/** checking waits for a live check, which DashboardPrivateAccess reports. refused and failed repeat the latest check's answer */
export type DashboardPrivateResult = { status: "checking" | "refused" | "failed" } | { status: "ok", data: DashboardPrivateData }
/** The start of a server export, which needs the same live check as private cases and passes the server owner only. refused also answers a passed check of someone else */
export type DashboardExportStart = { status: "checking" | "refused" | "failed" | "ok" }
/** expired means the owner's passed check ended, so the export continues after a new start */
export type DashboardExportPage = { status: "expired" } | { status: "ok", page: ServerExportPage }
/** Dashboard views. Each section subscribes to the one view it shows */
export interface DashboardGeneralView { serverId: string, prefix: string, replyStyle: "embed" | "text", revision: number }
/** The prefix is shown in the autorole chat command help */
export interface DashboardRolesView {
    serverId: string
    general: { prefix: string }
    roles: { revision: number, settings: RolesSettings, panels: RolesPanel[], jobs: DashboardRoleJob[] }
}
export interface DashboardMessagesView { serverId: string, jobs: DashboardMessageJob[] }
/** Saved templates first, then drafts, each up to the requested limit. more reports that either kind has more */
export interface DashboardTemplatesView { serverId: string, templates: Array<{ kind: "draft" | "template", name: string, revision: number }>, more: boolean }
export interface DashboardOverview { serverId: string, sections: Array<{ id: DashboardOverviewSection, state: DashboardOverviewState }> }
/** The latest permission check the bot ran for the dashboard. queued waits for the bot, failed means it did not answer in time */
export interface DashboardSetupCheck { serverId: string, state: "queued" | "done" | "failed", requestedAt: number, checkedAt?: number, problems: SetupProblem[] }
/** The latest restore preview, for the owner who made it. queued waits for the bot to read the archive and the server again, and failed names why it could not */
export interface DashboardBackupPreview { serverId: string, state: "queued" | "done" | "failed", requestedAt: number, failure?: BackupPreviewFailure, preview: BackupPreview | null }
/** A place in the structure: the category, or null for the top level, and the sibling right before, or null for first */
export interface StructurePlace { parentId: string | null, parentName: string | null, afterId: string | null, afterName: string | null }
/** One change a draft makes to the structure it started from. Names come from that structure and the draft, so a change describes itself */
export type StructureChange =
    | { type: "rename", channelId: string, from: string, to: string }
    | { type: "move", channelId: string, name: string, from: StructurePlace, to: StructurePlace }
/**
 * What saving a change would do against the current structure. apply changes the server, skip finds it already done, conflict means the
 * channel changed elsewhere since the draft started, blocked means the channel or the category it moves into is gone, and refused means
 * the manager lacks Manage Channels in the channel
 */
export type StructureDisposition = "apply" | "skip" | "conflict" | "blocked" | "refused"
export interface StructureItem { itemNo: number, change: StructureChange, disposition: StructureDisposition, reason: string | null }
/** A change after a save. failed changed nothing, and uncertain may have changed the server, which NeonFlux never repeats on its own */
export type StructureOutcome = "applied" | "skipped" | "conflict" | "blocked" | "refused" | "failed" | "uncertain"
export interface StructureResult { itemNo: number, change: StructureChange, outcome: StructureOutcome, reason: string | null }
/** unanswered: The bot did not answer in time. access: The manager is no longer a member. error: A Fluxer read failed. uncertain: A save started and was not confirmed */
export type StructureFailure = "unanswered" | "access" | "error" | "uncertain"
/**
 * One manager's structure editor: the latest read, closed threads loaded on demand and the latest save. state belongs to the latest
 * request: queued waits for the bot, applying means the bot is saving, and failed names why. changedAt is set when a channel was
 * created, changed, deleted or reordered after the read
 */
export interface DashboardStructure {
    serverId: string
    state: "queued" | "applying" | "done" | "failed"
    work: StructureWork["type"]
    requestedAt: number
    failure?: StructureFailure
    read: StructureRead | null
    changedAt?: number
    archived: Array<{ channelId: string, threads: StructureThread[], more: boolean }>
    save: { requestedAt: number, results: StructureResult[] } | null
}
/** A draft checked against the latest read, item by item, as a save would decide */
export interface DashboardStructurePreview { readAt: number, items: StructureItem[] }
/** A setting change, a member's deletion of their own data, a view of private data such as a moderation case, or the owner's export of the server's data */
export type DashboardAuditKind = "setting" | "member-data-deleted" | "private-data-viewed" | "server-exported"
/** Features the audit log names. Configuration families keep their own names */
export type DashboardAuditFeature = DashboardConfigurationFamily | "prefix" | "replies" | "analytics" | "logs" | "roles" | "member-data" | "private-data" | "export" | "structure"
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
    replyStyle?: "embed" | "text"
}
export type DashboardSaveResult = { saved: true, revision: number } | { saved: false, conflict: true, revision: number }
export interface DashboardCatalog {
    serverId: string
    ownerId?: string
    channels: Array<{ id: string, name: string, type: number, parentId?: string }>
    /** hoist shows the role's members as their own member-list group, ordered by hoistPosition, or by position while it is null */
    roles: Array<{ id: string, name: string, position: number, hoist?: boolean, hoistPosition?: number | null }>
}
export interface DashboardMetadataSnapshot { serverId: string, settings: MetadataLogsSettings, jobs: DashboardMetadataJob[] }
export interface DashboardMetadataQueueResult { queued: boolean, conflict: boolean, revision: number, jobId?: string }
import type { DashboardConfigurationFamily, DashboardConfigurationJob, DashboardConfigurationOperation, DashboardMessageJob, DashboardMetadataJob, DashboardRoleJob } from "@neonflux/contracts/dashboard"
export type { DashboardConfigurationFamily, DashboardEventCalendar, DashboardScheduleCalendar, DashboardResponseDefinition, DashboardResponseSave, DashboardConfigurationOperationMap, DashboardConfigurationOperation, DashboardConfigurationJob, DashboardConfigurationNativeTarget, DashboardConfigurationReadyJob, DashboardConfigurationReference, DashboardConfigurationExecuteRequest, DashboardConfigurationExecuteResult, DashboardMessageJob, DashboardRoleOperation, DashboardRoleJob, DashboardRoleRequest, DashboardMetadataOperation, DashboardMetadataJob, DashboardMetadataRequest, DashboardMetadataExecuteRequest } from "@neonflux/contracts/dashboard"
export type { StructureChannelType, StructureEntry, StructureChannel, StructureThread, StructureRead, StructureWork, StructureReadyJob, StructureApply, StructureClaim } from "@neonflux/contracts/structure"
import type { StructureThread, StructureRead, StructureWork } from "@neonflux/contracts/structure"
export type { DashboardOverviewSection, DashboardOverviewState, SetupProblem, SetupStatus, RecoverySource, RecoveryEntry, RecoveryInbox } from "@neonflux/contracts/setup"
import type { DashboardOverviewSection, DashboardOverviewState, SetupProblem } from "@neonflux/contracts/setup"
import type { AlertInviteList, AlertSettings } from "@neonflux/contracts/alerts"
import type { Appeal } from "@neonflux/contracts/appeal"
import type { BackupPreview, BackupPreviewFailure } from "@neonflux/contracts/backup"
import type { CleanupPolicy, CleanupSettings } from "@neonflux/contracts/cleanup"
import type { EventsDefinition, EventsSettings } from "@neonflux/contracts/events"
import type { GeneralNickname } from "@neonflux/contracts/general"
import type { GreetingsSettings } from "@neonflux/contracts/greetings"
import type { HelpDeskAnswer, HelpDeskSettings } from "@neonflux/contracts/helpdesk"
import type { LevelingSettings } from "@neonflux/contracts/leveling"
import type { LfgSettings } from "@neonflux/contracts/lfg"
import type { MetadataLogsSettings } from "@neonflux/contracts/metadata-logs"
import type { MilestonesRoute, MilestonesSettings } from "@neonflux/contracts/milestones"
import type { AutomodRule, ModerationCase, ModerationSettings, StaffClass, WatchlistEntry } from "@neonflux/contracts/moderation"
import type { OnboardingSettings } from "@neonflux/contracts/onboarding"
import type { PresetPlan } from "@neonflux/contracts/presets"
import type { Profile, ProfileJob, ProfileMemberOperation, ProfileSettings } from "@neonflux/contracts/profiles"
import type { PublishingDraft, PublishingSettings } from "@neonflux/contracts/publishing"
import type { ResponseDefinition } from "@neonflux/contracts/responses"
import type { RolePickerJob, RolePickerMemberOperation, RolePickerMenu, RolePickerRoleDisplay, RolePickerSettings } from "@neonflux/contracts/role-picker"
import type { RolesPanel, RolesSettings } from "@neonflux/contracts/roles"
import type { SchedulesDefinition, SchedulesSettings } from "@neonflux/contracts/schedules"
import type { ServerExportPage } from "@neonflux/contracts/server-export"
import type { MemberAccessLists } from "@neonflux/contracts/shared"
import type { Showcase, ShowcaseJob, ShowcaseMemberOperation, ShowcaseSettings } from "@neonflux/contracts/showcases"
import type { SidebarLink } from "@neonflux/contracts/sidebar"
import type { StickyMessage } from "@neonflux/contracts/sticky"
import type { SuggestionsSettings } from "@neonflux/contracts/suggestions"
import type { TemporaryRoleGrant, TemporaryRoleSettings } from "@neonflux/contracts/temporary-roles"
import type { TicketCategory, TicketSettings } from "@neonflux/contracts/tickets"
import type { VoiceGenerator } from "@neonflux/contracts/voice"
import type { YoutubeView } from "@neonflux/contracts/youtube"

export interface DashboardConfigurationDataMap {
    responses: { settings: { customEnabled: boolean, autoEnabled: boolean }, definitions: ResponseDefinition[] }
    /** privateDataRoleId is the role whose members may view private cases on the website, or null when only the owner may */
    moderation: { settings: ModerationSettings, privateDataRoleId: string | null, rules: AutomodRule[], watchlist: WatchlistEntry[] }
    publishing: { settings: PublishingSettings, drafts: PublishingDraft[] }
    greetings: { settings: GreetingsSettings }
    tickets: { settings: TicketSettings, categories: TicketCategory[] }
    leveling: { settings: LevelingSettings }
    milestones: { settings: MilestonesSettings, routes: MilestonesRoute[] }
    suggestions: { settings: SuggestionsSettings }
    cleanup: { settings: CleanupSettings, policies: CleanupPolicy[] }
    events: { settings: EventsSettings, events: EventsDefinition[] }
    schedules: { settings: SchedulesSettings, schedules: SchedulesDefinition[] }
    nickname: { settings: GeneralNickname }
    voice: { generators: VoiceGenerator[], rooms: number }
    rolepicker: { settings: RolePickerSettings, access: MemberAccessLists }
    sticky: { stickies: StickyMessage[] }
    sidebar: { link: SidebarLink | null }
    /** The current order comes from the server's role list in the catalog */
    memberlist: Record<string, never>
    /** The 100 active grants that end first. more reports that the server has others */
    temproles: { settings: TemporaryRoleSettings, grants: TemporaryRoleGrant[], more: boolean }
    /** invites is null until a manager first refreshes the list */
    alerts: { settings: AlertSettings, invites: AlertInviteList | null }
    helpdesk: { settings: HelpDeskSettings, answers: HelpDeskAnswer[] }
    /** completions counts members who finished the checklist in the last seven UTC days, including today, while analytics counts */
    onboarding: { settings: OnboardingSettings, completions: number }
    /** Every preset with the changes it would make now */
    presets: { presets: PresetPlan[] }
    /** generators lists the voice generator channels a manager can choose, and open counts the server's open groups */
    lfg: { settings: LfgSettings, generators: string[], open: number }
    showcase: { settings: ShowcaseSettings, access: MemberAccessLists }
    profile: { settings: ProfileSettings, access: MemberAccessLists }
    youtube: YoutubeView
}
export type DashboardConfigurationCollection = "definitions" | "rules" | "watchlist" | "drafts" | "categories" | "routes" | "policies" | "events" | "schedules"
export type DashboardConfigurationCursors = Partial<Record<DashboardConfigurationCollection, string>>
export type DashboardConfigurationRequest = DashboardConfigurationOperation & { sessionToken: string, serverId: string, requestId: string, expectedConfigRevision: number }
export interface DashboardConfigurationQueueResult { queued: boolean, conflict: boolean, revision: number, jobId?: string }
export type DashboardConfigurationSnapshot = { [K in DashboardConfigurationFamily]: { family: K, serverId: string, configRevision: number, data: DashboardConfigurationDataMap[K], jobs: DashboardConfigurationJob[], nextCursors?: DashboardConfigurationCursors } }[DashboardConfigurationFamily]

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
    menus: RolePickerMenu[]
    snapshot: { roleIds: string[], roles: RolePickerRoleDisplay[], allowed: boolean, observedAt: number, expiresAt: number } | null
    /** The member's own recent requests, newest first */
    requests: RolePickerJob[]
}
export interface DashboardRolePickerRequest { sessionToken: string, serverId: string, requestId: string, operation: RolePickerMemberOperation }
export interface DashboardRolePickerQueueResult { jobId: string }
/** The member view of showcases: The server's showcase settings, the member's own showcases and their recent requests, each newest first */
export interface DashboardShowcaseMember { serverId: string, settings: ShowcaseSettings, showcases: Showcase[], requests: ShowcaseJob[] }
export interface DashboardShowcaseRequest { sessionToken: string, serverId: string, requestId: string, operation: ShowcaseMemberOperation }
/** The member view of profiles: The member's own profile and recent requests, newest first */
export interface DashboardProfileMember { serverId: string, profile: Profile | null, requests: ProfileJob[] }
export interface DashboardProfileRequest { sessionToken: string, serverId: string, requestId: string, operation: ProfileMemberOperation }
export interface DashboardMemberQueueResult { jobId: string }
