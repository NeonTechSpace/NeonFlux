import type { DashboardOverviewState } from '@neonflux/backend/dashboard-contracts'
import { dashboardApi } from './dashboard-api'
import type { SectionProps } from './dashboard-sections'
import { Icon, navigation, sectionIcons, sectionLink, sectionNames } from './dashboard-sections'
import { useDraftSections } from './drafts'
import { useLiveQuery } from './live-query'

const stateLabels: Record<DashboardOverviewState,string> = { on: 'On',setup: 'Needs setup',off: 'Off' }

/** The landing page of a server: Setup progress, every section by group with its state, and sections holding unsaved drafts */
export function OverviewSection({ client,sessionToken,serverId,userId,sectionHref,openSection }: SectionProps) {
  const { data,error } = useLiveQuery(client,dashboardApi.overview,{ sessionToken,serverId })
  const drafts = useDraftSections(userId,serverId)
  const states = new Map(data?.sections.map(row => [row.id as string,row.state]))
  const total = data?.sections.length ?? 0, on = data?.sections.filter(row => row.state === 'on').length ?? 0, setup = data?.sections.filter(row => row.state === 'setup').length ?? 0
  return <>
    {error && <p className="notice error" role="alert">Setup progress is unavailable. Refresh your sign-in or check your server permission</p>}
    <section className="panel" aria-labelledby="overview-title">
      <h2 id="overview-title">Overview</h2>
      {!data ? <p role="status">Loading setup progress…</p> : <>
        <p className="muted">{on} of {total} features are on{setup ? `. ${setup} ${setup === 1 ? 'is on but needs' : 'are on but need'} setup, such as a channel or a first entry` : ''}</p>
        <progress className="setup-progress" max={total} value={on} aria-label="Features on">{on} of {total}</progress>
      </>}
      {drafts.size > 0 && <p className="notice draft-note" role="status"><strong>Unsaved drafts</strong> in {[...drafts].map(id => sectionNames[id as keyof typeof sectionNames] ?? id).join(', ')}. They stay in this tab until you save or discard them</p>}
    </section>
    {navigation.map(([group,items]) => <section className="panel" aria-labelledby={`overview-${group}`} key={group}>
      <h2 id={`overview-${group}`}>{group}</h2>
      <ul className="overview-grid">{items.map(([id,name]) => { const state = states.get(id); return <li key={id}>
        <a className="overview-card" {...sectionLink(id,sectionHref,openSection)}>
          <Icon path={sectionIcons[id]} /><span className="overview-name">{name}</span>
          {state && <span className={`state-pill ${state}`}>{stateLabels[state]}</span>}
          {drafts.has(id) && <span className="draft-tag">Unsaved draft</span>}
        </a>
      </li> })}</ul>
    </section>)}
  </>
}
