import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { DashboardSession } from '@neonflux/backend/dashboard-contracts'
import { ConvexError } from 'convex/values'
import { authorizeUrl, inviteUrl } from './invite.ts'

export interface AuthConfig {
  origin: string
  clientId: string
  clientSecret: string
  convexUrl: string
  sessionSecret: string
}
export interface AuthDependencies {
  config: AuthConfig
  fetch: typeof fetch
  now: () => number
  admit: (accessToken: string) => Promise<DashboardSession>
  refresh: (sessionToken: string) => Promise<DashboardSession>
  logout: (sessionToken: string) => Promise<unknown>
}
const sessionCookie = 'neonflux_session'
const handshakeCookie = 'neonflux_oauth'
const maxHandshakeAge = 10 * 60 * 1000
const privateHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }

export function cookieValue(request: Request, name = sessionCookie): string | undefined {
  const values = (request.headers.get('cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`))
  return values.length === 1 ? values[0]!.slice(name.length + 1) : undefined
}
export function sameOrigin(request: Request, origin: string): boolean {
  return new URL(request.url).origin === origin && request.headers.get('origin') === origin
}
function cookie(config: AuthConfig, name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.origin.startsWith('https:') ? '; Secure' : ''}`
}
function signature(value: string, secret: string): string { return createHmac('sha256', secret).update(value).digest('base64url') }
function decodeHandshake(raw: string | undefined, config: AuthConfig): { state: string, verifier: string, issuedAt: number, returnTo: string } | undefined {
  if (!raw || raw.length > 4096) return
  const [value, mac, extra] = raw.split('.')
  if (!value || !mac || extra || !/^[\w-]+$/.test(mac)) return
  const supplied = Buffer.from(mac, 'base64url'), expected = Buffer.from(signature(value, config.sessionSecret), 'base64url')
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return
  try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) } catch { return }
}
function safeReturnTo(value: string | null): string {
  if (value === '/') return value
  if (value && /^\/verify\?token=[a-f0-9]{32}$/.test(value)) return value
  return '/'
}
export async function discoverProvider(fetcher: typeof fetch): Promise<string> {
  let response = await fetcher('https://fluxer.app/.well-known/fluxer', { signal: AbortSignal.timeout(5000), redirect: 'manual' })
  if ([301,302,307,308].includes(response.status)) {
    const location = new URL(response.headers.get('location') ?? '', 'https://fluxer.app').href
    if (location !== 'https://api.fluxer.app/.well-known/fluxer') throw new Error('Provider discovery unavailable')
    response = await fetcher(location, { signal: AbortSignal.timeout(5000), redirect: 'error' })
  }
  if (!response.ok) throw new Error('Provider discovery unavailable')
  const body = await response.json() as { endpoints?: { api_public?: string } }
  const api = body.endpoints?.api_public
  if (typeof api !== 'string') throw new Error('Provider discovery unavailable')
  const url = new URL(api)
  if (url.protocol !== 'https:' || url.hostname !== 'api.fluxer.app' || url.username || url.password || url.search || url.hash) throw new Error('Provider discovery unavailable')
  return api.replace(/\/$/, '')
}

export function createAuthHandlers(deps: AuthDependencies) {
  const { config } = deps
  const json = (data: unknown, status = 200, extra: Record<string,string> = {}) => Response.json(data, { status, headers: { ...privateHeaders, ...extra } })
  const redirect = (location: string, cookies: string[]) => {
    const headers = new Headers({ ...privateHeaders, Location: location })
    for (const value of cookies) headers.append('Set-Cookie', value)
    return new Response(null, { status: 303, headers })
  }
  return {
    async begin(request: Request): Promise<Response> {
      if (new URL(request.url).origin !== config.origin) return json({ error: 'Invalid website origin' }, 400)
      const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url')
      const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'))
      const value = Buffer.from(JSON.stringify({ state, verifier, returnTo, issuedAt: deps.now() })).toString('base64url')
      const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${config.origin}/auth/fluxer/callback`, response_type: 'code', scope: 'identify guilds', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })
      try {
        const api = await discoverProvider(deps.fetch)
        return redirect(authorizeUrl(api, query), [cookie(config, handshakeCookie, `${value}.${signature(value, config.sessionSecret)}`, 600)])
      } catch { return json({ error: 'Fluxer sign-in is temporarily unavailable. Try again' }, 503) }
    },
    async callback(request: Request): Promise<Response> {
      const clear = cookie(config, handshakeCookie, '', 0)
      const handshake = decodeHandshake(cookieValue(request, handshakeCookie), config)
      const params = new URL(request.url).searchParams
      if (new URL(request.url).origin !== config.origin || !handshake || typeof handshake.issuedAt !== 'number' || deps.now() < handshake.issuedAt || deps.now() - handshake.issuedAt > maxHandshakeAge || params.get('state') !== handshake.state) {
        return redirect('/?authError=state', [clear])
      }
      const code = params.get('code')
      if (params.has('error') || !code || code.length > 256) return redirect('/?authError=denied', [clear])
      try {
        const api = await discoverProvider(deps.fetch)
        const response = await deps.fetch(`${api}/v1/oauth2/token`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: `${config.origin}/auth/fluxer/callback`, code_verifier: handshake.verifier }) })
        if (!response.ok) throw new Error('Sign-in unavailable')
        const data = await response.json() as { access_token?: unknown, token_type?: unknown, scope?: unknown }
        if (typeof data.access_token !== 'string' || typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' || typeof data.scope !== 'string') throw new Error('Sign-in unavailable')
        const scopes = data.scope.split(/\s+/)
        if (!['identify', 'guilds'].every(scope => scopes.includes(scope))) throw new Error('Sign-in unavailable')
        const session = await deps.admit(data.access_token)
        return redirect(safeReturnTo(handshake.returnTo), [clear, cookie(config, sessionCookie, session.sessionToken, 8 * 3600)])
      } catch {
        return redirect('/?authError=unavailable', [clear])
      }
    },
    async session(request: Request): Promise<Response> {
      if (!sameOrigin(request, config.origin)) return json({ error: 'Invalid website origin' }, 403)
      const token = cookieValue(request)
      if (!token) return json({ user: null }, 401)
      try {
        const session = await deps.refresh(token)
        // Multi mode offers the bot invite. Single mode serves only its configured server
        return json({ ...session, sessionToken: token, convexUrl: config.convexUrl, ...(session.mode === 'multi' ? { inviteUrl: inviteUrl(config.clientId) } : {}) })
      } catch (error) {
        if (error instanceof ConvexError && typeof error.data === 'object' && error.data !== null && 'status' in error.data && (error.data.status === 401 || error.data.status === 403)) return json({ error: 'Session expired. Sign in again' }, 401, { 'Set-Cookie': cookie(config, sessionCookie, '', 0) })
        return json({ error: 'Session refresh unavailable. Try again' }, 503)
      }
    },
    async logout(request: Request): Promise<Response> {
      if (!sameOrigin(request, config.origin)) return json({ error: 'Invalid website origin' }, 403)
      const token = cookieValue(request)
      if (token) {
        try { await deps.logout(token) } catch { return json({ error: 'Sign-out failed. Try again' }, 503) }
      }
      return json({ signedOut: true }, 200, { 'Set-Cookie': cookie(config, sessionCookie, '', 0) })
    },
  }
}
