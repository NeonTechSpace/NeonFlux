import { makeFunctionReference } from 'convex/server'
import type { DashboardSave, DashboardSaveResult, DashboardSession, DashboardSnapshot, DashboardRoleRequest, DashboardCatalog, DashboardMetadataSnapshot, DashboardMetadataRequest, DashboardMetadataQueueResult, DashboardConfigurationFamily, DashboardConfigurationCursors, DashboardConfigurationSnapshot, DashboardConfigurationRequest, DashboardConfigurationQueueResult, DashboardAnalyticsSnapshot, DashboardAnalyticsSave, DashboardRolePickerMember, DashboardRolePickerRequest, DashboardRolePickerQueueResult } from '@neonflux/backend/dashboard-contracts'
import type { PublishingContent } from '@neonflux/backend/contracts'

export const dashboardApi = {
  admit: makeFunctionReference<'action', { accessToken: string }, DashboardSession>('dashboard:admit'),
  refresh: makeFunctionReference<'action', { sessionToken: string }, DashboardSession>('dashboard:refresh'),
  logout: makeFunctionReference<'mutation', { sessionToken: string }, null>('dashboard:logout'),
  snapshot: makeFunctionReference<'query', { sessionToken: string, serverId: string }, DashboardSnapshot>('dashboard:snapshot'),
  save: makeFunctionReference<'action', { [K in keyof DashboardSave]: DashboardSave[K] }, DashboardSaveResult>('dashboard:save'),
  queueRole: makeFunctionReference<'action', { [K in keyof DashboardRoleRequest]: DashboardRoleRequest[K] }, { queued: boolean, conflict: boolean, revision: number, jobId?: string }>('dashboardRoles:queue'),
  catalog: makeFunctionReference<'action', { sessionToken: string, serverId: string }, DashboardCatalog>('dashboard:catalog'),
  queueMessage: makeFunctionReference<'action', { sessionToken: string, serverId: string, requestId: string, channelId: string, content: PublishingContent }, { jobId: string }>('dashboardMessages:queue'),
  metadataSnapshot: makeFunctionReference<'query', { sessionToken: string, serverId: string }, DashboardMetadataSnapshot>('dashboardMetadata:snapshot'),
  queueMetadata: makeFunctionReference<'action', { [K in keyof DashboardMetadataRequest]: DashboardMetadataRequest[K] }, DashboardMetadataQueueResult>('dashboardMetadata:queue'),
  configurationSnapshot: makeFunctionReference<'query', { sessionToken: string, serverId: string, family: DashboardConfigurationFamily, cursors?: DashboardConfigurationCursors }, DashboardConfigurationSnapshot>('dashboardConfiguration:snapshot'),
  queueConfiguration: makeFunctionReference<'action', DashboardConfigurationRequest, DashboardConfigurationQueueResult>('dashboardConfiguration:queue'),
  analytics: makeFunctionReference<'query', { sessionToken: string, serverId: string, range: 7 | 30, channelId?: string }, DashboardAnalyticsSnapshot>('analytics:dashboard'),
  saveAnalytics: makeFunctionReference<'action', { [K in keyof DashboardAnalyticsSave]: DashboardAnalyticsSave[K] }, DashboardSaveResult>('analytics:save'),
  rolePickerMember: makeFunctionReference<'query', { sessionToken: string, serverId: string }, DashboardRolePickerMember>('rolePicker:member'),
  rolePickerRequest: makeFunctionReference<'mutation', { [K in keyof DashboardRolePickerRequest]: DashboardRolePickerRequest[K] }, DashboardRolePickerQueueResult>('rolePicker:request'),
}

/** inviteUrl adds NeonFlux to another server and is present only in multi-server mode */
export type WebSession = DashboardSession & { convexUrl: string, inviteUrl?: string }
