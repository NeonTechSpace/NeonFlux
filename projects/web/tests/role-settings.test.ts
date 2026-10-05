import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import type { ConvexReactClient } from 'convex/react'
import type { DashboardSnapshot } from '@neonflux/backend/dashboard-contracts'
import { RoleSettings } from '../src/role-settings.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render, fireEvent, cleanup, act,within } = await import('@testing-library/react')
afterEach(cleanup)
function snapshot(): DashboardSnapshot { return { serverId: '2', messages: [], general: { prefix: '!', revision: 0 }, status: [], roles: { revision: 4, settings: { panelsEnabled: false, verificationEnabled: false, autoroleEnabled: false, humansOnly: true, autoroleIds: [], revision: 1 }, panels: [], jobs: [] } } }

test('A removed role panel keeps its mapping draft and blocks mutation until explicitly dismissed', async () => {
  const remote = snapshot()
  remote.roles.panels = [{ name: 'retained',kind: 'reaction',enabled: true,revision: 1,mappings: [{ emoji: '✅',roleId: '123',prerequisiteRoleIds: [],exclusionRoleIds: [] }],exclusive: false,withdrawing: false }]
  const props = { section: 'reaction' as const,remote,sessionToken: 'synthetic-session',client: {} as ConvexReactClient,connected: true }
  const ui = render(createElement(RoleSettings,props)),form = within(ui.getByRole('region',{ name: 'Panel: retained' }))
  fireEvent.change(form.getByRole('textbox',{ name: 'Emoji for mapping 1' }),{ target: { value: '⭐' } })
  const changed = structuredClone(remote)
  changed.roles.panels = [];changed.roles.revision++
  await act(async () => { ui.rerender(createElement(RoleSettings,{ ...props,remote: changed })) })
  assert.equal((form.getByRole('textbox',{ name: 'Emoji for mapping 1' }) as HTMLInputElement).value,'⭐')
  assert.equal(form.getByRole('button',{ name: 'Request panel change' }).hasAttribute('disabled'),true)
  assert.ok(ui.getByText('A panel was removed elsewhere. Its form and draft are kept below for copying, with saves disabled'))
  fireEvent.click(ui.getByRole('button',{ name: 'Dismiss removed panels and their drafts' }))
  assert.equal(ui.queryByRole('region',{ name: 'Panel: retained' }),null)
})
test('Autorole configuration queues a concrete native request and never claims application before a bot receipt', async () => {
  const requests: unknown[] = []
  const client = { action: async (_: unknown,args: unknown) => { requests.push(args); return { queued: true, conflict: false, revision: 4, jobId: 'job1' } } } as unknown as ConvexReactClient
  const ui = render(createElement(RoleSettings, { section: 'autorole', remote: snapshot(), sessionToken: 'synthetic-session', client, connected: true, catalog: { serverId: '2',channels: [],roles: [{ id: '123',name: 'Member',position: 1 },{ id: '456',name: 'Visitor',position: 2 }] } }))
  fireEvent.click(ui.getByLabelText('Enabled'))
  const picker = ui.getByRole('combobox', { name: 'Roles for new members' })
  fireEvent.change(picker, { target: { value: 'mbr' } })
  fireEvent.keyDown(picker,{ key: 'Enter' })
  fireEvent.change(picker, { target: { value: 'vstr' } })
  fireEvent.keyDown(picker,{ key: 'Enter' })
  await act(async () => { fireEvent.submit(ui.getByRole('button', { name: 'Request change' }).closest('form')!) })
  assert.deepEqual(requests, [{ sessionToken: 'synthetic-session', serverId: '2', section: 'autorole', expectedRevision: 4, operation: { type: 'settings', patch: { autoroleEnabled: true, autoroleIds: ['123','456'] } } }])
  assert.ok(ui.getByText('Change queued. Waiting for bot confirmation'))
  assert.equal(ui.queryByText('Change applied'), null)
})
test('Reservations queue exact absent-user IDs and preserve role names with emoji and case', async () => {
  const requests: Array<Record<string,unknown>> = []
  const client = { action: async (_: unknown,args: Record<string,unknown>) => { requests.push(args); return { queued: true,conflict: false,revision: 4,jobId: 'job1' } } } as unknown as ConvexReactClient
  const ui = render(createElement(RoleSettings,{ section: 'autorole',remote: snapshot(),sessionToken: 'synthetic-session',client,connected: true,catalog: { serverId: '2',channels: [],roles: [{ id: '123',name: '⭐ VIP Member',position: 1 }] } }))
  fireEvent.click(ui.getByRole('button',{ name: 'Add reserved user' }))
  fireEvent.change(ui.getByRole('textbox',{ name: 'Reserved user ID 1' }),{ target: { value: '789' } })
  const picker = ui.getByRole('combobox',{ name: 'Roles for reserved user 1' })
  fireEvent.change(picker,{ target: { value: '⭐ vip' } })
  fireEvent.keyDown(picker,{ key: 'Enter' })
  assert.ok(ui.getByRole('button',{ name: 'Remove ⭐ VIP Member' }))
  await act(async () => { fireEvent.submit(ui.getByRole('button',{ name: 'Request change' }).closest('form')!) })
  assert.deepEqual(requests[0]?.operation,{ type: 'settings',patch: { reservations: [{ userId: '789',roleIds: ['123'] }] } })
  assert.ok(ui.getByText(/Saving a reservation does not assign roles immediately/))
  assert.ok(ui.getByText('Change queued. Waiting for bot confirmation'))
  assert.equal(ui.queryByText('Change applied'),null)
})
test('Editing and removing existing reservations queues the updated future join mapping', async () => {
  const requests: Array<Record<string,unknown>> = []
  const remote = snapshot()
  remote.roles.settings.reservations = [{ userId: '789',roleIds: ['123'] },{ userId: '777',roleIds: ['456'] }]
  const client = { action: async (_: unknown,args: Record<string,unknown>) => { requests.push(args); return { queued: true,conflict: false,revision: 4,jobId: 'job1' } } } as unknown as ConvexReactClient
  const ui = render(createElement(RoleSettings,{ section: 'autorole',remote,sessionToken: 'synthetic-session',client,connected: true,catalog: { serverId: '2',channels: [],roles: [{ id: '123',name: 'Member',position: 1 },{ id: '456',name: 'VIP',position: 2 }] } }))
  fireEvent.change(ui.getByRole('textbox',{ name: 'Reserved user ID 1' }),{ target: { value: '888' } })
  fireEvent.click(ui.getByRole('button',{ name: 'Remove reservation 2' }))
  assert.equal(requests.length,0)
  await act(async () => { fireEvent.submit(ui.getByRole('button',{ name: 'Request change' }).closest('form')!) })
  assert.deepEqual((requests[0]?.operation as { patch: unknown }).patch,{ reservations: [{ userId: '888',roleIds: ['123'] }] })
})
test('Reservations reject duplicate users and empty roles before a request is queued', async () => {
  const requests: unknown[] = []
  const remote = snapshot()
  remote.roles.settings.reservations = [{ userId: '789',roleIds: ['123'] }]
  const client = { action: async (_: unknown,args: unknown) => { requests.push(args); return { queued: true,conflict: false,revision: 4,jobId: 'job1' } } } as unknown as ConvexReactClient
  const ui = render(createElement(RoleSettings,{ section: 'autorole',remote,sessionToken: 'synthetic-session',client,connected: true,catalog: { serverId: '2',channels: [],roles: [{ id: '123',name: 'Member',position: 1 }] } }))
  fireEvent.click(ui.getByRole('button',{ name: 'Add reserved user' }))
  fireEvent.change(ui.getByRole('textbox',{ name: 'Reserved user ID 2' }),{ target: { value: '789' } })
  await act(async () => { fireEvent.submit(ui.getByRole('button',{ name: 'Request change' }).closest('form')!) })
  assert.ok(ui.getByRole('alert').textContent?.includes('Each user can have only one role reservation'))
  fireEvent.change(ui.getByRole('textbox',{ name: 'Reserved user ID 2' }),{ target: { value: '999' } })
  await act(async () => { fireEvent.submit(ui.getByRole('button',{ name: 'Request change' }).closest('form')!) })
  assert.ok(ui.getByRole('alert').textContent?.includes('Choose at least one role for each reserved user'))
  assert.equal(requests.length,0)
})
test('Remote reservation changes preserve dirty rows until reviewed and queue against the current revision', async () => {
  const requests: Array<Record<string,unknown>> = []
  const remote = snapshot()
  remote.roles.settings.reservations = [{ userId: '789',roleIds: ['123'] }]
  const client = { action: async (_: unknown,args: Record<string,unknown>) => { requests.push(args); return { queued: true,conflict: false,revision: 5,jobId: 'job1' } } } as unknown as ConvexReactClient
  const props = { section: 'autorole' as const,remote,sessionToken: 'synthetic-session',client,connected: true }
  const ui = render(createElement(RoleSettings,props))
  fireEvent.change(ui.getByRole('textbox',{ name: 'Reserved user ID 1' }),{ target: { value: '888' } })
  const changed = structuredClone(remote)
  changed.roles.revision = 5
  changed.roles.settings.reservations = [{ userId: '999',roleIds: ['456'] }]
  ui.rerender(createElement(RoleSettings,{ ...props,remote: changed }))
  assert.equal((ui.getByRole('textbox',{ name: 'Reserved user ID 1' }) as HTMLInputElement).value,'888')
  assert.ok(ui.getByText('Changed elsewhere'))
  assert.equal((ui.getByRole('button',{ name: 'Request change' }) as HTMLButtonElement).disabled,true)
  fireEvent.click(ui.getByRole('button',{ name: 'Keep my draft after review' }))
  await act(async () => { fireEvent.submit(ui.getByRole('button',{ name: 'Request change' }).closest('form')!) })
  assert.equal(requests[0]?.expectedRevision,5)
  assert.deepEqual((requests[0]?.operation as { patch: { reservations: unknown } }).patch.reservations,[{ userId: '888',roleIds: ['123'] }])
})
test('A panel enable switch preserves unchanged mappings and exclusive semantics in its native operation', async () => {
  const requests: Array<Record<string,unknown>> = []
  const client = { action: async (_: unknown,args: Record<string,unknown>) => { requests.push(args); return { queued: true, conflict: false, revision: 4, jobId: 'job1' } } } as unknown as ConvexReactClient
  const remote = snapshot()
  remote.roles.panels.push({ name: 'member', kind: 'reaction', enabled: true, revision: 7, mappings: [{ emoji: '✅', roleId: '123', prerequisiteRoleIds: [], exclusionRoleIds: [] }], exclusive: false, withdrawing: false })
  const ui = render(createElement(RoleSettings, { section: 'reaction', remote, sessionToken: 'synthetic-session', client, connected: true }))
  fireEvent.click(ui.getByLabelText('Panel enabled'))
  await act(async () => { fireEvent.submit(ui.getByRole('button', { name: 'Request panel change' }).closest('form')!) })
  assert.deepEqual(requests[0]?.operation, { type: 'panel-update', name: 'member', expectedRevision: 7, patch: { enabled: false } })
  assert.equal(requests[0]?.publication, undefined)
})
test('The single verification-panel limit is reflected in the controls', () => {
  const remote = snapshot()
  remote.roles.panels.push({ name: 'verify', kind: 'verification', enabled: true, revision: 7, mappings: [{ emoji: '✅', roleId: '123', prerequisiteRoleIds: [], exclusionRoleIds: [] }], exclusive: false, withdrawing: false })
  const ui = render(createElement(RoleSettings, { section: 'verification', remote, sessionToken: 'synthetic-session', client: {} as ConvexReactClient, connected: true }))
  assert.equal(ui.queryByRole('button', { name: 'Create panel' }), null)
  assert.ok(ui.getByLabelText('Advanced visual challenge'))
  assert.ok(ui.getByRole('combobox', { name: 'Role for mapping 1' }))
})

test('Dynamic role mappings and JSON embed publication queue exact structured native content', async () => {
  const requests: Array<Record<string,unknown>> = []
  const client = { action: async (_: unknown,args: Record<string,unknown>) => { requests.push(args); return { queued: true,conflict: false,revision: 4,jobId: 'job1' } } } as unknown as ConvexReactClient
  const catalog = { serverId: '2',channels: [{ id: '999',name: 'Roles',type: 0 }],roles: [{ id: '123',name: 'Member',position: 1 },{ id: '456',name: 'Contributor',position: 2 }] }
  const ui = render(createElement(RoleSettings,{ section: 'reaction',remote: snapshot(),sessionToken: 'synthetic-session',client,connected: true,catalog }))
  fireEvent.change(ui.getByRole('textbox',{ name: 'Panel name' }),{ target: { value: 'members' } })
  const select = (name: string,query: string) => { const input = ui.getByRole('combobox',{ name }); fireEvent.change(input,{ target: { value: query } }); fireEvent.keyDown(input,{ key: 'Enter' }) }
  select('Role for mapping 1','mbr')
  fireEvent.click(ui.getByText('Prerequisites and exclusions'))
  select('Required roles for mapping 1','cntr')
  fireEvent.click(ui.getByRole('button',{ name: 'Add role mapping' }))
  select('Role for mapping 2','cntr')
  fireEvent.change(ui.getByRole('textbox',{ name: 'Emoji for mapping 2' }),{ target: { value: '⭐' } })
  fireEvent.click(ui.getByLabelText('Publish this panel'))
  select('Publication channel','rls')
  fireEvent.click(ui.getByRole('button',{ name: 'Import / export JSON' }))
  fireEvent.change(ui.getByRole('textbox',{ name: 'Message JSON' }),{ target: { value: '{"content":"Choose roles","embed":{"title":"Membership","fields":[{"name":"Info","value":"React below","inline":true}]}}' } })
  fireEvent.click(ui.getByRole('button',{ name: 'Import JSON' }))
  assert.equal(requests.length,0)
  await act(async () => { fireEvent.submit(ui.getByRole('button',{ name: 'Create panel' }).closest('form')!) })
  assert.deepEqual(requests[0]?.operation,{ type: 'panel-create',name: 'members',kind: 'reaction',exclusive: false,mappings: [{ emoji: '✅',roleId: '123',prerequisiteRoleIds: ['456'],exclusionRoleIds: [] },{ emoji: '⭐',roleId: '456',prerequisiteRoleIds: [],exclusionRoleIds: [] }] })
  assert.deepEqual(requests[0]?.publication,{ channelId: '999',content: { content: 'Choose roles',embed: { title: 'Membership',fields: [{ name: 'Info',value: 'React below',inline: true }] } } })
})
