import { useEffect, useMemo, useRef, useState } from 'react'

// Index order matches the server's dot color indices, using the path challenge's hues
const colors = ['#3ae0dd', '#ff69b4', '#ffcc49', '#b88eff'], background = '#0e121d', displaySize = 320, dotRadius = 1.25

interface MotionFrames { fps: number, grid: number, frames: Uint8Array[] }
function decodeMotionFrames(payload: string): MotionFrames | undefined {
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(payload), char => char.charCodeAt(0)) } catch { return undefined }
  if (bytes.length < 4 || bytes[0] !== 1 || !bytes[1] || !bytes[2]) return undefined
  const frames: Uint8Array[] = []
  const grid = bytes[3] + 1
  let offset = 4
  for (let frame = 0; frame < bytes[1]; frame++) {
    if (offset + 2 > bytes.length) return undefined
    const end = offset + 2 + (bytes[offset] | bytes[offset + 1] << 8) * 3
    if (end > bytes.length) return undefined
    const points = bytes.subarray(offset + 2, end)
    for (let index = 0; index < points.length; index += 3) if (points[index] >= grid || points[index + 1] >= grid || points[index + 2] >= colors.length) return undefined
    frames.push(points)
    offset = end
  }
  return offset === bytes.length ? { fps: bytes[2], grid, frames } : undefined
}

// Whole device-pixel squares without a transform avoid antialiasing and match the server's frame rasterizer. Their width is
// rounded down, so no devicePixelRatio makes a dot larger than the server's flash guard assumes
const edge = (center: number, scale: number) => Math.round((center + 0.5 - dotRadius) * scale)

// Frames are drawn live from point lists, so a screenshot or copied canvas holds a single frame of uniform noise
export function MotionCanvas({ frames: payload, paused = false }: { frames: string, paused?: boolean }) {
  const motion = useMemo(() => decodeMotionFrames(payload), [payload])
  const canvas = useRef<HTMLCanvasElement>(null)
  const [unavailable, setUnavailable] = useState(false), [reducedMotion, setReducedMotion] = useState(false)
  useEffect(() => { setReducedMotion(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) }, [])
  useEffect(() => {
    const element = canvas.current
    if (!motion || !element || paused) return
    const context = element.getContext('2d')
    if (!context) { setUnavailable(true); return }
    let start: number | undefined, shown = -1, handle = 0, size = 0, scale = 0, dot = 0, resolution: MediaQueryList | undefined
    const paint = () => {
      context.fillStyle = background
      context.fillRect(0, 0, size, size)
      const points = motion.frames[shown]
      let color = -1
      for (let point = 0; point < points.length; point += 3) {
        if (points[point + 2] !== color) { color = points[point + 2]; context.fillStyle = colors[color] }
        context.fillRect(edge(points[point], scale), edge(points[point + 1], scale), dot, dot)
      }
    }
    // Zooming changes devicePixelRatio, so the backing store follows it and the current frame is repainted at the new size.
    // Some browsers report the change only as a window resize, so both events trigger it
    const resize = () => {
      const ratio = window.devicePixelRatio || 1
      size = Math.round(displaySize * ratio)
      scale = size / motion.grid
      dot = Math.floor(2 * dotRadius * scale)
      element.width = size
      element.height = size
      if (shown >= 0) paint()
      resolution?.removeEventListener('change', resize)
      resolution = window.matchMedia?.(`(resolution: ${ratio}dppx)`)
      resolution?.addEventListener('change', resize)
    }
    // Every start shows one background-only frame first, so frames from separately checked payloads are never adjacent
    const draw = (time: number) => {
      if (start === undefined) { start = time; context.fillStyle = background; context.fillRect(0, 0, size, size) }
      else {
        const index = Math.floor((time - start) * motion.fps / 1000) % motion.frames.length
        if (index !== shown) { shown = index; paint() }
      }
      handle = window.requestAnimationFrame(draw)
    }
    resize()
    window.addEventListener('resize', resize)
    handle = window.requestAnimationFrame(draw)
    return () => { window.cancelAnimationFrame(handle); window.removeEventListener('resize', resize); resolution?.removeEventListener('change', resize) }
  }, [motion, paused])
  if (!motion || unavailable) return <p className="notice error" role="alert">The moving challenge could not be displayed. Reload the page, or request staff assistance below</p>
  return <>
    <canvas ref={canvas} className="motion-canvas" role="img" aria-label="Moving dots. A shape is visible only through motion, where the dots inside it move opposite to the dots around it. If you cannot use motion, request staff assistance below" />
    {reducedMotion && <p className="muted">Your device prefers reduced motion, but this challenge needs moving dots. If the motion is uncomfortable, request staff assistance below</p>}
  </>
}
