import type { ConvexReactClient } from 'convex/react'
import { useState } from 'react'
import type { PublishingContent, RolesMapping, RolesPanel, RolesSettings } from '@neonflux/backend/contracts'
import type { DashboardCatalog, DashboardSnapshot, DashboardRoleOperation } from '@neonflux/backend/dashboard-contracts'
import { dashboardApi } from './dashboard-api'
import { FormInputError, SettingsForm } from './settings-form'
import type { FormSaveResult, FormValues } from './settings-form'
import { SearchPicker } from './search-picker'
import { MessageBuilder } from './message-builder'
import { validateMessage } from './message-content'
import { publicationChannels, selectableRoles } from './catalog-options'

type RoleSection = 'reaction' | 'autorole' | 'verification'
interface Props { section: RoleSection, remote: DashboardSnapshot, sessionToken: string, client: ConvexReactClient, connected: boolean, catalog?: DashboardCatalog, catalogLoading?: boolean, catalogError?: boolean }
const idPattern = /^[1-9]\d{0,18}$/
function parseIds(text: string): string[] {
  const ids = JSON.parse(text) as unknown
  if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => typeof id !== 'string' || !idPattern.test(id) || BigInt(id) > 9223372036854775807n) || new Set(ids).size !== ids.length) throw new FormInputError('Choose up to twenty distinct roles')
  return ids as string[]
}
function parseMappings(text: string, section: RoleSection): RolesMapping[] {
  const rows = JSON.parse(text) as RolesMapping[]
  if (rows.length < 1 || rows.length > (section === 'verification' ? 1 : 20)) throw new FormInputError(section === 'verification' ? 'Verification needs exactly one access role mapping' : 'Choose one to twenty role mappings')
  for (const row of rows) {
    if (!row.emoji.trim() || !idPattern.test(row.roleId) || BigInt(row.roleId) > 9223372036854775807n) throw new FormInputError('Each mapping needs an emoji and a role')
    parseIds(JSON.stringify(row.prerequisiteRoleIds)); parseIds(JSON.stringify(row.exclusionRoleIds))
  }
  return rows
}
type RoleReservation = NonNullable<RolesSettings['reservations']>[number]
function parseReservations(text: string): RoleReservation[] {
  const rows = JSON.parse(text) as RoleReservation[]
  if (rows.length > 100) throw new FormInputError('Reserve roles for up to one hundred users')
  const users = new Set<string>()
  return rows.map(row => {
    const userId = row.userId.trim()
    if (!idPattern.test(userId) || BigInt(userId) > 9223372036854775807n) throw new FormInputError('Each reservation needs a valid user ID')
    if (users.has(userId)) throw new FormInputError('Each user can have only one role reservation')
    users.add(userId)
    const roleIds = parseIds(JSON.stringify(row.roleIds))
    if (!roleIds.length) throw new FormInputError('Choose at least one role for each reserved user')
    return { userId, roleIds }
  })
}
function settingsPatch(draft: FormValues, settings: RolesSettings, section: RoleSection): Extract<DashboardRoleOperation,{ type: 'settings' }>['patch'] {
  const proposed = { ...(section === 'reaction' ? { panelsEnabled: Boolean(draft.enabled) } : section === 'autorole' ? { autoroleEnabled: Boolean(draft.enabled), humansOnly: Boolean(draft.humansOnly), autoroleIds: parseIds(String(draft.roleIds)), reservations: parseReservations(String(draft.reservations)) } : { verificationEnabled: Boolean(draft.enabled) }) }
  if ('autoroleIds' in proposed && new Set([...(proposed.autoroleIds ?? []),...(proposed.reservations ?? []).flatMap(reservation => reservation.roleIds)]).size > 1000) throw new FormInputError('Choose up to one thousand distinct roles across defaults and reservations')
  const patch = Object.fromEntries(Object.entries(proposed).filter(([key,value]) => JSON.stringify(value) !== JSON.stringify(settings[key as keyof RolesSettings] ?? (key === 'reservations' ? [] : false))))
  if (!Object.keys(patch).length) throw new FormInputError('These values match the current settings')
  return patch
}
const newMapping = (): RolesMapping => ({ emoji: '✅',roleId: '',prerequisiteRoleIds: [],exclusionRoleIds: [] })
function panelValues(panel?: RolesPanel): FormValues {
  return { name: panel?.name ?? '', mappings: JSON.stringify(panel?.mappings ?? [newMapping()]), enabled: panel?.enabled ?? true, exclusive: panel?.exclusive ?? false, publish: false, channelId: '', content: JSON.stringify({ content: '' }) }
}
function panelPatch(draft: FormValues, panel: RolesPanel, section: RoleSection) {
  const mappings = parseMappings(String(draft.mappings), section)
  const patch: { enabled?: boolean, exclusive?: boolean, mappings?: RolesMapping[] } = {}
  if (Boolean(draft.enabled) !== panel.enabled) patch.enabled = Boolean(draft.enabled)
  if (Boolean(draft.exclusive) !== panel.exclusive) patch.exclusive = Boolean(draft.exclusive)
  if (JSON.stringify(mappings) !== JSON.stringify(panel.mappings)) patch.mappings = mappings
  if (!Object.keys(patch).length) patch.enabled = panel.enabled
  return patch
}

export function RoleSettings(props: Props) {
  const { section, remote, sessionToken, client, connected } = props
  const { settings, panels: livePanels, revision, jobs } = remote.roles
  const [remembered,setRemembered] = useState({ source: livePanels,panels: livePanels })
  const currentNames = new Set(livePanels.map(panel => panel.name))
  const missing = remembered.panels.filter(panel => !currentNames.has(panel.name))
  const panels = [...livePanels,...missing]
  if (remembered.source !== livePanels) setRemembered({ source: livePanels,panels })
  const missingNames = new Set(missing.map(panel => panel.name))
  const names = { reaction: 'Reaction roles', autorole: 'Autorole', verification: 'Verification' }
  async function queue(operation: DashboardRoleOperation, expectedRevision: number, publication?: { channelId: string, content: PublishingContent }): Promise<FormSaveResult> {
    const result = await client.action(dashboardApi.queueRole, { sessionToken, serverId: remote.serverId, section, expectedRevision, operation, ...(publication ? { publication } : {}) })
    if (result.conflict) return { saved: false, conflict: true, revision: result.revision }
    if (!result.queued || !result.jobId) throw new Error('Change not queued')
    return { queued: true, jobId: result.jobId, revision: result.revision }
  }
  const pickerProps = { options: selectableRoles(props.catalog),loading: props.catalogLoading,allowManual: props.catalogError }
  const values: FormValues = { ...(section === 'reaction' ? { enabled: settings.panelsEnabled } : section === 'autorole' ? { enabled: settings.autoroleEnabled, humansOnly: settings.humansOnly, roleIds: JSON.stringify(settings.autoroleIds), reservations: JSON.stringify(settings.reservations ?? []) } : { enabled: settings.verificationEnabled }) }
  const pending = jobs.some(job => job.state === 'queued' || job.state === 'configured')
  return <div className="role-section">
    <SettingsForm title={names[section]} description={section === 'reaction' ? 'Let members choose safe roles by reacting to published panels' : section === 'autorole' ? 'Assign default and reserved roles when members join or rejoin. Reservations stay configured until removed' : 'Use a published reaction panel to request an access role'} snapshot={{ revision, values }} connected={connected} jobs={jobs} resetAfterApplied submitLabel="Request change" save={(draft,expectedRevision) => queue({ type: 'settings', patch: settingsPatch(draft,settings,section) }, expectedRevision)} fields={(draft,edit,disabled) => <>
      <label><input type="checkbox" checked={Boolean(draft.enabled)} disabled={disabled} onChange={event => edit('enabled',event.target.checked)} />Enabled</label>
      {section === 'autorole' && <><label><input type="checkbox" checked={Boolean(draft.humansOnly)} disabled={disabled} onChange={event => edit('humansOnly',event.target.checked)} />Human accounts only</label><SearchPicker label="Roles for new members" {...pickerProps} multiple value={JSON.parse(String(draft.roleIds)) as string[]} disabled={disabled} onChange={ids => edit('roleIds',JSON.stringify(ids))} /><p className="field-help">Up to twenty default roles. The bot checks native permissions and hierarchy before applying changes</p><ReservationFields values={draft} edit={edit} disabled={disabled} catalog={props.catalog} catalogLoading={props.catalogLoading} catalogError={props.catalogError} /></>}
      {section === 'autorole' && <p className="field-help">Configured verification also gates reserved roles. Existing role ownership is retained after a configuration change. The existing <code>{remote.general.prefix}autorole history</code> and <code>{remote.general.prefix}autorole retire &lt;settings-revision&gt;</code> commands remain available. Current settings revision: {settings.revision}</p>}
    </>} />
    {section !== 'autorole' && <>
      {missing.some(panel => panel.kind === (section === 'reaction' ? 'reaction' : 'verification')) && <div className="notice" role="alert"><p>A panel was removed elsewhere. Its form and draft are kept below for copying, with saves disabled</p><button type="button" className="secondary" onClick={() => setRemembered({ source: livePanels,panels: livePanels })}>Dismiss removed panels and their drafts</button></div>}
      {panels.filter(panel => panel.kind === (section === 'reaction' ? 'reaction' : 'verification')).map(panel => <SettingsForm key={panel.name} title={`Panel: ${panel.name}`} description={panel.withdrawing ? 'This panel is being withdrawn. Further changes wait for the withdrawal to finish' : panel.published ? `Published in ${props.catalog?.channels.find(channel => channel.id === panel.published!.channelId)?.name ?? `channel ${panel.published.channelId}`}. Changes to mappings or exclusive selection require publishing a new panel message` : 'Configured but not yet published. Choose a channel and request publication to make this panel available'} snapshot={{ revision, values: panelValues(panel) }} connected={connected && !panel.withdrawing && !missingNames.has(panel.name)} jobs={jobs} resetAfterApplied submitLabel="Request panel change" save={(draft,expectedRevision) => queue({ type: 'panel-update', name: panel.name, expectedRevision: panel.revision, patch: panelPatch(draft,panel,section) }, expectedRevision, publication(draft))} fields={(draft,edit,disabled) => <PanelFields values={draft} edit={edit} disabled={disabled || panel.withdrawing} existing section={section} catalog={props.catalog} catalogLoading={props.catalogLoading} catalogError={props.catalogError} />} />)}
      {(section === 'reaction' ? livePanels.filter(panel => panel.kind === 'reaction').length < 50 : !livePanels.some(panel => panel.kind === 'verification')) && <SettingsForm title={section === 'reaction' ? 'Create a reaction panel' : 'Create a verification panel'} description="Configure the role mapping and optionally publish it to a channel. Publication waits for the running bot's fresh native checks" snapshot={{ revision, values: panelValues() }} connected={connected} jobs={jobs} resetAfterApplied submitLabel="Create panel" save={(draft,expectedRevision) => {
        const name = String(draft.name).trim().toLowerCase()
        if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) throw new FormInputError('Use a panel name with up to thirty-two lowercase letters, digits, underscores or hyphens')
        return queue({ type: 'panel-create', name, kind: section === 'reaction' ? 'reaction' : 'verification', mappings: parseMappings(String(draft.mappings),section), exclusive: Boolean(draft.exclusive) }, expectedRevision, publication(draft))
      }} fields={(draft,edit,disabled) => <PanelFields values={draft} edit={edit} disabled={disabled} section={section} catalog={props.catalog} catalogLoading={props.catalogLoading} catalogError={props.catalogError} />} />}
    </>}
    <section className="panel"><h2>Recent requests</h2>{pending && <p role="status">A role configuration request is pending. Further role changes wait until it finishes</p>}{jobs.filter(job => job.section === section).length === 0 ? <p className="muted">No recent requests for this section</p> : <ul className="request-list">{jobs.filter(job => job.section === section).map(job => <li key={job.id}><strong>{job.operation.type === 'settings' ? 'Settings' : job.operation.name}</strong>: {job.state === 'queued' ? 'Pending bot checks' : job.state === 'configured' ? 'Configured, publication pending' : job.state === 'applied' ? 'Applied' : job.state === 'conflict' ? 'Changed elsewhere' : 'Failed'}{job.error && <p className="error-text">{job.error}</p>}</li>)}</ul>}<p className="muted">The bot must be running. Requests expire after two minutes. Native permissions, role safety and provider delivery can prevent a change from completing</p></section>
  </div>
}
function ReservationFields({ values,edit,disabled,catalog,catalogLoading,catalogError }: { values: FormValues, edit: (key: string,value: string | boolean) => void, disabled: boolean, catalog?: DashboardCatalog, catalogLoading?: boolean, catalogError?: boolean }) {
  const reservations = JSON.parse(String(values.reservations)) as RoleReservation[]
  const change = (rows: RoleReservation[]) => edit('reservations',JSON.stringify(rows))
  const patch = (index: number,row: Partial<RoleReservation>) => change(reservations.map((reservation,i) => i === index ? { ...reservation,...row } : reservation))
  return <>
    <h3>Reserved user roles</h3>
    <p className="muted">Enter an exact user ID, even if the user has not joined yet. On their next join or rejoin, they receive these roles in addition to the default roles. Autorole must be enabled, and the human accounts setting applies to reservations too</p>
    <p className="field-help">Saving a reservation does not assign roles immediately. Removing one affects future joins and does not remove roles already assigned</p>
    {reservations.length === 0 && <p className="muted">No reserved users configured</p>}
    {reservations.map((reservation,index) => <fieldset className="mapping-row" key={index}><legend>Reservation {index + 1}</legend><label>Reserved user ID {index + 1}<input required inputMode="numeric" pattern="[1-9][0-9]{0,18}" maxLength={19} value={reservation.userId} disabled={disabled} onChange={event => patch(index,{ userId: event.target.value })} /></label><SearchPicker label={`Roles for reserved user ${index + 1}`} options={selectableRoles(catalog)} loading={catalogLoading} allowManual={catalogError} multiple disabled={disabled} value={reservation.roleIds} onChange={roleIds => patch(index,{ roleIds })} /><button type="button" className="secondary" disabled={disabled} onClick={() => change(reservations.filter((_,i) => i !== index))}>Remove reservation {index + 1}</button></fieldset>)}
    <button type="button" className="secondary" disabled={disabled || reservations.length >= 100} onClick={() => change([...reservations,{ userId: '',roleIds: [] }])}>Add reserved user</button>
    <p className="field-help">Up to one hundred users, with one to twenty roles per user and one thousand distinct roles across defaults and reservations. Request a change below to save additions, edits or removals</p>
  </>
}
function publication(values: FormValues): { channelId: string, content: PublishingContent } | undefined {
  if (!values.publish) return
  const channelId = String(values.channelId).trim()
  if (!idPattern.test(channelId) || BigInt(channelId) > 9223372036854775807n) throw new FormInputError('Choose a publication channel')
  return { channelId,content: validateMessage(JSON.parse(String(values.content))) }
}
function PanelFields({ values,edit,disabled,existing,section,catalog,catalogLoading,catalogError }: { values: FormValues, edit: (key: string,value: string | boolean) => void, disabled: boolean, existing?: boolean, section: RoleSection, catalog?: DashboardCatalog, catalogLoading?: boolean, catalogError?: boolean }) {
  const mappings = JSON.parse(String(values.mappings)) as RolesMapping[]
  const changeMappings = (rows: RolesMapping[]) => edit('mappings',JSON.stringify(rows))
  const patch = (index: number,row: Partial<RolesMapping>) => changeMappings(mappings.map((mapping,i) => i === index ? { ...mapping,...row } : mapping))
  return <>
    {!existing && <label>Panel name<input required maxLength={32} value={String(values.name)} disabled={disabled} onChange={event => edit('name',event.target.value)} /></label>}
    {existing && <label><input type="checkbox" checked={Boolean(values.enabled)} disabled={disabled} onChange={event => edit('enabled',event.target.checked)} />Panel enabled</label>}
    <h3>{section === 'verification' ? 'Access role mapping' : 'Role mappings'}</h3>
    {mappings.map((mapping,index) => <fieldset className="mapping-row" key={index}><legend>Mapping {index + 1}</legend><label>Emoji for mapping {index + 1}<input required maxLength={128} disabled={disabled} value={mapping.emoji} onChange={event => patch(index,{ emoji: event.target.value })} /></label><SearchPicker label={`Role for mapping ${index + 1}`} options={selectableRoles(catalog)} loading={catalogLoading} allowManual={catalogError} disabled={disabled} value={mapping.roleId ? [mapping.roleId] : []} onChange={ids => patch(index,{ roleId: ids[0] ?? '' })} /><details><summary>Prerequisites and exclusions</summary><SearchPicker label={`Required roles for mapping ${index + 1}`} options={selectableRoles(catalog)} loading={catalogLoading} allowManual={catalogError} disabled={disabled} multiple value={mapping.prerequisiteRoleIds} onChange={ids => patch(index,{ prerequisiteRoleIds: ids })} /><SearchPicker label={`Excluded roles for mapping ${index + 1}`} options={selectableRoles(catalog)} loading={catalogLoading} allowManual={catalogError} disabled={disabled} multiple value={mapping.exclusionRoleIds} onChange={ids => patch(index,{ exclusionRoleIds: ids })} /></details>{section !== 'verification' && <button type="button" className="secondary" disabled={disabled || mappings.length <= 1} onClick={() => changeMappings(mappings.filter((_,i) => i !== index))}>Remove mapping {index + 1}</button>}</fieldset>)}
    {section === 'reaction' && <><button type="button" className="secondary" disabled={disabled || mappings.length >= 20} onClick={() => changeMappings([...mappings,newMapping()])}>Add role mapping</button><label><input type="checkbox" checked={Boolean(values.exclusive)} disabled={disabled} onChange={event => edit('exclusive',event.target.checked)} />Allow only one role from this panel</label></>}
    <label><input type="checkbox" checked={Boolean(values.publish)} disabled={disabled} onChange={event => edit('publish',event.target.checked)} />{existing ? 'Publish a new panel message' : 'Publish this panel'}</label>
    {values.publish && <><SearchPicker label="Publication channel" options={publicationChannels(catalog)} loading={catalogLoading} allowManual={catalogError} disabled={disabled} value={values.channelId ? [String(values.channelId)] : []} onChange={ids => edit('channelId',ids[0] ?? '')} /><MessageBuilder value={String(values.content)} disabled={disabled} onChange={content => edit('content',content)} /><p className="muted">Choose a channel where the bot can send messages and manage panel reactions. Existing published messages are retained</p></>}
  </>
}
