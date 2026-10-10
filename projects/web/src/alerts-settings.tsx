import type { AlertKind } from '@neonflux/backend/contracts'
import { ConfigForm } from './configuration-form'
import type { ConfigSectionProps } from './configuration-form'
import { idValue } from './configuration-values'
import { FormInputError } from './settings-form'
import { localTime } from './time'

const alerts: ReadonlyArray<readonly [AlertKind,string,string]> = [
  ['invites','Invite logs','Log each invite created or deleted, flagging invites that never expire or have unlimited uses. The invite code is never recorded'],
  ['bots','Unexpected bots','Alert when a bot joins that is not marked expected below'],
  ['webhooks','Unexpected webhooks','Alert when a webhook that is not marked expected is created or changed, with who did it. Needs View Audit Log'],
  ['privileges','Privilege changes','Alert when a role gains Administrator, Manage Server, Manage Roles, Manage Channels, Manage Webhooks, Ban, Kick or Moderate Members, or a member gains such a role, with who did it. Needs View Audit Log'],
  ['impersonation','Impersonation','Alert when a member\'s username or server nickname closely matches the owner\'s or a staff member\'s name. Needs Manage Server'],
]
const when = (iso: string | null) => iso ? localTime(iso) : 'Never'

export function AlertsSettings(props: ConfigSectionProps<'alerts'>) {
  const { data,configRevision: revision,jobs } = props.remote, common = { queue: props.queue,connected: props.connected,jobs }, settings = data.settings
  const channelName = (id: string) => props.catalog?.channels.find(channel => channel.id === id)?.name ?? `Channel ${id}`
  const expected = [...settings.expectedBotIds.map(id => ['bot',id] as const),...settings.expectedWebhookIds.map(id => ['webhook',id] as const)]
  return <div className="role-section">
    <section className="panel"><h2>Security alerts</h2><p className="muted">Every alert starts off. Alerts go to the Security alerts group in Channel logs, so turn on logging and route that group to a staff channel. NeonFlux only reports and never acts on an alert. At most ten alerts arrive at once, then one a minute. The chat command !alerts changes the same settings</p></section>
    {alerts.map(([kind,title,description]) => <ConfigForm<'alerts'> {...common} key={kind} title={title} description={description} submitLabel={`Save ${title.toLowerCase()}`}
      snapshot={{ revision,values: { enabled: settings[kind] } }} operation={values => ({ type: 'set',alert: kind,enabled: Boolean(values.enabled) })}
      fields={(values,edit,disabled) => <label><input type="checkbox" checked={Boolean(values.enabled)} disabled={disabled} onChange={event => edit('enabled',event.target.checked)} />{title} on</label>} />)}
    <ConfigForm<'alerts'> {...common} title="Mark a bot or webhook expected" description="An expected bot or webhook raises no alert. A server can mark up to 50 of each" submitLabel="Mark expected"
      snapshot={{ revision,values: { kind: 'bot',id: '' } }} operation={values => ({ type: 'expect',kind: values.kind === 'webhook' ? 'webhook' : 'bot',id: idValue(values.id,'bot or webhook ID'),expected: true })}
      fields={(values,edit,disabled) => <>
        <label>Kind<select value={String(values.kind)} disabled={disabled} onChange={event => edit('kind',event.target.value)}><option value="bot">Bot</option><option value="webhook">Webhook</option></select></label>
        <label>ID<input required inputMode="numeric" maxLength={19} value={String(values.id)} disabled={disabled} onChange={event => edit('id',event.target.value)} /></label>
      </>} />
    {expected.length > 0 && <details><summary>Expected bots and webhooks ({expected.length})</summary><div className="role-section">{expected.map(([kind,id]) => <ConfigForm<'alerts'> {...common} key={`${kind}:${id}`}
      title={`${kind === 'bot' ? 'Bot' : 'Webhook'} ${id}`} description="Alerts resume for it once it is no longer expected" submitLabel="No longer expected"
      snapshot={{ revision,values: { confirm: false } }} operation={values => { if (!values.confirm) throw new FormInputError('Confirm that alerts resume for it'); return { type: 'expect',kind,id,expected: false } }}
      fields={(values,edit,disabled) => <label><input type="checkbox" checked={Boolean(values.confirm)} disabled={disabled} onChange={event => edit('confirm',event.target.checked)} />Alert about it again</label>} />)}</div></details>}
    <ConfigForm<'alerts'> {...common} title="Invites" description="NeonFlux reads the server's invites with its own permissions, which needs Manage Server, and lists up to 100, newest first. Invite codes are never shown or stored" submitLabel="Refresh invite list"
      snapshot={{ revision,values: { refresh: false } }} operation={values => { if (!values.refresh) throw new FormInputError('Choose to read the invites'); return { type: 'invites-refresh' } }}
      fields={(values,edit,disabled) => <>
        {data.invites ? <p className="field-help">Read {localTime(data.invites.readAt)}. {data.invites.invites.length} {data.invites.invites.length === 1 ? 'invite' : 'invites'}{data.invites.more ? ', and the server has more' : ''}</p> : <p className="field-help">Not read yet</p>}
        <label><input type="checkbox" checked={Boolean(values.refresh)} disabled={disabled} onChange={event => edit('refresh',event.target.checked)} />Read the current invites</label>
      </>} />
    {data.invites?.invites.map(invite => {
      const flags = [...invite.expiresAt === null ? ['never expires'] : [],...invite.maxUses === 0 ? ['unlimited uses'] : [],...invite.temporary ? ['temporary membership'] : []]
      return <ConfigForm<'alerts'> {...common} key={invite.ref} title={`Invite ${invite.ref} to ${channelName(invite.channelId)}`}
        description={`Created by ${invite.inviterId ?? 'unknown'} on ${when(invite.createdAt)}. ${invite.uses} of ${invite.maxUses || 'unlimited'} uses. Expires: ${when(invite.expiresAt)}${flags.length ? `. Flagged: ${flags.join(', ')}` : ''}`}
        submitLabel="Revoke invite" snapshot={{ revision,values: { confirm: false } }}
        operation={values => { if (!values.confirm) throw new FormInputError('Confirm revoking this invite'); return { type: 'invite-revoke',ref: invite.ref } }}
        fields={(values,edit,disabled) => <label><input type="checkbox" checked={Boolean(values.confirm)} disabled={disabled} onChange={event => edit('confirm',event.target.checked)} />Confirm revoking this invite. Members who joined with it stay</label>} />
    })}
  </div>
}
