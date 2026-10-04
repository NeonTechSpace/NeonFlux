import { ConvexError } from "convex/values"
import { Exit, Schema } from "effect"
import { IsoTime, hasText, isId, isName } from "@neonflux/contracts/common"
import { configuredServerScope, scopeDenied } from "./serverScope.ts"

export { isId }

/**
 * Refusals the bot turns into a reply that names the fix. REFUSED marks a refusal whose message is a sentence for members,
 * with its next step, and the bot shows it as it is. For every other code the bot reads the code, never the message
 */
export const REASON_CODES = [
    "BOT_PERMISSION",
    "BOT_BELOW_TARGET",
    "ACTOR_BELOW_TARGET",
    "ACTOR_PERMISSION",
    "TARGET_PROTECTED",
    "ROLE_NOT_ELIGIBLE",
    "REFUSED",
] as const
type ReasonCode = (typeof REASON_CODES)[number]
export function fail(status: number, error: string, code?: ReasonCode): never {
    throw new ConvexError({ status, error, ...(code ? { code } : {}) })
}
/** Whether an error is a refusal that fail() threw with this status */
export function failedWith(error: unknown, status: number): error is ConvexError<{ status: number }> {
    return (
        error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data !== null &&
        "status" in error.data &&
        error.data.status === status
    )
}

/**
 * Decodes a request, or part of one, with its shared contract from @neonflux/contracts. Any mismatch or unknown key
 * answers 400 with error. The bot shows that message only for a REFUSED code
 */
export function decode<S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
    value: unknown,
    error = "Invalid request",
): S["Type"] {
    const result = Schema.decodeUnknownExit(schema)(value, { onExcessProperty: "error" })
    if (Exit.isFailure(result)) fail(400, error)
    return result.value
}

// Format and the configured server only
export function requireServer(serverId: string) {
    if (!isId(serverId)) scopeDenied()
    const scope = configuredServerScope()
    if (scope.serverIds[0] !== serverId) scopeDenied()
}

export function requireId(value: unknown): string {
    if (!isId(value)) fail(400, "Invalid request")
    return value
}

/** Whether a channel rule lists a message's channel. A message in a thread counts as in its parent channel too */
export function listsChannel(list: readonly string[], channelId: string | undefined, parentChannelId?: string) {
    return (
        (channelId !== undefined && list.includes(channelId)) ||
        (parentChannelId !== undefined && list.includes(parentChannelId))
    )
}

export function object(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) fail(400, "Invalid request")
    return value as Record<string, unknown>
}

export function integer(value: unknown, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
        fail(400, "Invalid request")
    return value
}

export function text(value: unknown, maximum = 512): string {
    if (typeof value !== "string" || value.length > maximum || !hasText(value)) fail(400, "Invalid request")
    return value
}

export function ids(value: unknown, maximum = 20): string[] {
    if (!Array.isArray(value) || value.length > maximum) fail(400, "Invalid request")
    return [...new Set(value.map(requireId))]
}

export function name(value: unknown): string {
    if (typeof value !== "string") fail(400, "Invalid request")
    const result = value.trim().toLowerCase()
    if (!isName(result)) fail(400, "Invalid request")
    return result
}

export function cursor(value: unknown): string | null {
    if (value === undefined || value === null) return null
    if (typeof value !== "string" || !value.length || value.length > 16384) fail(400, "Invalid cursor")
    return value
}

// A value as JSON with its object keys sorted, so a replayed request compares equal whatever order its keys arrived in
export const canonicalJson = (value: unknown): string | undefined =>
    JSON.stringify(value, (_, item: unknown) =>
        item && typeof item === "object" && !Array.isArray(item)
            ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
            : item,
    )

export function fresh(timestamp: number, now: number) {
    if (timestamp < now - 15 * 60000 || timestamp > now + 60000) fail(400, "Invalid source event")
}

export function source(
    input: Record<string, unknown>,
    now: number,
): { serverId: string; messageId: string; createdAt: number } {
    const serverId = requireId(input.serverId)
    requireServer(serverId)
    const messageId = requireId(input.messageId)
    const createdAt = integer(input.createdAt, 0, Number.MAX_SAFE_INTEGER)
    fresh(createdAt, now)
    return { serverId, messageId, createdAt }
}

/** A member's join or timeout time as Fluxer reports it */
export const epoch = (value: unknown): string => decode(IsoTime, value, "Invalid membership epoch")

// Native evidence supplied for a member must name that same member
export function requireReadMember(row: Record<string, unknown>, userId: string) {
    if (Object.hasOwn(row, "memberUserId") && row.memberUserId !== userId) fail(403, "Native evidence member mismatch")
}
export type ConfigurationIdentity = {
    serverId: string
    actorId: string
    createdAt: number
    source: { kind: "chat"; messageId: string } | { kind: "job"; jobId: string }
}
export function configurationSourceId(identity: ConfigurationIdentity) {
    return identity.source.kind === "chat" ? identity.source.messageId : identity.source.jobId
}
