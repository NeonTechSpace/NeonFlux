/** The backend's public functions, typed by their own definitions. The website calls them through these types and never imports backend code */
export type DashboardApi = typeof api
export interface DashboardSession {
    sessionToken: string
    user: { id: string; name: string }
    /** Single-server deployments open straight on their one server, multi-server deployments start on a server picker */
    mode: "single" | "multi"
    /** Icon is a Fluxer CDN image URL, or null when the server has no icon */
    servers: Array<{ id: string; name: string; icon: string | null }>
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
import type { GreetingsSettings } from "@neonflux/contracts/greetings"
import type { LevelingSettings } from "@neonflux/contracts/leveling"
import type { MetadataLogsSettings } from "@neonflux/contracts/metadata-logs"
import type { MilestonesRoute, MilestonesSettings } from "@neonflux/contracts/milestones"
import type { AutomodRule, ModerationSettings, StaffClass, WatchlistEntry } from "@neonflux/contracts/moderation"
import type { PublishingDraft, PublishingSettings } from "@neonflux/contracts/publishing"
import type { ResponseDefinition } from "@neonflux/contracts/responses"
import type { RolesPanel, RolesSettings } from "@neonflux/contracts/roles"
import type { SchedulesDefinition, SchedulesSettings } from "@neonflux/contracts/schedules"
import type { SuggestionsSettings } from "@neonflux/contracts/suggestions"
import type { TicketCategory, TicketSettings } from "@neonflux/contracts/tickets"

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
