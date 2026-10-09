import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import type { DashboardConfigurationDataMap, DashboardConfigurationOperationMap } from '@neonflux/backend/dashboard-contracts'
import type { ConfigSectionProps } from '../src/configuration-form.tsx'
import { VoiceSettings } from '../src/voice-settings.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
afterEach(cleanup)
const catalog = { serverId: '2',roles: [],channels: [{ id: '501',name: 'Join to create',type: 2 },{ id: '789',name: 'Voice rooms',type: 4 },{ id: '123',name: 'General',type: 0 }] }
const generator = { channelId: '501',categoryId: '789',template: "{owner}'s room",userLimit: null,region: null,revision: 3,createdAt: 1,updatedAt: 2 }
function setup(data: DashboardConfigurationDataMap['voice']) {
  const calls: Array<{ operation: DashboardConfigurationOperationMap['voice'],revision: number }> = []
  const props = { remote: { family: 'voice',serverId: '2',configRevision: 7,jobs: [],data },connected: true,catalog,queue: async (operation: DashboardConfigurationOperationMap['voice'],revision: number) => { calls.push({ operation,revision }); return { queued: true,conflict: false,revision,jobId: 'job1' } } } as unknown as ConfigSectionProps<'voice'>
  return { ui: render(createElement(VoiceSettings,props)),calls }
}
const section = (ui: ReturnType<typeof render>,name: string) => within(ui.getByRole('region',{ name,hidden: true }))
async function submit(form: ReturnType<typeof within>) { await act(async () => { fireEvent.submit(form.getAllByRole('button',{ hidden: true }).find((button: HTMLElement) => button.getAttribute('type') === 'submit')!.closest('form')!) }) }

test('Adding a generator queues every room setting with the shared configuration revision', async () => {
  const { ui,calls } = setup({ generators: [],rooms: 0 })
  assert.ok(ui.getByText(/Generators 0\/10, live rooms 0\/50/))
  const form = section(ui,'Add generator')
  fireEvent.change(form.getByLabelText('New generator name'),{ target: { value: 'Lobby' } })
  const picker = form.getByRole('combobox',{ name: 'Room category',hidden: true })
  fireEvent.change(picker,{ target: { value: 'voice' } }); fireEvent.keyDown(picker,{ key: 'Enter' })
  fireEvent.change(form.getByLabelText('Room name template'),{ target: { value: '{owner} hangout' } })
  fireEvent.change(form.getByLabelText('Default member limit'),{ target: { value: '6' } })
  fireEvent.change(form.getByLabelText('Voice region'),{ target: { value: 'eu-west' } })
  await submit(form)
  assert.deepEqual(calls,[{ operation: { type: 'generator-add',channelName: 'Lobby',categoryId: '789',template: '{owner} hangout',userLimit: 6,region: 'eu-west' },revision: 7 }])
})

test('A server with ten generators gets a clear limit error instead of a queued add', async () => {
  const { ui,calls } = setup({ generators: Array.from({ length: 10 },(_,index) => ({ ...generator,channelId: String(600 + index) })),rooms: 0 })
  const form = section(ui,'Add generator')
  fireEvent.change(form.getByLabelText('New generator name'),{ target: { value: 'Lobby' } })
  await submit(form)
  assert.ok(form.getByRole('alert').textContent?.includes('at most 10 generators'))
  assert.equal(calls.length,0)
})

test('Generator settings keep the exact revision and only rename when the name changes', async () => {
  const { ui,calls } = setup({ generators: [generator],rooms: 2 })
  const form = section(ui,'Generator Join to create')
  fireEvent.change(form.getByLabelText('Room name template'),{ target: { value: 'Room of {owner}' } })
  await submit(form)
  assert.deepEqual(calls[0]?.operation,{ type: 'generator-set',channelId: '501',expectedRevision: 3,patch: { categoryId: '789',template: 'Room of {owner}',userLimit: null,region: null } })
  cleanup()
  const renamed = setup({ generators: [generator],rooms: 2 }), again = section(renamed.ui,'Generator Join to create')
  fireEvent.change(again.getByLabelText('Generator name'),{ target: { value: 'Gaming' } })
  fireEvent.change(again.getByLabelText('Default member limit'),{ target: { value: '12' } })
  await submit(again)
  assert.deepEqual(renamed.calls[0]?.operation,{ type: 'generator-set',channelId: '501',expectedRevision: 3,patch: { channelName: 'Gaming',categoryId: '789',template: "{owner}'s room",userLimit: 12,region: null } })
})

test('Invalid templates and unconfirmed removal never reach the queue', async () => {
  const { ui,calls } = setup({ generators: [generator],rooms: 0 })
  const settings = section(ui,'Generator Join to create')
  fireEvent.change(settings.getByLabelText('Room name template'),{ target: { value: '{user} room' } })
  await submit(settings)
  assert.ok(settings.getByRole('alert').textContent?.includes('only the {owner} placeholder'))
  const removal = section(ui,'Remove generator Join to create')
  await submit(removal)
  assert.equal(calls.length,0)
  fireEvent.click(removal.getByLabelText('Confirm generator removal'))
  await submit(removal)
  assert.deepEqual(calls[0]?.operation,{ type: 'generator-remove',channelId: '501',expectedRevision: 3 })
})

test('A generator missing from the loaded channel list reloads it once, then shows its name or an unavailable label', () => {
  let refreshes = 0
  const fresh = { ...generator,channelId: '777' }
  const props = (data: DashboardConfigurationDataMap['voice'],channels = catalog.channels) => ({ remote: { family: 'voice',serverId: '2',configRevision: 7,jobs: [],data },connected: true,catalog: { ...catalog,channels },catalogLoading: false,refreshCatalog: () => { refreshes++ },queue: async () => ({ queued: true,conflict: false,revision: 7,jobId: 'job1' }) }) as unknown as ConfigSectionProps<'voice'> & { refreshCatalog: () => void }
  const ui = render(createElement(VoiceSettings,props({ generators: [fresh],rooms: 0 })))
  assert.equal(refreshes,1)
  assert.ok(ui.getByText('Loading channel name'))
  ui.rerender(createElement(VoiceSettings,props({ generators: [fresh],rooms: 0 },[...catalog.channels,{ id: '777',name: 'New lobby',type: 2 }])))
  assert.ok(ui.getByText('New lobby'))
  assert.equal(refreshes,1)
  ui.rerender(createElement(VoiceSettings,props({ generators: [fresh],rooms: 0 })))
  assert.ok(ui.getByText('Unavailable channel 777'))
  assert.equal(refreshes,1)
  ui.rerender(createElement(VoiceSettings,props({ generators: [{ ...fresh,revision: 4 }],rooms: 0 },[...catalog.channels,{ id: '777',name: 'New lobby',type: 2 }])))
  assert.equal(refreshes,2,'a renamed generator reloads the channel list once more')
})
