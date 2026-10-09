import type { ConvexReactClient } from 'convex/react'
import { ConvexError } from 'convex/values'
import { useEffect, useRef, useState } from 'react'
import type { RolePickerJob, RolePickerMemberOperation, RolePickerRoleDisplay } from '@neonflux/backend/contracts'
import type { DashboardRolePickerMember } from '@neonflux/backend/dashboard-contracts'
import { dashboardApi } from './dashboard-api'

const states = { queued: 'Pending',applied: 'Applied',failed: 'Failed' }
function requestError(error: unknown) {
  const data = error instanceof ConvexError && typeof error.data === 'object' && error.data !== null ? error.data as { error?: unknown } : undefined
  return typeof data?.error === 'string' ? data.error : 'The request could not be sent. Check your connection and try again'
}

// The member view. The bot reads the member's roles in a lookup, and claims and drops wait for the bot like other dashboard requests
export function RolePickerMember({ client,sessionToken,serverId,connected }: { client: ConvexReactClient, sessionToken: string, serverId: string, connected: boolean }) {
  const [remote,setRemote] = useState<DashboardRolePickerMember>(), [error,setError] = useState(false)
  const [sending,setSending] = useState(false), [notice,setNotice] = useState('')
  const looked = useRef(false)
  useEffect(() => {
    setRemote(undefined); setError(false); looked.current = false
    const watch = client.watchQuery(dashboardApi.rolePickerMember,{ sessionToken,serverId })
    const update = () => { try { const result = watch.localQueryResult(); if (result) { setRemote(result); setError(false) } } catch { setError(true) } }
    const unsubscribe = watch.onUpdate(update)
    update()
    return unsubscribe
  },[client,sessionToken,serverId])
  async function send(operation: RolePickerMemberOperation) {
    setSending(true); setNotice('')
    try { await client.mutation(dashboardApi.rolePickerRequest,{ sessionToken,serverId,requestId: crypto.randomUUID(),operation }) }
    catch (cause) { setNotice(requestError(cause)) }
    finally { setSending(false) }
  }
  const pendingLookup = remote?.requests.some(row => row.state === 'queued' && row.operation.type === 'lookup') ?? false
  // One lookup when the view opens without fresh roles, so the menus can show what you hold
  useEffect(() => {
    if (!remote || looked.current || !connected) return
    looked.current = true
    if (!remote.snapshot && !pendingLookup) void send({ type: 'lookup' })
  },[remote,connected])
  // Role names and colors come from the bot: The last lookup's read first, then the names stored with the menus at their last save
  const roles = new Map<string,RolePickerRoleDisplay>([...(remote?.menus.flatMap(menu => menu.display ?? []) ?? []),...(remote?.snapshot?.roles ?? [])].map(role => [role.roleId,role]))
  const name = (roleId: string) => roles.get(roleId)?.name ?? 'Unnamed role'
  const swatch = (roleId: string) => { const color = roles.get(roleId)?.color ?? 0; return color ? <span aria-hidden="true" style={{ display: 'inline-block',width: '0.75em',height: '0.75em',borderRadius: '50%',marginRight: '0.4em',background: `#${color.toString(16).padStart(6,'0')}` }} /> : null }
  const label = (row: RolePickerJob) => row.operation.type === 'lookup' ? 'Check my roles' : `${row.operation.type === 'claim' ? 'Claim' : 'Drop'} ${name(row.operation.roleId)}`
  if (error) return <section className="panel"><p role="alert" className="notice error">The role picker is not available in this server right now. It may have been turned off, or your sign-in needs a refresh</p></section>
  if (!remote) return <section className="panel"><p role="status">Loading the role picker…</p></section>
  const snapshot = remote.snapshot, usable = connected && !sending && Boolean(snapshot?.allowed)
  return <>
    <section className="panel" aria-label="Role picker">
      <h2>Role picker</h2>
      <p className="muted">Claim or drop roles from the menus below. The bot checks your current roles and permissions before each change, so a change shows as pending until it is applied</p>
      {!snapshot && <p role="status" className="notice">{pendingLookup ? 'Checking your current roles…' : 'Your current roles are not loaded yet'}</p>}
      {snapshot && !snapshot.allowed && <p role="alert" className="notice error">You cannot use the role picker in this server</p>}
      {!remote.menus.length && <p className="muted">No menus are set up yet</p>}
      {remote.menus.map(menu => <fieldset className="mapping-row" key={menu.name}>
        <legend>{menu.name}</legend>
        {menu.description && <p>{menu.description}</p>}
        <p className="field-help">{menu.mode === 'single' ? 'Choose one. Claiming a role drops the other role of this menu' : 'Choose any number'}</p>
        <ul className="request-list">{menu.roleIds.map(roleId => {
          const held = snapshot?.roleIds.includes(roleId) ?? false
          const pending = remote.requests.some(row => row.state === 'queued' && row.operation.type !== 'lookup' && row.operation.roleId === roleId)
          return <li key={roleId}>{swatch(roleId)}{name(roleId)}{held && <span className="muted"> · You have this role</span>} <button type="button" className={held ? 'secondary' : undefined} disabled={!usable || pending}
            aria-label={`${held ? 'Drop' : 'Claim'} ${name(roleId)}`} onClick={() => void send({ type: held ? 'drop' : 'claim',menu: menu.name,roleId })}>{pending ? 'Pending…' : held ? 'Drop' : 'Claim'}</button></li>
        })}</ul>
      </fieldset>)}
      <div className="actions"><button type="button" className="secondary" disabled={!connected || sending || pendingLookup} onClick={() => void send({ type: 'lookup' })}>Refresh my roles</button>
        {snapshot && <span className="muted">Roles checked {new Date(snapshot.observedAt).toLocaleTimeString()}. This check expires after ten minutes</span>}</div>
      {notice && <p role="alert" className="notice error">{notice}</p>}
    </section>
    <section className="panel" aria-label="Your recent requests"><h2>Your recent requests</h2>
      {remote.requests.length ? <ul className="request-list">{remote.requests.map(row => <li key={row.id}>{label(row)}: {states[row.state]}{row.error && <p className="error-text">{row.error}</p>}</li>)}</ul> : <p className="muted">No recent requests</p>}
      <p className="field-help">Requests expire after two minutes. Records of your requests are deleted after one day</p>
    </section>
  </>
}
