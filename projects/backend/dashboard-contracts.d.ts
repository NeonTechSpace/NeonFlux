/** The backend's public functions, typed by their own definitions. The website calls them through these types and never imports backend code */
export type DashboardApi = typeof api
export interface DashboardSession {
    sessionToken: string
    user: { id: string; name: string }
    /** Single-server deployments open straight on their one server, multi-server deployments start on a server picker */
    mode: "single" | "multi"
    /** Icon is a Fluxer CDN image URL, or null when the server has no icon */
    servers: Array<{ id: string; name: string; icon: string | null }>
    /** Servers where the user is a member without managing them, NeonFlux is installed and the role picker is on */
    memberServers?: Array<{ id: string; name: string; icon: string | null }>
    expiresAt: number
}
/** The deployment's public website settings: its origin, null when unset, and the Fluxer OAuth application ID */
export interface DashboardWebConfig {
    websiteUrl: string | null
    clientId: string
}
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
export type { DashboardOverviewSection, DashboardOverviewState } from "@neonflux/contracts/setup"
import type { DashboardOverviewSection, DashboardOverviewState } from "@neonflux/contracts/setup"
import type { CleanupPolicy, CleanupSettings } from "@neonflux/contracts/cleanup"
import type { EventsDefinition, EventsSettings } from "@neonflux/contracts/events"
import type { GeneralNickname } from "@neonflux/contracts/general"
import type { GreetingsSettings } from "@neonflux/contracts/greetings"
import type { LevelingSettings } from "@neonflux/contracts/leveling"
import type { MetadataLogsSettings } from "@neonflux/contracts/metadata-logs"
import type { MilestonesRoute, MilestonesSettings } from "@neonflux/contracts/milestones"
import type { AutomodRule, ModerationSettings, StaffClass, WatchlistEntry } from "@neonflux/contracts/moderation"
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
    moderation: { settings: ModerationSettings; rules: AutomodRule[]; watchlist: WatchlistEntry[] }
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
