import type { ConvexReactClient } from 'convex/react'
import { ConvexError } from 'convex/values'
import { useState } from 'react'
import type { MemberRequestJob, Showcase, ShowcaseContent, ShowcaseMemberOperation } from '@neonflux/backend/contracts'
import { dashboardApi } from './dashboard-api'
import { useLiveQuery } from './live-query'
import { localTime } from './time'

const states = { queued: 'Pending',applied: 'Done',failed: 'Failed' }
const statusText: Record<Showcase['status'],string> = { posting: 'Being posted',posted: 'Posted',unconfirmed: 'Not confirmed by Fluxer. Staff can check it',failed: 'Not posted' }
export function requestError(error: unknown) {
  const data = error instanceof ConvexError && typeof error.data === 'object' && error.data !== null ? error.data as { error?: unknown } : undefined
  return typeof data?.error === 'string' ? data.error : 'The request could not be sent. Check your connection and try again'
}
/** Links typed one per line, as the backend expects them */
export const linkLines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean)
/** The member's recent requests and their outcome */
export function MemberRequests<O>({ requests,label }: { requests: MemberRequestJob<O>[], label: (operation: O) => string }) {
  return <section className="panel" aria-label="Your recent requests"><h2>Your recent requests</h2>
    {requests.length ? <ul className="request-list">{requests.map(row => <li key={row.id}>{label(row.operation)}: {states[row.state]}{row.error && <p className="error-text">{row.error}</p>}</li>)}</ul> : <p className="muted">No recent requests</p>}
    <p className="field-help">The bot handles each request within seconds while it is online. Requests expire after two minutes, and their records are deleted after one day</p>
  </section>
}

function ShowcaseForm({ initial,submitLabel,disabled,onSubmit,onCancel }: { initial: ShowcaseContent, submitLabel: string, disabled: boolean, onSubmit: (content: ShowcaseContent) => void, onCancel?: () => void }) {
  const [title,setTitle] = useState(initial.title), [text,setText] = useState(initial.text), [links,setLinks] = useState(initial.links.join('\n'))
  return <form className="role-section" onSubmit={event => { event.preventDefault(); onSubmit({ title: title.trim(),text: text.trim(),links: linkLines(links) }) }}>
    <label>Title<input required maxLength={100} value={title} disabled={disabled} onChange={event => setTitle(event.target.value)} /></label>
    <label>Text<textarea required maxLength={1000} rows={5} value={text} disabled={disabled} onChange={event => setText(event.target.value)} /></label>
    <label>Links, one per line<textarea rows={3} value={links} disabled={disabled} onChange={event => setLinks(event.target.value)} /></label>
    <p className="field-help">Up to three web addresses. The first HTTPS link to a PNG, JPEG, GIF or WebP image becomes the picture. You cannot upload files</p>
    <div className="actions"><button type="submit" disabled={disabled || linkLines(links).length > 3}>{submitLabel}</button>{onCancel && <button type="button" className="secondary" onClick={onCancel}>Cancel</button>}</div>
  </form>
}

// The member view. The bot reads the member, checks the server's rules and posts, edits or deletes its message, so each request shows as pending first
export function ShowcaseMember({ client,sessionToken,serverId,connected }: { client: ConvexReactClient, sessionToken: string, serverId: string, connected: boolean }) {
  const view = useLiveQuery(client,dashboardApi.showcaseMember,{ sessionToken,serverId })
  const [sending,setSending] = useState(false), [notice,setNotice] = useState(''), [editing,setEditing] = useState<number>(), [creating,setCreating] = useState(0)
  async function send(operation: ShowcaseMemberOperation) {
    setSending(true); setNotice('')
    try { await client.mutation(dashboardApi.showcaseRequest,{ sessionToken,serverId,requestId: crypto.randomUUID(),operation }); return true }
    catch (cause) { setNotice(requestError(cause)); return false }
    finally { setSending(false) }
  }
  if (view.error) return <section className="panel"><p role="alert" className="notice error">Showcases are not available in this server right now. They may have been turned off, or your sign-in needs a refresh</p></section>
  const remote = view.data
  if (!remote) return <section className="panel"><p role="status">Loading your showcases…</p></section>
  const { settings } = remote, pending = (showcaseNo: number) => remote.requests.some(row => row.state === 'queued' && row.operation.type !== 'create' && row.operation.showcaseNo === showcaseNo)
  const titled = (showcaseNo: number) => remote.showcases.find(row => row.showcaseNo === showcaseNo)?.title ?? `showcase ${showcaseNo}`
  const label = (operation: ShowcaseMemberOperation) => operation.type === 'create' ? `Post ${operation.title}` : operation.type === 'edit' ? `Edit ${operation.title}` : `Delete ${titled(operation.showcaseNo)}`
  const limits = [settings.maxPerMember !== null ? `up to ${settings.maxPerMember} showcases per member` : '',settings.intervalMinutes !== null ? `one every ${settings.intervalMinutes} minutes` : ''].filter(Boolean).join(' and ')
  return <>
    <section className="panel" aria-label="Post a showcase">
      <h2>Post a showcase</h2>
      <p className="muted">NeonFlux posts your showcase in {settings.channelId ? 'the server\'s showcase channel' : 'the showcase channel once staff choose one'}, with your name. The server's automod rules check the text and links, and mentions never notify anyone.{limits ? ` This server allows ${limits}` : ''}</p>
      <ShowcaseForm key={creating} initial={{ title: '',text: '',links: [] }} submitLabel="Post showcase" disabled={!connected || sending || !settings.channelId}
        onSubmit={content => void send({ type: 'create',...content }).then(sent => { if (sent) setCreating(value => value + 1) })} />
      {notice && <p role="alert" className="notice error">{notice}</p>}
    </section>
    <section className="panel" aria-label="Your showcases">
      <h2>Your showcases</h2>
      {!remote.showcases.length && <p className="muted">You have no showcases here yet</p>}
      {remote.showcases.map(row => <article className="mapping-row" key={row.showcaseNo}>
        <h3>{row.title}</h3>
        <p className="muted">{statusText[row.status]}. Last changed {localTime(row.updatedAt)}</p>
        {editing === row.showcaseNo ? <ShowcaseForm initial={row} submitLabel="Save changes" disabled={!connected || sending} onCancel={() => setEditing(undefined)}
          onSubmit={content => void send({ type: 'edit',showcaseNo: row.showcaseNo,...content }).then(sent => { if (sent) setEditing(undefined) })} />
          : <><p style={{ whiteSpace: 'pre-wrap' }}>{row.text}</p>{row.links.length > 0 && <ul>{row.links.map(link => <li key={link}><a href={link} target="_blank" rel="noopener noreferrer nofollow">{link}</a></li>)}</ul>}
            <div className="actions">
              <button type="button" className="secondary" disabled={!connected || sending || pending(row.showcaseNo) || row.status !== 'posted'} onClick={() => setEditing(row.showcaseNo)}>Edit</button>
              <button type="button" className="secondary" disabled={!connected || sending || pending(row.showcaseNo)} aria-label={`Delete ${row.title}`} onClick={() => void send({ type: 'delete',showcaseNo: row.showcaseNo })}>{pending(row.showcaseNo) ? 'Pending…' : 'Delete'}</button>
            </div></>}
      </article>)}
      <p className="field-help">Deleting a showcase also deletes its message in the server</p>
    </section>
    <MemberRequests requests={remote.requests} label={label} />
  </>
}
