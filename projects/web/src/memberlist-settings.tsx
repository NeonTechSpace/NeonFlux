import type { DashboardCatalog } from '@neonflux/backend/dashboard-contracts'
import { useEffect, useRef } from 'react'
import { ConfigForm } from './configuration-form'
import type { ConfigSectionProps } from './configuration-form'
import { FormInputError } from './settings-form'

type Role = DashboardCatalog['roles'][number]
const display = (role: Role) => role.hoistPosition ?? role.position
/** Hoisted roles as Fluxer shows them in the member list, top first */
export function memberListOrder(catalog?: DashboardCatalog) {
  return (catalog?.roles ?? []).filter(role => role.hoist && role.id !== catalog?.serverId)
    .sort((a,b) => display(b) - display(a) || b.position - a.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
}
const ids = (value: string | boolean | undefined) => JSON.parse(String(value)) as string[]

export function MemberListSettings(props: ConfigSectionProps<'memberlist'> & { refreshCatalog?: () => void }) {
  const { configRevision: revision,jobs } = props.remote, common = { queue: props.queue,connected: props.connected,jobs }
  const order = memberListOrder(props.catalog), nameOf = (id: string) => props.catalog?.roles.find(role => role.id === id)?.name ?? `Role ${id}`
  // The order lives in Fluxer, so an applied change reloads the role list once to show it
  const applied = jobs.find(job => job.state === 'applied')?.id, seen = useRef(applied), refreshCatalog = props.refreshCatalog
  useEffect(() => { if (applied && applied !== seen.current) { seen.current = applied; refreshCatalog?.() } },[applied,refreshCatalog])
  const snapshot = JSON.stringify(order.map(role => role.id))
  return <div className="role-section">
    <section className="panel"><h2>Member list order</h2><p className="muted">The order of the role groups in the member list, separate from the role hierarchy and its permissions. Only roles set to show separately appear here. The chat command !memberlist changes the same settings</p></section>
    {props.catalogLoading && !props.catalog ? <section className="panel"><p role="status">Loading roles…</p></section>
      : !order.length ? <section className="panel"><p className="muted">No role is shown separately in the member list. Turn on that role setting in Fluxer, then refresh the role list</p></section>
      : <ConfigForm<'memberlist'> {...common} title="Display order" description="Move roles up or down, top first. NeonFlux moves only roles below its own top role and yours, and fits the others around roles above them" submitLabel="Save order"
        snapshot={{ revision,values: { order: snapshot } }}
        operation={values => { const roleIds = ids(values.order); if (roleIds.length !== order.length) throw new FormInputError('The role list changed. Refresh it and try again'); return { type: 'set',roleIds } }}
        fields={(values,edit,disabled) => { const current = ids(values.order), move = (index: number,step: number) => { const next = [...current]; [next[index],next[index + step]] = [next[index + step]!,next[index]!]; edit('order',JSON.stringify(next)) }
          return <ol className="request-list">{current.map((id,index) => <li key={id}><strong>{nameOf(id)}</strong>{' '}
            <button type="button" className="secondary" aria-label={`Move ${nameOf(id)} up`} disabled={disabled || index === 0} onClick={() => move(index,-1)}>Up</button>{' '}
            <button type="button" className="secondary" aria-label={`Move ${nameOf(id)} down`} disabled={disabled || index === current.length - 1} onClick={() => move(index,1)}>Down</button></li>)}</ol> }} />}
    <ConfigForm<'memberlist'> {...common} title="Reset member list order" description="Clears every display position, including roles above yours, so the member list follows the role hierarchy again. Needs the server owner or an Administrator" submitLabel="Reset order"
      snapshot={{ revision,values: { confirm: false } }}
      operation={values => { if (!values.confirm) throw new FormInputError('Confirm the reset'); return { type: 'reset' } }}
      fields={(values,edit,disabled) => <label><input type="checkbox" checked={Boolean(values.confirm)} disabled={disabled} onChange={event => edit('confirm',event.target.checked)} />Confirm resetting the member list order</label>} />
  </div>
}
