import type { ConvexReactClient } from "convex/react"
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import type { DashboardCatalog } from "@neonflux/backend/dashboard-contracts"
import { dashboardApi } from "./dashboard-api"

// Each catalog call reads the server from Fluxer with the manager's sign-in, so refreshes wait at least this long after the previous call
export const CATALOG_REFRESH_MS = 10000
// Fresh cached catalogs satisfy section/server switches with zero Convex calls; older ones serve stale-while-revalidate
export const CATALOG_FRESH_MS = 2 * 60 * 1000
export const CATALOG_CACHE_TTL_MS = 30 * 60 * 1000
const CATALOG_CACHE_PREFIX = "neonflux.catalog.v1:"
const MAX_CACHED_CATALOGS = 10
const MAX_CATALOG_BYTES = 200_000

interface CatalogRefresh {
    refresh: () => void
    busy: boolean
    refreshing: boolean
}
interface CatalogState extends CatalogRefresh {
    catalog?: DashboardCatalog | undefined
    loading: boolean
    error: boolean
    refreshed: boolean
}
export interface CatalogClock {
    now: () => number
    setTimeout: (run: () => void, ms: number) => unknown
    clearTimeout: (timer: unknown) => void
}
const systemClock: CatalogClock = {
    now: () => Date.now(),
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}

// Deduplicates simultaneous catalog actions for the same client, session and server
const inFlightCatalogs = new WeakMap<ConvexReactClient, Map<string, Promise<DashboardCatalog>>>()

function fetchCatalogDeduped(
    client: ConvexReactClient,
    sessionToken: string,
    serverId: string,
    bypassInFlight: boolean,
): Promise<DashboardCatalog> {
    const key = `${catalogCacheGeneration}:${sessionFingerprint(sessionToken)}:${serverId}`
    let map = inFlightCatalogs.get(client)
    if (!map) {
        map = new Map()
        inFlightCatalogs.set(client, map)
    }
    const existing = !bypassInFlight ? map.get(key) : undefined
    if (existing) return existing
    const pending = client.action(dashboardApi.catalog, { sessionToken, serverId }).finally(() => {
        if (map?.get(key) === pending) map.delete(key)
    })
    map.set(key, pending)
    return pending
}

function catalogStorage(): Storage | undefined {
    try {
        return typeof window === "undefined" ? undefined : window.sessionStorage
    } catch {
        return undefined
    }
}
// Synchronous FNV-1a 64-bit fingerprint so sessionStorage keys isolate sessions without writing raw session tokens
function sessionFingerprint(sessionToken: string): string {
    let hash = 0xcbf29ce484222325n
    const prime = 0x100000001b3n
    const mask = 0xffffffffffffffffn
    for (let index = 0; index < sessionToken.length; index++) {
        hash ^= BigInt(sessionToken.charCodeAt(index))
        hash = (hash * prime) & mask
    }
    return hash.toString(16).padStart(16, "0")
}
const cacheKey = (sessionToken: string, serverId: string) =>
    `${CATALOG_CACHE_PREFIX}${sessionFingerprint(sessionToken)}:${serverId}`

function validCatalog(value: unknown, serverId: string): value is DashboardCatalog {
    if (!value || typeof value !== "object") return false
    const record = value as Partial<DashboardCatalog>
    return record.serverId === serverId && Array.isArray(record.channels) && Array.isArray(record.roles)
}
interface CachedCatalogEntry {
    catalog: DashboardCatalog
    at: number
    fresh: boolean
}
function readCachedCatalog(sessionToken: string, serverId: string, now: number): CachedCatalogEntry | undefined {
    const store = catalogStorage()
    if (!store || !sessionToken || !serverId) return undefined
    const key = cacheKey(sessionToken, serverId)
    try {
        const raw = store.getItem(key)
        if (!raw) return undefined
        const parsed = JSON.parse(raw) as { at?: unknown; catalog?: unknown }
        if (typeof parsed.at !== "number" || !Number.isFinite(parsed.at) || now - parsed.at > CATALOG_CACHE_TTL_MS) {
            store.removeItem(key)
            return undefined
        }
        if (!validCatalog(parsed.catalog, serverId)) {
            store.removeItem(key)
            return undefined
        }
        return {
            catalog: parsed.catalog,
            at: parsed.at,
            fresh: now - parsed.at < CATALOG_FRESH_MS,
        }
    } catch {
        try {
            store.removeItem(key)
        } catch {}
        return undefined
    }
}
function writeCachedCatalog(sessionToken: string, serverId: string, catalog: DashboardCatalog, now: number): void {
    const store = catalogStorage()
    if (!store || !sessionToken || !serverId) return
    const key = cacheKey(sessionToken, serverId)
    const raw = JSON.stringify({ at: now, catalog })
    if (raw.length > MAX_CATALOG_BYTES) {
        try {
            store.removeItem(key)
        } catch {}
        return
    }
    try {
        store.setItem(key, raw)
        const stored: Array<{ key: string; at: number }> = []
        for (let index = 0; index < store.length; index++) {
            const candidate = store.key(index)
            if (!candidate?.startsWith(CATALOG_CACHE_PREFIX)) continue
            let at = 0
            try {
                const parsed = JSON.parse(store.getItem(candidate) ?? "{}") as { at?: unknown }
                if (typeof parsed.at === "number" && Number.isFinite(parsed.at)) at = parsed.at
            } catch {}
            stored.push({ key: candidate, at })
        }
        stored.sort((a, b) => b.at - a.at)
        for (const stale of stored.slice(MAX_CACHED_CATALOGS)) store.removeItem(stale.key)
    } catch {
        try {
            store.removeItem(key)
        } catch {}
    }
}
// Incremented on clearCatalogCache() so late in-flight responses from a previous session never repopulate cleared storage
let catalogCacheGeneration = 0

/** Removes all cached channel and role catalogs from this tab's sessionStorage, called at sign-out */
export function clearCatalogCache(): void {
    catalogCacheGeneration += 1
    const store = catalogStorage()
    if (!store) return
    const keys: string[] = []
    for (let index = 0; index < store.length; index++) {
        const key = store.key(index)
        if (key?.startsWith(CATALOG_CACHE_PREFIX)) keys.push(key)
    }
    for (const key of keys) store.removeItem(key)
}

/** Removes cached catalogs belonging to any other session from this tab's sessionStorage */
export function clearOtherCatalogCaches(sessionToken: string): void {
    const store = catalogStorage()
    if (!store || !sessionToken) return
    const keepPrefix = `${CATALOG_CACHE_PREFIX}${sessionFingerprint(sessionToken)}:`
    const keys: string[] = []
    for (let index = 0; index < store.length; index++) {
        const key = store.key(index)
        if (key?.startsWith(CATALOG_CACHE_PREFIX) && !key.startsWith(keepPrefix)) keys.push(key)
    }
    for (const key of keys) store.removeItem(key)
}

/** The server's channels and roles, served from sessionStorage with a fresh short-TTL hit (zero backend call) and
 *  stale-while-revalidate when older. They never poll. Manual refresh bypasses the cache and makes one call on request,
 *  waiting if called again within CATALOG_REFRESH_MS */
export function useCatalog(
    client: ConvexReactClient,
    sessionToken: string,
    serverId: string,
    accessAvailable: boolean,
    clock: CatalogClock = systemClock,
): CatalogState {
    const [state, setState] = useState<{
        serverId: string
        sessionToken: string
        catalog?: DashboardCatalog | undefined
        loading: boolean
        refreshing: boolean
        error: boolean
        refreshed: boolean
        waiting: boolean
    }>({
        serverId: "",
        sessionToken: "",
        loading: false,
        refreshing: false,
        error: false,
        refreshed: false,
        waiting: false,
    })
    const call = useRef<{ serverId: string; sessionToken: string; id: number; startedAt: number; inFlight: boolean }>({
        serverId: "",
        sessionToken: "",
        id: 0,
        startedAt: -Infinity,
        inFlight: false,
    })
    const timer = useRef<unknown>(undefined)
    const scope = useRef({ client, sessionToken, serverId, accessAvailable })
    scope.current = { client, sessionToken, serverId, accessAvailable }
    const load = useCallback(
        (refresh: boolean) => {
            const { client, sessionToken, serverId } = scope.current
            const id = call.current.id + 1
            const clearGeneration = catalogCacheGeneration
            call.current = { serverId, sessionToken, id, startedAt: clock.now(), inFlight: true }
            setState((current) =>
                current.serverId === serverId && current.sessionToken === sessionToken
                    ? { ...current, loading: !current.catalog, refreshing: refresh, refreshed: false, waiting: false }
                    : {
                          serverId,
                          sessionToken,
                          loading: true,
                          refreshing: false,
                          error: false,
                          refreshed: false,
                          waiting: false,
                      },
            )
            void fetchCatalogDeduped(client, sessionToken, serverId, refresh).then(
                (result) => {
                    if (call.current.id !== id) return
                    call.current.inFlight = false
                    if (catalogCacheGeneration !== clearGeneration) {
                        setState((current) =>
                            current.serverId === serverId && current.sessionToken === sessionToken
                                ? { ...current, loading: false, refreshing: false }
                                : current,
                        )
                        return
                    }
                    writeCachedCatalog(sessionToken, serverId, result, clock.now())
                    setState({
                        serverId,
                        sessionToken,
                        catalog: result,
                        loading: false,
                        refreshing: false,
                        error: false,
                        refreshed: refresh,
                        waiting: false,
                    })
                },
                () => {
                    if (call.current.id !== id) return
                    call.current.inFlight = false
                    if (catalogCacheGeneration !== clearGeneration) {
                        setState((current) =>
                            current.serverId === serverId && current.sessionToken === sessionToken
                                ? { ...current, loading: false, refreshing: false }
                                : current,
                        )
                        return
                    }
                    setState((current) => ({
                        ...current,
                        loading: false,
                        refreshing: false,
                        error: true,
                        refreshed: false,
                    }))
                },
            )
        },
        [clock],
    )
    useEffect(() => {
        clock.clearTimeout(timer.current)
        timer.current = undefined
        let freshHit = false
        // A new server or session checks sessionStorage first: fresh hits skip Convex, stale hits revalidate once
        if (call.current.serverId !== serverId || call.current.sessionToken !== sessionToken) {
            const cached =
                serverId && accessAvailable ? readCachedCatalog(sessionToken, serverId, clock.now()) : undefined
            freshHit = Boolean(cached?.fresh)
            call.current = {
                serverId,
                sessionToken,
                id: call.current.id + 1,
                startedAt: freshHit && cached ? cached.at : -Infinity,
                inFlight: false,
            }
            setState({
                serverId,
                sessionToken,
                catalog: cached?.catalog,
                loading: Boolean(serverId && accessAvailable && !cached),
                refreshing: false,
                error: false,
                refreshed: false,
                waiting: false,
            })
        }
        if (!serverId || !accessAvailable || freshHit || call.current.startedAt !== -Infinity) return
        load(false)
    }, [client, sessionToken, serverId, accessAvailable, load, clock])
    useEffect(() => () => clock.clearTimeout(timer.current), [clock])
    const refresh = useCallback(() => {
        const { sessionToken, serverId, accessAvailable } = scope.current
        if (
            !serverId ||
            !accessAvailable ||
            call.current.serverId !== serverId ||
            call.current.sessionToken !== sessionToken ||
            call.current.inFlight ||
            timer.current !== undefined
        )
            return
        const wait = call.current.startedAt + CATALOG_REFRESH_MS - clock.now()
        if (wait <= 0) {
            load(true)
            return
        }
        setState((current) => ({ ...current, waiting: true }))
        timer.current = clock.setTimeout(() => {
            timer.current = undefined
            if (
                scope.current.serverId === serverId &&
                scope.current.sessionToken === sessionToken &&
                scope.current.accessAvailable
            )
                load(true)
            else setState((current) => ({ ...current, waiting: false }))
        }, wait)
    }, [load, clock])
    const current = state.serverId === serverId && state.sessionToken === sessionToken ? state : undefined
    return {
        catalog: current?.catalog,
        loading: current?.loading ?? Boolean(serverId && accessAvailable),
        error: current?.error ?? false,
        refreshing: Boolean(current?.refreshing || current?.waiting),
        refreshed: current?.refreshed ?? false,
        busy: Boolean(current?.loading || current?.refreshing || current?.waiting),
        refresh,
    }
}

const CatalogRefreshContext = createContext<CatalogRefresh | undefined>(undefined)
export const CatalogRefreshProvider = CatalogRefreshContext.Provider
export const useCatalogRefresh = () => useContext(CatalogRefreshContext)

/** Calls back once when the person comes back to this tab after opening the bot invitation in another tab */
export function useInviteReturn(onReturn: () => void) {
    const pending = useRef(false),
        callback = useRef(onReturn)
    callback.current = onReturn
    useEffect(() => {
        const back = () => {
            if (pending.current && document.visibilityState !== "hidden") {
                pending.current = false
                callback.current()
            }
        }
        document.addEventListener("visibilitychange", back)
        window.addEventListener("focus", back)
        return () => {
            document.removeEventListener("visibilitychange", back)
            window.removeEventListener("focus", back)
        }
    }, [])
    return useCallback(() => {
        pending.current = true
    }, [])
}
