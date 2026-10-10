import { useId, useState } from 'react'
import type { DashboardSession } from '@neonflux/backend/dashboard-contracts'
import { fuzzyOptions } from './search-picker'

type Server = DashboardSession['servers'][number]
type MemberServer = NonNullable<DashboardSession['memberServers']>[number]
const memberFeatureLabels = { rolepicker: 'role picker',showcase: 'showcases',profile: 'profile',private: 'private cases' } as const
const tileColors = ['#4f5bd5','#2f7d57','#a8326f','#9a6417','#b83a3a','#2a6aa8','#6b46c1']
// More servers than this offer a search field
export const SERVER_SEARCH_FROM = 7

export function ServerIcon({ server, large = false }: { server: Server, large?: boolean }) {
  const [failed, setFailed] = useState(false)
  const className = large ? 'server-icon large' : 'server-icon'
  if (server.icon && !failed) return <img className={className} src={server.icon} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  const initials = server.name.trim().split(/\s+/).slice(0,2).map(word => [...word][0] ?? '').join('').toUpperCase() || '?'
  const color = tileColors[[...server.id].reduce((sum,digit) => sum + digit.charCodeAt(0),0) % tileColors.length]
  return <span className={`${className} initials`} style={{ background: color }} aria-hidden="true">{initials}</span>
}

const arrow = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
export interface ServerPickerProps {
  servers: Server[]
  memberServers?: MemberServer[]
  inviteUrl?: string | undefined
  onSelect: (serverId: string) => void
  onInvite?: () => void
  /** After the invitation was opened in this tab, offers to look for the new server again. checking is true while that runs */
  onCheckServers?: (() => void) | undefined
  checking?: boolean
}
export function ServerPicker({ servers, memberServers = [], inviteUrl, onSelect, onInvite, onCheckServers, checking = false }: ServerPickerProps) {
  const id = useId(), [query, setQuery] = useState(''), [invited, setInvited] = useState(false)
  const searchable = servers.length + memberServers.length >= SERVER_SEARCH_FROM
  const filter = <T extends Server>(list: T[]) => searchable && query.trim() ? fuzzyOptions(list, query) as T[] : list
  const managed = filter(servers), joined = filter(memberServers), none = searchable && query.trim() && !managed.length && !joined.length
  const invite = () => { setInvited(true); onInvite?.() }
  const search = searchable && <div className="server-search">
    <label htmlFor={`${id}-search`}>Search servers</label>
    <input id={`${id}-search`} type="search" autoComplete="off" value={query} placeholder="Type a server name…" onChange={event => setQuery(event.target.value)} />
    <p className="visually-hidden" role="status">{query.trim() ? `${managed.length + joined.length} servers match` : ''}</p>
  </div>
  const members = joined.length > 0 && <section className="server-select" aria-labelledby="member-select-title">
    <h2 id="member-select-title">Your member features</h2>
    <p className="muted">Servers where you can claim or drop roles yourself with the role picker, post showcases, edit your profile, or view private cases when the server gives you its private data role</p>
    <ul className="server-grid">{joined.map(server => { const roles = server.features.includes('rolepicker'), cases = server.features.includes('private'), names = server.features.map(feature => memberFeatureLabels[feature]); return <li key={server.id}>
      <button type="button" className="server-card" aria-label={roles ? `Choose roles in ${server.name}` : cases && names.length === 1 ? `View private cases in ${server.name}` : `Open member features in ${server.name}`} onClick={() => onSelect(server.id)}>
        <ServerIcon server={server} large />
        <span className="server-card-name">{server.name}</span>
        <span className="server-card-action">{roles && cases && names.length === 2 ? 'Open roles and private cases' : `Open ${names.length < 2 ? names.join('') : `${names.slice(0,-1).join(', ')} and ${names.at(-1)}`}`}{arrow}</span>
      </button>
    </li> })}</ul>
  </section>
  if (!servers.length && !inviteUrl) return <>{search}{none && <p className="muted server-none">No servers match “{query.trim()}”</p>}{members || null}</>
  return <>
    <section className="server-select" aria-labelledby="server-select-title">
      <h2 id="server-select-title">Choose a server</h2>
      <p className="muted">Select the server you want to configure. You can switch servers at any time from the server header</p>
      {search}
      {invited && onCheckServers && <p className="notice" role="status">A server you just added appears once NeonFlux has joined it. This list was refreshed when you came back <button type="button" className="secondary" disabled={checking} onClick={onCheckServers}>{checking ? 'Checking…' : 'Check again'}</button></p>}
      {none && <p className="muted server-none">No servers match “{query.trim()}”</p>}
      <ul className="server-grid">{managed.map(server => <li key={server.id}>
        <button type="button" className="server-card" aria-label={`Configure ${server.name}`} onClick={() => onSelect(server.id)}>
          <ServerIcon server={server} large />
          <span className="server-card-name">{server.name}</span>
          <span className="server-card-action">Open settings{arrow}</span>
        </button>
      </li>)}{inviteUrl && <li>
        <a className="server-card add" href={inviteUrl} target="_blank" rel="noopener noreferrer" onClick={invite}>
          <span className="server-icon large add-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></span>
          <span className="server-card-name">Add NeonFlux to a server</span>
          <span className="server-card-action">Opens Fluxer{arrow}</span>
        </a>
      </li>}</ul>
    </section>
    {members}
  </>
}
