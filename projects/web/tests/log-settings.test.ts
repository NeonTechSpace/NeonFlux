import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import type { DashboardMetadataOperation, DashboardMetadataSnapshot } from '@neonflux/backend/dashboard-contracts'
import { LogSettings } from '../src/log-settings.tsx'
import type { LogSettingsProps } from '../src/log-settings.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
afterEach(cleanup)
function snapshot(): DashboardMetadataSnapshot {
  return { serverId: '2',jobs: [],settings: { enabled: true,revision: 3,configRevision: 8,routes: (['membership','resources','messages','audit','settings','operations'] as const).map(category => ({ category,revision: 2,enabled: category === 'membership',...(category === 'membership' ? { channelId: '123',ownerId: '789' } : {}) })),eventRoutes: [],messageChannelIds: [],excludedChannelIds: [],retained: 0,admissions: 0,admissionWindowStartedAt: 0,capacity: 10000,admissionCapacity: 10000,retentionMs: 2592000000,quotaPaused: false,refused: 0,suppressed: 0 } }
}
function setup(remote = snapshot()) {
  const calls: Array<{ operation: DashboardMetadataOperation,revision: number,requestId: string }> = []
  const props: LogSettingsProps = { remote,connected: true,catalog: { serverId: '2',roles: [],channels: [{ id: '123',name: '🌿 Staff Log',type: 0 },{ id: '456',name: '⭐ Event Log',type: 0 }] },queue: async (operation,revision,requestId) => { calls.push({ operation,revision,requestId }); return { queued: true,conflict: false,revision,jobId: 'job1' } } }
  const ui = render(createElement(LogSettings,props))
  return { ui,calls,props }
}
function section(ui: ReturnType<typeof render>,name: string) { return within(ui.getByRole('region',{ name,hidden: true })) }
async function submit(form: ReturnType<typeof within>) { await act(async () => { fireEvent.submit(form.getByRole('button',{ name: /^Request /,hidden: true }).closest('form')!) }) }
function selectChannel(form: ReturnType<typeof within>,name: string,query: string) { const input = form.getByRole('combobox',{ name,hidden: true }); fireEvent.change(input,{ target: { value: query } }); fireEvent.keyDown(input,{ key: 'Enter' }) }
test('Event routes override group destinations using shared configuration CAS and exact owner IDs', async () => {
  const { ui,calls } = setup()
  const event = section(ui,'Member joined')
  assert.ok(event.getByText('Current destination: Membership group: 🌿 Staff Log'))
  fireEvent.change(event.getByLabelText('Member joined routing'),{ target: { value: 'channel' } })
  selectChannel(event,'Member joined destination','⭐ evnt')
  assert.ok(event.getByRole('button',{ name: 'Remove ⭐ Event Log',hidden: true }))
  fireEvent.change(event.getByLabelText('Member joined owner ID'),{ target: { value: '999' } })
  await submit(event)
  assert.deepEqual(calls[0]?.operation,{ type: 'event-route',eventType: 'member-add',expectedRevision: 8,enabled: true,channelId: '456',ownerId: '999' })
  assert.equal(calls[0]?.revision,8)
  assert.match(calls[0]!.requestId,/^[0-9a-f-]{36}$/)
  assert.ok(event.getByText('Change queued. Waiting for bot confirmation'))
  assert.equal(event.queryByText('Change applied'),null)
})
test('An event can disable delivery without a destination and clear its override to inherit again', async () => {
  const { ui,calls } = setup()
  const event = section(ui,'Member joined')
  fireEvent.change(event.getByLabelText('Member joined routing'),{ target: { value: 'disabled' } })
  await submit(event)
  assert.deepEqual(calls[0]?.operation,{ type: 'event-route',eventType: 'member-add',expectedRevision: 8,enabled: false })
  cleanup()
  const remote = snapshot()
  remote.settings.eventRoutes = [{ eventType: 'member-add',revision: 55,enabled: true,channelId: '456',ownerId: '999' }]
  const next = setup(remote), inherited = section(next.ui,'Member joined')
  assert.ok(inherited.getByText('Current destination: Event override: ⭐ Event Log'))
  fireEvent.change(inherited.getByLabelText('Member joined routing'),{ target: { value: 'inherit' } })
  await submit(inherited)
  assert.deepEqual(next.calls[0]?.operation,{ type: 'event-clear',eventType: 'member-add',expectedRevision: 8 })
})
test('Group routing uses the group revision, independent of event override revisions', async () => {
  const { ui,calls } = setup()
  const group = section(ui,'Membership group')
  fireEvent.change(group.getByLabelText('Membership group routing'),{ target: { value: 'disabled' } })
  await submit(group)
  assert.deepEqual(calls[0]?.operation,{ type: 'clear',category: 'membership',expectedRevision: 2 })
  assert.equal(calls[0]?.revision,8)
})
test('Channel allowlist and exclusions queue structured IDs while preserving displayed channel names', async () => {
  const { ui,calls } = setup()
  const filters = section(ui,'Logging channel filters')
  selectChannel(filters,'Message observation channels','🌿 stf')
  selectChannel(filters,'Excluded message observation channels','⭐ evt')
  await submit(filters)
  assert.deepEqual(calls[0]?.operation,{ type: 'channels',expectedRevision: 3,messageChannelIds: ['123'],excludedChannelIds: ['456'] })
})
test('Existing fifty-channel filters stay editable, and a fifty-first selection is rejected before queueing', async () => {
  const remote = snapshot()
  const configured = Array.from({ length: 50 },(_,index) => String(1000 + index))
  remote.settings.messageChannelIds = configured
  remote.settings.excludedChannelIds = configured
  const first = setup(remote), filters = section(first.ui,'Logging channel filters')
  selectChannel(filters,'Message observation channels','evt')
  await submit(filters)
  assert.ok(filters.getByRole('alert').textContent?.includes('Choose up to fifty distinct channels'))
  assert.equal(first.calls.length,0)
  fireEvent.click(filters.getByRole('button',{ name: 'Remove ⭐ Event Log',hidden: true }))
  fireEvent.click(filters.getAllByRole('button',{ name: 'Remove 1000',hidden: true })[0]!)
  selectChannel(filters,'Message observation channels','evt')
  await submit(filters)
  assert.deepEqual(first.calls[0]?.operation,{ type: 'channels',expectedRevision: 3,messageChannelIds: [...configured.slice(1),'456'],excludedChannelIds: configured })
})
test('All six group palettes, twenty-two event types and eighteen audit actions remain available without custom color settings', () => {
  const { ui } = setup()
  for (const name of ['Membership','Resources','Messages','Audit','Settings','Operations']) assert.equal(within(ui.getByRole('list',{ name: `${name} color legend` })).getAllByRole('listitem').length,4)
  assert.equal(ui.getAllByLabelText(/ routing$/).length,46)
  assert.equal(ui.container.querySelector('input[type=color]'),null)
  assert.ok(ui.getByText(/Audit actors are shown only/))
})
test('Individual audit actions inherit the audit entry default and queue exact kick or ban selectors', async () => {
  const remote = snapshot()
  remote.settings.eventRoutes = [{ eventType: 'audit-entry',revision: 4,enabled: true,channelId: '123',ownerId: '789' }]
  const { ui,calls } = setup(remote)
  const kicked = section(ui,'Audit: Member kicked')
  assert.ok(kicked.getByText('Current destination: Audit entry default: 🌿 Staff Log'))
  fireEvent.change(kicked.getByLabelText('Audit: Member kicked routing'),{ target: { value: 'channel' } })
  selectChannel(kicked,'Audit: Member kicked destination','evt')
  fireEvent.change(kicked.getByLabelText('Audit: Member kicked owner ID'),{ target: { value: '999' } })
  await submit(kicked)
  assert.deepEqual(calls[0]?.operation,{ type: 'event-route',eventType: 'audit-entry:20',expectedRevision: 8,enabled: true,channelId: '456',ownerId: '999' })
  assert.ok(section(ui,'Audit: Member banned').getByText('Current destination: Audit entry default: 🌿 Staff Log'))
})
test('An explicit disabled audit action wins an enabled catchall and enabled audit group', () => {
  const remote = snapshot()
  remote.settings.routes = remote.settings.routes.map(route => route.category === 'audit' ? { ...route,enabled: true,channelId: '123',ownerId: '789' } : route)
  remote.settings.eventRoutes = [{ eventType: 'audit-entry',revision: 4,enabled: true,channelId: '456',ownerId: '789' },{ eventType: 'audit-entry:22',revision: 8,enabled: false }]
  const { ui } = setup(remote)
  const banned = section(ui,'Audit: Member banned')
  assert.ok(banned.getByText('Current destination: Event override: Disabled'))
  assert.equal((banned.getByLabelText('Audit: Member banned routing') as HTMLSelectElement).value,'disabled')
})
test('Live route changes preserve a dirty draft and require review before queuing the current revision', async () => {
  const { ui,calls,props } = setup()
  const event = section(ui,'Member joined')
  fireEvent.change(event.getByLabelText('Member joined routing'),{ target: { value: 'channel' } })
  selectChannel(event,'Member joined destination','evt')
  fireEvent.change(event.getByLabelText('Member joined owner ID'),{ target: { value: '999' } })
  const remote = structuredClone(props.remote)
  remote.settings.configRevision = 9
  remote.settings.eventRoutes = [{ eventType: 'member-add',revision: 1,enabled: false }]
  ui.rerender(createElement(LogSettings,{ ...props,remote }))
  const current = section(ui,'Member joined')
  assert.equal((current.getByLabelText('Member joined routing') as HTMLSelectElement).value,'channel')
  assert.ok(current.getByText('Changed elsewhere'))
  assert.equal((current.getByRole('button',{ name: 'Request member joined change',hidden: true }) as HTMLButtonElement).disabled,true)
  fireEvent.click(current.getByRole('button',{ name: 'Keep my draft after review',hidden: true }))
  await submit(current)
  assert.equal(calls[0]?.revision,9)
  assert.equal(calls[0]?.operation.expectedRevision,9)
})
test('Uncertain enqueue responses reuse the same request ID for an identical retry', async () => {
  const remote = snapshot(), calls: string[] = []
  const props: LogSettingsProps = { remote,connected: true,queue: async (_,revision,requestId) => { calls.push(requestId); if (calls.length === 1) throw new Error('Synthetic interrupted response'); return { queued: true,conflict: false,revision,jobId: 'job1' } } }
  const ui = render(createElement(LogSettings,props)), module = section(ui,'Channel logs')
  fireEvent.click(module.getByLabelText('Logging enabled'))
  await submit(module)
  assert.ok(module.getByRole('alert'))
  await submit(module)
  assert.equal(calls.length,2)
  assert.equal(calls[0],calls[1])
})
test('Applied bot receipts update route settings and release the pending form', async () => {
  const { ui,calls,props } = setup()
  const event = section(ui,'Member joined')
  fireEvent.change(event.getByLabelText('Member joined routing'),{ target: { value: 'disabled' } })
  await submit(event)
  assert.equal((event.getByLabelText('Member joined routing') as HTMLSelectElement).disabled,true)
  const remote = structuredClone(props.remote)
  remote.settings.configRevision = 9
  remote.settings.eventRoutes = [{ eventType: 'member-add',revision: 9,enabled: false }]
  remote.jobs = [{ id: 'job1',actorId: '999',expectedConfigRevision: 8,operation: calls[0]!.operation,state: 'applied',createdAt: 0,expiresAt: 120000 }]
  ui.rerender(createElement(LogSettings,{ ...props,remote }))
  const applied = section(ui,'Member joined')
  assert.ok(applied.getByText('Change applied'))
  assert.ok(applied.getByText('Current destination: Event override: Disabled'))
  assert.equal((applied.getByLabelText('Member joined routing') as HTMLSelectElement).disabled,false)
})
test('A destination needs an exact owner ID before its native configuration request is queued', async () => {
  const { ui,calls } = setup()
  const event = section(ui,'Member joined')
  fireEvent.change(event.getByLabelText('Member joined routing'),{ target: { value: 'channel' } })
  selectChannel(event,'Member joined destination','evt')
  await submit(event)
  assert.ok(event.getByRole('alert').textContent?.includes('Choose a valid owner ID'))
  assert.equal(calls.length,0)
})
