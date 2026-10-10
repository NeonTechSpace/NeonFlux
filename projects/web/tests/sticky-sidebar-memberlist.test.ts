import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import type { DashboardConfigurationFamily, DashboardConfigurationOperationMap } from '@neonflux/backend/dashboard-contracts'
import type { ConfigSectionProps } from '../src/configuration-form.tsx'
import { StickySettings } from '../src/sticky-settings.tsx'
import { SidebarSettings } from '../src/sidebar-settings.tsx'
import { MemberListSettings, memberListOrder } from '../src/memberlist-settings.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
afterEach(cleanup)
const roles = [{ id: '2',name: '@everyone',position: 0,hoist: false,hoistPosition: null },{ id: '40',name: 'VIP',position: 2,hoist: true,hoistPosition: 50 },{ id: '41',name: 'Mods',position: 18,hoist: true,hoistPosition: null },
  { id: '42',name: 'Helper',position: 5,hoist: true,hoistPosition: null },{ id: '43',name: 'Quiet',position: 9,hoist: false,hoistPosition: null }]
const catalog = { serverId: '2',roles,channels: [{ id: '123',name: 'general',type: 0 },{ id: '124',name: 'news',type: 5 },{ id: '789',name: 'Info',type: 4 },{ id: '601',name: 'NeonFlux dashboard',type: 998 }] }
function setup<F extends DashboardConfigurationFamily>(component: (props: ConfigSectionProps<F>) => unknown, family: F, data: unknown) {
  const calls: Array<{ operation: DashboardConfigurationOperationMap[F],revision: number }> = []
  const props = { remote: { family,serverId: '2',configRevision: 4,jobs: [],data },connected: true,catalog,queue: async (operation: DashboardConfigurationOperationMap[F],revision: number) => { calls.push({ operation,revision }); return { queued: true,conflict: false,revision,jobId: 'job1' } } } as unknown as ConfigSectionProps<F>
  return { ui: render(createElement(component as never,props as never)),calls }
}
const section = (ui: ReturnType<typeof render>,name: string) => within(ui.getByRole('region',{ name,hidden: true }))
async function submit(form: ReturnType<typeof within>) { await act(async () => { fireEvent.submit(form.getAllByRole('button',{ hidden: true }).find((button: HTMLElement) => button.getAttribute('type') === 'submit')!.closest('form')!) }) }
const sticky = { channelId: '123',content: 'Read the rules',intervalSeconds: 30,messageId: '900',revision: 2,updatedAt: 1 }

test('Adding a sticky queues the channel, text and interval, and the limit and bounds are checked before queueing', async () => {
  const { ui,calls } = setup(StickySettings,'sticky',{ stickies: [] })
  const form = section(ui,'Add sticky message')
  const picker = form.getByRole('combobox',{ name: 'Channel',hidden: true })
  fireEvent.change(picker,{ target: { value: 'news' } }); fireEvent.keyDown(picker,{ key: 'Enter' })
  fireEvent.change(form.getByLabelText('Sticky text'),{ target: { value: 'Post links in #links' } })
  fireEvent.change(form.getByLabelText('Repost interval in seconds'),{ target: { value: '5' } })
  await submit(form)
  assert.equal(calls.length,0)
  assert.ok(form.getByRole('alert').textContent?.includes('between 10 and 3600'))
  fireEvent.change(form.getByLabelText('Repost interval in seconds'),{ target: { value: '90' } })
  await submit(form)
  assert.deepEqual(calls,[{ operation: { type: 'set',channelId: '124',content: 'Post links in #links',intervalSeconds: 90 },revision: 4 }])
  cleanup()
  const full = setup(StickySettings,'sticky',{ stickies: ['1','2','3','4','5'].map(channelId => ({ ...sticky,channelId })) })
  assert.ok(full.ui.getByText(/maximum of 5 sticky messages/))
})

test('Changing and removing a sticky name its channel, and removal needs confirmation', async () => {
  const { ui,calls } = setup(StickySettings,'sticky',{ stickies: [sticky] })
  const edit = section(ui,'Sticky in general')
  fireEvent.change(edit.getByLabelText('Sticky text'),{ target: { value: 'Read the new rules' } })
  await submit(edit)
  const remove = section(ui,'Remove the sticky in general')
  fireEvent.click(remove.getByLabelText('Confirm removing this sticky'))
  await submit(remove)
  assert.deepEqual(calls.map(call => call.operation),[{ type: 'set',channelId: '123',content: 'Read the new rules',intervalSeconds: 30 },{ type: 'remove',channelId: '123' }])
})

test('The dashboard link section adds one link, then offers rename and removal', async () => {
  const empty = setup(SidebarSettings,'sidebar',{ link: null }), add = section(empty.ui,'Add dashboard link')
  fireEvent.click(add.getByLabelText('Create the dashboard link channel'))
  await submit(add)
  assert.deepEqual(empty.calls[0]?.operation,{ type: 'add',name: 'NeonFlux dashboard',categoryId: null })
  cleanup()
  const { ui,calls } = setup(SidebarSettings,'sidebar',{ link: { channelId: '601',revision: 1,updatedAt: 1 } })
  assert.ok(ui.getByText('Current link: NeonFlux dashboard'))
  assert.equal(ui.queryByRole('region',{ name: 'Add dashboard link',hidden: true }),null)
  const rename = section(ui,'Rename dashboard link')
  fireEvent.change(rename.getByLabelText('Link name'),{ target: { value: 'Server settings' } })
  await submit(rename)
  assert.deepEqual(calls[0]?.operation,{ type: 'set',name: 'Server settings' })
})

test('The member list shows hoisted roles top first and saves the order moved with up and down', async () => {
  assert.deepEqual(memberListOrder(catalog).map(role => role.name),['VIP','Mods','Helper'])
  const { ui,calls } = setup(MemberListSettings,'memberlist',{})
  const form = section(ui,'Display order')
  assert.ok(form.getByRole('button',{ name: 'Move VIP up',hidden: true }).hasAttribute('disabled'))
  fireEvent.click(form.getByRole('button',{ name: 'Move Helper up',hidden: true }))
  fireEvent.click(form.getByRole('button',{ name: 'Move VIP down',hidden: true }))
  await submit(form)
  assert.deepEqual(calls,[{ operation: { type: 'set',roleIds: ['42','40','41'] },revision: 4 }])
  const reset = section(ui,'Reset member list order')
  await submit(reset)
  assert.equal(calls.length,1)
  fireEvent.click(reset.getByLabelText('Confirm resetting the member list order'))
  await submit(reset)
  assert.deepEqual(calls[1]?.operation,{ type: 'reset' })
})
