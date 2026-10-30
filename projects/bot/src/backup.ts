import { dmServerHint, serverCommands, serverLabel, serverReply } from "./server-scope.ts"
import {
    BACKUP_RESTORE_LIMITS,
    backupChannelSemantic,
    backupExclusions,
    backupManifestHeader,
    backupOverwritesJson,
    backupSegments,
    backupSettingName,
    canonicalBackupJson,
} from "@neonflux/contracts/backup"
import { STRUCTURE_CHANNELS } from "@neonflux/contracts/common"
import { permissionNames } from "@neonflux/contracts/permission-names"
import type {
    BackupBinding,
    BackupCategory,
    BackupChannelSummary,
    BackupConfigObject,
    BackupContext,
    BackupDisposition,
    BackupGrant,
    BackupItem,
    BackupItemState,
    BackupManifest,
    BackupNativeProof,
    BackupPlan,
    BackupPreviewFailedRequest,
    BackupPreviewFailure,
    BackupPreviewJob,
    BackupStructureObject,
} from "@neonflux/contracts/backup"
import {
    errors,
    ChannelFlags,
    ChannelType,
    format,
    type BotEventContext,
    type Client,
    type ChannelCreate,
    type ChannelEdit,
    type GuildChannel,
    type Message,
    text,
} from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Exit, Semaphore } from "effect"
import { createHash, randomUUID } from "node:crypto"
import type { BotConfig } from "./config.ts"
import type { RolesPanel } from "@neonflux/contracts/roles"
import { syncPanelReactions } from "./roles.ts"
import { BackupCryptoError, backupArchiveDigest, decryptBackupParts, encryptBackupManifest } from "./backup-crypto.ts"
import { backupHelp, type BackupCommand } from "./backup-command.ts"
import { BackupAttachmentError, downloadBackupAttachments, uploadBackupAttachments } from "./backup-attachments.ts"
import {
    BackupPermissionError,
    backupReferenceKeys,
    captureBackupStructure,
    readBackupContext,
    readBackupEvidence,
    readBackupNativeProof,
    freshBackupProof,
    type BackupEvidence,
    snapshotBackupChannel,
} from "./backup-permissions.ts"
import {
    BackupStoreError,
    backupBinding,
    backupItemBinding,
    validateBackupManifest,
    type BackupStore,
} from "./backup-store.ts"
import { sourceTimestamp } from "./responses.ts"
import { places } from "@neonflux/contracts/structure"
import { sorted } from "./structure.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { applyNativeNickname, createGeneralSettingsStore, serverReplyStyle } from "./general-settings.ts"
import { reloadServerRuntime } from "./runtime-reload.ts"
import { ago, at, code, notSetUp, renderCard, type Card, type RenderedReply } from "./reply-style.ts"
import { warnFailure } from "./contained.ts"

/** version is an archive of an older format and parts an archive whose parts are not all attached, of partCount parts */
class BackupHandlingError extends Data.TaggedError("BackupHandlingError")<{
    readonly reason:
        "binding" | "expired" | "grant" | "snapshot" | "claim" | "capacity" | "archive" | "version" | "parts"
    readonly partCount?: number
}> {}
const locks = new WeakMap<Client, Map<string, Semaphore.Semaphore>>()
const serial = (client: Client, serverId: string) => {
    let servers = locks.get(client)
    if (!servers) {
        servers = new Map()
        locks.set(client, servers)
    }
    let lock = servers.get(serverId)
    if (!lock) {
        lock = Semaphore.makeUnsafe(1)
        servers.set(serverId, lock)
    }
    return lock
}
/** Forget a retired server's backup lock. Its runtime's scope has already interrupted any backup that held it */
export const forgetBackupLock = (client: Client, serverId: string) => {
    locks.get(client)?.delete(serverId)
}
const providerFor = (client: Client) =>
    client.instance.resolve({ timeoutMs: 5000 }).pipe(Effect.map((v) => new URL(v.endpoints.apiPublic).origin))
const sameChannel = (a: BackupStructureObject, b: BackupStructureObject) =>
    canonicalBackupJson(backupChannelSemantic(a)) === canonicalBackupJson(backupChannelSemantic(b))
const bigint = (o: BackupStructureObject["overwrites"][number]) => ({
    ...o,
    allow: BigInt(o.allow),
    deny: BigInt(o.deny),
})
export function nativeBackupCreate(channel: BackupStructureObject): ChannelCreate {
    if (channel.type === "forum" || channel.type === "media") {
        // One request creates the channel with its tags, since REQUIRE_TAG needs them to exist
        const forum = {
            name: channel.name,
            parentId: channel.parentId,
            permissionOverwrites: channel.overwrites.map(bigint),
            ...(channel.topic !== undefined ? { topic: channel.topic } : {}),
            ...(channel.nsfw !== undefined ? { nsfw: channel.nsfw } : {}),
            ...(channel.slowmodeSeconds !== undefined ? { rateLimitPerUser: channel.slowmodeSeconds } : {}),
            ...(channel.tags !== undefined ? { availableTags: channel.tags } : {}),
            ...(channel.defaultReaction !== undefined ? { defaultReactionEmoji: channel.defaultReaction } : {}),
            ...(channel.defaultAutoArchiveMinutes !== undefined
                ? { defaultAutoArchiveMinutes: channel.defaultAutoArchiveMinutes }
                : {}),
            ...(channel.sortOrder !== undefined ? { defaultSortOrder: channel.sortOrder } : {}),
            ...(channel.requireTag ? { flags: ChannelFlags.RequireTag } : {}),
        }
        return channel.type === "forum"
            ? {
                  ...forum,
                  type: ChannelType.Forum,
                  ...(channel.layout !== undefined ? { defaultForumLayout: channel.layout } : {}),
              }
            : { ...forum, type: ChannelType.Media }
    }
    return {
        type:
            channel.type === "category"
                ? ChannelType.Category
                : channel.type === "text"
                  ? ChannelType.Text
                  : channel.type === "announcement"
                    ? ChannelType.Announcement
                    : ChannelType.Voice,
        name: channel.name,
        parentId: channel.parentId,
        permissionOverwrites: channel.overwrites.map(bigint),
        ...(channel.topic !== undefined ? { topic: channel.topic } : {}),
        ...(channel.nsfw !== undefined ? { nsfw: channel.nsfw } : {}),
        ...(channel.slowmodeSeconds !== undefined ? { rateLimitPerUser: channel.slowmodeSeconds } : {}),
        ...(channel.bitrate !== undefined ? { bitrate: channel.bitrate } : {}),
        ...(channel.userLimit !== undefined ? { userLimit: channel.userLimit } : {}),
    }
}
/** Up to 20 items of a plan that still wait to run, in item order. The caller's `known` check renews itself as it ages */
function readOpenItems(
    store: BackupStore,
    config: BotConfig,
    client: Client,
    plan: BackupPlan,
    dm: string,
    known?: Effect.Effect<BackupContext, BackupPermissionError>,
) {
    return Effect.gen(function* () {
        const result = yield* store.query({
            serverId: config.serverId,
            context: yield* known ?? readBackupContext(client, config.serverId, plan.ownerId, dm),
            operation: { type: "open", binding: backupBinding(plan) },
        })
        if (result.type !== "open") return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
        return result.items
    })
}
/** Ten items of a plan in the order a page lists them, problems first, and the cursor of the next page */
function readPage(
    store: BackupStore,
    config: BotConfig,
    client: Client,
    plan: BackupPlan,
    dm: string,
    cursor: string | undefined,
) {
    return Effect.gen(function* () {
        const result = yield* store.query({
            serverId: config.serverId,
            context: yield* readBackupContext(client, config.serverId, plan.ownerId, dm),
            operation: { type: "page", binding: backupBinding(plan), ...(cursor ? { cursor } : {}) },
        })
        if (result.type !== "page") return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
        return { items: result.items, next: result.nextCursor }
    })
}
/** The archive channel IDs an object names that an earlier restore may have made again: its own and its category's, or those its settings name */
const originIds = (object: BackupConfigObject | BackupStructureObject) =>
    "family" in object
        ? backupReferenceKeys(object).flatMap((key) =>
              key.startsWith("channel:") ? [key.slice("channel:".length)] : [],
          )
        : [object.sourceId, ...(object.parentId ? [object.parentId] : [])]
/**
 * Where earlier restores put archive channels. Only the channels the objects at hand name are looked up, up to 100 a request, so a
 * server may keep any number of mappings. A mapping already known, such as one an item of the plan holds, stays as it is
 */
function originMappings(
    store: BackupStore,
    config: BotConfig,
    client: Client,
    ownerId: string,
    dm: string,
    provider: string,
    known?: Effect.Effect<BackupContext, BackupPermissionError>,
) {
    const mappings = new Map<string, string>(),
        asked = new Set<string>()
    const load = (objects: readonly (BackupConfigObject | BackupStructureObject)[], ids: readonly string[] = []) =>
        Effect.gen(function* () {
            const wanted = [...new Set([...objects.flatMap(originIds), ...ids])].filter(
                (id) => !asked.has(id) && !mappings.has(id),
            )
            for (let start = 0; start < wanted.length; start += BACKUP_RESTORE_LIMITS.originLookup) {
                const sourceIds = wanted.slice(start, start + BACKUP_RESTORE_LIMITS.originLookup)
                const result = yield* store.query({
                    serverId: config.serverId,
                    context: yield* known ?? readBackupContext(client, config.serverId, ownerId, dm),
                    operation: { type: "origins", provider, sourceIds },
                })
                if (result.type !== "origins") return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
                for (const origin of result.origins)
                    if (origin.category === "structure" && origin.mappedId && !mappings.has(origin.sourceId))
                        mappings.set(origin.sourceId, origin.mappedId)
                for (const id of sourceIds) asked.add(id)
            }
            return mappings
        })
    return { mappings, load }
}
function checkPlan(
    store: BackupStore,
    config: BotConfig,
    client: Client,
    plan: BackupPlan,
    context: BackupContext,
    work: boolean,
) {
    return Effect.gen(function* () {
        if (plan.serverId !== config.serverId || plan.provider !== (yield* providerFor(client)))
            return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
        const result = yield* store.query({
            serverId: config.serverId,
            context,
            operation: { type: "plan", binding: backupBinding(plan) },
        })
        if (result.type !== "plan" || result.plan.ownerId !== plan.ownerId || result.plan.forgotten)
            return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
        // A confirmed plan runs until it is done, whenever its check would have stopped being confirmable
        if (work && result.plan.confirmedAt === undefined)
            return yield* Effect.fail(new BackupHandlingError({ reason: "expired" }))
        return result.plan
    })
}
const AUDIT = "Restored from a NeonFlux backup"
/**
 * The edit that brings a channel from `from` to `to`, with only the settings that differ. A forum's tags keep their IDs by name, since
 * the archive keeps none, and its flags keep every bit except the required tag, which the archive sets. The category moves apart
 */
export function nativeBackupEdit(
    fresh: GuildChannel,
    from: BackupStructureObject,
    to: BackupStructureObject,
): ChannelEdit {
    const was = backupChannelSemantic(from),
        now = backupChannelSemantic(to),
        differs = (key: keyof typeof now) =>
            canonicalBackupJson(was[key] ?? null) !== canonicalBackupJson(now[key] ?? null)
    const ids = new Map("availableTags" in fresh ? fresh.availableTags?.map((tag) => [tag.name, tag.id]) : [])
    const flags = "flags" in fresh ? (fresh.flags ?? 0) : 0
    return {
        ...(to.type !== from.type
            ? { type: to.type === "announcement" ? ChannelType.Announcement : ChannelType.Text }
            : {}),
        ...(differs("name") ? { name: to.name } : {}),
        ...(differs("topic") ? { topic: to.topic ?? null } : {}),
        ...(differs("nsfw") ? { nsfw: to.nsfw ?? false } : {}),
        ...(differs("slowmodeSeconds") ? { rateLimitPerUser: to.slowmodeSeconds ?? 0 } : {}),
        ...(differs("bitrate") ? { bitrate: to.bitrate ?? null } : {}),
        ...(differs("userLimit") ? { userLimit: to.userLimit ?? null } : {}),
        ...(differs("overwrites") ? { permissionOverwrites: to.overwrites.map(bigint) } : {}),
        ...(differs("tags")
            ? {
                  availableTags: (to.tags ?? []).map((tag) => ({
                      ...(ids.has(tag.name) ? { id: ids.get(tag.name)! } : {}),
                      ...tag,
                  })),
              }
            : {}),
        ...(differs("defaultReaction") ? { defaultReactionEmoji: to.defaultReaction ?? null } : {}),
        ...(differs("defaultAutoArchiveMinutes")
            ? { defaultAutoArchiveMinutes: to.defaultAutoArchiveMinutes ?? null }
            : {}),
        ...(differs("sortOrder") ? { defaultSortOrder: to.sortOrder ?? null } : {}),
        ...(differs("layout") ? { defaultForumLayout: to.layout ?? null } : {}),
        ...(differs("requireTag")
            ? {
                  flags: to.requireTag ? flags | ChannelFlags.RequireTag : flags & ~ChannelFlags.RequireTag,
              }
            : {}),
    }
}
/** What differs between two channels, in the words an owner reads */
const differences = (a: BackupStructureObject, b: BackupStructureObject) => {
    const was = backupChannelSemantic(a),
        now = backupChannelSemantic(b)
    return (Object.keys({ ...was, ...now }) as (keyof typeof now)[])
        .filter((key) => canonicalBackupJson(was[key] ?? null) !== canonicalBackupJson(now[key] ?? null))
        .map((key) => (key === "overwrites" ? "permissions" : backupSettingName(key)))
}
const partly = (from: BackupStructureObject, read: BackupStructureObject, wanted: BackupStructureObject) => {
    const applied = differences(from, read),
        missing = differences(read, wanted)
    return applied.length
        ? `Partly applied: ${applied.join(", ")} changed, ${missing.join(", ")} not`
        : `Fluxer did not change it (${missing.join(", ")})`
}
/**
 * One exact channel write: a create reserves, claims and creates, while an update and a delete claim and write. Unknown transport never triggers
 * discovery or replay. The first proof reuses the caller's reads of the server's authority while they are fresh, and a fresh Owner check after its
 * reads backs the claim.
 * After the claim the write waits for a fresh proof and a last Owner check. An update and a delete are judged by reading the channel back, which says what applied
 */
function executeBackupNativeItem(
    store: BackupStore,
    config: BotConfig,
    client: Client,
    plan: BackupPlan,
    item: BackupItem,
    object: BackupStructureObject,
    dm: string,
    mappings: ReadonlyMap<string, string>,
    evidence: BackupEvidence,
) {
    return Effect.suspend(() => {
        const binding = backupItemBinding(item),
            claimToken = randomUUID().replaceAll("-", ""),
            creates = item.disposition === "create",
            target = mappings.get(object.sourceId) ?? object.sourceId
        let ownsClaim = false,
            invoked = false,
            nativeStage = false,
            mappedId: string | null = null,
            channel: BackupStructureObject | null = null,
            settled:
                | { outcome: "updated" | "deleted" | "failed" | "uncertain"; reason?: string; noDispatch?: true }
                | undefined
        // The channel as the grant should hold it: the archive's channel in its mapped category. A role or member that is gone has no overwrite
        // unless the server's channel already holds one, which stays as it is
        const desiredIn = (native: BackupNativeProof): BackupStructureObject => {
            const held = native.observations.find((x) => x.sourceId === target)?.channel?.overwrites ?? []
            return {
                ...object,
                parentId: object.parentId ? (mappings.get(object.parentId) ?? object.parentId) : null,
                overwrites: object.overwrites.flatMap((o) =>
                    native.references.some((r) => r.id === o.id && r.type === o.type && !r.exists)
                        ? held.filter((x) => x.id === o.id)
                        : [o],
                ),
            }
        }
        const synced = (proof: BackupNativeProof) =>
            proof.channels
                .filter((c) => c.parentId === target && c.synced)
                .map((c) => c.id)
                .sort()
                .join()
        const work = Effect.gen(function* () {
            const native = yield* readBackupNativeProof(
                client,
                config.serverId,
                evidence,
                [object],
                mappings,
                [],
                !creates,
            )
            const context = yield* readBackupContext(client, config.serverId, plan.ownerId, dm)
            let granted: BackupGrant | undefined
            if (creates) {
                const reservation = yield* store.work({
                    serverId: config.serverId,
                    operation: { type: "reserve", binding, context, native },
                })
                if (reservation.type === "item") return reservation.item
                granted = reservation.grant
            }
            const unclaimed = creates
                ? undefined
                : yield* store.work({
                      serverId: config.serverId,
                      operation: { type: "claim", binding, claimToken, context, native },
                  })
            if (unclaimed?.type === "item") return unclaimed.item
            // Another executor holds this claim, and its grant is not ours to write with
            if (unclaimed && !unclaimed.claimed) return yield* Effect.fail(new BackupHandlingError({ reason: "claim" }))
            const grant = granted ?? (unclaimed as { grant: BackupGrant }).grant
            if (grant.action === "order") return yield* Effect.fail(new BackupHandlingError({ reason: "grant" }))
            const sound =
                grant.provider === plan.provider &&
                grant.serverId === config.serverId &&
                grant.ownerId === plan.ownerId &&
                grant.botId === context.botId &&
                grant.sourceId === object.sourceId &&
                grant.action === item.disposition &&
                (item.disposition === "delete" || sameChannel(grant.channel, desiredIn(native)))
            if (creates) {
                if (!sound) return yield* Effect.fail(new BackupHandlingError({ reason: "grant" }))
                const claimed = yield* store.work({
                    serverId: config.serverId,
                    operation: { type: "claim", binding, claimToken, context, native },
                })
                if (
                    claimed.type !== "grant" ||
                    !claimed.claimed ||
                    canonicalBackupJson(claimed.grant) !== canonicalBackupJson(grant)
                )
                    return yield* Effect.fail(new BackupHandlingError({ reason: "claim" }))
            }
            ownsClaim = true
            if (!sound) return yield* Effect.fail(new BackupHandlingError({ reason: "grant" }))
            // The Owner, the DM, the server's authority and the channels are read again after the claim
            const finalProof = yield* readBackupNativeProof(
                client,
                config.serverId,
                yield* readBackupEvidence(client, config.serverId, plan.ownerId, dm),
                [object],
                mappings,
                [],
                !creates,
            )
            const seen = finalProof.observations.find((o) => o.sourceId === target)
            const parent = grant.channel.parentId
                ? finalProof.references.find((r) => r.id === grant.channel.parentId && r.type === "category")
                : undefined
            // Every role and member that the write gives an overwrite to must still exist. An overwrite the channel holds already stays, and a delete writes none
            const missing = grant.channel.overwrites.some(
                (o) =>
                    !grant.from?.overwrites.some((x) => canonicalBackupJson(x) === canonicalBackupJson(o)) &&
                    !finalProof.references.some((r) => r.id === o.id && r.type === o.type && r.exists),
            )
            if (
                missing ||
                finalProof.ownerId !== grant.ownerId ||
                finalProof.botId !== grant.botId ||
                (creates
                    ? !finalProof.botCanManageChannels ||
                      seen?.status !== "absent" ||
                      (grant.channel.parentId && !(parent?.exists && parent.botCanAccess && parent.botCanManage))
                    : seen?.status !== "present") ||
                (item.disposition === "delete" && finalProof.channels.some((c) => c.parentId === target))
            )
                return yield* Effect.fail(new BackupHandlingError({ reason: "grant" }))
            const timeoutMs = () =>
                Clock.currentTimeMillis.pipe(Effect.map((at) => Math.min(5000, grant.dispatchExpiresAt - at)))
            if (creates) {
                // The Owner and the DM are checked once more after the proof's channel and member reads
                yield* readBackupContext(client, config.serverId, plan.ownerId, dm)
                if ((yield* timeoutMs()) <= 0) return yield* Effect.fail(new BackupHandlingError({ reason: "expired" }))
                // Nothing awaited between the final grant deadline check and invoking the SDK create
                invoked = true
                nativeStage = true
                const created = yield* client.channels.create(config.serverId, nativeBackupCreate(grant.channel), {
                    timeoutMs: yield* timeoutMs(),
                })
                nativeStage = false
                if (created.guildId !== config.serverId || !/^[1-9]\d{0,18}$/.test(created.id))
                    return yield* Effect.fail(new BackupHandlingError({ reason: "snapshot" }))
                mappedId = created.id
                const createdAt = yield* Clock.currentTimeMillis
                channel = yield* Effect.try({
                    try: () => snapshotBackupChannel(created, createdAt),
                    catch: () => new BackupHandlingError({ reason: "snapshot" }),
                })
                if (!sameChannel(channel, grant.channel))
                    return yield* Effect.fail(new BackupHandlingError({ reason: "snapshot" }))
                const fresh = yield* client.channels.fetch(mappedId, { timeoutMs: 5000 })
                if (fresh.id !== mappedId || fresh.guildId !== config.serverId)
                    return yield* Effect.fail(new BackupHandlingError({ reason: "snapshot" }))
                const observedAt = yield* Clock.currentTimeMillis
                channel = yield* Effect.try({
                    try: () => snapshotBackupChannel(fresh, observedAt),
                    catch: () => new BackupHandlingError({ reason: "snapshot" }),
                })
                if (!sameChannel(channel, grant.channel))
                    return yield* Effect.fail(new BackupHandlingError({ reason: "snapshot" }))
                return undefined
            }
            // The channel is read once more, as the write is built from it, and must still be the one the grant names
            const fresh = yield* client.channels.fetch(target, { timeoutMs: 5000 })
            const freshAt = yield* Clock.currentTimeMillis
            const read = yield* Effect.try({
                try: () => snapshotBackupChannel(fresh, freshAt),
                catch: () => new BackupHandlingError({ reason: "snapshot" }),
            })
            if (fresh.id !== target || fresh.guildId !== config.serverId || !sameChannel(read, grant.from!))
                return yield* Effect.fail(new BackupHandlingError({ reason: "grant" }))
            mappedId = target
            const patch = nativeBackupEdit(fresh, grant.from!, grant.channel)
            // Fluxer copies a category's new permissions to the channels that follow it, so they must still be the ones the claim approved
            if (patch.permissionOverwrites && synced(finalProof) !== synced(native))
                return yield* Effect.fail(new BackupHandlingError({ reason: "grant" }))
            const writes: ((timeoutMs: number) => Effect.Effect<unknown, unknown>)[] =
                item.disposition === "delete"
                    ? [(timeoutMs) => client.channels.delete(target, { timeoutMs, auditReason: AUDIT })]
                    : [
                          ...(Object.keys(patch).length
                              ? [
                                    (timeoutMs: number) =>
                                        client.channels.edit(target, patch, { timeoutMs, auditReason: AUDIT }),
                                ]
                              : []),
                          ...(grant.channel.parentId !== grant.from!.parentId
                              ? [
                                    (timeoutMs: number) =>
                                        client.channels.reorder(
                                            config.serverId,
                                            [{ id: target, parentId: grant.channel.parentId }],
                                            { timeoutMs, auditReason: AUDIT },
                                        ),
                                ]
                              : []),
                      ]
            let first = true,
                stopped = ""
            for (const write of writes) {
                // Right before each request the Owner and the DM are read again and the grant must not have run out. What was written stays and is read back
                const allowed = Exit.isSuccess(
                    yield* Effect.exit(readBackupContext(client, config.serverId, plan.ownerId, dm)),
                )
                const left = yield* timeoutMs()
                if (!allowed || left <= 0) {
                    stopped = allowed ? "the step ran out of time" : "the Owner or the DM check failed"
                    break
                }
                invoked = true
                nativeStage = true
                const exit = yield* Effect.exit(write(left))
                nativeStage = false
                if (Exit.isFailure(exit)) {
                    // A request that never left changed nothing, and an earlier write of this item may still have applied
                    if (first && errors.outcome(exit.cause) === "notDispatched") invoked = false
                    break
                }
                first = false
            }
            if (!invoked) {
                settled = {
                    outcome: "failed",
                    reason: stopped
                        ? `Nothing was written: ${stopped}`
                        : "Fluxer was not reached, so nothing was written",
                    noDispatch: true,
                }
                return undefined
            }
            // Reading the channel back says what applied, whether or not each request was answered
            const back = yield* Effect.exit(client.channels.fetch(target, { timeoutMs: 5000 }))
            if (item.disposition === "delete") {
                settled =
                    Exit.isFailure(back) && errors.isNotFound(Cause.squash(back.cause), "channel")
                        ? { outcome: "deleted" }
                        : Exit.isFailure(back)
                          ? { outcome: "uncertain" }
                          : { outcome: "failed", reason: "Fluxer did not delete it" }
                mappedId = target
                return undefined
            }
            if (Exit.isFailure(back)) {
                settled = { outcome: "uncertain" }
                return undefined
            }
            const backAt = yield* Clock.currentTimeMillis
            channel = yield* Effect.try({
                try: () => snapshotBackupChannel(back.value, backAt),
                catch: () => new BackupHandlingError({ reason: "snapshot" }),
            })
            settled = sameChannel(channel, grant.channel)
                ? { outcome: "updated" }
                : { outcome: "failed", reason: partly(grant.from!, channel, grant.channel) }
            return undefined
        })
        const finish = Effect.gen(function* () {
            const result = yield* Effect.exit(work)
            if (!ownsClaim)
                return {
                    item: Exit.isSuccess(result) && result.value ? result.value : item,
                    recorded: Exit.isSuccess(result),
                    outcome: "blocked" as const,
                }
            // A create that Fluxer refused made no channel, so a new preview may try it again
            const notCreated =
                Exit.isFailure(result) &&
                nativeStage &&
                ["notDispatched", "rejected"].includes(errors.outcome(result.cause) ?? "")
            const noDispatch = settled?.noDispatch ?? (Exit.isFailure(result) && (!invoked || notCreated))
            const outcome = settled
                ? settled.outcome
                : Exit.isSuccess(result)
                  ? ("created" as const)
                  : noDispatch
                    ? ("failed" as const)
                    : ("uncertain" as const)
            const error = Exit.isFailure(result) ? Cause.squash(result.cause) : undefined
            // A read of Fluxer that failed found no change, and a channel that is gone was found changed
            const unread =
                error instanceof BackupPermissionError
                    ? error.reason === "transport"
                    : !(error instanceof BackupHandlingError) && !errors.isNotFound(error)
            const reason =
                settled?.reason ??
                (!creates && noDispatch && Exit.isFailure(result)
                    ? unread
                        ? "Nothing was written because Fluxer could not be read. A new preview retries it"
                        : "Nothing was written: the channel or its permissions changed just before the write"
                    : undefined)
            const ack = yield* store
                .work({
                    serverId: config.serverId,
                    operation: {
                        type: "outcome",
                        binding,
                        claimToken,
                        outcome,
                        ...(noDispatch ? { noDispatch: true as const } : {}),
                        channel,
                        mappedId,
                        ...(reason ? { reason } : {}),
                    },
                })
                .pipe(Effect.catch(() => Effect.succeed(undefined)))
            return { item: ack?.item ?? item, recorded: !!ack, outcome }
        })
        return finish.pipe(
            Effect.onInterrupt(() =>
                ownsClaim
                    ? store
                          .work({
                              serverId: config.serverId,
                              operation: {
                                  type: "outcome",
                                  binding,
                                  claimToken,
                                  outcome: invoked ? "uncertain" : "failed",
                                  ...(!invoked ? { noDispatch: true as const } : {}),
                                  channel,
                                  mappedId,
                              },
                          })
                          .pipe(
                              Effect.interruptible,
                              Effect.timeout("5 seconds"),
                              Effect.catchCause(() => Effect.void),
                              Effect.asVoid,
                          )
                    : Effect.void,
            ),
        )
    })
}
/**
 * The order item: one claim on the server's channel list as it is now, one reorder request with the moves the claim granted, and a read of the
 * list that says which moves landed. Like a channel write it is never sent again, and a request whose outcome is unknown ends not confirmed
 */
function executeBackupOrderItem(
    store: BackupStore,
    config: BotConfig,
    client: Client,
    plan: BackupPlan,
    item: BackupItem,
    dm: string,
    mappings: ReadonlyMap<string, string>,
    evidence: BackupEvidence,
) {
    return Effect.suspend(() => {
        const binding = backupItemBinding(item),
            claimToken = randomUUID().replaceAll("-", "")
        let ownsClaim = false,
            invoked = false,
            settled: { outcome: "updated" | "failed" | "uncertain"; reason?: string; noDispatch?: true } | undefined
        const work = Effect.gen(function* () {
            const native = yield* readBackupNativeProof(client, config.serverId, evidence, [], mappings, [], true)
            const context = yield* readBackupContext(client, config.serverId, plan.ownerId, dm)
            const claimed = yield* store.work({
                serverId: config.serverId,
                operation: { type: "claim", binding, claimToken, context, native },
            })
            if (claimed.type === "item") return claimed.item
            if (!claimed.claimed || claimed.grant.action !== "order")
                return yield* Effect.fail(new BackupHandlingError({ reason: "claim" }))
            const grant = claimed.grant
            ownsClaim = true
            if (
                grant.provider !== plan.provider ||
                grant.serverId !== config.serverId ||
                grant.ownerId !== plan.ownerId ||
                grant.botId !== context.botId
            )
                return yield* Effect.fail(new BackupHandlingError({ reason: "grant" }))
            // The Owner and the DM are read again right before the request, which must leave before the grant runs out
            const allowed = Exit.isSuccess(
                yield* Effect.exit(readBackupContext(client, config.serverId, plan.ownerId, dm)),
            )
            const left = Math.min(5000, grant.dispatchExpiresAt - (yield* Clock.currentTimeMillis))
            if (!allowed || left <= 0) {
                settled = {
                    outcome: "failed",
                    reason: `Nothing was written: ${allowed ? "the step ran out of time" : "the Owner or the DM check failed"}`,
                    noDispatch: true,
                }
                return undefined
            }
            invoked = true
            const exit = yield* Effect.exit(
                client.channels.reorder(config.serverId, grant.moves, { timeoutMs: left, auditReason: AUDIT }),
            )
            if (Exit.isFailure(exit) && errors.outcome(exit.cause) === "notDispatched") {
                invoked = false
                settled = {
                    outcome: "failed",
                    reason: "Fluxer was not reached, so nothing was written",
                    noDispatch: true,
                }
                return undefined
            }
            // Reading the list back says which moves landed, whether or not the request was answered
            const back = yield* Effect.exit(client.channels.fetchAll(config.serverId, { timeoutMs: 5000 }))
            if (Exit.isFailure(back)) {
                settled = { outcome: "uncertain" }
                return undefined
            }
            const at = places(
                sorted(back.value.filter((c) => c.guildId === config.serverId)).map(({ channel, parentId }) => ({
                    id: channel.id,
                    parentId,
                })),
            )
            const missed = grant.moves.filter((move) => {
                const place = at.get(move.id)
                return place?.parentId !== move.parentId || place.afterId !== move.precedingSiblingId
            })
            settled = !missed.length
                ? { outcome: "updated" }
                : Exit.isSuccess(exit) || errors.outcome(exit.cause) === "rejected"
                  ? {
                        outcome: "failed",
                        reason: `${plural(missed.length, "channel")} of ${grant.moves.length} did not move. Check again to see the order now`,
                    }
                  : { outcome: "uncertain" }
            return undefined
        })
        const outcome = (result: { outcome: "updated" | "failed" | "uncertain"; reason?: string; noDispatch?: true }) =>
            store.work({
                serverId: config.serverId,
                operation: {
                    type: "outcome",
                    binding,
                    claimToken,
                    outcome: result.outcome,
                    ...(result.noDispatch ? { noDispatch: true as const } : {}),
                    channel: null,
                    mappedId: null,
                    ...(result.reason ? { reason: result.reason } : {}),
                },
            })
        const finish = Effect.gen(function* () {
            const result = yield* Effect.exit(work)
            if (!ownsClaim)
                return {
                    item: Exit.isSuccess(result) && result.value ? result.value : item,
                    recorded: Exit.isSuccess(result),
                    outcome: "blocked" as const,
                }
            const final =
                settled ??
                (invoked
                    ? { outcome: "uncertain" as const }
                    : { outcome: "failed" as const, noDispatch: true as const })
            const ack = yield* outcome(final).pipe(Effect.catch(() => Effect.succeed(undefined)))
            return { item: ack?.item ?? item, recorded: !!ack, outcome: final.outcome }
        })
        return finish.pipe(
            Effect.onInterrupt(() =>
                ownsClaim
                    ? outcome(invoked ? { outcome: "uncertain" } : { outcome: "failed", noDispatch: true }).pipe(
                          Effect.interruptible,
                          Effect.timeout("5 seconds"),
                          Effect.catchCause(() => Effect.void),
                          Effect.asVoid,
                      )
                    : Effect.void,
            ),
        )
    })
}
/** Applies a nickname a restore recorded and not yet applied. A later nickname change replaces it, and its result is then not recorded */
function applyRestoredNickname(config: BotConfig, client: Client) {
    return Effect.gen(function* () {
        const store = createGeneralSettingsStore(config.backend!, config.serverId),
            current = yield* store.nickname()
        if (current.result?.state !== "pending" || current.result.nickname !== current.nickname) return
        yield* store.recordNickname(
            current.revision,
            current.nickname,
            yield* applyNativeNickname(client, config.serverId, current.nickname),
        )
    })
}
/** How old the pass's Owner and DM check or the proof of its identical channels may get before it is read again. The backend refuses them after 60 seconds */
const PASS_READ_MS = 30_000
/**
 * The members that identical channels collected together may name in their permissions between them. They are read a hundred to a request,
 * and one Fluxer leaves out, such as a member who left, is read by its own read that waits at most 5 seconds, so a group stays inside the 30
 * seconds even when every member it names left. A single channel that names more is collected alone and can take longer
 */
const BATCH_MEMBERS = 4
/** How old the pass's Owner and DM check may be when the identical channels are collected, so that the proof and the check are applied together */
const BATCH_CONTEXT_MS = 10_000
/**
 * One pass of a confirmed plan, the next 20 items that wait to run. One Owner and DM check opens the pass, and its reads feed the plan check, the plan's items, the
 * origin mappings and the opening proof of every item, so that no item reads the server's authority again only to look. It is read again once it
 * is 30 seconds old, also between pages. An identical setting or XP profile, a blocked item and a channel a match restore leaves alone write
 * nothing and settle from the plan with no read of Fluxer. The identical archive channels of the pass are observed together from one read of the
 * server's channel list, which also answers their categories, in groups of channels that name at most four members between them. A single channel
 * that names more is collected alone, which is the limit the original per-item read had. The Owner and DM check is renewed before a group is
 * collected when it is 10 seconds old. A group is read again after a channel write or when its oldest read is 30 seconds old. An item that writes checks the Owner and the DM fresh before it records anything and again right before each request it sends
 */
export function processBackupPlanPass(
    store: BackupStore,
    config: BotConfig,
    client: Client,
    plan: BackupPlan,
    privateChannelId: string,
    /** Filled as items settle, so a caller that sees the pass fail still knows how many it recorded */
    results: { item: BackupItem; recorded: boolean; outcome: string }[] = [],
    /** Clears the reactions of a restored posted role panel whose roles changed, as after a staff edit */
    syncPanel: (panel: RolesPanel) => Effect.Effect<unknown, unknown> = (panel) => syncPanelReactions(client, panel),
) {
    return serial(client, config.serverId).withPermit(
        Effect.gen(function* () {
            let evidence = yield* readBackupEvidence(client, config.serverId, plan.ownerId, privateChannelId)
            // The pass's Owner and DM check, read again once it is 30 seconds old. The backend refuses it after 60
            const renew = (maxAge: number) =>
                Effect.gen(function* () {
                    if ((yield* Clock.currentTimeMillis) - evidence.context.observedAt > maxAge)
                        evidence = yield* readBackupEvidence(client, config.serverId, plan.ownerId, privateChannelId)
                    return evidence
                })
            const renewed = renew(PASS_READ_MS)
            const renewedContext = renewed.pipe(Effect.map((e) => e.context))
            plan = yield* checkPlan(store, config, client, plan, evidence.context, true)
            const items = yield* readOpenItems(store, config, client, plan, privateChannelId, renewedContext)
            const origins = originMappings(
                    store,
                    config,
                    client,
                    plan.ownerId,
                    privateChannelId,
                    plan.provider,
                    renewedContext,
                ),
                mappings = origins.mappings
            for (const i of items) if (i.category === "structure" && i.mappedId) mappings.set(i.sourceId, i.mappedId)
            const open = (i: BackupItem) => ["planned", "reserved"].includes(i.state)
            const identicalChannel = (i: BackupItem) =>
                i.category === "structure" && i.disposition === "skip" && !i.extra && open(i)
            let identical: { proof: BackupNativeProof; startedAt: number; covered: Set<number> } | undefined
            for (const [index, item] of items.entries()) {
                if (results.length >= 20) break
                if (!open(item)) continue
                yield* renewed
                yield* checkPlan(store, config, client, plan, evidence.context, true)
                if (item.disposition === "skip" || item.disposition === "blocked") {
                    if (
                        identicalChannel(item) &&
                        (!identical ||
                            !identical.covered.has(item.itemNo) ||
                            (yield* Clock.currentTimeMillis) - identical.startedAt > PASS_READ_MS)
                    ) {
                        // The identical channels this pass has left are observed together, since each is decided again from fresh evidence.
                        // A channel whose permissions name more members than a read may hold starts the next one
                        const objects: BackupStructureObject[] = [],
                            covered = new Set<number>(),
                            members = new Set<string>()
                        let room = 20 - results.length
                        for (const next of items.slice(index)) {
                            if (room <= 0) break
                            if (!open(next)) continue
                            room--
                            if (!identicalChannel(next)) continue
                            const found = yield* store.query({
                                serverId: config.serverId,
                                context: yield* renewedContext,
                                operation: { type: "item", binding: backupItemBinding(next) },
                            })
                            if (found.type !== "item" || !found.object || !("type" in found.object))
                                return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
                            const named = found.object.overwrites.flatMap((o) => (o.type === "member" ? [o.id] : []))
                            if (objects.length && new Set([...members, ...named]).size > BATCH_MEMBERS) break
                            named.forEach((id) => members.add(id))
                            objects.push(found.object)
                            covered.add(next.itemNo)
                        }
                        // The Owner and DM check is renewed right before the read when it is 10 seconds old. The read is bounded, and its
                        // proof is applied at once, so both are well inside the backend's 60 seconds. Every observation is at least as new as
                        // the moment the read started, which is what ages the proof
                        yield* origins.load(objects)
                        yield* renew(BATCH_CONTEXT_MS)
                        const startedAt = yield* Clock.currentTimeMillis
                        identical = {
                            proof: yield* readBackupNativeProof(
                                client,
                                config.serverId,
                                evidence,
                                objects,
                                mappings,
                                [],
                                false,
                                true,
                            ),
                            startedAt,
                            covered,
                        }
                        // A channel that names many members takes a while to read, so a check that got old meanwhile is renewed for its proof
                        yield* renew(PASS_READ_MS)
                    }
                    const applied = yield* store.work({
                        serverId: config.serverId,
                        operation: {
                            type: "apply",
                            binding: backupItemBinding(item),
                            context: evidence.context,
                            native: identicalChannel(item) ? identical!.proof : null,
                        },
                    })
                    results.push({ item: applied.item, recorded: true, outcome: applied.item.state })
                    continue
                }
                if (item.order) {
                    // The order item reads the channel list itself, so it needs no archived object
                    results.push(
                        yield* executeBackupOrderItem(
                            store,
                            config,
                            client,
                            plan,
                            item,
                            privateChannelId,
                            mappings,
                            evidence,
                        ),
                    )
                    identical = undefined
                    continue
                }
                const value = yield* store.query({
                    serverId: config.serverId,
                    context: evidence.context,
                    operation: { type: "item", binding: backupItemBinding(item) },
                })
                if (value.type !== "item" || !value.object)
                    return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
                let result: { item: BackupItem; recorded: boolean; outcome: string }
                if ("family" in value.object || "type" in value.object)
                    yield* origins.load([value.object], value.resumed)
                if (item.category === "structure" && "type" in value.object)
                    result = yield* executeBackupNativeItem(
                        store,
                        config,
                        client,
                        plan,
                        item,
                        value.object,
                        privateChannelId,
                        mappings,
                        evidence,
                    )
                else {
                    // Turning the cleanup module on resumes the policies that are on, so the proof reads their channels too
                    const resumed = value.resumed ?? []
                    const native =
                        "family" in value.object
                            ? yield* readBackupNativeProof(
                                  client,
                                  config.serverId,
                                  evidence,
                                  [value.object],
                                  mappings,
                                  resumed,
                              )
                            : null
                    const applied = yield* store.work({
                        serverId: config.serverId,
                        operation: {
                            type: "apply",
                            binding: backupItemBinding(item),
                            context: yield* readBackupContext(client, config.serverId, plan.ownerId, privateChannelId),
                            native,
                        },
                    })
                    result = { item: applied.item, recorded: true, outcome: applied.item.state }
                    // The restore is saved, so a failed reaction update leaves the panel's reactions to update, which the next
                    // reaction on the panel or !roles reactions finishes
                    if (applied.type === "item" && applied.panel) {
                        const panel = applied.panel
                        yield* syncPanel(panel).pipe(
                            Effect.catchCause((cause) =>
                                Cause.hasInterrupts(cause)
                                    ? Effect.failCause(cause)
                                    : warnFailure(`Reactions of role panel ${panel.name} are not updated yet`, cause),
                            ),
                        )
                    }
                    // The backend recorded the archived nickname, so the bot applies it as itself and reports what Fluxer kept, as a
                    // dashboard change does
                    if (
                        "family" in value.object &&
                        value.object.family === "general" &&
                        (applied.item.state === "created" || applied.item.state === "updated") &&
                        config.backend
                    )
                        yield* applyRestoredNickname(config, client).pipe(Effect.catch(() => Effect.void))
                    // Features that keep settings in memory, such as sticky messages, the help desk and security alerts, pick up
                    // a restored item at once, as they do a dashboard change
                    if (
                        "family" in value.object &&
                        (applied.item.state === "created" || applied.item.state === "updated")
                    )
                        yield* reloadServerRuntime(client, config.serverId, value.object.family)
                }
                results.push(result)
                if (item.category === "structure") {
                    // A channel write can change the channels that follow, so the identical ones are read again
                    identical = undefined
                    if (result.item.mappedId) mappings.set(item.sourceId, result.item.mappedId)
                }
            }
            return { results }
        }),
    )
}
export function reconcileBackupPlan(
    store: BackupStore,
    config: BotConfig,
    client: Client,
    plan: BackupPlan,
    privateChannelId: string,
) {
    return serial(client, config.serverId).withPermit(
        Effect.gen(function* () {
            plan = yield* checkPlan(
                store,
                config,
                client,
                plan,
                yield* readBackupContext(client, config.serverId, plan.ownerId, privateChannelId),
                false,
            )
            const listed = yield* store.query({
                serverId: config.serverId,
                context: yield* readBackupContext(client, config.serverId, plan.ownerId, privateChannelId),
                operation: { type: "unconfirmed", binding: backupBinding(plan) },
            })
            if (listed.type !== "unconfirmed") return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            const items = listed.items,
                results: BackupItem[] = []
            const origins = originMappings(store, config, client, plan.ownerId, privateChannelId, plan.provider),
                mappings = origins.mappings
            for (const i of items) if (i.mappedId) mappings.set(i.sourceId, i.mappedId)
            for (const item of items) {
                const evidence = yield* readBackupEvidence(client, config.serverId, plan.ownerId, privateChannelId)
                const found = yield* store.query({
                    serverId: config.serverId,
                    context: evidence.context,
                    operation: { type: "item", binding: backupItemBinding(item) },
                })
                if (found.type !== "item" || !found.object || !("type" in found.object)) continue
                yield* origins.load([found.object])
                const native = yield* readBackupNativeProof(client, config.serverId, evidence, [found.object], mappings)
                const context = yield* readBackupContext(client, config.serverId, plan.ownerId, privateChannelId)
                const result = yield* store.work({
                    serverId: config.serverId,
                    operation: { type: "reconcile", binding: backupItemBinding(item), context, native },
                })
                results.push(result.item)
            }
            return results
        }),
    )
}
/**
 * Labels the exported channels that NeonFlux's tickets and temporary voice rooms made. NeonFlux forgets a closed ticket and an ended room, so
 * only the export can tell which channels they were, and a restore must not bring them back. The backup stays exact: The label is all it adds
 */
export function markManagedChannels(
    store: BackupStore,
    config: BotConfig,
    client: Client,
    message: Message,
    objects: readonly BackupStructureObject[],
) {
    return Effect.gen(function* () {
        const kinds = new Map<string, "ticket" | "voiceRoom">()
        // The backend looks up at most 100 channels a request
        for (let start = 0; start < objects.length; start += 100) {
            const result = yield* store.query({
                serverId: config.serverId,
                context: yield* readBackupContext(client, config.serverId, message.author.id, message.channelId),
                operation: { type: "managed", channelIds: objects.slice(start, start + 100).map((o) => o.sourceId) },
            })
            if (result.type !== "managed") return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            for (const x of result.channels) kinds.set(x.id, x.managed)
        }
        return objects.map((o) => (kinds.has(o.sourceId) ? { ...o, managed: kinds.get(o.sourceId)! } : o))
    })
}
const keyMissing =
    "Backups are off because NeonFlux has no NEONFLUX_BACKUP_KEY. Set one in the bot's configuration and keep a copy offline. Never send keys in chat"
/** Decrypts every part of an archive and checks that it belongs to this server. An older format and a missing part each have their reason */
function readArchive(config: BotConfig, parts: readonly Uint8Array[], provider: string) {
    return Effect.gen(function* () {
        const read = yield* Effect.try({
            try: () => {
                const { manifest, parts: ordered } = decryptBackupParts(parts, config.backupKey!)
                return { manifest: validateBackupManifest(manifest), archiveDigest: backupArchiveDigest(ordered) }
            },
            catch: (error) =>
                error instanceof BackupCryptoError && (error.reason === "version" || error.reason === "parts")
                    ? new BackupHandlingError({
                          reason: error.reason,
                          ...(error.partCount !== undefined ? { partCount: error.partCount } : {}),
                      })
                    : new BackupHandlingError({ reason: "archive" }),
        })
        if (read.manifest.provider !== provider || read.manifest.serverId !== config.serverId)
            return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
        return read
    })
}
/** A channel as a category's decision reads it, with the digest of its overwrites in ID order */
const summarize = (channel: BackupStructureObject): BackupChannelSummary => ({
    sourceId: channel.sourceId,
    parentId: channel.parentId,
    overwrites: createHash("sha256").update(backupOverwritesJson(channel.overwrites)).digest("hex"),
    ...(channel.managed ? { managed: channel.managed } : {}),
    ...(channel.position !== undefined ? { position: channel.position } : {}),
})
/**
 * The restore plan of an archive made now. A preview and a plan are the same thing: The backend stores the plan, replacing the earlier one
 * that was never confirmed, and the owner confirms exactly what was shown. The archive goes in segments, each read against the server
 * right before it is sent, and the first request binds every segment by its digest
 */
function makeBackupPlan(
    store: BackupStore,
    config: BotConfig,
    client: Client,
    message: Message,
    match: boolean,
    requestedAt?: number,
) {
    return Effect.gen(function* () {
        const provider = yield* providerFor(client),
            parts = yield* downloadBackupAttachments(client, { serverId: config.serverId, message })
        const { manifest, archiveDigest } = yield* readArchive(config, parts, provider)
        const owner = message.author.id,
            dm = message.channelId
        const mappings = yield* originMappings(store, config, client, owner, dm, provider).load([
            ...manifest.structure,
            ...manifest.config,
        ])
        const segments = backupSegments(manifest, summarize, (object) => backupReferenceKeys(object, mappings))
        const started = yield* store.previewStart({
            serverId: config.serverId,
            ...(requestedAt !== undefined ? { requestedAt } : {}),
            context: yield* readBackupContext(client, config.serverId, owner, dm),
            header: backupManifestHeader(manifest),
            segmentDigests: segments.map((segment) =>
                createHash("sha256").update(canonicalBackupJson(segment)).digest("hex"),
            ),
            archiveDigest,
            archive: { channelId: dm, messageId: message.id },
            match,
        })
        let plan = started.plan
        for (const [segmentNo, segment] of segments.entries()) {
            // Channels and the deletions of a match restore read the server's channel list, and settings read what they name
            const native =
                segment.kind === "xp"
                    ? null
                    : yield* readBackupNativeProof(
                          client,
                          config.serverId,
                          yield* readBackupEvidence(client, config.serverId, owner, dm),
                          segment.kind === "config"
                              ? segment.config
                              : segment.kind === "structure"
                                ? []
                                : segment.structure,
                          mappings,
                          [],
                          segment.kind !== "config",
                          // A check takes its channels from the one listing it reads, while a restore reads each channel fresh
                          segment.kind !== "config",
                      )
            const context = yield* readBackupContext(client, config.serverId, owner, dm)
            plan = (yield* store.previewSegment({
                serverId: config.serverId,
                context,
                planId: started.plan.planId,
                segmentNo,
                segment,
                native: native && freshBackupProof(native, yield* Clock.currentTimeMillis),
            })).plan
        }
        return plan
    })
}
const capital = (text: string) => text.replace(/^./, (letter) => letter.toUpperCase())
const familyNames: Partial<Record<string, string>> = {
    automod: "Automod rule",
    panel: "Role panel",
    ticketCategory: "Ticket category",
    metadata: "Metadata logs",
    general: "Prefix, reply style and nickname",
    rolepicker: "Role picker",
    temproles: "Temporary role defaults",
    onboarding: "Newcomer checklist",
    alerts: "Security alerts",
    helpdesk: "Help desk",
    helpdeskAnswer: "Saved answer",
    lfg: "Looking for group",
    showcase: "Showcases",
    profile: "Profiles",
    youtube: "YouTube alerts for",
    twitch: "Twitch alerts for",
}
const accessNames: Partial<Record<string, string>> = {
    rolepicker: "Role picker access",
    showcase: "Showcase access",
    profile: "Profile access",
}
/**
 * What an archive item is, by name where it has one. Responses, drafts and templates are kept as their kind and name, such as custom_hello.
 * Restores stay in their own server, so an archive channel's ID names the channel there while it exists
 */
function itemTarget(i: {
    category: BackupCategory
    family: string
    sourceId: string
    name?: string
    mappedId?: string | null
    order?: true
}) {
    if (i.order) return "Channel order"
    if (i.category === "structure")
        return i.name ? `Channel **${i.name}**` : `Channel ${format.channelMention(i.mappedId ?? i.sourceId)}`
    // An XP item is a page of members, such as XP of 100 members, from @a to @b
    if (i.category === "xp") return i.name ? `XP of ${i.name}` : `XP of ${format.userMention(i.sourceId)}`
    if (i.family === "cleanupPolicy") return `Message cleanup in ${format.channelMention(i.sourceId)}`
    if (i.family === "voiceGenerator") return `Voice generator ${format.channelMention(i.sourceId)}`
    if (i.family === "sticky") return `Sticky message in ${format.channelMention(i.sourceId)}`
    if (i.family === "access") return accessNames[i.sourceId] ?? `${capital(i.sourceId)} access`
    if (i.family === "milestoneRoute") return `${capital(i.sourceId)} posts`
    const kind = i.sourceId.slice(0, i.sourceId.indexOf("_")),
        name = i.sourceId.slice(i.sourceId.indexOf("_") + 1)
    if (i.family === "response" || i.family === "draft")
        return `${capital(kind)}${i.family === "response" ? " response" : ""} **${name}**`
    return i.sourceId === i.family
        ? (familyNames[i.family] ?? capital(i.family))
        : `${familyNames[i.family] ?? capital(i.family)} **${i.sourceId}**`
}
// What an archive leaves out, in plain words. Delivery receipts, leases, claims and live ownership are all live state
const exclusionNames: Partial<Record<string, string>> = {
    "native-roles": "roles",
    "server-settings": "server settings",
    "private-history": "private history",
    "audit-history": "audit history",
    receipts: "live state",
    leases: "live state",
    claims: "live state",
    "live-ownership": "live state",
    "effective-defcon": "the DEFCON level",
}
const dispositions: Record<BackupDisposition, string> = {
    create: "Will be created",
    update: "Will be updated",
    delete: "Will be deleted",
    skip: "Already identical",
    blocked: "Blocked",
}
const plural = (count: number, word: string, words = `${word}s`) => `${count} ${count === 1 ? word : words}`
/** A plan's decisions in one line, such as 40 to create, 5 to update, 2 to delete, 12 identical, 3 blocked. Counts of none are left out */
const decisions = (c: Record<BackupDisposition, number>) =>
    [
        ...(c.create ? [`${c.create} to create`] : []),
        ...(c.update ? [`${c.update} to update`] : []),
        ...(c.delete ? [`${c.delete} to delete`] : []),
        ...(c.skip ? [`${c.skip} identical`] : []),
        ...(c.blocked ? [`${c.blocked} blocked`] : []),
    ].join(", ") || "Nothing to restore"
/** What a restore grants beyond the server as it is: the permissions an overwrite gains and the settings that turn on, each on a line of its own */
const grants = (gain: BackupPlan["gain"]) => [
    ...(gain.items
        ? [
              `${gain.items} ${gain.items === 1 ? "item gives" : "items give"} more permissions than the server has now: ${permissionNames(gain.bits).join(", ")}`,
          ]
        : []),
    ...(gain.switches ? [`${gain.switches} ${gain.switches === 1 ? "setting turns" : "settings turn"} on`] : []),
]
/** What a match restore deletes, on a line of its own, since a deleted channel takes its messages with it */
const deletions = (counts: BackupPlan["counts"]) =>
    counts.delete
        ? [
              `${plural(counts.delete, "channel or category", "channels and categories")} will be deleted with ${counts.delete === 1 ? "its" : "their"} messages. This cannot be undone`,
          ]
        : []
/**
 * The items with a warning, such as messages they delete or post, counted where the owner reads first, since their own lines may sit on a later page.
 * A channel delete has the line above, so it does not count here
 */
const effects = (plan: BackupPlan) =>
    plan.warned
        ? [
              `${plan.warned} ${plan.warned === 1 ? "item has a warning" : "items have a warning"}, such as messages it deletes or posts, see ${plan.warned === 1 ? "its" : "their"} line`,
          ]
        : []
/** What an item will do, with its changed fields, the permissions or switches it adds and its reason */
const planLine = (i: BackupItem) =>
    `${itemTarget(i)}: ${i.disposition === "skip" && i.reason ? "Left alone" : dispositions[i.disposition]}${i.disposition === "update" && i.changed?.length ? ` (${i.changed.map(backupSettingName).join(", ")})` : ""}${i.gain ? ", more permissions than now" : ""}${i.on ? ", turns a setting on" : ""}${i.reason ? `. ${i.reason}` : ""}${i.warning ? `. ${i.warning}` : ""}`
/**
 * The website's work for the bot, always as the bot and never with the owner's sign-in. A refresh reads the stored archive message and the
 * server again, and a confirmed restore runs its next items, one pass of 20 at a time, until the backend says it ended
 */
export function processBackupJobPass(
    store: BackupStore,
    config: BotConfig,
    client: Client,
    syncPanel?: (panel: RolesPanel) => Effect.Effect<unknown, unknown>,
) {
    return Effect.gen(function* () {
        const { job } = yield* store.previewReady(config.serverId)
        if (!job) return
        // A run from chat that ended for lack of progress is told once, and runs nothing more
        if (job.ended && job.plan) {
            const plan = job.plan,
                failure = job.ended.failure
            if ((yield* store.outcomeClaim(config.serverId, job.requestedAt)).claimed)
                yield* postOutcome(store, config, client, job, plan, failure).pipe(Effect.catch(() => Effect.void))
            return
        }
        if (job.plan) {
            yield* runBackupJob(store, config, client, job, job.plan, syncPanel)
            return
        }
        if (!config.backupKey) {
            yield* store.previewFailed(config.serverId, job.requestedAt, "key")
            return
        }
        // The owner and private DM check comes first, so a sender who no longer owns the server is told apart from an unreadable archive
        const failure = yield* readBackupContext(client, config.serverId, job.ownerId, job.channelId).pipe(
            Effect.andThen(client.messages.fetch({ channelId: job.channelId, id: job.messageId }, { timeoutMs: 5000 })),
            Effect.flatMap((message) =>
                message.author.id === job.ownerId
                    ? makeBackupPlan(store, config, client, message, job.match, job.requestedAt)
                    : Effect.fail(new BackupHandlingError({ reason: "binding" })),
            ),
            Effect.as(undefined),
            Effect.catch((error) => Effect.succeed(previewFailure(error))),
        )
        if (failure) yield* store.previewFailed(config.serverId, job.requestedAt, failure)
    })
}
/**
 * One pass over the confirmed plan. The pass checks the Owner and the private DM as a chat confirmation does, and the backend decides from
 * what it recorded whether another pass follows. A sender who no longer owns the server stops the restore. Any other failure still reports
 * what the pass recorded before it. A run started from chat posts its outcome in the DM when the backend says it ended
 */
function runBackupJob(
    store: BackupStore,
    config: BotConfig,
    client: Client,
    job: BackupPreviewJob,
    plan: BackupPlan,
    syncPanel?: (panel: RolesPanel) => Effect.Effect<unknown, unknown>,
) {
    return Effect.gen(function* () {
        const results: Parameters<typeof processBackupPlanPass>[5] = []
        const stopped = yield* processBackupPlanPass(
            store,
            config,
            client,
            plan,
            job.channelId,
            results,
            syncPanel,
        ).pipe(
            Effect.as(undefined),
            Effect.catch((error) =>
                Effect.succeed(
                    error instanceof BackupPermissionError && (error.reason === "owner" || error.reason === "private")
                        ? ({ stopped: "owner" } as const)
                        : undefined,
                ),
            ),
        )
        const pass = { recorded: results.filter((r) => r.recorded).length, ...stopped }
        const step = yield* store.runStep({ serverId: config.serverId, requestedAt: job.requestedAt, ...pass })
        // A sender who no longer owns the server is not told anything about it
        if (step.ended && job.notify && step.ended.failure !== "owner")
            yield* postOutcome(store, config, client, job, plan, step.ended.failure).pipe(
                Effect.catch(() => Effect.void),
            )
    })
}
/** The outcome card of a run started from chat, posted in the owner's DM after the Owner and DM check */
function postOutcome(
    store: BackupStore,
    config: BotConfig,
    client: Client,
    job: BackupPreviewJob,
    plan: BackupPlan,
    failure: BackupPreviewFailure | undefined,
) {
    return Effect.gen(function* () {
        const context = yield* readBackupContext(client, config.serverId, job.ownerId, job.channelId)
        const found = yield* store.query({
            serverId: config.serverId,
            context,
            operation: { type: "plan", binding: backupBinding(plan) },
        })
        if (found.type !== "plan") return
        const label = config.scope?.mode === "multi" ? yield* serverLabel(client, config.serverId) : undefined
        for (const body of renderCard(outcomeCard(found.plan, failure, config), serverReplyStyle(config.serverId))) {
            yield* readBackupContext(client, config.serverId, job.ownerId, job.channelId)
            yield* client.messages.send(
                job.channelId,
                { ...(label ? serverReply(body, label) : body) },
                { timeoutMs: 5000 },
            )
        }
    })
}
function previewFailure(error: unknown): BackupPreviewFailedRequest["failure"] {
    if (error instanceof BackupPermissionError)
        return error.reason === "owner" || error.reason === "private" ? "owner" : "error"
    if (error instanceof BackupAttachmentError) return error.reason === "transport" ? "error" : "archive"
    if (error instanceof BackupStoreError) return error.status === 413 || error.status === 400 ? "refused" : "error"
    if (error instanceof BackupHandlingError || errors.isNotFound(error)) return "archive"
    return "error"
}
// NeonFlux accepts only the name pattern of the archives it sends, so a renamed copy is refused
const attachmentName =
    "Attach every .nfb part as NeonFlux sent it to one message, with its name unchanged, such as neonflux-backup-0123abcd-1of2.nfb. After neonflux-backup- a name may hold only letters, digits, - and _, so rename a copy such as neonflux-backup-0123abcd-1of2 (1).nfb first"
const previewFailureText: Record<BackupPreviewFailedRequest["failure"], string> = {
    owner: "Only the current server Owner can preview a restore, in a one-to-one DM with NeonFlux",
    archive: `The archive could not be read. Check that it belongs to this server and was made with the current backup key. ${attachmentName}`,
    key: keyMissing,
    refused: "A restore refuses this archive as a whole, because it does not hold what its header says",
    error: "The preview could not be made right now. Try again shortly",
}
const olderArchive =
    "This backup was made by an older NeonFlux and can no longer be restored. Make a new one with !backup export"
const allParts = (count: number) => `Attach all ${count} parts of this backup to one message`
const restoreRunning = "A restore is running. Preview again when it ends"
const planCapacity = `This server already has ${BACKUP_RESTORE_LIMITS.plans} restore plans that are not finished, the most it may have. A plan nobody confirmed is replaced by the next check, and a plan frees its place when its restore finishes or you forget it with !backup forget`
const itemStates: Record<BackupItemState, string> = {
    planned: "Waiting",
    reserved: "Starting",
    claimed: "In progress",
    created: "Created",
    updated: "Updated",
    deleted: "Deleted",
    skipped: "Already identical",
    conflict: "Left alone because it conflicts",
    blocked: "Blocked",
    failed: "Failed",
    uncertain: "Not confirmed yet",
}
// What a check after an unconfirmed creation found
const resolutions: Record<NonNullable<BackupItem["resolution"]>, string> = {
    match: "Created, found by a later check",
    absent: "Not created, a later check found it missing. It is not created again",
    conflict: "A later check found it, but it differs from the archive",
}
function itemLine(i: BackupItem) {
    if (i.resolution) return `${itemTarget(i)}: ${resolutions[i.resolution]}`
    if (i.state === "planned") return planLine(i)
    return `${itemTarget(i)}: ${itemStates[i.state]}${i.reason ? `. ${i.reason}` : ""}`
}
const stages = [
    "created",
    "updated",
    "deleted",
    "identical",
    "conflict",
    "blocked",
    "failed",
    "not confirmed",
    "still to do",
] as const
/** Where items in a state stand */
const stageOf: Record<BackupItemState, (typeof stages)[number]> = {
    created: "created",
    updated: "updated",
    deleted: "deleted",
    skipped: "identical",
    conflict: "conflict",
    blocked: "blocked",
    failed: "failed",
    uncertain: "not confirmed",
    planned: "still to do",
    reserved: "still to do",
    claimed: "still to do",
}
/** How many of a plan's items are at each stage, from its count of items by state */
function stageCounts(plan: BackupPlan) {
    const counts = new Map<string, number>()
    for (const [state, n] of Object.entries(plan.states) as [BackupItemState, number | undefined][])
        if (n) counts.set(stageOf[state], (counts.get(stageOf[state]) ?? 0) + n)
    return counts
}
/** Where a plan's items stand in one line, such as 12 created, 1 failed, 20 still to do */
function progress(plan: BackupPlan) {
    const counts = stageCounts(plan)
    return (
        stages
            .filter((name) => counts.get(name))
            .map((name) => (name === "conflict" ? plural(counts.get(name)!, name) : `${counts.get(name)} ${name}`))
            .join(", ") || "No items"
    )
}
/** Whether a plan has items that need the owner's attention: blocked, conflicting or failed, or a channel write not confirmed */
const problems = (plan: BackupPlan) =>
    plan.counts.blocked > 0 ||
    ["conflict", "blocked", "failed", "uncertain"].some((s) => plan.states[s as BackupItemState])
/**
 * A restore plan in two lines: Its decisions or progress, then whether it waits, runs or expired. The note names at most two next steps. A
 * confirmed plan runs until it is done, so only a plan nobody confirmed expires
 */
function planCard(plan: BackupPlan, now: number, config: BotConfig): Card {
    const command = (text: string) => code(serverCommands(text, config)),
        confirmed = plan.confirmedAt !== undefined,
        open = !plan.forgotten && (confirmed || now < plan.expiresAt),
        toDo = stageCounts(plan).get("still to do") ?? 0
    const state = plan.forgotten
        ? "Forgotten"
        : plan.state === "building"
          ? "NeonFlux is still checking the archive"
          : confirmed
            ? `Confirmed ${ago(plan.confirmedAt!)}${toDo ? "" : ". Every item is done"}`
            : !open
              ? `Expired ${ago(plan.expiresAt)}`
              : `Waiting for your confirmation. Expires ${at(plan.expiresAt)}`
    const steps = [
        ...(plan.forgotten || plan.state === "building" || (confirmed && !toDo)
            ? []
            : open
              ? [
                    confirmed
                        ? `If it stopped, ${command("!backup confirm")} continues it`
                        : `Send ${command("!backup confirm")} to start`,
                ]
              : [`Attach the archive to ${command("!backup preview")} again to make a new plan`]),
        ...(plan.states.uncertain
            ? [`${command("!backup reconcile")} checks the channels that were not confirmed`]
            : []),
        ...(!confirmed
            ? [`${command("!backup items")} lists each item, problems first`]
            : problems(plan)
              ? [`${command("!backup items")} lists problems first`]
              : []),
    ]
    return {
        title: "Restore plan",
        description: [
            confirmed ? progress(plan) : decisions(plan.counts),
            ...(confirmed ? [] : [...grants(plan.gain), ...deletions(plan.counts)]),
            state,
        ].join("\n"),
        ...(steps.length ? { note: steps.slice(0, 2).join(". ") } : {}),
        footer: confirmed
            ? "Finished items stay in place and nothing is rolled back"
            : `Blocked items stay untouched. Settings, XP and channels that differ change to match the archive${plan.match ? ", and the channels and categories it does not hold are deleted" : ", and nothing is deleted"}`,
    }
}
/** One page of a restore preview, which is the plan a confirmation runs, problems first, with the command for the next page */
function previewCard(
    plan: BackupPlan,
    items: readonly BackupItem[],
    next: string | undefined,
    config: BotConfig,
): Card {
    return {
        title: "Restore preview",
        description: [
            `Checked ${ago(plan.createdAt)}, ${plan.confirmedAt === undefined ? "nothing changed yet" : `confirmed ${ago(plan.confirmedAt)}`}. ${decisions(plan.counts)}`,
            ...grants(plan.gain),
            ...deletions(plan.counts),
            ...effects(plan),
            ...items.map(itemLine),
        ].join("\n"),
        fields: next === undefined ? [] : [["Next", code(serverCommands("!backup preview next", config))]],
        ...(plan.confirmedAt === undefined
            ? {
                  note: `To restore, send ${code(serverCommands("!backup confirm", config))} before ${at(plan.expiresAt)}. A restore checks every item again`,
              }
            : {}),
    }
}
/** One page of a plan's items, problems first */
function itemsCard(plan: BackupPlan, items: readonly BackupItem[], next: string | undefined, config: BotConfig): Card {
    return {
        title: "Restore items",
        description: items.map(itemLine).join("\n") || "This plan has no items",
        fields: next === undefined ? [] : [["Next", code(serverCommands("!backup items next", config))]],
        ...(items.some((i) => i.state === "uncertain" && !i.resolution)
            ? {
                  note: `${code(serverCommands("!backup reconcile", config))} checks the channels that were not confirmed`,
              }
            : {}),
        ...(problems(plan) ? { footer: "Items that need attention come first" } : {}),
    }
}
/** Why a run stopped before every item settled */
const stoppedWhy: Partial<Record<BackupPreviewFailure, string>> = {
    paused: "DEFCON 1 pauses restores. Send !backup confirm once DEFCON is lower to continue",
    expired:
        "The restore stopped because NeonFlux made no progress for 10 minutes. Send !backup confirm to continue it",
    error: "The restore could not go on. Send !backup confirm to continue it",
}
/** What a run did, posted in the DM when it ends, with at most two next steps */
function outcomeCard(plan: BackupPlan, failure: BackupPreviewFailure | undefined, config: BotConfig): Card {
    const command = (text: string) => code(serverCommands(text, config))
    const steps = [
        ...(failure && stoppedWhy[failure] ? [serverCommands(stoppedWhy[failure]!, config)] : []),
        ...(plan.states.uncertain
            ? [
                  `${command("!backup reconcile")} checks the channels that were not confirmed, a few minutes after they were tried`,
              ]
            : []),
        ...(problems(plan) ? [`${command("!backup items")} lists problems first`] : []),
    ]
    return {
        title: failure ? "Restore stopped" : "Restore finished",
        description: progress(plan),
        ...(steps.length ? { note: steps.slice(0, 2).join(". ") } : {}),
        footer: "Finished items stay in place. Nothing is rolled back",
    }
}
const reconcileWords: Record<NonNullable<BackupItem["resolution"]>, string> = {
    match: "found as planned",
    absent: "missing and not created again",
    conflict: "found but different from the archive",
}
export function handleBackupCommand(
    store: BackupStore | undefined,
    config: BotConfig,
    command: BackupCommand,
    context: BotEventContext<"messageCreate">,
) {
    return Effect.gen(function* () {
        const { message, client } = context
        if (message.guildId !== undefined) {
            if (message.guildId === config.serverId)
                yield* context.reply({
                    content: `Use !backup help in a one-to-one DM with NeonFlux${dmServerHint(config)}. Backup and restore require the current server Owner`,
                })
            return
        }
        if (message.author.isBot || message.author.isSystem || message.webhookId) return
        let fresh = yield* readBackupContext(client, config.serverId, message.author.id, message.channelId)
        const label = config.scope?.mode === "multi" ? yield* serverLabel(client, config.serverId) : undefined
        // Each message rechecks the owner and the private conversation right before it leaves
        const deliver = (bodies: readonly RenderedReply[]) =>
            Effect.gen(function* () {
                if (JSON.stringify(bodies).length > 64000)
                    return yield* Effect.fail(new BackupHandlingError({ reason: "capacity" }))
                for (const body of bodies) {
                    yield* readBackupContext(client, config.serverId, message.author.id, message.channelId)
                    yield* client.messages.send(
                        message.channelId,
                        { ...(label ? serverReply(body, label) : body) },
                        { timeoutMs: 5000 },
                    )
                }
            })
        const send = (content: string) =>
            deliver(text.split(content, { maxLength: 1900 }).map((piece) => ({ content: piece })))
        const card = (value: Card) => deliver(renderCard(value, serverReplyStyle(config.serverId)))
        if ("error" in command || command.type === "help") {
            yield* send(serverCommands("error" in command ? command.error : backupHelp, config))
            return
        }
        if (!config.backupKey && ["export", "inspect"].includes(command.type)) {
            yield* send(keyMissing)
            return
        }
        if (!store) {
            yield* send(notSetUp("Backups"))
            return
        }
        const run = Effect.gen(function* () {
            const provider = yield* providerFor(client)
            if (command.type === "export") {
                const categories = command.selected.filter((c): c is "config" | "xp" => c !== "structure")
                // The database is read in pages, each with a fresh Owner check, until the backend says there is no next page
                const config_: BackupManifest["config"] = [],
                    xp: BackupManifest["xp"] = [],
                    cursors = new Set<string>()
                let databaseAt: number | null = null,
                    cursor: string | undefined
                while (categories.length) {
                    const page = yield* store.snapshotPage({
                        serverId: config.serverId,
                        context: fresh,
                        selected: categories,
                        ...(cursor ? { cursor } : {}),
                    })
                    databaseAt ??= page.capturedAt
                    config_.push(...page.config)
                    xp.push(...page.xp)
                    if (page.cursor === null) break
                    if (cursors.has(page.cursor))
                        return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
                    cursors.add(page.cursor)
                    cursor = page.cursor
                    fresh = yield* readBackupContext(client, config.serverId, message.author.id, message.channelId)
                }
                const captured = command.selected.includes("structure")
                    ? yield* captureBackupStructure(client, config.serverId, message.author.id, message.channelId)
                    : undefined
                const native = captured && {
                    ...captured,
                    objects: yield* markManagedChannels(store, config, client, message, captured.objects),
                }
                const capturedAt = yield* Clock.currentTimeMillis
                const draft = {
                    version: 2,
                    backupId: randomUUID().replaceAll("-", ""),
                    provider,
                    serverId: config.serverId,
                    selected: command.selected,
                    capturedAt,
                    observations: {
                        databaseAt,
                        structureStartedAt: native?.startedAt ?? null,
                        structureFinishedAt: native?.finishedAt ?? null,
                    },
                    counts: {
                        config: config_.length,
                        xp: xp.length,
                        structure: native?.objects.length ?? 0,
                        overwrites: native?.objects.reduce((n, c) => n + c.overwrites.length, 0) ?? 0,
                    },
                    exclusions: [...backupExclusions],
                    config: config_,
                    xp,
                    structure: native?.objects ?? [],
                }
                const manifest = yield* Effect.try({
                    try: () => validateBackupManifest(draft),
                    catch: () => new BackupHandlingError({ reason: "capacity" }),
                })
                const parts = yield* Effect.try({
                    try: () => encryptBackupManifest(manifest, config.backupKey!),
                    catch: (error) =>
                        new BackupHandlingError({
                            reason:
                                error instanceof BackupCryptoError && error.reason === "size" ? "capacity" : "snapshot",
                        }),
                })
                yield* uploadBackupAttachments(
                    client,
                    message.channelId,
                    parts,
                    manifest.backupId,
                    readBackupContext(client, config.serverId, message.author.id, message.channelId),
                    label,
                )
                return
            }
            // The owner never types a plan's ID and hashes. The bot remembers the plan it showed this owner last, delivered in full, and every later
            // command sends that exact binding, so the backend's check that the confirmed plan is the one shown stays the same
            const planKey = pageKey(config.serverId, message, "backup", "plan")
            const replaced = () =>
                Effect.gen(function* () {
                    rememberPosition(planKey, undefined)
                    yield* send(
                        serverCommands(
                            "That preview was replaced. Send !backup status to pick up the newest plan, or attach the archive to !backup preview again",
                            config,
                        ),
                    )
                })
            // A plan that a newer check replaced is forgotten, and retention removes it later, so the backend may no longer find it
            const readPlan = (binding: BackupBinding) =>
                store.query({ serverId: config.serverId, context: fresh, operation: { type: "plan", binding } }).pipe(
                    Effect.map((found) => (found.type === "plan" && !found.plan.forgotten ? found.plan : undefined)),
                    Effect.catch((error) =>
                        error instanceof BackupStoreError && error.status === 404
                            ? Effect.succeed(undefined)
                            : Effect.fail(error),
                    ),
                )
            if (command.type === "preview") {
                // A preview is a plan, so the first page of it and each next page read the plan the owner can confirm
                const key = pageKey(config.serverId, message, "backup", "preview")
                const shown = (plan: BackupPlan, cursor: string | undefined) =>
                    Effect.gen(function* () {
                        const page = yield* readPage(store, config, client, plan, message.channelId, cursor)
                        yield* card(previewCard(plan, page.items, page.next, config))
                        rememberPosition(
                            key,
                            page.next === undefined ? undefined : { planId: plan.planId, cursor: page.next },
                        )
                        rememberPosition(planKey, backupBinding(plan))
                    })
                if (command.match && !message.attachments.length) {
                    yield* send(
                        serverCommands(
                            "Match needs the archive. Attach every part of the encrypted .nfb archive to !backup preview match",
                            config,
                        ),
                    )
                    return
                }
                if (command.next || !message.attachments.length) {
                    const binding = nextPosition<BackupBinding>(planKey),
                        start = command.next
                            ? nextPosition<{ planId: string; cursor: string }>(key)
                            : { planId: binding?.planId, cursor: undefined }
                    if (!binding || start?.planId !== binding.planId) {
                        yield* send(
                            serverCommands(
                                command.next
                                    ? noNextPage("!backup preview")
                                    : "No restore preview yet. Attach an encrypted .nfb archive to !backup preview, or send !backup status to pick up your latest plan",
                                config,
                            ),
                        )
                        return
                    }
                    const plan = yield* readPlan(binding)
                    if (!plan || plan.ownerId !== message.author.id || plan.provider !== provider) {
                        yield* replaced()
                        return
                    }
                    yield* shown(plan, start.cursor)
                    return
                }
                if (!config.backupKey) {
                    yield* send(keyMissing)
                    return
                }
                const made = yield* makeBackupPlan(store, config, client, message, !!command.match).pipe(
                    Effect.map((plan) => ({ plan })),
                    // A file with the wrong name, size or type has its own reply, and so do an older archive and missing parts
                    Effect.catch((error) =>
                        error instanceof BackupAttachmentError && error.reason === "metadata"
                            ? Effect.fail(error)
                            : Effect.succeed({
                                  failure:
                                      error instanceof BackupHandlingError && error.reason === "version"
                                          ? serverCommands(olderArchive, config)
                                          : error instanceof BackupHandlingError && error.reason === "parts"
                                            ? allParts(error.partCount ?? 1)
                                            : error instanceof BackupStoreError && error.status === 409
                                              ? restoreRunning
                                              : error instanceof BackupStoreError && error.status === 429
                                                ? serverCommands(planCapacity, config)
                                                : previewFailureText[previewFailure(error)],
                              }),
                    ),
                )
                if ("failure" in made) {
                    yield* send(made.failure)
                    return
                }
                yield* shown(made.plan, undefined)
                return
            }
            if (command.type === "inspect") {
                if (!message.attachments.length || message.attachments.length > BACKUP_RESTORE_LIMITS.parts) {
                    yield* send(
                        serverCommands("Attach every part of one encrypted .nfb archive to !backup inspect", config),
                    )
                    return
                }
                const parts = yield* downloadBackupAttachments(client, { serverId: config.serverId, message })
                const { manifest } = yield* readArchive(config, parts, provider)
                yield* card({
                    title: "Backup archive",
                    fields: [
                        [
                            "Contains",
                            manifest.selected
                                .map((category) =>
                                    category === "config" ? "settings" : category === "xp" ? "XP" : "channels",
                                )
                                .join(", "),
                        ],
                        ["Settings", String(manifest.counts.config)],
                        ["XP profiles", String(manifest.counts.xp)],
                        ["Channels", String(manifest.counts.structure)],
                        ["Parts", String(parts.length)],
                        ["Made", ago(manifest.capturedAt)],
                        [
                            "Not included",
                            capital(
                                [...new Set(manifest.exclusions.map((name) => exclusionNames[name] ?? name))].join(
                                    ", ",
                                ),
                            ),
                        ],
                    ],
                    footer: "Settings and channels were read one after the other, so they may differ slightly in time",
                })
                return
            }
            const showPlan = (plan: BackupPlan) =>
                Effect.gen(function* () {
                    yield* card(planCard(plan, yield* Clock.currentTimeMillis, config))
                    rememberPosition(planKey, backupBinding(plan))
                })
            if (command.type === "status") {
                // The owner's newest plan that is not forgotten. A server holds at most 10 unfinished plans, and the first page holds 20
                const result = yield* store.query({
                    serverId: config.serverId,
                    context: fresh,
                    operation: { type: "plans" },
                })
                if (result.type !== "plans") return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
                const latest = result.plans
                    .filter(
                        (plan) => !plan.forgotten && plan.ownerId === message.author.id && plan.provider === provider,
                    )
                    .sort((a, b) => b.createdAt - a.createdAt)[0]
                if (!latest) {
                    yield* send(
                        serverCommands(
                            "No restore plans yet. Attach an encrypted .nfb archive to !backup preview",
                            config,
                        ),
                    )
                    return
                }
                yield* showPlan(latest)
                return
            }
            if (
                command.type !== "items" &&
                command.type !== "confirm" &&
                command.type !== "reconcile" &&
                command.type !== "forget"
            )
                return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            const binding = nextPosition<BackupBinding>(planKey)
            if (!binding) {
                yield* send(
                    serverCommands(
                        "There is no restore plan to work on here. Attach the archive to !backup preview again, or send !backup status to pick up your latest plan",
                        config,
                    ),
                )
                return
            }
            const found = yield* readPlan(binding)
            if (!found) {
                yield* replaced()
                return
            }
            if (found.ownerId !== message.author.id || found.provider !== provider)
                return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            if (command.type === "items") {
                const key = pageKey(config.serverId, message, "backup", "items")
                const start = command.next
                    ? nextPosition<{ planId: string; cursor: string }>(key)
                    : { planId: binding.planId, cursor: undefined }
                if (start?.planId !== binding.planId) {
                    yield* send(serverCommands(noNextPage("!backup items"), config))
                    return
                }
                const page = yield* readPage(store, config, client, found, message.channelId, start.cursor)
                yield* card(itemsCard(found, page.items, page.next, config))
                rememberPosition(
                    key,
                    page.next === undefined ? undefined : { planId: binding.planId, cursor: page.next },
                )
                return
            }
            if (command.type === "reconcile") {
                const items = yield* reconcileBackupPlan(store, config, client, found, message.channelId)
                if (!items.length) {
                    yield* send(
                        "No channels need checking. A channel whose creation was not confirmed stays blocked and is never created again",
                    )
                    return
                }
                const checked = Object.entries(reconcileWords)
                    .map(
                        ([resolution, words]) =>
                            [items.filter((i) => i.resolution === resolution).length, words] as const,
                    )
                    .filter(([count]) => count)
                yield* card({
                    title: "Restore check",
                    description: `Checked ${plural(items.length, "channel")}: ${checked.map(([count, words]) => `${count} ${words}`).join(", ")}`,
                    note:
                        items.length >= 20
                            ? `Send ${code(serverCommands("!backup reconcile", config))} again to check more`
                            : `${code(serverCommands("!backup items", config))} shows each one`,
                })
                return
            }
            if (command.type === "confirm") {
                if (found.state === "building") {
                    yield* send(
                        serverCommands(
                            "NeonFlux is still checking this archive. Send !backup status in a moment",
                            config,
                        ),
                    )
                    return
                }
                // A check nobody confirmed stays confirmable for a day, and a confirmed plan runs again until it is done
                if (
                    found.forgotten ||
                    (found.confirmedAt === undefined && (yield* Clock.currentTimeMillis) >= found.expiresAt)
                ) {
                    yield* send(
                        serverCommands(
                            `This restore plan ${found.forgotten ? "was forgotten" : `expired ${ago(found.expiresAt)}`}. Attach the archive to !backup preview again to make a new one`,
                            config,
                        ),
                    )
                    return
                }
            }
            fresh = yield* readBackupContext(client, config.serverId, message.author.id, message.channelId)
            const result = yield* store
                .manage({
                    serverId: config.serverId,
                    messageId: message.id,
                    createdAt: yield* sourceTimestamp(message),
                    context: fresh,
                    operation: { type: command.type, binding },
                })
                .pipe(
                    Effect.map((value) => ({ value })),
                    // Another plan's restore is running, so this one waits for it
                    Effect.catch((error) =>
                        command.type === "confirm" && error instanceof BackupStoreError && error.status === 409
                            ? Effect.succeed({ running: true as const })
                            : Effect.fail(error),
                    ),
                )
            if ("running" in result) {
                yield* send(
                    serverCommands("Another restore is running. Send !backup confirm again when it ends", config),
                )
                return
            }
            if (command.type === "forget") {
                rememberPosition(planKey, undefined)
                yield* send(
                    "Restore plan forgotten. Created channels stay, and NeonFlux still knows which archive channels they came from",
                )
                return
            }
            if (result.value.type !== "confirmed")
                return yield* Effect.fail(new BackupHandlingError({ reason: "binding" }))
            // The run goes on in the background, since this command sits in the message pipeline
            yield* send(
                serverCommands(
                    result.value.run === "running"
                        ? "This restore is running. NeonFlux posts the outcome here when it ends. !backup status shows progress"
                        : `Restore started: ${plural(result.value.plan.itemCount, "item")}. NeonFlux runs it to the end and posts the outcome here. !backup status shows progress`,
                    config,
                ),
            )
        })
        yield* run.pipe(
            Effect.catch((error) =>
                error instanceof BackupAttachmentError && error.reason === "metadata"
                    ? send(`NeonFlux cannot use the attached file. Check its name, size and type. ${attachmentName}`)
                    : error instanceof BackupHandlingError && error.reason === "version"
                      ? send(serverCommands(olderArchive, config))
                      : error instanceof BackupHandlingError && error.reason === "parts"
                        ? send(allParts(error.partCount ?? 1))
                        : error instanceof BackupPermissionError && error.reason === "limit"
                          ? send(
                                `This server lists more than ${STRUCTURE_CHANNELS} channels, more than Fluxer allows in a server, so NeonFlux cannot read them as one structure. Export config or XP only`,
                            )
                          : error instanceof BackupHandlingError && error.reason === "capacity"
                            ? send(
                                  "This backup is larger than an archive holds, 40 MiB in at most 10 parts. Export fewer categories at a time",
                              )
                            : error instanceof BackupHandlingError && error.reason === "archive"
                              ? send(
                                    "NeonFlux cannot read that file as a backup. Send an archive that NeonFlux made, with the current backup key",
                                )
                              : send(
                                    serverCommands(
                                        "The backup command was refused or could not be checked. Make sure you still own the server, this is a one-to-one DM, and the archive was made with the current backup key. " +
                                            "Run !backup status to see where a restore stands. A channel whose creation was not confirmed is never created again",
                                        config,
                                    ),
                                ),
            ),
        )
    })
}
