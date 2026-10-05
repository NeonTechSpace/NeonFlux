import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement, StrictMode } from 'react'
import type { ConvexReactClient } from 'convex/react'
import { useLiveClient } from '../src/live-client.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render, cleanup } = await import('@testing-library/react')
test('StrictMode cleanup never leaves the mounted dashboard with a closed live client', () => {
  const clients: Array<{ closed: boolean, closes: number }> = []
  const factory = () => {
    const state = { closed: false, closes: 0 }
    clients.push(state)
    return { connectionState: () => { if (state.closed) throw new Error('Client already closed'); return { isWebSocketConnected: true } }, close: async () => { state.closed = true; state.closes++ } } as unknown as ConvexReactClient
  }
  function Probe() {
    const client = useLiveClient('https://synthetic.convex.cloud', factory)
    return createElement('p', {}, client?.connectionState().isWebSocketConnected ? 'Connected' : 'Connecting')
  }
  const ui = render(createElement(StrictMode, {}, createElement(Probe)))
  assert.ok(ui.getByText('Connected'))
  assert.equal(clients.length, 2)
  assert.equal(clients[0]?.closed, true)
  assert.equal(clients[1]?.closed, false)
  cleanup()
  assert.deepEqual(clients.map(client => client.closes), [1,1])
})
