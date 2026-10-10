import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { ConvexError } from 'convex/values'
import { createAuthHandlers, discoverProvider } from '../src/server/auth.ts'
import { NEONFLUX_BOT_PERMISSIONS } from '../src/server/invite.ts'
import type { AuthDependencies } from '../src/server/auth.ts'

const origin = 'http://localhost:3000'
const session = { sessionToken: 'synthetic-session-capability', user: { id: '1', name: 'Test user' }, mode: 'single' as const, servers: [{ id: '2', name: 'Test server', icon: null }], expiresAt: 400000 }
function fixture(overrides: Partial<AuthDependencies> = {}) {
  const calls: Array<{ url: string, init?: RequestInit }> = []
  const admitted: string[] = []
  const deps: AuthDependencies = {
    config: { origin, clientId: 'synthetic-client-id', clientSecret: 'synthetic-client-secret', convexUrl: 'https://synthetic.convex.cloud', sessionSecret: 'synthetic-handshake-key-longer-than-thirty-two' },
    now: () => 100000,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init }); return String(url).endsWith('/.well-known/fluxer') ? Response.json({ endpoints: { api_public: 'https://api.fluxer.app' } }) : Response.json({ access_token: 'synthetic-provider-token', token_type: 'bearer', scope: 'identify guilds' }) }) as typeof fetch,
    admit: async token => { admitted.push(token); return session },
    refresh: async () => session,
    logout: async () => null,
    ...overrides,
  }
  return { handlers: createAuthHandlers(deps), calls, admitted }
}
async function begin(f: ReturnType<typeof fixture>, suffix = '') {
  const response = await f.handlers.begin(new Request(`${origin}/auth/fluxer${suffix}`))
  const location = new URL(response.headers.get('location')!)
  const cookie = response.headers.getSetCookie()[0]!.split(';')[0]!
  return { response, location, cookie }
}
test('OAuth uses bound state, S256 PKCE and exact callback, and keeps provider credentials off returned session', async () => {
  const f = fixture(), started = await begin(f, '?returnTo=%2Fverify%3Ftoken%3D' + 'a'.repeat(32))
  assert.equal(started.location.searchParams.get('scope'), 'identify guilds')
  assert.equal(started.location.origin + started.location.pathname, 'https://api.fluxer.app/v1/oauth2/authorize')
  assert.equal(started.location.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(started.location.searchParams.get('redirect_uri'), `${origin}/auth/fluxer/callback`)
  assert.match(started.response.headers.getSetCookie()[0]!, /HttpOnly; SameSite=Lax; Max-Age=600/)
  const response = await f.handlers.callback(new Request(`${origin}/auth/fluxer/callback?code=synthetic-code&state=${started.location.searchParams.get('state')}`, { headers: { cookie: started.cookie } }))
  assert.equal(response.headers.get('location'), `/verify?token=${'a'.repeat(32)}`)
  assert.equal(f.calls[2]?.url, 'https://api.fluxer.app/v1/oauth2/token')
  const body = f.calls[2]!.init!.body as URLSearchParams
  assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'), started.location.searchParams.get('code_challenge'))
  assert.deepEqual(f.admitted, ['synthetic-provider-token'])
  assert.equal(response.headers.getSetCookie().some(cookie => cookie.includes('synthetic-provider-token')), false)
  const exposed = await f.handlers.session(new Request(`${origin}/api/session`, { method: 'POST', headers: { origin, cookie: 'neonflux_session=synthetic-session-capability' } }))
  assert.equal(exposed.status, 200)
  assert.equal(exposed.headers.get('cache-control'), 'no-store')
  const data = await exposed.json()
  assert.equal(data.sessionToken, session.sessionToken)
  assert.equal(JSON.stringify(data).includes('synthetic-provider-token'), false)
  assert.equal(JSON.stringify(data).includes('synthetic-client-secret'), false)
})
test('Wrong state, tampered or expired handshake never exchanges a code', async () => {
  for (const kind of ['state','tampered','expired']) {
    const f = fixture(), started = await begin(f)
    const target = kind === 'expired' ? fixture({ now: () => 800001 }) : f
    const response = await target.handlers.callback(new Request(`${origin}/auth/fluxer/callback?code=synthetic-code&state=${kind === 'state' ? 'wrong' : started.location.searchParams.get('state')}`, { headers: { cookie: started.cookie + (kind === 'tampered' ? 'tampered' : '') } }))
    assert.equal(response.headers.get('location'), '/?authError=state')
    assert.equal(target.calls.filter(call => call.url.endsWith('/oauth2/token')).length, 0)
  }
})
test('External return URLs are discarded and provider failure stays private', async () => {
  const f = fixture(), started = await begin(f, '?returnTo=https://outside.invalid')
  const success = await f.handlers.callback(new Request(`${origin}/auth/fluxer/callback?code=x&state=${started.location.searchParams.get('state')}`, { headers: { cookie: started.cookie } }))
  assert.equal(success.headers.get('location'), '/')
  const failed = fixture({ fetch: async () => { throw new Error('synthetic-private-error') } })
  const response = await failed.handlers.callback(new Request(`${origin}/auth/fluxer/callback?code=x&state=${started.location.searchParams.get('state')}`, { headers: { cookie: started.cookie } }))
  assert.equal(response.headers.get('location'), '/?authError=unavailable')
  assert.equal((await response.text()).includes('synthetic-private-error'), false)
  assert.equal(failed.admitted.length, 0)
})
test('Cross-origin session access and sign-out cannot expose or revoke a capability', async () => {
  let revoked = false
  const f = fixture({ logout: async () => { revoked = true } })
  for (const method of ['session', 'logout'] as const) {
    const response = await f.handlers[method](new Request(`${origin}/api/session`, { method: 'POST', headers: { origin: 'https://outside.invalid', cookie: 'neonflux_session=synthetic-session-capability' } }))
    assert.equal(response.status, 403)
  }
  assert.equal(revoked, false)
})
test('Transient refresh preserves the cookie, expired authorization clears it, failed sign-out keeps recoverable state', async () => {
  const request = new Request(`${origin}/api/session`, { method: 'POST', headers: { origin, cookie: 'neonflux_session=synthetic-session-capability' } })
  const transient = await fixture({ refresh: async () => { throw new Error('network') } }).handlers.session(request)
  assert.equal(transient.status, 503); assert.equal(transient.headers.has('set-cookie'), false)
  for (const status of [401, 403]) {
    const expired = await fixture({ refresh: async () => { throw new ConvexError({ status, message: 'Expired' }) } }).handlers.session(request)
    assert.equal(expired.status, 401); assert.match(expired.headers.get('set-cookie')!, /Max-Age=0/)
  }
  const signOut = await fixture({ logout: async () => { throw new Error('network') } }).handlers.logout(request)
  assert.equal(signOut.status, 503); assert.equal(signOut.headers.has('set-cookie'), false)
})
test('Official discovery allows its exact one-hop HTTPS redirect and rejects other destinations', async () => {
  const calls: string[] = []
  const fetcher = (async (url: string | URL | Request) => { calls.push(String(url)); return calls.length === 1 ? new Response(null, { status: 308, headers: { location: 'https://api.fluxer.app/.well-known/fluxer' } }) : Response.json({ endpoints: { api_public: 'https://api.fluxer.app' } }) }) as typeof fetch
  assert.equal(await discoverProvider(fetcher), 'https://api.fluxer.app')
  assert.equal(calls.length, 2)
  await assert.rejects(discoverProvider(async () => new Response(null, { status: 308, headers: { location: 'https://outside.invalid/discovery' } })))
})
test('Multi-server sessions carry the bot invite with the derived permissions, and single-server sessions do not', async () => {
  const request = () => new Request(`${origin}/api/session`, { method: 'POST', headers: { origin, cookie: 'neonflux_session=synthetic-session-capability' } })
  const multi = await (await fixture({ refresh: async () => ({ ...session, mode: 'multi' as const }) }).handlers.session(request())).json() as { inviteUrl?: string }
  const invite = new URL(multi.inviteUrl!)
  assert.equal(invite.origin + invite.pathname, 'https://api.fluxer.app/v1/oauth2/authorize')
  assert.deepEqual([...invite.searchParams], [['client_id', 'synthetic-client-id'], ['scope', 'bot'], ['permissions', '9008677076954326']])
  const single = await (await fixture().handlers.session(request())).json() as { inviteUrl?: string }
  assert.equal(single.inviteUrl, undefined)
  // Kick, Ban, Manage Channels, Add Reactions, View Audit Log, View Channel, Send Messages, Manage Messages, Embed Links,
  // Read Message History, Connect, Move Members, Change Nickname, Manage Roles, Moderate Members and Update RTC Region, as Fluxer numbers them
  assert.equal(NEONFLUX_BOT_PERMISSIONS, [1n, 2n, 4n, 6n, 7n, 10n, 11n, 13n, 14n, 16n, 20n, 24n, 26n, 28n, 35n, 36n, 38n, 40n, 53n].reduce((mask, bit) => mask | 1n << bit, 0n))
})
