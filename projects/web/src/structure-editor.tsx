import type { DashboardStructurePreview, StructureChange, StructureChannelType, StructureDisposition, StructureEntry, StructureFailure, StructureOutcome, StructurePlace, StructureRead, StructureThread } from '@neonflux/backend/dashboard-contracts'
import { useCallback, useEffect, useState } from 'react'
import type { DragEvent } from 'react'
import { dashboardApi } from './dashboard-api'
import type { SectionProps } from './dashboard-sections'
import { useStoredDraft } from './drafts'
import { useLiveQuery } from './live-query'
import { mentionText } from './mentions'
import { localTime } from './time'

const kinds: Record<StructureChannelType,string> = { category: 'Category',text: 'Text',voice: 'Voice',announcement: 'Announcement',forum: 'Forum',media: 'Media',link: 'Link' }
const holders = new Set<StructureChannelType>(['text','announcement','forum','media'])
const failures: Record<StructureFailure,string> = {
  unanswered: 'NeonFlux did not answer. Check that the bot is online, then check again',
  access: 'NeonFlux could not find you in the server, so it cannot show or change the structure for you',
  error: 'NeonFlux could not read the server right now. Check again shortly',
  uncertain: 'NeonFlux could not confirm what this save changed. Check the server before saving again. NeonFlux never repeats a change on its own',
}
const working = { read: 'Asking NeonFlux to read the server…',threads: 'Asking NeonFlux for closed threads…',save: 'Waiting for NeonFlux to save your changes…' }
const dispositions: Record<StructureDisposition,string> = { apply: 'Will be saved',skip: 'Already so',conflict: 'Conflicts',blocked: 'Blocked',refused: 'Refused' }
const outcomes: Record<StructureOutcome,string> = { applied: 'Saved',skipped: 'Already so',conflict: 'Not saved, changed elsewhere',blocked: 'Not saved',refused: 'Not saved',failed: 'Failed',uncertain: 'Outcome unknown' }
const where = (place: StructurePlace) => `${place.parentName ?? 'the top level'}, ${place.afterName === null ? 'first' : `after ${place.afterName}`}`
export const changeText = (change: StructureChange) => change.type === 'rename' ? `Rename ${change.from} to ${change.to}` : `Move ${change.name} from ${where(change.from)} to ${where(change.to)}`

const entriesOf = (read: StructureRead): StructureEntry[] => read.channels.map(({ id,type,name,parentId }) => ({ id,type,name,parentId }))
const siblings = (layout: readonly StructureEntry[], parentId: string | null) => layout.filter(entry => entry.parentId === parentId)
/** The layout with one entry moved under parentId at index among its new siblings. Categories stay at the top level and keep their channels */
export function moveEntry(layout: readonly StructureEntry[], id: string, parentId: string | null, index: number): StructureEntry[] {
  const groups = new Map<string | null,StructureEntry[]>()
  for (const entry of layout) if (entry.id !== id) groups.set(entry.parentId,[...groups.get(entry.parentId) ?? [],entry])
  const moved = { ...layout.find(entry => entry.id === id)!,parentId }, list = groups.get(parentId) ?? []
  list.splice(Math.max(0,Math.min(index,list.length)),0,moved)
  groups.set(parentId,list)
  return (groups.get(null) ?? []).flatMap(top => [top,...top.type === 'category' ? groups.get(top.id) ?? [] : []])
}

/** The server's categories, channels and threads, read by NeonFlux for this manager, with a draft of names and order that saves through the bot */
export function StructureSection({ client,sessionToken,serverId,connected,catalog }: SectionProps) {
  const { data,error } = useLiveQuery(client,dashboardApi.structure,{ sessionToken,serverId })
  const base = useStoredDraft<{ readAt: number, entries: StructureEntry[] } | null>('base',null)
  const draft = useStoredDraft<StructureEntry[] | null>('draft',null)
  const [preview,setPreview] = useState<DashboardStructurePreview | 'loading'>()
  const [problem,setProblem] = useState(''), [announcement,setAnnouncement] = useState(''), [dragged,setDragged] = useState<string>()
  const [sent,setSent] = useState<number>()
  const request = useCallback(() => {
    setProblem('')
    client.mutation(dashboardApi.requestStructure,{ sessionToken,serverId }).catch(() => setProblem('NeonFlux could not be asked to read the server. Refresh your sign-in or try again'))
  },[client,sessionToken,serverId])
  useEffect(request,[request])
  const read = data?.read ?? null, busy = data?.state === 'queued' || data?.state === 'applying'
  // A sent draft ends once its results arrive, and stays to send again when the save failed before it was claimed
  const { clear: clearBase,set: storeBase,value: started } = base, { clear: clearDraft,set: storeDraft,value: drafted } = draft
  useEffect(() => {
    if (sent === undefined) return
    if (data?.save?.requestedAt === sent) { clearBase(); clearDraft(); setSent(undefined) }
    else if (data?.requestedAt === sent && data.state === 'failed') { if (started && drafted) { storeBase(started); storeDraft(drafted) } setSent(undefined) }
  },[sent,data?.save?.requestedAt,data?.requestedAt,data?.state,clearBase,clearDraft,storeBase,storeDraft,started,drafted])
  const layout = draft.value ?? (read ? entriesOf(read) : []), byId = new Map(layout.map(entry => [entry.id,entry]))
  const current = new Map(read?.channels.map(channel => [channel.id,channel]))
  const nameOf = (id: string) => current.get(id)?.name ?? byId.get(id)?.name ?? id
  const editable = (id: string) => connected && !busy && sent === undefined && Boolean(current.get(id)?.manage)
  const edit = (next: StructureEntry[]) => {
    if (!base.value && read) base.set({ readAt: read.readAt,entries: entriesOf(read) })
    draft.set(next); setPreview(undefined)
  }
  const move = (id: string, parentId: string | null, index: number) => {
    const next = moveEntry(layout,id,parentId,index), list = siblings(next,parentId)
    edit(next)
    setAnnouncement(`${nameOf(id)} moved to ${parentId ? nameOf(parentId) : 'the top level'}, position ${list.findIndex(entry => entry.id === id) + 1} of ${list.length}`)
  }
  const drop = (id: string, target: string) => {
    const moving = byId.get(id)!, onto = byId.get(target)!, rest = layout.filter(entry => entry.id !== id)
    // A category goes before the top-level entry it lands on, a channel into the category it lands on or before the channel
    if (moving.type !== 'category' && onto.type === 'category') { move(id,onto.id,0); return }
    const parentId = moving.type === 'category' ? null : onto.parentId, index = siblings(rest,parentId).findIndex(entry => entry.id === (moving.type === 'category' ? onto.parentId ?? onto.id : onto.id))
    if (index >= 0) move(id,parentId,index)
  }
  const discard = () => { base.clear(); draft.clear(); setPreview(undefined); setSent(undefined) }
  const named = draft.value?.map(entry => ({ ...entry,name: entry.name.trim() }))
  const invalid = named?.some(entry => !entry.name || entry.name.length > 100)
  const review = () => {
    if (!base.value || !named) return
    setPreview('loading'); setProblem('')
    client.query(dashboardApi.structurePreview,{ sessionToken,serverId,base: base.value.entries,draft: named }).then(result => {
      if (result) setPreview(result); else { setPreview(undefined); setProblem('NeonFlux has not read the server yet. Check again first') }
    },() => { setPreview(undefined); setProblem('The review could not be loaded. Refresh your sign-in or try again') })
  }
  const save = () => {
    if (!base.value || !named) return
    setProblem('')
    client.mutation(dashboardApi.saveStructure,{ sessionToken,serverId,base: base.value.entries,draft: named }).then(result => {
      if (!result.queued) { setProblem('NeonFlux is still working on your last request. Save again when it finishes'); return }
      // The draft leaves this tab's storage, and stays on screen until its results arrive
      base.forget(); draft.forget(); setPreview(undefined); setSent(result.requestedAt)
    },() => setProblem('The changes could not be saved. Refresh your sign-in or try again'))
  }
  // Reasons name channels and roles as mentions. A channel takes its name from the latest read, then the draft and then the server's channel list
  const reason = (text: string) => mentionText(text,{ channels: [...read?.channels ?? [],...layout,...catalog?.channels ?? []],roles: catalog?.roles })
  const threads = (id: string) => {
    const active = read?.threads.filter(thread => thread.parentId === id) ?? [], closed = data?.archived.find(page => page.channelId === id)
    const item = (thread: StructureThread) => <li key={thread.id}>{thread.name}{thread.private ? ', private' : ''}{thread.archived ? ', closed' : ''}</li>
    if (!holders.has(byId.get(id)!.type) || !current.has(id)) return null
    return <div className="structure-threads">
      {active.length > 0 && <ul aria-label={`Threads in ${nameOf(id)}`}>{active.map(item)}</ul>}
      {closed ? closed.threads.length ? <ul aria-label={`Closed threads in ${nameOf(id)}`}>{closed.threads.map(item)}</ul> : <p className="muted">No closed threads</p>
        : <button type="button" className="secondary" disabled={busy || !connected} onClick={() => client.mutation(dashboardApi.structureThreads,{ sessionToken,serverId,channelId: id }).catch(() => setProblem('Closed threads could not be requested. Try again'))}>Show closed threads of {nameOf(id)}</button>}
      {closed?.more && <p className="muted">Only the 100 most recently closed threads are shown</p>}
    </div>
  }
  const row = (entry: StructureEntry) => {
    const allowed = editable(entry.id), list = siblings(layout,entry.parentId), index = list.findIndex(item => item.id === entry.id), label = `${kinds[entry.type].toLowerCase()} ${nameOf(entry.id)}`
    const dragProps = { draggable: allowed,onDragStart: (event: DragEvent) => { event.dataTransfer?.setData('text/plain',entry.id); setDragged(entry.id) },onDragEnd: () => setDragged(undefined),
      onDragOver: (event: DragEvent) => { if (dragged && dragged !== entry.id) event.preventDefault() },onDrop: (event: DragEvent) => { event.preventDefault(); if (dragged && dragged !== entry.id) drop(dragged,entry.id); setDragged(undefined) } }
    return <div className="structure-row" {...dragProps}>
      <span className="structure-kind">{kinds[entry.type]}</span>
      <input aria-label={`Name of ${label}`} value={entry.name} maxLength={100} disabled={!allowed} onChange={event => edit(layout.map(item => item.id === entry.id ? { ...item,name: event.target.value } : item))} />
      <button type="button" className="secondary" aria-label={`Move ${label} up`} disabled={!allowed || index === 0} onClick={() => move(entry.id,entry.parentId,index - 1)}>Up</button>
      <button type="button" className="secondary" aria-label={`Move ${label} down`} disabled={!allowed || index === list.length - 1} onClick={() => move(entry.id,entry.parentId,index + 1)}>Down</button>
      {entry.type !== 'category' && <select aria-label={`Category of ${label}`} value={entry.parentId ?? ''} disabled={!allowed} onChange={event => { const parentId = event.target.value || null; move(entry.id,parentId,siblings(layout,parentId).length) }}>
        <option value="">No category</option>{siblings(layout,null).filter(item => item.type === 'category').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>}
      {!current.has(entry.id) ? <span className="muted">Not in the latest read</span> : !current.get(entry.id)!.manage && <span className="muted">You need Manage Channels to change it</span>}
    </div>
  }
  const results = data?.save
  return <div className="role-section">
    <section className="panel" aria-labelledby="structure-title">
      <h2 id="structure-title">Server structure</h2>
      <p className="muted">Categories, channels and their threads as NeonFlux reads them for you, with your own access. Rename categories and channels and change their order or category by dragging them, or with Up, Down and the category choice. Review the changes, then save. NeonFlux reads the server again and checks each change with your permissions before it saves with its own access. A moved channel keeps its own permissions. Permissions, new channels and deleting channels stay in Fluxer</p>
      {error && <p className="notice error" role="alert">The structure is unavailable. Refresh your sign-in or check your server permission</p>}
      {problem && <p className="notice error" role="alert">{problem}</p>}
      {data === undefined ? !error && <p role="status">Loading…</p> : <>
        {busy && <p role="status">{data?.state === 'applying' ? 'NeonFlux is saving your changes…' : working[data!.work]}</p>}
        {data?.state === 'failed' && data.failure && <p className="notice error" role="alert">{failures[data.failure]}</p>}
        {read && <p className="muted">Read {localTime(read.readAt)}{read.threadsTruncated ? '. The server has more active threads than the 1,000 shown' : ''}</p>}
        {data?.changedAt !== undefined && !busy && <p className="notice" role="status">The server changed after this read. {draft.value ? 'Your draft keeps the structure it started from, and the review shows which of your changes still apply. ' : ''}<button type="button" className="secondary" disabled={!connected} onClick={request}>Load the current structure</button></p>}
        <div className="actions"><button type="button" className="secondary" disabled={busy || !connected} onClick={request}>Check again</button></div>
      </>}
    </section>
    {read && <section className="panel" aria-labelledby="structure-tree-title">
      <h2 id="structure-tree-title">Categories and channels</h2>
      {draft.value && <p className="draft-note" role="status">Unsaved draft, started from the read of {localTime(base.value?.readAt ?? read.readAt)} <button type="button" className="secondary" onClick={discard}>Discard draft</button></p>}
      <p className="visually-hidden" role="status">{announcement}</p>
      <ol className="structure-tree">{siblings(layout,null).map(top => <li key={top.id}>{row(top)}{threads(top.id)}
        {top.type === 'category' && <ol>{siblings(layout,top.id).map(child => <li key={child.id}>{row(child)}{threads(child.id)}</li>)}</ol>}</li>)}</ol>
      {draft.value && <div className="actions">
        {invalid && <p className="error-text" role="alert">Every name needs 1 to 100 characters</p>}
        <button type="button" disabled={invalid || preview === 'loading' || !connected} onClick={review}>Review changes</button>
      </div>}
      {preview && preview !== 'loading' && <>
        <h3>What saving changes</h3>
        <p className="muted">Checked against the read of {localTime(preview.readAt)}. Saving reads the server again and checks every change once more</p>
        {preview.items.length ? <table className="audit-table"><thead><tr><th>Change</th><th>Saving</th></tr></thead><tbody>
          {preview.items.map(item => <tr key={item.itemNo}><td>{changeText(item.change)}</td><td>{dispositions[item.disposition]}{item.reason ? `: ${reason(item.reason)}` : ''}</td></tr>)}
        </tbody></table> : <p>Your draft changes nothing</p>}
        {preview.items.length > 100 && <p className="error-text" role="alert">Save at most 100 changes at once</p>}
        <div className="actions"><button type="button" disabled={!connected || busy || preview.items.length > 100 || !preview.items.some(item => item.disposition === 'apply')} onClick={save}>Save changes</button></div>
      </>}
    </section>}
    {results && <section className="panel" aria-labelledby="structure-results-title">
      <h2 id="structure-results-title">Last save</h2>
      <p className="muted">Requested {localTime(results.requestedAt)}. Saved changes are in the audit log</p>
      <table className="audit-table"><thead><tr><th>Change</th><th>Outcome</th></tr></thead><tbody>
        {results.results.map(result => <tr key={result.itemNo}><td>{changeText(result.change)}</td><td>{outcomes[result.outcome]}{result.reason ? `: ${reason(result.reason)}` : ''}</td></tr>)}
      </tbody></table>
    </section>}
  </div>
}
