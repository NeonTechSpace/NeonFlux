import { anyApi } from "convex/server"
import type { DashboardApi, DashboardSession } from "@neonflux/backend/dashboard-contracts"

// References named and typed by the backend's own function definitions, so a changed argument or answer fails this package's typecheck
const api = anyApi as unknown as DashboardApi
export const dashboardApi = {
    webConfig: api.dashboard.webConfig,
    admit: api.dashboard.admit,
    refresh: api.dashboard.refresh,
    logout: api.dashboard.logout,
    general: api.dashboardViews.general,
    roles: api.dashboardViews.roles,
    messages: api.dashboardViews.messages,
    templates: api.dashboardViews.templates,
    overview: api.dashboardViews.overview,
    setupCheck: api.setupCheck.view,
    requestSetupCheck: api.setupCheck.request,
    save: api.dashboard.save,
    queueRole: api.dashboardRoles.queue,
    catalog: api.dashboard.catalog,
    queueMessage: api.dashboardMessages.queue,
    metadataSnapshot: api.dashboardMetadata.snapshot,
    queueMetadata: api.dashboardMetadata.queue,
    configurationSnapshot: api.dashboardConfiguration.snapshot,
    queueConfiguration: api.dashboardConfiguration.queue,
    analytics: api.analytics.dashboard,
    saveAnalytics: api.analytics.save,
    rolePickerMember: api.rolePicker.member,
    rolePickerRequest: api.rolePicker.request,
    showcaseMember: api.showcases.member,
    showcaseRequest: api.showcases.request,
    profileMember: api.profiles.member,
    profileRequest: api.profiles.request,
    profileRemove: api.profiles.remove,
    auditLog: api.auditLog.page,
    privateAccess: api.privateData.access,
    privateView: api.privateData.view,
    recovery: api.recovery.inbox,
    backupRestore: api.backup.restoreView,
    backupItems: api.backup.restoreItems,
    requestBackupRestore: api.backup.restoreRequest,
    confirmBackupRestore: api.backup.restoreConfirm,
    exportStart: api.serverExport.start,
    exportPage: api.serverExport.page,
}

/** inviteUrl adds NeonFlux to another server and is present only in multi-server mode */
export type WebSession = DashboardSession & { convexUrl: string; inviteUrl?: string }
