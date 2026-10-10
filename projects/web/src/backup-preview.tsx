import type { BackupPreviewFailure, BackupPreviewItem } from '@neonflux/backend/contracts'
import { useCallback, useEffect, useState } from 'react'
import { dashboardApi } from './dashboard-api'
import type { SectionProps } from './dashboard-sections'
import { useLiveQuery } from './live-query'
import { mentionText, type MentionNames } from './mentions'
import { localTime } from './time'

const PAGE = 25
const failures: Record<BackupPreviewFailure,string> = {
  owner: 'NeonFlux found that you no longer own this server or that its DM with you is no longer private, so the preview was removed',
  archive: 'NeonFlux could not read the archive again. Its DM message may be deleted or its attachment expired, or the recovery key changed. Send !backup preview with the archive attached again',
  key: 'Backups are off because the bot has no backup key, so the archive cannot be read. The bot operator sets NEONFLUX_BACKUP_KEY',
  refused: 'A restore refuses this archive as a whole. It may exceed restore limits, or a channel permission overwrite may grant permissions that you or NeonFlux lack',
  error: 'NeonFlux could not read the archive or the server right now. Check again shortly',
  unanswered: 'NeonFlux did not answer. Check that the bot is online, then check again',
}
// Reasons name channels, roles and members as mentions, shown with the names of the server's channel and role lists
const outcome = (item: BackupPreviewItem, names?: MentionNames) => item.disposition === 'create' ? 'Would be created' : item.disposition === 'skip' ? 'Skipped, identical'
  : `${item.disposition === 'conflict' ? 'Skipped, conflicts' : 'Blocked'}: ${mentionText(item.reason ?? '',names)}`
const capital = (text: string) => text.replace(/^./,letter => letter.toUpperCase())
const familyNames: Partial<Record<string,string>> = { ticketCategory: 'Ticket category',milestoneRoute: 'Milestone route' }
/** What an archive item is, as the bot's preview names it. Restores stay in their own server, so an archive channel's ID names the channel there while it exists */
const target = (item: BackupPreviewItem, names?: MentionNames) => item.category === 'structure' ? `Channel ${item.name ?? mentionText(`<#${item.sourceId}>`,names)}`
  : item.category === 'xp' ? `XP of ${mentionText(`<@${item.sourceId}>`)}` : item.family === 'cleanupPolicy' ? `Message cleanup in ${mentionText(`<#${item.sourceId}>`,names)}`
    : item.sourceId === item.family ? capital(item.family) : `${familyNames[item.family] ?? capital(item.family)} ${item.sourceId}`

/** The owner's latest read-only restore preview. Opening it asks NeonFlux to read the archive and the server again with its own token */
export function BackupSection({ client,sessionToken,serverId,catalog }: SectionProps) {
  const { data,error } = useLiveQuery(client,dashboardApi.backupPreview,{ sessionToken,serverId })
  const [failed,setFailed] = useState(false), [page,setPage] = useState(0)
  const request = useCallback(() => {
    setFailed(false)
    client.mutation(dashboardApi.requestBackupPreview,{ sessionToken,serverId }).catch(() => setFailed(true))
  },[client,sessionToken,serverId])
  useEffect(request,[request])
  const preview = data?.preview, items = preview?.items ?? [], pages = Math.max(1,Math.ceil(items.length / PAGE)), shown = items.slice(page * PAGE,(page + 1) * PAGE)
  return <section className="panel" aria-labelledby="backup-title">
    <h2 id="backup-title">Backup preview</h2>
    <p className="muted">What restoring your latest previewed archive would do to the server as it is now, without changing anything. Make a preview with <code>!backup preview</code> and an attached archive in a DM with NeonFlux. Only the server owner who made it sees it here. Restoring stays in that DM</p>
    {(failed || error) && <p className="notice error" role="alert">The preview could not be loaded. Refresh your sign-in or try again</p>}
    {data === undefined ? !error && <p role="status">Loading…</p> : data === null ? <p role="status">No preview yet</p> : <>
      {data.state === 'queued' && <p role="status">Asking NeonFlux to read the archive and the server again…</p>}
      {data.state === 'failed' && data.failure && <p className="notice error" role="alert">{failures[data.failure]}</p>}
      {preview && <>
        <p>Archive {preview.backupId}, checked {localTime(preview.checkedAt)}: Would create {preview.counts.create}, skip as identical {preview.counts.skip}, skip as conflicting {preview.counts.conflict}, blocked {preview.counts.blocked}</p>
        <table className="audit-table"><thead><tr><th>Item</th><th>What</th><th>Outcome</th></tr></thead><tbody>
          {shown.map(item => <tr key={item.itemNo}><td>{item.itemNo}</td><td>{target(item,catalog)}</td><td>{outcome(item,catalog)}</td></tr>)}
        </tbody></table>
        <div className="actions">
          <button type="button" className="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="muted">Page {page + 1} of {pages}</span>
          <button type="button" className="secondary" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </>}
      <div className="actions"><button type="button" className="secondary" disabled={data.state === 'queued'} onClick={request}>Check again</button></div>
    </>}
  </section>
}
