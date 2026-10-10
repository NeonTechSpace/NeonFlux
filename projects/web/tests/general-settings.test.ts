import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import type { GeneralNickname } from '@neonflux/contracts/general'
import type { DashboardConfigurationJob, DashboardConfigurationOperationMap } from '@neonflux/backend/dashboard-contracts'
import type { ConvexReactClient } from 'convex/react'
import { getFunctionName } from 'convex/server'
import type { SectionProps } from '../src/dashboard-sections.tsx'
import { GeneralSection,NicknameSettings } from '../src/general-settings.tsx'

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

function general(results: Array<{ saved: true,revision: number } | { saved: false,conflict: true,revision: number }>) {
  const saves: unknown[] = []
  const client = {
    connectionState: () => ({ isWebSocketConnected: true }),
    subscribeToConnectionState: () => () => {},
    action: async (_ref: unknown,args: unknown) => { saves.push(args); return results.shift() },
    watchQuery: (ref: unknown,args: { serverId: string }) => ({
      localQueryResult: () => getFunctionName(ref as never) === 'dashboardViews:general' ? { serverId: args.serverId,prefix: '?',replyStyle: 'embed',revision: 3 } : undefined,
      onUpdate: () => () => {} }),
  } as unknown as ConvexReactClient
  const ui = render(createElement(GeneralSection,{ section: 'general',client,sessionToken: 'synthetic-session',serverId: '2',userId: '1',connected: true,catalogLoading: false,catalogError: false } as SectionProps))
  const style = ui.getByRole('combobox',{ name: /^Reply style/ }) as HTMLSelectElement
  return { ui,saves,style }
}
test('The reply style saves with the prefix at the shared general revision', async () => {
  const { ui,saves,style } = general([{ saved: true,revision: 4 }])
  assert.equal(style.value,'embed')
  fireEvent.change(style,{ target: { value: 'text' } })
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Save changes' })) })
  assert.deepEqual(saves,[{ sessionToken: 'synthetic-session',serverId: '2',section: 'general',expectedRevision: 3,prefix: '?',replyStyle: 'text' }])
  assert.ok(ui.getByText('Settings saved'))
})
test('A reply style save that meets a newer revision keeps the draft and asks for review, like the prefix', async () => {
  const { ui,saves,style } = general([{ saved: false,conflict: true,revision: 4 }])
  fireEvent.change(style,{ target: { value: 'text' } })
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Save changes' })) })
  assert.equal(saves.length,1)
  assert.match(ui.getByRole('alert').textContent!,/Settings changed before your save/)
  assert.equal(style.value,'text')
})
