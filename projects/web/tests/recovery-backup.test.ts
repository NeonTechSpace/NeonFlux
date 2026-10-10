import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { getFunctionName } from 'convex/server'
import type { ConvexReactClient } from 'convex/react'
import type { BackupPreviewItem } from '@neonflux/contracts/backup'
import type { DashboardBackupPreview, DashboardCatalog, RecoveryInbox } from '@neonflux/backend/dashboard-contracts'
import type { SectionProps } from '../src/dashboard-sections.tsx'
import { RecoverySection } from '../src/recovery-inbox.tsx'
import { BackupSection } from '../src/backup-preview.tsx'
import { localTime } from '../src/time.ts'

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

// The server's channel and role lists, which name the mentions in recovery entries and backup reasons
const catalog: DashboardCatalog = { serverId: '2',channels: [{ id: '50',name: 'news',type: 0 }],roles: [{ id: '2',name: '@everyone',position: 0 },{ id: '40',name: 'Members',position: 1 }] }

test('The recovery inbox shows each entry with when it happened and its next step, and links a feature that needs setup', async () => {
  const inbox: RecoveryInbox = { serverId: '2',truncated: false,entries: [
    { kind: 'feature',feature: 'logs' },
    { kind: 'work',source: 'publishing',at: Date.UTC(2026,9,1,12,30),summary: 'Post #7: NeonFlux could not confirm whether it was sent',next: '!publish reconcile 7' },
    { kind: 'work',source: 'schedules',at: Date.UTC(2026,9,1,12,0),summary: 'Schedule news, date 4 is waiting: NeonFlux cannot post in <#50>',next: 'Give NeonFlux Send Messages in <#50>' },
    // Members show their ID, as a command takes it, and a channel or role missing from the lists says so
    { kind: 'work',source: 'temproles',at: Date.UTC(2026,9,1,11,30),summary: 'Temporary role <@&40> of <@30>: NeonFlux could not confirm the last role change',next: '!temprole reconcile <@30>' },
    { kind: 'work',source: 'cleanup',at: Date.UTC(2026,9,1,11,15),summary: 'Cleanup in <#51> stopped: A message could not be deleted, <@&41> or <@&2> may matter',next: 'Check it' },
    { kind: 'setup',at: Date.UTC(2026,9,1,11,0),problem: { kind: 'permissions',feature: 'moderation',permissions: ['KickMembers'] } },
  ] }
  const opened: string[] = []
  const ui = render(createElement(RecoverySection,{ ...props('recovery',client({ 'recovery:inbox': inbox }).client,opened),catalog }))
  assert.deepEqual(within(ui.getByRole('list')).getAllByRole('listitem').map(item => item.textContent),[
    'Now: Channel logs is on but needs setup, such as a channel or a first entry. Open Channel logs',
    `${localTime(Date.UTC(2026,9,1,12,30))}: Post #7: NeonFlux could not confirm whether it was sentNext: !publish reconcile 7`,
    `${localTime(Date.UTC(2026,9,1,12,0))}: Schedule news, date 4 is waiting: NeonFlux cannot post in #newsNext: Give NeonFlux Send Messages in #news`,
    `${localTime(Date.UTC(2026,9,1,11,30))}: Temporary role @Members of @30: NeonFlux could not confirm the last role changeNext: !temprole reconcile 30`,
    `${localTime(Date.UTC(2026,9,1,11,15))}: Cleanup in #unknown-channel stopped: A message could not be deleted, @unknown-role or @everyone may matterNext: Check it`,
    `${localTime(Date.UTC(2026,9,1,11,0))}, permission check: Moderation and safety: Grant Kick Members to the NeonFlux role`,
  ])
  await act(async () => { fireEvent.click(ui.getByRole('link',{ name: 'Open Channel logs' })) })
  assert.deepEqual(opened,['logs'])
  cleanup()
  const empty = render(createElement(RecoverySection,props('recovery',client({ 'recovery:inbox': { serverId: '2',truncated: false,entries: [] } }).client)))
  assert.ok(empty.getByText('Nothing needs attention'))
})

test('The backup preview asks the bot for a fresh read on open and pages the items with their outcome', async () => {
  const items: BackupPreviewItem[] = Array.from({ length: 27 },(_,i) => ({ itemNo: i + 1,category: 'xp',family: 'xp',sourceId: String(100 + i),disposition: 'create',reason: null }))
  items[24] = { itemNo: 25,category: 'config',family: 'cleanupPolicy',sourceId: '50',disposition: 'create',reason: null }
  items[25] = { itemNo: 26,category: 'structure',family: 'structure',sourceId: '60',name: 'updates',disposition: 'blocked',reason: 'The role <@&40> in its permissions is gone, or you or NeonFlux cannot see it' }
  items[26] = { itemNo: 27,category: 'xp',family: 'xp',sourceId: '126',disposition: 'blocked',reason: 'The server has reached its limit of 50,000 members with XP' }
  const preview: DashboardBackupPreview = { serverId: '2',state: 'failed',failure: 'archive',requestedAt: 1,preview: { backupId: 'synthetic',archiveDigest: 'a'.repeat(64),checkedAt: Date.UTC(2026,9,1,9,0),counts: { create: 25,skip: 0,conflict: 0,blocked: 2 },items } }
  const { client: convex,mutations } = client({ 'backup:previewView': preview })
  const ui = render(createElement(BackupSection,{ ...props('backup',convex),catalog }))
  await act(async () => {})
  assert.deepEqual(mutations,['backup:previewRequest'])
  assert.match(ui.getByRole('alert').textContent!,/could not read the archive again/)
  assert.equal(ui.getByText(/Would create 25/).textContent,`Archive synthetic, checked ${localTime(Date.UTC(2026,9,1,9,0))}: Would create 25, skip as identical 0, skip as conflicting 0, blocked 2`)
  const rows = () => within(ui.getByRole('table')).getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell').map(cell => cell.textContent).join(' | '))
  assert.equal(rows().length,25)
  // Items name members, channels and features in words, and reasons name roles instead of their mentions
  assert.equal(rows()[0],'1 | XP of @100 | Would be created')
  assert.equal(rows()[24],'25 | Message cleanup in #news | Would be created')
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Next' })) })
  assert.deepEqual(rows(),['26 | Channel updates | Blocked: The role @Members in its permissions is gone, or you or NeonFlux cannot see it','27 | XP of @126 | Blocked: The server has reached its limit of 50,000 members with XP'])
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Check again' })) })
  assert.deepEqual(mutations,['backup:previewRequest','backup:previewRequest'])
  cleanup()
  assert.ok(render(createElement(BackupSection,props('backup',client({ 'backup:previewView': null }).client))).getByText('No preview yet'))
})
