import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import type { WebSession } from '../src/dashboard-api'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
// The query library decides once at load whether it runs in a browser, so it loads after the window exists
const { render, cleanup, act } = await import('@testing-library/react')
const { focusManager, notifyManager, defaultScheduler } = await import('@tanstack/react-query')
const { SessionProvider, useSession } = await import('../src/session.tsx')
afterEach(() => { cleanup(); focusManager.setFocused(undefined); notifyManager.setScheduler(defaultScheduler) })

function Probe() {
  const session = useSession()
  return createElement('p',null,`${session.data?.user.name ?? 'none'}${session.isError ? ' error' : ''}`)
}
// Event loop turns let fetches and React settle, bounded so a missing refresh fails instead of hanging
async function until(check: () => boolean) {
  for (let turn = 0; turn < 200 && !check(); turn++) await act(() => new Promise(resolve => setImmediate(resolve)))
  assert(check())
}
test('a hidden tab keeps refreshing its sign-in, and a transient failure recovers on the next refresh', async context => {
  // Timers are controlled, including the cache cleanup, and query updates are delivered as microtasks
  context.mock.timers.enable({ apis: ['setInterval','setTimeout'] })
  notifyManager.setScheduler(queueMicrotask)
  const session = { sessionToken: 'synthetic-session',convexUrl: 'https://synthetic.invalid',expiresAt: 1,user: { id: '1',name: 'Synthetic user' },mode: 'single',servers: [] } satisfies WebSession
  const responses = [Response.json(session),Response.json({ error: 'Session refresh unavailable. Try again' },{ status: 503 }),Response.json(session)]
  let calls = 0
  context.mock.method(globalThis,'fetch',async () => responses[calls++]!)
  focusManager.setFocused(false)
  const ui = render(createElement(SessionProvider,null,createElement(Probe)))
  const text = () => ui.container.textContent
  await until(() => text() === 'Synthetic user')
  context.mock.timers.tick(3 * 60 * 1000)
  await until(() => text() === 'Synthetic user error')
  assert.equal(calls,2)
  context.mock.timers.tick(3 * 60 * 1000)
  await until(() => text() === 'Synthetic user')
  assert.equal(calls,3)
})
