import type { ResponseDefinition, ResponseKind } from '@neonflux/contracts/responses'
import type { DashboardResponseDefinition } from '@neonflux/backend/dashboard-contracts'
import { ConfigForm, ConfigurationPages } from './configuration-form'
import type { ConfigSectionProps } from './configuration-form'
import { ChoiceField, NumberField } from './configuration-fields'
import { idsValue, nameValue, numberValue } from './configuration-values'
import { SearchPicker } from './search-picker'
import { publicationChannels, selectableRoles } from './catalog-options'
import { MessageBuilder } from './message-builder'
import { responseMessage, responseReplyMessage } from './message-content'
import type { FormValues } from './settings-form'
function values(definition?: ResponseDefinition): FormValues {
  return { name: definition?.name ?? '',content: JSON.stringify(definition ? responseReplyMessage(definition.reply) : { content: '' }),enabled: definition?.enabled ?? true,triggerMode: definition?.trigger?.mode ?? 'exact',triggerText: definition?.trigger?.text ?? '',channelIds: JSON.stringify(definition?.channelIds ?? []),roleIds: JSON.stringify(definition?.roleIds ?? []),cooldownSeconds: String(definition?.cooldownSeconds ?? 0),priority: String(definition?.priority ?? 0) }
}
function definitionValue(draft: FormValues,kind: ResponseKind): DashboardResponseDefinition {
  return { name: nameValue(draft.name,'response name'),reply: responseMessage(String(draft.content)),enabled: Boolean(draft.enabled),...(kind === 'auto' ? { trigger: { mode: draft.triggerMode as 'exact' | 'contains',text: String(draft.triggerText).trim() } } : {}),channelIds: idsValue(draft.channelIds,20,'response channels'),roleIds: idsValue(draft.roleIds,20,'response roles'),cooldownSeconds: numberValue(draft.cooldownSeconds,0,3600,'cooldown seconds'),priority: numberValue(draft.priority,-100,100,'priority') }
}
export function ResponseSettings(props: ConfigSectionProps<'responses'> & { kind?: ResponseKind }) {
  const { data,configRevision: revision,jobs } = props.remote, common = { queue: props.queue,connected: props.connected,jobs }
  const kinds: ResponseKind[] = props.kind ? [props.kind] : ['custom','auto']
  return <div className="role-section">{kinds.map(kind => <div className="role-section" key={kind}>
    <ConfigForm<'responses'> {...common} title={kind === 'custom' ? 'Custom commands' : 'Autoresponders'} description="Configure stored replies, restrictions and cooldowns here. Existing chat commands remain available" snapshot={{ revision,values: { enabled: kind === 'custom' ? data.settings.customEnabled : data.settings.autoEnabled } }} operation={draft => ({ kind,operation: { type: 'module',enabled: Boolean(draft.enabled) } })} fields={(draft,edit,disabled) => <label><input type="checkbox" checked={Boolean(draft.enabled)} disabled={disabled} onChange={event => edit('enabled',event.target.checked)} />{kind === 'custom' ? 'Custom commands enabled' : 'Autoresponders enabled'}</label>} />
    {data.definitions.filter(definition => definition.kind === kind).map(definition => { const missing = props.removedDefinitions?.includes(`${kind}:${definition.name}`), card = { ...common,connected: common.connected && !missing }; return <details key={definition.name}><summary>{definition.name}: {definition.enabled ? 'Enabled' : 'Disabled'}</summary><div className="role-section">{missing && <p className="notice" role="status">Not in loaded pages. This draft is kept for copying. Load remaining pages to check whether it moved</p>}<ConfigForm<'responses'> {...card} title={`Response: ${definition.name}`} description="Save the full definition atomically, including the reply, restrictions and trigger" snapshot={{ revision,values: values(definition) }} operation={draft => ({ kind,operation: { type: 'definition-update',definition: definitionValue(draft,kind) } })} fields={(draft,edit,disabled) => <ResponseFields props={props} kind={kind} values={draft} edit={edit} disabled={disabled} existing />} /><ConfigForm<'responses'> {...card} title={`Delete response: ${definition.name}`} description="Remove this stored definition from future evaluation" snapshot={{ revision,values: { confirm: false },context: definition.updatedAt }} submitLabel="Delete response" operation={() => ({ kind,operation: { type: 'delete',name: definition.name } })} fields={(draft,edit,disabled) => <label><input type="checkbox" checked={Boolean(draft.confirm)} disabled={disabled} onChange={event => edit('confirm',event.target.checked)} />Confirm response deletion</label>} /></div></details> })}
    <ConfigForm<'responses'> {...common} title={kind === 'custom' ? 'Create custom command' : 'Create autoresponder'} description="Choose a name and compose the supported text or basic embed reply" snapshot={{ revision,values: values() }} submitLabel="Create response" operation={draft => ({ kind,operation: { type: 'definition-create',definition: definitionValue(draft,kind) } })} fields={(draft,edit,disabled) => <ResponseFields props={props} kind={kind} values={draft} edit={edit} disabled={disabled} />} />
  </div>)}<ConfigurationPages nextCursors={props.remote.nextCursors} loadPage={props.loadPage} loading={props.loadingPage} /></div>
}
function ResponseFields({ props,kind,values,edit,disabled,existing }: { props: ConfigSectionProps<'responses'>,kind: ResponseKind,values: FormValues,edit: (key: string,value: string | boolean) => void,disabled: boolean,existing?: boolean }) {
  const picks = { loading: props.catalogLoading,allowManual: props.catalogError,catalog: true }
  return <>
    {!existing && <label>Response name<input required maxLength={32} value={String(values.name)} disabled={disabled} onChange={event => edit('name',event.target.value)} /></label>}
    <label><input type="checkbox" checked={Boolean(values.enabled)} disabled={disabled} onChange={event => edit('enabled',event.target.checked)} />Response enabled</label>
    <MessageBuilder profile="response" value={String(values.content)} disabled={disabled} onChange={content => edit('content',content)} />
    <p className="field-help">Replies support text or a basic embed with title, description and color. Supported placeholders: {'{user.name}, {user.id}, {user.mention}, {channel.id}, {server.id}, {args}'}</p>
    {kind === 'auto' && <><ChoiceField label="Trigger match" value={String(values.triggerMode)} onChange={value => edit('triggerMode',value)} disabled={disabled} options={[{ value: 'exact',label: 'Exact' },{ value: 'contains',label: 'Contains' }]} /><label>Trigger text<input required maxLength={200} value={String(values.triggerText)} disabled={disabled} onChange={event => edit('triggerText',event.target.value)} /></label></>}
    <NumberField label="Response priority" value={String(values.priority)} onChange={value => edit('priority',value)} disabled={disabled} min={-100} max={100} />
    <SearchPicker {...picks} label="Allowed response channels" options={publicationChannels(props.catalog)} multiple value={JSON.parse(String(values.channelIds)) as string[]} disabled={disabled} onChange={ids => edit('channelIds',JSON.stringify(ids))} />
    <SearchPicker {...picks} label="Required response roles" options={selectableRoles(props.catalog)} multiple value={JSON.parse(String(values.roleIds)) as string[]} disabled={disabled} onChange={ids => edit('roleIds',JSON.stringify(ids))} />
    <p className="field-help">Up to twenty channels and roles. Empty selections allow all channels and roles</p>
    <NumberField label="Response cooldown (seconds)" value={String(values.cooldownSeconds)} onChange={value => edit('cooldownSeconds',value)} disabled={disabled} min={0} max={3600} />
  </>
}
