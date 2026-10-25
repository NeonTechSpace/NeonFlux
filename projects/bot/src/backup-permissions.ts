import {
    BACKUP_RESTORE_LIMITS,
    BackupStructureObject,
    type BackupConfigObject,
    type BackupContext,
    type BackupLiveChannel,
    type BackupNativeObservation,
    type BackupNativeProof,
    type BackupReference,
} from "@neonflux/contracts/backup"
import { readNativeMembers } from "./member-evidence.ts"
import {
    errors,
    ChannelFlags,
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
import { sorted } from "./structure.ts"

export class BackupPermissionError extends Data.TaggedError("BackupPermissionError")<{
    readonly reason: "owner" | "private" | "identity" | "snapshot" | "limit" | "reference" | "transport"
}> {}
const validTime = (v: string | null | undefined, now: number) =>
    v === null || (typeof v === "string" && v.length <= 64 && Number.isFinite(Date.parse(v)) && Date.parse(v) <= now)
export type BackupEvidence = { readonly context: BackupContext; readonly authority: SafetyAuthority }
/** The actual Owner in a private one-to-one DM, with the server's authority this check read. A native proof of the same step reuses it while it is fresh */
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
    ChannelType.Forum,
    ChannelType.Media,
    ChannelType.Announcement,
]
const structureType = {
    [ChannelType.Category]: "category",
    [ChannelType.Text]: "text",
    [ChannelType.Voice]: "voice",
    [ChannelType.Forum]: "forum",
    [ChannelType.Media]: "media",
    [ChannelType.Announcement]: "announcement",
} as const
// Fields Fluxer leaves out of a payload stay out of the snapshot. Tags are sorted by name, since their IDs are not kept
function forumSettings(channel: GuildChannel) {
    if (channel.type !== ChannelType.Forum && channel.type !== ChannelType.Media) return {}
    const tags = channel.availableTags
        ?.map((t) => ({ name: t.name, moderated: t.moderated, emojiId: t.emojiId, emojiName: t.emojiName }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    return {
        ...(channel.nsfw !== undefined ? { nsfw: channel.nsfw } : {}),
        ...(channel.topic !== undefined ? { topic: channel.topic } : {}),
        ...(channel.rateLimitPerUser !== undefined ? { slowmodeSeconds: channel.rateLimitPerUser } : {}),
        ...(tags ? { tags } : {}),
        ...(channel.defaultReactionEmoji !== undefined
            ? {
                  defaultReaction: channel.defaultReactionEmoji && {
                      emojiId: channel.defaultReactionEmoji.emojiId,
                      emojiName: channel.defaultReactionEmoji.emojiName,
                  },
              }
            : {}),
        ...(channel.defaultAutoArchiveMinutes !== undefined
            ? { defaultAutoArchiveMinutes: channel.defaultAutoArchiveMinutes }
            : {}),
        ...(channel.defaultSortOrder !== undefined ? { sortOrder: channel.defaultSortOrder } : {}),
        ...(channel.type === ChannelType.Forum && channel.defaultForumLayout !== undefined
            ? { layout: channel.defaultForumLayout }
            : {}),
        ...(channel.flags !== undefined ? { requireTag: (channel.flags & ChannelFlags.RequireTag) !== 0 } : {}),
    }
}
export function snapshotBackupChannel(channel: GuildChannel, capturedAt: number): BackupStructureObject {
    try {
        if (!backupChannelTypes.includes(channel.type) || !channel.permissionOverwrites) throw new Error()
        const object: BackupStructureObject = {
            sourceId: channel.id,
            type: structureType[channel.type as keyof typeof structureType],
            name: channel.name!,
            parentId: channel.parentId ?? null,
            ...forumSettings(channel),
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
        // Only category, text, announcement, voice, forum and media channels are restorable. Other channel types stay out of the archive
        const channels = all.filter((c) => backupChannelTypes.includes(c.type))
        // Fluxer allows 500 channels in a server, so a longer list is not one this server can have
        if (channels.length > STRUCTURE_CHANNELS)
            return yield* Effect.fail(new BackupPermissionError({ reason: "limit" }))
        if (new Set(channels.map((c) => c.id)).size !== channels.length || channels.some((c) => c.guildId !== serverId))
            return yield* Effect.fail(new BackupPermissionError({ reason: "snapshot" }))
        // Each channel's place among its siblings, counted in Fluxer's order, so a restore can put them back in it
        const place = new Map<string, number>(),
            counts = new Map<string | null, number>()
        for (const { channel, parentId } of sorted(channels)) {
            place.set(channel.id, counts.get(parentId) ?? 0)
            counts.set(parentId, (counts.get(parentId) ?? 0) + 1)
        }
        const objects = yield* Effect.try({
            try: () => channels.map((c) => ({ ...snapshotBackupChannel(c, observedAt), position: place.get(c.id)! })),
            catch: () => new BackupPermissionError({ reason: "snapshot" }),
        })
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
/**
 * The roles, members and channels the evidence of an object reads, as role:ID, member:ID and channel:ID, by the ID they have on the server.
 * A setting names them by key, such as a role ID list or a channel ID, and a channel by its category and the targets of its overwrites. Member
 * IDs in lists, such as an access list or the excluded authors of a cleanup policy, are kept as they are and read nothing
 */
export function backupReferenceKeys(
    object: BackupConfigObject | BackupStructureObject,
    mappings: ReadonlyMap<string, string> = new Map(),
): string[] {
    const keys: string[] = []
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
            if (/role/i.test(key)) keys.push(`role:${v}`)
            else if (/channel|parentId|categoryId|forumIds/i.test(key)) keys.push(`channel:${mappings.get(v) ?? v}`)
            else if (/^(ownerId|userId)$/.test(key)) keys.push(`member:${v}`)
        }
        visit(object.value)
        return keys
    }
    if (object.parentId) keys.push(`channel:${mappings.get(object.parentId) ?? object.parentId}`)
    for (const overwrite of object.overwrites) keys.push(`${overwrite.type}:${overwrite.id}`)
    return keys
}
/**
 * The member reads of a proof, their waits for Fluxer's limits and their timeouts end within 40 seconds of the first answer. That leaves 20
 * of the backend's 60 seconds for the reads after them and for sending the proof
 */
const MEMBER_READ_MS = 40_000
/** A member answer older than this when the proof is put together is left out as unknown, so none is stale when the proof is sent */
const MEMBER_PROOF_MS = 50_000
/**
 * A proof without the observations that got older than the backend's 60 seconds allow, less 10 for sending it, such as during the Owner and
 * DM check after it. What they named stays unproven, so only the items that name it are blocked instead of the whole check
 */
export const freshBackupProof = (proof: BackupNativeProof, now: number): BackupNativeProof => ({
    ...proof,
    references: proof.references.filter((reference) => now - reference.observedAt <= MEMBER_PROOF_MS),
    observations: proof.observations.filter((observation) => now - observation.observedAt <= MEMBER_PROOF_MS),
})
/** How many channels the listing left out a check reads by ID at once, so all of them stay fresh for the backend */
const OMITTED_READS = 10
/** A proof reads the Owner and DM check and the server's authority again when the given one is older than this once its members are read */
const EVIDENCE_REUSE_MS = 30_000
export function readBackupNativeProof(
    client: Client,
    serverId: string,
    given: BackupEvidence,
    objects: readonly (BackupConfigObject | BackupStructureObject)[],
    mappings: ReadonlyMap<string, string> = new Map(),
    channelIds: readonly string[] = [],
    withChannels = false,
    fromList = false,
) {
    return Effect.gen(function* () {
        // Every role, member and channel the objects name, as role:ID, member:ID and channel:ID
        const needed = new Map<string, "role" | "member" | "channel">()
        for (const object of objects)
            for (const key of backupReferenceKeys(object, mappings))
                needed.set(key, key.slice(0, key.indexOf(":")) as "role" | "member" | "channel")
        for (const id of channelIds) needed.set(`channel:${mappings.get(id) ?? id}`, "channel")
        if (needed.size > BACKUP_RESTORE_LIMITS.proofReferences)
            return yield* Effect.fail(new BackupPermissionError({ reason: "reference" }))
        // The members come first, a hundred to a request, and the channels are read after them, so every observation is still fresh when
        // the proof is sent. Many members take a while, so an Owner and DM check that got old meanwhile is read again with the server's
        // authority its roles come from
        const memberIds = [...needed].flatMap(([key, type]) => (type === "member" ? [key.slice(7)] : []))
        const members = memberIds.length
            ? yield* readNativeMembers(client, serverId, memberIds, MEMBER_READ_MS)
            : undefined
        const { context, authority } =
            members && (yield* Clock.currentTimeMillis) - given.context.observedAt > EVIDENCE_REUSE_MS
                ? yield* readBackupEvidence(client, serverId, given.context.actorId, given.context.dmChannelId)
                : given
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
        const observations: BackupNativeObservation[] = [],
            references: BackupReference[] = [],
            channels: BackupLiveChannel[] = []
        const botIn = (channel: GuildChannel) =>
            client.permissions.calculate({
                guild: authority.guild,
                member: authority.bot,
                roles: authority.roles,
                channel,
            })
        // One listing of the server's channels, and when it was read, which is how old every channel taken from it is
        let listedAt: number | undefined
        const list = Effect.gen(function* () {
            listedAt = yield* Clock.currentTimeMillis
            return (yield* client.channels.fetchAll(serverId, { timeoutMs: 5000 })).filter(
                (c) => c.guildId === serverId,
            )
        })
        const listed = withChannels || fromList ? yield* list : []
        const byId = new Map(listed.map((c) => [c.id, c]))
        // The listing holds only the channels NeonFlux can view, so a channel it leaves out may still exist. Each is read by its ID, a few at
        // a time so they all stay fresh, and only Fluxer's answer that it is gone makes it absent. Any other answer, such as for a channel
        // NeonFlux cannot view, leaves it unknown, which blocks only what names it. null is that unknown answer
        const omitted = new Map<string, { channel: GuildChannel | undefined | null; observedAt: number }>()
        if (fromList) {
            const ids = new Set<string>()
            for (const object of objects)
                if (!("family" in object)) ids.add(mappings.get(object.sourceId) ?? object.sourceId)
            for (const [key, type] of needed) if (type === "channel") ids.add(key.slice(8))
            for (const id of byId.keys()) ids.delete(id)
            yield* Effect.forEach(
                ids,
                (id) =>
                    Effect.gen(function* () {
                        const observedAt = yield* Clock.currentTimeMillis
                        const channel = yield* client.channels
                            .fetch(id, { timeoutMs: 5000 })
                            .pipe(
                                Effect.catch((e) => Effect.succeed(errors.isNotFound(e, "channel") ? undefined : null)),
                            )
                        omitted.set(id, { channel, observedAt })
                    }),
                { concurrency: OMITTED_READS, discard: true },
            )
        }
        const settingsNameChannels =
            channelIds.length > 0 ||
            objects.some(
                (object) =>
                    "family" in object &&
                    backupReferenceKeys(object, mappings).some((key) => key.startsWith("channel:")),
            )
        for (const object of objects) {
            if ("family" in object) continue
            const targetId = mappings.get(object.sourceId) ?? object.sourceId,
                read = omitted.get(targetId)
            const native = fromList
                ? (byId.get(targetId) ?? read?.channel ?? undefined)
                : yield* client.channels
                      .fetch(targetId, { timeoutMs: 5000 })
                      .pipe(
                          Effect.catch((e) =>
                              errors.isNotFound(e, "channel") ? Effect.succeed(undefined) : Effect.fail(e),
                          ),
                      )
            // A channel from the listing was observed when the listing was read
            const observedAt = fromList ? (read?.observedAt ?? listedAt!) : yield* Clock.currentTimeMillis
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
                status: read?.channel === null ? "unknown" : !native ? "absent" : snapshot ? "present" : "unknown",
                channel: snapshot,
                botPermissions: native ? botIn(native).toString() : "0",
            })
        }
        if (withChannels) {
            if (listed.length > STRUCTURE_CHANNELS)
                return yield* Effect.fail(new BackupPermissionError({ reason: "snapshot" }))
            // In Fluxer's order, each category followed by its channels, which is the order the order item reads. A thread has no place
            // there and comes last
            const ordered = sorted(listed).map(({ channel }) => channel),
                placed = new Set(ordered.map((c) => c.id))
            for (const c of [...ordered, ...listed.filter((c) => !placed.has(c.id))]) {
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
        // The channels settings name come from that listing too, each by its exact ID, so a setting that names every channel of the server
        // costs one read. A thread, which the listing leaves out, or a channel it does not hold is read by its ID
        if (listedAt === undefined && settingsNameChannels) for (const c of yield* list) byId.set(c.id, c)
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
                // A member Fluxer left out that no read by its ID confirmed stays out of the proof, so what names it is not proven. So does
                // one whose answer got too old while the reads after it ran
                const read = members?.get(id)
                if (!read || observedAt - read.observedAt > MEMBER_PROOF_MS) continue
                const member = read.member
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
                    originServerId: authority.guild.id,
                    id,
                    type,
                    serverId,
                    observedAt: read.observedAt,
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
                // A channel the listing left out that its own read could not tell about stays out of the proof, so what names it is not proven
                const listing = byId.get(id),
                    direct = omitted.get(id)
                if (direct?.channel === null) continue
                const channel = listing ?? (fromList ? direct?.channel : yield* read(id))
                // An announcement, forum or media channel counts as a message channel when configuration names it, such as a suggestion forum.
                // So does a thread, such as one leveling excludes, which takes its permissions from its parent
                if (
                    channel &&
                    (channel.id !== id ||
                        channel.guildId !== serverId ||
                        !(backupChannelTypes.includes(channel.type) || isThreadChannel(channel)))
                )
                    return yield* Effect.fail(new BackupPermissionError({ reason: "identity" }))
                const parentId = isThreadChannel(channel) ? channel.parentId : undefined
                const parentListing = parentId ? byId.get(parentId) : undefined,
                    parentChannel = parentId ? (parentListing ?? (yield* read(parentId))) : undefined
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
                    observedAt:
                        listing || parentListing ? listedAt! : (direct?.observedAt ?? (yield* Clock.currentTimeMillis)),
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
