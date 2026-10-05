import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement, useState } from 'react'
import type { ConvexReactClient } from 'convex/react'
import { MessageBuilder } from '../src/message-builder.tsx'
import { Messages } from '../src/messages.tsx'
import { SearchPicker, fuzzyOptions } from '../src/search-picker.tsx'
import { importMessage, validateMessage, validateResponseMessage, responseMessage, responseReplyMessage } from '../src/message-content.ts'
import { publicationChannels,selectableRoles } from '../src/catalog-options.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window,document: dom.window.document,navigator: dom.window.navigator,HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render,fireEvent,cleanup,act,within } = await import('@testing-library/react')
afterEach(cleanup)
const catalog = { serverId: '2',roles: [],channels: [{ id: '123',name: 'Announcements',type: 0 }] }

test('Channel search ignores capitalization and emoji presentation while preserving original names', () => {
  const options = [{ id: '12345',name: '📢 Announcements' },{ id: '67890',name: '☀️ Summer Café' },{ id: '24680',name: '🏳️‍🌈 Community' }]
  assert.deepEqual(fuzzyOptions(options,'ANNOUNCE'),[options[0]])
  assert.deepEqual(fuzzyOptions(options,'📢 ANCM'),[options[0]])
  assert.deepEqual(fuzzyOptions(options,'☀ SUMMER CAFE\u0301'),[options[1]])
  assert.deepEqual(fuzzyOptions(options,'🏳‍🌈 COMMUNITY'),[options[2]])
  assert.deepEqual(fuzzyOptions(options,'123'),[options[0]])
  const selected: string[][] = []
  const ui = render(createElement(SearchPicker,{ label: 'Channel',options,value: [],onChange: value => selected.push(value) }))
  const input = ui.getByRole('combobox',{ name: 'Channel' })
  fireEvent.change(input,{ target: { value: '📢 ANN' } })
  assert.ok(ui.getByRole('option',{ name: '📢 Announcements 12345' }))
  fireEvent.keyDown(input,{ key: 'Enter' })
  assert.deepEqual(selected,[['12345']])
})

test('Fuzzy server choices support keyboard selection and Escape without changing the selection', () => {
  const options = [{ id: '2',name: 'NeonFlux community' },{ id: '3',name: 'Testing server' }]
  assert.deepEqual(fuzzyOptions(options,'nfx'),[options[0]])
  const selected: string[][] = []
  const ui = render(createElement(SearchPicker,{ label: 'Server',options,value: ['2'],onChange: value => selected.push(value) }))
  const input = ui.getByRole('combobox',{ name: 'Server' })
  fireEvent.change(input,{ target: { value: 'tsrv' } })
  fireEvent.keyDown(input,{ key: 'Escape' })
  assert.deepEqual(selected,[])
  assert.equal(input.getAttribute('aria-expanded'),'false')
  fireEvent.keyDown(input,{ key: 'ArrowDown' })
  fireEvent.keyDown(input,{ key: 'Enter' })
  assert.deepEqual(selected,[['3']])
})

test('JSON import preserves the complete content contract and rejects unsupported keys and limits', () => {
  const content = { content: 'Hello',embed: { title: 'News',description: 'Details',url: 'https://example.com',color: 42,timestamp: '2026-10-05T10:00:00Z',author: { name: 'Team',url: 'https://example.com',iconUrl: 'https://example.com/icon.png' },footer: { text: 'Footer',iconUrl: 'https://example.com/footer.png' },image: { url: 'https://example.com/image.png',description: 'Image' },thumbnail: { url: 'https://example.com/thumbnail.png',description: 'Thumbnail' },fields: [{ name: 'A',value: 'B',inline: true }] } }
  assert.deepEqual(importMessage(JSON.stringify(content)),content)
  assert.throws(() => importMessage('{"content":"hello","embeds":[]}'),/unsupported/)
  assert.throws(() => validateMessage({ content: 'a'.repeat(2001) }),/2000/)
  assert.throws(() => validateMessage({ content: '',embed: { fields: Array.from({ length: 26 },() => ({ name: 'a',value: 'b' })) } }),/twenty-five/)
  assert.throws(() => validateMessage({ content: '',embed: { title: 'a'.repeat(256),description: 'b'.repeat(4096),footer: { text: 'c'.repeat(2048) } } }),/six thousand/)
  assert.throws(() => validateMessage({ content: '',embed: { image: { url: 'javascript:alert(1)' } } }),/HTTP/)
  assert.throws(() => validateMessage({ content: '',embed: { timestamp: '2026-02-30T10:00:00Z' } }),/calendar/)
})

test('Catalog options exclude everyone, voice channels, and categories from role and publication controls', () => {
  const source = { serverId: '2',roles: [{ id: '2',name: '@everyone',position: 0 },{ id: '3',name: 'Member',position: 1 }],channels: [{ id: '10',name: 'Text',type: 0 },{ id: '11',name: 'Announcements',type: 5 },{ id: '12',name: 'Voice',type: 2 },{ id: '13',name: 'Category',type: 4 }] }
  assert.deepEqual(selectableRoles(source).map(role => role.id),['3'])
  assert.deepEqual(publicationChannels(source).map(channel => channel.id),['10','11'])
})

test('Response composition preserves supported replies and rejects rich fields without dropping them', () => {
  const reply = { type: 'embed' as const,embed: { title: 'Hello {user.name}',description: 'Welcome',color: 42 } }
  assert.deepEqual(responseMessage(JSON.stringify(responseReplyMessage(reply))),reply)
  assert.deepEqual(responseMessage('{"content":"Hello {user.name}"}'),{ type: 'text',text: 'Hello {user.name}' })
  assert.throws(() => validateResponseMessage({ content: 'Text',embed: { description: 'Embed' } }),/Choose message text or an embed/)
  assert.throws(() => responseMessage('{"content":"","embed":{"title":"Only title"}}'),/description/)
  assert.throws(() => validateResponseMessage({ content: '',embed: { description: 'x'.repeat(4001) } }),/4000/)
  for (const unsupported of [{ fields: [{ name: 'A',value: 'B' }] },{ url: 'https://example.com' },{ author: { name: 'A' } }]) assert.throws(() => validateResponseMessage({ content: '',embed: { description: 'Hello',...unsupported } }),/title, description and color only/)
})

test('Response builder exposes basic embed fields and rejects unsupported JSON while keeping the draft', () => {
  let latest = ''
  function Harness() { const [value,setValue] = useState('{"content":"","embed":{"title":"Saved","description":"Keep me","color":42}}'); latest = value; return createElement(MessageBuilder,{ value,onChange: setValue,profile: 'response' }) }
  const ui = render(createElement(Harness))
  assert.equal(ui.queryByRole('button',{ name: 'Add field' }),null)
  assert.equal(ui.queryByRole('textbox',{ name: 'Title URL' }),null)
  assert.equal(ui.getByRole('textbox',{ name: 'Embed description' }).getAttribute('maxlength'),'4000')
  fireEvent.click(ui.getByRole('button',{ name: 'Import / export JSON' }))
  fireEvent.change(ui.getByRole('textbox',{ name: 'Message JSON' }),{ target: { value: '{"content":"","embed":{"description":"New","fields":[{"name":"A","value":"B"}]}}' } })
  fireEvent.click(ui.getByRole('button',{ name: 'Import JSON' }))
  assert.match(ui.getByRole('alert').textContent ?? '',/title, description and color only/)
  assert.equal(JSON.parse(latest).embed.description,'Keep me')
  fireEvent.change(ui.getByRole('textbox',{ name: 'Message JSON' }),{ target: { value: '{"content":"","embed":{"description":"New","color":99}}' } })
  fireEvent.click(ui.getByRole('button',{ name: 'Import JSON' }))
  fireEvent.click(ui.getByRole('button',{ name: 'Export JSON' }))
  assert.deepEqual(JSON.parse((ui.getByRole('textbox',{ name: 'Message JSON' }) as HTMLTextAreaElement).value),{ content: '',embed: { description: 'New',color: 99 } })
})

test('Builder imports and exports JSON, adds inline fields, removes fields, and previews the draft', () => {
  let latest = ''
  function Harness() { const [value,setValue] = useState('{"content":""}'); latest = value; return createElement(MessageBuilder,{ value,onChange: setValue }) }
  const ui = render(createElement(Harness))
  fireEvent.click(ui.getByRole('button',{ name: 'Import / export JSON' }))
  fireEvent.change(ui.getByRole('textbox',{ name: 'Message JSON' }),{ target: { value: '{"content":"Welcome","embed":{"title":"News"}}' } })
  fireEvent.click(ui.getByRole('button',{ name: 'Import JSON' }))
  assert.equal((ui.getByLabelText('Accent color') as HTMLInputElement).value,'#000000')
  assert.equal(JSON.parse(latest).embed.color,undefined)
  fireEvent.click(ui.getByRole('button',{ name: 'Add field' }))
  fireEvent.change(ui.getByRole('textbox',{ name: 'Field 1 name' }),{ target: { value: 'Topic' } })
  fireEvent.change(ui.getByRole('textbox',{ name: 'Field 1 value' }),{ target: { value: 'Updates' } })
  fireEvent.click(ui.getByLabelText('Inline field 1'))
  assert.equal(JSON.parse(latest).embed.fields[0].inline,true)
  assert.ok(within(ui.getByRole('region',{ name: 'Message preview' })).getByText('Updates'))
  fireEvent.click(ui.getByRole('button',{ name: 'Export JSON' }))
  assert.deepEqual(JSON.parse((ui.getByRole('textbox',{ name: 'Message JSON' }) as HTMLTextAreaElement).value),JSON.parse(latest))
  fireEvent.click(ui.getByRole('button',{ name: 'Remove field 1' }))
  assert.deepEqual(JSON.parse(latest).embed.fields,[])
  fireEvent.click(ui.getByRole('button',{ name: 'Remove embed' }))
  fireEvent.click(ui.getByRole('button',{ name: 'Add embed' }))
  assert.equal(JSON.parse(latest).embed.color,0x648ccc)
  assert.equal((ui.getByLabelText('Accent color') as HTMLInputElement).value,'#648ccc')
})

test('Import and preview never send, and a failed queue retry reuses the request ID and keeps the draft', async () => {
  const requests: Array<Record<string,unknown>> = []
  const client = { action: async (_: unknown,args: Record<string,unknown>) => { requests.push(args); if (requests.length === 1) throw new Error('Synthetic transport failure'); return { jobId: 'job1' } } } as unknown as ConvexReactClient
  const ui = render(createElement(Messages,{ client,sessionToken: 'synthetic-session',serverId: '2',connected: true,catalog,catalogLoading: false,catalogError: false,jobs: [] }))
  const picker = ui.getByRole('combobox',{ name: 'Destination channel' })
  fireEvent.change(picker,{ target: { value: 'ann' } })
  fireEvent.keyDown(picker,{ key: 'Enter' })
  fireEvent.click(ui.getByRole('button',{ name: 'Import / export JSON' }))
  fireEvent.change(ui.getByRole('textbox',{ name: 'Message JSON' }),{ target: { value: '{"content":"Hello","embed":{"title":"Notice"}}' } })
  fireEvent.click(ui.getByRole('button',{ name: 'Import JSON' }))
  assert.equal(requests.length,0)
  const form = ui.getByRole('button',{ name: 'Request send' }).closest('form')!
  await act(async () => { fireEvent.submit(form) })
  assert.ok(ui.getByRole('alert'))
  assert.equal((ui.getByRole('textbox',{ name: 'Message text' }) as HTMLTextAreaElement).value,'Hello')
  await act(async () => { fireEvent.submit(form) })
  assert.equal(requests.length,2)
  assert.equal(requests[0]?.requestId,requests[1]?.requestId)
  assert.deepEqual(requests[1]?.content,{ content: 'Hello',embed: { title: 'Notice' } })
  assert.ok(ui.getByText('Message request queued. Check the delivery status below'))
  await act(async () => { fireEvent.submit(form) })
  assert.equal(requests.length,2)
})
