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

export function ServerPicker({ servers, onSelect }: { servers: Server[], onSelect: (serverId: string) => void }) {
  return <section className="server-select" aria-labelledby="server-select-title">
    <h2 id="server-select-title">Choose a server</h2>
    <p className="muted">Select the server you want to configure. You can switch servers at any time from the server header</p>
    <ul className="server-grid">{servers.map(server => <li key={server.id}>
      <button type="button" className="server-card" aria-label={`Configure ${server.name}`} onClick={() => onSelect(server.id)}>
        <ServerIcon server={server} large />
        <span className="server-card-name">{server.name}</span>
        <span className="server-card-action">Open settings<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
      </button>
    </li>)}</ul>
  </section>
}
