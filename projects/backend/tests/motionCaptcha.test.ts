import assert from "node:assert/strict"
import { test } from "node:test"
import { inflateSync } from "node:zlib"
import { createMotionCaptcha, createMotionFrames, createMotionRound, decodeMotionFrames, motionAnswer, encodeMotionFrames, motionFlashPeaks, motionMask, motionRandom, motionRound, rasterizeMotionFrame, MOTION_CAPTCHA_AREA, MOTION_CAPTCHA_DOT_SIZE, MOTION_CAPTCHA_DOTS, MOTION_CAPTCHA_FLASH_GUARD, MOTION_CAPTCHA_FPS, MOTION_CAPTCHA_FRAME_COUNT, MOTION_CAPTCHA_GRID, MOTION_CAPTCHA_LIFETIME, MOTION_CAPTCHA_PALETTE, MOTION_CAPTCHA_SPEED, MOTION_CAPTCHA_SYMBOLS, MOTION_CAPTCHA_ZOOM_STEPS, type MotionPoint } from "../convex/motionCaptcha.ts"

const random = (initial: number) => { let seed = initial; return () => { seed = seed * 16807 % 2147483647; return seed / 2147483647 } }
const grid = MOTION_CAPTCHA_GRID, count = MOTION_CAPTCHA_FRAME_COUNT
const cell = (x: number, y: number) => ((y % grid + grid) % grid) * grid + (x % grid + grid) % grid
const occupancy = (frame: readonly MotionPoint[]) => { const cells = new Uint8Array(grid * grid); for (const { x, y } of frame) cells[cell(x, y)] = 1; return cells }
const area = (mask: Uint8Array) => mask.reduce((sum, value) => sum + value, 0) / mask.length
// Mean block occupancy over 16-unit blocks, the coarse scale at which moving dots resolve a silhouette.
const blocks = (mask: Uint8Array) => { const result = new Float64Array(256); mask.forEach((value, index) => { result[(index >> 12) * 16 + (index % grid >> 4)]! += value / 256 }); return result }
// Points of a later frame found at a vertical offset of the earlier frame, split by mask side.
const continued = (before: Uint8Array, after: readonly MotionPoint[], mask: Uint8Array, inside: number, outside: number) =>
    after.filter(({ x, y }) => before[cell(x, y - (mask[cell(x, y)] ? inside : outside))]).length
// Cells whose vertical step of one SPEED crosses the mask boundary, along horizontal edges.
const crossing = (mask: Uint8Array) => mask.map((value, index) => Number(value !== mask[cell(index % grid, (index >> 8) + MOTION_CAPTCHA_SPEED)]))
// WCAG 2.2 relative luminance of each raster index, and the conservative transition area: every pixel whose relative
// luminance changes by 0.1 or more, with the darker state below 0.8, counts as flashing, without pairing changes into flashes.
const linear = (value: number) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const colors = Array.from({ length: MOTION_CAPTCHA_PALETTE.length / 3 }, (_, index) => MOTION_CAPTCHA_PALETTE.slice(index * 3, index * 3 + 3))
const luminance = colors.map(([r, g, b]) => 0.2126 * linear(r!) + 0.7152 * linear(g!) + 0.0722 * linear(b!))
const changed = (before: Uint8Array, after: Uint8Array) => before.map((value, index) => { const a = luminance[value]!, b = luminance[after[index]!]!; return Number(Math.abs(a - b) >= 0.1 && Math.min(a, b) < 0.8) })
// Largest changing share of a field anywhere over the canvas. The page around the canvas never changes.
const share = (flags: Uint8Array, width: number, fieldWidth: number, fieldHeight: number) => {
    const integral = new Float64Array((width + 1) ** 2), w = Math.min(fieldWidth, width), h = Math.min(fieldHeight, width)
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) integral[(y + 1) * (width + 1) + x + 1] = flags[y * width + x]! + integral[y * (width + 1) + x + 1]! + integral[(y + 1) * (width + 1) + x]! - integral[y * (width + 1) + x]!
    let worst = 0
    for (let y = 0; y + h <= width; y++) for (let x = 0; x + w <= width; x++) worst = Math.max(worst, integral[(y + h) * (width + 1) + x + w]! - integral[y * (width + 1) + x + w]! - integral[(y + h) * (width + 1) + x]! + integral[y * (width + 1) + x]!)
    return worst / (fieldWidth * fieldHeight)
}
// Positive control: the rejected design, two uniform fields each hidden outside its own side of the mask.
const clipped = (mask: Uint8Array, direction: 1 | -1, next: () => number) => {
    const frames: MotionPoint[][] = Array.from({ length: count }, () => [])
    for (const field of [1, -1]) for (let dot = 0; dot < MOTION_CAPTCHA_DOTS; dot++) {
        const phase = Math.floor(next() * MOTION_CAPTCHA_LIFETIME)
        for (let start = phase; start < phase + count; start += MOTION_CAPTCHA_LIFETIME) {
            const x = Math.floor(next() * grid), y = next() * grid
            for (let age = 0; age < MOTION_CAPTCHA_LIFETIME; age++) {
                const row = Math.floor(((y + age * field * direction * MOTION_CAPTCHA_SPEED) % grid + grid) % grid)
                if (mask[row * grid + x] === (field === 1 ? 1 : 0)) frames[(start + age) % count]!.push({ x, y: row, color: 0 })
            }
        }
    }
    return frames
}

test("motion rounds emit bounded decodable frames and labeled choices with private answers", () => {
    const payloads = new Set<string>(), answers = new Set<number>()
    for (let seed = 1; seed <= 12; seed++) {
        const round = createMotionRound(random(seed))
        assert.deepEqual(Object.keys(round).sort(), ["answerIndex", "choices", "imageDataUri", "motionFrames"])
        assert.ok(Number.isInteger(round.answerIndex) && round.answerIndex >= 0 && round.answerIndex < 6)
        assert.equal(new Set(round.choices).size, 6)
        assert.ok(round.choices.every(symbol => Number.isInteger(symbol) && symbol >= 0 && symbol < MOTION_CAPTCHA_SYMBOLS.length))
        answers.add(round.answerIndex); payloads.add(round.motionFrames)
        assert.ok(round.motionFrames.length <= Math.ceil((4 + count * (2 + 3 * 1.1 * MOTION_CAPTCHA_DOTS)) / 3) * 4, `${round.motionFrames.length} base64 characters`)
        assert.deepEqual([...Buffer.from(round.motionFrames, "base64").subarray(0, 4)], [1, 60, 30, 255])
        const decoded = decodeMotionFrames(round.motionFrames)
        assert.equal(decoded.fps, MOTION_CAPTCHA_FPS); assert.equal(decoded.frameCount, count); assert.equal(decoded.grid, grid)
        assert.equal(decoded.frames.length, count)
        for (const frame of decoded.frames) assert.ok(Math.abs(frame.length - MOTION_CAPTCHA_DOTS) < 120)
        // Each card shows its symbol's mask at answer position, sampled over an 84-pixel square under the label.
        const image = Buffer.from(round.imageDataUri.slice("data:image/png;base64,".length), "base64")
        assert.ok(round.imageDataUri.startsWith("data:image/png;base64,")); assert.equal(image.subarray(1, 4).toString(), "PNG")
        assert.equal(image.readUInt32BE(16), 320); assert.equal(image.readUInt32BE(20), 232)
        let raw: Buffer | undefined
        for (let offset = 8; offset < image.length;) {
            const length = image.readUInt32BE(offset)
            if (image.subarray(offset + 4, offset + 8).toString() === "IDAT") raw = inflateSync(image.subarray(offset + 8, offset + 8 + length))
            offset += length + 12
        }
        assert.equal(raw?.length, 81 * 232)
        const pixel = (x: number, y: number) => raw![y * 81 + 1 + (x >> 2)]! >> 6 - x % 4 * 2 & 3
        const masks = MOTION_CAPTCHA_SYMBOLS.map((_, symbol) => motionMask(symbol))
        for (let index = 0; index < 6; index++) {
            const left = 8 + index % 3 * 104, top = 8 + Math.floor(index / 3) * 112
            assert.equal(pixel(left, top), 2); assert.equal(pixel(left + 48, top + 2), 1)
            const agreement = masks.map(mask => {
                let same = 0, total = 0
                for (let y = 0; y < 84; y++) for (let x = 0; x < 84; x++) {
                    total++; if ((pixel(left + 6 + x, top + 18 + y) === 3) === (mask[Math.floor((y + 0.5) * grid / 84) * grid + Math.floor((x + 0.5) * grid / 84)] === 1)) same++
                }
                return same / total
            })
            const best = agreement.indexOf(Math.max(...agreement))
            assert.equal(best, round.choices[index]); assert.equal(agreement[best], 1)
        }
    }
    assert.equal(payloads.size, 12); assert.ok(answers.size >= 4)
    for (const value of [-1, 1, NaN, Infinity]) {
        assert.throws(() => createMotionRound(() => value), /Invalid server randomness/); assert.throws(() => createMotionCaptcha(() => value), /Invalid server randomness/)
    }
})

test("stored motion state is a small private seed whose rounds regenerate exactly and match the answers", () => {
    const seeds = new Set<string>()
    for (let seed = 1; seed <= 8; seed++) {
        const challenge = createMotionCaptcha(random(8200 + seed))
        assert.deepEqual(Object.keys(challenge).sort(), ["motionSeed", "pathAnswers", "pathRound", "pathSelections"])
        assert.equal(challenge.pathRound, 0); assert.deepEqual(challenge.pathSelections, [])
        assert.match(challenge.motionSeed, /^[0-9a-f]{32}$/); seeds.add(challenge.motionSeed)
        assert.ok(JSON.stringify(challenge).length < 200)
        const rounds = [0, 1].map(round => motionRound(challenge.motionSeed, round))
        assert.deepEqual(rounds.map(round => round.answerIndex), challenge.pathAnswers)
        assert.deepEqual(motionRound(challenge.motionSeed, 0), rounds[0]); assert.deepEqual(createMotionRound(motionRandom(challenge.motionSeed, 1)), rounds[1])
        assert.notEqual(rounds[0]!.motionFrames, rounds[1]!.motionFrames)
        for (const round of rounds) assert.equal(round.motionFrames.includes(challenge.motionSeed) || round.imageDataUri.includes(challenge.motionSeed), false)
    }
    assert.equal(seeds.size, 8)
    const fixed = motionRandom("0123456789abcdef0123456789abcdef", 0), draws = Array.from({ length: 4 }, fixed)
    assert.ok(draws.every(value => value >= 0 && value < 1)); assert.equal(new Set(draws).size, 4)
    assert.notDeepEqual(Array.from({ length: 4 }, motionRandom("0123456789abcdef0123456789abcdef", 1)), draws)
    for (const [seed, round] of [["0123", 0], ["0123456789ABCDEF0123456789ABCDEF", 0], ["0123456789abcdef0123456789abcdef0", 0], ["0123456789abcdef0123456789abcdeg", 0], ["0123456789abcdef0123456789abcdef", -1], ["0123456789abcdef0123456789abcdef", 0.5]] as const) {
        assert.throws(() => motionRandom(seed, round), /Invalid motion seed/)
    }
})

test("symbols share one mask area inside the grid, keep the crescent bold and stay coarsely distinct", () => {
    const masks = MOTION_CAPTCHA_SYMBOLS.map((_, symbol) => motionMask(symbol))
    for (const [symbol, mask] of masks.entries()) {
        assert.ok(Math.abs(area(mask) - MOTION_CAPTCHA_AREA) < 0.002, `${MOTION_CAPTCHA_SYMBOLS[symbol]} area ${area(mask)}`)
        let margin = grid
        mask.forEach((value, index) => { if (value) margin = Math.min(margin, index % grid, index >> 8, grid - 1 - index % grid, grid - 1 - (index >> 8)) })
        assert.ok(margin >= 16, `${MOTION_CAPTCHA_SYMBOLS[symbol]} margin ${margin}`)
    }
    // Opening with a disc a twelfth of the grid wide removes any thinner part of the crescent.
    const radius = Math.floor(grid / 24), disc: number[][] = []
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= radius * radius) disc.push([dx, dy])
    const morph = (mask: Uint8Array, erode: boolean) => mask.map((_, index) => {
        const x = index % grid, y = index >> 8
        return Number(erode === disc.every(([dx, dy]) => { const u = x + dx!, w = y + dy!; return (u >= 0 && w >= 0 && u < grid && w < grid ? mask[w * grid + u]! : 0) === Number(erode) }))
    })
    const moon = masks[MOTION_CAPTCHA_SYMBOLS.indexOf("moon")]!, opened = morph(morph(moon, true), false)
    assert.ok(area(opened) / area(moon) > 0.99, `crescent opening keeps ${area(opened) / area(moon)}`)
    const coarse = masks.map(blocks)
    for (let i = 0; i < coarse.length; i++) for (let j = i + 1; j < coarse.length; j++) {
        let overlap = 0, union = 0
        for (let index = 0; index < 256; index++) { overlap += Math.min(coarse[i]![index]!, coarse[j]![index]!); union += Math.max(coarse[i]![index]!, coarse[j]![index]!) }
        assert.ok(overlap / union < 0.78, `${MOTION_CAPTCHA_SYMBOLS[i]} and ${MOTION_CAPTCHA_SYMBOLS[j]} coarse overlap ${overlap / union}`)
    }
})

test("every frame shows every dot, so visible counts never depend on the symbol", () => {
    for (let symbol = 0; symbol < MOTION_CAPTCHA_SYMBOLS.length; symbol++) for (const direction of [1, -1] as const) {
        for (const frame of createMotionFrames(motionMask(symbol), direction, random(300 + symbol * 2 + (direction + 1) / 2))) assert.equal(frame.length, MOTION_CAPTCHA_DOTS)
    }
})

test("frame averages keep density and vertical continuity at horizontal edges, unlike a clipped field", () => {
    const ratios = (make: (mask: Uint8Array, direction: 1 | -1, next: () => number) => MotionPoint[][], k: number) => {
        let bandSum = 0, bandCells = 0, restSum = 0, restCells = 0, bandPairs = 0, restPairs = 0
        for (const [symbol, seed] of [[0, 1], [1, 2], [3, 3], [6, 4], [8, 5], [9, 6]] as const) for (let round = 0; round < 3; round++) {
            const mask = motionMask(symbol), band = crossing(mask), frames = make(mask, (seed + round) % 2 ? 1 : -1, random(700 + seed * 31 + round * 7 + k))
            for (let start = 0; start + k <= count; start += k) {
                const counts = new Float64Array(grid * grid)
                for (let frame = start; frame < start + k; frame++) for (const { x, y } of frames[frame]!) counts[y * grid + x]! += 1
                for (let index = 0; index < grid * grid; index++) {
                    const value = counts[index]!, pair = value * counts[(index + MOTION_CAPTCHA_SPEED * grid) % (grid * grid)]!
                    if (band[index]) { bandSum += value; bandCells++; bandPairs += pair } else { restSum += value; restCells++; restPairs += pair }
                }
            }
        }
        return { density: bandSum / bandCells / (restSum / restCells), continuity: bandPairs / bandCells / (restPairs / restCells) }
    }
    for (const k of [2, 3, 4, count]) {
        const real = ratios(createMotionFrames, k), control = ratios(clipped, k)
        assert.ok(Math.abs(real.density - 1) < 0.05, `${k}-frame edge density ${real.density}`)
        assert.ok(Math.abs(real.continuity - 1) < 0.08, `${k}-frame edge continuity ${real.continuity}`)
        assert.ok(control.continuity < 0.85, `clipped ${k}-frame edge continuity ${control.continuity}`)
    }
})

test("a four-frame long exposure stays at chance against the choices, though it exposes a clipped field", () => {
    const bands = MOTION_CAPTCHA_SYMBOLS.map((_, symbol) => crossing(motionMask(symbol)))
    // The reviewer-style attack: average four rendered frames, then pick the choice whose horizontal edges break vertical streaks.
    const attack = (frames: readonly MotionPoint[][], choices: readonly number[], start: number) => {
        const exposure = new Float64Array(grid * grid)
        for (let frame = start; frame < start + 4; frame++) rasterizeMotionFrame(frames[frame % count]!, 1).pixels.forEach((value, index) => { if (value) exposure[index]! += 1 })
        const scores = choices.map(symbol => {
            let sum = 0, cells = 0
            for (let index = 0; index < grid * grid; index++) if (bands[symbol]![index]) { sum += exposure[index]! * exposure[(index + MOTION_CAPTCHA_SPEED * grid) % (grid * grid)]!; cells++ }
            return -sum / cells
        })
        return scores.indexOf(Math.max(...scores))
    }
    let real = 0, control = 0
    for (let seed = 1; seed <= 30; seed++) {
        const round = createMotionRound(random(500 + seed)), target = motionMask(round.choices[round.answerIndex]!)
        if (attack(decodeMotionFrames(round.motionFrames).frames, round.choices, seed % count) === round.answerIndex) real++
        if (attack(clipped(target, seed % 2 ? 1 : -1, random(900 + seed)), round.choices, seed % count) === round.answerIndex) control++
    }
    // Chance is five of thirty.
    assert.ok(real <= 10, `attack recovered ${real} of 30 rounds`)
    assert.ok(control >= 18, `positive control recovered only ${control} of 30 clipped rounds`)
})

test("every motion frame is a uniform field whose mask occupancy matches area for every symbol", () => {
    const means: number[] = [], sided = Array.from({ length: 4 * MOTION_CAPTCHA_LIFETIME }, () => ({ hits: 0, expected: 0 }))
    for (let symbol = 0; symbol < MOTION_CAPTCHA_SYMBOLS.length; symbol++) {
        const mask = motionMask(symbol), p = area(mask), direction = symbol % 2 ? 1 : -1, frames = createMotionFrames(mask, direction, random(100 + symbol))
        // Cells within four units of the silhouette edge, where boundary artifacts would accumulate.
        const band = new Uint8Array(grid * grid)
        for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
            for (let dy = -4; dy <= 4 && !band[y * grid + x]; dy++) for (let dx = -4; dx <= 4; dx++) if (mask[cell(x + dx, y + dy)] !== mask[y * grid + x]) { band[y * grid + x] = 1; break }
        }
        const bandInside = mask.reduce((sum, value, index) => sum + (value & band[index]!), 0) / mask.length, bandOutside = area(band) - bandInside
        let total = 0, inside = 0, edgeInside = 0, edgeOutside = 0
        for (const frame of frames) {
            const k = frame.filter(({ x, y }) => mask[cell(x, y)]).length
            // A single frame's inside fraction stays within about five standard errors of the area.
            assert.ok(Math.abs(k / frame.length - p) < 5 * Math.sqrt(p * (1 - p) / frame.length), `${MOTION_CAPTCHA_SYMBOLS[symbol]} frame ${k}/${frame.length}`)
            total += frame.length; inside += k
            for (const { x, y } of frame) if (band[cell(x, y)]) { if (mask[cell(x, y)]) edgeInside++; else edgeOutside++ }
        }
        assert.ok(Math.abs(inside / total - p) < 0.015, `${MOTION_CAPTCHA_SYMBOLS[symbol]} ${inside / total} vs ${p}`)
        assert.ok(Math.abs(edgeInside / total / bandInside - 1) < 0.15, `${MOTION_CAPTCHA_SYMBOLS[symbol]} inside edge density`)
        assert.ok(Math.abs(edgeOutside / total / bandOutside - 1) < 0.15, `${MOTION_CAPTCHA_SYMBOLS[symbol]} outside edge density`)
        means.push(total / count)
        // Each side of a horizontal edge, one step ahead of or behind the motion, per frame phase.
        for (const [ahead, offset] of [1, -1].entries()) for (const side of [0, 1]) {
            const shift = (offset * direction * MOTION_CAPTCHA_SPEED * grid + grid * grid) % (grid * grid)
            const near = (index: number) => mask[index] === side && mask[(index + shift) % (grid * grid)] !== side
            let cells = 0
            for (let index = 0; index < grid * grid; index++) if (near(index)) cells++
            for (const [index, frame] of frames.entries()) {
                const slot = sided[(index % MOTION_CAPTCHA_LIFETIME) * 4 + ahead * 2 + side]!
                slot.expected += frame.length * cells / grid / grid
                for (const { x, y } of frame) if (near(y * grid + x)) slot.hits++
            }
        }
        // The rendered screenshot has the same colored-pixel density inside and outside the silhouette.
        let paintedInside = 0, paintedOutside = 0
        for (let frame = 0; frame < count; frame += MOTION_CAPTCHA_LIFETIME) rasterizeMotionFrame(frames[frame]!, 1).pixels.forEach((value, index) => { if (value) { if (mask[index]) paintedInside++; else paintedOutside++ } })
        const ratio = paintedInside / p / (paintedOutside / (1 - p))
        assert.ok(ratio > 0.9 && ratio < 1.1, `${MOTION_CAPTCHA_SYMBOLS[symbol]} pixel density ratio ${ratio}`)
    }
    for (const mean of means) assert.ok(Math.abs(mean - MOTION_CAPTCHA_DOTS) < 20, `mean visible points ${mean}`)
    for (const [index, { hits, expected }] of sided.entries()) assert.ok(Math.abs(hits / expected - 1) < 0.15, `one-sided edge density ${index}: ${hits / expected}`)
})

test("frames a lifetime apart are independent while consecutive frames carry signed motion that recovers the symbol", () => {
    for (const [symbol, direction, seed] of [[0, 1, 11], [3, -1, 12], [6, 1, 13], [7, -1, 14], [9, 1, 15]] as const) {
        const mask = motionMask(symbol), frames = createMotionFrames(mask, direction, random(seed)), cells = frames.map(occupancy)
        const correlation = (a: Uint8Array, b: Uint8Array, shift: number) => {
            let ab = 0, sa = 0, sb = 0
            for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) { const u = a[y * grid + x]!, w = b[cell(x, y + shift)]!; ab += u * w; sa += u; sb += w }
            const n = grid * grid, ma = sa / n, mb = sb / n
            return (ab / n - ma * mb) / Math.sqrt(ma * (1 - ma) * mb * (1 - mb))
        }
        for (let frame = 0; frame < count; frame += 3) {
            const later = cells[(frame + MOTION_CAPTCHA_LIFETIME) % count]!
            for (const shift of [-MOTION_CAPTCHA_LIFETIME * MOTION_CAPTCHA_SPEED, 0, MOTION_CAPTCHA_LIFETIME * MOTION_CAPTCHA_SPEED]) assert.ok(Math.abs(correlation(cells[frame]!, later, shift)) < 0.03)
        }
        for (const shift of [-MOTION_CAPTCHA_SPEED, MOTION_CAPTCHA_SPEED]) assert.ok(correlation(cells[0]!, cells[1]!, shift) > 0.05)
        // Accumulate points that moved down or up by one step between consecutive frames, in 16-unit blocks.
        const score = new Float64Array(256)
        for (let frame = 0; frame < count; frame++) for (const { x, y } of frames[(frame + 1) % count]!) {
            const block = (y >> 4) * 16 + (x >> 4)
            score[block]! += cells[frame]![cell(x, y - MOTION_CAPTCHA_SPEED)]! - cells[frame]![cell(x, y + MOTION_CAPTCHA_SPEED)]!
        }
        const fit = MOTION_CAPTCHA_SYMBOLS.map((_, candidate) => {
            const occupied = blocks(motionMask(candidate))
            const ms = score.reduce((a, b) => a + b) / 256, mb = occupied.reduce((a, b) => a + b) / 256
            let sb = 0, ss = 0, sbs = 0
            for (let index = 0; index < 256; index++) { sbs += (score[index]! - ms) * (occupied[index]! - mb); ss += (score[index]! - ms) ** 2; sb += (occupied[index]! - mb) ** 2 }
            return sbs / Math.sqrt(ss * sb)
        })
        const best = fit.map(Math.abs).indexOf(Math.max(...fit.map(Math.abs)))
        assert.equal(best, symbol, `${MOTION_CAPTCHA_SYMBOLS[symbol]} recovered as ${MOTION_CAPTCHA_SYMBOLS[best]}`)
        assert.ok(fit[symbol]! * direction > 0.8, `${MOTION_CAPTCHA_SYMBOLS[symbol]} signed fit ${fit[symbol]}`)
    }
})

test("the motion loop is seamless and its payload round-trips with strict decoding in shuffled order", () => {
    const mask = motionMask(1), direction = -1, frames = createMotionFrames(mask, direction, random(77)), cells = frames.map(occupancy)
    const inside = direction * MOTION_CAPTCHA_SPEED, outside = -inside
    const steps = frames.map((_, frame) => continued(cells[frame]!, frames[(frame + 1) % count]!, mask, inside, outside) / frames[(frame + 1) % count]!.length)
    const typical = steps.slice(0, -1).reduce((a, b) => a + b) / (count - 1)
    // Each dot continues for all but its last frame, less boundary crossings.
    assert.ok(Math.abs(typical - (1 - 1 / MOTION_CAPTCHA_LIFETIME)) < 0.06, `continuation ${typical}`)
    assert.ok(Math.abs(steps[count - 1]! - typical) < 0.06, `loop continuation ${steps[count - 1]} vs ${typical}`)
    for (let frame = 0; frame < count; frame++) {
        const later = frames[(frame + MOTION_CAPTCHA_LIFETIME) % count]!
        assert.ok(continued(cells[frame]!, later, mask, inside * MOTION_CAPTCHA_LIFETIME, outside * MOTION_CAPTCHA_LIFETIME) / later.length < 0.04)
        // Shuffled order does not link a dot to its next position by array index.
        const linked = frames[frame]!.filter((point, index) => frames[(frame + 1) % count]![index]?.x === point.x).length
        assert.ok(linked < 0.03 * frames[frame]!.length, `frame ${frame} has ${linked} index-linked points`)
    }
    const payload = encodeMotionFrames(frames)
    assert.deepEqual(decodeMotionFrames(payload), { fps: MOTION_CAPTCHA_FPS, frameCount: count, grid, frames })
    const bytes = Buffer.from(payload, "base64"), mutate = (change: (copy: Buffer) => Buffer) => change(Buffer.from(bytes)).toString("base64")
    for (const bad of [mutate(copy => { copy[0] = 2; return copy }), mutate(copy => copy.subarray(0, copy.length - 1)), mutate(copy => Buffer.concat([copy, Buffer.from([0])])),
        mutate(copy => { copy[4 + 2 + 2] = 4; return copy }), mutate(copy => { copy[1] = 0; return copy }), ""]) assert.throws(() => decodeMotionFrames(bad), /Invalid motion frames/)
    for (const point of [{ x: 256, y: 0, color: 0 }, { x: 0, y: -1, color: 0 }, { x: 0, y: 0, color: 4 }, { x: 0.5, y: 0, color: 0 }]) assert.throws(() => encodeMotionFrames([[point]]), /Invalid motion point/)
})

test("motion rasters paint clipped square dots exactly as the canvas draws them", () => {
    assert.equal(MOTION_CAPTCHA_PALETTE.length, 15)
    const single = rasterizeMotionFrame([{ x: 10, y: 20, color: 2 }], 4)
    assert.equal(single.width, 1024); assert.equal(single.height, 1024)
    const painted = [...single.pixels.entries()].filter(([, value]) => value)
    assert.equal(painted.length, 100); assert.ok(painted.every(([index, value]) => value === 3 && index % 1024 >= 37 && index % 1024 < 47 && index >> 10 >= 77 && index >> 10 < 87))
    const edges = rasterizeMotionFrame([{ x: 0, y: 0, color: 0 }, { x: 255, y: 255, color: 3 }], 1.25)
    assert.equal(edges.width, 320)
    assert.equal(edges.pixels.filter(value => value === 1).length, 4); assert.equal(edges.pixels.filter(value => value === 4).length, 4)
    assert.equal(edges.pixels[319 * 320 + 319], 4); assert.equal(edges.pixels[0], 1)
    // Edges snap with Math.round, so half-pixel edges round up exactly as the canvas does.
    const snapped = [...rasterizeMotionFrame([{ x: 10, y: 20, color: 1 }], 2).pixels.entries()].filter(([, value]) => value)
    assert.equal(snapped.length, 25); assert.ok(snapped.every(([index, value]) => value === 2 && index % 512 >= 19 && index % 512 < 24 && index >> 9 >= 39 && index >> 9 < 44))
    for (const scale of [0, -1, NaN, 17]) assert.throws(() => rasterizeMotionFrame([], scale))
})

// Conservative transition-area analysis for WCAG 2.2 success criterion 2.3.1, using its 341 x 256 px estimate of a
// 10-degree field at 1024 x 768.
test("conservative transition-area analysis of rendered frames stays below the WCAG 2.3.1 limits", () => {
    // No state is a saturated red, R / (R + G + B) of 0.8 or more, in encoded or linear terms.
    for (const [r, g, b] of colors) { assert.ok(r! / (r! + g! + b!) < 0.8); assert.ok(linear(r!) / (linear(r!) + linear(g!) + linear(b!)) < 0.8) }
    const worstShare = (rasters: readonly Uint8Array[], width: number, fieldWidth: number, fieldHeight: number, steps: readonly number[]) =>
        Math.max(...rasters.flatMap((raster, frame) => steps.map(step => share(changed(raster, rasters[(frame + step) % count]!), width, fieldWidth, fieldHeight))))
    const rounds = [1, 2].map(seed => decodeMotionFrames(createMotionRound(random(6000 + seed)).motionFrames).frames)
    // The live canvas is 320 CSS px at device pixel ratios 1, 1.5 and 2, across the loop seam and one dropped frame.
    for (const ratio of [1, 1.5, 2]) for (const frames of rounds) {
        const rasters = frames.map(frame => rasterizeMotionFrame(frame, 1.25 * ratio).pixels), width = Math.round(320 * ratio)
        const worst = worstShare(rasters, width, Math.round(341 * ratio), Math.round(256 * ratio), ratio === 1 ? [1, 2] : [1])
        assert.ok(worst < 0.2, `device ratio ${ratio} transition area ${worst}`)
    }
    // At 500% page zoom the field covers 68 x 51 CSS px of a canvas drawn at 6.25 px per unit. Sampled steps include the
    // loop seam, long frame jumps and a reset from a blank canvas.
    const zoomed = (frame: readonly MotionPoint[]) => rasterizeMotionFrame(frame, 6.25).pixels, blank = new Uint8Array(1600 * 1600)
    const pairs = [...[0, 11, 23, 37, 48, 59].map(frame => [frame, (frame + 1) % count]), [0, 30], [7, 52], [-1, 17]] as const
    for (const [from, to] of pairs) {
        const area = share(changed(from < 0 ? blank : zoomed(rounds[0]![from]!), zoomed(rounds[0]![to]!)), 1600, 341, 256)
        assert.ok(area < 0.25, `500% zoom frames ${from} to ${to} transition area ${area}`)
    }
    // The frame-mean luminance stays constant, so the whole field never flickers.
    const rasters = rounds[0]!.map(frame => rasterizeMotionFrame(frame, 1.25).pixels), means = rasters.map(raster => raster.reduce((sum, value) => sum + luminance[value]!, 0) / raster.length)
    for (let frame = 0; frame < count; frame++) assert.ok(Math.abs(means[(frame + 1) % count]! - means[frame]!) < 0.005)
    // The analysis can fail: the same rule with dots twice as wide exceeds the 25% area limit.
    const paint = (frame: readonly MotionPoint[], size: number) => {
        const pixels = new Uint8Array(320 * 320), span = (center: number) => { const start = Math.round((center - size / 2) * 1.25); return [Math.max(0, start), Math.min(320, start + Math.floor(size * 1.25))] as const }
        for (const { x, y, color } of frame) { const [left, right] = span(x + 0.5), [top, bottom] = span(y + 0.5); for (let row = top; row < bottom; row++) pixels.fill(color + 1, row * 320 + left, row * 320 + right) }
        return pixels
    }
    assert.deepEqual(paint(rounds[0]![0]!, MOTION_CAPTCHA_DOT_SIZE), rasters[0])
    assert.ok(worstShare(rounds[0]!.map(frame => paint(frame, 2 * MOTION_CAPTCHA_DOT_SIZE)), 320, 341, 256, [1]) > 0.25)
})

test("the flash guard covers every common browser zoom step with a window at least as large and a budget no larger", () => {
    // Chrome, Firefox and Safari steps from 100% to 500%. A field at an unchecked step between two checked ones, such as 220%
    // between 200% and 240%, spans more cells than the higher step while allowing fewer dots than the lower one.
    for (const percent of [100, 110, 115, 120, 125, 130, 133, 140, 150, 160, 170, 175, 180, 190, 200, 220, 240, 250, 260, 280, 300, 400, 500]) {
        const unit = 1.25 * percent / 100, budget = Math.floor(0.25 * 341 * 256 / (MOTION_CAPTCHA_DOT_SIZE * unit) ** 2)
        const columns = Math.min(grid, Math.ceil(342 / unit + MOTION_CAPTCHA_DOT_SIZE)), rows = Math.min(grid, Math.ceil(257 / unit + MOTION_CAPTCHA_DOT_SIZE))
        assert.ok(MOTION_CAPTCHA_FLASH_GUARD.some(scale => scale.columns >= columns && scale.rows >= rows && scale.budget <= budget), `${percent}% is not bounded`)
    }
})

test("rasterized dots never exceed the flash guard's dot size at fractional device pixel ratios", () => {
    // devicePixelRatio is browser zoom times the display's native ratio. The canvas backing store is round(320 * ratio)
    // device px shown across 320 CSS px, so a dot w device px wide spans w * 320 * zoom / store px of the zoomed page.
    const dots = Array.from({ length: 24 }, (_, index) => ({ x: index * 10 + index % 7, y: 128, color: 0 }))
    for (const { zoom, size } of MOTION_CAPTCHA_ZOOM_STEPS) for (const native of [1, 1.25, 1.5, 1.75]) {
        const store = Math.round(320 * zoom * native), scale = store / grid
        if (scale > 8) continue
        const { width, pixels } = rasterizeMotionFrame(dots, scale), row = Math.floor(128.5 * scale) * width
        let run = 0, widest = 0
        for (let x = 0; x < width; x++) { run = pixels[row + x] ? run + 1 : 0; widest = Math.max(widest, run) }
        assert.ok(widest * 320 * zoom / store <= size + 1e-9, `zoom ${zoom} native ${native}: ${widest} device px against ${size} px`)
    }
})

test("the flash guard bounds every frame pair of every accepted payload at every zoom step", () => {
    // Each step's window reaches every cell a snapped dot can touch, and its budget keeps two frames within 25% of the field.
    for (const { zoom, columns, rows, size, budget } of MOTION_CAPTCHA_ZOOM_STEPS) {
        const unit = 1.25 * zoom
        assert.equal(size, MOTION_CAPTCHA_DOT_SIZE * unit)
        assert.ok(columns >= Math.min(grid, 342 / unit + MOTION_CAPTCHA_DOT_SIZE) && rows >= Math.min(grid, 257 / unit + MOTION_CAPTCHA_DOT_SIZE))
        assert.ok(budget * size ** 2 <= 0.25 * 341 * 256, `${zoom}: ${budget} dots of ${size} px`)
    }
    // Independent brute force over every zoom step: the two busiest frames of every exact window, never wrapping.
    const peaks = (frames: readonly (readonly MotionPoint[])[]) => {
        const table = new Int32Array((grid + 1) ** 2), steps = MOTION_CAPTCHA_ZOOM_STEPS.map(({ columns, rows }) => ({ columns, rows, across: grid - columns + 1, first: new Int32Array((grid - columns + 1) * (grid - rows + 1)), second: new Int32Array((grid - columns + 1) * (grid - rows + 1)) }))
        for (const frame of frames) {
            table.fill(0)
            for (const { x, y } of frame) table[(y + 1) * (grid + 1) + x + 1]! += 1
            for (let y = 1; y <= grid; y++) for (let x = 1; x <= grid; x++) table[y * (grid + 1) + x]! += table[(y - 1) * (grid + 1) + x]! + table[y * (grid + 1) + x - 1]! - table[(y - 1) * (grid + 1) + x - 1]!
            for (const { columns, rows, across, first, second } of steps) for (let index = 0; index < first.length; index++) {
                const x = index % across, y = (index - x) / across
                const inside = table[(y + rows) * (grid + 1) + x + columns]! - table[y * (grid + 1) + x + columns]! - table[(y + rows) * (grid + 1) + x]! + table[y * (grid + 1) + x]!
                if (inside > first[index]!) { second[index] = first[index]!; first[index] = inside } else if (inside > second[index]!) second[index] = inside
            }
        }
        return steps.map(({ first, second }) => first.reduce((worst, value, index) => Math.max(worst, value + second[index]!), 0))
    }
    const budgets = MOTION_CAPTCHA_ZOOM_STEPS.map(step => step.budget), guarded = MOTION_CAPTCHA_FLASH_GUARD.map(scale => MOTION_CAPTCHA_ZOOM_STEPS.findIndex(step => step.zoom === scale.zoom))
    const seeds = random(9100)
    for (let index = 0; index < 20; index++) {
        const seed = Array.from({ length: 4 }, () => Math.floor(seeds() * 2 ** 32).toString(16).padStart(8, "0")).join("")
        const frames = decodeMotionFrames(motionRound(seed, index % 2).motionFrames).frames, exact = peaks(frames), scanned = motionFlashPeaks(frames)
        exact.forEach((peak, step) => assert.ok(peak <= budgets[step]!, `seed ${seed} zoom ${MOTION_CAPTCHA_ZOOM_STEPS[step]!.zoom} pair count ${peak}`))
        // Scanned peaks are exact at stride 1 and upper bounds otherwise.
        guarded.forEach((step, scale) => MOTION_CAPTCHA_FLASH_GUARD[scale]!.stride === 1 ? assert.equal(scanned[scale], exact[step]) : assert.ok(scanned[scale]! >= exact[step]!))
    }
    // Regression: frames 0 and 2 fill the outer lattice rings of one 400% field, everything else lies far away. Each frame
    // keeps every 500% window at 42 dots or fewer, so the 500% check alone passed, yet jumping from frame 0 to 2 changes over
    // 25% of the 400% field on a display with native ratio 2, where dots reach the guard's exact size. The circle answer and
    // an upward field keep the corner outside the mask.
    const ring: (readonly [number, number])[] = [], background: (readonly [number, number])[] = []
    for (let row = 0; row < 17; row++) for (let column = 0; column < 22; column++) if (row < 2 || row > 14 || column < 2 || column > 19) ring.push([4 + 3 * column, 4 + 3 * row])
    for (let y = 4; y < 252; y += 9.3) for (let x = 2; x < 254; x += 9.3) if (x >= 130 || y >= 110) background.push([Math.floor(x), Math.floor(y)])
    const special = ring.length / 2, values: number[] = []
    for (let dot = 0; dot < MOTION_CAPTCHA_DOTS; dot++) {
        values.push(0.25)
        for (let segment = 0; segment < count / MOTION_CAPTCHA_LIFETIME; segment++) {
            const placed = dot < special && segment < 2, [x, y] = placed ? ring[dot * 2 + segment]! : background[dot < special ? MOTION_CAPTCHA_DOTS - special + dot : dot - special]!
            values.push((x + 0.5) / grid, (placed ? y - 1 : y + 0.5) / grid, 0.1)
        }
    }
    for (let index = 0; index < count * (MOTION_CAPTCHA_DOTS - 1); index++) values.push(0.5)
    const injected = (prefix: readonly number[]) => { let index = 0; return () => index < prefix.length ? prefix[index++]! : values[(index++ - prefix.length) % values.length]! }
    const attack = createMotionFrames(motionMask(MOTION_CAPTCHA_SYMBOLS.indexOf("circle")), 1, injected([])), attackPeaks = peaks(attack), at = (zoom: number) => MOTION_CAPTCHA_ZOOM_STEPS.findIndex(step => step.zoom === zoom)
    assert.ok(attackPeaks[at(5)]! <= budgets[at(5)]! && attackPeaks[at(4)]! > budgets[at(4)]!, `attack peaks ${attackPeaks}`)
    assert.ok(share(changed(rasterizeMotionFrame(attack[0]!, 10).pixels, rasterizeMotionFrame(attack[2]!, 10).pixels), 2560, 682, 512) > 0.25)
    // Setup draws keep the choices in order and pick the circle with an upward field, so the payload matches the frames above.
    assert.throws(() => createMotionRound(injected([...Array<number>(9).fill(0.999), 3.5 / 6, 0.25])), /flash guard/)
    // A valid but clustered random stream cannot produce a payload either.
    let step = 0
    const clustered = () => (step++ % 97) / 1000
    assert.ok(peaks(createMotionFrames(motionMask(0), 1, clustered)).some((peak, index) => peak > budgets[index]!))
    assert.throws(() => createMotionRound(clustered), /flash guard/)
})

test("the first motion choice reveals no correctness feedback and a full pair consumes one attempt", () => {
    const state = { status: "started", attempts: 0, solveExpiresAt: 1000, pathAnswers: [1, 4], pathSelections: [], pathRound: 0 }
    const correctFirst = motionAnswer(state, [1], 0, 900), wrongFirst = motionAnswer(state, [2], 0, 900)
    assert.deepEqual({ ...correctFirst, pathSelections: [] }, { ...wrongFirst, pathSelections: [] })
    assert.deepEqual(motionAnswer({ ...state, ...correctFirst }, [4], 1, 999), { status: "solved", attempts: 1, pathRound: 0, pathSelections: [] })
    const wrong = motionAnswer({ ...state, ...wrongFirst }, [4], 1, 999)
    assert.deepEqual(wrong, { status: "started", attempts: 1, pathRound: 0, pathSelections: [] })
    const retry = motionAnswer({ ...state, ...wrong }, [1], 0, 999)
    assert.deepEqual(motionAnswer({ ...state, ...retry }, [0], 1, 999), { status: "failed", attempts: 2, pathRound: 0, pathSelections: [] })
})

test("motion rounds fence replay, malformed choices and immutable deadline equality", () => {
    const state = { status: "started", attempts: 0, solveExpiresAt: 1000, pathAnswers: [1, 4], pathSelections: [], pathRound: 0 }
    for (const value of [[], [0, 1], [-1], [6], [1.2], ["1"], null]) assert.throws(() => motionAnswer(state, value, 0, 900))
    for (const round of [undefined, -1, 2, "0"]) assert.throws(() => motionAnswer(state, [1], round, 900))
    assert.throws(() => motionAnswer(state, [1], 1, 900))
    const first = motionAnswer(state, [1], 0, 900)
    assert.deepEqual(motionAnswer({ ...state, ...first }, [1], 0, 901), first)
    assert.throws(() => motionAnswer({ ...state, ...first }, [2], 0, 901))
    assert.deepEqual(motionAnswer({ ...state, ...first }, [4], 1, 1000), { status: "expired", attempts: 0 })
    for (const status of ["issued", "solved", "expired", "failed", "redeemed"]) assert.throws(() => motionAnswer({ ...state, status }, [1], 0, 900))
})
