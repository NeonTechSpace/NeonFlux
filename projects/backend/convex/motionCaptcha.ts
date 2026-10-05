import {
    MOTION_CAPTCHA_COLORS,
    MOTION_CAPTCHA_DOT_SIZE,
    MOTION_CAPTCHA_GRID,
    MOTION_CAPTCHA_RGB,
    SPARK_START,
    SPARK_GOAL,
    SPARK_GOAL_RADIUS,
    SPARK_SIZE,
    SPARK_MAX_SAMPLE_GAP,
    SPARK_MIN_TIME,
    SPARK_MAX_TIME,
    SPARK_MAX_SPEED,
    encodeMotionFrames,
    isSparkPath,
    type MotionPoint,
} from "@neonflux/contracts/motion-captcha"
import { VERIFICATION_ATTEMPTS } from "./captchaDomain.ts"
import { fail } from "./validation.ts"

export const MOTION_CAPTCHA_INSTRUCTION =
    "Drag the spark or use the arrow keys to guide it along the moving current into the goal ring"
const MOTION_CAPTCHA_FPS = 30,
    MOTION_CAPTCHA_FRAME_COUNT = 240
export const MOTION_CAPTCHA_DOTS = 320
export const SPARK_ROUTE_TOLERANCE = 13
const SPARK_START_RADIUS = 6,
    SPARK_CURRENT_WIDTH = 16
export const MOTION_CAPTCHA_PALETTE = MOTION_CAPTCHA_RGB.flat()

export const MOTION_CAPTCHA_ZOOM_STEPS = [
    100, 110, 115, 120, 125, 130, 133, 140, 150, 160, 170, 175, 180, 190, 200, 220, 240, 250, 260, 280, 300, 400, 500,
].map((percent) => {
    const unit = ((320 / MOTION_CAPTCHA_GRID) * percent) / 100,
        size = MOTION_CAPTCHA_DOT_SIZE * unit
    return {
        zoom: percent / 100,
        columns: Math.min(MOTION_CAPTCHA_GRID, Math.ceil(342 / unit + MOTION_CAPTCHA_DOT_SIZE)),
        rows: Math.min(MOTION_CAPTCHA_GRID, Math.ceil(257 / unit + MOTION_CAPTCHA_DOT_SIZE)),
        size,
        budget: Math.floor((0.25 * 341 * 256 - 2 * (SPARK_SIZE * unit + 2) ** 2) / size ** 2),
    }
})
// A lower zoom's window contains every higher zoom's window, so a lower step with no larger budget already bounds a higher
// one. Only steps whose budget is below every lower step's are scanned. Steps with budget headroom scan every stride cells
// with windows stride - 1 cells larger, which contain every exact window they replace, so their counts stay upper bounds.
export const MOTION_CAPTCHA_FLASH_GUARD = MOTION_CAPTCHA_ZOOM_STEPS.filter((step, index, steps) =>
    steps
        .slice(0, index)
        .every((lower) => lower.budget > step.budget && lower.columns >= step.columns && lower.rows >= step.rows),
).map((step) => ({ ...step, stride: Math.max(1, 2 ** Math.floor(Math.log2(step.budget / 64))) }))

const mix = (value: number) => {
    value = Math.imul(value ^ (value >>> 16), 0x85ebca6b)
    value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35)
    return (value ^ (value >>> 16)) | 0
}
// sfc32 seeded from a private 128-bit challenge seed so frames regenerate exactly.
export function motionRandom(seed: string): () => number {
    if (!/^[0-9a-f]{32}$/.test(seed)) throw new Error("Invalid motion seed")
    const words = [0, 8, 16, 24].map((offset) => parseInt(seed.slice(offset, offset + 8), 16))
    let a = mix(words[0]! + 0x9e3779b9),
        b = mix(words[1]! ^ a),
        c = mix(words[2]! ^ b),
        d = mix(words[3]! ^ c)
    const next = () => {
        const t = (((a + b) | 0) + d) | 0
        d = (d + 1) | 0
        a = b ^ (b >>> 9)
        b = (c + (c << 3)) | 0
        c = (((c << 21) | (c >>> 11)) + t) | 0
        return (t >>> 0) / 4294967296
    }
    for (let i = 0; i < 16; i++) next()
    return next
}

function sample(random: () => number) {
    const value = random()
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("Invalid server randomness")
    return value
}
export function createMotionCaptcha(random: () => number = Math.random) {
    return {
        motionSeed: Array.from({ length: 4 }, () =>
            Math.floor(sample(random) * 2 ** 32)
                .toString(16)
                .padStart(8, "0"),
        ).join(""),
    }
}
// Three waves with seeded strengths and phases, so a guessed route almost never stays within the tolerance of the real one
const SPARK_WAVES = [
    [30, 10],
    [18, 8],
    [10, 5],
] as const
const SPARK_ROUTE_DRAWS = SPARK_WAVES.length * 2
// A smooth horizontal graph with fixed endpoints and zero endpoint slopes, at most 81 units from the middle row
export function sparkRoute(seed: string) {
    const random = motionRandom(seed),
        waves = SPARK_WAVES.map(([base, spread], index) => ({
            frequency: index + 1,
            amplitude: base + random() * spread,
            phase: random() * Math.PI * 2,
        }))
    return (x: number) => {
        if (x <= SPARK_START.x || x >= SPARK_GOAL.x) return SPARK_START.y
        const u = (x - SPARK_START.x) / (SPARK_GOAL.x - SPARK_START.x)
        return (
            SPARK_START.y +
            Math.sin(Math.PI * u) ** 2 *
                waves.reduce(
                    (sum, { frequency, amplitude, phase }) =>
                        sum + amplitude * Math.sin(frequency * Math.PI * u + phase),
                    0,
                )
        )
    }
}
// Uniform x and route-relative offsets form an area-preserving coordinate system. Moving x at either sign preserves
// uniform density in every frame. Only the current's direction is coherent. Color, size and lifetime never identify it
export function createMotionFrames(route: (x: number) => number, random: () => number): MotionPoint[][] {
    const grid = MOTION_CAPTCHA_GRID,
        count = MOTION_CAPTCHA_FRAME_COUNT,
        frames: MotionPoint[][] = Array.from({ length: count }, () => [])
    for (let dot = 0; dot < MOTION_CAPTCHA_DOTS; dot++) {
        const x = sample(random) * grid,
            offset = sample(random) * grid,
            color = Math.floor(sample(random) * MOTION_CAPTCHA_COLORS)
        const direction = Math.min(offset, grid - offset) <= SPARK_CURRENT_WIDTH ? 1 : sample(random) < 0.5 ? -1 : 1
        for (let index = 0; index < count; index++) {
            const column = (x + (direction * index * grid) / count + grid) % grid
            frames[index]!.push({ x: Math.floor(column), y: Math.floor((route(column) + offset) % grid), color })
        }
    }
    for (const frame of frames)
        for (let i = frame.length - 1; i > 0; i--) {
            const j = Math.floor(sample(random) * (i + 1))
            ;[frame[i], frame[j]] = [frame[j]!, frame[i]!]
        }
    return frames
}

export function motionFlashPeaks(frames: readonly (readonly MotionPoint[])[]): number[] {
    const grid = MOTION_CAPTCHA_GRID,
        line = grid + 1,
        table = new Int32Array(line * line)
    const scales = MOTION_CAPTCHA_FLASH_GUARD.map(({ columns, rows, stride }) => {
        const width = Math.min(grid, columns + stride - 1),
            height = Math.min(grid, rows + stride - 1)
        const xs = Int32Array.from({ length: Math.ceil((grid - columns + 1) / stride) }, (_, k) =>
            Math.min(k * stride, grid - width),
        )
        const ys = Int32Array.from({ length: Math.ceil((grid - rows + 1) / stride) }, (_, k) =>
            Math.min(k * stride, grid - height),
        )
        return {
            width,
            height,
            xs,
            ys,
            first: new Uint16Array(xs.length * ys.length),
            second: new Uint16Array(xs.length * ys.length),
        }
    })
    for (const frame of frames) {
        table.fill(0)
        for (const { x, y } of frame) table[(y + 1) * line + x + 1]! += 1
        for (let y = 1; y <= grid; y++) {
            let row = 0
            for (let x = 1; x <= grid; x++) {
                row += table[y * line + x]!
                table[y * line + x] = table[(y - 1) * line + x]! + row
            }
        }
        for (const { width, height, xs, ys, first, second } of scales)
            for (let j = 0; j < ys.length; j++) {
                const top = ys[j]! * line,
                    bottom = top + height * line,
                    out = j * xs.length
                for (let i = 0; i < xs.length; i++) {
                    const x = xs[i]!,
                        sum =
                            table[bottom + x + width]! - table[top + x + width]! - table[bottom + x]! + table[top + x]!,
                        index = out + i
                    if (sum > second[index]!) {
                        if (sum > first[index]!) {
                            second[index] = first[index]!
                            first[index] = sum
                        } else second[index] = sum
                    }
                }
            }
    }
    return scales.map(({ first, second }) =>
        first.reduce((peak, value, index) => Math.max(peak, value + second[index]!), 0),
    )
}

// Matches the canvas with scale in device pixels per grid unit: each square around (x + 0.5, y + 0.5) snaps its top-left
// corner with Math.round, is MOTION_CAPTCHA_DOT_SIZE units wide rounded down to whole pixels, fills [left, right) by
// [top, bottom) clipped to the canvas and paints in payload order.
export function rasterizeMotionFrame(
    frame: readonly MotionPoint[],
    scale: number,
): { width: number; height: number; pixels: Uint8Array } {
    if (!Number.isFinite(scale) || scale <= 0 || scale > 16) throw new Error("Invalid motion scale")
    const width = Math.round(MOTION_CAPTCHA_GRID * scale),
        height = width,
        pixels = new Uint8Array(width * height),
        half = MOTION_CAPTCHA_DOT_SIZE / 2
    const dot = Math.floor(MOTION_CAPTCHA_DOT_SIZE * scale)
    const span = (center: number) => {
        const start = Math.round((center - half) * scale)
        return [Math.max(0, start), Math.min(width, start + dot)] as const
    }
    for (const { x, y, color } of frame) {
        const [left, right] = span(x + 0.5),
            [top, bottom] = span(y + 0.5)
        for (let row = top; row < bottom; row++) pixels.fill(color + 1, row * width + left, row * width + right)
    }
    return { width, height, pixels }
}

// The seed always regenerates the same first field that passes the guard, including room for the moving spark
export function motionChallenge(seed: string) {
    const route = sparkRoute(seed),
        random = motionRandom(seed)
    // The first draws define the route. Particle positions start after them so they do not repeat those values
    for (let draw = 0; draw < SPARK_ROUTE_DRAWS; draw++) random()
    for (let attempt = 0; attempt < 32; attempt++) {
        const frames = createMotionFrames(route, random)
        if (motionFlashPeaks(frames).every((peak, index) => peak <= MOTION_CAPTCHA_FLASH_GUARD[index]!.budget))
            return { motionFrames: encodeMotionFrames(frames, MOTION_CAPTCHA_FPS) }
    }
    throw new Error("Motion field exceeds the flash guard")
}
// Check every submitted point and the straight segments between them at no more than one grid unit apart
export function sparkPathValid(seed: string, path: unknown, elapsed: number): boolean {
    if (!isSparkPath(path)) return false
    const first = path[0]!,
        last = path[path.length - 1]!
    if (
        first.t !== 0 ||
        last.t < SPARK_MIN_TIME ||
        last.t > SPARK_MAX_TIME ||
        last.t > elapsed ||
        Math.hypot(first.x - SPARK_START.x, first.y - SPARK_START.y) > SPARK_START_RADIUS ||
        Math.hypot(last.x - SPARK_GOAL.x, last.y - SPARK_GOAL.y) > SPARK_GOAL_RADIUS
    )
        return false
    const route = sparkRoute(seed)
    // The route's second derivative stays below 0.16, so over a one-unit segment its chord error is below 0.02
    // A 0.03-unit margin keeps the entire segment inside the tolerance between the checked positions
    const inside = (x: number, y: number) =>
        x >= SPARK_START.x - SPARK_START_RADIUS &&
        x <= SPARK_GOAL.x + SPARK_GOAL_RADIUS &&
        Math.abs(y - route(x)) <= SPARK_ROUTE_TOLERANCE - 0.03
    if (!inside(first.x, first.y)) return false
    for (let index = 1; index < path.length; index++) {
        const before = path[index - 1]!,
            point = path[index]!,
            dt = point.t - before.t,
            distance = Math.hypot(point.x - before.x, point.y - before.y)
        if (dt <= 0 || dt > SPARK_MAX_SAMPLE_GAP || distance > (SPARK_MAX_SPEED * dt) / 1000) return false
        const steps = Math.max(1, Math.ceil(distance))
        for (let step = 1; step <= steps; step++)
            if (
                !inside(
                    before.x + ((point.x - before.x) * step) / steps,
                    before.y + ((point.y - before.y) * step) / steps,
                )
            )
                return false
    }
    return true
}
export function motionAnswer(
    state: { status: string; solveExpiresAt?: number; startedAt?: number; attempts: number; motionSeed?: string },
    path: unknown,
    now: number,
) {
    if (
        state.status !== "started" ||
        state.attempts >= VERIFICATION_ATTEMPTS ||
        !state.motionSeed ||
        state.startedAt === undefined
    )
        fail(409, "Challenge is no longer active")
    if (state.solveExpiresAt === undefined || now >= state.solveExpiresAt)
        return { status: "expired" as const, attempts: state.attempts }
    const attempts = state.attempts + 1,
        correct = sparkPathValid(state.motionSeed, path, now - state.startedAt)
    return {
        status: correct
            ? ("solved" as const)
            : attempts === VERIFICATION_ATTEMPTS
              ? ("failed" as const)
              : ("started" as const),
        attempts,
    }
}
