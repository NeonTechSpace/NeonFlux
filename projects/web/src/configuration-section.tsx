import type { ConvexReactClient } from 'convex/react'
import { useState } from 'react'
import type { DashboardCatalog, DashboardConfigurationFamily, DashboardConfigurationOperationMap, DashboardConfigurationRequest,DashboardConfigurationSnapshot } from '@neonflux/backend/dashboard-contracts'
import type { ConfigurationQueue, TemplateOption } from './configuration-form'
import { dashboardApi } from './dashboard-api'
import type { SectionProps } from './dashboard-sections'
import { useConfigurationState } from './configuration-live'
import { useLiveQuery } from './live-query'
import { JobStatus } from './job-status'
import { ResponseSettings } from './response-settings'
import { SafetySettings } from './safety-settings'
import { PublishingSettings } from './publishing-settings'
import { GreetingSettings,TicketSettings } from './onboarding-settings'
import { LevelingSettings,MilestoneSettings,SuggestionSettings } from './community-settings'
import { EventSettings,ScheduleSettings } from './calendar-settings'
import { CleanupSettings } from './cleanup-settings'
import { VoiceSettings } from './voice-settings'
import { preserveRemovedDefinitions } from './configuration-retained'
import { RolePickerSettings } from './role-picker-settings'
import { StickySettings } from './sticky-settings'
import { SidebarSettings } from './sidebar-settings'
import { MemberListSettings } from './memberlist-settings'
import { OnboardingSettings } from './onboarding-checklist'
import { PresetSettings } from './preset-settings'
import { LfgSettings } from './lfg-settings'
import { TemporaryRoleSettings } from './temporary-role-settings'
import { AlertsSettings } from './alerts-settings'
import { HelpDeskSettings } from './helpdesk-settings'

export const configurationSections = {
  custom: { family: 'responses',title: 'Custom commands' },auto: { family: 'responses',title: 'Autoresponders' },moderation: { family: 'moderation',title: 'Moderation and safety' },publishing: { family: 'publishing',title: 'Drafts and templates' },greetings: { family: 'greetings',title: 'Greetings' },tickets: { family: 'tickets',title: 'Tickets' },leveling: { family: 'leveling',title: 'Leveling' },milestones: { family: 'milestones',title: 'Milestones' },suggestions: { family: 'suggestions',title: 'Suggestions' },cleanup: { family: 'cleanup',title: 'Message cleanup' },events: { family: 'events',title: 'Events' },schedules: { family: 'schedules',title: 'Schedules' },voice: { family: 'voice',title: 'Temporary voice' },lfg: { family: 'lfg',title: 'Looking for group' },rolepicker: { family: 'rolepicker',title: 'Role picker' },temproles: { family: 'temproles',title: 'Temporary roles' },onboarding: { family: 'onboarding',title: 'Newcomer checklist' },presets: { family: 'presets',title: 'Setup presets' },sticky: { family: 'sticky',title: 'Sticky messages' },sidebar: { family: 'sidebar',title: 'Dashboard link' },memberlist: { family: 'memberlist',title: 'Member list order' },alerts: { family: 'alerts',title: 'Security alerts' },helpdesk: { family: 'helpdesk',title: 'Help desk' },
} satisfies Record<string,{ family: DashboardConfigurationFamily,title: string }>
export type ConfigurationSectionId = keyof typeof configurationSections
export function isConfigurationSection(value: string): value is ConfigurationSectionId { return Object.hasOwn(configurationSections,value) }
export interface ConfigurationSectionProps {
  section: ConfigurationSectionId
  client: ConvexReactClient
  sessionToken: string
  serverId: string
  /** The signed-in user, so owner-only settings can say who may change them */
  userId?: string | undefined
  connected: boolean
  catalog?: DashboardCatalog
  catalogLoading: boolean
  catalogError: boolean
  templates?: TemplateOption[] | undefined
  templatesLoading?: boolean
  templatesError?: boolean
  templatesHasMore?: boolean
  loadTemplatesPage?: () => void
  refreshCatalog?: () => void
}
// Families whose forms choose a saved template revision
const templateFamilies = new Set<DashboardConfigurationFamily>(['greetings','tickets','milestones','events','schedules'])
const TEMPLATE_PAGE = 50, TEMPLATE_LIMIT = 500
/** A configuration section of the dashboard. Template consumers also subscribe to template names and revisions, without content */
export function ConfigurationView(props: SectionProps & { section: ConfigurationSectionId }) {
  const { client,sessionToken,serverId,section } = props, consumer = templateFamilies.has(configurationSections[section].family)
  const [limit,setLimit] = useState(TEMPLATE_PAGE)
  const templates = useLiveQuery(client,dashboardApi.templates,consumer ? { sessionToken,serverId,limit } : undefined)
  return <ConfigurationSection section={section} client={client} sessionToken={sessionToken} serverId={serverId} userId={props.userId} connected={props.connected} catalog={props.catalog} catalogLoading={props.catalogLoading} catalogError={props.catalogError} refreshCatalog={props.refreshCatalog}
    templates={templates.data?.templates} templatesLoading={consumer && !templates.current} templatesError={templates.error} templatesHasMore={Boolean(templates.data?.more) && limit < TEMPLATE_LIMIT} loadTemplatesPage={() => setLimit(current => Math.min(TEMPLATE_LIMIT,current + TEMPLATE_PAGE))} />
}
export function ConfigurationSection(props: ConfigurationSectionProps) {
  const { client,sessionToken,serverId,section } = props
  const state = useConfigurationState(client,sessionToken,serverId,configurationSections[section].family)
  const [memory,setMemory] = useState<{ source: DashboardConfigurationSnapshot,view: DashboardConfigurationSnapshot,missing: string[] }>()
  const retention = state.remote ? memory?.source === state.remote ? memory : { source: state.remote,...preserveRemovedDefinitions(state.remote,memory?.view) } : undefined
  if (retention && memory?.source !== state.remote) setMemory(retention)
  const common = { connected: props.connected && !state.error && !state.loadingPage,userId: props.userId,catalog: props.catalog,catalogLoading: props.catalogLoading,catalogError: props.catalogError,defaultOwnerId: props.catalog?.ownerId,loadPage: state.loadPage,loadingPage: state.loadingPage,templates: props.templates,templatesLoading: props.templatesLoading,templatesError: props.templatesError,templatesHasMore: props.templatesHasMore,loadTemplatesPage: props.loadTemplatesPage,removedDefinitions: retention?.missing }
  function queue<F extends DashboardConfigurationFamily>(family: F): ConfigurationQueue<F> {
    return (operation: DashboardConfigurationOperationMap[F],expectedConfigRevision: number,requestId: string) => client.action(dashboardApi.queueConfiguration,{ sessionToken,serverId,family,operation,expectedConfigRevision,requestId } as DashboardConfigurationRequest)
  }
  const remote = retention?.view
  let form
  if (remote) switch (remote.family) {
    case 'responses': form = <ResponseSettings {...common} remote={remote} queue={queue('responses')} kind={section === 'auto' ? 'auto' : 'custom'} />; break
    case 'moderation': form = <SafetySettings {...common} remote={remote} queue={queue('moderation')} />; break
    case 'publishing': form = <PublishingSettings {...common} remote={remote} queue={queue('publishing')} />; break
    case 'greetings': form = <GreetingSettings {...common} remote={remote} queue={queue('greetings')} />; break
    case 'tickets': form = <TicketSettings {...common} remote={remote} queue={queue('tickets')} />; break
    case 'leveling': form = <LevelingSettings {...common} remote={remote} queue={queue('leveling')} />; break
    case 'milestones': form = <MilestoneSettings {...common} remote={remote} queue={queue('milestones')} />; break
    case 'suggestions': form = <SuggestionSettings {...common} remote={remote} queue={queue('suggestions')} />; break
    case 'cleanup': form = <CleanupSettings {...common} remote={remote} queue={queue('cleanup')} />; break
    case 'events': form = <EventSettings {...common} remote={remote} queue={queue('events')} />; break
    case 'schedules': form = <ScheduleSettings {...common} remote={remote} queue={queue('schedules')} />; break
    case 'voice': form = <VoiceSettings {...common} remote={remote} queue={queue('voice')} refreshCatalog={props.refreshCatalog} />; break
    case 'rolepicker': form = <RolePickerSettings {...common} remote={remote} queue={queue('rolepicker')} />; break
    case 'sticky': form = <StickySettings {...common} remote={remote} queue={queue('sticky')} />; break
    case 'sidebar': form = <SidebarSettings {...common} remote={remote} queue={queue('sidebar')} />; break
    case 'memberlist': form = <MemberListSettings {...common} remote={remote} queue={queue('memberlist')} refreshCatalog={props.refreshCatalog} />; break
    case 'temproles': form = <TemporaryRoleSettings {...common} remote={remote} queue={queue('temproles')} />; break
    case 'alerts': form = <AlertsSettings {...common} remote={remote} queue={queue('alerts')} />; break
    case 'helpdesk': form = <HelpDeskSettings {...common} remote={remote} queue={queue('helpdesk')} />; break
    case 'onboarding': form = <OnboardingSettings {...common} remote={remote} queue={queue('onboarding')} />; break
    case 'presets': form = <PresetSettings {...common} remote={remote} queue={queue('presets')} />; break
    case 'lfg': form = <LfgSettings {...common} remote={remote} queue={queue('lfg')} />; break
  }
  return <div className="role-section">
    {state.error && <p className="notice error" role="alert">Live configuration is unavailable. Your draft is kept. Refresh sign-in or check server permission before saving</p>}
    {!remote && <section className="panel"><p role="status">Loading {configurationSections[section].title.toLowerCase()}…</p></section>}
    {retention?.missing.length ? <div className="notice" role="alert"><p>Definitions are no longer in the loaded pages. They may have been removed or moved to a later page. Their forms and drafts are kept below for copying, with saves disabled until those definitions are loaded again</p><button type="button" className="secondary" onClick={() => { if (state.remote) setMemory({ source: state.remote,view: state.remote,missing: [] }) }}>Dismiss unavailable definitions and their drafts</button></div> : null}
    {form}
    {remote && <section className="panel"><h2>Recent configuration requests</h2>{remote.jobs.length ? <ul className="request-list">{remote.jobs.map(job => { const operation = 'operation' in job.operation ? job.operation.operation.type : job.operation.type; return <li key={job.id}><strong>{operation[0]!.toUpperCase() + operation.slice(1).replaceAll('-',' ')}</strong>: <JobStatus state={job.state} error={job.error} /></li> })}</ul> : <p className="muted">No recent requests</p>}<p className="field-help">The running bot rechecks current permissions before applying a change. Requests expire after two minutes{remote.family === 'events' ? '. Applied confirms configuration, while native card delivery follows its own status' : ''}</p></section>}
  </div>
}
