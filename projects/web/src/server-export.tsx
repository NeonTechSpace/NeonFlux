import type { ServerExportFile, ServerExportPage } from '@neonflux/backend/contracts'
import { useEffect, useRef, useState } from 'react'
import { dashboardApi } from './dashboard-api'
import type { SectionProps } from './dashboard-sections'
import { useLiveQuery } from './live-query'

type Phase = { phase: 'idle' | 'refused' | 'failed' | 'error' } | { phase: 'checking', resume: boolean } | { phase: 'reading', records: number } | { phase: 'ready', url: string, name: string, records: number }
const count = (file: ServerExportFile) => file.levels.length + file.cases.length + file.appeals.length
function add(file: ServerExportFile, page: ServerExportPage) {
  if (page.section === 'levels') file.levels.push(...page.levels)
  else if (page.section === 'cases') file.cases.push(...page.cases)
  else if (page.section === 'appeals') file.appeals.push(...page.appeals)
  else if (!file.settings[page.family]) file.settings[page.family] = page.data
  // A later page of a family continues its lists
  else for (const [key,value] of Object.entries(page.data)) file.settings[page.family]![key] = [...file.settings[page.family]![key] as unknown[] ?? [],...value as unknown[]]
}

/** The owner's readable export of the server's data. It starts after the same live check as private cases, which must find the
 *  server owner, and reads the export page by page while that check is fresh. An export that outlasts it continues after a new check */
export function ServerExportSection({ client,sessionToken,serverId }: Pick<SectionProps,'client' | 'sessionToken' | 'serverId'>) {
  const access = useLiveQuery(client,dashboardApi.privateAccess,{ sessionToken,serverId })
  const [state,setState] = useState<Phase>({ phase: 'idle' })
  const run = useRef<{ cursor: string | null, file: ServerExportFile }>(undefined), mounted = useRef(true)
  const check = access.data?.check, checkKey = check ? `${check.state}:${check.checkedAt ?? check.requestedAt}` : 'none'
  useEffect(() => () => { mounted.current = false },[])
  useEffect(() => () => { if (state.phase === 'ready') URL.revokeObjectURL(state.url) },[state])
  const read = async () => {
    const current = run.current!
    do {
      const answer = await client.query(dashboardApi.exportPage,{ sessionToken,serverId,cursor: current.cursor })
      if (!mounted.current) return
      if (answer.status === 'expired') { setState({ phase: 'checking',resume: true }); return }
      add(current.file,answer.page)
      current.cursor = answer.page.cursor
      setState({ phase: 'reading',records: count(current.file) })
    } while (current.cursor)
    const name = `neonflux-server-export-${serverId}.json`
    setState({ phase: 'ready',name,records: count(current.file),url: URL.createObjectURL(new Blob([JSON.stringify({ ...current.file,lastPart: true },null,2)],{ type: 'application/json' })) })
  }
  // A start that waits for the bot's check asks again when the check answers
  const resume = state.phase === 'checking' && state.resume
  useEffect(() => {
    if (state.phase !== 'checking') return
    let active = true
    client.mutation(dashboardApi.exportStart,{ sessionToken,serverId,...resume ? { resume } : {} }).then(result => {
      if (!active) return
      if (result.status === 'ok') { setState({ phase: 'reading',records: count(run.current!.file) }); read().catch(() => { if (mounted.current) setState({ phase: 'error' }) }) }
      else if (result.status !== 'checking') setState({ phase: result.status })
    },() => { if (active) setState({ phase: 'error' }) })
    return () => { active = false }
  },[state.phase,resume,checkKey])
  const begin = () => {
    run.current = { cursor: null,file: { format: 'neonflux-server-export',version: 1,serverId,exportedAt: Date.now(),part: 1,lastPart: true,settings: {},levels: [],cases: [],appeals: [] } }
    setState({ phase: 'checking',resume: false })
  }
  const busy = state.phase === 'checking' || state.phase === 'reading'
  return <section className="panel" aria-labelledby="export-title">
    <h2 id="export-title">Server export</h2>
    <p className="muted">A readable JSON file of this server's NeonFlux data: The settings of every feature, leveling XP and levels, moderation cases with their corrections and appeals. Text the owner erased stays out. Other bots can load it, and the export guide in the NeonFlux documentation describes every field. It is separate from the encrypted backup, which only restores into NeonFlux</p>
    <p className="muted">Only the server owner can export, because the file holds private moderation data. NeonFlux checks with Fluxer that you own the server, and the audit log records each export. You can also send <code>!export</code> to NeonFlux in a DM</p>
    {state.phase === 'checking' && <p role="status">Checking with NeonFlux that you own this server…</p>}
    {state.phase === 'reading' && <p role="status">Reading the export… {state.records} records so far</p>}
    {state.phase === 'refused' && <p className="notice error" role="alert">Only the server owner can export this server's data</p>}
    {state.phase === 'failed' && <p className="notice error" role="alert">NeonFlux could not check your access. The bot may be offline</p>}
    {state.phase === 'error' && <p className="notice error" role="alert">The export could not be read. Check your connection and try again</p>}
    {state.phase === 'ready' && <p role="status">The export is ready with {state.records} {state.records === 1 ? 'record' : 'records'}. <a className="button" href={state.url} download={state.name}>Save {state.name}</a></p>}
    <div className="actions"><button type="button" disabled={busy} onClick={begin}>{state.phase === 'idle' ? 'Export server data' : 'Export again'}</button></div>
  </section>
}
