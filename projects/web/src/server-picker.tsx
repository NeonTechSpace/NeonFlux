import { useState } from 'react'
import type { DashboardSession } from '@neonflux/backend/dashboard-contracts'

type Server = DashboardSession['servers'][number]
const tileColors = ['#4f5bd5','#2f7d57','#a8326f','#9a6417','#b83a3a','#2a6aa8','#6b46c1']

export function ServerIcon({ server, large = false }: { server: Server, large?: boolean }) {
  const [failed, setFailed] = useState(false)
  const className = large ? 'server-icon large' : 'server-icon'
  if (server.icon && !failed) return <img className={className} src={server.icon} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  const initials = server.name.trim().split(/\s+/).slice(0,2).map(word => [...word][0] ?? '').join('').toUpperCase() || '?'
  const color = tileColors[[...server.id].reduce((sum,digit) => sum + digit.charCodeAt(0),0) % tileColors.length]
  return <span className={`${className} initials`} style={{ background: color }} aria-hidden="true">{initials}</span>
}

export function ServerPicker({ servers, memberServers = [], inviteUrl, onSelect }: { servers: Server[], memberServers?: Server[], inviteUrl?: string | undefined, onSelect: (serverId: string) => void }) {
  const members = memberServers.length > 0 && <section className="server-select" aria-labelledby="member-select-title">
    <h2 id="member-select-title">Choose your roles</h2>
    <p className="muted">Servers where you can claim or drop roles yourself with the role picker</p>
    <ul className="server-grid">{memberServers.map(server => <li key={server.id}>
      <button type="button" className="server-card" aria-label={`Choose roles in ${server.name}`} onClick={() => onSelect(server.id)}>
        <ServerIcon server={server} large />
        <span className="server-card-name">{server.name}</span>
        <span className="server-card-action">Open role picker<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
      </button>
    </li>)}</ul>
  </section>
  if (!servers.length && !inviteUrl) return members || null
  return <>{managerPicker(servers, inviteUrl, onSelect)}{members}</>
}
function managerPicker(servers: Server[], inviteUrl: string | undefined, onSelect: (serverId: string) => void) {
  return <section className="server-select" aria-labelledby="server-select-title">
    <h2 id="server-select-title">Choose a server</h2>
    <p className="muted">Select the server you want to configure. You can switch servers at any time from the server header</p>
    <ul className="server-grid">{servers.map(server => <li key={server.id}>
      <button type="button" className="server-card" aria-label={`Configure ${server.name}`} onClick={() => onSelect(server.id)}>
        <ServerIcon server={server} large />
        <span className="server-card-name">{server.name}</span>
        <span className="server-card-action">Open settings<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
      </button>
    </li>)}{inviteUrl && <li>
      <a className="server-card add" href={inviteUrl} target="_blank" rel="noopener noreferrer">
        <span className="server-icon large add-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></span>
        <span className="server-card-name">Add NeonFlux to a server</span>
        <span className="server-card-action">Opens Fluxer<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
      </a>
    </li>}</ul>
  </section>
}
