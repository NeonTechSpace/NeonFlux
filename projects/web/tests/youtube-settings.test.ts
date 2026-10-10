import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import type { YoutubeSubscription, YoutubeView } from '@neonflux/backend/contracts'
import type { DashboardConfigurationOperationMap } from '@neonflux/backend/dashboard-contracts'
import type { ConfigSectionProps } from '../src/configuration-form.tsx'
import { YoutubeSettings } from '../src/youtube-settings.tsx'
import { localTime } from '../src/time.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
afterEach(cleanup)
const UC = `UC${'a'.repeat(22)}`, OTHER = `UC${'b'.repeat(22)}`, at = Date.parse('2026-10-01T12:30:00Z')
const catalog = { serverId: '2',roles: [],channels: [{ id: '123',name: 'general',type: 0 },{ id: '124',name: 'news',type: 5 },{ id: '125',name: 'uploads',type: 15 },{ id: '126',name: 'Lounge',type: 2 }] }
const followed: YoutubeSubscription = { youtubeChannelId: UC,channelId: '123',enabled: false,problem: 'permission',createdAt: at,
  status: { title: 'Synthetic Channel',subscribedUntil: at + 86400000,lastNotificationAt: at,latestVideo: { videoId: 'synthVideo1',title: 'Synthetic upload',publishedAt: at } } }
function setup(data: YoutubeView) {
  const calls: Array<DashboardConfigurationOperationMap['youtube']> = []
  const props = { remote: { family: 'youtube',serverId: '2',configRevision: 4,jobs: [],data },connected: true,catalog,
    queue: async (operation: DashboardConfigurationOperationMap['youtube'],revision: number) => { calls.push(operation); return { queued: true,conflict: false,revision,jobId: 'job1' } } } as unknown as ConfigSectionProps<'youtube'>
  return { ui: render(createElement(YoutubeSettings,props)),calls }
}
const section = (ui: ReturnType<typeof render>,name: string) => within(ui.getByRole('region',{ name,hidden: true }))
async function submit(form: ReturnType<typeof within>) { await act(async () => { fireEvent.submit(form.getAllByRole('button',{ hidden: true }).find((button: HTMLElement) => button.getAttribute('type') === 'submit')!.closest('form')!) }) }
function pick(form: ReturnType<typeof within>,channel: string) {
  const picker = form.getByRole('combobox',{ name: 'Alert channel',hidden: true })
  fireEvent.change(picker,{ target: { value: channel } }); fireEvent.keyDown(picker,{ key: 'Enter' })
}

test('Following a channel takes its ID or /channel/ link, refuses handles and offers only channels that can hold alerts', async () => {
  const { ui,calls } = setup({ configured: true,subscriptions: [] })
  assert.ok(ui.getByText(/without a YouTube API key, so livestreams, premieres and Shorts arrive as ordinary new videos/))
  assert.equal(ui.getByRole('link',{ name: "YouTube's Terms of Service" }).getAttribute('href'),'https://www.youtube.com/t/terms')
  assert.equal(ui.getByRole('link',{ name: "Google's Privacy Policy" }).getAttribute('href'),'https://policies.google.com/privacy')
  const form = section(ui,'Follow a YouTube channel')
  // A voice channel cannot hold alerts
  const picker = form.getByRole('combobox',{ name: 'Alert channel',hidden: true })
  fireEvent.focus(picker)
  fireEvent.change(picker,{ target: { value: 'Lounge' } })
  assert.equal(form.queryByRole('option',{ name: /Lounge/,hidden: true }),null)
  fireEvent.change(picker,{ target: { value: 'news' } })
  assert.ok(form.getByRole('option',{ name: 'news 124',hidden: true }))
  fireEvent.change(form.getByLabelText('YouTube channel ID'),{ target: { value: '@SyntheticCreator' } })
  pick(form,'uploads')
  await submit(form)
  assert.equal(calls.length,0)
  assert.match(form.getByRole('alert').textContent ?? '',/Copy channel ID\. An @handle does not work/)
  fireEvent.change(form.getByLabelText('YouTube channel ID'),{ target: { value: `https://www.youtube.com/channel/${UC}/videos` } })
  await submit(form)
  assert.deepEqual(calls,[{ type: 'add',youtubeChannelId: UC,channelId: '125' }])
})

test('A followed channel shows its status and problem, moves its alerts and is removed only after confirmation', async () => {
  const { ui,calls } = setup({ configured: true,subscriptions: [followed] })
  const status = section(ui,`Status of Synthetic Channel (${UC})`)
  assert.ok(status.getByText(/Off: NeonFlux cannot post in its alert channel/))
  assert.deepEqual(status.getAllByRole('listitem').slice(1).map(item => item.textContent),[`YouTube subscription: Confirmed until ${localTime(at + 86400000)}`,`Last notification: ${localTime(at)}`,'Last post: None yet',`Newest video: Synthetic upload, published ${localTime(at)}`])
  assert.equal(status.getByRole('link',{ name: 'Synthetic upload' }).getAttribute('href'),'https://www.youtube.com/watch?v=synthVideo1')
  const move = section(ui,`Alert channel for Synthetic Channel (${UC})`)
  pick(move,'news')
  await submit(move)
  const remove = section(ui,`Stop alerts for Synthetic Channel (${UC})`)
  await submit(remove)
  fireEvent.click(remove.getByLabelText('Confirm removing this YouTube channel'))
  await submit(remove)
  assert.deepEqual(calls,[{ type: 'add',youtubeChannelId: UC,channelId: '124' },{ type: 'remove',youtubeChannelId: UC }])
  // Following the same channel again is caught before queueing
  const add = section(ui,'Follow a YouTube channel')
  fireEvent.change(add.getByLabelText('YouTube channel ID'),{ target: { value: UC } })
  pick(add,'general')
  await submit(add)
  assert.equal(calls.length,2)
  assert.match(add.getByRole('alert').textContent ?? '',/already follows that YouTube channel/)
})

test('A full server or a deployment without YouTube alerts offers no add form', () => {
  const full = setup({ configured: true,subscriptions: Array.from({ length: 10 },(_,index) => ({ ...followed,youtubeChannelId: `UC${String(index).padStart(22,'c')}` })) })
  assert.ok(full.ui.getByText(/follows the maximum of 10 YouTube channels/))
  cleanup()
  const off = setup({ configured: false,subscriptions: [{ ...followed,youtubeChannelId: OTHER }] })
  assert.ok(off.ui.getByText(/The bot operator has not set up YouTube alerts yet/))
  assert.equal(off.ui.queryByRole('region',{ name: 'Follow a YouTube channel',hidden: true }),null)
})
