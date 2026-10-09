import { useRef, useState } from 'react'
import type { ConvexReactClient } from 'convex/react'
import type { DashboardConfigurationOperationMap, DashboardConfigurationRequest } from '@neonflux/backend/dashboard-contracts'
import type { ConfigSectionProps } from './configuration-form'
import { useConfigurationState } from './configuration-live'
import { dashboardApi } from './dashboard-api'

// Fluxer accepts 1 to 32 characters. Surrounding spaces and control characters are rejected so the applied nickname compares exactly
export const validNickname = (value: string) => value.length >= 1 && value.length <= 32 && value.trim() === value && !/[\u0000-\u001f\u007f\u202e]/.test(value)

export function NicknameSection({ client, sessionToken, serverId, connected }: { client: ConvexReactClient, sessionToken: string, serverId: string, connected: boolean }) {
  const state = useConfigurationState(client,sessionToken,serverId,'nickname')
  const remote = state.remote?.family === 'nickname' && state.remote.serverId === serverId ? state.remote : undefined
  return <>
    {state.error && <p className="notice error" role="alert">The bot nickname is unavailable. Refresh your sign-in or check your server permission</p>}
    {!remote ? <section className="panel"><p role="status">Loading bot nickname…</p></section>
      : <NicknameSettings remote={remote} connected={connected && !state.error} queue={(operation,expectedConfigRevision,requestId) => client.action(dashboardApi.queueConfiguration,{ sessionToken,serverId,family: 'nickname',operation,expectedConfigRevision,requestId } as DashboardConfigurationRequest)} />}
  </>
}

/** Explicit set and reset only. A nickname changed directly in Fluxer is left alone until the next explicit change */
export function NicknameSettings({ remote, queue, connected }: Pick<ConfigSectionProps<'nickname'>, 'remote' | 'queue' | 'connected'>) {
  const settings = remote.data.settings, result = settings.result
  const [draft,setDraft] = useState<string>(), [saving,setSaving] = useState(false), [error,setError] = useState(''), [jobId,setJobId] = useState<string>()
  const request = useRef<{ key: string, id: string } | undefined>(undefined)
  const value = draft ?? settings.nickname ?? ''
  const job = remote.jobs.find(row => row.id === jobId)
  const waiting = remote.jobs.some(row => row.state === 'queued')
  const disabled = !connected || saving || waiting
  async function send(operation: DashboardConfigurationOperationMap['nickname']) {
    const key = JSON.stringify({ operation,revision: remote.configRevision })
    if (request.current?.key !== key) request.current = { key,id: crypto.randomUUID() }
    setSaving(true); setError('')
    try {
      const queued = await queue(operation,remote.configRevision,request.current.id)
      request.current = undefined
      if (queued.conflict) setError('The nickname changed elsewhere. Review the current nickname, then try again')
      else if (queued.jobId) { setJobId(queued.jobId); setDraft(undefined) }
    } catch { setError('Save failed. Your draft has been kept. Check your connection and permission, then try again') }
    finally { setSaving(false) }
  }
  const status = waiting ? 'Waiting for the bot to apply the change'
    : job && (job.state === 'failed' || job.state === 'conflict') ? `Not applied: ${job.error ?? 'The bot could not apply this change'}`
    : !result ? 'No nickname has been applied from NeonFlux yet'
    : result.state === 'pending' ? 'The bot has not confirmed the last change'
    : result.state === 'applied' ? `Applied: ${result.nickname ?? "the bot's username is shown"}`
    : `Failed: ${result.error ?? 'Fluxer did not confirm the nickname change'}`
  return <section className="panel" aria-label="Bot nickname">
    <h2>Bot nickname</h2><p className="muted">Set the bot's display name in this server. The bot applies it as itself and needs the Change Nickname permission</p>
    <form onSubmit={event => {
      event.preventDefault()
      if (disabled) return
      if (!validNickname(value)) { setError('Use 1 to 32 characters, without control characters or spaces at the start or end'); return }
      void send({ type: 'set',nickname: value })
    }}>
      <label>Nickname<input aria-label="Nickname" maxLength={32} value={value} disabled={disabled} onChange={event => { setDraft(event.target.value); setError('') }} /><span className="field-help">Current nickname: {settings.nickname ?? "none, so the bot's username is shown"}. A nickname changed directly in Fluxer is kept until the next change here or in chat</span></label>
      <div className="actions"><button type="submit" disabled={disabled || !value}>{saving ? 'Saving…' : waiting ? 'Waiting for bot…' : 'Apply nickname'}</button><button type="button" className="secondary" disabled={disabled} onClick={() => void send({ type: 'reset' })}>Reset to username</button></div>
    </form>
    <p role="status" className={result?.state === 'failed' || job?.state === 'failed' || job?.state === 'conflict' ? 'error-text' : 'muted'}>Last result: {status}</p>
    {error && <p className="notice error" role="alert">{error}</p>}
  </section>
}
