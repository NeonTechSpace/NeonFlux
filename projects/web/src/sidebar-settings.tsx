import type { DashboardCatalog } from '@neonflux/backend/dashboard-contracts'
import { ConfigForm } from './configuration-form'
import type { ConfigSectionProps } from './configuration-form'
import { idValue } from './configuration-values'
import { FormInputError } from './settings-form'
import { SearchPicker } from './search-picker'

const categories = (catalog?: DashboardCatalog) => catalog?.channels.filter(channel => channel.type === 4) ?? []
function linkName(value: string | boolean | undefined) {
  const parsed = typeof value === 'string' ? value.trim() : ''
  if (!parsed.replace(/[\u000c‮]/g,'') || parsed.length > 100) throw new FormInputError('Use a link name with 1 to 100 characters')
  return parsed
}

export function SidebarSettings(props: ConfigSectionProps<'sidebar'>) {
  const { data,configRevision: revision,jobs } = props.remote, common = { queue: props.queue,connected: props.connected,jobs }, link = data.link
  const name = link ? props.catalog?.channels.find(channel => channel.id === link.channelId)?.name : undefined
  const nameField = (value: string | boolean | undefined,edit: (key: string,value: string | boolean) => void,disabled: boolean) =>
    <label>Link name<input required maxLength={100} value={String(value)} disabled={disabled} onChange={event => edit('name',event.target.value)} /></label>
  return <div className="role-section">
    <section className="panel"><h2>Dashboard link</h2><p className="muted">A link channel in the server sidebar that opens this server's NeonFlux dashboard page. The bot creates the channel and needs Manage Channels, and the bot's website address must be set. The chat command !sidebar changes the same settings</p>
      {link && <p>Current link: {name ?? (props.catalogLoading ? 'Loading channel name' : `Channel ${link.channelId}. Refresh the channel list to show its name`)}</p>}</section>
    {link ? <>
      <ConfigForm<'sidebar'> {...common} title="Rename dashboard link" description="Renaming also points the link at the bot's current website address" submitLabel="Rename link"
        snapshot={{ revision,values: { name: name ?? '' },context: link.revision }}
        operation={values => ({ type: 'set',name: linkName(values.name) })} fields={(values,edit,disabled) => nameField(values.name,edit,disabled)} />
      <ConfigForm<'sidebar'> {...common} title="Remove dashboard link" description="NeonFlux deletes the link channel it created" submitLabel="Remove link"
        snapshot={{ revision,values: { confirm: false },context: link.revision }}
        operation={values => { if (!values.confirm) throw new FormInputError('Confirm the link removal'); return { type: 'remove' } }}
        fields={(values,edit,disabled) => <label><input type="checkbox" checked={Boolean(values.confirm)} disabled={disabled} onChange={event => edit('confirm',event.target.checked)} />Confirm removing the dashboard link</label>} />
    </> : <ConfigForm<'sidebar'> {...common} title="Add dashboard link" description="NeonFlux creates one link channel, at the top level or in the category you choose" submitLabel="Add link"
      snapshot={{ revision,values: { name: 'NeonFlux dashboard',categoryId: '',confirm: false } }}
      operation={values => { if (!values.confirm) throw new FormInputError('Confirm creating the link channel'); return { type: 'add',name: linkName(values.name),categoryId: typeof values.categoryId === 'string' && values.categoryId ? idValue(values.categoryId,'category') : null } }}
      fields={(values,edit,disabled) => <>
        <label><input type="checkbox" checked={Boolean(values.confirm)} disabled={disabled} onChange={event => edit('confirm',event.target.checked)} />Create the dashboard link channel</label>
        {nameField(values.name,edit,disabled)}
        <SearchPicker catalog label="Category" options={categories(props.catalog)} loading={props.catalogLoading} allowManual={props.catalogError} value={values.categoryId ? [String(values.categoryId)] : []} disabled={disabled} onChange={ids => edit('categoryId',ids[0] ?? '')} />
        <p className="field-help">Leave the category empty for a top-level link</p>
      </>} />}
  </div>
}
