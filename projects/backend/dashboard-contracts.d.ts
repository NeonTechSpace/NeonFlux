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
/** Member features a server offers on the website: the role picker when it is on, and private cases once the server names a private data role */
export type DashboardMemberFeature = "rolepicker" | "private"
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
    | { type: "case"; caseNo: number }
    | { type: "appeals"; beforeAppealNo?: number }
    | { type: "history"; userId: string; beforeCaseNo?: number }
/** Lists are newest first in pages of 25, and a next number continues with older entries. An erased case or appeal keeps only its erasure marker */
export type DashboardPrivateData =
    | { type: "cases"; cases: ModerationCase[]; nextBeforeCaseNo?: number }
    | { type: "case"; case: ModerationCase; appeals: Appeal[] }
    | { type: "appeals"; appeals: Appeal[]; nextBeforeAppealNo?: number }
    | { type: "history"; userId: string; cases: ModerationCase[]; nextBeforeCaseNo?: number; appeals: Appeal[] }
/** checking waits for a live check, which DashboardPrivateAccess reports. refused and failed repeat the latest check's answer */
export type DashboardPrivateResult =
    { status: "checking" | "refused" | "failed" } | { status: "ok"; data: DashboardPrivateData }
/** Dashboard views. Each section subscribes to the one view it shows */
export interface DashboardGeneralView {
    serverId: string
    prefix: string
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
/** A setting change, a member's deletion of their own data, or a view of private data such as a moderation case */
export type DashboardAuditKind = "setting" | "member-data-deleted" | "private-data-viewed"
/** Features the audit log names. Configuration families keep their own names */
export type DashboardAuditFeature =
    | DashboardConfigurationFamily
    | "prefix"
    | "analytics"
    | "logs"
    | "roles"
    | "member-data"
    | "private-data"
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
    createdAt: number
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
    roles: Array<{ id: string; name: string; position: number }>
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
import type { api } from "./convex/_generated/api.js"
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
export type { DashboardOverviewSection, DashboardOverviewState, SetupProblem } from "@neonflux/contracts/setup"
import type { DashboardOverviewSection, DashboardOverviewState, SetupProblem } from "@neonflux/contracts/setup"
import type { Appeal } from "@neonflux/contracts/appeal"
import type { CleanupPolicy, CleanupSettings } from "@neonflux/contracts/cleanup"
import type { EventsDefinition, EventsSettings } from "@neonflux/contracts/events"
import type { GeneralNickname } from "@neonflux/contracts/general"
import type { GreetingsSettings } from "@neonflux/contracts/greetings"
import type { LevelingSettings } from "@neonflux/contracts/leveling"
import type { MetadataLogsSettings } from "@neonflux/contracts/metadata-logs"
import type { MilestonesRoute, MilestonesSettings } from "@neonflux/contracts/milestones"
import type {
    AutomodRule,
    ModerationCase,
    ModerationSettings,
    StaffClass,
    WatchlistEntry,
} from "@neonflux/contracts/moderation"
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
import type { MemberAccessLists } from "@neonflux/contracts/shared"
import type { SuggestionsSettings } from "@neonflux/contracts/suggestions"
import type { TicketCategory, TicketSettings } from "@neonflux/contracts/tickets"
import type { VoiceGenerator } from "@neonflux/contracts/voice"

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
    members: Array<{ day: number; joins: number; leaves: number }>
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
