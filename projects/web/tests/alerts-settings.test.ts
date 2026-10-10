import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import type { DashboardConfigurationOperationMap } from '@neonflux/backend/dashboard-contracts'
import type { ConfigSectionProps } from '../src/configuration-form.tsx'
import { AlertsSettings } from '../src/alerts-settings.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
afterEach(cleanup)
const catalog = { serverId: '2',roles: [],channels: [{ id: '123',name: 'general',type: 0 }] }
const settings = { invites: false,bots: true,webhooks: false,privileges: false,impersonation: false,expectedBotIds: ['77'],expectedWebhookIds: [] }
const invite = { ref: '0123456789abcdef',channelId: '123',inviterId: '55',uses: 2,maxUses: 0,expiresAt: null,createdAt: '2026-01-01T00:00:00.000Z',temporary: false }
function setup(data: unknown) {
  const calls: Array<DashboardConfigurationOperationMap['alerts']> = []
  const props = { remote: { family: 'alerts',serverId: '2',configRevision: 4,jobs: [],data },connected: true,catalog,queue: async (operation: DashboardConfigurationOperationMap['alerts'],revision: number) => { calls.push(operation); return { queued: true,conflict: false,revision,jobId: 'job1' } } } as unknown as ConfigSectionProps<'alerts'>
  return { ui: render(createElement(AlertsSettings,props)),calls }
}
const section = (ui: ReturnType<typeof render>,name: string) => within(ui.getByRole('region',{ name,hidden: true }))
async function submit(form: ReturnType<typeof within>) { await act(async () => { fireEvent.submit(form.getAllByRole('button',{ hidden: true }).find((button: HTMLElement) => button.getAttribute('type') === 'submit')!.closest('form')!) }) }

test('Each alert has its own switch, and expected bots and webhooks are added and removed by ID', async () => {
  const { ui,calls } = setup({ settings,invites: null })
  const privileges = section(ui,'Privilege changes')
  fireEvent.click(privileges.getByLabelText('Privilege changes on'))
  await submit(privileges)
  const expect = section(ui,'Mark a bot or webhook expected')
  fireEvent.change(expect.getByLabelText('Kind'),{ target: { value: 'webhook' } })
  fireEvent.change(expect.getByLabelText('ID'),{ target: { value: 'not an id' } })
  await submit(expect)
  assert.equal(calls.length,1)
  fireEvent.change(expect.getByLabelText('ID'),{ target: { value: '88' } })
  await submit(expect)
  const unexpect = section(ui,'Bot 77')
  fireEvent.click(unexpect.getByLabelText('Alert about it again'))
  await submit(unexpect)
  assert.deepEqual(calls,[{ type: 'set',alert: 'privileges',enabled: true },{ type: 'expect',kind: 'webhook',id: '88',expected: true },{ type: 'expect',kind: 'bot',id: '77',expected: false }])
})

test('The invite list refreshes on request, flags invites without limits and revokes one only after confirmation', async () => {
  const empty = setup({ settings,invites: null })
  const refresh = section(empty.ui,'Invites')
  assert.ok(refresh.getByText('Not read yet'))
  fireEvent.click(refresh.getByLabelText('Read the current invites'))
  await submit(refresh)
  assert.deepEqual(empty.calls,[{ type: 'invites-refresh' }])
  cleanup()
  const { ui,calls } = setup({ settings,invites: { readAt: 1,invites: [invite],more: false } })
  const row = section(ui,'Invite 0123456789abcdef to general')
  assert.ok(row.getByText(/2 of unlimited uses\. Expires: Never\. Flagged: never expires, unlimited uses/))
  await submit(row)
  assert.equal(calls.length,0)
  fireEvent.click(row.getByLabelText('Confirm revoking this invite. Members who joined with it stay'))
  await submit(row)
  assert.deepEqual(calls,[{ type: 'invite-revoke',ref: '0123456789abcdef' }])
})
