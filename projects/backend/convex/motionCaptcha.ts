import { indexedPng, VERIFICATION_ATTEMPTS } from "./captchaDomain.ts"
import { fail } from "./validation.ts"

// Every single frame is a uniform dot field, and frame averages keep mask-independent density and vertical
// streaks. The symbol exists only in frame-to-frame motion. Screen recording, browser automation or the
// payload itself can still reveal it.
export const MOTION_CAPTCHA_INSTRUCTION = "Watch the moving dots. A shape appears where dots move against the rest. Choose that shape."
export const MOTION_CAPTCHA_GRID = 256
export const MOTION_CAPTCHA_FPS = 30
export const MOTION_CAPTCHA_FRAME_COUNT = 60
// Two-frame dot lives keep burst shots and Live Photo frames from sharing dots.
export const MOTION_CAPTCHA_LIFETIME = 2
export const MOTION_CAPTCHA_SPEED = 3
// Every dot is visible in every frame. 550 dots let MOTION_CAPTCHA_FLASH_GUARD accept about 99% of first attempts.
export const MOTION_CAPTCHA_DOTS = 550
// Every symbol mask covers this grid fraction, so the share of figure motion does not depend on the symbol.
export const MOTION_CAPTCHA_AREA = 0.25
export const MOTION_CAPTCHA_COLORS = 4
export const MOTION_CAPTCHA_DOT_SIZE = 2.5
// Raster index 0 is the background and indexes 1 to 4 are dot colors 0 to 3: cyan, pink, amber, purple.
export const MOTION_CAPTCHA_PALETTE = [14, 18, 29, 58, 224, 221, 255, 105, 180, 255, 204, 73, 184, 142, 255]
export const MOTION_CAPTCHA_SYMBOLS = ["star", "heart", "triangle", "circle", "hourglass", "plus", "arrow", "moon", "house", "lightning"] as const
export const MOTION_CAPTCHA_CHOICES_WIDTH = 320
export const MOTION_CAPTCHA_CHOICES_HEIGHT = 232
// WCAG 2.3.1 area guard for the 320 CSS px canvas at every common Chrome, Firefox and Safari zoom step from 100% to 500%.
// At zoom z a grid unit spans 1.25z px, and the 341 x 256 px estimate of a 10-degree field spans 341 / 1.25z x 256 / 1.25z
// units. Dots are drawn as squares of whole device pixels, rounded down from the exact width, so each covers at most
// size x size px whatever the devicePixelRatio, the product of browser zoom and the display's native ratio. With a native
// ratio of at least 1, snapping a dot's edge moves it by at most half a px, so dots able to touch the field lie within the
// window's cells. Two frames, the worst case for any transition or frame jump, then change at most 25% of the field even
// with no overlap when the two busiest frames of every window total at most the budget. One frame alone is bounded too, so frame-to-blank and blank-to-frame changes stay within the
// limit when the canvas shows a blank frame between payloads, as it does for retries and round changes.
export const MOTION_CAPTCHA_ZOOM_STEPS = [100, 110, 115, 120, 125, 130, 133, 140, 150, 160, 170, 175, 180, 190, 200, 220, 240, 250, 260, 280, 300, 400, 500].map(percent => {
    const unit = 320 / MOTION_CAPTCHA_GRID * percent / 100, size = MOTION_CAPTCHA_DOT_SIZE * unit
    return { zoom: percent / 100, columns: Math.min(MOTION_CAPTCHA_GRID, Math.ceil(342 / unit + MOTION_CAPTCHA_DOT_SIZE)), rows: Math.min(MOTION_CAPTCHA_GRID, Math.ceil(257 / unit + MOTION_CAPTCHA_DOT_SIZE)), size, budget: Math.floor(0.25 * 341 * 256 / size ** 2) }
})
// A lower zoom's window contains every higher zoom's window, so a lower step with no larger budget already bounds a higher
// one. Only steps whose budget is below every lower step's are scanned. Steps with budget headroom scan every stride cells
// with windows stride - 1 cells larger, which contain every exact window they replace, so their counts stay upper bounds.
export const MOTION_CAPTCHA_FLASH_GUARD = MOTION_CAPTCHA_ZOOM_STEPS
    .filter((step, index, steps) => steps.slice(0, index).every(lower => lower.budget > step.budget && lower.columns >= step.columns && lower.rows >= step.rows))
    .map(step => ({ ...step, stride: Math.max(1, 2 ** Math.floor(Math.log2(step.budget / 64))) }))

export type MotionPoint = { x: number, y: number, color: number }
// 3 x 5 card labels.
const glyphs: Record<string, string[]> = {
    A: ["010", "101", "111", "101", "101"], B: ["110", "101", "110", "101", "110"],
    C: ["011", "100", "100", "100", "011"], D: ["110", "101", "101", "101", "110"],
    E: ["111", "100", "110", "100", "111"], F: ["111", "100", "110", "100", "100"],
}
type Point = readonly [number, number]

function sampler(random: () => number) {
    const sample = () => {
        const value = random()
        if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("Invalid server randomness")
        return value
    }
    const pick = (bound: number) => Math.floor(sample() * bound)
    const shuffle = <T>(values: T[]) => {
        for (let i = values.length - 1; i > 0; i--) { const j = pick(i + 1); [values[i], values[j]] = [values[j]!, values[i]!] }
        return values
    }
    return { sample, pick, shuffle }
}

const polygon = (x: number, y: number, points: readonly Point[]) => {
    let inside = false
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [ax, ay] = points[i]!, [bx, by] = points[j]!
        if (ay > y !== by > y && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside
    }
    return inside
}
const star = Array.from({ length: 10 }, (_, i): Point => [Math.cos(-Math.PI / 2 + i * Math.PI / 5) * (i % 2 ? 0.5 : 1), Math.sin(-Math.PI / 2 + i * Math.PI / 5) * (i % 2 ? 0.5 : 1) + 0.1])
// Bold filled silhouettes around the origin with y pointing down, in MOTION_CAPTCHA_SYMBOLS order.
const shapes: Array<(x: number, y: number) => boolean> = [
    (x, y) => polygon(x, y, star),
    (x, y) => (Math.abs(x) - 0.45) ** 2 + (y + 0.38) ** 2 <= 0.25 || polygon(x, y, [[-0.93, -0.25], [0.93, -0.25], [0, 0.92]]),
    (x, y) => polygon(x, y, [[0, -0.86], [0.98, 0.86], [-0.98, 0.86]]),
    (x, y) => x * x + y * y <= 0.92 ** 2,
    (x, y) => polygon(x, y, [[-0.85, -0.92], [0.85, -0.92], [0.17, 0], [0.85, 0.92], [-0.85, 0.92], [-0.17, 0]]),
    (x, y) => Math.max(Math.abs(x), Math.abs(y)) <= 0.92 && Math.min(Math.abs(x), Math.abs(y)) <= 0.3,
    (x, y) => x >= -0.95 && x <= 0.15 && Math.abs(y) <= 0.3 || polygon(x, y, [[0.05, -0.85], [0.97, 0], [0.05, 0.85]]),
    // Radially cut tips keep the crescent at least about a twelfth of the grid thick.
    (x, y) => x * x + y * y <= 1 && (x - 0.5) ** 2 + y * y > 0.5625 && x <= 0.404 * Math.abs(y),
    (x, y) => polygon(x, y, [[-0.98, 0.02], [0, -0.92], [0.98, 0.02]]) || Math.abs(x) <= 0.7 && y >= -0.05 && y <= 0.9 && (Math.abs(x) > 0.18 || y < 0.38),
    (x, y) => polygon(x, y, [[-0.25, -0.9], [0.8, -0.9], [0.38, -0.18], [0.95, -0.18], [-0.35, 0.9], [-0.05, 0.12], [-0.7, 0.12]]),
]

const masks = new Map<number, Uint8Array>()
function symbolMask(symbol: number) {
    const shape = shapes[symbol], grid = MOTION_CAPTCHA_GRID, target = MOTION_CAPTCHA_AREA * grid * grid
    if (!shape) throw new Error("Unknown motion symbol")
    let mask = masks.get(symbol)
    if (mask) return mask
    const rasterize = (radius: number) => {
        const cells = new Uint8Array(grid * grid)
        for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) cells[y * grid + x] = Number(shape((x + 0.5 - grid / 2) / radius, (y + 0.5 - grid / 2) / radius))
        return cells
    }
    // Area grows with the square of the radius. Two corrections land within a few cells of the target.
    let radius = 100
    mask = rasterize(radius)
    for (let pass = 0; pass < 2; pass++) { radius *= Math.sqrt(target / mask.reduce((sum, value) => sum + value, 0)); mask = rasterize(radius) }
    masks.set(symbol, mask)
    return mask
}
// One byte per grid cell, 1 inside the centered symbol.
export function motionMask(symbol: number): Uint8Array {
    return symbolMask(symbol).slice()
}

// Every dot draws a complete vertical trajectory around a uniform midpoint on the torus, moving with
// direction inside the mask and against it outside. No dot is ever hidden. Its uniform phase shows mirrored
// trajectory offsets equally often, so single frames and window averages are uniform whatever the mask.
export function createMotionFrames(mask: Uint8Array, direction: 1 | -1, random: () => number = Math.random): MotionPoint[][] {
    const { sample, pick, shuffle } = sampler(random), grid = MOTION_CAPTCHA_GRID, lifetime = MOTION_CAPTCHA_LIFETIME, count = MOTION_CAPTCHA_FRAME_COUNT
    if (mask.length !== grid * grid || count % lifetime !== 0) throw new Error("Invalid motion field")
    const frames: MotionPoint[][] = Array.from({ length: count }, () => [])
    for (let dot = 0; dot < MOTION_CAPTCHA_DOTS; dot++) {
        const phase = pick(lifetime)
        for (let start = phase; start < phase + count; start += lifetime) {
            const x = pick(grid), y = sample() * grid, color = pick(MOTION_CAPTCHA_COLORS)
            const velocity = (mask[Math.floor(y) * grid + x] ? direction : -direction) * MOTION_CAPTCHA_SPEED
            for (let age = 0; age < lifetime; age++) {
                const row = Math.floor(((y + (age - (lifetime - 1) / 2) * velocity) % grid + grid) % grid)
                frames[(start + age) % count]!.push({ x, y: row, color })
            }
        }
    }
    for (const frame of frames) shuffle(frame)
    return frames
}

// For each guard scale, the largest total of the two busiest frames' dot counts in any window, exact at stride 1 and an
// upper bound otherwise. One summed-area table per frame serves every scale. Windows stay inside the canvas, because the
// screen does not wrap.
export function motionFlashPeaks(frames: readonly (readonly MotionPoint[])[]): number[] {
    const grid = MOTION_CAPTCHA_GRID, line = grid + 1, table = new Int32Array(line * line)
    const scales = MOTION_CAPTCHA_FLASH_GUARD.map(({ columns, rows, stride }) => {
        const width = Math.min(grid, columns + stride - 1), height = Math.min(grid, rows + stride - 1)
        const xs = Int32Array.from({ length: Math.ceil((grid - columns + 1) / stride) }, (_, k) => Math.min(k * stride, grid - width))
        const ys = Int32Array.from({ length: Math.ceil((grid - rows + 1) / stride) }, (_, k) => Math.min(k * stride, grid - height))
        return { width, height, xs, ys, first: new Uint16Array(xs.length * ys.length), second: new Uint16Array(xs.length * ys.length) }
    })
    for (const frame of frames) {
        table.fill(0)
        for (const { x, y } of frame) table[(y + 1) * line + x + 1]! += 1
        for (let y = 1; y <= grid; y++) { let row = 0; for (let x = 1; x <= grid; x++) { row += table[y * line + x]!; table[y * line + x] = table[(y - 1) * line + x]! + row } }
        for (const { width, height, xs, ys, first, second } of scales) for (let j = 0; j < ys.length; j++) {
            const top = ys[j]! * line, bottom = top + height * line, out = j * xs.length
            for (let i = 0; i < xs.length; i++) {
                const x = xs[i]!, sum = table[bottom + x + width]! - table[top + x + width]! - table[bottom + x]! + table[top + x]!, index = out + i
                if (sum > second[index]!) { if (sum > first[index]!) { second[index] = first[index]!; first[index] = sum } else second[index] = sum }
            }
        }
    }
    return scales.map(({ first, second }) => first.reduce((peak, value, index) => Math.max(peak, value + second[index]!), 0))
}

export function encodeMotionFrames(frames: readonly (readonly MotionPoint[])[]): string {
    if (frames.length < 1 || frames.length > 255) throw new Error("Invalid motion frame count")
    const bytes = new Uint8Array(4 + frames.reduce((sum, frame) => sum + 2 + frame.length * 3, 0))
    bytes.set([1, frames.length, MOTION_CAPTCHA_FPS, MOTION_CAPTCHA_GRID - 1])
    let offset = 4
    for (const frame of frames) {
        if (frame.length > 65535) throw new Error("Invalid motion point count")
        bytes[offset++] = frame.length & 255; bytes[offset++] = frame.length >>> 8
        for (const { x, y, color } of frame) {
            if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= MOTION_CAPTCHA_GRID || y >= MOTION_CAPTCHA_GRID || !Number.isInteger(color) || color < 0 || color >= MOTION_CAPTCHA_COLORS) throw new Error("Invalid motion point")
            bytes[offset++] = x; bytes[offset++] = y; bytes[offset++] = color
        }
    }
    let binary = ""
    for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
    return btoa(binary)
}

export function decodeMotionFrames(payload: string): { fps: number, frameCount: number, grid: number, frames: MotionPoint[][] } {
    const bytes = Uint8Array.from(atob(payload), char => char.charCodeAt(0))
    if (bytes.length < 4 || bytes[0] !== 1 || bytes[1] === 0 || bytes[2] === 0) throw new Error("Invalid motion frames")
    const frameCount = bytes[1]!, fps = bytes[2]!, grid = bytes[3]! + 1, frames: MotionPoint[][] = []
    let offset = 4
    for (let index = 0; index < frameCount; index++) {
        if (offset + 2 > bytes.length) throw new Error("Invalid motion frames")
        const count = bytes[offset]! | bytes[offset + 1]! << 8, frame: MotionPoint[] = []
        offset += 2
        if (offset + count * 3 > bytes.length) throw new Error("Invalid motion frames")
        for (let point = 0; point < count; point++, offset += 3) {
            const x = bytes[offset]!, y = bytes[offset + 1]!, color = bytes[offset + 2]!
            if (x >= grid || y >= grid || color >= MOTION_CAPTCHA_COLORS) throw new Error("Invalid motion frames")
            frame.push({ x, y, color })
        }
        frames.push(frame)
    }
    if (offset !== bytes.length) throw new Error("Invalid motion frames")
    return { fps, frameCount, grid, frames }
}

// Matches the canvas with scale in device pixels per grid unit: each square around (x + 0.5, y + 0.5) snaps its top-left
// corner with Math.round, is MOTION_CAPTCHA_DOT_SIZE units wide rounded down to whole pixels, fills [left, right) by
// [top, bottom) clipped to the canvas and paints in payload order.
export function rasterizeMotionFrame(frame: readonly MotionPoint[], scale: number): { width: number, height: number, pixels: Uint8Array } {
    if (!Number.isFinite(scale) || scale <= 0 || scale > 16) throw new Error("Invalid motion scale")
    const width = Math.round(MOTION_CAPTCHA_GRID * scale), height = width, pixels = new Uint8Array(width * height), half = MOTION_CAPTCHA_DOT_SIZE / 2
    const dot = Math.floor(MOTION_CAPTCHA_DOT_SIZE * scale)
    const span = (center: number) => { const start = Math.round((center - half) * scale); return [Math.max(0, start), Math.min(width, start + dot)] as const }
    for (const { x, y, color } of frame) {
        const [left, right] = span(x + 0.5), [top, bottom] = span(y + 0.5)
        for (let row = top; row < bottom; row++) pixels.fill(color + 1, row * width + left, row * width + right)
    }
    return { width, height, pixels }
}

// Six labeled cards in three columns, each showing its symbol's exact mask. Card order is the answer order.
export function motionChoicesImage(choices: readonly number[]): string {
    const width = MOTION_CAPTCHA_CHOICES_WIDTH, height = MOTION_CAPTCHA_CHOICES_HEIGHT, pixels = new Uint8Array(width * height), grid = MOTION_CAPTCHA_GRID
    if (choices.length !== 6) throw new Error("Invalid motion choices")
    choices.forEach((symbol, index) => {
        const mask = symbolMask(symbol), left = 8 + index % 3 * 104, top = 8 + Math.floor(index / 3) * 112
        for (let y = top; y < top + 104; y++) for (let x = left; x < left + 96; x++) pixels[y * width + x] = x === left || x === left + 95 || y === top || y === top + 103 ? 2 : 1
        // An 84-pixel square under the label samples the whole grid.
        for (let y = 0; y < 84; y++) for (let x = 0; x < 84; x++) if (mask[Math.floor((y + 0.5) * grid / 84) * grid + Math.floor((x + 0.5) * grid / 84)]) pixels[(top + 18 + y) * width + left + 6 + x] = 3
        const glyph = glyphs["ABCDEF"[index]!]!
        for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) if (glyph[row]![col] === "1") {
            for (let dy = 0; dy < 3; dy++) pixels.fill(3, (top + 3 + row * 3 + dy) * width + left + 5 + col * 3, (top + 3 + row * 3 + dy) * width + left + 8 + col * 3)
        }
    })
    let binary = ""
    for (const byte of indexedPng(width, height, pixels)) binary += String.fromCharCode(byte)
    return `data:image/png;base64,${btoa(binary)}`
}

const mix = (value: number) => {
    value = Math.imul(value ^ value >>> 16, 0x85ebca6b)
    value = Math.imul(value ^ value >>> 13, 0xc2b2ae35)
    return (value ^ value >>> 16) | 0
}
// sfc32 seeded from a private 128-bit challenge seed and the round, so a round regenerates exactly.
export function motionRandom(seed: string, round: number): () => number {
    if (!/^[0-9a-f]{32}$/.test(seed) || !Number.isInteger(round) || round < 0) throw new Error("Invalid motion seed")
    const words = [0, 8, 16, 24].map(offset => parseInt(seed.slice(offset, offset + 8), 16))
    let a = mix(words[0]! + Math.imul(round + 1, 0x9e3779b9)), b = mix(words[1]! ^ a), c = mix(words[2]! ^ b), d = mix(words[3]! ^ c)
    const next = () => {
        const t = (a + b | 0) + d | 0
        d = d + 1 | 0; a = b ^ b >>> 9; b = c + (c << 3) | 0; c = (c << 21 | c >>> 11) + t | 0
        return (t >>> 0) / 4294967296
    }
    for (let i = 0; i < 16; i++) next()
    return next
}

function roundSetup(random: () => number) {
    const { pick, shuffle } = sampler(random)
    const choices = shuffle(MOTION_CAPTCHA_SYMBOLS.map((_, index) => index)).slice(0, 6), answerIndex = pick(6)
    return { choices, answerIndex, direction: pick(2) === 0 ? 1 as const : -1 as const }
}

// The returned choices and answer stay server-side. Only motionFrames and imageDataUri reach the browser. Positions are
// redrawn from the same stream until the flash guard holds, so a seed always regenerates the same accepted round.
export function createMotionRound(random: () => number = Math.random) {
    const { choices, answerIndex, direction } = roundSetup(random), mask = symbolMask(choices[answerIndex]!)
    for (let attempt = 0; attempt < 32; attempt++) {
        const frames = createMotionFrames(mask, direction, random)
        if (motionFlashPeaks(frames).every((peak, index) => peak <= MOTION_CAPTCHA_FLASH_GUARD[index]!.budget)) return { motionFrames: encodeMotionFrames(frames), imageDataUri: motionChoicesImage(choices), answerIndex, choices }
    }
    throw new Error("Motion field exceeds the flash guard")
}
export const motionRound = (seed: string, round: number) => createMotionRound(motionRandom(seed, round))

// Checks the two rounds as one pair. The first choice gets no feedback, and a full pair consumes one attempt.
export function motionAnswer(state: { status: string, solveExpiresAt?: number, attempts: number, pathAnswers?: number[], pathSelections?: number[], pathRound?: number }, selected: unknown, round: unknown, now: number) {
    if (!Array.isArray(selected) || selected.length !== 1 || !Number.isInteger(selected[0]) || selected[0] < 0 || selected[0] > 5 || round !== 0 && round !== 1) fail(400, "Choose one shape for the current round")
    if (state.status !== "started") fail(409, "Challenge is no longer active")
    if (state.solveExpiresAt === undefined || now >= state.solveExpiresAt) return { status: "expired" as const, attempts: state.attempts }
    if (state.attempts >= VERIFICATION_ATTEMPTS || state.pathAnswers?.length !== 2) fail(409, "Challenge is no longer active")
    if (round !== state.pathRound) {
        if (round === 0 && state.pathRound === 1 && state.pathSelections?.[0] === selected[0]) return { status: "started" as const, attempts: state.attempts, pathRound: 1, pathSelections: state.pathSelections!.slice() }
        fail(409, "Round changed. Refresh the current challenge")
    }
    if (round === 0) return { status: "started" as const, attempts: state.attempts, pathRound: 1, pathSelections: [selected[0] as number] }
    if (state.pathSelections?.length !== 1) fail(409, "Complete the first round")
    const attempts = state.attempts + 1, correct = state.pathSelections[0] === state.pathAnswers[0] && selected[0] === state.pathAnswers[1]
    return { status: correct ? "solved" as const : attempts === VERIFICATION_ATTEMPTS ? "failed" as const : "started" as const, attempts, pathRound: 0, pathSelections: [] as number[] }
}

// Rows store only the seed and answers. Views regenerate the current round's frames and choices.
export function createMotionCaptcha(random: () => number = Math.random) {
    const { pick } = sampler(random), motionSeed = Array.from({ length: 4 }, () => pick(2 ** 32).toString(16).padStart(8, "0")).join("")
    return { motionSeed, pathAnswers: [0, 1].map(round => roundSetup(motionRandom(motionSeed, round)).answerIndex), pathSelections: [] as number[], pathRound: 0 }
}
