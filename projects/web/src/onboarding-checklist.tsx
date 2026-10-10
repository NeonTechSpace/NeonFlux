import type { OnboardingStep } from '@neonflux/contracts/onboarding'
import { ConfigForm } from './configuration-form'
import type { ConfigSectionProps } from './configuration-form'
import { ChoiceField } from './configuration-fields'
import { idsValue } from './configuration-values'
import { FormInputError } from './settings-form'
import { SearchPicker } from './search-picker'
import { publicationChannels, selectableRoles } from './catalog-options'

const STEPS = 5
type Row = { type: OnboardingStep['type'], name: string, channelId: string, text: string }
const kinds = [{ value: 'rules',label: 'Accept the rules' },{ value: 'panel',label: 'Pick roles from a reaction panel' },{ value: 'menu',label: 'Pick roles from a role picker menu' },{ value: 'link',label: 'Visit a channel' }]
const toRow = (step: OnboardingStep): Row => ({ type: step.type,name: 'name' in step ? step.name : '',channelId: step.type === 'link' ? step.channelId : '',text: step.type === 'link' ? step.text : '' })
/** The step list as the form edits it, checked like the bot checks it */
export function stepsValue(value: string | boolean | undefined): OnboardingStep[] {
  const rows = JSON.parse(String(value)) as Row[]
  return rows.map((row,index) => {
    const position = `Step ${index + 1}`
    if (row.type === 'rules') return { type: 'rules' }
    if (row.type === 'link') {
      if (!row.channelId) throw new FormInputError(`${position}: Choose a channel`)
      if (!row.text.trim() || row.text.trim().length > 100) throw new FormInputError(`${position}: Write a line of 1 to 100 characters`)
      return { type: 'link',channelId: row.channelId,text: row.text.trim() }
    }
    const name = row.name.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) throw new FormInputError(`${position}: Enter the ${row.type === 'panel' ? 'panel' : 'menu'} name`)
    return { type: row.type,name }
  })
}

export function OnboardingSettings(props: ConfigSectionProps<'onboarding'>) {
  const { data,configRevision: revision,jobs } = props.remote, { settings } = data, common = { queue: props.queue,connected: props.connected,jobs }
  const channels = publicationChannels(props.catalog), roles = selectableRoles(props.catalog), picks = { loading: props.catalogLoading,allowManual: props.catalogError,catalog: true }
  return <div className="role-section">
    <section className="panel" aria-labelledby="onboarding-summary"><h2 id="onboarding-summary">Newcomer checklist</h2>
      <p className="muted">New members see these steps with their welcome or DM greeting and check what is left with !onboarding. They finish steps through rules verification, reaction role panels and the role picker, and a member who finishes every step can receive a completion role</p>
      <p>{`Members who finished it in the last 7 days: ${data.completions}`}</p>
    </section>
    <ConfigForm<'onboarding'> {...common} title="Checklist" description="Turning it on does not message existing members" snapshot={{ revision,values: { enabled: settings.enabled } }}
      operation={values => ({ type: 'module',enabled: Boolean(values.enabled) })}
      fields={(values,edit,disabled) => <label><input type="checkbox" checked={Boolean(values.enabled)} disabled={disabled} onChange={event => edit('enabled',event.target.checked)} />Newcomer checklist enabled</label>} />
    <ConfigForm<'onboarding'> {...common} title="Delivery" description="The greeting route that carries the checklist. Configure that route in Greetings" snapshot={{ revision,values: { delivery: settings.delivery } }}
      operation={values => ({ type: 'delivery',delivery: values.delivery === 'dm' ? 'dm' : 'welcome' })}
      fields={(values,edit,disabled) => <ChoiceField label="Send the checklist with" value={String(values.delivery)} onChange={value => edit('delivery',value)} disabled={disabled} options={[{ value: 'welcome',label: 'The channel welcome' },{ value: 'dm',label: 'The DM greeting' }]} />} />
    <ConfigForm<'onboarding'> {...common} title="Steps" description={`Up to ${STEPS} steps, in order. Panel and menu steps name an existing reaction panel or role picker menu`}
      snapshot={{ revision,values: { steps: JSON.stringify(settings.steps.map(toRow)) } }}
      operation={values => ({ type: 'steps',steps: stepsValue(values.steps) })}
      fields={(values,edit,disabled) => {
        const rows = JSON.parse(String(values.steps)) as Row[], change = (next: Row[]) => edit('steps',JSON.stringify(next))
        const patch = (index: number,value: Partial<Row>) => change(rows.map((row,i) => i === index ? { ...row,...value } : row))
        return <fieldset className="mapping-row"><legend>Steps</legend>
          {rows.map((row,index) => <div className="list-row" key={index}>
            <ChoiceField label={`Step ${index + 1}`} value={row.type} onChange={value => patch(index,{ type: value as Row['type'] })} disabled={disabled} options={kinds} />
            {(row.type === 'panel' || row.type === 'menu') && <label>{row.type === 'panel' ? 'Panel name' : 'Menu name'}<input required maxLength={32} value={row.name} disabled={disabled} onChange={event => patch(index,{ name: event.target.value })} /></label>}
            {row.type === 'link' && <><SearchPicker {...picks} label={`Step ${index + 1} channel`} options={channels} value={row.channelId ? [row.channelId] : []} disabled={disabled} onChange={ids => patch(index,{ channelId: ids[0] ?? '' })} />
              <label>Line<input required maxLength={100} value={row.text} disabled={disabled} onChange={event => patch(index,{ text: event.target.value })} /></label></>}
            <button type="button" className="secondary" disabled={disabled} onClick={() => change(rows.filter((_,i) => i !== index))}>Remove step {index + 1}</button>
          </div>)}
          {!rows.length && <p className="muted">No steps yet</p>}
          <button type="button" className="secondary" disabled={disabled || rows.length >= STEPS} onClick={() => change([...rows,{ type: 'rules',name: '',channelId: '',text: '' }])}>Add step</button>
          <p className="field-help">A link step is guidance that never needs finishing. A panel, menu or rules step that is not published or turned off is left out until it is</p>
        </fieldset>
      }} />
    <ConfigForm<'onboarding'> {...common} title="Completion role" description="Given once to a member who finishes every step, through the same checks as other role features. Changing it later does not take the old role away"
      snapshot={{ revision,values: { roleId: JSON.stringify(settings.completionRoleId ? [settings.completionRoleId] : []) } }}
      operation={values => ({ type: 'role',roleId: idsValue(values.roleId,1,'completion role')[0] ?? null })}
      fields={(values,edit,disabled) => <SearchPicker {...picks} label="Completion role" options={roles} value={JSON.parse(String(values.roleId)) as string[]} disabled={disabled} onChange={next => edit('roleId',JSON.stringify(next))} />} />
  </div>
}
