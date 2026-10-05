import type { DashboardConfigurationSnapshot } from '@neonflux/backend/dashboard-contracts'

function retained<T>(current: T[],previous: T[],identity: (row: T) => string) {
  const ids = new Set(current.map(identity)),removed = previous.filter(row => !ids.has(identity(row)))
  return { rows: [...current,...removed],missing: removed.map(identity) }
}
export function preserveRemovedDefinitions(current: DashboardConfigurationSnapshot,previous?: DashboardConfigurationSnapshot): { view: DashboardConfigurationSnapshot,missing: string[] } {
  if (!previous || current.serverId !== previous.serverId || current.family !== previous.family) return { view: current,missing: [] }
  switch (current.family) {
    case 'responses': {
      if (previous.family !== 'responses') break
      const result = retained(current.data.definitions,previous.data.definitions,row => `${row.kind}:${row.name}`)
      return { view: { ...current,data: { ...current.data,definitions: result.rows } },missing: result.missing }
    }
    case 'moderation': {
      if (previous.family !== 'moderation') break
      const rules = retained(current.data.rules,previous.data.rules,row => `rule:${row.name}`),watchlist = retained(current.data.watchlist,previous.data.watchlist,row => `watchlist:${row.userId}`)
      return { view: { ...current,data: { ...current.data,rules: rules.rows,watchlist: watchlist.rows } },missing: [...rules.missing,...watchlist.missing] }
    }
    case 'publishing': {
      if (previous.family !== 'publishing') break
      const result = retained(current.data.drafts,previous.data.drafts,row => `${row.kind}:${row.name}`)
      return { view: { ...current,data: { ...current.data,drafts: result.rows } },missing: result.missing }
    }
    case 'tickets': {
      if (previous.family !== 'tickets') break
      const result = retained(current.data.categories,previous.data.categories,row => row.name)
      return { view: { ...current,data: { ...current.data,categories: result.rows } },missing: result.missing }
    }
    case 'milestones': {
      if (previous.family !== 'milestones') break
      const result = retained(current.data.routes,previous.data.routes,row => row.kind)
      return { view: { ...current,data: { ...current.data,routes: result.rows } },missing: result.missing }
    }
    case 'cleanup': {
      if (previous.family !== 'cleanup') break
      const result = retained(current.data.policies,previous.data.policies,row => row.channelId)
      return { view: { ...current,data: { ...current.data,policies: result.rows } },missing: result.missing }
    }
    case 'events': {
      if (previous.family !== 'events') break
      const result = retained(current.data.events,previous.data.events,row => String(row.eventNo))
      return { view: { ...current,data: { ...current.data,events: result.rows } },missing: result.missing }
    }
    case 'schedules': {
      if (previous.family !== 'schedules') break
      const result = retained(current.data.schedules,previous.data.schedules,row => String(row.scheduleNo))
      return { view: { ...current,data: { ...current.data,schedules: result.rows } },missing: result.missing }
    }
  }
  return { view: current,missing: [] }
}
