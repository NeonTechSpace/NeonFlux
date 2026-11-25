import type { ConvexReactClient } from "convex/react"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import type { DashboardMemberFeature } from "@neonflux/backend/dashboard-contracts"
import { AmbientLava, MotionToggle, useMotionPreference } from "./ambient-lava"
import { BrandMark } from "./brand-mark"
import {
    CatalogRefreshProvider,
    clearCatalogCache,
    clearOtherCatalogCaches,
    useCatalog,
    useInviteReturn,
} from "./catalog"
import type { CatalogClock } from "./catalog"
import { CommandPalette } from "./command-palette"
import type { WebSession } from "./dashboard-api"
import { SessionProvider, SignIn, useSession } from "./session"
import { useLiveClient } from "./live-client"
import { clearLiveQueryCache } from "./live-query"
import { ServerIcon, ServerPicker } from "./server-picker"
import { fuzzyOptions } from "./fuzzy"
import {
    Icon,
    isSectionId,
    navigation,
    sectionIcons,
    sectionLink,
    sectionNames,
    useMemberView,
    useSection,
} from "./dashboard-sections"
import type { SectionId, SectionProps } from "./dashboard-sections"
import { DraftScopeProvider, clearAllDrafts, clearServerDrafts, useDraftSections } from "./drafts"
import { DashboardTour, useDashboardTour } from "./dashboard-tour"

const SIDEBAR_STORAGE_KEY = "neonflux:sidebar-collapsed"
const SESSION_FRESH_MS = 5 * 60 * 1000
const TAB_RETURN_REVERIFY_MS = 60 * 1000

/** Where the dashboard is, read from the page address so every server and section has its own link.
 *  Single-server mode needs no server, and the overview is the section when none is named */
export interface DashboardLocation {
    server?: string | undefined
    section?: SectionId | undefined
}
export function dashboardSearch(search: Record<string, unknown>): DashboardLocation {
    return {
        server: typeof search.server === "string" && /^[1-9]\d{0,18}$/.test(search.server) ? search.server : undefined,
        section: isSectionId(search.section) && search.section !== "overview" ? search.section : undefined,
    }
}
export function dashboardHref(location: DashboardLocation): string {
    const query = new URLSearchParams()
    if (location.server) query.set("server", location.server)
    if (location.section && location.section !== "overview") query.set("section", location.section)
    const text = query.toString()
    return text ? `/?${text}` : "/"
}
interface Navigation {
    location?: DashboardLocation | undefined
    navigate?: ((location: DashboardLocation) => void) | undefined
}

function readSidebarCollapsed(): boolean {
    try {
        return typeof window !== "undefined" && window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1"
    } catch {
        return false
    }
}
function useShortcutLabel(): string {
    const [label, setLabel] = useState("Ctrl K")
    useEffect(() => {
        if (typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent))
            setLabel("Cmd K")
    }, [])
    return label
}

export function Dashboard({
    clientFactory,
    catalogClock,
    ...props
}: Navigation & {
    clientFactory?: ((url: string) => ConvexReactClient) | undefined
    catalogClock?: CatalogClock | undefined
}) {
    return (
        <SessionProvider>
            <DashboardSession clientFactory={clientFactory} catalogClock={catalogClock} {...props} />
        </SessionProvider>
    )
}
function SessionVerifyingCard({ message }: { message: string }) {
    return (
        <section className="panel status-card verifying-card" aria-busy="true">
            <div className="status-card-emblem">
                <BrandMark size="md" />
            </div>
            <p className="eyebrow">Session security check</p>
            <p role="status" className="verifying-label">
                {message}
            </p>
            <div className="verifying-skeleton" aria-hidden="true">
                <span className="skeleton-bar wide" />
                <span className="skeleton-bar medium" />
                <span className="skeleton-bar short" />
            </div>
        </section>
    )
}
function DashboardSession({
    location,
    navigate,
    clientFactory,
    catalogClock,
}: Navigation & {
    clientFactory?: ((url: string) => ConvexReactClient) | undefined
    catalogClock?: CatalogClock | undefined
}) {
    const session = useSession(),
        motion = useMotionPreference(),
        [logoutError, setLogoutError] = useState(""),
        [hadSession, setHadSession] = useState(false),
        [awaitingTabCheck, setAwaitingTabCheck] = useState(false)
    const hadSessionRef = useRef(false)
    const hiddenAtRef = useRef<number | undefined>(undefined)
    const checkBaselineRef = useRef(0)
    const updatedAtRef = useRef(0)
    updatedAtRef.current = session.dataUpdatedAt

    const staleSession = Boolean(
        session.data && session.dataUpdatedAt > 0 && Date.now() - session.dataUpdatedAt > SESSION_FRESH_MS,
    )
    const verifyingReturn = awaitingTabCheck || (staleSession && session.isFetching)
    const activeSession =
        session.data && !verifyingReturn && !(session.isError && staleSession) ? session.data : undefined
    const activeAccount = activeSession ? `${activeSession.user.id}:${activeSession.sessionToken}` : undefined
    const lastAccountRef = useRef<string | undefined>(activeAccount)
    const [readyAccount, setReadyAccount] = useState<string | undefined>(activeAccount)

    useEffect(() => {
        if (session.data) {
            hadSessionRef.current = true
            setHadSession(true)
        } else if (session.data === null) {
            lastAccountRef.current = undefined
            setReadyAccount(undefined)
            clearCatalogCache()
        }
    }, [session.data])

    useEffect(() => {
        if (!activeSession || !activeAccount) return
        if (lastAccountRef.current && lastAccountRef.current !== activeAccount) clearCatalogCache()
        else clearOtherCatalogCaches(activeSession.sessionToken)
        lastAccountRef.current = activeAccount
        if (readyAccount !== activeAccount) setReadyAccount(activeAccount)
    }, [activeSession, activeAccount, readyAccount])

    // Returning to a tab that was hidden or whose verification aged past 60s confirms live permissions before showing data
    useEffect(() => {
        if (typeof document === "undefined" || typeof window === "undefined") return
        let mounted = true
        const checkOnReturn = () => {
            const hiddenAt = hiddenAtRef.current
            if (hiddenAt === undefined || !hadSessionRef.current) return
            hiddenAtRef.current = undefined
            const now = Date.now()
            const sessionAge = updatedAtRef.current > 0 ? now - updatedAtRef.current : Infinity
            const hiddenFor = now - hiddenAt
            if (sessionAge < TAB_RETURN_REVERIFY_MS && hiddenFor < TAB_RETURN_REVERIFY_MS) return
            const token = ++checkBaselineRef.current
            setAwaitingTabCheck(true)
            void session.refetch().finally(() => {
                if (mounted && checkBaselineRef.current === token) setAwaitingTabCheck(false)
            })
        }
        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden") hiddenAtRef.current ??= Date.now()
            else checkOnReturn()
        }
        document.addEventListener("visibilitychange", onVisibilityChange)
        window.addEventListener("focus", checkOnReturn)
        return () => {
            mounted = false
            document.removeEventListener("visibilitychange", onVisibilityChange)
            window.removeEventListener("focus", checkOnReturn)
        }
    }, [session.refetch])

    return (
        <>
            <AmbientLava enabled={motion.enabled} />
            <div className="app">
                <AppHeader
                    userName={activeSession?.user.name}
                    motionEnabled={motion.enabled}
                    onToggleMotion={motion.toggle}
                    onSignOut={async () => {
                        try {
                            const response = await fetch("/api/session", { method: "DELETE" })
                            if (!response.ok) throw new Error()
                            clearAllDrafts()
                            clearCatalogCache()
                            window.location.assign("/")
                        } catch {
                            setLogoutError("Sign-out failed. Try again")
                        }
                    }}
                />
                <main className="app-main">
                    {logoutError && (
                        <p role="alert" className="notice error">
                            {logoutError}
                        </p>
                    )}
                    {session.isPending && <SessionVerifyingCard message="Checking sign-in…" />}
                    {!session.isPending && verifyingReturn && (
                        <SessionVerifyingCard message="Verifying your sign-in and permissions…" />
                    )}
                    {session.isError && !verifyingReturn && (
                        <div role="alert" className="notice error">
                            Unable to refresh your sign-in. Your drafts stay in this tab{" "}
                            <button className="secondary" onClick={() => void session.refetch()}>
                                Try again
                            </button>
                        </div>
                    )}
                    {session.data === null && !verifyingReturn && (
                        <>
                            {hadSession && (
                                <p className="notice status-banner" role="status">
                                    Your sign-in expired. Any unsaved drafts stay in this tab. Sign in again before
                                    saving
                                </p>
                            )}
                            <SignIn returnTo={dashboardHref(location ?? {})} />
                        </>
                    )}
                    {activeSession &&
                        (readyAccount === activeAccount ? (
                            <ManagedDashboard
                                session={activeSession}
                                accessAvailable={!session.isError}
                                refreshSession={() => void session.refetch()}
                                refreshingSession={session.isFetching}
                                clientFactory={clientFactory}
                                catalogClock={catalogClock}
                                location={location}
                                navigate={navigate}
                            />
                        ) : (
                            <SessionVerifyingCard message="Connecting to live settings…" />
                        ))}
                </main>
            </div>
        </>
    )
}
function AppHeader({
    userName,
    motionEnabled,
    onToggleMotion,
    onSignOut,
}: {
    userName?: string | undefined
    motionEnabled: boolean
    onToggleMotion: () => void
    onSignOut: () => void
}) {
    return (
        <header className="header">
            <div className="brand">
                <BrandMark size="sm" />
                <h1>
                    Neon<span className="brand-flux">Flux</span>
                </h1>
            </div>
            <div className="header-actions">
                <MotionToggle enabled={motionEnabled} onToggle={onToggleMotion} />
                {userName && (
                    <div className="account">
                        <span className="account-pill">
                            <span className="account-dot" aria-hidden="true" />
                            <span className="account-name">{userName}</span>
                        </span>
                        <button className="ghost-action" onClick={onSignOut}>
                            Sign out
                        </button>
                    </div>
                )}
            </div>
        </header>
    )
}
const memberFeatureNames: Record<DashboardMemberFeature, string> = {
    rolepicker: "Choose your roles",
    showcase: "Showcases",
    profile: "Your profile",
    voice: "Your voice room",
    private: "Private cases",
}
function MemberFeatureView({
    feature,
    client,
    sessionToken,
    serverId,
    connected,
    userId,
}: {
    feature: DashboardMemberFeature
    client: ConvexReactClient
    sessionToken: string
    serverId: string
    connected: boolean
    userId: string
}) {
    const { component: View, failed, retry } = useMemberView(feature)
    if (View)
        return (
            <View
                key={`${userId}:${serverId}:${feature}`}
                client={client}
                sessionToken={sessionToken}
                serverId={serverId}
                connected={connected}
            />
        )
    if (failed)
        return (
            <section className="panel">
                <p className="notice error" role="alert">
                    This member view could not be loaded. Check your connection{" "}
                    <button type="button" className="secondary" onClick={retry}>
                        Try again
                    </button>
                </p>
            </section>
        )
    return (
        <section className="panel">
            <p role="status">Loading {memberFeatureNames[feature].toLowerCase()}…</p>
        </section>
    )
}
export function ManagedDashboard({
    session,
    accessAvailable,
    clientFactory,
    catalogClock,
    ...props
}: {
    session: WebSession
    accessAvailable: boolean
    refreshSession: () => void
    refreshingSession: boolean
    clientFactory?: ((url: string) => ConvexReactClient) | undefined
    catalogClock?: CatalogClock | undefined
} & Navigation) {
    const client = useLiveClient(session.convexUrl, clientFactory)
    const account = `${session.user.id}:${session.sessionToken}`
    const [readyAccount, setReadyAccount] = useState(account)
    useEffect(() => {
        if (!client || readyAccount === account) return
        clearLiveQueryCache(client)
        clearCatalogCache()
        setReadyAccount(account)
    }, [client, account, readyAccount])
    return client && readyAccount === account ? (
        <ServerDashboard
            key={account}
            session={session}
            accessAvailable={accessAvailable}
            client={client}
            catalogClock={catalogClock}
            {...props}
        />
    ) : (
        <SessionVerifyingCard message="Connecting to live settings…" />
    )
}
export function ServerDashboard({
    session,
    accessAvailable,
    client,
    refreshSession,
    refreshingSession = false,
    catalogClock,
    location,
    navigate,
}: {
    session: WebSession
    accessAvailable: boolean
    client: ConvexReactClient
    refreshSession?: (() => void) | undefined
    refreshingSession?: boolean | undefined
    catalogClock?: CatalogClock | undefined
} & Navigation) {
    // Without a router, such as in tests, the location lives in component state
    const [localLocation, setLocalLocation] = useState<DashboardLocation>({})
    const here = navigate ? (location ?? {}) : localLocation,
        go = navigate ?? setLocalLocation
    const multi = session.mode === "multi",
        memberServers = session.memberServers ?? []
    const [menuOpen, setMenuOpen] = useState(false),
        [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed),
        [paletteOpen, setPaletteOpen] = useState(false),
        shortcutLabel = useShortcutLabel(),
        [confirmDiscardAll, setConfirmDiscardAll] = useState(false),
        [draftResetKey, setDraftResetKey] = useState(0),
        [sectionQuery, setSectionQuery] = useState(""),
        searchId = useId()
    const [connected, setConnected] = useState(client.connectionState().isWebSocketConnected)
    useEffect(() => client.subscribeToConnectionState((state) => setConnected(state.isWebSocketConnected)), [client])
    const requested = here.server ?? ""
    const serverId = session.servers.some((server) => server.id === requested)
        ? requested
        : multi
          ? ""
          : (session.servers[0]?.id ?? "")
    // A server the user only joined opens the member view, which renders no manager section
    const memberServerId = serverId
        ? ""
        : memberServers.some((server) => server.id === requested)
          ? requested
          : multi
            ? ""
            : (memberServers[0]?.id ?? "")
    const section: SectionId = here.section ?? "overview"
    const {
        catalog,
        loading: catalogLoading,
        error: catalogError,
        refresh: refreshCatalog,
        busy: catalogBusy,
        refreshing: catalogRefreshing,
        refreshed: catalogRefreshed,
    } = useCatalog(client, session.sessionToken, serverId, accessAvailable, catalogClock)
    const catalogRefresh = useMemo(
        () => ({ refresh: refreshCatalog, busy: catalogBusy, refreshing: catalogRefreshing }),
        [refreshCatalog, catalogBusy, catalogRefreshing],
    )
    // Coming back from the bot invitation reloads the server list once, and the open server's channels and roles once
    const markInvite = useInviteReturn(() => {
        refreshSession?.()
        refreshCatalog()
    })
    const drafts = useDraftSections(session.user.id, serverId)
    useEffect(() => {
        if (drafts.size === 0) setConfirmDiscardAll(false)
    }, [drafts.size, serverId])
    const draftScope = useMemo(
        () => ({ userId: session.user.id, serverId, section }),
        [session.user.id, serverId, section],
    )
    const { component: Section, failed: sectionFailed, retry: retrySection } = useSection(section)
    // A section chosen from the menu moves focus to the content, because the menu closes on small screens
    const content = useRef<HTMLDivElement>(null),
        focusContent = useRef(false)
    const tour = useDashboardTour(session.user.id)
    useEffect(() => {
        if (focusContent.current) {
            focusContent.current = false
            content.current?.focus()
        }
    }, [section])
    // Global Cmd+K / Ctrl+K shortcut opens the command palette whenever a server or switcher is available
    const paletteAvailable = Boolean(serverId || (multi && (session.servers.length > 0 || memberServers.length > 0)))
    useEffect(() => {
        if (!paletteAvailable || typeof window === "undefined") return
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault()
                setPaletteOpen((open) => !open)
            } else if (event.key === "Escape" && menuOpen) {
                setMenuOpen(false)
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [paletteAvailable, menuOpen])

    const toggleSidebar = useCallback(() => {
        setSidebarCollapsed((current) => {
            const next = !current
            try {
                window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0")
            } catch {}
            return next
        })
    }, [])

    const place = useCallback(
        (id: SectionId) => ({
            server: multi ? serverId : undefined,
            section: id === "overview" ? undefined : id,
        }),
        [multi, serverId],
    )
    const sectionHref = useCallback((id: SectionId) => dashboardHref(place(id)), [place])
    const openSection = useCallback(
        (id: SectionId) => {
            setMenuOpen(false)
            focusContent.current = true
            go(place(id))
        },
        [go, place],
    )
    const selectServer = useCallback(
        (id: string) => {
            setMenuOpen(false)
            go({ server: id })
        },
        [go],
    )
    const closePalette = useCallback(() => setPaletteOpen(false), [])
    const invite = multi ? session.inviteUrl : undefined
    const commandPalette = (
        <CommandPalette
            open={paletteOpen}
            onClose={closePalette}
            currentSection={serverId ? section : undefined}
            currentServerId={serverId || memberServerId || undefined}
            drafts={drafts}
            multi={multi}
            servers={session.servers}
            memberServers={memberServers}
            onSelectSection={openSection}
            onSelectServer={selectServer}
        />
    )
    if (!session.servers.length && !memberServers.length)
        return (
            <section className="panel status-card no-access-card">
                <div className="status-card-emblem">
                    <BrandMark size="lg" />
                </div>
                <p className="eyebrow">Server access</p>
                <h2>No manageable servers</h2>
                {invite ? (
                    <>
                        <p className="status-card-copy">
                            You need to own a server with NeonFlux, or have Manage community permission in it, to edit
                            its settings. After you add NeonFlux, the server appears here when you come back to this
                            tab, within a few minutes or when you reload
                        </p>
                        <div className="status-card-actions">
                            <a
                                className="button button-primary"
                                href={invite}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={markInvite}
                            >
                                Add NeonFlux to a server
                            </a>
                        </div>
                    </>
                ) : (
                    <p className="status-card-copy">
                        You need to own a configured NeonFlux server or have Manage community permission to edit its
                        settings
                    </p>
                )}
            </section>
        )
    if (memberServerId) {
        const server = memberServers.find((value) => value.id === memberServerId)!,
            live = connected && accessAvailable
        // The member view offers only the server's member features: the role picker, showcases, profiles, the voice room page and private cases, which the backend opens after a live check.
        // The first feature opens without a section in the link
        const shown = server.features.find((feature) => feature === section) ?? server.features[0]!
        const memberPlace = (id: SectionId) => ({
            server: multi ? memberServerId : undefined,
            section: id === server.features[0] ? undefined : id,
        })
        const memberHref = (id: SectionId) => dashboardHref(memberPlace(id)),
            openMember = (id: SectionId) => go(memberPlace(id))
        return (
            <div className="content">
                <div className="server-header">
                    <div className="server-identity">
                        <ServerIcon server={server} large />
                        <div className="server-title">
                            <p className="eyebrow">{memberFeatureNames[shown]}</p>
                            <h2>{server.name}</h2>
                        </div>
                        <span className={live ? "status-pill live" : "status-pill"}>
                            {live ? "Live" : connected ? "Read only" : "Offline"}
                        </span>
                    </div>
                    {multi && (
                        <div className="server-toolbar-actions">
                            <button
                                type="button"
                                className="search-trigger"
                                aria-label="Open command palette"
                                onClick={() => setPaletteOpen(true)}
                            >
                                <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                                    <circle cx="11" cy="11" r="7" />
                                    <path d="M20 20l-3.5-3.5" />
                                </svg>
                                <span className="search-trigger-label">Search</span>
                                <kbd className="search-trigger-key">{shortcutLabel}</kbd>
                            </button>
                            <div className="server-switch">
                                <button type="button" className="ghost-action" onClick={() => go({})}>
                                    Switch server
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                {server.features.length > 1 && (
                    <nav className="inline-field member-nav" aria-label="Member features">
                        {server.features.map((id) => (
                            <a
                                key={id}
                                {...sectionLink(id, memberHref, openMember)}
                                aria-current={id === shown ? "page" : undefined}
                            >
                                {memberFeatureNames[id]}
                            </a>
                        ))}
                    </nav>
                )}
                <MemberFeatureView
                    feature={shown}
                    client={client}
                    sessionToken={session.sessionToken}
                    serverId={memberServerId}
                    connected={live}
                    userId={session.user.id}
                />
                {commandPalette}
            </div>
        )
    }
    if (!serverId)
        return (
            <>
                {requested && (
                    <p className="notice" role="status">
                        The server in this link is not available to you. You need Manage community permission in it, and
                        NeonFlux must be in it
                    </p>
                )}
                <ServerPicker
                    servers={session.servers}
                    memberServers={memberServers}
                    inviteUrl={invite}
                    onInvite={markInvite}
                    onCheckServers={refreshSession}
                    checking={refreshingSession}
                    onSelect={selectServer}
                />
                {commandPalette}
            </>
        )
    const server = session.servers.find((value) => value.id === serverId)!
    const writable = connected && accessAvailable
    const props: SectionProps = {
        section,
        client,
        sessionToken: session.sessionToken,
        serverId,
        userId: session.user.id,
        connected: writable,
        catalog,
        catalogLoading,
        catalogError,
        refreshCatalog,
        multi,
        sectionHref,
        openSection,
    }
    const link = (id: SectionId, name: string) => (
        <a
            key={id}
            {...sectionLink(id, sectionHref, openSection)}
            aria-current={section === id ? "page" : undefined}
            title={sidebarCollapsed ? name : undefined}
        >
            <Icon path={sectionIcons[id]} />
            <span className="nav-name">{name}</span>
            {drafts.has(id) && (
                <span className="nav-draft" title="Unsaved draft">
                    <span className="visually-hidden">, unsaved draft</span>
                </span>
            )}
        </a>
    )
    // While the search field has text, matching sections replace the groups. The matches are the same links
    const found = sectionQuery.trim()
        ? fuzzyOptions(
              navigation.flatMap(([, items]) => items.map(([id, name]) => ({ id, name }))),
              sectionQuery,
          )
        : undefined
    const draftSectionIds = [...drafts].filter((id): id is SectionId => isSectionId(id))

    return (
        <CatalogRefreshProvider value={catalogRefresh}>
            <div className={`layout${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
                {menuOpen && <div className="drawer-backdrop" aria-hidden="true" onClick={() => setMenuOpen(false)} />}
                <aside className={`sidebar${menuOpen ? " drawer-open" : ""}`}>
                    <div className="sidebar-controls">
                        <button
                            type="button"
                            className="section-menu secondary"
                            aria-expanded={menuOpen}
                            aria-controls="configuration-navigation"
                            onClick={() => setMenuOpen((value) => !value)}
                        >
                            <span>{sectionNames[section]}</span>
                            <span className="section-menu-hint">Sections</span>
                        </button>
                        <span className="sidebar-rail-title">Sections</span>
                        <button
                            type="button"
                            className="sidebar-collapse"
                            aria-expanded={!sidebarCollapsed}
                            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                            onClick={toggleSidebar}
                        >
                            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                                <rect x="3" y="4" width="18" height="16" rx="2.5" />
                                <path d="M9 4v16" />
                            </svg>
                        </button>
                    </div>
                    <div className="drawer-header">
                        <span className="drawer-title">Sections</span>
                        <button
                            type="button"
                            className="secondary drawer-close"
                            aria-label="Close sections menu"
                            onClick={() => setMenuOpen(false)}
                        >
                            Close
                        </button>
                    </div>
                    <nav
                        id="configuration-navigation"
                        className={menuOpen ? "menu-open" : ""}
                        aria-label="Configuration sections"
                    >
                        <div className="section-search">
                            <label className="visually-hidden" htmlFor={`${searchId}-search`}>
                                Find a section
                            </label>
                            <input
                                id={`${searchId}-search`}
                                type="search"
                                autoComplete="off"
                                value={sectionQuery}
                                placeholder="Filter sections…"
                                onChange={(event) => setSectionQuery(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Escape") setSectionQuery("")
                                    else if (event.key === "Enter" && found?.[0]) openSection(found[0].id as SectionId)
                                }}
                            />
                            <p className="visually-hidden" role="status">
                                {found
                                    ? `${found.length} ${found.length === 1 ? "section matches" : "sections match"}`
                                    : ""}
                            </p>
                        </div>
                        {found ? (
                            <div className="nav-group">
                                {found.map(({ id, name }) => link(id as SectionId, name))}
                                {!found.length && <p className="muted nav-empty">No section matches</p>}
                            </div>
                        ) : (
                            <div className="nav-group">{link("overview", "Overview")}</div>
                        )}
                        {!found &&
                            navigation.map(([group, items]) => (
                                <div className="nav-group" key={group}>
                                    <p className="nav-heading">{group}</p>
                                    {items.map(([id, name]) => link(id, name))}
                                </div>
                            ))}
                    </nav>
                </aside>
                <div className={`content${drafts.size > 0 ? " has-draft-bar" : ""}`} ref={content} tabIndex={-1}>
                    <div className="server-header">
                        <div className="server-identity">
                            <ServerIcon server={server} />
                            <div className="server-title">
                                <h2>{server.name}</h2>
                            </div>
                            <span className={writable ? "status-pill live" : "status-pill"}>
                                {writable ? "Live" : connected ? "Read only" : "Offline"}
                            </span>
                        </div>
                        <div className="server-toolbar-actions">
                            <button
                                type="button"
                                className="search-trigger"
                                aria-label="Open command palette"
                                onClick={() => setPaletteOpen(true)}
                            >
                                <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                                    <circle cx="11" cy="11" r="7" />
                                    <path d="M20 20l-3.5-3.5" />
                                </svg>
                                <span className="search-trigger-label">Search</span>
                                <kbd className="search-trigger-key">{shortcutLabel}</kbd>
                            </button>
                            <button type="button" className="ghost-action" onClick={tour.start}>
                                Dashboard tour
                            </button>
                            {multi && (
                                <div className="server-switch">
                                    <button
                                        type="button"
                                        className="ghost-action"
                                        onClick={() => {
                                            setMenuOpen(false)
                                            go({})
                                        }}
                                    >
                                        Switch server
                                    </button>
                                    {drafts.size > 0 && (
                                        <span className="field-help">
                                            {drafts.size === 1
                                                ? "1 section of this server has"
                                                : `${drafts.size} sections of this server have`}{" "}
                                            unsaved drafts. They stay in this tab until you save or discard them
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    {catalogError && (
                        <p className="notice error" role="alert">
                            {catalog
                                ? "Channel and role choices could not be refreshed. The lists loaded earlier are still shown, and you can enter an exact ID"
                                : "Channel and role choices could not be loaded. Existing selections are kept. You can enter an exact ID while choices are unavailable"}{" "}
                            <button type="button" className="secondary" disabled={catalogBusy} onClick={refreshCatalog}>
                                {catalogRefreshing ? "Retrying…" : "Retry choices"}
                            </button>
                        </p>
                    )}
                    <p className="visually-hidden" role="status">
                        {catalogRefreshed ? "Channel and role lists refreshed" : ""}
                    </p>
                    {!connected && (
                        <p className="notice" role="status">
                            Offline. Your draft has been kept. Saving will be available when the live connection returns
                        </p>
                    )}
                    {tour.open && (
                        <DashboardTour
                            onClose={() => {
                                tour.close()
                                content.current?.focus()
                            }}
                        />
                    )}
                    <DraftScopeProvider value={draftScope}>
                        {Section ? (
                            <div
                                className="section-content"
                                key={`${session.user.id}:${serverId}:${section}:${draftResetKey}`}
                            >
                                <Section {...props} />
                            </div>
                        ) : sectionFailed ? (
                            <section className="panel">
                                <p className="notice error" role="alert">
                                    This section could not be loaded. Check your connection{" "}
                                    <button type="button" className="secondary" onClick={retrySection}>
                                        Try again
                                    </button>
                                </p>
                            </section>
                        ) : (
                            <section className="panel">
                                <p role="status">Loading {sectionNames[section].toLowerCase()}…</p>
                            </section>
                        )}
                    </DraftScopeProvider>
                </div>
            </div>
            {drafts.size > 0 && (
                <aside className="floating-draft-bar" aria-label="Unsaved drafts">
                    <div className="floating-draft-summary">
                        <span className="floating-draft-dot" aria-hidden="true" />
                        <span>
                            {drafts.size === 1 ? "1 unsaved draft section" : `${drafts.size} unsaved draft sections`}
                        </span>
                    </div>
                    <div className="floating-draft-links">
                        {draftSectionIds.slice(0, 4).map((id) => (
                            <button
                                key={id}
                                type="button"
                                className={`secondary floating-draft-chip${id === section ? " is-active" : ""}`}
                                onClick={() => openSection(id)}
                            >
                                {sectionNames[id]}
                            </button>
                        ))}
                        {draftSectionIds.length > 4 && (
                            <span className="muted floating-draft-more">+{draftSectionIds.length - 4} more</span>
                        )}
                    </div>
                    <div className="floating-draft-actions">
                        {confirmDiscardAll ? (
                            <>
                                <button
                                    type="button"
                                    className="danger-button"
                                    onClick={() => {
                                        clearServerDrafts(session.user.id, serverId)
                                        setConfirmDiscardAll(false)
                                        setDraftResetKey((value) => value + 1)
                                    }}
                                >
                                    Confirm discard all
                                </button>
                                <button type="button" className="secondary" onClick={() => setConfirmDiscardAll(false)}>
                                    Cancel
                                </button>
                            </>
                        ) : (
                            <button type="button" className="secondary" onClick={() => setConfirmDiscardAll(true)}>
                                Discard all drafts
                            </button>
                        )}
                    </div>
                </aside>
            )}
            {commandPalette}
        </CatalogRefreshProvider>
    )
}
