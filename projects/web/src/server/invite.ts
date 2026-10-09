// Permissions NeonFlux's features use, requested when a server admin adds the bot:
// Kick Members, Ban Members, Manage Channels, Add Reactions, View Audit Log, View Channel, Send Messages,
// Manage Messages, Embed Links, Read Message History, Connect, Move Members, Change Nickname, Manage Roles,
// Moderate Members and Update RTC Region
export const NEONFLUX_BOT_PERMISSIONS = 9008299119832278n

// Hosted Fluxer API. Sign-in discovery accepts only this host, so the invite link uses the same authorize route
export const hostedFluxerApi = 'https://api.fluxer.app'
export function authorizeUrl(api: string, query: URLSearchParams): string {
  return `${api}/v1/oauth2/authorize?${query}`
}
export function inviteUrl(clientId: string): string {
  return authorizeUrl(hostedFluxerApi, new URLSearchParams({ client_id: clientId, scope: 'bot', permissions: String(NEONFLUX_BOT_PERMISSIONS) }))
}
