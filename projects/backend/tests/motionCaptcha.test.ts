import assert from "node:assert/strict"
import { test } from "node:test"
import { createMotionCaptcha, createMotionFrames, motionChallenge, motionRandom, motionAnswer, sparkRoute, sparkPathValid, motionFlashPeaks, rasterizeMotionFrame, MOTION_CAPTCHA_FLASH_GUARD, MOTION_CAPTCHA_ZOOM_STEPS, MOTION_CAPTCHA_DOTS, SPARK_ROUTE_TOLERANCE } from "../convex/motionCaptcha.ts"
import { encodeMotionFrames, decodeMotionFrames, isSparkPath, SPARK_MAX_SAMPLES, SPARK_START, SPARK_GOAL, SPARK_MAX_SPEED, MOTION_CAPTCHA_RGB } from "@neonflux/contracts/motion-captcha"

const seed = "0123456789abcdef0123456789abcdef"
const trace = (duration = 10000) => { const route = sparkRoute(seed); return Array.from({ length: 101 }, (_, i) => ({ x: 24 + 208 * i / 100, y: route(24 + 208 * i / 100), t: i * duration / 100 })) }
const valid = trace()
const state = { status: "started", attempts: 0, startedAt: 0, solveExpiresAt: 90000, motionSeed: seed }

test("a sampled route passes, including small input error inside the corridor", () => {
    assert.ok(sparkPathValid(seed, valid, 10000))
    assert.ok(sparkPathValid(seed, valid.map((p, i) => ({ ...p, y: p.y + (i > 0 && i < 100 ? 3 : 0) })), 10000))
    assert.deepEqual(motionAnswer(state, valid, 10000), { status: "solved", attempts: 1 })
})
test("paths that leave the route, skip ahead or end outside the goal fail", () => {
    const offRoute = valid.map((p, i) => ({ ...p, y: p.y + 25 * Math.sin(Math.PI * i / 100) ** 2 }))
    assert.ok(offRoute.slice(1).every((p, i) => Math.hypot(p.x - offRoute[i]!.x, p.y - offRoute[i]!.y) <= SPARK_MAX_SPEED * 0.1))
    assert.equal(sparkPathValid(seed, offRoute, 10000), false)
    assert.equal(sparkPathValid(seed, valid.filter((_, i) => i < 30 || i > 65), 10000), false)
    assert.equal(sparkPathValid(seed, valid.slice(0, -10), 10000), false)
    const route = sparkRoute(seed), lateStart = Array.from({ length: 101 }, (_, i) => ({ x: 64 + 168 * i / 100, y: route(64 + 168 * i / 100), t: i * 100 }))
    assert.equal(sparkPathValid(seed, lateStart, 10000), false)
})
test("paths that move too fast, finish too quickly or exceed the size or timing bounds fail", () => {
    assert.equal(sparkPathValid(seed, trace(3000), 10000), false)
    const fast = valid.map(p => ({ ...p })); fast[51]!.t = fast[50]!.t + 1
    assert.equal(sparkPathValid(seed, fast, 10000), false)
    const route = sparkRoute(seed), oversized = Array.from({ length: SPARK_MAX_SAMPLES + 1 }, (_, i) => ({ x: 24 + 208 * i / SPARK_MAX_SAMPLES, y: route(24 + 208 * i / SPARK_MAX_SAMPLES), t: i * 50 }))
    assert.equal(sparkPathValid(seed, oversized, 12800), false)
    assert.equal(sparkPathValid(seed, trace(26000), 90000), false)
    assert.equal(sparkPathValid(seed, valid, 9999), false)
    assert.equal(sparkPathValid(seed, valid.map(p => ({ ...p, t: p.t + 1 })), 10001), false)
    assert.equal(sparkPathValid(seed, valid.map((p, i) => i === 51 ? { ...p, t: valid[50]!.t } : p), 10000), false)
})
test("interpolated segments are checked, so samples cannot bridge a bend", () => {
    let rejected = false
    for (const side of [1, -1]) {
        const route = sparkRoute(seed)
        const path = Array.from({ length: 27 }, (_, i) => ({ x: 24 + i * 8, y: route(24 + i * 8) + (i > 0 && i < 26 ? side * (SPARK_ROUTE_TOLERANCE - 0.05) : 0), t: i * 250 }))
        assert.ok(path.slice(1).every((p, i) => Math.hypot(p.x - path[i]!.x, p.y - path[i]!.y) <= SPARK_MAX_SPEED * 0.25))
        if (!sparkPathValid(seed, path, 6500)) rejected = true
    }
    assert.ok(rejected, "A chord that exits the tolerance must be rejected even when its sampled endpoints are inside")
})
test("minimum human time rejects an otherwise valid speed-limited trace", () => {
    let shortSeed = "", points: Array<{ x: number, y: number, distance: number }> = []
    for (let index = 1; index <= 64 && !shortSeed; index++) {
        const candidate = index.toString(16).padStart(32, "0"), route = sparkRoute(candidate)
        const curve = Array.from({ length: 209 }, (_, x) => ({ x: x + 24, y: route(x + 24), distance: 0 }))
        for (let i = 1; i < curve.length; i++) curve[i]!.distance = curve[i - 1]!.distance + Math.hypot(curve[i]!.x - curve[i - 1]!.x, curve[i]!.y - curve[i - 1]!.y)
        if (curve[208]!.distance < 245) { shortSeed = candidate; points = curve }
    }
    assert.ok(shortSeed)
    const path = Array.from({ length: 40 }, (_, i) => {
        const distance = points[208]!.distance * i / 39, end = points.findIndex(p => p.distance >= distance), b = points[Math.max(1, end)]!, a = points[Math.max(1, end) - 1]!, fraction = (distance - a.distance) / (b.distance - a.distance)
        return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, t: i * 100 }
    })
    assert.ok(path.slice(1).every((p, i) => Math.hypot(p.x - path[i]!.x, p.y - path[i]!.y) <= SPARK_MAX_SPEED * 0.1))
    assert.equal(sparkPathValid(shortSeed, path, 10000), false)
    assert.equal(sparkPathValid(shortSeed, path.map(p => ({ ...p, t: Math.round(p.t * 1.1) })), 10000), true)
})
test("two failed paths exhaust attempts and the exact server deadline expires", () => {
    const first = motionAnswer(state, [], 10000)
    assert.deepEqual(first, { status: "started", attempts: 1 })
    assert.deepEqual(motionAnswer({ ...state, ...first }, [], 10000), { status: "failed", attempts: 2 })
    assert.deepEqual(motionAnswer(state, valid, 90000), { status: "expired", attempts: 0 })
    for (const status of ["issued", "solved", "expired", "failed", "redeemed"]) assert.throws(() => motionAnswer({ ...state, status }, valid, 10000))
})
test("frame and path contracts reject malformed values and round trip public points", () => {
    const frames = [[{ x: 10, y: 20, color: 0 }], [{ x: 255, y: 0, color: 3 }]]
    assert.deepEqual(decodeMotionFrames(encodeMotionFrames(frames, 30)).frames, frames)
    for (const payload of ["", "%%%", Buffer.from([1, 1, 0, 255]).toString("base64"), encodeMotionFrames(frames, 30).slice(0, -4)]) assert.throws(() => decodeMotionFrames(payload))
    assert.ok(isSparkPath(valid))
    for (const path of [null, [], [{ x: 24, y: 128, t: 0 }], valid.map(p => ({ ...p, private: 1 })), valid.map(p => ({ ...p, x: NaN })), valid.map(p => ({ ...p, t: 0.5 }))]) assert.equal(isSparkPath(path), false)
})
test("the private seed alone regenerates frames, route and fixed endpoints", () => {
    const captcha = createMotionCaptcha(motionRandom(seed))
    assert.deepEqual(Object.keys(captcha), ["motionSeed"])
    assert.match(captcha.motionSeed, /^[0-9a-f]{32}$/)
    const challenge = motionChallenge(captcha.motionSeed)
    assert.deepEqual(Object.keys(challenge), ["motionFrames"])
    assert.deepEqual(motionChallenge(captcha.motionSeed), challenge)
    const motion = decodeMotionFrames(challenge.motionFrames)
    assert.equal(motion.fps, 30); assert.equal(motion.frameCount, 240); assert.equal(motion.grid, 256)
    assert.ok(motion.frames.every(frame => frame.length === MOTION_CAPTCHA_DOTS))
    assert.ok(challenge.motionFrames.length < 400000)
    const route = sparkRoute(captcha.motionSeed)
    assert.equal(route(SPARK_START.x), SPARK_START.y); assert.equal(route(SPARK_GOAL.x), SPARK_GOAL.y)
    for (const value of [-1, 1, NaN, Infinity]) assert.throws(() => createMotionCaptcha(() => value))
    assert.throws(() => motionRandom("bad"))
    assert.ok(valid.slice(1).every((p, i) => Math.hypot(p.x - valid[i]!.x, p.y - valid[i]!.y) <= SPARK_MAX_SPEED * 0.1))
})
test("photosensitivity guard covers all zoom steps and reserves two spark footprints", () => {
    const frames = decodeMotionFrames(motionChallenge(seed).motionFrames).frames, peaks = motionFlashPeaks(frames)
    assert.ok(peaks.every((peak, i) => peak <= MOTION_CAPTCHA_FLASH_GUARD[i]!.budget))
    for (const step of MOTION_CAPTCHA_ZOOM_STEPS) {
        const guard = MOTION_CAPTCHA_FLASH_GUARD.find(g => g.columns >= step.columns && g.rows >= step.rows && g.budget <= step.budget)
        assert.ok(guard, 'Uncovered zoom ' + step.zoom)
        assert.ok(step.budget * step.size ** 2 + 2 * (10 * 1.25 * step.zoom + 2) ** 2 <= 0.25 * 341 * 256)
    }
    const linear = (value: number) => (value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4)
    for (const [r, g, b] of MOTION_CAPTCHA_RGB) assert.ok(linear(r) / (linear(r) + linear(g) + linear(b)) < 0.8)
    const clustered = Array.from({ length: 2 }, () => Array.from({ length: MOTION_CAPTCHA_DOTS }, () => ({ x: 128, y: 128, color: 0 })))
    assert.ok(motionFlashPeaks(clustered).some((peak, i) => peak > MOTION_CAPTCHA_FLASH_GUARD[i]!.budget))
    assert.equal(rasterizeMotionFrame([{ x: 100, y: 100, color: 0 }], 1.25).pixels.filter(Boolean).length, 9)
    const raw = createMotionFrames(sparkRoute(seed), motionRandom(seed))
    assert.equal(raw.length, 240)
})
