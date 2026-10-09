import type { Client, MessageReference } from "@neontechspace/fluxerly/effect"
import type { VerificationReady } from "@neonflux/backend/verification-contracts"
import { randomUUID } from "node:crypto"
import { Cause, Clock, Data, Effect, Exit, Queue } from "effect"
import type { BotConfig } from "./config.ts"
import type { RolesStore } from "./roles-store.ts"
import type { VerificationStore } from "./verification-store.ts"
import { evaluateRoleRequest, roleMemberContext, verifyRolePanel, withRoleMember } from "./roles.ts"
import { targetedReactionPresent } from "./role-permissions.ts"
import { verifyWelcomeMessage, verifyWelcomePrivateChannel } from "./welcome-permissions.ts"
import { noMentions } from "./responses.ts"
import { readRoleAuthority } from "./role-permissions.ts"
import { SafetyPermissionError } from "./safety-permissions.ts"
import { moderationActor } from "./moderation.ts"

export class VerificationHandlingError extends Data.TaggedError("VerificationHandlingError")<{ readonly stage: "configuration" | "panel" | "membership" | "delivery" }> {}

export function reviewVerificationRequest(store: VerificationStore, roles: RolesStore, config: BotConfig, client: Client, challengeId: string, actorId: string) {
    return Effect.gen(function* () {
        const authority = yield* readRoleAuthority(client, config.serverId, actorId, { readOnly: true })
        if (!authority.isOwner && !authority.isAdmin) return yield* Effect.fail(new VerificationHandlingError({ stage: "configuration" }))
        const request = yield* store.request({ serverId: config.serverId, challengeId })
        const fresh = yield* roleMemberContext(client, config.serverId, request.userId, actorId)
        if (fresh.context.joinedAt !== request.joinedAt) return yield* Effect.fail(new VerificationHandlingError({ stage: "membership" }))
        const current = yield* roles.memberQuery({ serverId: config.serverId, context: fresh.context })
        const panel = current.panels.find(panel => panel.kind === "verification" && panel.name === request.panelName && panel.revision === request.revision)
        if (!panel) return yield* Effect.fail(new VerificationHandlingError({ stage: "panel" }))
        yield* verifyRolePanel(client, config.serverId, actorId, panel)
        return yield* store.review({ serverId: config.serverId, challengeId, context: fresh.context, actor: moderationActor(fresh.authority), panelVerified: true })
    })
}

export function requestVerificationLink(store: VerificationStore, roles: RolesStore, config: BotConfig, client: Client, userId: string, target?: MessageReference & { guildId?: string }) {
    return withRoleMember(client, userId, Effect.gen(function* () {
        if (target?.guildId !== undefined && target.guildId !== config.serverId) return false
        const fresh = yield* roleMemberContext(client, config.serverId, userId), current = yield* roles.memberQuery({ serverId: config.serverId, context: fresh.context })
        if (!current.settings.advancedVerificationEnabled) return false
        const panel = current.panels.find(panel => panel.kind === "verification" && (!target || panel.published?.messageId === target.id && panel.published.channelId === target.channelId))
        if (!panel && target) return false
        if (!panel?.enabled || panel.withdrawing || !current.settings.verificationEnabled) return true
        if (!config.websiteUrl) return yield* Effect.fail(new VerificationHandlingError({ stage: "configuration" }))
        const snapshot = yield* verifyRolePanel(client, config.serverId, userId, panel)
        const reactionTarget = target ?? { id: snapshot.messageId, channelId: snapshot.channelId }
        if (!(yield* targetedReactionPresent(client, reactionTarget, snapshot.mappings[0]!.emoji, userId))) return true
        const linkToken = randomUUID().replaceAll("-", "")
        const issued = yield* store.issue({ serverId: config.serverId, sourceId: `reaction_${randomUUID().replaceAll("-", "")}`, createdAt: yield* Clock.currentTimeMillis,
            context: fresh.context, panelName: panel.name, revision: panel.revision, messageId: snapshot.messageId, panelVerified: true, reactionPresent: true, linkToken })
        if (!issued.issued) return true
        const link = new URL("/verify", config.websiteUrl)
        link.searchParams.set("token", linkToken)
        const dm = yield* client.directMessages.open(userId, { timeoutMs: 5000 })
        yield* verifyWelcomePrivateChannel(dm, userId, fresh.context.botId)
        const returned = yield* client.messages.send(dm.id, { content: `Complete verification for server ${config.serverId}: ${link.href}\nThis link expires in 10 minutes. Sign in as the same account, then press Start. You have 90 seconds and two attempts. The custom visual challenge is experimental. If you cannot use it, contact server staff and give request ${issued.challengeId}`, allowedMentions: noMentions }, { timeoutMs: 5000 })
        yield* verifyWelcomeMessage(returned, { channelId: dm.id, botId: fresh.context.botId })
        return true
    }), config.serverId)
}

// Proofs stay discoverable until the member has the role or can no longer receive it. A member who left or rejoined settles
// the proof as failed, so stale proofs never block newer ones. Otherwise the role is observed after evaluation, which also
// finishes a proof whose grant was reserved before a restart
export function processVerificationRequest(store: VerificationStore, roles: RolesStore, config: BotConfig, client: Client, request: VerificationReady) {
    return withRoleMember(client, request.userId, Effect.gen(function* () {
        const settle = (outcome: "succeeded" | "failed") => store.delivery({ serverId: config.serverId, challengeId: request.challengeId, outcome })
        const member = yield* Effect.exit(roleMemberContext(client, config.serverId, request.userId))
        // Only a missing membership of the human counts as departed. Other missing reads, such as the bot's own member, are retried
        if (Exit.isFailure(member) && member.cause.reasons.some(reason => reason._tag === "Fail" && reason.error instanceof SafetyPermissionError && reason.error.operation === "actor" && (reason.error.kind === "notFound" || reason.error.status === 404))
            || Exit.isSuccess(member) && member.value.context.joinedAt !== request.joinedAt) return yield* settle("failed")
        const fresh = yield* member
        const current = yield* roles.memberQuery({ serverId: config.serverId, context: fresh.context })
        const panel = current.panels.find(panel => panel.kind === "verification" && panel.name === request.panelName && panel.revision === request.revision && panel.published?.messageId === request.messageId)
        if (!panel) return yield* Effect.fail(new VerificationHandlingError({ stage: "panel" }))
        yield* verifyRolePanel(client, config.serverId, request.userId, panel)
        const claimed = yield* store.claim({ serverId: config.serverId, challengeId: request.challengeId, claimToken: randomUUID().replaceAll("-", ""), context: fresh.context, panelVerified: true })
        if (!claimed.claimed) return
        const applied = yield* Effect.exit(evaluateRoleRequest(roles, config.serverId, client,
            { sourceId: claimed.sourceId!, createdAt: claimed.createdAt! }, request.userId,
            { type: "verify", name: panel.name, revision: panel.revision, messageId: request.messageId, panelVerified: true, reactionPresent: true }, request.userId, false, request.joinedAt))
        if (Exit.isFailure(applied) && Cause.hasInterrupts(applied.cause)) return yield* Effect.failCause(applied.cause)
        // The proof stays discoverable until the autoroles it unlocks are applied
        if (Exit.isSuccess(applied) && applied.value.autoroleFailed) return yield* Effect.fail(new VerificationHandlingError({ stage: "delivery" }))
        const after = yield* roleMemberContext(client, config.serverId, request.userId)
        if (after.context.joinedAt === request.joinedAt && panel.mappings.every(mapping => after.context.roleIds.includes(mapping.roleId))) yield* settle("succeeded")
    }), config.serverId)
}

export function startVerificationWorker(store: VerificationStore, roles: RolesStore, config: BotConfig, client: Client) {
    const pass = Effect.gen(function* () {
        const ready = yield* store.ready({ serverId: config.serverId })
        for (const request of ready.requests) yield* processVerificationRequest(store, roles, config, client, request).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause)
            ? Effect.failCause(cause) : Effect.logWarning("Advanced verification access could not be confirmed yet. It is retried until the proof expires")))
    })
    // The work dispatcher wakes this worker when the backend holds solved proofs for this server
    return Effect.gen(function* () {
        const queue = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" }), notify = () => Queue.offer(queue, undefined).pipe(Effect.asVoid)
        yield* Effect.forever(Queue.take(queue).pipe(Effect.andThen(pass), Effect.catchCause(cause => Cause.hasInterrupts(cause)
            ? Effect.failCause(cause) : Effect.logWarning("Advanced verification worker paused this pass")))).pipe(Effect.forkScoped({ startImmediately: true }))
        return { notify }
    })
}
