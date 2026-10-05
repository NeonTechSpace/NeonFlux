import type { ModerationActionGrant, ModerationActionType, ModerationOutcome, PermissionOverwriteSnapshot, ProviderObservation } from "@neonflux/backend/contracts"
import { ChannelOperationError, GuildOperationError, MessageOperationError, Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Exit } from "effect"
import { readSafetyAuthority, type SafetyAuthority } from "./safety-permissions.ts"
import { readNativeMember } from "./member-evidence.ts"

export class ActionExecutionError extends Data.TaggedError("ActionExecutionError")<{ readonly stage: "authorization" | "snapshot" | "observation" }> {}

export function actionPermission(action: ModerationActionType) {
    switch (action) {
        case "kick": return Permissions.KickMembers
        case "ban": case "unban": return Permissions.BanMembers
        case "timeout": case "untimeout": case "quarantine": case "release": case "warn": return Permissions.ModerateMembers
        case "delete": case "purge": return Permissions.ManageMessages
        case "lock": return Permissions.ManageRoles
        case "unlock": return Permissions.ManageRoles | Permissions.ManageChannels
        case "slowmode": return Permissions.ManageChannels
        default: return undefined
    }
}

export function overwriteSnapshot(channel: { readonly permissionOverwrites?: readonly { readonly id: string, readonly type: string, readonly allow: bigint, readonly deny: bigint }[] }, serverId: string): PermissionOverwriteSnapshot {
    const value = channel.permissionOverwrites?.find((item) => item.id === serverId && item.type === "role")
    if (!channel.permissionOverwrites) throw new ActionExecutionError({ stage: "snapshot" })
    if (value && (value.allow > 9223372036854775807n || value.deny > 9223372036854775807n)) throw new ActionExecutionError({ stage: "snapshot" })
    return value ? { exists: true, allow: value.allow.toString(), deny: value.deny.toString() } : { exists: false, allow: "0", deny: "0" }
}

export function matchingLockBits(actual: PermissionOverwriteSnapshot, expected: PermissionOverwriteSnapshot) {
    return actual.exists === expected.exists && (BigInt(actual.allow) & Permissions.SendMessages) === (BigInt(expected.allow) & Permissions.SendMessages)
        && (BigInt(actual.deny) & Permissions.SendMessages) === (BigInt(expected.deny) & Permissions.SendMessages)
}

// `known` is the authority the caller read for this same action, so it is not fetched twice.
// `confirm` runs right before a provider write and fails when the grant is no longer pending
export function executeAction<E>(client: Client, serverId: string, actorId: string, grant: ModerationActionGrant,
    confirm: Effect.Effect<unknown, E>, known?: SafetyAuthority) {
    return Effect.gen(function* () {
        const authority = known ?? (yield* readSafetyAuthority(client, serverId, actorId, {
            ...(actionPermission(grant.action) !== undefined ? { permission: actionPermission(grant.action)! } : {}),
            ...(grant.targetId && grant.action !== "log" ? { targetId: grant.targetId, allowAbsentTarget: grant.action === "ban" || grant.action === "unban" } : {}),
            ...(grant.channelId ? { channelId: grant.channelId } : {}),
        }))
        if (!authority.nativePermissionAuthorized || !authority.botPermissionAuthorized || (grant.targetId && grant.action !== "log"
            && (authority.targetProtected || !authority.actorCanManageTarget || !authority.botCanManageTarget))) {
            return yield* Effect.fail(new ActionExecutionError({ stage: "authorization" }))
        }
        // Reused authority may predate the reservation, so recovery comparisons re-read the target member or channel
        const snapshot = <A>(read: Effect.Effect<A, unknown>) => read.pipe(Effect.mapError(() => new ActionExecutionError({ stage: "snapshot" })))
        const targetMember = !known || !grant.targetId ? Effect.succeed(authority.target)
            : snapshot(readNativeMember(client, serverId, grant.targetId)).pipe(Effect.map((evidence) => evidence.member))
        const channelState = !known || !grant.channelId ? Effect.succeed(authority.channel) : snapshot(client.channels.fetch(grant.channelId, { timeoutMs: 5000 })).pipe(
            Effect.flatMap((channel) => channel.id === grant.channelId && channel.guildId === serverId ? Effect.succeed(channel) : Effect.fail(new ActionExecutionError({ stage: "snapshot" }))))
        const target = grant.targetId ? { guildId: serverId, userId: grant.targetId } : undefined
        const now = yield* Clock.currentTimeMillis
        const options = { timeoutMs: 5000, auditReason: `NeonFlux case ${grant.caseNo}` }
        let operation: Effect.Effect<unknown, unknown> = Effect.void
        switch (grant.action) {
            case "log": case "warn": break
            case "kick": operation = client.members.kick(target!, options); break
            case "ban": operation = client.members.ban(target!, { reason: grant.reason, ...(grant.durationSeconds ? { durationMs: grant.durationSeconds * 1000 } : {}) }, options); break
            case "unban": operation = client.members.unban(target!, options); break
            case "timeout": case "quarantine": {
                const current = (yield* targetMember)?.communicationDisabledUntil
                if (grant.expectedTimeoutUntil !== undefined && current !== grant.expectedTimeoutUntil) return yield* Effect.fail(new ActionExecutionError({ stage: "snapshot" }))
                const until = current ? Date.parse(current) : 0
                const wanted = now + grant.durationSeconds! * 1000
                if (grant.action === "quarantine" && (current === undefined || !Number.isFinite(until))) return yield* Effect.fail(new ActionExecutionError({ stage: "snapshot" }))
                if (grant.action === "quarantine" && until >= wanted) return yield* Effect.fail(new ActionExecutionError({ stage: "snapshot" }))
                operation = client.members.timeout(target!, grant.durationSeconds! * 1000, { ...options, timeoutReason: grant.reason })
                break
            }
            case "release": case "untimeout": {
                const current = (yield* targetMember)?.communicationDisabledUntil
                if (grant.expectedTimeoutUntil === undefined || current !== grant.expectedTimeoutUntil) return yield* Effect.fail(new ActionExecutionError({ stage: "snapshot" }))
                if (grant.action === "release" && grant.restoreTimeoutUntil && Date.parse(grant.restoreTimeoutUntil) > now) return yield* Effect.fail(new ActionExecutionError({ stage: "snapshot" }))
                operation = client.members.clearTimeout(target!, options)
                break
            }
            case "delete": operation = client.messages.delete({ channelId: grant.channelId!, id: grant.messageIds![0]! }, options); break
            case "purge": operation = client.messages.deleteMany(grant.channelId!, grant.messageIds!, options); break
            case "slowmode": {
                const channel = yield* channelState
                if (!channel || !("rateLimitPerUser" in channel) || channel.rateLimitPerUser !== grant.expectedSlowmodeSeconds) return yield* Effect.fail(new ActionExecutionError({ stage: "snapshot" }))
                operation = client.channels.edit(grant.channelId!, { rateLimitPerUser: grant.slowmodeSeconds! }, options)
                break
            }
            case "lock": case "unlock": {
                const channel = yield* channelState
                const current = yield* Effect.try({ try: () => overwriteSnapshot(channel!, serverId), catch: () => new ActionExecutionError({ stage: "snapshot" }) })
                if (!grant.expectedOverwrite || !grant.overwrite || !matchingLockBits(current, grant.expectedOverwrite)) return yield* Effect.fail(new ActionExecutionError({ stage: "snapshot" }))
                const allow = (BigInt(current.allow) & ~Permissions.SendMessages) | (BigInt(grant.overwrite.allow) & Permissions.SendMessages)
                const deny = (BigInt(current.deny) & ~Permissions.SendMessages) | (BigInt(grant.overwrite.deny) & Permissions.SendMessages)
                operation = !grant.overwrite.exists && allow === 0n && deny === 0n
                    ? client.channels.removePermissionOverwrite(grant.channelId!, serverId, options)
                    : client.channels.setPermissionOverwrite(grant.channelId!, { id: serverId, type: "role", allow, deny }, options)
                break
            }
        }
        if (grant.action !== "log" && grant.action !== "warn") yield* confirm
        const result = yield* Effect.exit(operation)
        if (Exit.isFailure(result) && Cause.hasInterrupts(result.cause)) return yield* Effect.failCause(result.cause)
        const outcome: ModerationOutcome = Exit.isSuccess(result) ? "succeeded" : result.cause.reasons.some((reason) => reason._tag !== "Fail"
            || !((reason.error instanceof GuildOperationError || reason.error instanceof ChannelOperationError || reason.error instanceof MessageOperationError)
                && reason.error.outcome === "notDispatched")) ? "uncertain" : "failed"
        let timeoutUntil: string | null | undefined
        let banExpiresAt: string | null | undefined
        if (Exit.isSuccess(result) && result.value && typeof result.value === "object" && "communicationDisabledUntil" in result.value) {
            const value = result.value.communicationDisabledUntil
            if (value === null || typeof value === "string") timeoutUntil = value
        }
        if (Exit.isSuccess(result) && ["timeout", "quarantine", "release", "untimeout"].includes(grant.action) && timeoutUntil === undefined) {
            return { outcome: "uncertain" as const }
        }
        if (Exit.isSuccess(result) && grant.action === "ban" && grant.durationSeconds) {
            const bans = yield* client.members.fetchBans(serverId, { timeoutMs: 5000 }).pipe(Effect.catch(() => Effect.succeed(undefined)))
            banExpiresAt = bans?.find((ban) => ban.userId === grant.targetId && ban.guildId === serverId)?.expiresAt
        }
        return { outcome, ...(timeoutUntil !== undefined ? { timeoutUntil } : {}), ...(banExpiresAt !== undefined ? { banExpiresAt } : {}) }
    })
}

export function observeAction(client: Client, serverId: string, action: { action: ModerationActionType, targetId?: string, channelId?: string }) {
    return Effect.gen(function* () {
        const observation: ProviderObservation = { originServerId: serverId, observedAt: yield* Clock.currentTimeMillis }
        if (action.targetId) {
            const evidence = yield* readNativeMember(client, serverId, action.targetId)
            const target = evidence.member
            if (target && (target.userId !== action.targetId || target.guildId !== serverId)) return yield* Effect.fail(new ActionExecutionError({ stage: "observation" }))
            observation.memberPresent = !!target
            observation.originServerId = evidence.originServerId
            observation.memberUserId = evidence.userId
            if (target?.communicationDisabledUntil !== undefined) observation.timeoutUntil = target.communicationDisabledUntil
            if (action.action === "ban" || action.action === "unban") {
                const bans = yield* client.members.fetchBans(serverId, { timeoutMs: 5000 })
                const ban = bans.find((item) => item.userId === action.targetId && item.guildId === serverId)
                observation.banned = ban !== undefined
                if (ban?.expiresAt !== undefined) observation.banExpiresAt = ban.expiresAt
            }
        }
        if (action.channelId) {
            const channel = yield* client.channels.fetch(action.channelId, { timeoutMs: 5000 })
            if (channel.id !== action.channelId || channel.guildId !== serverId) return yield* Effect.fail(new ActionExecutionError({ stage: "observation" }))
            if (action.action === "lock" || action.action === "unlock") observation.overwrite = yield* Effect.try({ try: () => overwriteSnapshot(channel, serverId), catch: () => new ActionExecutionError({ stage: "observation" }) })
            if (action.action === "slowmode" && "rateLimitPerUser" in channel && typeof channel.rateLimitPerUser === "number") observation.slowmodeSeconds = channel.rateLimitPerUser
        }
        return observation
    }).pipe(Effect.mapError(() => new ActionExecutionError({ stage: "observation" })))
}
