import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import type { GeneralNickname } from '@neonflux/backend/contracts'
import type { DashboardConfigurationJob, DashboardConfigurationOperationMap } from '@neonflux/backend/dashboard-contracts'
import { NicknameSettings } from '../src/general-settings.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act } = await import('@testing-library/react')
afterEach(cleanup)

function setup(settings: GeneralNickname,jobs: DashboardConfigurationJob[] = []) {
  const calls: Array<{ operation: DashboardConfigurationOperationMap['nickname'],revision: number }> = []
  const queue = async (operation: DashboardConfigurationOperationMap['nickname'],revision: number) => { calls.push({ operation,revision }); return { queued: true,conflict: false,revision,jobId: 'job1' } }
  const ui = render(createElement(NicknameSettings,{ remote: { family: 'nickname',serverId: '2',configRevision: 4,data: { settings },jobs },connected: true,queue }))
  return { ui,calls }
}

test('Setting the bot nickname queues the exact name at the current revision', async () => {
  const { ui,calls } = setup({ nickname: null,revision: 4,result: null })
  fireEvent.change(ui.getByLabelText('Nickname'),{ target: { value: 'Neon Helper' } })
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Apply nickname' })) })
  assert.deepEqual(calls,[{ operation: { type: 'set',nickname: 'Neon Helper' },revision: 4 }])
})
test('Reset queues a reset even when the stored nickname is already empty', async () => {
  const { ui,calls } = setup({ nickname: null,revision: 4,result: null })
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Reset to username' })) })
  assert.deepEqual(calls,[{ operation: { type: 'reset' },revision: 4 }])
})
test('Invalid nicknames stay local with a reason', async () => {
  const { ui,calls } = setup({ nickname: 'Neon',revision: 4,result: null })
  for (const value of [' Neon','x'.repeat(33),'Neon\u0007','Ne\u202eon']) {
    fireEvent.change(ui.getByLabelText('Nickname'),{ target: { value } })
    await act(async () => { fireEvent.submit(ui.getByLabelText('Nickname').closest('form')!) })
    assert.match(ui.getByRole('alert').textContent!,/1 to 32 characters/)
  }
  assert.deepEqual(calls,[])
})
test('The last apply result shows applied names and failure reasons', () => {
  const applied = setup({ nickname: 'Neon',revision: 4,result: { state: 'applied',nickname: 'Neon',at: 1 } })
  assert.match(applied.ui.getByText(/Last result/).textContent!,/Applied: Neon/)
  cleanup()
  const failed = setup({ nickname: 'Neon',revision: 4,result: { state: 'failed',nickname: 'Neon',at: 1,error: 'Missing Change Nickname permission. Fluxer kept a different nickname' } })
  assert.match(failed.ui.getByText(/Last result/).textContent!,/Failed: Missing Change Nickname permission/)
  cleanup()
  const waiting = setup({ nickname: 'Neon',revision: 4,result: null },[{ id: 'job1',family: 'nickname',operation: { type: 'set',nickname: 'Neon' },actorId: '1',expectedConfigRevision: 4,state: 'queued',createdAt: 1,expiresAt: 2 }])
  assert.match(waiting.ui.getByText(/Last result/).textContent!,/Waiting for the bot/)
  assert.equal((waiting.ui.getByRole('button',{ name: 'Reset to username' }) as HTMLButtonElement).disabled,true)
})
