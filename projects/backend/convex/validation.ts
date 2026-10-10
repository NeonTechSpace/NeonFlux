import { ConvexError } from "convex/values"
import { Exit, Schema } from "effect"
import { isId } from "@neonflux/contracts/common"
import { configuredServerScope, scopeDenied } from "./serverScope.ts"

export { isId }

/** Refusals the bot turns into a reply that names the fix. The bot reads the code, never the message */
export type ReasonCode = "BOT_PERMISSION" | "BOT_BELOW_TARGET" | "ACTOR_BELOW_TARGET" | "ACTOR_PERMISSION" | "TARGET_PROTECTED" | "ROLE_NOT_ELIGIBLE"
export const REASON_CODES: readonly string[] = ["BOT_PERMISSION", "BOT_BELOW_TARGET", "ACTOR_BELOW_TARGET", "ACTOR_PERMISSION", "TARGET_PROTECTED", "ROLE_NOT_ELIGIBLE"] satisfies ReasonCode[]
export function fail(status: number, error: string, code?: ReasonCode): never {
    throw new ConvexError({ status, error, ...(code ? { code } : {}) })
}

/**
 * Decodes a request, or part of one, with its shared contract from @neonflux/contracts. Any mismatch or unknown key answers 400 with
 * error. The bot reads only the status and reason code of a refusal, so the message matters only where the website shows it
 */
export function decode<S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown, error = "Invalid request"): S["Type"] {
    const result = Schema.decodeUnknownExit(schema)(value, { onExcessProperty: "error" })
    if (Exit.isFailure(result)) fail(400, error)
    return result.value
}

// Format and the single-mode server only. Multi-mode installation is checked in the calling transaction, see installations.ts
export function requireServer(serverId: string) {
    if (!isId(serverId)) scopeDenied()
    const scope = configuredServerScope()
    if (scope.mode === "single" && scope.serverIds[0] !== serverId) scopeDenied()
}

export function requireId(value: unknown): string {
    if (!isId(value)) fail(400, "Invalid request")
    return value
}

/** Whether a channel rule lists a message's channel. A message in a thread counts as in its parent channel too */
export function listsChannel(list: readonly string[], channelId: string | undefined, parentChannelId?: string) {
    return channelId !== undefined && list.includes(channelId) || parentChannelId !== undefined && list.includes(parentChannelId)
}

export function object(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) fail(400, "Invalid request")
    return value as Record<string, unknown>
}

export function integer(value: unknown, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail(400, "Invalid request")
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
