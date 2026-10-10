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
// The per-form conflict rule. Every form of a section shares the section revision, so a revision change alone says nothing about one form
test('A save elsewhere in the section that leaves this form\'s fields alone keeps the draft and saves against the newer revision', async () => {
  const saves: number[] = []
  const initial = props({ save: async (_,revision) => { saves.push(revision); return { saved: true,revision: revision + 1 } } }), ui = render(createElement(SettingsForm,initial))
  fireEvent.change(ui.getByLabelText('Prefix'),{ target: { value: '$' } })
  ui.rerender(createElement(SettingsForm,{ ...initial,snapshot: { revision: 4,values: { prefix: '!' } } }))
  assert.ok(!ui.queryByText('Changed elsewhere'),'an unrelated save is no conflict')
  assert.equal((ui.getByLabelText('Prefix') as HTMLInputElement).value,'$')
  assert.equal((ui.getByRole('button',{ name: 'Save changes' }) as HTMLButtonElement).disabled,false)
  await act(async () => { fireEvent.submit(ui.getByRole('button',{ name: 'Save changes' }).closest('form')!) })
  assert.deepEqual(saves,[4])
})
test('A change to the item a form applies to is a conflict even when the form\'s own fields are unchanged', async () => {
  const saves: number[] = []
  const confirm = props({ snapshot: { revision: 0,values: { confirm: false },context: 3 },save: async (_,revision) => { saves.push(revision); return { saved: true,revision: revision + 1 } },
    fields: (values,edit,disabled) => createElement('label',{},'Confirm removal',createElement('input',{ type: 'checkbox',checked: Boolean(values.confirm),disabled,onChange: (event: { target: { checked: boolean } }) => edit('confirm',event.target.checked) })) })
  const ui = render(createElement(SettingsForm,confirm))
  fireEvent.click(ui.getByLabelText('Confirm removal'))
  ui.rerender(createElement(SettingsForm,{ ...confirm,snapshot: { revision: 1,values: { confirm: false },context: 3 } }))
  assert.ok(!ui.queryByText('Changed elsewhere'),'an unrelated save keeps the confirmation')
  ui.rerender(createElement(SettingsForm,{ ...confirm,snapshot: { revision: 2,values: { confirm: false },context: 4 } }))
  assert.ok(ui.getByText('Changed elsewhere'))
  assert.ok(ui.getByText(/The item this form applies to changed after you started/))
  assert.equal((ui.getByLabelText('Confirm removal') as HTMLInputElement).checked,true)
  assert.equal((ui.getByRole('button',{ name: 'Save changes' }) as HTMLButtonElement).disabled,true)
  fireEvent.click(ui.getByRole('button',{ name: 'Keep my draft after review' }))
  await act(async () => { fireEvent.submit(ui.getByRole('button',{ name: 'Save changes' }).closest('form')!) })
  assert.deepEqual(saves,[2])
})
test('A draft the server now matches is up to date instead of conflicting', () => {
  const initial = props(), ui = render(createElement(SettingsForm,initial))
  fireEvent.change(ui.getByLabelText('Prefix'),{ target: { value: '$' } })
  ui.rerender(createElement(SettingsForm,{ ...initial,snapshot: { revision: 3,values: { prefix: '$' } } }))
  assert.ok(!ui.queryByText('Changed elsewhere'),'a matching server value is no conflict')
  assert.ok(ui.getByText('Up to date'))
})
