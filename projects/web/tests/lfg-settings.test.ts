import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import type { DashboardConfigurationOperationMap } from '@neonflux/backend/dashboard-contracts'
import type { ConfigSectionProps } from '../src/configuration-form.tsx'
import { LfgSettings } from '../src/lfg-settings.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
afterEach(cleanup)
const catalog = { serverId: '2',roles: [],channels: [{ id: '123',name: 'general',type: 0 },{ id: '124',name: 'groups',type: 0 },{ id: '500',name: 'Join to create',type: 2 },{ id: '501',name: 'Lounge',type: 2 }] }
const settings = { enabled: false,channelId: null,generatorChannelId: null,expiryMinutes: 60,maxSize: 10,memberGroups: 1,serverGroups: 20 }
function setup() {
  const calls: Array<{ operation: DashboardConfigurationOperationMap['lfg'],revision: number }> = []
  const props = { remote: { family: 'lfg',serverId: '2',configRevision: 3,jobs: [],data: { settings,generators: ['500'],open: 2 } },connected: true,catalog,
    queue: async (operation: DashboardConfigurationOperationMap['lfg'],revision: number) => { calls.push({ operation,revision }); return { queued: true,conflict: false,revision,jobId: 'job1' } } } as unknown as ConfigSectionProps<'lfg'>
  return { ui: render(createElement(LfgSettings,props)),calls }
}
const choose = (form: ReturnType<typeof within>,label: string,text: string) => {
  const picker = form.getByRole('combobox',{ name: label,hidden: true })
  fireEvent.change(picker,{ target: { value: text } }); fireEvent.keyDown(picker,{ key: 'Enter' })
}
async function submit(form: ReturnType<typeof within>) { await act(async () => { fireEvent.submit(form.getAllByRole('button',{ hidden: true }).find((button: HTMLElement) => button.getAttribute('type') === 'submit')!.closest('form')!) }) }

test('Saving queues every group setting, offers only voice generators and checks the bounds first', async () => {
  const { ui,calls } = setup()
  const form = within(ui.getByRole('region',{ name: 'Group settings',hidden: true }))
  assert.ok(ui.getByText(/Open groups now 2/))
  fireEvent.click(form.getByLabelText('Looking for group is on'))
  choose(form,'Group channel','groups')
  // Only generators are offered, not the ordinary voice channel
  const generator = form.getByRole('combobox',{ name: 'Voice generator',hidden: true })
  fireEvent.change(generator,{ target: { value: 'Lounge' } })
  assert.equal(within(document.body).queryByRole('option',{ name: /Lounge/,hidden: true }),null)
  choose(form,'Voice generator','Join to create')
  fireEvent.change(form.getByLabelText('Largest group size'),{ target: { value: '30' } })
  await submit(form)
  assert.equal(calls.length,0)
  assert.ok(form.getByRole('alert').textContent?.includes('between 2 and 25'))
  fireEvent.change(form.getByLabelText('Largest group size'),{ target: { value: '5' } })
  await submit(form)
  assert.deepEqual(calls,[{ operation: { type: 'settings',patch: { enabled: true,channelId: '124',generatorChannelId: '500',expiryMinutes: 60,maxSize: 5,memberGroups: 1,serverGroups: 20 } },revision: 3 }])
})
