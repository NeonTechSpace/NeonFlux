import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { getFunctionName } from 'convex/server'
import type { ConvexReactClient } from 'convex/react'
import type { DashboardAuditEntry, DashboardAuditPage } from '@neonflux/backend/dashboard-contracts'
import { AuditLogSection } from '../src/audit-log.tsx'
import type { SectionProps } from '../src/dashboard-sections.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
afterEach(cleanup)

const entry = (id: string,changes: Partial<DashboardAuditEntry> = {}): DashboardAuditEntry => ({ id,kind: 'setting',source: 'command',actorId: '99',feature: 'leveling',setting: 'settings',summary: 'xpPerMessage: 15 → 25',createdAt: Date.UTC(2026,0,2,3,4),...changes })
function setup() {
  const asked: Array<{ cursor: string | null, feature?: string }> = []
  const page = (args: { cursor: string | null, feature?: string }): DashboardAuditPage => args.cursor === 'older'
    ? { serverId: '2',entries: [entry('3',{ setting: 'settings',summary: 'enabled: off → on' })],nextCursor: null }
    : { serverId: '2',entries: args.feature === 'member-data' ? [entry('4',{ kind: 'member-data-deleted',feature: 'member-data',setting: 'delete own data',summary: 'Deleted 2 records: AFK status 1, Leveling XP 1',actorId: '70' })]
      : [entry('1',{ source: 'website',actorName: 'Manager',actorId: '20',feature: 'prefix',setting: 'prefix',summary: 'prefix: ! → ?' }),entry('2',{ kind: 'private-data-viewed',feature: 'moderation',setting: 'case 4',summary: 'Viewed a private case' })],nextCursor: 'older' }
  const client = {
    watchQuery: (ref: unknown,args: { cursor: string | null, feature?: string }) => {
      assert.equal(getFunctionName(ref as never),'auditLog:page')
      asked.push({ cursor: args.cursor,...(args.feature ? { feature: args.feature } : {}) })
      return { localQueryResult: () => page(args),onUpdate: () => () => {} }
    },
  } as unknown as ConvexReactClient
  const props = { section: 'audit',client,sessionToken: 'synthetic-session',serverId: '2',userId: '20',connected: true,catalogLoading: false,catalogError: false,refreshCatalog: () => {},sectionHref: () => '/',openSection: () => {} } satisfies SectionProps
  return { ui: render(createElement(AuditLogSection,props)),asked }
}
const rows = (ui: ReturnType<typeof render>) => within(ui.getByRole('table')).getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell').map(cell => cell.textContent))

test('The audit log shows who changed what and from where, newest first', () => {
  const { ui } = setup()
  assert.deepEqual(rows(ui),[
    ['2026-01-02 03:04 UTC','Manager (20)','Website','Prefix','prefix','prefix: ! → ?'],
    ['2026-01-02 03:04 UTC','99','Command','Moderation and safety','Private data viewed','case 4. Viewed a private case'],
  ])
})

test('Older and Newer page with the cursor, and a feature filter starts again from the newest entries', async () => {
  const { ui,asked } = setup()
  const newer = ui.getByRole('button',{ name: 'Newer' }) as HTMLButtonElement
  assert.equal(newer.disabled,true)
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Older' })) })
  assert.deepEqual(rows(ui),[['2026-01-02 03:04 UTC','99','Command','Leveling','settings','enabled: off → on']])
  assert.equal((ui.getByRole('button',{ name: 'Older' }) as HTMLButtonElement).disabled,true)
  await act(async () => { fireEvent.change(ui.getByRole('combobox',{ name: 'Feature' }),{ target: { value: 'member-data' } }) })
  assert.deepEqual(rows(ui),[['2026-01-02 03:04 UTC','70','Command','Member data','Member deleted their own data','Deleted 2 records: AFK status 1, Leveling XP 1']])
  assert.deepEqual(asked,[{ cursor: null },{ cursor: 'older' },{ cursor: null,feature: 'member-data' }])
})
