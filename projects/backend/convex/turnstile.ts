import { fail } from "./validation.ts"

export async function verifyTurnstileToken(token: string): Promise<void> {
    if (!token.trim() || token.length > 2048) fail(400, "Complete the Turnstile verification")
    const secret = process.env.TURNSTILE_SECRET_KEY?.trim()
    const hostnames = process.env.TURNSTILE_HOSTNAMES?.split(",").map(hostname => hostname.trim()).filter(Boolean)
    if (!secret || !hostnames?.length) fail(503, "Turnstile verification unavailable")

    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000)
    let result: unknown
    try {
        const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ secret, response: token }), signal: controller.signal,
        })
        if (!response.ok) fail(503, "Turnstile verification unavailable")
        result = await response.json()
    } catch {
        fail(503, "Turnstile verification unavailable")
    } finally {
        clearTimeout(timeout)
    }
    if (!result || typeof result !== "object" || !("success" in result) || result.success !== true
        || !("action" in result) || result.action !== "verification_start"
        || !("hostname" in result) || typeof result.hostname !== "string" || !hostnames.includes(result.hostname)) {
        fail(403, "Turnstile verification failed. Please try again")
    }
}
