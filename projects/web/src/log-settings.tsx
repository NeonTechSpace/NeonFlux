import { useRef } from 'react'
import type { MetadataLogsCategory, MetadataLogsEventSelector, MetadataLogsSettings } from '@neonflux/backend/contracts'
import type { DashboardCatalog, DashboardMetadataOperation, DashboardMetadataQueueResult, DashboardMetadataSnapshot } from '@neonflux/backend/dashboard-contracts'
import { FormInputError, SettingsForm } from './settings-form'
import type { FormSaveResult, FormValues, SettingsFormProps } from './settings-form'
import { SearchPicker } from './search-picker'
import { publicationChannels } from './catalog-options'

export type LogSettingsQueue = (operation: DashboardMetadataOperation, expectedConfigRevision: number, requestId: string) => Promise<DashboardMetadataQueueResult>
export interface LogSettingsProps {
  remote: DashboardMetadataSnapshot
  queue: LogSettingsQueue
  connected: boolean
  catalog?: DashboardCatalog
  catalogLoading?: boolean
  catalogError?: boolean
  defaultOwnerId?: string
}
const groups = {
  membership: { title: 'Membership', colors: ['#4ade80','#22c55e','#16a34a','#15803d'] },
  resources: { title: 'Resources', colors: ['#60a5fa','#3b82f6','#2563eb','#1d4ed8'] },
  messages: { title: 'Messages', colors: ['#22d3ee','#06b6d4','#0891b2','#0e7490'] },
  audit: { title: 'Audit', colors: ['#c084fc','#a855f7','#9333ea','#7e22ce'] },
  settings: { title: 'Settings', colors: ['#fbbf24','#f59e0b','#d97706','#b45309'] },
  operations: { title: 'Operations', colors: ['#fb7f6b','#f25d50','#dc443c','#b92f2d'] },
} satisfies Record<MetadataLogsCategory,{ title: string, colors: string[] }>
const events = {
  'member-add': { category: 'membership', title: 'Member joined' },
  'member-update': { category: 'membership', title: 'Member changed' },
  'member-remove': { category: 'membership', title: 'Member departed' },
  'role-create': { category: 'resources', title: 'Role created' },
  'role-update': { category: 'resources', title: 'Role changed' },
  'role-delete': { category: 'resources', title: 'Role deleted' },
  'channel-create': { category: 'resources', title: 'Channel created' },
  'channel-update': { category: 'resources', title: 'Channel changed' },
  'channel-delete': { category: 'resources', title: 'Channel deleted' },
  'thread-create': { category: 'resources', title: 'Thread created' },
  'thread-update': { category: 'resources', title: 'Thread changed' },
  'thread-delete': { category: 'resources', title: 'Thread deleted' },
  'server-update': { category: 'resources', title: 'Server changed' },
  'message-update': { category: 'messages', title: 'Message changed' },
  'message-delete': { category: 'messages', title: 'Message deleted' },
  'message-bulk-delete': { category: 'messages', title: 'Messages deleted in bulk' },
  'audit-entry': { category: 'audit', title: 'Audit entry default' },
  'settings-change': { category: 'settings', title: 'Settings changed' },
  'backend-failure': { category: 'operations', title: 'Backend failure' },
  'admission-failure': { category: 'operations', title: 'Admission failure' },
  'delivery-failure': { category: 'operations', title: 'Delivery failure' },
  'gateway-discontinuity': { category: 'operations', title: 'Gateway connection changed' },
  'audit-entry:1': { category: 'audit', title: 'Audit: Server updated' },
  'audit-entry:10': { category: 'audit', title: 'Audit: Channel created' },
  'audit-entry:11': { category: 'audit', title: 'Audit: Channel updated' },
  'audit-entry:12': { category: 'audit', title: 'Audit: Channel deleted' },
  'audit-entry:13': { category: 'audit', title: 'Audit: Permission overwrite created' },
  'audit-entry:14': { category: 'audit', title: 'Audit: Permission overwrite updated' },
  'audit-entry:15': { category: 'audit', title: 'Audit: Permission overwrite deleted' },
  'audit-entry:20': { category: 'audit', title: 'Audit: Member kicked' },
  'audit-entry:22': { category: 'audit', title: 'Audit: Member banned' },
  'audit-entry:23': { category: 'audit', title: 'Audit: Member ban lifted' },
  'audit-entry:24': { category: 'audit', title: 'Audit: Member updated' },
  'audit-entry:25': { category: 'audit', title: 'Audit: Member roles updated' },
  'audit-entry:26': { category: 'audit', title: 'Audit: Member moved' },
  'audit-entry:27': { category: 'audit', title: 'Audit: Member disconnected' },
  'audit-entry:28': { category: 'audit', title: 'Audit: Bot added' },
  'audit-entry:30': { category: 'audit', title: 'Audit: Role created' },
  'audit-entry:31': { category: 'audit', title: 'Audit: Role updated' },
  'audit-entry:32': { category: 'audit', title: 'Audit: Role deleted' },
} satisfies Record<MetadataLogsEventSelector,{ category: MetadataLogsCategory, title: string }>
const categories = Object.keys(groups) as MetadataLogsCategory[]
const eventTypes = Object.keys(events) as MetadataLogsEventSelector[]
function id(value: string | boolean | undefined, label: string): string {
  const result = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(result) || BigInt(result) > 9223372036854775807n) throw new FormInputError(`Choose a valid ${label}`)
  return result
}
function ids(value: string | boolean | undefined): string[] {
  const list = JSON.parse(String(value)) as string[]
  if (list.length > 50 || new Set(list).size !== list.length) throw new FormInputError('Choose up to fifty distinct channels for each filter')
  return list.map(value => id(value,'channel ID'))
}
function LogForm({ queue,operation,...props }: Omit<SettingsFormProps,'save'> & { queue: LogSettingsQueue, operation: (values: FormValues) => DashboardMetadataOperation }) {
  const request = useRef<{ key: string, id: string } | undefined>(undefined)
  async function save(values: FormValues, expectedRevision: number): Promise<FormSaveResult> {
    const next = operation(values), key = JSON.stringify({ next,expectedRevision })
    if (request.current?.key !== key) request.current = { key,id: crypto.randomUUID() }
    const result = await queue(next,expectedRevision,request.current.id)
    request.current = undefined
    if (result.conflict) return { saved: false,conflict: true,revision: result.revision }
    if (!result.queued || !result.jobId) throw new Error('Logging change was not queued')
    return { queued: true,jobId: result.jobId,revision: result.revision }
  }
  return <SettingsForm {...props} save={save} resetAfterApplied />
}
function channelName(channelId: string, catalog?: DashboardCatalog): string { return catalog?.channels.find(channel => channel.id === channelId)?.name ?? `Channel ${channelId}` }
function destination(settings: MetadataLogsSettings, category: MetadataLogsCategory, eventType: MetadataLogsEventSelector | undefined, catalog?: DashboardCatalog): string {
  const override = eventType ? settings.eventRoutes.find(route => route.eventType === eventType) : undefined
  const auditDefault = eventType?.startsWith('audit-entry:') ? settings.eventRoutes.find(route => route.eventType === 'audit-entry') : undefined
  const route = override ?? auditDefault ?? settings.routes.find(route => route.category === category)
  const source = override ? 'Event override' : auditDefault ? 'Audit entry default' : `${groups[category].title} group`
  if (!route?.enabled || !route.channelId) return `${source}: Disabled`
  return `${source}: ${channelName(route.channelId,catalog)}${settings.enabled ? '' : ' (logging is disabled)'}`
}
function DestinationFields({ values,edit,disabled,label,props }: { values: FormValues, edit: (key: string,value: string | boolean) => void, disabled: boolean, label: string, props: LogSettingsProps }) {
  return <><SearchPicker label={`${label} destination`} options={publicationChannels(props.catalog)} loading={props.catalogLoading} allowManual={props.catalogError} disabled={disabled} value={values.channelId ? [String(values.channelId)] : []} onChange={selected => edit('channelId',selected[0] ?? '')} /><label>{label} owner ID<input required inputMode="numeric" pattern="[1-9][0-9]{0,18}" maxLength={19} value={String(values.ownerId)} disabled={disabled} onChange={event => edit('ownerId',event.target.value)} /></label><p className="field-help">Use the ID of a current server Owner or Administrator with access to this destination. The running bot checks the owner and its own permissions before applying the route</p></>
}
function requestName(operation: DashboardMetadataOperation): string {
  if ('eventType' in operation) return events[operation.eventType].title
  if ('category' in operation) return `${groups[operation.category].title} group`
  return operation.type === 'module' ? 'Logging enabled' : 'Channel filters'
}
export function LogSettings(props: LogSettingsProps) {
  const { settings,jobs } = props.remote
  const { configRevision: revision } = settings
  const common = { connected: props.connected,jobs,queue: props.queue }
  const picker = { options: publicationChannels(props.catalog),loading: props.catalogLoading,allowManual: props.catalogError }
  return <div className="role-section">
    <LogForm {...common} title="Channel logs" description="Route supported server observations to staff channels. Event overrides take priority over their group destination" snapshot={{ revision,values: { enabled: settings.enabled } }} submitLabel="Request logging change" operation={values => ({ type: 'module',expectedRevision: settings.revision,enabled: Boolean(values.enabled) })} fields={(values,edit,disabled) => <><label><input type="checkbox" checked={Boolean(values.enabled)} disabled={disabled} onChange={event => edit('enabled',event.target.checked)} />Logging enabled</label><p className="field-help">Disabling logging preserves retained work. Settings apply after the running bot confirms them. Configuration flags do not prove successful delivery</p></>} />
    <LogForm {...common} title="Logging channel filters" description="Limit message observations to chosen channels and exclude message sources" snapshot={{ revision,values: { messageChannelIds: JSON.stringify(settings.messageChannelIds),excludedChannelIds: JSON.stringify(settings.excludedChannelIds) } }} submitLabel="Request filter change" operation={values => ({ type: 'channels',expectedRevision: settings.revision,messageChannelIds: ids(values.messageChannelIds),excludedChannelIds: ids(values.excludedChannelIds) })} fields={(values,edit,disabled) => <><SearchPicker {...picker} label="Message observation channels" multiple disabled={disabled} value={JSON.parse(String(values.messageChannelIds)) as string[]} onChange={selected => edit('messageChannelIds',JSON.stringify(selected))} /><p className="field-help">Choose up to fifty channels per filter. An empty message observation list disables message observations</p><SearchPicker {...picker} label="Excluded message observation channels" multiple disabled={disabled} value={JSON.parse(String(values.excludedChannelIds)) as string[]} onChange={selected => edit('excludedChannelIds',JSON.stringify(selected))} /><p className="field-help">These filters apply to message events even with a specific event route. Private channels and bot-authored message observations are omitted</p></>} />
    {categories.map(category => {
      const group = groups[category], route = settings.routes.find(route => route.category === category)
      const values: FormValues = { mode: route?.enabled ? 'channel' : 'disabled',channelId: route?.channelId ?? '',ownerId: route?.ownerId ?? props.defaultOwnerId ?? '' }
      return <div className="role-section" key={category}>
        <LogForm {...common} title={`${group.title} group`} description={`Default route for ${group.title.toLowerCase()} events. An event can override or disable this default`} snapshot={{ revision,values }} submitLabel={`Request ${group.title.toLowerCase()} route`} operation={values => values.mode === 'disabled' ? { type: 'clear',category,expectedRevision: route?.revision ?? 1 } : { type: 'route',category,expectedRevision: route?.revision ?? 1,enabled: true,channelId: id(values.channelId,'destination channel'),ownerId: id(values.ownerId,'owner ID') }} fields={(values,edit,disabled) => <>
          <p className="field-help">Current destination: {destination(settings,category,undefined,props.catalog)}</p>
          <label>{group.title} group routing<select value={String(values.mode)} disabled={disabled} onChange={event => edit('mode',event.target.value)}><option value="disabled">Disabled (clear group destination)</option><option value="channel">Specific destination</option></select></label>
          {values.mode === 'channel' && <DestinationFields values={values} edit={edit} disabled={disabled} label={group.title} props={props} />}
          <p className="field-help">Fixed {group.title.toLowerCase()} colors. The action title describes what happened</p>
          <ul aria-label={`${group.title} color legend`} className="request-list">{['Addition','Observation','Change','Deletion or failure'].map((label,index) => <li key={label}><span aria-hidden="true" style={{ display: 'inline-block',width: 14,height: 14,marginRight: 8,backgroundColor: group.colors[index],borderRadius: 3 }} />{label}</li>)}</ul>
        </>} />
        <details><summary>{group.title} event overrides</summary><div className="role-section">{eventTypes.filter(eventType => events[eventType].category === category).map(eventType => {
          const override = settings.eventRoutes.find(route => route.eventType === eventType), title = events[eventType].title
          const values: FormValues = { mode: !override ? 'inherit' : override.enabled ? 'channel' : 'disabled',channelId: override?.channelId ?? '',ownerId: override?.ownerId ?? props.defaultOwnerId ?? '' }
          const auditAction = eventType.startsWith('audit-entry:')
          return <LogForm {...common} key={eventType} title={title} description={auditAction ? `Event: ${eventType}. This action can override the audit entry default and the audit group` : eventType === 'audit-entry' ? 'Default route for supported audit actions without an individual override' : `Event: ${eventType}. A specific event destination overrides the ${group.title.toLowerCase()} group`} snapshot={{ revision,values }} submitLabel={`Request ${title.toLowerCase()} change`} operation={values => values.mode === 'inherit' ? { type: 'event-clear',eventType,expectedRevision: settings.configRevision } : values.mode === 'disabled' ? { type: 'event-route',eventType,expectedRevision: settings.configRevision,enabled: false } : { type: 'event-route',eventType,expectedRevision: settings.configRevision,enabled: true,channelId: id(values.channelId,'destination channel'),ownerId: id(values.ownerId,'owner ID') }} fields={(values,edit,disabled) => <><p className="field-help">Current destination: {destination(settings,category,eventType,props.catalog)}</p><label>{title} routing<select value={String(values.mode)} disabled={disabled} onChange={event => edit('mode',event.target.value)}><option value="inherit">{auditAction ? 'Inherit audit default' : 'Inherit group'}</option><option value="disabled">Disable this event</option><option value="channel">Specific destination</option></select></label>{values.mode === 'channel' && <DestinationFields values={values} edit={edit} disabled={disabled} label={title} props={props} />}<p className="field-help">{auditAction ? 'Inherit follows the audit entry default, then the audit group' : "Inherit removes this event's override"}. Disable suppresses delivery for this event even when its default route is enabled</p></>} />
        })}</div></details>
      </div>
    })}
    <section className="panel"><h2>Recent logging requests</h2>{jobs.length ? <ul className="request-list">{jobs.map(job => <li key={job.id}><strong>{requestName(job.operation)}</strong>: {job.state === 'queued' ? 'Pending bot checks' : job.state === 'applied' ? 'Applied' : job.state === 'conflict' ? 'Changed elsewhere' : 'Failed'}{job.error && <p className="error-text">{job.error}</p>}</li>)}</ul> : <p className="muted">No recent logging requests</p>}<p className="field-help">Supported gateway metadata is bounded and does not include message bodies or complete event history. Audit actors are shown only when supplied by an allowlisted audit entry. Unknown attribution stays unknown</p><p className="field-help">Member departures have an unknown cause. Supported audit actions retain their own labels and color tones. Individual action overrides take priority over the audit entry default, then the audit group</p></section>
  </div>
}
