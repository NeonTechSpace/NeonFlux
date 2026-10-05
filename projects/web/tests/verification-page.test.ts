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

test('Motion verification animates the live canvas above the choices and sends one choice per round', async context => {
  browserCheck()
  context.mock.method(Date, 'now', () => 100000)
  const { fills, frame } = motionCanvas(context), frames = motionFrames
  const requests: Array<Record<string, unknown>> = []
  let view: VerificationView = { challengeId: 'motion1', panelName: 'Verify', serverId: '2', status: 'issued', linkExpiresAt: 700000, expiresAt: 700000, attemptsRemaining: 2, instruction: 'Choose the shape moving against its surroundings' }
  context.mock.method(globalThis, 'fetch', async (_: unknown, init: RequestInit) => {
    const data = JSON.parse(String(init.body)) as Record<string, unknown>
    requests.push(data)
    if (data.operation === 'start') view = { ...view, status: 'started', expiresAt: 190000, captchaKind: 'motion', round: 0, roundCount: 2, imageDataUri: 'data:image/png;base64,choices0', motionFrames: frames(0) }
    if (data.operation === 'answer') view = data.round === 0 ? { ...view, round: 1, imageDataUri: 'data:image/png;base64,choices1', motionFrames: frames(1) } : { ...view, status: 'solved', imageDataUri: undefined, motionFrames: undefined }
    return Response.json({ ...view, turnstileSiteKey: 'synthetic-site-key' })
  })
  let ui!: ReturnType<typeof render>
  await act(async () => { ui = render(createElement(VerificationChallenge, { token: 'a'.repeat(32), userName: 'Test user' })) })
  assert.ok(ui.getByText(/uses moving dots.*request staff assistance/))
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'Start challenge' })) })
  assert.ok(ui.getByText('Round 1 of 2'))
  const canvas = ui.getByRole('img', { name: /visible only through motion/ }), choices = ui.getByRole('img', { name: /Six shape choices/ })
  assert.equal(canvas.tagName, 'CANVAS')
  assert.equal(canvas.compareDocumentPosition(choices) & window.Node.DOCUMENT_POSITION_FOLLOWING, window.Node.DOCUMENT_POSITION_FOLLOWING)
  assert.equal(choices.getAttribute('src'), 'data:image/png;base64,choices0')
  assert.equal(choices.getAttribute('width'), null)
  assert.equal(ui.getAllByRole('button', { name: /^Option [A-F]$/ }).length, 6)
  frame(0)
  frame(16)
  assert.deepEqual(fills.splice(0), ['#0e121d', '#0e121d', '#3ae0dd'])
  fireEvent.click(ui.getByRole('button', { name: 'Option D' }))
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'Continue' })) })
  assert.deepEqual(requests[2], { operation: 'answer', challengeId: 'motion1', selected: [3], round: 0 })
  assert.ok(ui.getByText('Round 2 of 2'))
  assert.ok(ui.getByText('No option selected'))
  frame(32)
  assert.deepEqual(fills.splice(0), ['#0e121d'])
  frame(48)
  assert.deepEqual(fills.splice(0), ['#0e121d', '#ff69b4'])
  fireEvent.click(ui.getByRole('button', { name: 'Option A' }))
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'Submit choices' })) })
  assert.deepEqual(requests[3], { operation: 'answer', challengeId: 'motion1', selected: [0], round: 1 })
  assert.ok(ui.getByText('Challenge accepted. Your access role is pending'))
  assert.equal(ui.queryByText('Your access role was applied'), null)
  assert.equal(ui.queryByRole('img'), null)
})

test('Motion dots pause while staff assistance is open and disappear when the countdown ends', async context => {
  let time = 100000, tick: (() => void) | undefined
  context.mock.method(Date, 'now', () => time)
  context.mock.method(window, 'setInterval', (callback: () => void) => { tick = callback; return 1 })
  context.mock.method(window, 'clearInterval', () => {})
  const motion = motionCanvas(context)
  context.mock.method(globalThis, 'fetch', async () => Response.json({ challengeId: 'motion2', panelName: 'Verify', serverId: '2', status: 'started', linkExpiresAt: 700000, expiresAt: 190000, attemptsRemaining: 2, instruction: 'Choose the shape', captchaKind: 'motion', round: 0, roundCount: 2, imageDataUri: 'data:image/png;base64,choices', motionFrames: motionFrames(0) } satisfies VerificationView))
  let ui!: ReturnType<typeof render>
  await act(async () => { ui = render(createElement(VerificationChallenge, { token: 'a'.repeat(32), userName: 'Test user' })) })
  const details = ui.container.querySelector('details')!, assistance = async (open: boolean) => { await act(async () => { details.open = open; fireEvent(details, new window.Event('toggle')) }) }
  motion.frame(0)
  motion.frame(16)
  assert.equal(motion.fills.splice(0).length, 3)
  await assistance(true)
  assert.ok(ui.getByRole('img', { name: /visible only through motion/ }))
  assert.equal(motion.pending(), 0)
  await assistance(false)
  assert.equal(motion.pending(), 1)
  motion.frame(1000)
  motion.frame(1100)
  assert.equal(motion.fills.splice(0).length, 3)
  time = 189000
  await act(async () => { tick?.() })
  assert.ok(ui.getByRole('img', { name: /visible only through motion/ }))
  time = 190000
  await act(async () => { tick?.() })
  assert.ok(ui.getByText('0 seconds remaining'))
  assert.equal(ui.queryByRole('img', { name: /visible only through motion/ }), null)
  assert.ok(ui.getByRole('img', { name: /Six shape choices/ }))
  assert.equal(motion.pending(), 0)
  motion.frame(2000)
  assert.deepEqual(motion.fills, [])
})

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

for (const responseLost of [false, true]) test(`Motion verification preserves selections on connection failure and inspect ${responseLost ? 'recovers an advanced round' : 'preserves an unchanged round'}`, async context => {
  context.mock.method(Date, 'now', () => 100000)
  motionCanvas(context)
  let view: VerificationView = { challengeId: 'motion3', panelName: 'Verify', serverId: '2', status: 'started', linkExpiresAt: 700000, expiresAt: 190000, attemptsRemaining: 2, instruction: 'Choose the shape', captchaKind: 'motion', round: 0, roundCount: 2, imageDataUri: 'data:image/png;base64,choices0', motionFrames: motionFrames(0) }
  const requests: Array<Record<string, unknown>> = []
  context.mock.method(globalThis, 'fetch', async (_: unknown, init: RequestInit) => {
    const data = JSON.parse(String(init.body)) as Record<string, unknown>
    requests.push(data)
    if (data.operation === 'answer') {
      if (responseLost) view = { ...view, round: 1, imageDataUri: 'data:image/png;base64,choices1', motionFrames: motionFrames(1) }
      throw new Error('Synthetic connection failure')
    }
    return Response.json(view)
  })
  let ui!: ReturnType<typeof render>
  await act(async () => { ui = render(createElement(VerificationChallenge, { token: 'a'.repeat(32), userName: 'Test user' })) })
  fireEvent.click(ui.getByRole('button', { name: 'Option C' }))
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'Continue' })) })
  assert.ok(ui.getByText('Option C selected'))
  assert.ok(ui.getByRole('alert'))
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'Try again' })) })
  assert.deepEqual(requests.map(request => request.operation), ['inspect', 'answer', 'inspect'])
  assert.equal(ui.queryByRole('alert'), null)
  if (responseLost) {
    assert.ok(ui.getByText('Round 2 of 2'))
    assert.ok(ui.getByText('No option selected'))
    assert.equal((ui.getByRole('button', { name: 'Submit choices' }) as HTMLButtonElement).disabled, true)
  } else {
    assert.ok(ui.getByText('Round 1 of 2'))
    assert.ok(ui.getByText('Option C selected'))
    assert.equal((ui.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled, false)
  }
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

test('A final answer rejection removes the challenge and stops the motion canvas', async context => {
  browserCheck()
  context.mock.method(Date, 'now', () => 100000)
  const motion = motionCanvas(context)
  let view: VerificationView = { challengeId: 'motion4', panelName: 'Verify', serverId: '2', status: 'issued', linkExpiresAt: 700000, expiresAt: 700000, attemptsRemaining: 2, instruction: 'Choose the shape moving against its surroundings' }
  context.mock.method(globalThis, 'fetch', async (_: unknown, init: RequestInit) => {
    const data = JSON.parse(String(init.body)) as Record<string, unknown>
    if (data.operation === 'answer') return Response.json({ error: 'This verification link can no longer be used', final: true }, { status: 409 })
    if (data.operation === 'start') view = { ...view, status: 'started', expiresAt: 190000, captchaKind: 'motion', round: 0, roundCount: 2, imageDataUri: 'data:image/png;base64,choices0', motionFrames: motionFrames(0) }
    return Response.json({ ...view, turnstileSiteKey: 'synthetic-site-key' })
  })
  let ui!: ReturnType<typeof render>
  await act(async () => { ui = render(createElement(VerificationChallenge, { token: 'a'.repeat(32), userName: 'Test user' })) })
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'Start challenge' })) })
  motion.frame(0)
  assert.equal(motion.pending(), 1)
  fireEvent.click(ui.getByRole('button', { name: 'Option D' }))
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'Continue' })) })
  assert.ok(ui.getByText('This verification link can no longer be used'))
  assert.equal(ui.queryByRole('img'), null)
  assert.equal(ui.queryByRole('button', { name: 'Continue' }), null)
  assert.equal(motion.pending(), 0)
})
