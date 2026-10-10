import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { getFunctionName } from 'convex/server'
import type { ConvexReactClient } from 'convex/react'
import type { DashboardStructure, DashboardStructurePreview, StructureChannel, StructureEntry } from '@neonflux/backend/dashboard-contracts'
import type { SectionProps } from '../src/dashboard-sections.tsx'
import { StructureSection } from '../src/structure-editor.tsx'
import { DraftScopeProvider, readDraft } from '../src/drafts.ts'
import { localTime } from '../src/time.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
afterEach(cleanup)

// A live view that tests can change, a one-shot preview and every mutation the section sends
function client(view: DashboardStructure,preview?: DashboardStructurePreview) {
  const calls: Array<[string,unknown]> = [], listeners: Array<() => void> = []
  let current = view
  const convex = {
    watchQuery: () => ({ localQueryResult: () => current,onUpdate: (listener: () => void) => { listeners.push(listener); return () => {} } }),
    mutation: async (ref: unknown,args: unknown) => { const name = getFunctionName(ref as never); calls.push([name,args]); return name === 'structure:save' ? { queued: true,requestedAt: 7 } : null },
    query: async (ref: unknown,args: unknown) => { calls.push([getFunctionName(ref as never),args]); return preview },
  } as unknown as ConvexReactClient
  return { calls,convex,update: (next: DashboardStructure) => { current = next; listeners.forEach(listener => listener()) } }
}
const props = (convex: ConvexReactClient) => ({ section: 'structure',client: convex,sessionToken: 'synthetic-session',serverId: '2',userId: '20',connected: true,catalogLoading: false,catalogError: false,
  catalog: { serverId: '2',channels: [],roles: [{ id: '40',name: 'Members',position: 1 }] },refreshCatalog: () => {},sectionHref: (id: string) => `/?server=2&section=${id}`,openSection: () => {} }) satisfies SectionProps

const channel = (id: string,type: StructureChannel['type'],name: string,parentId: string | null = null,manage = true): StructureChannel => ({ id,type,name,parentId,manage })
// Chat holds general and lounge, Info holds rules, which the manager cannot change, and welcome sits at the top level
const channels = [channel('200','category','Chat'),channel('201','text','general','200'),channel('202','voice','lounge','200'),channel('100','category','Info'),
  channel('101','text','rules','100',false),channel('300','text','welcome')]
const view = (overrides: Partial<DashboardStructure> = {}): DashboardStructure => ({ serverId: '2',state: 'done',work: 'read',requestedAt: 1,archived: [],save: null,
  read: { readAt: Date.UTC(2026,9,1,9,0),channels,threadsTruncated: false,threads: [{ id: '900',parentId: '201',name: 'plans',private: false,archived: false },
    { id: '901',parentId: '201',name: 'secret',private: true,archived: false }] },...overrides })
const entries = (rows: readonly StructureChannel[]): StructureEntry[] => rows.map(({ id,type,name,parentId }) => ({ id,type,name,parentId }))
const names = (ui: ReturnType<typeof render>) => ui.getAllByRole('textbox').map(input => (input as HTMLInputElement).value)

test('The structure opens with a fresh read, shows threads as fixed children and loads closed threads on request', async () => {
  const { calls,convex } = client(view({ changedAt: Date.UTC(2026,9,1,9,5) }))
  const ui = render(createElement(StructureSection,props(convex)))
  await act(async () => {})
  assert.deepEqual(calls,[['structure:request',{ sessionToken: 'synthetic-session',serverId: '2' }]])
  assert.deepEqual(names(ui),['Chat','general','lounge','Info','rules','welcome'])
  assert.equal((ui.getByRole('textbox',{ name: 'Name of text rules' }) as HTMLInputElement).disabled,true)
  assert.ok(ui.getByText('You need Manage Channels to change it'))
  // Categories and channels can be dragged, threads cannot
  assert.equal(ui.container.querySelectorAll('[draggable=true]').length,5)
  const threads = within(ui.getByRole('list',{ name: 'Threads in general' })).getAllByRole('listitem')
  assert.deepEqual(threads.map(item => [item.textContent,item.closest('[draggable]')]),[['plans',null],['secret, private',null]])
  assert.match(ui.getAllByRole('status').map(item => item.textContent).join(' '),/The server changed after this read/)
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Show closed threads of general' })) })
  assert.deepEqual(calls.at(-1),['structure:threads',{ sessionToken: 'synthetic-session',serverId: '2',channelId: '201' }])
})

test('Names and order change by typing, buttons, the category choice and dragging, then the review and the save send the draft with its start', async () => {
  const preview: DashboardStructurePreview = { readAt: 1,items: [{ itemNo: 1,disposition: 'apply',reason: null,change: { type: 'rename',channelId: '201',from: 'general',to: 'chat' } },
    { itemNo: 2,disposition: 'conflict',reason: 'It was moved since your draft started',change: { type: 'move',channelId: '202',name: 'lounge',from: { parentId: '200',parentName: 'Chat',afterId: '201',afterName: 'general' },
      to: { parentId: '100',parentName: 'Info',afterId: '101',afterName: 'rules' } } }] }
  const { calls,convex,update } = client(view(),preview)
  const ui = render(createElement(StructureSection,props(convex)))
  await act(async () => {})
  await act(async () => { fireEvent.change(ui.getByRole('textbox',{ name: 'Name of text general' }),{ target: { value: 'chat' } }) })
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Move text welcome up' })) })
  assert.deepEqual(names(ui),['Chat','chat','lounge','welcome','Info','rules'])
  await act(async () => { fireEvent.change(ui.getByRole('combobox',{ name: 'Category of voice lounge' }),{ target: { value: '100' } }) })
  assert.match(ui.getAllByRole('status').map(item => item.textContent).join(' '),/lounge moved to Info, position 2 of 2/)
  // Dropping a category on another places it before that one
  const row = (label: string) => ui.getByRole('textbox',{ name: label }).closest('.structure-row')!
  const dataTransfer = { setData: () => {} }
  await act(async () => { fireEvent.dragStart(row('Name of category Info'),{ dataTransfer }) })
  await act(async () => { fireEvent.dragOver(row('Name of category Chat'),{ dataTransfer }) })
  await act(async () => { fireEvent.drop(row('Name of category Chat'),{ dataTransfer }) })
  assert.deepEqual(names(ui),['Info','rules','lounge','Chat','chat','welcome'])
  assert.equal(ui.getByText(/^Unsaved draft/).textContent,`Unsaved draft, started from the read of ${localTime(Date.UTC(2026,9,1,9,0))} Discard draft`)

  const draft = [{ id: '100',type: 'category',name: 'Info',parentId: null },{ id: '101',type: 'text',name: 'rules',parentId: '100' },{ id: '202',type: 'voice',name: 'lounge',parentId: '100' },
    { id: '200',type: 'category',name: 'Chat',parentId: null },{ id: '201',type: 'text',name: 'chat',parentId: '200' },{ id: '300',type: 'text',name: 'welcome',parentId: null }]
  const sent = { sessionToken: 'synthetic-session',serverId: '2',base: entries(channels),draft }
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Review changes' })) })
  assert.deepEqual(calls.at(-1),['structure:preview',sent])
  const rows = () => within(ui.getAllByRole('table').at(-1)!).getAllByRole('row').slice(1).map(item => within(item).getAllByRole('cell').map(cell => cell.textContent).join(' | '))
  assert.deepEqual(rows(),['Rename general to chat | Will be saved','Move lounge from Chat, after general to Info, after rules | Conflicts: It was moved since your draft started'])
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Save changes' })) })
  assert.deepEqual(calls.at(-1),['structure:save',sent])
  // The sent draft cannot change while NeonFlux saves it
  assert.equal((ui.getByRole('textbox',{ name: 'Name of text general' }) as HTMLInputElement).disabled,true)

  // Its results end the draft, and a fix names the channel and the role instead of their mentions
  await act(async () => { update(view({ state: 'queued',requestedAt: 8,save: { requestedAt: 7,results: [{ itemNo: 1,change: preview.items[0]!.change,outcome: 'applied',reason: null },
    { itemNo: 2,change: preview.items[1]!.change,outcome: 'failed',reason: 'Grant Manage Channels to the NeonFlux role and allow it in <#202> and move it above <@&40>' }] } })) })
  assert.deepEqual(names(ui),['Chat','general','lounge','Info','rules','welcome'])
  assert.deepEqual(rows(),['Rename general to chat | Saved','Move lounge from Chat, after general to Info, after rules | Failed: Grant Manage Channels to the NeonFlux role and allow it in #lounge and move it above @Members'])
})

test('A save the bot never took keeps the draft, so it can be saved again', async () => {
  const preview: DashboardStructurePreview = { readAt: 1,items: [{ itemNo: 1,disposition: 'apply',reason: null,change: { type: 'rename',channelId: '201',from: 'general',to: 'chat' } }] }
  const { calls,convex,update } = client(view(),preview), scope = { userId: '20',serverId: '2',section: 'structure' }
  const ui = render(createElement(DraftScopeProvider,{ value: scope },createElement(StructureSection,props(convex))))
  await act(async () => {})
  await act(async () => { fireEvent.change(ui.getByRole('textbox',{ name: 'Name of text general' }),{ target: { value: 'chat' } }) })
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Review changes' })) })
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Save changes' })) })
  // A sent draft leaves this tab's storage while NeonFlux has it
  assert.equal((ui.getByRole('textbox',{ name: 'Name of text general' }) as HTMLInputElement).disabled,true)
  assert.equal(readDraft(scope,'draft'),undefined)
  await act(async () => { update(view({ state: 'failed',work: 'save',requestedAt: 7,failure: 'unanswered' })) })
  assert.match(ui.getByRole('alert').textContent!,/NeonFlux did not answer/)
  const input = ui.getByRole('textbox',{ name: 'Name of text general' }) as HTMLInputElement
  assert.deepEqual([input.value,input.disabled],['chat',false])
  assert.equal(readDraft<StructureEntry[]>(scope,'draft')?.find(entry => entry.id === '201')?.name,'chat')
  assert.deepEqual(readDraft<{ entries: StructureEntry[] }>(scope,'base')?.entries,entries(channels))
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Review changes' })) })
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Save changes' })) })
  assert.equal(calls.filter(([name]) => name === 'structure:save').length,2)
})
