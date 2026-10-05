import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import type { VerificationView } from '@neonflux/backend/verification-contracts'
import { cookieValue, sameOrigin } from './auth.ts'

interface VerificationBridge {
  inspect: (args: { sessionToken: string, linkToken: string }) => Promise<VerificationView>
  start: (args: { sessionToken: string, linkToken: string, turnstileToken: string }) => Promise<VerificationView>
  answer: (args: { sessionToken: string, challengeId: string, selected: number[], round: number }) => Promise<VerificationView>
}
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
export function createVerificationHandler(origin: string, bridge: VerificationBridge, turnstileSiteKey = '') {
  return async (request: Request): Promise<Response> => {
    if (!sameOrigin(request, origin)) return Response.json({ error: 'Invalid website origin' }, { status: 403, headers })
    const sessionToken = cookieValue(request)
    if (!sessionToken) return Response.json({ error: 'Sign in before verification' }, { status: 401, headers })
    if (Number(request.headers.get('content-length') ?? 0) > 4096) return Response.json({ error: 'Invalid request' }, { status: 400, headers })
    let body: unknown
    try { const raw = await request.text(); if (raw.length > 4096) throw new Error(); body = JSON.parse(raw) } catch { return Response.json({ error: 'Invalid request' }, { status: 400, headers }) }
    if (!body || typeof body !== 'object') return Response.json({ error: 'Invalid request' }, { status: 400, headers })
    const data = body as Record<string, unknown>
    try {
      if ((data.operation === 'inspect' || data.operation === 'start') && typeof data.linkToken === 'string' && /^[a-f0-9]{32}$/.test(data.linkToken)) {
        if (data.operation === 'start' && (typeof data.turnstileToken !== 'string' || !data.turnstileToken.trim() || data.turnstileToken.length > 2048)) return Response.json({ error: 'Complete the browser check before starting' }, { status: 400, headers })
        const view = data.operation === 'start'
          ? await bridge.start({ sessionToken, linkToken: data.linkToken, turnstileToken: data.turnstileToken as string })
          : await bridge.inspect({ sessionToken, linkToken: data.linkToken })
        return Response.json({ ...view, ...(view.status === 'issued' && turnstileSiteKey ? { turnstileSiteKey } : {}) }, { headers })
      }
      if (data.operation === 'answer' && typeof data.challengeId === 'string' && data.challengeId.length > 0 && data.challengeId.length <= 128 && Array.isArray(data.selected)) {
        const roundChoice = (data.round === 0 || data.round === 1) && data.selected.length === 1 && data.selected.every(choice => Number.isInteger(choice) && choice >= 0 && choice <= 5)
        if (roundChoice) return Response.json(await bridge.answer({ sessionToken, challengeId: data.challengeId, selected: data.selected as number[], round: data.round as number }), { headers })
      }
      return Response.json({ error: 'Invalid request' }, { status: 400, headers })
    } catch (error) {
      // Backend rejections are final for this link, so the page shows them without offering a retry. A rejected browser
      // check leaves the link usable, so it stays retryable with a fresh token
      const data = (error as { data?: { status?: unknown, error?: unknown } } | null)?.data, status = data?.status
      if (typeof status === 'number' && status >= 400 && status < 500 && typeof data?.error === 'string' && data.error.includes('Turnstile')) return Response.json({ error: 'The browser check was not accepted. Complete it again, then start the challenge' }, { status, headers })
      if (status === 401) return Response.json({ error: 'Your sign-in expired. Sign in again, then reopen the verification link', final: true }, { status, headers })
      if (status === 429) return Response.json({ error: 'Verification request limit reached. Contact server staff for assistance', final: true }, { status, headers })
      if (typeof status === 'number' && status >= 400 && status < 500) return Response.json({ error: 'This verification link can no longer be used. Return to the server and react to the verification panel for a new link', final: true }, { status, headers })
      return Response.json({ error: 'Verification unavailable. Check your link, connection and account, then try again' }, { status: 503, headers })
    }
  }
}
export async function verificationRoute(request: Request): Promise<Response> {
  if (!process.env.CONVEX_URL) return Response.json({ error: 'Verification is not configured' }, { status: 503, headers })
  const client = new ConvexHttpClient(process.env.CONVEX_URL)
  const reference = (name: string) => makeFunctionReference<'action', { sessionToken: string, linkToken: string }, VerificationView>(`verification:${name}`)
  return createVerificationHandler(process.env.WEB_ORIGIN ?? 'http://localhost:3000', {
    inspect: args => client.action(reference('inspect'), args),
    start: args => client.action(makeFunctionReference<'action', typeof args, VerificationView>('verification:start'), args),
    answer: args => client.action(makeFunctionReference<'action', typeof args, VerificationView>('verification:answer'), args),
  }, process.env.TURNSTILE_SITE_KEY?.trim())(request)
}
