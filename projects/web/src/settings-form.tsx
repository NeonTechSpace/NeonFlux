import { useEffect, useReducer, useState } from 'react'
import type { ReactNode } from 'react'
import type { DashboardSaveResult } from '@neonflux/backend/dashboard-contracts'

export type FormValues = Record<string, string | boolean>
type Values = FormValues
export class FormInputError extends Error {}
export type FormSaveResult = DashboardSaveResult | { queued: true, jobId: string, revision: number }
export interface SettingsJob { id: string, state: 'queued' | 'configured' | 'applied' | 'failed' | 'conflict', error?: string }
interface Snapshot { revision: number, values: Values }
interface Draft { base: Snapshot, current: Snapshot, values: Values }
type Event = { type: 'remote', snapshot: Snapshot } | { type: 'edit', key: string, value: string | boolean } | { type: 'reload' } | { type: 'review' } | { type: 'saved', snapshot: Snapshot }
function equal(a: Values, b: Values): boolean { return JSON.stringify(a) === JSON.stringify(b) }
function reducer(state: Draft, event: Event): Draft {
  if (event.type === 'edit') return { ...state, values: { ...state.values, [event.key]: event.value } }
  if (event.type === 'reload') return { base: state.current, current: state.current, values: state.current.values }
  if (event.type === 'review') return { ...state, base: state.current }
  if (event.type === 'saved') return { base: event.snapshot, current: state.current.revision > event.snapshot.revision ? state.current : event.snapshot, values: event.snapshot.values }
  if (event.snapshot.revision < state.current.revision || event.snapshot.revision === state.current.revision && equal(event.snapshot.values,state.current.values)) return state
  if (equal(state.values, state.base.values)) return { base: event.snapshot, current: event.snapshot, values: event.snapshot.values }
  return { ...state, current: event.snapshot }
}

export interface SettingsFormProps {
  title: string
  description: string
  snapshot: Snapshot
  connected: boolean
  save: (values: Values, expectedRevision: number) => Promise<FormSaveResult>
  fields: (values: Values, edit: (key: string, value: string | boolean) => void, disabled: boolean) => ReactNode
  jobs?: SettingsJob[]
  resetAfterApplied?: boolean
  submitLabel?: string
}

export function SettingsForm({ title, description, snapshot, connected, save, fields, jobs, resetAfterApplied, submitLabel = 'Save changes' }: SettingsFormProps) {
  const [draft, dispatch] = useReducer(reducer, { base: snapshot, current: snapshot, values: snapshot.values })
  const [saving, setSaving] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  const [queued, setQueued] = useState<{ id: string, values: Values }>()
  const snapshotKey = JSON.stringify(snapshot)
  useEffect(() => { dispatch({ type: 'remote', snapshot }) }, [snapshotKey])
  const job = jobs?.find(value => value.id === queued?.id)
  useEffect(() => {
    if (!queued || !job || job.state === 'queued' || job.state === 'configured') return
    if (job.state === 'applied') {
      if (resetAfterApplied || equal(snapshot.values, queued.values)) { dispatch({ type: 'saved', snapshot }); setMessage('Change applied') }
      else setMessage('Change applied. Review the current settings and your draft')
    } else setError(job.error ?? 'The bot could not apply this change. Your draft has been kept')
    setQueued(undefined)
  }, [job?.state, queued, snapshotKey, resetAfterApplied])
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => { if (!equal(draft.values, draft.base.values)) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', listener)
    return () => window.removeEventListener('beforeunload', listener)
  }, [draft])
  const dirty = !equal(draft.values, draft.base.values), changed = (draft.current.revision !== draft.base.revision || !equal(draft.current.values,draft.base.values)) && !queued
  const awaitingBot = Boolean(queued) || Boolean(jobs?.some(value => value.state === 'queued' || value.state === 'configured'))
  const edit = (key: string, value: string | boolean) => { dispatch({ type: 'edit', key, value }); setError(''); setMessage('') }
  return <section className="panel" aria-label={title}>
    <h2>{title}</h2><p className="muted">{description}</p>
    {changed && <div className="notice" role="alert">
      <h3>Changed elsewhere</h3><p>Your draft has been kept. Review the current settings before saving</p>
      <div className="comparison">
        <div><strong>When you started</strong><pre>{JSON.stringify(draft.base.values, null, 2)}</pre></div>
        <div><strong>Current settings</strong><pre>{JSON.stringify(draft.current.values, null, 2)}</pre></div>
        <div><strong>Your draft</strong><pre>{JSON.stringify(draft.values, null, 2)}</pre></div>
      </div>
      <div className="actions"><button className="secondary" type="button" onClick={() => { dispatch({ type: 'reload' }); setError(''); setMessage('Current settings loaded') }}>Reload current settings</button><button className="secondary" type="button" onClick={() => { dispatch({ type: 'review' }); setError(''); setMessage('Current settings reviewed. Your draft is ready to save') }}>Keep my draft after review</button></div>
    </div>}
    <form onSubmit={async event => {
      event.preventDefault()
      if (!dirty || changed || saving || awaitingBot || !connected) return
      setSaving(true); setError(''); setMessage('')
      try {
        const result = await save(draft.values, draft.base.revision)
        if ('queued' in result) { setQueued({ id: result.jobId, values: draft.values }); setMessage('Change queued. Waiting for bot confirmation') }
        else if (result.saved) { dispatch({ type: 'saved', snapshot: { revision: result.revision, values: draft.values } }); setMessage('Settings saved') }
        else setError('Settings changed before your save. Wait for the current settings, then review your draft')
      } catch (error) { setError(error instanceof FormInputError ? error.message : 'Save failed. Your draft has been kept. Check your connection and permission, then try again') }
      finally { setSaving(false) }
    }}>
      {fields(draft.values, edit, saving || Boolean(queued))}
      <div className="actions"><button type="submit" disabled={!dirty || changed || saving || awaitingBot || !connected}>{saving ? 'Saving…' : awaitingBot ? 'Waiting for bot…' : submitLabel}</button><span className="muted">{dirty ? 'Unsaved changes' : 'Up to date'}</span></div>
    </form>
    {error && <p className="notice error" role="alert">{error}</p>}
    {message && <p className="success" role="status">{message}</p>}
  </section>
}
