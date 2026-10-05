import type { DashboardCatalog } from '@neonflux/backend/dashboard-contracts'

export const publicationChannels = (catalog?: DashboardCatalog) => catalog?.channels.filter(channel => channel.type === 0 || channel.type === 5) ?? []
export const selectableRoles = (catalog?: DashboardCatalog) => catalog?.roles.filter(role => role.id !== catalog.serverId) ?? []
