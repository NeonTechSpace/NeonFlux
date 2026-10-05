import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createVerificationHandler } from '../src/server/verification.ts'

test('Verification bridge takes identity only from HttpOnly session and rejects cross-origin/malformed answers', async () => {
  const seen: unknown[] = []
  const view = { challengeId: 'test', serverId: '2', panelName: 'Test', status: 'started' as const, linkExpiresAt: 10000, expiresAt: 9000, attemptsRemaining: 2, instruction: 'Test' }
  const handler = createVerificationHandler('http://localhost:3000', { inspect: async args => { seen.push(args); return view }, start: async args => { seen.push(args); return view }, answer: async args => { seen.push(args); return view } })
  const request = (body: unknown, origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/verification', { method: 'POST', headers: { origin, cookie: 'neonflux_session=synthetic-cookie-session' }, body: JSON.stringify(body) })
  assert.equal((await handler(request({ operation: 'start', linkToken: 'a'.repeat(32), turnstileToken: 'synthetic-browser-check', sessionToken: 'browser-forged', userId: 'browser-forged' }))).status, 200)
  assert.deepEqual(seen, [{ sessionToken: 'synthetic-cookie-session', linkToken: 'a'.repeat(32), turnstileToken: 'synthetic-browser-check' }])
  assert.equal((await handler(request({ operation: 'answer', challengeId: 'test', selected: [0,0,1,2] }))).status, 400)
  assert.equal((await handler(request({ operation: 'answer', challengeId: 'test', selected: [0,1,2,3] }, 'https://outside.invalid'))).status, 403)
  assert.equal(seen.length, 1)
})

test('Verification start requires a bounded browser token and only exposes the public site key', async () => {
  const seen: unknown[] = []
  const view = { challengeId: 'test', serverId: '2', panelName: 'Test', status: 'issued' as const, linkExpiresAt: 10000, expiresAt: 10000, attemptsRemaining: 2, instruction: 'Test' }
  const handler = createVerificationHandler('http://localhost:3000', { inspect: async () => view, start: async args => { seen.push(args); return view }, answer: async () => view }, 'synthetic-public-key')
  const request = (body: unknown) => new Request('http://localhost:3000/api/verification', { method: 'POST', headers: { origin: 'http://localhost:3000', cookie: 'neonflux_session=synthetic-session' }, body: JSON.stringify(body) })
  for (const turnstileToken of [undefined, '', ' ', null, 42, 'x'.repeat(2049)]) {
    assert.equal((await handler(request({ operation: 'start', linkToken: 'a'.repeat(32), turnstileToken }))).status, 400)
  }
  assert.equal(seen.length, 0)
  const inspected = await (await handler(request({ operation: 'inspect', linkToken: 'a'.repeat(32) }))).json()
  assert.deepEqual(inspected, { ...view, turnstileSiteKey: 'synthetic-public-key' })
  const started = await handler(request({ operation: 'start', linkToken: 'a'.repeat(32), turnstileToken: 'x'.repeat(2048) }))
  assert.equal(started.status, 200)
  assert.equal(seen.length, 1)
})

test('Verification bridge forwards one bounded choice per round and rejects four-tile answers', async () => {
  const seen: unknown[] = []
  const view = { challengeId: 'test', serverId: '2', panelName: 'Test', status: 'started' as const, linkExpiresAt: 10000, expiresAt: 9000, attemptsRemaining: 2, instruction: 'Test' }
  const handler = createVerificationHandler('http://localhost:3000', { inspect: async () => view, start: async () => view, answer: async args => { seen.push(args); return view } })
  const answer = (selected: unknown, extra: Record<string, unknown> = {}) => handler(new Request('http://localhost:3000/api/verification', { method: 'POST', headers: { origin: 'http://localhost:3000', cookie: 'neonflux_session=synthetic-cookie-session' }, body: JSON.stringify({ operation: 'answer', challengeId: 'test', selected, ...extra }) }))
  for (const round of [0, 1]) assert.equal((await answer([5], { round })).status, 200)
  assert.equal((await answer([0, 1, 2, 15])).status, 400)
  assert.deepEqual(seen, [
    { sessionToken: 'synthetic-cookie-session', challengeId: 'test', selected: [5], round: 0 },
    { sessionToken: 'synthetic-cookie-session', challengeId: 'test', selected: [5], round: 1 },
  ])
  for (const round of [-1, 2, 0.5, '0', null]) assert.equal((await answer([0], { round })).status, 400)
  for (const selected of [[], [0, 1], [-1], [6], [0.5], ['0'], [0, 1, 2, 3]]) assert.equal((await answer(selected, { round: 0 })).status, 400)
  assert.equal((await answer([0])).status, 400)
  assert.equal((await answer([0, 0, 1, 2])).status, 400)
  assert.equal(seen.length, 2)
})

test('Verification bridge passes uncapped motion frames through and forwards one bounded motion choice per round', async () => {
  const seen: unknown[] = []
  const view = { challengeId: 'test', serverId: '2', panelName: 'Test', status: 'started' as const, linkExpiresAt: 10000, expiresAt: 9000, attemptsRemaining: 2, instruction: 'Test', captchaKind: 'motion' as const, round: 0, roundCount: 2, imageDataUri: 'data:image/png;base64,choices', motionFrames: 'A'.repeat(200000) }
  const handler = createVerificationHandler('http://localhost:3000', { inspect: async () => view, start: async () => view, answer: async args => { seen.push(args); return view } })
  const request = (body: unknown) => handler(new Request('http://localhost:3000/api/verification', { method: 'POST', headers: { origin: 'http://localhost:3000', cookie: 'neonflux_session=synthetic-cookie-session' }, body: JSON.stringify(body) }))
  const inspected = await request({ operation: 'inspect', linkToken: 'a'.repeat(32) })
  assert.equal(inspected.status, 200)
  assert.deepEqual(await inspected.json(), view)
  for (const round of [0, 1]) assert.equal((await request({ operation: 'answer', challengeId: 'test', selected: [3], round })).status, 200)
  assert.deepEqual(seen, [0, 1].map(round => ({ sessionToken: 'synthetic-cookie-session', challengeId: 'test', selected: [3], round })))
  for (const extra of [{ selected: [3, 4], round: 0 }, { selected: [6], round: 1 }, { selected: [3], round: 2 }, { selected: [3] }, { selected: [3], round: 0, padding: 'x'.repeat(4096) }]) assert.equal((await request({ operation: 'answer', challengeId: 'test', ...extra })).status, 400)
  assert.equal(seen.length, 2)
})

test('Verification maps final backend rejections to final messages and keeps transient failures retryable', async () => {
  const failure = (status?: number) => Object.assign(new Error('synthetic backend failure'), status === undefined ? {} : { data: { status, error: 'Synthetic rejection' } })
  const handlerFor = (error: Error) => createVerificationHandler('http://localhost:3000', { inspect: async () => { throw error }, start: async () => { throw error }, answer: async () => { throw error } })
  const request = () => new Request('http://localhost:3000/api/verification', { method: 'POST', headers: { origin: 'http://localhost:3000', cookie: 'neonflux_session=synthetic-session' }, body: JSON.stringify({ operation: 'inspect', linkToken: 'a'.repeat(32) }) })
  for (const status of [401, 403, 404, 409, 429]) {
    const response = await handlerFor(failure(status))(request())
    assert.equal(response.status, status)
    assert.equal((await response.json() as { final?: boolean }).final, true)
  }
  const transient = await handlerFor(failure())(request())
  assert.equal(transient.status, 503)
  assert.equal((await transient.json() as { final?: boolean }).final, undefined)
})

test('Verification keeps a rejected Turnstile token retryable', async () => {
  for (const [status, message] of [[400, 'Complete the Turnstile verification'], [403, 'Turnstile verification failed. Please try again']] as const) {
    const error = Object.assign(new Error('synthetic backend failure'), { data: { status, error: message } })
    const handler = createVerificationHandler('http://localhost:3000', { inspect: async () => { throw error }, start: async () => { throw error }, answer: async () => { throw error } })
    const response = await handler(new Request('http://localhost:3000/api/verification', { method: 'POST', headers: { origin: 'http://localhost:3000', cookie: 'neonflux_session=synthetic-session' },
      body: JSON.stringify({ operation: 'start', linkToken: 'a'.repeat(32), turnstileToken: 'synthetic-turnstile-token' }) }))
    assert.equal(response.status, status)
    assert.equal((await response.json() as { final?: boolean }).final, undefined)
  }
})
