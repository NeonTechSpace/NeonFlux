import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { getFunctionName } from 'convex/server'
import type { ConvexReactClient } from 'convex/react'
import type { DashboardConfigurationOperationMap, DashboardProfileMember, DashboardShowcaseMember } from '@neonflux/backend/dashboard-contracts'
import type { ConfigSectionProps } from '../src/configuration-form.tsx'
import type { WebSession } from '../src/dashboard-api.ts'
import { ServerDashboard } from '../src/dashboard.tsx'
import { ShowcaseMember } from '../src/showcase-member.tsx'
import { ProfileMember } from '../src/profile-member.tsx'
import { ShowcaseSettings } from '../src/showcase-settings.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
afterEach(cleanup)

const showcases = (overrides: Partial<DashboardShowcaseMember> = {}): DashboardShowcaseMember => ({ serverId: '5',settings: { enabled: true,channelId: '40',maxPerMember: 3,intervalMinutes: null },requests: [],
  showcases: [{ showcaseNo: 1,authorId: '1',title: 'My game',text: 'Built it',links: ['https://example.org/'],channelId: '40',postNo: 1,messageId: '500',status: 'posted',createdAt: 1,updatedAt: 1 }],...overrides })
const profile: DashboardProfileMember = { serverId: '5',profile: null,requests: [] }
// A live client that answers member queries by function name and records every request
function liveClient() {
  const watched: string[] = [], requests: Array<{ name: string, operation?: unknown }> = []
  const results: Record<string,unknown> = { 'showcases:member': showcases(),'profiles:member': profile }
  const client = {
    connectionState: () => ({ isWebSocketConnected: true }),
    subscribeToConnectionState: () => () => {},
    watchQuery: (ref: unknown) => { const name = getFunctionName(ref as never); watched.push(name); return { localQueryResult: () => results[name],onUpdate: () => () => {} } },
    action: async () => { throw new Error('Unexpected action') },
    mutation: async (ref: unknown,args: { operation?: unknown }) => { requests.push({ name: getFunctionName(ref as never),...(args.operation ? { operation: args.operation } : {}) }); return { jobId: 'job1' } },
  } as unknown as ConvexReactClient
  return { client,watched,requests }
}

test('A member server with showcases and profiles opens a member page for each and no manager section', async () => {
  const live = liveClient()
  const session: WebSession = { sessionToken: 'synthetic-session',convexUrl: 'https://synthetic.invalid',expiresAt: 1,user: { id: '1',name: 'Synthetic member' },mode: 'multi',servers: [],memberServers: [{ id: '5',name: 'Member server',icon: null,features: ['showcase','profile'] }] }
  const ui = render(createElement(ServerDashboard,{ session,client: live.client,accessAvailable: true }))
  assert.ok(ui.getByText('Open showcases and profile'))
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Open member features in Member server' })) })
  assert.ok(ui.getByRole('region',{ name: 'Your showcases' }))
  assert.equal(ui.queryByRole('navigation',{ name: 'Configuration sections' }),null)
  await act(async () => { fireEvent.click(within(ui.getByRole('navigation',{ name: 'Member features' })).getByText('Your profile')) })
  assert.ok(ui.getByRole('region',{ name: 'Your profile' }))
  assert.deepEqual(live.watched,['showcases:member','profiles:member'])
})

test('Members post, edit and delete their showcases, each as a request for the bot', async () => {
  const live = liveClient()
  const ui = render(createElement(ShowcaseMember,{ client: live.client,sessionToken: 'synthetic-session',serverId: '5',connected: true }))
  const post = within(ui.getByRole('region',{ name: 'Post a showcase' }))
  fireEvent.change(post.getByLabelText('Title'),{ target: { value: ' New game ' } })
  fireEvent.change(post.getByLabelText('Text'),{ target: { value: 'Text' } })
  fireEvent.change(post.getByLabelText('Links, one per line'),{ target: { value: 'https://example.org/a.png\n\nhttps://example.org/b' } })
  await act(async () => { fireEvent.click(post.getByRole('button',{ name: 'Post showcase' })) })
  const mine = within(ui.getByRole('region',{ name: 'Your showcases' }))
  await act(async () => { fireEvent.click(mine.getByRole('button',{ name: 'Edit' })) })
  fireEvent.change(mine.getByLabelText('Title'),{ target: { value: 'Renamed' } })
  await act(async () => { fireEvent.click(mine.getByRole('button',{ name: 'Save changes' })) })
  await act(async () => { fireEvent.click(mine.getByRole('button',{ name: 'Delete My game' })) })
  assert.deepEqual(live.requests.map(row => row.operation),[{ type: 'create',title: 'New game',text: 'Text',links: ['https://example.org/a.png','https://example.org/b'] },
    { type: 'edit',showcaseNo: 1,title: 'Renamed',text: 'Built it',links: ['https://example.org/'] },{ type: 'delete',showcaseNo: 1 }])
  assert.match(ui.getByText(/This server allows/).textContent!,/up to 3 showcases per member/)
})

test('Members save and delete their profile, with the accent color optional', async () => {
  const live = liveClient()
  const ui = render(createElement(ProfileMember,{ client: live.client,sessionToken: 'synthetic-session',serverId: '5',connected: true }))
  fireEvent.change(ui.getByLabelText('Bio'),{ target: { value: 'Hi' } })
  fireEvent.click(ui.getByLabelText('Use an accent color'))
  fireEvent.change(ui.getByLabelText('Accent color'),{ target: { value: '#ff0000' } })
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Save profile' })) })
  assert.deepEqual(live.requests,[{ name: 'profiles:request',operation: { type: 'save',bio: 'Hi',links: [],color: 0xff0000 } }])
})

test('The showcase section saves the channel, limits and access lists', async () => {
  const calls: Array<DashboardConfigurationOperationMap['showcase']> = []
  const access = { allowRoleIds: [],blockRoleIds: [],allowUserIds: [],blockUserIds: [] }
  const props = { remote: { family: 'showcase',serverId: '2',configRevision: 1,jobs: [],data: { settings: { enabled: false,channelId: null,maxPerMember: null,intervalMinutes: null },access } },connected: true,
    catalog: { serverId: '2',roles: [],channels: [{ id: '40',name: 'showcase',type: 0 }] },queue: async (operation: DashboardConfigurationOperationMap['showcase'],revision: number) => { calls.push(operation); return { queued: true,conflict: false,revision,jobId: 'job1' } } } as unknown as ConfigSectionProps<'showcase'>
  const ui = render(createElement(ShowcaseSettings,props))
  const form = within(ui.getByRole('region',{ name: 'Showcases',hidden: true }))
  fireEvent.click(form.getByLabelText('Showcases enabled'))
  const picker = form.getByRole('combobox',{ name: 'Showcase channel',hidden: true })
  fireEvent.change(picker,{ target: { value: 'show' } }); fireEvent.keyDown(picker,{ key: 'Enter' })
  fireEvent.change(form.getByLabelText('Showcases per member'),{ target: { value: '2' } })
  await act(async () => { fireEvent.submit(form.getByLabelText('Showcases per member').closest('form')!) })
  assert.deepEqual(calls,[{ type: 'settings',enabled: true,channelId: '40',maxPerMember: 2,intervalMinutes: null }])
})
