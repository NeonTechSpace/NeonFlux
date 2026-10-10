import type * as C from "@neonflux/backend/contracts"
import { GuildOperationError, type Client, type MessageReference } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Exit, Semaphore } from "effect"
import { createHash, randomUUID } from "node:crypto"
import { moderationActor } from "./moderation.ts"
import { readRoleAuthority, targetedReactionPresent } from "./role-permissions.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { canonicalPublishingContent, equalPublishingContent, publishingMessageContent } from "./publishing-content.ts"
import { verifyPublishingMessage } from "./publishing-permissions.ts"
import type { RolesStore } from "./roles-store.ts"
import { noMentions } from "./responses.ts"
import { readNativeMember } from "./member-evidence.ts"
import { replyPrefix } from "./general-settings.ts"

export class RoleHandlingError extends Data.TaggedError("RoleHandlingError")<{ readonly stage: "identity" | "eligibility" | "snapshot" | "claim" | "panel" }> {}
export const roleEventSource = (kind: string, ...values: string[]) => `${kind}_${createHash("sha256").update(values.join("\u0000")).digest("hex")}`
const memberWork = new WeakMap<Client, Map<string, { lock: Semaphore.Semaphore, users: number }>>()
export function withRoleMember<A, E, R>(client: Client, userId: string, work: Effect.Effect<A, E, R>, serverId = "legacy") {
    const key = `${serverId}:${userId}`
    return Effect.acquireUseRelease(Effect.sync(() => {
        let pending = memberWork.get(client)
        if (!pending) { pending = new Map(); memberWork.set(client, pending) }
        let entry = pending.get(key)
        if (!entry) { entry = { lock: Semaphore.makeUnsafe(1), users: 0 }; pending.set(key, entry) }
        entry.users++
        return { pending, entry }
    }), ({ entry }) => entry.lock.withPermit(work), ({ pending, entry }) => Effect.sync(() => {
        entry.users--
        if (entry.users === 0) pending.delete(key)
    }))
}
export function roleSnapshots(authority: Effect.Success<ReturnType<typeof readRoleAuthority>>): C.RolesRoleSnapshot[] {
    return authority.roleSnapshots.filter((role) => role.roleId !== authority.guild.id)
}

/** The member context the backend evaluates. A reaction passes cached to read the bot's cached copies, since every grant reads Fluxer again */
export function roleMemberContext(client: Client, serverId: string, userId: string, actorId = userId, allowBotTarget = false, cached = false) {
    return Effect.gen(function* () {
        const authority = yield* readRoleAuthority(client, serverId, actorId, { targetId: userId, allowBotTarget, readOnly: true, cached })
        const member = authority.target ?? authority.actor
        if (member.userId !== userId || member.guildId !== serverId || member.communicationDisabledUntil === undefined) {
            return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
        }
        const context: C.RolesMemberContext & { originServerId: string } = { originServerId: member.guildId, userId, joinedAt: member.joinedAt, roleIds: [...member.roleIds], isBot: member.isBot,
            timeoutUntil: member.communicationDisabledUntil, botId: authority.botId, botAuthorized: authority.botPermissionAuthorized,
            roles: roleSnapshots(authority) }
        return { authority, context }
    })
}

export function verifyRolePanel(client: Client, serverId: string, userId: string, panel: C.RolesPanel) {
    return Effect.gen(function* () {
        const snapshot = panel.published
        if (!snapshot || snapshot.revision !== panel.revision) return yield* Effect.fail(new RoleHandlingError({ stage: "panel" }))
        const authority = yield* readSafetyAuthority(client, serverId, userId, { channelId: snapshot.channelId })
        if (!authority.channel || authority.botId !== snapshot.botId) return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
        const message = yield* client.messages.fetch({ id: snapshot.messageId, channelId: snapshot.channelId }, { timeoutMs: 5000 })
        yield* verifyPublishingMessage(message, { serverId, channelId: snapshot.channelId, messageId: snapshot.messageId, botId: snapshot.botId, verifiedChannel: authority.channel })
        const content = publishingMessageContent(message)
        if (!content || !equalPublishingContent(content, canonicalPublishingContent(snapshot.content))) return yield* Effect.fail(new RoleHandlingError({ stage: "snapshot" }))
        return snapshot
    })
}

export function performRoleGrant(store: RolesStore, serverId: string, client: Client, grant: C.RolesGrant, actorId = grant.userId, allowBotTarget = false) {
    return Effect.gen(function* () {
        const token = randomUUID().replaceAll("-", "")
        let claimRequested = false, ownsClaim = false, invoked = false
        const operation = Effect.gen(function* () {
            if (!["add", "remove"].includes(grant.action) || grant.nativeDeadlineMs !== 5000 || grant.expectedPresent !== (grant.action === "remove")
                || (yield* Clock.currentTimeMillis) >= grant.dispatchExpiresAt) return yield* Effect.fail(new RoleHandlingError({ stage: "claim" }))
            const fresh = yield* readRoleAuthority(client, serverId, actorId, { targetId: grant.userId, roleIds: [grant.roleId], allowBotTarget,
                configuration: actorId !== grant.userId })
            const member = fresh.target ?? fresh.actor
            const now = yield* Clock.currentTimeMillis
            if (fresh.botId !== grant.botId || member.joinedAt !== grant.joinedAt || member.roleIds.includes(grant.roleId) !== grant.expectedPresent
                || fresh.bot.communicationDisabledUntil === undefined || fresh.bot.communicationDisabledUntil !== null && Date.parse(fresh.bot.communicationDisabledUntil) > now
                || grant.action === "add" && (member.communicationDisabledUntil === undefined || member.communicationDisabledUntil !== null && Date.parse(member.communicationDisabledUntil) > now)) {
                return yield* Effect.fail(new RoleHandlingError({ stage: "snapshot" }))
            }
            claimRequested = true
            const context: C.RolesMemberContext = { originServerId: member.guildId, userId: member.userId, joinedAt: member.joinedAt, roleIds: [...member.roleIds], isBot: member.isBot,
                timeoutUntil: member.communicationDisabledUntil ?? null, botId: fresh.botId, botAuthorized: fresh.botPermissionAuthorized, roles: roleSnapshots(fresh) }
            const claimed = yield* store.dispatch({ serverId, attemptId: grant.attemptId, ownershipId: grant.ownershipId, generation: grant.generation, sourceId: grant.sourceId, claimToken: token, context,
                ...(actorId !== grant.userId || fresh.isOwner || fresh.isAdmin ? { actor: moderationActor(fresh) } : {}) })
            if (!claimed.claimed || claimed.dispatchExpiresAt !== grant.dispatchExpiresAt || claimed.nativeDeadlineMs !== 5000) return yield* Effect.fail(new RoleHandlingError({ stage: "claim" }))
            ownsClaim = true
            if ((yield* Clock.currentTimeMillis) >= grant.dispatchExpiresAt) return yield* Effect.fail(new RoleHandlingError({ stage: "claim" }))
            invoked = true
            const target = { guildId: serverId, userId: grant.userId }
            const options = { timeoutMs: 5000, auditReason: "Managed role request" }
            // A confirmed native write is the outcome, a failed readback must not lock the role
            if (grant.action === "add") yield* client.members.addRole(target, grant.roleId, options)
            else yield* client.members.removeRole(target, grant.roleId, options)
        })
        const result = yield* Effect.exit(operation)
        if (Exit.isFailure(result) && Cause.hasInterrupts(result.cause)) return yield* Effect.failCause(result.cause)
        if (!ownsClaim && claimRequested) return { outcome: "uncertain" as const, acknowledged: false }
        const notDispatched = Exit.isFailure(result) && result.cause.reasons.length > 0 && result.cause.reasons.every((reason) =>
            reason._tag === "Fail" && reason.error instanceof GuildOperationError && reason.error.outcome === "notDispatched")
        const outcome = Exit.isSuccess(result) ? "succeeded" : invoked && !notDispatched ? "uncertain" : "failed"
        const acknowledged = yield* store.outcome({ serverId, attemptId: grant.attemptId, ownershipId: grant.ownershipId, generation: grant.generation,
            sourceId: grant.sourceId, outcome, ...(ownsClaim ? { claimToken: token } : {}) }).pipe(Effect.match({ onFailure: () => false, onSuccess: (v) => v.recorded }))
        return { outcome, acknowledged }
    })
}

function applyRoleRequest(store: RolesStore, serverId: string, client: Client, source: C.RolesSource, userId: string,
    operation: C.RolesEvaluateOperation, actorId = userId, allowBotTarget = false, expectedJoinedAt?: string,
    reactionJob?: C.RolesReactionJobBinding, initial?: Effect.Success<ReturnType<typeof roleMemberContext>>) {
    return Effect.gen(function* () {
        let continuationAttemptId: string | undefined
        let result: C.RolesEvaluateResult | undefined
        let outcome: Awaited<Effect.Success<ReturnType<typeof performRoleGrant>>> | undefined
        // One operation can release an exclusive choice, then grant its replacement.
        // Joins combine at most twenty default roles and twenty reserved roles.
        for (let index = 0; index < (operation.type === "join" ? 41 : 21); index++) {
            const fresh = index === 0 && initial ? initial : yield* roleMemberContext(client, serverId, userId, actorId, allowBotTarget)
            if (expectedJoinedAt !== undefined && fresh.context.joinedAt !== expectedJoinedAt) return yield* Effect.fail(new RoleHandlingError({ stage: "snapshot" }))
            result = yield* store.evaluate({ ...source, serverId, context: fresh.context, operation, ...(continuationAttemptId ? { continuationAttemptId } : {}),
                ...(reactionJob ? { reactionJob } : {}),
                ...(actorId !== userId || fresh.authority.isOwner || fresh.authority.isAdmin ? { actor: moderationActor(fresh.authority) } : {}) })
            if (!result.grant) break
            outcome = yield* performRoleGrant(store, serverId, client, result.grant, actorId, allowBotTarget)
            if (outcome.outcome !== "succeeded" || !outcome.acknowledged) break
            continuationAttemptId = result.grant.attemptId
        }
        return { result: result!, ...(outcome ? { outcome } : {}) }
    })
}

export function evaluateRoleRequest(store: RolesStore, serverId: string, client: Client, source: C.RolesSource, userId: string,
    operation: C.RolesEvaluateOperation, actorId = userId, allowBotTarget = false, expectedJoinedAt?: string,
    reactionJob?: C.RolesReactionJobBinding, initial?: Effect.Success<ReturnType<typeof roleMemberContext>>) {
    return Effect.gen(function* () {
        const applied = yield* applyRoleRequest(store, serverId, client, source, userId, operation, actorId, allowBotTarget, expectedJoinedAt, reactionJob, initial)
        // Verification unlocks the autoroles that a gated join could not grant, and a redelivered verification retries them
        if (operation.type === "verify" && (applied.result.status === "acknowledged" || applied.result.duplicate && applied.result.acknowledgment.acknowledged)) {
            const autorole = yield* Effect.exit(applyRoleRequest(store, serverId, client, { sourceId: roleEventSource("autorole", source.sourceId), createdAt: source.createdAt },
                userId, { type: "join" }, userId, false, expectedJoinedAt))
            if (Exit.isFailure(autorole)) {
                if (Cause.hasInterrupts(autorole.cause)) return yield* Effect.failCause(autorole.cause)
                return { ...applied, autoroleFailed: true as const }
            }
        }
        return { ...applied, autoroleFailed: false as const }
    })
}

export function handleRoleReaction(store: RolesStore, serverId: string, client: Client, target: MessageReference & { guildId?: string }, userId: string, expectedJoinedAt?: string,
    job?: { binding: C.RolesReactionJobBinding, source: C.RolesSource }) {
    return withRoleMember(client, userId, Effect.gen(function* () {
        if (target.guildId !== undefined && target.guildId !== serverId) return false
        // A live reaction is evaluated from the bot's cached copies. Reconciliation jobs and every grant read Fluxer
        const cached = job === undefined
        const evidence = yield* readNativeMember(client, serverId, userId, { allowAbsent: job !== undefined, cached })
        const native = evidence.member
        if (job && (!native || native.joinedAt !== expectedJoinedAt)) {
            yield* store.reactionJobs({ serverId, operation: { type: "skip", binding: job.binding, originServerId: evidence.originServerId, memberUserId: evidence.userId,
                observedAt: yield* Clock.currentTimeMillis, currentJoinedAt: native?.joinedAt ?? null } })
            return true
        }
        if (!native || native.isBot) return false
        const fresh = yield* roleMemberContext(client, serverId, userId, userId, false, cached), context = fresh.context
        if (expectedJoinedAt !== undefined && context.joinedAt !== expectedJoinedAt) {
            if (job) yield* store.reactionJobs({ serverId, operation: { type: "skip", binding: job.binding, originServerId: context.originServerId, memberUserId: context.userId,
                observedAt: yield* Clock.currentTimeMillis, currentJoinedAt: context.joinedAt } })
            return true
        }
        const member = yield* store.memberQuery({ serverId, context })
        const panel = member.panels.find((p) => p.published?.messageId === target.id && p.published.channelId === target.channelId)
        // The backend binds the published message, so a reaction needs no message or permission re-read
        const snapshot = panel?.published
        if (!panel || !snapshot || snapshot.revision !== panel.revision || !panel.enabled || panel.withdrawing) return !job
        const presentEmojis: string[] = []
        for (const mapping of snapshot.mappings) if (yield* targetedReactionPresent(client, target, mapping.emoji, userId)) presentEmojis.push(mapping.emoji)
        const source: C.RolesSource = job?.source ?? { sourceId: `reaction_${randomUUID().replaceAll("-", "")}`, createdAt: yield* Clock.currentTimeMillis }
        const operation: C.RolesEvaluateOperation = panel.kind === "verification"
            ? { type: "verify", name: panel.name, revision: panel.revision, messageId: target.id, panelVerified: true, reactionPresent: presentEmojis.includes(snapshot.mappings[0]?.emoji ?? "") }
            : { type: "reaction", name: panel.name, revision: panel.revision, messageId: target.id, presentEmojis, panelVerified: true }
        if (!job && panel.kind === "verification" && !presentEmojis.includes(snapshot.mappings[0]?.emoji ?? "")) return true
        const applied = yield* evaluateRoleRequest(store, serverId, client, source, userId, operation, userId, false, context.joinedAt, job?.binding, fresh)
        if (applied.result.status === "ambiguous" && !applied.result.duplicate) yield* client.messages.send(snapshot.channelId,
            { content: `Current reactions on ${panel.name} contain multiple exclusive choices. Use ${replyPrefix(serverId, serverId)}roles choose ${panel.name} <emoji> to select one current mapping`, allowedMentions: noMentions }, { timeoutMs: 5000 })
        return applied.result.status !== "blocked" && (!applied.outcome || applied.outcome.outcome === "succeeded" && applied.outcome.acknowledged)
    }), serverId)
}

export function handleRoleJoin(store: RolesStore, serverId: string, client: Client, userId: string, eventJoinedAt: string) {
    return withRoleMember(client, userId, Effect.gen(function* () {
        const createdAt = Date.parse(eventJoinedAt), now = yield* Clock.currentTimeMillis
        if (!Number.isFinite(createdAt) || createdAt > now + 60000 || createdAt < now - 900000) return
        const policy = yield* store.policy({ serverId })
        if (!policy.settings.autoroleEnabled && !policy.settings.verificationEnabled) return
        const target = yield* client.members.fetch({ guildId: serverId, userId }, { timeoutMs: 5000 })
        if (target.joinedAt !== eventJoinedAt) return
        if (target.isBot && policy.settings.humansOnly) return
        // A configured bot autorole is a server policy, never a bot-authored staff command.
        const actorId = target.isBot ? (yield* client.guilds.fetch(serverId, { timeoutMs: 5000 })).ownerId : userId
        const fresh = yield* roleMemberContext(client, serverId, userId, actorId, target.isBot)
        if (fresh.context.joinedAt !== eventJoinedAt) return
        const current = yield* store.memberQuery({ serverId, context: fresh.context })
        if (target.isBot && current.settings.humansOnly) return
        const verification = current.panels.find((p) => p.kind === "verification" && p.enabled && p.published?.revision === p.revision)
        if (!target.isBot && current.settings.verificationEnabled && !current.settings.advancedVerificationEnabled && verification?.published) {
            const snapshot = yield* verifyRolePanel(client, serverId, userId, verification)
            if (snapshot.mappings[0] && (yield* targetedReactionPresent(client, { id: snapshot.messageId, channelId: snapshot.channelId }, snapshot.mappings[0].emoji, userId))) {
                yield* evaluateRoleRequest(store, serverId, client,
                    { sourceId: roleEventSource("joinverify", userId, fresh.context.joinedAt, snapshot.messageId), createdAt }, userId,
                    { type: "verify", name: verification.name, revision: verification.revision, messageId: snapshot.messageId, panelVerified: true, reactionPresent: true }, userId, false, eventJoinedAt)
            }
        }
        if (current.settings.autoroleEnabled) yield* evaluateRoleRequest(store, serverId, client,
            { sourceId: roleEventSource("join", userId, fresh.context.joinedAt), createdAt }, userId, { type: "join" }, actorId, target.isBot, eventJoinedAt)
    }), serverId)
}
