export interface DashboardSession {
    sessionToken: string
    user: { id: string, name: string }
    /** Single-server deployments open straight on their one server, multi-server deployments start on a server picker */
    mode: "single" | "multi"
    /** Icon is a Fluxer CDN image URL, or null when the server has no icon */
    servers: Array<{ id: string, name: string, icon: string | null }>
    expiresAt: number
}
export interface DashboardSnapshot {
    serverId: string
    general: { prefix: string, revision: number }
    status: Array<{ id: string, name: string, enabled: boolean }>
    roles: { revision: number, settings: RolesSettings, panels: RolesPanel[], jobs: DashboardRoleJob[] }
    messages: DashboardMessageJob[]
}
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
    roles: Array<{ id: string, name: string, position: number }>
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

export type DashboardConfigurationFamily = "responses" | "moderation" | "publishing" | "greetings" | "tickets" | "leveling" | "milestones" | "suggestions" | "cleanup" | "events" | "schedules" | "nickname"
type WithoutNative<T> = T extends unknown ? Omit<T, "roles" | "recipientOwner"> : never
export type DashboardEventCalendar = Omit<C.EventsCalendar, "dates">
export type DashboardScheduleCalendar = Omit<C.SchedulesCalendar, "dates">
export type DashboardResponseDefinition = Omit<C.ResponseDefinition, "kind" | "createdAt" | "updatedAt">
export type DashboardResponseSave = { type: "definition-create" | "definition-update", definition: DashboardResponseDefinition }
export interface DashboardConfigurationOperationMap {
    responses: { kind: "custom", operation: Exclude<C.ResponseCustomOperation, { type: "list" | "show" }> | DashboardResponseSave } | { kind: "auto", operation: Exclude<C.ResponseAutoOperation, { type: "list" | "show" }> | DashboardResponseSave }
    moderation: Extract<C.ModerationManageOperation, { type: "settings" | "rule-create" | "rule-update" | "rule-delete" | "watchlist-add" | "watchlist-remove" }>
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
}
export type DashboardConfigurationOperation = { [K in DashboardConfigurationFamily]: { family: K, operation: DashboardConfigurationOperationMap[K] } }[DashboardConfigurationFamily]
export interface DashboardConfigurationDataMap {
    responses: { settings: { customEnabled: boolean, autoEnabled: boolean }, definitions: C.ResponseDefinition[] }
    moderation: { settings: C.ModerationSettings, rules: C.AutomodRule[], watchlist: C.WatchlistEntry[] }
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
    calendar?: C.EventsCalendar | C.SchedulesCalendar
    references?: DashboardConfigurationReference[]
}
export interface DashboardConfigurationExecuteResult { job: DashboardConfigurationJob, grant?: C.EventsDeliveryGrant }

