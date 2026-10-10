import type { ConvexReactClient } from 'convex/react'
import type { ComponentType } from 'react'
import { useEffect, useState } from 'react'
import type { DashboardCatalog } from '@neonflux/backend/dashboard-contracts'

export const sectionIds = ['overview','general','presets','sidebar','structure','custom','auto','moderation','alerts','private','cleanup','logs','reaction','autorole','verification','rolepicker','temproles','onboarding','memberlist','messages','sticky','publishing','greetings','schedules','tickets','helpdesk','showcase','profile','leveling','milestones','suggestions','events','voice','lfg','analytics','recovery','audit','backup','export'] as const
export type SectionId = typeof sectionIds[number]
export const isSectionId = (value: unknown): value is SectionId => typeof value === 'string' && (sectionIds as readonly string[]).includes(value)
export const navigation: ReadonlyArray<readonly [string,ReadonlyArray<readonly [SectionId,string]>]> = [
  ['Basics',[['general','General'],['presets','Setup presets'],['sidebar','Dashboard link'],['structure','Server structure'],['custom','Custom commands'],['auto','Autoresponders']]],
  ['Moderation',[['moderation','Moderation and safety'],['alerts','Security alerts'],['private','Private cases'],['cleanup','Message cleanup'],['logs','Channel logs']]],
  ['Roles',[['reaction','Reaction roles'],['autorole','Autorole'],['verification','Verification'],['rolepicker','Role picker'],['temproles','Temporary roles'],['onboarding','Newcomer checklist'],['memberlist','Member list order']]],
  ['Messaging',[['messages','Messages'],['sticky','Sticky messages'],['publishing','Drafts and templates'],['greetings','Greetings'],['schedules','Schedules']]],
  ['Community',[['tickets','Tickets'],['helpdesk','Help desk'],['showcase','Showcases'],['profile','Profiles'],['leveling','Leveling'],['milestones','Milestones'],['suggestions','Suggestions'],['events','Events'],['voice','Temporary voice'],['lfg','Looking for group']]],
  ['Insights',[['analytics','Analytics'],['recovery','Recovery inbox'],['audit','Audit log'],['backup','Backup preview'],['export','Server export']]],
]
export const sectionNames: Record<SectionId,string> = Object.fromEntries([['overview','Overview'],...navigation.flatMap(([,items]) => items)]) as Record<SectionId,string>
export const sectionIcons: Record<SectionId,string> = {
  overview: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  general: 'M4 6h9M17 6h3M15 4v4M4 12h3M11 12h9M9 10v4M4 18h11M19 18h1M17 16v4',
  custom: 'M4 17l6-5-6-5M12 19h8',
  auto: 'M13 2L4 14h7l-1 8 9-12h-7z',
  moderation: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  private: 'M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3M12 15v2',
  cleanup: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  logs: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  reaction: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  autorole: 'M15 20c0-3-2.5-5-6-5s-6 2-6 5M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M16 11h6',
  verification: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM8 12l3 3 5-6',
  rolepicker: 'M10 6h10M10 12h10M10 18h10M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17',
  temproles: 'M7 3h10M7 21h10M8 3c0 5 8 4 8 9s-8 4-8 9M16 3c0 5-8 4-8 9s8 4 8 9',
  onboarding: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18h2',
  presets: 'M4 4h7v7H4zM13 13h7v7h-7zM14.5 4.5l5 5M19.5 4.5l-5 5M4.5 14.5h6v6h-6z',
  messages: 'M4 5h16v11H9l-5 4z',
  publishing: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  greetings: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
  schedules: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 7v5l3 2',
  tickets: 'M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4zM14 7v10',
  leveling: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  milestones: 'M5 21V4M5 4h11l-2 4 2 4H5',
  showcase: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15 9h.01',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.5-6 8-6s8 2 8 6',
  suggestions: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
  events: 'M4 6h16v15H4zM4 10h16M8 3v5M16 3v5',
  voice: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  lfg: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 2.5-5 6-5s6 2 6 5M14 15.5c.6-.3 1.3-.5 2-.5 3.5 0 6 2 6 5',
  analytics: 'M4 20h16M6 20v-6M11 20V6M16 20v-9',
  audit: 'M9 3h6v4H9zM7 5H5v16h14V5h-2M8 12h8M8 16h5',
  export: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  sticky: 'M5 4h14v16H5zM8 16h8M8 12h8',
  structure: 'M4 4h7v4H4zM8 8v11h5M8 13h5M13 11h7v4h-7zM13 17h7v4h-7z',
  sidebar: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  memberlist: 'M8 6h12M8 12h12M8 18h12M3 8l2-2 2 2M3 16l2 2 2-2',
  alerts: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  helpdesk: 'M4 5h16v11H9l-5 4zM9 9h6M9 12h4',
  recovery: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M12 8v4l3 2',
  backup: 'M4 7h16v13H4zM4 7l2-3h12l2 3M9 12h6',
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
  custom: configuration, auto: configuration, moderation: configuration, cleanup: configuration, rolepicker: configuration, temproles: configuration, onboarding: configuration, presets: configuration, showcase: configuration, profile: configuration, publishing: configuration, greetings: configuration,
  schedules: configuration, tickets: configuration, leveling: configuration, milestones: configuration, suggestions: configuration, events: configuration, voice: configuration, lfg: configuration,
  sticky: configuration, sidebar: configuration, memberlist: configuration, alerts: configuration, helpdesk: configuration,
  logs: () => import('./log-settings').then(module => module.LogsSection),
  reaction: roles, autorole: roles, verification: roles,
  messages: () => import('./messages').then(module => module.MessagesSection),
  analytics: () => import('./analytics-settings').then(module => module.AnalyticsSection as Section),
  audit: () => import('./audit-log').then(module => module.AuditLogSection),
  private: () => import('./private-cases').then(module => module.PrivateCasesSection),
  recovery: () => import('./recovery-inbox').then(module => module.RecoverySection),
  backup: () => import('./backup-preview').then(module => module.BackupSection),
  structure: () => import('./structure-editor').then(module => module.StructureSection),
  export: () => import('./server-export').then(module => module.ServerExportSection),
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
