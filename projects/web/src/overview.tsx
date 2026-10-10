import type { ConvexReactClient } from 'convex/react'
import { useCallback, useEffect, useState } from 'react'
import type { DashboardOverviewState, SetupProblem } from '@neonflux/backend/dashboard-contracts'
import { dashboardApi } from './dashboard-api'
import type { SectionProps } from './dashboard-sections'
import { Icon, navigation, sectionIcons, sectionLink, sectionNames } from './dashboard-sections'
import { useDraftSections } from './drafts'
import { useLiveQuery } from './live-query'

const stateLabels: Record<DashboardOverviewState,string> = { on: 'On',setup: 'Needs setup',off: 'Off' }

const labels: Record<string,string> = { ManageGuild: 'Manage Server',UpdateRtcRegion: 'Update RTC Region' }
const list = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0,-1).join(', ')} and ${items.at(-1)}`
/** One problem from the bot as a sentence that names its fix, worded like the bot's !health reply */
export function problemText(problem: SetupProblem) {
  if (problem.kind === 'gateway') return `Gateway: ${problem.state}. NeonFlux reconnects on its own. If this lasts, the bot operator should check the host's network and the bot's logs`
  const feature = problem.feature === 'general' ? 'Replies' : sectionNames[problem.feature]
  return problem.kind === 'permissions'
    ? `${feature}: Grant ${list(problem.permissions.map(name => labels[name] ?? name.replace(/([a-z])([A-Z])/g,'$1 $2')))} to the NeonFlux role`
    : `${feature}: Move the NeonFlux role above ${list(problem.roles.map(role => `@${role.name}`))}`
}

/** The bot's own permission check. The bot reads Fluxer with its token, so opening this asks it for a fresh check without using your sign-in */
function PermissionCheck({ client,sessionToken,serverId }: { client: ConvexReactClient, sessionToken: string, serverId: string }) {
  const { data: check } = useLiveQuery(client,dashboardApi.setupCheck,{ sessionToken,serverId })
  const [failed,setFailed] = useState(false)
  const request = useCallback(() => {
    setFailed(false)
    client.mutation(dashboardApi.requestSetupCheck,{ sessionToken,serverId }).catch(() => setFailed(true))
  },[client,sessionToken,serverId])
  useEffect(request,[request])
  const checking = check?.state === 'queued' || check === undefined
  return <section className="panel" aria-labelledby="permission-check-title">
    <h2 id="permission-check-title">Permission check</h2>
    {failed && <p className="notice error" role="alert">The check could not be requested. Refresh your sign-in or try again</p>}
    {checking ? <p role="status">Asking NeonFlux to check its permissions…</p>
      : check === null ? <p role="status">No check has run yet</p>
        : check.state === 'failed' ? <p className="notice error" role="alert">NeonFlux did not answer. Check that the bot is online, then check again</p>
          : check.problems.length ? <ul>{check.problems.map((problem,index) => <li key={index}>{problemText(problem)}</li>)}</ul>
            : <p role="status">No problems found. Every enabled feature has the permissions and role position it needs</p>}
    <div className="actions"><button type="button" className="secondary" disabled={checking} onClick={request}>Check again</button></div>
  </section>
}

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
    <PermissionCheck client={client} sessionToken={sessionToken} serverId={serverId} />
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
