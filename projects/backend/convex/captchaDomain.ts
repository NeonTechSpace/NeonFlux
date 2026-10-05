import { fail } from "./validation.ts"

export const VERIFICATION_LINK_TTL = 600000
export { VERIFICATION_SOLVE_TTL } from "@neonflux/contracts/motion-captcha"
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
