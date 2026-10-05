// Public frame geometry and trace bounds. The seeded route stays in the backend
export const MOTION_CAPTCHA_GRID = 256
export const MOTION_CAPTCHA_COLORS = 4
export const MOTION_CAPTCHA_RGB = [[14, 18, 29], [87, 173, 187], [136, 144, 207], [114, 189, 158], [170, 146, 195]] as const
export const MOTION_CAPTCHA_DOT_SIZE = 2.5, MOTION_CAPTCHA_CANVAS = 320
export const SPARK_START = { x: 24, y: 128 }, SPARK_GOAL = { x: 232, y: 128 }
export const SPARK_GOAL_RADIUS = 9, SPARK_SIZE = 10
export const SPARK_SAMPLE_MS = 100, SPARK_MAX_SAMPLES = 256, SPARK_MAX_SAMPLE_GAP = 250
export const SPARK_MIN_TIME = 4000, SPARK_MAX_TIME = 25500, SPARK_MAX_SPEED = 64, SPARK_PLAY_SPEED = 40
/** How long a started challenge stays open */
export const VERIFICATION_SOLVE_TTL = 90000
export type SparkSample = { x: number, y: number, t: number }
export function isSparkPath(value: unknown): value is SparkSample[] {
    return Array.isArray(value) && value.length >= 2 && value.length <= SPARK_MAX_SAMPLES && value.every(point =>
        point !== null && typeof point === "object" && Object.keys(point).length === 3 &&
        Number.isFinite(point.x) && point.x >= 0 && point.x < MOTION_CAPTCHA_GRID &&
        Number.isFinite(point.y) && point.y >= 0 && point.y < MOTION_CAPTCHA_GRID &&
        Number.isInteger(point.t) && point.t >= 0 && point.t <= SPARK_MAX_TIME)
}

export type MotionPoint = { x: number, y: number, color: number }
/** Version 1: a version byte, the frame count, the frame rate and the grid size less one, then per frame a little-endian point count and x, y, color bytes */
export function encodeMotionFrames(frames: readonly (readonly MotionPoint[])[], fps: number): string {
    if (!Number.isInteger(fps) || fps < 1 || fps > 255) throw new Error("Invalid motion frame rate")
    if (frames.length < 1 || frames.length > 255) throw new Error("Invalid motion frame count")
    const bytes = new Uint8Array(4 + frames.reduce((sum, frame) => sum + 2 + frame.length * 3, 0))
    bytes.set([1, frames.length, fps, MOTION_CAPTCHA_GRID - 1])
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
