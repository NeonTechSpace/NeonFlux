import { ConvexError } from "convex/values"
import { SERVICE_KEY_LABEL, type ServiceScope } from "@neonflux/contracts/service"
import { configuredServerScope, misconfigured } from "./serverScope.ts"

// The bot never sends NEONFLUX_BOT_API_SECRET. It sends a key, an HMAC-SHA256 of the shared versioned label keyed by the
// secret, so the secret itself never appears in function arguments and keeps its other uses, such as leveling digests
const encoder = new TextEncoder()
let derived: { secret: string, key: Uint8Array } | undefined

/** Lowercase hex, 64 characters. The bot derives the same value with Node's HMAC */
export async function deriveServiceKey(secret: string): Promise<string> {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(SERVICE_KEY_LABEL)))
    return Array.from(signed, byte => byte.toString(16).padStart(2, "0")).join("")
}

// Reads every byte of the expected key whatever the input, so the time taken does not show how much of a guess matched
export function constantTimeEqual(expected: ArrayLike<number>, actual: ArrayLike<number>): boolean {
    let difference = expected.length ^ actual.length
    for (let index = 0; index < expected.length; index++) difference |= expected[index]! ^ (actual[index] ?? 0)
    return difference === 0
}

// Every public bot entry point calls this before it reads anything. Configuration problems answer 503 and a missing
// or wrong key 401, in the same order as the former HTTP routes
export async function requireServiceKey(key: unknown): Promise<ServiceScope> {
    const scope = configuredServerScope(), secret = process.env.NEONFLUX_BOT_API_SECRET
    // The bot refuses surrounding space too, so both sides derive the key from the same text
    if (!secret || secret.length < 32 || secret !== secret.trim()) misconfigured("Set NEONFLUX_BOT_API_SECRET to at least 32 characters without surrounding spaces")
    if (derived?.secret !== secret) derived = { secret, key: encoder.encode(await deriveServiceKey(secret)) }
    if (!constantTimeEqual(derived.key, encoder.encode(typeof key === "string" ? key : ""))) throw new ConvexError({ status: 401, error: "Unauthorized" })
    return scope
}
