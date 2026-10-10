import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { getFunctionName } from 'convex/server'
import type { ConvexReactClient } from 'convex/react'
import type { WebSession } from '../src/dashboard-api.ts'
import { ServerDashboard } from '../src/dashboard.tsx'
import { preloadSections } from '../src/dashboard-sections.tsx'
import { tourSteps } from '../src/dashboard-tour.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
await preloadSections()
afterEach(() => { cleanup(); window.localStorage.clear() })

const client = {
  connectionState: () => ({ isWebSocketConnected: true }),
  subscribeToConnectionState: () => () => {},
  action: async () => new Promise(() => {}),
  mutation: async () => null,
  watchQuery: (ref: unknown,args: { serverId: string }) => ({ localQueryResult: () => getFunctionName(ref as never) === 'dashboardViews:overview' ? { serverId: args.serverId,sections: [] } : undefined,onUpdate: () => () => {} }),
} as unknown as ConvexReactClient
const session = (userId: string): WebSession => ({ sessionToken: 'synthetic-session',convexUrl: 'https://synthetic.invalid',expiresAt: 1,user: { id: userId,name: 'Synthetic manager' },mode: 'single',servers: [{ id: '2',name: 'Synthetic server',icon: null }] })
const show = (userId: string) => render(createElement(ServerDashboard,{ session: session(userId),client,accessAvailable: true }))

test('The tour opens on a manager\'s first visit, steps through with the keyboard focus on each step, and never opens again once finished', async () => {
  const ui = show('1')
  const tour = () => ui.getByRole('dialog',{ name: tourSteps[0]!.title })
  assert.equal(tour().getAttribute('aria-modal'),'false')
  assert.equal(document.activeElement,ui.getByRole('heading',{ name: tourSteps[0]!.title }))
  assert.ok(within(tour()).getByText('Dashboard tour, step 1 of 5'))
  assert.ok(within(ui.getByRole('dialog')).getByRole('button',{ name: 'Previous step' }).hasAttribute('disabled'))
  for (const step of tourSteps.slice(1)) {
    await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Next step' })) })
    assert.equal(document.activeElement,ui.getByRole('heading',{ name: step.title }))
    assert.equal(ui.getByRole('dialog').getAttribute('aria-describedby'),'tour-text')
  }
  // The steps explain the overview, sections, drafts, the audit log and where !setup and !help fit
  assert.match(tourSteps.map(step => step.text).join(' '),/Overview.*sidebar.*drafts.*Audit log.*!setup.*!help/s)
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Finish tour' })) })
  assert.equal(ui.queryByRole('dialog'),null)
  cleanup()
  assert.equal(show('1').queryByRole('dialog'),null)
})

test('Escape dismisses the tour for good, another account still sees it, and the help link restarts it at the first step', async () => {
  const ui = show('1')
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Next step' })) })
  await act(async () => { fireEvent.keyDown(ui.getByRole('dialog'),{ key: 'Escape' }) })
  assert.equal(ui.queryByRole('dialog'),null)
  cleanup()
  const again = show('1')
  assert.equal(again.queryByRole('dialog'),null)
  await act(async () => { fireEvent.click(again.getByRole('button',{ name: 'Dashboard tour' })) })
  assert.ok(again.getByRole('dialog',{ name: tourSteps[0]!.title }))
  await act(async () => { fireEvent.click(again.getByRole('button',{ name: 'Skip tour' })) })
  assert.equal(again.queryByRole('dialog'),null)
  cleanup()
  assert.ok(show('7').getByRole('dialog'))
})
