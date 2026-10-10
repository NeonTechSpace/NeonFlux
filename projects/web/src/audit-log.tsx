import type { DashboardAuditEntry, DashboardAuditFeature } from '@neonflux/backend/dashboard-contracts'
import { useState } from 'react'
import { dashboardApi } from './dashboard-api'
import type { SectionProps } from './dashboard-sections'
import { useLiveQuery } from './live-query'

/** Features the log can be filtered by, named as the dashboard names their sections */
export const auditFeatures: ReadonlyArray<readonly [DashboardAuditFeature,string]> = [
  ['prefix','Prefix'],['nickname','Bot nickname'],['responses','Custom commands and autoresponders'],['moderation','Moderation and safety'],['cleanup','Message cleanup'],
  ['logs','Channel logs'],['roles','Reaction roles, autorole and verification'],['rolepicker','Role picker'],['publishing','Drafts and templates'],['greetings','Greetings'],
  ['schedules','Schedules'],['tickets','Tickets'],['leveling','Leveling'],['milestones','Milestones'],['suggestions','Suggestions'],['events','Events'],['voice','Temporary voice'],
  ['analytics','Analytics'],['member-data','Member data'],['private-data','Private cases'],
]
const featureNames = new Map<string,string>(auditFeatures)
const kinds: Record<Exclude<DashboardAuditEntry['kind'],'setting'>,string> = { 'member-data-deleted': 'Member deleted their own data','private-data-viewed': 'Private data viewed' }
const when = (at: number) => `${new Date(at).toISOString().slice(0,16).replace('T',' ')} UTC`

/** Setting changes from the website and chat, members' deletions of their own data and views of private cases, newest first in pages of 25 */
export function AuditLogSection({ client,sessionToken,serverId }: SectionProps) {
  const [feature,setFeature] = useState(''), [cursors,setCursors] = useState<string[]>([])
  const cursor = cursors.at(-1) ?? null
  const { data,error,current } = useLiveQuery(client,dashboardApi.auditLog,{ sessionToken,serverId,cursor,...(feature ? { feature } : {}) })
  const next = current ? data?.nextCursor : null
  return <section className="panel" aria-labelledby="audit-title">
    <div className="panel-heading"><h2 id="audit-title">Audit log</h2>
      <label className="inline-field">Feature<select value={feature} onChange={event => { setFeature(event.target.value); setCursors([]) }}>
        <option value="">All features</option>{auditFeatures.map(([id,name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
    </div>
    <p className="muted">Every setting change, from this website or a chat command, every member's deletion of their own data and every view of private cases. Entries are kept for 180 days</p>
    {error && <p className="notice error" role="alert">The audit log is unavailable. Refresh your sign-in or check your server permission</p>}
    {!data ? <p role="status">Loading the audit log…</p> : !data.entries.length ? <p className="muted">{cursor ? 'No older entries' : 'No entries yet'}</p>
      : <table className="audit-table"><thead><tr><th>When</th><th>Who</th><th>From</th><th>Feature</th><th>Action</th><th>Change</th></tr></thead><tbody>
        {data.entries.map(entry => <tr key={entry.id}>
          <td>{when(entry.createdAt)}</td><td>{entry.actorName ? `${entry.actorName} (${entry.actorId})` : entry.actorId}</td><td>{entry.source === 'website' ? 'Website' : 'Command'}</td>
          <td>{featureNames.get(entry.feature) ?? entry.feature}</td><td>{entry.kind === 'setting' ? entry.setting : <strong>{kinds[entry.kind]}</strong>}</td>
          <td>{entry.kind === 'private-data-viewed' ? `${entry.setting}. ${entry.summary}` : entry.summary}</td>
        </tr>)}
      </tbody></table>}
    <div className="actions">
      <button type="button" className="secondary" disabled={!cursors.length} onClick={() => setCursors(cursors.slice(0,-1))}>Newer</button>
      <button type="button" className="secondary" disabled={!next} onClick={() => { if (next) setCursors([...cursors,next]) }}>Older</button>
    </div>
  </section>
}
