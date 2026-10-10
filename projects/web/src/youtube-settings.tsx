import type { DashboardCatalog } from '@neonflux/backend/dashboard-contracts'
import type { YoutubeSubscription } from '@neonflux/backend/contracts'
import { ConfigForm } from './configuration-form'
import type { ConfigSectionProps } from './configuration-form'
import { FormInputError } from './settings-form'
import type { FormValues } from './settings-form'
import { SearchPicker } from './search-picker'
import { localTime } from './time'

const YOUTUBE_LIMIT = 10
const findChannelId = 'On YouTube, open the channel, select the more link in its description, then Share channel and Copy channel ID'
// Text, announcement and forum channels. In a forum each alert becomes its own post
const alertChannels = (catalog?: DashboardCatalog) => catalog?.channels.filter(channel => [0,5,15].includes(channel.type)) ?? []
/** A channel ID, or a link with /channel/ that holds one. Handles need YouTube's API, which NeonFlux does not use */
export function youtubeChannelValue(value: string | boolean | undefined) {
  const text = typeof value === 'string' ? value.trim() : ''
  const id = /^UC[A-Za-z0-9_-]{22}$/.test(text) ? text : /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})(?:[/?#]|$)/i.exec(text)?.[1]
  if (!id) throw new FormInputError(`Enter a YouTube channel ID, which starts with UC and has 24 characters. ${findChannelId}. An @handle does not work`)
  return id
}
function channelValue(values: FormValues) {
  if (typeof values.channelId !== 'string' || !values.channelId) throw new FormInputError('Choose a channel for the alerts')
  return values.channelId
}
const name = (row: YoutubeSubscription) => row.status.title ? `${row.status.title} (${row.youtubeChannelId})` : row.youtubeChannelId
const problems = {
  channel: 'Off: Its alert channel is gone or cannot hold alerts. Choose a text, announcement or forum channel below to turn the alerts back on',
  permission: 'Off: NeonFlux cannot post in its alert channel. Give NeonFlux View Channel, Send Messages and Embed Links there, then save the channel below to turn the alerts back on',
}

export function YoutubeSettings(props: ConfigSectionProps<'youtube'>) {
  const { data,configRevision: revision,jobs } = props.remote, common = { queue: props.queue,connected: props.connected,jobs }
  const nameOf = (id: string) => props.catalog?.channels.find(channel => channel.id === id)?.name ?? `Channel ${id}`
  const picker = (values: FormValues,edit: (key: string,value: string | boolean) => void,disabled: boolean) =>
    <SearchPicker catalog label="Alert channel" options={alertChannels(props.catalog)} loading={props.catalogLoading} allowManual={props.catalogError} value={values.channelId ? [String(values.channelId)] : []} disabled={disabled} onChange={ids => edit('channelId',ids[0] ?? '')} />
  const help = <p className="field-help">NeonFlux needs View Channel, Send Messages and Embed Links in the alert channel. If they go missing, or the channel is removed, NeonFlux turns that channel's alerts off and says so in the server's system channel and the recovery inbox</p>
  const used = new Set(data.subscriptions.map(row => row.youtubeChannelId))
  return <div className="role-section">
    <section className="panel"><h2>YouTube alerts</h2>
      <p className="muted">YouTube channels {data.subscriptions.length}/{YOUTUBE_LIMIT}. NeonFlux posts each new upload of a followed channel with its title, thumbnail and a link to the video. It hears about uploads from YouTube's own notifications, without a YouTube API key, so livestreams, premieres and Shorts arrive as ordinary new videos. Videos published before a channel was added are not posted. The chat command !youtube changes the same settings</p>
      {!data.configured && <p className="notice" role="status">The bot operator has not set up YouTube alerts yet, so channels cannot be added</p>}
      <p className="field-help">Alerts show content from YouTube. See <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube's Terms of Service</a> and <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google's Privacy Policy</a></p>
    </section>
    {data.subscriptions.map(row => <details key={row.youtubeChannelId}><summary>{name(row)} in {nameOf(row.channelId)}: {row.enabled ? 'On' : 'Off'}</summary><div className="role-section">
      <section className="panel" aria-label={`Status of ${name(row)}`}><ul>
        {row.problem && <li>{problems[row.problem]}</li>}
        <li>YouTube subscription: {row.status.hubError ? `${row.status.hubError}. NeonFlux tries again on its own` : row.status.subscribedUntil !== undefined ? `Confirmed until ${localTime(row.status.subscribedUntil)}` : 'Waiting for YouTube to confirm'}</li>
        <li>Last notification: {row.status.lastNotificationAt !== undefined ? localTime(row.status.lastNotificationAt) : 'None yet'}</li>
        <li>Last post: {row.status.lastPostAt !== undefined ? localTime(row.status.lastPostAt) : 'None yet'}</li>
        {row.status.latestVideo && <li>Newest video: <a href={`https://www.youtube.com/watch?v=${row.status.latestVideo.videoId}`} target="_blank" rel="noopener noreferrer">{row.status.latestVideo.title}</a>, published {localTime(row.status.latestVideo.publishedAt)}</li>}
      </ul></section>
      <ConfigForm<'youtube'> {...common} draftKey={`youtube:${row.youtubeChannelId}`} title={`Alert channel for ${name(row)}`} description="Saving moves the alerts and turns them back on if NeonFlux turned them off" submitLabel="Save channel"
        snapshot={{ revision,values: { channelId: row.channelId } }}
        operation={values => ({ type: 'add',youtubeChannelId: row.youtubeChannelId,channelId: channelValue(values) })} fields={(values,edit,disabled) => <>{picker(values,edit,disabled)}{help}</>} />
      <ConfigForm<'youtube'> {...common} draftKey={`youtube-remove:${row.youtubeChannelId}`} title={`Stop alerts for ${name(row)}`} description="NeonFlux stops posting this channel's uploads" submitLabel="Remove channel"
        snapshot={{ revision,values: { confirm: false } }}
        operation={values => { if (!values.confirm) throw new FormInputError('Confirm removing this YouTube channel'); return { type: 'remove',youtubeChannelId: row.youtubeChannelId } }}
        fields={(values,edit,disabled) => <label><input type="checkbox" checked={Boolean(values.confirm)} disabled={disabled} onChange={event => edit('confirm',event.target.checked)} />Confirm removing this YouTube channel</label>} />
    </div></details>)}
    {!data.configured ? null : data.subscriptions.length < YOUTUBE_LIMIT ? <ConfigForm<'youtube'> {...common} title="Follow a YouTube channel" description={`A channel ID starts with UC and has 24 characters. ${findChannelId}. A link with /channel/UC… works too`} submitLabel="Follow channel"
      snapshot={{ revision,values: { youtubeChannelId: '',channelId: '' } }}
      operation={values => {
        const youtubeChannelId = youtubeChannelValue(values.youtubeChannelId)
        if (used.has(youtubeChannelId)) throw new FormInputError('This server already follows that YouTube channel. Change its alert channel above')
        return { type: 'add',youtubeChannelId,channelId: channelValue(values) }
      }}
      fields={(values,edit,disabled) => <>
        <label>YouTube channel ID<input value={String(values.youtubeChannelId)} maxLength={200} disabled={disabled} onChange={event => edit('youtubeChannelId',event.target.value)} /></label>
        {picker(values,edit,disabled)}{help}
      </>} /> : <section className="panel"><h2>Follow a YouTube channel</h2><p className="muted">This server follows the maximum of {YOUTUBE_LIMIT} YouTube channels. Remove one to follow another</p></section>}
  </div>
}
