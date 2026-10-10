import { ConfigForm } from './configuration-form'
import type { ConfigSectionProps } from './configuration-form'
import { idValue, numberValue } from './configuration-values'
import { SearchPicker } from './search-picker'
import { publicationChannels } from './catalog-options'

const channelValue = (value: string | boolean | undefined, label: string) => typeof value === 'string' && value ? idValue(value,label) : null

export function LfgSettings(props: ConfigSectionProps<'lfg'>) {
  const { data,configRevision: revision,jobs } = props.remote, settings = data.settings
  const nameOf = (id: string) => props.catalog?.channels.find(channel => channel.id === id)?.name ?? `Channel ${id}`
  // Only voice generators can give group rooms their category, member limit and region
  const generators = data.generators.map(id => ({ id,name: nameOf(id),type: 2 }))
  const picks = { catalog: true,loading: props.catalogLoading,allowManual: props.catalogError }
  return <div className="role-section">
    <section className="panel"><h2>Looking for group</h2><p className="muted">Members post a group with !lfg "activity" size and others join with !lfg join. A full group, or one its host starts, gets a temporary voice room from the chosen generator that only the group can see, and its members are mentioned once. Open groups now {data.open}</p></section>
    <ConfigForm<'lfg'> queue={props.queue} connected={props.connected} jobs={jobs} title="Group settings" description="The chat command !lfg config changes the same settings" submitLabel="Save settings"
      snapshot={{ revision,values: { enabled: settings.enabled,channelId: settings.channelId ?? '',generatorChannelId: settings.generatorChannelId ?? '',expiryMinutes: String(settings.expiryMinutes),
        maxSize: String(settings.maxSize),memberGroups: String(settings.memberGroups),serverGroups: String(settings.serverGroups) } }}
      operation={values => ({ type: 'settings',patch: { enabled: Boolean(values.enabled),channelId: channelValue(values.channelId,'group channel'),generatorChannelId: channelValue(values.generatorChannelId,'voice generator'),
        expiryMinutes: numberValue(values.expiryMinutes,10,1440,'how many minutes a group stays open'),maxSize: numberValue(values.maxSize,2,25,'the largest group size'),
        memberGroups: numberValue(values.memberGroups,1,5,'open groups per host'),serverGroups: numberValue(values.serverGroups,1,50,'open groups per server') } })}
      fields={(values,edit,disabled) => <>
        <label><input type="checkbox" checked={Boolean(values.enabled)} disabled={disabled} onChange={event => edit('enabled',event.target.checked)} />Looking for group is on</label>
        <SearchPicker {...picks} label="Group channel" options={publicationChannels(props.catalog)} value={values.channelId ? [String(values.channelId)] : []} disabled={disabled} onChange={ids => edit('channelId',ids[0] ?? '')} />
        <SearchPicker {...picks} label="Voice generator" options={generators} value={values.generatorChannelId ? [String(values.generatorChannelId)] : []} disabled={disabled} onChange={ids => edit('generatorChannelId',ids[0] ?? '')} />
        <label>Minutes a group stays open<input type="number" inputMode="numeric" step={1} min={10} max={1440} value={String(values.expiryMinutes)} disabled={disabled} onChange={event => edit('expiryMinutes',event.target.value)} /></label>
        <label>Largest group size<input type="number" inputMode="numeric" step={1} min={2} max={25} value={String(values.maxSize)} disabled={disabled} onChange={event => edit('maxSize',event.target.value)} /></label>
        <label>Open groups per host<input type="number" inputMode="numeric" step={1} min={1} max={5} value={String(values.memberGroups)} disabled={disabled} onChange={event => edit('memberGroups',event.target.value)} /></label>
        <label>Open groups per server<input type="number" inputMode="numeric" step={1} min={1} max={50} value={String(values.serverGroups)} disabled={disabled} onChange={event => edit('serverGroups',event.target.value)} /></label>
        <p className="field-help">NeonFlux posts one card per group in the group channel and needs View Channel and Send Messages there. Add a generator in Temporary voice first. Group sizes count the host, and a group with a start time stays open that many minutes after it</p>
      </>} />
  </div>
}
