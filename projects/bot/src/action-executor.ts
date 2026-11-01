import type {
    ModerationActionGrant,
    ModerationActionType,
    ModerationOutcome,
    PermissionOverwriteSnapshot,
    ProviderObservation,
} from "@neonflux/contracts/moderation"
import { errors, hierarchy, permissionBits, Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Exit, type Types } from "effect"
import { allowBotPosting, ownedPostingBits, readSafetyAuthority, type SafetyAuthority } from "./safety-permissions.ts"
import { readNativeMember } from "./member-evidence.ts"

class ActionExecutionError extends Data.TaggedError("ActionExecutionError")<{
    readonly stage: "authorization" | "snapshot" | "observation"
}> {}

export function actionPermission(action: ModerationActionType) {
    switch (action) {
        case "kick":
            return Permissions.KickMembers
        case "ban":
        case "unban":
            return Permissions.BanMembers
        case "timeout":
        case "untimeout":
        case "quarantine":
        case "release":
        case "warn":
            return Permissions.ModerateMembers
        case "delete":
        case "purge":
            return Permissions.ManageMessages
        // Fluxer checks only Manage roles when it sets or removes a permission overwrite
        case "lock":
        case "unlock":
        case "jail":
        case "unjail":
            return Permissions.ManageRoles
        case "slowmode":
            return Permissions.ManageChannels
        default:
            return undefined
    }
}

/** The stored roles an unjail could not give back, which its reply and staff log name */
export type JailLeftOut = { deleted: string[]; above: string[] }
const outranks = (authority: SafetyAuthority, role: SafetyAuthority["roles"][number]) => {
    try {
        return hierarchy.canManageRole({ guild: authority.guild, actor: authority.bot, role, roles: authority.roles })
    } catch {
        return false
    }
}

export function overwriteSnapshot(
    channel: {
        readonly permissionOverwrites?: readonly {
            readonly id: string
            readonly type: string
            readonly allow: bigint
            readonly deny: bigint
        }[]
    },
    serverId: string,
): PermissionOverwriteSnapshot {
    const value = channel.permissionOverwrites?.find((item) => item.id === serverId && item.type === "role")
    if (!channel.permissionOverwrites) throw new ActionExecutionError({ stage: "snapshot" })
    if (value && (value.allow > 9223372036854775807n || value.deny > 9223372036854775807n))
        throw new ActionExecutionError({ stage: "snapshot" })
    return value
        ? { exists: true, allow: value.allow.toString(), deny: value.deny.toString() }
        : { exists: false, allow: "0", deny: "0" }
}

function matchingLockBits(
    actual: PermissionOverwriteSnapshot,
    expected: PermissionOverwriteSnapshot,
    mask: bigint = Permissions.SendMessages,
) {
    return (
        actual.exists === expected.exists &&
        (BigInt(actual.allow) & mask) === (BigInt(expected.allow) & mask) &&
        (BigInt(actual.deny) & mask) === (BigInt(expected.deny) & mask)
    )
}

// `known` is the authority the caller read for this same action, so it is not fetched twice.
// `confirm` runs right before a provider write and fails when the grant is no longer pending
export function executeAction<E>(
    client: Client,
    serverId: string,
    actorId: string,
    grant: ModerationActionGrant,
    confirm: Effect.Effect<unknown, E>,
    known?: SafetyAuthority,
) {
    return Effect.gen(function* () {
        const authority =
            known ??
            (yield* readSafetyAuthority(client, serverId, actorId, {
                ...(actionPermission(grant.action) !== undefined
                    ? { permission: actionPermission(grant.action)! }
                    : {}),
                ...(grant.targetId && grant.action !== "log"
                    ? {
                          targetId: grant.targetId,
                          allowAbsentTarget:
                              grant.action === "ban" || grant.action === "unban" || grant.action === "unjail",
                      }
                    : {}),
                ...(grant.channelId ? { channelId: grant.channelId } : {}),
            }))
        // The backend let this actor through a bot-only right. A grant that relies on one reads the actor again above, so a member who lost
        // the role since, or whose role moved above NeonFlux, or who can no longer view the channel, acts on nothing
        const throughRight =
            grant.viaRight !== undefined &&
            (grant.rightRoleIds ?? []).some(
                (id) => authority.roleIds.includes(id) && authority.rightRoleIds.includes(id),
            ) &&
            (!grant.channelId || authority.actorViewsChannel)
        if (
            (!authority.nativePermissionAuthorized && !throughRight) ||
            !authority.botPermissionAuthorized ||
            (grant.targetId &&
                grant.action !== "log" &&
                (authority.targetProtected || !authority.actorCanManageTarget || !authority.botCanManageTarget))
        ) {
            return yield* Effect.fail(new ActionExecutionError({ stage: "authorization" }))
        }
        // Reused authority may predate the reservation, so recovery comparisons re-read the target member or channel
        const snapshot = <A>(read: Effect.Effect<A, unknown>) =>
            read.pipe(Effect.mapError(() => new ActionExecutionError({ stage: "snapshot" })))
        const targetMember =
            !known || !grant.targetId
                ? Effect.succeed(authority.target)
                : snapshot(
                      readNativeMember(client, serverId, grant.targetId, { allowAbsent: grant.action === "unjail" }),
                  ).pipe(Effect.map((evidence) => evidence.member))
        const channelState =
            !known || !grant.channelId
                ? Effect.succeed(authority.channel)
                : snapshot(client.channels.fetch(grant.channelId, { timeoutMs: 5000 })).pipe(
                      Effect.flatMap((channel) =>
                          channel.id === grant.channelId && channel.guildId === serverId
                              ? Effect.succeed(channel)
                              : Effect.fail(new ActionExecutionError({ stage: "snapshot" })),
                      ),
                  )
        const target = grant.targetId ? { guildId: serverId, userId: grant.targetId } : undefined
        const now = yield* Clock.currentTimeMillis
        // Fluxer's audit entry names NeonFlux, so its reason names the member who acted through a right
        const options = {
            timeoutMs: 5000,
            auditReason: `NeonFlux case ${grant.caseNo}${grant.viaRight ? `, for member ${actorId}` : ""}`,
        }
        let operation: Effect.Effect<unknown, unknown> = Effect.void
        let leftOut: JailLeftOut | undefined
        switch (grant.action) {
            case "log":
            case "warn":
                break
            case "kick":
                operation = client.members.kick(target!, options)
                break
            case "ban":
                operation = client.members.ban(
                    target!,
                    {
                        ...(grant.reason ? { reason: grant.reason } : {}),
                        ...(grant.durationSeconds ? { durationMs: grant.durationSeconds * 1000 } : {}),
                    },
                    options,
                )
                break
            case "unban":
                operation = client.members.unban(target!, options)
                break
            case "timeout":
            case "quarantine": {
                const current = (yield* targetMember)?.communicationDisabledUntil
                if (grant.expectedTimeoutUntil !== undefined && current !== grant.expectedTimeoutUntil)
                    return yield* Effect.fail(new ActionExecutionError({ stage: "snapshot" }))
                const until = current ? Date.parse(current) : 0
                const wanted = now + grant.durationSeconds! * 1000
                if (grant.action === "quarantine" && (current === undefined || !Number.isFinite(until)))
                    return yield* Effect.fail(new ActionExecutionError({ stage: "snapshot" }))
                if (grant.action === "quarantine" && until >= wanted)
                    return yield* Effect.fail(new ActionExecutionError({ stage: "snapshot" }))
                operation = client.members.timeout(target!, grant.durationSeconds! * 1000, {
                    ...options,
                    ...(grant.reason ? { timeoutReason: grant.reason } : {}),
                })
                break
            }
            case "release":
            case "untimeout": {
                const current = (yield* targetMember)?.communicationDisabledUntil
                if (grant.expectedTimeoutUntil === undefined || current !== grant.expectedTimeoutUntil)
                    return yield* Effect.fail(new ActionExecutionError({ stage: "snapshot" }))
                if (
                    grant.action === "release" &&
                    grant.restoreTimeoutUntil &&
                    Date.parse(grant.restoreTimeoutUntil) > now
                )
                    return yield* Effect.fail(new ActionExecutionError({ stage: "snapshot" }))
                operation = client.members.clearTimeout(target!, options)
                break
            }
            case "jail": {
                // A later jail of the same member changes only its length or reason, which the backend already holds
                if (grant.jailRoleId === undefined) break
                const member = yield* targetMember
                const expected = grant.expectedRoleIds ?? []
                if (
                    !member ||
                    member.roleIds.length !== expected.length ||
                    !expected.every((id) => member.roleIds.includes(id))
                )
                    return yield* Effect.fail(new ActionExecutionError({ stage: "snapshot" }))
                const role = authority.roles.find((item) => item.id === grant.jailRoleId)
                if (!role || !outranks(authority, role))
                    return yield* Effect.fail(new ActionExecutionError({ stage: "snapshot" }))
                operation = client.members.setRoles(target!, [grant.jailRoleId], options)
                break
            }
            case "unjail": {
                // A member who left has no roles to set. The record ends, and a rejoin is an ordinary one
                const member = yield* targetMember
                if (!member) break
                const kept: string[] = []
                leftOut = { deleted: [], above: [] }
                for (const id of grant.restoreRoleIds ?? []) {
                    const role = authority.roles.find((item) => item.id === id)
                    if (!role) leftOut.deleted.push(id)
                    else if (!outranks(authority, role)) leftOut.above.push(id)
                    else kept.push(id)
                }
                operation = client.members.setRoles(target!, kept, options)
                break
            }
            case "delete":
                operation = client.messages.delete({ channelId: grant.channelId!, id: grant.messageIds![0]! }, options)
                break
            case "purge":
                operation = client.messages.deleteMany(grant.channelId!, grant.messageIds!, options)
                break
            case "slowmode": {
                const channel = yield* channelState
                if (
                    !channel ||
                    !("rateLimitPerUser" in channel) ||
                    channel.rateLimitPerUser !== grant.expectedSlowmodeSeconds
                )
                    return yield* Effect.fail(new ActionExecutionError({ stage: "snapshot" }))
                operation = client.channels.edit(
                    grant.channelId!,
                    { rateLimitPerUser: grant.slowmodeSeconds! },
                    options,
                )
                break
            }
            case "lock":
            case "unlock": {
                const channel = yield* channelState
                const current = yield* Effect.try({
                    try: () => overwriteSnapshot(channel!, serverId),
                    catch: () => new ActionExecutionError({ stage: "snapshot" }),
                })
                // A lock owns SendMessages and the thread bits the bot held when it began
                const owned = ownedPostingBits(grant)
                if (
                    !grant.ownedPermissions ||
                    !grant.expectedOverwrite ||
                    !grant.overwrite ||
                    !matchingLockBits(current, grant.expectedOverwrite, owned)
                )
                    return yield* Effect.fail(new ActionExecutionError({ stage: "snapshot" }))
                const allow = (BigInt(current.allow) & ~owned) | (BigInt(grant.overwrite.allow) & owned)
                const deny = (BigInt(current.deny) & ~owned) | (BigInt(grant.overwrite.deny) & owned)
                const restore =
                    !grant.overwrite.exists && allow === 0n && deny === 0n
                        ? client.channels.removePermissionOverwrite(grant.channelId!, serverId, options)
                        : client.channels.setPermissionOverwrite(
                              grant.channelId!,
                              { id: serverId, type: "role", allow, deny },
                              options,
                          )
                // Only the lock denies the bot's own bits, and it must keep the right to lift the denial
                operation =
                    grant.action === "lock"
                        ? allowBotPosting(
                              client,
                              grant.channelId!,
                              authority.botId,
                              authority.botServerPermissions,
                              owned,
                              channel!.permissionOverwrites?.find(
                                  (item) => item.id === authority.botId && item.type === "member",
                              ),
                              options,
                          ).pipe(Effect.andThen(restore))
                        : restore
                break
            }
        }
        if (grant.action !== "log" && grant.action !== "warn") yield* confirm
        const result = yield* Effect.exit(operation)
        if (Exit.isFailure(result) && Cause.hasInterrupts(result.cause)) return yield* Effect.failCause(result.cause)
        let outcome: ModerationOutcome = Exit.isSuccess(result)
            ? "succeeded"
            : errors.outcome(result.cause) !== "notDispatched"
              ? "uncertain"
              : "failed"
        // Fluxer can make a slowmode change after the request's deadline, so one read of the channel settles it when the change is there
        if (outcome === "uncertain" && grant.action === "slowmode") {
            const channel = yield* client.channels
                .fetch(grant.channelId!, { timeoutMs: 5000 })
                .pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (
                channel !== undefined &&
                channel.id === grant.channelId &&
                channel.guildId === serverId &&
                "rateLimitPerUser" in channel &&
                channel.rateLimitPerUser === grant.slowmodeSeconds
            )
                outcome = "succeeded"
        }
        // A jailed member would stay in a voice channel, so one disconnect follows a confirmed jail when NeonFlux may. Its failure changes nothing
        // about the jail, and it is never repeated. Connect is denied, so a member who left cannot come back
        if (
            outcome === "succeeded" &&
            grant.action === "jail" &&
            grant.jailRoleId !== undefined &&
            permissionBits.has(authority.botServerPermissions, "MoveMembers")
        ) {
            const disconnected = yield* Effect.exit(client.members.disconnect(target!, options))
            if (Exit.isFailure(disconnected) && Cause.hasInterrupts(disconnected.cause))
                return yield* Effect.failCause(disconnected.cause)
        }
        let timeoutUntil: string | null | undefined
        let banExpiresAt: string | null | undefined
        if (
            Exit.isSuccess(result) &&
            result.value &&
            typeof result.value === "object" &&
            "communicationDisabledUntil" in result.value
        ) {
            const value = result.value.communicationDisabledUntil
            if (value === null || typeof value === "string") timeoutUntil = value
        }
        if (
            Exit.isSuccess(result) &&
            ["timeout", "quarantine", "release", "untimeout"].includes(grant.action) &&
            timeoutUntil === undefined
        ) {
            return { outcome: "uncertain" as const }
        }
        if (Exit.isSuccess(result) && grant.action === "ban" && grant.durationSeconds) {
            const bans = yield* client.members
                .fetchBans(serverId, { timeoutMs: 5000 })
                .pipe(Effect.catch(() => Effect.succeed(undefined)))
            banExpiresAt = bans?.find((ban) => ban.userId === grant.targetId && ban.guildId === serverId)?.expiresAt
        }
        return {
            outcome,
            ...(timeoutUntil !== undefined ? { timeoutUntil } : {}),
            ...(banExpiresAt !== undefined ? { banExpiresAt } : {}),
            ...(leftOut && (leftOut.deleted.length || leftOut.above.length) ? { leftOut } : {}),
        }
    })
}

export function observeAction(
    client: Client,
    serverId: string,
    action: { action: ModerationActionType; targetId?: string; channelId?: string },
) {
    return Effect.gen(function* () {
        const observation: Types.Mutable<ProviderObservation> = {
            originServerId: serverId,
            observedAt: yield* Clock.currentTimeMillis,
        }
        if (action.targetId) {
            const evidence = yield* readNativeMember(client, serverId, action.targetId, {
                allowAbsent: action.action === "jail" || action.action === "unjail",
            })
            const target = evidence.member
            observation.memberPresent = !!target
            observation.originServerId = evidence.originServerId
            observation.memberUserId = evidence.userId
            if (target?.communicationDisabledUntil !== undefined)
                observation.timeoutUntil = target.communicationDisabledUntil
            if (target && (action.action === "jail" || action.action === "unjail"))
                observation.roleIds = [...target.roleIds]
            if (action.action === "ban" || action.action === "unban") {
                const bans = yield* client.members.fetchBans(serverId, { timeoutMs: 5000 })
                const ban = bans.find((item) => item.userId === action.targetId && item.guildId === serverId)
                observation.banned = ban !== undefined
                if (ban?.expiresAt !== undefined) observation.banExpiresAt = ban.expiresAt
            }
        }
        if (action.channelId) {
            const channel = yield* client.channels.fetch(action.channelId, { timeoutMs: 5000 })
            if (channel.id !== action.channelId || channel.guildId !== serverId)
                return yield* Effect.fail(new ActionExecutionError({ stage: "observation" }))
            if (action.action === "lock" || action.action === "unlock")
                observation.overwrite = yield* Effect.try({
                    try: () => overwriteSnapshot(channel, serverId),
                    catch: () => new ActionExecutionError({ stage: "observation" }),
                })
            if (
                action.action === "slowmode" &&
                "rateLimitPerUser" in channel &&
                typeof channel.rateLimitPerUser === "number"
            )
                observation.slowmodeSeconds = channel.rateLimitPerUser
        }
        return observation
    }).pipe(Effect.mapError(() => new ActionExecutionError({ stage: "observation" })))
}
