import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import { crc32, deflateSync } from "node:zlib"
import { pathToFileURL } from "node:url"
import { motionChallenge, motionRandom, sparkRoute, sparkPathValid, rasterizeMotionFrame, MOTION_CAPTCHA_PALETTE } from "../convex/motionCaptcha.ts"
import { decodeMotionFrames } from "@neonflux/contracts/motion-captcha"

export const ROUTE_GUESSES = 8
export function wilson(hits: number, total: number): [number, number] {
    const z = 1.96, p = hits / total, divisor = 1 + z * z / total, center = (p + z * z / (2 * total)) / divisor
    const radius = z / divisor * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))
    return [Math.max(0, center - radius), Math.min(1, center + radius)]
}
const seedFor = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 32)
type Route = (x: number) => number
export function screenshotScores(pixels: Uint8Array, routes: Route[]) {
    return routes.map(route => {
        let density = 0, contrast = 0, edges = 0, cells = 0
        for (let x = 32; x < 224; x++) for (let dy = -16; dy <= 16; dy++) {
            const row = Math.round((route(x) + dy) * 1.25), column = Math.round(x * 1.25), value = pixels[row * 320 + column]!
            density += Number(value > 0)
            contrast += value > 0 ? MOTION_CAPTCHA_PALETTE[value * 3]! + MOTION_CAPTCHA_PALETTE[value * 3 + 1]! + MOTION_CAPTCHA_PALETTE[value * 3 + 2]! : 0
            edges += Number(value !== pixels[row * 320 + Math.round((x + 1) * 1.25)]!); cells++
        }
        return { density: density / cells, contrast: contrast / cells, edges: edges / cells }
    })
}
export function motionScores(before: Uint8Array, after: Uint8Array, routes: Route[]) {
    return routes.map(route => {
        let score = 0, cells = 0
        for (let x = 32; x < 224; x++) for (let dy = -12; dy <= 12; dy++) {
            const y = Math.round(route(x) + dy), value = before[y * 256 + x]!
            if (!value) continue
            const nextY = y + Math.round(route(x + 256 / 240) - route(x)), previousY = y + Math.round(route(x - 256 / 240) - route(x))
            let forward = false, backward = false
            for (let dx = 1; dx <= 2; dx++) for (let offset = -1; offset <= 1; offset++) {
                forward ||= after[(nextY + offset) * 256 + x + dx] === value
                backward ||= after[(previousY + offset) * 256 + x - dx] === value
            }
            score += Number(forward) - Number(backward); cells++
        }
        return cells ? score / cells : 0
    })
}
const rank = (scores: number[], random: () => number) => scores.map((score, index) => ({ score: score + random() * 1e-9, index })).sort((a, b) => b.score - a.score)[0]!.index
export function evaluateCase(index: number) {
    const seeds = Array.from({ length: ROUTE_GUESSES }, (_, i) => seedFor('spark-candidate-' + index + '-' + i)), routes = seeds.map(sparkRoute)
    const random = motionRandom(seedFor('spark-evaluation-' + index)), answer = Math.floor(random() * ROUTE_GUESSES), frameIndex = Math.floor(random() * 240)
    const frames = decodeMotionFrames(motionChallenge(seeds[answer]!).motionFrames).frames
    const pixels = rasterizeMotionFrame(frames[frameIndex]!, 1.25).pixels, scores = screenshotScores(pixels, routes)
    const guesses = Object.fromEntries(['density', 'contrast', 'edges'].map(name => [name, rank(scores.map(score => score[name as keyof typeof score]), random)]))
    const positive = pixels.slice(), route = routes[answer]!
    for (let x = 32; x < 224; x++) for (let dy = -16; dy <= 16; dy++) positive[Math.round((route(x) + dy) * 1.25) * 320 + Math.round(x * 1.25)] = 1
    const control = rank(screenshotScores(positive, routes).map(score => score.density), random)
    const recording = rank(motionScores(rasterizeMotionFrame(frames[frameIndex]!, 1).pixels, rasterizeMotionFrame(frames[(frameIndex + 1) % 240]!, 1).pixels, routes), random)
    const accepted = routes.map(route => sparkPathValid(seeds[answer]!, Array.from({ length: 101 }, (_, i) => ({ x: 24 + 208 * i / 100, y: route(24 + 208 * i / 100), t: i * 100 })), 10000))
    return { answer, guesses, control, recording, pixels, accepted }
}
export function encodePng(pixels: Uint8Array): Buffer {
    const chunk = (name: string, data: Buffer) => { const body = Buffer.concat([Buffer.from(name), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([length, body, crc]) }
    const header = Buffer.alloc(13); header.writeUInt32BE(320, 0); header.writeUInt32BE(320, 4); header[8] = 8; header[9] = 2
    const rows = Buffer.alloc(320 * (1 + 320 * 3))
    for (let y = 0; y < 320; y++) for (let x = 0; x < 320; x++) for (let color = 0; color < 3; color++) rows[y * 961 + 1 + x * 3 + color] = MOTION_CAPTCHA_PALETTE[pixels[y * 320 + x]! * 3 + color]!
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
async function main() {
    const count = Number(process.argv[2] ?? 200)
    if (!Number.isInteger(count) || count < 16 || count > 2000) throw new Error("Use 16 to 2000 screenshots")
    const directory = resolve('../web/.local/spark-screenshots-' + new Date().toISOString().replace(/[:.]/g, '-'))
    await mkdir(directory, { recursive: false })
    const hits: Record<string, number> = { density: 0, contrast: 0, edges: 0, densityControl: 0, consecutiveFrames: 0 }
    const acceptedHits: Record<string, number> = { density: 0, contrast: 0, edges: 0 }
    let acceptanceChance = 0
    for (let i = 0; i < count; i++) {
        const result = evaluateCase(i)
        for (const [name, guess] of Object.entries(result.guesses)) { hits[name]! += Number(guess === result.answer); acceptedHits[name]! += Number(result.accepted[guess]) }
        acceptanceChance += result.accepted.filter(Boolean).length / ROUTE_GUESSES
        hits.densityControl! += Number(result.control === result.answer); hits.consecutiveFrames! += Number(result.recording === result.answer)
        if (i < 8) await writeFile(join(directory, 'frame-' + i + '.png'), encodePng(result.pixels))
        if ((i + 1) % 25 === 0) console.log('Evaluated ' + (i + 1) + ' screenshots')
    }
    const results = Object.fromEntries(Object.entries(hits).map(([name, hits]) => [name, { hits, total: count, rate: hits / count, interval95: wilson(hits, count) }]))
    acceptanceChance /= count
    const pathAcceptance = Object.fromEntries(Object.entries(acceptedHits).map(([name, hits]) => [name, { hits, total: count, rate: hits / count, interval95: wilson(hits, count) }]))
    const report = { chance: 1 / ROUTE_GUESSES, routeGuesses: ROUTE_GUESSES, results, acceptanceChance, pathAcceptance, limits: "Offline raster attacks against eight candidate routes with shared endpoints. Path acceptance uses the backend check. No human usability or external screenshot solver trial. Consecutive frames are outside the single-screenshot threat model" }
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2)); console.log(directory)
    const best = Math.max(...['density', 'contrast', 'edges'].map(name => results[name]!.rate))
    const upperChance = 1 / ROUTE_GUESSES + 3 * Math.sqrt(1 / ROUTE_GUESSES * (1 - 1 / ROUTE_GUESSES) / count)
    const bestAcceptance = Math.max(...Object.values(pathAcceptance).map(result => result.rate)), upperAcceptance = acceptanceChance + 3 * Math.sqrt(acceptanceChance * (1 - acceptanceChance) / count)
    if (best > upperChance || bestAcceptance > upperAcceptance || results.densityControl!.rate < 0.8 || results.consecutiveFrames!.rate < 0.5) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
