import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import type { DashboardConfigurationDataMap, DashboardConfigurationOperationMap } from '@neonflux/backend/dashboard-contracts'
import type { ConfigSectionProps } from '../src/configuration-form.tsx'
import { TemporaryRoleSettings } from '../src/temporary-role-settings.tsx'
import { localTime } from '../src/time.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
afterEach(cleanup)
const catalog = { serverId: '2',channels: [],roles: [{ id: '2',name: '@everyone',position: 0 },{ id: '41',name: 'Event winner',position: 2 },{ id: '42',name: 'Helper',position: 3 }] }
const grant = { grantId: 'g1',userId: '70',roleId: '41',joinedAt: '2026-01-01T00:00:00.000Z',endsAt: Date.parse('2026-02-01T12:30:00Z'),grantedBy: '71',createdAt: 1,updatedAt: 1,sourceId: 'temp_g1_1' }
function setup(data: DashboardConfigurationDataMap['temproles']) {
  const calls: Array<{ operation: DashboardConfigurationOperationMap['temproles'],revision: number }> = []
  const props = { remote: { family: 'temproles',serverId: '2',configRevision: 4,jobs: [],data },connected: true,catalog,queue: async (operation: DashboardConfigurationOperationMap['temproles'],revision: number) => { calls.push({ operation,revision }); return { queued: true,conflict: false,revision,jobId: 'job1' } } } as unknown as ConfigSectionProps<'temproles'>
  return { ui: render(createElement(TemporaryRoleSettings,props)),calls }
}
const section = (ui: ReturnType<typeof render>,name: string) => within(ui.getByRole('region',{ name,hidden: true }))
async function submit(form: ReturnType<typeof within>) { await act(async () => { fireEvent.submit(form.getAllByRole('button',{ hidden: true }).find((button: HTMLElement) => button.getAttribute('type') === 'submit')!.closest('form')!) }) }

test('Active grants show their role, end time and any problem that keeps a role in place', () => {
  const { ui } = setup({ settings: { roles: [] },grants: [grant,{ ...grant,grantId: 'g2',roleId: '42',problem: 'permission' }],more: true })
  const list = section(ui,'Active temporary roles')
  const end = localTime(grant.endsAt)
  assert.deepEqual(list.getAllByRole('listitem').map(item => item.textContent),[`Member 70: Event winner, ends ${end}`,`Member 70: Helper, ended ${end} and not removed yet. NeonFlux lacks Manage Roles. Grant it to the NeonFlux role`])
  assert.ok(list.getByText(/Showing the 100 that end first/))
})

test('Role defaults queue both durations with the shared configuration revision, and invalid durations never reach the queue', async () => {
  const { ui,calls } = setup({ settings: { roles: [{ roleId: '41',defaultSeconds: 604800 }] },grants: [],more: false })
  assert.ok(ui.getByText('Event winner: Default 1w, longest 365d'))
  const form = section(ui,'Add role defaults')
  const picker = form.getByRole('combobox',{ name: 'Role',hidden: true })
  fireEvent.change(picker,{ target: { value: 'help' } }); fireEvent.keyDown(picker,{ key: 'Enter' })
  fireEvent.change(form.getByLabelText('Default duration'),{ target: { value: 'forever' } })
  await submit(form)
  assert.ok(form.getByRole('alert').textContent?.includes('m, h, d or w'))
  fireEvent.change(form.getByLabelText('Default duration'),{ target: { value: '40d' } })
  fireEvent.change(form.getByLabelText('Longest duration'),{ target: { value: '30d' } })
  await submit(form)
  assert.ok(form.getByRole('alert').textContent?.includes('longer than the longest'))
  assert.equal(calls.length,0)
  fireEvent.change(form.getByLabelText('Default duration'),{ target: { value: '12h' } })
  await submit(form)
  assert.deepEqual(calls,[{ operation: { type: 'role',roleId: '42',defaultSeconds: 43200,maxSeconds: 2592000 },revision: 4 }])
  // Clearing both durations of a role with defaults removes them
  const existing = section(ui,'Defaults for Event winner')
  fireEvent.change(existing.getByLabelText('Default duration'),{ target: { value: '' } })
  await submit(existing)
  assert.deepEqual(calls[1]?.operation,{ type: 'role',roleId: '41',defaultSeconds: null,maxSeconds: null })
})
