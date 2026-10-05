import { useEffect, useState } from 'react'
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
export function useConfigurationState(client: ConvexReactClient, sessionToken: string, serverId: string, family: DashboardConfigurationFamily, active = true) {
  const [remote,setRemote] = useState<DashboardConfigurationSnapshot>(), [error,setError] = useState(false)
  const [counts,setCounts] = useState<Partial<Record<DashboardConfigurationCollection,number>>>({}), [loadingPage,setLoadingPage] = useState(false)
  const key = JSON.stringify(counts)
  useEffect(() => { setRemote(undefined); setError(false); setCounts({}); setLoadingPage(false) },[serverId,family])
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
        const all = [first],nextCursors: DashboardConfigurationCursors = { ...first.nextCursors }
        for (const collection of Object.keys(counts) as DashboardConfigurationCollection[]) {
          let previous = first
          for (let depth = 0;depth < counts[collection]!;depth++) {
            const cursor = previous.nextCursors?.[collection]
            if (!cursor) { delete nextCursors[collection];break }
            const result = read({ [collection]: cursor },used)
            if (!result || result.configRevision !== first.configRevision) { setLoadingPage(true);return }
            all.push(result)
            previous = result
            if (result.nextCursors?.[collection]) nextCursors[collection] = result.nextCursors[collection]
            else delete nextCursors[collection]
          }
        }
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
    setCounts(current => ({ ...current,[collection]: (current[collection] ?? 0) + 1 }))
  }
  return { remote,error,loadingPage,loadPage }
}
