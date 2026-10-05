import { useEffect, useRef, useState } from 'react'
import type { ConvexReactClient } from 'convex/react'
import type { DashboardCatalog, DashboardMessageJob } from '@neonflux/backend/dashboard-contracts'
import { dashboardApi } from './dashboard-api'
import { SearchPicker } from './search-picker'
import { MessageBuilder } from './message-builder'
import { validateMessage } from './message-content'
import { FormInputError } from './settings-form'
import { publicationChannels } from './catalog-options'

export function Messages({ client,sessionToken,serverId,connected,catalog,catalogLoading,catalogError,jobs }: { client: ConvexReactClient,sessionToken: string,serverId: string,connected: boolean,catalog?: DashboardCatalog,catalogLoading: boolean,catalogError: boolean,jobs: DashboardMessageJob[] }) {
  const [channel,setChannel] = useState(''), [content,setContent] = useState(JSON.stringify({ content: '' })), [sending,setSending] = useState(false), [error,setError] = useState(''), [queued,setQueued] = useState('')
  const request = useRef<{ key: string,id: string } | undefined>(undefined)
  const lastSubmitted = useRef('')
  const key = JSON.stringify({ channel,content })
  const dirty = Boolean(channel || content !== JSON.stringify({ content: '' }))
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload',listener)
    return () => window.removeEventListener('beforeunload',listener)
  },[dirty])
  const editChannel = (value: string) => { setChannel(value); setError(''); setQueued('') }
  const editContent = (value: string) => { setContent(value); setError(''); setQueued('') }
  return <div className="role-section"><section className="panel"><h2>Send a message</h2><p className="muted">Compose text or an embed, then request a send through the running bot</p><form onSubmit={async event => {
    event.preventDefault()
    if (!connected || sending || lastSubmitted.current === key) return
    setError(''); setQueued('')
    try {
      if (!/^[1-9]\d{0,18}$/.test(channel) || BigInt(channel) > 9223372036854775807n) throw new FormInputError('Choose a channel')
      const message = validateMessage(JSON.parse(content))
      if (request.current?.key !== key) request.current = { key,id: crypto.randomUUID() }
      setSending(true)
      const result = await client.action(dashboardApi.queueMessage,{ sessionToken,serverId,channelId: channel,content: message,requestId: request.current.id })
      if (!result.jobId) throw new Error('Request was not queued')
      lastSubmitted.current = key
      setQueued(result.jobId)
    } catch (error) { setError(error instanceof FormInputError ? error.message : 'Send request failed. Your draft is kept. Retry to check the same request safely') }
    finally { setSending(false) }
  }}><SearchPicker label="Destination channel" options={publicationChannels(catalog)} loading={catalogLoading} allowManual={catalogError} disabled={sending} value={channel ? [channel] : []} onChange={ids => editChannel(ids[0] ?? '')} /><MessageBuilder value={content} onChange={editContent} disabled={sending} /><div className="actions"><button type="submit" disabled={!connected || sending || lastSubmitted.current === key}>{sending ? 'Requesting…' : lastSubmitted.current === key ? 'Request queued' : 'Request send'}</button>{lastSubmitted.current === key && <button type="button" className="secondary" onClick={() => { lastSubmitted.current = ''; request.current = undefined; setQueued(''); setContent(JSON.stringify({ content: '' })) }}>Compose another message</button>}</div></form>{error && <p className="notice error" role="alert">{error}</p>}{queued && <p className="success" role="status">Message request queued. Check the delivery status below</p>}</section><section className="panel"><h2>Recent message requests</h2>{jobs.length === 0 ? <p className="muted">No recent message requests</p> : <ul className="request-list">{jobs.map(job => <li key={job.id}><strong>{catalog?.channels.find(channel => channel.id === job.channelId)?.name ?? `Channel ${job.channelId}`}</strong>: {job.state === 'queued' ? 'Pending bot checks' : job.state === 'reserved' ? 'Sending' : job.state === 'sent' ? 'Sent' : job.state === 'uncertain' ? 'Delivery uncertain, check the channel before trying again' : 'Failed'}{job.messageId && <span className="field-help">Message {job.messageId}</span>}{job.error && <p className="error-text">{job.error}</p>}</li>)}</ul>}<p className="muted">The bot checks current destination permissions before sending. A queued request is not a delivery confirmation</p></section></div>
}
