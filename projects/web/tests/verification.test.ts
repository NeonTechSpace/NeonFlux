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
  assert.equal((await handler(request({ operation: 'answer', challengeId: 'test', path: [] }))).status, 400)
  assert.equal((await handler(request({ operation: 'answer', challengeId: 'test', path: [] }, 'https://outside.invalid'))).status, 403)
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

test('Verification bridge forwards bounded timed paths and motion frames', async () => {
  const seen: unknown[] = [], path = [{ x: 24, y: 128, t: 0 }, { x: 25, y: 128, t: 100 }]
  const view = { challengeId: 'test', serverId: '2', panelName: 'rules', status: 'started' as const, linkExpiresAt: 10000, expiresAt: 9000, attemptsRemaining: 2, instruction: 'Guide the spark', motionFrames: 'A'.repeat(400000) }
  const handler = createVerificationHandler('http://localhost:3000', { inspect: async () => view, start: async () => view, answer: async args => { seen.push(args); return view } })
  const request = (body: unknown) => handler(new Request('http://localhost:3000/api/verification', { method: 'POST', headers: { origin: 'http://localhost:3000', cookie: 'neonflux_session=synthetic-session' }, body: JSON.stringify(body) }))
  assert.deepEqual(await (await request({ operation: 'inspect', linkToken: 'a'.repeat(32) })).json(), view)
  assert.equal((await request({ operation: 'answer', challengeId: 'test', path })).status, 200)
  assert.deepEqual(seen, [{ sessionToken: 'synthetic-session', challengeId: 'test', path }])
  for (const invalid of [[], [path[0]], Array.from({ length: 257 }, () => path[0]), [{ x: 256, y: 128, t: 0 }, path[1]], [{ x: 24, y: 128, t: 0.5 }, path[1]], [{ x: 24, y: 128, t: 0, extra: 1 }, path[1]]]) assert.equal((await request({ operation: 'answer', challengeId: 'test', path: invalid })).status, 400)
  assert.equal((await request({ operation: 'answer', challengeId: 'test', path, padding: 'x'.repeat(16384) })).status, 400)
  assert.equal(seen.length, 1)
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
