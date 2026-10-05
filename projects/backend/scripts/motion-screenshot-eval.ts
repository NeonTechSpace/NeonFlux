import { createHash, randomBytes, randomInt } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { crc32, deflateSync, inflateSync } from "node:zlib"
import { VERIFICATION_ATTEMPTS, VERIFICATION_SOLVE_TTL } from "../convex/captchaDomain.ts"
import * as motionModule from "../convex/motionCaptcha.ts"
import { createMotionRound, decodeMotionFrames, motionAnswer, motionChoicesImage, motionMask, rasterizeMotionFrame, MOTION_CAPTCHA_GRID, MOTION_CAPTCHA_INSTRUCTION, MOTION_CAPTCHA_LIFETIME, MOTION_CAPTCHA_PALETTE, MOTION_CAPTCHA_SPEED, MOTION_CAPTCHA_SYMBOLS, type MotionPoint } from "../convex/motionCaptcha.ts"

// Offline screenshot-threat harness for the live motion challenge. It renders public composites of the
// canvas above the choices image for each capture cohort, attacks them with source-informed statistics
// and grades complete pairs through the live verifier's answer function. Generator constants are read
// from the module, so a rerun measures the current tuning. Attacks never receive answers or frame data.

// Live layout: a 320 CSS pixel canvas (projects/web/src/motion-canvas.tsx) with a 16-pixel vertical
// margin (projects/web/src/styles.css). Screenshots assume a device pixel ratio of 1.
export const CANVAS_SIZE = 320
export const CANVAS_GAP = 16
export const COHORTS = ["S1", "S3", "ALIAS", "BURST", "EXPOSURE2", "EXPOSURE4", "PAIR33", "RECORDING", "DENSITY_CONTROL"] as const
export type Cohort = typeof COHORTS[number]
const S3_WINDOW_MS = 10000, S3_MIN_GAP_MS = 700, BURST_SHOTS = 5, BURST_GAP_MS = 100, MAX_EXPOSURE = 4, ALIAS_START_MS = 500
// The synthetic density control thins dots outside the answer silhouette until the inside share of one frame sits
// this many binomial standard deviations above the silhouette's area share. A fixed third gave about 5.3 at 1000 dots.
const DENSITY_CONTROL_Z = 8
export const COHORT_DESCRIPTIONS: Record<Cohort, string> = {
    S1: "one screenshot at a uniformly random frame",
    S3: `three random captures within ${S3_WINDOW_MS / 1000} s, at least ${S3_MIN_GAP_MS} ms apart`,
    ALIAS: `three captures from ${ALIAS_START_MS} ms, one loop plus one frame apart, landing on consecutive data frames`,
    BURST: `${BURST_SHOTS} shots ${BURST_GAP_MS} ms apart from a random time`,
    EXPOSURE2: "one exposure averaging 2 consecutive frames",
    EXPOSURE4: "one exposure averaging 4 consecutive frames",
    PAIR33: "two consecutive frames, the boundary case",
    RECORDING: "every frame of one loop in order, reference",
    DENSITY_CONTROL: `synthetic control, one random frame with dots outside the answer thinned to a planted inside-share z of ${DENSITY_CONTROL_Z}`,
}
// A pair of images counts as motion evidence when vertical same-color matches exceed the horizontal
// chance control by this many Poisson units. Unrelated frames reached about 8, consecutive frames over 100.
const SHIFT_Z_MIN = 20
const PROBES_PER_COHORT = 20, POSITIVE_CONTROL_RATE = 0.8
// Cohorts that must be solved by a named attack, or the null results elsewhere are not meaningful.
const POSITIVE_CONTROLS = [["PAIR33", "shift"], ["RECORDING", "shift"], ["ALIAS", "shift"], ["DENSITY_CONTROL", "contrast"]] as const
const ATTACKS = ["contrast", "regularity", "continuity", "shift"] as const
type Attack = typeof ATTACKS[number]
const LETTERS = "ABCDEF"

export type Rgb = { width: number, height: number, data: Uint8Array }

// sfc32 from a 128-bit hex seed. Seeds come from node:crypto, the stream is fast enough for generation.
export function seededRandom(seed: string): () => number {
    if (!/^[0-9a-f]{32}$/.test(seed)) throw new Error("Invalid seed")
    let [a, b, c, d] = [0, 8, 16, 24].map(offset => parseInt(seed.slice(offset, offset + 8), 16) | 0) as [number, number, number, number]
    const next = () => {
        const t = (a + b | 0) + d | 0
        d = d + 1 | 0; a = b ^ b >>> 9; b = c + (c << 3) | 0; c = (c << 21 | c >>> 11) + t | 0
        return (t >>> 0) / 4294967296
    }
    for (let i = 0; i < 16; i++) next()
    return next
}
export const freshSeed = () => randomBytes(16).toString("hex")
const cryptoUnit = () => randomInt(2 ** 47) / 2 ** 47

// PNG input and output with node:zlib only.
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
function chunk(type: string, data: Uint8Array): Buffer {
    const out = Buffer.alloc(data.length + 12)
    out.writeUInt32BE(data.length, 0); out.write(type, 4, "ascii"); out.set(data, 8)
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
    return out
}
export function encodePng({ width, height, data }: Rgb): Buffer {
    const raw = Buffer.alloc((width * 3 + 1) * height), header = Buffer.alloc(13)
    for (let y = 0; y < height; y++) raw.set(data.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1)
    header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
    return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())])
}
export function decodePng(bytes: Uint8Array): Rgb {
    const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), idat: Buffer[] = []
    if (!input.subarray(0, 8).equals(SIGNATURE)) throw new Error("Not a PNG")
    let offset = 8, width = 0, height = 0, depth = 0, type = -1, palette: Uint8Array | undefined
    while (offset + 12 <= input.length) {
        const length = input.readUInt32BE(offset), name = input.toString("ascii", offset + 4, offset + 8), data = input.subarray(offset + 8, offset + 8 + length)
        if (name === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]!; type = data[9]!; if (data[12] !== 0) throw new Error("Interlaced PNG") }
        else if (name === "PLTE") palette = data
        else if (name === "IDAT") idat.push(data)
        else if (name === "IEND") break
        offset += length + 12
    }
    const channels = type === 2 ? 3 : type === 0 || type === 3 ? 1 : 0
    if (!channels || (type === 2 ? depth !== 8 : ![1, 2, 4, 8].includes(depth)) || type === 3 && !palette) throw new Error("Unsupported PNG format")
    const bits = depth * channels, stride = Math.ceil(width * bits / 8), bpp = Math.max(1, bits / 8), raw = inflateSync(Buffer.concat(idat)), rows = new Uint8Array(stride * height)
    if (raw.length < (stride + 1) * height) throw new Error("Truncated PNG")
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)]!, line = y * stride
        for (let x = 0; x < stride; x++) {
            const left = x >= bpp ? rows[line + x - bpp]! : 0, up = y ? rows[line - stride + x]! : 0, corner = x >= bpp && y ? rows[line - stride + x - bpp]! : 0
            let predictor = 0
            if (filter === 1) predictor = left
            else if (filter === 2) predictor = up
            else if (filter === 3) predictor = (left + up) >> 1
            else if (filter === 4) { const p = left + up - corner, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner); predictor = a <= b && a <= c ? left : b <= c ? up : corner }
            else if (filter !== 0) throw new Error("Unsupported PNG filter")
            rows[line + x] = (raw[y * (stride + 1) + 1 + x]! + predictor) & 255
        }
    }
    const out = new Uint8Array(width * height * 3)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 3
        if (type === 2) { out.set(rows.subarray(y * stride + x * 3, y * stride + x * 3 + 3), o); continue }
        const bit = x * depth, sample = (rows[y * stride + (bit >> 3)]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
        if (type === 3) {
            if (sample * 3 + 2 >= palette!.length) throw new Error("PNG palette index out of range")
            out.set(palette!.subarray(sample * 3, sample * 3 + 3), o)
        } else out.fill(Math.round(sample * 255 / ((1 << depth) - 1)), o, o + 3)
    }
    return { width, height, data: out }
}
const dataUriBytes = (uri: string) => Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64")

// Capture timing. The browser shows frame floor(t * fps / 1000) mod frameCount at time t.
export function captureShots(cohort: Cohort, fps: number, count: number, unit: () => number = cryptoUnit): { shots: number[][], timesMs?: number[] } {
    const loopMs = count * 1000 / fps, frameAt = (t: number) => Math.floor(t * fps / 1000) % count, start = Math.floor(unit() * count)
    const run = (length: number) => Array.from({ length }, (_, index) => (start + index) % count)
    if (cohort === "S1" || cohort === "DENSITY_CONTROL") return { shots: [[start]] }
    if (cohort === "ALIAS") {
        // Rounded up to 0.01 ms so floating point cannot land just before a frame boundary.
        const times = [0, 1, 2].map(index => Math.ceil((ALIAS_START_MS + index * (loopMs + 1000 / fps)) * 100) / 100)
        return { shots: times.map(time => [frameAt(time)]), timesMs: times }
    }
    if (cohort === "S3") {
        let times: number[]
        do times = [unit(), unit(), unit()].map(value => value * S3_WINDOW_MS).sort((x, y) => x - y)
        while (times[1]! - times[0]! < S3_MIN_GAP_MS || times[2]! - times[1]! < S3_MIN_GAP_MS)
        return { shots: times.map(time => [frameAt(time)]), timesMs: times }
    }
    if (cohort === "BURST") {
        const first = unit() * loopMs, times = Array.from({ length: BURST_SHOTS }, (_, index) => first + index * BURST_GAP_MS)
        return { shots: times.map(time => [frameAt(time)]), timesMs: times }
    }
    if (cohort === "EXPOSURE2") return { shots: [run(2)] }
    if (cohort === "EXPOSURE4") return { shots: [run(4)] }
    if (cohort === "PAIR33") return { shots: run(2).map(frame => [frame]) }
    return { shots: run(count).map(frame => [frame]) }
}
// Ground truth for diagnostics: two single-frame shots share live dots when their loop distance is below the lifetime.
export function sharedDotPair(shots: readonly (readonly number[])[], count: number): boolean {
    const single = shots.filter(shot => shot.length === 1).map(shot => shot[0]!)
    for (let a = 0; a < single.length; a++) for (let b = a + 1; b < single.length; b++) {
        const lag = ((single[b]! - single[a]!) % count + count) % count
        if (Math.min(lag, count - lag) >= 1 && Math.min(lag, count - lag) < MOTION_CAPTCHA_LIFETIME) return true
    }
    return false
}

// One public screenshot: the canvas, averaged over the shot's frames for exposures, above the choices image.
const backgrounds = new WeakMap<Rgb, Uint8Array>()
export function composite(frames: readonly (readonly MotionPoint[])[], shot: readonly number[], choices: Rgb): Rgb {
    const size = CANVAS_SIZE, width = Math.max(size, choices.width), height = size + CANVAS_GAP + choices.height, sums = new Uint16Array(size * size * 3)
    let base = backgrounds.get(choices)
    if (!base) {
        base = new Uint8Array(width * height * 3)
        for (let pixel = 0; pixel < width * height; pixel++) base.set(MOTION_CAPTCHA_PALETTE.slice(0, 3), pixel * 3)
        for (let y = 0; y < choices.height; y++) base.set(choices.data.subarray(y * choices.width * 3, (y + 1) * choices.width * 3), (size + CANVAS_GAP + y) * width * 3)
        backgrounds.set(choices, base)
    }
    const data = base.slice()
    for (const index of shot) {
        const { width: rasterWidth, pixels } = rasterizeMotionFrame(frames[index]!, size / MOTION_CAPTCHA_GRID)
        if (rasterWidth !== size) throw new Error("Unexpected canvas raster size")
        for (let pixel = 0; pixel < pixels.length; pixel++) {
            const color = pixels[pixel]! * 3
            for (let channel = 0; channel < 3; channel++) sums[pixel * 3 + channel] = sums[pixel * 3 + channel]! + MOTION_CAPTCHA_PALETTE[color + channel]!
        }
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size * 3; x++) data[y * width * 3 + x] = Math.round(sums[y * size * 3 + x]! / shot.length)
    return { width, height, data }
}

// Attacker side. Everything below uses the public composites plus generator source: card symbols are
// identified by re-rendering motionChoicesImage, silhouettes come from motionMask, and the palette,
// grid, speed and lifetime are public constants.
let recognizer: { width: number, regions: Int32Array[], references: Uint8Array[][] } | undefined
function choiceRecognizer() {
    if (recognizer) return recognizer
    const render = (choices: number[]) => decodePng(dataUriBytes(motionChoicesImage(choices)))
    const width = render([0, 0, 0, 0, 0, 0]).width, regions: Int32Array[] = [], references: Uint8Array[][] = []
    for (let card = 0; card < 6; card++) {
        const variants = MOTION_CAPTCHA_SYMBOLS.map((_, symbol) => render(Array.from({ length: 6 }, (_, index) => index === card ? symbol : 0)).data), base = variants[0]!, region: number[] = []
        for (let pixel = 0; pixel < base.length / 3; pixel++) if (variants.some(variant => variant[pixel * 3] !== base[pixel * 3] || variant[pixel * 3 + 1] !== base[pixel * 3 + 1] || variant[pixel * 3 + 2] !== base[pixel * 3 + 2])) region.push(pixel)
        regions.push(Int32Array.from(region))
        references.push(variants.map(variant => Uint8Array.from(region.flatMap(pixel => [variant[pixel * 3]!, variant[pixel * 3 + 1]!, variant[pixel * 3 + 2]!]))))
    }
    return recognizer = { width, regions, references }
}
export function recognizeChoices(image: Rgb): number[] {
    const { width, regions, references } = choiceRecognizer(), top = CANVAS_SIZE + CANVAS_GAP
    return regions.map((region, card) => {
        const misses = references[card]!.map(reference => {
            let miss = 0
            region.forEach((pixel, index) => {
                const o = ((top + Math.floor(pixel / width)) * image.width + pixel % width) * 3
                if (image.data[o] !== reference[index * 3] || image.data[o + 1] !== reference[index * 3 + 1] || image.data[o + 2] !== reference[index * 3 + 2]) miss++
            })
            return miss
        })
        if (misses.filter(miss => miss === 0).length !== 1) throw new Error(`Choice card ${LETTERS[card]} not recognized`)
        return misses.indexOf(0)
    })
}

// Per-cell decoding of the canvas at each grid cell's center pixel. An exposure of k frames is decoded
// into how many frames had a dot there and which dot colors appeared.
const tables = new Map<number, Map<number, number>>()
function exposureTable(k: number) {
    let table = tables.get(k)
    if (table) return table
    const entries = MOTION_CAPTCHA_PALETTE.length / 3, built = new Map<number, number>()
    const visit = (from: number, depth: number, r: number, g: number, b: number, dots: number, colors: number) => {
        if (depth === k) {
            const key = Math.round(r / k) << 16 | Math.round(g / k) << 8 | Math.round(b / k), value = dots * 256 + colors, previous = built.get(key)
            built.set(key, previous === undefined || previous === value ? value : -1)
            return
        }
        for (let entry = from; entry < entries; entry++) visit(entry, depth + 1, r + MOTION_CAPTCHA_PALETTE[entry * 3]!, g + MOTION_CAPTCHA_PALETTE[entry * 3 + 1]!, b + MOTION_CAPTCHA_PALETTE[entry * 3 + 2]!, dots + Number(entry > 0), entry > 0 ? colors | 1 << entry - 1 : colors)
    }
    visit(0, 0, 0, 0, 0, 0, 0)
    tables.set(k, built)
    return built
}
type Cells = { k: number, dots: Uint8Array, colors: Uint8Array }
export function decodeCells(image: Rgb): Cells {
    const grid = MOTION_CAPTCHA_GRID, scale = CANVAS_SIZE / grid, keys = new Int32Array(grid * grid)
    for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
        const o = (Math.floor((y + 0.5) * scale) * image.width + Math.floor((x + 0.5) * scale)) * 3
        keys[y * grid + x] = image.data[o]! << 16 | image.data[o + 1]! << 8 | image.data[o + 2]!
    }
    for (let k = 1; k <= MAX_EXPOSURE; k++) {
        const table = exposureTable(k), dots = new Uint8Array(keys.length), colors = new Uint8Array(keys.length), limit = keys.length / 1000
        let misses = 0
        for (let cell = 0; cell < keys.length && misses <= limit; cell++) {
            const value = table.get(keys[cell]!)
            if (value === undefined || value < 0) { misses++; continue }
            dots[cell] = value >> 8; colors[cell] = value & 255
        }
        if (misses <= limit) return { k, dots, colors }
    }
    throw new Error("Canvas pixels do not decode as averages of motion palette frames")
}

let templateCache: { symbols: { inside: Int32Array, edge: Int32Array }[], outer: Int32Array } | undefined
function templates() {
    if (templateCache) return templateCache
    const size = MOTION_CAPTCHA_GRID ** 2, step = MOTION_CAPTCHA_SPEED * MOTION_CAPTCHA_GRID, covered = new Uint8Array(size)
    const symbols = MOTION_CAPTCHA_SYMBOLS.map((_, symbol) => {
        const mask = motionMask(symbol), inside: number[] = [], edge: number[] = []
        for (let cell = 0; cell < size; cell++) {
            if (mask[cell]) { inside.push(cell); covered[cell] = 1 }
            // A dot one step away crosses the silhouette edge here, so its pair is cut by the mask.
            if (mask[cell] !== mask[(cell + step) % size]) edge.push(cell)
        }
        return { inside: Int32Array.from(inside), edge: Int32Array.from(edge) }
    })
    const outer: number[] = []
    for (let cell = 0; cell < size; cell++) if (!covered[cell]) outer.push(cell)
    return templateCache = { symbols, outer: Int32Array.from(outer) }
}
function moments(values: Float64Array): [number, number] {
    let sum = 0, squares = 0
    for (const value of values) { sum += value; squares += value * value }
    const mean = sum / values.length
    return [mean, Math.sqrt(Math.max(0, squares / values.length - mean * mean))]
}
// Pearson correlation with a binary template, scaled by sqrt(cells) to a z-like value.
function templateZ(values: Float64Array, mean: number, sd: number, cells: Int32Array): number {
    const p = cells.length / values.length
    if (!(sd > 0) || p <= 0 || p >= 1) return 0
    let sum = 0
    for (const cell of cells) sum += values[cell]!
    return (sum / values.length - mean * p) / (sd * Math.sqrt(p * (1 - p))) * Math.sqrt(values.length)
}

// Signed shift correlation between two images: same-color matches one motion step down minus one step up,
// against a horizontal chance control. Returns the best lag within the dot lifetime.
function pairEvidence(first: Uint8Array, second: Uint8Array): { z: number, map: Int8Array } | undefined {
    const grid = MOTION_CAPTCHA_GRID, size = grid * grid
    let best: { z: number, step: number } | undefined
    for (let lag = 1; lag < MOTION_CAPTCHA_LIFETIME; lag++) {
        const shift = lag * MOTION_CAPTCHA_SPEED, step = shift * grid
        let matched = 0, control = 0
        for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
            const cell = y * grid + x, color = first[cell]!
            if (!color) continue
            if (color & second[(cell + step) % size]!) matched++
            if (color & second[(cell - step + size) % size]!) matched++
            if (color & second[y * grid + (x + shift) % grid]!) control++
            if (color & second[y * grid + (x - shift + grid) % grid]!) control++
        }
        const z = (matched - control) / Math.sqrt(control + 1)
        if (!best || z > best.z) best = { z, step }
    }
    if (!best) return undefined
    const map = new Int8Array(size)
    for (let cell = 0; cell < size; cell++) {
        const color = first[cell]!
        if (color) map[cell] = Number((color & second[(cell + best.step) % size]!) !== 0) - Number((color & second[(cell - best.step + size) % size]!) !== 0)
    }
    return { z: best.z, map }
}

export type RoundEvidence = { choices: number[], contrast: number[], regularity: number[], continuity: number[], shift: number[] | undefined, pairs: number, significantPairs: number, maxPairZ: number | null, exposures: number[] }
// Four attacks, each scoring the six visible silhouettes:
// Contrast: dot coverage summed over images, as the absolute z of inside against outside each silhouette.
// A static density difference in either direction ranks the true silhouette higher.
// Regularity: each image's coverage z inside the silhouette. When dots are clipped to the mask, the count inside
// the true silhouette varies less than inside other regions, so a lower sum of squares ranks higher.
// Continuity: same-color vertical pairs one motion step apart, summed over images. When a trajectory crossing a
// horizontal silhouette edge loses its partner, a deficit along that edge band ranks higher.
// Shift: oriented signed maps of significant image pairs, correlated with each silhouette.
export function attackRound(images: readonly Rgb[], adjacentOnly = false): RoundEvidence {
    if (!images.length) throw new Error("No images")
    const { symbols, outer } = templates(), choices = recognizeChoices(images[0]!), size = MOTION_CAPTCHA_GRID ** 2, step = MOTION_CAPTCHA_SPEED * MOTION_CAPTCHA_GRID
    const cells = images.map(decodeCells), pairing = new Float64Array(size), total = new Float64Array(size), regularity = choices.map(() => 0)
    for (const { k, dots, colors } of cells) {
        const coverage = new Float64Array(size)
        for (let cell = 0; cell < size; cell++) {
            coverage[cell] = dots[cell]! / k
            total[cell] = total[cell]! + coverage[cell]!
            if (colors[cell]! & colors[(cell + step) % size]!) pairing[cell] = pairing[cell]! + 1
        }
        const [mean, sd] = moments(coverage)
        choices.forEach((symbol, index) => { regularity[index] = regularity[index]! - templateZ(coverage, mean, sd, symbols[symbol]!.inside) ** 2 })
    }
    const [totalMean, totalSd] = moments(total)
    const contrast = choices.map(symbol => Math.abs(templateZ(total, totalMean, totalSd, symbols[symbol]!.inside)))
    // Box smoothing of this map lowered EXPOSURE2 top-1 from 110/120 to 106, 94 and 73 for radii 1 to 3, so it stays raw.
    const [pairingMean, pairingSd] = moments(pairing)
    const continuity = choices.map(symbol => -templateZ(pairing, pairingMean, pairingSd, symbols[symbol]!.edge))
    const motion = new Float64Array(size)
    let pairs = 0, significantPairs = 0, maxPairZ: number | null = null
    for (let a = 0; a < cells.length; a++) for (let b = a + 1; b < cells.length; b++) {
        if (adjacentOnly && b !== a + 1) continue
        pairs++
        const evidence = pairEvidence(cells[a]!.colors, cells[b]!.colors)
        if (!evidence) continue
        maxPairZ = Math.max(maxPairZ ?? -Infinity, evidence.z)
        if (evidence.z < SHIFT_Z_MIN) continue
        significantPairs++
        // Cells outside every silhouette are background, so orient each pair's background negative.
        let background = 0
        for (const cell of outer) background += evidence.map[cell]!
        const sign = background > 0 ? -1 : 1
        for (let cell = 0; cell < size; cell++) motion[cell] = motion[cell]! + sign * evidence.map[cell]!
    }
    const [mean, sd] = moments(motion)
    const shift = significantPairs ? choices.map(symbol => templateZ(motion, mean, sd, symbols[symbol]!.inside)) : undefined
    return { choices, contrast, regularity, continuity, shift, pairs, significantPairs, maxPairZ, exposures: cells.map(cell => cell.k) }
}

// Pair semantics. Rounds are scored independently, a pair's score is the sum of standardized round
// scores, and the second attempt is the next most likely pair. Ties break randomly.
function standardize(scores: readonly number[]): number[] {
    const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length, sd = Math.sqrt(scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / scores.length)
    return scores.map(value => sd > 0 ? (value - mean) / sd : 0)
}
export function rankPairs(first: readonly number[], second: readonly number[], jitter: () => number = cryptoUnit): [number, number][] {
    const a = standardize(first), b = standardize(second), pairs: { pair: [number, number], score: number }[] = []
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) pairs.push({ pair: [i, j], score: a[i]! + b[j]! + jitter() * 1e-9 })
    return pairs.sort((x, y) => y.score - x.score).map(entry => entry.pair)
}
// Grades through the live pair state machine: both rounds must match, and a failed pair consumes an attempt.
export function gradeAttempts(answers: readonly number[], attempts: readonly (readonly [number, number])[], now = 0): { first: boolean, passed: boolean } {
    let state: Parameters<typeof motionAnswer>[0] = { status: "started", attempts: 0, solveExpiresAt: VERIFICATION_SOLVE_TTL, pathAnswers: [...answers], pathSelections: [], pathRound: 0 }
    for (const [index, [roundOne, roundTwo]] of attempts.slice(0, VERIFICATION_ATTEMPTS).entries()) {
        state = { ...state, ...motionAnswer(state, [roundOne], 0, now) }
        if (state.status !== "started") break
        state = { ...state, ...motionAnswer(state, [roundTwo], 1, now) }
        if (state.status === "solved") return { first: index === 0, passed: true }
        if (state.status !== "started") break
    }
    return { first: false, passed: false }
}
export function wilson(successes: number, trials: number, z = 1.959963984540054): [number, number] {
    if (!trials) return [0, 1]
    const p = successes / trials, denominator = 1 + z * z / trials, center = (p + z * z / (2 * trials)) / denominator, half = z * Math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / denominator
    return [Math.max(0, center - half), Math.min(1, center + half)]
}
// Accepts "B E", "B,E" or "BE" per attempt, as lines of one string or array entries. At most two attempts.
export function parseAttempts(value: unknown): [number, number][] | undefined {
    const lines = typeof value === "string" ? value.split(/\r?\n/) : Array.isArray(value) && value.every(entry => typeof entry === "string") ? value as string[] : undefined
    if (!lines) return undefined
    const attempts: [number, number][] = []
    for (const line of lines) {
        if (!line.trim()) continue
        const match = /^\s*([A-F])\s*[,/ ]?\s*([A-F])\s*$/i.exec(line)
        if (!match) return undefined
        attempts.push([LETTERS.indexOf(match[1]!.toUpperCase()), LETTERS.indexOf(match[2]!.toUpperCase())])
    }
    return attempts.length >= 1 && attempts.length <= VERIFICATION_ATTEMPTS ? attempts : undefined
}

// Share of outside dots to remove so that, with `dots` per frame and a silhouette covering `area` of the grid, the
// expected inside share reaches z binomial standard deviations above `area`. Bisection, since z grows with the share.
export function densityControlDrop(dots: number, area: number, z = DENSITY_CONTROL_Z): number {
    const planted = (drop: number) => {
        const kept = dots * (area + (1 - area) * (1 - drop))
        return (dots * area / kept - area) * Math.sqrt(kept / (area * (1 - area)))
    }
    if (!(dots > 0) || !(area > 0 && area < 1) || planted(1 - 1e-9) < z) throw new Error("Density control cannot reach its planted z")
    let low = 0, high = 1
    for (let step = 0; step < 50; step++) { const middle = (low + high) / 2; if (planted(middle) < z) low = middle; else high = middle }
    return high
}

// Challenge preparation on the harness side, which knows the answers and checks the recognizer against them.
export type PreparedRound = { answerIndex: number, choices: number[], shots: number[][], timesMs?: number[], sharedDots: boolean, images: Rgb[], payloadChars: number, choicesPngBytes: number, plantedDrop?: number }
export function prepareChallenge(cohort: Cohort, seed: string, unit: () => number = cryptoUnit): PreparedRound[] {
    const random = seededRandom(seed)
    return [0, 1].map(() => {
        const round = createMotionRound(random), { fps, frameCount, frames: generated } = decodeMotionFrames(round.motionFrames), choicesPng = dataUriBytes(round.imageDataUri)
        const choicesImage = decodePng(choicesPng), { shots, timesMs } = captureShots(cohort, fps, frameCount, unit)
        // The density control plants a static leak with the private answer, so the contrast attack has a known target.
        // Its strength follows the decoded points per frame and the answer's area, so it adapts to generator tuning.
        const answerMask = cohort === "DENSITY_CONTROL" ? motionMask(round.choices[round.answerIndex]!) : undefined
        const plantedDrop = answerMask ? densityControlDrop(generated.reduce((sum, frame) => sum + frame.length, 0) / generated.length, answerMask.reduce((sum, cell) => sum + cell, 0) / answerMask.length) : undefined
        const frames = answerMask && plantedDrop !== undefined ? generated.map(frame => frame.filter(({ x, y }) => answerMask[y * MOTION_CAPTCHA_GRID + x] || random() >= plantedDrop)) : generated
        return { answerIndex: round.answerIndex, choices: round.choices, shots, ...timesMs ? { timesMs } : {}, sharedDots: sharedDotPair(shots, frameCount), images: shots.map(shot => composite(frames, shot, choicesImage)), payloadChars: round.motionFrames.length, choicesPngBytes: choicesPng.length, ...plantedDrop !== undefined ? { plantedDrop } : {} }
    })
}
export function attackChallenge(cohort: Cohort, rounds: readonly PreparedRound[]) {
    const began = performance.now(), evidence = rounds.map(round => attackRound(round.images, cohort === "RECORDING")), attackMs = performance.now() - began
    rounds.forEach((round, index) => { if (evidence[index]!.choices.join() !== round.choices.join()) throw new Error("Choice recognizer disagrees with the generator") })
    const answers = rounds.map(round => round.answerIndex), zeros = [0, 0, 0, 0, 0, 0]
    const scores: Record<Attack, number[][] | undefined> = {
        contrast: evidence.map(round => round.contrast),
        regularity: evidence.map(round => round.regularity),
        continuity: evidence.map(round => round.continuity),
        shift: rounds[0]!.images.length > 1 ? evidence.map(round => round.shift ?? zeros) : undefined,
    }
    const outcomes: Partial<Record<Attack, { attempts: [number, number][], first: boolean, passed: boolean, roundHits: number }>> = {}
    for (const attack of ATTACKS) {
        const roundScores = scores[attack]
        if (!roundScores) continue
        const attempts = rankPairs(roundScores[0]!, roundScores[1]!).slice(0, VERIFICATION_ATTEMPTS)
        outcomes[attack] = { attempts, ...gradeAttempts(answers, attempts, Math.floor(attackMs)), roundHits: Number(attempts[0]![0] === answers[0]) + Number(attempts[0]![1] === answers[1]) }
    }
    return { attackMs, evidence, outcomes }
}

// Output helpers.
const percent = (value: number) => `${(value * 100).toFixed(1)}%`
const rate = (successes: number, trials: number) => { const [low, high] = wilson(successes, trials); return { successes, trials, rate: trials ? successes / trials : 0, wilson95: [low, high] } }
const describe = ({ successes, trials, rate: value, wilson95 }: ReturnType<typeof rate>) => `${percent(value)} (${successes}/${trials}) [${percent(wilson95[0]!)}, ${percent(wilson95[1]!)}]`
const median = (values: readonly number[]) => { const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1; return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2 }
function table(header: string[], rows: string[][]): string {
    const widths = header.map((cell, column) => Math.max(cell.length, ...rows.map(row => row[column]!.length)))
    return [header, ...rows].map(row => row.map((cell, column) => cell.padEnd(widths[column]!)).join("  ").trimEnd()).join("\n")
}
function probeTask(files: string[][]): string {
    return `${MOTION_CAPTCHA_INSTRUCTION}\n\n${files.map((names, round) => `Round ${round + 1}: ${names.map(name => `\`${name}\``).join(", ")}`).join("\n")}\n\nAnswer with one line holding the round 1 letter and the round 2 letter, for example \`B E\`. You may add a second line with a different pair as a second attempt. It counts only if the first pair is wrong.\n`
}
const shotName = (cohort: Cohort, round: number, shot: number, shots: number) => shots === 1 ? `round-${round + 1}.png` : `round-${round + 1}-shot-${String(shot + 1).padStart(cohort === "RECORDING" ? 2 : 1, "0")}.png`

async function run(count: number, label: string | undefined) {
    const generatorPath = resolve(import.meta.dirname, "../convex/motionCaptcha.ts"), generatorSha256 = createHash("sha256").update(await readFile(generatorPath)).digest("hex")
    const began = performance.now(), output = resolve(import.meta.dirname, "../../web/.local", `motion-screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}${label ? `-${label}` : ""}`)
    await mkdir(dirname(output), { recursive: true })
    await mkdir(output)
    await mkdir(join(output, "private"))
    const sizes: Record<string, number[]> = {}, trials: unknown[] = [], results: Record<string, unknown> = {}, mainRows: string[][] = [], diagnosticRows: string[][] = []
    const save = async (path: string, bytes: Uint8Array | string, group: string) => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, bytes)
        ;(sizes[group] ??= []).push(typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.length)
    }
    const savePng = async (path: string, image: Rgb, group: string) => {
        const png = encodePng(image), decoded = decodePng(png)
        if (decoded.width !== image.width || !Buffer.from(decoded.data).equals(Buffer.from(image.data))) throw new Error("PNG round trip changed pixels")
        await save(path, png, group)
    }
    for (const cohort of COHORTS) {
        const cohortBegan = performance.now(), counts = Object.fromEntries(ATTACKS.map(attack => [attack, { first: 0, passed: 0, roundHits: 0, trials: 0 }])) as Record<Attack, { first: number, passed: number, roundHits: number, trials: number }>
        const attackTimes: number[] = []
        let evidenceRounds = 0, sharedRounds = 0, payloadChars = 0, plantedDrops: number[] = []
        for (let trial = 0; trial < count; trial++) {
            const seed = freshSeed(), rounds = prepareChallenge(cohort, seed), { attackMs, evidence, outcomes } = attackChallenge(cohort, rounds)
            attackTimes.push(attackMs)
            for (const attack of ATTACKS) {
                const outcome = outcomes[attack]
                if (!outcome) continue
                const total = counts[attack]
                total.trials++; total.first += Number(outcome.first); total.passed += Number(outcome.passed); total.roundHits += outcome.roundHits
            }
            evidenceRounds += evidence.filter(round => round.significantPairs > 0).length
            sharedRounds += rounds.filter(round => round.sharedDots).length
            plantedDrops.push(...rounds.flatMap(round => round.plantedDrop === undefined ? [] : [round.plantedDrop]))
            payloadChars = Math.max(payloadChars, ...rounds.map(round => round.payloadChars))
            trials.push({ cohort, trial: trial + 1, seed, attackMs: Math.round(attackMs * 10) / 10, rounds: rounds.map((round, index) => ({ answer: LETTERS[round.answerIndex], choices: round.choices.map(symbol => MOTION_CAPTCHA_SYMBOLS[symbol]), shots: round.shots, timesMs: round.timesMs?.map(time => Math.round(time)), sharedDots: round.sharedDots, plantedDrop: round.plantedDrop === undefined ? undefined : Math.round(round.plantedDrop * 1000) / 1000, exposures: evidence[index]!.exposures, pairs: evidence[index]!.pairs, significantPairs: evidence[index]!.significantPairs, maxPairZ: evidence[index]!.maxPairZ === null ? null : Math.round(evidence[index]!.maxPairZ! * 10) / 10 })), outcomes: Object.fromEntries(Object.entries(outcomes).map(([attack, outcome]) => [attack, { attempts: outcome.attempts.map(pair => pair.map(choice => LETTERS[choice]).join("")), first: outcome.first, passed: outcome.passed }])) })
            if (trial === 0) for (const [index, round] of rounds.entries()) for (const [shot, image] of round.images.entries()) await savePng(join(output, "samples", cohort.toLowerCase(), shotName(cohort, index, shot, round.images.length)), image, `samples/${cohort}`)
        }
        const summary = Object.fromEntries(ATTACKS.filter(attack => counts[attack].trials).map(attack => [attack, { firstAttempt: rate(counts[attack].first, counts[attack].trials), twoAttempts: rate(counts[attack].passed, counts[attack].trials), roundTop1: rate(counts[attack].roundHits, counts[attack].trials * 2) }]))
        results[cohort] = { challenges: count, ...summary, medianAttackMs: Math.round(median(attackTimes) * 10) / 10, roundsWithShiftEvidence: rate(evidenceRounds, count * 2), roundsWithSharedDotShots: rate(sharedRounds, count * 2), ...plantedDrops.length ? { meanPlantedOutsideDrop: Math.round(plantedDrops.reduce((sum, value) => sum + value, 0) / plantedDrops.length * 1000) / 1000 } : {}, maxPayloadBase64Chars: payloadChars, cohortSeconds: Math.round((performance.now() - cohortBegan) / 100) / 10 }
        // The strongest attack is chosen after the fact, by complete-pair passes with two attempts, then first attempts.
        const strongest = ATTACKS.filter(attack => summary[attack]).sort((a, b) => summary[b]!.twoAttempts.successes - summary[a]!.twoAttempts.successes || summary[b]!.firstAttempt.successes - summary[a]!.firstAttempt.successes)[0]!, best = summary[strongest]!
        results[cohort] = { ...results[cohort] as object, strongestAttack: strongest }
        mainRows.push([cohort, String(count), strongest, describe(best.firstAttempt), describe(best.twoAttempts), `${median(attackTimes).toFixed(1)} ms`])
        diagnosticRows.push([cohort, ...ATTACKS.map(attack => summary[attack] ? `${percent(summary[attack].firstAttempt.rate)} / ${percent(summary[attack].twoAttempts.rate)} / ${percent(summary[attack].roundTop1.rate)}` : "n/a"), percent(evidenceRounds / count / 2), percent(sharedRounds / count / 2)])
        console.log(`${cohort}: strongest ${strongest} ${describe(best.twoAttempts)} with two attempts, ${((performance.now() - cohortBegan) / 1000).toFixed(1)} s`)
    }

    // Model probe packages: public composites and the task text only. Answers live in private/judge.json.
    const judge: unknown[] = []
    for (const cohort of ["S1", "S3"] as const) for (let index = 1; index <= PROBES_PER_COHORT; index++) {
        const id = `${cohort.toLowerCase()}-${String(index).padStart(2, "0")}`, seed = freshSeed(), rounds = prepareChallenge(cohort, seed), files: string[][] = []
        for (const [round, prepared] of rounds.entries()) {
            files.push([])
            for (const [shot, image] of prepared.images.entries()) {
                const name = shotName(cohort, round, shot, prepared.images.length)
                files[round]!.push(name)
                await savePng(join(output, "probes", id, name), image, `probes/${cohort}`)
            }
        }
        await save(join(output, "probes", id, "task.md"), probeTask(files), "probes/task")
        judge.push({ id, cohort, seed, answers: rounds.map(round => LETTERS[round.answerIndex]), choices: rounds.map(round => round.choices.map(symbol => MOTION_CAPTCHA_SYMBOLS[symbol])), shots: rounds.map(round => round.shots), timesMs: rounds.map(round => round.timesMs?.map(time => Math.round(time))), sharedDots: rounds.map(round => round.sharedDots) })
    }
    await save(join(output, "private", "judge.json"), JSON.stringify({ createdAt: new Date().toISOString(), grading: "Pair semantics through motionAnswer, at most two attempts. Grade with: node scripts/motion-screenshot-eval.ts grade <output directory> <answers.json>", probes: judge }, null, 2), "private")
    await save(join(output, "private", "eval-trials.json"), JSON.stringify(trials), "private")

    const control = POSITIVE_CONTROLS.map(([cohort, attack]) => ({ cohort, attack, firstAttempt: (results[cohort] as Record<string, { firstAttempt: { rate: number } } | undefined>)[attack]?.firstAttempt.rate ?? 0 }))
    const positiveControl = { threshold: POSITIVE_CONTROL_RATE, cohorts: control, passed: control.every(entry => entry.firstAttempt >= POSITIVE_CONTROL_RATE) }
    const fileSizes = Object.fromEntries(Object.entries(sizes).map(([group, values]) => [group, { files: values.length, totalBytes: values.reduce((sum, value) => sum + value, 0), minBytes: Math.min(...values), medianBytes: median(values), maxBytes: Math.max(...values) }]))
    const constants = Object.fromEntries(Object.entries(motionModule).filter(([name, value]) => name.startsWith("MOTION_CAPTCHA_") && (typeof value === "number" || name === "MOTION_CAPTCHA_SYMBOLS")))
    const runSeconds = Math.round((performance.now() - began) / 100) / 10
    const text = [
        `Motion screenshot evaluation${label ? ` (${label})` : ""}, ${count} fresh challenges per cohort, two rounds of six choices each`,
        `Generator convex/motionCaptcha.ts sha256 ${generatorSha256}`,
        `Constants: ${Object.entries(constants).filter(([, value]) => typeof value === "number").map(([name, value]) => `${name.replace("MOTION_CAPTCHA_", "")}=${value}`).join(", ")}`,
        `Guessing baseline: first attempt ${percent(1 / 36)}, two attempts ${percent(2 / 36)}`,
        "",
        `Strongest scripted attack per cohort, chosen after the fact among ${ATTACKS.join(", ")} (slightly optimistic)`,
        table(["Cohort", "N", "Attack", "First attempt [Wilson 95%]", "Two attempts [Wilson 95%]", "Median attack, all attacks"], mainRows),
        "",
        "Diagnostics: first attempt / two attempts / per-round top-1 (chance 16.7%)",
        table(["Cohort", ...ATTACKS.map(attack => attack[0]!.toUpperCase() + attack.slice(1)), "Rounds with shift evidence", "Rounds with shots sharing dots"], diagnosticRows),
        "",
        "Cohorts",
        ...COHORTS.map(cohort => `${cohort.padEnd(16)}${COHORT_DESCRIPTIONS[cohort]}`),
        "",
        `Positive controls (first attempt >= ${percent(POSITIVE_CONTROL_RATE)}): ${control.map(entry => `${entry.cohort} ${entry.attack} ${percent(entry.firstAttempt)}`).join(", ")}${(results.DENSITY_CONTROL as { meanPlantedOutsideDrop?: number } | undefined)?.meanPlantedOutsideDrop === undefined ? "" : ` (density control removed ${percent((results.DENSITY_CONTROL as { meanPlantedOutsideDrop: number }).meanPlantedOutsideDrop)} of outside dots on average)`}, ${positiveControl.passed ? "passed" : "FAILED, null results are not meaningful"}`,
        `Run time ${runSeconds} s`,
    ].join("\n")
    const protocol = `Each challenge is generated by createMotionRound from a node:crypto seed. Screenshots are composites of the live 320 CSS pixel canvas (rasterizeMotionFrame at 320/grid scale, device pixel ratio 1) 16 pixels above the decoded public choices PNG. Exposures average the RGB of consecutive frames with rounding. The attack receives only the composite pixels and the generator source: it identifies card symbols by re-rendering motionChoicesImage, decodes each grid cell's center pixel, and scores silhouettes from motionMask. Contrast: dot coverage summed over images, ranked by the absolute z of inside against outside each silhouette. Regularity: per image, the z of dot coverage inside each silhouette, ranked by the lowest sum of squares over images. Continuity: same-color vertical pairs one motion step apart, summed over images, ranked by the deficit z along each silhouette's band where a step crosses its edge. Shift: signed same-color matches one motion step down minus up for every image pair (adjacent pairs only for RECORDING), kept when they exceed a horizontal chance control by z >= ${SHIFT_Z_MIN}, oriented by the background outside every silhouette and correlated with each silhouette. The strongest attack per cohort is selected after the fact. Pairs are ranked by the sum of standardized round scores, attempt two is the next pair, and grading runs through motionAnswer with the measured attack time. Attack time excludes generation, rendering and PNG encoding. BURST starts at a uniform loop time. DENSITY_CONTROL plants a static leak with the private answer and is not a capture of the live challenge. Cohorts: ${COHORTS.map(cohort => `${cohort}, ${COHORT_DESCRIPTIONS[cohort]}`).join(". ")}`
    await save(join(output, "report.json"), JSON.stringify({ createdAt: new Date().toISOString(), label: label ?? null, generatorSha256, protocol, constants, layout: { canvasSize: CANVAS_SIZE, gap: CANVAS_GAP, s3WindowMs: S3_WINDOW_MS, s3MinGapMs: S3_MIN_GAP_MS, aliasStartMs: ALIAS_START_MS, densityControlZ: DENSITY_CONTROL_Z, burst: { shots: BURST_SHOTS, gapMs: BURST_GAP_MS }, shiftZMin: SHIFT_Z_MIN }, baseline: { firstAttempt: 1 / 36, twoAttempts: 2 / 36 }, cohorts: COHORT_DESCRIPTIONS, results, positiveControl, fileSizes, runSeconds }, null, 2), "report")
    await save(join(output, "report.txt"), `${text}\n`, "report")
    console.log(`\n${text}\n`)
    console.log(JSON.stringify({ output, fileSizes }, null, 2))
    if (!positiveControl.passed) process.exitCode = 1
}

async function grade(directory: string, answersFile: string) {
    const judge = JSON.parse(await readFile(join(resolve(directory), "private", "judge.json"), "utf8")) as { probes: { id: string, cohort: Cohort, answers: string[] }[] }
    const answers = JSON.parse(await readFile(resolve(answersFile), "utf8")) as Record<string, unknown>
    const groups = new Map<string, { first: number, passed: number, invalid: number, total: number }>(), details: unknown[] = []
    for (const probe of judge.probes) {
        const attempts = parseAttempts(answers[probe.id]), expected = probe.answers.map(letter => LETTERS.indexOf(letter))
        const result = attempts ? gradeAttempts(expected, attempts) : { first: false, passed: false }
        for (const key of [probe.cohort, "ALL"]) {
            const group = groups.get(key) ?? { first: 0, passed: 0, invalid: 0, total: 0 }
            group.total++; group.first += Number(result.first); group.passed += Number(result.passed); group.invalid += Number(!attempts)
            groups.set(key, group)
        }
        details.push({ id: probe.id, answers: probe.answers.join(""), attempts: attempts?.map(pair => pair.map(choice => LETTERS[choice]).join("")) ?? null, ...result })
    }
    console.log(`Guessing baseline: first attempt ${percent(1 / 36)}, two attempts ${percent(2 / 36)}`)
    console.log(table(["Cohort", "First attempt [Wilson 95%]", "Two attempts [Wilson 95%]", "Missing or invalid"], [...groups].sort(([a], [b]) => Number(a === "ALL") - Number(b === "ALL")).map(([key, group]) => [key, describe(rate(group.first, group.total)), describe(rate(group.passed, group.total)), String(group.invalid)])))
    console.log(JSON.stringify(details))
}

if (import.meta.main) {
    const [command, ...rest] = process.argv.slice(2)
    if (command === "grade") {
        if (rest.length !== 2) throw new Error("Usage: node scripts/motion-screenshot-eval.ts grade <output directory> <answers.json>")
        await grade(rest[0]!, rest[1]!)
    } else {
        const count = Number(command ?? 200), label = rest[0]
        if (!Number.isInteger(count) || count < 1 || count > 1000 || rest.length > 1 || label !== undefined && !/^[a-z0-9-]{1,40}$/.test(label)) throw new Error("Usage: node scripts/motion-screenshot-eval.ts [challenges per cohort, 1 to 1000] [label] | grade <output directory> <answers.json>")
        await run(count, label)
    }
}
