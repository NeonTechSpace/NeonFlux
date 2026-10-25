/** The backend's public functions, typed by their own definitions. The website calls them through these types and never imports backend code */
export type DashboardApi = typeof api
export interface DashboardSession {
    sessionToken: string
    user: { id: string; name: string }
    /** Single-server deployments open straight on their one server, multi-server deployments start on a server picker */
    mode: "single" | "multi"
    /** Icon is a Fluxer CDN image URL, or null when the server has no icon */
    servers: Array<{ id: string; name: string; icon: string | null }>
    /** Servers where the user is a member without managing them, NeonFlux is installed and the server offers a member feature */
    memberServers?: Array<{ id: string; name: string; icon: string | null; features: DashboardMemberFeature[] }>
    expiresAt: number
}
/** The deployment's public website settings: its origin, null when unset, and the Fluxer OAuth application ID */
export interface DashboardWebConfig {
    websiteUrl: string | null
    clientId: string
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
    check: {
        state: "queued" | "passed" | "refused" | "failed"
        requestedAt: number
        checkedAt?: number
        validUntil?: number
    } | null
}
/** One view of private data. Every view that returns data is recorded in the audit log */
export type DashboardPrivateView =
    | { type: "cases"; beforeCaseNo?: number }
    /** correctionsAfter continues the case's corrections after the creation time of the last one shown */
    | { type: "case"; caseNo: number; correctionsAfter?: number }
    | { type: "appeals"; beforeAppealNo?: number }
    | { type: "open-appeals"; afterAppealNo?: number }
    | { type: "history"; userId: string; beforeCaseNo?: number }
/** Lists are newest first in pages of 25, and a next number continues with older entries. Waiting appeals are oldest first and continue with newer ones. An erased case or appeal keeps only its erasure marker */
export type DashboardPrivateData =
    | { type: "cases"; cases: ModerationCase[]; nextBeforeCaseNo?: number }
    | {
          type: "case"
          case: ModerationCase
          corrections: ModerationCorrection[]
          nextCorrectionsAfter?: number
          appeals: Appeal[]
      }
    | { type: "appeals"; appeals: Appeal[]; nextBeforeAppealNo?: number }
    | { type: "open-appeals"; appeals: Appeal[]; nextAfterAppealNo?: number }
    | { type: "history"; userId: string; cases: ModerationCase[]; nextBeforeCaseNo?: number; appeals: Appeal[] }
/** checking waits for a live check, which DashboardPrivateAccess reports. refused and failed repeat the latest check's answer */
export type DashboardPrivateResult =
    { status: "checking" | "refused" | "failed" } | { status: "ok"; data: DashboardPrivateData }
/** The start of a server export, which needs the same live check as private cases and passes the server owner only. refused also answers a passed check of someone else */
export type DashboardExportStart = { status: "checking" | "refused" | "failed" | "ok" }
/** expired means the owner's passed check ended, so the export continues after a new start */
export type DashboardExportPage = { status: "expired" } | { status: "ok"; page: ServerExportPage }
/** Dashboard views. Each section subscribes to the one view it shows */
export interface DashboardGeneralView {
    serverId: string
    prefix: string
    replyStyle: "embed" | "text"
    revision: number
}
/** The prefix is shown in the autorole chat command help */
export interface DashboardRolesView {
    serverId: string
    general: { prefix: string }
    roles: { revision: number; settings: RolesSettings; panels: RolesPanel[]; jobs: DashboardRoleJob[] }
}
export interface DashboardMessagesView {
    serverId: string
    jobs: DashboardMessageJob[]
}
/** One page of saved drafts and templates by kind and name. cursor reads the next page, or is null on the last */
export interface DashboardTemplatesView {
    serverId: string
    templates: Array<{ kind: "draft" | "template"; name: string; revision: number }>
    cursor: string | null
}
export interface DashboardOverview {
    serverId: string
    sections: Array<{ id: DashboardOverviewSection; state: DashboardOverviewState }>
}
/** The latest permission check the bot ran for the dashboard. queued waits for the bot, failed means it did not answer in time */
export interface DashboardSetupCheck {
    serverId: string
    state: "queued" | "done" | "failed"
    requestedAt: number
    checkedAt?: number
    problems: SetupProblem[]
}
/** One item of the latest restore plan as the owner sees it, without the hashes and the plan binding */
export type DashboardBackupItem = Omit<BackupItem, "planId" | "revision" | "planHash" | "archiveDigest">
/** One item of the latest restore plan with what it changes, as the owner sees it */
export type DashboardBackupChangedItem = DashboardBackupItem & { changes: BackupChange[] }
/**
 * The latest restore job and plan, for the owner who made them. queued waits for the bot to read the archive and the server again, running for
 * the bot to run the next items of a confirmed plan, waiting for the claims it left open to age, and failed names why the job stopped.
 * settled counts the items that have an outcome, and states counts every item by its state
 */
export interface DashboardBackupRestore {
    state: "queued" | "running" | "waiting" | "done" | "failed"
    failure?: BackupPreviewFailure
    plan: {
        planId: string
        planHash: string
        backupId: string
        match: boolean
        createdAt: number
        /** The last moment the website confirms the plan, which leaves the bot time to run it */
        confirmBefore: number
        confirmedAt?: number
        itemCount: number
        counts: BackupPlan["counts"]
        gain: BackupPlan["gain"]
        /** The items that delete messages or post logs */
        warned: number
        /** The items with a setting that turns on */
        turnsOn: Pick<DashboardBackupItem, "category" | "family" | "sourceId" | "name">[]
        settled: number
        states: Partial<Record<BackupItemState, number>>
    } | null
}
/** One page of the plan's items, problems first. nextCursor is missing on the last page */
export interface DashboardBackupItems {
    items: DashboardBackupChangedItem[]
    nextCursor?: string
}
/**
 * What saving a change would do against the current structure. apply changes the server, skip finds it already done, conflict means the
 * channel changed elsewhere since the draft started, blocked means the channel or the category it moves into is gone, and refused means
 * the manager lacks Manage channels in the channel
 */
export type StructureDisposition = "apply" | "skip" | "conflict" | "blocked" | "refused"
export interface StructureItem {
    itemNo: number
    change: StructureChange
    disposition: StructureDisposition
    reason: string | null
}
/** A change after a save. failed changed nothing, and uncertain may have changed the server, which NeonFlux never repeats on its own */
export type StructureOutcome = StructureResult["outcome"]
export type StructureResult = Infer<typeof structureResult>
/** unanswered: The bot did not answer in time. access: The manager is no longer a member. error: A Fluxer read failed. uncertain: A save started and was not confirmed */
export type StructureFailure = Infer<typeof structureFailure>
/**
 * One manager's structure editor: the latest read, closed threads loaded on demand and the latest save. state belongs to the latest
 * request: queued waits for the bot, applying means the bot is saving, and failed names why. changedAt is set when a channel was
 * created, changed, deleted or reordered after the read
 */
export interface DashboardStructure {
    serverId: string
    state: Doc<"dashboardStructureJobs">["state"]
    work: StructureWork["type"]
    requestedAt: number
    failure?: StructureFailure
    read: StructureRead | null
    changedAt?: number
    archived: Array<{ channelId: string; threads: StructureThread[]; more: boolean }>
    save: { requestedAt: number; results: StructureResult[] } | null
}
/** A draft checked against the latest read, item by item, as a save would decide */
export interface DashboardStructurePreview {
    readAt: number
    items: StructureItem[]
}
/** A setting change, a member's deletion of their own data, a view of private data such as a moderation case, or the owner's export of the server's data */
export type DashboardAuditKind = "setting" | "member-data-deleted" | "private-data-viewed" | "server-exported"
/** Features the audit log names. Configuration families keep their own names */
export type DashboardAuditFeature =
    | DashboardConfigurationFamily
    | "prefix"
    | "replies"
    | "analytics"
    | "logs"
    | "roles"
    | "member-data"
    | "private-data"
    | "export"
    | "structure"
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
    /** The entry has before and after values, which the auditLog entry query reads */
    detail?: true
    createdAt: number
}
/** One changed value. A missing before was added and a missing after removed. cut is the full length of a value stored as its first 8,000 code units */
export interface DashboardAuditChange {
    path: string
    before?: unknown
    after?: unknown
    cut?: number
}
/** An entry's changed values. more counts the changes that were too large to store */
export interface DashboardAuditDetail {
    changes: DashboardAuditChange[]
    more: number
}
/** Newest first. nextCursor reads the next older page, or is null on the last page */
export interface DashboardAuditPage {
    serverId: string
    entries: DashboardAuditEntry[]
    nextCursor: string | null
}
export type DashboardSaveResult = { saved: true; revision: number } | { saved: false; conflict: true; revision: number }
export interface DashboardCatalog {
    serverId: string
    ownerId?: string
    channels: Array<{ id: string; name: string; type: number; parentId?: string }>
    /** hoist shows the role's members as their own member-list group, ordered by hoistPosition, or by position while it is null */
    roles: Array<{ id: string; name: string; position: number; hoist?: boolean; hoistPosition?: number | null }>
}
export interface DashboardMetadataSnapshot {
    serverId: string
    settings: MetadataLogsSettings
    jobs: DashboardMetadataJob[]
}
export interface DashboardMetadataQueueResult {
    queued: boolean
    conflict: boolean
    revision: number
    jobId?: string
}
import type { Infer } from "convex/values"
import type { api } from "./convex/_generated/api.js"
import type { Doc } from "./convex/_generated/dataModel.js"
import type { structureFailure, structureResult } from "./convex/structureValidators.ts"
import type {
    DashboardConfigurationFamily,
    DashboardConfigurationJob,
    DashboardConfigurationOperation,
    DashboardMessageJob,
    DashboardMetadataJob,
    DashboardRoleJob,
} from "@neonflux/contracts/dashboard"
export type {
    DashboardConfigurationFamily,
    DashboardEventCalendar,
    DashboardScheduleCalendar,
    DashboardConfigurationOperationMap,
    DashboardConfigurationOperation,
    DashboardConfigurationJob,
    DashboardMessageJob,
    DashboardRoleOperation,
    DashboardRoleJob,
    DashboardMetadataOperation,
    DashboardMetadataJob,
} from "@neonflux/contracts/dashboard"
export type {
    StructureChannelType,
    StructureEntry,
    StructureChannel,
    StructureThread,
    StructureRead,
    StructureWork,
    StructureChange,
} from "@neonflux/contracts/structure"
import type { StructureChange, StructureThread, StructureRead, StructureWork } from "@neonflux/contracts/structure"
export type {
    DashboardOverviewSection,
    DashboardOverviewState,
    SetupProblem,
    RecoveryEntry,
    RecoveryInbox,
} from "@neonflux/contracts/setup"
import type { DashboardOverviewSection, DashboardOverviewState, SetupProblem } from "@neonflux/contracts/setup"
import type { AlertInviteList, AlertSettings } from "@neonflux/contracts/alerts"
import type { Appeal } from "@neonflux/contracts/appeal"
import type {
    BackupChange,
    BackupItem,
    BackupItemState,
    BackupPlan,
    BackupPreviewFailure,
} from "@neonflux/contracts/backup"
import type { CleanupPolicy, CleanupSettings } from "@neonflux/contracts/cleanup"
import type { EventsDefinition, EventsSettings } from "@neonflux/contracts/events"
import type { GeneralNickname } from "@neonflux/contracts/general"
import type { GreetingsSettings } from "@neonflux/contracts/greetings"
import type { HelpDeskAnswer, HelpDeskSettings } from "@neonflux/contracts/helpdesk"
import type { LevelingSettings } from "@neonflux/contracts/leveling"
import type { LfgSettings } from "@neonflux/contracts/lfg"
import type { MetadataLogsSettings } from "@neonflux/contracts/metadata-logs"
import type { MilestonesRoute, MilestonesSettings } from "@neonflux/contracts/milestones"
import type {
    AutomodRule,
    ModerationCase,
    ModerationCorrection,
    ModerationSettings,
    StaffClass,
    WatchlistEntry,
} from "@neonflux/contracts/moderation"
import type { OnboardingSettings } from "@neonflux/contracts/onboarding"
import type { PresetPlan } from "@neonflux/contracts/presets"
import type { Profile, ProfileJob, ProfileSettings } from "@neonflux/contracts/profiles"
import type { PublishingDraft, PublishingSettings } from "@neonflux/contracts/publishing"
import type { ResponseDefinition } from "@neonflux/contracts/responses"
import type {
    RolePickerJob,
    RolePickerMenu,
    RolePickerRoleDisplay,
    RolePickerSettings,
} from "@neonflux/contracts/role-picker"
import type { RolesPanel, RolesSettings } from "@neonflux/contracts/roles"
import type { SchedulesDefinition, SchedulesSettings } from "@neonflux/contracts/schedules"
import type { ServerExportPage } from "@neonflux/contracts/server-export"
import type { MemberAccessLists } from "@neonflux/contracts/shared"
import type { Showcase, ShowcaseJob, ShowcaseSettings } from "@neonflux/contracts/showcases"
import type { SidebarLink } from "@neonflux/contracts/sidebar"
import type { StickyMessage } from "@neonflux/contracts/sticky"
import type { SuggestionsSettings } from "@neonflux/contracts/suggestions"
import type { TemporaryRoleGrant, TemporaryRoleSettings } from "@neonflux/contracts/temporary-roles"
import type { TicketCategory, TicketSettings } from "@neonflux/contracts/tickets"
import type { VoiceGenerator } from "@neonflux/contracts/voice"
import type { YoutubeView } from "@neonflux/contracts/youtube"

export interface DashboardConfigurationDataMap {
    responses: { settings: { customEnabled: boolean; autoEnabled: boolean }; definitions: ResponseDefinition[] }
    /** privateDataRoleId is the role whose members may view private cases on the website, or null when only the owner may */
    moderation: {
        settings: ModerationSettings
        privateDataRoleId: string | null
        rules: AutomodRule[]
        watchlist: WatchlistEntry[]
    }
    publishing: { settings: PublishingSettings; drafts: PublishingDraft[] }
    greetings: { settings: GreetingsSettings }
    tickets: { settings: TicketSettings; categories: TicketCategory[] }
    leveling: { settings: LevelingSettings }
    milestones: { settings: MilestonesSettings; routes: MilestonesRoute[] }
    suggestions: { settings: SuggestionsSettings }
    cleanup: { settings: CleanupSettings; policies: CleanupPolicy[] }
    events: { settings: EventsSettings; events: EventsDefinition[] }
    schedules: { settings: SchedulesSettings; schedules: SchedulesDefinition[] }
    nickname: { settings: GeneralNickname }
    voice: { generators: VoiceGenerator[]; rooms: number }
    rolepicker: { settings: RolePickerSettings; access: MemberAccessLists }
    sticky: { stickies: StickyMessage[] }
    sidebar: { link: SidebarLink | null }
    /** The current order comes from the server's role list in the catalog */
    memberlist: Record<string, never>
    /** The 100 active grants that end first. more reports that the server has others */
    temproles: { settings: TemporaryRoleSettings; grants: TemporaryRoleGrant[]; more: boolean }
    /** invites is null until a manager first refreshes the list */
    alerts: { settings: AlertSettings; invites: AlertInviteList | null }
    helpdesk: { settings: HelpDeskSettings; answers: HelpDeskAnswer[] }
    /** completions counts members who finished the checklist in the last seven UTC days, including today, while analytics counts */
    onboarding: { settings: OnboardingSettings; completions: number }
    /** Every preset with the changes it would make now */
    presets: { presets: PresetPlan[] }
    /** generators lists the voice generator channels a manager can choose, and open counts the server's open groups */
    lfg: { settings: LfgSettings; generators: string[]; open: number }
    showcase: { settings: ShowcaseSettings; access: MemberAccessLists }
    profile: { settings: ProfileSettings; access: MemberAccessLists }
    youtube: YoutubeView
}
export type DashboardConfigurationCollection =
    "definitions" | "rules" | "watchlist" | "drafts" | "categories" | "routes" | "policies" | "events" | "schedules"
export type DashboardConfigurationCursors = Partial<Record<DashboardConfigurationCollection, string>>
export type DashboardConfigurationRequest = DashboardConfigurationOperation & {
    sessionToken: string
    serverId: string
    requestId: string
    expectedConfigRevision: number
}
export interface DashboardConfigurationQueueResult {
    queued: boolean
    conflict: boolean
    revision: number
    jobId?: string
}
export type DashboardConfigurationSnapshot = {
    [K in DashboardConfigurationFamily]: {
        family: K
        serverId: string
        configRevision: number
        data: DashboardConfigurationDataMap[K]
        jobs: DashboardConfigurationJob[]
        nextCursors?: DashboardConfigurationCursors
    }
}[DashboardConfigurationFamily]

export interface DashboardAnalyticsSnapshot {
    serverId: string
    enabled: boolean
    revision: number
    /** Thirty UTC days ending today, oldest first, with zero-filled gaps */
    members: Array<{ day: number; joins: number; leaves: number; onboarded: number }>
    /** Fourteen UTC days ending today, oldest first, with zero-filled gaps */
    messages: Array<{ day: number; count: number }>
    /** Top channels by messages over the requested range of 7 or 30 days, at most ten */
    range: 7 | 30
    topChannels: Array<{ channelId: string; count: number }>
    /** The channel that hours describe, or null for every channel */
    channelId: string | null
    /** Messages per UTC hour for each day of the range, oldest first, with zero-filled gaps. Counts holds 24 values, from 00:00 to 23:00 */
    hours: Array<{ day: number; counts: number[] }>
}

/** The member view of the role picker. The snapshot is the member's last lookup and expires after ten minutes.
 *  Its roles are the names and colors of menu roles that the bot read with it, which take precedence over the names stored with the menus */
export interface DashboardRolePickerMember {
    serverId: string
    menus: RolePickerMenu[]
    snapshot: {
        roleIds: string[]
        roles: RolePickerRoleDisplay[]
        allowed: boolean
        observedAt: number
        expiresAt: number
    } | null
    /** The member's own recent requests, newest first */
    requests: RolePickerJob[]
}
export interface DashboardRolePickerQueueResult {
    jobId: string
}
/** The member view of showcases: The server's showcase settings, one page of the member's own showcases and their recent requests, each newest first. nextCursor reads the next page of showcases */
export interface DashboardShowcaseMember {
    serverId: string
    settings: ShowcaseSettings
    showcases: Showcase[]
    nextCursor: string | null
    requests: ShowcaseJob[]
}
/**
 * The member view of profiles: The member's own profile, their current birthday sign-up with their choice to show it on the profile, or
 * null without one, and recent requests, newest first
 */
export interface DashboardProfileMember {
    serverId: string
    profile: Profile | null
    birthday: { show: boolean } | null
    requests: ProfileJob[]
}
export interface DashboardMemberQueueResult {
    jobId: string
}
