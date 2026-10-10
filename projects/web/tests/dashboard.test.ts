import assert from 'node:assert/strict'
import { afterEach,mock,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { getFunctionName } from 'convex/server'
import type { ConvexReactClient } from 'convex/react'
import type { DashboardConfigurationSnapshot, DashboardOverview, DashboardRolesView } from '@neonflux/backend/dashboard-contracts'
import type { WebSession } from '../src/dashboard-api.ts'
import { ServerDashboard, dashboardHref, dashboardSearch } from '../src/dashboard.tsx'
import type { DashboardLocation } from '../src/dashboard.tsx'
import { navigation, preloadSections } from '../src/dashboard-sections.tsx'
import type { SectionId } from '../src/dashboard-sections.tsx'
import { SearchPicker } from '../src/search-picker.tsx'
import { ConfigForm } from '../src/configuration-form.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
// Section code loads on first use. Loading it up front lets each render show its section at once
await preloadSections()
afterEach(() => { cleanup(); window.sessionStorage.clear() })

const servers = [{ id: '2',name: 'Synthetic Alpha',icon: 'https://fluxerusercontent.com/icons/2/abc.webp?size=128&animated=false' },{ id: '3',name: 'Synthetic beta',icon: null }]
function roles(serverId: string): DashboardRolesView { return { serverId,general: { prefix: '!' },roles: { revision: 0,settings: { panelsEnabled: false,verificationEnabled: false,autoroleEnabled: false,humansOnly: true,autoroleIds: [],revision: 1 },panels: [],jobs: [] } } }
function nickname(serverId: string): DashboardConfigurationSnapshot { return { family: 'nickname',serverId,configRevision: 0,data: { settings: { nickname: null,revision: 0,result: null } },jobs: [] } }
const overview = (serverId: string): DashboardOverview => ({ serverId,sections: [{ id: 'custom',state: 'setup' },{ id: 'moderation',state: 'on' },{ id: 'cleanup',state: 'off' }] })
// Views the sections render. Other configuration families stay loading, which is enough to count their subscriptions
function result(name: string,args: { serverId: string, family?: string }) {
  switch (name) {
    case 'dashboardViews:overview': return overview(args.serverId)
    case 'dashboardViews:general': return { serverId: args.serverId,prefix: '!',revision: 0 }
    case 'dashboardViews:roles': return roles(args.serverId)
    case 'dashboardViews:messages': return { serverId: args.serverId,jobs: [] }
    case 'dashboardViews:templates': return { serverId: args.serverId,templates: [],more: false }
    case 'dashboardConfiguration:snapshot': return args.family === 'nickname' ? nickname(args.serverId) : undefined
  }
}
function harness(mode: WebSession['mode'],list = servers,extra: Partial<WebSession> = {},refreshSession?: () => void,routing?: { location: DashboardLocation, navigate: (location: DashboardLocation) => void }) {
  const watched: string[] = [], active = new Map<number,string>()
  let next = 0
  const client = {
    connectionState: () => ({ isWebSocketConnected: true }),
    subscribeToConnectionState: () => () => {},
    action: async () => new Promise(() => {}),
    watchQuery: (ref: unknown,args: { serverId: string, family?: string }) => {
      const name = getFunctionName(ref as never), label = `${name}:${args.serverId}${args.family ? `:${args.family}` : ''}`
      watched.push(label)
      return { localQueryResult: () => result(name,args),onUpdate: () => { const id = ++next; active.set(id,label); return () => { active.delete(id) } } }
    },
  } as unknown as ConvexReactClient
  const session: WebSession = { sessionToken: 'synthetic-session',convexUrl: 'https://synthetic.invalid',expiresAt: 1,user: { id: '1',name: 'Synthetic user' },mode,servers: list,...extra }
  const props = { session,client,accessAvailable: true,...(refreshSession ? { refreshSession } : {}),...routing }
  const ui = render(createElement(ServerDashboard,props))
  return { ui,watched,live: () => [...active.values()].sort(),rerender: (routing: { location: DashboardLocation, navigate: (location: DashboardLocation) => void }) => ui.rerender(createElement(ServerDashboard,{ ...props,...routing })),
    rerenderSession: (change: Partial<WebSession>) => ui.rerender(createElement(ServerDashboard,{ ...props,session: { ...session,...change } })) }
}
const nav = (ui: ReturnType<typeof render>,name: string) => within(ui.getByRole('navigation',{ name: 'Configuration sections' })).getByRole('link',{ name: new RegExp(`^${name}`) })

test('Multi-server mode opens on a server picker, a server opens on its overview, and the header switches back', async () => {
  const { ui,watched,live } = harness('multi')
  assert.ok(ui.getByRole('heading',{ name: 'Choose a server' }))
  assert.deepEqual(watched,[])
  assert.equal(ui.queryByRole('navigation',{ name: 'Configuration sections' }),null)
  const alpha = ui.getByRole('button',{ name: 'Configure Synthetic Alpha' }), beta = ui.getByRole('button',{ name: 'Configure Synthetic beta' })
  assert.equal(alpha.querySelector('img')?.getAttribute('src'),servers[0]!.icon)
  assert.equal(beta.querySelector('img'),null)
  assert.equal(beta.querySelector('.initials')?.textContent,'SB')
  await act(async () => { fireEvent.click(beta) })
  assert.ok(ui.getByRole('heading',{ name: 'Synthetic beta' }))
  assert.ok(ui.getByRole('heading',{ name: 'Overview' }))
  assert.deepEqual(live(),['dashboardViews:overview:3'])
  await act(async () => { fireEvent.click(nav(ui,'General')) })
  assert.ok(ui.getByRole('region',{ name: 'General' }))
  assert.ok(ui.getByRole('region',{ name: 'Bot nickname' }))
  assert.deepEqual(live(),['dashboardConfiguration:snapshot:3:nickname','dashboardViews:general:3'])
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Switch server' })) })
  assert.ok(ui.getByRole('heading',{ name: 'Choose a server' }))
  assert.deepEqual(live(),[])
})
test('Only the open section keeps live subscriptions, whichever sections were opened before', async () => {
  const { ui,live } = harness('single',servers.slice(0,1))
  const most = new Map<string,number>()
  for (const [,items] of navigation) for (const [id,name] of items) {
    await act(async () => { fireEvent.click(nav(ui,name)) })
    assert.equal(nav(ui,name).getAttribute('aria-current'),'page')
    most.set(id,live().length)
    assert.ok(live().every(label => !label.startsWith('dashboardViews:overview')),`${id} leaves the overview unsubscribed`)
  }
  assert.ok(Math.max(...most.values()) <= 2,`at most two live queries per section, found ${JSON.stringify(Object.fromEntries(most))}`)
  await act(async () => { fireEvent.click(nav(ui,'Greetings')) })
  assert.deepEqual(live(),['dashboardConfiguration:snapshot:2:greetings','dashboardViews:templates:2'])
  await act(async () => { fireEvent.click(nav(ui,'Reaction roles')) })
  assert.deepEqual(live(),['dashboardViews:roles:2'])
})
test('Section links come from the address, keep the browser\'s own handling for modified clicks and ignore unknown values', async () => {
  const moves: DashboardLocation[] = []
  const { ui,rerender } = harness('multi',servers,{},undefined,{ location: { server: '3',section: 'rolepicker' },navigate: location => { moves.push(location) } })
  assert.ok(ui.getByRole('heading',{ name: 'Synthetic beta' }))
  assert.equal(nav(ui,'Role picker').getAttribute('aria-current'),'page')
  assert.equal(nav(ui,'General').getAttribute('href'),'/?server=3&section=general')
  assert.equal(nav(ui,'Overview').getAttribute('href'),'/?server=3')
  fireEvent.click(nav(ui,'General'))
  assert.deepEqual(moves,[{ server: '3',section: 'general' }])
  fireEvent.click(nav(ui,'Tickets'),{ ctrlKey: true })
  assert.equal(moves.length,1)
  rerender({ location: { server: '99' },navigate: location => { moves.push(location) } })
  assert.ok(ui.getByText(/The server in this link is not available to you/))
  assert.ok(ui.getByRole('heading',{ name: 'Choose a server' }))
  assert.deepEqual(dashboardSearch({ server: '3',section: 'logs' }),{ server: '3',section: 'logs' })
  assert.deepEqual(dashboardSearch({ server: 'x',section: 'unknown' }),{ server: undefined,section: undefined })
  assert.equal(dashboardHref({ section: 'overview' as SectionId }),'/')
})
const invite = 'https://api.fluxer.app/v1/oauth2/authorize?client_id=30&scope=bot&permissions=9008677076954326'
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
test('Coming back to the tab after opening the bot invitation reloads the server list once', () => {
  let refreshes = 0
  const { ui } = harness('multi',servers,{ inviteUrl: invite },() => { refreshes++ })
  const add = ui.getByRole('link',{ name: /Add NeonFlux to a server/ })
  add.addEventListener('click',event => event.preventDefault())
  fireEvent.click(add)
  fireEvent(window,new window.Event('focus'))
  fireEvent(window,new window.Event('focus'))
  assert.equal(refreshes,1)
})
test('Single-server mode opens straight on its server without a picker or switch control', () => {
  const { ui,watched } = harness('single',servers.slice(0,1))
  assert.equal(ui.queryByRole('heading',{ name: 'Choose a server' }),null)
  assert.equal(ui.queryByRole('button',{ name: 'Switch server' }),null)
  assert.ok(ui.getByRole('heading',{ name: 'Synthetic Alpha' }))
  assert.deepEqual(watched,['dashboardViews:overview:2'])
  assert.ok(ui.getByText('Needs setup'))
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

const prefix = (ui: ReturnType<typeof render>) => ui.getByRole('textbox',{ name: /^Command prefix/ }) as HTMLInputElement
test('An unsaved draft survives leaving its section and switching servers, is marked, and discarding it loads the current settings', async () => {
  const { ui } = harness('multi')
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Configure Synthetic Alpha' })) })
  await act(async () => { fireEvent.click(nav(ui,'General')) })
  fireEvent.change(prefix(ui),{ target: { value: '$' } })
  await act(async () => { fireEvent.click(nav(ui,'Custom commands')) })
  assert.ok(nav(ui,'General').textContent?.includes('unsaved draft'))
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Switch server' })) })
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Configure Synthetic beta' })) })
  await act(async () => { fireEvent.click(nav(ui,'General')) })
  assert.equal(prefix(ui).value,'!','drafts belong to their server')
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Switch server' })) })
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Configure Synthetic Alpha' })) })
  assert.ok(ui.getByText(/in General\. They stay in this tab/),'the overview lists sections with drafts')
  await act(async () => { fireEvent.click(nav(ui,'General')) })
  assert.equal(prefix(ui).value,'$')
  assert.ok(ui.getByText(/Your earlier changes to this form were restored/))
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Discard draft' })) })
  assert.equal(prefix(ui).value,'!')
  assert.ok(!ui.queryByText(/Your earlier changes to this form were restored/),'the note leaves with the draft')
  assert.ok(!nav(ui,'General').textContent?.includes('unsaved draft'))
  assert.equal(window.sessionStorage.length,0)
})
test('Another account signing in while a form has a draft opens a fresh form, and the draft is not stored for that account', async () => {
  const { ui,rerenderSession } = harness('single',servers.slice(0,1))
  await act(async () => { fireEvent.click(nav(ui,'General')) })
  fireEvent.change(prefix(ui),{ target: { value: '$' } })
  await act(async () => { rerenderSession({ user: { id: '9',name: 'Another synthetic user' } }) })
  assert.equal(prefix(ui).value,'!')
  const keys = Array.from({ length: window.sessionStorage.length },(_,index) => window.sessionStorage.key(index)!)
  assert.ok(keys.length > 0 && keys.every(key => !key.includes('["9"')),'only the first account keeps its draft')
})
test('Drafts belong to the signed-in user, stay bounded and end with sign-out', async () => {
  const first = harness('single',servers.slice(0,1))
  await act(async () => { fireEvent.click(nav(first.ui,'General')) })
  fireEvent.change(prefix(first.ui),{ target: { value: '$' } })
  cleanup()
  const other = harness('single',servers.slice(0,1),{ user: { id: '9',name: 'Another synthetic user' } })
  await act(async () => { fireEvent.click(nav(other.ui,'General')) })
  assert.equal(prefix(other.ui).value,'!')
  cleanup()
  const { writeDraft,clearAllDrafts,MAX_DRAFTS } = await import('../src/drafts.ts')
  let now = 1_000
  mock.method(Date,'now',() => ++now)
  for (let index = 0; index < MAX_DRAFTS + 5; index++) writeDraft({ userId: '1',serverId: '2',section: 'custom' },`form ${index}`,{ index })
  assert.equal(window.sessionStorage.length,MAX_DRAFTS)
  assert.equal(window.sessionStorage.getItem(`neonflux.draft.v1:${JSON.stringify(['1','2','custom','form 0'])}`),null,'the oldest draft goes first')
  writeDraft({ userId: '1',serverId: '2',section: 'custom' },'large',{ text: 'x'.repeat(200_000) })
  assert.equal(window.sessionStorage.getItem(`neonflux.draft.v1:${JSON.stringify(['1','2','custom','large'])}`),null,'an oversized draft is not stored')
  clearAllDrafts()
  assert.equal(window.sessionStorage.length,0)
  mock.restoreAll()
})
