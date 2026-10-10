import type { DashboardCatalog } from '@neonflux/backend/dashboard-contracts'
import { useEffect,useRef } from 'react'
import { ConfigForm } from './configuration-form'
import type { ConfigSectionProps } from './configuration-form'
import { idValue, numberValue } from './configuration-values'
import { FormInputError } from './settings-form'
import type { FormValues } from './settings-form'
import { SearchPicker } from './search-picker'

const categories = (catalog?: DashboardCatalog) => catalog?.channels.filter(channel => channel.type === 4) ?? []
const visible = (value: string) => value.replace(/[\u000c\u202e]/g,'').trim()
function channelName(value: string | boolean | undefined) {
  const parsed = typeof value === 'string' ? value.trim() : ''
  if (!visible(parsed) || parsed.length > 100) throw new FormInputError('Use a generator name with 1 to 100 characters')
  return parsed
}
function templateValue(value: string | boolean | undefined) {
  const parsed = typeof value === 'string' ? value.trim() : ''
  if (!visible(parsed) || parsed.length > 100 || /[{}]/.test(parsed.replaceAll('{owner}',''))) throw new FormInputError('Use a room name template with 1 to 100 characters and only the {owner} placeholder')
  return parsed
}
const limitValue = (value: string | boolean | undefined) => typeof value === 'string' && value.trim() ? numberValue(value,1,99,'default member limit') : null
function regionValue(value: string | boolean | undefined) {
  const parsed = typeof value === 'string' ? value.trim() : ''
  if (!parsed) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(parsed)) throw new FormInputError('Leave the region empty for automatic routing, or enter a region ID of up to 64 letters, digits, dots, underscores or hyphens')
  return parsed
}
const categoryValue = (value: string | boolean | undefined) => typeof value === 'string' && value ? idValue(value,'room category') : null

export function VoiceSettings(props: ConfigSectionProps<'voice'> & { refreshCatalog?: () => void }) {
  const { data,configRevision: revision,jobs } = props.remote, common = { queue: props.queue,connected: props.connected,jobs }
  const nameOf = (id: string) => props.catalog?.channels.find(channel => channel.id === id)?.name
  // Channel names come from the channel list loaded with the dashboard. A generator created or renamed after that,
  // from the dashboard or from chat, reloads the list once so its current name shows instead of its ID
  const signature = data.generators.map(generator => `${generator.channelId}:${generator.revision}`).join(','), shown = useRef(signature), refreshed = useRef<string | undefined>(undefined)
  const ready = Boolean(props.catalog) && !props.catalogLoading, missing = ready && data.generators.some(generator => !nameOf(generator.channelId))
  const refreshCatalog = props.refreshCatalog
  useEffect(() => {
    if (!ready || refreshed.current === signature || !missing && shown.current === signature) return
    refreshed.current = signature
    shown.current = signature
    refreshCatalog?.()
  },[ready,missing,signature,refreshCatalog])
  const label = (id: string) => nameOf(id) ?? (props.catalogLoading ? 'Loading channel name' : !props.catalog ? `Channel ${id}` : refreshed.current === signature ? `Unavailable channel ${id}` : 'Loading channel name')
  const fields = (values: FormValues,edit: (key: string,value: string | boolean) => void,disabled: boolean,label: string) => <>
    <label>{label}<input required maxLength={100} value={String(values.channelName)} disabled={disabled} onChange={event => edit('channelName',event.target.value)} /></label>
    <SearchPicker catalog label="Room category" options={categories(props.catalog)} loading={props.catalogLoading} allowManual={props.catalogError} value={values.categoryId ? [String(values.categoryId)] : []} disabled={disabled} onChange={ids => edit('categoryId',ids[0] ?? '')} />
    <label>Room name template<input required maxLength={100} value={String(values.template)} disabled={disabled} onChange={event => edit('template',event.target.value)} /></label>
    <label>Default member limit<input type="number" inputMode="numeric" step={1} min={1} max={99} value={String(values.userLimit)} disabled={disabled} onChange={event => edit('userLimit',event.target.value)} /></label>
    <label>Voice region<input maxLength={64} value={String(values.region)} disabled={disabled} onChange={event => edit('region',event.target.value)} /></label>
    <p className="field-help">Leave the category empty for top-level rooms, the limit empty for no limit and the region empty for automatic routing. {'{owner}'} becomes the room owner's name</p>
  </>
  return <div className="role-section">
    <section className="panel"><h2>Temporary voice rooms</h2><p className="muted">Generators {data.generators.length}/10, live rooms {data.rooms}/50. Members who join a generator get their own room, which NeonFlux deletes after it has been empty for 45 seconds</p></section>
    <ConfigForm<'voice'> {...common} title="Add generator" description="NeonFlux creates a new voice channel and uses it as a generator" resetAfterApplied submitLabel="Add generator"
      snapshot={{ revision,values: { channelName: 'Join to create',categoryId: '',template: "{owner}'s room",userLimit: '',region: '' } }}
      operation={values => { if (data.generators.length >= 10) throw new FormInputError('A server can have at most 10 generators. Remove one first'); return { type: 'generator-add',channelName: channelName(values.channelName),categoryId: categoryValue(values.categoryId),template: templateValue(values.template),userLimit: limitValue(values.userLimit),region: regionValue(values.region) } }}
      fields={(values,edit,disabled) => fields(values,edit,disabled,'New generator name')} />
    {data.generators.map(generator => { const name = nameOf(generator.channelId); return <details key={generator.channelId}><summary>{label(generator.channelId)}</summary><div className="role-section">
      <ConfigForm<'voice'> {...common} draftKey={`generator:${generator.channelId}`} title={`Generator ${name ?? generator.channelId}`} description="Room settings apply to rooms created after saving. A new name renames the generator channel"
        snapshot={{ revision,values: { channelName: name ?? '',categoryId: generator.categoryId ?? '',template: generator.template,userLimit: generator.userLimit === null ? '' : String(generator.userLimit),region: generator.region ?? '' } }}
        operation={values => { const renamed = typeof values.channelName === 'string' && values.channelName.trim() && values.channelName.trim() !== name ? { channelName: channelName(values.channelName) } : {}
          return { type: 'generator-set',channelId: generator.channelId,expectedRevision: generator.revision,patch: { ...renamed,categoryId: categoryValue(values.categoryId),template: templateValue(values.template),userLimit: limitValue(values.userLimit),region: regionValue(values.region) } } }}
        fields={(values,edit,disabled) => fields(values,edit,disabled,'Generator name')} />
      <ConfigForm<'voice'> {...common} draftKey={`generator-remove:${generator.channelId}`} title={`Remove generator ${name ?? generator.channelId}`} description="The channel stays as an ordinary voice channel. Existing rooms are still deleted once they are empty" submitLabel="Remove generator"
        snapshot={{ revision,values: { confirm: false },context: generator.revision }}
        operation={values => { if (!values.confirm) throw new FormInputError('Confirm generator removal'); return { type: 'generator-remove',channelId: generator.channelId,expectedRevision: generator.revision } }}
        fields={(values,edit,disabled) => <label><input type="checkbox" checked={Boolean(values.confirm)} disabled={disabled} onChange={event => edit('confirm',event.target.checked)} />Confirm generator removal</label>} />
    </div></details> })}
  </div>
}
