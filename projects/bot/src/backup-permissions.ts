import type * as C from "@neonflux/backend/contracts"
import { readNativeMember } from "./member-evidence.ts"
import { ChannelFlags, ChannelOperationError, ChannelType, hierarchy, Permissions, type Client, type GuildChannel } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect, Schema } from "effect"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { backupStructureObjectSchema, backupSafeAllowMask, backupKnownDenyMask } from "./backup-store.ts"

export class BackupPermissionError extends Data.TaggedError("BackupPermissionError")<{ readonly reason: "owner" | "private" | "identity" | "snapshot" | "permissions" | "reference" | "transport" }> {}
const validTime = (v: string | null | undefined, now: number) => v === null || typeof v === "string" && v.length <= 64 && Number.isFinite(Date.parse(v)) && Date.parse(v) <= now
export function readBackupContext(client: Client, serverId: string, ownerId: string, privateChannelId: string) {
    return Effect.gen(function* () {
        const authority = yield* readSafetyAuthority(client, serverId, ownerId)
        const instance = yield* client.instance.resolve({ timeoutMs: 5000 })
        const dm = yield* client.directMessages.fetch(privateChannelId, { timeoutMs: 5000 })
        const now = yield* Clock.currentTimeMillis
        if (!authority.isOwner || authority.guild.ownerId !== ownerId || authority.actor.isBot || authority.actor.userId === authority.botId
            || !authority.bot.isBot || !Number.isFinite(Date.parse(authority.actor.joinedAt)) || !validTime(authority.actor.communicationDisabledUntil, now) || !validTime(authority.bot.communicationDisabledUntil, now)) return yield* Effect.fail(new BackupPermissionError({ reason: "owner" }))
        if (dm.id !== privateChannelId || dm.type !== "dm" || !dm.recipients.some(r => r.id === ownerId && !r.isBot && !r.isSystem)
            || !dm.recipients.every(r => r.id === ownerId && !r.isBot && !r.isSystem || r.id === authority.botId && r.isBot && !r.isSystem)) return yield* Effect.fail(new BackupPermissionError({ reason: "private" }))
        const context: C.BackupContext = { originServerId: authority.guild.id, provider: new URL(instance.endpoints.apiPublic).origin, observedAt: now, ownerId: authority.guild.ownerId, actorId: ownerId, actorKind: "human", botId: authority.botId, botKind: "bot", ownerJoinedAt: authority.actor.joinedAt,
            ownerTimeoutUntil: authority.actor.communicationDisabledUntil!, botTimeoutUntil: authority.bot.communicationDisabledUntil!, dmChannelId: privateChannelId, dmType: 1, recipientIds: [ownerId], privateReplyAuthorized: true }
        return context
    }).pipe(Effect.mapError(e => e instanceof BackupPermissionError ? e : new BackupPermissionError({ reason: "transport" })))
}
const backupChannelTypes: readonly (string | number)[] = [ChannelType.Category, ChannelType.Text, ChannelType.Voice, ChannelType.Forum, ChannelType.Media]
const structureType = { [ChannelType.Category]: "category", [ChannelType.Text]: "text", [ChannelType.Voice]: "voice", [ChannelType.Forum]: "forum", [ChannelType.Media]: "media" } as const
// Fields Fluxer leaves out of a payload stay out of the snapshot. Tags are sorted by name, since their IDs are not kept
function forumSettings(channel: GuildChannel) {
    if (channel.type !== ChannelType.Forum && channel.type !== ChannelType.Media) return {}
    const tags = channel.availableTags?.map(t => ({ name: t.name, moderated: t.moderated, emojiId: t.emojiId, emojiName: t.emojiName })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    return { ...(channel.nsfw !== undefined ? { nsfw: channel.nsfw } : {}), ...(channel.topic !== undefined ? { topic: channel.topic } : {}), ...(channel.rateLimitPerUser !== undefined ? { slowmodeSeconds: channel.rateLimitPerUser } : {}),
        ...(tags ? { tags } : {}), ...(channel.defaultReactionEmoji !== undefined ? { defaultReaction: channel.defaultReactionEmoji && { emojiId: channel.defaultReactionEmoji.emojiId, emojiName: channel.defaultReactionEmoji.emojiName } } : {}),
        ...(channel.defaultAutoArchiveMinutes !== undefined ? { defaultAutoArchiveMinutes: channel.defaultAutoArchiveMinutes } : {}), ...(channel.defaultSortOrder !== undefined ? { sortOrder: channel.defaultSortOrder } : {}),
        ...(channel.type === ChannelType.Forum && channel.defaultForumLayout !== undefined ? { layout: channel.defaultForumLayout } : {}), ...(channel.flags !== undefined ? { requireTag: (channel.flags & ChannelFlags.RequireTag) !== 0 } : {}) }
}
export function snapshotBackupChannel(channel: GuildChannel, capturedAt: number): C.BackupStructureObject {
    try {
        if (!backupChannelTypes.includes(channel.type) || !channel.permissionOverwrites || channel.parentId === undefined) throw new Error()
        const object: C.BackupStructureObject = { sourceId: channel.id, type: structureType[channel.type as keyof typeof structureType], name: channel.name!, parentId: channel.parentId, ...forumSettings(channel),
            capturedAt, overwrites: channel.permissionOverwrites.map(o => ({ id: o.id, type: o.type, allow: o.allow.toString(), deny: o.deny.toString() })).sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)),
            ...(channel.type === ChannelType.Text ? { ...(channel.nsfw !== undefined ? { nsfw: channel.nsfw } : {}), ...(channel.topic !== undefined ? { topic: channel.topic } : {}), ...(channel.rateLimitPerUser !== undefined ? { slowmodeSeconds: channel.rateLimitPerUser } : {}) } : {}),
            ...(channel.type === ChannelType.Voice ? { ...(channel.bitrate !== undefined && channel.bitrate !== null ? { bitrate: channel.bitrate } : {}), ...(channel.userLimit !== undefined && channel.userLimit !== null ? { userLimit: channel.userLimit } : {}) } : {}) }
        return Schema.decodeUnknownSync(backupStructureObjectSchema, { onExcessProperty: "error" })(object)
    } catch { throw new BackupPermissionError({ reason: "snapshot" }) }
}
export function captureBackupStructure(client: Client, serverId: string, ownerId: string, privateChannelId: string) {
    return Effect.gen(function* () {
        yield* readBackupContext(client, serverId, ownerId, privateChannelId)
        const startedAt = yield* Clock.currentTimeMillis
        const all = yield* client.channels.fetchAll(serverId, { timeoutMs: 5000 })
        const observedAt = yield* Clock.currentTimeMillis
        // Only category, text and voice channels are restorable. Other channel types stay out of the archive
        const channels = all.filter(c => backupChannelTypes.includes(c.type))
        if (channels.length > 100 || new Set(channels.map(c => c.id)).size !== channels.length || channels.some(c => c.guildId !== serverId)) return yield* Effect.fail(new BackupPermissionError({ reason: "snapshot" }))
        const objects = yield* Effect.try({ try: () => channels.map(c => snapshotBackupChannel(c, observedAt)), catch: () => new BackupPermissionError({ reason: "snapshot" }) })
        if (objects.reduce((n, c) => n + c.overwrites.length, 0) > 500 || objects.some(c => c.parentId && !objects.some(p => p.sourceId === c.parentId && p.type === "category"))) return yield* Effect.fail(new BackupPermissionError({ reason: "snapshot" }))
        yield* readBackupContext(client, serverId, ownerId, privateChannelId)
        return { objects: objects.sort((a, b) => a.type === b.type ? a.sourceId.localeCompare(b.sourceId) : a.type === "category" ? -1 : b.type === "category" ? 1 : a.type.localeCompare(b.type)), startedAt, finishedAt: yield* Clock.currentTimeMillis }
    }).pipe(Effect.mapError(e => e instanceof BackupPermissionError ? e : new BackupPermissionError({ reason: "transport" })))
}
/** Exact original/response-bound IDs only. No name discovery or creation inference */
export function readBackupNativeProof(client: Client, serverId: string, ownerId: string, privateChannelId: string, objects: readonly (C.BackupConfigObject | C.BackupStructureObject)[], mappings: ReadonlyMap<string, string> = new Map()) {
    return Effect.gen(function* () {
        const context = yield* readBackupContext(client, serverId, ownerId, privateChannelId)
        const authority = yield* readSafetyAuthority(client, serverId, ownerId)
        const actorBits = client.permissions.calculate({ guild: authority.guild, member: authority.actor, roles: authority.roles })
        const botBits = client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles })
        const needed = new Map<string, "role" | "member" | "channel">(), observations: C.BackupNativeObservation[] = [], references: C.BackupReference[] = []
        const add = (id: string, type: "role" | "member" | "channel") => { const key = `${type}:${id}`; needed.set(key, type) }
        for (const object of objects) {
            if ("family" in object) {
                const visit = (v: unknown, key = "") => {
                    if (Array.isArray(v)) { for (const entry of v) visit(entry, key); return }
                    if (v && typeof v === "object") { for (const [k, entry] of Object.entries(v)) visit(entry, k === "staffRoleIds" ? "roleIds" : /^(moderation|cases|automod|security|appeals)$/.test(k) && key === "roleIds" ? "roleIds" : k); return }
                    if (typeof v !== "string" || !/^[1-9]\d{0,18}$/.test(v)) return
                    if (/role/i.test(key)) add(v, "role")
                    else if (/channel|parentId/i.test(key)) add(mappings.get(v) ?? v, "channel")
                    else if (/ownerId|userId/i.test(key)) add(v, "member")
                }
                visit(object.value)
                continue
            }
            const targetId = mappings.get(object.sourceId) ?? object.sourceId
            const native = yield* client.channels.fetch(targetId, { timeoutMs: 5000 }).pipe(Effect.catch(e => e instanceof ChannelOperationError && e.status === 404 && e.reason === "notFound" ? Effect.succeed(undefined) : Effect.fail(e)))
            const observedAt = yield* Clock.currentTimeMillis
            if (native && (native.id !== targetId || native.guildId !== serverId)) return yield* Effect.fail(new BackupPermissionError({ reason: "identity" }))
            const snapshot = native ? yield* Effect.try({ try: () => snapshotBackupChannel(native, observedAt), catch: () => new BackupPermissionError({ reason: "snapshot" }) }).pipe(Effect.catch(() => Effect.succeed(null))) : null
            observations.push({ originServerId: authority.guild.id, sourceId: targetId, observedAt, status: !native ? "absent" : snapshot ? "present" : "unknown", channel: snapshot })
            if (object.parentId) add(mappings.get(object.parentId) ?? object.parentId, "channel")
            for (const overwrite of object.overwrites) add(overwrite.id, overwrite.type)
        }
        if (needed.size > 600) return yield* Effect.fail(new BackupPermissionError({ reason: "reference" }))
        const botRank = authority.roles.filter(r => r.id === serverId || authority.bot.roleIds.includes(r.id)).sort((a, b) => hierarchy.compare(b, a))[0]
        for (const [key, type] of needed) {
            const id = key.slice(key.indexOf(":") + 1), observedAt = yield* Clock.currentTimeMillis
            if (type === "role") {
                const role = authority.roles.find(r => r.id === id), manage = !!role && (id === serverId || !!botRank && hierarchy.isAbove(botRank, role))
                references.push({ originServerId: authority.guild.id, id, type, serverId, observedAt, exists: !!role, actorCanAccess: !!role, botCanAccess: !!role, actorCanManage: !!role, botCanManage: manage, permissions: role?.permissions.toString() ?? "0" })
            } else if (type === "member") {
                const evidence = yield* readNativeMember(client, serverId, id)
                const member = evidence.member
                if (member && (member.guildId !== serverId || member.userId !== id)) return yield* Effect.fail(new BackupPermissionError({ reason: "identity" }))
                const manage = !!member && (id === authority.botId || hierarchy.canManage({ guild: authority.guild, actor: authority.bot, target: member, roles: authority.roles }))
                references.push({ originServerId: evidence.originServerId, id: evidence.userId, type, serverId, observedAt: yield* Clock.currentTimeMillis, exists: !!member, actorCanAccess: !!member, botCanAccess: !!member, actorCanManage: !!member, botCanManage: manage, permissions: member ? client.permissions.calculate({ guild: authority.guild, member, roles: authority.roles }).toString() : "0" })
            } else {
                const channel = yield* client.channels.fetch(id, { timeoutMs: 5000 }).pipe(Effect.catch(e => e instanceof ChannelOperationError && e.reason === "notFound" && e.status === 404 ? Effect.succeed(undefined) : Effect.fail(e)))
                // A forum or media channel counts as a message channel when configuration names it, such as a suggestion forum
                if (channel && (channel.id !== id || channel.guildId !== serverId || ![0, 2, 4, 15, 16].includes(channel.type as number))) return yield* Effect.fail(new BackupPermissionError({ reason: "identity" }))
                const actor = channel ? client.permissions.calculate({ guild: authority.guild, member: authority.actor, roles: authority.roles, channel }) : 0n
                const bot = channel ? client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, channel }) : 0n
                references.push({ originServerId: authority.guild.id, id, type: channel?.type === ChannelType.Category ? "category" : channel?.type === ChannelType.Voice ? "voice" : "text", serverId, observedAt: yield* Clock.currentTimeMillis, exists: !!channel, actorCanAccess: !!(actor & Permissions.ViewChannel), botCanAccess: !!(bot & Permissions.ViewChannel), actorCanManage: !!(actor & Permissions.ManageChannels), botCanManage: !!(bot & Permissions.ManageChannels), permissions: bot.toString() })
            }
        }
        const proof: C.BackupNativeProof = { originServerId: authority.guild.id, observedAt: yield* Clock.currentTimeMillis, serverId, ownerId: context.ownerId, botId: context.botId, actorPermissions: (actorBits & backupKnownDenyMask).toString(), botPermissions: (botBits & backupKnownDenyMask).toString(), actorCanManageChannels: !!(actorBits & Permissions.ManageChannels), botCanManageChannels: !!(botBits & Permissions.ManageChannels) && !!(botBits & Permissions.ManageRoles), references, observations }
        // Allow grants are checked independently here and again by the backend
        if (objects.some(o => !('family' in o) && o.overwrites.some(w => BigInt(w.allow) & ~backupSafeAllowMask || BigInt(w.allow) & ~actorBits || BigInt(w.allow) & ~botBits))) return yield* Effect.fail(new BackupPermissionError({ reason: "permissions" }))
        return proof
    }).pipe(Effect.mapError(e => e instanceof BackupPermissionError ? e : new BackupPermissionError({ reason: "transport" })))
}
