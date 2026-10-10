import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { getFunctionName } from 'convex/server'
import type { ConvexReactClient } from 'convex/react'
import type { DashboardAnalyticsSnapshot } from '@neonflux/backend/dashboard-contracts'
import { AnalyticsSection } from '../src/analytics-settings.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
afterEach(cleanup)

// 2026-10-09 is a Friday
const DAY = 86400000, today = Date.UTC(2026,9,9)
// Messages by days before today and UTC hour
type Hours = Record<number,Record<number,number>>
const week: Hours = { 0: { 18: 30,9: 5 },1: { 18: 10 } }, month: Hours = { 0: { 18: 30 },7: { 18: 15 } }, general: Hours = { 2: { 3: 7 } }
function snapshot(range: 7 | 30,enabled = true,channelId?: string): DashboardAnalyticsSnapshot {
  const hours = channelId === '123' ? general : channelId ? {} : range === 7 ? week : month
  return { serverId: '2',enabled,revision: 4,range,
    members: Array.from({ length: 30 },(_,index) => ({ day: today - (29 - index) * DAY,joins: index === 29 ? 3 : 0,leaves: index === 28 ? 2 : 0,onboarded: 0 })),
    messages: Array.from({ length: 14 },(_,index) => ({ day: today - (13 - index) * DAY,count: index * 10 })),
    topChannels: range === 7 ? [{ channelId: '123',count: 90 },{ channelId: '999',count: 12 }] : [{ channelId: '456',count: 400 }],
    channelId: channelId ?? null,
    hours: Array.from({ length: range },(_,index) => { const back = range - 1 - index; return { day: today - back * DAY,counts: Array.from({ length: 24 },(_,hour) => hours[back]?.[hour] ?? 0) } }) }
}
function setup(enabled = true) {
  const watched: string[] = [], saves: unknown[] = []
  const client = {
    action: async (_ref: unknown,args: unknown) => { saves.push(args); return { saved: true,revision: 5 } },
    watchQuery: (ref: unknown,args: { serverId: string,range: 7 | 30,channelId?: string }) => {
      watched.push([getFunctionName(ref as never),args.serverId,args.range,...(args.channelId ? [args.channelId] : [])].join(':'))
      return { localQueryResult: () => snapshot(args.range,enabled,args.channelId),onUpdate: () => () => {} }
    },
  } as unknown as ConvexReactClient
  const catalog = { serverId: '2',roles: [],channels: [{ id: '123',name: 'general',type: 0 },{ id: '456',name: 'events',type: 0 },{ id: '789',name: 'Community',type: 4 }] }
  const ui = render(createElement(AnalyticsSection,{ client,sessionToken: 'synthetic-session',serverId: '2',connected: true,catalog }))
  return { ui,watched,saves }
}

test('Analytics shows the toggle, both day charts and top channels with names or the ID of a missing channel', async () => {
  const { ui,watched } = setup()
  assert.deepEqual(watched,['analytics:dashboard:2:7'])
  assert.ok(ui.getByRole('region',{ name: 'Analytics' }))
  assert.equal((ui.getByLabelText('Count server activity') as HTMLInputElement).checked,true)
  assert.ok(ui.getByRole('img',{ name: 'Member joins and leaves per day for the last 30 days. 3 joins and 2 leaves' }))
  assert.ok(ui.getByRole('img',{ name: 'Messages per day for the last 14 days. 910 messages' }))
  assert.ok(ui.getByText('Joins 3')); assert.ok(ui.getByText('Leaves 2'))
  const members = ui.getByRole('region',{ name: 'Joins and leaves' })
  assert.equal(members.querySelectorAll('path.bar.joins').length,1); assert.equal(members.querySelectorAll('path.bar.leaves').length,1)
  assert.equal(ui.getByRole('region',{ name: 'Messages' }).querySelectorAll('path.bar.messages').length,13)
  const top = within(ui.getByRole('region',{ name: 'Top channels' }))
  assert.deepEqual(top.getAllByRole('listitem').map(item => item.textContent),['#general90','99912'])
  await act(async () => { fireEvent.change(top.getByLabelText('Range'),{ target: { value: '30' } }) })
  assert.deepEqual(watched,['analytics:dashboard:2:7','analytics:dashboard:2:30'])
  assert.deepEqual(within(ui.getByRole('region',{ name: 'Top channels' })).getAllByRole('listitem').map(item => item.textContent),['#events400'])
})

test('Busiest hours shows hour totals and weekday averages for the range, and a channel narrows them to that channel', async () => {
  const { ui,watched } = setup()
  const region = () => ui.getByRole('region',{ name: 'Busiest hours' }), hours = () => within(region())
  assert.match(region().textContent!,/Busiest hour: 18:00 UTC, 40 messages/)
  const hourChart = hours().getByRole('img',{ name: 'Messages per UTC hour of the day over the last 7 days. The busiest hour is 18:00 with 40 messages' })
  assert.equal(hourChart.querySelectorAll('path.bar.messages').length,2)
  // Seven weekdays of 24 cells. Only hours with messages take a step of the blue ramp
  const weekChart = hours().getByRole('img',{ name: 'Messages per UTC hour and weekday over the range. The busiest is Fri 18:00 UTC: 30 messages' })
  const cells = [...weekChart.querySelectorAll<SVGRectElement>('rect.heat-cell')]
  assert.equal(cells.length,168)
  // Ten messages take the second step, five the first and thirty, the busiest, the last
  assert.deepEqual(cells.filter(cell => cell.style.fill !== 'var(--surface-3)').map(cell => cell.style.fill),['rgb(37, 106, 191)','rgb(24, 79, 149)','rgb(183, 211, 246)'])
  assert.ok([...weekChart.querySelectorAll('title')].some(title => title.textContent === 'Thu 18:00 UTC: 10 messages'))
  // Over 30 days a weekday occurs four or five times, so its cells are averages
  await act(async () => { fireEvent.change(within(ui.getByRole('region',{ name: 'Top channels' })).getByLabelText('Range'),{ target: { value: '30' } }) })
  assert.match(region().textContent!,/Busiest hour: 18:00 UTC, 45 messages/)
  assert.ok([...region().querySelectorAll('title')].some(title => title.textContent === 'Fri 18:00 UTC: 9 messages on average over 5 days'))
  // Categories are not offered. Picking a channel watches that channel's hours
  const input = hours().getByRole('combobox',{ name: 'Channel' })
  fireEvent.focus(input)
  fireEvent.change(input,{ target: { value: 'Comm' } })
  assert.equal(hours().queryByRole('option',{ name: /Community/ }),null)
  fireEvent.change(input,{ target: { value: 'gen' } })
  assert.ok(hours().getByRole('option',{ name: /#general/ }))
  await act(async () => { fireEvent.keyDown(input,{ key: 'Enter' }) })
  assert.deepEqual(watched,['analytics:dashboard:2:7','analytics:dashboard:2:30','analytics:dashboard:2:30:123'])
  assert.match(region().textContent!,/Busiest hour: 03:00 UTC, 7 messages/)
  assert.equal(hours().queryByText('Loading the selected channel…'),null)
})

test('Busiest hours says when the chosen channel has no messages in the range', async () => {
  const { ui } = setup()
  const input = within(ui.getByRole('region',{ name: 'Busiest hours' })).getByRole('combobox',{ name: 'Channel' })
  fireEvent.focus(input)
  fireEvent.change(input,{ target: { value: 'events' } })
  await act(async () => { fireEvent.keyDown(input,{ key: 'Enter' }) })
  const region = within(ui.getByRole('region',{ name: 'Busiest hours' }))
  assert.ok(region.getByText('No messages counted in this range yet'))
  assert.equal(region.queryByRole('img'),null)
})

test('Analytics off says the bot is not counting and the toggle saves with the current revision', async () => {
  const { ui,saves } = setup(false)
  assert.ok(ui.getByText('Analytics is off. The bot is not counting activity for this server. Existing counts stay until they age out'))
  const toggle = ui.getByLabelText('Count server activity') as HTMLInputElement
  assert.equal(toggle.checked,false)
  fireEvent.click(toggle)
  await act(async () => { fireEvent.submit(toggle.closest('form')!) })
  assert.deepEqual(saves,[{ sessionToken: 'synthetic-session',serverId: '2',expectedRevision: 4,enabled: true }])
  assert.ok(ui.getByText('Settings saved'))
})
