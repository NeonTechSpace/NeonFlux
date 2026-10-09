import type { ConvexReactClient } from 'convex/react'
import { useEffect, useState } from 'react'
import type { DashboardCatalog, DashboardSnapshot, DashboardMetadataSnapshot } from '@neonflux/backend/dashboard-contracts'
import type { WebSession } from './dashboard-api'
import { dashboardApi } from './dashboard-api'
import { SessionProvider, SignIn, useSession } from './session'
import { SettingsForm } from './settings-form'
import { RoleSettings } from './role-settings'
import { useLiveClient } from './live-client'
import { ServerIcon, ServerPicker } from './server-picker'
import { Messages } from './messages'
import { LogSettings } from './log-settings'
import { ConfigurationSection, isConfigurationSection } from './configuration-section'
import { useConfigurationState } from './configuration-live'
import { NicknameSection } from './general-settings'

const navigation = [
  ['Basics',[['general','General'],['custom','Custom commands'],['auto','Autoresponders']]],
  ['Moderation',[['moderation','Moderation and safety'],['cleanup','Message cleanup'],['logs','Channel logs']]],
  ['Roles',[['reaction','Reaction roles'],['autorole','Autorole'],['verification','Verification']]],
  ['Messaging',[['messages','Messages'],['publishing','Drafts and templates'],['greetings','Greetings'],['schedules','Schedules']]],
  ['Community',[['tickets','Tickets'],['leveling','Leveling'],['milestones','Milestones'],['suggestions','Suggestions'],['events','Events']]],
] as const
const sections = navigation.flatMap(([,items]): ReadonlyArray<readonly [string,string]> => items)
const templateConsumers = new Set(['greetings','tickets','milestones','events','schedules'])
const icons: Record<string,string> = {
  general: 'M4 6h9M17 6h3M15 4v4M4 12h3M11 12h9M9 10v4M4 18h11M19 18h1M17 16v4',
  custom: 'M4 17l6-5-6-5M12 19h8',
  auto: 'M13 2L4 14h7l-1 8 9-12h-7z',
  moderation: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  cleanup: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  logs: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  reaction: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  autorole: 'M15 20c0-3-2.5-5-6-5s-6 2-6 5M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M16 11h6',
  verification: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM8 12l3 3 5-6',
  messages: 'M4 5h16v11H9l-5 4z',
  publishing: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  greetings: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
  schedules: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 7v5l3 2',
  tickets: 'M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4zM14 7v10',
  leveling: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  milestones: 'M5 21V4M5 4h11l-2 4 2 4H5',
  suggestions: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
  events: 'M4 6h16v15H4zM4 10h16M8 3v5M16 3v5',
}
const Icon = ({ path }: { path: string }) => <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg>

export function Dashboard() { return <SessionProvider><DashboardSession /></SessionProvider> }
function DashboardSession() {
  const session = useSession(), [logoutError, setLogoutError] = useState('')
  const [lastSession, setLastSession] = useState<WebSession>()
  useEffect(() => { if (session.data) setLastSession(session.data) }, [session.data])
  const visibleSession = session.data ?? lastSession
  return <div className="app">
    <AppHeader userName={session.data?.user.name} onSignOut={async () => {
      try { const response = await fetch('/auth/logout', { method: 'POST' }); if (!response.ok) throw new Error(); window.location.assign('/') } catch { setLogoutError('Sign-out failed. Try again') }
    }} />
    <main className="app-main">
      {logoutError && <p role="alert" className="notice error">{logoutError}</p>}
      {session.isPending && <p role="status" className="muted">Checking sign-in…</p>}
      {session.isError && <div role="alert" className="notice error">Unable to refresh your sign-in. Your drafts remain below <button className="secondary" onClick={() => session.refetch()}>Try again</button></div>}
      {session.data === null && <><SignIn />{lastSession && <p className="notice" role="status">Your sign-in expired. Your drafts remain below. Sign in again before saving</p>}</>}
      {visibleSession && <ManagedDashboard session={visibleSession} accessAvailable={Boolean(session.data) && !session.isError} />}
    </main>
  </div>
}
export function AppHeader({ userName, onSignOut }: { userName?: string, onSignOut: () => void }) {
  return <header className="header">
    <div className="brand"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg></span><div><h1>NeonFlux</h1><p className="muted">Server configuration</p></div></div>
    {userName && <div className="account"><span className="account-name">{userName}</span><button className="secondary" onClick={onSignOut}>Sign out</button></div>}
  </header>
}
function ManagedDashboard({ session, accessAvailable }: { session: WebSession, accessAvailable: boolean }) {
  const client = useLiveClient(session.convexUrl)
  return client ? <ServerDashboard session={session} accessAvailable={accessAvailable} client={client} /> : <p role="status" className="muted">Connecting to live settings…</p>
}
export function ServerDashboard({ session, accessAvailable, client }: { session: WebSession, accessAvailable: boolean, client: ConvexReactClient }) {
  const multi = session.mode === 'multi'
  const [selected, setSelected] = useState(multi ? '' : session.servers[0]?.id ?? '')
  const [section, setSection] = useState('general')
  const [logsOpened, setLogsOpened] = useState(false)
  const [opened, setOpened] = useState<string[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [connected, setConnected] = useState(client.connectionState().isWebSocketConnected)
  const [remoteState, setRemote] = useState<DashboardSnapshot>(), [liveError, setLiveError] = useState(false)
  const [catalogState,setCatalog] = useState<DashboardCatalog>(), [catalogLoading,setCatalogLoading] = useState(false), [catalogError,setCatalogError] = useState(false), [catalogRefresh,setCatalogRefresh] = useState(0)
  useEffect(() => client.subscribeToConnectionState(state => setConnected(state.isWebSocketConnected)), [client])
  const serverId = session.servers.some(server => server.id === selected) ? selected : multi ? '' : session.servers[0]?.id ?? ''
  const remote = remoteState?.serverId === serverId ? remoteState : undefined
  const catalog = catalogState?.serverId === serverId ? catalogState : undefined
  const templates = useConfigurationState(client,session.sessionToken,serverId,'publishing',Boolean(serverId) && opened.some(id => templateConsumers.has(id)))
  const templateRemote = templates.remote?.serverId === serverId && templates.remote.family === 'publishing' ? templates.remote : undefined
  useEffect(() => {
    let active = true
    setCatalog(undefined); setCatalogError(false); setCatalogLoading(true)
    if (!serverId || !accessAvailable) { setCatalogLoading(false); return }
    void client.action(dashboardApi.catalog,{ sessionToken: session.sessionToken,serverId }).then(result => { if (active) { setCatalog(result); setCatalogLoading(false) } },() => { if (active) { setCatalogError(true); setCatalogLoading(false) } })
    return () => { active = false }
  },[client,session.sessionToken,serverId,catalogRefresh,accessAvailable])
  useEffect(() => {
    setRemote(undefined); setLiveError(false)
    if (!serverId) return
    const watch = client.watchQuery(dashboardApi.snapshot, { sessionToken: session.sessionToken, serverId })
    const update = () => { try { const result = watch.localQueryResult(); if (result) { setRemote(result); setLiveError(false) } } catch { setLiveError(true) } }
    const unsubscribe = watch.onUpdate(update)
    update()
    return unsubscribe
  }, [client, session.sessionToken, serverId])
  const invite = multi ? session.inviteUrl : undefined
  if (!session.servers.length) return <section className="panel"><h2>No manageable servers</h2>{invite
    ? <><p>You need to own a server with NeonFlux, or have Manage Server permission in it, to edit its settings. After you add NeonFlux, the server appears here within a few minutes or when you reload</p><a className="button" href={invite} target="_blank" rel="noopener noreferrer">Add NeonFlux to a server</a></>
    : <p>You need to own a configured NeonFlux server or have Manage Server permission to edit its settings</p>}</section>
  if (!serverId) return <ServerPicker servers={session.servers} inviteUrl={invite} onSelect={id => { setSelected(id); setMenuOpen(false) }} />
  const server = session.servers.find(value => value.id === serverId)!
  const writable = connected && !liveError && accessAvailable
  return <div className="layout">
    <aside className="sidebar"><button className="section-menu secondary" aria-expanded={menuOpen} aria-controls="configuration-navigation" onClick={() => setMenuOpen(value => !value)}>{sections.find(([id]) => id === section)?.[1] ?? 'Configuration'} · Sections</button><nav id="configuration-navigation" className={menuOpen ? 'menu-open' : ''} aria-label="Configuration sections">{navigation.map(([group,items]) => <div className="nav-group" key={group}><p className="nav-heading">{group}</p>{items.map(([id,name]) => <button key={id} aria-current={section === id ? 'page' : undefined} onClick={() => { setSection(id); setMenuOpen(false); if (id === 'logs') setLogsOpened(true); setOpened(current => current.includes(id) ? current : [...current,id]) }}><Icon path={icons[id]!} />{name}</button>)}</div>)}</nav></aside>
    <div className="content">
      <div className="server-header">
        <ServerIcon server={server} large />
        <div className="server-title"><p className="eyebrow">{multi ? 'Configuring server' : 'Server'}</p><h2>{server.name}</h2></div>
        <span className={writable ? 'status-pill live' : 'status-pill'}>{writable ? 'Live' : connected ? 'Read only' : 'Offline'}</span>
        {multi && <div className="server-switch"><button type="button" className="secondary" onClick={() => { setSelected(''); setMenuOpen(false) }}>Switch server</button><span className="field-help">Save your changes before switching servers. Switching clears unsaved drafts for the current server</span></div>}
      </div>
      {catalogError && <p className="notice error" role="alert">Channel and role choices could not be loaded. Existing selections are kept. You can enter an exact ID while choices are unavailable <button type="button" className="secondary" onClick={() => setCatalogRefresh(value => value + 1)}>Retry choices</button></p>}
      {!connected && <p className="notice" role="status">Offline. Your draft has been kept. Saving will be available when the live connection returns</p>}
      {liveError && <p className="notice error" role="alert">Live settings are unavailable. Refresh your sign-in or check your server permission. Your draft has been kept</p>}
      {!remote && <section className="panel"><p role="status">Loading live settings…</p></section>}
      {remote && <div hidden={section !== 'general'}><SettingsForm key={`${serverId}:general`} title="General" description="Set the command prefix for this server. Changes also reach the bot through the shared backend" snapshot={{ revision: remote.general.revision, values: { prefix: remote.general.prefix } }} connected={writable} save={(values,expectedRevision) => client.action(dashboardApi.save, { sessionToken: session.sessionToken, serverId, section: 'general', expectedRevision, prefix: String(values.prefix) })} fields={(values,edit,disabled) => <label>Command prefix<input required minLength={1} maxLength={5} value={String(values.prefix)} disabled={disabled} onChange={event => edit('prefix',event.target.value)} /><span className="field-help">One to five punctuation characters, such as ! or ?. Commands remain available in chat</span></label>} /><NicknameSection key={`${serverId}:nickname`} client={client} sessionToken={session.sessionToken} serverId={serverId} connected={writable} /></div>}
      {opened.filter(isConfigurationSection).map(id => <div hidden={section !== id} key={`${serverId}:${id}`}><ConfigurationSection section={id} client={client} sessionToken={session.sessionToken} serverId={serverId} connected={writable} catalog={catalog} catalogLoading={catalogLoading} catalogError={catalogError} templates={templateRemote?.data.drafts} templatesLoading={!templateRemote || templates.loadingPage} templatesError={templates.error} templatesHasMore={Boolean(templateRemote?.nextCursors?.drafts)} loadTemplatesPage={() => templates.loadPage('drafts',templateRemote?.nextCursors?.drafts)} /></div>)}
      {remote && (['reaction','autorole','verification'] as const).map(roleSection => <div hidden={section !== roleSection} key={`${serverId}:${roleSection}`}><RoleSettings section={roleSection} remote={remote} sessionToken={session.sessionToken} client={client} connected={writable} catalog={catalog} catalogLoading={catalogLoading} catalogError={catalogError} /></div>)}
      {remote && <div hidden={section !== 'messages'} key={`${serverId}:messages`}><Messages client={client} sessionToken={session.sessionToken} serverId={serverId} connected={writable} catalog={catalog} catalogLoading={catalogLoading} catalogError={catalogError} jobs={remote.messages ?? []} /></div>}
      {logsOpened && <div hidden={section !== 'logs'} key={`${serverId}:logs`}><MetadataSection client={client} sessionToken={session.sessionToken} serverId={serverId} connected={writable} catalog={catalog} catalogLoading={catalogLoading} catalogError={catalogError} /></div>}
    </div>
  </div>
}

function MetadataSection({ client, sessionToken, serverId, connected, catalog, catalogLoading, catalogError }: { client: ConvexReactClient, sessionToken: string, serverId: string, connected: boolean, catalog?: DashboardCatalog, catalogLoading: boolean, catalogError: boolean }) {
  const [remote,setRemote] = useState<DashboardMetadataSnapshot>(), [error,setError] = useState(false)
  useEffect(() => {
    const watch = client.watchQuery(dashboardApi.metadataSnapshot,{ sessionToken,serverId })
    const update = () => { try { const result = watch.localQueryResult(); if (result) { setRemote(result); setError(false) } } catch { setError(true) } }
    const unsubscribe = watch.onUpdate(update)
    update()
    return unsubscribe
  },[client,sessionToken,serverId])
  return <>
    {error && <p role="alert" className="notice error">Live logging settings are unavailable. Your draft has been kept. Refresh your sign-in before saving</p>}
    {!remote && <section className="panel"><p role="status">Loading logging settings…</p></section>}
    {remote && <LogSettings remote={remote} connected={connected && !error} catalog={catalog} catalogLoading={catalogLoading} catalogError={catalogError} defaultOwnerId={catalog?.ownerId} queue={(operation,expectedConfigRevision,requestId) => client.action(dashboardApi.queueMetadata,{ sessionToken,serverId,requestId,expectedConfigRevision,operation })} />}
  </>
}
