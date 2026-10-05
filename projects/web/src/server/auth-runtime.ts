import { ConvexHttpClient } from 'convex/browser'
import { dashboardApi } from '../dashboard-api.ts'
import { createAuthHandlers } from './auth.ts'

export function authHandlers() {
  const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000'
  const clientId = process.env.FLUXER_CLIENT_ID ?? '', clientSecret = process.env.FLUXER_CLIENT_SECRET ?? ''
  const convexUrl = process.env.CONVEX_URL ?? '', sessionSecret = process.env.WEB_SESSION_SECRET ?? ''
  if (!clientId || !clientSecret || !convexUrl || sessionSecret.length < 32) throw new Error('Website authentication is not configured')
  const parsed = new URL(origin)
  if (parsed.origin !== origin || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && parsed.hostname === 'localhost'))) throw new Error('Invalid website origin configuration')
  const client = new ConvexHttpClient(convexUrl)
  return createAuthHandlers({ config: { origin, clientId, clientSecret, convexUrl, sessionSecret }, fetch, now: Date.now,
    admit: accessToken => client.action(dashboardApi.admit, { accessToken }),
    refresh: sessionToken => client.action(dashboardApi.refresh, { sessionToken }),
    logout: sessionToken => client.mutation(dashboardApi.logout, { sessionToken }),
  })
}
export async function authRoute(handler: 'begin' | 'callback' | 'session' | 'logout', request: Request): Promise<Response> {
  try { return await authHandlers()[handler](request) } catch { return Response.json({ error: 'Website authentication is not configured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }) }
}
