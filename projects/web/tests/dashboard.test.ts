import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { getFunctionName } from 'convex/server'
import type { ConvexReactClient } from 'convex/react'
import type { DashboardConfigurationSnapshot, DashboardSnapshot } from '@neonflux/backend/dashboard-contracts'
import type { WebSession } from '../src/dashboard-api.ts'
import { ServerDashboard } from '../src/dashboard.tsx'
import { SearchPicker } from '../src/search-picker.tsx'
import { ConfigForm } from '../src/configuration-form.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act } = await import('@testing-library/react')
afterEach(cleanup)

const servers = [{ id: '2',name: 'Synthetic Alpha',icon: 'https://fluxerusercontent.com/icons/2/abc.webp?size=128&animated=false' },{ id: '3',name: 'Synthetic beta',icon: null }]
function snapshot(serverId: string): DashboardSnapshot { return { serverId,messages: [],general: { prefix: '!',revision: 0 },status: [],roles: { revision: 0,settings: { panelsEnabled: false,verificationEnabled: false,autoroleEnabled: false,humansOnly: true,autoroleIds: [],revision: 1 },panels: [],jobs: [] } } }
function nickname(serverId: string): DashboardConfigurationSnapshot { return { family: 'nickname',serverId,configRevision: 0,data: { settings: { nickname: null,revision: 0,result: null } },jobs: [] } }
function harness(mode: WebSession['mode'],list = servers,extra: Partial<WebSession> = {}) {
  const watched: string[] = []
  const client = {
    connectionState: () => ({ isWebSocketConnected: true }),
    subscribeToConnectionState: () => () => {},
    action: async () => new Promise(() => {}),
    watchQuery: (ref: unknown,args: { serverId: string }) => { const name = getFunctionName(ref as never); watched.push(`${name}:${args.serverId}`); return { localQueryResult: () => name === 'dashboardConfiguration:snapshot' ? nickname(args.serverId) : snapshot(args.serverId),onUpdate: () => () => {} } },
  } as unknown as ConvexReactClient
  const session: WebSession = { sessionToken: 'synthetic-session',convexUrl: 'https://synthetic.invalid',expiresAt: 1,user: { id: '1',name: 'Synthetic user' },mode,servers: list,...extra }
  return { ui: render(createElement(ServerDashboard,{ session,client,accessAvailable: true })),watched }
}

test('Multi-server mode opens on a server picker with icons or initials and the header switches back', async () => {
  const { ui,watched } = harness('multi')
  assert.ok(ui.getByRole('heading',{ name: 'Choose a server' }))
  assert.deepEqual(watched,[])
  assert.equal(ui.queryByRole('navigation',{ name: 'Configuration sections' }),null)
  const alpha = ui.getByRole('button',{ name: 'Configure Synthetic Alpha' }), beta = ui.getByRole('button',{ name: 'Configure Synthetic beta' })
  assert.equal(alpha.querySelector('img')?.getAttribute('src'),servers[0]!.icon)
  assert.equal(beta.querySelector('img'),null)
  assert.equal(beta.querySelector('.initials')?.textContent,'SB')
  await act(async () => { fireEvent.click(beta) })
  assert.ok(ui.getByRole('heading',{ name: 'Synthetic beta' }))
  assert.deepEqual(watched,['dashboard:snapshot:3','dashboardConfiguration:snapshot:3'])
  assert.ok(ui.getByRole('region',{ name: 'General' }))
  assert.ok(ui.getByRole('region',{ name: 'Bot nickname' }))
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Switch server' })) })
  assert.ok(ui.getByRole('heading',{ name: 'Choose a server' }))
})
const invite = 'https://api.fluxer.app/v1/oauth2/authorize?client_id=30&scope=bot&permissions=1099847265494'
test('Multi-server mode offers the bot invite after the servers and in the empty state, and single mode never does', () => {
  const picker = harness('multi',servers,{ inviteUrl: invite }).ui
  const cards = picker.getAllByRole('listitem')
  const add = picker.getByRole('link',{ name: /Add NeonFlux to a server/ })
  assert.equal(add.getAttribute('href'),invite)
  assert.equal(add.getAttribute('target'),'_blank')
  assert.equal(cards.at(-1)?.contains(add),true)
  cleanup()
  const empty = harness('multi',[],{ inviteUrl: invite }).ui
  assert.ok(empty.getByRole('heading',{ name: 'No manageable servers' }))
  assert.equal(empty.getByRole('link',{ name: 'Add NeonFlux to a server' }).getAttribute('href'),invite)
  cleanup()
  const single = harness('single',[],{ inviteUrl: invite }).ui
  assert.ok(single.getByText(/own a configured NeonFlux server/))
  assert.equal(single.queryByRole('link'),null)
})
test('Single-server mode opens straight on its server without a picker or switch control', () => {
  const { ui,watched } = harness('single',servers.slice(0,1))
  assert.equal(ui.queryByRole('heading',{ name: 'Choose a server' }),null)
  assert.equal(ui.queryByRole('button',{ name: 'Switch server' }),null)
  assert.ok(ui.getByRole('heading',{ name: 'Synthetic Alpha' }))
  assert.deepEqual(watched,['dashboard:snapshot:2','dashboardConfiguration:snapshot:2'])
})
test('A disabled picker closes its open result list', () => {
  const options = [{ id: '5',name: 'general' }], props = { label: 'Channel',options,value: [],onChange: () => {} }
  const ui = render(createElement(SearchPicker,props))
  fireEvent.focus(ui.getByRole('combobox'))
  assert.ok(ui.getByRole('listbox'))
  ui.rerender(createElement(SearchPicker,{ ...props,disabled: true }))
  assert.equal(ui.queryByRole('listbox'),null)
  assert.equal(ui.getByRole('combobox').getAttribute('aria-expanded'),'false')
})
test('An unchanged save reuses its request ID only while the previous outcome is unknown', async () => {
  const ids: string[] = []
  const results: Array<() => never | { queued: false,conflict: true,revision: number }> = [() => { throw new Error('network') },() => ({ queued: false,conflict: true,revision: 0 }),() => ({ queued: false,conflict: true,revision: 0 })]
  const ui = render(createElement(ConfigForm<'leveling'>,{ title: 'Leveling',description: 'Synthetic',connected: true,snapshot: { revision: 0,values: { xp: '10' } },
    fields: (values,edit,disabled) => createElement('label',{},'XP',createElement('input',{ value: String(values.xp),disabled,onChange: event => edit('xp',(event.target as HTMLInputElement).value) })),
    operation: values => ({ type: 'settings',expectedRevision: 1,patch: { xpPerMessage: Number(values.xp) } }),
    queue: async (_operation,_revision,requestId) => { ids.push(requestId); return results[ids.length - 1]!() } }))
  fireEvent.change(ui.getByLabelText('XP'),{ target: { value: '25' } })
  for (let attempt = 0; attempt < 3; attempt++) await act(async () => { fireEvent.submit(ui.getByLabelText('XP').closest('form')!) })
  assert.equal(ids.length,3)
  assert.equal(ids[1],ids[0])
  assert.notEqual(ids[2],ids[1])
})
