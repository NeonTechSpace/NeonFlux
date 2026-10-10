import { useEffect, useReducer, useState } from 'react'
import type { ReactNode } from 'react'
import type { DashboardSaveResult } from '@neonflux/backend/dashboard-contracts'
import { clearDraft, readDraft, useDraftScope, writeDraft } from './drafts'
import { jobWording } from './job-status'

export type FormValues = Record<string, string | boolean>
type Values = FormValues
export class FormInputError extends Error {}
export type FormSaveResult = DashboardSaveResult | { queued: true, jobId: string, revision: number }
export interface SettingsJob { id: string, state: 'queued' | 'configured' | 'applied' | 'failed' | 'conflict', error?: string }
/** A form's view of the server. revision is the section's shared configuration revision. values are the server's values of
 *  the form's own fields, and context is anything else the save is based on, such as the version of the item a removal confirms */
export interface FormSnapshot { revision: number, values: Values, context?: unknown }
type Snapshot = FormSnapshot
interface Draft { base: Snapshot, current: Snapshot, values: Values }
type Event = { type: 'remote', snapshot: Snapshot } | { type: 'edit', key: string, value: string | boolean } | { type: 'reload' } | { type: 'review' } | { type: 'saved', snapshot: Snapshot }
function equal(a: Values, b: Values): boolean { return JSON.stringify(a) === JSON.stringify(b) }
// Whether two snapshots agree on everything this form edits or depends on. The section revision is not compared
function same(a: Snapshot, b: Snapshot): boolean { return equal(a.values,b.values) && JSON.stringify(a.context) === JSON.stringify(b.context) }
function reducer(state: Draft, event: Event): Draft {
  if (event.type === 'edit') return { ...state, values: { ...state.values, [event.key]: event.value } }
  if (event.type === 'reload') return { base: state.current, current: state.current, values: state.current.values }
  if (event.type === 'review') return { ...state, base: state.current }
  if (event.type === 'saved') { const latest = state.current.revision > event.snapshot.revision ? state.current : event.snapshot; return { base: latest, current: latest, values: latest.values } }
  if (event.snapshot.revision < state.current.revision || event.snapshot.revision === state.current.revision && same(event.snapshot,state.current)) return state
  // A clean draft follows the server, and so does a draft the server now matches
  if (equal(state.values, state.base.values) || equal(state.values, event.snapshot.values)) return { base: event.snapshot, current: event.snapshot, values: event.snapshot.values }
  // A save elsewhere in the same section that left this form's fields and context alone only moves the revision. The draft
  // rebases onto it, so its save is checked against the newest revision. Anything else is a real conflict to review
  if (same(event.snapshot, state.base)) return { ...state, base: event.snapshot, current: event.snapshot }
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
  /** Names the stored draft within its section. Defaults to the title, so set it when the title can change */
  draftKey?: string
}
interface StoredDraft { base: Snapshot, values: Values, queued?: { id: string, values: Values } }
const sameKeys = (a: object, b: object) => JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort())
// A stored draft is used only when it still has the form's fields, so a changed form never receives an old draft's shape
function storedDraft(value: unknown, snapshot: Snapshot): StoredDraft | undefined {
  const draft = value as StoredDraft | undefined
  if (!draft || typeof draft !== 'object' || !draft.base || typeof draft.base.revision !== 'number' || !draft.values || typeof draft.values !== 'object' || !draft.base.values || !sameKeys(draft.values,snapshot.values) || !sameKeys(draft.base.values,snapshot.values)) return
  return draft
}

export function SettingsForm({ title, description, snapshot, connected, save, fields, jobs, resetAfterApplied, submitLabel = 'Save changes', draftKey = title }: SettingsFormProps) {
  const scope = useDraftScope()
  const [stored] = useState(() => scope ? storedDraft(readDraft(scope,draftKey),snapshot) : undefined)
  const [restored, setRestored] = useState(Boolean(stored))
  const [draft, dispatch] = useReducer(reducer, undefined, () => stored ? reducer({ base: stored.base, current: stored.base, values: stored.values }, { type: 'remote', snapshot }) : { base: snapshot, current: snapshot, values: snapshot.values })
  const [saving, setSaving] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  // A change sent before the form was left keeps waiting for its result while the bot still lists it
  const [queued, setQueued] = useState<{ id: string, values: Values } | undefined>(() => stored?.queued && jobs?.some(job => job.id === stored.queued!.id) ? stored.queued : undefined)
  const snapshotKey = JSON.stringify(snapshot)
  const dirty = !equal(draft.values, draft.base.values)
  useEffect(() => {
    if (!scope) return
    if (dirty) writeDraft(scope,draftKey,{ base: draft.base,values: draft.values,...(queued ? { queued } : {}) } satisfies StoredDraft)
    else { clearDraft(scope,draftKey); setRestored(false) }
  }, [scope, draftKey, draft, dirty, queued])
  useEffect(() => { dispatch({ type: 'remote', snapshot }) }, [snapshotKey])
  const job = jobs?.find(value => value.id === queued?.id)
  useEffect(() => {
    if (!queued || !job || job.state === 'queued' || job.state === 'configured') return
    if (job.state === 'applied') {
      if (resetAfterApplied || equal(snapshot.values, queued.values)) { dispatch({ type: 'saved', snapshot }); setMessage('Change applied') }
      else setMessage('Change applied. Review the current settings and your draft')
    } else if (job.state === 'conflict') setError('Not applied: The settings changed elsewhere before the bot applied this change. Your draft has been kept. Review the current settings, then save again')
    else setError(`Not applied: ${job.error ?? 'The bot could not apply this change'}. Your draft has been kept. Fix the cause, then save again`)
    setQueued(undefined)
  }, [job?.state, queued, snapshotKey, resetAfterApplied])
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => { if (!equal(draft.values, draft.base.values)) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', listener)
    return () => window.removeEventListener('beforeunload', listener)
  }, [draft])
  const changed = !same(draft.current, draft.base) && !queued
  const awaitingBot = Boolean(queued) || Boolean(jobs?.some(value => value.state === 'queued' || value.state === 'configured'))
  const edit = (key: string, value: string | boolean) => { dispatch({ type: 'edit', key, value }); setError(''); setMessage('') }
  return <section className="panel" aria-label={title}>
    <h2>{title}</h2><p className="muted">{description}</p>
    {restored && dirty && <p className="notice draft-note" role="status"><strong>Unsaved draft.</strong> Your earlier changes to this form were restored. Save them, or discard them to load the current settings <button type="button" className="secondary" disabled={saving || Boolean(queued)} onClick={() => { dispatch({ type: 'reload' }); setRestored(false); setError(''); setMessage('Draft discarded. Current settings loaded') }}>Discard draft</button></p>}
    {changed && <div className="notice" role="alert">
      <h3>Changed elsewhere</h3>
      {equal(draft.current.values, draft.base.values) ? <p>The item this form applies to changed after you started. Your draft has been kept. Review the current settings before you continue</p> : <>
        <p>Your draft has been kept. Review the current settings before saving</p>
        <div className="comparison">
          <div><strong>When you started</strong><pre>{JSON.stringify(draft.base.values, null, 2)}</pre></div>
          <div><strong>Current settings</strong><pre>{JSON.stringify(draft.current.values, null, 2)}</pre></div>
          <div><strong>Your draft</strong><pre>{JSON.stringify(draft.values, null, 2)}</pre></div>
        </div>
      </>}
      <div className="actions"><button className="secondary" type="button" onClick={() => { dispatch({ type: 'reload' }); setError(''); setMessage('Current settings loaded') }}>Reload current settings</button><button className="secondary" type="button" onClick={() => { dispatch({ type: 'review' }); setError(''); setMessage('Current settings reviewed. Your draft is ready to save') }}>Keep my draft after review</button></div>
    </div>}
    <form onSubmit={async event => {
      event.preventDefault()
      if (!dirty || changed || saving || awaitingBot || !connected) return
      setSaving(true); setError(''); setMessage('')
      try {
        const result = await save(draft.values, draft.base.revision)
        if ('queued' in result) { setQueued({ id: result.jobId, values: draft.values }); setMessage('Change queued. Waiting for bot confirmation') }
        else if (result.saved) { dispatch({ type: 'saved', snapshot: { revision: result.revision, values: draft.values, context: draft.base.context } }); setMessage('Settings saved') }
        else setError('Settings changed before your save. Wait for the current settings, then review your draft')
      } catch (error) { setError(error instanceof FormInputError ? error.message : 'Save failed. Your draft has been kept. Check your connection and permission, then try again') }
      finally { setSaving(false) }
    }}>
      {fields(draft.values, edit, saving || Boolean(queued))}
      <div className="actions"><button type="submit" disabled={!dirty || changed || saving || awaitingBot || !connected}>{saving ? 'Saving…' : awaitingBot ? 'Waiting for bot…' : submitLabel}</button><span className="muted">{dirty ? 'Unsaved changes' : 'Up to date'}</span></div>
    </form>
    {error && <p className="notice error" role="alert">{error}</p>}
    {message && <p className={queued ? 'muted' : 'success'} role="status">{message}</p>}
    {queued && <p className="field-help">{jobWording('queued').next}. Your draft stays until it is applied</p>}
  </section>
}
