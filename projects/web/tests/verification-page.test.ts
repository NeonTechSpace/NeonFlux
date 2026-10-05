import assert from 'node:assert/strict'
import { afterEach, test, type TestContext } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { VerificationChallenge } from '../src/verification-page.tsx'
import type { VerificationView } from '@neonflux/backend/verification-contracts'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render, fireEvent, cleanup, act } = await import('@testing-library/react')
afterEach(() => { cleanup(); delete window.turnstile })
function browserCheck() {
  window.turnstile = {
    ready: () => { throw new Error('[Cloudflare Turnstile] Remove async/defer from the Turnstile api.js script tag before using turnstile.ready()') },
    render: (_container, options) => { options.callback('synthetic-turnstile-token'); return 'synthetic-widget' },
    reset: () => {}, remove: () => {},
  }
}
// Animation frames run only when the test calls them, and canvas fills are recorded by color
function motionCanvas(context: TestContext) {
  const callbacks = new Map<number, FrameRequestCallback>(), fills: string[] = []
  let handles = 0
  for (const [name, value] of Object.entries({ requestAnimationFrame: (callback: FrameRequestCallback) => { callbacks.set(++handles, callback); return handles }, cancelAnimationFrame: (handle: number) => { callbacks.delete(handle) } })) Object.defineProperty(window, name, { value, configurable: true, writable: true })
  context.after(() => { Reflect.deleteProperty(window, 'requestAnimationFrame'); Reflect.deleteProperty(window, 'cancelAnimationFrame') })
  const surface = { fillStyle: '', fillRect: () => { fills.push(surface.fillStyle) } }
  context.mock.method(window.HTMLCanvasElement.prototype, 'getContext', () => surface)
  return { fills, pending: () => callbacks.size, frame: (time: number) => { const due = [...callbacks.values()]; callbacks.clear(); for (const callback of due) callback(time) } }
}
const motionFrames = (color: number) => Buffer.from([1, 2, 10, 255, 1, 0, 128, 128, color, 1, 0, 129, 128, color]).toString('base64')

test('Start waits for Turnstile, clears expired tokens and resets after a failed submission', async context => {
  context.mock.method(Date, 'now', () => 100000)
  let callbacks: Parameters<NonNullable<Window['turnstile']>['render']>[1] | undefined
  let resets = 0, removals = 0
  window.turnstile = {
    ready: () => { throw new Error('[Cloudflare Turnstile] Remove async/defer from the Turnstile api.js script tag before using turnstile.ready()') },
    render: (_container, options) => { callbacks = options; return 'synthetic-widget' },
    reset: () => { resets++ }, remove: () => { removals++ },
  }
  const requests: Array<Record<string, unknown>> = []
  context.mock.method(globalThis, 'fetch', async (_: unknown, init: RequestInit) => {
    const data = JSON.parse(String(init.body)) as Record<string, unknown>
    requests.push(data)
    if (data.operation === 'start') return Response.json({ error: 'Synthetic provider failure' }, { status: 503 })
    return Response.json({ challengeId: 'test', panelName: 'Verify', serverId: '2', status: 'issued', linkExpiresAt: 700000, expiresAt: 700000, attemptsRemaining: 2, instruction: 'Test', turnstileSiteKey: 'synthetic-public-key' })
  })
  let ui!: ReturnType<typeof render>
  await act(async () => { ui = render(createElement(VerificationChallenge, { token: 'a'.repeat(32), userName: 'Test user' })) })
  const start = ui.getByRole('button', { name: 'Start challenge' }) as HTMLButtonElement
  assert.equal(start.disabled, true)
  assert.equal(callbacks?.action, 'verification_start')
  assert.equal(callbacks?.theme, 'dark')
  assert.equal(callbacks?.size, 'compact')
  await act(async () => { callbacks?.callback('synthetic-first-token') })
  assert.equal(start.disabled, false)
  await act(async () => { callbacks?.['expired-callback']() })
  assert.equal(start.disabled, true)
  await act(async () => { callbacks?.callback('synthetic-next-token') })
  await act(async () => { fireEvent.click(start) })
  assert.deepEqual(requests[1], { operation: 'start', linkToken: 'a'.repeat(32), turnstileToken: 'synthetic-next-token' })
  assert.equal(resets, 1)
  assert.equal(start.disabled, true)
  await act(async () => { callbacks?.callback('synthetic-retry-token') })
  assert.equal(start.disabled, false)
  ui.unmount()
  assert.equal(removals, 1)
})

test('An unconfigured browser check cannot start verification', async context => {
  context.mock.method(Date, 'now', () => 100000)
  context.mock.method(globalThis, 'fetch', async () => Response.json({ challengeId: 'test', panelName: 'Verify', serverId: '2', status: 'issued', linkExpiresAt: 700000, expiresAt: 700000, attemptsRemaining: 2, instruction: 'Test' }))
  let ui!: ReturnType<typeof render>
  await act(async () => { ui = render(createElement(VerificationChallenge, { token: 'a'.repeat(32), userName: 'Test user' })) })
  assert.equal((ui.getByRole('button', { name: 'Start challenge' }) as HTMLButtonElement).disabled, true)
  assert.ok(ui.getByRole('alert').textContent?.includes('Browser verification is not configured'))
})

test('A final rejection shows its message without a retry that cannot succeed', async context => {
  let calls = 0
  context.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: 'This verification link can no longer be used. Return to the server and react to the verification panel for a new link', final: true }, { status: 403 }) })
  let ui!: ReturnType<typeof render>
  await act(async () => { ui = render(createElement(VerificationChallenge, { token: 'a'.repeat(32), userName: 'Test user' })) })
  assert.match(ui.getByRole('alert').textContent ?? '', /can no longer be used/)
  assert.equal(ui.queryByRole('button', { name: 'Try again' }), null)
  assert.equal(ui.queryByRole('status'), null)
  assert.equal(calls, 1)
})



const activeView = (): VerificationView => ({ challengeId: 'spark1', panelName: 'internal_lowercase_name', serverId: '2', status: 'started', linkExpiresAt: 700000, expiresAt: 190000, attemptsRemaining: 2, instruction: 'Guide the spark along the moving current', motionFrames: motionFrames(0) })

test('Guide the spark submits one timed path and shows success without the internal panel name', async context => {
  context.mock.method(Date, 'now', () => 100000)
  const motion = motionCanvas(context), requests: Array<Record<string, unknown>> = []
  context.mock.method(globalThis, 'fetch', async (_: unknown, init: RequestInit) => {
    const data = JSON.parse(String(init.body)) as Record<string, unknown>
    requests.push(data)
    return Response.json(data.operation === 'answer' ? { ...activeView(), status: 'solved', motionFrames: undefined } : activeView())
  })
  let ui!: ReturnType<typeof render>
  await act(async () => { ui = render(createElement(VerificationChallenge, { token: 'a'.repeat(32), userName: 'Test user' })) })
  assert.ok(ui.getByRole('heading', { name: 'Server verification' }))
  assert.equal(ui.queryByText('internal_lowercase_name'), null)
  assert.ok(ui.getByRole('timer', { name: '90 seconds remaining' }))
  fireEvent.keyDown(ui.getByRole('application'), { key: 'ArrowRight' })
  await act(async () => { motion.frame(0); motion.frame(16); for (let t = 116; t <= 5516; t += 100) motion.frame(t) })
  assert.equal(requests.length, 2)
  assert.equal(requests[1]!.operation, 'answer')
  assert.equal(requests[1]!.challengeId, 'spark1')
  const path = requests[1]!.path as Array<{ x: number, y: number, t: number }>
  assert.deepEqual(path[0], { x: 24, y: 128, t: 0 })
  assert.ok(path.length > 2 && path.length <= 256)
  assert.ok(ui.getByText('Verification complete'))
  assert.ok(ui.getByText('Challenge accepted. Your access role is pending'))
  assert.equal(ui.queryByRole('application'), null)
})

test('Staff assistance pauses the canvas and expiry shows how to get a new link', async context => {
  let time = 100000, tick: (() => void) | undefined
  context.mock.method(Date, 'now', () => time)
  context.mock.method(window, 'setInterval', (callback: () => void) => { tick = callback; return 1 })
  context.mock.method(window, 'clearInterval', () => {})
  const motion = motionCanvas(context)
  context.mock.method(globalThis, 'fetch', async () => Response.json(activeView()))
  let ui!: ReturnType<typeof render>
  await act(async () => { ui = render(createElement(VerificationChallenge, { token: 'a'.repeat(32), userName: 'Test user' })) })
  motion.frame(0); motion.frame(16)
  const details = ui.container.querySelector('details')!
  await act(async () => { details.open = true; fireEvent(details, new window.Event('toggle')) })
  assert.equal(motion.pending(), 0)
  await act(async () => { details.open = false; fireEvent(details, new window.Event('toggle')) })
  assert.equal(motion.pending(), 1)
  time = 190000
  await act(async () => { tick?.() })
  assert.ok(ui.getByText("Time's up"))
  assert.ok(ui.getByText('Return to the server and react to the verification panel for a new link'))
  assert.equal(ui.queryByRole('application'), null)
  assert.equal(motion.pending(), 0)
})

for (const lostResponse of [false, true]) test('Connection recovery ' + (lostResponse ? 'resets after a consumed attempt' : 'preserves the sampled path'), async context => {
  context.mock.method(Date, 'now', () => 100000)
  const motion = motionCanvas(context)
  let view = activeView(), fail = true
  context.mock.method(globalThis, 'fetch', async (_: unknown, init: RequestInit) => {
    const data = JSON.parse(String(init.body)) as Record<string, unknown>
    if (data.operation === 'answer' && fail) { if (lostResponse) view = { ...view, attemptsRemaining: 1 }; throw new Error('Synthetic connection failure') }
    return Response.json(view)
  })
  let ui!: ReturnType<typeof render>
  await act(async () => { ui = render(createElement(VerificationChallenge, { token: 'a'.repeat(32), userName: 'Test user' })) })
  fireEvent.keyDown(ui.getByRole('application'), { key: 'ArrowRight' })
  await act(async () => { motion.frame(0); motion.frame(16); for (let t = 116; t <= 5516; t += 100) motion.frame(t) })
  assert.ok(ui.getByRole('alert'))
  fail = false
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'Try again' })) })
  assert.equal(ui.queryByRole('alert'), null)
  assert.equal(ui.queryByRole('button', { name: 'Submit path again' }) !== null, !lostResponse)
  if (lostResponse) { assert.ok(ui.getByText('1 attempt remaining')); assert.equal(motion.pending(), 1) }
})

test('A final answer rejection stops play', async context => {
  context.mock.method(Date, 'now', () => 100000)
  const motion = motionCanvas(context)
  context.mock.method(globalThis, 'fetch', async (_: unknown, init: RequestInit) => JSON.parse(String(init.body)).operation === 'answer' ? Response.json({ final: true, error: 'This verification link can no longer be used' }, { status: 409 }) : Response.json(activeView()))
  let ui!: ReturnType<typeof render>
  await act(async () => { ui = render(createElement(VerificationChallenge, { token: 'a'.repeat(32), userName: 'Test user' })) })
  fireEvent.keyDown(ui.getByRole('application'), { key: 'ArrowRight' })
  await act(async () => { motion.frame(0); motion.frame(16); for (let t = 116; t <= 5516; t += 100) motion.frame(t) })
  assert.ok(ui.getByText('This verification link can no longer be used'))
  assert.equal(ui.queryByRole('application'), null)
  assert.equal(motion.pending(), 0)
})
