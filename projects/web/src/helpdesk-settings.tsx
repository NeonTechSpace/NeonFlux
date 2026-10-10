import type { DashboardCatalog } from '@neonflux/backend/dashboard-contracts'
import { ConfigForm } from './configuration-form'
import type { ConfigSectionProps } from './configuration-form'
import { numberValue } from './configuration-values'
import { FormInputError } from './settings-form'
import type { FormValues } from './settings-form'
import { SearchPicker } from './search-picker'
import { publicationChannels } from './catalog-options'

const FORUM_LIMIT = 10, ANSWER_LIMIT = 50
/** Forum and media channels, which hold posts */
export const forumChannels = (catalog?: DashboardCatalog) => catalog?.channels.filter(channel => channel.type === 15 || channel.type === 16) ?? []
const bounded = (value: string | boolean | undefined, max: number, label: string) => {
  const text = typeof value === 'string' ? value : ''
  if (!text.trim() || text.length > max) throw new FormInputError(`Use ${label} with 1 to ${max} characters`)
  return text
}
function answerName(value: string | boolean | undefined) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name) || ['list','set','remove','help'].includes(name)) throw new FormInputError('Use an answer name of 1 to 32 lowercase letters, digits, - or _, other than list, set, remove or help')
  return name
}

export function HelpDeskSettings(props: ConfigSectionProps<'helpdesk'>) {
  const { data,configRevision: revision,jobs } = props.remote, common = { queue: props.queue,connected: props.connected,jobs }, { settings,answers } = data
  const nameOf = (id: string) => props.catalog?.channels.find(channel => channel.id === id)?.name ?? `Channel ${id}`
  const forums = forumChannels(props.catalog).filter(channel => !settings.forumIds.includes(channel.id))
  const answerFields = (values: FormValues,edit: (key: string,value: string | boolean) => void,disabled: boolean) => <>
    <label>Title<input required maxLength={100} value={String(values.title)} disabled={disabled} onChange={event => edit('title',event.target.value)} /></label>
    <label>Answer text<textarea required maxLength={2000} rows={5} value={String(values.content)} disabled={disabled} onChange={event => edit('content',event.target.value)} /></label>
  </>
  return <div className="role-section">
    <section className="panel"><h2>Help desk</h2><p className="muted">NeonFlux greets new posts in the chosen forums, closes a post with its solved tag when its author or staff send !solved and reminds an author once when nobody replied. Staff post saved answers with !answer and open a ticket for a post's author with !escalate. Changes here and with !helpdesk in chat share one revision</p></section>
    {settings.forumIds.map(id => <ConfigForm<'helpdesk'> key={id} {...common} draftKey={`helpdesk-forum:${id}`} title={`Stop serving ${nameOf(id)}`} description="Posts stay. New posts there are no longer greeted or reminded" submitLabel="Remove forum"
      snapshot={{ revision,values: {} }} operation={() => ({ type: 'forum-remove',channelId: id })} fields={() => null} />)}
    {settings.forumIds.length < FORUM_LIMIT ? <ConfigForm<'helpdesk'> {...common} title="Add help desk forum" description="Choose a forum or media channel. NeonFlux needs View Channel, Send Messages in Threads, Read Message History and Manage Threads there" submitLabel="Add forum"
      snapshot={{ revision,values: { channelId: '' } }}
      operation={values => {
        const channelId = typeof values.channelId === 'string' ? values.channelId : ''
        if (!channelId) throw new FormInputError('Choose a forum')
        return { type: 'forum-add',channelId }
      }}
      fields={(values,edit,disabled) => <SearchPicker catalog label="Forum" options={forums} loading={props.catalogLoading} allowManual={props.catalogError} value={values.channelId ? [String(values.channelId)] : []} disabled={disabled} onChange={ids => edit('channelId',ids[0] ?? '')} />} />
      : <section className="panel"><h2>Add help desk forum</h2><p className="muted">The help desk serves at most {FORUM_LIMIT} forums. Remove one to add another</p></section>}
    <ConfigForm<'helpdesk'> {...common} draftKey="helpdesk-settings" title="Help desk settings" description="Leave the greeting or the reminder empty to turn it off"
      snapshot={{ revision,values: { greeting: settings.greeting ?? '',solvedTag: settings.solvedTag,nudgeHours: settings.nudgeHours === null ? '' : String(settings.nudgeHours),guardChannelId: settings.guardChannelId ?? '',autoArchive: settings.autoArchive } }}
      operation={values => {
        const greeting = typeof values.greeting === 'string' && values.greeting.trim() ? bounded(values.greeting,500,'a greeting') : null
        const nudge = typeof values.nudgeHours === 'string' ? values.nudgeHours.trim() : ''
        const guard = typeof values.guardChannelId === 'string' && values.guardChannelId ? values.guardChannelId : null
        return { type: 'settings',greeting,solvedTag: bounded(values.solvedTag,50,'a tag name').trim(),nudgeHours: nudge ? numberValue(nudge,1,168,'a reminder wait in hours') : null,guardChannelId: guard,autoArchive: Boolean(values.autoArchive) }
      }}
      fields={(values,edit,disabled) => <>
        <label>Greeting on new posts<textarea maxLength={500} rows={3} value={String(values.greeting)} disabled={disabled} onChange={event => edit('greeting',event.target.value)} /></label>
        <label>Solved tag<input required maxLength={50} value={String(values.solvedTag)} disabled={disabled} onChange={event => edit('solvedTag',event.target.value)} /></label>
        <p className="field-help">Each help desk forum needs a tag with this name. !solved adds it and closes the post</p>
        <label>Reply reminder after hours<input type="number" inputMode="numeric" step={1} min={1} max={168} value={String(values.nudgeHours)} disabled={disabled} onChange={event => edit('nudgeHours',event.target.value)} /></label>
        <SearchPicker catalog label="Thread warnings channel" options={publicationChannels(props.catalog)} loading={props.catalogLoading} allowManual={props.catalogError} value={values.guardChannelId ? [String(values.guardChannelId)] : []} disabled={disabled} onChange={ids => edit('guardChannelId',ids[0] ?? '')} />
        <p className="field-help">Staff are warned there, at most once a day, when the server has 900 of Fluxer's 1000 active threads</p>
        <label><input type="checkbox" checked={Boolean(values.autoArchive)} disabled={disabled} onChange={event => edit('autoArchive',event.target.checked)} />Give threads their channel's default auto-archive time</label>
      </>} />
    <section className="panel"><h2>Saved answers</h2><p className="muted">Saved answers {answers.length}/{ANSWER_LIMIT}. Staff post one with !answer &lt;name&gt;</p></section>
    {answers.map(answer => <details key={answer.name}><summary>{answer.name}: {answer.title}</summary><div className="role-section">
      <ConfigForm<'helpdesk'> {...common} draftKey={`helpdesk-answer:${answer.name}`} title={`Answer ${answer.name}`} description="Saving replaces the title and text"
        snapshot={{ revision,values: { title: answer.title,content: answer.content } }}
        operation={values => ({ type: 'answer-set',name: answer.name,title: bounded(values.title,100,'a title').trim(),content: bounded(values.content,2000,'answer text') })} fields={answerFields} />
      <ConfigForm<'helpdesk'> {...common} draftKey={`helpdesk-answer-remove:${answer.name}`} title={`Remove answer ${answer.name}`} description="Staff can no longer post it" submitLabel="Remove answer"
        snapshot={{ revision,values: { confirm: false } }}
        operation={values => { if (!values.confirm) throw new FormInputError('Confirm the answer removal'); return { type: 'answer-remove',name: answer.name } }}
        fields={(values,edit,disabled) => <label><input type="checkbox" checked={Boolean(values.confirm)} disabled={disabled} onChange={event => edit('confirm',event.target.checked)} />Confirm removing this answer</label>} />
    </div></details>)}
    {answers.length < ANSWER_LIMIT ? <ConfigForm<'helpdesk'> {...common} title="Add saved answer" description="Names use lowercase letters, digits, - and _" submitLabel="Save answer"
      snapshot={{ revision,values: { name: '',title: '',content: '' } }}
      operation={values => {
        const name = answerName(values.name)
        if (answers.some(answer => answer.name === name)) throw new FormInputError('An answer has this name. Change it above')
        return { type: 'answer-set',name,title: bounded(values.title,100,'a title').trim(),content: bounded(values.content,2000,'answer text') }
      }}
      fields={(values,edit,disabled) => <>
        <label>Name<input required maxLength={32} value={String(values.name)} disabled={disabled} onChange={event => edit('name',event.target.value)} /></label>
        {answerFields(values,edit,disabled)}
      </>} /> : <section className="panel"><h2>Add saved answer</h2><p className="muted">This server has the maximum of {ANSWER_LIMIT} saved answers. Remove one to add another</p></section>}
  </div>
}
