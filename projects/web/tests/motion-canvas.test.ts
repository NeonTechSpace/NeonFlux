import assert from 'node:assert/strict'
import { afterEach, test, type TestContext } from 'node:test'
import { JSDOM } from 'jsdom'
import { createElement } from 'react'
import { MotionCanvas } from '../src/motion-canvas.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000' })
for (const [name,value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement })) Object.defineProperty(globalThis,name,{ value,configurable: true })
const { render, cleanup } = await import('@testing-library/react')
afterEach(() => cleanup())

function payload(frames: number[][][], { version = 1, fps = 10, grid = 128 } = {}) {
  const bytes = [version, frames.length, fps, grid - 1]
  for (const points of frames) { bytes.push(points.length & 255, points.length >> 8); for (const point of points) bytes.push(...point) }
  return Buffer.from(bytes).toString('base64')
}
// Frames run only when the test calls them, with explicit timestamps
function animation(context: TestContext, { ratio = 1, reducedMotion = false }: { ratio?: number, reducedMotion?: boolean } = {}) {
  const callbacks = new Map<number, FrameRequestCallback>(), cancelled: number[] = [], draws: Array<[string, number, number, number, number]> = []
  let handles = 0
  const stubs: Record<string, unknown> = { requestAnimationFrame: (callback: FrameRequestCallback) => { callbacks.set(++handles, callback); return handles }, cancelAnimationFrame: (handle: number) => { cancelled.push(handle); callbacks.delete(handle) }, devicePixelRatio: ratio }
  const media = new Map<string, Set<() => void>>(), listeners = (query: string) => media.get(query) ?? media.set(query, new Set()).get(query)!
  stubs.matchMedia = (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' ? reducedMotion : true, addEventListener: (_: string, listener: () => void) => listeners(query).add(listener), removeEventListener: (_: string, listener: () => void) => listeners(query).delete(listener) })
  const original = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
  for (const [name, value] of Object.entries(stubs)) Object.defineProperty(window, name, { value, configurable: true, writable: true })
  context.after(() => { for (const name of Object.keys(stubs)) Reflect.deleteProperty(window, name); if (original) Object.defineProperty(window, 'devicePixelRatio', original) })
  const surface = { fillStyle: '', fillRect: (x: number, y: number, width: number, height: number) => { draws.push([surface.fillStyle, x, y, width, height]) } }
  const getContext = context.mock.method(window.HTMLCanvasElement.prototype, 'getContext', (): typeof surface | null => surface)
  const zoom = (next: number) => {
    const watching = [...listeners(`(resolution: ${window.devicePixelRatio}dppx)`)]
    Object.defineProperty(window, 'devicePixelRatio', { value: next, configurable: true, writable: true })
    for (const listener of watching) listener()
  }
  // Some browsers report a devicePixelRatio change only through a window resize
  const resize = (next: number) => {
    Object.defineProperty(window, 'devicePixelRatio', { value: next, configurable: true, writable: true })
    window.dispatchEvent(new window.Event('resize'))
  }
  return { getContext, draws, cancelled, zoom, resize, watched: () => [...media].filter(([, set]) => set.size).map(([query]) => query), pending: () => callbacks.size, frame: (time: number) => { const due = [...callbacks.values()]; callbacks.clear(); for (const callback of due) callback(time) } }
}

test('Motion canvas decodes frames, draws only when the frame index changes and stops on unmount', context => {
  const motion = animation(context, { ratio: 2 })
  const ui = render(createElement(MotionCanvas, { frames: payload([[[10, 20, 0], [11, 21, 0], [100, 50, 3]], [[0, 0, 1]], [[127, 127, 2]]]) }))
  const canvas = ui.getByRole('img') as HTMLCanvasElement
  assert.equal(canvas.tagName, 'CANVAS')
  assert.match(canvas.getAttribute('aria-label') ?? '', /visible only through motion.*staff assistance/)
  assert.equal(canvas.width, 640)
  assert.equal(canvas.height, 640)
  assert.equal(ui.queryByText(/prefers reduced motion/), null)
  assert.deepEqual(motion.draws, [])
  motion.frame(1000)
  assert.deepEqual(motion.draws.splice(0), [['#0e121d', 0, 0, 640, 640]])
  motion.frame(1016)
  assert.deepEqual(motion.draws.splice(0), [['#0e121d', 0, 0, 640, 640], ['#3ae0dd', 46, 96, 12, 12], ['#3ae0dd', 51, 101, 12, 12], ['#b88eff', 496, 246, 12, 12]])
  motion.frame(1099)
  assert.deepEqual(motion.draws, [])
  motion.frame(1100)
  assert.deepEqual(motion.draws.splice(0), [['#0e121d', 0, 0, 640, 640], ['#ff69b4', -4, -4, 12, 12]])
  motion.frame(1250)
  assert.deepEqual(motion.draws.splice(0), [['#0e121d', 0, 0, 640, 640], ['#ffcc49', 631, 631, 12, 12]])
  motion.frame(1300)
  assert.equal(motion.draws.splice(0).length, 4)
  assert.equal(motion.pending(), 1)
  ui.unmount()
  assert.equal(motion.pending(), 0)
  assert.equal(motion.cancelled.length, 1)
})

const rectangles = {
  1: [['#0e121d', 0, 0, 320, 320], ['#3ae0dd', -1, -1, 3, 3], ['#ff69b4', 318, 318, 3, 3], ['#ffcc49', 124, 45, 3, 3], ['#b88eff', 125, 249, 3, 3], ['#3ae0dd', 125, 45, 3, 3]],
  2: [['#0e121d', 0, 0, 640, 640], ['#3ae0dd', -2, -2, 6, 6], ['#ff69b4', 636, 636, 6, 6], ['#ffcc49', 248, 91, 6, 6], ['#b88eff', 251, 498, 6, 6], ['#3ae0dd', 251, 91, 6, 6]],
}
for (const ratio of [1, 2] as const) test(`Motion canvas paints whole device-pixel squares in payload order at devicePixelRatio ${ratio}`, context => {
  const motion = animation(context, { ratio })
  render(createElement(MotionCanvas, { frames: payload([[[0, 0, 0], [255, 255, 1], [100, 37, 2], [101, 200, 3], [101, 37, 0]]], { grid: 256 }) }))
  motion.frame(0)
  assert.deepEqual(motion.draws.splice(0), [rectangles[ratio][0]])
  motion.frame(16)
  assert.deepEqual(motion.draws, rectangles[ratio])
})

test('Motion canvas follows devicePixelRatio changes during playback and repaints the current frame', context => {
  const motion = animation(context)
  const ui = render(createElement(MotionCanvas, { frames: payload([[[0, 0, 0]], [[100, 37, 2]]], { grid: 256 }) }))
  const canvas = ui.getByRole('img') as HTMLCanvasElement
  assert.deepEqual(motion.watched(), ['(resolution: 1dppx)'])
  motion.frame(0)
  motion.frame(100)
  assert.deepEqual(motion.draws.splice(0).slice(-2), [['#0e121d', 0, 0, 320, 320], ['#ffcc49', 124, 45, 3, 3]])
  motion.zoom(2)
  assert.equal(canvas.width, 640)
  assert.equal(canvas.height, 640)
  assert.deepEqual(motion.draws.splice(0), [['#0e121d', 0, 0, 640, 640], ['#ffcc49', 248, 91, 6, 6]])
  assert.deepEqual(motion.watched(), ['(resolution: 2dppx)'])
  motion.frame(150)
  assert.deepEqual(motion.draws, [])
  motion.zoom(1.5)
  assert.equal(canvas.width, 480)
  assert.deepEqual(motion.draws.splice(0), [['#0e121d', 0, 0, 480, 480], ['#ffcc49', 186, 68, 4, 4]])
  ui.unmount()
  assert.deepEqual(motion.watched(), [])
  assert.equal(motion.pending(), 0)
})

test('Motion canvas follows a devicePixelRatio change reported only as a window resize', context => {
  const motion = animation(context)
  const ui = render(createElement(MotionCanvas, { frames: payload([[[100, 37, 2]]], { grid: 256 }) }))
  const canvas = ui.getByRole('img') as HTMLCanvasElement
  motion.frame(0)
  motion.frame(16)
  motion.draws.splice(0)
  motion.resize(1.5)
  assert.equal(canvas.width, 480)
  assert.deepEqual(motion.draws.splice(0), [['#0e121d', 0, 0, 480, 480], ['#ffcc49', 186, 68, 4, 4]])
  assert.deepEqual(motion.watched(), ['(resolution: 1.5dppx)'])
  ui.unmount()
  motion.resize(2)
  assert.deepEqual(motion.draws, [])
})

test('Motion canvas restarts a new payload after one background-only frame and keeps running for an identical one', context => {
  const motion = animation(context)
  const ui = render(createElement(MotionCanvas, { frames: payload([[[1, 1, 0]], [[2, 2, 1]]]) }))
  motion.frame(0)
  motion.frame(100)
  ui.rerender(createElement(MotionCanvas, { frames: payload([[[1, 1, 0]], [[2, 2, 1]]]) }))
  assert.deepEqual(motion.cancelled, [])
  motion.draws.splice(0)
  ui.rerender(createElement(MotionCanvas, { frames: payload([[[64, 64, 3]]], { grid: 256 }) }))
  assert.equal(motion.cancelled.length, 1)
  assert.equal(motion.pending(), 1)
  motion.frame(5000)
  assert.deepEqual(motion.draws.splice(0), [['#0e121d', 0, 0, 320, 320]])
  motion.frame(5016)
  assert.deepEqual(motion.draws, [['#0e121d', 0, 0, 320, 320], ['#b88eff', 79, 79, 3, 3]])
})

test('Motion canvas keeps animating under reduced motion and points to staff assistance', context => {
  const motion = animation(context, { reducedMotion: true })
  const ui = render(createElement(MotionCanvas, { frames: payload([[[1, 1, 0]]]) }))
  assert.ok(ui.getByText(/prefers reduced motion.*request staff assistance/))
  motion.frame(0)
  motion.frame(16)
  assert.equal(motion.draws.length, 3)
  assert.equal(motion.pending(), 1)
})

test('Motion canvas reports malformed payloads and missing canvas support instead of animating', context => {
  const motion = animation(context)
  const valid = Buffer.from(payload([[[1, 1, 0]]]), 'base64')
  const malformed = [
    payload([[[1, 1, 0]]], { version: 2 }), payload([[[128, 1, 0]]]), payload([[[1, 200, 0]]], { grid: 200 }), payload([[[1, 1, 0]]], { fps: 0 }), payload([]),
    valid.subarray(0, valid.length - 1).toString('base64'), Buffer.from([...valid, 0]).toString('base64'),
    Buffer.from([1, 1, 10, 127, 2, 0, 1, 1, 0]).toString('base64'), payload([[[1, 1, 4]]]), '%%%', '',
  ]
  for (const frames of malformed) {
    const ui = render(createElement(MotionCanvas, { frames }))
    assert.match(ui.getByRole('alert').textContent ?? '', /could not be displayed.*staff assistance/, frames)
    assert.equal(ui.queryByRole('img'), null)
    ui.unmount()
  }
  assert.equal(motion.pending(), 0)
  motion.getContext.mock.mockImplementation(() => null)
  const ui = render(createElement(MotionCanvas, { frames: payload([[[1, 1, 0]]]) }))
  assert.ok(ui.getByRole('alert'))
  assert.equal(ui.queryByRole('img'), null)
  assert.equal(motion.pending(), 0)
})
