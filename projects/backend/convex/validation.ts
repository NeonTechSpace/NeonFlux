import { ConvexError } from "convex/values"

export function isId(value: unknown): value is string {
    return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value)
        && BigInt(value) <= 9223372036854775807n
}

export function fail(status: number, error: string): never {
    throw new ConvexError({ status, error })
}

export function requireServer(serverId: string) {
    if (!isId(process.env.NEONFLUX_SERVER_ID) || serverId !== process.env.NEONFLUX_SERVER_ID) {
        fail(403, "Server not allowed")
    }
}

export type ConfigurationIdentity = { serverId: string, actorId: string, createdAt: number, source: { kind: "chat", messageId: string } }

export function requireId(value: unknown): string {
    if (!isId(value)) fail(400, "Invalid request")
    return value
}

export function object(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) fail(400, "Invalid request")
    return value as Record<string, unknown>
}

export function integer(value: unknown, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail(400, "Invalid request")
    return value
}

export function bool(value: unknown): boolean {
    if (typeof value !== "boolean") fail(400, "Invalid request")
    return value
}

export function text(value: unknown, maximum = 512): string {
    if (typeof value !== "string" || value.length > maximum || !value.replace(/[\u000c\u202e]/g, "").trim()) fail(400, "Invalid request")
    return value
}

export function ids(value: unknown, maximum = 20): string[] {
    if (!Array.isArray(value) || value.length > maximum) fail(400, "Invalid request")
    return [...new Set(value.map(requireId))]
}

export function token(value: unknown): string {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) fail(400, "Invalid request")
    return value
}

export function name(value: unknown): string {
    if (typeof value !== "string") fail(400, "Invalid request")
    const result = value.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(result)) fail(400, "Invalid request")
    return result
}

export function cursor(value: unknown): string | null {
    if (value === undefined || value === null) return null
    if (typeof value !== "string" || !value.length || value.length > 16384) fail(400, "Invalid cursor")
    return value
}

export function fresh(timestamp: number, now: number) {
    if (timestamp < now - 15 * 60000 || timestamp > now + 60000) fail(400, "Invalid source event")
}

export function source(input: Record<string, unknown>, now: number): { serverId: string, messageId: string, createdAt: number } {
    const serverId = requireId(input.serverId)
    requireServer(serverId)
    const messageId = requireId(input.messageId)
    const createdAt = integer(input.createdAt, 0, Number.MAX_SAFE_INTEGER)
    fresh(createdAt, now)
    return { serverId, messageId, createdAt }
}

// Work bindings select a member, so supplied native evidence must name that same member
export function requireReadMember(row: Record<string, unknown>, userId: string) {
    if (Object.hasOwn(row, "memberUserId") && row.memberUserId !== userId) fail(403, "Native evidence member mismatch")
}
