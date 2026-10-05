import { fail } from "./validation.ts"

export const VERIFICATION_LINK_TTL = 600000
export const VERIFICATION_SOLVE_TTL = 90000
export const VERIFICATION_ISSUE_COOLDOWN = 60000
export const VERIFICATION_ATTEMPTS = 2

export function verificationToken(value: unknown): string {
    if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) fail(400, "Invalid verification link")
    return value
}
export async function verificationHash(token: string): Promise<string> {
    verificationToken(token)
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")
}
// A bounded indexed PNG keeps the choices image raster-only without a dependency.
export function indexedPng(width: number, height: number, pixels: Uint8Array, palette = [14, 18, 29, 29, 38, 56, 76, 88, 111, 206, 238, 255]): Uint8Array {
    const bits = palette.length > 12 ? 4 : 2, perByte = 8 / bits
    const u32 = (value: number) => [value >>> 24 & 255, value >>> 16 & 255, value >>> 8 & 255, value & 255]
    const chunk = (name: string, data: number[]) => {
        const body = [...Array.from(name, ch => ch.charCodeAt(0)), ...data]
        let crc = 0xffffffff
        for (const byte of body) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1 }
        return [...u32(data.length), ...body, ...u32((crc ^ 0xffffffff) >>> 0)]
    }
    const scanlines: number[] = []
    for (let y = 0; y < height; y++) {
        scanlines.push(0)
        for (let x = 0; x < width; x += perByte) {
            let value = 0
            for (let index = 0; index < perByte; index++) value |= pixels[y * width + x + index]! << (8 - bits * (index + 1))
            scanlines.push(value)
        }
    }
    const compressed = [0x78, 0x01]
    for (let offset = 0; offset < scanlines.length; offset += 65535) {
        const length = Math.min(65535, scanlines.length - offset)
        compressed.push(offset + length === scanlines.length ? 1 : 0, length & 255, length >>> 8, ~length & 255, ~length >>> 8 & 255, ...scanlines.slice(offset, offset + length))
    }
    let a = 1, b = 0
    for (const byte of scanlines) { a = (a + byte) % 65521; b = (b + a) % 65521 }
    compressed.push(...u32((b << 16 | a) >>> 0))
    return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10,
        ...chunk("IHDR", [...u32(width), ...u32(height), bits, 3, 0, 0, 0]),
        ...chunk("PLTE", palette),
        ...chunk("IDAT", compressed), ...chunk("IEND", [])])
}
