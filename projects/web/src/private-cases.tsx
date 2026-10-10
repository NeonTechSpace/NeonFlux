import type { Appeal } from '@neonflux/contracts/appeal'
import type { ModerationCase } from '@neonflux/contracts/moderation'
import type { DashboardPrivateResult, DashboardPrivateView } from '@neonflux/backend/dashboard-contracts'
import { ConvexError } from 'convex/values'
import { useEffect, useState } from 'react'
import { dashboardApi } from './dashboard-api'
import type { SectionProps } from './dashboard-sections'
import { useLiveQuery } from './live-query'
import { localTime } from './time'

const erased = <em>Erased by the server owner</em>
function viewError(error: unknown) {
  const data = error instanceof ConvexError && typeof error.data === 'object' && error.data !== null ? error.data as { error?: unknown } : undefined
  return typeof data?.error === 'string' ? data.error : 'This view could not be loaded. Check your connection and try again'
}

/** Private cases, appeals and member history. Every view asks the backend, which needs a live access check the bot answered,
 *  and records the view in the audit log. A passed check serves views for two minutes */
export function PrivateCasesSection({ client,sessionToken,serverId }: Pick<SectionProps,'client' | 'sessionToken' | 'serverId'>) {
  const access = useLiveQuery(client,dashboardApi.privateAccess,{ sessionToken,serverId })
  const [view,setView] = useState<DashboardPrivateView>({ type: 'cases' }), [trail,setTrail] = useState<DashboardPrivateView[]>([])
  const [result,setResult] = useState<DashboardPrivateResult>(), [failure,setFailure] = useState(''), [attempt,setAttempt] = useState(0)
  const [member,setMember] = useState('')
  const check = access.data?.check, checkKey = check ? `${check.state}:${check.checkedAt ?? check.requestedAt}` : 'none'
  // A view is asked for when it opens and again when the access check answers, so a passed check shows the view at once
  useEffect(() => {
    if (!access.data) return
    let active = true
    setFailure('')
    client.mutation(dashboardApi.privateView,{ sessionToken,serverId,view }).then(value => { if (active) setResult(value) },cause => { if (active) setFailure(viewError(cause)) })
    return () => { active = false }
  },[Boolean(access.data),JSON.stringify(view),checkKey,attempt])
  const open = (next: DashboardPrivateView) => { setTrail([...trail,view]); setResult(undefined); setView(next) }
  const back = () => { setResult(undefined); setView(trail.at(-1)!); setTrail(trail.slice(0,-1)) }
  const top = (next: DashboardPrivateView) => { setTrail([]); setResult(undefined); setView(next) }
  const memberValid = /^[1-9]\d{0,18}$/.test(member)
  const data = result?.status === 'ok' ? result.data : undefined
  const caseRows = (cases: ModerationCase[]) => <table className="audit-table"><thead><tr><th>Case</th><th>When</th><th>Action</th><th>Member</th><th>Moderator</th><th>Outcome</th><th>Reason</th></tr></thead><tbody>
    {cases.map(row => <tr key={row.caseNo}>
      <td><button type="button" className="secondary" onClick={() => open({ type: 'case',caseNo: row.caseNo })}>Case {row.caseNo}</button></td><td>{localTime(row.createdAt)}</td>
      <td>{row.action}{row.voided ? ', voided' : ''}</td>
      <td>{row.targetId ? <button type="button" className="secondary" aria-label={`History of member ${row.targetId}`} onClick={() => open({ type: 'history',userId: row.targetId! })}>{row.targetId}</button> : 'None'}</td>
      <td>{row.actorId ?? row.origin}</td><td>{row.outcome}</td><td>{row.erased ? erased : row.reason}</td>
    </tr>)}
  </tbody></table>
  const appealRows = (appeals: Appeal[]) => appeals.length ? <ul className="request-list">{appeals.map(row => <li key={row.appealNo}>
    <strong>Appeal {row.appealNo}</strong>, case {row.caseNo}, member {row.userId}: {row.status}, {localTime(row.createdAt)}
    <p>{row.erased ? erased : row.text}</p>{!row.erased && row.decisionReason && <p>Decision: {row.decisionReason}</p>}
  </li>)}</ul> : <p className="muted">No appeals</p>
  const refused = access.data?.roleConfigured ? 'You need this server\'s private data role to view private cases. Administrator permission alone is not enough'
    : 'Only the server owner can view private cases until the owner names a private data role'
  return <section className="panel" aria-labelledby="private-title">
    <div className="panel-heading"><h2 id="private-title">Private cases</h2>
      <div className="inline-field"><button type="button" className="secondary" onClick={() => top({ type: 'cases' })}>Cases</button><button type="button" className="secondary" onClick={() => top({ type: 'appeals' })}>Appeals</button></div>
    </div>
    <p className="muted">Moderation cases, appeals and member history. Only the server owner and members with the private data role can view them. NeonFlux checks your roles with Fluxer before you view them, at most every two minutes, and the audit log records every view</p>
    <form className="inline-field" onSubmit={event => { event.preventDefault(); if (memberValid) top({ type: 'history',userId: member }) }}>
      <label className="inline-field">Member ID<input inputMode="numeric" maxLength={19} value={member} onChange={event => setMember(event.target.value.trim())} /></label>
      <button type="submit" className="secondary" disabled={!memberValid}>Show history</button>
    </form>
    {access.error && <p className="notice error" role="alert">Private cases are not available to you in this server. Refresh your sign-in</p>}
    {failure && <p className="notice error" role="alert">{failure}</p>}
    {!access.error && !failure && (!result || result.status === 'checking') && <p role="status">{result ? 'Checking your access with NeonFlux…' : 'Loading…'}</p>}
    {result?.status === 'refused' && <p className="notice error" role="alert">{refused} <button type="button" className="secondary" onClick={() => setAttempt(attempt + 1)}>Check again</button></p>}
    {result?.status === 'failed' && <p className="notice error" role="alert">NeonFlux could not check your access. The bot may be offline <button type="button" className="secondary" onClick={() => setAttempt(attempt + 1)}>Try again</button></p>}
    {data?.type === 'cases' && (data.cases.length ? caseRows(data.cases) : <p className="muted">No cases</p>)}
    {data?.type === 'appeals' && appealRows(data.appeals)}
    {data?.type === 'history' && <><h3>Member {data.userId}</h3>{data.cases.length ? caseRows(data.cases) : <p className="muted">No cases</p>}<h3>Appeals</h3>{appealRows(data.appeals)}</>}
    {data?.type === 'case' && <>
      <h3>Case {data.case.caseNo}</h3>
      <ul className="request-list">
        <li>{data.case.action}, {data.case.outcome}{data.case.voided ? ', voided' : ''}, {localTime(data.case.createdAt)}</li>
        <li>Member: {data.case.targetId ?? 'None'}{data.case.channelId ? `, channel ${data.case.channelId}` : ''}</li>
        <li>Moderator: {data.case.actorId ?? data.case.origin}{data.case.ruleName ? `, rule ${data.case.ruleName}` : ''}{data.case.linkedCaseNo ? `, linked to case ${data.case.linkedCaseNo}` : ''}</li>
        <li>Reason: {data.case.erased ? erased : data.case.reason}</li>
      </ul>
      <h3>Corrections</h3>
      {data.case.corrections.length ? <ul className="request-list">{data.case.corrections.map(row => <li key={row.createdAt}>{row.type === 'void' ? 'Voided' : 'Reason corrected'} by {row.actorId}, {localTime(row.createdAt)}: {row.previousReason} → {row.reason}</li>)}</ul> : <p className="muted">No corrections</p>}
      <h3>Appeals</h3>{appealRows(data.appeals)}
    </>}
    <div className="actions">
      <button type="button" className="secondary" disabled={!trail.length} onClick={back}>Back</button>
      {data?.type === 'cases' && data.nextBeforeCaseNo && <button type="button" className="secondary" onClick={() => open({ type: 'cases',beforeCaseNo: data.nextBeforeCaseNo! })}>Older cases</button>}
      {data?.type === 'history' && data.nextBeforeCaseNo && <button type="button" className="secondary" onClick={() => open({ type: 'history',userId: data.userId,beforeCaseNo: data.nextBeforeCaseNo! })}>Older cases</button>}
      {data?.type === 'appeals' && data.nextBeforeAppealNo && <button type="button" className="secondary" onClick={() => open({ type: 'appeals',beforeAppealNo: data.nextBeforeAppealNo! })}>Older appeals</button>}
      {check?.validUntil !== undefined && check.state === 'passed' && <span className="muted">Access checked {localTime(check.checkedAt!)}. NeonFlux checks again after {localTime(check.validUntil)}</span>}
    </div>
  </section>
}
