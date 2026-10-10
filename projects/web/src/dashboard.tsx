import type { ConvexReactClient } from 'convex/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CatalogRefreshProvider, useCatalog, useInviteReturn } from './catalog'
import type { CatalogClock } from './catalog'
import type { WebSession } from './dashboard-api'
import { SessionProvider, SignIn, useSession } from './session'
import { useLiveClient } from './live-client'
import { ServerIcon, ServerPicker } from './server-picker'
import { RolePickerMember } from './role-picker-member'
import { Icon, isSectionId, navigation, sectionIcons, sectionLink, sectionNames, useSection } from './dashboard-sections'
import type { SectionId, SectionProps } from './dashboard-sections'
import { DraftScopeProvider, clearAllDrafts, useDraftSections } from './drafts'

/** Where the dashboard is, read from the page address so every server and section has its own link.
 *  Single-server mode needs no server, and the overview is the section when none is named */
export interface DashboardLocation { server?: string | undefined, section?: SectionId | undefined }
export function dashboardSearch(search: Record<string,unknown>): DashboardLocation {
  return { server: typeof search.server === 'string' && /^[1-9]\d{0,18}$/.test(search.server) ? search.server : undefined,section: isSectionId(search.section) && search.section !== 'overview' ? search.section : undefined }
}
export function dashboardHref(location: DashboardLocation): string {
  const query = new URLSearchParams()
  if (location.server) query.set('server',location.server)
  if (location.section && location.section !== 'overview') query.set('section',location.section)
  const text = query.toString()
  return text ? `/?${text}` : '/'
}
interface Navigation { location?: DashboardLocation | undefined, navigate?: ((location: DashboardLocation) => void) | undefined }

export function Dashboard(props: Navigation) { return <SessionProvider><DashboardSession {...props} /></SessionProvider> }
function DashboardSession({ location, navigate }: Navigation) {
  const session = useSession(), [logoutError, setLogoutError] = useState('')
  const [lastSession, setLastSession] = useState<WebSession>()
  useEffect(() => { if (session.data) setLastSession(session.data) }, [session.data])
  const visibleSession = session.data ?? lastSession
  return <div className="app">
    <AppHeader userName={session.data?.user.name} onSignOut={async () => {
      try { const response = await fetch('/auth/logout', { method: 'POST' }); if (!response.ok) throw new Error(); clearAllDrafts(); window.location.assign('/') } catch { setLogoutError('Sign-out failed. Try again') }
    }} />
    <main className="app-main">
      {logoutError && <p role="alert" className="notice error">{logoutError}</p>}
      {session.isPending && <p role="status" className="muted">Checking sign-in…</p>}
      {session.isError && <div role="alert" className="notice error">Unable to refresh your sign-in. Your drafts remain below <button className="secondary" onClick={() => session.refetch()}>Try again</button></div>}
      {session.data === null && <><SignIn returnTo={dashboardHref(location ?? {})} />{lastSession && <p className="notice" role="status">Your sign-in expired. Your drafts remain below and in this tab. Sign in again before saving</p>}</>}
      {visibleSession && <ManagedDashboard session={visibleSession} accessAvailable={Boolean(session.data) && !session.isError} refreshSession={() => void session.refetch()} refreshingSession={session.isFetching} location={location} navigate={navigate} />}
    </main>
  </div>
}
export function AppHeader({ userName, onSignOut }: { userName?: string, onSignOut: () => void }) {
  return <header className="header">
    <div className="brand"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg></span><div><h1>NeonFlux</h1><p className="muted">Server configuration</p></div></div>
    {userName && <div className="account"><span className="account-name">{userName}</span><button className="secondary" onClick={onSignOut}>Sign out</button></div>}
  </header>
}
function ManagedDashboard({ session, accessAvailable, ...props }: { session: WebSession, accessAvailable: boolean, refreshSession: () => void, refreshingSession: boolean } & Navigation) {
  const client = useLiveClient(session.convexUrl)
  return client ? <ServerDashboard session={session} accessAvailable={accessAvailable} client={client} {...props} /> : <p role="status" className="muted">Connecting to live settings…</p>
}
export function ServerDashboard({ session, accessAvailable, client, refreshSession, refreshingSession = false, catalogClock, location, navigate }: { session: WebSession, accessAvailable: boolean, client: ConvexReactClient, refreshSession?: () => void, refreshingSession?: boolean, catalogClock?: CatalogClock } & Navigation) {
  // Without a router, such as in tests, the location lives in component state
  const [localLocation, setLocalLocation] = useState<DashboardLocation>({})
  const here = navigate ? location ?? {} : localLocation, go = navigate ?? setLocalLocation
  const multi = session.mode === 'multi', memberServers = session.memberServers ?? []
  const [menuOpen, setMenuOpen] = useState(false)
  const [connected, setConnected] = useState(client.connectionState().isWebSocketConnected)
  useEffect(() => client.subscribeToConnectionState(state => setConnected(state.isWebSocketConnected)), [client])
  const requested = here.server ?? ''
  const serverId = session.servers.some(server => server.id === requested) ? requested : multi ? '' : session.servers[0]?.id ?? ''
  // A server the user only joined opens the member view, which renders no manager section
  const memberServerId = serverId ? '' : memberServers.some(server => server.id === requested) ? requested : multi ? '' : memberServers[0]?.id ?? ''
  const section: SectionId = here.section ?? 'overview'
  const { catalog, loading: catalogLoading, error: catalogError, refresh: refreshCatalog, busy: catalogBusy, refreshing: catalogRefreshing, refreshed: catalogRefreshed } = useCatalog(client,session.sessionToken,serverId,accessAvailable,catalogClock)
  const catalogRefresh = useMemo(() => ({ refresh: refreshCatalog,busy: catalogBusy,refreshing: catalogRefreshing }),[refreshCatalog,catalogBusy,catalogRefreshing])
  // Coming back from the bot invitation reloads the server list once, and the open server's channels and roles once
  const markInvite = useInviteReturn(() => { refreshSession?.(); refreshCatalog() })
  const drafts = useDraftSections(session.user.id,serverId)
  const draftScope = useMemo(() => ({ userId: session.user.id,serverId,section }),[session.user.id,serverId,section])
  const { component: Section, failed: sectionFailed, retry: retrySection } = useSection(section)
  // A section chosen from the menu moves focus to the content, because the menu closes on small screens
  const content = useRef<HTMLDivElement>(null), focusContent = useRef(false)
  useEffect(() => { if (focusContent.current) { focusContent.current = false; content.current?.focus() } },[section])
  const place = (id: SectionId) => ({ server: multi ? serverId : undefined,section: id === 'overview' ? undefined : id })
  const sectionHref = (id: SectionId) => dashboardHref(place(id))
  const openSection = (id: SectionId) => { setMenuOpen(false); focusContent.current = true; go(place(id)) }
  const invite = multi ? session.inviteUrl : undefined
  if (!session.servers.length && !memberServers.length) return <section className="panel"><h2>No manageable servers</h2>{invite
    ? <><p>You need to own a server with NeonFlux, or have Manage Server permission in it, to edit its settings. After you add NeonFlux, the server appears here when you come back to this tab, within a few minutes or when you reload</p><a className="button" href={invite} target="_blank" rel="noopener noreferrer" onClick={markInvite}>Add NeonFlux to a server</a></>
    : <p>You need to own a configured NeonFlux server or have Manage Server permission to edit its settings</p>}</section>
  if (memberServerId) {
    const server = memberServers.find(value => value.id === memberServerId)!, live = connected && accessAvailable
    return <div className="content">
      <div className="server-header">
        <ServerIcon server={server} large />
        <div className="server-title"><p className="eyebrow">Choose your roles</p><h2>{server.name}</h2></div>
        <span className={live ? 'status-pill live' : 'status-pill'}>{live ? 'Live' : connected ? 'Read only' : 'Offline'}</span>
        {multi && <div className="server-switch"><button type="button" className="secondary" onClick={() => go({})}>Switch server</button></div>}
      </div>
      <RolePickerMember key={memberServerId} client={client} sessionToken={session.sessionToken} serverId={memberServerId} connected={live} />
    </div>
  }
  if (!serverId) return <>
    {requested && <p className="notice" role="status">The server in this link is not available to you. You need Manage Server permission in it, and NeonFlux must be in it</p>}
    <ServerPicker servers={session.servers} memberServers={memberServers} inviteUrl={invite} onInvite={markInvite} onCheckServers={refreshSession} checking={refreshingSession} onSelect={id => { setMenuOpen(false); go({ server: id }) }} />
  </>
  const server = session.servers.find(value => value.id === serverId)!
  const writable = connected && accessAvailable
  const props: SectionProps = { section,client,sessionToken: session.sessionToken,serverId,userId: session.user.id,connected: writable,catalog,catalogLoading,catalogError,refreshCatalog,sectionHref,openSection }
  const link = (id: SectionId, name: string) => <a key={id} {...sectionLink(id,sectionHref,openSection)} aria-current={section === id ? 'page' : undefined}><Icon path={sectionIcons[id]} /><span className="nav-name">{name}</span>{drafts.has(id) && <span className="nav-draft" title="Unsaved draft"><span className="visually-hidden">, unsaved draft</span></span>}</a>
  return <CatalogRefreshProvider value={catalogRefresh}><div className="layout">
    <aside className="sidebar"><button className="section-menu secondary" aria-expanded={menuOpen} aria-controls="configuration-navigation" onClick={() => setMenuOpen(value => !value)}>{sectionNames[section]} · Sections</button><nav id="configuration-navigation" className={menuOpen ? 'menu-open' : ''} aria-label="Configuration sections"><div className="nav-group">{link('overview','Overview')}</div>{navigation.map(([group,items]) => <div className="nav-group" key={group}><p className="nav-heading">{group}</p>{items.map(([id,name]) => link(id,name))}</div>)}</nav></aside>
    <div className="content" ref={content} tabIndex={-1}>
      <div className="server-header">
        <ServerIcon server={server} large />
        <div className="server-title"><p className="eyebrow">{multi ? 'Configuring server' : 'Server'}</p><h2>{server.name}</h2></div>
        <span className={writable ? 'status-pill live' : 'status-pill'}>{writable ? 'Live' : connected ? 'Read only' : 'Offline'}</span>
        {multi && <div className="server-switch"><button type="button" className="secondary" onClick={() => { setMenuOpen(false); go({}) }}>Switch server</button><span className="field-help">Unsaved drafts stay in this tab until you save or discard them</span></div>}
      </div>
      {catalogError && <p className="notice error" role="alert">{catalog ? 'Channel and role choices could not be refreshed. The lists loaded earlier are still shown, and you can enter an exact ID' : 'Channel and role choices could not be loaded. Existing selections are kept. You can enter an exact ID while choices are unavailable'} <button type="button" className="secondary" disabled={catalogBusy} onClick={refreshCatalog}>{catalogRefreshing ? 'Retrying…' : 'Retry choices'}</button></p>}
      <p className="visually-hidden" role="status">{catalogRefreshed ? 'Channel and role lists refreshed' : ''}</p>
      {!connected && <p className="notice" role="status">Offline. Your draft has been kept. Saving will be available when the live connection returns</p>}
      <DraftScopeProvider value={draftScope}>
        {Section ? <div className="section-content" key={`${session.user.id}:${serverId}:${section}`}><Section {...props} /></div>
          : sectionFailed ? <section className="panel"><p className="notice error" role="alert">This section could not be loaded. Check your connection <button type="button" className="secondary" onClick={retrySection}>Try again</button></p></section>
          : <section className="panel"><p role="status">Loading {sectionNames[section].toLowerCase()}…</p></section>}
      </DraftScopeProvider>
    </div>
  </div></CatalogRefreshProvider>
}
