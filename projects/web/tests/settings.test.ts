import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { SettingsForm } from '../src/settings-form.tsx'
import type { SettingsFormProps } from '../src/settings-form.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000' })
Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true })
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, configurable: true })
const { render, fireEvent, cleanup, act } = await import('@testing-library/react')
afterEach(cleanup)
function props(overrides: Partial<SettingsFormProps> = {}): SettingsFormProps {
  return { title: 'General', description: 'Command prefix', connected: true, snapshot: { revision: 0, values: { prefix: '!' } }, save: async () => ({ saved: true, revision: 1 }), fields: (values,edit,disabled) => createElement('label', {}, 'Prefix', createElement('input', { value: String(values.prefix), disabled, onChange: (event: { target: { value: string } }) => edit('prefix',event.target.value) })), ...overrides }
}
test('Clean input follows live values, dirty input retains draft and blocks stale saves until explicit review', async () => {
  const saves: Array<{ values: unknown, revision: number }> = []
  const initial = props({ save: async (values,revision) => { saves.push({ values,revision }); return { saved: true, revision: revision + 1 } } })
  const ui = render(createElement(SettingsForm, initial))
  ui.rerender(createElement(SettingsForm, { ...initial, snapshot: { revision: 1, values: { prefix: '?' } } }))
  assert.equal((ui.getByLabelText('Prefix') as HTMLInputElement).value, '?')
  fireEvent.change(ui.getByLabelText('Prefix'), { target: { value: '$' } })
  ui.rerender(createElement(SettingsForm, { ...initial, snapshot: { revision: 2, values: { prefix: '#' } } }))
  assert.equal((ui.getByLabelText('Prefix') as HTMLInputElement).value, '$')
  assert.ok(ui.getByText('Changed elsewhere'))
  assert.equal((ui.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled, true)
  assert.equal(saves.length, 0)
  fireEvent.click(ui.getByRole('button', { name: 'Keep my draft after review' }))
  await act(async () => { fireEvent.submit(ui.getByRole('button', { name: 'Save changes' }).closest('form')!) })
  assert.deepEqual(saves, [{ values: { prefix: '$' }, revision: 2 }])
  assert.ok(ui.getByText('Settings saved'))
})
test('Reload discards only the local draft and save failure keeps its value', async () => {
  const initial = props({ save: async () => { throw new Error('network') } }), ui = render(createElement(SettingsForm, initial))
  fireEvent.change(ui.getByLabelText('Prefix'), { target: { value: '$' } })
  await act(async () => { fireEvent.submit(ui.getByRole('button', { name: 'Save changes' }).closest('form')!) })
  assert.equal((ui.getByLabelText('Prefix') as HTMLInputElement).value, '$')
  assert.match(ui.getByRole('alert').textContent!, /Your draft has been kept/)
  ui.rerender(createElement(SettingsForm, { ...initial, snapshot: { revision: 1, values: { prefix: '?' } } }))
  fireEvent.click(ui.getByRole('button', { name: 'Reload current settings' }))
  assert.equal((ui.getByLabelText('Prefix') as HTMLInputElement).value, '?')
})
test('Offline blocks saves and CAS conflict preserves the draft for live review', async () => {
  const initial = props({ connected: false, save: async () => ({ saved: false, conflict: true, revision: 2 }) }), ui = render(createElement(SettingsForm, initial))
  fireEvent.change(ui.getByLabelText('Prefix'), { target: { value: '$' } })
  assert.equal((ui.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled, true)
  ui.rerender(createElement(SettingsForm, { ...initial, connected: true }))
  await act(async () => { fireEvent.submit(ui.getByRole('button', { name: 'Save changes' }).closest('form')!) })
  assert.equal((ui.getByLabelText('Prefix') as HTMLInputElement).value, '$')
  assert.match(ui.getByRole('alert').textContent!, /Settings changed before your save/)
})
test('A queued role change waits for real applied confirmation and failure preserves its draft', async () => {
  const initial = props({ jobs: [], save: async () => ({ queued: true, jobId: 'job1', revision: 0 }) }), ui = render(createElement(SettingsForm, initial))
  fireEvent.change(ui.getByLabelText('Prefix'), { target: { value: '$' } })
  await act(async () => { fireEvent.submit(ui.getByRole('button', { name: 'Save changes' }).closest('form')!) })
  assert.ok(ui.getByText('Change queued. Waiting for bot confirmation'))
  assert.equal(ui.queryByText('Settings saved'), null)
  assert.equal((ui.getByRole('button', { name: 'Waiting for bot…' }) as HTMLButtonElement).disabled, true)
  const job = { id: 'job1', actorId: '1', section: 'reaction' as const, expectedRevision: 0, operation: { type: 'settings' as const, patch: { panelsEnabled: true } }, createdAt: 0, expiresAt: 120000, state: 'applied' as const }
  ui.rerender(createElement(SettingsForm, { ...initial, snapshot: { revision: 1, values: { prefix: '$' } }, jobs: [job] }))
  assert.ok(ui.getByText('Change applied'))
  assert.equal((ui.getByLabelText('Prefix') as HTMLInputElement).value, '$')
  cleanup()
  const failed = render(createElement(SettingsForm, initial))
  fireEvent.change(failed.getByLabelText('Prefix'), { target: { value: '%' } })
  await act(async () => { fireEvent.submit(failed.getByRole('button', { name: 'Save changes' }).closest('form')!) })
  failed.rerender(createElement(SettingsForm, { ...initial, jobs: [{ ...job, state: 'failed', error: 'Native permission unavailable' }] }))
  assert.equal((failed.getByLabelText('Prefix') as HTMLInputElement).value, '%')
  assert.match(failed.getByRole('alert').textContent!, /Native permission unavailable/)
})
