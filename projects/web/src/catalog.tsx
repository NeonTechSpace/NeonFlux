import type { ConvexReactClient } from 'convex/react'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { DashboardCatalog } from '@neonflux/backend/dashboard-contracts'
import { dashboardApi } from './dashboard-api'

// Each catalog call reads the server from Fluxer with the manager's sign-in, so refreshes wait at least this long after the previous call
export const CATALOG_REFRESH_MS = 10000
export interface CatalogRefresh { refresh: () => void, busy: boolean, refreshing: boolean }
export interface CatalogState extends CatalogRefresh { catalog?: DashboardCatalog, loading: boolean, error: boolean, refreshed: boolean }
export interface CatalogClock { now: () => number, setTimeout: (run: () => void, ms: number) => unknown, clearTimeout: (timer: unknown) => void }
const systemClock: CatalogClock = { now: () => Date.now(), setTimeout: (run,ms) => setTimeout(run,ms), clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>) }

/** The server's channels and roles, loaded once when a server opens. They never poll. refresh asks again on request: One call per
 *  request, and a request during the wait after the previous call runs once when the wait ends instead of being dropped */
export function useCatalog(client: ConvexReactClient, sessionToken: string, serverId: string, accessAvailable: boolean, clock: CatalogClock = systemClock): CatalogState {
  const [state,setState] = useState<{ serverId: string, catalog?: DashboardCatalog, loading: boolean, refreshing: boolean, error: boolean, refreshed: boolean, waiting: boolean }>({ serverId: '',loading: false,refreshing: false,error: false,refreshed: false,waiting: false })
  const call = useRef<{ serverId: string, id: number, startedAt: number, inFlight: boolean }>({ serverId: '',id: 0,startedAt: -Infinity,inFlight: false })
  const timer = useRef<unknown>(undefined)
  const scope = useRef({ client,sessionToken,serverId,accessAvailable })
  scope.current = { client,sessionToken,serverId,accessAvailable }
  const load = useCallback((refresh: boolean) => {
    const { client,sessionToken,serverId } = scope.current
    const id = call.current.id + 1
    call.current = { serverId,id,startedAt: clock.now(),inFlight: true }
    setState(current => current.serverId === serverId ? { ...current,loading: !current.catalog,refreshing: refresh,refreshed: false,waiting: false } : { serverId,loading: true,refreshing: false,error: false,refreshed: false,waiting: false })
    void client.action(dashboardApi.catalog,{ sessionToken,serverId }).then(result => {
      if (call.current.id !== id) return
      call.current.inFlight = false
      setState({ serverId,catalog: result,loading: false,refreshing: false,error: false,refreshed: refresh,waiting: false })
    },() => {
      if (call.current.id !== id) return
      call.current.inFlight = false
      setState(current => ({ ...current,loading: false,refreshing: false,error: true,refreshed: false }))
    })
  },[clock])
  useEffect(() => {
    clock.clearTimeout(timer.current); timer.current = undefined
    // A new server starts empty. Losing access keeps the loaded lists without asking Fluxer again
    if (call.current.serverId !== serverId) { call.current = { serverId,id: call.current.id + 1,startedAt: -Infinity,inFlight: false }; setState({ serverId,loading: Boolean(serverId && accessAvailable),refreshing: false,error: false,refreshed: false,waiting: false }) }
    if (!serverId || !accessAvailable || call.current.startedAt !== -Infinity) return
    load(false)
  },[client,sessionToken,serverId,accessAvailable,load,clock])
  useEffect(() => () => clock.clearTimeout(timer.current),[clock])
  const refresh = useCallback(() => {
    const { serverId,accessAvailable } = scope.current
    if (!serverId || !accessAvailable || call.current.serverId !== serverId || call.current.inFlight || timer.current !== undefined) return
    const wait = call.current.startedAt + CATALOG_REFRESH_MS - clock.now()
    if (wait <= 0) { load(true); return }
    setState(current => ({ ...current,waiting: true }))
    timer.current = clock.setTimeout(() => { timer.current = undefined; if (scope.current.serverId === serverId && scope.current.accessAvailable) load(true); else setState(current => ({ ...current,waiting: false })) },wait)
  },[load,clock])
  const current = state.serverId === serverId ? state : undefined
  return { catalog: current?.catalog,loading: current?.loading ?? Boolean(serverId && accessAvailable),error: current?.error ?? false,refreshing: Boolean(current?.refreshing || current?.waiting),refreshed: current?.refreshed ?? false,busy: Boolean(current?.loading || current?.refreshing || current?.waiting),refresh }
}

const CatalogRefreshContext = createContext<CatalogRefresh | undefined>(undefined)
export const CatalogRefreshProvider = CatalogRefreshContext.Provider
export const useCatalogRefresh = () => useContext(CatalogRefreshContext)

/** Calls back once when the person comes back to this tab after opening the bot invitation in another tab */
export function useInviteReturn(onReturn: () => void) {
  const pending = useRef(false), callback = useRef(onReturn)
  callback.current = onReturn
  useEffect(() => {
    const back = () => { if (pending.current && document.visibilityState !== 'hidden') { pending.current = false; callback.current() } }
    document.addEventListener('visibilitychange',back)
    window.addEventListener('focus',back)
    return () => { document.removeEventListener('visibilitychange',back); window.removeEventListener('focus',back) }
  },[])
  return useCallback(() => { pending.current = true },[])
}
