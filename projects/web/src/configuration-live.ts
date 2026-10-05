import { useEffect, useRef, useState } from 'react'
import type { ConvexReactClient } from 'convex/react'
import type { DashboardConfigurationCollection, DashboardConfigurationCursors, DashboardConfigurationFamily, DashboardConfigurationSnapshot } from '@neonflux/backend/dashboard-contracts'
import { dashboardApi } from './dashboard-api'

function unique<T>(rows: T[], key: (row: T) => string): T[] { return [...new Map(rows.map(row => [key(row),row])).values()] }
function mergePages(first: DashboardConfigurationSnapshot, all: DashboardConfigurationSnapshot[]): DashboardConfigurationSnapshot {
  switch (first.family) {
    case 'responses': return { ...first,data: { ...first.data,definitions: unique(all.flatMap(page => page.family === 'responses' ? page.data.definitions : []),row => `${row.kind}:${row.name}`) } }
    case 'moderation': return { ...first,data: { ...first.data,rules: unique(all.flatMap(page => page.family === 'moderation' ? page.data.rules : []),row => row.name),watchlist: unique(all.flatMap(page => page.family === 'moderation' ? page.data.watchlist : []),row => row.userId) } }
    case 'publishing': return { ...first,data: { ...first.data,drafts: unique(all.flatMap(page => page.family === 'publishing' ? page.data.drafts : []),row => `${row.kind}:${row.name}`) } }
    case 'tickets': return { ...first,data: { ...first.data,categories: unique(all.flatMap(page => page.family === 'tickets' ? page.data.categories : []),row => row.name) } }
    case 'milestones': return { ...first,data: { ...first.data,routes: unique(all.flatMap(page => page.family === 'milestones' ? page.data.routes : []),row => row.kind) } }
    case 'cleanup': return { ...first,data: { ...first.data,policies: unique(all.flatMap(page => page.family === 'cleanup' ? page.data.policies : []),row => row.channelId) } }
    case 'events': return { ...first,data: { ...first.data,events: unique(all.flatMap(page => page.family === 'events' ? page.data.events : []),row => String(row.eventNo)) } }
    case 'schedules': return { ...first,data: { ...first.data,schedules: unique(all.flatMap(page => page.family === 'schedules' ? page.data.schedules : []),row => String(row.scheduleNo)) } }
    default: return first
  }
}
/** The most later pages of one collection that stay loaded and live beside the first page. Loading another drops the earliest of them */
export const PAGE_WINDOW = 4
// A collection's loaded later pages: from is the cursor of the earliest one, or undefined when they follow the first page
type PageWindow = { from?: string | undefined, pages: number }
export function useConfigurationState(client: ConvexReactClient, sessionToken: string, serverId: string, family: DashboardConfigurationFamily, active = true) {
  const [remote,setRemote] = useState<DashboardConfigurationSnapshot>(), [error,setError] = useState(false)
  const [windows,setWindows] = useState<Partial<Record<DashboardConfigurationCollection,PageWindow>>>({}), [loadingPage,setLoadingPage] = useState(false)
  // The cursor of each loaded later page, so the window can move one page on
  const chains = useRef<Partial<Record<DashboardConfigurationCollection,string[]>>>({})
  const key = JSON.stringify(windows)
  useEffect(() => { setRemote(undefined); setError(false); setWindows({}); setLoadingPage(false) },[serverId,family])
  useEffect(() => {
    if (!active) return
    let disposed = false,pending = false
    const subscriptions = new Map<string,{ watch: ReturnType<ConvexReactClient['watchQuery']>,unsubscribe?: () => void }>()
    function schedule() { if (!disposed && !pending) { pending = true;queueMicrotask(() => { pending = false;if (!disposed) update() }) } }
    function read(cursors: DashboardConfigurationCursors,used: Set<string>) {
      const id = JSON.stringify(cursors)
      used.add(id)
      let subscription = subscriptions.get(id)
      if (!subscription) {
        const watch = client.watchQuery(dashboardApi.configurationSnapshot,{ sessionToken,serverId,family,...(Object.keys(cursors).length ? { cursors } : {}) })
        subscription = { watch }
        subscriptions.set(id,subscription)
        subscription.unsubscribe = watch.onUpdate(schedule)
      }
      const result = subscription.watch.localQueryResult() as DashboardConfigurationSnapshot | undefined
      if (result && (result.family !== family || result.serverId !== serverId)) throw new Error('Configuration scope changed')
      return result
    }
    function update() {
      try {
        const used = new Set<string>(),first = read({},used)
        if (!first) return
        const all = [first],nextCursors: DashboardConfigurationCursors = { ...first.nextCursors },cursors: typeof chains.current = {}
        for (const collection of Object.keys(windows) as DashboardConfigurationCollection[]) {
          const window = windows[collection]!, chain: string[] = cursors[collection] = []
          let cursor = window.from ?? first.nextCursors?.[collection]
          for (let depth = 0;depth < window.pages;depth++) {
            if (!cursor) { delete nextCursors[collection];break }
            const result = read({ [collection]: cursor },used)
            if (!result || result.configRevision !== first.configRevision) { setLoadingPage(true);return }
            all.push(result)
            chain.push(cursor)
            cursor = result.nextCursors?.[collection]
            if (cursor) nextCursors[collection] = cursor
            else delete nextCursors[collection]
          }
        }
        chains.current = cursors
        for (const [id,subscription] of subscriptions) if (!used.has(id)) { subscription.unsubscribe?.();subscriptions.delete(id) }
        setRemote({ ...mergePages(first,all),nextCursors })
        setLoadingPage(false);setError(false)
      } catch { setError(true);setLoadingPage(false) }
    }
    update()
    return () => { disposed = true;subscriptions.forEach(subscription => subscription.unsubscribe?.()) }
  },[client,sessionToken,serverId,family,active,key])
  function loadPage(collection: DashboardConfigurationCollection, cursor?: string) {
    if (!cursor || loadingPage || cursor !== remote?.nextCursors?.[collection]) return
    setLoadingPage(true)
    setWindows(current => {
      const window = current[collection] ?? { pages: 0 }
      // A full window moves on by one page, so loaded pages, and their live queries, stay bounded
      return { ...current,[collection]: window.pages < PAGE_WINDOW ? { ...window,pages: window.pages + 1 } : { from: chains.current[collection]?.[1] ?? cursor,pages: window.pages } }
    })
  }
  /** Shows a collection from its first page again */
  function firstPages(collection: DashboardConfigurationCollection) { setWindows(({ [collection]: _,...rest }) => rest) }
  // Collections whose earlier later pages were dropped from the window
  const skipped = (Object.keys(windows) as DashboardConfigurationCollection[]).filter(collection => windows[collection]?.from !== undefined)
  // start changes only when a window moves or returns to the first page, which removes rows on purpose
  return { remote,error,loadingPage,loadPage,skipped,firstPages,start: JSON.stringify(skipped.map(collection => [collection,windows[collection]!.from])) }
}
