import type { TemporaryRoleProblem } from '@neonflux/backend/contracts'
import { ConfigForm } from './configuration-form'
import type { ConfigSectionProps } from './configuration-form'
import { idsValue } from './configuration-values'
import { FormInputError } from './settings-form'
import type { FormValues } from './settings-form'
import { SearchPicker } from './search-picker'
import { selectableRoles } from './catalog-options'
import { localTime } from './time'

const units = { m: 60,h: 3600,d: 86400,w: 604800 } as const
/** A duration in the chat command's form, such as 30m, 12h, 7d or 2w, from 1 minute to 365 days. Empty means none */
export function durationValue(value: string | boolean | undefined, label: string): number | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!text) return null
  const match = /^(\d{1,6})([mhdw])$/.exec(text), seconds = match ? Number(match[1]) * units[match[2] as keyof typeof units] : 0
  if (seconds < 60 || seconds > 365 * 86400) throw new FormInputError(`Enter the ${label} as a number with m, h, d or w, such as 7d, from 1 minute to 365 days, or leave it empty`)
  return seconds
}
export function durationText(seconds: number | undefined) {
  if (seconds === undefined) return ''
  const found = Object.entries(units).reverse().find(([,size]) => seconds % size === 0)
  return found ? `${seconds / found[1]}${found[0]}` : `${Math.round(seconds / 60)}m`
}
const problems: Record<TemporaryRoleProblem,string> = {
  permission: 'NeonFlux lacks Manage Roles. Grant it to the NeonFlux role',
  role: 'The role ranks at or above the NeonFlux role or has staff permissions. Move the NeonFlux role above it',
  refused: 'Fluxer refused the removal',
  uncertain: 'Fluxer did not confirm the last role change, so NeonFlux does not repeat it. An Administrator runs !temprole reconcile @member',
  unavailable: 'NeonFlux could not read the member or the roles',
}

export function TemporaryRoleSettings(props: ConfigSectionProps<'temproles'>) {
  const { data,configRevision: revision,jobs } = props.remote, common = { queue: props.queue,connected: props.connected,jobs }
  const roleName = (id: string) => props.catalog?.roles.find(role => role.id === id)?.name ?? `Role ${id}`
  const roles = selectableRoles(props.catalog), picks = { loading: props.catalogLoading,allowManual: props.catalogError,catalog: true }
  const fields = (values: FormValues,edit: (key: string,value: string | boolean) => void,disabled: boolean) => <>
    <label>Default duration<input maxLength={8} value={String(values.defaultSeconds)} disabled={disabled} onChange={event => edit('defaultSeconds',event.target.value)} /></label>
    <label>Longest duration<input maxLength={8} value={String(values.maxSeconds)} disabled={disabled} onChange={event => edit('maxSeconds',event.target.value)} /></label>
    <p className="field-help">Use m, h, d or w, such as 30m, 12h, 7d or 2w. Without a default, staff name a duration for each grant, and without a longest duration grants last up to 365 days</p>
  </>
  const operation = (roleId: string) => (values: FormValues) => {
    const defaultSeconds = durationValue(values.defaultSeconds,'default duration'), maxSeconds = durationValue(values.maxSeconds,'longest duration')
    if (defaultSeconds !== null && maxSeconds !== null && defaultSeconds > maxSeconds) throw new FormInputError('The default duration is longer than the longest duration')
    return { type: 'role' as const,roleId,defaultSeconds,maxSeconds }
  }
  return <div className="role-section">
    <section className="panel" aria-labelledby="temporary-grants"><h2 id="temporary-grants">Active temporary roles</h2>
      <p className="muted">Staff with Manage Roles give a role for a set time in chat with !temprole add @member @role 7d, and renew, shorten or end it with !temprole set and remove. NeonFlux removes each role when its time ends</p>
      {data.grants.length ? <ul>{data.grants.map(grant => <li key={grant.grantId}>{`Member ${grant.userId}: ${roleName(grant.roleId)}, `}
        {grant.problem ? <strong>{`ended ${localTime(grant.endsAt)} and not removed yet. ${problems[grant.problem]}`}</strong> : `ends ${localTime(grant.endsAt)}`}</li>)}</ul> : <p>No temporary roles are active</p>}
      {data.more && <p className="muted">Showing the 100 that end first. !temprole list pages through all of them</p>}
    </section>
    {data.settings.roles.map(row => <details key={row.roleId}><summary>{`${roleName(row.roleId)}: Default ${durationText(row.defaultSeconds) || 'none'}, longest ${durationText(row.maxSeconds) || '365d'}`}</summary><div className="role-section">
      <ConfigForm<'temproles'> {...common} draftKey={`role:${row.roleId}`} title={`Defaults for ${roleName(row.roleId)}`} description="Clearing both durations removes this role's defaults"
        snapshot={{ revision,values: { defaultSeconds: durationText(row.defaultSeconds),maxSeconds: durationText(row.maxSeconds) } }} operation={operation(row.roleId)} fields={fields} />
    </div></details>)}
    <ConfigForm<'temproles'> {...common} title="Add role defaults" description={`Give a role a default duration, a longest duration or both. ${data.settings.roles.length} of 100 roles have defaults`} submitLabel="Save defaults"
      snapshot={{ revision,values: { roleId: '[]',defaultSeconds: '',maxSeconds: '' } }}
      operation={values => {
        const [roleId] = idsValue(values.roleId,1,'role')
        if (!roleId) throw new FormInputError('Choose a role')
        return operation(roleId)(values)
      }}
      fields={(values,edit,disabled) => <><SearchPicker {...picks} label="Role" options={roles} value={JSON.parse(String(values.roleId)) as string[]} disabled={disabled} onChange={next => edit('roleId',JSON.stringify(next))} />{fields(values,edit,disabled)}</>} />
  </div>
}
