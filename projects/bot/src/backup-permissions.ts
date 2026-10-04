import {
    BACKUP_CATEGORY_LIMITS,
    BACKUP_RESTORE_LIMITS,
    BackupStructureObject,
    type BackupConfigObject,
    type BackupContext,
    type BackupLiveChannel,
    type BackupNativeObservation,
    type BackupNativeProof,
    type BackupReference,
} from "@neonflux/contracts/backup"
import { readNativeMember } from "./member-evidence.ts"
import {
    errors,
    ChannelType,
    hierarchy,
    isThreadChannel,
    permissionBits,
    Permissions,
    type Client,
    type GuildChannel,
} from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect, Schema } from "effect"
import { STRUCTURE_CHANNELS } from "@neonflux/contracts/common"
import { readSafetyAuthority, type SafetyAuthority } from "./safety-permissions.ts"

export class BackupPermissionError extends Data.TaggedError("BackupPermissionError")<{
    readonly reason: "owner" | "private" | "identity" | "snapshot" | "limit" | "reference" | "transport"
}> {}
const validTime = (v: string | null | undefined, now: number) =>
    v === null || (typeof v === "string" && v.length <= 64 && Number.isFinite(Date.parse(v)) && Date.parse(v) <= now)
export type BackupEvidence = { readonly context: BackupContext; readonly authority: SafetyAuthority }
/** The actual Owner in a private one-to-one DM, with the server's authority this check read. A native proof of the same step reuses it */
export function readBackupEvidence(client: Client, serverId: string, ownerId: string, privateChannelId: string) {
    return Effect.gen(function* () {
        const authority = yield* readSafetyAuthority(client, serverId, ownerId)
        const instance = yield* client.instance.resolve({ timeoutMs: 5000 })
        const dm = yield* client.directMessages.fetch(privateChannelId, { timeoutMs: 5000 })
        const now = yield* Clock.currentTimeMillis
        if (
            !authority.isOwner ||
            authority.guild.ownerId !== ownerId ||
            authority.actor.isBot ||
            authority.actor.userId === authority.botId ||
            !authority.bot.isBot ||
            !Number.isFinite(Date.parse(authority.actor.joinedAt)) ||
            !validTime(authority.actor.communicationDisabledUntil, now) ||
            !validTime(authority.bot.communicationDisabledUntil, now)
        )
            return yield* Effect.fail(new BackupPermissionError({ reason: "owner" }))
        if (
            dm.id !== privateChannelId ||
            dm.type !== "dm" ||
            !dm.recipients.some((r) => r.id === ownerId && !r.isBot && !r.isSystem) ||
            !dm.recipients.every(
                (r) =>
                    (r.id === ownerId && !r.isBot && !r.isSystem) ||
                    (r.id === authority.botId && r.isBot && !r.isSystem),
            )
        )
            return yield* Effect.fail(new BackupPermissionError({ reason: "private" }))
        const context: BackupContext = {
            originServerId: authority.guild.id,
            provider: new URL(instance.endpoints.apiPublic).origin,
            observedAt: now,
            ownerId: authority.guild.ownerId,
            actorId: ownerId,
            actorKind: "human",
            botId: authority.botId,
            botKind: "bot",
            ownerJoinedAt: authority.actor.joinedAt,
            ownerTimeoutUntil: authority.actor.communicationDisabledUntil!,
            botTimeoutUntil: authority.bot.communicationDisabledUntil!,
            dmChannelId: privateChannelId,
            dmType: 1,
            recipientIds: [ownerId],
            privateReplyAuthorized: true,
        }
        const evidence: BackupEvidence = { context, authority }
        return evidence
    }).pipe(
        Effect.mapError((e) =>
            e instanceof BackupPermissionError ? e : new BackupPermissionError({ reason: "transport" }),
        ),
    )
}
export const readBackupContext = (client: Client, serverId: string, ownerId: string, privateChannelId: string) =>
    readBackupEvidence(client, serverId, ownerId, privateChannelId).pipe(Effect.map((evidence) => evidence.context))
const backupChannelTypes: readonly (string | number)[] = [
    ChannelType.Category,
    ChannelType.Text,
    ChannelType.Voice,
    ChannelType.Announcement,
]
const structureType = {
    [ChannelType.Category]: "category",
    [ChannelType.Text]: "text",
    [ChannelType.Voice]: "voice",
    [ChannelType.Announcement]: "announcement",
} as const
export function snapshotBackupChannel(channel: GuildChannel, capturedAt: number): BackupStructureObject {
    try {
        if (!backupChannelTypes.includes(channel.type) || !channel.permissionOverwrites) throw new Error()
        const object: BackupStructureObject = {
            sourceId: channel.id,
            type: structureType[channel.type as keyof typeof structureType],
            name: channel.name!,
            parentId: channel.parentId ?? null,
            capturedAt,
            overwrites: channel.permissionOverwrites
                .map((o) => ({ id: o.id, type: o.type, allow: o.allow.toString(), deny: o.deny.toString() }))
                .sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)),
            ...(channel.type === ChannelType.Text || channel.type === ChannelType.Announcement
                ? {
                      ...(channel.nsfw !== undefined ? { nsfw: channel.nsfw } : {}),
                      ...(channel.topic !== undefined ? { topic: channel.topic } : {}),
                      ...(channel.rateLimitPerUser !== undefined ? { slowmodeSeconds: channel.rateLimitPerUser } : {}),
                  }
                : {}),
            ...(channel.type === ChannelType.Voice
                ? {
                      ...(channel.bitrate !== undefined && channel.bitrate !== null
                          ? { bitrate: channel.bitrate }
                          : {}),
                      ...(channel.userLimit !== undefined && channel.userLimit !== null
                          ? { userLimit: channel.userLimit }
                          : {}),
                  }
                : {}),
        }
        return Schema.decodeSync(BackupStructureObject, { onExcessProperty: "error" })(object)
    } catch {
        throw new BackupPermissionError({ reason: "snapshot" })
    }
}
export function captureBackupStructure(client: Client, serverId: string, ownerId: string, privateChannelId: string) {
    return Effect.gen(function* () {
        yield* readBackupContext(client, serverId, ownerId, privateChannelId)
        const startedAt = yield* Clock.currentTimeMillis
        const all = yield* client.channels.fetchAll(serverId, { timeoutMs: 5000 })
        const observedAt = yield* Clock.currentTimeMillis
        // Only category, text, announcement and voice channels are restorable. Other channel types stay out of the archive
        const channels = all.filter((c) => backupChannelTypes.includes(c.type))
        if (channels.length > BACKUP_CATEGORY_LIMITS.structure)
            return yield* Effect.fail(new BackupPermissionError({ reason: "limit" }))
        if (new Set(channels.map((c) => c.id)).size !== channels.length || channels.some((c) => c.guildId !== serverId))
            return yield* Effect.fail(new BackupPermissionError({ reason: "snapshot" }))
        const objects = yield* Effect.try({
            try: () => channels.map((c) => snapshotBackupChannel(c, observedAt)),
            catch: () => new BackupPermissionError({ reason: "snapshot" }),
        })
        if (objects.reduce((n, c) => n + c.overwrites.length, 0) > BACKUP_RESTORE_LIMITS.overwrites)
            return yield* Effect.fail(new BackupPermissionError({ reason: "limit" }))
        if (objects.some((c) => c.parentId && !objects.some((p) => p.sourceId === c.parentId && p.type === "category")))
            return yield* Effect.fail(new BackupPermissionError({ reason: "snapshot" }))
        yield* readBackupContext(client, serverId, ownerId, privateChannelId)
        return {
            objects: objects.sort((a, b) =>
                a.type === b.type
                    ? a.sourceId.localeCompare(b.sourceId)
                    : a.type === "category"
                      ? -1
                      : b.type === "category"
                        ? 1
                        : a.type.localeCompare(b.type),
            ),
            startedAt,
            finishedAt: yield* Clock.currentTimeMillis,
        }
    }).pipe(
        Effect.mapError((e) =>
            e instanceof BackupPermissionError ? e : new BackupPermissionError({ reason: "transport" }),
        ),
    )
}
/**
 * Exact original/response-bound IDs only. No name discovery or creation inference. The evidence is the step's own fresh Owner check.
 * withChannels also lists every channel of the server from one read, which a restore needs to see the channels the archive does not hold and the
 * channels a category's permission change would also reach. fromList takes each object's channel from that one read instead of reading it by ID,
 * so a pass can observe many channels, and the categories they name, with a single request. A channel the list does not hold is observed as absent
 */
export function readBackupNativeProof(
    client: Client,
    serverId: string,
    { context, authority }: BackupEvidence,
    objects: readonly (BackupConfigObject | BackupStructureObject)[],
    mappings: ReadonlyMap<string, string> = new Map(),
    channelIds: readonly string[] = [],
    withChannels = false,
    fromList = false,
) {
    return Effect.gen(function* () {
        const actorBits = client.permissions.calculate({
            guild: authority.guild,
            member: authority.actor,
            roles: authority.roles,
        })
        const botBits = client.permissions.calculate({
            guild: authority.guild,
            member: authority.bot,
            roles: authority.roles,
        })
        const needed = new Map<string, "role" | "member" | "channel">(),
            observations: BackupNativeObservation[] = [],
            references: BackupReference[] = [],
            channels: BackupLiveChannel[] = []
        const botIn = (channel: GuildChannel) =>
            client.permissions.calculate({
                guild: authority.guild,
                member: authority.bot,
                roles: authority.roles,
                channel,
            })
        const add = (id: string, type: "role" | "member" | "channel") => {
            const key = `${type}:${id}`
            needed.set(key, type)
        }
        const listed =
            withChannels || fromList
                ? (yield* client.channels.fetchAll(serverId, { timeoutMs: 5000 })).filter((c) => c.guildId === serverId)
                : []
        const byId = new Map(listed.map((c) => [c.id, c]))
        for (const object of objects) {
            if ("family" in object) {
                const visit = (v: unknown, key = "") => {
                    if (Array.isArray(v)) {
                        for (const entry of v) visit(entry, key)
                        return
                    }
                    if (v && typeof v === "object") {
                        for (const [k, entry] of Object.entries(v))
                            visit(
                                entry,
                                k === "staffRoleIds"
                                    ? "roleIds"
                                    : /^(moderation|cases|automod|security|appeals)$/.test(k) && key === "roleIds"
                                      ? "roleIds"
                                      : k,
                            )
                        return
                    }
                    if (typeof v !== "string" || !/^[1-9]\d{0,18}$/.test(v)) return
                    if (/role/i.test(key)) add(v, "role")
                    else if (/channel|parentId/i.test(key)) add(mappings.get(v) ?? v, "channel")
                    else if (/ownerId|userId/i.test(key)) add(v, "member")
                }
                visit(object.value)
                continue
            }
            const targetId = mappings.get(object.sourceId) ?? object.sourceId
            const native = fromList
                ? byId.get(targetId)
                : yield* client.channels
                      .fetch(targetId, { timeoutMs: 5000 })
                      .pipe(
                          Effect.catch((e) =>
                              errors.isNotFound(e, "channel") ? Effect.succeed(undefined) : Effect.fail(e),
                          ),
                      )
            const observedAt = yield* Clock.currentTimeMillis
            if (native && (native.id !== targetId || native.guildId !== serverId))
                return yield* Effect.fail(new BackupPermissionError({ reason: "identity" }))
            const snapshot = native
                ? yield* Effect.try({
                      try: () => snapshotBackupChannel(native, observedAt),
                      catch: () => new BackupPermissionError({ reason: "snapshot" }),
                  }).pipe(Effect.catch(() => Effect.succeed(null)))
                : null
            observations.push({
                originServerId: authority.guild.id,
                sourceId: targetId,
                observedAt,
                status: !native ? "absent" : snapshot ? "present" : "unknown",
                channel: snapshot,
                botPermissions: native ? botIn(native).toString() : "0",
            })
            if (object.parentId) add(mappings.get(object.parentId) ?? object.parentId, "channel")
            for (const overwrite of object.overwrites) add(overwrite.id, overwrite.type)
        }
        for (const id of channelIds) add(mappings.get(id) ?? id, "channel")
        if (withChannels) {
            const all = listed
            if (all.length > STRUCTURE_CHANNELS)
                return yield* Effect.fail(new BackupPermissionError({ reason: "snapshot" }))
            for (const c of all) {
                const parent = c.parentId ? byId.get(c.parentId) : undefined
                channels.push({
                    originServerId: authority.guild.id,
                    id: c.id,
                    type:
                        structureType[c.type as keyof typeof structureType] ??
                        (c.type === ChannelType.Link ? "link" : "other"),
                    name: (c.name ?? "").slice(0, 100),
                    parentId: c.parentId ?? null,
                    botCanManage: !!(botIn(c) & Permissions.ManageChannels),
                    synced:
                        !!parent?.permissionOverwrites &&
                        !!c.permissionOverwrites &&
                        permissionBits.sameOverwrites(c.permissionOverwrites, parent.permissionOverwrites),
                })
            }
        }
        if (needed.size > 600) return yield* Effect.fail(new BackupPermissionError({ reason: "reference" }))
        for (const [key, type] of needed) {
            const id = key.slice(key.indexOf(":") + 1),
                observedAt = yield* Clock.currentTimeMillis
            if (type === "role") {
                const role = authority.roles.find((r) => r.id === id),
                    manage =
                        !!role &&
                        (id === serverId ||
                            hierarchy.canManageRole({
                                guild: authority.guild,
                                actor: authority.bot,
                                role,
                                roles: authority.roles,
                            }))
                references.push({
                    originServerId: authority.guild.id,
                    id,
                    type,
                    serverId,
                    observedAt,
                    exists: !!role,
                    actorCanAccess: !!role,
                    botCanAccess: !!role,
                    actorCanManage: !!role,
                    botCanManage: manage,
                    permissions: role?.permissions.toString() ?? "0",
                })
            } else if (type === "member") {
                const evidence = yield* readNativeMember(client, serverId, id)
                const member = evidence.member
                const manage =
                    !!member &&
                    (id === authority.botId ||
                        hierarchy.canManage({
                            guild: authority.guild,
                            actor: authority.bot,
                            target: member,
                            roles: authority.roles,
                        }))
                references.push({
                    originServerId: evidence.originServerId,
                    id: evidence.userId,
                    type,
                    serverId,
                    observedAt: yield* Clock.currentTimeMillis,
                    exists: !!member,
                    actorCanAccess: !!member,
                    botCanAccess: !!member,
                    actorCanManage: !!member,
                    botCanManage: manage,
                    permissions: member
                        ? client.permissions
                              .calculate({ guild: authority.guild, member, roles: authority.roles })
                              .toString()
                        : "0",
                })
            } else {
                const read = (channelId: string) =>
                    client.channels
                        .fetch(channelId, { timeoutMs: 5000 })
                        .pipe(
                            Effect.catch((e) =>
                                errors.isNotFound(e, "channel") ? Effect.succeed(undefined) : Effect.fail(e),
                            ),
                        )
                const channel = fromList ? byId.get(id) : yield* read(id)
                // An announcement channel counts as a message channel when configuration names it.
                // So does a thread, such as one leveling excludes, which takes its permissions from its parent
                if (
                    channel &&
                    (channel.id !== id ||
                        channel.guildId !== serverId ||
                        !(backupChannelTypes.includes(channel.type) || isThreadChannel(channel)))
                )
                    return yield* Effect.fail(new BackupPermissionError({ reason: "identity" }))
                const parentId = isThreadChannel(channel) ? channel.parentId : undefined
                const parentChannel = parentId ? (byId.get(parentId) ?? (yield* read(parentId))) : undefined
                if (parentChannel && (parentChannel.id !== parentId || parentChannel.guildId !== serverId))
                    return yield* Effect.fail(new BackupPermissionError({ reason: "identity" }))
                // A thread whose parent is gone cannot be checked, so only the settings that name it are blocked
                const input = !channel
                    ? undefined
                    : !parentId
                      ? { channel }
                      : parentChannel
                        ? { channel, parentChannel }
                        : undefined
                const actor = input
                    ? client.permissions.calculate({
                          guild: authority.guild,
                          member: authority.actor,
                          roles: authority.roles,
                          ...input,
                      })
                    : 0n
                const bot = input
                    ? client.permissions.calculate({
                          guild: authority.guild,
                          member: authority.bot,
                          roles: authority.roles,
                          ...input,
                      })
                    : 0n
                references.push({
                    originServerId: authority.guild.id,
                    id,
                    type:
                        channel?.type === ChannelType.Category
                            ? "category"
                            : channel?.type === ChannelType.Voice
                              ? "voice"
                              : "text",
                    serverId,
                    observedAt: yield* Clock.currentTimeMillis,
                    exists: !!channel,
                    actorCanAccess: !!(actor & Permissions.ViewChannel),
                    botCanAccess: !!(bot & Permissions.ViewChannel),
                    actorCanManage: !!(actor & Permissions.ManageChannels),
                    botCanManage: !!(bot & Permissions.ManageChannels),
                    permissions: bot.toString(),
                })
            }
        }
        const proof: BackupNativeProof = {
            originServerId: authority.guild.id,
            observedAt: yield* Clock.currentTimeMillis,
            serverId,
            ownerId: context.ownerId,
            botId: context.botId,
            actorPermissions: actorBits.toString(),
            botPermissions: botBits.toString(),
            actorCanManageChannels: !!(actorBits & Permissions.ManageChannels),
            botCanManageChannels: !!(botBits & Permissions.ManageChannels) && !!(botBits & Permissions.ManageRoles),
            references,
            observations,
            channels,
        }
        return proof
    }).pipe(
        Effect.mapError((e) =>
            e instanceof BackupPermissionError ? e : new BackupPermissionError({ reason: "transport" }),
        ),
    )
}
