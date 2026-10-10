import type { ConvexReactClient } from 'convex/react'
import type { ComponentType } from 'react'
import { useEffect, useState } from 'react'
import type { DashboardCatalog } from '@neonflux/backend/dashboard-contracts'

export const sectionIds = ['overview','general','custom','auto','moderation','cleanup','logs','reaction','autorole','verification','rolepicker','messages','publishing','greetings','schedules','tickets','leveling','milestones','suggestions','events','voice','analytics'] as const
export type SectionId = typeof sectionIds[number]
export const isSectionId = (value: unknown): value is SectionId => typeof value === 'string' && (sectionIds as readonly string[]).includes(value)
export const navigation: ReadonlyArray<readonly [string,ReadonlyArray<readonly [SectionId,string]>]> = [
  ['Basics',[['general','General'],['custom','Custom commands'],['auto','Autoresponders']]],
  ['Moderation',[['moderation','Moderation and safety'],['cleanup','Message cleanup'],['logs','Channel logs']]],
  ['Roles',[['reaction','Reaction roles'],['autorole','Autorole'],['verification','Verification'],['rolepicker','Role picker']]],
  ['Messaging',[['messages','Messages'],['publishing','Drafts and templates'],['greetings','Greetings'],['schedules','Schedules']]],
  ['Community',[['tickets','Tickets'],['leveling','Leveling'],['milestones','Milestones'],['suggestions','Suggestions'],['events','Events'],['voice','Temporary voice']]],
  ['Insights',[['analytics','Analytics']]],
]
export const sectionNames: Record<SectionId,string> = Object.fromEntries([['overview','Overview'],...navigation.flatMap(([,items]) => items)]) as Record<SectionId,string>
export const sectionIcons: Record<SectionId,string> = {
  overview: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  general: 'M4 6h9M17 6h3M15 4v4M4 12h3M11 12h9M9 10v4M4 18h11M19 18h1M17 16v4',
  custom: 'M4 17l6-5-6-5M12 19h8',
  auto: 'M13 2L4 14h7l-1 8 9-12h-7z',
  moderation: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  cleanup: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  logs: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  reaction: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  autorole: 'M15 20c0-3-2.5-5-6-5s-6 2-6 5M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M16 11h6',
  verification: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM8 12l3 3 5-6',
  rolepicker: 'M10 6h10M10 12h10M10 18h10M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17',
  messages: 'M4 5h16v11H9l-5 4z',
  publishing: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  greetings: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
  schedules: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 7v5l3 2',
  tickets: 'M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4zM14 7v10',
  leveling: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  milestones: 'M5 21V4M5 4h11l-2 4 2 4H5',
  suggestions: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
  events: 'M4 6h16v15H4zM4 10h16M8 3v5M16 3v5',
  voice: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  analytics: 'M4 20h16M6 20v-6M11 20V6M16 20v-9',
}
export const Icon = ({ path }: { path: string }) => <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg>

/** What every section receives. Each section owns its live subscriptions, so only the open section is subscribed */
export interface SectionProps {
  section: SectionId
  client: ConvexReactClient
  sessionToken: string
  serverId: string
  userId: string
  connected: boolean
  catalog?: DashboardCatalog | undefined
  catalogLoading: boolean
  catalogError: boolean
  refreshCatalog: () => void
  /** The link to another section of the same server, and navigation to it */
  sectionHref: (section: SectionId) => string
  openSection: (section: SectionId) => void
}
type Section = ComponentType<SectionProps>
// Sections load their code the first time they open. Several sections share one module
const configuration = () => import('./configuration-section').then(module => module.ConfigurationView as Section)
const roles = () => import('./role-settings').then(module => module.RolesSection as Section)
const loaders: Record<SectionId,() => Promise<Section>> = {
  overview: () => import('./overview').then(module => module.OverviewSection),
  general: () => import('./general-settings').then(module => module.GeneralSection),
  custom: configuration, auto: configuration, moderation: configuration, cleanup: configuration, rolepicker: configuration, publishing: configuration, greetings: configuration,
  schedules: configuration, tickets: configuration, leveling: configuration, milestones: configuration, suggestions: configuration, events: configuration, voice: configuration,
  logs: () => import('./log-settings').then(module => module.LogsSection),
  reaction: roles, autorole: roles, verification: roles,
  messages: () => import('./messages').then(module => module.MessagesSection),
  analytics: () => import('./analytics-settings').then(module => module.AnalyticsSection as Section),
}
const loaded = new Map<SectionId,Section>()
const load = (id: SectionId) => loaders[id]().then(component => { loaded.set(id,component); return component })
/** Loads every section ahead of use, for tests that render sections without waiting */
export const preloadSections = () => Promise.all(sectionIds.map(load)).then(() => undefined)
/** Starts loading a section early, such as when its link gets focus */
export const prefetchSection = (id: SectionId) => { if (!loaded.has(id)) void load(id).catch(() => {}) }
/** Props for a link to a section. A plain click navigates in place, while modified clicks keep the browser's own behavior */
export function sectionLink(id: SectionId, href: (section: SectionId) => string, open: (section: SectionId) => void) {
  return { href: href(id), onFocus: () => prefetchSection(id), onMouseEnter: () => prefetchSection(id),
    onClick: (event: { button: number, metaKey: boolean, ctrlKey: boolean, shiftKey: boolean, altKey: boolean, preventDefault: () => void }) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault(); open(id)
    } }
}
export function useSection(id: SectionId): { component?: Section, failed: boolean, retry: () => void } {
  const [state,setState] = useState<{ id: SectionId, failed: boolean, attempt: number }>({ id,failed: false,attempt: 0 })
  const component = loaded.get(id)
  useEffect(() => {
    if (component) return
    let active = true
    load(id).then(() => { if (active) setState(current => ({ ...current,id,failed: false })) },() => { if (active) setState(current => ({ ...current,id,failed: true })) })
    return () => { active = false }
  },[id,component,state.attempt])
  return { component,failed: state.id === id && state.failed,retry: () => setState(current => ({ id,failed: false,attempt: current.attempt + 1 })) }
}
