import {
    ROLES_AUTOROLES,
    type RolesEvaluateOperation,
    type RolesEvaluateResult,
    type RolesGrant,
    type RolesPanel,
    type RolesReactionJobBinding,
    type RolesSource,
} from "@neonflux/contracts/roles"
import { ROLE_PICKER_MENU_ROLES } from "@neonflux/contracts/role-picker"
import type { ModerationActor, RolesMemberContext, RolesRoleSnapshot } from "@neonflux/contracts/shared"
import { errors, format, type Client, type MessageReference, type ReactionEmoji } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { createHash, randomUUID } from "node:crypto"
import { moderationActor } from "./moderation.ts"
import { readRoleAuthority, targetedReactionPresent } from "./role-permissions.ts"
import { memberTimeout, readSafetyAuthority, SafetyPermissionError } from "./safety-permissions.ts"
import { canonicalPublishingContent, equalPublishingContent } from "@neonflux/contracts/publishing-base"
import { publishingMessageContent } from "./publishing-content.ts"
import { verifyPublishingMessage } from "./publishing-permissions.ts"
import { RolesStoreError, type RolesStore } from "./roles-store.ts"
import { readNativeMember } from "./member-evidence.ts"
import { replyPrefix } from "./general-settings.ts"
import { code } from "./reply-style.ts"
import { warnFailure } from "./contained.ts"

export class RoleHandlingError extends Data.TaggedError("RoleHandlingError")<{
    readonly stage: "identity" | "eligibility" | "snapshot" | "claim" | "panel"
}> {}
export const roleEventSource = (kind: string, ...values: string[]) =>
    `${kind}_${createHash("sha256").update(values.join("\u0000")).digest("hex")}`
// A line of work that runs one at a time in the order it came. Ending a turn hands the line to the next waiting work, so work that takes
// the line again right after, such as a long pass's next round, waits behind the work that was already waiting
type Turn = { granted: boolean; done: boolean; wake?: () => void }
const workLines = new WeakMap<Client, Map<string, { held: boolean; waiting: Turn[] }>>()
/** Takes a place in a line at once. take waits for the turn, and release ends the turn or leaves the line, once */
function enterLine(client: Client, key: string) {
    let lines = workLines.get(client)
    if (!lines) workLines.set(client, (lines = new Map()))
    let line = lines.get(key)
    if (!line) lines.set(key, (line = { held: false, waiting: [] }))
    const turn: Turn = { granted: !line.held, done: false }
    if (turn.granted) line.held = true
    else line.waiting.push(turn)
    const take = Effect.callback<void>((resume) => {
        if (turn.granted) return resume(Effect.void)
        turn.wake = () => resume(Effect.void)
        return Effect.sync(() => delete turn.wake)
    })
    const release = () => {
        if (turn.done) return
        turn.done = true
        if (!turn.granted) {
            line.waiting.splice(line.waiting.indexOf(turn), 1)
            return
        }
        const next = line.waiting.shift()
        if (next) {
            next.granted = true
            next.wake?.()
        } else {
            line.held = false
            lines.delete(key)
        }
    }
    return { granted: turn.granted, take, release }
}
const inLine = <A, E, R>(client: Client, key: string, work: Effect.Effect<A, E, R>) =>
    Effect.uninterruptibleMask((restore) =>
        Effect.suspend(() => {
            const turn = enterLine(client, key)
            return restore(Effect.andThen(turn.take, work)).pipe(Effect.ensuring(Effect.sync(turn.release)))
        }),
    )
/** Runs a member's role work after their earlier role work, in the order it came */
export function withRoleMember<A, E, R>(
    client: Client,
    userId: string,
    work: Effect.Effect<A, E, R>,
    serverId: string,
) {
    return inLine(client, `${serverId}:${userId}`, work)
}
// Each server's long role work waits for the work before it, and its server runtime's scope owns it once setup registered that scope
const roleLines = new WeakMap<Client, Map<string, { scope?: Scope.Scope; tail?: Deferred.Deferred<void> }>>()
const roleLine = (client: Client, serverId: string) => {
    let servers = roleLines.get(client)
    if (!servers) roleLines.set(client, (servers = new Map()))
    let line = servers.get(serverId)
    if (!line) servers.set(serverId, (line = {}))
    return line
}
/** Ties a server's role work to the current scope, its runtime's, so retiring the server stops the work */
export const ownRoleWork = (client: Client, serverId: string) =>
    Effect.gen(function* () {
        roleLine(client, serverId).scope = yield* Effect.scope
        yield* Effect.addFinalizer(() => Effect.sync(() => roleLines.get(client)?.delete(serverId)))
    })
/**
 * Runs a server's long role work, such as a join's autoroles or a member's withdrawal, beside the event handlers, which run one at a time, so
 * no later join or command waits for it. The work runs one at a time in the order it came, so one pass never pushes another's member reads past
 * their deadlines. It is a client task, so a stop lets running work finish first. A restart forgets work that has not finished
 */
export function backgroundRoleWork(client: Client, serverId: string, work: Effect.Effect<void, unknown>) {
    return Effect.suspend(() => {
        const line = roleLine(client, serverId),
            previous = line.tail,
            done = Deferred.makeUnsafe<void>(),
            owner = line.scope
        line.tail = done
        const release = Effect.sync(() => {
            Deferred.doneUnsafe(done, Effect.void)
            if (line.tail === done) delete line.tail
        })
        const run = (previous ? Deferred.await(previous) : Effect.void).pipe(Effect.andThen(work))
        return client
            .schedule(
                (owner ? run.pipe(Effect.forkIn(owner), Effect.flatMap(Fiber.join)) : run).pipe(
                    Effect.ensuring(release),
                ),
            )
            .pipe(
                // The client refuses new tasks once it is stopping
                Effect.catchCause((cause) =>
                    release.pipe(
                        Effect.andThen(
                            Cause.hasInterrupts(cause)
                                ? Effect.failCause(cause)
                                : warnFailure("Role work did not start because the bot is stopping", cause),
                        ),
                    ),
                ),
            )
    }).pipe(Effect.asVoid)
}
/**
 * Runs a member's own role request from an event, such as a panel reaction, !roles choose or !verify, beside the event handlers, so no later
 * event waits for it. It takes its place in the member's line at once, so it runs after the member's earlier role work and requests, in the
 * order they came, and holds it while it runs. Then it waits only for the server's earlier requests of this kind, which run one at a time as
 * their handlers did, never for another member's autorole pass. waiting runs first when the member's line is busy. Like the server's
 * background role work it is a client task owned by the server runtime's scope
 */
export function memberRoleWork(
    client: Client,
    serverId: string,
    userId: string,
    work: Effect.Effect<void, unknown>,
    waiting: Effect.Effect<unknown, unknown> = Effect.void,
) {
    return Effect.uninterruptibleMask(() =>
        Effect.suspend(() => {
            const turn = enterLine(client, `${serverId}:${userId}`),
                owner = roleLine(client, serverId).scope,
                release = Effect.sync(turn.release)
            const run = (turn.granted ? Effect.void : Effect.ignore(waiting)).pipe(
                Effect.andThen(turn.take),
                Effect.andThen(inLine(client, `self:${serverId}`, work)),
            )
            return client
                .schedule(
                    (owner ? run.pipe(Effect.forkIn(owner), Effect.flatMap(Fiber.join)) : run).pipe(
                        Effect.ensuring(release),
                    ),
                )
                .pipe(
                    // The client refuses new tasks once it is stopping
                    Effect.catchCause((cause) =>
                        release.pipe(
                            Effect.andThen(
                                Cause.hasInterrupts(cause)
                                    ? Effect.failCause(cause)
                                    : warnFailure("A role request did not start because the bot is stopping", cause),
                            ),
                        ),
                    ),
                )
        }),
    ).pipe(Effect.asVoid)
}
export function roleSnapshots(authority: Effect.Success<ReturnType<typeof readRoleAuthority>>): RolesRoleSnapshot[] {
    return authority.roleSnapshots.filter((role) => role.roleId !== authority.guild.id)
}

/** The member context the backend evaluates. A reaction passes cached to read the bot's cached copies, since every grant reads Fluxer again */
export function roleMemberContext(
    client: Client,
    serverId: string,
    userId: string,
    actorId = userId,
    allowBotTarget = false,
    cached = false,
) {
    return Effect.gen(function* () {
        const authority = yield* readRoleAuthority(client, serverId, actorId, {
            targetId: userId,
            allowBotTarget,
            readOnly: true,
            cached,
        })
        const member = authority.target ?? authority.actor
        if (
            member.userId !== userId ||
            member.guildId !== serverId ||
            member.communicationDisabledUntil === undefined
        ) {
            return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
        }
        const context: RolesMemberContext & { originServerId: string } = {
            originServerId: member.guildId,
            userId,
            joinedAt: member.joinedAt,
            roleIds: [...member.roleIds],
            isBot: member.isBot,
            timeoutUntil: member.communicationDisabledUntil,
            botId: authority.botId,
            botAuthorized: authority.botPermissionAuthorized,
            roles: roleSnapshots(authority),
        }
        return { authority, context }
    })
}

/**
 * Reads the member again and records what Fluxer shows for the first unconfirmed role change of one feature, which
 * unlocks that role for the next request. It records one change per command, so the reply says when another
 * unconfirmed role needs another run
 */
export function reconcileRoleChange(
    roles: RolesStore,
    serverId: string,
    client: Client,
    actor: ModerationActor,
    source: { messageId: string; createdAt: number },
    userId: string,
    ownConsumer: (consumerKey: string) => boolean,
) {
    return Effect.gen(function* () {
        const fresh = yield* roleMemberContext(client, serverId, userId, actor.userId)
        const unconfirmed = []
        let cursor: string | undefined
        do {
            const page = yield* roles.query({
                serverId,
                actor,
                // Every membership is listed, so a change left unconfirmed before the member rejoined is found too
                operation: { type: "claim-list", userId, ...(cursor ? { cursor } : {}) },
            })
            if (page.type !== "claims") break
            for (const row of page.claims)
                if (row.status === "uncertain" && row.attempt && ownConsumer(row.attempt.consumerKey))
                    unconfirmed.push(row)
            cursor = unconfirmed.length > 1 ? undefined : page.nextCursor
        } while (cursor)
        const claim = unconfirmed[0]
        if (!claim?.attempt) return "No unconfirmed role change for this member"
        const present = fresh.context.roleIds.includes(claim.roleId)
        const recorded = yield* roles
            .reconcile({
                serverId,
                actor,
                ...source,
                attemptId: claim.attempt.attemptId,
                generation: claim.generation,
                observation: {
                    originServerId: serverId,
                    observedAt: yield* Clock.currentTimeMillis,
                    userId,
                    joinedAt: fresh.context.joinedAt,
                    roleId: claim.roleId,
                    present,
                },
            })
            .pipe(
                Effect.catch((error) =>
                    error instanceof RolesStoreError && error.status === 409
                        ? Effect.succeed(undefined)
                        : Effect.fail(error),
                ),
            )
        if (recorded && !recorded.recorded)
            return "Nothing new was recorded for that role. Send the command again as a new message"
        return recorded
            ? `Recorded that ${format.roleMention(claim.roleId)} is ${present ? "on" : "not on"} ${format.userMention(userId)}${unconfirmed.length > 1 ? ". Another role change is still unconfirmed, so send the command again" : ""}`
            : "The last role change is still within its few-minute window. Try again shortly"
    })
}

export function verifyRolePanel(client: Client, serverId: string, userId: string, panel: RolesPanel) {
    return Effect.gen(function* () {
        const snapshot = panel.published
        if (!snapshot || snapshot.revision !== panel.revision)
            return yield* Effect.fail(new RoleHandlingError({ stage: "panel" }))
        const authority = yield* readSafetyAuthority(client, serverId, userId, { channelId: snapshot.channelId })
        if (!authority.channel || authority.botId !== snapshot.botId)
            return yield* Effect.fail(new RoleHandlingError({ stage: "identity" }))
        const message = yield* client.messages.fetch(
            { id: snapshot.messageId, channelId: snapshot.channelId },
            { timeoutMs: 5000 },
        )
        yield* verifyPublishingMessage(message, {
            serverId,
            channelId: snapshot.channelId,
            messageId: snapshot.messageId,
            botId: snapshot.botId,
            verifiedChannel: authority.channel,
        })
        const content = publishingMessageContent(message)
        if (!content || !equalPublishingContent(content, canonicalPublishingContent(snapshot.content)))
            return yield* Effect.fail(new RoleHandlingError({ stage: "snapshot" }))
        return snapshot
    })
}

export function performRoleGrant(
    store: RolesStore,
    serverId: string,
    client: Client,
    grant: RolesGrant,
    actorId = grant.userId,
    allowBotTarget = false,
    auditReason = "Managed role request",
) {
    return Effect.gen(function* () {
        const token = randomUUID().replaceAll("-", "")
        let claimRequested = false,
            ownsClaim = false,
            invoked = false,
            read: Effect.Success<ReturnType<typeof roleMemberContext>> | undefined
        const operation = Effect.gen(function* () {
            if (
                !["add", "remove"].includes(grant.action) ||
                grant.nativeDeadlineMs !== 5000 ||
                grant.expectedPresent !== (grant.action === "remove") ||
                (yield* Clock.currentTimeMillis) >= grant.dispatchExpiresAt
            )
                return yield* Effect.fail(new RoleHandlingError({ stage: "claim" }))
            const fresh = yield* readRoleAuthority(client, serverId, actorId, {
                targetId: grant.userId,
                roleIds: [grant.roleId],
                allowBotTarget,
                configuration: actorId !== grant.userId,
            })
            const member = fresh.target ?? fresh.actor
            const now = yield* Clock.currentTimeMillis
            if (
                fresh.botId !== grant.botId ||
                member.joinedAt !== grant.joinedAt ||
                member.roleIds.includes(grant.roleId) !== grant.expectedPresent ||
                memberTimeout(client, fresh.bot, now) !== "none" ||
                (grant.action === "add" && memberTimeout(client, member, now) !== "none")
            ) {
                return yield* Effect.fail(new RoleHandlingError({ stage: "snapshot" }))
            }
            claimRequested = true
            const context: RolesMemberContext & { originServerId: string } = {
                originServerId: member.guildId,
                userId: member.userId,
                joinedAt: member.joinedAt,
                roleIds: [...member.roleIds],
                isBot: member.isBot,
                timeoutUntil: member.communicationDisabledUntil ?? null,
                botId: fresh.botId,
                botAuthorized: fresh.botPermissionAuthorized,
                roles: roleSnapshots(fresh),
            }
            read = { authority: fresh, context }
            const claimed = yield* store.dispatch({
                serverId,
                attemptId: grant.attemptId,
                ownershipId: grant.ownershipId,
                generation: grant.generation,
                sourceId: grant.sourceId,
                claimToken: token,
                context,
                ...(actorId !== grant.userId || fresh.isOwner || fresh.isAdmin
                    ? { actor: moderationActor(fresh) }
                    : {}),
            })
            if (
                !claimed.claimed ||
                claimed.dispatchExpiresAt !== grant.dispatchExpiresAt ||
                claimed.nativeDeadlineMs !== 5000
            )
                return yield* Effect.fail(new RoleHandlingError({ stage: "claim" }))
            ownsClaim = true
            if ((yield* Clock.currentTimeMillis) >= grant.dispatchExpiresAt)
                return yield* Effect.fail(new RoleHandlingError({ stage: "claim" }))
            invoked = true
            const target = { guildId: serverId, userId: grant.userId }
            const options = { timeoutMs: 5000, auditReason }
            // A confirmed native write is the outcome, a failed readback must not lock the role
            if (grant.action === "add") yield* client.members.addRole(target, grant.roleId, options)
            else yield* client.members.removeRole(target, grant.roleId, options)
        })
        const result = yield* Effect.exit(operation)
        if (Exit.isFailure(result) && Cause.hasInterrupts(result.cause)) return yield* Effect.failCause(result.cause)
        if (!ownsClaim && claimRequested) return { outcome: "uncertain" as const, acknowledged: false }
        const notDispatched = Exit.isFailure(result) && errors.outcome(result.cause) === "notDispatched"
        const outcome = Exit.isSuccess(result) ? "succeeded" : invoked && !notDispatched ? "uncertain" : "failed"
        // Fluxer's role limit refused the call before it was sent, and says how long until it may go
        const retryAfterMs =
            outcome === "failed" && Exit.isFailure(result) ? errors.retryAfterMs(result.cause) : undefined
        const acknowledged = yield* store
            .outcome({
                serverId,
                attemptId: grant.attemptId,
                ownershipId: grant.ownershipId,
                generation: grant.generation,
                sourceId: grant.sourceId,
                outcome,
                ...(ownsClaim ? { claimToken: token } : {}),
            })
            .pipe(Effect.match({ onFailure: () => false, onSuccess: (v) => v.recorded }))
        // A confirmed change is what Fluxer holds now, so the read before it, with the change, is the member's current state
        const observed =
            outcome === "succeeded" && read
                ? {
                      ...read,
                      context: {
                          ...read.context,
                          roleIds:
                              grant.action === "add"
                                  ? [...read.context.roleIds, grant.roleId]
                                  : read.context.roleIds.filter((id) => id !== grant.roleId),
                      },
                  }
                : undefined
        return {
            outcome,
            acknowledged,
            ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
            ...(observed ? { observed } : {}),
        }
    })
}

function applyRoleRequest(
    store: RolesStore,
    serverId: string,
    client: Client,
    source: RolesSource,
    userId: string,
    operation: RolesEvaluateOperation,
    actorId = userId,
    allowBotTarget = false,
    expectedJoinedAt?: string,
    reactionJob?: RolesReactionJobBinding,
    initial?: Effect.Success<ReturnType<typeof roleMemberContext>>,
    maxGrants = Infinity,
) {
    return Effect.gen(function* () {
        let continuationAttemptId: string | undefined,
            grants = 0,
            more = false
        let result: RolesEvaluateResult | undefined
        let outcome: Effect.Success<ReturnType<typeof performRoleGrant>> | undefined
        // One operation can release an exclusive choice, then grant its replacement.
        // Joins combine every autorole and at most twenty reserved roles.
        // A picker choice can release every role of a full menu, then grant its replacement and settle
        const steps =
            operation.type === "join"
                ? ROLES_AUTOROLES + 21
                : operation.type === "pick"
                  ? ROLE_PICKER_MENU_ROLES + 1
                  : 21
        // A grant reads the member fresh before it writes, and that read with its confirmed change is the next step's member
        let fresh: typeof initial =
            initial ?? (yield* roleMemberContext(client, serverId, userId, actorId, allowBotTarget))
        // The membership the first step read, which binds the work it unlocks
        const joinedAt = fresh.context.joinedAt
        for (let index = 0; index < steps; index++) {
            fresh ??= yield* roleMemberContext(client, serverId, userId, actorId, allowBotTarget)
            if (expectedJoinedAt !== undefined && fresh.context.joinedAt !== expectedJoinedAt)
                return yield* Effect.fail(new RoleHandlingError({ stage: "snapshot" }))
            result = yield* store.evaluate({
                ...source,
                // A join's autoroles count from each step's own time, never before the join, so a pass that waited behind other
                // work still gives every role within the backend's 15 minutes for a source
                ...(operation.type === "join"
                    ? { createdAt: Math.max(yield* Clock.currentTimeMillis, Date.parse(fresh.context.joinedAt)) }
                    : {}),
                serverId,
                context: fresh.context,
                operation,
                ...(continuationAttemptId ? { continuationAttemptId } : {}),
                ...(reactionJob ? { reactionJob } : {}),
                ...(actorId !== userId || fresh.authority.isOwner || fresh.authority.isAdmin
                    ? { actor: moderationActor(fresh.authority) }
                    : {}),
            })
            if (!result.grant) break
            outcome = yield* performRoleGrant(store, serverId, client, result.grant, actorId, allowBotTarget)
            if (outcome.outcome !== "succeeded" || !outcome.acknowledged) break
            continuationAttemptId = result.grant.attemptId
            fresh = outcome.observed
            // A round that gave its share stops here, so the caller can let the member's waiting work go first
            if (++grants >= maxGrants) {
                more = true
                break
            }
        }
        return { result: result!, joinedAt, more, ...(outcome ? { outcome } : {}) }
    })
}

/** The roles one autorole round gives while it holds the member's lock, so the member's own request waits for at most this many */
const ROUND_GRANTS = 5
/**
 * Gives a join's autoroles in rounds of at most ROUND_GRANTS roles. Each round holds the member's lock, and the next one reads the member
 * again under a source of its own once the work that waited for the lock ran. Fluxer adds 20 roles per server every 10 seconds. The SDK
 * waits for that within a round, and a round whose next change the SDK refused waits for Fluxer's limit outside the lock. It stops after
 * one round per role it may give
 */
export function giveJoinRoles(
    store: RolesStore,
    serverId: string,
    client: Client,
    sourceId: string,
    userId: string,
    actorId: string,
    allowBotTarget: boolean,
    expectedJoinedAt: string,
    from = { round: 0, waitMs: 0 },
) {
    return Effect.gen(function* () {
        let waitMs = from.waitMs
        for (let round = from.round; round <= ROLES_AUTOROLES + 21; round++) {
            if (waitMs > 0) yield* Effect.sleep(`${waitMs} millis`)
            const applied = yield* withRoleMember(
                client,
                userId,
                applyRoleRequest(
                    store,
                    serverId,
                    client,
                    { sourceId, createdAt: Date.parse(expectedJoinedAt) },
                    userId,
                    { type: "join" },
                    actorId,
                    allowBotTarget,
                    expectedJoinedAt,
                    undefined,
                    undefined,
                    ROUND_GRANTS,
                ),
                serverId,
            )
            const outcome = applied.outcome
            if (applied.more) waitMs = 0
            else if (outcome?.retryAfterMs !== undefined && outcome.acknowledged) waitMs = outcome.retryAfterMs
            else return
            sourceId = roleEventSource("joinwait", sourceId)
        }
    })
}

/**
 * A join's autorole pass as background work. A member who left before it ran needs no roles, and one who has not accepted the rules yet gets
 * them once they do
 */
export const joinRolesWork = (...args: Parameters<typeof giveJoinRoles>) =>
    giveJoinRoles(...args).pipe(
        Effect.catchCause((cause) =>
            Cause.hasInterrupts(cause)
                ? Effect.failCause(cause)
                : cause.reasons.some(
                        (reason) =>
                            reason._tag === "Fail" &&
                            ((reason.error instanceof SafetyPermissionError &&
                                reason.error.notFound === true &&
                                (reason.error.operation === "actor" || reason.error.operation === "target")) ||
                                (reason.error instanceof RolesStoreError && reason.error.code === "MEMBER_NOT_READY")),
                    )
                  ? Effect.void
                  : warnFailure(
                        "A new member's autoroles could not all be given. !autorole history shows the ones given, and staff can add the rest",
                        cause,
                    ),
        ),
    )

export function evaluateRoleRequest(
    store: RolesStore,
    serverId: string,
    client: Client,
    source: RolesSource,
    userId: string,
    operation: RolesEvaluateOperation,
    actorId = userId,
    allowBotTarget = false,
    expectedJoinedAt?: string,
    reactionJob?: RolesReactionJobBinding,
    initial?: Effect.Success<ReturnType<typeof roleMemberContext>>,
    background = false,
) {
    return Effect.gen(function* () {
        const applied = yield* applyRoleRequest(
            store,
            serverId,
            client,
            source,
            userId,
            operation,
            actorId,
            allowBotTarget,
            expectedJoinedAt,
            reactionJob,
            initial,
        )
        // Verification unlocks the autoroles that a gated join could not grant, and a redelivered verification retries them. An event or
        // command leaves them to the server's background role work, so it never waits for them. They are bound to the membership that
        // verified, as the verification read it
        const joinedAt = expectedJoinedAt ?? applied.joinedAt
        if (
            operation.type === "verify" &&
            (applied.result.status === "acknowledged" ||
                (applied.result.duplicate && applied.result.acknowledgment.acknowledged))
        ) {
            const sourceId = roleEventSource("autorole", source.sourceId)
            if (background) {
                yield* backgroundRoleWork(
                    client,
                    serverId,
                    joinRolesWork(store, serverId, client, sourceId, userId, userId, false, joinedAt),
                )
                return { ...applied, autoroleFailed: false as const }
            }
            const autorole = yield* Effect.exit(
                applyRoleRequest(
                    store,
                    serverId,
                    client,
                    { sourceId, createdAt: source.createdAt },
                    userId,
                    { type: "join" },
                    userId,
                    false,
                    joinedAt,
                    undefined,
                    undefined,
                    ROUND_GRANTS,
                ),
            )
            if (Exit.isFailure(autorole)) {
                if (Cause.hasInterrupts(autorole.cause)) return yield* Effect.failCause(autorole.cause)
                return { ...applied, autoroleFailed: true as const }
            }
            // The roles after the first round, and the ones Fluxer's limit holds back once it allows, follow in the background
            const held = autorole.value.outcome
            if (autorole.value.more || (held?.retryAfterMs !== undefined && held.acknowledged))
                yield* backgroundRoleWork(
                    client,
                    serverId,
                    joinRolesWork(
                        store,
                        serverId,
                        client,
                        roleEventSource("joinwait", sourceId),
                        userId,
                        userId,
                        false,
                        joinedAt,
                        { round: 1, waitMs: autorole.value.more ? 0 : held!.retryAfterMs! },
                    ),
                )
        }
        return { ...applied, autoroleFailed: false as const }
    })
}

/** Whether a reaction event's emoji is the emoji a panel maps, written as Unicode text or custom emoji markup */
export const sameEmoji = (mapped: string, emoji: ReactionEmoji) =>
    emoji.id ? /^<a?:[\w-]+:(\d+)>$/.exec(mapped)?.[1] === emoji.id : mapped === emoji.name

/**
 * Clears every reaction of an emoji whose meaning changed on a posted panel, then adds the bot's own reaction for each
 * emoji it maps. Answers the cleared emojis, which the next reaction check reports so that they count again. A failed
 * clear fails the sync, and a failed own reaction only leaves members without the hint
 */
export function syncPanelReactions(client: Client, panel: RolesPanel) {
    return Effect.gen(function* () {
        const published = panel.published
        if (!published) return []
        const message = { id: published.messageId, channelId: published.channelId }
        const cleared: string[] = []
        for (const emoji of published.pendingClear ?? []) {
            yield* client.messages.clearReaction(message, emoji, { timeoutMs: 5000 })
            cleared.push(emoji)
        }
        for (const mapping of published.mappings)
            yield* client.messages
                .addReaction(message, mapping.emoji, { timeoutMs: 5000 })
                .pipe(Effect.catch(() => Effect.void))
        return cleared
    })
}

/** Whether a failed panel reaction sync found its posted message or its channel gone */
export const panelMessageGone = (error: unknown) =>
    errors.isNotFound(error, "message") || errors.isNotFound(error, "channel")

/** Checks a member's reactions on a panel under the member's lock, as a reaction check job does */
export const handleRoleReaction = (...args: Parameters<typeof roleReaction>) =>
    withRoleMember(args[2], args[4], roleReaction(...args), args[1])

/**
 * A member's live reaction on a panel, as their own role request beside the event handlers. handled runs first and answers true when it
 * took the reaction, such as advanced verification sending its link. The request is bound to the membership the reaction came from
 */
export function liveRoleReaction(
    store: RolesStore,
    serverId: string,
    client: Client,
    target: MessageReference & { guildId?: string; emoji?: ReactionEmoji },
    userId: string,
    syncPending?: (panel: RolesPanel) => Effect.Effect<unknown, unknown>,
    handled: Effect.Effect<boolean, unknown> = Effect.succeed(false),
) {
    return Effect.gen(function* () {
        // The SDK keeps the member Fluxer attached to the reaction in its cache before the event arrives
        const joinedAt = (yield* client.members.get({ guildId: serverId, userId }))?.joinedAt
        yield* memberRoleWork(
            client,
            serverId,
            userId,
            Effect.gen(function* () {
                if (yield* handled) return
                yield* roleReaction(store, serverId, client, target, userId, joinedAt, undefined, syncPending)
            }).pipe(
                Effect.catchCause((cause) =>
                    Cause.hasInterrupts(cause)
                        ? Effect.failCause(cause)
                        : warnFailure("A reaction on a role panel could not be handled", cause),
                ),
            ),
        )
    })
}

function roleReaction(
    store: RolesStore,
    serverId: string,
    client: Client,
    target: MessageReference & { guildId?: string; emoji?: ReactionEmoji },
    userId: string,
    expectedJoinedAt?: string,
    job?: { binding: RolesReactionJobBinding; source: RolesSource },
    syncPending?: (panel: RolesPanel) => Effect.Effect<unknown, unknown>,
) {
    return Effect.gen(function* () {
        if (target.guildId !== undefined && target.guildId !== serverId) return false
        // A live reaction is evaluated from the bot's cached copies. Reconciliation jobs and every grant read Fluxer
        const cached = job === undefined
        const evidence = yield* readNativeMember(client, serverId, userId, {
            allowAbsent: job !== undefined,
            cached,
        })
        const native = evidence.member
        if (job && (!native || native.joinedAt !== expectedJoinedAt)) {
            yield* store.reactionJobs({
                serverId,
                operation: {
                    type: "skip",
                    binding: job.binding,
                    originServerId: evidence.originServerId,
                    memberUserId: evidence.userId,
                    observedAt: yield* Clock.currentTimeMillis,
                    currentJoinedAt: native?.joinedAt ?? null,
                },
            })
            return true
        }
        if (!native || native.isBot) return false
        const fresh = yield* roleMemberContext(client, serverId, userId, userId, false, cached),
            context = fresh.context
        if (expectedJoinedAt !== undefined && context.joinedAt !== expectedJoinedAt) {
            if (job)
                yield* store.reactionJobs({
                    serverId,
                    operation: {
                        type: "skip",
                        binding: job.binding,
                        originServerId: context.originServerId,
                        memberUserId: context.userId,
                        observedAt: yield* Clock.currentTimeMillis,
                        currentJoinedAt: context.joinedAt,
                    },
                })
            return true
        }
        // Reactions read under an earlier mapping of the posted panel are refused with PANEL_CHANGED and read again. The
        // same refused generation in the fresh read ends the check
        let refusedGeneration: number | undefined
        for (;;) {
            const member = yield* store.memberQuery({ serverId, context })
            const panel = member.panels.find(
                (p) => p.published?.messageId === target.id && p.published.channelId === target.channelId,
            )
            // The backend binds the published message, so a reaction needs no message or permission re-read
            const snapshot = panel?.published
            if (!panel || !snapshot || snapshot.revision !== panel.revision || !panel.enabled || panel.withdrawing)
                return !job
            if (refusedGeneration !== undefined && (snapshot.clearGeneration ?? 0) === refusedGeneration)
                return yield* Effect.fail(new RoleHandlingError({ stage: "snapshot" }))
            // An emoji whose meaning changed counts only once the bot cleared its reactions. A panel left with emojis to
            // clear, such as after a failed sync of a dashboard change, clears them at the next reaction, which takes a
            // reaction on such an emoji along
            const pending = snapshot.pendingClear ?? [],
                emoji = target.emoji
            if (!job && pending.length && syncPending)
                yield* syncPending(panel).pipe(
                    Effect.catchCause((cause) =>
                        Cause.hasInterrupts(cause)
                            ? Effect.failCause(cause)
                            : warnFailure(`Reactions of role panel ${panel.name} are not updated yet`, cause),
                    ),
                )
            if (!job && emoji && pending.some((x) => sameEmoji(x, emoji))) return true
            const presentEmojis: string[] = []
            for (const mapping of snapshot.mappings)
                if (
                    !pending.includes(mapping.emoji) &&
                    (yield* targetedReactionPresent(client, target, mapping.emoji, userId))
                )
                    presentEmojis.push(mapping.emoji)
            const source: RolesSource = job?.source ?? {
                sourceId: `reaction_${randomUUID().replaceAll("-", "")}`,
                createdAt: yield* Clock.currentTimeMillis,
            }
            const operation: RolesEvaluateOperation =
                panel.kind === "verification"
                    ? {
                          type: "verify",
                          name: panel.name,
                          revision: panel.revision,
                          messageId: target.id,
                          panelVerified: true,
                          reactionPresent: presentEmojis.includes(snapshot.mappings[0]?.emoji ?? ""),
                      }
                    : {
                          type: "reaction",
                          name: panel.name,
                          revision: panel.revision,
                          messageId: target.id,
                          presentEmojis,
                          panelVerified: true,
                          clearGeneration: snapshot.clearGeneration ?? 0,
                      }
            if (!job && panel.kind === "verification" && !presentEmojis.includes(snapshot.mappings[0]?.emoji ?? ""))
                return true
            const applied = yield* evaluateRoleRequest(
                store,
                serverId,
                client,
                source,
                userId,
                operation,
                userId,
                false,
                context.joinedAt,
                job?.binding,
                fresh,
                true,
            ).pipe(
                Effect.catch((error) =>
                    error instanceof RolesStoreError && error.status === 409 && error.code === "PANEL_CHANGED"
                        ? Effect.succeed(undefined)
                        : Effect.fail(error),
                ),
            )
            if (!applied) {
                refusedGeneration = snapshot.clearGeneration ?? 0
                continue
            }
            if (applied.result.status === "ambiguous" && !applied.result.duplicate)
                yield* client.messages.send(
                    snapshot.channelId,
                    {
                        content: `${format.userMention(userId)}, your reactions on panel ${panel.name} pick more than one role, but it gives one at a time. Use ${code(`${replyPrefix(serverId, serverId)}roles choose ${panel.name} <emoji>`)} to pick one`,
                    },
                    { timeoutMs: 5000 },
                )
            return (
                applied.result.status !== "blocked" &&
                (!applied.outcome || (applied.outcome.outcome === "succeeded" && applied.outcome.acknowledged))
            )
        }
    })
}

/** joinWork reports whether the last roles answer had autorole or rules verification on. The member read answers the settings again, so the policy read is skipped then */
export function handleRoleJoin(
    store: RolesStore,
    serverId: string,
    client: Client,
    userId: string,
    eventJoinedAt: string,
    joinWork: () => boolean = () => false,
) {
    return withRoleMember(
        client,
        userId,
        Effect.gen(function* () {
            const createdAt = Date.parse(eventJoinedAt),
                now = yield* Clock.currentTimeMillis
            if (!Number.isFinite(createdAt) || createdAt > now + 60000 || createdAt < now - 900000) return
            const policy = joinWork() ? undefined : yield* store.policy({ serverId })
            if (policy && !policy.settings.autoroleEnabled && !policy.settings.verificationEnabled) return
            const target = yield* client.members.fetch({ guildId: serverId, userId }, { timeoutMs: 5000 })
            if (target.joinedAt !== eventJoinedAt) return
            if (target.isBot && policy?.settings.humansOnly) return
            // A configured bot autorole is a server policy, never a bot-authored staff command.
            const actorId = target.isBot ? (yield* client.guilds.fetch(serverId, { timeoutMs: 5000 })).ownerId : userId
            const fresh = yield* roleMemberContext(client, serverId, userId, actorId, target.isBot)
            if (fresh.context.joinedAt !== eventJoinedAt) return
            const current = yield* store.memberQuery({ serverId, context: fresh.context })
            if (target.isBot && current.settings.humansOnly) return
            const verification = current.panels.find(
                (p) => p.kind === "verification" && p.enabled && p.published?.revision === p.revision,
            )
            if (
                !target.isBot &&
                current.settings.verificationEnabled &&
                !current.settings.advancedVerificationEnabled &&
                verification?.published
            ) {
                const snapshot = yield* verifyRolePanel(client, serverId, userId, verification)
                if (
                    snapshot.mappings[0] &&
                    (yield* targetedReactionPresent(
                        client,
                        { id: snapshot.messageId, channelId: snapshot.channelId },
                        snapshot.mappings[0].emoji,
                        userId,
                    ))
                ) {
                    yield* evaluateRoleRequest(
                        store,
                        serverId,
                        client,
                        {
                            sourceId: roleEventSource("joinverify", userId, fresh.context.joinedAt, snapshot.messageId),
                            createdAt,
                        },
                        userId,
                        {
                            type: "verify",
                            name: verification.name,
                            revision: verification.revision,
                            messageId: snapshot.messageId,
                            panelVerified: true,
                            reactionPresent: true,
                        },
                        userId,
                        false,
                        eventJoinedAt,
                        undefined,
                        undefined,
                        true,
                    )
                }
            }
            // The pass runs as the server's background role work, so the joins after this one reach their protection at once
            if (current.settings.autoroleEnabled)
                yield* backgroundRoleWork(
                    client,
                    serverId,
                    joinRolesWork(
                        store,
                        serverId,
                        client,
                        roleEventSource("join", userId, fresh.context.joinedAt),
                        userId,
                        actorId,
                        target.isBot,
                        eventJoinedAt,
                    ),
                )
        }),
        serverId,
    )
}
