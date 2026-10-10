import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement,useState } from 'react'
import type { ConvexReactClient } from 'convex/react'
import type { DashboardConfigurationSnapshot } from '@neonflux/backend/dashboard-contracts'
import { useConfigurationState } from '../src/configuration-live.ts'
import { ResponseSettings } from '../src/response-settings.tsx'
import { TemplatePicker,CalendarFields } from '../src/configuration-fields.tsx'
import { ConfigurationSection } from '../src/configuration-section.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
afterEach(cleanup)

function page(name: string,revision: number,next?: string,text = 'Synthetic reply'): Extract<DashboardConfigurationSnapshot,{ family: 'responses' }> {
  return { family: 'responses',serverId: '2',configRevision: revision,data: { settings: { customEnabled: true,autoEnabled: true },definitions: [{ name,kind: 'custom',reply: { type: 'text',text },channelIds: [],roleIds: [],cooldownSeconds: 0,priority: 0,enabled: true,createdAt: 1,updatedAt: 1 }] },jobs: [],...(next ? { nextCursors: { definitions: next } } : {}) }
}
// A definition edited elsewhere conflicts with its own form's draft. The create form edits no stored definition, so the same save leaves it alone
test('Loading more live definitions keeps drafts and shows drift only once loaded pages agree, and only on the changed definition', async () => {
  const first = { value: page('first',1,'next') }, second: { value?: DashboardConfigurationSnapshot } = {}
  const listeners = new Map<string,() => void>()
  const client = { watchQuery: (_: unknown,args: { cursors?: { definitions?: string } }) => {
    const key = args.cursors?.definitions ?? '',slot = key ? second : first
    return { localQueryResult: () => slot.value,onUpdate: (listener: () => void) => { listeners.set(key,listener); return () => { if (listeners.get(key) === listener) listeners.delete(key) } } }
  } } as unknown as ConvexReactClient
  function Harness() {
    const state = useConfigurationState(client,'synthetic-session','2','responses')
    return state.remote?.family === 'responses' ? createElement(ResponseSettings,{ remote: state.remote,connected: !state.error && !state.loadingPage,queue: async () => ({ queued: false,conflict: true,revision: 3 }),loadPage: state.loadPage,loadingPage: state.loadingPage,kind: 'custom' }) : createElement('p',null,'Loading')
  }
  const ui = render(createElement(Harness)), form = within(ui.getByRole('region',{ name: 'Create custom command' }))
  fireEvent.change(form.getByRole('textbox',{ name: 'Response name' }),{ target: { value: 'keep_draft' } })
  fireEvent.change(form.getByRole('textbox',{ name: 'Message text' }),{ target: { value: 'Keep this draft' } })
  const existing = within(ui.getByRole('region',{ name: 'Response: first',hidden: true }))
  fireEvent.change(existing.getByRole('textbox',{ name: 'Message text',hidden: true }),{ target: { value: 'My edited reply' } })
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Load more definitions' })) })
  assert.equal((form.getByRole('textbox',{ name: 'Response name' }) as HTMLInputElement).value,'keep_draft')
  assert.equal(form.getByRole('button',{ name: 'Create response' }).hasAttribute('disabled'),true)
  await act(async () => { first.value = page('first',2,'next','Reply changed elsewhere'); listeners.get('')!() })
  assert.ok(!ui.queryByText('Changed elsewhere'),'drift waits until every loaded page has the same revision')
  await act(async () => { second.value = page('second',2); listeners.get('next')!() })
  assert.ok(ui.getByText('second: Enabled'))
  assert.ok(existing.getByText('Changed elsewhere'))
  assert.equal((existing.getByRole('textbox',{ name: 'Message text',hidden: true }) as HTMLTextAreaElement).value,'My edited reply')
  assert.ok(!form.queryByText('Changed elsewhere'),'the create form edits no stored definition')
  assert.equal((form.getByRole('textbox',{ name: 'Message text' }) as HTMLTextAreaElement).value,'Keep this draft')
  assert.equal(form.getByRole('button',{ name: 'Create response' }).hasAttribute('disabled'),false)
})

test('Template picker keeps an older frozen binding until the user explicitly chooses the current revision', () => {
  let latest = ''
  const template = { kind: 'template' as const,name: 'welcome',revision: 5,content: { content: 'New version' },canonicalContent: { content: 'New version' },createdAt: 1,updatedAt: 2 }
  function Harness() { const [value,setValue] = useState('{"kind":"template","name":"welcome","revision":2}'); latest = value; return createElement(TemplatePicker,{ label: 'Welcome template',value,onChange: setValue,templates: [template] }) }
  const ui = render(createElement(Harness))
  assert.ok(ui.getByText('welcome (template, saved version 2)'))
  assert.equal(JSON.parse(latest).revision,2)
  fireEvent.change(ui.getByRole('combobox',{ name: 'Welcome template' }),{ target: { value: 'welcome' } })
  fireEvent.click(ui.getByRole('option',{ name: /welcome \(template, version 5\)/ }))
  assert.equal(JSON.parse(latest).revision,5)
})

test('Calendar controls preserve a civil gap input and empty numeric draft without resolving instants in the browser', () => {
  let latest = ''
  function Harness() { const [value,setValue] = useState('{"localMinute":"2027-03-28T01:30","zone":"Europe/Berlin","fold":"reject","durationMinutes":60,"recurrence":{"type":"none"}}'); latest = value; return createElement(CalendarFields,{ value,onChange: setValue,event: true }) }
  const ui = render(createElement(Harness))
  fireEvent.change(ui.getByLabelText('Local date and time'),{ target: { value: '2027-03-28T02:30' } })
  fireEvent.change(ui.getByLabelText('Duration (minutes)'),{ target: { value: '' } })
  const draft = JSON.parse(latest)
  assert.equal(draft.localMinute,'2027-03-28T02:30')
  assert.equal(draft.zone,'Europe/Berlin')
  assert.equal(draft.durationMinutes,'')
  assert.equal(draft.dates,undefined)
})

test('A live deletion retains the existing edited definition while blocking its mutations until explicit dismissal', async () => {
  let current = page('first',1),listener: (() => void) | undefined
  const client = { watchQuery: () => ({ localQueryResult: () => current,onUpdate: (next: () => void) => { listener = next;return () => { if (listener === next) listener = undefined } } }) } as unknown as ConvexReactClient
  const ui = render(createElement(ConfigurationSection,{ client,sessionToken: 'synthetic-session',serverId: '2',section: 'custom',connected: true,catalogLoading: false,catalogError: false }))
  fireEvent.click(ui.getByText('first: Enabled'))
  const form = within(ui.getByRole('region',{ name: 'Response: first',hidden: true }))
  fireEvent.change(form.getByRole('textbox',{ name: 'Message text',hidden: true }),{ target: { value: 'Retain this unsaved reply' } })
  await act(async () => { current = { ...page('first',2),data: { settings: { customEnabled: true,autoEnabled: true },definitions: [] } };listener!() })
  assert.equal((form.getByRole('textbox',{ name: 'Message text',hidden: true }) as HTMLTextAreaElement).value,'Retain this unsaved reply')
  assert.equal(form.getByRole('button',{ name: 'Save changes',hidden: true }).hasAttribute('disabled'),true)
  assert.ok(ui.getByText('Definitions are no longer in the loaded pages. They may have been removed or moved to a later page. Their forms and drafts are kept below for copying, with saves disabled until those definitions are loaded again'))
  const create = within(ui.getByRole('region',{ name: 'Create custom command' }))
  fireEvent.change(create.getByRole('textbox',{ name: 'Response name' }),{ target: { value: 'new_definition' } })
  fireEvent.change(create.getByRole('textbox',{ name: 'Message text' }),{ target: { value: 'An independent current draft' } })
  assert.equal(create.getByRole('button',{ name: 'Create response' }).hasAttribute('disabled'),false)
  fireEvent.click(ui.getByRole('button',{ name: 'Dismiss unavailable definitions and their drafts' }))
  assert.equal(ui.queryByRole('region',{ name: 'Response: first',hidden: true }),null)
  assert.equal((create.getByRole('textbox',{ name: 'Response name' }) as HTMLInputElement).value,'new_definition')
})

test('Sorted insertion rebases loaded page cursors and retains a pushed-out draft until its new page is loaded', async () => {
  const many = (names: string[],revision: number,next?: string) => ({ ...page(names[0]!,revision,next),data: { settings: { customEnabled: true,autoEnabled: true },definitions: names.map(name => page(name,revision).data.definitions[0]!) } })
  const slots = new Map<string,DashboardConfigurationSnapshot>([['',many(['alpha','bravo'],1,'after_bravo')],['after_bravo',many(['charlie','delta'],1)]])
  const listeners = new Map<string,() => void>(),requested: string[] = []
  const client = { watchQuery: (_: unknown,args: { cursors?: { definitions?: string } }) => {
    const key = args.cursors?.definitions ?? '';requested.push(key)
    return { localQueryResult: () => slots.get(key),onUpdate: (listener: () => void) => { listeners.set(key,listener);return () => { if (listeners.get(key) === listener) listeners.delete(key) } } }
  } } as unknown as ConvexReactClient
  const ui = render(createElement(ConfigurationSection,{ client,sessionToken: 'synthetic-session',serverId: '2',section: 'custom',connected: true,catalogLoading: false,catalogError: false }))
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Load more definitions' })) })
  fireEvent.click(ui.getByText('delta: Enabled'))
  const delta = within(ui.getByRole('region',{ name: 'Response: delta',hidden: true }))
  fireEvent.change(delta.getByRole('textbox',{ name: 'Message text',hidden: true }),{ target: { value: 'Keep the draft beyond the shifted boundary' } })
  await act(async () => { slots.set('',many(['aardvark','alpha'],2,'after_alpha'));listeners.get('')!() })
  assert.ok(requested.includes('after_alpha'))
  assert.equal((delta.getByRole('textbox',{ name: 'Message text',hidden: true }) as HTMLTextAreaElement).value,'Keep the draft beyond the shifted boundary')
  await act(async () => { slots.set('after_alpha',many(['bravo','charlie'],2,'after_charlie'));listeners.get('after_alpha')!() })
  assert.ok(ui.getByText('bravo: Enabled'))
  assert.ok(ui.getByText('charlie: Enabled'))
  assert.equal(delta.getByRole('button',{ name: 'Save changes',hidden: true }).hasAttribute('disabled'),true)
  assert.ok(ui.getByText(/They may have been removed or moved to a later page/))
  slots.set('after_charlie',many(['delta'],2))
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Load more definitions' })) })
  assert.equal(ui.queryByText(/They may have been removed or moved to a later page/),null)
  assert.equal((delta.getByRole('textbox',{ name: 'Message text',hidden: true }) as HTMLTextAreaElement).value,'Keep the draft beyond the shifted boundary')
  // delta only moved to a later page and its stored values did not change, so its draft continues on the newer revision without review
  assert.ok(!delta.queryByText('Changed elsewhere'),'a definition that only moved pages is no conflict')
  assert.equal(delta.getByRole('button',{ name: 'Save changes',hidden: true }).hasAttribute('disabled'),false)
})
