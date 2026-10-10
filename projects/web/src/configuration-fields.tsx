import type { PublishingKind } from '@neonflux/backend/contracts'
import type { TemplateOption } from './configuration-form'
import { SearchPicker } from './search-picker'

interface Field { label: string, value: string, onChange: (value: string) => void, disabled?: boolean }
export function NumberField({ label,value,onChange,disabled,min,max,required = true }: Field & { min: number, max: number, required?: boolean }) {
  return <label>{label}<input type="number" inputMode="numeric" step={1} required={required} min={min} max={max} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} /></label>
}
export function ChoiceField({ label,value,onChange,disabled,options }: Field & { options: ReadonlyArray<{ value: string, label: string }> }) {
  return <label>{label}<select value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
}
function ListField({ label,value,onChange,disabled,max,maxLength,ids = false }: Field & { max: number, maxLength: number, ids?: boolean }) {
  const rows = JSON.parse(value || '[]') as string[]
  const change = (next: string[]) => onChange(JSON.stringify(next))
  return <fieldset className="mapping-row"><legend>{label}</legend>
    {rows.map((row,index) => <div className="list-row" key={index}><label>{label} {index + 1}<input required maxLength={maxLength} inputMode={ids ? 'numeric' : undefined} value={row} disabled={disabled} onChange={event => change(rows.map((current,i) => i === index ? event.target.value : current))} /></label><button type="button" className="secondary" disabled={disabled} onClick={() => change(rows.filter((_,i) => i !== index))}>Remove {label.toLowerCase()} {index + 1}</button></div>)}
    {!rows.length && <p className="muted">No {label.toLowerCase()} configured</p>}
    <button type="button" className="secondary" disabled={disabled || rows.length >= max} onClick={() => change([...rows,''])}>Add {label.toLowerCase()}</button>
    <p className="field-help">Up to {max} entries{ids ? '. Use exact IDs' : ''}</p>
  </fieldset>
}
export function IdList(props: Field & { max: number }) { return <ListField {...props} maxLength={19} ids /> }
export function StringList(props: Field & { max: number, maxLength: number }) { return <ListField {...props} /> }

interface TemplateBinding { kind: PublishingKind, name: string, revision: number }
export function TemplatePicker({ label,value,onChange,disabled,templates,loading = false,error = false,kinds = ['template'],loadMore,hasMore = false }: Field & { templates?: TemplateOption[] | undefined, loading?: boolean, error?: boolean, kinds?: PublishingKind[], loadMore?: () => void, hasMore?: boolean }) {
  const selected = value ? JSON.parse(value) as TemplateBinding : undefined
  const key = (row: TemplateBinding) => JSON.stringify({ kind: row.kind,name: row.name,revision: row.revision })
  const options = (templates ?? []).filter(row => kinds.includes(row.kind)).map(row => ({ id: key(row),name: `${row.name} (${row.kind}, revision ${row.revision})` }))
  const current = selected ? templates?.find(row => row.kind === selected.kind && row.name === selected.name) : undefined
  if (selected && !options.some(option => option.id === key(selected))) options.unshift({ id: key(selected),name: `${selected.name} (${selected.kind}, saved revision ${selected.revision})` })
  return <div><SearchPicker label={label} options={options} value={selected ? [key(selected)] : []} onChange={values => onChange(values[0] ?? '')} disabled={disabled} loading={loading && !selected} />
    <p className="field-help">Uses the selected saved revision. Later template edits do not silently update this configuration</p>
    {current && selected && current.revision > selected.revision && <p className="notice" role="status">A newer template is available: Revision {current.revision}. Your saved revision is kept. Choose the new revision explicitly to refresh it</p>}
    {error && <p className="notice error" role="status">Template choices are unavailable. Your saved selection is kept</p>}
    {hasMore && loadMore && <button type="button" className="secondary" disabled={disabled || loading} onClick={loadMore}>Load more templates</button>}
  </div>
}

const zones = ['UTC',...Intl.supportedValuesOf('timeZone')].map(zone => ({ id: zone,name: zone }))
export function CalendarFields({ value,onChange,disabled,event = false }: { value: string, onChange: (value: string) => void, disabled?: boolean, event?: boolean }) {
  const calendar = JSON.parse(value || '{}') as Record<string,unknown>
  const recurrence = calendar.recurrence && typeof calendar.recurrence === 'object' ? calendar.recurrence as Record<string,unknown> : { type: 'none' }
  const patch = (key: string,next: unknown) => onChange(JSON.stringify({ ...calendar,[key]: next }))
  return <fieldset className="mapping-row"><legend>Dates and timezone</legend>
    <label>Local date and time<input required type="datetime-local" step={60} value={String(calendar.localMinute ?? '')} disabled={disabled} onChange={input => patch('localMinute',input.target.value)} /></label>
    <SearchPicker label="Timezone" options={zones} value={calendar.zone ? [String(calendar.zone)] : []} disabled={disabled} onChange={selected => patch('zone',selected[0] ?? '')} />
    <ChoiceField label="Repeated local time" value={String(calendar.fold ?? 'reject')} disabled={disabled} options={[{ value: 'reject',label: 'Reject ambiguous time' },{ value: 'earlier',label: 'Earlier offset' },{ value: 'later',label: 'Later offset' }]} onChange={fold => patch('fold',fold)} />
    {event && <NumberField label="Duration (minutes)" value={String(calendar.durationMinutes ?? 60)} min={1} max={10080} disabled={disabled} onChange={duration => patch('durationMinutes',duration)} />}
    <ChoiceField label="Repeat" value={String(recurrence.type ?? 'none')} disabled={disabled} options={[{ value: 'none',label: 'Once' },{ value: 'daily',label: 'Daily' },{ value: 'weekly',label: 'Weekly' }]} onChange={type => patch('recurrence',type === 'none' ? { type: 'none' } : { type,interval: recurrence.interval ?? 1,count: recurrence.count ?? 2 })} />
    {recurrence.type !== 'none' && <><NumberField label="Repeat interval" value={String(recurrence.interval ?? 1)} min={1} max={12} disabled={disabled} onChange={interval => patch('recurrence',{ ...recurrence,interval })} /><NumberField label="Total occurrences" value={String(recurrence.count ?? 2)} min={1} max={26} disabled={disabled} onChange={count => patch('recurrence',{ ...recurrence,count })} /></>}
    <p className="field-help">Dates stay in the selected timezone. The bot validates daylight-saving gaps and repeated times before applying them. At most 26 dates within 180 days</p>
  </fieldset>
}
