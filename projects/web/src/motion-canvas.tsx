import { MOTION_CAPTCHA_CANVAS, MOTION_CAPTCHA_DOT_SIZE, MOTION_CAPTCHA_GRID, MOTION_CAPTCHA_RGB, SPARK_START, SPARK_GOAL, SPARK_GOAL_RADIUS, SPARK_SIZE, SPARK_SAMPLE_MS, SPARK_MAX_SAMPLES, SPARK_PLAY_SPEED, decodeMotionFrames, type SparkSample } from '@neonflux/contracts/motion-captcha'
import { useEffect, useMemo, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react'

const [background, ...colors] = MOTION_CAPTCHA_RGB.map(rgb => '#' + rgb.map(value => value.toString(16).padStart(2, '0')).join(''))
const decode = (payload: string) => { try { return decodeMotionFrames(payload) } catch { return undefined } }
const edge = (center: number, scale: number) => Math.round((center + 0.5 - MOTION_CAPTCHA_DOT_SIZE / 2) * scale)

export function MotionCanvas({ frames: payload, paused = false, resetKey = 0, onComplete }: { frames: string, paused?: boolean, resetKey?: number, onComplete: (path: SparkSample[]) => void }) {
  const motion = useMemo(() => decode(payload), [payload]), canvas = useRef<HTMLCanvasElement>(null), spark = useRef<HTMLSpanElement>(null)
  const complete = useRef(onComplete)
  complete.current = onComplete
  const play = useMemo(() => ({ x: SPARK_START.x, y: SPARK_START.y, path: [] as SparkSample[], start: undefined as number | undefined, last: undefined as number | undefined, target: undefined as { x: number, y: number } | undefined, pointer: undefined as number | undefined, keys: new Set<string>(), done: false }), [payload, resetKey])
  const [unavailable, setUnavailable] = useState(false), [reducedMotion, setReducedMotion] = useState(false)
  useEffect(() => { setReducedMotion(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) }, [])
  useEffect(() => {
    const element = canvas.current
    if (!motion || !element) return
    const context = element.getContext('2d')
    if (!context) { setUnavailable(true); return }
    let start: number | undefined, shown = -1, handle = 0, size = 0, scale = 0, dot = 0, resolution: MediaQueryList | undefined
    const position = () => { if (spark.current) { spark.current.style.left = play.x / MOTION_CAPTCHA_GRID * 100 + '%'; spark.current.style.top = play.y / MOTION_CAPTCHA_GRID * 100 + '%' } }
    const paint = () => {
      context.fillStyle = background!
      context.fillRect(0, 0, size, size)
      if (shown < 0) return
      for (const point of motion.frames[shown]!) { context.fillStyle = colors[point.color]!; context.fillRect(edge(point.x, scale), edge(point.y, scale), dot, dot) }
    }
    const resize = () => {
      const ratio = window.devicePixelRatio || 1
      size = Math.round(MOTION_CAPTCHA_CANVAS * ratio); scale = size / motion.grid; dot = Math.floor(MOTION_CAPTCHA_DOT_SIZE * scale)
      element.width = size; element.height = size; if (shown >= 0) paint()
      resolution?.removeEventListener('change', resize)
      resolution = window.matchMedia?.('(resolution: ' + ratio + 'dppx)')
      resolution?.addEventListener('change', resize)
    }
    const sample = (x: number, y: number, t: number) => play.path.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, t: Math.ceil(t) })
    const steer = (time: number) => {
      const before = { x: play.x, y: play.y }, dx = Number(play.keys.has('ArrowRight')) - Number(play.keys.has('ArrowLeft')), dy = Number(play.keys.has('ArrowDown')) - Number(play.keys.has('ArrowUp'))
      let vx = dx, vy = dy
      if (!dx && !dy && play.target) { vx = play.target.x - play.x; vy = play.target.y - play.y }
      const distance = Math.hypot(vx, vy)
      if (distance > 0 && play.start === undefined) { play.start = time; sample(play.x, play.y, 0) }
      const previous = play.last ?? time, dt = Math.max(0, Math.min(100, time - previous))
      if (distance > 0) {
        const step = Math.min(SPARK_PLAY_SPEED * dt / 1000, play.target && !dx && !dy ? distance : Infinity)
        play.x = Math.max(0, Math.min(255, play.x + vx / distance * step)); play.y = Math.max(0, Math.min(255, play.y + vy / distance * step))
      }
      play.last = time
      position()
      if (play.start === undefined || play.done) return
      const elapsed = time - play.start
      while (play.path.length < SPARK_MAX_SAMPLES && elapsed >= play.path[play.path.length - 1]!.t + SPARK_SAMPLE_MS) {
        const t = play.path[play.path.length - 1]!.t + SPARK_SAMPLE_MS, fraction = Math.max(0, Math.min(1, (play.start + t - previous) / Math.max(1, time - previous)))
        sample(before.x + (play.x - before.x) * fraction, before.y + (play.y - before.y) * fraction, t)
      }
      const goal = Math.hypot(Math.round(play.x * 100) / 100 - SPARK_GOAL.x, Math.round(play.y * 100) / 100 - SPARK_GOAL.y) <= SPARK_GOAL_RADIUS
      if (goal || play.path.length === SPARK_MAX_SAMPLES) {
        if (goal && play.path.length < SPARK_MAX_SAMPLES && Math.ceil(elapsed) > play.path[play.path.length - 1]!.t) sample(play.x, play.y, elapsed)
        play.done = true; play.target = undefined; play.keys.clear(); complete.current(play.path.slice())
      }
    }
    const draw = (time: number) => {
      if (start === undefined) { start = time; paint() }
      else { const index = Math.floor((time - start) * motion.fps / 1000) % motion.frames.length; if (index !== shown) { shown = index; paint() }; steer(time) }
      if (!play.done) handle = window.requestAnimationFrame(draw)
    }
    resize(); position()
    window.addEventListener('resize', resize)
    if (!paused && !play.done) handle = window.requestAnimationFrame(draw)
    const release = () => { play.keys.clear(); play.target = undefined; play.pointer = undefined }
    window.addEventListener('blur', release)
    return () => { window.cancelAnimationFrame(handle); window.removeEventListener('resize', resize); window.removeEventListener('blur', release); resolution?.removeEventListener('change', resize); play.last = undefined; release() }
  }, [motion, paused, play])
  const coordinates = (event: PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: (event.clientX - bounds.left) / bounds.width * MOTION_CAPTCHA_GRID, y: (event.clientY - bounds.top) / bounds.height * MOTION_CAPTCHA_GRID }
  }
  const key = (event: KeyboardEvent<HTMLCanvasElement>, down: boolean) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    if (paused || play.done) return
    if (down) play.keys.add(event.key); else play.keys.delete(event.key)
  }
  if (!motion || unavailable) return <p className="notice error" role="alert">The moving challenge could not be displayed. Reload the page, or request staff assistance below</p>
  return <>
    <div className="spark-field">
      <canvas ref={canvas} className="motion-canvas" tabIndex={0} role="application" aria-label="Guide the spark. Drag from the start or use the arrow keys to follow the current visible only in motion to the goal ring. Request staff assistance below if you cannot use motion" onKeyDown={event => key(event, true)} onKeyUp={event => key(event, false)} onBlur={() => play.keys.clear()}
        onPointerDown={event => { if (paused || play.done || play.pointer !== undefined) return; const point = coordinates(event); if (Math.hypot(point.x - play.x, point.y - play.y) > 14) return; event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); play.pointer = event.pointerId; play.target = point }}
        onPointerMove={event => { if (!paused && play.pointer === event.pointerId) play.target = coordinates(event) }}
        onPointerUp={event => { if (play.pointer === event.pointerId) { play.target = undefined; play.pointer = undefined } }} onPointerCancel={() => { play.target = undefined; play.pointer = undefined }} onLostPointerCapture={() => { play.target = undefined; play.pointer = undefined }} />
      <span className="spark-start" aria-hidden="true" style={{ left: SPARK_START.x / 256 * 100 + '%', top: SPARK_START.y / 256 * 100 + '%' }} />
      <span className="spark-goal" aria-hidden="true" style={{ left: SPARK_GOAL.x / 256 * 100 + '%', top: SPARK_GOAL.y / 256 * 100 + '%', width: SPARK_GOAL_RADIUS * 2 / 256 * 100 + '%', height: SPARK_GOAL_RADIUS * 2 / 256 * 100 + '%' }} />
      <span ref={spark} className="spark" aria-hidden="true" style={{ width: SPARK_SIZE / 256 * 100 + '%', height: SPARK_SIZE / 256 * 100 + '%' }} />
    </div>
    <div className="spark-labels" aria-hidden="true"><span>Start</span><span>Goal</span></div>
    {reducedMotion && <p className="muted">Your device prefers reduced motion, but this challenge needs moving particles. If the motion is uncomfortable, request staff assistance below</p>}
  </>
}
