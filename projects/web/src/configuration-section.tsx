import type { ConvexReactClient } from 'convex/react'
import { useState } from 'react'
import type { DashboardCatalog, DashboardConfigurationFamily, DashboardConfigurationOperationMap, DashboardConfigurationRequest,DashboardConfigurationSnapshot } from '@neonflux/backend/dashboard-contracts'
import type { PublishingDraft } from '@neonflux/backend/contracts'
import type { ConfigurationQueue } from './configuration-form'
import { dashboardApi } from './dashboard-api'
import { useConfigurationState } from './configuration-live'
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

export const configurationSections = {
  custom: { family: 'responses',title: 'Custom commands' },auto: { family: 'responses',title: 'Autoresponders' },moderation: { family: 'moderation',title: 'Moderation and safety' },publishing: { family: 'publishing',title: 'Drafts and templates' },greetings: { family: 'greetings',title: 'Greetings' },tickets: { family: 'tickets',title: 'Tickets' },leveling: { family: 'leveling',title: 'Leveling' },milestones: { family: 'milestones',title: 'Milestones' },suggestions: { family: 'suggestions',title: 'Suggestions' },cleanup: { family: 'cleanup',title: 'Message cleanup' },events: { family: 'events',title: 'Events' },schedules: { family: 'schedules',title: 'Schedules' },voice: { family: 'voice',title: 'Temporary voice' },rolepicker: { family: 'rolepicker',title: 'Role picker' },
} satisfies Record<string,{ family: DashboardConfigurationFamily,title: string }>
export type ConfigurationSectionId = keyof typeof configurationSections
export function isConfigurationSection(value: string): value is ConfigurationSectionId { return Object.hasOwn(configurationSections,value) }
export interface ConfigurationSectionProps {
  section: ConfigurationSectionId
  client: ConvexReactClient
  sessionToken: string
  serverId: string
  connected: boolean
  catalog?: DashboardCatalog
  catalogLoading: boolean
  catalogError: boolean
  templates?: PublishingDraft[]
  templatesLoading?: boolean
  templatesError?: boolean
  templatesHasMore?: boolean
  loadTemplatesPage?: () => void
  refreshCatalog?: () => void
}
export function ConfigurationSection(props: ConfigurationSectionProps) {
  const { client,sessionToken,serverId,section } = props
  const state = useConfigurationState(client,sessionToken,serverId,configurationSections[section].family)
  const [memory,setMemory] = useState<{ source: DashboardConfigurationSnapshot,view: DashboardConfigurationSnapshot,missing: string[] }>()
  const retention = state.remote ? memory?.source === state.remote ? memory : { source: state.remote,...preserveRemovedDefinitions(state.remote,memory?.view) } : undefined
  if (retention && memory?.source !== state.remote) setMemory(retention)
  const common = { connected: props.connected && !state.error && !state.loadingPage,catalog: props.catalog,catalogLoading: props.catalogLoading,catalogError: props.catalogError,defaultOwnerId: props.catalog?.ownerId,loadPage: state.loadPage,loadingPage: state.loadingPage,templates: props.templates,templatesLoading: props.templatesLoading,templatesError: props.templatesError,templatesHasMore: props.templatesHasMore,loadTemplatesPage: props.loadTemplatesPage,removedDefinitions: retention?.missing }
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
  }
  return <div className="role-section">
    {state.error && <p className="notice error" role="alert">Live configuration is unavailable. Your draft is kept. Refresh sign-in or check server permission before saving</p>}
    {!remote && <section className="panel"><p role="status">Loading {configurationSections[section].title.toLowerCase()}…</p></section>}
    {retention?.missing.length ? <div className="notice" role="alert"><p>Definitions are no longer in the loaded pages. They may have been removed or moved to a later page. Their forms and drafts are kept below for copying, with saves disabled until those definitions are loaded again</p><button type="button" className="secondary" onClick={() => { if (state.remote) setMemory({ source: state.remote,view: state.remote,missing: [] }) }}>Dismiss unavailable definitions and their drafts</button></div> : null}
    {form}
    {remote && <section className="panel"><h2>Recent configuration requests</h2>{remote.jobs.length ? <ul className="request-list">{remote.jobs.map(job => { const operation = 'operation' in job.operation ? job.operation.operation.type : job.operation.type; return <li key={job.id}>{operation[0]!.toUpperCase() + operation.slice(1).replaceAll('-',' ')}: {job.state === 'queued' ? 'Pending bot confirmation' : job.state[0]!.toUpperCase() + job.state.slice(1)}{job.error && <p className="error-text">{job.error}</p>}</li> })}</ul> : <p className="muted">No recent requests</p>}<p className="field-help">The running bot rechecks current permissions before applying a change. Requests expire after two minutes{remote.family === 'events' ? '. Applied confirms configuration, while native card delivery follows its own status' : ''}</p></section>}
  </div>
}
