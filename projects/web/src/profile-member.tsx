import type { ConvexReactClient } from 'convex/react'
import { useState } from 'react'
import type { Profile, ProfileMemberOperation } from '@neonflux/contracts/profiles'
import { dashboardApi } from './dashboard-api'
import { useLiveQuery } from './live-query'
import { linkLines, MemberRequests, requestError } from './showcase-member'

const hex = (color: number | null) => color === null ? '' : `#${color.toString(16).padStart(6,'0')}`
function ProfileForm({ profile,disabled,onSubmit }: { profile: Profile | null, disabled: boolean, onSubmit: (operation: ProfileMemberOperation) => void }) {
  const [bio,setBio] = useState(profile?.bio ?? ''), [links,setLinks] = useState(profile?.links.join('\n') ?? ''), [accent,setAccent] = useState(profile ? profile.color !== null : false), [color,setColor] = useState(hex(profile?.color ?? 0x3d66b8))
  return <form className="role-section" onSubmit={event => { event.preventDefault(); onSubmit({ type: 'save',bio: bio.trim(),links: linkLines(links),color: accent ? Number.parseInt(color.slice(1),16) : null }) }}>
    <label>Bio<textarea maxLength={300} rows={4} value={bio} disabled={disabled} onChange={event => setBio(event.target.value)} /></label>
    <label>Links, one per line<textarea rows={3} value={links} disabled={disabled} onChange={event => setLinks(event.target.value)} /></label>
    <p className="field-help">Up to three web addresses</p>
    <label><input type="checkbox" checked={accent} disabled={disabled} onChange={event => setAccent(event.target.checked)} />Use an accent color</label>
    {accent && <label>Accent color<input type="color" value={color} disabled={disabled} onChange={event => setColor(event.target.value)} /></label>}
    <div className="actions"><button type="submit" disabled={disabled || linkLines(links).length > 3}>Save profile</button></div>
  </form>
}

// The member view. The bot reads the member and checks the server's access lists and automod rules before a save is stored
export function ProfileMember({ client,sessionToken,serverId,connected }: { client: ConvexReactClient, sessionToken: string, serverId: string, connected: boolean }) {
  const view = useLiveQuery(client,dashboardApi.profileMember,{ sessionToken,serverId })
  const [sending,setSending] = useState(false), [notice,setNotice] = useState('')
  async function run(work: () => Promise<unknown>) {
    setSending(true); setNotice('')
    try { await work() } catch (cause) { setNotice(requestError(cause)) } finally { setSending(false) }
  }
  if (view.error) return <section className="panel"><p role="alert" className="notice error">Profiles are not available in this server right now. They may have been turned off, or your sign-in needs a refresh</p></section>
  const remote = view.data
  if (!remote) return <section className="panel"><p role="status">Loading your profile…</p></section>
  return <>
    <section className="panel" aria-label="Your profile">
      <h2>Your profile</h2>
      <p className="muted">Members see your profile when someone sends !profile with your name in the server. The server's automod rules check it, and mentions never notify anyone</p>
      <ProfileForm key={remote.profile?.updatedAt ?? 0} profile={remote.profile} disabled={!connected || sending}
        onSubmit={operation => void run(() => client.mutation(dashboardApi.profileRequest,{ sessionToken,serverId,requestId: crypto.randomUUID(),operation }))} />
      {remote.profile && <div className="actions"><button type="button" className="secondary" disabled={!connected || sending} onClick={() => void run(() => client.mutation(dashboardApi.profileRemove,{ sessionToken,serverId }))}>Delete profile</button></div>}
      {notice && <p role="alert" className="notice error">{notice}</p>}
    </section>
    <MemberRequests requests={remote.requests} label={() => 'Save profile'} />
  </>
}
