import type { CleanupContext, CleanupCounts, CleanupMessage, CleanupObservation, CleanupPolicy, CleanupSkipReason, CleanupSweepBinding, CleanupTargetBinding } from "../contracts.js"
import { actor } from "./moderationDomain.ts"

import { epoch } from "./rolesDomain.ts"
import { shape } from "./publishingDomain.ts"
import { fail, requireId, bool, integer } from "./validation.ts"
import { eventMember } from "./publishingContext.ts"

export const CLEANUP_DAY = 86400000, CLEANUP_RETENTION = 30 * CLEANUP_DAY, CLEANUP_GRANT_MS = 120000, CLEANUP_SETTLE_MS = 10000
export const CLEANUP_EPOCH = 1420070400000
export const cleanupAge = (value: unknown) => integer(value, 3600000, 365 * CLEANUP_DAY)
export const advanceCleanup = (value: number) => integer(value + 1, 1, Number.MAX_SAFE_INTEGER)
export const emptyCleanupCounts = (): CleanupCounts => ({ scanned: 0, skipped: 0, attempted: 0, submitted: 0, acknowledged: 0, observedAbsent: 0, unresolved: 0, failed: 0, cancelled: 0 })
export function cleanupBoundary(at: number) { return requireId(((BigInt(integer(at, CLEANUP_EPOCH + 1, Number.MAX_SAFE_INTEGER)) - BigInt(CLEANUP_EPOCH)) << 22n).toString()) }
export function cleanupContext(value: unknown, now = Date.now()): CleanupContext {
    const r = shape(value, ["observedAt", "actor", "member", "channelId", "channelType", "botId", "botAuthorized", "actorAuthorized", "actorKind", "botKind", "botMember"], ["observedAt", "actor", "member", "channelId", "channelType", "botId", "botAuthorized", "actorAuthorized", "actorKind", "botKind", "botMember"])
    const observedAt = integer(r.observedAt, now - 60000, now + 1000)
    shape(r.actor, ["userId", "roleIds", "isOwner", "isAdministrator", "nativePermissionAuthorized"], ["userId", "roleIds", "isOwner", "isAdministrator", "nativePermissionAuthorized"])
    if (r.channelType !== 0 && r.channelType !== 5 || !["human", "bot", "unknown"].includes(String(r.actorKind)) || !["bot", "unknown"].includes(String(r.botKind))) fail(400, "Invalid cleanup identity")
    const context: CleanupContext = { observedAt, actor: actor(r.actor), member: eventMember(r.member, observedAt), botMember: eventMember(r.botMember, observedAt), channelId: requireId(r.channelId), channelType: r.channelType as 0 | 5, botId: requireId(r.botId), botAuthorized: bool(r.botAuthorized), actorAuthorized: bool(r.actorAuthorized), actorKind: r.actorKind as CleanupContext["actorKind"], botKind: r.botKind as CleanupContext["botKind"] }
    if (context.member.userId !== context.actor.userId || context.botMember.userId !== context.botId) fail(400, "Cleanup identity mismatch")
    return context
}
export function cleanupMessage(value: unknown, now = Date.now()): CleanupMessage {
    const keys = ["messageId", "channelId", "serverId", "observedAt", "createdAt", "authorId", "authorBot", "authorSystem", "type", "pinned", "webhookId"]
    const r = shape(value, keys, keys), nullableBool = (v: unknown) => v === null ? null : bool(v), nullableId = (v: unknown) => v === null ? null : requireId(v)
    return { messageId: requireId(r.messageId), channelId: requireId(r.channelId), serverId: nullableId(r.serverId), observedAt: integer(r.observedAt, now - 60000, now + 1000), createdAt: r.createdAt === null ? null : epoch(r.createdAt), authorId: nullableId(r.authorId), authorBot: nullableBool(r.authorBot), authorSystem: nullableBool(r.authorSystem), type: r.type === null ? null : integer(r.type, 0, 65535), pinned: nullableBool(r.pinned), webhookId: nullableId(r.webhookId) }
}
export function cleanupMessages(value: unknown, channelId: string, serverId: string, before?: string): CleanupMessage[] {
    if (!Array.isArray(value) || value.length > 50) fail(400, "Cleanup history page too large")
    const messages = value.map(x => cleanupMessage(x)), seen = new Set<string>()
    let last = before === undefined ? undefined : BigInt(requireId(before))
    for (const message of messages) {
        if (message.channelId !== channelId || message.serverId !== null && message.serverId !== serverId || seen.has(message.messageId) || last !== undefined && BigInt(message.messageId) >= last) fail(409, "Malformed cleanup history page")
        seen.add(message.messageId); last = BigInt(message.messageId)
    }
    return messages
}
export function cleanupEligibility(message: CleanupMessage, policy: Pick<CleanupPolicy, "channelId" | "excludedAuthorIds" | "excludedMessageIds">, cutoffAt: number): CleanupSkipReason | null {
    if (message.pinned === true) return "pinned"
    if (message.pinned !== false) return "pin-unknown"
    if (message.webhookId !== null) return "webhook"
    if (message.authorBot === true) return "bot"
    if (message.authorSystem === true || message.type !== null && message.type !== 0 && message.type !== 19) return "system"
    if (!message.authorId || message.authorBot !== false || message.authorSystem !== false || message.type === null) return "identity-unknown"
    if (!message.createdAt || Date.parse(message.createdAt) !== Number((BigInt(message.messageId) >> 22n) + BigInt(CLEANUP_EPOCH))) return "timestamp-unknown"
    if (Date.parse(message.createdAt) >= cutoffAt) return "too-new"
    if (policy.excludedAuthorIds.includes(message.authorId)) return "excluded-author"
    if (policy.excludedMessageIds.includes(message.messageId)) return "excluded-message"
    return null
}
export function cleanupBinding(value: unknown): CleanupSweepBinding {
    const r = shape(value, ["channelId", "policyRevision", "moduleRevision", "sweepNo"], ["channelId", "policyRevision", "moduleRevision", "sweepNo"])
    return { channelId: requireId(r.channelId), policyRevision: integer(r.policyRevision, 1, Number.MAX_SAFE_INTEGER), moduleRevision: integer(r.moduleRevision, 1, Number.MAX_SAFE_INTEGER), sweepNo: integer(r.sweepNo, 1, Number.MAX_SAFE_INTEGER) }
}
export function cleanupTargetBinding(value: unknown): CleanupTargetBinding {
    const r = shape(value, ["channelId", "policyRevision", "moduleRevision", "sweepNo", "pageNo", "targetNo", "messageId"], ["channelId", "policyRevision", "moduleRevision", "sweepNo", "pageNo", "targetNo", "messageId"])
    return { ...cleanupBinding({ channelId: r.channelId, policyRevision: r.policyRevision, moduleRevision: r.moduleRevision, sweepNo: r.sweepNo }), pageNo: integer(r.pageNo, 1, Number.MAX_SAFE_INTEGER), targetNo: integer(r.targetNo, 1, Number.MAX_SAFE_INTEGER), messageId: requireId(r.messageId) }
}
export function cleanupObservation(value: unknown, messageId: string, channelId: string): CleanupObservation {
    const r = shape(value, ["messageId", "channelId", "observedAt", "status", "channelVisible"], ["messageId", "channelId", "observedAt", "status", "channelVisible"])
    if (requireId(r.messageId) !== messageId || requireId(r.channelId) !== channelId || !["present", "absent", "unknown"].includes(String(r.status))) fail(409, "Cleanup observation mismatch")
    const observation: CleanupObservation = { messageId, channelId, observedAt: integer(r.observedAt, Date.now() - 60000, Date.now() + 1000), status: r.status as CleanupObservation["status"], channelVisible: bool(r.channelVisible) }
    if (observation.status !== "unknown" && !observation.channelVisible) fail(403, "Visible containing channel required")
    return observation
}
