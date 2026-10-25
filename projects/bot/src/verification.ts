import { errors, type Client, type MessageReference } from "@neontechspace/fluxerly/effect"
import type { VerificationReady } from "@neonflux/contracts/verification"
import { randomUUID } from "node:crypto"
import { Cause, Clock, Data, Effect, Exit } from "effect"
import type { BotConfig } from "./config.ts"
import type { RolesStore } from "./roles-store.ts"
import { VerificationStoreError, type VerificationStore } from "./verification-store.ts"
import { evaluateRoleRequest, RoleHandlingError, roleMemberContext, verifyRolePanel, withRoleMember } from "./roles.ts"
import { targetedReactionPresent } from "./role-permissions.ts"
import { verifyWelcomeMessage, verifyWelcomePrivateChannel } from "./welcome-permissions.ts"
import { code } from "./reply-style.ts"
import { serverLabel } from "./server-scope.ts"
import { readRoleAuthority, RolePermissionError, rolePermissionFix } from "./role-permissions.ts"
import { SafetyPermissionError } from "./safety-permissions.ts"
import { moderationActor } from "./moderation.ts"
import { startSignalledWorker } from "./signalled-worker.ts"
import { warnFailure } from "./contained.ts"

export class VerificationHandlingError extends Data.TaggedError("VerificationHandlingError")<{
    readonly stage: "configuration" | "panel" | "membership" | "delivery"
}> {}

export function reviewVerificationRequest(
    store: VerificationStore,
    roles: RolesStore,
    config: BotConfig,
    client: Client,
    challengeId: string,
    actorId: string,
) {
    return Effect.gen(function* () {
        const authority = yield* readRoleAuthority(client, config.serverId, actorId, { readOnly: true })
        if (!authority.isOwner && !authority.isAdmin)
            return yield* Effect.fail(new VerificationHandlingError({ stage: "configuration" }))
        const request = yield* store.request({ serverId: config.serverId, challengeId })
        const fresh = yield* roleMemberContext(client, config.serverId, request.userId, actorId)
        if (fresh.context.joinedAt !== request.joinedAt)
            return yield* Effect.fail(new VerificationHandlingError({ stage: "membership" }))
        const current = yield* roles.memberQuery({ serverId: config.serverId, context: fresh.context })
        const panel = current.panels.find(
            (panel) =>
                panel.kind === "verification" &&
                panel.name === request.panelName &&
                panel.revision === request.revision,
        )
        if (!panel) return yield* Effect.fail(new VerificationHandlingError({ stage: "panel" }))
        yield* verifyRolePanel(client, config.serverId, actorId, panel)
        return yield* store.review({
            serverId: config.serverId,
            challengeId,
            context: fresh.context,
            actor: moderationActor(fresh.authority),
            panelVerified: true,
        })
    })
}

/** The answer to a !verify review that fails. Commands print with the prefix the administrator used */
export function verificationReviewFailure(error: unknown) {
    if (error instanceof VerificationHandlingError)
        return error.stage === "configuration"
            ? "Only the server owner and Administrators can review verification"
            : error.stage === "membership"
              ? "The member left or rejoined since the link was sent. They can send !verify again"
              : "The rules panel changed since the link was sent. The member can send !verify again"
    if (error instanceof SafetyPermissionError && error.operation === "target" && error.notFound)
        return "The member left or rejoined since the link was sent. They can send !verify again"
    if (error instanceof VerificationStoreError && error.status === 404)
        return "No verification request has that reference. Check it and try again"
    if (error instanceof VerificationStoreError && error.status === 409)
        return "That request is already complete, or its member changed. Check the member with !verify reconcile @user"
    if (error instanceof VerificationStoreError && error.status === 403)
        return "Rules verification is not open right now, or the rules panel changed since the link was sent"
    return (
        (error instanceof RolePermissionError && rolePermissionFix(error)) ||
        "NeonFlux couldn't record the review. Try again in a minute"
    )
}

type LinkReply =
    "sent" | "verified" | "react-first" | "unavailable" | "refused" | "republish" | "limit" | "undelivered" | "failed"

/** The answer to !verify for each outcome of a link request. Commands print with the prefix the member used */
export const verificationLinkReplies = {
    sent: "Check your direct messages for your verification link",
    verified: "You are already verified",
    "react-first": "React to the rules panel first, then send !verify again",
    unavailable: "Verification is not open right now. Ask server staff",
    refused:
        "NeonFlux sent no new link. You may have asked a moment ago, " +
        "so check your direct messages or try again in a minute",
    republish: "The rules panel was removed or changed after it was published. Ask server staff to publish it again",
    limit: "You asked for too many verification links. Try again in an hour or ask server staff",
    undelivered:
        "NeonFlux could not send your verification link. Allow direct messages from this server, " +
        "then send !verify again in a minute. If it keeps failing, ask server staff",
    failed: "NeonFlux could not prepare your verification link. Send !verify again in a minute. If it keeps failing, ask server staff",
} as const satisfies Record<LinkReply, string>

/** The answer to a !verify link request that fails. Only a failure to reach the member's direct messages asks them to allow them */
export function verificationLinkFailure(error: unknown): LinkReply {
    if (error instanceof RoleHandlingError && (error.stage === "panel" || error.stage === "snapshot"))
        return "republish"
    if (error instanceof VerificationStoreError && error.status === 403) return "unavailable"
    if (error instanceof VerificationStoreError && error.status === 429) return "limit"
    if (error instanceof VerificationHandlingError && error.stage === "delivery") return "undelivered"
    return "failed"
}

/** Sends a member their verification link. It is the member's own role request, so callers run it in the member's line with memberRoleWork */
export function requestVerificationLink(
    store: VerificationStore,
    roles: RolesStore,
    config: BotConfig,
    client: Client,
    userId: string,
    target?: MessageReference & { guildId?: string },
) {
    return Effect.gen(function* () {
        if (target?.guildId !== undefined && target.guildId !== config.serverId) return undefined
        // A reaction is evaluated from the bot's cached copies, while the verify command reads Fluxer
        const fresh = yield* roleMemberContext(client, config.serverId, userId, userId, false, target !== undefined),
            current = yield* roles.memberQuery({ serverId: config.serverId, context: fresh.context })
        if (!current.settings.advancedVerificationEnabled) return undefined
        const panel = current.panels.find(
            (panel) =>
                panel.kind === "verification" &&
                (!target ||
                    (panel.published?.messageId === target.id && panel.published.channelId === target.channelId)),
        )
        if (!panel && target) return undefined
        if (!panel?.enabled || panel.withdrawing || !current.settings.verificationEnabled) return "unavailable" as const
        if (current.acknowledgment.acknowledged && current.acknowledgment.accessRolePresent) return "verified" as const
        if (!config.websiteUrl) return yield* Effect.fail(new VerificationHandlingError({ stage: "configuration" }))
        const snapshot = yield* verifyRolePanel(client, config.serverId, userId, panel).pipe(
            // Staff deleted the rules message or its channel
            Effect.mapError((error) =>
                errors.isNotFound(error) ||
                (error instanceof SafetyPermissionError && error.operation === "channel" && error.notFound)
                    ? new RoleHandlingError({ stage: "panel" })
                    : error,
            ),
        )
        const reactionTarget = target ?? { id: snapshot.messageId, channelId: snapshot.channelId }
        if (!(yield* targetedReactionPresent(client, reactionTarget, snapshot.mappings[0]!.emoji, userId)))
            return "react-first" as const
        const linkToken = randomUUID().replaceAll("-", "")
        const issued = yield* store.issue({
            serverId: config.serverId,
            createdAt: yield* Clock.currentTimeMillis,
            context: fresh.context,
            panelName: panel.name,
            revision: panel.revision,
            messageId: snapshot.messageId,
            panelVerified: true,
            reactionPresent: true,
            linkToken,
        })
        if (!issued.issued) return "refused" as const
        const link = new URL("/verify", config.websiteUrl)
        link.searchParams.set("token", linkToken)
        const label = yield* serverLabel(client, config.serverId)
        // Only a failure to reach the member's direct messages is answered with advice about them
        yield* Effect.gen(function* () {
            const dm = yield* client.directMessages.open(userId, { timeoutMs: 5000 })
            yield* verifyWelcomePrivateChannel(dm, userId, fresh.context.botId)
            const returned = yield* client.messages.send(
                dm.id,
                {
                    content: `Complete verification for **${label}**: ${link.href}\nThe link expires in 10 minutes. Sign in as the same account, then press Start. You have 90 seconds and two attempts. If you cannot use it, ask server staff for help with this reference\nReference: ${code(issued.challengeId!)}`,
                },
                { timeoutMs: 5000 },
            )
            yield* verifyWelcomeMessage(returned, { channelId: dm.id, botId: fresh.context.botId })
        }).pipe(Effect.mapError(() => new VerificationHandlingError({ stage: "delivery" })))
        return "sent" as const
    })
}

// Proofs stay discoverable until the member has the role or can no longer receive it. A member who left or rejoined settles
// the proof as failed, so stale proofs never block newer ones. Otherwise the role is observed after evaluation, which also
// finishes a proof whose grant was reserved before a restart
export function processVerificationRequest(
    store: VerificationStore,
    roles: RolesStore,
    config: BotConfig,
    client: Client,
    request: VerificationReady,
) {
    return withRoleMember(
        client,
        request.userId,
        Effect.gen(function* () {
            const settle = (outcome: "succeeded" | "failed") =>
                store.delivery({ serverId: config.serverId, challengeId: request.challengeId, outcome })
            const member = yield* Effect.exit(roleMemberContext(client, config.serverId, request.userId))
            // Only a missing membership of the human counts as departed. Other missing reads, such as the bot's own member, are retried
            if (
                (Exit.isFailure(member) &&
                    member.cause.reasons.some(
                        (reason) =>
                            reason._tag === "Fail" &&
                            reason.error instanceof SafetyPermissionError &&
                            reason.error.operation === "actor" &&
                            reason.error.notFound,
                    )) ||
                (Exit.isSuccess(member) && member.value.context.joinedAt !== request.joinedAt)
            )
                return yield* settle("failed")
            const fresh = yield* member
            const current = yield* roles.memberQuery({ serverId: config.serverId, context: fresh.context })
            const panel = current.panels.find(
                (panel) =>
                    panel.kind === "verification" &&
                    panel.name === request.panelName &&
                    panel.revision === request.revision &&
                    panel.published?.messageId === request.messageId,
            )
            if (!panel) return yield* Effect.fail(new VerificationHandlingError({ stage: "panel" }))
            yield* verifyRolePanel(client, config.serverId, request.userId, panel)
            const claimed = yield* store.claim({
                serverId: config.serverId,
                challengeId: request.challengeId,
                context: fresh.context,
                panelVerified: true,
            })
            if (!claimed.claimed) return
            const applied = yield* Effect.exit(
                evaluateRoleRequest(
                    roles,
                    config.serverId,
                    client,
                    { sourceId: claimed.sourceId!, createdAt: claimed.createdAt! },
                    request.userId,
                    {
                        type: "verify",
                        name: panel.name,
                        revision: panel.revision,
                        messageId: request.messageId,
                        panelVerified: true,
                        reactionPresent: true,
                    },
                    request.userId,
                    false,
                    request.joinedAt,
                ),
            )
            if (Exit.isFailure(applied) && Cause.hasInterrupts(applied.cause))
                return yield* Effect.failCause(applied.cause)
            // The proof stays discoverable until the autoroles it unlocks are applied
            if (Exit.isSuccess(applied) && applied.value.autoroleFailed)
                return yield* Effect.fail(new VerificationHandlingError({ stage: "delivery" }))
            const after = yield* roleMemberContext(client, config.serverId, request.userId)
            if (
                after.context.joinedAt === request.joinedAt &&
                panel.mappings.every((mapping) => after.context.roleIds.includes(mapping.roleId))
            )
                yield* settle("succeeded")
        }),
        config.serverId,
    )
}

export function startVerificationWorker(
    store: VerificationStore,
    roles: RolesStore,
    config: BotConfig,
    client: Client,
) {
    const pass = Effect.gen(function* () {
        const ready = yield* store.ready({ serverId: config.serverId })
        for (const request of ready.requests)
            yield* processVerificationRequest(store, roles, config, client, request).pipe(
                Effect.catchCause((cause) =>
                    Cause.hasInterrupts(cause)
                        ? Effect.failCause(cause)
                        : warnFailure(
                              "Advanced verification access could not be confirmed yet. It is retried until the proof expires",
                              cause,
                          ),
                ),
            )
    })
    // The work dispatcher wakes this worker when the backend holds solved proofs for this server
    return Effect.gen(function* () {
        const { wake } = yield* startSignalledWorker(
            pass,
            Effect.logWarning("Advanced verification worker paused this pass"),
        )
        return { notify: () => wake }
    })
}
