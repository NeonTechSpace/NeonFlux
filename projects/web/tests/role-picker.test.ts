import assert from 'node:assert/strict'
import { afterEach,test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { getFunctionName } from 'convex/server'
import { ConvexError } from 'convex/values'
import type { ConvexReactClient } from 'convex/react'
import type { RolePickerJob, RolePickerRoleDisplay } from '@neonflux/backend/contracts'
import type { DashboardConfigurationOperationMap, DashboardRolePickerMember } from '@neonflux/backend/dashboard-contracts'
import type { WebSession } from '../src/dashboard-api.ts'
import { ServerDashboard } from '../src/dashboard.tsx'
import { RolePickerMember } from '../src/role-picker-member.tsx'
import { RolePickerSettings } from '../src/role-picker-settings.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>',{ url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
afterEach(cleanup)

// The names stored with the menu at its last save, which the member view falls back to
const member = (overrides: Partial<DashboardRolePickerMember> = {}): DashboardRolePickerMember => ({ serverId: '5',snapshot: null,requests: [],
  menus: [{ name: 'colors',description: 'One colour',mode: 'single',roleIds: ['40','41'],display: [{ roleId: '40',name: 'Red',color: 0xff0000 },{ roleId: '41',name: 'Blue',color: 0x0000ff }] }],...overrides })
// A lookup's fresher read renamed role 40. The backend never sends roles outside menus, and the view would not show them either
const fresh: RolePickerRoleDisplay[] = [{ roleId: '40',name: 'Crimson',color: 0xdc143c },{ roleId: '90',name: 'Hidden staff',color: 0 }]
const snapshot = (roleIds: string[],allowed = true,roles = fresh): NonNullable<DashboardRolePickerMember['snapshot']> => ({ roleIds,roles,allowed,observedAt: 1,expiresAt: 600001 })
const request = (id: string,state: RolePickerJob['state'],operation: RolePickerJob['operation'],error?: string): RolePickerJob => ({ id,actorId: '1',operation,state,createdAt: 1,expiresAt: 2,...(error ? { error } : {}) })
// A live client whose member query result the test replaces, with every request and query recorded. Member views send no actions
function liveClient(initial: DashboardRolePickerMember,reject?: unknown) {
  let current = initial
  const listeners = new Set<() => void>(), watched: string[] = [], requests: unknown[] = [], actions: unknown[] = []
  const client = {
    connectionState: () => ({ isWebSocketConnected: true }),
    subscribeToConnectionState: () => () => {},
    watchQuery: (ref: unknown,args: { serverId: string }) => { const name = getFunctionName(ref as never); watched.push(`${name}:${args.serverId}`); return { localQueryResult: () => current,onUpdate: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) } } },
    action: async (ref: unknown) => { actions.push(getFunctionName(ref as never)); throw new Error('Unexpected action') },
    mutation: async (_: unknown,args: { operation: unknown }) => { requests.push(args.operation); if (reject) throw reject; return { jobId: `job${requests.length}` } },
  } as unknown as ConvexReactClient
  return { client,watched,requests,actions,publish: async (next: DashboardRolePickerMember) => { current = next; await act(async () => { listeners.forEach(listener => listener()) }) } }
}

test('A member who manages nothing gets only the role picker, never a manager section', async () => {
  const live = liveClient(member())
  const session: WebSession = { sessionToken: 'synthetic-session',convexUrl: 'https://synthetic.invalid',expiresAt: 1,user: { id: '1',name: 'Synthetic member' },mode: 'multi',servers: [],memberServers: [{ id: '5',name: 'Member server',icon: null,features: ['rolepicker'] }] }
  const ui = render(createElement(ServerDashboard,{ session,client: live.client,accessAvailable: true }))
  assert.equal(ui.queryByRole('heading',{ name: 'Choose a server' }),null)
  assert.equal(ui.queryByRole('heading',{ name: 'No manageable servers' }),null)
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Choose roles in Member server' })) })
  assert.ok(ui.getByRole('heading',{ name: 'Member server' }))
  assert.ok(ui.getByRole('region',{ name: 'Role picker' }))
  assert.equal(ui.queryByRole('navigation',{ name: 'Configuration sections' }),null)
  assert.equal(ui.queryByRole('region',{ name: 'General' }),null)
  assert.deepEqual(live.watched,['rolePicker:member:5'])
  assert.deepEqual(live.actions,[])
  cleanup()
  // Single-server mode opens straight on the member view, and a manager still gets the full dashboard
  const single = render(createElement(ServerDashboard,{ session: { ...session,mode: 'single' },client: liveClient(member()).client,accessAvailable: true }))
  assert.ok(single.getByRole('region',{ name: 'Role picker' }))
  assert.equal(single.queryByRole('button',{ name: 'Switch server' }),null)
})

test('The member view looks up roles once, then shows selections and pending, applied or failed requests as they change', async () => {
  const live = liveClient(member())
  const ui = render(createElement(RolePickerMember,{ client: live.client,sessionToken: 'synthetic-session',serverId: '5',connected: true }))
  await act(async () => {})
  assert.deepEqual(live.requests,[{ type: 'lookup' }])
  assert.match(ui.getByRole('status').textContent!,/not loaded yet/)
  await live.publish(member({ requests: [request('job1','queued',{ type: 'lookup' })] }))
  assert.match(ui.getByRole('status').textContent!,/Checking your current roles/)
  // Before a lookup the stored menu names render
  assert.equal((ui.getByRole('button',{ name: 'Claim Red' }) as HTMLButtonElement).disabled,true)
  await live.publish(member({ snapshot: snapshot(['40']),requests: [request('job1','applied',{ type: 'lookup' })] }))
  assert.ok(ui.getByText('One colour'))
  // The lookup's fresher name wins, the stored name stays for roles it did not cover, and roles outside menus never render
  assert.equal((ui.getByRole('button',{ name: 'Drop Crimson' }) as HTMLButtonElement).disabled,false)
  assert.equal(ui.queryByRole('button',{ name: 'Drop Red' }),null)
  assert.equal(ui.queryByText(/Hidden staff/),null)
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Claim Blue' })) })
  assert.deepEqual(live.requests.at(-1),{ type: 'claim',menu: 'colors',roleId: '41' })
  const claim = request('job2','queued',{ type: 'claim',menu: 'colors',roleId: '41' })
  await live.publish(member({ snapshot: snapshot(['40']),requests: [claim,request('job1','applied',{ type: 'lookup' })] }))
  const recent = () => within(ui.getByRole('region',{ name: 'Your recent requests' })).getAllByRole('listitem').map(item => item.textContent)
  assert.equal(ui.getByRole('button',{ name: 'Claim Blue' }).textContent,'Pending…')
  assert.equal((ui.getByRole('button',{ name: 'Claim Blue' }) as HTMLButtonElement).disabled,true)
  assert.deepEqual(recent(),['Claim Blue: Pending','Check my roles: Applied'])
  await live.publish(member({ snapshot: snapshot(['41']),requests: [{ ...claim,state: 'applied' },request('job1','applied',{ type: 'lookup' })] }))
  assert.ok(ui.getByRole('button',{ name: 'Drop Blue' }))
  assert.deepEqual(recent(),['Claim Blue: Applied','Check my roles: Applied'])
  await live.publish(member({ snapshot: snapshot(['41']),requests: [request('job3','failed',{ type: 'drop',menu: 'colors',roleId: '41' },'Fluxer refused the role change. Ask a moderator to check the bot\'s role position')] }))
  assert.deepEqual(recent(),['Drop Blue: FailedFluxer refused the role change. Ask a moderator to check the bot\'s role position'])
  // A blocked member sees why and cannot send claims or drops
  await live.publish(member({ snapshot: snapshot(['41'],false) }))
  assert.equal(ui.getByRole('alert').textContent,'You cannot use the role picker in this server')
  assert.equal((ui.getByRole('button',{ name: 'Drop Blue' }) as HTMLButtonElement).disabled,true)
  assert.equal((ui.getByRole('button',{ name: 'Claim Crimson' }) as HTMLButtonElement).disabled,true)
  // No request reads roles with the member's own sign-in
  assert.deepEqual(live.actions,[])
})

test('Rate limit and other refusals reach the member as clear errors', async () => {
  // A snapshot without names falls back to the names stored with the menu
  const live = liveClient(member({ snapshot: snapshot([],true,[]) }),new ConvexError({ status: 429,error: 'Too many role requests. Wait a minute and try again' }))
  const ui = render(createElement(RolePickerMember,{ client: live.client,sessionToken: 'synthetic-session',serverId: '5',connected: true }))
  await act(async () => { fireEvent.click(ui.getByRole('button',{ name: 'Claim Red' })) })
  assert.deepEqual(live.requests,[{ type: 'claim',menu: 'colors',roleId: '40' }])
  assert.equal(ui.getByRole('alert').textContent,'Too many role requests. Wait a minute and try again')
})

test('Managers add menus and set access lists through queued role picker saves', async () => {
  const calls: Array<{ operation: DashboardConfigurationOperationMap['rolepicker'],revision: number }> = []
  const queue = async (operation: DashboardConfigurationOperationMap['rolepicker'],revision: number) => { calls.push({ operation,revision }); return { queued: true,conflict: false,revision,jobId: `job${calls.length}` } }
  const ui = render(createElement(RolePickerSettings,{ connected: true,queue,catalog: { serverId: '2',channels: [],roles: [{ id: '2',name: '@everyone',position: 0 },{ id: '40',name: 'Red',position: 2 },{ id: '41',name: 'Blue',position: 3 }] },
    remote: { family: 'rolepicker',serverId: '2',configRevision: 7,jobs: [],data: { settings: { enabled: true,menus: [{ name: 'games',mode: 'multi',roleIds: [] }] },access: { allowRoleIds: [],blockRoleIds: [],allowUserIds: [],blockUserIds: [] } } } }))
  const add = within(ui.getByRole('region',{ name: 'Add menu' }))
  fireEvent.change(add.getByLabelText('Menu name'),{ target: { value: 'Colors' } })
  fireEvent.change(add.getByLabelText('New menu description'),{ target: { value: 'One colour' } })
  fireEvent.change(add.getByLabelText('New menu choice'),{ target: { value: 'single' } })
  const roles = add.getByRole('combobox',{ name: 'New menu roles' })
  for (const query of ['red','blue']) { fireEvent.change(roles,{ target: { value: query } }); fireEvent.keyDown(roles,{ key: 'Enter' }) }
  await act(async () => { fireEvent.submit(add.getByLabelText('Menu name').closest('form')!) })
  assert.deepEqual(calls.at(-1),{ operation: { type: 'menu-set',name: 'colors',mode: 'single',roleIds: ['40','41'],description: 'One colour' },revision: 7 })
  fireEvent.change(add.getByLabelText('Menu name'),{ target: { value: 'games' } })
  await act(async () => { fireEvent.submit(add.getByLabelText('Menu name').closest('form')!) })
  assert.equal(calls.length,1)
  const access = within(ui.getByRole('region',{ name: 'Who may use the role picker' }))
  const blocked = access.getByRole('combobox',{ name: 'Blocked roles' })
  fireEvent.change(blocked,{ target: { value: 'red' } }); fireEvent.keyDown(blocked,{ key: 'Enter' })
  await act(async () => { fireEvent.submit(blocked.closest('form')!) })
  assert.deepEqual(calls.at(-1),{ operation: { type: 'access-set',allowRoleIds: [],blockRoleIds: ['40'],allowUserIds: [],blockUserIds: [] },revision: 7 })
})

test('Saving the on switch elsewhere keeps an access draft without a false conflict, while a changed menu needs review before removal', async () => {
  const calls: Array<{ operation: DashboardConfigurationOperationMap['rolepicker'],revision: number }> = []
  const queue = async (operation: DashboardConfigurationOperationMap['rolepicker'],revision: number) => { calls.push({ operation,revision }); return { queued: true,conflict: false,revision,jobId: `job${calls.length}` } }
  const catalog = { serverId: '2',channels: [],roles: [{ id: '40',name: 'Red',position: 2 },{ id: '41',name: 'Blue',position: 3 }] }
  const remote = (revision: number,enabled: boolean,roleIds: string[]) => ({ family: 'rolepicker' as const,serverId: '2',configRevision: revision,jobs: [],data: { settings: { enabled,menus: [{ name: 'games',mode: 'multi' as const,roleIds }] },access: { allowRoleIds: [],blockRoleIds: [],allowUserIds: [],blockUserIds: [] } } })
  const ui = render(createElement(RolePickerSettings,{ connected: true,queue,catalog,remote: remote(7,false,['40']) }))
  const access = within(ui.getByRole('region',{ name: 'Who may use the role picker' })), blocked = access.getByRole('combobox',{ name: 'Blocked roles' })
  fireEvent.change(blocked,{ target: { value: 'red' } }); fireEvent.keyDown(blocked,{ key: 'Enter' })
  const removal = within(ui.getByRole('region',{ name: 'Remove menu games',hidden: true }))
  fireEvent.click(removal.getByLabelText('Confirm removing menu games',{ selector: 'input' }))
  // Another manager turns the role picker on, which moves the shared revision
  ui.rerender(createElement(RolePickerSettings,{ connected: true,queue,catalog,remote: remote(8,true,['40']) }))
  assert.ok(!access.queryByText('Changed elsewhere'),'the access draft is not flagged by an unrelated save')
  assert.ok(!removal.queryByText('Changed elsewhere'),'the removal is not flagged while its menu is unchanged')
  await act(async () => { fireEvent.submit(blocked.closest('form')!) })
  assert.deepEqual(calls.at(-1),{ operation: { type: 'access-set',allowRoleIds: [],blockRoleIds: ['40'],allowUserIds: [],blockUserIds: [] },revision: 8 })
  // A change to the menu itself is what the removal confirmed, so it needs review
  ui.rerender(createElement(RolePickerSettings,{ connected: true,queue,catalog,remote: remote(9,true,['40','41']) }))
  assert.ok(removal.getByText('Changed elsewhere'))
  assert.equal((removal.getByRole('button',{ name: 'Remove menu',hidden: true }) as HTMLButtonElement).disabled,true)
})
