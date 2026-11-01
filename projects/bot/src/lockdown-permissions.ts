import type { LockdownPlanRow, LockdownWorkRow } from "@neonflux/contracts/lockdown"
import {
    ChannelType,
    errors,
    permissionBits,
    Permissions,
    type Client,
    type GuildChannel,
    type GuildRole,
} from "@neontechspace/fluxerly/effect"
import { Cause, Data, Effect, Exit } from "effect"
import { overwriteSnapshot } from "./action-executor.ts"
import {
    allowBotPosting,
    postingPermissions,
    readAuthenticatedBotId,
    readSafetyAuthority,
} from "./safety-permissions.ts"

export class LockdownPlanError extends Data.TaggedError("LockdownPlanError")<{}> {}

// Fluxer's edge answers a plain 429 with a five second wait when busy, and a wait as long as the timeout fails the write unsent
const options = { timeoutMs: 15000, auditReason: "NeonFlux lockdown" }
/**
 * A write's result. A write known unsent, or that Fluxer answered with a 429, may go again, so a raid does not leave a channel open waiting for
 * staff. Fluxer refusing it fails, and an unknown result stays uncertain and is never repeated
 */
const writeOutcome = (operation: Effect.Effect<unknown, unknown>) =>
    Effect.gen(function* () {
        const result = yield* Effect.exit(operation)
        if (Exit.isSuccess(result)) return "done" as const
        if (Cause.hasInterrupts(result.cause)) return yield* Effect.failCause(result.cause)
        const outcome = errors.outcome(result.cause)
        if (outcome === "notDispatched" || (outcome === "rejected" && errors.retryAfterMs(result.cause) !== undefined))
            return "retry" as const
        return outcome === "rejected" ? ("failed" as const) : ("uncertain" as const)
    })
/** The channels whose chat a lockdown stops. Threads follow their parent, and a category holds no chat */
const lockableTypes: readonly unknown[] = [
    ChannelType.Text,
    ChannelType.Announcement,
    ChannelType.Forum,
    ChannelType.Voice,
]
type Overwrites = NonNullable<GuildChannel["permissionOverwrites"]>[number]
const memberOverwrite = (channel: GuildChannel, botId: string): Overwrites | undefined =>
    channel.permissionOverwrites?.find((item) => item.id === botId && item.type === "member")
const roleOverwrite = (channel: GuildChannel, serverId: string): Overwrites | undefined =>
    channel.permissionOverwrites?.find((item) => item.id === serverId && item.type === "role")

/** A role that runs the server rather than a role members join with. A channel only such roles view is a staff channel */
const staffPermissions =
    Permissions.Administrator |
    Permissions.ManageGuild |
    Permissions.ManageRoles |
    Permissions.ManageChannels |
    Permissions.ManageMessages |
    Permissions.BanMembers |
    Permissions.KickMembers |
    Permissions.ModerateMembers
/**
 * Whether only staff can view a channel. Many servers show channels through a member role and deny View channel to everyone, so a denial for
 * everyone alone does not make a channel private. A member overwrite, as a ticket has, shows it to one person, not to a role
 */
function privateChannel(channel: GuildChannel, serverId: string, roles: readonly GuildRole[]) {
    const base = roles.find((role) => role.id === serverId)?.permissions ?? 0n,
        everyone = roleOverwrite(channel, serverId)
    const views = (role?: GuildRole) => {
        let bits = base | (role?.permissions ?? 0n)
        if (permissionBits.has(bits, "Administrator")) return true
        if (everyone) bits = (bits & ~everyone.deny) | everyone.allow
        const own = role && roleOverwrite(channel, role.id)
        if (own) bits = (bits & ~own.deny) | own.allow
        return (bits & Permissions.ViewChannel) !== 0n
    }
    return (
        !views() &&
        !roles.some((role) => role.id !== serverId && (role.permissions & staffPermissions) === 0n && views(role))
    )
}
/**
 * Whether a lockdown of this channel leaves a role able to post. Fluxer applies a channel's everyone overwrite first and role overwrites
 * after it, so a role's own allow for Send messages outlives the denial. A lockdown changes only the everyone role, so it can only say so
 */
const roleStillPosts = (channel: GuildChannel, serverId: string, roles: readonly GuildRole[]) =>
    channel.permissionOverwrites?.some(
        (item) =>
            item.type === "role" &&
            item.id !== serverId &&
            (item.allow & Permissions.SendMessages) !== 0n &&
            ((roles.find((role) => role.id === item.id)?.permissions ?? 0n) & staffPermissions) === 0n,
    ) ?? false

/** One channel of a new lockdown, from the bot's fresh read. A lockdown owns only what it adds, so a !security lock keeps what it holds */
export function lockdownPlanRow(
    channel: GuildChannel,
    serverId: string,
    botId: string,
    roles: readonly GuildRole[],
    botServerPermissions: bigint,
): LockdownPlanRow | undefined {
    if (!lockableTypes.includes(channel.type)) return undefined
    const everyone = overwriteSnapshot(channel, serverId),
        own = memberOverwrite(channel, botId)
    const botBefore = own
        ? { exists: true, allow: own.allow.toString(), deny: own.deny.toString() }
        : { exists: false, allow: "0", deny: "0" }
    const row = { channelId: channel.id, everyone, botBefore }
    // Fluxer lets a bot stop denying only permissions it holds, so a lockdown owns SendMessages and the thread bits the bot holds
    const wanted = Permissions.SendMessages | (botServerPermissions & postingPermissions)
    // Private staff and ticket channels already hold nothing for everyone
    if (privateChannel(channel, serverId, roles)) return { ...row, skip: "private", bits: "0" }
    const bits = wanted & ~BigInt(everyone.deny)
    if (!bits) return { ...row, skip: "held", bits: "0" }
    // The lockdown denies these for the bot too, so it first allows them for itself, as a channel lock does
    const botSet =
        !permissionBits.has(botServerPermissions, "Administrator") && ((own?.allow ?? 0n) & bits) !== bits
            ? { allow: ((own?.allow ?? 0n) | bits).toString(), deny: ((own?.deny ?? 0n) & ~bits).toString() }
            : undefined
    return { ...row, bits: bits.toString(), ...(botSet ? { botSet } : {}) }
}

/** What the channels hold now, read fresh with what NeonFlux may do. canWrite is false without Manage roles */
export function readLockdownFacts(client: Client, serverId: string) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const authority = yield* readSafetyAuthority(client, serverId, botId, { permission: Permissions.ManageRoles })
        const channels = yield* client.channels.fetchAll(serverId, { timeoutMs: options.timeoutMs })
        return {
            botId,
            channels,
            canWrite: authority.botPermissionAuthorized,
            botServerPermissions: authority.botServerPermissions,
            roles: authority.roles,
        }
    })
}
/** The server's channels as a lockdown plan, with how many keep a role that can still post */
export function readLockdownPlan(client: Client, serverId: string) {
    return readLockdownFacts(client, serverId).pipe(
        Effect.flatMap((facts) =>
            Effect.try({
                try: () => {
                    const rows = facts.channels.flatMap((channel) => {
                        const row = lockdownPlanRow(
                            channel,
                            serverId,
                            facts.botId,
                            facts.roles,
                            facts.botServerPermissions,
                        )
                        return row ? [{ row, channel }] : []
                    })
                    return {
                        canWrite: facts.canWrite,
                        plan: rows.map(({ row }) => row),
                        stillPost: rows.filter(
                            ({ row, channel }) => !row.skip && roleStillPosts(channel, serverId, facts.roles),
                        ).length,
                    }
                },
                catch: () => new LockdownPlanError(),
            }),
        ),
    )
}

/** Locks one channel from its fresh read. Unrelated bits the channel holds now stay as they are */
export function lockChannel(
    client: Client,
    serverId: string,
    botId: string,
    botServerPermissions: bigint,
    row: LockdownWorkRow,
    channel: GuildChannel,
) {
    const bits = BigInt(row.bits),
        current = roleOverwrite(channel, serverId)
    return writeOutcome(
        allowBotPosting(
            client,
            channel.id,
            botId,
            botServerPermissions,
            bits,
            memberOverwrite(channel, botId),
            options,
        ).pipe(
            Effect.andThen(
                client.channels.setPermissionOverwrite(
                    channel.id,
                    {
                        id: serverId,
                        type: "role",
                        allow: (current?.allow ?? 0n) & ~bits,
                        deny: (current?.deny ?? 0n) | bits,
                    },
                    options,
                ),
            ),
        ),
    )
}
/**
 * Gives one channel back only what this lockdown changed, from its fresh read. A bit no longer denied was changed by someone since and
 * stays their choice. An everyone overwrite that did not exist before and now holds nothing is removed, and NeonFlux's own allow goes
 * when it is still exactly what the lockdown set
 */
export function restoreChannel(
    client: Client,
    serverId: string,
    botId: string,
    row: LockdownWorkRow,
    channel: GuildChannel,
) {
    const current = roleOverwrite(channel, serverId),
        still = BigInt(row.bits) & (current?.deny ?? 0n)
    const writes: Effect.Effect<unknown, unknown>[] = []
    if (current && still) {
        const allow = (current.allow & ~still) | (BigInt(row.everyone.allow) & still),
            deny = (current.deny & ~still) | (BigInt(row.everyone.deny) & still)
        writes.push(
            !row.everyone.exists && allow === 0n && deny === 0n
                ? client.channels.removePermissionOverwrite(channel.id, serverId, options)
                : client.channels.setPermissionOverwrite(
                      channel.id,
                      { id: serverId, type: "role", allow, deny },
                      options,
                  ),
        )
    }
    const own = memberOverwrite(channel, botId)
    if (row.botSet && own && own.allow.toString() === row.botSet.allow && own.deny.toString() === row.botSet.deny)
        writes.push(
            row.botBefore.exists
                ? client.channels.setPermissionOverwrite(
                      channel.id,
                      {
                          id: botId,
                          type: "member",
                          allow: BigInt(row.botBefore.allow),
                          deny: BigInt(row.botBefore.deny),
                      },
                      options,
                  )
                : client.channels.removePermissionOverwrite(channel.id, botId, options),
        )
    return writeOutcome(Effect.forEach(writes, (write) => write, { discard: true }))
}
/**
 * Whether a channel holds what its phase set out to do, read without writing anything. A restore has two writes, so one that stopped between
 * them counts as done only once NeonFlux's own allow is gone too
 */
export function lockdownSettled(row: LockdownWorkRow, channel: GuildChannel, serverId: string, botId: string) {
    const denied = roleOverwrite(channel, serverId)?.deny ?? 0n,
        bits = BigInt(row.bits)
    if (row.phase === "lock") return (denied & bits) === bits
    const own = memberOverwrite(channel, botId)
    const allowLeft =
        row.botSet && own?.allow.toString() === row.botSet.allow && own.deny.toString() === row.botSet.deny
    return (denied & bits) === 0n && !allowLeft
}
