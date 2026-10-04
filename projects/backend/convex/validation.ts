import { ConvexError } from "convex/values"
import { Exit, Schema } from "effect"
import { isId } from "@neonflux/contracts/common"
import { configuredServerScope, scopeDenied } from "./serverScope.ts"

export { isId }

export function fail(status: number, error: string): never {
    throw new ConvexError({ status, error })
}

/**
 * Decodes a request, or part of one, with its shared contract from @neonflux/contracts. Any mismatch or unknown key
 * answers 400 with error
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
function requireServer(serverId: string) {
    if (!isId(serverId)) scopeDenied()
    const scope = configuredServerScope()
    if (scope.serverIds[0] !== serverId) scopeDenied()
}

function requireId(value: unknown): string {
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

function integer(value: unknown, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
        fail(400, "Invalid request")
    return value
}

function fresh(timestamp: number, now: number) {
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
