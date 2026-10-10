/** Every state a change the bot applies can be in. Pending states wait for the bot, and the others are final */
export type JobState = 'queued' | 'configured' | 'reserved' | 'applied' | 'sent' | 'failed' | 'conflict' | 'uncertain'
type Wording = { label: string, next?: string, tone: 'pending' | 'done' | 'problem' }
const changes: Record<JobState,Wording> = {
  queued: { label: 'Waiting for the bot',tone: 'pending',next: 'The bot checks permissions and applies it within seconds while it is online. If the bot does not pick it up within two minutes, it fails and nothing changes' },
  configured: { label: 'Saved, publishing the panel',tone: 'pending',next: 'The settings are saved and the bot is sending the panel message' },
  reserved: { label: 'Sending',tone: 'pending',next: 'The bot is sending it now' },
  applied: { label: 'Applied',tone: 'done' },
  sent: { label: 'Sent',tone: 'done' },
  failed: { label: 'Failed',tone: 'problem',next: 'Fix the cause shown, then try again. If the bot was offline, try again once it is back' },
  conflict: { label: 'Not applied, changed elsewhere',tone: 'problem',next: 'Review the current settings, then save again' },
  uncertain: { label: 'Outcome unknown',tone: 'problem',next: 'The bot could not confirm whether it was sent. Check the channel before you send it again. NeonFlux never resends it on its own' },
}
const messages: Partial<Record<JobState,Wording>> = {
  queued: { label: 'Waiting for the bot',tone: 'pending',next: 'The bot checks the channel and its permissions, then sends it within seconds while it is online. If the bot does not pick it up within two minutes, nothing is sent' },
  failed: { label: 'Failed',tone: 'problem',next: 'It was not sent. Fix the cause shown, then send it again' },
}
export const jobWording = (state: JobState, kind: 'change' | 'message' = 'change') => (kind === 'message' ? messages[state] : undefined) ?? changes[state]

/** One request's state in plain words, its error and what to do next */
export function JobStatus({ state,error,kind = 'change' }: { state: JobState, error?: string | undefined, kind?: 'change' | 'message' }) {
  const wording = jobWording(state,kind)
  return <><span className={`job-state ${wording.tone}`}>{wording.label}</span>{error && <span className="error-text job-error">{error}</span>}{wording.next && <span className="field-help">{wording.next}</span>}</>
}
