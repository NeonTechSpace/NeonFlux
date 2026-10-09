import { anyApi } from 'convex/server'
import type { DashboardApi, DashboardSession } from '@neonflux/backend/dashboard-contracts'

// References named and typed by the backend's own function definitions, so a changed argument or answer fails this package's typecheck
const api = anyApi as unknown as DashboardApi
export const dashboardApi = {
  webConfig: api.dashboard.webConfig,
  admit: api.dashboard.admit,
  refresh: api.dashboard.refresh,
  logout: api.dashboard.logout,
  snapshot: api.dashboard.snapshot,
  save: api.dashboard.save,
  queueRole: api.dashboardRoles.queue,
  catalog: api.dashboard.catalog,
  queueMessage: api.dashboardMessages.queue,
  metadataSnapshot: api.dashboardMetadata.snapshot,
  queueMetadata: api.dashboardMetadata.queue,
  configurationSnapshot: api.dashboardConfiguration.snapshot,
  queueConfiguration: api.dashboardConfiguration.queue,
}

/** inviteUrl adds NeonFlux to another server and is present only in multi-server mode */
export type WebSession = DashboardSession & { convexUrl: string, inviteUrl?: string }
