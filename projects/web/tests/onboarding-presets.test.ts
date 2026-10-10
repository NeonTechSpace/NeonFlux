import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import type { DashboardConfigurationDataMap, DashboardConfigurationOperationMap } from '@neonflux/backend/dashboard-contracts'
import type { ConfigSectionProps } from '../src/configuration-form.tsx'
import { OnboardingSettings } from '../src/onboarding-checklist.tsx'
import { PresetSettings } from '../src/preset-settings.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
afterEach(cleanup)
const catalog = { serverId: '2',channels: [{ id: '31',name: 'introductions',type: 0 }],roles: [{ id: '2',name: '@everyone',position: 0 },{ id: '41',name: 'Member',position: 2 }] }
function setup<F extends 'onboarding' | 'presets'>(family: F,data: DashboardConfigurationDataMap[F]) {
  const calls: Array<{ operation: DashboardConfigurationOperationMap[F],revision: number }> = []
  const props = { remote: { family,serverId: '2',configRevision: 3,jobs: [],data },connected: true,catalog,queue: async (operation: DashboardConfigurationOperationMap[F],revision: number) => { calls.push({ operation,revision }); return { queued: true,conflict: false,revision,jobId: 'job1' } } } as unknown as ConfigSectionProps<F>
  const component = family === 'onboarding' ? OnboardingSettings : PresetSettings
  return { ui: render(createElement(component as never,props as never)),calls }
}
const section = (ui: ReturnType<typeof render>,name: string) => within(ui.getByRole('region',{ name,hidden: true }))
async function submit(form: ReturnType<typeof within>) { await act(async () => { fireEvent.submit(form.getAllByRole('button',{ hidden: true }).find((button: HTMLElement) => button.getAttribute('type') === 'submit')!.closest('form')!) }) }

test('The checklist steps save as one ordered list, and incomplete steps never reach the queue', async () => {
  const { ui,calls } = setup('onboarding',{ settings: { enabled: true,delivery: 'welcome',steps: [{ type: 'rules' }],completionRoleId: null },completions: 4 })
  assert.ok(ui.getByText('Members who finished it in the last 7 days: 4'))
  const form = section(ui,'Steps')
  fireEvent.click(form.getByRole('button',{ name: 'Add step',hidden: true }))
  fireEvent.change(form.getByLabelText('Step 2'),{ target: { value: 'panel' } })
  await submit(form)
  assert.ok(form.getByRole('alert').textContent?.includes('Step 2: Enter the panel name'))
  assert.equal(calls.length,0)
  fireEvent.change(form.getByLabelText('Panel name'),{ target: { value: 'Colors' } })
  fireEvent.click(form.getByRole('button',{ name: 'Add step',hidden: true }))
  fireEvent.change(form.getByLabelText('Step 3'),{ target: { value: 'link' } })
  const picker = form.getByRole('combobox',{ name: 'Step 3 channel',hidden: true })
  fireEvent.change(picker,{ target: { value: 'intro' } }); fireEvent.keyDown(picker,{ key: 'Enter' })
  fireEvent.change(form.getByLabelText('Line'),{ target: { value: ' Say hello ' } })
  await submit(form)
  assert.deepEqual(calls,[{ operation: { type: 'steps',steps: [{ type: 'rules' },{ type: 'panel',name: 'colors' },{ type: 'link',channelId: '31',text: 'Say hello' }] },revision: 3 }])
})

test('A preset lists the exact changes and applies only after confirmation, with the token of that preview', async () => {
  const token = '0a1b2c3d'
  const { ui,calls } = setup('presets',{ presets: [
    { name: 'gaming',kind: 'community',description: 'Leveling with quick XP',token,changes: [{ family: 'leveling',setting: 'leveling',from: 'off',to: 'on' }] },
    { name: 'strict',kind: 'security',description: 'Strict automod',token: 'ffffffff',changes: [] },
  ] })
  assert.ok(ui.getByText('strict (security level): Already matches'))
  assert.equal(ui.queryByRole('region',{ name: 'Apply strict',hidden: true }),null)
  assert.ok(within(ui.getByRole('list',{ name: 'Changes of gaming',hidden: true })).getByText('leveling: off → on'))
  const form = section(ui,'Apply gaming')
  // Nothing is applied until the manager confirms the listed changes
  assert.equal((form.getByRole('button',{ name: 'Apply preset',hidden: true }) as HTMLButtonElement).disabled,true)
  fireEvent.click(form.getByLabelText('Confirm the 1 changes'))
  await submit(form)
  assert.deepEqual(calls,[{ operation: { type: 'apply',name: 'gaming',token },revision: 3 }])
})
