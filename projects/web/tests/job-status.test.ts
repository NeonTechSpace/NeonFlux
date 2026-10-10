import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import type { ConvexReactClient } from 'convex/react'
import type { DashboardMessageJob } from '@neonflux/backend/dashboard-contracts'
import { JobStatus } from '../src/job-status.tsx'
import { Messages } from '../src/messages.tsx'
import { SettingsForm } from '../src/settings-form.tsx'
import type { SettingsFormProps } from '../src/settings-form.tsx'
import { ServerPicker,SERVER_SEARCH_FROM } from '../src/server-picker.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
afterEach(cleanup)

test('Every request state reads in plain words with what to do next', () => {
  const states = ['queued','configured','reserved','applied','sent','failed','conflict','uncertain'] as const
  const ui = render(createElement('ul',null,...states.map(state => createElement('li',{ key: state },createElement(JobStatus,{ state,...(state === 'failed' ? { error: 'Missing Manage Roles permission' } : {}) })))))
  const items = ui.getAllByRole('listitem').map(item => item.textContent)
  assert.match(items[0]!,/^Waiting for the bot.*within two minutes, it fails and nothing changes$/)
  assert.match(items[1]!,/^Saved, publishing the panel/)
  assert.match(items[3]!,/^Applied$/)
  assert.match(items[5]!,/^FailedMissing Manage Roles permissionFix the cause shown, then try again/)
  assert.match(items[6]!,/^Not applied, changed elsewhereReview the current settings, then save again$/)
  assert.match(items[7]!,/^Outcome unknown.*Check the channel before you send it again\. NeonFlux never resends it on its own$/)
})

test('Message requests say whether anything was sent, and an uncertain send asks to check the channel', () => {
  const job = (id: string,state: DashboardMessageJob['state'],error?: string): DashboardMessageJob => ({ id,actorId: '1',channelId: '5',content: { content: 'Synthetic' },state,createdAt: 1,expiresAt: 2,...(error ? { error } : {}) })
  const ui = render(createElement(Messages,{ client: {} as ConvexReactClient,sessionToken: 'synthetic-session',serverId: '2',connected: true,catalog: { serverId: '2',channels: [{ id: '5',name: 'general',type: 0 }],roles: [] },catalogLoading: false,catalogError: false,
    jobs: [job('a','queued'),job('b','uncertain'),job('c','failed','Missing Send Messages permission')] }))
  const items = within(ui.getByRole('heading',{ name: 'Recent message requests' }).parentElement!).getAllByRole('listitem').map(item => item.textContent)
  assert.match(items[0]!,/^general: Waiting for the bot.*nothing is sent$/)
  assert.match(items[1]!,/^general: Outcome unknown.*never resends/)
  assert.match(items[2]!,/^general: FailedMissing Send Messages permissionIt was not sent\. Fix the cause shown, then send it again$/)
})

test('A form says when its change is waiting, and why a finished change was not applied', async () => {
  const props: SettingsFormProps = { title: 'General',description: 'Synthetic',connected: true,jobs: [],snapshot: { revision: 0,values: { prefix: '!' } },save: async () => ({ queued: true,jobId: 'job1',revision: 0 }),
    fields: (values,edit,disabled) => createElement('label',{},'Prefix',createElement('input',{ value: String(values.prefix),disabled,onChange: (event: { target: { value: string } }) => edit('prefix',event.target.value) })) }
  const ui = render(createElement(SettingsForm,props))
  fireEvent.change(ui.getByLabelText('Prefix'),{ target: { value: '$' } })
  await act(async () => { fireEvent.submit(ui.getByLabelText('Prefix').closest('form')!) })
  assert.ok(ui.getByText(/applies it within seconds while it is online.*Your draft stays until it is applied/))
  const job = { id: 'job1',actorId: '1',section: 'reaction' as const,expectedRevision: 0,operation: { type: 'settings' as const,patch: { panelsEnabled: true } },createdAt: 0,expiresAt: 120000,state: 'conflict' as const }
  ui.rerender(createElement(SettingsForm,{ ...props,jobs: [job] }))
  assert.equal(ui.getByRole('alert').textContent,'Not applied: The settings changed elsewhere before the bot applied this change. Your draft has been kept. Review the current settings, then save again')
  assert.equal((ui.getByLabelText('Prefix') as HTMLInputElement).value,'$')
})

test('Many servers get a search field that filters both lists and keeps the invitation, and few servers do not', () => {
  const many = Array.from({ length: SERVER_SEARCH_FROM },(_,index) => ({ id: String(100 + index),name: index === 3 ? 'Synthetic Gaming Lounge' : `Synthetic server ${index}`,icon: null }))
  let checks = 0
  const ui = render(createElement(ServerPicker,{ servers: many.slice(1),memberServers: many.slice(0,1).map(server => ({ ...server,features: ['rolepicker' as const] })),inviteUrl: 'https://api.fluxer.app/v1/oauth2/authorize?client_id=30',onSelect: () => {},onCheckServers: () => { checks++ } }))
  fireEvent.change(ui.getByRole('searchbox',{ name: 'Search servers' }),{ target: { value: 'gaming' } })
  assert.deepEqual(ui.getAllByRole('button',{ name: /^(Configure|Choose roles in) / }).map(button => button.getAttribute('aria-label')),['Configure Synthetic Gaming Lounge'])
  assert.ok(ui.getByRole('link',{ name: /Add NeonFlux to a server/ }))
  fireEvent.change(ui.getByRole('searchbox',{ name: 'Search servers' }),{ target: { value: 'zzz' } })
  assert.ok(ui.getByText(/No servers match/))
  // After the invitation opens, the picker offers to look for the new server again
  const add = ui.getByRole('link',{ name: /Add NeonFlux to a server/ })
  add.addEventListener('click',event => event.preventDefault())
  fireEvent.click(add)
  fireEvent.click(ui.getByRole('button',{ name: 'Check again' }))
  assert.equal(checks,1)
  cleanup()
  const few = render(createElement(ServerPicker,{ servers: many.slice(0,2),onSelect: () => {} }))
  assert.ok(!few.queryByRole('searchbox'),'a short list needs no search')
})
