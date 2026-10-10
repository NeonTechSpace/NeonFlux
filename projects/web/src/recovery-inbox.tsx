import type { RecoveryEntry } from '@neonflux/backend/dashboard-contracts'
import { dashboardApi } from './dashboard-api'
import type { SectionProps } from './dashboard-sections'
import { sectionLink, sectionNames } from './dashboard-sections'
import { useLiveQuery } from './live-query'
import { problemText } from './overview'

const when = (at: number | undefined) => at === undefined ? 'Now' : `${new Date(at).toISOString().slice(0,16).replace('T',' ')} UTC`

/** Failed, stuck or uncertain work, features that are on but cannot act and the latest permission check's problems, each with its next step */
export function RecoverySection({ client,sessionToken,serverId,sectionHref,openSection }: SectionProps) {
  const { data,error } = useLiveQuery(client,dashboardApi.recovery,{ sessionToken,serverId })
  const row = (entry: RecoveryEntry,index: number) => {
    if (entry.kind === 'feature') return <li key={index}><strong>Now</strong>: {sectionNames[entry.feature]} is on but needs setup, such as a channel or a first entry.{' '}
      <a {...sectionLink(entry.feature,sectionHref,openSection)}>Open {sectionNames[entry.feature]}</a></li>
    if (entry.kind === 'setup') return <li key={index}><strong>{when(entry.at)}</strong>, permission check: {problemText(entry.problem)}</li>
    return <li key={index}><strong>{when(entry.at)}</strong>: {entry.summary}<br /><span className="muted">Next: <code>{entry.next}</code></span></li>
  }
  return <section className="panel" aria-labelledby="recovery-title">
    <h2 id="recovery-title">Recovery inbox</h2>
    <p className="muted">Work that failed, stalled or has an unknown outcome, features that are on but cannot act yet and the problems of the latest permission check, current state first and then newest first. Each source shows its newest 10 entries. The chat command <code>!recovery</code> lists the same entries</p>
    {error && <p className="notice error" role="alert">The recovery inbox is unavailable. Refresh your sign-in or check your server permission</p>}
    {!data ? !error && <p role="status">Loading…</p>
      : data.entries.length ? <ul className="request-list">{data.entries.map(row)}</ul> : <p role="status">Nothing needs attention</p>}
    {data?.truncated && <p className="muted">More entries exist than the 100 shown. Resolve these first</p>}
  </section>
}
