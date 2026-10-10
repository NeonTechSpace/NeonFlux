import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { getFunctionName } from 'convex/server'
import type { ConvexReactClient } from 'convex/react'
import type { ServerExportFile, ServerExportPage } from '@neonflux/backend/contracts'
import type { DashboardExportPage, DashboardExportStart, DashboardPrivateAccess } from '@neonflux/backend/dashboard-contracts'
import { ServerExportSection } from '../src/server-export.tsx'
import { auditFeatures } from '../src/audit-log.tsx'
import { navigation } from '../src/dashboard-sections.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act } = await import('@testing-library/react')
afterEach(cleanup)

// A live client whose access check the test publishes, with export starts and pages the test answers
function liveClient(start: (resume: boolean) => DashboardExportStart,page: (cursor: string | null) => DashboardExportPage) {
  let access: DashboardPrivateAccess = { serverId: '2',roleConfigured: false,check: null }
  const listeners = new Set<() => void>(), starts: boolean[] = [], cursors: Array<string | null> = []
  const client = {
    watchQuery: () => ({ localQueryResult: () => access,onUpdate: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) } }),
    mutation: async (ref: unknown,args: { resume?: boolean }) => {
      assert.equal(getFunctionName(ref as never),'serverExport:start')
      starts.push(args.resume === true)
      return start(args.resume === true)
    },
    query: async (ref: unknown,args: { cursor: string | null }) => {
      assert.equal(getFunctionName(ref as never),'serverExport:page')
      cursors.push(args.cursor)
      return page(args.cursor)
    },
  } as unknown as ConvexReactClient
  return { client,starts,cursors,publish: async (check: DashboardPrivateAccess['check']) => { access = { ...access,check }; await act(async () => { listeners.forEach(listener => listener()) }) } }
}

test('The owner exports after the live check, the export continues after a new check when the first one ends, and the file holds every page', async () => {
  const blobs: Blob[] = []
  Object.assign(URL,{ createObjectURL: (blob: Blob) => { blobs.push(blob); return 'blob:synthetic-export' },revokeObjectURL: () => {} })
  let passed = false, expired = true
  const pages: Record<string,ServerExportPage> = {
    start: { section: 'settings',family: 'moderation',data: { settings: { appealsEnabled: true },watchlist: [{ userId: '1' }] },cursor: 'a' },
    a: { section: 'settings',family: 'moderation',data: { watchlist: [{ userId: '2' }] },cursor: 'b' },
    b: { section: 'levels',levels: [{ userId: '21',xp: 400,level: 2 }],cursor: null },
  }
  const live = liveClient(() => ({ status: passed ? 'ok' : 'checking' }),cursor => {
    // The owner's check ends once, before the second page
    if (cursor === 'a' && expired) { expired = false; passed = false; return { status: 'expired' } }
    return { status: 'ok',page: pages[cursor ?? 'start']! }
  })
  const ui = render(createElement(ServerExportSection,{ client: live.client,sessionToken: 'synthetic-session',serverId: '2' }))
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Export server data' })) })
  assert.equal(ui.getByRole('status').textContent,'Checking with NeonFlux that you own this server…')
  passed = true
  await live.publish({ state: 'passed',requestedAt: 1,checkedAt: 2,validUntil: 120002 })
  assert.match(ui.getByRole('status').textContent!,/Checking with NeonFlux/)
  passed = true
  await live.publish({ state: 'passed',requestedAt: 3,checkedAt: 4,validUntil: 120004 })
  await act(async () => {})
  assert.deepEqual(live.starts,[false,false,true,true])
  assert.deepEqual(live.cursors,[null,'a','a','b'])
  const link = ui.getByRole('link',{ name: 'Save neonflux-server-export-2.json' })
  assert.equal(link.getAttribute('download'),'neonflux-server-export-2.json')
  assert.match(ui.getByRole('status').textContent!,/ready with 1 record. /)
  const file = JSON.parse(await blobs[0]!.text()) as ServerExportFile
  assert.deepEqual([file.format,file.version,file.serverId,file.part,file.lastPart],['neonflux-server-export',1,'2',1,true])
  assert.deepEqual(file.settings.moderation,{ settings: { appealsEnabled: true },watchlist: [{ userId: '1' },{ userId: '2' }] })
  assert.deepEqual(file.levels,[{ userId: '21',xp: 400,level: 2 }])
  assert.ok(auditFeatures.some(([id,name]) => id === 'export' && name === 'Server export'))
  assert.ok(navigation.some(([group,items]) => group === 'Insights' && items.some(([id]) => id === 'export')))
})

test('Someone other than the owner is told that only the owner can export, and nothing is read', async () => {
  const live = liveClient(() => ({ status: 'refused' }),() => { throw new Error('No page is read without the owner') })
  const ui = render(createElement(ServerExportSection,{ client: live.client,sessionToken: 'synthetic-session',serverId: '2' }))
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Export server data' })) })
  assert.equal(ui.getByRole('alert').textContent,'Only the server owner can export this server\'s data')
  assert.deepEqual(live.cursors,[])
})
