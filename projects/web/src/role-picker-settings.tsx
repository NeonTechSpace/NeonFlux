import type { RolePickerMode } from '@neonflux/contracts/role-picker'
import { ConfigForm } from './configuration-form'
import type { ConfigSectionProps } from './configuration-form'
import { ChoiceField, IdList } from './configuration-fields'
import { idsValue, nameValue } from './configuration-values'
import { FormInputError } from './settings-form'
import type { FormValues } from './settings-form'
import { SearchPicker } from './search-picker'
import { selectableRoles } from './catalog-options'

const modes = [{ value: 'single',label: 'Single choice, one role at a time' },{ value: 'multi',label: 'Multiple choice' }]
function description(values: FormValues) {
  const text = String(values.description).trim()
  if (text.length > 200 || /[\r\n]/.test(text)) throw new FormInputError('Keep the description to one line of up to 200 characters')
  return text ? { description: text } : {}
}
const ids = (value: string | boolean | undefined) => JSON.parse(String(value)) as string[]

export function RolePickerSettings(props: ConfigSectionProps<'rolepicker'>) {
  const { data,configRevision: revision,jobs } = props.remote, { settings,access } = data, common = { queue: props.queue,connected: props.connected,jobs }
  const roles = selectableRoles(props.catalog), picks = { loading: props.catalogLoading,allowManual: props.catalogError,catalog: true }
  const menuFields = (values: FormValues,edit: (key: string,value: string | boolean) => void,disabled: boolean,label: string) => <>
    <label>{label} description<input maxLength={200} value={String(values.description)} disabled={disabled} onChange={event => edit('description',event.target.value)} /></label><span className="field-help">Optional, shown to members above the roles</span>
    <ChoiceField label={`${label} choice`} value={String(values.mode)} onChange={value => edit('mode',value)} disabled={disabled} options={modes} />
    <SearchPicker {...picks} label={`${label} roles`} options={roles} multiple value={ids(values.roleIds)} disabled={disabled} onChange={next => edit('roleIds',JSON.stringify(next))} />
    <p className="field-help">Up to 25 roles. Each role must sit below the bot's top role and yours, carry no moderation or management permissions and belong to one menu only</p>
  </>
  const menuOperation = (name: string) => (values: FormValues) => ({ type: 'menu-set' as const,name,mode: values.mode as RolePickerMode,roleIds: idsValue(values.roleIds,25,'menu roles'),...description(values) })
  return <div className="role-section">
    <ConfigForm<'rolepicker'> {...common} title="Role picker" description="Members who sign in to this website choose roles from these menus. The bot checks each member's current roles and permissions before it changes a role" snapshot={{ revision,values: { enabled: settings.enabled } }} operation={values => ({ type: 'module',enabled: Boolean(values.enabled) })} fields={(values,edit,disabled) => <label><input type="checkbox" checked={Boolean(values.enabled)} disabled={disabled} onChange={event => edit('enabled',event.target.checked)} />Role picker enabled</label>} />
    {settings.menus.map(menu => <details key={menu.name}><summary>Menu {menu.name}: {menu.mode === 'single' ? 'Single choice' : 'Multiple choice'}, {menu.roleIds.length} roles</summary><div className="role-section">
      <ConfigForm<'rolepicker'> {...common} title={`Menu ${menu.name}`} description="Saving replaces this menu. Roles members already chose stay with them" snapshot={{ revision,values: { description: menu.description ?? '',mode: menu.mode,roleIds: JSON.stringify(menu.roleIds) } }} operation={menuOperation(menu.name)} fields={(values,edit,disabled) => menuFields(values,edit,disabled,`Menu ${menu.name}`)} />
      <ConfigForm<'rolepicker'> {...common} title={`Remove menu ${menu.name}`} description="Members can no longer choose these roles here. Roles they already chose stay" submitLabel="Remove menu" snapshot={{ revision,values: { confirm: false },context: menu }} operation={values => { if (!values.confirm) throw new FormInputError('Confirm the menu removal'); return { type: 'menu-remove',name: menu.name } }} fields={(values,edit,disabled) => <label><input type="checkbox" checked={Boolean(values.confirm)} disabled={disabled} onChange={event => edit('confirm',event.target.checked)} />Confirm removing menu {menu.name}</label>} />
    </div></details>)}
    {settings.menus.length < 10 ? <ConfigForm<'rolepicker'> {...common} title="Add menu" description={`A server can have 10 menus. ${settings.menus.length} are in use`} snapshot={{ revision,values: { name: '',description: '',mode: 'multi',roleIds: '[]' } }} operation={values => {
      const name = nameValue(values.name,'menu name')
      if (settings.menus.some(menu => menu.name === name)) throw new FormInputError('A menu with this name already exists')
      return menuOperation(name)(values)
    }} fields={(values,edit,disabled) => <><label>Menu name<input required maxLength={32} value={String(values.name)} disabled={disabled} onChange={event => edit('name',event.target.value)} /></label><span className="field-help">Up to 32 lowercase letters, digits, underscores or hyphens</span>{menuFields(values,edit,disabled,'New menu')}</>} /> : <section className="panel"><h2>Add menu</h2><p className="muted">This server has the maximum of 10 menus. Remove one to add another</p></section>}
    <ConfigForm<'rolepicker'> {...common} title="Who may use the role picker" description="A block always wins over an allow. With both allow lists empty, every member who is not blocked may use it" snapshot={{ revision,values: { allowRoleIds: JSON.stringify(access.allowRoleIds),blockRoleIds: JSON.stringify(access.blockRoleIds),allowUserIds: JSON.stringify(access.allowUserIds),blockUserIds: JSON.stringify(access.blockUserIds) } }}
      operation={values => ({ type: 'access-set',allowRoleIds: idsValue(values.allowRoleIds,100,'allowed roles'),blockRoleIds: idsValue(values.blockRoleIds,100,'blocked roles'),allowUserIds: idsValue(values.allowUserIds,100,'allowed user IDs'),blockUserIds: idsValue(values.blockUserIds,100,'blocked user IDs') })}
      fields={(values,edit,disabled) => <>
        <SearchPicker {...picks} label="Allowed roles" options={roles} multiple value={ids(values.allowRoleIds)} disabled={disabled} onChange={next => edit('allowRoleIds',JSON.stringify(next))} />
        <IdList label="Allowed user IDs" value={String(values.allowUserIds)} onChange={value => edit('allowUserIds',value)} disabled={disabled} max={100} />
        <SearchPicker {...picks} label="Blocked roles" options={roles} multiple value={ids(values.blockRoleIds)} disabled={disabled} onChange={next => edit('blockRoleIds',JSON.stringify(next))} />
        <IdList label="Blocked user IDs" value={String(values.blockUserIds)} onChange={value => edit('blockUserIds',value)} disabled={disabled} max={100} />
      </>} />
  </div>
}
