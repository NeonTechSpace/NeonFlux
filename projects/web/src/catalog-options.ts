import type { DashboardCatalog } from "@neonflux/backend/dashboard-contracts"

export const publicationChannels = (catalog?: DashboardCatalog) =>
    catalog?.channels.filter((channel) => channel.type === 0 || channel.type === 5) ?? []
/** Text and announcement channels, plus forum and media channels, where each card becomes its own post */
export const postChannels = (catalog?: DashboardCatalog) =>
    catalog?.channels.filter((channel) => [0, 5, 15, 16].includes(channel.type)) ?? []
/** Channels a message rule or filter can name. A message in a thread or forum post counts as in its parent channel */
export const messageChannels = postChannels
export const selectableRoles = (catalog?: DashboardCatalog) =>
    catalog?.roles.filter((role) => role.id !== catalog.serverId) ?? []
