import type { MemberAccessLists } from '@neonflux/backend/contracts'
import type { DashboardConfigurationJob, DashboardConfigurationOperationMap } from '@neonflux/backend/dashboard-contracts'
import { ConfigForm } from './configuration-form'
import type { ConfigSectionProps } from './configuration-form'
import { IdList } from './configuration-fields'
import { idsValue, numberValue } from './configuration-values'
import type { FormValues } from './settings-form'
import { SearchPicker } from './search-picker'
import { publicationChannels, selectableRoles } from './catalog-options'

const ids = (value: string | boolean | undefined) => JSON.parse(String(value)) as string[]
const optionalNumber = (value: string | boolean | undefined, min: number, max: number, label: string) => typeof value === 'string' && value.trim() ? numberValue(value.trim(),min,max,label) : null

// Who may use a member feature. The same allow and block lists as the role picker, saved for this feature only
function AccessForm<F extends 'showcase' | 'profile'>(props: ConfigSectionProps<F> & { access: MemberAccessLists, what: string }) {
  const roles = selectableRoles(props.catalog), picks = { loading: props.catalogLoading,allowManual: props.catalogError,catalog: true }, { access } = props
  const remote: { configRevision: number, jobs: DashboardConfigurationJob[] } = props.remote
  return <ConfigForm<F> queue={props.queue} connected={props.connected} jobs={remote.jobs} title={`Who may ${props.what}`} description="A block always wins over an allow. With both allow lists empty, every member who is not blocked may use it"
    snapshot={{ revision: remote.configRevision,values: { allowRoleIds: JSON.stringify(access.allowRoleIds),blockRoleIds: JSON.stringify(access.blockRoleIds),allowUserIds: JSON.stringify(access.allowUserIds),blockUserIds: JSON.stringify(access.blockUserIds) } }}
    operation={(values: FormValues) => ({ type: 'access-set',allowRoleIds: idsValue(values.allowRoleIds,100,'allowed roles'),blockRoleIds: idsValue(values.blockRoleIds,100,'blocked roles'),allowUserIds: idsValue(values.allowUserIds,100,'allowed user IDs'),blockUserIds: idsValue(values.blockUserIds,100,'blocked user IDs') }) as DashboardConfigurationOperationMap[F]}
    fields={(values,edit,disabled) => <>
      <SearchPicker {...picks} label="Allowed roles" options={roles} multiple value={ids(values.allowRoleIds)} disabled={disabled} onChange={next => edit('allowRoleIds',JSON.stringify(next))} />
      <IdList label="Allowed user IDs" value={String(values.allowUserIds)} onChange={value => edit('allowUserIds',value)} disabled={disabled} max={100} />
      <SearchPicker {...picks} label="Blocked roles" options={roles} multiple value={ids(values.blockRoleIds)} disabled={disabled} onChange={next => edit('blockRoleIds',JSON.stringify(next))} />
      <IdList label="Blocked user IDs" value={String(values.blockUserIds)} onChange={value => edit('blockUserIds',value)} disabled={disabled} max={100} />
    </>} />
}

export function ShowcaseSettings(props: ConfigSectionProps<'showcase'>) {
  const { data: { settings,access },configRevision: revision,jobs } = props.remote
  return <div className="role-section">
    <ConfigForm<'showcase'> queue={props.queue} connected={props.connected} jobs={jobs} title="Showcases" description="Members post a title, text and up to three links on this website, and NeonFlux posts each one as an embed in the showcase channel. The server's automod word, domain, invite and deceptive link rules check every post and edit. Changes here and with !showcase in chat share one revision"
      snapshot={{ revision,values: { enabled: settings.enabled,channelId: settings.channelId ?? '',maxPerMember: settings.maxPerMember === null ? '' : String(settings.maxPerMember),intervalMinutes: settings.intervalMinutes === null ? '' : String(settings.intervalMinutes) } }}
      operation={values => ({ type: 'settings',enabled: Boolean(values.enabled),channelId: typeof values.channelId === 'string' && values.channelId ? values.channelId : null,
        maxPerMember: optionalNumber(values.maxPerMember,1,50,'a limit of 1 to 50 showcases'),intervalMinutes: optionalNumber(values.intervalMinutes,1,10080,'a wait of 1 to 10080 minutes') })}
      fields={(values,edit,disabled) => <>
        <label><input type="checkbox" checked={Boolean(values.enabled)} disabled={disabled} onChange={event => edit('enabled',event.target.checked)} />Showcases enabled</label>
        <SearchPicker catalog label="Showcase channel" options={publicationChannels(props.catalog)} loading={props.catalogLoading} allowManual={props.catalogError} value={values.channelId ? [String(values.channelId)] : []} disabled={disabled} onChange={next => edit('channelId',next[0] ?? '')} />
        <p className="field-help">NeonFlux needs View Channel, Send Messages and Embed Links there. Existing showcases stay in the channel they were posted in</p>
        <label>Showcases per member<input type="number" inputMode="numeric" step={1} min={1} max={50} value={String(values.maxPerMember)} disabled={disabled} onChange={event => edit('maxPerMember',event.target.value)} /></label>
        <p className="field-help">Leave empty for no limit. Only showcases that still exist count</p>
        <label>Minutes between a member's showcases<input type="number" inputMode="numeric" step={1} min={1} max={10080} value={String(values.intervalMinutes)} disabled={disabled} onChange={event => edit('intervalMinutes',event.target.value)} /></label>
        <p className="field-help">Leave empty for no wait. The wait counts from the member's newest showcase that still exists</p>
      </>} />
    <AccessForm<'showcase'> {...props} access={access} what="post showcases" />
  </div>
}

export function ProfileSettings(props: ConfigSectionProps<'profile'>) {
  const { data: { settings,access },configRevision: revision,jobs } = props.remote
  return <div className="role-section">
    <ConfigForm<'profile'> queue={props.queue} connected={props.connected} jobs={jobs} title="Profiles" description="Members write a short bio, add up to three links and pick an accent color on this website. !profile shows a member's profile as an embed, and the server's automod word, domain, invite and deceptive link rules check it. Changes here and with !profile in chat share one revision"
      snapshot={{ revision,values: { enabled: settings.enabled,cooldownSeconds: settings.cooldownSeconds === null ? '' : String(settings.cooldownSeconds) } }}
      operation={values => ({ type: 'settings',enabled: Boolean(values.enabled),cooldownSeconds: optionalNumber(values.cooldownSeconds,1,3600,'a cooldown of 1 to 3600 seconds') })}
      fields={(values,edit,disabled) => <>
        <label><input type="checkbox" checked={Boolean(values.enabled)} disabled={disabled} onChange={event => edit('enabled',event.target.checked)} />Profiles enabled</label>
        <label>Seconds between a member's !profile commands<input type="number" inputMode="numeric" step={1} min={1} max={3600} value={String(values.cooldownSeconds)} disabled={disabled} onChange={event => edit('cooldownSeconds',event.target.value)} /></label>
        <p className="field-help">Leave empty for no cooldown</p>
      </>} />
    <AccessForm<'profile'> {...props} access={access} what="use profiles" />
  </div>
}
