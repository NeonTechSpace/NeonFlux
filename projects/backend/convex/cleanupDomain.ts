import { List } from "@neonflux/contracts/common"
import {
    CleanupContext,
    CleanupMessageInput,
    CleanupObservation,
    CleanupSweepBinding,
    CleanupTargetBinding,
    CLEANUP_EPOCH,
    CLEANUP_EXCLUSIONS_PER_LIST,
    CLEANUP_SERVER_EXCLUSIONS,
    type CleanupCounts,
    type CleanupMessage,
    type CleanupPolicy,
    type CleanupSkipReason,
} from "@neonflux/contracts/cleanup"
import { actor } from "./moderationDomain.ts"
import { decode, fail, requireId, integer } from "./validation.ts"
import { composerMember } from "./publishingContext.ts"

export {
    CLEANUP_DAY,
    CLEANUP_RETENTION,
    CLEANUP_GRANT_MS,
    CLEANUP_SETTLE_MS,
    CLEANUP_EPOCH,
} from "@neonflux/contracts/cleanup"
/** How long a channel whose sweep reached its end waits before the next sweep. The shortest age is an hour */
export const CLEANUP_REST_MS = 15 * 60000
export const advanceCleanup = (value: number) => integer(value + 1, 1, Number.MAX_SAFE_INTEGER)
type ExclusionLists = { excludedAuthorIds: readonly string[]; excludedMessageIds: readonly string[] }
const exclusions = (x: ExclusionLists | null) => (x ? x.excludedAuthorIds.length + x.excludedMessageIds.length : 0)
/**
 * Why a policy's exclusion lists may not grow to lists: past what one channel or the server keeps, with others the server's other
 * policies. A change that only shrinks them always passes
 */
export function cleanupExclusionsRefusal(
    current: ExclusionLists | null,
    lists: ExclusionLists,
    others: Iterable<ExclusionLists>,
): string | null {
    if (exclusions(lists) <= exclusions(current)) return null
    if (
        lists.excludedAuthorIds.length > CLEANUP_EXCLUSIONS_PER_LIST ||
        lists.excludedMessageIds.length > CLEANUP_EXCLUSIONS_PER_LIST
    )
        return `A channel keeps at most ${CLEANUP_EXCLUSIONS_PER_LIST} excluded authors and ${CLEANUP_EXCLUSIONS_PER_LIST} excluded messages`
    let total = exclusions(lists)
    for (const other of others) total += exclusions(other)
    return total > CLEANUP_SERVER_EXCLUSIONS
        ? `A server keeps at most ${CLEANUP_SERVER_EXCLUSIONS} excluded authors and messages across its cleanup channels`
        : null
}
export const emptyCleanupCounts = (): CleanupCounts => ({
    scanned: 0,
    skipped: 0,
    attempted: 0,
    submitted: 0,
    acknowledged: 0,
    observedAbsent: 0,
    unresolved: 0,
    failed: 0,
    cancelled: 0,
})
export function cleanupBoundary(at: number) {
    return requireId(
        ((BigInt(integer(at, CLEANUP_EPOCH + 1, Number.MAX_SAFE_INTEGER)) - BigInt(CLEANUP_EPOCH)) << 22n).toString(),
    )
}
export function cleanupContext(value: unknown, now = Date.now()): CleanupContext {
    const r = decode(CleanupContext, value),
        observedAt = integer(r.observedAt, now - 60000, now + 1000)
    const context: CleanupContext = {
        ...r,
        observedAt,
        actor: actor(r.actor),
        member: composerMember(r.member, observedAt),
        botMember: composerMember(r.botMember, observedAt),
    }
    if (context.member.userId !== context.actor.userId || context.botMember.userId !== context.botId)
        fail(400, "Cleanup identity mismatch")
    return context
}
export function cleanupMessage(value: unknown, now = Date.now()): CleanupMessage {
    const { originServerId: _origin, ...message } = decode(CleanupMessageInput, value)
    integer(message.observedAt, now - 60000, now + 1000)
    return message
}
export function cleanupMessages(
    value: unknown,
    channelId: string,
    serverId: string,
    before?: string,
): CleanupMessage[] {
    const messages = decode(List(CleanupMessageInput, 50), value).map((x) => cleanupMessage(x)),
        seen = new Set<string>()
    let last = before === undefined ? undefined : BigInt(requireId(before))
    for (const message of messages) {
        if (
            message.channelId !== channelId ||
            (message.serverId !== null && message.serverId !== serverId) ||
            seen.has(message.messageId) ||
            (last !== undefined && BigInt(message.messageId) >= last)
        )
            fail(409, "Malformed cleanup history page")
        seen.add(message.messageId)
        last = BigInt(message.messageId)
    }
    return messages
}
export function cleanupEligibility(
    message: CleanupMessage,
    policy: Pick<CleanupPolicy, "channelId" | "excludedAuthorIds" | "excludedMessageIds">,
    cutoffAt: number,
): CleanupSkipReason | null {
    if (message.pinned === true) return "pinned"
    if (message.pinned !== false) return "pin-unknown"
    if (message.webhookId !== null) return "webhook"
    if (message.authorBot === true) return "bot"
    if (message.authorSystem === true || (message.type !== null && message.type !== 0 && message.type !== 19))
        return "system"
    if (!message.authorId || message.authorBot !== false || message.authorSystem !== false || message.type === null)
        return "identity-unknown"
    if (
        !message.createdAt ||
        Date.parse(message.createdAt) !== Number((BigInt(message.messageId) >> 22n) + BigInt(CLEANUP_EPOCH))
    )
        return "timestamp-unknown"
    if (Date.parse(message.createdAt) >= cutoffAt) return "too-new"
    if (policy.excludedAuthorIds.includes(message.authorId)) return "excluded-author"
    if (policy.excludedMessageIds.includes(message.messageId)) return "excluded-message"
    return null
}
export const cleanupBinding = (value: unknown): CleanupSweepBinding => decode(CleanupSweepBinding, value)
export const cleanupTargetBinding = (value: unknown): CleanupTargetBinding => decode(CleanupTargetBinding, value)
export function cleanupObservation(value: unknown, messageId: string, channelId: string): CleanupObservation {
    const { originServerId: _origin, ...observation } = decode(CleanupObservation, value)
    if (observation.messageId !== messageId || observation.channelId !== channelId)
        fail(409, "Cleanup observation mismatch")
    integer(observation.observedAt, Date.now() - 60000, Date.now() + 1000)
    if (observation.status !== "unknown" && !observation.channelVisible)
        fail(403, "Visible containing channel required")
    return observation
}
