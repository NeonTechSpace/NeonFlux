import { ConfigForm } from './configuration-form'
import type { ConfigSectionProps } from './configuration-form'
import { FormInputError } from './settings-form'

export function PresetSettings(props: ConfigSectionProps<'presets'>) {
  const { data,configRevision: revision,jobs } = props.remote, common = { queue: props.queue,connected: props.connected,jobs }
  return <div className="role-section">
    <section className="panel" aria-labelledby="presets-summary"><h2 id="presets-summary">Setup presets</h2>
      <p className="muted">A preset sets several settings at once as a starting point. It changes only the settings listed under it, adds or updates its own automod rules named preset-, deletes nothing and never changes channels or roles. Applying one needs the server owner or an Administrator, and every change appears in the audit log</p>
    </section>
    {data.presets.map(plan => <details key={plan.name}><summary>{`${plan.name} (${plan.kind === 'security' ? 'security level' : 'community'}): ${plan.changes.length ? `${plan.changes.length} changes` : 'Already matches'}`}</summary><div className="role-section">
      <p>{plan.description}</p>
      {plan.changes.length ? <ul aria-label={`Changes of ${plan.name}`}>{plan.changes.map(change => <li key={`${change.family}:${change.setting}`}>{`${change.setting}: ${change.from} → ${change.to}`}</li>)}</ul> : <p className="muted">This server already matches it</p>}
      {plan.changes.length > 0 && <ConfigForm<'presets'> {...common} draftKey={`preset:${plan.name}`} title={`Apply ${plan.name}`} description="Applies exactly the changes listed above. If settings change first, the preview updates and needs a new confirmation" submitLabel="Apply preset"
        snapshot={{ revision,values: { confirm: false },context: plan.token }}
        operation={values => { if (!values.confirm) throw new FormInputError('Confirm the listed changes'); return { type: 'apply',name: plan.name,token: plan.token } }}
        fields={(values,edit,disabled) => <label><input type="checkbox" checked={Boolean(values.confirm)} disabled={disabled} onChange={event => edit('confirm',event.target.checked)} />{`Confirm the ${plan.changes.length} changes`}</label>} />}
    </div></details>)}
  </div>
}
