import { ConfigForm } from './configuration-form'
import type { ConfigSectionProps } from './configuration-form'
import { numberValue } from './configuration-values'
import { FormInputError } from './settings-form'
import type { FormValues } from './settings-form'
import { SearchPicker } from './search-picker'
import { publicationChannels } from './catalog-options'

const STICKY_LIMIT = 5
function contentValue(value: string | boolean | undefined) {
  const text = typeof value === 'string' ? value : ''
  if (!text.trim() || text.length > 2000) throw new FormInputError('Use sticky text with 1 to 2000 characters')
  return text
}
const intervalValue = (value: string | boolean | undefined) => numberValue(value,10,3600,'a repost interval in seconds')

export function StickySettings(props: ConfigSectionProps<'sticky'>) {
  const { data,configRevision: revision,jobs } = props.remote, common = { queue: props.queue,connected: props.connected,jobs }
  const channels = publicationChannels(props.catalog), nameOf = (id: string) => props.catalog?.channels.find(channel => channel.id === id)?.name ?? `Channel ${id}`
  const fields = (values: FormValues,edit: (key: string,value: string | boolean) => void,disabled: boolean) => <>
    <label>Sticky text<textarea required maxLength={2000} rows={4} value={String(values.content)} disabled={disabled} onChange={event => edit('content',event.target.value)} /></label>
    <label>Repost interval in seconds<input type="number" inputMode="numeric" step={1} min={10} max={3600} value={String(values.intervalSeconds)} disabled={disabled} onChange={event => edit('intervalSeconds',event.target.value)} /></label>
    <p className="field-help">After members post, NeonFlux sends the text again and deletes its previous copy, at most once per interval, so a busy channel stays readable. Mentions in the text do not notify anyone</p>
  </>
  const used = new Set(data.stickies.map(sticky => sticky.channelId))
  return <div className="role-section">
    <section className="panel"><h2>Sticky messages</h2><p className="muted">Sticky messages {data.stickies.length}/{STICKY_LIMIT}. Each keeps one bot message at the bottom of its channel. The chat command !sticky changes the same settings</p></section>
    {data.stickies.map(sticky => <details key={sticky.channelId}><summary>{nameOf(sticky.channelId)}: Every {sticky.intervalSeconds} seconds at most</summary><div className="role-section">
      <ConfigForm<'sticky'> {...common} draftKey={`sticky:${sticky.channelId}`} title={`Sticky in ${nameOf(sticky.channelId)}`} description="Saving posts the new text at once and deletes the previous copy"
        snapshot={{ revision,values: { content: sticky.content,intervalSeconds: String(sticky.intervalSeconds) } }}
        operation={values => ({ type: 'set',channelId: sticky.channelId,content: contentValue(values.content),intervalSeconds: intervalValue(values.intervalSeconds) })} fields={fields} />
      <ConfigForm<'sticky'> {...common} draftKey={`sticky-remove:${sticky.channelId}`} title={`Remove the sticky in ${nameOf(sticky.channelId)}`} description="NeonFlux stops reposting and deletes its last copy" submitLabel="Remove sticky"
        snapshot={{ revision,values: { confirm: false },context: sticky.revision }}
        operation={values => { if (!values.confirm) throw new FormInputError('Confirm the sticky removal'); return { type: 'remove',channelId: sticky.channelId } }}
        fields={(values,edit,disabled) => <label><input type="checkbox" checked={Boolean(values.confirm)} disabled={disabled} onChange={event => edit('confirm',event.target.checked)} />Confirm removing this sticky</label>} />
    </div></details>)}
    {data.stickies.length < STICKY_LIMIT ? <ConfigForm<'sticky'> {...common} title="Add sticky message" description="Choose a text or announcement channel. NeonFlux needs View Channel and Send Messages there" submitLabel="Add sticky"
      snapshot={{ revision,values: { channelId: '',content: '',intervalSeconds: '30' } }}
      operation={values => {
        const channelId = typeof values.channelId === 'string' ? values.channelId : ''
        if (!channelId) throw new FormInputError('Choose a channel')
        if (used.has(channelId)) throw new FormInputError('This channel already has a sticky message. Change it above')
        return { type: 'set',channelId,content: contentValue(values.content),intervalSeconds: intervalValue(values.intervalSeconds) }
      }}
      fields={(values,edit,disabled) => <>
        <SearchPicker catalog label="Channel" options={channels} loading={props.catalogLoading} allowManual={props.catalogError} value={values.channelId ? [String(values.channelId)] : []} disabled={disabled} onChange={ids => edit('channelId',ids[0] ?? '')} />
        {fields(values,edit,disabled)}
      </>} /> : <section className="panel"><h2>Add sticky message</h2><p className="muted">This server has the maximum of {STICKY_LIMIT} sticky messages. Remove one to add another</p></section>}
  </div>
}
