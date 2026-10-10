import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { getFunctionName } from 'convex/server'
import type { ConvexReactClient } from 'convex/react'
import type { BackupPreviewItem } from '@neonflux/backend/contracts'
import type { DashboardBackupPreview, RecoveryInbox } from '@neonflux/backend/dashboard-contracts'
import type { SectionProps } from '../src/dashboard-sections.tsx'
import { RecoverySection } from '../src/recovery-inbox.tsx'
import { BackupSection } from '../src/backup-preview.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
afterEach(cleanup)

function client(answers: Record<string,unknown>) {
  const mutations: string[] = []
  return { mutations,client: {
    watchQuery: (ref: unknown) => ({ localQueryResult: () => answers[getFunctionName(ref as never)],onUpdate: () => () => {} }),
    mutation: async (ref: unknown) => { mutations.push(getFunctionName(ref as never)); return null },
  } as unknown as ConvexReactClient }
}
const props = (section: SectionProps['section'],convex: ConvexReactClient,opened: string[] = []) => ({ section,client: convex,sessionToken: 'synthetic-session',serverId: '2',userId: '20',connected: true,catalogLoading: false,catalogError: false,
  refreshCatalog: () => {},sectionHref: (id: string) => `/?server=2&section=${id}`,openSection: (id: string) => { opened.push(id) } }) satisfies SectionProps

test('The recovery inbox shows each entry with when it happened and its next step, and links a feature that needs setup', async () => {
  const inbox: RecoveryInbox = { serverId: '2',truncated: false,entries: [
    { kind: 'feature',feature: 'logs' },
    { kind: 'work',source: 'publishing',at: Date.UTC(2026,9,1,12,30),summary: 'Post 7: NeonFlux could not confirm whether it was sent',next: '!publish reconcile 7' },
    { kind: 'setup',at: Date.UTC(2026,9,1,11,0),problem: { kind: 'permissions',feature: 'moderation',permissions: ['KickMembers'] } },
  ] }
  const opened: string[] = []
  const ui = render(createElement(RecoverySection,props('recovery',client({ 'recovery:inbox': inbox }).client,opened)))
  assert.deepEqual(within(ui.getByRole('list')).getAllByRole('listitem').map(item => item.textContent),[
    'Now: Channel logs is on but needs setup, such as a channel or a first entry. Open Channel logs',
    '2026-10-01 12:30 UTC: Post 7: NeonFlux could not confirm whether it was sentNext: !publish reconcile 7',
    '2026-10-01 11:00 UTC, permission check: Moderation and safety: Grant Kick Members to the NeonFlux role',
  ])
  await act(async () => { fireEvent.click(ui.getByRole('link',{ name: 'Open Channel logs' })) })
  assert.deepEqual(opened,['logs'])
  cleanup()
  const empty = render(createElement(RecoverySection,props('recovery',client({ 'recovery:inbox': { serverId: '2',truncated: false,entries: [] } }).client)))
  assert.ok(empty.getByText('Nothing needs attention'))
})

test('The backup preview asks the bot for a fresh read on open and pages the items with their outcome', async () => {
  const items: BackupPreviewItem[] = Array.from({ length: 27 },(_,i) => ({ itemNo: i + 1,category: 'xp',family: 'xp',sourceId: String(100 + i),disposition: 'create',reason: null }))
  items[26] = { itemNo: 27,category: 'xp',family: 'xp',sourceId: '126',disposition: 'blocked',reason: 'XP profile capacity reached' }
  const preview: DashboardBackupPreview = { serverId: '2',state: 'failed',failure: 'archive',requestedAt: 1,preview: { backupId: 'synthetic',archiveDigest: 'a'.repeat(64),checkedAt: Date.UTC(2026,9,1,9,0),counts: { create: 26,skip: 0,conflict: 0,blocked: 1 },items } }
  const { client: convex,mutations } = client({ 'backup:previewView': preview })
  const ui = render(createElement(BackupSection,props('backup',convex)))
  await act(async () => {})
  assert.deepEqual(mutations,['backup:previewRequest'])
  assert.match(ui.getByRole('alert').textContent!,/could not read the archive again/)
  assert.ok(ui.getByText(/Would create 26, skip as identical 0, skip as conflicting 0, blocked 1/))
  const rows = () => within(ui.getByRole('table')).getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell').map(cell => cell.textContent).join(' | '))
  assert.equal(rows().length,25)
  assert.equal(rows()[0],'1 | XP of 100 | Would be created')
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Next' })) })
  assert.deepEqual(rows(),['26 | XP of 125 | Would be created','27 | XP of 126 | Blocked: XP profile capacity reached'])
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Check again' })) })
  assert.deepEqual(mutations,['backup:previewRequest','backup:previewRequest'])
  cleanup()
  assert.ok(render(createElement(BackupSection,props('backup',client({ 'backup:previewView': null }).client))).getByText('No preview yet'))
})
